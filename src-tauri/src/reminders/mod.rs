//! Reminders projection. A reminder is "tell me about X at time T", optionally
//! repeating and optionally attached to a task. Event-sourced like everything
//! else; the scheduler in `scheduler.rs` decides when to fire and appends the
//! `reminder.fired` / `reminder.task_fired` events so a restart never
//! re-notifies something the user already saw.

use crate::store::StoredEvent;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub mod scheduler;

pub const DAY_MS: i64 = 86_400_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Repeat {
    #[default]
    None,
    Daily,
    Weekdays,
    Weekly,
}

impl Repeat {
    pub fn from_label(s: &str) -> Self {
        match s {
            "daily" => Repeat::Daily,
            "weekdays" => Repeat::Weekdays,
            "weekly" => Repeat::Weekly,
            _ => Repeat::None,
        }
    }
    pub fn label(self) -> &'static str {
        match self {
            Repeat::None => "none",
            Repeat::Daily => "daily",
            Repeat::Weekdays => "weekdays",
            Repeat::Weekly => "weekly",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Reminder {
    pub id: String,
    pub workspace_id: Option<String>,
    pub title: String,
    pub due_ms: i64,
    #[serde(default)]
    pub repeat: Repeat,
    /// Minutes east of UTC where the reminder was set; used to keep
    /// repeating reminders on the same local wall-clock time and to know
    /// which days are weekdays.
    #[serde(default)]
    pub tz_offset_min: i32,
    #[serde(default)]
    pub task_id: Option<String>,
    pub created_ms: i64,
    /// Last time this reminder notified. For repeating reminders `due_ms`
    /// has already moved on to the next occurrence.
    #[serde(default)]
    pub fired_ms: Option<i64>,
    #[serde(default)]
    pub done: bool,
}

/// Day-of-week in the reminder's local zone: 0 = Monday … 6 = Sunday.
fn local_weekday(ms: i64, tz_offset_min: i32) -> i64 {
    let local_days = (ms + tz_offset_min as i64 * 60_000).div_euclid(DAY_MS);
    // 1970-01-01 was a Thursday (index 3).
    (local_days + 3).rem_euclid(7)
}

/// First occurrence strictly after `after_ms` following `repeat`, keeping
/// the wall-clock time of `due_ms`.
pub fn next_occurrence(
    due_ms: i64,
    repeat: Repeat,
    tz_offset_min: i32,
    after_ms: i64,
) -> Option<i64> {
    let step = match repeat {
        Repeat::None => return None,
        Repeat::Daily | Repeat::Weekdays => DAY_MS,
        Repeat::Weekly => 7 * DAY_MS,
    };
    let mut next = due_ms;
    // Bounded loop: a reminder years overdue still terminates quickly.
    for _ in 0..20_000 {
        next += step;
        if next <= after_ms {
            continue;
        }
        if repeat == Repeat::Weekdays && local_weekday(next, tz_offset_min) >= 5 {
            continue;
        }
        return Some(next);
    }
    None
}

#[derive(Default)]
pub struct RemindersProjection {
    items: HashMap<String, Reminder>,
    /// task_id → due_ms that has already been notified.
    fired_tasks: HashMap<String, i64>,
}

impl RemindersProjection {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn apply(&mut self, ev: &StoredEvent) {
        match ev.kind.as_str() {
            "workspace.deleted" | "workspace.recovered" => {
                if let (Some(source), Some(destination)) = (
                    ev.payload["id"].as_str(),
                    ev.payload["destination_id"].as_str(),
                ) {
                    for r in self
                        .items
                        .values_mut()
                        .filter(|r| r.workspace_id.as_deref().unwrap_or_default() == source)
                    {
                        r.workspace_id = Some(destination.into());
                    }
                }
            }
            "reminder.created" => {
                let id = ev.payload["id"].as_str().unwrap_or_default().to_string();
                let Some(due_ms) = ev.payload["due_ms"].as_i64() else {
                    return;
                };
                if id.is_empty() {
                    return;
                }
                self.items.insert(
                    id.clone(),
                    Reminder {
                        id,
                        workspace_id: ev.payload["workspace_id"].as_str().map(Into::into),
                        title: ev.payload["title"].as_str().unwrap_or("").to_string(),
                        due_ms,
                        repeat: ev.payload["repeat"]
                            .as_str()
                            .map(Repeat::from_label)
                            .unwrap_or_default(),
                        tz_offset_min: ev.payload["tz_offset_min"].as_i64().unwrap_or(0) as i32,
                        task_id: ev.payload["task_id"].as_str().map(Into::into),
                        created_ms: ev.ts_ms,
                        fired_ms: None,
                        done: false,
                    },
                );
            }
            "reminder.updated" => {
                let id = ev.payload["id"].as_str().unwrap_or_default();
                if let Some(r) = self.items.get_mut(id) {
                    if let Some(title) = ev.payload["title"].as_str() {
                        r.title = title.to_string();
                    }
                    if let Some(due) = ev.payload["due_ms"].as_i64() {
                        r.due_ms = due;
                        r.done = false;
                    }
                    if let Some(rep) = ev.payload["repeat"].as_str() {
                        r.repeat = Repeat::from_label(rep);
                    }
                    if let Some(tz) = ev.payload["tz_offset_min"].as_i64() {
                        r.tz_offset_min = tz as i32;
                    }
                }
            }
            "reminder.snoozed" => {
                let id = ev.payload["id"].as_str().unwrap_or_default();
                if let (Some(r), Some(due)) =
                    (self.items.get_mut(id), ev.payload["due_ms"].as_i64())
                {
                    r.due_ms = due;
                    r.done = false;
                }
            }
            "reminder.fired" => {
                let id = ev.payload["id"].as_str().unwrap_or_default();
                if let Some(r) = self.items.get_mut(id) {
                    r.fired_ms = Some(ev.ts_ms);
                    match next_occurrence(r.due_ms, r.repeat, r.tz_offset_min, ev.ts_ms) {
                        Some(next) => r.due_ms = next,
                        None => r.done = true,
                    }
                }
            }
            "reminder.done" => {
                let id = ev.payload["id"].as_str().unwrap_or_default();
                if let Some(r) = self.items.get_mut(id) {
                    r.done = true;
                }
            }
            "reminder.deleted" => {
                let id = ev.payload["id"].as_str().unwrap_or_default();
                self.items.remove(id);
            }
            "reminder.task_fired" => {
                if let (Some(task), Some(due)) = (
                    ev.payload["task_id"].as_str(),
                    ev.payload["due_ms"].as_i64(),
                ) {
                    self.fired_tasks.insert(task.to_string(), due);
                }
            }
            "task.deleted" => {
                let id = ev.payload["id"].as_str().unwrap_or_default();
                self.fired_tasks.remove(id);
                self.items.retain(|_, r| r.task_id.as_deref() != Some(id));
            }
            _ => {}
        }
    }

    /// Every reminder, soonest first; done ones last.
    pub fn list(&self) -> Vec<Reminder> {
        let mut v: Vec<Reminder> = self.items.values().cloned().collect();
        v.sort_by(|a, b| a.done.cmp(&b.done).then(a.due_ms.cmp(&b.due_ms)));
        v
    }

    pub fn get(&self, id: &str) -> Option<&Reminder> {
        self.items.get(id)
    }

    /// Scheduled reminders whose time has come.
    pub fn due(&self, now_ms: i64) -> Vec<Reminder> {
        let mut v: Vec<Reminder> = self
            .items
            .values()
            .filter(|r| !r.done && r.due_ms <= now_ms)
            .cloned()
            .collect();
        v.sort_by_key(|r| r.due_ms);
        v
    }

    pub fn task_already_fired(&self, task_id: &str, due_ms: i64) -> bool {
        self.fired_tasks.get(task_id) == Some(&due_ms)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(kind: &str, ts_ms: i64, payload: serde_json::Value) -> StoredEvent {
        StoredEvent {
            id: 0,
            ts_ms,
            kind: kind.into(),
            payload,
        }
    }

    #[test]
    fn weekday_math_matches_known_dates() {
        // 2026-10-27 09:00 UTC is a Tuesday.
        let tue = 1_793_091_600_000;
        assert_eq!(local_weekday(tue, 0), 1);
        // Same instant is still Tuesday at UTC+5:30 and Monday night at UTC-10.
        assert_eq!(local_weekday(tue, 330), 1);
        assert_eq!(local_weekday(tue - 9 * 3_600_000, -600), 0);
    }

    #[test]
    fn weekdays_skip_the_weekend() {
        // Friday 2026-10-30 09:00 UTC.
        let fri = 1_793_350_800_000;
        let next = next_occurrence(fri, Repeat::Weekdays, 0, fri).unwrap();
        assert_eq!(local_weekday(next, 0), 0);
        assert_eq!(next, fri + 3 * DAY_MS);
        assert_eq!(
            next_occurrence(fri, Repeat::Weekly, 0, fri),
            Some(fri + 7 * DAY_MS)
        );
        assert_eq!(next_occurrence(fri, Repeat::None, 0, fri), None);
        // Catch up past a long gap in one step.
        assert!(
            next_occurrence(fri, Repeat::Daily, 0, fri + 40 * DAY_MS).unwrap() > fri + 40 * DAY_MS
        );
    }

    #[test]
    fn firing_advances_repeating_and_finishes_one_shot() {
        let mut p = RemindersProjection::new();
        p.apply(&ev(
            "reminder.created",
            1_000,
            serde_json::json!({"id":"a","title":"Standup","due_ms":10_000,"repeat":"daily"}),
        ));
        p.apply(&ev(
            "reminder.created",
            1_000,
            serde_json::json!({"id":"b","title":"Dentist","due_ms":10_000}),
        ));
        assert_eq!(p.due(9_999).len(), 0);
        assert_eq!(p.due(10_000).len(), 2);
        p.apply(&ev("reminder.fired", 10_500, serde_json::json!({"id":"a"})));
        p.apply(&ev("reminder.fired", 10_500, serde_json::json!({"id":"b"})));
        let a = p.get("a").unwrap();
        assert!(!a.done && a.due_ms == 10_000 + DAY_MS && a.fired_ms == Some(10_500));
        assert!(p.get("b").unwrap().done);
        assert!(p.due(11_000).is_empty());
        p.apply(&ev(
            "reminder.snoozed",
            11_000,
            serde_json::json!({"id":"b","due_ms":20_000}),
        ));
        assert_eq!(
            p.due(20_000)
                .iter()
                .map(|r| r.id.as_str())
                .collect::<Vec<_>>(),
            vec!["b"]
        );
        assert_eq!(p.list()[0].id, "b");
    }

    #[test]
    fn task_fired_memo_and_task_deletion() {
        let mut p = RemindersProjection::new();
        assert!(!p.task_already_fired("t1", 5));
        p.apply(&ev(
            "reminder.task_fired",
            5,
            serde_json::json!({"task_id":"t1","due_ms":5}),
        ));
        assert!(p.task_already_fired("t1", 5));
        assert!(!p.task_already_fired("t1", 6));
        p.apply(&ev(
            "reminder.created",
            1,
            serde_json::json!({"id":"r","title":"x","due_ms":9,"task_id":"t1"}),
        ));
        p.apply(&ev("task.deleted", 7, serde_json::json!({"id":"t1"})));
        assert!(p.get("r").is_none());
        assert!(!p.task_already_fired("t1", 5));
    }
}

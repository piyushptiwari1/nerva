//! Habits projection — daily habit tracker.
//!
//! Design notes (informed by complaints about every other habit-tracker app on
//! the market):
//!   - **Skip-honored streaks**: missing a day on holiday should not nuke a
//!     hard-won streak. An entry with `skipped = true` counts as neutral —
//!     neither success nor failure — for streak math and completion %.
//!   - **No paywalls, no quotas**: any number of habits, any kind.
//!   - **Three kinds covering 95% of real-world use**:
//!       `Bool`    — yes / no       (e.g. meditate)
//!       `Count`   — integer reps   (e.g. push-ups, glasses of water as units)
//!       `Amount`  — floating value (e.g. minutes, miles, ml)
//!   - **Per-entry value is signed f64**; the projection knows how to interpret
//!     it given the habit kind. Target (if set) defines "complete" for the day.
//!
//! Event-sourced like the rest of Nerva — all mutations go through
//! `store.append_event` and the projection is rebuilt by replaying the log.

use crate::store::StoredEvent;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HabitKind {
    /// Yes/no completion. Target ignored. value == 1.0 → done.
    Bool,
    /// Integer count (e.g. "10 push-ups"). value is the count. If target set,
    /// day is complete when value >= target.
    Count,
    /// Free-form numeric (e.g. "30 minutes meditation"). value is the amount.
    /// Same target semantics as Count.
    Amount,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Habit {
    pub id: String,
    pub workspace_id: Option<String>,
    pub name: String,
    pub kind: HabitKind,
    /// Daily target. `None` means "any positive value = complete".
    pub target: Option<f64>,
    /// Display unit for amount/count habits (e.g. "min", "ml", "reps").
    pub unit: Option<String>,
    pub color: String,
    pub created_ms: i64,
    pub archived: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HabitEntry {
    pub habit_id: String,
    /// ISO YYYY-MM-DD in local time. We keep entries day-keyed (not ts_ms)
    /// because users think in days, not in epochs.
    pub day: String,
    pub value: f64,
    pub skipped: bool,
    pub updated_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct HabitStats {
    pub habit_id: String,
    /// Consecutive streak ending today: completed or skipped days count;
    /// missed days break the streak.
    pub current_streak: u32,
    /// Best streak ever observed.
    pub best_streak: u32,
    /// Completion % over the last 30 days, ignoring skipped days in the
    /// denominator (so vacation doesn't tank your average).
    pub completion_30d: f64,
    /// Completion % all-time, same skip semantics.
    pub completion_all: f64,
    /// Number of completed days, all-time.
    pub total_completions: u32,
    /// Per-weekday completion %, indexed Mon..Sun (0..6).
    pub weekday_rate: [f64; 7],
    /// 30-day sparkline: value per day, oldest → newest. For Bool this is
    /// 0.0/1.0; for Count/Amount it's the raw value (caller renders it).
    pub sparkline_30d: Vec<f64>,
}

#[derive(Default)]
pub struct HabitsProjection {
    habits: HashMap<String, Habit>,
    /// `habit_id -> { day_iso -> entry }`. BTreeMap so we get cheap ordered
    /// iteration for streak math.
    entries: HashMap<String, BTreeMap<String, HabitEntry>>,
}

impl HabitsProjection {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn apply(&mut self, ev: &StoredEvent) {
        match ev.kind.as_str() {
            "habit.created" => {
                let id = ev.payload["id"].as_str().unwrap_or_default().to_string();
                if id.is_empty() {
                    return;
                }
                let kind = match ev.payload["kind"].as_str().unwrap_or("bool") {
                    "count" => HabitKind::Count,
                    "amount" => HabitKind::Amount,
                    _ => HabitKind::Bool,
                };
                let target = ev.payload["target"].as_f64();
                let unit = ev.payload["unit"]
                    .as_str()
                    .map(|s| s.to_string())
                    .filter(|s| !s.is_empty());
                let h = Habit {
                    id: id.clone(),
                    workspace_id: ev.payload["workspace_id"].as_str().map(|s| s.to_string()),
                    name: ev.payload["name"].as_str().unwrap_or("Untitled").to_string(),
                    kind,
                    target,
                    unit,
                    color: ev.payload["color"]
                        .as_str()
                        .unwrap_or("#7c9cff")
                        .to_string(),
                    created_ms: ev.ts_ms,
                    archived: false,
                };
                self.habits.insert(id, h);
            }
            "habit.updated" => {
                let id = ev.payload["id"].as_str().unwrap_or_default();
                if let Some(h) = self.habits.get_mut(id) {
                    if let Some(n) = ev.payload["name"].as_str() {
                        h.name = n.to_string();
                    }
                    if let Some(c) = ev.payload["color"].as_str() {
                        h.color = c.to_string();
                    }
                    if ev.payload.get("target").is_some() {
                        h.target = ev.payload["target"].as_f64();
                    }
                    if ev.payload.get("unit").is_some() {
                        h.unit = ev.payload["unit"]
                            .as_str()
                            .map(|s| s.to_string())
                            .filter(|s| !s.is_empty());
                    }
                }
            }
            "habit.archived" => {
                let id = ev.payload["id"].as_str().unwrap_or_default();
                if let Some(h) = self.habits.get_mut(id) {
                    h.archived = true;
                }
            }
            "habit.unarchived" => {
                let id = ev.payload["id"].as_str().unwrap_or_default();
                if let Some(h) = self.habits.get_mut(id) {
                    h.archived = false;
                }
            }
            "habit.deleted" => {
                let id = ev.payload["id"].as_str().unwrap_or_default();
                self.habits.remove(id);
                self.entries.remove(id);
            }
            "habit.logged" => {
                let id = ev.payload["habit_id"].as_str().unwrap_or_default().to_string();
                let day = ev.payload["day"].as_str().unwrap_or_default().to_string();
                if id.is_empty() || day.is_empty() {
                    return;
                }
                let value = ev.payload["value"].as_f64().unwrap_or(0.0);
                let skipped = ev.payload["skipped"].as_bool().unwrap_or(false);
                let entry = HabitEntry {
                    habit_id: id.clone(),
                    day: day.clone(),
                    value,
                    skipped,
                    updated_ms: ev.ts_ms,
                };
                self.entries.entry(id).or_default().insert(day, entry);
            }
            "habit.cleared" => {
                let id = ev.payload["habit_id"].as_str().unwrap_or_default();
                let day = ev.payload["day"].as_str().unwrap_or_default();
                if let Some(map) = self.entries.get_mut(id) {
                    map.remove(day);
                }
            }
            _ => {}
        }
    }

    pub fn list(&self) -> Vec<Habit> {
        let mut out: Vec<Habit> = self.habits.values().cloned().collect();
        out.sort_by(|a, b| a.created_ms.cmp(&b.created_ms));
        out
    }

    pub fn get(&self, id: &str) -> Option<Habit> {
        self.habits.get(id).cloned()
    }

    /// Return entries for `habit_id` between `from_day` and `to_day` inclusive
    /// (ISO YYYY-MM-DD). Order is by day ascending.
    pub fn entries_range(&self, habit_id: &str, from_day: &str, to_day: &str) -> Vec<HabitEntry> {
        let Some(map) = self.entries.get(habit_id) else {
            return Vec::new();
        };
        map.range(from_day.to_string()..=to_day.to_string())
            .map(|(_, e)| e.clone())
            .collect()
    }

    /// Compute analytics for a habit relative to `today_iso` (so the caller
    /// owns timezone semantics — we never call chrono::Local here).
    pub fn stats(&self, habit_id: &str, today_iso: &str) -> Option<HabitStats> {
        let h = self.habits.get(habit_id)?;
        let map = self.entries.get(habit_id);
        let target = h.target.unwrap_or(match h.kind {
            HabitKind::Bool => 1.0,
            HabitKind::Count | HabitKind::Amount => f64::EPSILON, // any positive
        });
        let is_complete = |e: &HabitEntry| !e.skipped && e.value >= target;

        // --- streaks ---
        let mut current = 0u32;
        let mut best = 0u32;
        if let Some(map) = map {
            // Walk back from today day-by-day.
            let mut d = today_iso.to_string();
            loop {
                match map.get(&d) {
                    Some(e) if is_complete(e) => current += 1,
                    Some(e) if e.skipped => { /* neutral, keep going */ }
                    _ => break,
                }
                d = previous_day(&d);
            }
            // Best streak: scan entries chronologically. Treat skip as neutral
            // (doesn't extend, doesn't break). Treat any explicit miss
            // (entry with value < target and not skipped) OR a gap (no entry)
            // as a break. Days without entries break the streak.
            let mut prev_day: Option<String> = None;
            let mut run = 0u32;
            for (day, entry) in map.iter() {
                // Detect gap from prev_day → day.
                if let Some(p) = &prev_day {
                    if next_day(p) != *day {
                        best = best.max(run);
                        run = 0;
                    }
                }
                if is_complete(entry) {
                    run += 1;
                } else if entry.skipped {
                    // neutral — keep run
                } else {
                    best = best.max(run);
                    run = 0;
                }
                prev_day = Some(day.clone());
            }
            best = best.max(run).max(current);
        }

        // --- completion rates ---
        let (completed_30, scheduled_30) = window_completion(map, target, &is_complete, today_iso, 30);
        let (completed_all, scheduled_all) =
            all_time_completion(map, target, &is_complete);
        let completion_30d = if scheduled_30 > 0 {
            completed_30 as f64 / scheduled_30 as f64
        } else {
            0.0
        };
        let completion_all = if scheduled_all > 0 {
            completed_all as f64 / scheduled_all as f64
        } else {
            0.0
        };

        // --- per-weekday rate (Mon..Sun) ---
        let mut wd_done = [0u32; 7];
        let mut wd_sched = [0u32; 7];
        if let Some(map) = map {
            for (day, e) in map.iter() {
                if e.skipped {
                    continue;
                }
                let Some(wd) = weekday_index(day) else {
                    continue;
                };
                wd_sched[wd] += 1;
                if is_complete(e) {
                    wd_done[wd] += 1;
                }
            }
        }
        let weekday_rate = {
            let mut r = [0f64; 7];
            for i in 0..7 {
                r[i] = if wd_sched[i] > 0 {
                    wd_done[i] as f64 / wd_sched[i] as f64
                } else {
                    0.0
                };
            }
            r
        };

        // --- 30d sparkline ---
        let mut sparkline_30d = Vec::with_capacity(30);
        let mut d = today_iso.to_string();
        let mut stack = Vec::with_capacity(30);
        for _ in 0..30 {
            stack.push(d.clone());
            d = previous_day(&d);
        }
        for day in stack.iter().rev() {
            let v = map
                .and_then(|m| m.get(day))
                .map(|e| if e.skipped { 0.0 } else { e.value })
                .unwrap_or(0.0);
            sparkline_30d.push(v);
        }

        Some(HabitStats {
            habit_id: habit_id.to_string(),
            current_streak: current,
            best_streak: best,
            completion_30d,
            completion_all,
            total_completions: completed_all,
            weekday_rate,
            sparkline_30d,
        })
    }
}

fn window_completion(
    map: Option<&BTreeMap<String, HabitEntry>>,
    _target: f64,
    is_complete: &impl Fn(&HabitEntry) -> bool,
    today_iso: &str,
    days: u32,
) -> (u32, u32) {
    let mut completed = 0;
    let mut scheduled = 0;
    let mut d = today_iso.to_string();
    for _ in 0..days {
        // A day is "scheduled" if it could have been completed. Skipped days
        // and days before the habit existed are not scheduled.
        if let Some(map) = map {
            match map.get(&d) {
                Some(e) if e.skipped => { /* not scheduled */ }
                Some(e) => {
                    scheduled += 1;
                    if is_complete(e) {
                        completed += 1;
                    }
                }
                None => {
                    // No entry: count as scheduled-but-missed only if the
                    // habit existed by this date. We approximate "habit
                    // existed" as "there's any entry at or before this date".
                    if has_any_entry_on_or_before(map, &d) {
                        scheduled += 1;
                    }
                }
            }
        }
        d = previous_day(&d);
    }
    (completed, scheduled)
}

fn all_time_completion(
    map: Option<&BTreeMap<String, HabitEntry>>,
    _target: f64,
    is_complete: &impl Fn(&HabitEntry) -> bool,
) -> (u32, u32) {
    let mut completed = 0u32;
    let mut scheduled = 0u32;
    let Some(map) = map else {
        return (0, 0);
    };
    for (_, e) in map.iter() {
        if e.skipped {
            continue;
        }
        scheduled += 1;
        if is_complete(e) {
            completed += 1;
        }
    }
    (completed, scheduled)
}

fn has_any_entry_on_or_before(map: &BTreeMap<String, HabitEntry>, day: &str) -> bool {
    map.range(..=day.to_string()).next().is_some()
}

/// Move an ISO YYYY-MM-DD string back one day. Naive arithmetic; relies on the
/// helpers below.
fn previous_day(day: &str) -> String {
    let (y, m, d) = parse_iso(day).unwrap_or((1970, 1, 1));
    let (ny, nm, nd) = sub_one_day(y, m, d);
    format!("{:04}-{:02}-{:02}", ny, nm, nd)
}

fn next_day(day: &str) -> String {
    let (y, m, d) = parse_iso(day).unwrap_or((1970, 1, 1));
    let (ny, nm, nd) = add_one_day(y, m, d);
    format!("{:04}-{:02}-{:02}", ny, nm, nd)
}

fn parse_iso(s: &str) -> Option<(i32, u32, u32)> {
    if s.len() != 10 {
        return None;
    }
    let y = s.get(0..4)?.parse().ok()?;
    let m = s.get(5..7)?.parse().ok()?;
    let d = s.get(8..10)?.parse().ok()?;
    Some((y, m, d))
}

fn days_in_month(y: i32, m: u32) -> u32 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 {
                29
            } else {
                28
            }
        }
        _ => 30,
    }
}

fn add_one_day(y: i32, m: u32, d: u32) -> (i32, u32, u32) {
    let dim = days_in_month(y, m);
    if d < dim {
        (y, m, d + 1)
    } else if m < 12 {
        (y, m + 1, 1)
    } else {
        (y + 1, 1, 1)
    }
}

fn sub_one_day(y: i32, m: u32, d: u32) -> (i32, u32, u32) {
    if d > 1 {
        (y, m, d - 1)
    } else if m > 1 {
        let nm = m - 1;
        (y, nm, days_in_month(y, nm))
    } else {
        (y - 1, 12, 31)
    }
}

/// Mon=0..Sun=6 from an ISO date string. Sakamoto's algorithm — accurate for
/// all years in our supported range (1900..2100 is fine for a habit tracker).
fn weekday_index(day: &str) -> Option<usize> {
    let (mut y, m, d) = parse_iso(day)?;
    static T: [i32; 12] = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
    if m < 3 {
        y -= 1;
    }
    let w = (y + y / 4 - y / 100 + y / 400 + T[(m - 1) as usize] + d as i32) % 7;
    // Sakamoto returns Sun=0..Sat=6; remap to Mon=0..Sun=6.
    let mon0 = ((w + 6) % 7) as usize;
    Some(mon0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(kind: &str, ts_ms: i64, payload: serde_json::Value) -> StoredEvent {
        StoredEvent {
            id: 0,
            ts_ms,
            kind: kind.to_string(),
            payload,
        }
    }

    #[test]
    fn weekday_known_dates() {
        // 2024-01-01 was a Monday.
        assert_eq!(weekday_index("2024-01-01"), Some(0));
        // 2024-01-07 was a Sunday.
        assert_eq!(weekday_index("2024-01-07"), Some(6));
    }

    #[test]
    fn day_arithmetic_month_boundary() {
        assert_eq!(next_day("2024-01-31"), "2024-02-01");
        assert_eq!(previous_day("2024-03-01"), "2024-02-29"); // leap
        assert_eq!(previous_day("2023-03-01"), "2023-02-28");
        assert_eq!(next_day("2024-12-31"), "2025-01-01");
    }

    #[test]
    fn streak_skip_neutral() {
        let mut p = HabitsProjection::new();
        p.apply(&ev(
            "habit.created",
            0,
            serde_json::json!({"id":"h","name":"X","kind":"bool","color":"#fff"}),
        ));
        for day in ["2024-05-01", "2024-05-02", "2024-05-04"] {
            p.apply(&ev(
                "habit.logged",
                0,
                serde_json::json!({"habit_id":"h","day":day,"value":1.0}),
            ));
        }
        // 05-03 skipped: streak should bridge it.
        p.apply(&ev(
            "habit.logged",
            0,
            serde_json::json!({"habit_id":"h","day":"2024-05-03","value":0.0,"skipped":true}),
        ));
        let s = p.stats("h", "2024-05-04").unwrap();
        assert_eq!(s.current_streak, 3);
        assert!(s.best_streak >= 3);
    }

    #[test]
    fn streak_breaks_on_missed_day() {
        let mut p = HabitsProjection::new();
        p.apply(&ev(
            "habit.created",
            0,
            serde_json::json!({"id":"h","name":"X","kind":"bool","color":"#fff"}),
        ));
        // Complete D-2, miss D-1, complete D. Current streak = 1, best = 1.
        p.apply(&ev(
            "habit.logged",
            0,
            serde_json::json!({"habit_id":"h","day":"2024-05-01","value":1.0}),
        ));
        // No entry for 05-02 at all → counts as missed by virtue of being a
        // gap surrounded by entries.
        p.apply(&ev(
            "habit.logged",
            0,
            serde_json::json!({"habit_id":"h","day":"2024-05-03","value":1.0}),
        ));
        let s = p.stats("h", "2024-05-03").unwrap();
        assert_eq!(s.current_streak, 1);
    }

    #[test]
    fn count_kind_respects_target() {
        let mut p = HabitsProjection::new();
        p.apply(&ev(
            "habit.created",
            0,
            serde_json::json!({"id":"h","name":"Pushups","kind":"count","target":20.0,"color":"#fff"}),
        ));
        p.apply(&ev(
            "habit.logged",
            0,
            serde_json::json!({"habit_id":"h","day":"2024-05-01","value":15.0}),
        ));
        p.apply(&ev(
            "habit.logged",
            0,
            serde_json::json!({"habit_id":"h","day":"2024-05-02","value":25.0}),
        ));
        let s = p.stats("h", "2024-05-02").unwrap();
        assert_eq!(s.current_streak, 1); // only day 2 met the target
    }
}

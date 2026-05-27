//! Multi-timer engine.
//!
//! Wall-clock based math so timers stay correct across sleep, suspend, and
//! reboot. State is reconstructed from the event log; this struct is the
//! in-memory projection used by IPC handlers.

use crate::store::{now_ms, StoredEvent};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TimerStatus {
    Idle,
    Running,
    Paused,
    Completed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Timer {
    pub id: String,
    pub name: String,
    pub color: String,
    pub duration_ms: i64,
    pub status: TimerStatus,
    /// Wall-clock ms when the timer was (re)started. None until first start.
    pub started_at_ms: Option<i64>,
    /// Accumulated paused time across all pause spans.
    pub paused_total_ms: i64,
    /// Wall-clock ms when the current pause began (if Paused).
    pub paused_at_ms: Option<i64>,
    pub workspace_id: Option<String>,
    pub parent_id: Option<String>,
    pub group_id: Option<String>,
    /// Optional id of a task this timer is focusing on. When the timer
    /// completes the IPC layer auto-toggles the task to `done`.
    pub task_id: Option<String>,
    /// Computed at read time; not authoritative.
    pub remaining_ms: i64,
}

impl Timer {
    fn new(id: String, name: String, color: String, duration_ms: i64, workspace_id: Option<String>) -> Self {
        Self {
            id,
            name,
            color,
            duration_ms,
            status: TimerStatus::Idle,
            started_at_ms: None,
            paused_total_ms: 0,
            paused_at_ms: None,
            workspace_id,
            parent_id: None,
            group_id: None,
            task_id: None,
            remaining_ms: duration_ms,
        }
    }

    /// Recompute remaining_ms from wall-clock state. Pure function of fields.
    pub fn recompute(&mut self, now: i64) {
        let elapsed = match (self.status, self.started_at_ms, self.paused_at_ms) {
            (TimerStatus::Running, Some(start), _) => now - start - self.paused_total_ms,
            (TimerStatus::Paused, Some(start), Some(paused_at)) => {
                // pause is open — frozen at paused_at
                paused_at - start - self.paused_total_ms
            }
            _ => 0,
        };
        let remaining = self.duration_ms - elapsed.max(0);
        self.remaining_ms = remaining.max(0);
        if self.status == TimerStatus::Running && self.remaining_ms == 0 {
            self.status = TimerStatus::Completed;
        }
    }
}

#[derive(Default)]
pub struct TimerEngine {
    timers: HashMap<String, Timer>,
}

impl TimerEngine {
    pub fn new() -> Self { Self::default() }

    pub fn apply(&mut self, ev: &StoredEvent) {
        match ev.kind.as_str() {
            "timer.created" => {
                let id = ev.payload["id"].as_str().unwrap_or_default().to_string();
                if id.is_empty() { return; }
                let name = ev.payload["name"].as_str().unwrap_or("Timer").to_string();
                let color = ev.payload["color"].as_str().unwrap_or("#7c9cff").to_string();
                let duration = ev.payload["duration_ms"].as_i64().unwrap_or(25 * 60 * 1000);
                let ws = ev.payload["workspace_id"].as_str().map(|s| s.to_string());
                let mut t = Timer::new(id.clone(), name, color, duration, ws);
                t.task_id = ev.payload["task_id"].as_str().map(|s| s.to_string());
                self.timers.insert(id, t);
            }
            "timer.started" => {
                let id = ev.payload["id"].as_str().unwrap_or_default();
                if let Some(t) = self.timers.get_mut(id) {
                    t.started_at_ms = Some(ev.ts_ms);
                    t.paused_total_ms = 0;
                    t.paused_at_ms = None;
                    t.status = TimerStatus::Running;
                }
            }
            "timer.paused" => {
                let id = ev.payload["id"].as_str().unwrap_or_default();
                if let Some(t) = self.timers.get_mut(id) {
                    if t.status == TimerStatus::Running {
                        t.paused_at_ms = Some(ev.ts_ms);
                        t.status = TimerStatus::Paused;
                    }
                }
            }
            "timer.resumed" => {
                let id = ev.payload["id"].as_str().unwrap_or_default();
                if let Some(t) = self.timers.get_mut(id) {
                    if let Some(paused_at) = t.paused_at_ms {
                        t.paused_total_ms += ev.ts_ms - paused_at;
                    }
                    t.paused_at_ms = None;
                    t.status = TimerStatus::Running;
                }
            }
            "timer.reset" => {
                let id = ev.payload["id"].as_str().unwrap_or_default();
                if let Some(t) = self.timers.get_mut(id) {
                    t.started_at_ms = None;
                    t.paused_total_ms = 0;
                    t.paused_at_ms = None;
                    t.status = TimerStatus::Idle;
                    t.remaining_ms = t.duration_ms;
                }
            }
            "timer.deleted" => {
                let id = ev.payload["id"].as_str().unwrap_or_default();
                self.timers.remove(id);
            }
            "timer.completed" => {
                let id = ev.payload["id"].as_str().unwrap_or_default();
                if let Some(t) = self.timers.get_mut(id) {
                    t.status = TimerStatus::Completed;
                }
            }
            _ => {}
        }
    }

    pub fn list(&self) -> Vec<Timer> {
        let now = now_ms();
        let mut out: Vec<Timer> = self.timers.values().cloned().collect();
        for t in out.iter_mut() {
            t.recompute(now);
        }
        out.sort_by(|a, b| a.name.cmp(&b.name));
        out
    }

    pub fn tick(&mut self) -> Vec<String> {
        let now = now_ms();
        let mut just_completed = Vec::new();
        for t in self.timers.values_mut() {
            let was = t.status;
            t.recompute(now);
            if was == TimerStatus::Running && t.status == TimerStatus::Completed {
                just_completed.push(t.id.clone());
            }
        }
        just_completed
    }

    pub fn get(&self, id: &str) -> Option<&Timer> { self.timers.get(id) }
}

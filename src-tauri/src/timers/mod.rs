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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PhaseKind {
    Focus,
    Break,
}

/// One segment of a structured session. A plain timer is a single
/// `Focus` phase spanning the whole duration.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Phase {
    pub kind: PhaseKind,
    pub duration_ms: i64,
}

const MIN: i64 = 60_000;
/// Below this total the pomodoro structure is not applied at all.
pub const POMODORO_MIN_TOTAL_MS: i64 = 30 * MIN;
const FOCUS_BLOCK_MS: i64 = 25 * MIN;
const SHORT_BREAK_MS: i64 = 5 * MIN;
const LONG_BREAK_MS: i64 = 15 * MIN;
/// A trailing focus remainder shorter than this is merged into the
/// previous focus block instead of becoming its own tiny phase.
const MIN_TAIL_FOCUS_MS: i64 = 10 * MIN;

/// Split `total_ms` into focus/break phases using pomodoro conventions.
///
/// Rules:
/// - `total < 30 min` → single focus phase.
/// - Otherwise 25 m focus / 5 m break cycles; every 4th break is 15 m.
/// - The plan always ends on a focus phase (a session never ends on a
///   break), and a trailing focus shorter than 10 m is folded into the
///   preceding focus block.
/// - The phases always sum exactly to `total_ms`.
pub fn plan_phases(total_ms: i64) -> Vec<Phase> {
    let single = vec![Phase {
        kind: PhaseKind::Focus,
        duration_ms: total_ms.max(0),
    }];
    if total_ms < POMODORO_MIN_TOTAL_MS {
        return single;
    }
    let mut phases: Vec<Phase> = Vec::new();
    let mut remaining = total_ms;
    let mut focus_blocks = 0;
    while remaining > 0 {
        let focus = FOCUS_BLOCK_MS.min(remaining);
        phases.push(Phase {
            kind: PhaseKind::Focus,
            duration_ms: focus,
        });
        remaining -= focus;
        focus_blocks += 1;
        if remaining <= 0 {
            break;
        }
        let brk = if focus_blocks % 4 == 0 {
            LONG_BREAK_MS
        } else {
            SHORT_BREAK_MS
        };
        // If what's left after this break would be a sliver of focus,
        // extend the current focus block with everything left instead.
        if remaining - brk < MIN_TAIL_FOCUS_MS {
            if let Some(last) = phases.last_mut() {
                last.duration_ms += remaining;
            }
            break;
        }
        phases.push(Phase {
            kind: PhaseKind::Break,
            duration_ms: brk,
        });
        remaining -= brk;
    }
    debug_assert_eq!(phases.iter().map(|p| p.duration_ms).sum::<i64>(), total_ms);
    debug_assert_eq!(phases.last().map(|p| p.kind), Some(PhaseKind::Focus));
    phases
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
    /// Session structure. Always non-empty; sums to `duration_ms`.
    #[serde(default)]
    pub phases: Vec<Phase>,
    /// Computed at read time; not authoritative.
    pub remaining_ms: i64,
    /// Index into `phases` of the phase the wall-clock is currently in.
    #[serde(default)]
    pub phase_index: usize,
    /// Kind of the current phase (denormalised for the frontend).
    #[serde(default = "default_phase_kind")]
    pub phase_kind: PhaseKind,
    /// Remaining ms inside the current phase.
    #[serde(default)]
    pub phase_remaining_ms: i64,
    /// Total ms of the current phase.
    #[serde(default)]
    pub phase_duration_ms: i64,
    /// Set once the engine has recomputed this timer at least once since
    /// load. `tick()` only reports phase transitions after that, so a
    /// replayed timer that is already mid-session doesn't fire a stale
    /// "break started" cue on the first tick after launch.
    #[serde(skip)]
    ticked: bool,
}

fn default_phase_kind() -> PhaseKind {
    PhaseKind::Focus
}

/// A running timer crossed a phase boundary during `tick()`.
#[derive(Debug, Clone, Serialize)]
pub struct PhaseChange {
    pub id: String,
    pub name: String,
    pub from: PhaseKind,
    pub to: PhaseKind,
    pub phase_index: usize,
    pub phase_count: usize,
    pub phase_duration_ms: i64,
}

impl Timer {
    fn new(
        id: String,
        name: String,
        color: String,
        duration_ms: i64,
        workspace_id: Option<String>,
        phases: Vec<Phase>,
    ) -> Self {
        let phases = if phases.is_empty() {
            vec![Phase {
                kind: PhaseKind::Focus,
                duration_ms,
            }]
        } else {
            phases
        };
        let first = phases[0];
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
            phases,
            remaining_ms: duration_ms,
            phase_index: 0,
            phase_kind: first.kind,
            phase_remaining_ms: first.duration_ms,
            phase_duration_ms: first.duration_ms,
            ticked: false,
        }
    }

    /// Recompute remaining_ms + phase fields from wall-clock state. Pure
    /// function of fields.
    pub fn recompute(&mut self, now: i64) {
        let elapsed = match (self.status, self.started_at_ms, self.paused_at_ms) {
            (TimerStatus::Running, Some(start), _) => now - start - self.paused_total_ms,
            (TimerStatus::Paused, Some(start), Some(paused_at)) => {
                // pause is open — frozen at paused_at
                paused_at - start - self.paused_total_ms
            }
            _ => 0,
        }
        .max(0);
        let remaining = self.duration_ms - elapsed;
        self.remaining_ms = remaining.max(0);
        if self.status == TimerStatus::Running && self.remaining_ms == 0 {
            self.status = TimerStatus::Completed;
        }
        // Locate the current phase by walking cumulative durations.
        let mut cum = 0;
        let last = self.phases.len().saturating_sub(1);
        let mut idx = last;
        for (i, p) in self.phases.iter().enumerate() {
            if elapsed < cum + p.duration_ms {
                idx = i;
                break;
            }
            cum += p.duration_ms;
        }
        let p = self.phases.get(idx).copied().unwrap_or(Phase {
            kind: PhaseKind::Focus,
            duration_ms: self.duration_ms,
        });
        self.phase_index = idx;
        self.phase_kind = p.kind;
        self.phase_duration_ms = p.duration_ms;
        // Elapsed-within-phase; when past the end (completed) clamp to 0.
        let into = (elapsed - cum).max(0);
        self.phase_remaining_ms = (p.duration_ms - into).max(0);
    }
}

#[derive(Default)]
pub struct TimerEngine {
    timers: HashMap<String, Timer>,
}

impl TimerEngine {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn apply(&mut self, ev: &StoredEvent) {
        match ev.kind.as_str() {
            "timer.created" => {
                let id = ev.payload["id"].as_str().unwrap_or_default().to_string();
                if id.is_empty() {
                    return;
                }
                let name = ev.payload["name"].as_str().unwrap_or("Timer").to_string();
                let color = ev.payload["color"]
                    .as_str()
                    .unwrap_or("#7c9cff")
                    .to_string();
                let duration = ev.payload["duration_ms"].as_i64().unwrap_or(25 * 60 * 1000);
                let ws = ev.payload["workspace_id"].as_str().map(|s| s.to_string());
                // Events written before v0.1.12 carry no `phases` → single
                // focus phase (behaviour identical to the old engine).
                let phases: Vec<Phase> = ev
                    .payload
                    .get("phases")
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                    .filter(|p: &Vec<Phase>| {
                        !p.is_empty() && p.iter().map(|x| x.duration_ms).sum::<i64>() == duration
                    })
                    .unwrap_or_default();
                let mut t = Timer::new(id.clone(), name, color, duration, ws, phases);
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
                    t.recompute(0);
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

    /// Advance all timers to `now`. Returns ids that just completed plus
    /// any phase boundaries crossed by still-running timers.
    pub fn tick(&mut self) -> (Vec<String>, Vec<PhaseChange>) {
        self.tick_at(now_ms())
    }

    pub fn tick_at(&mut self, now: i64) -> (Vec<String>, Vec<PhaseChange>) {
        let mut just_completed = Vec::new();
        let mut changes = Vec::new();
        for t in self.timers.values_mut() {
            let was = t.status;
            let was_idx = t.phase_index;
            let was_kind = t.phase_kind;
            let was_ticked = t.ticked;
            t.recompute(now);
            t.ticked = true;
            if was == TimerStatus::Running && t.status == TimerStatus::Completed {
                just_completed.push(t.id.clone());
            } else if was_ticked
                && was == TimerStatus::Running
                && t.status == TimerStatus::Running
                && t.phase_index != was_idx
            {
                changes.push(PhaseChange {
                    id: t.id.clone(),
                    name: t.name.clone(),
                    from: was_kind,
                    to: t.phase_kind,
                    phase_index: t.phase_index,
                    phase_count: t.phases.len(),
                    phase_duration_ms: t.phase_duration_ms,
                });
            }
        }
        (just_completed, changes)
    }

    pub fn get(&self, id: &str) -> Option<&Timer> {
        self.timers.get(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn m(n: i64) -> i64 {
        n * MIN
    }

    fn kinds(p: &[Phase]) -> Vec<(char, i64)> {
        p.iter()
            .map(|x| {
                (
                    match x.kind {
                        PhaseKind::Focus => 'f',
                        PhaseKind::Break => 'b',
                    },
                    x.duration_ms / MIN,
                )
            })
            .collect()
    }

    #[test]
    fn short_timers_are_single_focus() {
        for mins in [1, 5, 8, 25, 29] {
            let p = plan_phases(m(mins));
            assert_eq!(kinds(&p), vec![('f', mins)], "{mins}m");
        }
    }

    #[test]
    fn thirty_minutes_merges_tail_into_single_block() {
        // 25f + 5b would end on a break → merged into 30f.
        assert_eq!(kinds(&plan_phases(m(30))), vec![('f', 30)]);
    }

    #[test]
    fn one_hour_is_two_blocks_with_one_break() {
        assert_eq!(
            kinds(&plan_phases(m(60))),
            vec![('f', 25), ('b', 5), ('f', 30)]
        );
    }

    #[test]
    fn two_hour_sprint_has_breaks_and_ends_on_focus() {
        let p = plan_phases(m(120));
        assert_eq!(
            kinds(&p),
            vec![
                ('f', 25),
                ('b', 5),
                ('f', 25),
                ('b', 5),
                ('f', 25),
                ('b', 5),
                ('f', 30)
            ]
        );
        assert_eq!(p.iter().map(|x| x.duration_ms).sum::<i64>(), m(120));
    }

    #[test]
    fn every_fourth_break_is_long() {
        // 4×25 focus + 3×5 short + 15 long + trailing focus.
        let p = plan_phases(m(180));
        let breaks: Vec<i64> = p
            .iter()
            .filter(|x| x.kind == PhaseKind::Break)
            .map(|x| x.duration_ms / MIN)
            .collect();
        // 25f 5b 25f 5b 25f 5b 25f 15b 25f 5b 20f
        assert_eq!(breaks, vec![5, 5, 5, 15, 5]);
        assert_eq!(p.last().unwrap().kind, PhaseKind::Focus);
        assert_eq!(p.iter().map(|x| x.duration_ms).sum::<i64>(), m(180));
    }

    #[test]
    fn plans_always_sum_and_end_on_focus() {
        for mins in 30..=600 {
            let p = plan_phases(m(mins));
            assert_eq!(
                p.iter().map(|x| x.duration_ms).sum::<i64>(),
                m(mins),
                "{mins}"
            );
            assert_eq!(p.last().unwrap().kind, PhaseKind::Focus, "{mins}");
            assert!(
                p.iter().all(|x| x.duration_ms >= m(5)),
                "{mins}: no sliver phases {:?}",
                kinds(&p)
            );
        }
    }

    fn engine_with_session(total_ms: i64, start: i64) -> TimerEngine {
        let mut e = TimerEngine::new();
        e.apply(&StoredEvent {
            id: 1,
            ts_ms: start,
            kind: "timer.created".into(),
            payload: json!({
                "id": "t1", "name": "Sprint", "duration_ms": total_ms,
                "phases": plan_phases(total_ms),
            }),
        });
        e.apply(&StoredEvent {
            id: 2,
            ts_ms: start,
            kind: "timer.started".into(),
            payload: json!({ "id": "t1" }),
        });
        e
    }

    #[test]
    fn phase_fields_track_wall_clock() {
        let mut e = engine_with_session(m(60), 1_000);
        e.tick_at(1_000);
        let t = e.get("t1").unwrap();
        assert_eq!((t.phase_index, t.phase_kind), (0, PhaseKind::Focus));
        assert_eq!(t.phase_remaining_ms, m(25));

        // 26 minutes in → inside the 5m break, 4m left in it.
        e.tick_at(1_000 + m(26));
        let t = e.get("t1").unwrap();
        assert_eq!((t.phase_index, t.phase_kind), (1, PhaseKind::Break));
        assert_eq!(t.phase_remaining_ms, m(4));
        assert_eq!(t.remaining_ms, m(34));
    }

    #[test]
    fn tick_reports_phase_transitions_but_not_on_first_tick_after_load() {
        let mut e = engine_with_session(m(60), 0);
        // First tick lands mid-break: engine must stay silent (replay case).
        let (done, changes) = e.tick_at(m(26));
        assert!(done.is_empty() && changes.is_empty());
        // Crossing break→focus at 30m fires exactly one change.
        let (_, changes) = e.tick_at(m(31));
        assert_eq!(changes.len(), 1);
        assert_eq!(
            (changes[0].from, changes[0].to),
            (PhaseKind::Break, PhaseKind::Focus)
        );
        assert_eq!(changes[0].phase_index, 2);
        // No duplicate on the next tick.
        let (_, changes) = e.tick_at(m(32));
        assert!(changes.is_empty());
        // Completion is reported as completion, not as a phase change.
        let (done, changes) = e.tick_at(m(61));
        assert_eq!(done, vec!["t1".to_string()]);
        assert!(changes.is_empty());
    }

    #[test]
    fn pause_freezes_phase_progress() {
        let mut e = engine_with_session(m(60), 0);
        e.tick_at(m(10));
        e.apply(&StoredEvent {
            id: 3,
            ts_ms: m(20),
            kind: "timer.paused".into(),
            payload: json!({ "id": "t1" }),
        });
        // Paused for 20 minutes: still 5m of focus left, no break entered.
        let (_, changes) = e.tick_at(m(40));
        assert!(changes.is_empty());
        let t = e.get("t1").unwrap();
        assert_eq!(t.status, TimerStatus::Paused);
        assert_eq!(t.phase_kind, PhaseKind::Focus);
        assert_eq!(t.phase_remaining_ms, m(5));
        e.apply(&StoredEvent {
            id: 4,
            ts_ms: m(40),
            kind: "timer.resumed".into(),
            payload: json!({ "id": "t1" }),
        });
        // 6 minutes after resume → 1 minute into the break.
        let (_, changes) = e.tick_at(m(46));
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].to, PhaseKind::Break);
        assert_eq!(e.get("t1").unwrap().phase_remaining_ms, m(4));
    }

    #[test]
    fn legacy_events_without_phases_are_single_focus() {
        let mut e = TimerEngine::new();
        e.apply(&StoredEvent {
            id: 1,
            ts_ms: 0,
            kind: "timer.created".into(),
            payload: json!({ "id": "old", "name": "Legacy", "duration_ms": m(90) }),
        });
        let t = e.get("old").unwrap();
        assert_eq!(t.phases.len(), 1);
        assert_eq!(t.phases[0].duration_ms, m(90));
    }

    #[test]
    fn mismatched_phase_sum_is_ignored() {
        let mut e = TimerEngine::new();
        e.apply(&StoredEvent {
            id: 1,
            ts_ms: 0,
            kind: "timer.created".into(),
            payload: json!({
                "id": "bad", "duration_ms": m(60),
                "phases": [{"kind":"focus","duration_ms": m(10)}],
            }),
        });
        assert_eq!(e.get("bad").unwrap().phases[0].duration_ms, m(60));
    }
}

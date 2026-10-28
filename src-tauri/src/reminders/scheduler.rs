//! Decides what is due, records it, and (on the runtime side) raises OS
//! notifications plus an in-app event. `tick` is pure over the store so it
//! is testable without Tauri.

use crate::state::AppState;
use crate::store::StoredEvent;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct Fired {
    /// "reminder" or "task".
    pub kind: &'static str,
    pub id: String,
    pub title: String,
    pub due_ms: i64,
    pub workspace_id: Option<String>,
}

/// Everything that became due by `now_ms`, each recorded exactly once.
/// Task deadlines older than a day are not announced on first launch after
/// a long absence — a wall of stale alerts helps nobody.
pub fn tick(state: &AppState, now_ms: i64) -> Vec<Fired> {
    const STALE_MS: i64 = crate::reminders::DAY_MS;
    let mut out = Vec::new();

    let due = state.reminders.lock().due(now_ms);
    for r in due {
        let payload = serde_json::json!({ "id": r.id });
        let Ok(id) = state.store.append_event("reminder.fired", &payload) else {
            continue;
        };
        let ev = StoredEvent {
            id,
            ts_ms: now_ms,
            kind: "reminder.fired".into(),
            payload,
        };
        state.reminders.lock().apply(&ev);
        out.push(Fired {
            kind: "reminder",
            id: r.id,
            title: r.title,
            due_ms: r.due_ms,
            workspace_id: r.workspace_id,
        });
    }

    let tasks: Vec<crate::tasks::Task> = state
        .tasks
        .lock()
        .list()
        .into_iter()
        .filter(|t| t.status == crate::tasks::TaskStatus::Todo)
        .filter(|t| matches!(t.due_ms, Some(d) if d <= now_ms))
        .collect();
    for t in tasks {
        let due_ms = t.due_ms.unwrap_or(now_ms);
        if state.reminders.lock().task_already_fired(&t.id, due_ms) {
            continue;
        }
        let payload = serde_json::json!({ "task_id": t.id, "due_ms": due_ms });
        let Ok(id) = state.store.append_event("reminder.task_fired", &payload) else {
            continue;
        };
        let ev = StoredEvent {
            id,
            ts_ms: now_ms,
            kind: "reminder.task_fired".into(),
            payload,
        };
        state.reminders.lock().apply(&ev);
        if now_ms - due_ms <= STALE_MS {
            out.push(Fired {
                kind: "task",
                id: t.id,
                title: t.title,
                due_ms,
                workspace_id: t.workspace_id,
            });
        }
    }
    out
}

/// Upcoming items (reminders + task deadlines) within `horizon_ms`, soonest
/// first. Used by the "Up next" strip and by mobile to pre-schedule
/// notifications with the OS.
pub fn upcoming(
    state: &AppState,
    now_ms: i64,
    horizon_ms: i64,
    workspace_id: Option<&str>,
) -> Vec<Fired> {
    let mut out: Vec<Fired> = state
        .reminders
        .lock()
        .list()
        .into_iter()
        .filter(|r| !r.done && r.due_ms <= now_ms + horizon_ms)
        .filter(|r| workspace_id.map_or(true, |w| r.workspace_id.as_deref() == Some(w)))
        .map(|r| Fired {
            kind: "reminder",
            id: r.id,
            title: r.title,
            due_ms: r.due_ms,
            workspace_id: r.workspace_id,
        })
        .collect();
    let reminders = state.reminders.lock();
    out.extend(
        state
            .tasks
            .lock()
            .list()
            .into_iter()
            .filter(|t| t.status == crate::tasks::TaskStatus::Todo)
            .filter(|t| workspace_id.map_or(true, |w| t.workspace_id.as_deref() == Some(w)))
            .filter_map(|t| t.due_ms.map(|d| (t, d)))
            .filter(|(t, d)| *d <= now_ms + horizon_ms && !reminders.task_already_fired(&t.id, *d))
            .map(|(t, d)| Fired {
                kind: "task",
                id: t.id,
                title: t.title,
                due_ms: d,
                workspace_id: t.workspace_id,
            }),
    );
    drop(reminders);
    out.sort_by_key(|f| f.due_ms);
    out
}

/// Background loop: every 15 s announce what is due. Desktop and Android
/// while the process is alive; Android pre-schedules the next week with
/// the OS from the frontend as a belt-and-braces path.
pub fn spawn(app: tauri::AppHandle, state: std::sync::Arc<AppState>) {
    tauri::async_runtime::spawn(async move {
        use tauri::Emitter;
        use tauri_plugin_notification::NotificationExt;
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(15));
        loop {
            interval.tick().await;
            let fired = tick(&state, crate::store::now_ms());
            for f in fired {
                let (title, body) = match f.kind {
                    "task" => (
                        format!("Due: {}", f.title),
                        "Task deadline reached. Nerva by Bytical".to_string(),
                    ),
                    _ => (f.title.clone(), "Reminder. Nerva by Bytical".to_string()),
                };
                if let Err(e) = app
                    .notification()
                    .builder()
                    .title(&title)
                    .body(&body)
                    .show()
                {
                    tracing::debug!(err = %e, "os notification failed");
                }
                let _ = app.emit("reminder:fired", &f);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fires_once_and_skips_stale_task_deadlines() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::initialize_at(dir.path().into()).unwrap();
        let ws = state.workspaces.lock().active().unwrap().id.clone();
        let now = 1_793_091_600_000;

        let r = crate::ipc::reminder_create_for(
            &state,
            crate::ipc::CreateReminderArgs {
                title: "Water".into(),
                due_ms: now - 1,
                repeat: Some("daily".into()),
                tz_offset_min: Some(0),
                task_id: None,
                workspace_id: Some(ws.clone()),
            },
        )
        .unwrap();
        let fresh = crate::ipc::task_create_for(
            &state,
            crate::ipc::CreateTaskArgs {
                title: "Ship".into(),
                workspace_id: Some(ws.clone()),
            },
        )
        .unwrap();
        crate::ipc::task_set_due_for(&state, fresh.id.clone(), Some(now - 60_000)).unwrap();
        let stale = crate::ipc::task_create_for(
            &state,
            crate::ipc::CreateTaskArgs {
                title: "Old".into(),
                workspace_id: Some(ws),
            },
        )
        .unwrap();
        crate::ipc::task_set_due_for(
            &state,
            stale.id.clone(),
            Some(now - 3 * crate::reminders::DAY_MS),
        )
        .unwrap();

        let fired = tick(&state, now);
        let ids: Vec<&str> = fired.iter().map(|f| f.id.as_str()).collect();
        assert_eq!(ids, vec![r.id.as_str(), fresh.id.as_str()]);
        assert!(tick(&state, now + 1_000).is_empty(), "nothing fires twice");

        // Repeating reminder rolled forward and shows in tomorrow's horizon.
        let up = upcoming(&state, now, 2 * crate::reminders::DAY_MS, None);
        assert!(up.iter().any(|f| f.id == r.id && f.due_ms > now));
        assert!(
            !up.iter().any(|f| f.id == fresh.id),
            "already-announced deadline is not 'upcoming'"
        );

        // Replay from disk remembers what fired.
        drop(state);
        let state = AppState::initialize_at(dir.path().into()).unwrap();
        assert!(tick(&state, now + 2_000).is_empty());
    }
}

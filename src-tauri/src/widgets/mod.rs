use crate::error::{NervaError, Result};
use crate::ipc;
use crate::state::AppState;
use crate::tasks::TaskStatus;
use crate::timers::TimerStatus;
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::{json, Value};

#[cfg(target_os = "android")]
pub mod android;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TimerOperation {
    Start,
    Pause,
    Resume,
    Restart,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum WidgetCommand {
    Snapshot {
        day: String,
    },
    Timer {
        id: String,
        operation: TimerOperation,
    },
    TimerCreate {
        minutes: u32,
        workspace_id: Option<String>,
    },
    TaskSet {
        id: String,
        done: bool,
    },
    TaskCreate {
        title: String,
        workspace_id: Option<String>,
    },
    HabitSet {
        id: String,
        day: String,
        value: Option<f64>,
        #[serde(default)]
        skipped: bool,
        expected_updated_ms: Option<i64>,
    },
    NoteRead {
        id: String,
    },
    NoteSave {
        id: Option<String>,
        workspace_id: Option<String>,
        title: String,
        body: String,
        expected_body: Option<String>,
        expected_updated_ms: Option<i64>,
    },
}

fn validate_day(day: &str) -> Result<()> {
    if day.len() != 10 || NaiveDate::parse_from_str(day, "%Y-%m-%d").is_err() {
        return Err(NervaError::Invalid("day must be a valid YYYY-MM-DD".into()));
    }
    Ok(())
}

fn validate_workspace(state: &AppState, workspace_id: Option<&str>) -> Result<()> {
    if let Some(id) = workspace_id {
        if !state
            .workspaces
            .lock()
            .list()
            .iter()
            .any(|workspace| workspace.id == id)
        {
            return Err(NervaError::NotFound(id.into()));
        }
    }
    Ok(())
}

pub fn execute(state: &AppState, command: WidgetCommand) -> Result<Value> {
    match command {
        WidgetCommand::Snapshot { day } => {
            validate_day(&day)?;
            let report = ipc::timer_tick_for(state)?;
            let habits = state.habits.lock();
            let habit_rows: Vec<Value> = habits
                .list()
                .into_iter()
                .filter(|habit| !habit.archived)
                .map(|habit| {
                    let entry = habits
                        .entries_range(&habit.id, &day, &day)
                        .into_iter()
                        .next();
                    let stats = habits.stats(&habit.id, &day);
                    json!({ "habit": habit, "entry": entry, "stats": stats })
                })
                .collect();
            drop(habits);
            let workspaces = state.workspaces.lock().list();
            let tasks = state.tasks.lock().list();
            let notes = state.notes.lock().list();
            Ok(json!({
                "generated_ms": crate::store::now_ms(),
                "day": day,
                "workspaces": workspaces,
                "timers": report.timers,
                "tasks": tasks,
                "habits": habit_rows,
                "notes": notes,
            }))
        }
        WidgetCommand::Timer { id, operation } => {
            ipc::timer_tick_for(state)?;
            let timer = state
                .timers
                .lock()
                .get(&id)
                .cloned()
                .ok_or_else(|| NervaError::NotFound(id.clone()))?;
            let updated = match (&operation, &timer.status) {
                (TimerOperation::Start, TimerStatus::Idle) => ipc::timer_start_for(state, id)?,
                (TimerOperation::Pause, TimerStatus::Running) => ipc::timer_pause_for(state, id)?,
                (TimerOperation::Resume, TimerStatus::Paused) => ipc::timer_resume_for(state, id)?,
                (TimerOperation::Restart, TimerStatus::Completed | TimerStatus::Cancelled) => {
                    ipc::timer_reset_for(state, id.clone())?;
                    ipc::timer_start_for(state, id)?
                }
                _ => timer,
            };
            Ok(json!(updated))
        }
        WidgetCommand::TimerCreate {
            minutes,
            workspace_id,
        } => {
            if !(1..=720).contains(&minutes) {
                return Err(NervaError::Invalid(
                    "duration must be 1 to 720 minutes".into(),
                ));
            }
            validate_workspace(state, workspace_id.as_deref())?;
            let timer = ipc::timer_create_for(
                state,
                ipc::CreateTimerArgs {
                    name: format!("{minutes} min focus"),
                    duration_ms: i64::from(minutes) * 60_000,
                    color: None,
                    workspace_id,
                    task_id: None,
                    auto_breaks: None,
                },
            )?;
            Ok(json!(timer))
        }
        WidgetCommand::TaskSet { id, done } => {
            let task = state
                .tasks
                .lock()
                .list()
                .into_iter()
                .find(|task| task.id == id)
                .ok_or_else(|| NervaError::NotFound(id.clone()))?;
            if matches!(task.status, TaskStatus::Done) == done {
                return Ok(json!(task));
            }
            Ok(json!(ipc::task_toggle_for(state, id)?))
        }
        WidgetCommand::TaskCreate {
            title,
            workspace_id,
        } => {
            if title.chars().count() > 512 {
                return Err(NervaError::Invalid("task title is too long".into()));
            }
            validate_workspace(state, workspace_id.as_deref())?;
            Ok(json!(ipc::task_create_for(
                state,
                ipc::CreateTaskArgs {
                    title,
                    workspace_id
                }
            )?))
        }
        WidgetCommand::HabitSet {
            id,
            day,
            value,
            skipped,
            expected_updated_ms,
        } => {
            validate_day(&day)?;
            if value.is_some_and(|value| !value.is_finite() || value < 0.0) {
                return Err(NervaError::Invalid(
                    "habit value must be finite and nonnegative".into(),
                ));
            }
            let current = {
                let habits = state.habits.lock();
                if !habits
                    .list()
                    .iter()
                    .any(|habit| habit.id == id && !habit.archived)
                {
                    return Err(NervaError::NotFound(id));
                }
                habits.entries_range(&id, &day, &day).into_iter().next()
            };
            let same = match (&current, value) {
                (None, None) => true,
                (Some(entry), Some(value)) => entry.value == value && entry.skipped == skipped,
                _ => false,
            };
            if same {
                return Ok(json!(current));
            }
            if current.as_ref().map(|entry| entry.updated_ms) != expected_updated_ms {
                return Err(NervaError::Invalid(
                    "This habit changed. Refresh before trying again.".into(),
                ));
            }
            if let Some(value) = value {
                Ok(json!(ipc::habit_log_for(
                    state,
                    ipc::LogHabitArgs {
                        habit_id: id,
                        day,
                        value,
                        skipped,
                    }
                )?))
            } else {
                ipc::habit_clear_for(state, ipc::ClearHabitArgs { habit_id: id, day })?;
                Ok(Value::Null)
            }
        }
        WidgetCommand::NoteRead { id } => {
            let (workspace_id, title, body, updated_ms) = state
                .store
                .note_get(&id)?
                .ok_or_else(|| NervaError::NotFound(id.clone()))?;
            Ok(
                json!({ "id": id, "workspace_id": workspace_id, "title": title, "body": body, "updated_ms": updated_ms }),
            )
        }
        WidgetCommand::NoteSave {
            id,
            workspace_id,
            title,
            body,
            expected_body,
            expected_updated_ms,
        } => {
            validate_workspace(state, workspace_id.as_deref())?;
            let expected = expected_body.as_deref().zip(expected_updated_ms);
            if id.is_some() && expected.is_none() {
                return Err(NervaError::Invalid(
                    "Reopen this note before editing it.".into(),
                ));
            }
            Ok(json!(ipc::note_save_checked(
                state,
                ipc::SaveNoteArgs {
                    id,
                    title,
                    body,
                    workspace_id,
                },
                expected
            )?))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::StoredEvent;
    use tempfile::TempDir;

    fn state(directory: &TempDir) -> AppState {
        AppState::initialize_at(directory.path().to_path_buf()).unwrap()
    }

    fn command(state: &AppState, value: Value) -> Value {
        execute(state, serde_json::from_value(value).unwrap()).unwrap()
    }

    #[test]
    fn widget_task_completion_is_idempotent_and_persisted() {
        let directory = TempDir::new().unwrap();
        let runtime = state(&directory);
        let task = command(
            &runtime,
            json!({ "action": "task_create", "title": "Review", "workspace_id": null }),
        );
        let complete = json!({ "action": "task_set", "id": task["id"], "done": true });
        command(&runtime, complete.clone());
        let count = runtime.store.replay_all().unwrap().len();
        command(&runtime, complete);
        assert_eq!(count, runtime.store.replay_all().unwrap().len());
        let reopened = state(&directory);
        assert!(matches!(
            reopened.tasks.lock().list()[0].status,
            TaskStatus::Done
        ));
        command(
            &reopened,
            json!({ "action": "task_set", "id": task["id"], "done": false }),
        );
        assert!(matches!(
            state(&directory).tasks.lock().list()[0].status,
            TaskStatus::Todo
        ));
    }

    #[test]
    fn widget_timer_controls_share_persistent_engine() {
        let directory = TempDir::new().unwrap();
        let runtime = state(&directory);
        let timer = command(&runtime, json!({ "action": "timer_create", "minutes": 60 }));
        let start = json!({ "action": "timer", "id": timer["id"], "operation": "start" });
        let started = command(&runtime, start.clone());
        let repeated = command(&runtime, start);
        assert_eq!(started["started_at_ms"], repeated["started_at_ms"]);
        command(
            &runtime,
            json!({ "action": "timer", "id": timer["id"], "operation": "pause" }),
        );
        let reopened = state(&directory);
        let snapshot = command(
            &reopened,
            json!({ "action": "snapshot", "day": "2026-09-26" }),
        );
        assert_eq!(snapshot["timers"][0]["status"], "paused");
        assert!(snapshot["timers"][0]["phases"].as_array().unwrap().len() > 1);
        let resumed = command(
            &reopened,
            json!({ "action": "timer", "id": timer["id"], "operation": "resume" }),
        );
        assert_eq!(resumed["status"], "running");
    }

    #[test]
    fn widget_note_edit_rejects_stale_content() {
        let directory = TempDir::new().unwrap();
        let runtime = state(&directory);
        let note = command(
            &runtime,
            json!({ "action": "note_save", "title": "Pinned", "body": "Original" }),
        );
        let original = command(&runtime, json!({ "action": "note_read", "id": note["id"] }));
        command(
            &runtime,
            json!({ "action": "note_save", "id": note["id"], "title": "Pinned", "body": "New",
            "expected_body": original["body"], "expected_updated_ms": original["updated_ms"] }),
        );
        let stale = serde_json::from_value(
            json!({ "action": "note_save", "id": note["id"], "title": "Pinned", "body": "Overwrite",
            "expected_body": original["body"], "expected_updated_ms": original["updated_ms"] }),
        )
        .unwrap();
        assert!(execute(&runtime, stale).is_err());
        assert_eq!(
            state(&directory)
                .store
                .note_get(note["id"].as_str().unwrap())
                .unwrap()
                .unwrap()
                .2,
            "New"
        );
    }

    #[test]
    fn widget_habit_records_once_and_can_undo() {
        let directory = TempDir::new().unwrap();
        let runtime = state(&directory);
        let payload = json!({ "id": "habit", "name": "Read", "kind": "count", "target": 4 });
        let event_id = runtime
            .store
            .append_event("habit.created", &payload)
            .unwrap();
        runtime.habits.lock().apply(&StoredEvent {
            id: event_id,
            ts_ms: crate::store::now_ms(),
            kind: "habit.created".into(),
            payload,
        });
        let log = json!({ "action": "habit_set", "id": "habit", "day": "2026-09-26", "value": 1 });
        let entry = command(&runtime, log.clone());
        let count = runtime.store.replay_all().unwrap().len();
        command(&runtime, log);
        assert_eq!(count, runtime.store.replay_all().unwrap().len());
        assert_eq!(
            state(&directory)
                .habits
                .lock()
                .entries_range("habit", "2026-09-26", "2026-09-26")[0]
                .value,
            1.0
        );
        command(
            &runtime,
            json!({ "action": "habit_set", "id": "habit", "day": "2026-09-26", "value": null,
            "expected_updated_ms": entry["updated_ms"] }),
        );
        assert!(state(&directory)
            .habits
            .lock()
            .entries_range("habit", "2026-09-26", "2026-09-26")
            .is_empty());
    }

    #[test]
    fn widget_snapshot_excludes_secrets_and_invalid_requests_fail() {
        let directory = TempDir::new().unwrap();
        let runtime = state(&directory);
        runtime
            .store
            .meta_set("ai.api_key", "private-test-key")
            .unwrap();
        let snapshot = command(
            &runtime,
            json!({ "action": "snapshot", "day": "2026-09-26" }),
        );
        assert!(!snapshot.to_string().contains("private-test-key"));
        for request in [
            json!({ "action": "snapshot", "day": "2026-02-30" }),
            json!({ "action": "timer_create", "minutes": 0 }),
            json!({ "action": "timer", "id": "missing", "operation": "start" }),
            json!({ "action": "task_create", "title": "Task", "workspace_id": "missing" }),
        ] {
            assert!(execute(&runtime, serde_json::from_value(request).unwrap()).is_err());
        }
    }
}

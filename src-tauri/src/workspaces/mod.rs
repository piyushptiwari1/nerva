//! Workspaces projection — a workspace bundles timers, notes, audio, layout.

use crate::error::{NervaError, Result};
use crate::state::AppState;
use crate::store::StoredEvent;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub color: String,
    pub created_ms: i64,
}

#[derive(Default)]
pub struct WorkspacesProjection {
    items: HashMap<String, Workspace>,
    active: Option<String>,
}

impl WorkspacesProjection {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn apply(&mut self, ev: &StoredEvent) {
        match ev.kind.as_str() {
            "workspace.created" => {
                let id = ev.payload["id"].as_str().unwrap_or_default().to_string();
                if id.is_empty() {
                    return;
                }
                let name = ev.payload["name"]
                    .as_str()
                    .unwrap_or("Workspace")
                    .to_string();
                let color = ev.payload["color"]
                    .as_str()
                    .unwrap_or("#7c9cff")
                    .to_string();
                self.items.insert(
                    id.clone(),
                    Workspace {
                        id,
                        name,
                        color,
                        created_ms: ev.ts_ms,
                    },
                );
            }
            "workspace.activated" => {
                let id = ev.payload["id"].as_str().unwrap_or_default().to_string();
                if self.items.contains_key(&id) {
                    self.active = Some(id);
                }
            }
            "workspace.recovered" => {
                if let Some(id) = ev.payload["destination_id"].as_str() {
                    self.items.insert(
                        id.into(),
                        Workspace {
                            id: id.into(),
                            name: "Recovered items".into(),
                            color: "#388569".into(),
                            created_ms: ev.ts_ms,
                        },
                    );
                }
            }
            "workspace.deleted" => {
                let id = ev.payload["id"].as_str().unwrap_or_default();
                self.items.remove(id);
                if self.active.as_deref() == Some(id) {
                    self.active = ev.payload["destination_id"]
                        .as_str()
                        .filter(|destination| self.items.contains_key(*destination))
                        .map(str::to_owned);
                }
            }
            _ => {}
        }
    }

    pub fn list(&self) -> Vec<Workspace> {
        let mut v: Vec<_> = self.items.values().cloned().collect();
        v.sort_by_key(|a| a.created_ms);
        v
    }

    pub fn active(&self) -> Option<&Workspace> {
        self.active.as_ref().and_then(|id| self.items.get(id))
    }

    pub fn resolve(&self, requested: Option<String>) -> Result<Option<String>> {
        let resolved = requested.or_else(|| self.active().map(|workspace| workspace.id.clone()));
        if let Some(id) = resolved.as_deref() {
            if !self.items.contains_key(id) {
                return Err(NervaError::NotFound("Workspace no longer exists".into()));
            }
        }
        Ok(resolved)
    }

    pub fn set_active(&mut self, id: &str) {
        if self.items.contains_key(id) {
            self.active = Some(id.to_string());
        }
    }

    pub fn create_default(&mut self) -> String {
        let id = Uuid::new_v4().to_string();
        self.items.insert(
            id.clone(),
            Workspace {
                id: id.clone(),
                name: "Default".into(),
                color: "#7c9cff".into(),
                created_ms: crate::store::now_ms(),
            },
        );
        id
    }
}

pub(crate) fn delete(state: &AppState, id: &str, destination: &str) -> Result<()> {
    let mut notes = state.notes.lock();
    let mut workspaces = state.workspaces.lock();
    if id == destination || workspaces.list().len() < 2 {
        return Err(NervaError::Invalid(
            "Keep at least one workspace and choose a different destination".into(),
        ));
    }
    workspaces.resolve(Some(id.into()))?;
    workspaces.resolve(Some(destination.into()))?;
    let mut timers = state.timers.lock();
    let mut tasks = state.tasks.lock();
    let mut habits = state.habits.lock();
    let event = state.store.move_workspace_contents(id, destination)?;
    notes.apply(&event);
    timers.apply(&event);
    tasks.apply(&event);
    habits.apply(&event);
    workspaces.apply(&event);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;
    use serde_json::json;

    #[test]
    fn workspace_deletion_preserves_content_and_replays() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::open(&directory.path().join("nerva.db")).unwrap();
        store.migrate().unwrap();
        for id in ["source", "destination"] {
            store
                .append_event("workspace.created", &json!({ "id": id, "name": id }))
                .unwrap();
        }
        store
            .append_event("workspace.activated", &json!({ "id": "source" }))
            .unwrap();
        for (kind, id) in [
            ("task.created", "task"),
            ("timer.created", "timer"),
            ("habit.created", "habit"),
            ("note.saved", "note"),
        ] {
            store
                .append_event(
                    kind,
                    &json!({ "id": id, "title": "Keep this", "workspace_id": "source" }),
                )
                .unwrap();
        }
        store
            .append_event("timer.started", &json!({ "id": "timer" }))
            .unwrap();
        store
            .append_event("task.completed", &json!({ "id": "task" }))
            .unwrap();
        store
            .append_event(
                "habit.logged",
                &json!({ "habit_id": "habit", "day": "2026-10-04", "value": 1 }),
            )
            .unwrap();
        store
            .note_upsert("note", Some("source"), "Keep this", "Important text")
            .unwrap();
        let state = AppState::initialize_at(directory.path().into()).unwrap();
        assert_eq!(
            crate::ipc::momentum_snapshot_for(&state, Some(7), Some("destination".into()))
                .unwrap()
                .iter()
                .map(|bucket| bucket.completed_tasks)
                .sum::<i64>(),
            0
        );
        delete(&state, "source", "destination").unwrap();
        assert_eq!(
            crate::ipc::momentum_snapshot_for(&state, Some(7), Some("destination".into()))
                .unwrap()
                .iter()
                .map(|bucket| bucket.completed_tasks)
                .sum::<i64>(),
            1
        );
        assert_eq!(state.workspaces.lock().active().unwrap().id, "destination");
        drop(state);
        let restored = AppState::initialize_at(directory.path().into()).unwrap();
        assert_eq!(restored.workspaces.lock().list().len(), 1);
        assert_eq!(
            restored.workspaces.lock().active().unwrap().id,
            "destination"
        );
        let timer = restored.timers.lock().get("timer").unwrap().clone();
        assert_eq!(timer.workspace_id.as_deref(), Some("destination"));
        assert_eq!(timer.status, crate::timers::TimerStatus::Running);
        let task = restored.tasks.lock().list().remove(0);
        assert_eq!(task.workspace_id.as_deref(), Some("destination"));
        assert_eq!(task.status, crate::tasks::TaskStatus::Done);
        assert_eq!(
            restored
                .habits
                .lock()
                .get("habit")
                .unwrap()
                .workspace_id
                .as_deref(),
            Some("destination")
        );
        assert_eq!(
            restored
                .habits
                .lock()
                .entries_range("habit", "2026-10-04", "2026-10-04")
                .len(),
            1
        );
        let note = restored.store.note_get("note").unwrap().unwrap();
        assert_eq!(note.0, "destination");
        assert_eq!(note.2, "Important text");
        assert_eq!(
            restored.notes.lock().list()[0].workspace_id.as_deref(),
            Some("destination")
        );
        assert_eq!(
            restored.store.note_search("Important", 10).unwrap()[0].1,
            "destination"
        );
    }

    #[test]
    fn workspace_deletion_rejects_invalid_destinations_without_mutation() {
        let directory = tempfile::tempdir().unwrap();
        let state = AppState::initialize_at(directory.path().into()).unwrap();
        let id = state.workspaces.lock().active().unwrap().id.clone();
        let before = state.store.replay_all().unwrap().len();
        assert!(delete(&state, &id, &id).is_err());
        assert!(delete(&state, &id, "missing").is_err());
        assert_eq!(state.store.replay_all().unwrap().len(), before);
        assert_eq!(state.workspaces.lock().active().unwrap().id, id);
    }

    #[test]
    fn workspace_recovery_keeps_legacy_unassigned_content_accessible_once() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::open(&directory.path().join("nerva.db")).unwrap();
        store.migrate().unwrap();
        store
            .append_event(
                "task.created",
                &json!({"id":"legacy-task", "title":"Keep this"}),
            )
            .unwrap();
        store
            .append_event(
                "note.saved",
                &json!({"id":"legacy-note", "title":"Keep this"}),
            )
            .unwrap();
        store
            .note_upsert("legacy-note", None, "Keep this", "Legacy text")
            .unwrap();
        let state = AppState::initialize_at(directory.path().into()).unwrap();
        let recovery = state
            .workspaces
            .lock()
            .list()
            .into_iter()
            .find(|workspace| workspace.name == "Recovered items")
            .unwrap();
        assert_eq!(
            state.tasks.lock().list()[0].workspace_id.as_deref(),
            Some(recovery.id.as_str())
        );
        assert_eq!(
            state.store.note_get("legacy-note").unwrap().unwrap().0,
            recovery.id
        );
        let before = state.store.replay_all().unwrap().len();
        drop(state);
        let restored = AppState::initialize_at(directory.path().into()).unwrap();
        assert_eq!(restored.store.replay_all().unwrap().len(), before);
        assert_eq!(restored.workspaces.lock().list().len(), 2);
    }
}

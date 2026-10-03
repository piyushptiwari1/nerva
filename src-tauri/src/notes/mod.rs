//! Notes projection. Light wrapper — body lives in `notes` table for fast
//! reads, while every save also appends an event for the timeline replay.

use crate::error::{NervaError, Result};
use crate::state::AppState;
use crate::store::StoredEvent;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteMeta {
    pub id: String,
    pub workspace_id: Option<String>,
    pub title: String,
    pub updated_ms: i64,
}

#[derive(Default)]
pub struct NotesProjection {
    metas: HashMap<String, NoteMeta>,
    order: HashMap<Option<String>, Vec<String>>,
}

impl NotesProjection {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn apply(&mut self, ev: &StoredEvent) {
        if ev.kind == "note.saved" {
            let id = ev.payload["id"].as_str().unwrap_or_default().to_string();
            if id.is_empty() {
                return;
            }
            let title = ev.payload["title"].as_str().unwrap_or("").to_string();
            let ws = ev.payload["workspace_id"].as_str().map(|s| s.to_string());
            if !self.metas.contains_key(&id) {
                if let Some(order) = self.order.get_mut(&ws) {
                    order.insert(0, id.clone());
                }
            }
            self.metas.insert(
                id.clone(),
                NoteMeta {
                    id,
                    workspace_id: ws,
                    title,
                    updated_ms: ev.ts_ms,
                },
            );
        } else if ev.kind == "note.reordered" {
            let workspace = ev.payload["workspace_id"].as_str().map(str::to_owned);
            let ids = ev.payload["ordered_ids"]
                .as_array()
                .map(|values| {
                    values
                        .iter()
                        .filter_map(|value| value.as_str().map(str::to_owned))
                        .collect()
                })
                .unwrap_or_default();
            self.order.insert(workspace, ids);
        } else if ev.kind == "workspace.deleted" || ev.kind == "workspace.recovered" {
            if let (Some(source), Some(destination)) = (
                ev.payload["id"].as_str(),
                ev.payload["destination_id"].as_str(),
            ) {
                for note in self
                    .metas
                    .values_mut()
                    .filter(|note| note.workspace_id.as_deref().unwrap_or_default() == source)
                {
                    note.workspace_id = Some(destination.into());
                }
                if let Some(moved) = self.order.remove(&Some(source.into())) {
                    self.order
                        .entry(Some(destination.into()))
                        .or_default()
                        .extend(moved);
                }
            }
        } else if ev.kind == "note.deleted" {
            let id = ev.payload["id"].as_str().unwrap_or_default();
            self.metas.remove(id);
            for order in self.order.values_mut() {
                order.retain(|note| note != id);
            }
        }
    }

    pub fn list(&self) -> Vec<NoteMeta> {
        let mut v: Vec<_> = self.metas.values().cloned().collect();
        let rank = |note: &NoteMeta| {
            self.order
                .get(&note.workspace_id)
                .and_then(|order| order.iter().position(|id| id == &note.id))
                .unwrap_or(usize::MAX)
        };
        v.sort_by(|left, right| {
            left.workspace_id
                .cmp(&right.workspace_id)
                .then_with(|| rank(left).cmp(&rank(right)))
                .then_with(|| right.updated_ms.cmp(&left.updated_ms))
                .then_with(|| left.id.cmp(&right.id))
        });
        v
    }
}

pub(crate) fn reorder(
    state: &AppState,
    workspace_id: String,
    ordered_ids: Vec<String>,
) -> Result<Vec<NoteMeta>> {
    let mut notes = state.notes.lock();
    state
        .workspaces
        .lock()
        .resolve(Some(workspace_id.clone()))?;
    let current: Vec<_> = notes
        .list()
        .into_iter()
        .filter(|note| note.workspace_id.as_deref() == Some(&workspace_id))
        .collect();
    let unique: std::collections::HashSet<_> = ordered_ids.iter().collect();
    if unique.len() != ordered_ids.len()
        || ordered_ids
            .iter()
            .any(|id| !current.iter().any(|note| &note.id == id))
    {
        return Err(NervaError::Invalid(
            "Note order must contain unique notes from this workspace".into(),
        ));
    }
    let mut merged = ordered_ids.clone();
    merged.extend(
        current
            .into_iter()
            .filter(|note| !unique.contains(&note.id))
            .map(|note| note.id),
    );
    let payload = serde_json::json!({ "workspace_id": workspace_id, "ordered_ids": merged });
    let event = StoredEvent {
        id: state.store.append_event("note.reordered", &payload)?,
        ts_ms: crate::store::now_ms(),
        kind: "note.reordered".into(),
        payload,
    };
    notes.apply(&event);
    Ok(notes.list())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn note_order_survives_edits_and_replay() {
        let events: Vec<_> = [
            ("note.saved", json!({"id":"first", "workspace_id":"work"})),
            ("note.saved", json!({"id":"second", "workspace_id":"work"})),
            (
                "note.reordered",
                json!({"workspace_id":"work", "ordered_ids":["second","first"]}),
            ),
            (
                "note.saved",
                json!({"id":"first", "workspace_id":"work", "title":"Edited"}),
            ),
            ("note.saved", json!({"id":"new", "workspace_id":"work"})),
        ]
        .into_iter()
        .enumerate()
        .map(|(index, (kind, payload))| StoredEvent {
            id: index as i64,
            ts_ms: index as i64,
            kind: kind.into(),
            payload,
        })
        .collect();
        let mut projection = NotesProjection::new();
        for event in &events {
            projection.apply(event);
        }
        assert_eq!(
            projection
                .list()
                .iter()
                .map(|note| note.id.as_str())
                .collect::<Vec<_>>(),
            vec!["new", "second", "first"]
        );
        projection.apply(&StoredEvent {
            id: 6,
            ts_ms: 6,
            kind: "note.deleted".into(),
            payload: json!({"id":"second"}),
        });
        assert_eq!(projection.list().len(), 2);
    }

    #[test]
    fn note_order_rejects_foreign_or_duplicate_ids() {
        let directory = tempfile::tempdir().unwrap();
        let state = AppState::initialize_at(directory.path().into()).unwrap();
        let workspace = state.workspaces.lock().active().unwrap().id.clone();
        let event = StoredEvent {
            id: 3,
            ts_ms: 3,
            kind: "note.saved".into(),
            payload: json!({"id":"note", "workspace_id": workspace}),
        };
        state.notes.lock().apply(&event);
        assert!(reorder(&state, workspace.clone(), vec!["foreign".into()]).is_err());
        assert!(reorder(
            &state,
            workspace.clone(),
            vec!["note".into(), "note".into()]
        )
        .is_err());
        assert!(reorder(&state, workspace, vec!["note".into()]).is_ok());
    }
}

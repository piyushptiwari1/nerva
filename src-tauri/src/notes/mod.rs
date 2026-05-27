//! Notes projection. Light wrapper — body lives in `notes` table for fast
//! reads, while every save also appends an event for the timeline replay.

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
}

impl NotesProjection {
    pub fn new() -> Self { Self::default() }

    pub fn apply(&mut self, ev: &StoredEvent) {
        if ev.kind == "note.saved" {
            let id = ev.payload["id"].as_str().unwrap_or_default().to_string();
            if id.is_empty() { return; }
            let title = ev.payload["title"].as_str().unwrap_or("").to_string();
            let ws = ev.payload["workspace_id"].as_str().map(|s| s.to_string());
            self.metas.insert(
                id.clone(),
                NoteMeta { id, workspace_id: ws, title, updated_ms: ev.ts_ms },
            );
        } else if ev.kind == "note.deleted" {
            let id = ev.payload["id"].as_str().unwrap_or_default();
            self.metas.remove(id);
        }
    }

    pub fn list(&self) -> Vec<NoteMeta> {
        let mut v: Vec<_> = self.metas.values().cloned().collect();
        v.sort_by(|a, b| b.updated_ms.cmp(&a.updated_ms));
        v
    }
}

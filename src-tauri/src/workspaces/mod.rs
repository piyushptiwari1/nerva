//! Workspaces projection — a workspace bundles timers, notes, audio, layout.

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
                if !id.is_empty() {
                    self.active = Some(id);
                }
            }
            "workspace.deleted" => {
                let id = ev.payload["id"].as_str().unwrap_or_default();
                self.items.remove(id);
                if self.active.as_deref() == Some(id) {
                    self.active = None;
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

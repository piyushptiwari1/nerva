//! Tasks projection. Lightweight todo list scoped per workspace, event-sourced
//! like every other module. State is held in-memory and rebuilt by replaying
//! `task.*` events; the IPC layer is responsible for emitting them.

use crate::store::StoredEvent;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    Todo,
    Done,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub workspace_id: Option<String>,
    pub title: String,
    pub status: TaskStatus,
    pub created_ms: i64,
    pub completed_ms: Option<i64>,
}

#[derive(Default)]
pub struct TasksProjection {
    items: HashMap<String, Task>,
}

impl TasksProjection {
    pub fn new() -> Self { Self::default() }

    pub fn apply(&mut self, ev: &StoredEvent) {
        match ev.kind.as_str() {
            "task.created" => {
                let id = ev.payload["id"].as_str().unwrap_or_default().to_string();
                if id.is_empty() { return; }
                let title = ev.payload["title"].as_str().unwrap_or("").to_string();
                let ws = ev.payload["workspace_id"].as_str().map(|s| s.to_string());
                self.items.insert(
                    id.clone(),
                    Task {
                        id,
                        workspace_id: ws,
                        title,
                        status: TaskStatus::Todo,
                        created_ms: ev.ts_ms,
                        completed_ms: None,
                    },
                );
            }
            "task.completed" => {
                let id = ev.payload["id"].as_str().unwrap_or_default();
                if let Some(t) = self.items.get_mut(id) {
                    t.status = TaskStatus::Done;
                    t.completed_ms = Some(ev.ts_ms);
                }
            }
            "task.uncompleted" => {
                let id = ev.payload["id"].as_str().unwrap_or_default();
                if let Some(t) = self.items.get_mut(id) {
                    t.status = TaskStatus::Todo;
                    t.completed_ms = None;
                }
            }
            "task.renamed" => {
                let id = ev.payload["id"].as_str().unwrap_or_default();
                if let Some(t) = self.items.get_mut(id) {
                    if let Some(title) = ev.payload["title"].as_str() {
                        t.title = title.to_string();
                    }
                }
            }
            "task.deleted" => {
                let id = ev.payload["id"].as_str().unwrap_or_default();
                self.items.remove(id);
            }
            _ => {}
        }
    }

    pub fn list(&self) -> Vec<Task> {
        let mut v: Vec<_> = self.items.values().cloned().collect();
        // Open tasks first, newest open at top; then done by completion time desc.
        v.sort_by(|a, b| match (a.status, b.status) {
            (TaskStatus::Todo, TaskStatus::Done) => std::cmp::Ordering::Less,
            (TaskStatus::Done, TaskStatus::Todo) => std::cmp::Ordering::Greater,
            (TaskStatus::Todo, TaskStatus::Todo) => b.created_ms.cmp(&a.created_ms),
            (TaskStatus::Done, TaskStatus::Done) => {
                b.completed_ms.unwrap_or(0).cmp(&a.completed_ms.unwrap_or(0))
            }
        });
        v
    }
}

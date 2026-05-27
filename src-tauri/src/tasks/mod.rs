//! Tasks projection. Lightweight todo list scoped per workspace, event-sourced
//! like every other module. State is held in-memory and rebuilt by replaying
//! `task.*` events; the IPC layer is responsible for emitting them.
//!
//! Ordering of open tasks follows a per-workspace `order` vector that is
//! rewritten on every `task.reordered` event. Open tasks not present in the
//! vector fall back to newest-first; this keeps newly-created tasks visible
//! without forcing a reorder write for every create.

use crate::store::StoredEvent;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    Todo,
    Done,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskPriority {
    High,
    Med,
    Low,
}

impl TaskPriority {
    /// Sort weight where lower = higher priority (so default `sort` ascends).
    pub fn rank(self) -> i32 {
        match self {
            TaskPriority::High => 0,
            TaskPriority::Med => 1,
            TaskPriority::Low => 2,
        }
    }

    fn from_str(s: &str) -> Self {
        match s {
            "high" => TaskPriority::High,
            "low" => TaskPriority::Low,
            _ => TaskPriority::Med,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub workspace_id: Option<String>,
    pub title: String,
    pub status: TaskStatus,
    pub created_ms: i64,
    pub completed_ms: Option<i64>,
    /// Importance level. Defaults to `Med` for tasks created before this field
    /// existed; replay applies it via the `task.priority_set` event.
    #[serde(default = "default_priority")]
    pub priority: TaskPriority,
    /// Optional due-by Unix ms in local time. `None` = no deadline.
    #[serde(default)]
    pub due_ms: Option<i64>,
}

fn default_priority() -> TaskPriority { TaskPriority::Med }

#[derive(Default)]
pub struct TasksProjection {
    items: HashMap<String, Task>,
    /// Ordered todo ids per workspace. `None` is the "no workspace" bucket.
    order: HashMap<Option<String>, Vec<String>>,
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
                let priority = ev.payload["priority"].as_str()
                    .map(TaskPriority::from_str)
                    .unwrap_or(TaskPriority::Med);
                let due_ms = ev.payload["due_ms"].as_i64();
                self.items.insert(
                    id.clone(),
                    Task {
                        id,
                        workspace_id: ws,
                        title,
                        status: TaskStatus::Todo,
                        created_ms: ev.ts_ms,
                        completed_ms: None,
                        priority,
                        due_ms,
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
                for v in self.order.values_mut() {
                    v.retain(|x| x != id);
                }
            }
            "task.reordered" => {
                let ws = ev.payload["workspace_id"].as_str().map(|s| s.to_string());
                let ids: Vec<String> = ev.payload["ordered_ids"]
                    .as_array()
                    .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                    .unwrap_or_default();
                self.order.insert(ws, ids);
            }
            "task.priority_set" => {
                let id = ev.payload["id"].as_str().unwrap_or_default();
                if let Some(t) = self.items.get_mut(id) {
                    if let Some(p) = ev.payload["priority"].as_str() {
                        t.priority = TaskPriority::from_str(p);
                    }
                }
            }
            "task.due_set" => {
                let id = ev.payload["id"].as_str().unwrap_or_default();
                if let Some(t) = self.items.get_mut(id) {
                    // `null` clears the due-by; missing key leaves it untouched.
                    if ev.payload.get("due_ms").is_some() {
                        t.due_ms = ev.payload["due_ms"].as_i64();
                    }
                }
            }
            _ => {}
        }
    }

    pub fn list(&self) -> Vec<Task> {
        // Split open/done so we can apply distinct orderings.
        let (mut todo, mut done): (Vec<Task>, Vec<Task>) = self
            .items
            .values()
            .cloned()
            .partition(|t| t.status == TaskStatus::Todo);

        // Open tasks: priority first (High → Low), then per-workspace explicit
        // order vec for ties, then newest-first. This means a freshly-flagged
        // high-priority task automatically rises to the top without forcing a
        // reorder write, while explicit reorders still control intra-bucket order.
        todo.sort_by(|a, b| {
            a.priority
                .rank()
                .cmp(&b.priority.rank())
                .then_with(|| self.rank(a).cmp(&self.rank(b)))
                .then_with(|| b.created_ms.cmp(&a.created_ms))
        });
        // Done: newest-completion first.
        done.sort_by(|a, b| b.completed_ms.unwrap_or(0).cmp(&a.completed_ms.unwrap_or(0)));
        todo.extend(done);
        todo
    }

    /// Sort key for an open task: its index in the workspace order vec, or
    /// `i64::MAX` if absent (so unknown ids slot in after explicitly-ordered
    /// ones and then fall back to newest-first via the secondary key).
    fn rank(&self, t: &Task) -> i64 {
        let order = match self.order.get(&t.workspace_id) {
            Some(v) => v,
            None => return i64::MAX,
        };
        order.iter().position(|x| *x == t.id).map(|i| i as i64).unwrap_or(i64::MAX)
    }
}

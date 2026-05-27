//! Application-wide state: storage pool + in-memory projections.

use crate::error::{NervaError, Result};
use crate::notes::NotesProjection;
use crate::store::Store;
use crate::timers::TimerEngine;
use crate::workspaces::WorkspacesProjection;
use parking_lot::Mutex;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

pub struct AppState {
    pub store: Arc<Store>,
    pub timers: Arc<Mutex<TimerEngine>>,
    pub notes: Arc<Mutex<NotesProjection>>,
    pub workspaces: Arc<Mutex<WorkspacesProjection>>,
    pub data_dir: PathBuf,
}

impl AppState {
    pub fn initialize(app: &AppHandle) -> Result<Self> {
        let data_dir = resolve_data_dir(app)?;
        std::fs::create_dir_all(&data_dir)?;
        tracing::info!(path = %data_dir.display(), "data directory");

        let db_path = data_dir.join("nerva.db");
        let store = Arc::new(Store::open(&db_path)?);
        store.migrate()?;

        // Replay events to rebuild in-memory projections.
        let mut timers = TimerEngine::new();
        let mut notes = NotesProjection::new();
        let mut workspaces = WorkspacesProjection::new();

        let events = store.replay_all()?;
        tracing::info!(count = events.len(), "replaying events");
        for ev in &events {
            timers.apply(ev);
            notes.apply(ev);
            workspaces.apply(ev);
        }

        // Ensure a default workspace exists.
        if workspaces.list().is_empty() {
            let id = workspaces.create_default();
            store.append_event("workspace.created", &serde_json::json!({
                "id": id, "name": "Default", "color": "#7c9cff"
            }))?;
            workspaces.set_active(&id);
            store.append_event("workspace.activated", &serde_json::json!({ "id": id }))?;
        }

        Ok(Self {
            store,
            timers: Arc::new(Mutex::new(timers)),
            notes: Arc::new(Mutex::new(notes)),
            workspaces: Arc::new(Mutex::new(workspaces)),
            data_dir,
        })
    }
}

fn resolve_data_dir(app: &AppHandle) -> Result<PathBuf> {
    app.path()
        .app_data_dir()
        .map_err(|e| NervaError::Storage(format!("app_data_dir: {e}")))
}

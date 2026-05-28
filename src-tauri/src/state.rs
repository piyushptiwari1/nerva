//! Application-wide state: storage pool + in-memory projections.

use crate::audio::{AudioEngine, AudioSettings};
use crate::error::{NervaError, Result};
use crate::habits::HabitsProjection;
use crate::intelligence::{OllamaClient, OllamaConfig};
use crate::notes::NotesProjection;
use crate::store::Store;
use crate::tasks::TasksProjection;
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
    pub tasks: Arc<Mutex<TasksProjection>>,
    pub habits: Arc<Mutex<HabitsProjection>>,
    pub audio: Arc<AudioEngine>,
    pub ai: Arc<OllamaClient>,
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
        let mut tasks = TasksProjection::new();
        let mut habits = HabitsProjection::new();

        let events = store.replay_all()?;
        tracing::info!(count = events.len(), "replaying events");
        for ev in &events {
            timers.apply(ev);
            notes.apply(ev);
            workspaces.apply(ev);
            tasks.apply(ev);
            habits.apply(ev);
        }

        // Ensure a default workspace exists.
        if workspaces.list().is_empty() {
            let id = workspaces.create_default();
            store.append_event(
                "workspace.created",
                &serde_json::json!({
                    "id": id, "name": "Default", "color": "#7c9cff"
                }),
            )?;
            workspaces.set_active(&id);
            store.append_event("workspace.activated", &serde_json::json!({ "id": id }))?;
        }

        // Restore audio settings from meta.
        let mut audio_settings = AudioSettings::default();
        if let Ok(Some(v)) = store.meta_get("audio.volume") {
            if let Ok(f) = v.parse::<f32>() {
                audio_settings.volume = f.clamp(0.0, 1.0);
            }
        }
        if let Ok(Some(v)) = store.meta_get("audio.muted") {
            audio_settings.muted = v == "true";
        }
        if let Ok(Some(v)) = store.meta_get("audio.ambient_volume") {
            if let Ok(f) = v.parse::<f32>() {
                audio_settings.ambient_volume = f.clamp(0.0, 1.0);
            }
        }
        // Note: we don't auto-resume the ambient track on boot — explicit
        // user intent feels less surprising than waking up to noise. The
        // ipc layer can read the last-selected kind on demand.
        let audio = Arc::new(AudioEngine::spawn(audio_settings));

        // Resolve LLM config: meta-table override, then env vars, then defaults.
        let mut cfg = OllamaConfig::from_env();
        if let Ok(Some(url)) = store.meta_get("ai.endpoint") {
            cfg.endpoint = url;
        }
        if let Ok(Some(m)) = store.meta_get("ai.model") {
            cfg.model = m;
        }
        let ai = Arc::new(OllamaClient::new(cfg));

        Ok(Self {
            store,
            timers: Arc::new(Mutex::new(timers)),
            notes: Arc::new(Mutex::new(notes)),
            workspaces: Arc::new(Mutex::new(workspaces)),
            tasks: Arc::new(Mutex::new(tasks)),
            habits: Arc::new(Mutex::new(habits)),
            audio,
            ai,
            data_dir,
        })
    }
}

fn resolve_data_dir(app: &AppHandle) -> Result<PathBuf> {
    app.path()
        .app_data_dir()
        .map_err(|e| NervaError::Storage(format!("app_data_dir: {e}")))
}

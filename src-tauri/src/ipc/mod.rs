//! Tauri command surface (frontend ↔ backend IPC).

use crate::error::{NervaError, Result};
use crate::notes::NoteMeta;
use crate::state::AppState;
use crate::store::StoredEvent;
use crate::timers::Timer;
use crate::workspaces::Workspace;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

type State<'a> = tauri::State<'a, Arc<AppState>>;

#[derive(Debug, Serialize)]
pub struct RuntimeInfo {
    pub version: &'static str,
    pub data_dir: String,
    pub event_count: i64,
}

#[tauri::command]
pub fn ping() -> &'static str { "pong" }

#[tauri::command]
pub fn get_runtime_info(state: State) -> Result<RuntimeInfo> {
    let events = state.store.replay_all()?;
    Ok(RuntimeInfo {
        version: env!("CARGO_PKG_VERSION"),
        data_dir: state.data_dir.display().to_string(),
        event_count: events.len() as i64,
    })
}

// ---------- timers ----------

#[derive(Debug, Deserialize)]
pub struct CreateTimerArgs {
    pub name: String,
    pub duration_ms: i64,
    pub color: Option<String>,
    pub workspace_id: Option<String>,
}

#[tauri::command]
pub fn timer_create(state: State, args: CreateTimerArgs) -> Result<Timer> {
    if args.duration_ms <= 0 {
        return Err(NervaError::Invalid("duration_ms must be > 0".into()));
    }
    let id = Uuid::new_v4().to_string();
    let workspace_id = args
        .workspace_id
        .or_else(|| state.workspaces.lock().active().map(|w| w.id.clone()));
    let payload = serde_json::json!({
        "id": id,
        "name": args.name,
        "duration_ms": args.duration_ms,
        "color": args.color.unwrap_or_else(|| "#7c9cff".into()),
        "workspace_id": workspace_id,
    });
    let evt_id = state.store.append_event("timer.created", &payload)?;
    let ev = StoredEvent { id: evt_id, ts_ms: crate::store::now_ms(), kind: "timer.created".into(), payload };
    let mut engine = state.timers.lock();
    engine.apply(&ev);
    Ok(engine.get(&id).cloned().ok_or_else(|| NervaError::Invalid("create failed".into()))?)
}

fn append_and_apply(state: &State, kind: &str, id: &str) -> Result<()> {
    let payload = serde_json::json!({ "id": id });
    let evt_id = state.store.append_event(kind, &payload)?;
    let ev = StoredEvent { id: evt_id, ts_ms: crate::store::now_ms(), kind: kind.into(), payload };
    state.timers.lock().apply(&ev);
    Ok(())
}

#[tauri::command]
pub fn timer_start(state: State, id: String) -> Result<Timer> {
    append_and_apply(&state, "timer.started", &id)?;
    state.timers.lock().get(&id).cloned().ok_or_else(|| NervaError::NotFound(id))
}

#[tauri::command]
pub fn timer_pause(state: State, id: String) -> Result<Timer> {
    append_and_apply(&state, "timer.paused", &id)?;
    state.timers.lock().get(&id).cloned().ok_or_else(|| NervaError::NotFound(id))
}

#[tauri::command]
pub fn timer_resume(state: State, id: String) -> Result<Timer> {
    append_and_apply(&state, "timer.resumed", &id)?;
    state.timers.lock().get(&id).cloned().ok_or_else(|| NervaError::NotFound(id))
}

#[tauri::command]
pub fn timer_reset(state: State, id: String) -> Result<Timer> {
    append_and_apply(&state, "timer.reset", &id)?;
    state.timers.lock().get(&id).cloned().ok_or_else(|| NervaError::NotFound(id))
}

#[tauri::command]
pub fn timer_delete(state: State, id: String) -> Result<()> {
    append_and_apply(&state, "timer.deleted", &id)
}

#[tauri::command]
pub fn timer_list(state: State) -> Result<Vec<Timer>> {
    Ok(state.timers.lock().list())
}

/// Lightweight pure-read tick: recompute & report timers that just completed.
#[tauri::command]
pub fn timer_tick(state: State) -> Result<TickReport> {
    let mut engine = state.timers.lock();
    let completed = engine.tick();
    // Persist completion events for any that crossed the line.
    for id in &completed {
        let _ = state.store.append_event("timer.completed", &serde_json::json!({ "id": id }));
    }
    Ok(TickReport { completed, timers: engine.list() })
}

#[derive(Debug, Serialize)]
pub struct TickReport {
    pub completed: Vec<String>,
    pub timers: Vec<Timer>,
}

// ---------- notes ----------

#[derive(Debug, Serialize)]
pub struct Note {
    pub id: String,
    pub workspace_id: String,
    pub title: String,
    pub body: String,
    pub updated_ms: i64,
}

#[derive(Debug, Deserialize)]
pub struct SaveNoteArgs {
    pub id: Option<String>,
    pub title: String,
    pub body: String,
    pub workspace_id: Option<String>,
}

#[tauri::command]
pub fn note_get(state: State, id: String) -> Result<Option<Note>> {
    let row = state.store.note_get(&id)?;
    Ok(row.map(|(ws, title, body, ts)| Note {
        id,
        workspace_id: ws,
        title,
        body,
        updated_ms: ts,
    }))
}

#[tauri::command]
pub fn note_save(state: State, args: SaveNoteArgs) -> Result<Note> {
    let id = args.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let ws = args
        .workspace_id
        .or_else(|| state.workspaces.lock().active().map(|w| w.id.clone()));
    state
        .store
        .note_upsert(&id, ws.as_deref(), &args.title, &args.body)?;
    // Remember this as the "resume" note for the workspace.
    if let Some(ws_id) = ws.as_deref() {
        let _ = state.store.meta_set(&format!("last_note:{ws_id}"), &id);
    }
    let payload = serde_json::json!({
        "id": id,
        "title": args.title,
        "workspace_id": ws,
        "len": args.body.len(),
    });
    let evt_id = state.store.append_event("note.saved", &payload)?;
    let ev = StoredEvent { id: evt_id, ts_ms: crate::store::now_ms(), kind: "note.saved".into(), payload };
    state.notes.lock().apply(&ev);
    Ok(Note {
        id,
        workspace_id: ws.unwrap_or_default(),
        title: args.title,
        body: args.body,
        updated_ms: crate::store::now_ms(),
    })
}

#[tauri::command]
pub fn note_list(state: State) -> Result<Vec<NoteMeta>> {
    Ok(state.notes.lock().list())
}

#[derive(Debug, Serialize)]
pub struct NoteSearchHit {
    pub id: String,
    pub workspace_id: String,
    pub title: String,
    pub snippet: String,
    pub rank: f64,
}

#[tauri::command]
pub fn note_search(state: State, query: String, limit: Option<i64>) -> Result<Vec<NoteSearchHit>> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }
    // Sanitize: FTS5 MATCH treats some chars specially. Wrap each token in quotes
    // and append `*` for prefix search to make casual queries forgiving.
    let sanitized = q
        .split_whitespace()
        .map(|t| {
            let safe = t.replace('"', "");
            format!("\"{safe}\"*")
        })
        .collect::<Vec<_>>()
        .join(" ");
    let hits = state.store.note_search(&sanitized, limit.unwrap_or(20))?;
    Ok(hits
        .into_iter()
        .map(|(id, ws, title, snippet, rank)| NoteSearchHit {
            id,
            workspace_id: ws,
            title,
            snippet,
            rank,
        })
        .collect())
}

#[tauri::command]
pub fn last_note_for_workspace(state: State, workspace_id: String) -> Result<Option<String>> {
    state.store.meta_get(&format!("last_note:{workspace_id}"))
}

// ---------- workspaces ----------

#[derive(Debug, Deserialize)]
pub struct CreateWorkspaceArgs {
    pub name: String,
    pub color: Option<String>,
}

#[tauri::command]
pub fn workspace_list(state: State) -> Result<Vec<Workspace>> {
    Ok(state.workspaces.lock().list())
}

#[tauri::command]
pub fn workspace_create(state: State, args: CreateWorkspaceArgs) -> Result<Workspace> {
    let id = Uuid::new_v4().to_string();
    let color = args.color.unwrap_or_else(|| "#7c9cff".into());
    let payload = serde_json::json!({ "id": id, "name": args.name, "color": color });
    let evt_id = state.store.append_event("workspace.created", &payload)?;
    let ev = StoredEvent {
        id: evt_id, ts_ms: crate::store::now_ms(),
        kind: "workspace.created".into(), payload,
    };
    let mut ws = state.workspaces.lock();
    ws.apply(&ev);
    ws.list()
        .into_iter()
        .find(|w| w.id == id)
        .ok_or_else(|| NervaError::Invalid("workspace create failed".into()))
}

#[tauri::command]
pub fn workspace_activate(state: State, id: String) -> Result<()> {
    let payload = serde_json::json!({ "id": id });
    let evt_id = state.store.append_event("workspace.activated", &payload)?;
    let ev = StoredEvent {
        id: evt_id, ts_ms: crate::store::now_ms(),
        kind: "workspace.activated".into(), payload,
    };
    state.workspaces.lock().apply(&ev);
    Ok(())
}

#[tauri::command]
pub fn workspace_active(state: State) -> Result<Option<Workspace>> {
    Ok(state.workspaces.lock().active().cloned())
}

// ---------- timeline ----------

#[tauri::command]
pub fn events_recent(state: State, limit: Option<i64>) -> Result<Vec<StoredEvent>> {
    state.store.recent_events(limit.unwrap_or(200))
}

// ---------- sticky windows ----------

/// Spawn (or focus, if already open) a small always-on-top sticky-note window
/// rendering a single note. The frontend is the same bundle — it reads the
/// `sticky` URL query param and mounts the `<StickyNote/>` view.
#[tauri::command]
pub fn open_sticky(app: tauri::AppHandle, note_id: String) -> Result<()> {
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

    let label = format!("sticky-{}", note_id.replace(['-', ' '], "_"));
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.set_focus();
        return Ok(());
    }
    let url = format!("index.html?sticky={note_id}");
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title("Nerva Sticky")
        .inner_size(360.0, 420.0)
        .min_inner_size(240.0, 240.0)
        .always_on_top(true)
        .decorations(false)
        .transparent(false)
        .skip_taskbar(false)
        .resizable(true)
        .build()
        .map_err(|e| NervaError::Invalid(format!("open sticky: {e}")))?;
    Ok(())
}

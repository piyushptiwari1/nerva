//! Tauri command surface (frontend ↔ backend IPC).

use crate::error::{NervaError, Result};
use crate::intelligence::{AiHealth, ChatMessage};
use crate::notes::NoteMeta;
use crate::state::AppState;
use crate::store::StoredEvent;
use crate::tasks::Task;
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
    // Persist completion events for any that crossed the line, then fire the
    // completion sound once per batch (a single "ding" even if N timers finish
    // in the same tick — avoids a cluster of overlapping tones).
    for id in &completed {
        let _ = state.store.append_event("timer.completed", &serde_json::json!({ "id": id }));
    }
    if !completed.is_empty() {
        state.audio.play_completion();
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

// ---------- tasks ----------

#[derive(Debug, Deserialize)]
pub struct CreateTaskArgs {
    pub title: String,
    pub workspace_id: Option<String>,
}

#[tauri::command]
pub fn task_list(state: State) -> Result<Vec<Task>> {
    Ok(state.tasks.lock().list())
}

#[tauri::command]
pub fn task_create(state: State, args: CreateTaskArgs) -> Result<Task> {
    let title = args.title.trim();
    if title.is_empty() {
        return Err(NervaError::Invalid("task title required".into()));
    }
    let id = Uuid::new_v4().to_string();
    let ws = args
        .workspace_id
        .or_else(|| state.workspaces.lock().active().map(|w| w.id.clone()));
    let payload = serde_json::json!({
        "id": id,
        "title": title,
        "workspace_id": ws,
    });
    let evt_id = state.store.append_event("task.created", &payload)?;
    let ev = StoredEvent {
        id: evt_id, ts_ms: crate::store::now_ms(),
        kind: "task.created".into(), payload,
    };
    let mut proj = state.tasks.lock();
    proj.apply(&ev);
    proj.list()
        .into_iter()
        .find(|t| t.id == id)
        .ok_or_else(|| NervaError::Invalid("task create failed".into()))
}

#[tauri::command]
pub fn task_toggle(state: State, id: String) -> Result<Task> {
    let kind = {
        let proj = state.tasks.lock();
        let t = proj
            .list()
            .into_iter()
            .find(|t| t.id == id)
            .ok_or_else(|| NervaError::NotFound(id.clone()))?;
        match t.status {
            crate::tasks::TaskStatus::Todo => "task.completed",
            crate::tasks::TaskStatus::Done => "task.uncompleted",
        }
    };
    let payload = serde_json::json!({ "id": id });
    let evt_id = state.store.append_event(kind, &payload)?;
    let ev = StoredEvent {
        id: evt_id, ts_ms: crate::store::now_ms(),
        kind: kind.into(), payload,
    };
    let mut proj = state.tasks.lock();
    proj.apply(&ev);
    proj.list()
        .into_iter()
        .find(|t| t.id == id)
        .ok_or_else(|| NervaError::NotFound(id))
}

#[derive(Debug, Deserialize)]
pub struct RenameTaskArgs {
    pub id: String,
    pub title: String,
}

#[tauri::command]
pub fn task_rename(state: State, args: RenameTaskArgs) -> Result<Task> {
    let title = args.title.trim();
    if title.is_empty() {
        return Err(NervaError::Invalid("task title required".into()));
    }
    let payload = serde_json::json!({ "id": args.id, "title": title });
    let evt_id = state.store.append_event("task.renamed", &payload)?;
    let ev = StoredEvent {
        id: evt_id, ts_ms: crate::store::now_ms(),
        kind: "task.renamed".into(), payload,
    };
    let mut proj = state.tasks.lock();
    proj.apply(&ev);
    proj.list()
        .into_iter()
        .find(|t| t.id == args.id)
        .ok_or_else(|| NervaError::NotFound(args.id))
}

#[tauri::command]
pub fn task_delete(state: State, id: String) -> Result<()> {
    let payload = serde_json::json!({ "id": id });
    let evt_id = state.store.append_event("task.deleted", &payload)?;
    let ev = StoredEvent {
        id: evt_id, ts_ms: crate::store::now_ms(),
        kind: "task.deleted".into(), payload,
    };
    state.tasks.lock().apply(&ev);
    Ok(())
}

// ---------- momentum ----------

#[derive(Debug, Serialize)]
pub struct MomentumBucket {
    /// `YYYY-MM-DD` in local time, oldest first.
    pub date: String,
    /// Unix ms of midnight (local) for the bucket — handy for client tooltips.
    pub start_ms: i64,
    pub completed_timers: i64,
    pub completed_tasks: i64,
    /// Total focused milliseconds (sum of completed-timer durations) for the day.
    pub focus_ms: i64,
}

#[tauri::command]
pub fn momentum_snapshot(state: State, days: Option<i64>) -> Result<Vec<MomentumBucket>> {
    let days = days.unwrap_or(7).clamp(1, 90);
    let now = crate::store::now_ms();
    let day_ms: i64 = 86_400_000;
    // Bucket by UTC day. Good enough for a 7-day momentum strip; a future
    // refactor can plumb in a real timezone offset if users complain.
    let utc_midnight_today = (now / day_ms) * day_ms;
    let start_ms = utc_midnight_today - (days - 1) * day_ms;

    let mut buckets: Vec<MomentumBucket> = (0..days)
        .map(|i| {
            let bucket_start = start_ms + i * day_ms;
            MomentumBucket {
                date: format_utc_date(bucket_start),
                start_ms: bucket_start,
                completed_timers: 0,
                completed_tasks: 0,
                focus_ms: 0,
            }
        })
        .collect();

    let timer_durations: std::collections::HashMap<String, i64> = state
        .timers
        .lock()
        .list()
        .into_iter()
        .map(|t| (t.id, t.duration_ms))
        .collect();

    for ev in state.store.replay_all()? {
        if ev.ts_ms < start_ms {
            continue;
        }
        let idx = ((ev.ts_ms - start_ms) / day_ms) as usize;
        if idx >= buckets.len() {
            continue;
        }
        match ev.kind.as_str() {
            "timer.completed" => {
                buckets[idx].completed_timers += 1;
                if let Some(id) = ev.payload["id"].as_str() {
                    if let Some(d) = timer_durations.get(id) {
                        buckets[idx].focus_ms += *d;
                    }
                }
            }
            "task.completed" => buckets[idx].completed_tasks += 1,
            _ => {}
        }
    }
    Ok(buckets)
}

/// Convert a unix-ms timestamp at a UTC day boundary to a `YYYY-MM-DD` string.
/// Uses the civil-from-days algorithm by Howard Hinnant — no external deps.
fn format_utc_date(ms: i64) -> String {
    let days = ms.div_euclid(86_400_000);
    let (y, m, d) = civil_from_days(days);
    format!("{:04}-{:02}-{:02}", y, m, d)
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    // Hinnant's date algorithm. Days are counted from 1970-01-01.
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146_096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
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

/// Spawn (or focus) the always-on-top floating timer widget. Single instance.
#[tauri::command]
pub fn open_timer_widget(app: tauri::AppHandle) -> Result<()> {
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

    let label = "timer-widget";
    if let Some(win) = app.get_webview_window(label) {
        let _ = win.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(&app, label, WebviewUrl::App("index.html?widget=timer".into()))
        .title("Nerva Timer")
        .inner_size(280.0, 130.0)
        .min_inner_size(220.0, 100.0)
        .always_on_top(true)
        .decorations(false)
        .transparent(false)
        .resizable(true)
        .build()
        .map_err(|e| NervaError::Invalid(format!("open timer widget: {e}")))?;
    Ok(())
}

// ---------- audio ----------

#[derive(Debug, Serialize)]
pub struct AudioState {
    pub volume: f32,
    pub muted: bool,
    pub available: bool,
}

#[tauri::command]
pub fn audio_state(state: State) -> Result<AudioState> {
    let s = state.audio.snapshot();
    Ok(AudioState { volume: s.volume, muted: s.muted, available: s.available })
}

#[tauri::command]
pub fn audio_set_volume(state: State, volume: f32) -> Result<AudioState> {
    let v = volume.clamp(0.0, 1.0);
    state.audio.set_volume(v);
    state.store.meta_set("audio.volume", &v.to_string())?;
    audio_state(state)
}

#[tauri::command]
pub fn audio_set_muted(state: State, muted: bool) -> Result<AudioState> {
    state.audio.set_muted(muted);
    state.store.meta_set("audio.muted", if muted { "true" } else { "false" })?;
    audio_state(state)
}

#[tauri::command]
pub fn audio_test(state: State) -> Result<()> {
    state.audio.play_completion();
    Ok(())
}

// ---------- focus / DND ----------

#[derive(Debug, Serialize)]
pub struct FocusState {
    pub dnd: Option<bool>,
    pub supported: bool,
}

#[tauri::command]
pub fn focus_state() -> Result<FocusState> {
    let dnd = crate::focus::get_dnd()?;
    Ok(FocusState { dnd, supported: dnd.is_some() })
}

#[tauri::command]
pub fn focus_set_dnd(state: State, enabled: bool) -> Result<FocusState> {
    let toggled = crate::focus::set_dnd(enabled)?;
    if toggled {
        state
            .store
            .meta_set("focus.dnd", if enabled { "true" } else { "false" })?;
    }
    focus_state()
}

// ---------- intelligence (local LLM) ----------

#[derive(Debug, Deserialize)]
pub struct AskArgs {
    /// Frontend-supplied request id — echoed in every `ai.chunk` event so the
    /// UI can multiplex concurrent asks against a single window event channel.
    pub request_id: String,
    pub prompt: String,
    /// Whether to inject workspace + recent-events context into the system msg.
    #[serde(default)]
    pub include_context: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct AiChunk {
    pub request_id: String,
    pub delta: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct AiResult {
    pub request_id: String,
    pub text: String,
}

#[tauri::command]
pub async fn ai_health(state: tauri::State<'_, Arc<AppState>>) -> Result<AiHealth> {
    Ok(state.ai.health().await)
}

#[derive(Debug, Serialize, Clone)]
pub struct AiDone {
    pub request_id: String,
    pub text: String,
    pub cancelled: bool,
    pub model: String,
}

#[tauri::command]
pub async fn ai_ask(
    window: tauri::Window,
    state: tauri::State<'_, Arc<AppState>>,
    args: AskArgs,
) -> Result<AiResult> {
    use tauri::Emitter;
    if args.prompt.trim().is_empty() {
        return Err(NervaError::Invalid("prompt required".into()));
    }
    let messages = build_messages(&state, &args)?;
    let req_id = args.request_id.clone();
    let win = window.clone();
    let outcome = state
        .ai
        .chat_stream(&req_id, messages, |delta| {
            // Best-effort emit; if the listener has dropped, swallow the error
            // rather than aborting the stream.
            let _ = win.emit(
                "ai.chunk",
                AiChunk { request_id: req_id.clone(), delta: delta.to_string() },
            );
        })
        .await?;

    // Tell the frontend the stream ended (cleanly or via cancel).
    let _ = window.emit(
        "ai.done",
        AiDone {
            request_id: req_id.clone(),
            text: outcome.text.clone(),
            cancelled: outcome.cancelled,
            model: outcome.model.clone(),
        },
    );

    // Persist completed exchanges into the event log so we can replay history
    // and build longer-running session memory later. Skip cancelled streams —
    // they're likely incomplete and not worth surfacing.
    if !outcome.cancelled && !outcome.text.trim().is_empty() {
        let payload = serde_json::json!({
            "id": req_id,
            "prompt": args.prompt,
            "response": outcome.text,
            "model": outcome.model,
            "include_context": args.include_context,
        });
        let _ = state.store.append_event("ai.exchange.recorded", &payload);
    }

    Ok(AiResult { request_id: req_id, text: outcome.text })
}

#[tauri::command]
pub fn ai_cancel(state: State, request_id: String) -> Result<bool> {
    Ok(state.ai.cancel(&request_id))
}

#[derive(Debug, Serialize)]
pub struct AiExchange {
    pub id: String,
    pub ts_ms: i64,
    pub prompt: String,
    pub response: String,
    pub model: String,
}

/// Return the most recent completed AI exchanges, newest first.
#[tauri::command]
pub fn ai_history(state: State, limit: Option<i64>) -> Result<Vec<AiExchange>> {
    let limit = limit.unwrap_or(20).clamp(1, 200) as usize;
    let mut out: Vec<AiExchange> = Vec::with_capacity(limit);
    // Walk events newest→oldest so we can early-exit once we've collected enough.
    let all = state.store.replay_all()?;
    for ev in all.into_iter().rev() {
        if ev.kind != "ai.exchange.recorded" { continue; }
        let id = ev.payload.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let prompt = ev.payload.get("prompt").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let response = ev.payload.get("response").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let model = ev.payload.get("model").and_then(|v| v.as_str()).unwrap_or("").to_string();
        out.push(AiExchange { id, ts_ms: ev.ts_ms, prompt, response, model });
        if out.len() >= limit { break; }
    }
    Ok(out)
}

#[derive(Debug, Serialize)]
pub struct AiSettings {
    pub endpoint: String,
    pub model: String,
}

#[tauri::command]
pub fn ai_settings_get(state: State) -> Result<AiSettings> {
    let cfg = state.ai.snapshot();
    Ok(AiSettings { endpoint: cfg.endpoint, model: cfg.model })
}

#[tauri::command]
pub fn ai_set_model(state: State, model: String) -> Result<AiSettings> {
    let m = model.trim();
    if m.is_empty() {
        return Err(NervaError::Invalid("model required".into()));
    }
    state.ai.set_model(m);
    state.store.meta_set("ai.model", m)?;
    let cfg = state.ai.snapshot();
    Ok(AiSettings { endpoint: cfg.endpoint, model: cfg.model })
}

/// Build the Ollama message list. The system prompt is short, opinionated, and
/// pins the assistant's role; optional context appends today's workspace name,
/// completed/active timers, open tasks, and the last 30 events.
fn build_messages(state: &State, args: &AskArgs) -> Result<Vec<ChatMessage>> {
    let mut system = String::from(
        "You are Nerva, a calm, terse copilot living inside a personal focus \
         workspace. Answer concisely. Prefer bullet points. Never invent \
         calendar events, files, or facts that aren't in the supplied context. \
         If asked to plan, propose 1–3 short steps.",
    );
    if args.include_context {
        let ws = state.workspaces.lock().active().map(|w| w.name.clone());
        let timers = state.timers.lock().list();
        let active_timers: Vec<String> = timers
            .iter()
            .filter(|t| matches!(t.status, crate::timers::TimerStatus::Running | crate::timers::TimerStatus::Paused))
            .map(|t| format!("- {} ({}m, {:?})", t.name, t.duration_ms / 60_000, t.status))
            .collect();
        let tasks = state.tasks.lock().list();
        let open_tasks: Vec<String> = tasks
            .iter()
            .filter(|t| matches!(t.status, crate::tasks::TaskStatus::Todo))
            .take(10)
            .map(|t| format!("- {}", t.title))
            .collect();
        let recent = state.store.recent_events(30)?;
        let recent_lines: Vec<String> = recent
            .iter()
            .rev()
            .map(|ev| format!("- {} {}", ev.kind, short_payload(&ev.payload)))
            .collect();

        system.push_str("\n\n# Current session\n");
        if let Some(w) = ws { system.push_str(&format!("Workspace: {w}\n")); }
        if !active_timers.is_empty() {
            system.push_str("Active timers:\n");
            system.push_str(&active_timers.join("\n"));
            system.push('\n');
        }
        if !open_tasks.is_empty() {
            system.push_str("Open tasks:\n");
            system.push_str(&open_tasks.join("\n"));
            system.push('\n');
        }
        if !recent_lines.is_empty() {
            system.push_str("Recent events (oldest→newest):\n");
            system.push_str(&recent_lines.join("\n"));
            system.push('\n');
        }
    }
    Ok(vec![
        ChatMessage { role: "system".into(), content: system },
        ChatMessage { role: "user".into(), content: args.prompt.clone() },
    ])
}

fn short_payload(v: &serde_json::Value) -> String {
    // Pick a couple of common keys so context stays compact.
    let mut parts = vec![];
    for k in ["name", "title", "id"] {
        if let Some(s) = v.get(k).and_then(|x| x.as_str()) {
            parts.push(format!("{k}={s}"));
            if parts.len() >= 2 { break; }
        }
    }
    parts.join(" ")
}

//! Nerva — persistent focus workspace runtime.
//!
//! Architecture:
//!   - Event-sourced SQLite store (append-only) as ground truth.
//!   - In-memory projections (timers, notes, workspaces) rebuilt by replaying events.
//!   - Wall-clock based timer math (survives sleep/reboot).
//!   - Tauri commands + events for IPC with the React frontend.

pub mod error;
pub mod intelligence;
pub mod ipc;
pub mod notes;
pub mod state;
pub mod store;
pub mod tasks;
pub mod timers;
pub mod workspaces;
pub mod audio;
pub mod focus;

use state::AppState;
use std::sync::Arc;
use tracing_subscriber::EnvFilter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "nerva=info".into()))
        .with_target(false)
        .compact()
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // Focus existing window on second-instance launch.
            use tauri::Manager;
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_focus();
                let _ = win.unminimize();
            }
        }))
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            use tauri::Manager;
            let handle = app.handle().clone();
            let state = AppState::initialize(&handle)
                .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
            app.manage(Arc::new(state));
            tracing::info!("Nerva runtime ready");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ipc::ping,
            ipc::get_runtime_info,
            // timers
            ipc::timer_create,
            ipc::timer_start,
            ipc::timer_pause,
            ipc::timer_resume,
            ipc::timer_reset,
            ipc::timer_delete,
            ipc::timer_list,
            ipc::timer_tick,
            // notes
            ipc::note_get,
            ipc::note_save,
            ipc::note_list,
            ipc::note_search,
            ipc::last_note_for_workspace,
            // workspaces
            ipc::workspace_list,
            ipc::workspace_create,
            ipc::workspace_activate,
            ipc::workspace_active,
            // events (timeline)
            ipc::events_recent,
            // tasks
            ipc::task_list,
            ipc::task_create,
            ipc::task_toggle,
            ipc::task_rename,
            ipc::task_delete,
            ipc::task_reorder,
            // momentum
            ipc::momentum_snapshot,
            // sticky / widgets
            ipc::open_sticky,
            ipc::open_timer_widget,
            // audio
            ipc::audio_state,
            ipc::audio_set_volume,
            ipc::audio_set_muted,
            ipc::audio_test,
            // focus / DND
            ipc::focus_state,
            ipc::focus_set_dnd,
            // intelligence (local LLM)
            ipc::ai_health,
            ipc::ai_ask,
            ipc::ai_cancel,
            ipc::ai_history,
            ipc::ai_settings_get,
            ipc::ai_set_model,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Nerva");
}

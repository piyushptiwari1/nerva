//! Nerva — persistent focus workspace runtime.
//!
//! Architecture:
//!   - Event-sourced SQLite store (append-only) as ground truth.
//!   - In-memory projections (timers, notes, workspaces) rebuilt by replaying events.
//!   - Wall-clock based timer math (survives sleep/reboot).
//!   - Tauri commands + events for IPC with the React frontend.

pub mod audio;
pub mod diag;
pub mod error;
pub mod focus;
pub mod habits;
pub mod intelligence;
pub mod ipc;
pub mod notes;
pub mod state;
pub mod store;
pub mod tasks;
pub mod timers;
pub mod workspaces;

use state::AppState;
use std::sync::Arc;
use tracing_subscriber::EnvFilter;

/// Best-effort wipe of the on-disk SQLite store for `nerva --reset`.
/// Matches the directory Tauri's `app_data_dir()` returns for our
/// identifier on Linux/macOS/Windows. We don't delete the directory
/// itself — that would race with another concurrent instance — only
/// the `nerva.db` family of files. WAL/SHM are removed too because a
/// stale WAL replayed against a fresh DB is exactly the corruption
/// pattern we're recovering from.
fn wipe_data_dir_for_cli_reset() -> std::io::Result<()> {
    const ID: &str = "ai.bytical.nerva";
    let base = dirs::data_dir()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "no platform data dir"))?;
    let dir = base.join(ID);
    if !dir.exists() {
        return Ok(());
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let backup = dir.join(format!("backup-{stamp}"));
    std::fs::create_dir_all(&backup)?;
    for name in ["nerva.db", "nerva.db-wal", "nerva.db-shm"] {
        let from = dir.join(name);
        if from.exists() {
            let _ = std::fs::rename(&from, backup.join(name));
        }
    }
    eprintln!("[nerva --reset] data backed up to {}", backup.display());
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Install the crash hook BEFORE tracing/Tauri so a panic during setup is
    // still captured. Strictly local — see `diag::install_panic_hook`.
    diag::install_panic_hook();

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "nerva=info".into()))
        .with_target(false)
        .compact()
        .init();

    // CLI: `nerva --reset` wipes the on-disk state before any projection
    // is loaded. Last-ditch recovery path when the in-app "Reset all data"
    // button is unreachable (rare — only if the React shell itself is broken).
    // Honoured here, BEFORE `tauri::Builder::default()`, so AppState boots
    // fresh on this same launch.
    let reset_requested = std::env::args().any(|a| a == "--reset");
    if reset_requested {
        if let Err(e) = wipe_data_dir_for_cli_reset() {
            eprintln!("[nerva --reset] wipe failed: {e}");
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // Second-instance launch (e.g. user double-clicks the app icon
            // again while it's already running, or main has been hidden via
            // the close button). Restore + focus the main window so the user
            // always gets back to their workspace.
            use tauri::Manager;
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // Auto-updater: probes the endpoint in tauri.conf.json once at
        // startup. Signature is verified against the bundled pubkey
        // before the .deb/.AppImage/.msi is swapped in. Default is
        // "check, prompt user, apply on next launch" — see the JS
        // call in src/main.tsx for the UI side.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            use tauri::Manager;
            let handle = app.handle().clone();
            let state = AppState::initialize(&handle)
                .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
            let state = Arc::new(state);
            app.manage(state.clone());

            // Wire up the system-tray menu. The icon itself is declared in
            // tauri.conf.json (so it's bundled and registered at boot); here
            // we attach a real menu so right-click reveals Show/Quit/etc.,
            // and left-click on the icon focuses the main window.
            //
            // Without this block the tray icon appears but does nothing on
            // either left or right click, which is the v0.1.0 bug we're fixing.
            if let Err(e) = install_tray_menu(app) {
                tracing::warn!(err = %e, "tray menu setup failed (continuing without)");
            }

            // Intercept the main window's close button: instead of destroying
            // the window (which leaves the user with no way back into the app
            // while popouts are still running), hide it. The user re-opens
            // main via the tray icon ("Show Nerva" or left-click). To truly
            // exit, use tray → "Quit Nerva".
            //
            // Without this, closing the main window on Windows or Linux while
            // popouts are open orphans the user — popouts keep running but
            // there's no tray menu hook (pre-v0.1.1) and no main window to
            // click, so the only recovery is killing every popout.
            if let Some(main) = app.get_webview_window("main") {
                let app_for_event = app.handle().clone();
                main.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        if let Some(w) = app_for_event.get_webview_window("main") {
                            let _ = w.hide();
                        }
                    }
                });
            }

            // Best-effort background backfill: embed any notes that don't
            // have a cached vector yet. Runs once on boot; bounded by the
            // number of notes — typical user has < a few hundred. Each embed
            // is sequential to avoid hammering Ollama; failures are silent
            // (the next note.saved will retry naturally).
            //
            // Hard cap of 200 notes per boot to keep CPU/network bounded for
            // heavy users; remaining notes get embedded on next save or on
            // the following launch. Per-call timeout via `ai.embed` itself.
            let bg = state.clone();
            tauri::async_runtime::spawn(async move {
                const MAX_PER_BOOT: usize = 200;
                let model = std::env::var("NERVA_EMBED_MODEL")
                    .unwrap_or_else(|_| crate::intelligence::DEFAULT_EMBED_MODEL.to_string());
                let pending = match bg.store.notes_missing_embeddings() {
                    Ok(v) => v,
                    Err(e) => {
                        tracing::warn!(err = %e, "embed backfill query");
                        return;
                    }
                };
                if pending.is_empty() {
                    return;
                }
                let total = pending.len();
                tracing::info!(total, cap = MAX_PER_BOOT, "embedding backfill starting");
                for (id, title, body) in pending.into_iter().take(MAX_PER_BOOT) {
                    let text = format!("{title}\n\n{body}");
                    match bg.ai.embed(&text, &model).await {
                        Ok(v) => {
                            let _ = bg.store.embedding_upsert(&id, &model, &v);
                        }
                        Err(e) => {
                            tracing::debug!(note = %id, err = %e, "backfill embed skipped");
                            // Don't keep hammering if the sidecar is offline.
                            break;
                        }
                    }
                }
                tracing::info!("embedding backfill done");
            });

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
            ipc::note_delete,
            ipc::note_list,
            ipc::note_search,
            ipc::note_semantic_search,
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
            ipc::task_set_priority,
            ipc::task_set_due,
            // momentum
            ipc::momentum_snapshot,
            // sticky / widgets
            ipc::open_sticky,
            ipc::open_timer_widget,
            ipc::open_habits_widget,
            ipc::open_tasks_widget,
            ipc::window_set_always_on_top,
            ipc::window_close,
            ipc::reveal_data_dir,
            ipc::reset_all_data,
            // audio
            ipc::audio_state,
            ipc::audio_set_volume,
            ipc::audio_set_muted,
            ipc::audio_test,
            ipc::ambient_set,
            ipc::ambient_set_volume,
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
            ipc::ai_set_endpoint,
            // settings
            ipc::settings_get,
            ipc::timer_presets_set,
            // diagnostics
            ipc::diag_list_crashes,
            ipc::diag_read_crash,
            ipc::diag_clear_crashes,
            // habits
            ipc::habit_list,
            ipc::habit_create,
            ipc::habit_update,
            ipc::habit_delete,
            ipc::habit_log,
            ipc::habit_clear,
            ipc::habit_entries,
            ipc::habit_stats,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Nerva");
}

/// Build and attach the tray menu to the conf-declared tray icon.
///
/// Menu:
///   Show Nerva     — brings the main window forward (de-minimizes too).
///   New Timer      — opens (or focuses) the floating timer widget.
///   New Tasks      — opens (or focuses) the floating tasks widget.
///   New Habits     — opens (or focuses) the floating habits widget.
///   ───────────────────────────────────────────────────────
///   Quit Nerva     — cleanly shuts down the app.
///
/// Left-clicking the tray icon also brings the main window forward.
fn install_tray_menu(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};

    let show = MenuItemBuilder::with_id("tray_show", "Show Nerva").build(app)?;
    let new_timer = MenuItemBuilder::with_id("tray_new_timer", "New Timer").build(app)?;
    let new_tasks = MenuItemBuilder::with_id("tray_new_tasks", "New Tasks").build(app)?;
    let new_habits = MenuItemBuilder::with_id("tray_new_habits", "New Habits").build(app)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::with_id("tray_quit", "Quit Nerva").build(app)?;

    let menu = MenuBuilder::new(app)
        .items(&[&show, &new_timer, &new_tasks, &new_habits, &sep, &quit])
        .build()?;

    // The icon is declared in tauri.conf.json; Tauri assigns it the default
    // id "main". Look it up and attach the menu we just built.
    let Some(tray) = app.tray_by_id("main") else {
        tracing::warn!(
            "tray icon 'main' not found (declared in tauri.conf.json?) — skipping menu wire-up"
        );
        return Ok(());
    };

    tray.set_menu(Some(menu))?;
    tray.set_show_menu_on_left_click(false)?;

    tray.on_menu_event(move |app, event| match event.id().as_ref() {
        "tray_show" => focus_main(app),
        "tray_new_timer" => {
            let _ = ipc::open_timer_widget(app.clone());
        }
        "tray_new_tasks" => {
            let _ = ipc::open_tasks_widget(app.clone());
        }
        "tray_new_habits" => {
            let _ = ipc::open_habits_widget(app.clone());
        }
        "tray_quit" => app.exit(0),
        _ => {}
    });

    tray.on_tray_icon_event(|tray, event| {
        if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        } = event
        {
            focus_main(tray.app_handle());
        }
    });

    Ok(())
}

fn focus_main(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

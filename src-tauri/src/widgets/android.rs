use super::{execute, WidgetCommand};
use crate::error::{NervaError, Result};
use crate::state::AppState;
use jni::objects::{JClass, JString};
use jni::sys::jstring;
use jni::JNIEnv;
use parking_lot::Mutex;
use serde_json::json;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{Emitter, Manager};

static STATE: Mutex<Option<Arc<AppState>>> = Mutex::new(None);
static COMMAND_LOCK: Mutex<()> = Mutex::new(());
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

struct WidgetPlugin(PluginHandle<tauri::Wry>);

pub fn init() -> TauriPlugin<tauri::Wry> {
    Builder::new("nerva-widgets")
        .setup(|app, api| {
            let handle =
                api.register_android_plugin("ai.bytical.nerva.widgets", "WidgetsPlugin")?;
            app.manage(WidgetPlugin(handle));
            Ok(())
        })
        .build()
}

pub fn call(
    app: &tauri::AppHandle,
    action: &str,
    kind: Option<String>,
) -> Result<serde_json::Value> {
    if !matches!(action, "refresh" | "status" | "pin" | "alarmSettings") {
        return Err(NervaError::Invalid("unknown widget operation".into()));
    }
    app.state::<WidgetPlugin>()
        .0
        .run_mobile_plugin(
            action,
            json!({ "kind": kind.unwrap_or_else(|| "focus".into()) }),
        )
        .map_err(|error| NervaError::Invalid(error.to_string()))
}

pub fn shared_state(directory: PathBuf) -> Result<Arc<AppState>> {
    std::fs::create_dir_all(&directory)?;
    let directory = directory.canonicalize()?;
    let mut cached = STATE.lock();
    if let Some(state) = cached.as_ref() {
        if state.data_dir != directory {
            return Err(NervaError::Invalid(
                "widget database directory mismatch".into(),
            ));
        }
        return Ok(state.clone());
    }
    let state = Arc::new(AppState::initialize_at(directory)?);
    *cached = Some(state.clone());
    Ok(state)
}

pub fn attach(app: tauri::AppHandle) {
    let _ = APP.set(app);
}

#[no_mangle]
pub extern "system" fn Java_ai_bytical_nerva_widgets_WidgetBridge_nativeExecute(
    mut environment: JNIEnv,
    _class: JClass,
    directory: JString,
    request: JString,
) -> jstring {
    let response = std::panic::catch_unwind(std::panic::AssertUnwindSafe(
        || -> Result<serde_json::Value> {
            let directory: String = environment
                .get_string(&directory)
                .map_err(|error| NervaError::Invalid(error.to_string()))?
                .into();
            let request: String = environment
                .get_string(&request)
                .map_err(|error| NervaError::Invalid(error.to_string()))?
                .into();
            let command: WidgetCommand = serde_json::from_str(&request)
                .map_err(|error| NervaError::Invalid(error.to_string()))?;
            let changes_state = !matches!(
                command,
                WidgetCommand::Snapshot { .. } | WidgetCommand::NoteRead { .. }
            );
            let note_save = matches!(command, WidgetCommand::NoteSave { .. });
            let _guard = COMMAND_LOCK.lock();
            let state = shared_state(directory.into())?;
            let result = execute(&state, command)?;
            if changes_state {
                if let Some(app) = APP.get() {
                    let _ = app.emit("widget:changed", ());
                    let _ = app.emit("habit:changed", ());
                    if note_save {
                        let _ = app.emit(
                            "note:saved",
                            json!({ "id": result["id"], "source": "android-widget" }),
                        );
                    }
                }
            }
            Ok(result)
        },
    ));
    let envelope = match response {
        Ok(Ok(data)) => json!({ "ok": true, "data": data }),
        Ok(Err(error)) => json!({ "ok": false, "error": error.to_string() }),
        Err(_) => json!({ "ok": false, "error": "Widget operation failed. Please retry." }),
    };
    environment
        .new_string(envelope.to_string())
        .map(|value| value.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

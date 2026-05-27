//! Focus / Do-Not-Disturb integration. Best-effort, OS-conditional.
//!
//! Linux (GNOME/KDE-via-gsettings): toggles `org.gnome.desktop.notifications
//! show-banners`. If gsettings is missing (e.g. non-GNOME shells) the call
//! returns Ok(false) — UI just shows the user that DND is not wired here.

use crate::error::{NervaError, Result};

/// Returns true if a backend was actually toggled.
pub fn set_dnd(enabled: bool) -> Result<bool> {
    #[cfg(target_os = "linux")]
    {
        // GNOME: `show-banners` = false means notifications won't pop banners.
        let show = if enabled { "false" } else { "true" };
        let out = std::process::Command::new("gsettings")
            .args(["set", "org.gnome.desktop.notifications", "show-banners", show])
            .output();
        match out {
            Ok(o) if o.status.success() => Ok(true),
            Ok(o) => {
                tracing::warn!(
                    stderr = %String::from_utf8_lossy(&o.stderr),
                    "gsettings dnd toggle failed"
                );
                Ok(false)
            }
            Err(e) => {
                tracing::warn!(error = %e, "gsettings not available");
                Ok(false)
            }
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = enabled;
        // macOS Focus / Windows Focus Assist will land in P6.
        Ok(false)
    }
}

/// Best-effort read of current DND state. None if unknown.
pub fn get_dnd() -> Result<Option<bool>> {
    #[cfg(target_os = "linux")]
    {
        let out = std::process::Command::new("gsettings")
            .args(["get", "org.gnome.desktop.notifications", "show-banners"])
            .output();
        match out {
            Ok(o) if o.status.success() => {
                let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
                // `true` means banners shown (DND off); `false` means DND on.
                Ok(Some(s == "false"))
            }
            _ => Ok(None),
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        Ok(None)
    }
}

#[allow(dead_code)]
fn _unused(_e: NervaError) {}

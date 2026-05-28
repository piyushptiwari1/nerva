//! GNOME / KDE-via-gsettings DND backend.

use crate::error::Result;

pub fn set_dnd(enabled: bool) -> Result<bool> {
    let show = if enabled { "false" } else { "true" };
    let out = std::process::Command::new("gsettings")
        .args([
            "set",
            "org.gnome.desktop.notifications",
            "show-banners",
            show,
        ])
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

pub fn get_dnd() -> Result<Option<bool>> {
    let out = std::process::Command::new("gsettings")
        .args(["get", "org.gnome.desktop.notifications", "show-banners"])
        .output();
    match out {
        Ok(o) if o.status.success() => {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            Ok(Some(s == "false"))
        }
        _ => Ok(None),
    }
}

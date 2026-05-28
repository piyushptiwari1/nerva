//! Focus / Do-Not-Disturb integration. Best-effort, OS-conditional.
//!
//! The actual backend lives in a per-OS module so each platform's surface
//! can grow without a `#[cfg]` thicket inside one file:
//!
//!   - linux.rs   — GNOME / KDE-via-gsettings (real)
//!   - macos.rs   — placeholder, ships as no-op until a Mac is available
//!   - windows.rs — placeholder, ships as no-op
//!
//! `set_dnd` returns `Ok(true)` when a backend was actually toggled, `Ok(false)`
//! when DND is not wired on the current platform. `get_dnd` returns `Some(bool)`
//! when the current state is known, `None` otherwise.

use crate::error::Result;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
use linux as backend;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
use macos as backend;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
use windows as backend;

// Fallback for unsupported OSes (BSD, etc.) — keep the crate compiling.
#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
mod fallback {
    use crate::error::Result;
    pub fn set_dnd(_enabled: bool) -> Result<bool> {
        Ok(false)
    }
    pub fn get_dnd() -> Result<Option<bool>> {
        Ok(None)
    }
}
#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
use fallback as backend;

pub fn set_dnd(enabled: bool) -> Result<bool> {
    backend::set_dnd(enabled)
}

pub fn get_dnd() -> Result<Option<bool>> {
    backend::get_dnd()
}

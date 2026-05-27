//! macOS DND placeholder.
//!
//! Real Focus-mode control on macOS is awkward: there is no public DND API
//! and AppleScript / osascript paths break across releases (Big Sur ↔
//! Ventura ↔ Sonoma each changed the surface). The most reliable route is
//! the user's own Shortcuts.app "Turn On Do Not Disturb" shortcut invoked
//! via `shortcuts run` — but that requires per-user setup.
//!
//! Rather than ship code that silently no-ops or worse, this returns
//! `(false, None)` and the UI shows "DND not wired on this platform" so
//! the user reaches for the system Focus toggle directly. A real impl
//! lands once we can test it on a Mac.

use crate::error::Result;

pub fn set_dnd(_enabled: bool) -> Result<bool> {
    Ok(false)
}

pub fn get_dnd() -> Result<Option<bool>> {
    Ok(None)
}

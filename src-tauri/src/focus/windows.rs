//! Windows Focus Assist placeholder.
//!
//! Focus Assist in Windows 10/11 is controlled via the undocumented
//! quiet-hours registry surface; programmatic toggling has been broken
//! more than once across feature updates. Ships as a no-op until a real
//! WinRT-based implementation is ready.

use crate::error::Result;

pub fn set_dnd(_enabled: bool) -> Result<bool> {
    Ok(false)
}

pub fn get_dnd() -> Result<Option<bool>> {
    Ok(None)
}

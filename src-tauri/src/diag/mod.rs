//! Local-only crash diagnostics.
//!
//! Installs a [`std::panic::set_hook`] that captures the panic message,
//! location, and a best-effort backtrace into `$XDG_DATA_HOME/nerva/crashes/`
//! (or the platform equivalent via the `dirs` crate). The next launch can
//! surface these files through the Settings → Diagnostics tab.
//!
//! Strictly local — no network egress. Files are never auto-uploaded.

use crate::error::{NervaError, Result};
use std::backtrace::Backtrace;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

static CRASH_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Computes the crash directory under the user's data dir. Idempotent.
pub fn crash_dir() -> PathBuf {
    CRASH_DIR
        .get_or_init(|| {
            let base = dirs::data_local_dir()
                .or_else(dirs::data_dir)
                .unwrap_or_else(|| PathBuf::from("."));
            let dir = base.join("nerva").join("crashes");
            let _ = fs::create_dir_all(&dir);
            dir
        })
        .clone()
}

/// Install the panic hook. Safe to call multiple times — only the first call
/// has effect.
pub fn install_panic_hook() {
    static INSTALLED: OnceLock<()> = OnceLock::new();
    if INSTALLED.set(()).is_err() {
        return;
    }
    // Preserve the default hook so panics still log to stderr in dev.
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let _ = write_panic(info);
        prev(info);
    }));
}

fn write_panic(info: &std::panic::PanicHookInfo<'_>) -> Result<()> {
    let dir = crash_dir();
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = dir.join(format!("{ts}.log"));
    let mut f = fs::File::create(&path)?;
    writeln!(f, "ts_ms: {ts}")?;
    if let Some(loc) = info.location() {
        writeln!(f, "where: {}:{}:{}", loc.file(), loc.line(), loc.column())?;
    }
    // PanicHookInfo::payload() can be &str or String; Display via the info itself.
    writeln!(f, "what: {info}")?;
    writeln!(f, "---")?;
    let bt = Backtrace::force_capture();
    writeln!(f, "{bt}")?;
    Ok(())
}

/// One row returned to the frontend list view.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CrashEntry {
    pub name: String,
    pub ts_ms: i64,
    pub size_bytes: u64,
    pub snippet: String,
}

/// List crash logs, newest first. Bounded — most users never have any.
pub fn list_crashes() -> Result<Vec<CrashEntry>> {
    let dir = crash_dir();
    let mut out = Vec::new();
    let read = match fs::read_dir(&dir) {
        Ok(r) => r,
        Err(_) => return Ok(out),
    };
    for entry in read.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.ends_with(".log") {
            continue;
        }
        let ts_ms: i64 = name.trim_end_matches(".log").parse().unwrap_or(0);
        let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
        // Read up to 240 bytes for a one-line preview.
        let snippet = fs::read_to_string(entry.path())
            .ok()
            .map(|s| {
                let line = s.lines().find(|l| l.starts_with("what:")).unwrap_or("");
                line.chars().take(240).collect::<String>()
            })
            .unwrap_or_default();
        out.push(CrashEntry {
            name,
            ts_ms,
            size_bytes,
            snippet,
        });
    }
    out.sort_by_key(|x| std::cmp::Reverse(x.ts_ms));
    Ok(out)
}

/// Read the full body of one crash log. Hardened against path traversal:
/// only accepts a bare basename ending in `.log` with no separators.
pub fn read_crash(name: &str) -> Result<String> {
    let safe = sanitize_name(name).ok_or_else(|| {
        NervaError::Invalid("crash name must be <ts>.log with no path separators".into())
    })?;
    let path = crash_dir().join(safe);
    Ok(fs::read_to_string(path)?)
}

/// Delete every crash log. Returns the count removed.
pub fn clear_crashes() -> Result<usize> {
    let dir = crash_dir();
    let mut n = 0;
    let read = match fs::read_dir(&dir) {
        Ok(r) => r,
        Err(_) => return Ok(0),
    };
    for entry in read.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.ends_with(".log") {
            continue;
        }
        if fs::remove_file(entry.path()).is_ok() {
            n += 1;
        }
    }
    Ok(n)
}

fn sanitize_name(name: &str) -> Option<&str> {
    if name.is_empty() || name.len() > 64 {
        return None;
    }
    if !name.ends_with(".log") {
        return None;
    }
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return None;
    }
    // Stem must be all digits (timestamp).
    let stem = &name[..name.len() - 4];
    if !stem.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    // Ensure resolved path stays inside crash_dir.
    let candidate = crash_dir().join(name);
    let parent = crash_dir();
    if !path_starts_with(&candidate, &parent) {
        return None;
    }
    Some(name)
}

fn path_starts_with(child: &Path, parent: &Path) -> bool {
    let cp = fs::canonicalize(child).ok();
    let pp = fs::canonicalize(parent).ok();
    match (cp, pp) {
        (Some(c), Some(p)) => c.starts_with(p),
        // If canonicalize fails (e.g. file does not yet exist), fall back to
        // a string-prefix check on the unresolved join. The basename rules
        // above already disallow traversal.
        _ => child.starts_with(parent),
    }
}

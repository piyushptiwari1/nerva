//! Local backup: export the live database to a single `.nerva.db` file and
//! restore from one. Free for everyone; Drive sync (Pro) will reuse this.
//!
//! Export uses SQLite's online backup API, so it is consistent even while
//! WAL has uncheckpointed pages. Import validates the candidate (it must be
//! a SQLite file containing Nerva's `events` table) and keeps the current
//! database as a dated copy before swapping; the app restarts afterwards
//! because the in-memory projections and pool belong to the old file.

use crate::error::{NervaError, Result};
use rusqlite::{backup::Backup, Connection, OpenFlags};
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const EXTENSION: &str = "nerva.db";

#[derive(Debug, serde::Serialize)]
pub struct BackupInfo {
    pub path: String,
    pub bytes: u64,
    pub events: i64,
    pub notes: i64,
}

fn stamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    chrono::DateTime::from_timestamp(secs, 0)
        .map(|t| t.format("%Y-%m-%d_%H%M%SZ").to_string())
        .unwrap_or_else(|| secs.to_string())
}

pub fn default_filename() -> String {
    format!("nerva-backup-{}.{}", stamp(), EXTENSION)
}

/// Copy the live database at `source` into `destination` atomically.
pub fn export(source: &Path, destination: &Path) -> Result<BackupInfo> {
    if destination == source {
        return Err(NervaError::Invalid(
            "Choose a location outside Nerva's data folder".into(),
        ));
    }
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let temporary = destination.with_extension("tmp");
    let _ = std::fs::remove_file(&temporary);
    {
        let from = Connection::open_with_flags(source, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let mut to = Connection::open(&temporary)?;
        {
            let backup = Backup::new(&from, &mut to)?;
            backup.run_to_completion(256, Duration::from_millis(5), None)?;
        }
        // Plain journal so the exported file is a single self-contained file.
        to.pragma_update(None, "journal_mode", "DELETE")?;
    }
    std::fs::rename(&temporary, destination)?;
    let info = inspect(destination)?;
    Ok(info)
}

/// Validate that `candidate` is a Nerva database and report its contents.
pub fn inspect(candidate: &Path) -> Result<BackupInfo> {
    let bytes = std::fs::metadata(candidate)?.len();
    let header = {
        let mut buffer = [0u8; 16];
        use std::io::Read;
        let mut file = std::fs::File::open(candidate)?;
        let read = file.read(&mut buffer)?;
        buffer[..read].to_vec()
    };
    if !header.starts_with(b"SQLite format 3\0") {
        return Err(NervaError::Invalid(
            "This file is not a Nerva backup (not a SQLite database)".into(),
        ));
    }
    let connection = Connection::open_with_flags(candidate, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let has_events: i64 = connection.query_row(
        "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'events'",
        [],
        |row| row.get(0),
    )?;
    if has_events == 0 {
        return Err(NervaError::Invalid(
            "This SQLite file has no Nerva event log".into(),
        ));
    }
    let events: i64 = connection.query_row("SELECT count(*) FROM events", [], |row| row.get(0))?;
    let notes: i64 = connection
        .query_row("SELECT count(*) FROM notes", [], |row| row.get(0))
        .unwrap_or(0);
    Ok(BackupInfo {
        path: candidate.display().to_string(),
        bytes,
        events,
        notes,
    })
}

/// Replace the live database files with `candidate`. The previous database
/// is moved to `backup-before-restore-<stamp>/` inside the data directory.
/// Caller must restart the app afterwards.
pub fn restore(data_dir: &Path, candidate: &Path) -> Result<PathBuf> {
    inspect(candidate)?;
    let keep = data_dir.join(format!("backup-before-restore-{}", stamp()));
    std::fs::create_dir_all(&keep)?;
    for name in ["nerva.db", "nerva.db-wal", "nerva.db-shm"] {
        let from = data_dir.join(name);
        if from.exists() {
            std::fs::rename(&from, keep.join(name))?;
        }
    }
    let target = data_dir.join("nerva.db");
    // Copy (not rename): the candidate may live on another filesystem and
    // the user keeps their backup file untouched.
    std::fs::copy(candidate, &target)?;
    Ok(keep)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;

    #[test]
    fn export_then_restore_round_trips_content() {
        let data = tempfile::tempdir().unwrap();
        let out = tempfile::tempdir().unwrap();
        let state = AppState::initialize_at(data.path().into()).unwrap();
        let workspace = state.workspaces.lock().active().unwrap().id.clone();
        crate::ipc::note_save_for(
            &state,
            crate::ipc::SaveNoteArgs {
                id: None,
                title: "Keep".into(),
                body: "Restore me".into(),
                workspace_id: Some(workspace),
            },
        )
        .unwrap();
        let file = out.path().join(default_filename());
        let info = export(&data.path().join("nerva.db"), &file).unwrap();
        assert!(info.events >= 2 && info.notes == 1 && info.bytes > 0);
        drop(state);

        let fresh = tempfile::tempdir().unwrap();
        let empty = AppState::initialize_at(fresh.path().into()).unwrap();
        assert!(empty.notes.lock().list().is_empty());
        drop(empty);
        let kept = restore(fresh.path(), &file).unwrap();
        assert!(kept.join("nerva.db").exists());
        let restored = AppState::initialize_at(fresh.path().into()).unwrap();
        let notes = restored.notes.lock().list();
        assert_eq!(notes.len(), 1);
        let row = restored.store.note_get(&notes[0].id).unwrap().unwrap();
        assert_eq!(row.2, "Restore me");
    }

    #[test]
    fn restore_rejects_non_nerva_files_without_touching_data() {
        let data = tempfile::tempdir().unwrap();
        let state = AppState::initialize_at(data.path().into()).unwrap();
        drop(state);
        let bogus = data.path().join("bogus.nerva.db");
        std::fs::write(&bogus, b"definitely not sqlite").unwrap();
        assert!(restore(data.path(), &bogus).is_err());
        let plain = Connection::open(data.path().join("plain.db")).unwrap();
        plain.execute_batch("CREATE TABLE unrelated(x)").unwrap();
        drop(plain);
        assert!(restore(data.path(), &data.path().join("plain.db")).is_err());
        assert!(data.path().join("nerva.db").exists());
        assert!(!std::fs::read_dir(data.path()).unwrap().any(|e| e
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("backup-before-restore")));
    }
}

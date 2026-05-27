//! Event-sourced SQLite store.
//!
//! Schema: append-only `events` log + lightweight `snapshots` for fast warm-start.
//! All mutations are events. Projections (timers/notes/workspaces) live in RAM
//! and are reconstructed by replaying the log on startup.

use crate::error::{NervaError, Result};
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::path::Path;

pub type DbPool = Pool<SqliteConnectionManager>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredEvent {
    pub id: i64,
    pub ts_ms: i64,
    pub kind: String,
    pub payload: serde_json::Value,
}

pub struct Store {
    pool: DbPool,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        let manager = SqliteConnectionManager::file(path).with_init(|c| {
            c.pragma_update(None, "journal_mode", "WAL")?;
            c.pragma_update(None, "synchronous", "NORMAL")?;
            c.pragma_update(None, "foreign_keys", "ON")?;
            c.pragma_update(None, "busy_timeout", 5000_i32)?;
            Ok(())
        });
        let pool = Pool::builder()
            .max_size(8)
            .build(manager)
            .map_err(|e| NervaError::Storage(format!("pool build: {e}")))?;
        Ok(Self { pool })
    }

    pub fn migrate(&self) -> Result<()> {
        let conn = self.pool.get()?;
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS events (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                ts_ms     INTEGER NOT NULL,
                kind      TEXT    NOT NULL,
                payload   TEXT    NOT NULL
            );
            CREATE INDEX IF NOT EXISTS events_kind_idx ON events(kind);
            CREATE INDEX IF NOT EXISTS events_ts_idx   ON events(ts_ms);

            CREATE TABLE IF NOT EXISTS snapshots (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                ts_ms       INTEGER NOT NULL,
                up_to_event INTEGER NOT NULL,
                kind        TEXT    NOT NULL,
                blob        TEXT    NOT NULL
            );

            CREATE TABLE IF NOT EXISTS notes (
                id          TEXT PRIMARY KEY,
                workspace_id TEXT,
                title       TEXT NOT NULL DEFAULT '',
                body        TEXT NOT NULL DEFAULT '',
                updated_ms  INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS meta (
                k TEXT PRIMARY KEY,
                v TEXT NOT NULL
            );
            "#,
        )?;
        Ok(())
    }

    /// Append an event with current wall-clock timestamp.
    pub fn append_event(&self, kind: &str, payload: &serde_json::Value) -> Result<i64> {
        let conn = self.pool.get()?;
        let ts = now_ms();
        conn.execute(
            "INSERT INTO events (ts_ms, kind, payload) VALUES (?1, ?2, ?3)",
            params![ts, kind, payload.to_string()],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn replay_all(&self) -> Result<Vec<StoredEvent>> {
        let conn = self.pool.get()?;
        let mut stmt =
            conn.prepare("SELECT id, ts_ms, kind, payload FROM events ORDER BY id ASC")?;
        let rows = stmt.query_map([], |r| {
            let payload_text: String = r.get(3)?;
            Ok(StoredEvent {
                id: r.get(0)?,
                ts_ms: r.get(1)?,
                kind: r.get(2)?,
                payload: serde_json::from_str(&payload_text).unwrap_or(serde_json::Value::Null),
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn recent_events(&self, limit: i64) -> Result<Vec<StoredEvent>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, ts_ms, kind, payload FROM events ORDER BY id DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], |r| {
            let payload_text: String = r.get(3)?;
            Ok(StoredEvent {
                id: r.get(0)?,
                ts_ms: r.get(1)?,
                kind: r.get(2)?,
                payload: serde_json::from_str(&payload_text).unwrap_or(serde_json::Value::Null),
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        out.reverse();
        Ok(out)
    }

    /// Upsert note body. We persist notes directly in addition to events so we
    /// can survive log truncation/compaction and offer fast reads.
    pub fn note_upsert(
        &self,
        id: &str,
        workspace_id: Option<&str>,
        title: &str,
        body: &str,
    ) -> Result<()> {
        let conn = self.pool.get()?;
        let ts = now_ms();
        conn.execute(
            "INSERT INTO notes (id, workspace_id, title, body, updated_ms) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET workspace_id=excluded.workspace_id,
                                           title=excluded.title,
                                           body=excluded.body,
                                           updated_ms=excluded.updated_ms",
            params![id, workspace_id, title, body, ts],
        )?;
        Ok(())
    }

    pub fn note_get(&self, id: &str) -> Result<Option<(String, String, String, i64)>> {
        let conn = self.pool.get()?;
        let mut stmt = conn
            .prepare("SELECT workspace_id, title, body, updated_ms FROM notes WHERE id = ?1")?;
        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            let ws: Option<String> = row.get(0)?;
            let title: String = row.get(1)?;
            let body: String = row.get(2)?;
            let ts: i64 = row.get(3)?;
            Ok(Some((ws.unwrap_or_default(), title, body, ts)))
        } else {
            Ok(None)
        }
    }

    pub fn note_list(&self) -> Result<Vec<(String, String, String, i64)>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, workspace_id, title, updated_ms FROM notes ORDER BY updated_ms DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            let id: String = r.get(0)?;
            let ws: Option<String> = r.get(1)?;
            let title: String = r.get(2)?;
            let ts: i64 = r.get(3)?;
            Ok((id, ws.unwrap_or_default(), title, ts))
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }
}

pub fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

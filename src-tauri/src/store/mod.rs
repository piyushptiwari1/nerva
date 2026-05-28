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

/// One FTS hit row: `(note_id, workspace_id, title, snippet_html, bm25_rank)`.
/// Pulled out into a type alias so `note_search`'s signature stops tripping
/// clippy's `type_complexity` lint.
pub type NoteSearchHit = (String, String, String, String, f64);

/// One stored embedding row from `embeddings_all`:
/// `(note_id, note_title, workspace_id, vector)`. Type alias for the same
/// `type_complexity` reason as `NoteSearchHit`.
pub type NoteEmbeddingRow = (String, String, Option<String>, Vec<f32>);

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

            -- FTS5 virtual table over notes (content-less; we sync manually via triggers).
            CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
                id UNINDEXED,
                workspace_id UNINDEXED,
                title,
                body,
                tokenize = 'porter unicode61'
            );

            CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
                INSERT INTO notes_fts(id, workspace_id, title, body)
                VALUES (new.id, new.workspace_id, new.title, new.body);
            END;
            CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
                DELETE FROM notes_fts WHERE id = old.id;
            END;
            CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
                DELETE FROM notes_fts WHERE id = old.id;
                INSERT INTO notes_fts(id, workspace_id, title, body)
                VALUES (new.id, new.workspace_id, new.title, new.body);
            END;

            -- Per-note embedding cache for semantic search. `vec` is a raw
            -- little-endian f32 sequence; len = vec.length / 4 floats. `model`
            -- lets us invalidate stale embeddings if the user switches embed
            -- models (we treat dim-mismatched rows as stale on read).
            CREATE TABLE IF NOT EXISTS note_embeddings (
                note_id TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
                model   TEXT NOT NULL,
                dim     INTEGER NOT NULL,
                vec     BLOB NOT NULL,
                ts_ms   INTEGER NOT NULL
            );
            "#,
        )?;
        // Backfill FTS if it's empty but notes exist (first migration after upgrade).
        let conn = self.pool.get()?;
        let fts_count: i64 = conn.query_row("SELECT count(*) FROM notes_fts", [], |r| r.get(0))?;
        let notes_count: i64 = conn.query_row("SELECT count(*) FROM notes", [], |r| r.get(0))?;
        if fts_count == 0 && notes_count > 0 {
            conn.execute(
                "INSERT INTO notes_fts(id, workspace_id, title, body)
                 SELECT id, workspace_id, title, body FROM notes",
                [],
            )?;
        }
        Ok(())
    }

    pub fn meta_set(&self, k: &str, v: &str) -> Result<()> {
        let conn = self.pool.get()?;
        conn.execute(
            "INSERT INTO meta (k, v) VALUES (?1, ?2)
             ON CONFLICT(k) DO UPDATE SET v = excluded.v",
            params![k, v],
        )?;
        Ok(())
    }

    pub fn meta_get(&self, k: &str) -> Result<Option<String>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare("SELECT v FROM meta WHERE k = ?1")?;
        let mut rows = stmt.query(params![k])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    /// Full-text search across notes. Returns (id, workspace_id, title, snippet, rank).
    pub fn note_search(&self, query: &str, limit: i64) -> Result<Vec<NoteSearchHit>> {
        let conn = self.pool.get()?;
        // snippet(table, col_index, before, after, ellipsis, max_tokens)
        let mut stmt = conn.prepare(
            "SELECT id, COALESCE(workspace_id, ''), title,
                    snippet(notes_fts, 3, '<mark>', '</mark>', '…', 12) AS snip,
                    bm25(notes_fts) AS rank
             FROM notes_fts
             WHERE notes_fts MATCH ?1
             ORDER BY rank
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![query, limit], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, f64>(4)?,
            ))
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
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
        let mut stmt =
            conn.prepare("SELECT id, ts_ms, kind, payload FROM events ORDER BY id DESC LIMIT ?1")?;
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
        let mut stmt =
            conn.prepare("SELECT workspace_id, title, body, updated_ms FROM notes WHERE id = ?1")?;
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

    // ---------- embeddings (semantic search cache) ----------

    /// Upsert a note embedding. We serialise the f32 vector as a little-endian
    /// byte sequence — same layout f32::from_le_bytes expects on read, so it
    /// roundtrips identically across architectures.
    pub fn embedding_upsert(&self, note_id: &str, model: &str, vec: &[f32]) -> Result<()> {
        let conn = self.pool.get()?;
        let mut bytes = Vec::with_capacity(vec.len() * 4);
        for f in vec {
            bytes.extend_from_slice(&f.to_le_bytes());
        }
        let ts = now_ms();
        conn.execute(
            "INSERT INTO note_embeddings (note_id, model, dim, vec, ts_ms)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(note_id) DO UPDATE SET model=excluded.model,
                                                dim=excluded.dim,
                                                vec=excluded.vec,
                                                ts_ms=excluded.ts_ms",
            params![note_id, model, vec.len() as i64, bytes, ts],
        )?;
        Ok(())
    }

    /// Stream every stored note embedding alongside its title for semantic
    /// search. `expected_dim` filters out stale rows from a previous model
    /// (rather than mass-deleting them — the next `note.saved` will rebuild
    /// them naturally).
    pub fn embeddings_all(&self, expected_dim: usize) -> Result<Vec<NoteEmbeddingRow>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT e.note_id, n.title, n.workspace_id, e.dim, e.vec
             FROM note_embeddings e
             JOIN notes n ON n.id = e.note_id",
        )?;
        let rows = stmt.query_map([], |r| {
            let id: String = r.get(0)?;
            let title: String = r.get(1)?;
            let ws: Option<String> = r.get(2)?;
            let dim: i64 = r.get(3)?;
            let bytes: Vec<u8> = r.get(4)?;
            Ok((id, title, ws, dim as usize, bytes))
        })?;
        let mut out = Vec::new();
        for r in rows {
            let (id, title, ws, dim, bytes) = r?;
            if dim != expected_dim || bytes.len() != dim * 4 {
                continue; // stale row; ignore until rewritten
            }
            let mut v = Vec::with_capacity(dim);
            for chunk in bytes.chunks_exact(4) {
                let arr = [chunk[0], chunk[1], chunk[2], chunk[3]];
                v.push(f32::from_le_bytes(arr));
            }
            out.push((id, title, ws, v));
        }
        Ok(out)
    }

    /// IDs of every note that does NOT currently have an embedding. Used by
    /// the boot-time backfill so existing notes get indexed without forcing
    /// the user to re-save each one.
    pub fn notes_missing_embeddings(&self) -> Result<Vec<(String, String, String)>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT n.id, n.title, n.body
             FROM notes n
             LEFT JOIN note_embeddings e ON e.note_id = n.id
             WHERE e.note_id IS NULL",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
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

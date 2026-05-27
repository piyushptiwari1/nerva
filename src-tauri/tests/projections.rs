//! Integration tests covering the event-sourced projections end-to-end:
//!
//!   1. tasks   — create/toggle/rename/reorder/delete round-trips a fresh
//!      replay back to the same in-memory state
//!   2. timers  — create/start/pause/resume produce the expected status
//!   3. store   — SQLite migrations, append+replay, FTS5 note search,
//!      meta key/value
//!   4. embeddings — upsert + dim-mismatch filtering
//!
//! These exercise pure logic without booting Tauri, so they run under a
//! plain `cargo test` and protect future refactors of the projections.

use nerva_lib::store::{Store, StoredEvent};
use nerva_lib::tasks::{TaskStatus, TasksProjection};
use nerva_lib::timers::{TimerEngine, TimerStatus};
use serde_json::json;
use tempfile::TempDir;

fn tmp_store() -> (TempDir, Store) {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("nerva-test.db");
    let store = Store::open(&path).expect("open store");
    store.migrate().expect("migrate");
    (dir, store)
}

fn replay_into_tasks(store: &Store) -> TasksProjection {
    let mut p = TasksProjection::new();
    for ev in store.replay_all().expect("replay") {
        p.apply(&ev);
    }
    p
}

fn replay_into_timers(store: &Store) -> TimerEngine {
    let mut e = TimerEngine::new();
    for ev in store.replay_all().expect("replay") {
        e.apply(&ev);
    }
    e
}

#[test]
fn tasks_round_trip_through_replay() {
    let (_g, store) = tmp_store();

    // create three open tasks in workspace "w1"
    for (id, title) in [("t1", "alpha"), ("t2", "beta"), ("t3", "gamma")] {
        store
            .append_event(
                "task.created",
                &json!({ "id": id, "title": title, "workspace_id": "w1" }),
            )
            .expect("append");
    }
    // complete one, rename one
    store
        .append_event("task.completed", &json!({ "id": "t2" }))
        .expect("append");
    store
        .append_event("task.renamed", &json!({ "id": "t1", "title": "ALPHA" }))
        .expect("append");
    // pin order: t3 first, then t1
    store
        .append_event(
            "task.reordered",
            &json!({ "workspace_id": "w1", "ordered_ids": ["t3", "t1"] }),
        )
        .expect("append");

    let proj = replay_into_tasks(&store);
    let all = proj.list();

    // 3 items survive; t2 is done; ordering on open tasks matches the order vec
    assert_eq!(all.len(), 3);
    let titles: Vec<&str> = all.iter().map(|t| t.title.as_str()).collect();
    // Open tasks first (ordered), then done tasks
    assert_eq!(titles[0], "gamma");
    assert_eq!(titles[1], "ALPHA");
    let t2 = all.iter().find(|t| t.id == "t2").unwrap();
    assert_eq!(t2.status, TaskStatus::Done);
    assert!(t2.completed_ms.is_some());
}

#[test]
fn tasks_delete_clears_from_order_vector() {
    let (_g, store) = tmp_store();
    store
        .append_event(
            "task.created",
            &json!({ "id": "a", "title": "A", "workspace_id": "w" }),
        )
        .unwrap();
    store
        .append_event(
            "task.reordered",
            &json!({ "workspace_id": "w", "ordered_ids": ["a"] }),
        )
        .unwrap();
    store
        .append_event("task.deleted", &json!({ "id": "a" }))
        .unwrap();

    let proj = replay_into_tasks(&store);
    assert!(proj.list().is_empty(), "deleted task must not surface");
}

#[test]
fn timer_status_progresses_through_lifecycle() {
    let (_g, store) = tmp_store();
    store
        .append_event(
            "timer.created",
            &json!({
                "id": "T",
                "name": "Focus",
                "color": "#7c9cff",
                "duration_ms": 25 * 60 * 1000_i64,
                "workspace_id": "w",
            }),
        )
        .unwrap();
    store
        .append_event("timer.started", &json!({ "id": "T" }))
        .unwrap();
    store
        .append_event("timer.paused", &json!({ "id": "T" }))
        .unwrap();
    store
        .append_event("timer.resumed", &json!({ "id": "T" }))
        .unwrap();

    let engine = replay_into_timers(&store);
    let t = engine.get("T").expect("timer exists");
    assert_eq!(t.status, TimerStatus::Running);
    assert_eq!(t.duration_ms, 25 * 60 * 1000);
    assert!(t.started_at_ms.is_some());
}

#[test]
fn timer_deleted_is_gone() {
    let (_g, store) = tmp_store();
    store
        .append_event(
            "timer.created",
            &json!({
                "id": "X",
                "name": "x",
                "color": "#fff",
                "duration_ms": 60_000_i64,
                "workspace_id": null,
            }),
        )
        .unwrap();
    store
        .append_event("timer.deleted", &json!({ "id": "X" }))
        .unwrap();
    let engine = replay_into_timers(&store);
    assert!(engine.get("X").is_none());
}

#[test]
fn notes_fts_round_trip() {
    let (_g, store) = tmp_store();
    store
        .note_upsert("n1", Some("w"), "Pinned thoughts", "The quick brown fox jumps over.")
        .unwrap();
    store
        .note_upsert("n2", Some("w"), "Recipe ideas", "Slow-cooked beans with smoked paprika.")
        .unwrap();

    let hits = store.note_search("smoked paprika", 10).unwrap();
    assert!(
        hits.iter().any(|(id, _, _, _, _)| id == "n2"),
        "FTS5 search must find the paprika note"
    );
    let none = store.note_search("zzzunlikely", 10).unwrap();
    assert!(none.is_empty());

    // Deletion via the events table is not tested here; the note_upsert/
    // note_search pair is what crosses the rusqlite + FTS5 trigger surface.
}

#[test]
fn meta_set_and_get_survive_roundtrip() {
    let (_g, store) = tmp_store();
    assert!(store.meta_get("missing").unwrap().is_none());
    store.meta_set("audio.ambient_volume", "0.42").unwrap();
    assert_eq!(
        store.meta_get("audio.ambient_volume").unwrap().as_deref(),
        Some("0.42")
    );
    // Overwrite is upsert, not append.
    store.meta_set("audio.ambient_volume", "0.8").unwrap();
    assert_eq!(
        store.meta_get("audio.ambient_volume").unwrap().as_deref(),
        Some("0.8")
    );
}

#[test]
fn replay_all_preserves_event_order() {
    let (_g, store) = tmp_store();
    for i in 0..5 {
        store
            .append_event("task.created", &json!({ "id": format!("id{i}"), "title": "t" }))
            .unwrap();
    }
    let evs: Vec<StoredEvent> = store.replay_all().unwrap();
    assert_eq!(evs.len(), 5);
    for w in evs.windows(2) {
        assert!(w[0].id < w[1].id, "events must come out in insertion order");
    }
}

#[test]
fn embeddings_upsert_and_dim_filter() {
    let (_g, store) = tmp_store();
    store
        .note_upsert("n1", Some("w"), "title", "body")
        .unwrap();
    let v768: Vec<f32> = (0..768).map(|i| i as f32 * 0.001).collect();
    store
        .embedding_upsert("n1", "test-model", &v768)
        .expect("upsert");

    // Correct dim — should come back.
    let rows = store.embeddings_all(768).expect("read 768");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].0, "n1");
    assert_eq!(rows[0].3.len(), 768);

    // Mismatched dim — silently filtered.
    let rows = store.embeddings_all(1536).expect("read 1536");
    assert!(rows.is_empty(), "dim-mismatched rows must be skipped");
}

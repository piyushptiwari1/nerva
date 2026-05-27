# Nerva — Architecture

## High-level

```
┌──────────────────────────────────────────────────────────────────┐
│ Frontend (Tauri webview)                                          │
│   React 18 · TypeScript · Tailwind · Framer Motion · zustand     │
│                                                                   │
│   src/                                                            │
│   ├── components/   Sidebar · TimerStage · NotesPanel · …         │
│   ├── lib/ipc.ts    typed wrappers over @tauri-apps/api/core      │
│   └── store/app.ts  zustand store, bootstraps via IPC             │
└────────────────────────────┬──────────────────────────────────────┘
                              │ IPC (tauri commands + events)
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│ Backend (Rust)                                                    │
│                                                                   │
│   src-tauri/src/                                                  │
│   ├── lib.rs        runtime entry, plugin wiring                  │
│   ├── state.rs      AppState — store + projections (Arc<Mutex>>)  │
│   ├── store/        event-sourced SQLite (WAL, r2d2 pool)         │
│   ├── timers/       wall-clock multi-timer engine                 │
│   ├── notes/        notes projection + body table                 │
│   ├── workspaces/   workspace projection + active pointer         │
│   ├── ipc/          #[tauri::command] surface                     │
│   └── error.rs      NervaError → serialised to frontend           │
└────────────────────────────┬──────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│ Persistence                                                       │
│   $XDG_DATA_HOME/dev.nerva.app/nerva.db                           │
│   Tables: events (append-only), snapshots, notes, meta            │
│   PRAGMAs: journal_mode=WAL, synchronous=NORMAL                   │
└──────────────────────────────────────────────────────────────────┘
```

## Event sourcing

Every mutation is an event appended to `events`.

| Kind                  | Payload (JSON)                                              |
|-----------------------|-------------------------------------------------------------|
| `timer.created`       | `{ id, name, duration_ms, color, workspace_id }`            |
| `timer.started`       | `{ id }`                                                    |
| `timer.paused`        | `{ id }`                                                    |
| `timer.resumed`       | `{ id }`                                                    |
| `timer.reset`         | `{ id }`                                                    |
| `timer.deleted`       | `{ id }`                                                    |
| `timer.completed`     | `{ id }`                                                    |
| `note.saved`          | `{ id, title, workspace_id, len }`                          |
| `note.deleted`        | `{ id }`                                                    |
| `workspace.created`   | `{ id, name, color }`                                       |
| `workspace.activated` | `{ id }`                                                    |
| `workspace.deleted`   | `{ id }`                                                    |

On launch, `AppState::initialize` calls `store.replay_all()` and
fans events into each projection's `apply()`. After that, IPC
mutations follow the strict order:

1. Build payload.
2. `store.append_event(kind, &payload)` — durable, fsynced.
3. Construct an in-memory `StoredEvent`.
4. `projection.apply(&ev)` — never fails.
5. Return the resulting domain object.

The store is **always** ahead of (or equal to) the projection.

## Wall-clock timer math

`Timer` stores `started_at_ms`, `paused_total_ms`, `paused_at_ms`,
`duration_ms`, `status`. Remaining time is a **pure function** of
those plus `now_ms()`:

```text
elapsed = (status, started, paused_at) match:
  Running        -> now - started - paused_total
  Paused         -> paused_at - started - paused_total
  _              -> 0
remaining = max(0, duration - max(0, elapsed))
```

No tick persistence; the UI calls `timer_tick` ~4 Hz purely for
recomputation + completion edge detection. A timer that was running
when the laptop slept correctly reflects "sleep duration was elapsed"
when the OS wakes — which is the user's intuition.

## Crash recovery

1. systemd `--user` unit with `Restart=on-failure` brings the daemon
   back.
2. Backend opens the DB (WAL means in-flight writes from before the
   crash are replayed by SQLite itself).
3. `replay_all()` rebuilds the in-memory world.
4. Frontend reconnects via Tauri's normal handshake; React calls
   `bootstrap()` to repopulate the UI.

There is **no separate snapshot/save step** — the event log is the
truth, and projection memory is disposable.

## Concurrency

- `AppState` is `Arc<…>`; projections are wrapped in
  `parking_lot::Mutex`.
- IPC handlers hold a projection lock for the *minimum* span
  (lock → mutate → unlock; do `append_event` *before* taking the lock
  where possible to avoid awaiting fsync under the lock).
- Tokio runtime is available (Tauri ships one) for future async work;
  current commands are synchronous because the DB writes are <1ms on
  WAL.

## Frontend state

- zustand `useApp` store mirrors backend state.
- A 250ms interval calls `timer_tick`, the cheapest read in the system.
- All mutations are awaited and re-bootstrap the relevant slice.

## Security

- CSP is locked down in `tauri.conf.json` — no remote scripts,
  inline styles only (Tailwind JIT needs them), images may be data
  URLs or blobs.
- IPC capabilities are explicit in `capabilities/default.json`.
- No network access from the frontend in P0–P3.

## Platform abstractions (future)

`platform/` module (P2+) will expose:

```rust
trait PlatformIntegrations {
    fn set_dnd(&self, enabled: bool) -> Result<()>;
    fn set_autostart(&self, enabled: bool) -> Result<()>;
    fn show_tray_menu(&self, items: &[TrayItem]) -> Result<()>;
}
```

with implementations gated by `#[cfg(target_os = "linux" | "macos" |
"windows")]`.

## Testing strategy

- Pure functions (`Timer::recompute`, projection `apply`) are
  unit-tested without a DB.
- The store has integration tests against an in-memory SQLite
  (`:memory:`).
- IPC surface is contract-tested by spawning a Tauri test harness and
  invoking commands.
- E2E via Tauri's `tauri::test` driver + headless WebKit.

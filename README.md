# Nerva

> **The focus workspace that never forgets.**

A native desktop focus workspace built for deep work. Parallel timers that
survive sleep and reboot, sticky markdown notes that float above any window,
a year-long habit heatmap, and tasks with priority and due times.
Offline-first. No telemetry. No account.

**Six things, done properly:**

1. **Parallel focus timers** — wall-clock math. Survives sleep, suspend, reboot.
2. **Sticky markdown notes** — pop out a note; it floats above any window. Autosaves every 250 ms.
3. **Habit heatmap** — 4-state daily toggle, streaks, full-year contribution grid.
4. **Tasks with pop-out** — priority + due time, dockable side panel or floating widget.
5. **Command palette** — `Ctrl+Space` to jump anywhere. Global shortcuts for habits, tasks, timer.
6. **Crash-safe local store** — event-sourced SQLite. Append-only log. Replay-on-launch recovery.

Native Rust core, ~80 MB RAM idle. Not Electron. Apache-2.0.

→ **Download:** https://nerva.bytical.ai
→ **Canonical product story:** [`docs/STORY.md`](docs/STORY.md)

## Status

Foundation (P0) — May 2026.

| Module | State |
|---|---|
| Event-sourced SQLite store | ✅ implemented |
| Multi-timer engine (wall-clock math) | ✅ implemented |
| Persistent notes (autosave) | ✅ implemented |
| Workspaces | ✅ implemented |
| Tauri IPC surface | ✅ implemented |
| Dashboard skeleton (Sidebar / Stage / Notes / Timeline) | ✅ implemented |
| systemd user daemon unit | ✅ shipped (template) |
| Audio engine | ⏳ P2 |
| Habit tracker (rolling momentum) | ⏳ P3 |
| Anti-distraction layer | ⏳ P2 |
| Session intelligence (local LLM) | ⏳ P4 |
| E2E encrypted sync | ⏳ P5 |
| Windows / macOS parity | ⏳ P6 |

## Architecture

```
React (Vite + TS + Tailwind)
        │ Tauri IPC (commands + events)
        ▼
Rust runtime
   ├─ store/      event-sourced SQLite (append-only) + projections
   ├─ timers/     wall-clock multi-timer engine (suspend/reboot-safe)
   ├─ notes/      autosaved notes (250 ms debounce)
   ├─ workspaces/ bundles of timers, notes, audio, layout
   └─ ipc/        Tauri command surface
```

**Crash recovery**: every state mutation is an append-only event.
On launch the runtime replays the log to reconstruct in-memory state —
including timers, which use wall-clock timestamps so they keep counting
correctly across sleep, suspend, and power loss.

## Development

```bash
# one-time
npm install
rustup default stable
# Linux build deps already installed in this environment:
#   libwebkit2gtk-4.1-dev build-essential libxdo-dev libssl-dev \
#   libayatana-appindicator3-dev librsvg2-dev pkg-config

# dev (hot reload, frontend + backend)
npm run tauri:dev

# release build
npm run tauri:build  # produces .deb and .AppImage in src-tauri/target
```

### Daemon (Linux)

```bash
bash packaging/linux/install-daemon.sh
```

Installs a `systemd --user` unit configured with `Restart=on-failure`.
Logs: `journalctl --user -u nerva -f`.

## Data location

`$XDG_DATA_HOME/dev.nerva.app/nerva.db` (typically `~/.local/share/dev.nerva.app/`).

The database is the single source of truth. It's safe to back up, copy,
or restore — Nerva will replay events from any point.

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md).

## License

Apache-2.0 (planned).

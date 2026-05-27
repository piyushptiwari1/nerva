# Nerva

> A persistent focus workspace for deep work.

Native-first Ubuntu desktop app. Multi-timer engine, persistent notes,
workspace memory, and cognitive-state continuity that survives reboots
and crashes. GPU-light, offline-first, no Electron bloat.

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

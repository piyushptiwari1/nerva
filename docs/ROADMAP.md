# Nerva — Roadmap

> Source of truth: `/memories/repo/nerva-project.md` (agent-readable).

## Product identity

**A persistent focus workspace for deep work.**

Not another Pomodoro app. Nerva behaves as an operating-system layer for
focused execution: multi-timer engine, smart persistent notes, workspace
memory, and cognitive-state continuity that survives reboots and crashes.

## Killer differentiators

1. **Cognitive-state continuity** — every state change is an event in an
   append-only SQLite log. On launch, the runtime replays the log to
   rebuild in-memory state (timers, notes cursor, active workspace,
   audio track). Wall-clock timer math means a 90-minute timer that
   was 12 minutes from completion when your laptop slept will still
   be 12 minutes from completion when you boot back up.
2. **Multi-timer engine** — parallel, nestable, chainable. Not "one
   timer, then a break". Real workflows (90m deep work + 8m tea brew +
   45m stretch reminder + 20m call countdown), each isolated.
3. **Native-first Ubuntu** — Tauri/Rust, <100 MB RAM, sub-50ms IPC.
   No Electron. Wayland/X11/GNOME/KDE all first-class.
4. **Anti-shame habits** — rolling momentum, recovery weighting.
   Missing a day does not destroy a streak.
5. **Resume context** — opening a task restores its timers, notes
   cursor, audio track, and linked apps.

## Phases

### P0 — Foundation (shipped this session)

- Tauri 2 + React 18 + Tailwind scaffold
- Event-sourced SQLite store + WAL + replay
- Multi-timer engine (idle / running / paused / completed)
- Persistent notes with 250ms debounce autosave + recent list
- Workspaces (default workspace auto-created)
- Dashboard: Sidebar + Center Stage + Notes Panel + Timeline Bar +
  Command Bar
- systemd `--user` daemon unit + installer script

### P1 — Notes & context (next)

- Markdown rendering with code blocks
- Always-on-top sticky floating note window (separate Tauri window
  label, `set_always_on_top`)
- Screenshot paste + drag-drop snippets
- "Resume context": every task remembers its last note cursor, open
  files, browser URLs. Activate task → restore everything.
- Full-text search (SQLite FTS5).

### P2 — Audio + anti-distraction

- `rodio` ambient audio engine (rain / cafe / brown / pink / binaural).
- Phase-transition sound design (subtle bass pulse, no alarms).
- Local audio pack format (.nervaudio = manifest.json + ogg files).
- DBus DND toggle during focus sessions (org.freedesktop.Notifications).
- App / site blocker — nftables rules + DNS rewrites via systemd-resolved.

### P3 — Habits, tasks, timeline replay

- Habit tracker with rolling momentum (target density, recovery
  multipliers; no streak-loss).
- Execution-focused tasks (queued / active / paused / blocked /
  waiting / archived). Tasks own timers, notes, context.
- Timeline replay UI — scrub through the day's events.

### P4 — Session intelligence

- Local small model (llama.cpp + a 1-3B model) for actionable
  insights: focus decay points, context-switching cost, optimal cycle
  detection. No motivational fluff.
- Command palette (Ctrl/Cmd+K) — Raycast-style with intent routing.

### P5 — Sync & shared core

- Factor out `nerva-core/` crate (store, timers, notes, workspaces,
  sync). The `src-tauri/` shell depends on it; mobile depends on it
  via UniFFI.
- E2E encrypted sync (age + S3-compatible storage), CRDT merge on
  the event log (Lamport timestamps already in place).

### P6 — Windows + macOS parity

- WebView2 (Windows) / WKWebView (macOS) already supported by Tauri.
- Windows daemon: Task Scheduler with restart triggers.
- macOS daemon: `~/Library/LaunchAgents/dev.nerva.daemon.plist`.
- Windows tray: native Shell_NotifyIcon (Tauri default).
- macOS tray: NSStatusItem with template image.
- Distribution: Microsoft Store (MSIX), Mac App Store (DMG +
  notarisation), Snap Store, Flathub, AppImage, .deb.

### P7 — Mobile companion (Android + iOS)

> Spec: [MOBILE.md](MOBILE.md).

- **iOS** (SwiftUI + WidgetKit + ActivityKit + watchOS): home screen
  widgets, lock screen accessory widgets, Live Activities in the
  Dynamic Island, Apple Watch complication, App Intents for Siri.
- **Android** (Compose + Glance + Wear OS): home screen widgets,
  foreground-service media-style notification with timer controls,
  Quick Settings tile, Wear OS tile + complications.
- Shared `nerva-core` via UniFFI (Swift) and JNI (Kotlin).
- Mobile is read-mostly: show timers, capture quick notes, switch
  workspaces. Authoritative writes stay on desktop.

## Tech decisions

| Concern | Decision | Why |
|---|---|---|
| Frontend runtime | Tauri 2 WebView | <100 MB RAM vs Electron's 800+ |
| UI framework | React 18 + Tailwind + Framer Motion | familiar, fast, GPU-light |
| Backend language | Rust 1.77+ | speed, safety, DBus/Wayland ecosystem |
| Storage | SQLite (rusqlite, bundled) + WAL | zero-deps, durable, fast |
| State model | Event sourcing | crash recovery is a free side-effect |
| Timer math | Wall-clock (unix ms) | survives sleep/reboot |
| Sync | CRDT on events (P5) | offline-first, mergeable |

## File layout

See `README.md` and `/memories/repo/nerva-project.md`.

## Open questions

- Bundle ID `dev.nerva.app` — verify availability on each store.
- Trademark check for "Nerva" in productivity / software class.
- Optional encrypted cloud backend: roll our own or piggyback on
  iCloud/Drive folders?

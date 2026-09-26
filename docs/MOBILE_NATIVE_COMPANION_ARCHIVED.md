# Nerva — Mobile Strategy (Android + iOS)

> Status: planning. No mobile code yet. This document is the reference
> spec; once P5 (Sync) is stable we open the mobile track.

## Goal

Mobile is **not a port of the desktop app**. It is a **companion** —
specifically a **widget-first lock-screen / home-screen extension** of
the user's persistent focus state.

Three jobs only:

1. **Show**: current active timer(s) + remaining time + workspace
   name, on lock screen, home screen, and Apple Watch / Wear OS.
2. **Capture**: quick-capture a note that lands in the active workspace.
3. **Resume**: tap a widget → opens app → app pushes a
   `workspace.activated` event into the sync stream so the desktop
   picks it up next time it connects.

Everything else (multi-timer creation, full notes, habits, audio)
remains desktop-first. Mobile users get a read-mostly experience.

---

## Why a companion, not a full port

- Deep work happens at a desk. Mobile timers compete with notifications;
  desktop wins for the core use case.
- Mobile widgets are *the* killer surface — a glanceable focus state
  on the lock screen massively reduces context-switching cost.
- A full mobile port would 3× the maintenance burden for a small
  share of value.

---

## Architecture

```
┌────────────────────────────────────────────┐
│ Desktop (Linux / Windows / macOS)          │
│   Tauri + Rust runtime (source of truth)   │
│              │                              │
│              ▼                              │
│   Event log (SQLite, append-only)          │
│              │                              │
│              ▼                              │
│   Sync engine (P5: age + S3-compat)        │
└────────────────┬───────────────────────────┘
                 │  E2E-encrypted event stream
                 ▼
┌────────────────────────────────────────────┐
│ Mobile companion                            │
│   - Native iOS app (SwiftUI + WidgetKit)   │
│   - Native Android app (Jetpack Compose +  │
│     Glance for widgets)                     │
│   Shared Rust core via UniFFI / mobile-ffi │
└────────────────────────────────────────────┘
```

### Why native (not Tauri Mobile) for v1

| Concern | Tauri mobile | Native |
|---|---|---|
| WidgetKit / Glance access | ❌ not exposed | ✅ first-class |
| Apple Watch complications | ❌ blocked | ✅ |
| Background refresh budgets | ⚠️ unpredictable | ✅ |
| App Store review risk | ⚠️ medium | ✅ low |
| Code reuse with desktop | ✅ via UniFFI | ✅ via UniFFI |

So: native shells + **shared Rust core** via UniFFI (iOS) and JNI
(Android). The core handles event log decoding, timer math, and CRDT
merge.

---

## iOS

### Targets
- iPhone (iOS 17+)
- iPad (iPadOS 17+)
- Apple Watch (watchOS 10+)
- Mac (Catalyst — bonus, may share with desktop tray)

### Surfaces

1. **Home screen widget** (small / medium / large)
   - Small: ring + remaining time + workspace dot.
   - Medium: ring + remaining + next-up timer + workspace name.
   - Large: stacked timeline of all active timers + last note title.
2. **Lock screen widget** (iOS 16+ accessory widgets)
   - Inline: `🟢 Focus 23:11`.
   - Circular: ring with %.
   - Rectangular: ring + workspace.
3. **Live Activity** (Dynamic Island, iOS 16.1+)
   - Mirror the active timer with ring + name.
   - Compact: ring + minutes left.
   - Expanded: full timer + pause/resume CTA via App Intent.
4. **Apple Watch complication** (corner / circular / rectangular).
5. **Control Center widget** (iOS 18+).
6. **App Intent**: "Start a 25-minute focus timer in Coding" via Siri /
   Shortcuts.

### Tech

- SwiftUI + WidgetKit + ActivityKit (Live Activities).
- Rust core compiled to `aarch64-apple-ios` + `aarch64-apple-ios-sim` +
  `aarch64-apple-darwin` (Mac Catalyst).
- UniFFI generates the Swift bindings.
- Sync state stored in App Group container shared across app + widgets
  (`group.dev.nerva.app`).
- Background refresh: BGTaskScheduler. Live Activities update via push
  (silent APNs from sync backend) so the widget stays accurate while
  the app is closed.

### Distribution

- TestFlight → App Store.
- Bundle: `dev.nerva.app` (matches desktop).
- Categories: Productivity (primary), Lifestyle (secondary).
- Privacy nutrition labels: "Data Not Collected" — everything is E2E.

---

## Android

### Targets
- Phone (Android 13+, API 33+)
- Tablet
- Wear OS 4+
- Foldables (responsive layouts)

### Surfaces

1. **Home screen widget** (`androidx.glance`)
   - 2×1, 2×2, 4×2 sizes mirroring iOS.
   - Glance composables → RemoteViews compiled at build time.
2. **Lock screen** (Android 14+: notification + media-style controls)
   - Foreground service notification rendered as a media-style card
     when a timer is active, exposing pause/resume.
3. **Wear OS tile** + complications.
4. **Quick Settings tile** (`TileService`) — toggle "Focus mode" from
     the system QS panel.
5. **App Shortcuts** — "Start 25m Focus" / "Open Coding workspace".
6. **Google Assistant action** via App Actions (BII:
   `actions.intent.START_EXERCISE` repurposed, or custom BII).

### Tech

- Kotlin + Jetpack Compose + `androidx.glance:glance-appwidget`.
- Rust core compiled to `aarch64-linux-android` + `armv7-linux-androideabi`
  + `x86_64-linux-android` (emulator).
- UniFFI → Kotlin bindings.
- Sync state in app-private storage + a tiny content provider for
  widget reads.
- Background: WorkManager + foreground service for active timers
  (Android 14 requires `dataSync` foreground service type).

### Distribution

- Internal track → closed beta → production on Google Play.
- Same `dev.nerva.app` package id (with `.android` suffix if needed).
- F-Droid: build pipeline with reproducible builds, no proprietary deps.

---

## Sync contract

Mobile reads + writes events to the same encrypted log as desktop.

- **Read** events at startup + every 60s when foregrounded + on push.
- **Write** events for:
  - `note.saved` (quick capture)
  - `workspace.activated` (tap a widget to switch)
  - `timer.started` / `timer.paused` (only if user explicitly acts;
    we don't second-guess the desktop)
- Conflict resolution: events are CRDT-friendly (Lamport timestamps,
  last-writer-wins on `workspace.activated`).

The desktop remains the **authoritative writer** for habit
calculations, audio, and intelligence. Mobile never runs those.

---

## Shared Rust core

`nerva-core/` (new crate, factored out of `src-tauri/src/` at P5):

```
nerva-core/
├── store/      # SQLite + event log (already exists)
├── timers/     # wall-clock math (already exists)
├── notes/
├── workspaces/
├── sync/       # CRDT merge, age E2E, S3-compat client
├── ffi/        # UniFFI scaffold (mobile)
└── lib.rs
```

The desktop `src-tauri/` becomes a thin shell that depends on
`nerva-core`. Mobile shells depend on `nerva-core` via UniFFI.

---

## Phased rollout

- **P5.1**: Factor `nerva-core` out of `src-tauri/`. UniFFI scaffold.
- **P5.2**: Sync engine end-to-end on desktop only.
- **P6.1**: iOS minimal — single widget (medium) + Live Activity for
  one active timer + quick-capture sheet.
- **P6.2**: Apple Watch complication.
- **P6.3**: Android minimal — single Glance widget + foreground-service
  notification + quick capture.
- **P6.4**: Wear OS tile.
- **P7**: Full widget matrices, Siri / Assistant actions, Quick
  Settings tile, App Intents.

---

## UX rules for mobile

- **No new timers from widgets** (too easy to mis-tap). Widgets only
  show + resume.
- **No notifications during focus**. The only notification is at the
  *end* of a timer, and it's a quiet local notification (no sound by
  default).
- **No streaks visible** — anti-shame design carries over.
- **Glance, not graze** — every widget should be readable in under
  300 ms of attention.

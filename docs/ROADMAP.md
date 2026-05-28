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

### P4 — Adaptive coach (personalized LLM layer)

Goal: turn Nerva from a passive timer/notes app into a coach that
understands the user's actual workflow and proposes the next move.
All inference is **local-first** (llama.cpp + 1–3B quantized model);
larger models are an opt-in via a user-supplied API key. No telemetry,
no remote training on user data.

What the model is given (read-only views over the event log, no PII
ever leaves the device):

- **Habit signal** — completion patterns, time-of-day clustering,
  recovery after misses, streak velocity.
- **Focus signal** — timer-length distribution per workspace,
  interruption rate, paused-then-abandoned rate, deep-work windows
  detected from sustained running-timer + low-notification activity.
- **Task signal** — priority vs. actual completion order, due-time
  slippage, time-of-day a task type usually gets done.
- **Notes signal** — recent topics (TF-IDF over note bodies),
  sentiment trend, fragmented vs. flowing prose as a stress proxy.
- **Calendar / day-shape signal** — slot density, recovery gaps
  between meetings.
- **Self-reported mode** — a single optional daily "how's the head
  today?" picker (focused / scattered / drained / wired / flat).

What the model produces (surfaced as gentle suggestions, never
auto-applied):

- **Time-of-day routing** — "your deep-work hits 9–11am 4 days out of
  5; this 90m block looks like a fit". Re-orders the day plan.
- **Task triage** — promotes / demotes priorities based on energy
  signal + slippage history. "You've bounced off `<task>` 3 mornings
  — try it after coffee tomorrow or break it down."
- **Cycle length** — proposes a timer length per task type ("notes
  edits land in 25m, deep code wants 75m"). Replaces the static 25/5
  Pomodoro default.
- **Recovery prompts** — detects a drained pattern and offers a
  shorter / different cycle instead of pushing through.
- **End-of-day reflection** — 3-line summary of what the day actually
  was vs. what it was planned to be. Stored as a note, not pushed.
- **Weekly retro** — pattern drift over 4 weeks: streaks gained,
  habits decaying, workspace getting heavier.

Architecture:

- New `nerva-coach/` Rust crate. Pure data layer: takes a slice of
  the event log + a prompt template, returns a structured
  `Recommendation` enum that the UI knows how to render. Never
  free-text into the UI.
- `llama.cpp` via `llama-cpp-2` bindings. Default model: a 3B
  instruction-tuned weight checkpointed in the AppData dir on first
  use. Inference is gated by a feature flag and explicitly opt-in
  in Settings — zero work happens otherwise.
- Optional bring-your-own-key adapter for Claude / GPT-4o-mini /
  local Ollama. Same `Recommendation` interface.
- Prompts are versioned in-repo (`prompts/coach/*.md`) so users can
  see and edit what the model is told about them.

Privacy contract:

- Inputs to the model are aggregated counters and bucketed
  timestamps, never raw note bodies (notes are only included when
  the user explicitly opens "ask Nerva about today's notes").
- All inference results are stored in the same event log as
  everything else — fully auditable, fully deletable.

Status: design only, not on the v0.x track. Lands after multi-device
sync (P5) because suggestions are most useful with a complete
behavior history.

### P5 — Identity, sync, and shared core

Goal: one user, many devices, one workspace. Open the laptop at home,
the phone on the train, the work machine at the office — same
timers, same notes, same habit grid, same coach context.

#### P5.0 — Local-only refactor (no cloud)

- Factor out `nerva-core/` crate (store, timers, notes, workspaces,
  sync primitives). The `src-tauri/` shell depends on it; mobile
  depends on it via UniFFI (iOS) and JNI (Android).
- All events already carry a Lamport timestamp + actor id — these
  become the foundation for merge in P5.1.

#### P5.1 — Account + identity

- **Bytical Account** — single sign-on across Nerva, future Bytical
  products, and the web dashboard. Email + passkey + magic-link;
  no passwords by default. OAuth (Google / Apple / GitHub) optional.
- Account is **identity only** — it carries an account id and a
  per-device public key. It does *not* hold user data.
- Account server: a small Postgres + Rust service. Stores only:
  account id, verified email, list of paired device public keys,
  per-device display name, subscription tier. Open source under
  Apache-2.0 — self-hostable for users who want full sovereignty.

#### P5.2 — End-to-end encrypted sync

- Storage backend: any S3-compatible bucket (Bytical-hosted by
  default, BYO bucket for power users). Server sees ciphertext only.
- Per-account master key derived from a passphrase (Argon2id) +
  unwrapped at device pairing time via the account passkey. Master
  key never reaches the server.
- Event log is the synced unit. Each device appends; merge is a
  CRDT-style union over (lamport, actor) — already deterministic
  because the event types are designed for monotonic merge.
- Conflict resolution: timer state uses last-writer-wins on the
  composite (lamport, actor) key; notes use Yjs-style text CRDT for
  concurrent edits; habits and tasks are commutative by design
  (toggle/complete are idempotent on (day, habit_id) and
  (task_id, status)).
- Selective sync — workspaces are the unit. Personal workspace
  syncs everywhere; "work-only" workspace can be device-pinned.

#### P5.3 — Device management

- **Paired Devices** screen in Settings — name each device, see
  last-seen, revoke a key. Revoking a device tombstones its public
  key on the account server; the local data on the revoked device
  becomes unreadable on next launch.
- **Recovery codes** — a single Argon2id-derived recovery passphrase
  is generated at signup and shown once. Losing all devices without
  the recovery code = data is unrecoverable (this is the privacy
  contract).
- **Web dashboard** — a read-only view at `nerva.bytical.ai/app`
  for habit grid / weekly retro. Same E2E crypto, runs in a
  service worker, never decrypts on the server.

#### P5.4 — Free / paid tiers (informational)

- **Free** — local-only, single device. Forever. No regressions
  vs. v0.1.x.
- **Bytical Account (free)** — sync up to 2 devices, 100 MB of
  encrypted event-log storage. Covers the typical solo user.
- **Bytical Pro (paid)** — unlimited devices, larger storage,
  hosted coach inference (P4) for users without a local GPU,
  priority support. Pricing TBD.

#### P5.5 — Funding + payment infrastructure

Until tiers ship, monetisation is donation-only and runs through
the same gateway the Bytical platform already uses:

- **GitHub Sponsors** — primary recurring channel
  (`.github/FUNDING.yml`, surfaced on every release page and inside
  the app at Settings → About).
- **One-time donation page** at `nerva.bytical.ai/support`. Hosted
  on the same Vercel project as the marketing site, posts to a
  PayU checkout. PayU was picked to match
  [`bytical-platform-backend/routes/payment_endpoints.py`](https://github.com/bytical/bytical-platform-backend)
  so the same `PAYU_KEY` / `PAYU_SALT` / `PAYU_BASE_URL` env vars
  and the same hash + redirect-back flow Bytical already runs in
  prod are reused. Only the productinfo, amount, and surl/furl
  change per integration.
- **Pro subscription** (post-P5.1) reuses the platform's
  `PaymentIntent` + `subscription_manager` mongo collection — the
  Nerva account-server is a thin shim that calls into the same
  payment endpoints rather than a parallel Stripe/Razorpay
  integration. Means one billing dashboard, one tax-report, one
  reconciliation pipeline.
- **What does NOT live in the desktop binary**: no payment keys,
  no checkout iframe, no IAP. The app only opens
  `nerva.bytical.ai/support` and `github.com/sponsors/piyushptiwari1`
  in the user's browser. Keeps the OSS binary free of any
  payment-gateway secret and lets the support page evolve without
  a desktop release.

Open questions:
- Self-host story for the account server — provide a Docker image
  + a one-command `nerva-self-host up`?
- Should the coach (P4) ever run server-side for Pro users, or
  always locally? Leaning toward local-only with the option to
  offload to a user-controlled remote (their own Ollama, their own
  OpenAI key) — never to Bytical infra.

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

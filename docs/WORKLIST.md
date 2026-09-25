# Nerva by Bytical — Worklist (v0.1.12 → v0.3)

Status legend: **✅ done this cycle** · **🛠 in progress** · **📐 planned (design below)** · **🔬 research**

Each item lists **Intent** (why), **Use case** (who/when), **Approach** (how, with the concrete files touched or to touch), **Testing**, and **Status**.

---

## 1. Pop-out notes: close button hidden / must slide window to reach it — ✅

**Intent.** A sticky must always spawn fully on the monitor the user is looking at, with `×` reachable on first paint.

**Use case.** User pops a note out on a laptop (Windows 125–150 % scaling) or on a multi-monitor rig where the main window sits near the right edge of monitor 1. The sticky appears straddling the monitor boundary; the header controls land on monitor 2 (or off-screen).

**Root cause (two independent bugs).**
1. **DPI unit mix-up in `spawn_popup`** ([src-tauri/src/ipc/mod.rs](../src-tauri/src/ipc/mod.rs)). `outer_position()`, `outer_size()`, and `Monitor::size()/position()` return **physical** pixels, while `inner_size(width,height)` and `WebviewWindowBuilder::position(x,y)` take **logical** pixels. On a 1.5× display the computed physical `x` is fed in as logical → Tauri multiplies by 1.5 again → the window lands 50 % further right/down than intended, past the monitor edge. On a 1× single-monitor setup the bug is invisible, which is why it looked "random".
2. **Header overflow** — already fixed last cycle (`min-w-0` on the title, `shrink-0` on controls) but the clamp above could still push the whole header off-screen, so users blamed the button.

**Approach.**
- Convert everything to logical coordinates via `scale_factor()` before doing the placement math; clamp to the monitor rect in logical units; then call `.position()`.
- Prefer `Monitor::work_area()` when available (excludes taskbar/dock) — falls back to full monitor rect.
- Frontend safety net in every popup (`StickyNote`, `TimerWidget`, `HabitsWidget`, `TasksWidget`): `Esc` closes/hides the window, so a mis-placed popup is always dismissible from the keyboard. Also a `Ctrl/Cmd+W` binding.
- Wayland caveat (documented in code): compositors ignore client positioning; nothing to do server-side, keyboard escape hatch covers it.

**Testing.** Pure-function `clamp_popup_origin()` extracted and unit-tested in Rust (1×, 1.5×, 2× scale; monitor at negative x offset; main window partially off-screen). Manual: Windows 150 %, Ubuntu X11 dual-monitor.

---

## 2. Finish previous-cycle leftovers + cross-platform functionality matrix — ✅ (matrix) / 📐 (payload v2)

**Leftovers from the last cycle**
- Per-user timer/habit/note *detail* in telemetry (payload v2) → 📐 scheduled for v0.1.12 after this bug-fix batch; schema draft in [docs/PLATFORM_MATRIX.md](PLATFORM_MATRIX.md#telemetry-payload-v2).
- Sticky-note header fix → ✅ shipped (see §1).

**Matrix.** [docs/PLATFORM_MATRIX.md](PLATFORM_MATRIX.md) is the single source of truth for which feature exists on Linux / Windows / macOS / Android / Web, with owner + notes. CI should fail if a feature is added to `src/` without a matrix row (lint TODO: simple grep on `// matrix:` tags).

---

## 3. Ratings, reviews, feature requests (app + website + GitHub) — ✅ MVP

**Intent.** Right now the only signal after download is a weekly anonymous ping. We need *qualitative* signal: is it useful, what's missing, would they pay.

**Use case.**
- Day-7 user gets a soft, dismissible "How is Nerva working for you?" card → 1–5 stars + optional text + optional email. Never nags again after answer or 2 dismissals.
- User hits a wall → `Ctrl+K → Send feedback` or Settings → Feedback → "Request a feature" / "Report a bug", pre-filled with version/OS.
- Website visitor → `/feedback` form; GitHub visitor → structured issue templates.

**Approach.**
- **App**: `FeedbackPane` (Settings tab + palette command). Posts to `https://nerva.bytical.ai/api/feedback` with `{kind: rating|feature|bug, stars?, text, email?, app_version, os, anon_id}`. Offline → queued in localStorage, retried on next launch. Rating prompt gated by `nerva.feedback.*` localStorage keys (first-run ts, dismiss count, answered).
- **Web**: `web/api/feedback.ts` edge function → validates, rate-limits per IP hash, appends JSONL to private `nerva-metrics` repo (same path as telemetry) and mirrors to Segment. `/data` dashboard gets a "Feedback" table + average stars KPI.
- **GitHub**: `.github/ISSUE_TEMPLATE/{bug_report,feature_request}.yml` + `config.yml` linking to discussions/website. README badge "★ Rate Nerva".

**Testing.** Type-check; manual POST with curl; dashboard renders new rows.

---

## 4. Google Drive backup plugin + paid tier — 📐

**Intent.** Users trust Nerva with months of notes/habits; a lost laptop = lost data. Backup is also the first credible paid feature.

**Use case.** Free: manual "Export backup (.nerva.zip)" / "Restore". Pro: nightly encrypted backup to the user's own Google Drive (app-data folder), multi-device restore, 30-day version history.

**Approach.**
1. **Backup format (free, foundation)**: zip of `nerva.db` (WAL-checkpointed) + `meta.json {version, created_ms, os}`. Rust command `backup_export(path)` / `backup_import(path)` (uses `rusqlite::backup`). Settings → Data tab.
2. **Drive (Pro)**: OAuth 2.0 PKCE loopback flow (Tauri opens system browser, listens on `127.0.0.1:<port>`), scope `drive.appdata` only (invisible to user's Drive UI, no access to their files). Token stored via `keyring` crate (OS secret store), never in SQLite. Encrypt zip with age/XChaCha20 using a passphrase-derived key (Argon2id). Scheduler: after each app launch + every 24 h while running.
3. **Licensing**: PayU checkout already exists on the site (`web/api/payu-*`). Issue an Ed25519-signed license JWT `{email, plan, exp}`; app verifies offline with embedded public key; grace period 14 days. Entitlement gates: Drive sync, multi-device, priority feedback.
4. Price anchor: $3/mo or $24/yr; lifetime $49 during launch.

**Testing.** Backup/restore round-trip test in Rust; OAuth flow manual on all 3 OSes.

---

## 5. Component-by-component UI/UX audit + "Nerva by Bytical" branding — ✅ audit + branding pass, 🛠 polish continues

Full audit table in [docs/UX_AUDIT.md](UX_AUDIT.md). Fixed this cycle:
- `TimerStage` ring digits hard-coded `#e3e6ec` → invisible on light theme. Now `currentColor` with `text-ink-100`. Ring track uses theme hairline.
- `.prose-nerva` heading/code/hr colours hard-coded for dark → moved to CSS variables.
- `HabitsRail` never refreshed after adding a habit from the overlay (§11).
- Branding: window titles, popup headers, About tab, command bar footer, website footer, and `tauri.conf.json` product name now read **"Nerva by Bytical"**.

---

## 6. Competitor research (incl. open source) — 🔬 summary

| Product | What they do better than Nerva today | Nerva response |
|---|---|---|
| **Pomofocus** (web) | Zero-friction start, auto long-break every 4th round, task-linked pomodoro estimates | §13 auto-structure; task estimate field (📐) |
| **Focus To-Do** (all platforms) | Cross-device sync, reports, whitelist app blocker | Drive sync (§4), Android (§15) |
| **Session** (macOS) | Beautiful minimal UI, intention prompt before session, reflection after, analytics | Add "intention" line on timer start + 1-line reflection on completion (📐 v0.1.13) |
| **Forest** | Gamified tree growth, social planting | Not chasing gamification; anti-shame momentum is our angle |
| **Super Productivity** (OSS, Electron) | Jira/GitHub/GitLab issue import, time tracking per task, worklog export | Task import via URL/API (📐 v0.3), CSV export of focus log (📐 v0.2) |
| **Toggl Track** | Precise time tracking + reports | Focus log → CSV/ICS export (📐) |
| **Loop Habit Tracker** (OSS, Android) | Habit scoring with exponential smoothing, widgets | Our heatmap ≈ parity; adopt Loop's score as "momentum %" |
| **Rize / RescueTime** | Automatic activity tracking | Out of scope (privacy); maybe opt-in window-title tagging later |
| **Obsidian / Logseq / AppFlowy / Anytype** | Rich note graph, backlinks, plugins | Keep notes lightweight; add `[[wikilinks]]` + backlink pane (📐), never a full PKM |
| **Sunsama / Akiflow / Motion** | Daily planning ritual, calendar integration | Read-only calendar overlay in Timeline bar via ICS URL (📐 v0.3) |
| **Flowtime / Flowmodoro apps** | Break = ⅕ of focus time, no fixed length | Offer "Flowtime" mode in §13 structure picker |

Open-source projects to watch/borrow: Super Productivity (worklog model), Loop (scoring math), Pomatez (Electron pomodoro, tray UX), Flameshot (Wayland popup positioning lessons), AppFlowy (Flutter+Rust local-first sync).

---

## 7. Bring-your-own LLM keys (multi-provider) — ✅ MVP

**Intent.** Ollama-only excludes most users. Let them plug OpenAI / Anthropic / Gemini / OpenRouter / any OpenAI-compatible endpoint.

**Approach.**
- Provider enum in Rust `intelligence`: `ollama | openai | anthropic | gemini | openrouter | custom`. Each with `{endpoint, model, api_key}`. Keys stored in SQLite `meta` for now (device-local, never synced or telemetered) — migrate to `keyring` with §4.
- Streaming adapters: OpenAI-compatible SSE (`/v1/chat/completions`, covers OpenAI, OpenRouter, Groq, Together, LM Studio, vLLM), Anthropic Messages SSE, Gemini `streamGenerateContent?alt=sse`.
- Settings → Nerva AI tab: provider picker, key field (masked, "Test" button), model text/select.
- `include_context` notes injection stays identical across providers.

**Testing.** Unit tests for each provider's request body builder + SSE line parser (no network).

---

## 8. Collaboration, Kanban and shared workspaces — 📐

**Intent.** Move from single-player to small teams (2–10) without turning into Jira.

**Use cases.** Pair deep-work sessions (shared timer), shared Kanban for a side project, shared habit accountability.

**Approach (phased).**
1. **Local Kanban view** over existing tasks: `status: todo|doing|done` + `column_order` (event `task.moved`). Board view in TimerStage tab. Zero sync needed.
2. **Sync substrate**: the event log is already append-only → CRDT-free "op log sync". Each device gets a `device_id`; sync = exchange events since last cursor. Transport options: (a) Google Drive appdata folder (reuses §4), (b) a tiny Bytical relay (WebSocket, E2E-encrypted blobs, no plaintext server-side).
3. **Shared workspace**: a workspace gets `share_id` + symmetric key (QR/invite link). Members' events tagged `author_id`. Conflicts: last-writer-wins per entity for metadata; append-only for logs/entries (no conflict).
4. **Live timer**: presence + timer events over the relay; UI shows "Alice is in a 50m Deep (23:10 left)".

Non-goals: comments threads, permissions matrix, SSO.

---

## 9. User-customisable dashboard — ✅ MVP

**Intent.** Not everyone wants Habits or Momentum on the left; some want the clock first.

**Approach.** `useLayout` zustand-persist store `{sidebar: SectionId[], hidden: SectionId[]}`. Settings → Layout tab lets users reorder (↑/↓, drag with existing `@dnd-kit`) and toggle sections: Workspaces, Tasks, Habits, World clock, Momentum. Command `Reset layout`. Next step (📐): resizable column widths, swap Notes ↔ Sidebar sides, hide Timeline bar.

---

## 10. Multi-country clocks — ✅

**Intent.** Remote workers coordinate across zones.

**Approach.** `WorldClock` sidebar section: up to 6 IANA zones, persisted (`useClocks`), shows `HH:MM`, day offset (+1/−1) and offset vs local; add via searchable list built from `Intl.supportedValuesOf("timeZone")`. 30 s tick, respects 12/24 h locale. Also exposed as palette command "Add world clock".

---

## 11. Habits section on dashboard doesn't list added habits — ✅

**Root cause.** `HabitsRail` only refreshed on mount and on `window.focus`. Habits are created inside the `HabitsPane` overlay in the *same* window → no focus event → rail stays stale until the app is re-focused/restarted. (The `habit:changed` event *was* emitted by `ipc.mutate`, but the rail never subscribed.)

**Fix.** Subscribe to `habit:changed` + `workspace:activated`; recompute `today` at refresh time so a rail left open across midnight doesn't log to yesterday.

---

## 12. Better completion / break / restart sounds — ✅

**Intent.** The single sine beep is harsh and not semantically distinct: users can't tell "focus ended" from "break ended".

**Approach.** Keep zero-asset synthesis (bundle stays small, no licensing) but make it *musical*: additive-synth bell (fundamental + 2.76× + 5.4× partials with independent decays), soft ADSR envelopes, three distinct cues:
- **Focus complete** — warm descending 3-note bell (G5→E5→C5), long tail.
- **Break over / back to focus** — bright ascending 2-note (C5→G5), shorter.
- **Resume / restart** — single soft tick-bell.
Users still pick the family (classic/chime/bell/beep/soft) in Settings; phase cues derive from it. All samples pre-rendered once into a buffer at 44.1 kHz on first play (cheap).

---

## 13. Pomodoro-aware timer creation + uniform session flow + light-theme digits — ✅

**Intent.** A 2 h "sprint" should automatically contain breaks and run as **one** timer; pausing must not spawn a separate "Tea"/"Break" timer.

**Rules (`plan_phases(total_ms)` in Rust, unit-tested).**
- `< 30 min` → single focus phase (no pomodoro).
- `≥ 30 min` → 25 m focus / 5 m break cycles; every 4th break is 15 m; the plan **always ends on a focus phase**; a trailing remainder `< 10 m` is merged into the previous focus block.
- Examples: 30 → `25f 5b`→ merged → `30f`; 60 → `25f 5b 30f`; 120 → `25f 5b 25f 5b 25f 5b 30f`.
- User can toggle "Auto breaks" off per timer; default from Settings → Timers.

**Engine.** `Timer.phases: Vec<Phase>` persisted in `timer.created`. `recompute()` derives `phase_index`, `phase_remaining_ms` from the same wall-clock elapsed. `tick()` reports `phase_transitions` → distinct sound + OS notification ("Break — 5:00"). Old events without `phases` → single-phase, fully backward compatible.

**UI.** Card shows phase pill (`Focus 2/4`, `Break`), ring = current phase, thin outer track = whole session. Widget shows `Focus · 12:04 · next break in…`. Ring digits now use `currentColor` (fixes white-on-white in light theme).

---

## 14. Mature, clean, minimalist UX across all components — 🛠 (audit in UX_AUDIT.md)

Principles adopted: one accent, 3 text tones, 8-pt spacing grid, every destructive action confirms or undoes, every popup has Esc + drag + pin, every empty state teaches one thing. Fixes shipped this cycle are marked in the audit; remaining rows are ordered by user impact.

---

## 15. Android app — 📐

**Approach.** Tauri 2 mobile target reusing the Rust core (SQLite, timers, habits). UI: a *separate* mobile shell (`src/mobile/`) — bottom tab bar (Focus · Notes · Habits · Tasks), one column, big timer, swipe-to-complete habits, Material You dynamic colour via `@material/material-color-utilities`. Foreground service for running timers (`tauri-plugin-notification` + a small Kotlin plugin for `ForegroundService`). Home-screen widgets: timer + today's habits (Glance). Distribution: Play (internal → closed → production) + F-Droid (reproducible build). Existing [docs/MOBILE.md](MOBILE.md) covers toolchain; add `android/` capability file and `nerva-mobile` CI job.

---

## 16. SEO / GEO for US-EU-UK + LLM discoverability — ✅ foundations, 📐 content

**Done now.** `robots.txt`, `sitemap.xml`, `llms.txt` + `llms-full.txt` (structured product facts LLM crawlers ingest), tightened title/description with target keywords, `hreflang` en-US/en-GB, `SoftwareApplication` schema extended with `aggregateRating` placeholder (fed by §3), `HowTo` schema for install.

**Keyword targets (research summary).** Head: "pomodoro app linux", "focus timer windows", "deep work app", "multi timer app". Long-tail (LLM-friendly, question form): "pomodoro timer that survives reboot", "offline habit tracker desktop", "free alternative to Session app windows", "focus app with sticky notes", "Flowtime timer desktop". EU/UK spelling variants in copy ("favourite", "organise") on the en-GB page.

**Next (📐).** Comparison pages (`/vs/pomofocus`, `/vs/session`, `/vs/focus-to-do`), `/linux`, `/windows` landing pages, GitHub README FAQ mirrors the site FAQ verbatim (LLMs cite READMEs heavily), submit to AlternativeTo / Product Hunt / awesome-productivity lists, weekly changelog page (fresh content signal).

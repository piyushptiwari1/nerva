# Nerva — canonical product story

> **Single source of truth.** Every other surface (landing page, Snap Store,
> winget, Microsoft Store, README, GitHub topics, social posts) MUST quote from
> this file verbatim. Do not invent new taglines elsewhere.

---

## 1. Identity

- **Name:** Nerva
- **Publisher:** Bytical Solutions Private Limited
- **License:** Apache-2.0
- **Home:** https://nerva.bytical.ai
- **Repo:** https://github.com/piyushptiwari1/nerva

## 2. Taglines (pick by surface)

| Surface | Tagline (verbatim) |
|---|---|
| Hero / OG title | **The focus workspace that never forgets.** |
| Sub-hero | A persistent desktop workspace for deep work — timers, notes, habits, tasks. All offline. |
| One-liner (≤80 chars) | Persistent focus workspace for deep work. Offline. No account. |
| Twitter bio | Multi-timer engine + markdown notes + habit heatmap + tasks. One native app. |
| App store short | Persistent focus workspace for deep work |

## 3. Short description (≤300 chars — Snap, winget, MS Store)

Nerva is a native desktop focus workspace built for deep work. Parallel timers that survive sleep and reboot, markdown sticky notes that float above any window, a year-long habit heatmap, and tasks with priority and due times. Offline-first. No telemetry. No account.

## 4. Long description (~700 chars — README, MS Store full)

Nerva is the focus workspace that never forgets. Run multiple deep-work timers in parallel — each one keeps counting accurately through sleep, suspend, and full reboots, because every tick is wall-clock anchored, not a JavaScript interval. Capture markdown notes in sticky pop-outs that hover above any other window so your thinking stays one keystroke away. Track habits with a 4-state toggle and a year-long heatmap. Manage tasks with priority, due times, and a floating pop-out. Everything is stored in a local, crash-safe, event-sourced SQLite log: your data never leaves your machine, and the app restores to the exact state it was in even after a power loss.

## 5. The six hero features (use these names, this order, everywhere)

1. **Parallel focus timers** — wall-clock multi-timer engine. Survives sleep, suspend, reboot.
2. **Sticky markdown notes** — pop up a note; it floats above any window. Autosaves every 250 ms.
3. **Habit heatmap** — 4-state daily toggle, streaks, full-year contribution grid.
4. **Tasks with pop-out** — priority + due time, dockable side panel or floating widget.
5. **Command palette** — `Ctrl+Space` to jump anywhere. Global shortcuts for habits, tasks, timer.
6. **Crash-safe local store** — event-sourced SQLite. Append-only log. Replay-on-launch recovery.

## 6. Differentiators (anti-Electron, anti-cloud)

- Native Rust core, Tauri shell — typically <80 MB RAM idle vs 400+ MB for Electron apps.
- Offline-first by design — works on a plane, in a tunnel, on day-3 of an internet outage.
- No telemetry, no account, no sign-in flow, no "free trial".
- One install file per OS. Open source (Apache-2.0). Audit the code yourself.

## 7. SEO keywords (use naturally in copy — never stuff)

Primary: focus app, deep work timer, multi-timer desktop app, persistent timer, markdown sticky notes, habit tracker desktop, offline productivity app.

Secondary: pomodoro alternative, native productivity app linux, windows focus timer, tauri productivity, no-telemetry productivity app, ubuntu focus app, open-source habit tracker, command palette productivity.

## 8. Platforms (Always list in this order)

Linux (Ubuntu 22.04 / 24.04 / Fedora / Arch) · Windows 10 / 11 · Snap Store · winget · AUR.

macOS is roadmap (P6), not shipping yet — do not advertise.

## 9. FAQ (canonical — reuse anywhere)

**Is Nerva free?**  Yes. Apache-2.0 licensed. No paid tier.

**Does Nerva work offline?**  Yes. There is no cloud component. Everything is local SQLite.

**Does Nerva send any telemetry?**  No. The app makes zero outbound network calls unless you explicitly check for updates.

**Why doesn't my timer drift after sleep?**  Because Nerva uses wall-clock math, not interval ticks. When you wake the machine, the timer reads `now - started_at` and reflects the real elapsed time.

**Will my notes survive a crash?**  Yes. Notes autosave every 250 ms into an append-only event log. On next launch the runtime replays the log.

**Why is the Windows installer flagged "Unrecognized app"?**  Nerva is signed with a self-signed certificate during early releases. Click `More info → Run anyway`, or install the Bytical trust certificate once to silence the warning. The Microsoft Store build (coming soon) bypasses this entirely.

**Is there a Mac version?**  Not yet — it's on the roadmap.

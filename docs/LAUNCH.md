# Nerva v0.1.0 — Launch Copy

Canonical tagline: **The focus workspace that never forgets.**

Everything below is post-ready. Pick one channel, paste, attach the hero
screenshot from `web/public/` if asked, hit post.

---

## 1. Product Hunt

**Submit at:** https://www.producthunt.com/posts/new

**Tagline (60 char max):**
> The focus workspace that never forgets.

**Description (260 char max):**
> Parallel focus timers that survive sleep, suspend, and reboot. Sticky
> markdown notes that float above any window. A year-long habit heatmap.
> Tasks with pop-out. Command palette. Crash-safe local SQLite store.
> Native Rust + Tauri, ~80 MB RAM, no telemetry, no account, Apache-2.0.

**First comment (Maker comment):**
> Hey PH 👋
>
> I built Nerva because every productivity app I tried either lost my
> timer on sleep, replaced markdown with a custom format, or shipped
> 400 MB of Electron just to draw a rectangle.
>
> Nerva is the opposite. The Rust core is ~80 MB resident. Every action
> is an event in an append-only SQLite log — close the app mid-timer,
> pull the plug, the next launch replays and you're exactly where you
> were. No account. No telemetry. Apache-2.0.
>
> Six things it does properly:
> 1. **Parallel focus timers** — wall-clock math. Open as many as you want.
> 2. **Sticky markdown notes** — pop out a note, it floats above any window. 250 ms autosave.
> 3. **Habit heatmap** — 4-state daily toggle, streaks, full-year contribution grid.
> 4. **Tasks with pop-out** — priority + due time, dockable or floating widget.
> 5. **Command palette** — Ctrl+Space to jump anywhere.
> 6. **Crash-safe store** — replay-on-launch.
>
> Linux (.AppImage, .deb, .rpm) and Windows (.msi, .exe) both ship today.
> Snap and winget coming this week.
>
> Site: https://nerva.bytical.ai
> Source: https://github.com/piyushptiwari1/nerva
> Releases: https://github.com/piyushptiwari1/nerva/releases/tag/v0.1.0
>
> Happy to answer anything. Roast it 🔥

**Topics:** Productivity · Open Source · Linux · Windows · Developer Tools

---

## 2. Hacker News — Show HN

**Submit at:** https://news.ycombinator.com/submit

**Title (80 char max):**
> Show HN: Nerva – A focus workspace whose timers survive sleep and reboot

**URL:**
> https://nerva.bytical.ai

**Text (optional first comment, paste after posting):**
> Hi HN, author here.
>
> Nerva is a native desktop focus app: parallel timers, sticky markdown
> notes, a year-long habit heatmap, tasks with pop-out, command palette.
>
> Three things I cared about while building it:
>
> 1. **Timers as wall-clock math, not setInterval.** Every running timer
>    is `(start_epoch, accumulated_paused_ms, paused_at_epoch)`. The
>    display value is computed from `Date.now()` on every paint. That
>    means closing the lid, suspending, rebooting, or even killing the
>    process mid-session does not change the elapsed time on next launch.
>
> 2. **Append-only event log.** Every user action (note edit, timer
>    start/pause, habit toggle, task tick) becomes a row in a single
>    SQLite events table. On startup the log is replayed into in-memory
>    state. If the app crashes during a write, the partial row is
>    truncated by SQLite's WAL and the prior state is intact. No
>    "did it save?" UX.
>
> 3. **Native Rust core, ~80 MB RAM.** Tauri 2 + React for the shell,
>    a Rust state machine + SQLite for everything that has to be right.
>    No telemetry, no account, no cloud.
>
> Apache-2.0, Linux + Windows today, Snap and winget incoming.
> Releases: https://github.com/piyushptiwari1/nerva/releases/tag/v0.1.0
> Source:   https://github.com/piyushptiwari1/nerva
>
> Feedback very welcome — especially on the event-store design and on
> what's still missing for a real daily driver.

---

## 3. Reddit — r/linux

**Submit at:** https://www.reddit.com/r/linux/submit
**Flair:** Software release

**Title:**
> [Release] Nerva 0.1.0 — a focus workspace with parallel timers, sticky markdown notes, habit heatmap. Native Rust + Tauri, Apache-2.0.

**Self-post body:**
> Shipping the first public release of **Nerva** today.
>
> **What it is:** a single desktop app that combines parallel focus
> timers, sticky markdown notes, a year-long habit heatmap, tasks with
> a pop-out widget, and a command palette. Native Rust + Tauri, around
> 80 MB resident, no telemetry, no account, Apache-2.0.
>
> **Linux packages shipped:**
> - `.AppImage` — portable, works on any modern distro
> - `.deb` — Ubuntu 22.04 / 24.04, Debian 12+
> - `.rpm` — Fedora, RHEL/Rocky/Alma
> - Snap and AUR landing this week
>
> **The thing I'm most proud of:** timers use wall-clock math, and
> every action is an event in an append-only SQLite log. So if you
> start a Pomodoro, close the laptop, suspend overnight, and open it
> tomorrow — the timer is exactly where it should be. Same for
> mid-edit notes and task ticks.
>
> Site: https://nerva.bytical.ai
> Source: https://github.com/piyushptiwari1/nerva
> Release: https://github.com/piyushptiwari1/nerva/releases/tag/v0.1.0
>
> Feedback and bug reports welcome.

---

## 4. Reddit — r/selfhosted

**Submit at:** https://www.reddit.com/r/selfhosted/submit
**Flair:** Software – Other

**Title:**
> Nerva 0.1.0 — fully local, no-account focus + notes + habits app (Linux + Windows, Rust, Apache-2.0)

**Self-post body:**
> Hey r/selfhosted,
>
> **Nerva** is a desktop focus workspace that is "self-hosted" in the
> strictest sense: there is no server. Every byte lives in a single
> SQLite file under your home directory. No account, no telemetry, no
> network calls except the updater (which you can disable).
>
> What it covers:
> - Parallel focus timers (survive sleep / suspend / reboot)
> - Sticky markdown notes that float above any window
> - Year-long habit heatmap with streaks
> - Tasks with priority + due time + pop-out widget
> - Command palette (Ctrl+Space)
>
> Built with Tauri 2 + Rust. ~80 MB RAM idle. Apache-2.0.
>
> Ships as .AppImage / .deb / .rpm / .msi / .exe today, Snap + winget
> later this week.
>
> https://nerva.bytical.ai
> https://github.com/piyushptiwari1/nerva
>
> Backups are trivial — just copy
> `~/.local/share/ai.bytical.nerva/events.db`.

---

## 5. r/productivity (optional)

**Title:**
> Built a focus app whose timers actually survive sleep and reboot — Nerva 0.1.0 (free, Apache-2.0)

Use the r/linux body, swap the "Linux packages" block for a single line
mentioning Linux + Windows both supported.

---

## 6. X / Twitter / LinkedIn thread

**Tweet 1 (hook):**
> Nerva v0.1.0 is out.
>
> A focus workspace that never forgets.
>
> Parallel timers that survive sleep, suspend, and reboot.
> Sticky markdown notes that float above any window.
> A year-long habit heatmap.
> 80 MB RAM. No telemetry. No account. Apache-2.0.
>
> https://nerva.bytical.ai 🧵

**Tweet 2 (timer trick):**
> The thing I'm proudest of: timers are wall-clock math, not setInterval.
> Every paint reads Date.now() and renders elapsed from the start epoch.
>
> Result: close the lid, suspend overnight, kill the process — the timer
> is exactly where it should be on next launch.

**Tweet 3 (event store):**
> Every action — timer start, note edit, habit tick — is a row in an
> append-only SQLite events table. On launch the log replays into
> in-memory state.
>
> No "did it save?" UX. WAL truncates any partial write. Full crash safety.

**Tweet 4 (CTA):**
> Linux: .AppImage, .deb, .rpm
> Windows: .msi, .exe
> Snap + winget this week.
>
> Source: https://github.com/piyushptiwari1/nerva
> Release: https://github.com/piyushptiwari1/nerva/releases/tag/v0.1.0
>
> Built with Tauri 2 + Rust + React. ~80 MB RAM idle.

---

## 7. lobste.rs

Same as Show HN title + URL. lobste.rs is invite-only — only post if you
have an account.

---

## Posting order (recommended)

1. **Product Hunt** at 00:01 PT (best US morning visibility window).
2. **Show HN** at the same time — HN crowd overlaps PH.
3. **r/linux + r/selfhosted** ~2 hours after PH/HN go live, to ride the
   second wave.
4. **X thread** continuously, retweet the PH and HN links.
5. **LinkedIn** end of day — repost the X thread as a single post.

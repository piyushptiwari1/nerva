# Changelog

All notable changes to Nerva by Bytical. The in-app "What's new" dialog and the
GitHub release body are generated from this file — keep each version under a
`## vX.Y.Z` heading with `### ` sub-sections and plain bullets.

## v0.1.15 — 2026-10-02

### Android Installation
- **Nerva Mobile installs alongside v0.1.14.** The old APK was signed with a temporary build key that was not retained. The new app uses a permanent release key and the separate package `ai.bytical.nerva.mobile`. Your old Nerva installation and its data remain untouched. Data is not imported automatically; keep the old app installed if you need its notes, tasks, habits or history. Desktop installations update normally.

### New
- **Native Android home-screen widgets:** Focus, Tasks, Habits and Note. Choose a source and light, dark or system theme for each widget. Control a timer, complete and undo tasks, log habits, or read a selected note without opening the full app.
- **Native quick capture and editing** for tasks and notes, including unsaved-edit protection and rejection of stale note edits.
- **Phone-first navigation:** working workspace selection and habit management, accessible icon controls, widget setup and notification/alarm permission status.
- **Persistent Android signing** with certificate and package verification before publication. Google Play and iOS remain planned.

### Fixed
- Replaced the generated Tauri launcher artwork with the Nerva logo and removed nonfunctional desktop pop-out controls from phones.
- Native widget refresh clears stale empty messages and Undo controls; task and habit changes persist through process restarts.
- Android phase alerts use the native alarm scheduler instead of relying on JavaScript while the phone is asleep. Delivery still depends on notification permissions and device power policies.
- The website's private data dashboard no longer starts hundreds of simultaneous GitHub requests after login. It reports incomplete data and recoverable upstream errors, with a retryable login screen.

## v0.1.14 — 2026-09-26

### New
- **Nerva for Android (beta).** The same Rust core and panels, in a one-column phone shell with Focus / Tasks / Habits / Notes tabs. Timer and break alerts are scheduled with the OS so they fire even when the app is in the background. Your Pro key works on the phone as another device. Download the APK from the GitHub release or nerva.bytical.ai; Google Play and iOS are next.

### Changed
- **Cleaner dashboard.** The bottom event timeline is now off by default (Settings → Layout → Advanced to bring it back) and "Momentum" became **This week**: focus time, sessions and tasks done, with a plain comparison to last week. Hidden until you finish your first timer; turn it on in Settings → Layout.

## v0.1.13 — 2026-09-26

### Fixed
- **Updater showed "Check failed" after a successful update.** The new version was installed correctly, but the automatic relaunch failed because the process plugin was never registered, and the error was reported as a failed check. Relaunch now works; if it ever can't, the app says "Update installed — quit and reopen" instead of pretending the check failed.
- The real updater error message is now shown inline (and in the console) instead of a generic "see Diagnostics".

## v0.1.12 — 2026-09-25

### New
- **Pomodoro auto-structure.** Timers of 30 min or more are split into 25-min focus blocks with 5-min breaks (15 min every fourth) inside one session that always ends on focus. Shorter timers are never split. Toggle per timer or in Settings → Timers.
- **Distinct sound cues** for session complete, break start, back-to-focus and resume — a small additive synth replaces the old raw beeps. Preview in Settings → Audio.
- **Bring your own LLM key.** Ask Nerva now supports OpenAI, Anthropic, Google Gemini, OpenRouter and any OpenAI-compatible endpoint next to local Ollama. Keys stay on your device.
- **World clocks** in the sidebar (up to 6 zones, offset vs you, ±1 day).
- **Customisable dashboard.** Settings → Layout: show, hide and reorder sidebar sections.
- **Feedback & ratings.** Settings → Feedback or `Ctrl+K → Send feedback`; a one-tap rating card appears once after a week.
- **What's new** dialog after every update (this one).
- **Nerva Pro** (early access): one key for all your devices (Monthly 2 · Yearly 3 · Lifetime 5), device management and "lost your key?" recovery in Settings → Pro; key + invoice emailed on purchase, expiry reminders before renewal. Pro status is verified by the Rust core with a signed device token. Buy at nerva.bytical.ai/#pro.

### Fixed
- Sticky-note pop-outs spawned partly off-screen on HiDPI / multi-monitor setups (logical vs physical pixel mix-up). Esc or Ctrl+W now closes any pop-out.
- Habits rail on the dashboard did not refresh after adding a habit.
- Timer digits were invisible in the light theme; markdown preview colours and heatmap cells now follow the theme too.
- Pausing a long timer no longer looks like a separate "break" timer.
- Focus menu closes with Esc; deleting an open task or a running timer asks first.

### Changed
- Product name is now shown as **Nerva by Bytical** across the app, popups and website.

## v0.1.11 — 2026-07-14

### New
- Opt-in anonymous weekly usage ping with an explicit consent dialog.
- Deep `/data` analytics dashboard on the website; AUR package `nerva-desktop-bin`.

### Fixed
- Sticky-note header overflow pushed the close button off-screen with long titles.

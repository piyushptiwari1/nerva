# Changelog

All notable changes to Nerva by Bytical. The in-app "What's new" dialog and the
GitHub release body are generated from this file — keep each version under a
`## vX.Y.Z` heading with `### ` sub-sections and plain bullets.

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

# Nerva by Bytical — Platform Functionality Matrix

Single source of truth for feature parity. ✅ shipped · 🟡 partial/known issue · ⛔ not applicable · ⬜ not yet · 📐 planned

| Feature | Linux (deb/AppImage/rpm/AUR/Snap/Flatpak) | Windows (NSIS/MSI/MSIX/winget) | macOS | Android | Web (nerva.bytical.ai) | Notes |
|---|---|---|---|---|---|---|
| Parallel wall-clock timers | ✅ | ✅ | ⬜ (builds, untested) | 📐 | ⛔ | Event-sourced; survives sleep/reboot |
| Pomodoro auto-structure (phases) | ✅ v0.1.12 | ✅ v0.1.12 | ⬜ | 📐 | ⛔ | `plan_phases()` in `timers/mod.rs` |
| Phase-transition sounds (focus/break/resume) | ✅ v0.1.12 | ✅ v0.1.12 | ⬜ | 📐 (system sounds) | ⛔ | Synthesised, no assets |
| Ambient noise (white/pink/brown) | ✅ | ✅ | ⬜ | 📐 | ⛔ | |
| OS notification on completion | ✅ | ✅ | ⬜ | 📐 | ⛔ | tauri-plugin-notification |
| Do-Not-Disturb toggle | 🟡 GNOME only | ⬜ | ⬜ | 📐 | ⛔ | gsettings; KDE + Windows Focus Assist planned |
| Sticky pop-out notes | ✅ (X11 positioned; Wayland compositor-placed) | ✅ | ⬜ | ⛔ | ⛔ | DPI clamp fix v0.1.12; Esc closes |
| Timer / Habits / Tasks floating widgets | ✅ | ✅ | ⬜ | ⛔ | ⛔ | Pin = always-on-top |
| Markdown notes + FTS5 search | ✅ | ✅ | ⬜ | 📐 | ⛔ | |
| Semantic note search (Ollama embeddings) | ✅ | ✅ | ⬜ | ⬜ | ⛔ | Requires Ollama |
| Ask Nerva (LLM) — Ollama | ✅ | ✅ | ⬜ | ⬜ | ⛔ | |
| Ask Nerva — BYO keys (OpenAI/Anthropic/Gemini/OpenRouter/custom) | ✅ v0.1.12 | ✅ v0.1.12 | ⬜ | 📐 | ⛔ | Keys stored device-local |
| Habits (bool/count/amount, heatmap, streaks) | ✅ | ✅ | ⬜ | 📐 | ⛔ | Rail refresh bug fixed v0.1.12 |
| Tasks (priority, due, reorder, timer-linked) | ✅ | ✅ | ⬜ | 📐 | ⛔ | |
| Kanban board | 📐 | 📐 | 📐 | 📐 | ⛔ | See WORKLIST §8 |
| Workspaces | ✅ | ✅ | ⬜ | 📐 | ⛔ | |
| World clocks | ✅ v0.1.12 | ✅ v0.1.12 | ⬜ | 📐 | ⛔ | |
| Customisable sidebar layout | ✅ v0.1.12 | ✅ v0.1.12 | ⬜ | 📐 | ⛔ | |
| Light / dark theme | ✅ | ✅ | ⬜ | 📐 | ✅ | Hard-coded colours audited v0.1.12 |
| Command palette (Ctrl+K) | ✅ | ✅ | ⬜ | ⛔ | ⛔ | |
| Global shortcuts | ✅ | ✅ | ⬜ | ⛔ | ⛔ | |
| Tray icon | ✅ | ✅ | ⬜ | ⛔ | ⛔ | |
| Auto-update (signed) | ✅ AppImage | ✅ NSIS | ⬜ | ⛔ (store) | ⛔ | minisign key in `secrets/` |
| Crash logs (Diagnostics tab) | ✅ | ✅ | ⬜ | 📐 | ⛔ | |
| Anonymous weekly telemetry (opt-in) | ✅ | ✅ | ⬜ | 📐 | ✅ (edge fn) | Payload v2 planned (see below) |
| In-app rating / feedback | ✅ v0.1.12 | ✅ v0.1.12 | ⬜ | 📐 | ✅ `/api/feedback` | |
| Backup export / import (.zip) | 📐 | 📐 | 📐 | 📐 | ⛔ | Foundation for Drive sync |
| Google Drive encrypted sync (Pro) | 📐 | 📐 | 📐 | 📐 | ⛔ | WORKLIST §4 |
| Paid licence (PayU) | ⬜ | ⬜ | ⬜ | ⬜ | ✅ checkout exists | Entitlement JWT planned |
| Download geo + usage dashboard | ⛔ | ⛔ | ⛔ | ⛔ | ✅ `/data` | Private `nerva-metrics` repo |

## Telemetry payload v2 (planned, opt-in only)

Adds *aggregate* detail per install — still no note contents, task titles or habit names.

```jsonc
{
  "v": 2,
  // …v1 fields…
  "timers": { "by_preset_min": {"25": 12, "50": 3, "90": 1, "custom": 4}, "pomodoro_sessions_7d": 6, "phase_breaks_taken_7d": 14, "avg_pause_ms": 42000 },
  "habits": { "n_bool": 3, "n_amount": 1, "completion_7d": 0.71, "logged_days_7d": 5 },
  "notes":  { "n": 14, "edited_7d": 6, "sticky_opens_7d": 9, "avg_body_chars": 640 },
  "tasks":  { "created_7d": 9, "completed_7d": 6, "with_timer_7d": 2 },
  "ui":     { "theme": "light", "layout_changed": true, "world_clocks": 2, "ai_provider": "openai" }
}
```

## Adding a feature

1. Add a row here in the same PR.
2. Tag the component with `// matrix: <Feature name>` so a future lint can cross-check.
3. If the feature is desktop-only, mark Android ⛔ or 📐 explicitly — don't leave it blank.

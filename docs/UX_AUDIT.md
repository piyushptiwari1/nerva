# Nerva by Bytical — UI/UX Audit (v0.1.12 cycle)

Principles: one accent · three text tones (`ink-100/300/400`) · 8-pt spacing · every destructive action confirms or undoes · every overlay/popup has **Esc + drag + pin** · every empty state teaches exactly one thing · no hard-coded colours outside user data (timer/habit/workspace swatches).

Status: ✅ fixed this cycle · 🛠 partially · ⬜ open

| Component | Purpose | Issues found | Fix / suggestion | Status |
|---|---|---|---|---|
| `StickyNote` | Pop-out paper note | Spawned off-monitor on HiDPI/multi-monitor (Rust DPI bug); no Esc/Ctrl+W to close; long title pushed `×` off-screen (fixed last cycle). Amber palette is **intentional** (paper metaphor) — not a theme bug, but offer 4 paper tints later. | Logical-pixel clamp in `spawn_popup`; Esc/Ctrl+W → close; aria-labels on Edit/Preview toggle | ✅ |
| `TimerStage` | Focus stage, presets, cards | Ring digits `fill="#e3e6ec"` invisible on light theme; ring track `rgba(255,255,255,.06)`; delete `×` no confirm, no aria-label; no phase awareness; pause looked like a separate "break" | `currentColor` + theme track; confirm on delete; phase pill + session track; auto-breaks toggle in new-timer form | ✅ |
| `TimerWidget` | Floating timer | Header says "Nerva timer"; no phase info; no Esc | Brand header "Nerva by Bytical"; phase line; Esc hides | ✅ |
| `HabitsRail` | Sidebar habits | Never refreshed after adding habits in overlay (no `habit:changed` sub); `today` frozen at mount; icon buttons lack aria-labels | Subscribe to events; recompute today per refresh; aria-labels | ✅ |
| `HabitsPane` | Habit tracker overlay | Delete without confirm (row menu); some `rgba(255,255,255,…)` heatmap cell colours dim on light theme | Confirm; `var(--hairline)`-based empty cell | 🛠 (colours) |
| `HabitsWidget` | Floating habits | +/− buttons lack aria-labels; no Esc | aria-labels; Esc hides | ✅ (Esc) / ⬜ (aria) |
| `TasksPanel` | Sidebar tasks | Delete `×` no confirm; priority/checkbox buttons lack aria-labels; truncated titles lack tooltip | confirm; aria-labels; `title=` | 🛠 |
| `TasksWidget` | Floating tasks | Icon-only buttons lack aria-labels; no Esc | Esc hides; aria-labels | ✅ (Esc) / ⬜ (aria) |
| `NotesPanel` | Notes list + editor | `window.confirm` on delete (native, un-themed); empty state has no CTA | Keep confirm (safe) but themed later; add "+ New note" in empty state | ⬜ |
| `Sidebar` | Left column | Fixed order/sections; `+`/`×` lack aria-labels; no clock | Layout store (reorder/hide); `WorldClock` section; aria-labels | ✅ |
| `SettingsPane` | Settings tabs | AI tab is Ollama-only; no Feedback tab; no Layout tab; tabs lack `aria-selected`; About says just "Nerva" | Provider picker + keys; Feedback tab; Layout tab; branding | ✅ |
| `FocusMenu` | Sound/DND popover | No Esc to close; toggles lack `aria-pressed` | Esc; aria-pressed | ✅ |
| `CommandBar` | Top bar | Brand only "Nerva" | "Nerva **by Bytical**" wordmark | ✅ |
| `CommandPalette` | Ctrl+K | No "no results" state; rows lack aria-labels; no feedback / world-clock commands | Empty state; new commands | 🛠 |
| `AskNerva` | LLM modal | Ollama-only; errors only in console; model select no aria-label | Provider-aware health line; inline error banner | 🛠 |
| `TimelineBar` | Day timeline | Focused label truncates without tooltip | `title=` | ⬜ |
| `Tutorial` | First-run tour | No brand line; doesn't mention pomodoro auto-structure | Add "Nerva by Bytical" welcome + one slide on auto breaks | ⬜ |
| `TelemetryConsent` | Opt-in dialog | Fine | — | — |
| `KeyboardCheatsheet` | Shortcuts | Missing new shortcuts (Esc in popups, Ctrl+W) | Add rows | ⬜ |
| `ErrorBoundary` / `PinButton` | — | Fine | — | — |

## Global style debt
- `.prose-nerva` heading/code/hr colours hard-coded for dark → moved to CSS vars (✅).
- `caret-color: #a8bdff` hard-coded → `rgb(var(--accent-glow))` (✅).
- Mixed `text-[10px]` / `text-[11px]` / `text-xs` — standardise on `text-[11px]` for meta, `text-xs` for body-small (⬜ sweep).
- Native `confirm()` is acceptable for now (safe + accessible); replace with a themed `ConfirmDialog` once one exists (⬜).

## Premium polish backlog (ordered by impact)
1. Motion: 120–180 ms ease-out on every panel/overlay open (framer-motion already present); no bounce.
2. Typography: Inter Display for the big timer digits, tabular numerals everywhere numbers change.
3. Card elevation: single `glass` surface + `hairline`; drop nested glass-in-glass (TimerStage new-timer form).
4. Empty states: one sentence + one primary action, no paragraphs.
5. Focus rings: keep accent outline but reduce to 1.5 px inside glass panels.
6. Iconography: replace unicode glyphs (⋮⋮ ↗ ×) with a consistent 16-px stroke icon set (lucide) — biggest single "premium" lever.
7. Sticky note paper tints (yellow/blue/green/pink) + font size stepper.

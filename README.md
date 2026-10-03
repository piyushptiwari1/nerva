<p align="center">
  <strong>Nerva by Bytical</strong><br/>
  <em>The focus workspace that never forgets.</em>
</p>

<p align="center">
  <a href="https://nerva.bytical.ai"><img alt="Website" src="https://img.shields.io/badge/website-nerva.bytical.ai-7c9cff"></a>
  <a href="https://github.com/piyushptiwari1/nerva/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/piyushptiwari1/nerva?label=release&color=7dd6a8"></a>
  <a href="https://github.com/piyushptiwari1/nerva/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/piyushptiwari1/nerva/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/piyushptiwari1/nerva/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/piyushptiwari1/nerva/total?color=e8b86d"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue"></a>
  <a href="https://github.com/piyushptiwari1/nerva/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/piyushptiwari1/nerva?style=social"></a>
</p>

A free, offline-first focus workspace for **Linux, Windows and Android**. Pomodoro
timers with automatic breaks that survive sleep and reboot, sticky markdown notes
that float above any window, a year-long habit heatmap, tasks, world clocks, and
an optional AI assistant that runs on your own model or key. No account. No cloud.
Telemetry is opt-in only and never contains your content.

→ **Website & downloads:** https://nerva.bytical.ai
→ **Changelog:** https://nerva.bytical.ai/changelog · [`CHANGELOG.md`](CHANGELOG.md)
→ **Product story:** [`docs/STORY.md`](docs/STORY.md) · **Roadmap:** [`docs/WORKLIST.md`](docs/WORKLIST.md)

> ⭐ **If Nerva helps you focus, star this repo** — it is the single biggest signal that tells us to keep going.
> 💬 **Tell us what to build next:** `Ctrl+K → Send feedback` inside the app, the [website form](https://nerva.bytical.ai/#feedback), or [open an issue](https://github.com/piyushptiwari1/nerva/issues/new/choose).

## What you get

| | |
|---|---|
| **Pomodoro, automatically** | Timers ≥ 30 min are split into 25/5 focus–break phases (15-min break every 4th) inside *one* session that always ends on focus. Distinct cues for "break" and "back to work". Shorter timers are left alone. |
| **Parallel wall-clock timers** | Run a 90-min deep-work block, an 8-min tea brew and a 20-min call countdown at once. Survives sleep, suspend and reboot. |
| **Sticky markdown notes** | Pop any note out as a small always-on-top window. Autosaves every 250 ms and on every close path. Esc / Ctrl+W dismisses. |
| **Habits** | Yes/no or amount habits, 4-state daily log, streaks, 30-day and all-time heatmaps. Missing a day doesn't shame you. |
| **Tasks** | Priority, due times, drag reorder, floating widget. Timer-linked tasks auto-complete. |
| **Android home-screen widgets** | Nerva Mobile: Focus, Tasks, Habits and Note. Configure each widget independently, control sessions, complete/undo tasks, log habits and capture notes without the full app. |
| **Ask Nerva** | Local Ollama by default — or bring your own OpenAI / Anthropic / Gemini / OpenRouter / OpenAI-compatible key. Keys stay on-device. |
| **Your dashboard** | Reorder or hide sidebar sections; up to six world clocks. Light and dark themes. |
| **Command palette** | `Ctrl+K` for everything. `Ctrl+,` settings · `Ctrl+H` habits. |
| **Crash-safe store** | Event-sourced SQLite (append-only log, FTS5 search). Replay-on-launch recovery. |
| **Nerva Pro (optional)** | Licence key that funds development and unlocks encrypted Google Drive backup / multi-device restore as it ships. Everything above stays free. [Plans →](https://nerva.bytical.ai/#pro) |

Native Rust core (Tauri 2), ≈ 80 MB RAM idle. Not Electron. Apache-2.0.

## Download

Direct links always resolve to the **latest published release** (fronted by the bytical.ai CDN, no GitHub redirect):

| Platform | Format | Link |
|---|---|---|
| **Linux** (Ubuntu 22.04/24.04, Debian) | `.deb` | https://nerva.bytical.ai/download/linux/deb |
| **Linux** (any distro, portable) | `.AppImage` | https://nerva.bytical.ai/download/linux/appimage |
| **Linux** (Fedora, openSUSE, RHEL) | `.rpm` | https://nerva.bytical.ai/download/linux/rpm |
| **Windows 10 / 11** | `.exe` (NSIS) | https://nerva.bytical.ai/download/windows/exe |
| **Windows 10 / 11** | `.msi` | https://nerva.bytical.ai/download/windows/msi |
| **Android 7+** | `.apk` (Nerva Mobile) | https://nerva.bytical.ai/download/android/apk |

**Android v0.1.14 users:** Nerva Mobile installs separately under
`ai.bytical.nerva.mobile` because the legacy APK used a temporary signing key.
The old app and its data remain intact; there is no automatic import. Keep
v0.1.14 installed if you need its content. Future Nerva Mobile APKs use a
permanent signing key. Google Play and iOS remain planned.

Or via a package manager:

```bash
sudo snap install nerva               # Linux (any snap-enabled distro)
yay -S nerva-desktop-bin              # Arch (AUR)
winget install Bytical.Nerva          # Windows
```

Desktop direct-download builds support signed updates, verified locally, and show a **"What's new"** card after each update. Android APK updates are downloaded from the website.
Windows builds are signed with the Bytical self-signed certificate — first run shows SmartScreen "Unrecognized app";
click *More info → Run anyway*, or install the [trust certificate](https://nerva.bytical.ai/cert) once.

## Platform support

See [`docs/PLATFORM_MATRIX.md`](docs/PLATFORM_MATRIX.md) for the full feature × platform table.
Linux and Windows are first-class. Android has a phone shell and native home-screen widgets;
macOS builds but is untested. iOS and Google Play publishing are planned.

## Architecture

```
React 18 (Vite + TS + Tailwind)          ← main window + pop-out windows share one bundle
        │ Tauri 2 IPC (commands + events)
        ▼
Rust runtime
   ├─ store/         event-sourced SQLite (append-only) + FTS5 + projections
   ├─ timers/        wall-clock multi-timer engine with pomodoro phases
   ├─ notes/ tasks/ habits/ workspaces/
   ├─ audio/         additive-synth cues + pink/brown noise (no audio assets)
   ├─ intelligence/  Ollama / OpenAI / Anthropic / Gemini / OpenRouter streaming
   └─ ipc/           Tauri command surface, popup placement (DPI-aware)
```

Every state mutation is an append-only event. On launch the runtime replays the log to
reconstruct in-memory state — timers use wall-clock timestamps so they keep counting
correctly across sleep, suspend and power loss. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Development

```bash
npm install
rustup default stable
# Linux build deps: libwebkit2gtk-4.1-dev build-essential libxdo-dev libssl-dev \
#                   libayatana-appindicator3-dev librsvg2-dev libasound2-dev pkg-config

npm run tauri:dev            # hot reload, frontend + backend
npm run build                # tsc --noEmit && vite build
(cd src-tauri && cargo test) # Rust unit + integration tests
npm run tauri:build          # release bundles in src-tauri/target/release/bundle
```

CI runs dashboard and signing tests, `tsc`, `vite build`, `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`, and
verifies that `CHANGELOG.md` has a section for the version in `package.json`. Tagging `vX.Y.Z`
builds Linux, Windows and Android after a signing preflight, publishes the GitHub release
with notes from `CHANGELOG.md`, and updates AUR/Snap plus submits winget updates.
The separate Android Widgets workflow tests native behavior on an API 35 emulator.

### Website

`web/` is a static site plus Vercel edge functions: download proxy (`/download/*`, logged to a
private metrics repo with coarse geo), opt-in telemetry ingest, feedback, PayU checkout / callback
(Pro licences + donations), licence verification, and the password-gated `/data` dashboard.

## Data location

`$XDG_DATA_HOME/ai.bytical.nerva/nerva.db` (typically `~/.local/share/ai.bytical.nerva/`) on Linux;
`%APPDATA%\ai.bytical.nerva\` on Windows. On Android the database is in Nerva Mobile's
app-private data directory, isolated from the legacy app. Stop the app before manually
copying its database and associated WAL files; general backup/export is still planned.

## Contributing

Bug reports and feature requests: [issue templates](https://github.com/piyushptiwari1/nerva/issues/new/choose).
Before opening a PR read [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) and add a line to `CHANGELOG.md`.

## License

Apache-2.0 — © 2026 Bytical Solutions Private Limited.

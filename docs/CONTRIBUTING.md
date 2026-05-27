# Contributing to Nerva

Thanks for considering a contribution. Nerva is opinionated — please
read this before opening a PR.

## Principles

1. **No Electron-mindset PRs.** Anything that bloats the binary,
   requires a network round-trip for normal use, or duplicates an OS
   primitive is suspect.
2. **Cognitive-state continuity is sacred.** New features must
   survive an SSH `kill -9` of the app at any moment. If you can't
   crash-test it, it isn't ready.
3. **No fake rewards.** No streaks-that-shame, no confetti, no
   "great job!" copy. Nerva is a tool, not a friend.
4. **Keyboard-first.** Every action must have a discoverable keyboard
   path before it ships.
5. **GPU-light.** No blur-on-blur, no fullscreen WebGL backgrounds.
   Target a 5-year-old Ubuntu laptop on integrated graphics.

## Setup

```bash
git clone git@github.com:piyushptiwari1/nerva.git
cd nerva
npm install
rustup default stable
sudo apt install -y libwebkit2gtk-4.1-dev build-essential libxdo-dev \
  libssl-dev libayatana-appindicator3-dev librsvg2-dev pkg-config
npm run tauri:dev
```

## Layout

See [ARCHITECTURE.md](ARCHITECTURE.md).

## Commit style

Conventional Commits:

```
feat(timers): add nested timer chains
fix(store): fence event append behind WAL checkpoint
docs(mobile): clarify Live Activities update model
```

Scope from the module list (`timers`, `notes`, `workspaces`, `store`,
`ipc`, `audio`, `habits`, `mobile`, `docs`).

## PR checklist

- [ ] `cargo fmt && cargo clippy --all-targets -- -D warnings` clean
- [ ] `npm run build` succeeds
- [ ] If the change touches the event schema, the new event kind is
      documented in `ARCHITECTURE.md` *and* old events still replay
      correctly (forward compatibility is mandatory).
- [ ] If the change adds a Tauri command, it's exported from `ipc/`,
      registered in `lib.rs`, and added to `src/lib/ipc.ts`.
- [ ] If the change touches UI, it's keyboard-navigable.

## Releases

Tagged via GitHub Releases. CI builds `.deb` + `.AppImage` for
Linux (P0), then adds `.msi` (Windows) and `.dmg` (macOS) in P6.

## License

Apache-2.0. By contributing you agree to license your work under the
same terms.

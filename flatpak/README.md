# Flatpak / Flathub distribution

Nerva ships to Flathub as `ai.bytical.nerva` — the same id as the
Tauri identifier, so the .deb / .rpm / AppImage / Flatpak / Snap
builds all share the same DBus name, GSettings path, and tray-icon
StatusNotifier slot. A user moving between formats sees the same
data.

```
flatpak install flathub ai.bytical.nerva
flatpak run ai.bytical.nerva
```

## Files in this directory

- `ai.bytical.nerva.yaml` — Flatpak manifest. Repacks the signed
  upstream `.deb` from a GitHub Release via the `extra-data` source
  type, so the binary on Flathub is bit-for-bit identical to the
  one on GitHub Releases. Avoids vendoring the Rust + Node toolchain
  into Flathub's offline build sandbox.
- `ai.bytical.nerva.metainfo.xml` — AppStream metadata (store name,
  summary, description, screenshots, releases, OARS rating). Validate
  before every PR with:
  ```
  appstreamcli validate --pedantic flatpak/ai.bytical.nerva.metainfo.xml
  ```
- `ai.bytical.nerva.desktop` — `.desktop` file with the
  `ai.bytical.nerva` basename and `StartupWMClass` so the runtime
  wires window-class → tray icon → notifications → store entry.

## Submission flow (one-time)

1. Fork `github.com/flathub/flathub`.
2. `git checkout -b new-pr/ai.bytical.nerva`.
3. Copy these three files into the branch root.
4. Open a PR titled `Add ai.bytical.nerva`.
5. Reviewers run the build + AppStream validation + screenshots
   check. Expect 1–2 review rounds. On merge a new repo
   `flathub/ai.bytical.nerva` is created — that becomes the repo we
   PR into for every subsequent release.

## Update flow (every release)

1. Bump the `.deb` URL + sha256 + size in `ai.bytical.nerva.yaml`
   `sources.extra-data`. Compute with:
   ```
   sha256sum Nerva_<ver>_amd64.deb
   stat -c%s Nerva_<ver>_amd64.deb
   ```
2. Add a new `<release version="<ver>" date="…">` block at the top
   of `<releases>` in `ai.bytical.nerva.metainfo.xml`.
3. Open a PR against `flathub/ai.bytical.nerva` main with those two
   files. Flathub's bot autobuilds and publishes after review.

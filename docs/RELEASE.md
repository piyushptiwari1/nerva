# Nerva — Release & Distribution Runbook

Identity (Bytical Partner Center):

```
Seller ID:      90032360
Publisher Name: Bytical Solutions Private Limited
Publisher ID:   byticalsolutionsprivatelimited1736190787784
Partner ID:     6941092
Tauri identifier: ai.bytical.nerva
```

Distribution surfaces (all driven by one tag push):

| Channel | OS | Trigger | Cost |
|---|---|---|---|
| GitHub Releases | Linux + Windows | `git tag vX.Y.Z && git push --tags` | $0 |
| Vercel landing page | n/a | every git push to `main` | $0 |
| winget | Windows | tag → CI auto-PRs winget-pkgs | $0 |
| Snap Store | Linux | `snapcraft upload` after each build | $0 |
| AUR | Linux | manual `git push` to AUR repo | $0 |
| Microsoft Store | Windows | manual `.msixupload` to Partner Center (review 1–3 days) | $0 (one-time $99 enrollment already done) |
| Flathub | Linux | manual PR (review weeks) — defer to v0.2 | $0 |

---

## One-time setup (do these once, in order)

### A. Generate signing keys (local machine, never re-run)

```bash
./scripts/gen-signing-cert.sh   # produces secrets/bytical-codesign.pfx
./scripts/gen-updater-keys.sh   # produces secrets/tauri-updater.key
```

Then update [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json):

- Replace `"pubkey": "REPLACE_WITH_GENERATED_PUBKEY"` with the contents of
  `secrets/tauri-updater.key.pub`.

### B. Add GitHub repo secrets

Push the repo to `github.com/bytical-ai/nerva` first, then:

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret name | Value source |
|---|---|
| `WINDOWS_CERTIFICATE` | contents of `secrets/bytical-codesign.pfx.b64` |
| `WINDOWS_CERTIFICATE_PASSWORD` | PFX password you chose |
| `WINDOWS_CERTIFICATE_THUMBPRINT` | contents of `secrets/bytical-codesign.thumbprint.txt` |
| `TAURI_SIGNING_PRIVATE_KEY` | contents of `secrets/tauri-updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | updater-key password you chose |
| `WINGET_TOKEN` | a GitHub PAT with `public_repo` scope (for the winget-pkgs PR) |

### C. Vercel — deploy nerva.bytical.ai

1. https://vercel.com/new → import the `bytical-ai/nerva` repo.
2. **Root directory**: `web`.
3. **Build command**: `npm run build`.
4. **Output directory**: `dist`.
5. Deploy → assign domain `nerva.bytical.ai` (Project Settings → Domains).
6. Add DNS `CNAME nerva → cname.vercel-dns.com` on Bytical's DNS provider.

### D. Snap Store — reserve the name

1. `sudo snap install snapcraft --classic`
2. `snapcraft login` (use your Snapcraft account)
3. `snapcraft register nerva`
4. After your first GitHub release lands: download the `.deb`, place it in
   `src-tauri/target/release/bundle/deb/`, then `cd /` and run `snapcraft` in
   the repo root → produces `nerva_0.1.0_amd64.snap` → `snapcraft upload --release=stable nerva_0.1.0_amd64.snap`.

### E. Microsoft Store — reserve the name + first submission

See [packaging/msix/README.md](../packaging/msix/README.md). Summary:

1. Sign in to https://partner.microsoft.com/en-us/dashboard/home (piyush@bytical.ai).
2. Apps and games → New product → MSIX or PWA app → reserve **`Nerva`**.
3. Record the three identity strings → paste into `packaging/msix/AppxManifest.xml`.
4. After your first signed Windows release: convert MSI → MSIX, upload to Partner Center.

### F. AUR

```bash
git clone ssh://aur@aur.archlinux.org/nerva-bin.git
# edit PKGBUILD pointing to GitHub release tarball + SHA256
makepkg --printsrcinfo > .SRCINFO
git add PKGBUILD .SRCINFO && git commit -m "v0.1.0" && git push
```

---

## Per-release flow (do this for every X.Y.Z)

1. Bump version in three places (must match):
   - `package.json` → `"version"`
   - `src-tauri/tauri.conf.json` → `"version"`
   - `src-tauri/Cargo.toml` → `[package] version`

2. Update `CHANGELOG.md`.

3. Commit + tag + push:
   ```bash
   git add -A
   git commit -m "chore(release): v0.1.0"
   git tag v0.1.0
   git push && git push --tags
   ```

4. CI builds for ubuntu-22.04 + windows-latest, signs, and creates a **draft**
   GitHub Release. Verify the draft, then **Publish**.

5. CI auto-submits the winget-pkgs PR.

6. (Manual, optional same day) Snap Store upload + MSIX submission.

---

## Verifying users on each OS

### Ubuntu 22.04
```bash
sudo apt install ./Nerva_0.1.0_amd64.deb
```

### Ubuntu 24.04
Same `.deb` — its dependency declarations resolve identically on 24.04. If you
hit `libwebkit2gtk-4.1-0` not found, fall back to the AppImage:
```bash
chmod +x Nerva_0.1.0_amd64.AppImage
./Nerva_0.1.0_amd64.AppImage
```

### Windows 10
Double-click `Nerva_0.1.0_x64-setup.exe` → SmartScreen warning → "More info" →
"Run anyway". One-time trust: install `bytical-codesign.crt` into Trusted Root
Certification Authorities.

### Windows 11
Same as Windows 10. MSI alternative: `msiexec /i Nerva_0.1.0_x64_en-US.msi`.

---

## Cost summary

| Item | Cost |
|---|---|
| Self-signed cert | $0 (already accepted; SmartScreen warning is the trade-off) |
| Tauri updater keypair | $0 |
| GitHub Actions | $0 (public repo, free minutes) |
| Vercel hobby plan | $0 |
| Snap Store | $0 |
| Microsoft Partner Center | already enrolled by Bytical |
| Apple Developer | n/a (macOS deferred) |
| **Total recurring** | **$0/yr** |

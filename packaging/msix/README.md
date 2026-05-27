# Microsoft Store (MSIX) submission for Nerva

Identity (provided by Microsoft Partner Center for **Bytical Solutions Private Limited**):

```
Seller ID:      90032360
Publisher Name: Bytical Solutions Private Limited
Publisher ID:   byticalsolutionsprivatelimited1736190787784
Partner ID:     6941092
```

The MSIX **Publisher** field in `AppxManifest.xml` is *not* the human-readable name —
it must be the **exact CN= string Microsoft assigns to your reserved app**. You will
get that string in Partner Center after step 1 below.

## Step 1 — Reserve the product name in Partner Center

1. Sign in to https://partner.microsoft.com/en-us/dashboard/home as `piyush@bytical.ai`.
2. **Apps and games → Overview → New product → MSIX or PWA app**.
3. Reserve name: **`Nerva`**.
4. Open the new app → **Product identity** (left nav) and record the three values:
   - **Package/Identity/Name** (e.g. `12345BytialSolutionsPrivateLimited.Nerva`)
   - **Package/Identity/Publisher** (e.g. `CN=A1B2C3D4-E5F6-7890-ABCD-EF1234567890`)
   - **Package/Properties/PublisherDisplayName** (= `Bytical Solutions Private Limited`)
5. Paste those three strings into [`AppxManifest.xml`](./AppxManifest.xml) — replace the
   three `__REPLACE_*__` placeholders.

## Step 2 — Build the .msix from the .msi

GitHub Actions produces a `.msi` for every tag. To convert MSI → MSIX:

**Option A (recommended, fully automated):** add an `msix` job to `release.yml` using
[`microsoft/setup-msbuild`](https://github.com/microsoft/setup-msbuild) +
[`MSIX Packaging Tool CLI`](https://learn.microsoft.com/en-us/windows/msix/packaging-tool/tool-overview).
Sample command:

```pwsh
makeappx.exe pack `
  /d staged-files `
  /p Nerva.msix `
  /l
```

**Option B (one-time manual, easier for first submission):**
1. On a Windows 10/11 machine install **MSIX Packaging Tool** (free, Microsoft Store).
2. Run it → "Application package" → "Create package on this computer".
3. Point it at the `.msi` from the GitHub Release.
4. When prompted for `Publisher`, paste the **CN=...** string from step 1 above.
5. Save as `Nerva-0.1.0.msix`.

## Step 3 — Sign the MSIX

For Store submission you have two valid choices:

- **Leave it unsigned (recommended for self-signed-cert teams):** upload
  `Nerva-0.1.0.msixupload` to Partner Center → Microsoft re-signs with the Store
  cert during certification. Users installing from the Store never see the
  self-signed cert at all.
- **Sign with Bytical self-signed PFX:** only useful for sideloading; not needed
  for the Store path.

## Step 4 — Submit

1. Partner Center → your reserved app → **Packages** → upload `.msixupload`.
2. Fill **Pricing and availability** → Free, all markets.
3. **Properties** → Category: Productivity. System requirements: Windows 10 1809+.
4. **Store listings** → English (United States) → paste shortDescription /
   longDescription from `bundle.shortDescription` / `bundle.longDescription` in
   `tauri.conf.json`. Upload screenshots (1366×768 or 1920×1080, PNG).
5. **Submit for certification**. Review = 1–3 business days.

## Step 5 — Disable Tauri auto-updater on the Store build

The Microsoft Store handles its own update channel. To prevent Tauri's updater
from competing with it, build the Store MSIX with the `store-build` Cargo feature:

```bash
npm run tauri build -- --features store-build --bundles msi
```

The `store-build` feature gates out the `tauri-plugin-updater` registration in
`src-tauri/src/lib.rs` (TODO once the plugin is added).

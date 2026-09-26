# Nerva — Mobile (Android shipped in beta · iOS planned)

> **Status (v0.1.14):** Android APK builds from the same repo via Tauri 2
> mobile and is attached to every GitHub release. iOS is fully planned but
> **on hold until Bytical has an Apple Developer account** (needs macOS +
> $99/yr for signing/TestFlight). Nothing in the codebase blocks it.
>
> The earlier native-companion spec (SwiftUI/Compose over a UniFFI core) is
> archived in `MOBILE_NATIVE_COMPANION_ARCHIVED.md` for the widget ideas.

## Decision: Tauri 2 mobile, not native shells

| | Tauri 2 mobile (chosen) | Native companions (previous plan) |
|---|---|---|
| Rust core reuse (timers, SQLite log, licence) | ✅ identical crate | ✅ via UniFFI, but a second build system |
| UI reuse | ✅ same React panels, phone shell | ❌ two new UIs |
| Time to first APK | days | months |
| Home-screen widgets / Live Activities | ⬜ later via a small native plugin | ✅ first-class |
| Maintenance | one release pipeline | three |

Widgets are nice-to-have; a working app on the phone is the feature.

## What's in the Android build

- **Shell:** `src/mobile/MobileApp.tsx` — one column, bottom tabs
  Focus · Tasks · Habits · Notes, settings gear. Picked at boot by
  `isMobile()` (`src/lib/platform.ts`; UA sniff, `?shell=mobile` forces it
  in a browser for layout work).
- **Same Rust core** — `src-tauri/` compiles for
  `aarch64-linux-android` (+ armv7/x86/x86_64 in CI). Desktop-only pieces are
  `#[cfg(desktop)]`: tray, single-instance, global shortcuts, updater,
  process plugin, floating windows (`spawn_popup`), `reveal_data_dir`, and
  the rodio audio engine (`audio/mobile.rs` is a no-op reporting
  `available=false`). Their crates live in a
  `[target.'cfg(not(any(target_os="android", target_os="ios")))'.dependencies]`
  table and their permissions in `capabilities/desktop.json`
  (`platforms: [linux, macOS, windows]`).
- **Background alerts:** Android suspends the WebView, so instead of the
  250 ms tick we hand the OS scheduled notifications for every phase
  boundary and the session end (`src/mobile/alerts.ts`,
  `plugin-notification` `schedule`). Re-armed whenever the running set
  changes; `cancelAll()` first so it's idempotent. Manifest permissions:
  `POST_NOTIFICATIONS`, `SCHEDULE_EXACT_ALARM`, `RECEIVE_BOOT_COMPLETED`.
- **Pro:** licence activation works unchanged — a phone is just another
  device against the plan's limit (2/3/5).
- **Ask Nerva:** cloud providers (OpenAI/Anthropic/Gemini/OpenRouter/custom)
  work; Ollama needs a reachable endpoint (set it to your desktop's LAN IP).
- **Not on mobile:** pop-out windows, tray, keyboard shortcuts/palette, DND
  toggle, synthesized audio, sidebar layout editor, auto-updater (store).

## Building

```bash
./scripts/android-setup.sh          # JDK 17 + SDK/NDK + rust targets (user-local, once)
source ~/.nerva-android.env
npm run tauri android dev           # on a connected device / emulator
npm run tauri android build --apk   # universal release APK
npm run tauri android build --apk --target aarch64   # faster, arm64 only
```

Output: `src-tauri/gen/android/app/build/outputs/apk/universal/release/`.
`src-tauri/gen/android/` is **committed** (manifest permissions, signing
config); `build/`, `.gradle`, `keystore.properties`, `*.jks` are ignored.

### Signing

`app/build.gradle.kts` reads `app/keystore.properties`
(`keyAlias`, `password`, `storeFile`). Without it the release build is
signed with the debug key so it still installs (sideload/testing).

Create the upload key once:

```bash
keytool -genkey -v -keystore ~/nerva-upload.jks -keyalg RSA -keysize 2048 \
  -validity 10000 -alias nerva-upload
base64 -w0 ~/nerva-upload.jks   # → GitHub secret ANDROID_KEYSTORE_B64
```

GitHub secrets: `ANDROID_KEYSTORE_B64`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD`. The `android` job in `release.yml` writes them into
`keystore.properties`, builds `--apk --aab`, and uploads
`Nerva_<v>_android.apk` / `.aab` to the release. **Keep the .jks backed up
offline** — Play requires the same upload key forever.

## Distribution roadmap

| Step | Channel | Status |
|---|---|---|
| A1 | GitHub release APK (sideload), website download tile | ✅ v0.1.14 |
| A2 | Google Play internal testing (AAB from CI) | ⬜ needs Play Console account ($25 one-off) |
| A3 | Play production + Data-safety form ("no data collected" unless telemetry opt-in) | ⬜ |
| A4 | F-Droid (reproducible build recipe; no proprietary deps — we have none) | ⬜ |
| A5 | Home-screen widget (Glance) via a tiny Tauri plugin reading the SQLite log | 📐 |
| A6 | Wear OS tile | 📐 |

## iOS (planned, not started)

Tauri 2 supports iOS with the same crate; expected work when unblocked:

1. Apple Developer account + a Mac (or a `macos-14` CI runner) for `tauri ios init/build`.
2. `#[cfg(desktop)]` gates already cover iOS; test the `audio/mobile.rs` path.
3. Notifications: `plugin-notification` schedules on iOS too; no exact-alarm permission needed.
4. TestFlight → App Store; privacy label "Data Not Collected".
5. Later: WidgetKit / Live Activity via a small Swift plugin.

## UX rules for mobile

- Glance, not graze — the Focus tab must be readable in <300 ms.
- No streak shaming; "This week" summary only.
- Only end-of-phase notifications; nothing mid-focus.
- Every panel used on the phone must remain usable at 360 px wide — check
  with `?shell=mobile` in a narrow browser window before shipping.

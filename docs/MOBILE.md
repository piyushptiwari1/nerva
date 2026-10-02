# Nerva — Mobile Research and Implementation

> **Baseline (v0.1.14):** Android APK available, but no native home-screen
> widgets. Desktop pop-out controls and the generated Tauri launcher icon
> were incorrectly retained. A successful APK build did not validate the
> complete mobile experience. The widget work below is in progress, not a
> claim about the published APK. iOS and Google Play publishing remain planned.
>
> The earlier native-companion spec (SwiftUI/Compose over a UniFFI core) is
> archived in `MOBILE_NATIVE_COMPANION_ARCHIVED.md` for the widget ideas.

## Research (2026-09-26)

This is a qualitative desk review of official product/help pages, their
published UI examples, and a small sample of publicly visible Google Play
reviews. It is not a usability study or a representative survey. Review
dates below matter: historical complaints are test scenarios, not claims
that a competitor still has that defect. Reddit search did not expose
readable comments, so no Reddit findings are asserted. No competitor code
or artwork is being copied.

| Competitor | Documented functionality | User-facing approach / UI | Nerva decision |
|---|---|---|---|
| [TickTick](https://ticktick.com/features) | Tasks, recurring reminders, calendar, lists/kanban, habits, Pomodoro, widgets for viewing/adding tasks | One planner spanning several jobs; consistent task context across views | Keep context, but show one job per widget instead of an entire dashboard |
| [Todoist Android widgets](https://www.todoist.com/help/todoist/features/use-a-todoist-widget-on-your-android-device-632pZA) | Project/filter selection, task list, completion, Quick Add, productivity summary, theme/font/opacity configuration | Preview during setup; direct completion in normal mode; compact mode removes the completion circle | Per-widget source selection and preview; never sacrifice a direct completion control just to fit more rows |
| [Loop Habit Tracker](https://loophabits.org/) / [F-Droid](https://f-droid.org/en/packages/org.isoron.uhabits/) | Flexible habits, progress history, score, notification actions, offline operation | Minimal interface, progress that is not destroyed by one missed day | Visible done/skipped/not-recorded states, simple increments and undo; no punitive messaging |
| [Focus To-Do](https://www.focustodo.cn/) | Task-linked Pomodoro, subtasks, repeats, reminders, time reports, cross-device access | Connect the task, focus session and history; timer is an execution tool | Show selected session name, phase and remaining time together; retain the existing Rust timer engine |
| [Google Keep widgets](https://support.google.com/keep/answer/13302793?hl=en) | Single note, note collection, quick capture; checklist toggles on the home screen | Choose the content once; keep it visible; text editing opens a dedicated editing surface | Pinned note and quick capture; native text editor rather than pretending an Android widget can host an EditText |
| [Forest](https://www.forestapp.cc/) | Focus duration, visual session progress and history, distraction-blocking features | A single prominent session state with a visual reward | Borrow clarity of the primary action, not the game, punitive failure state or decorative illustrations |

### Public feedback and resulting requirements

| Source / sample | Observation | Requirement |
|---|---|---|
| [Loop reviews](https://play.google.com/store/apps/details?id=org.isoron.uhabits&hl=en), 2026-09-07 and 2026-08-19 | Users report weak dark-theme contrast and difficulty distinguishing habit states | Status must use text/symbols as well as color; check both themes |
| [TickTick reviews](https://play.google.com/store/apps/details?id=com.ticktick.task&hl=en), 2026-07-11 and 2026-07-28 | One reviewer finds the interface difficult and wants time corrections; another values the integrated, clean feature set | Progressive disclosure, reversible actions, no raw internal event names |
| [Focus To-Do reviews](https://play.google.com/store/apps/details?id=com.superelement.pomodoro&hl=en), 2020-10-04 and 2025-01-24 | Historical lost-progress report; later praise for sync and requests for better batch interaction | Persistence/reopen tests are release gates; do not imply Nerva has cross-device sync |
| [Keep reviews](https://play.google.com/store/apps/details?id=com.google.android.keep&hl=en), 2026-09-08 and 2026-07-15 | Fast capture is valued; another reviewer requests more privacy control | Few-step capture; note content appears on the home screen only after explicit selection |
| [Todoist widget help](https://www.todoist.com/help/todoist/features/use-a-todoist-widget-on-your-android-device-632pZA) | Documents frozen widgets under some battery-management conditions | Test cold-process actions and resume, not only widgets while the app is open |

## Functionality, Intent, Problems and Use Cases

| Function | Intent and problem statement | Concrete use case | UI/UX and implementation approach |
|---|---|---|---|
| Focus widget | Opening the full app just to check/pause a session interrupts focus | Select a session, start/pause/resume it, glance at the next boundary | Native countdown, phase text, end time and primary play/pause control; reuse Rust wall-clock math |
| Tasks widget | A shortcut is not a useful list; users need to finish work in place | Pin a workspace list, complete a task, undo a mistaken completion, quick-add another | Scrollable rows, 48 dp action targets, due/priority context, in-place mutation and undo |
| Habits widget | Logging should not require navigating a tracker | Pin a habit/list, record today, increment a measured target, undo | Distinct status text, progress against target, native log/undo actions; local calendar day |
| Notes widget | Important information should stay visible without opening the editor | Pin one note, read an excerpt, edit or capture in a small native sheet | Explicit note selection, readable text, edit/capture surface without launching Tauri |
| Widget configuration | Multiple widgets must not all silently follow the same global selection | Work tasks and personal tasks on separate home pages | Persist selection per appWidgetId, preview, reconfigure, reset missing/deleted sources safely |
| Branding and phone shell | Generated icon and desktop-only buttons undermine trust | Recognize Nerva, add a habit, switch workspace, use Settings on a narrow screen | Existing Nerva artwork, consistent icons, no floating-window commands, visible close/back controls |

## Usability Contract

- Native Android widgets, not embedded WebViews or simulated widget cards.
- One clear job per widget, with a stable header/content/action hierarchy.
- At least 48 dp interactive targets; accessible labels; text and symbols
  supplement semantic color. No gesture-only essential commands.
- Resize by useful content density, never by shrinking text below legibility.
- Follow system light/dark appearance with restrained accent colors and
  Android widget corner conventions, not nested decorative cards.
- Show persisted results immediately. Keep configuration and independent
  widget instances across restart, process eviction and app upgrade.
- Use platform Chronometer/alarm facilities rather than a per-second worker.
- Reconcile app and widget changes through the same Rust state and SQLite
  event store. No second timer model, duplicate database or fake success.
- Exact-alarm/notification denial must be visible and handled. Android
  force-stop and some OEM power policies can prevent background delivery;
  do not promise an unconditional alarm guarantee.
- A small native capture/editor Activity is necessary for text input:
  Android RemoteViews do not support a normal editable text field.

## Acceptance and Verification

1. All four providers appear in the launcher widget picker with Nerva branding.
2. Configure two instances with different sources; resize both and verify isolation.
3. Start/pause/resume a timer, complete/undo a task and log/undo a habit without
   creating MainActivity or a Tauri WebView, including after process eviction.
4. Reopen the app and confirm the same data; app edits refresh pinned widgets.
5. Test empty/deleted sources, repeated taps, midnight/time-zone changes,
   denied notification/alarm permissions and restart recovery.
6. Inspect minimum-size layouts, large fonts and both themes; no clipped
   primary controls or inaccessible touch targets.
7. Run focused Rust/native tests, Android build and desktop regression gates.
8. Publish only verified results. Device/OEM tests not executed are reported
   explicitly; neither a compile nor a screenshot proves alarm delivery.

### Clean-Emulator Gate

The `Android Widgets` workflow builds the x86_64 Rust core and debug test
APKs before starting a fresh API 35 emulator. It runs the persistence/layout
test, a separate cold-process test, the live collection-button test, and a
reused-view regression in that order. A failed instrumentation assertion fails the job even when ADB
returns exit code zero. Logs, widget state and screenshots are retained as
`android-widget-results-<attempt>` for 14 days. This workflow does not publish
a release or use signing secrets.

With those debug APKs built and an isolated emulator running, use
`bash scripts/test-android-widgets.sh` to repeat the same checks. This clears
Nerva's data on the connected test device; never run it against a personal
phone with real data. Output is written under `test-results/android-widgets/`.

## Decision: Tauri 2 mobile, not native shells

| | Tauri 2 mobile (chosen) | Native companions (previous plan) |
|---|---|---|
| Rust core reuse (timers, SQLite log, licence) | ✅ identical crate | ✅ via UniFFI, but a second build system |
| UI reuse | ✅ same React panels, phone shell | ❌ two new UIs |
| Time to first APK | days | months |
| Home-screen widgets / Live Activities | Android native RemoteViews + JNI implemented; iOS planned | First-class native APIs |
| Maintenance | one release pipeline | three |

Home-screen widgets are a primary Android workflow. Tauri remains the full
app shell; native Android components own launcher widgets and quick capture.

## Current Branch (Not Yet Released)

- **Shell:** `src/mobile/MobileApp.tsx` — one column, bottom tabs
  Focus · Tasks · Habits · Notes, settings gear. Picked at boot by
  `isMobile()` (`src/lib/platform.ts`; UA sniff, `?shell=mobile` forces it
  in a browser for layout work). Workspace selection, habit management and
  home-screen widget setup are available in the phone shell. Desktop pop-out
  controls are hidden; the launcher icon uses Nerva's existing artwork.
- **Home-screen widgets:** native Focus, Tasks, Habits and Note providers,
  with source and theme saved per widget. Kotlin calls the existing Rust
  commands through `WidgetBridge`; both the widgets and Tauri share one
  in-process state and the database at Android's `applicationInfo.dataDir`.
- **Same Rust core** — `src-tauri/` compiles for
  `aarch64-linux-android` (+ armv7/x86/x86_64 in CI). Desktop-only pieces are
  `#[cfg(desktop)]`: tray, single-instance, global shortcuts, updater,
  process plugin, floating windows (`spawn_popup`), `reveal_data_dir`, and
  the rodio audio engine (`audio/mobile.rs` is a no-op reporting
  `available=false`). Their crates live in a
  `[target.'cfg(not(any(target_os="android", target_os="ios")))'.dependencies]`
  table and their permissions in `capabilities/desktop.json`
  (`platforms: [linux, macOS, windows]`).
- **Background alerts:** native `WidgetAlarms` schedules phase boundaries
  through Android's AlarmManager. App changes trigger native refresh via
  `src/mobile/widgets.ts`; pausing cancels the scheduled boundary. The old
  JavaScript scheduler was removed to avoid duplicate Android alerts.
  Permission denial falls back to approximate delivery and is shown in the
  widget setup screen. Manifest permissions:
  `POST_NOTIFICATIONS`, `SCHEDULE_EXACT_ALARM`, `RECEIVE_BOOT_COMPLETED`.
- **Pro:** uses the same licence code and device limits (2/3/5); live
  purchase/activation on a phone is not covered by widget tests.
- **Ask Nerva:** provider settings are shared, but the phone shell does not
  yet expose the chat view. Do not claim mobile chat parity from the backend
  provider support alone.
- **Not on mobile:** pop-out windows, tray, keyboard shortcuts/palette, DND
  toggle, synthesized audio, sidebar layout editor, auto-updater (store).

API 35 tests cover provider binding, persisted direct actions, cold-process
recovery without MainActivity, and bounds at normal through 200% text size.
They do not certify alarm timing under Doze/OEM restrictions, every launcher,
Google Play distribution, full mobile chat, or live Pro activation. Those
remain separate release checks. Android force-stop can prevent alarms until
the app is opened again.

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
signed with the debug key for local testing. A fresh CI debug key changes the
signing identity, so it must not be used for a new public update channel:
existing installations cannot upgrade in place with a different certificate.
Provision and back up a persistent release key before the next public APK.

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
offline**. Sideload updates require compatible app signing. With Play App
Signing, the app-signing key and upload key are different roles; a lost
upload key can be reset through Play Console.

## Distribution roadmap

| Step | Channel | Status |
|---|---|---|
| A1 | GitHub release APK (sideload), website download tile | ✅ v0.1.14 |
| A2 | Google Play internal testing (AAB from CI) | ⬜ needs Play Console account ($25 one-off) |
| A3 | Play production + Data-safety form ("no data collected" unless telemetry opt-in) | ⬜ |
| A4 | F-Droid (reproducible build recipe; no proprietary deps — we have none) | ⬜ |
| A5 | Native RemoteViews widgets using the shared Rust commands over JNI | Implemented on main; not in the published v0.1.14 APK |
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

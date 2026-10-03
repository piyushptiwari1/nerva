#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ADB="${ADB:-adb}"
OUTPUT="$ROOT/test-results/android-widgets/release"
DRIVER="ai.bytical.nerva.widgetsmoke"
APP="ai.bytical.nerva.mobile"

if [[ "$("$ADB" shell getprop ro.kernel.qemu | tr -d '\r')" != "1" ]]; then
  printf 'Release smoke tests require an isolated Android emulator.\n' >&2
  exit 1
fi

mkdir -p "$OUTPUT"
collect() {
  local result=$?
  trap - EXIT
  "$ADB" logcat -d -v threadtime > "$OUTPUT/logcat.txt" 2>&1 || true
  "$ADB" shell dumpsys appwidget > "$OUTPUT/appwidgets.txt" 2>&1 || true
  "$ADB" shell dumpsys activity top > "$OUTPUT/activity.txt" 2>&1 || true
  "$ADB" exec-out screencap -p > "$OUTPUT/screen.png" 2>/dev/null || true
  "$ADB" pull "/sdcard/Android/data/$DRIVER/files/release-widget-screenshots" "$OUTPUT/screenshots" >/dev/null 2>&1 || true
  exit "$result"
}
trap collect EXIT

"$ADB" install -r "$ROOT/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk"
"$ADB" install -r "$ROOT/src-tauri/gen/android/widget-smoke/build/outputs/apk/debug/widget-smoke-debug.apk"
"$ADB" install -r "$ROOT/src-tauri/gen/android/widget-smoke/build/outputs/apk/androidTest/debug/widget-smoke-debug-androidTest.apk"
"$ADB" shell pm clear "$APP"
"$ADB" logcat -c
"$ADB" shell am instrument -w -r -e class ai.bytical.nerva.widgetsmoke.ReleaseWidgetTest \
  "$DRIVER.test/androidx.test.runner.AndroidJUnitRunner" | tee "$OUTPUT/result.txt"
grep -Eq '^OK \(1 test\)' "$OUTPUT/result.txt"
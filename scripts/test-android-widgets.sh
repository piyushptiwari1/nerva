#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="${WIDGET_TEST_OUTPUT:-$ROOT/test-results/android-widgets}"
APP_APK="$ROOT/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk"
TEST_APK="$ROOT/src-tauri/gen/android/app/build/outputs/apk/androidTest/universal/debug/app-universal-debug-androidTest.apk"
RUNNER="ai.bytical.nerva.test/androidx.test.runner.AndroidJUnitRunner"
CLASS="ai.bytical.nerva.widgets.WidgetBehaviorTest"
ADB="${ADB:-adb}"

if [[ "$("$ADB" shell getprop ro.kernel.qemu | tr -d '\r')" != "1" ]]; then
  printf 'Refusing to clear Nerva data: connect an isolated Android emulator.\n' >&2
  exit 1
fi

mkdir -p "$OUTPUT"

collect_results() {
  local result=$?
  trap - EXIT
  "$ADB" logcat -d -v threadtime > "$OUTPUT/logcat.txt" 2>&1 || true
  "$ADB" shell dumpsys appwidget > "$OUTPUT/appwidgets.txt" 2>&1 || true
  "$ADB" shell dumpsys activity top > "$OUTPUT/activity.txt" 2>&1 || true
  "$ADB" exec-out screencap -p > "$OUTPUT/screen.png" 2>/dev/null || true
  "$ADB" pull /sdcard/Android/data/ai.bytical.nerva/files/widget-test-screenshots "$OUTPUT/screenshots" >/dev/null 2>&1 || true
  printf '%s\n' "$result" > "$OUTPUT/exit-code.txt"
  exit "$result"
}
trap collect_results EXIT

"$ADB" install -r "$APP_APK"
"$ADB" install -r "$TEST_APK"
"$ADB" shell pm clear ai.bytical.nerva
"$ADB" logcat -c

run_test() {
  local method="$1"
  local suite="${2:-$CLASS}"
  "$ADB" shell am instrument -w -r -e class "$suite#$method" "$RUNNER" | tee "$OUTPUT/$method.txt"
  if ! grep -Eq '^OK \(1 test\)' "$OUTPUT/$method.txt"; then
    printf 'Android widget test failed: %s\n' "$method" >&2
    return 1
  fi
}

run_test providersActionsPersistenceAndLayouts
"$ADB" shell am force-stop ai.bytical.nerva
run_test coldProcessRecoversAndActsWithoutMainActivity
"$ADB" shell am force-stop ai.bytical.nerva
run_test liveCollectionsRenderAndAcceptTap
run_test reapplyClearsStaleEmptyContentAndUndo ai.bytical.nerva.widgets.WidgetRenderingTest
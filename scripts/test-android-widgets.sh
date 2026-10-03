#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="${WIDGET_TEST_OUTPUT:-$ROOT/test-results/android-widgets}"
APP_APK="$ROOT/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk"
TEST_APK="$ROOT/src-tauri/gen/android/app/build/outputs/apk/androidTest/universal/debug/app-universal-debug-androidTest.apk"
LEGACY_APK="${NERVA_LEGACY_APK:?Set NERVA_LEGACY_APK to the published v0.1.14 APK}"
APP_ID="ai.bytical.nerva.mobile"
RUNNER="$APP_ID.test/androidx.test.runner.AndroidJUnitRunner"
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
  "$ADB" pull "/sdcard/Android/data/$APP_ID/files/widget-test-screenshots" "$OUTPUT/screenshots" >/dev/null 2>&1 || true
  printf '%s\n' "$result" > "$OUTPUT/exit-code.txt"
  exit "$result"
}
trap collect_results EXIT

[[ -f "$LEGACY_APK" ]]
"$ADB" install -r "$LEGACY_APK"
"$ADB" install -r "$APP_APK"
"$ADB" install -r "$TEST_APK"
"$ADB" shell pm clear "$APP_ID"
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
"$ADB" shell am force-stop "$APP_ID"
run_test coldProcessRecoversAndActsWithoutMainActivity
"$ADB" shell am force-stop "$APP_ID"
run_test liveCollectionsRenderAndAcceptTap
run_test reapplyClearsStaleEmptyContentAndUndo ai.bytical.nerva.widgets.WidgetRenderingTest
run_test newInstallIsIsolatedFromLegacyData ai.bytical.nerva.widgets.WidgetIsolationTest
run_test quickCaptureSavesThroughNativeScreens ai.bytical.nerva.widgets.WidgetScreenTest
"$ADB" shell am force-stop "$APP_ID"
"$ADB" shell cmd appops set "$APP_ID" SCHEDULE_EXACT_ALARM deny
"$ADB" shell pm revoke "$APP_ID" android.permission.POST_NOTIFICATIONS
run_test deniedPermissionsFallBackAndPauseCancels ai.bytical.nerva.widgets.WidgetAlarmTest
"$ADB" shell cmd appops set "$APP_ID" SCHEDULE_EXACT_ALARM allow
"$ADB" shell pm grant "$APP_ID" android.permission.POST_NOTIFICATIONS
"$ADB" shell input keyevent KEYCODE_SLEEP
run_test screenOffAlarmDeliversWithoutMainActivity ai.bytical.nerva.widgets.WidgetAlarmTest
run_test prepareRebootRecovery ai.bytical.nerva.widgets.WidgetAlarmTest
"$ADB" reboot
"$ADB" wait-for-device
node "$ROOT/scripts/wait-android-boot.mjs" "$ADB"
"$ADB" shell am wait-for-broadcast-idle
run_test rebootRecoversAndDeliversWithoutMainActivity ai.bytical.nerva.widgets.WidgetAlarmTest
"$ADB" shell input keyevent KEYCODE_WAKEUP
run_test fullAppUsesMobileDatabaseAfterHeadlessWidgetUse ai.bytical.nerva.widgets.WidgetScreenTest
"$ADB" shell pm path ai.bytical.nerva
#!/usr/bin/env bash
# Build a signed ARM64 test APK of the current tree for phone acceptance.
# Output: test-results/android-candidate/Nerva-Mobile-<sha>-arm64.apk
set -euo pipefail
cd "$(dirname "$0")/.."
source ~/.nerva-android.env
export NDK_HOME="${NDK_HOME:-$ANDROID_HOME/ndk/27.0.12077973}"
export NERVA_GOOGLE_CLIENT_ID=$(python3 -c "import json;print(json.load(open('secrets/google-oauth-desktop.json'))['client_id'])")
export NERVA_GOOGLE_CLIENT_SECRET=$(python3 -c "import json;print(json.load(open('secrets/google-oauth-desktop.json'))['client_secret'])")
export NERVA_GOOGLE_DEVICE_CLIENT_ID=$(python3 -c "import json;print(json.load(open('secrets/google-oauth-device.json'))['client_id'])")
export NERVA_GOOGLE_DEVICE_CLIENT_SECRET=$(python3 -c "import json;print(json.load(open('secrets/google-oauth-device.json'))['client_secret'])")

SHA=$(git rev-parse --short HEAD)
OUT=test-results/android-candidate
mkdir -p "$OUT"
APKSIGNER="$ANDROID_HOME/build-tools/35.0.0/apksigner"
ZIPALIGN="$ANDROID_HOME/build-tools/35.0.0/zipalign"

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  npx tauri android build --apk --target aarch64 --ci
fi

# Tauri names the single-ABI output "universal" even for one target.
UNSIGNED=$(ls -t src-tauri/gen/android/app/build/outputs/apk/*/release/*.apk | head -1)
ALIGNED="$OUT/aligned.apk"
FINAL="$OUT/Nerva-Mobile-$SHA-arm64.apk"
"$ZIPALIGN" -P 16 -f 4 "$UNSIGNED" "$ALIGNED"
"$APKSIGNER" sign --ks secrets/android-release.p12 --ks-pass file:secrets/android-release.password \
  --ks-type PKCS12 --v2-signing-enabled true --v3-signing-enabled true --out "$FINAL" "$ALIGNED"
rm -f "$ALIGNED"
"$APKSIGNER" verify --print-certs "$FINAL" | grep -i "sha-256" | head -1
echo "EXPECTED  $(cat secrets/android-release.sha256)"
ls -la "$FINAL"
sha256sum "$FINAL"

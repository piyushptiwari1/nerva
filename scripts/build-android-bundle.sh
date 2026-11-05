#!/usr/bin/env bash
# Build a Play-ready Android App Bundle signed with the persistent Nerva release
# key, and (first time only) export that key for Play App Signing so Play keeps
# our existing certificate. Users who sideloaded can then update from Play.
#
#   bash scripts/build-android-bundle.sh            # build + sign .aab
#   bash scripts/build-android-bundle.sh --export   # also write the PEPK upload blob
#
# Output: test-results/android-bundle/Nerva-Mobile-<sha>.aab (+ .sha256)
#         test-results/android-bundle/play-app-signing-key.zip (with --export)
set -euo pipefail
cd "$(dirname "$0")/.."
source ~/.nerva-android.env
export NDK_HOME="${NDK_HOME:-$ANDROID_HOME/ndk/27.0.12077973}"
for v in NERVA_GOOGLE_CLIENT_ID:desktop:client_id NERVA_GOOGLE_CLIENT_SECRET:desktop:client_secret \
         NERVA_GOOGLE_DEVICE_CLIENT_ID:device:client_id NERVA_GOOGLE_DEVICE_CLIENT_SECRET:device:client_secret; do
  IFS=: read -r name file key <<<"$v"
  export "$name=$(python3 -c "import json;print(json.load(open('secrets/google-oauth-$file.json'))['$key'])")"
done

SHA=$(git rev-parse --short HEAD)
OUT=test-results/android-bundle
mkdir -p "$OUT"
KS=secrets/android-release.p12
PASS=$(cat secrets/android-release.password)
ALIAS=nerva-release

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  # keystore.properties makes Gradle sign the bundle itself (same key as the APKs).
  cat > src-tauri/gen/android/app/keystore.properties <<EOF
keyAlias=$ALIAS
password=$PASS
storeFile=$(pwd)/$KS
EOF
  trap 'rm -f src-tauri/gen/android/app/keystore.properties' EXIT
  NERVA_ANDROID_REQUIRE_SIGNING=1 npx tauri android build --aab --ci
fi

BUNDLE=$(ls -t src-tauri/gen/android/app/build/outputs/bundle/*/*.aab | head -1)
FINAL="$OUT/Nerva-Mobile-$SHA.aab"
cp "$BUNDLE" "$FINAL"
# Confirm the bundle carries the App Functions metadata Gemini needs.
unzip -l "$FINAL" | grep -q "base/root/assets/nerva_app_functions.xml" && echo "App Functions metadata: present" || { echo "App Functions metadata MISSING"; exit 1; }
jarsigner -verify -verbose -certs "$FINAL" 2>/dev/null | grep -m1 "SHA256 digest\|CN=" || true
sha256sum "$FINAL" | tee "$FINAL.sha256"

if [[ "${1:-}" == "--export" ]]; then
  # Google's PEPK tool wraps the private key for upload under Play Console →
  # Setup → App signing → "Export and upload a key from Java keystore".
  PEPK=$OUT/pepk.jar
  [[ -f "$PEPK" ]] || curl -fsSL -o "$PEPK" https://www.gstatic.com/play-apps-publisher-rapid/signing-tool/prod/pepk.jar
  ENC=secrets/play-encryption-public-key.pem
  if [[ ! -f "$ENC" ]]; then
    echo "Save the encryption public key shown in Play Console (App signing page) to $ENC, then re-run with --export."
    exit 2
  fi
  java -jar "$PEPK" --keystore="$KS" --alias="$ALIAS" --output="$OUT/play-app-signing-key.zip" \
    --include-cert --rsa-aes-encryption --encryption-key-path="$ENC" --keystore-pass="$PASS" --key-pass="$PASS"
  echo "Upload $OUT/play-app-signing-key.zip in Play Console → App signing."
fi

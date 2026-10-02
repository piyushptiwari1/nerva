#!/usr/bin/env bash
set -euo pipefail

APK="${1:?Provide the built APK}"
PREVIOUS_APK="${2:?Provide the previously published APK}"
EXPECTED="${ANDROID_CERT_SHA256:?Set the pinned public certificate SHA-256}"
APKSIGNER="${APKSIGNER:-apksigner}"

if [[ ! "$EXPECTED" =~ ^[a-fA-F0-9]{64}$ ]]; then
  printf 'Invalid release certificate fingerprint.\n' >&2
  exit 1
fi
EXPECTED="$(printf '%s' "$EXPECTED" | tr '[:upper:]' '[:lower:]')"

fingerprint() {
  local report
  report="$("$APKSIGNER" verify --verbose --print-certs "$1")"
  if ! grep -q '^Number of signers: 1$' <<< "$report"; then
    printf 'Expected exactly one verified APK signer.\n' >&2
    return 1
  fi
  sed -n 's/^Signer #1 certificate SHA-256 digest: //p' <<< "$report"
}

current="$(fingerprint "$APK")"
previous="$(fingerprint "$PREVIOUS_APK")"
if [[ "$current" != "$EXPECTED" ]]; then
  printf 'Release APK does not match the pinned signing certificate.\n' >&2
  exit 1
fi
if [[ "$current" != "$previous" ]]; then
  printf 'BLOCKED: Android signing identity changed. An in-place update would fail.\n' >&2
  printf 'Recover the previous signing key or approve and implement a data-preserving migration before publishing.\n' >&2
  exit 1
fi
printf 'PASS: APK signature is valid, pinned and compatible with the previous release.\n'
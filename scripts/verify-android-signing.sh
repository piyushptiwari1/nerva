#!/usr/bin/env bash
set -euo pipefail

APK="${1:?Provide the built APK}"
PREVIOUS_APK="${2:?Provide the previously published APK}"
EXPECTED="${ANDROID_CERT_SHA256:?Set the pinned public certificate SHA-256}"
APKSIGNER="${APKSIGNER:-apksigner}"
APKANALYZER="${APKANALYZER:-apkanalyzer}"
PACKAGE="ai.bytical.nerva.mobile"
LEGACY_PACKAGE="ai.bytical.nerva"
LEGACY_CERTIFICATE="0c6e092921f6045eeeeff8d237b633922be137495599f5f05f677ea835e4d324"

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

previous="$(fingerprint "$PREVIOUS_APK")"
previous_package="$("$APKANALYZER" manifest application-id "$PREVIOUS_APK")"
if [[ "$previous_package" == "$PACKAGE" && "$previous" == "$EXPECTED" ]]; then
  transition="upgrade-compatible"
elif [[ "$previous_package" == "$LEGACY_PACKAGE" && "$previous" == "$LEGACY_CERTIFICATE" ]]; then
  transition="approved side-by-side installation; legacy data remains in v0.1.14"
else
  printf 'BLOCKED: unknown or incompatible previous Android signing identity.\n' >&2
  exit 1
fi

if [[ "$APK" != "--previous" ]]; then
  current="$(fingerprint "$APK")"
  if [[ "$current" != "$EXPECTED" ]]; then
    printf 'Release APK does not match the pinned signing certificate.\n' >&2
    exit 1
  fi
  current_package="$("$APKANALYZER" manifest application-id "$APK")"
  if [[ "$current_package" != "$PACKAGE" ]]; then
    printf 'BLOCKED: release package must be %s; never replace the legacy app with a new key.\n' "$PACKAGE" >&2
    exit 1
  fi
fi
printf 'PASS: verified Android identity (%s).\n' "$transition"
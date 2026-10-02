#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
KEYSTORE="$ROOT/secrets/android-release.p12"
PASSWORD_FILE="$ROOT/secrets/android-release.password"
CERTIFICATE="$ROOT/secrets/android-release.pem"
FINGERPRINT="$ROOT/secrets/android-release.sha256"
ALIAS="nerva-release"
KEYTOOL="${JAVA_HOME:?Set JAVA_HOME to a JDK}/bin/keytool"
MODE="${1:-local}"

if [[ "$MODE" != "local" && "$MODE" != "github" ]]; then
  printf 'Usage: %s [local|github]\n' "$0" >&2
  exit 1
fi

command -v openssl >/dev/null
[[ -x "$KEYTOOL" ]]
git -C "$ROOT" check-ignore -q secrets/android-release.p12
git -C "$ROOT" check-ignore -q secrets/android-release.password
mkdir -p "$ROOT/secrets"

if [[ -e "$KEYSTORE" || -e "$PASSWORD_FILE" ]]; then
  if [[ ! -f "$KEYSTORE" || ! -f "$PASSWORD_FILE" ]]; then
    printf 'Incomplete signing files; refusing to replace an existing key or password.\n' >&2
    exit 1
  fi
else
  temporary="$(mktemp -d "$ROOT/secrets/.android-signing.XXXXXX")"
  trap 'rm -rf -- "$temporary"' EXIT
  openssl rand -hex 32 > "$temporary/password"
  "$KEYTOOL" -genkeypair -noprompt -keystore "$temporary/release.p12" \
    -storetype PKCS12 -storepass:file "$temporary/password" -keypass:file "$temporary/password" \
    -alias "$ALIAS" -keyalg RSA -keysize 3072 -sigalg SHA256withRSA -validity 10000 \
    -dname 'CN=Nerva Android Release,O=Bytical Solutions Private Limited,C=IN'
  mv "$temporary/password" "$PASSWORD_FILE"
  mv "$temporary/release.p12" "$KEYSTORE"
fi

chmod 600 "$KEYSTORE" "$PASSWORD_FILE"
"$KEYTOOL" -exportcert -rfc -keystore "$KEYSTORE" -storepass:file "$PASSWORD_FILE" \
  -alias "$ALIAS" -file "$CERTIFICATE"
openssl x509 -in "$CERTIFICATE" -noout -fingerprint -sha256 | \
  cut -d= -f2 | tr -d ':' | tr '[:upper:]' '[:lower:]' > "$FINGERPRINT"
[[ "$(wc -c < "$FINGERPRINT")" -eq 65 ]]

if [[ "$MODE" == "github" ]]; then
  REPO="${GH_REPO:-piyushptiwari1/nerva}"
  base64 -w0 "$KEYSTORE" | gh secret set ANDROID_KEYSTORE_B64 --repo "$REPO"
  gh secret set ANDROID_KEY_PASSWORD --repo "$REPO" < "$PASSWORD_FILE"
  printf '%s' "$ALIAS" | gh secret set ANDROID_KEY_ALIAS --repo "$REPO"
  gh variable set ANDROID_CERT_SHA256 --repo "$REPO" --body "$(< "$FINGERPRINT")"
  printf 'Persistent Android signing configuration stored in GitHub.\n'
fi

printf 'Signing key preserved under the ignored secrets directory; keep an offline backup.\n'
printf 'Public certificate SHA-256: %s\n' "$(< "$FINGERPRINT")"
printf 'This creates no release and does not resolve compatibility with the v0.1.14 signing key.\n'
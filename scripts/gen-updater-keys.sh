#!/usr/bin/env bash
# Generate the Tauri updater signing keypair.
#
# Private key + password → GitHub Actions secrets (signs new releases).
# Public key            → pasted into src-tauri/tauri.conf.json plugins.updater.pubkey
#                         so installed apps verify update integrity.
#
# Usage:
#   ./scripts/gen-updater-keys.sh

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( dirname "$SCRIPT_DIR" )"
OUT_DIR="$REPO_ROOT/secrets"
mkdir -p "$OUT_DIR"

if [[ -f "$OUT_DIR/tauri-updater.key" ]]; then
  echo "[gen-updater-keys] secrets/tauri-updater.key already exists. Refusing to overwrite."
  exit 1
fi

cd "$REPO_ROOT"
npx --yes @tauri-apps/cli signer generate \
  --write-keys "$OUT_DIR/tauri-updater.key"

PUB="$OUT_DIR/tauri-updater.key.pub"

cat <<EOM

[gen-updater-keys] DONE.

  Private key:  $OUT_DIR/tauri-updater.key
  Public key:   $PUB

NEXT STEPS:
  1. Copy the contents of $PUB into src-tauri/tauri.conf.json:
       "plugins": { "updater": { "pubkey": "<paste here>", ... } }

  2. Add to GitHub repo secrets:
       TAURI_SIGNING_PRIVATE_KEY          = <contents of tauri-updater.key>
       TAURI_SIGNING_PRIVATE_KEY_PASSWORD = <the password you just chose>

  3. NEVER commit secrets/*.key — already gitignored.
EOM

#!/usr/bin/env bash
# Nerva dev launcher — scrubs snap-VSCode env pollution that injects an
# incompatible libpthread/GTK from /snap/code/* into child processes.
#
# Usage:   ./scripts/dev.sh           # tauri dev (vite + cargo run)
#          ./scripts/dev.sh build     # tauri build
#          ./scripts/dev.sh run       # run the already-built debug binary
#
# Safe to run from inside a VS Code (snap) terminal or any other shell.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CMD="${1:-dev}"

# Snap-VSCode redirects a fistful of GTK/glibc env vars into its sandbox.
# Unsetting them lets the dynamic loader find the host /lib/x86_64-linux-gnu
# libraries the Tauri binary was linked against.
SCRUB=(
  LOCPATH
  GTK_PATH GTK_EXE_PREFIX GTK_IM_MODULE_FILE
  GSETTINGS_SCHEMA_DIR GIO_MODULE_DIR
  XDG_DATA_DIRS XDG_DATA_HOME
  LD_LIBRARY_PATH LD_PRELOAD
)

clean_run() {
  local args=("$@")
  local cmd=(env)
  for var in "${SCRUB[@]}"; do
    cmd+=(-u "$var")
  done
  cmd+=("${args[@]}")
  exec "${cmd[@]}"
}

case "$CMD" in
  dev)    clean_run npm run tauri dev ;;
  build)  clean_run npm run tauri build ;;
  run)    clean_run ./src-tauri/target/debug/nerva ;;
  *)      echo "usage: $0 [dev|build|run]" >&2; exit 2 ;;
esac

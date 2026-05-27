#!/usr/bin/env bash
# Install Nerva user-level systemd unit so timers keep ticking and the
# event-sourced state survives logouts / crashes.
set -euo pipefail

UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$UNIT_DIR"
cp "$(dirname "$0")/systemd/nerva.service" "$UNIT_DIR/nerva.service"

systemctl --user daemon-reload
systemctl --user enable --now nerva.service
systemctl --user status --no-pager nerva.service || true

echo
echo "Nerva daemon installed. Logs:  journalctl --user -u nerva -f"

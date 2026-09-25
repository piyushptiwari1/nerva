#!/usr/bin/env bash
# Pull Bytical brand assets from bytical.ai into web/public/brand (used by the
# invoice + emails). They are white-on-transparent — always place on navy #071B34.
set -euo pipefail
cd "$(dirname "$0")/../web/public"
mkdir -p brand
for f in bytical-mark-on-dark-96.png bytical-wordmark-on-dark-h80-2x.png bytical-apple-touch-icon-180.png bytical-og-1200x630.png; do
  curl -fsSL -o "brand/$f" "https://bytical.ai/brand-v4/$f"
  file "brand/$f" | grep -q "PNG image" || { echo "not an image: $f"; exit 1; }
done
file brand/*

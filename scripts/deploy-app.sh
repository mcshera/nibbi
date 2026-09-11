#!/bin/bash
set -euo pipefail
NIBBI_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
(cd "$NIBBI_REPO" && npm run build && npm run build -w nibbi-desktop)
NIBBI_BUNDLE="${CARGO_TARGET_DIR:-$NIBBI_REPO/desktop/src-tauri/target}/release/bundle/macos/Nibbi.app"
[ -d "$NIBBI_BUNDLE" ] || { echo "Desktop bundle not found: $NIBBI_BUNDLE"; exit 1; }
mkdir -p "$HOME/Applications"
if [ -d "$HOME/Applications/Nibbi.app" ]; then
  mv "$HOME/Applications/Nibbi.app" "$HOME/Applications/Nibbi.app.backup-$(date +%Y%m%d-%H%M%S)"
fi
cp -R "$NIBBI_BUNDLE" "$HOME/Applications/Nibbi.app"
echo "Installed Nibbi.app; any previous app was preserved alongside it."

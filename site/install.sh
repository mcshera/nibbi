#!/bin/bash
# nibbi.com/install.sh — bootstrap: clone the repo and run its installer. Usage: curl -fsSL https://nibbi.com/install.sh | bash
set -euo pipefail
DEST="${NIBBI_DIR:-$HOME/Nibbi-app}"
command -v git >/dev/null || { echo "git is missing — run: xcode-select --install  (then re-run)"; exit 1; }
if [ -d "$DEST/.git" ]; then echo "updating $DEST"; git -C "$DEST" pull --ff-only; else echo "cloning into $DEST"; git clone --depth 1 https://github.com/mcshera/nibbi.git "$DEST"; fi
cd "$DEST" && exec bash install.sh "$@"

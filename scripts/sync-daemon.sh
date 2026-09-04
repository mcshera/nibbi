#!/bin/bash
# scripts/sync-daemon.sh — vendor the daemon (Nibbi's brain/gateway) into this repo from its development checkout.
# Maintainer-only. Usage: scripts/sync-daemon.sh [path-to-daemon-app]   (default: ~/Nibbi/app)
set -euo pipefail
SRC="${1:-$HOME/Nibbi/app}"; DST="$(cd "$(dirname "$0")/.." && pwd)/daemon"
[ -f "$SRC/src/gateway.ts" ] || { echo "no daemon at $SRC"; exit 1; }
mkdir -p "$DST"
rsync -a --delete --exclude node_modules --exclude .gitignore --exclude '.DS_Store' --exclude 'launchd' "$SRC/src" "$SRC/bin" "$SRC/public" "$SRC/package.json" "$SRC/package-lock.json" "$SRC/tsconfig.json" "$DST/"
printf 'node_modules/\n' > "$DST/.gitignore"
# state scripts the daemon expects in ~/.nibbi/bin (installed by install.sh); vault-backup is site-specific → example only
mkdir -p "$DST/state-bin"
for f in transcribe tts-kokoro kokoro-server.py whisper-server.py nibbi-doctor; do [ -f "$HOME/.nibbi/bin/$f" ] && cp "$HOME/.nibbi/bin/$f" "$DST/state-bin/$f"; done
[ -f "$HOME/.nibbi/bin/vault-backup" ] && sed -e 's#root@[0-9.]*:#root@YOUR_SERVER:#g; s#root@[0-9.]* #root@YOUR_SERVER #g' "$HOME/.nibbi/bin/vault-backup" > "$DST/state-bin/vault-backup.example"
# strip machine-specific paths from the state scripts (they derive HOME at runtime)
sed -i '' -e "s#/Users/[A-Za-z0-9_.-]*/\.nibbi#\$HOME/.nibbi#g; s#/Users/[A-Za-z0-9_.-]*/NibbiVault#\$HOME/NibbiVault#g" "$DST"/state-bin/* 2>/dev/null || true
printf 'mlx-whisper\nmlx-audio\nimageio-ffmpeg\n' > "$DST/requirements-voice.txt"
echo "daemon synced from $SRC → $DST ($(find "$DST/src" -name '*.ts' | wc -l | tr -d ' ') ts files)"

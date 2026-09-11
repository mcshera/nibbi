#!/bin/bash
# Remove services and app recoverably. Never purge vaults, state, branches or worktrees.
set -euo pipefail
if [ "$#" -gt 0 ]; then
  echo "Automatic purge is disabled. Back up and inspect retained work before any manual cleanup."
  exit 2
fi
NIBBI_UID="$(id -u)"
NIBBI_STATE_DIR="${NIBBI_STATE_DIR:-$HOME/.nibbi}"
NIBBI_BACKUP="$NIBBI_STATE_DIR/backups/uninstall-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$NIBBI_BACKUP"
for unit in com.nibbi.gateway com.nibbi.host com.nibbi.kokoro com.nibbi.whisper com.nibbi.ollama; do
  launchctl bootout "gui/$NIBBI_UID/$unit" >/dev/null 2>&1 || true
  if [ -f "$HOME/Library/LaunchAgents/$unit.plist" ]; then mv "$HOME/Library/LaunchAgents/$unit.plist" "$NIBBI_BACKUP/$unit.plist"; fi
done
if [ -d "$HOME/Applications/Nibbi.app" ]; then mv "$HOME/Applications/Nibbi.app" "$NIBBI_BACKUP/Nibbi.app"; fi
echo "Services stopped; app and launchd definitions moved to $NIBBI_BACKUP."
echo "Vault, state, projects, branches and worktrees were retained. Manually launched backends must be stopped separately."

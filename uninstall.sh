#!/bin/bash
# uninstall.sh — stop and remove Nibbi's services and app. Keeps your vault, projects and state unless --purge.
set -euo pipefail
UID_="$(id -u)"; PURGE=0; for a in "$@"; do [ "$a" = "--purge" ] && PURGE=1; done
for u in com.nibbi.gateway com.nibbi.host com.nibbi.kokoro com.nibbi.whisper com.nibbi.ollama; do launchctl bootout "gui/$UID_/$u" >/dev/null 2>&1 || true; rm -f "$HOME/Library/LaunchAgents/$u.plist"; done
rm -rf "$HOME/Applications/Nibbi.app"; rm -f "$HOME/Documents/NibbiVault"
echo "services + app removed."
if [ "$PURGE" = 1 ]; then rm -rf "$HOME/.nibbi" "$HOME/NibbiWork"; echo "state removed. Your vault ($HOME/NibbiVault) and projects ($HOME/NibbiProjects) were kept — delete them yourself if you mean it."; fi

#!/bin/sh
# Installs the Nibbi host as a login-time launchd agent (KeepAlive). Re-run to update.
set -e
P="$HOME/Library/LaunchAgents/com.nibbi.host.plist"
cp "$(dirname "$0")/com.nibbi.host.plist" "$P"
launchctl bootout "gui/$(id -u)/com.nibbi.host" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$P"
launchctl kickstart -k "gui/$(id -u)/com.nibbi.host"
echo "nibbi host: http://127.0.0.1:4527  (log: ~/.nibbi/logs/nibbi.log)"

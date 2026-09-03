#!/bin/sh
# Installs the Nibbi host as a login-time launchd agent (KeepAlive). Re-run to update.
set -e
P="$HOME/Library/LaunchAgents/com.oracle.nibbi.plist"
cp "$(dirname "$0")/com.oracle.nibbi.plist" "$P"
launchctl bootout "gui/$(id -u)/com.oracle.nibbi" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$P"
launchctl kickstart -k "gui/$(id -u)/com.oracle.nibbi"
echo "nibbi host: http://127.0.0.1:4527  (log: ~/.oracle/logs/nibbi.log)"

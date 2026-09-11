#!/bin/bash
# Install the local Nibbi platform. Run this explicitly after reviewing the migration guide.
# Options: --voice --no-launchd --no-app --owner "Name"
set -euo pipefail
NIBBI_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export NIBBI_STATE_DIR="${NIBBI_STATE_DIR:-$HOME/.nibbi}"
export NIBBI_VAULT_DIR="${NIBBI_VAULT_DIR:-$HOME/NibbiVault}"
export NIBBI_WORK_DIR="${NIBBI_WORK_DIR:-$HOME/NibbiWork/fixers}"
export NIBBI_PROJECTS_DIR="${NIBBI_PROJECTS_DIR:-$HOME/NibbiProjects}"
VOICE=0; LAUNCHD=1; APP=1
while [ $# -gt 0 ]; do
  case "$1" in
    --voice) VOICE=1;;
    --no-launchd) LAUNCHD=0;;
    --no-app) APP=0;;
    --owner) export NIBBI_OWNER="${2:?Owner required}"; shift;;
    --yes|-y) : ;;
    -h|--help) sed -n '2,3p' "$0"; exit 0;;
    *) echo "Unknown option: $1"; exit 2;;
  esac
  shift
done
[ "$(uname)" = Darwin ] || { echo "The supported backend is local macOS."; exit 1; }
command -v git >/dev/null
command -v node >/dev/null
command -v rg >/dev/null || { echo "ripgrep (rg) is required by the command sandbox. Install it before continuing."; exit 1; }
node -e 'const [major,minor]=process.versions.node.split(".").map(Number); if(major<22 || (major===22 && minor<14)) throw Error("Node 22.14 or later is required")'
export NIBBI_NODE="$(command -v node)"
export NIBBI_RIPGREP="$(command -v rg)"
export NIBBI_OWNER="${NIBBI_OWNER:-$(id -F)}"
export NIBBI_REPO
node "$NIBBI_REPO/tools/install-state.mjs" --preflight
if [ "$VOICE" = 1 ]; then
  [ "$(uname -m)" = arm64 ] || { echo "Optional local voice requires Apple Silicon."; exit 1; }
  export NIBBI_FFMPEG="$(command -v ffmpeg)"
fi
if [ "$LAUNCHD" = 1 ]; then
  NIBBI_UID="$(id -u)"
  launchctl bootout "gui/$NIBBI_UID/com.nibbi.host" >/dev/null 2>&1 || true
  launchctl bootout "gui/$NIBBI_UID/com.nibbi.gateway" >/dev/null 2>&1 || true
fi
node "$NIBBI_REPO/tools/install-state.mjs" --wait-stopped
(cd "$NIBBI_REPO" && npm ci --no-audit --no-fund && npm run build)
node "$NIBBI_REPO/tools/install-state.mjs"
if [ "$VOICE" = 1 ]; then
  [ "$(uname -m)" = arm64 ] || { echo "Optional local voice requires Apple Silicon."; exit 1; }
  NIBBI_PYTHON="$(command -v python3.12 || command -v python3.11 || command -v python3)"
  [ -d "$NIBBI_STATE_DIR/venv" ] || "$NIBBI_PYTHON" -m venv "$NIBBI_STATE_DIR/venv"
  "$NIBBI_STATE_DIR/venv/bin/pip" install -r "$NIBBI_REPO/daemon/requirements-voice.txt"
fi
if [ "$LAUNCHD" = 1 ]; then
  node "$NIBBI_REPO/tools/install-state.mjs" --launchd
  launchctl bootstrap "gui/$NIBBI_UID" "$HOME/Library/LaunchAgents/com.nibbi.gateway.plist"
  if [ "$VOICE" = 1 ]; then
    for unit in com.nibbi.kokoro com.nibbi.whisper; do
      launchctl bootout "gui/$NIBBI_UID/$unit" >/dev/null 2>&1 || true
      launchctl bootstrap "gui/$NIBBI_UID" "$HOME/Library/LaunchAgents/$unit.plist"
    done
  fi
else
  echo "Start manually: node \"$NIBBI_REPO/server.mjs\""
fi
if [ "$APP" = 1 ]; then
  echo "Build this version of the desktop shell with: npm run deploy"
  echo "The installer does not replace your installed app with an unrelated latest release."
fi
echo "Nibbi: http://127.0.0.1:${NIBBI_PORT:-4527}"
echo "Claude: install Claude Code if needed, then choose Sign in with Claude in Settings → Providers. No API key is required."
echo "Codex: install the Codex CLI if needed, then connect it in Settings → Providers."
echo "Phone access is opt-in: start with --remote. See docs/PLATFORM-MIGRATION.md."

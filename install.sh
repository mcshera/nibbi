#!/bin/bash
# install.sh — set Nibbi up on a Mac, from a fresh clone. Idempotent: re-run any time.
#   bash install.sh                 # everything except voice; installs the desktop app from the latest release
#   bash install.sh --voice         # also the local voice stack (Kokoro TTS + whisper STT; Apple Silicon, ~2 GB of models)
#   bash install.sh --no-launchd    # don't register background services (prints how to run things by hand)
#   bash install.sh --no-app        # skip the desktop app (use http://127.0.0.1:4527 in a browser)
#   bash install.sh --owner "Your Name"   # who Nibbi works for (default: your macOS full name)
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE="$HOME/.nibbi"; VAULT="$HOME/NibbiVault"; WORK="$HOME/NibbiWork/fixers"; PROJECTS="$HOME/NibbiProjects"
GATEWAY_PORT="${NIBBI_GATEWAY_PORT:-4519}"; HOST_PORT="${NIBBI_PORT:-4527}"
VOICE=0; LAUNCHD=1; APP=1; OWNER=""; YES=0
while [ $# -gt 0 ]; do case "$1" in --voice) VOICE=1;; --no-launchd) LAUNCHD=0;; --no-app) APP=0;; --yes|-y) YES=1;; --owner) OWNER="${2:-}"; shift;; --owner=*) OWNER="${1#*=}";; -h|--help) sed -n 2,8p "$0"; exit 0;; *) echo "unknown option: $1"; exit 2;; esac; shift; done
[ -n "$OWNER" ] || OWNER="$(id -F 2>/dev/null || echo "$USER")"

ok(){ printf '  \033[32m✓\033[0m %s\n' "$1"; }; warn(){ printf '  \033[33m•\033[0m %s\n' "$1"; }; die(){ printf '  \033[31m✗\033[0m %s\n' "$1"; exit 1; }
say(){ printf '\n\033[1m%s\033[0m\n' "$1"; }

say "nibbi · install  ($REPO)"
[ "$(uname)" = "Darwin" ] || die "Nibbi's daemon and desktop app are macOS-only right now."
ARCH="$(uname -m)"; [ "$ARCH" = "arm64" ] || warn "Intel Mac: the core works; voice (--voice) needs Apple Silicon."

# ---- 1. prerequisites -------------------------------------------------------------------------------------------------
say "1 · prerequisites"
command -v git >/dev/null || die "git is missing — run: xcode-select --install"
ok "git $(git --version | awk '{print $3}')"
if command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ]; then ok "node $(node -v)"; else die "Node 22+ is required. Install from https://nodejs.org (LTS) or: brew install node@22 — then re-run."; fi
NODE="$(command -v node)"; NODEDIR="$(dirname "$NODE")"
if command -v claude >/dev/null; then ok "Claude Code $(claude --version 2>/dev/null | head -1)"; else
  warn "Claude Code CLI not found — installing (npm i -g @anthropic-ai/claude-code)"; npm i -g @anthropic-ai/claude-code >/dev/null 2>&1 && ok "Claude Code installed" || warn "could not install Claude Code automatically: npm i -g @anthropic-ai/claude-code"
fi
if [ -f "$HOME/.claude/.credentials.json" ] || security find-generic-password -s "Claude Code-credentials" >/dev/null 2>&1; then ok "Claude login found"; else warn "Claude is not logged in yet. After install, run:  claude   (log in with your Max/Pro account) — Nibbi's brain uses that login."; fi

# ---- 2. state + vault + folders --------------------------------------------------------------------------------------
say "2 · home for Nibbi"
mkdir -p "$STATE/logs" "$STATE/tmp" "$STATE/bin" "$WORK" "$PROJECTS"
cp "$REPO"/daemon/state-bin/{transcribe,tts-kokoro,kokoro-server.py,whisper-server.py,nibbi-doctor} "$STATE/bin/" 2>/dev/null || true
# vault-backup: install a simple local-snapshot default unless the user set up their own (e.g. the offsite .example)
[ -e "$STATE/bin/vault-backup" ] || cp "$REPO/daemon/state-bin/vault-backup" "$STATE/bin/" 2>/dev/null || true
chmod +x "$STATE"/bin/* 2>/dev/null || true
[ -f "$STATE/games.json" ] || echo '{}' > "$STATE/games.json"
[ -f "$STATE/auto.json" ] || echo '{}' > "$STATE/auto.json"
printf '{"path":"%s/server.mjs","node":"%s","repo":"%s"}\n' "$REPO" "$NODE" "$REPO" > "$STATE/host.json"
ok "state in $STATE"
if [ ! -d "$VAULT" ]; then
  cp -R "$REPO/vault-template" "$VAULT"
  find "$VAULT" -type f \( -name '*.md' \) -exec sed -i '' -e "s#{{OWNER}}#$OWNER#g; s#{{REPO}}#$REPO#g; s#{{DATE}}#$(date +%F)#g" {} +
  ( cd "$VAULT" && git init -q && git add -A && git -c user.name="Nibbi" -c user.email="nibbi@local" commit -q -m "vault born (install.sh)" )
  ok "vault created at $VAULT (git)"
else ok "vault exists at $VAULT"; fi
ln -sfn "$VAULT" "$HOME/Documents/NibbiVault" 2>/dev/null || true

# ---- 3. daemon deps -----------------------------------------------------------------------------------------------------
say "3 · daemon"
( cd "$REPO/daemon" && npm ci --no-audit --no-fund >/dev/null 2>&1 ) && ok "daemon dependencies installed" || die "npm ci failed in $REPO/daemon"

# ---- 4. optional voice --------------------------------------------------------------------------------------------------
if [ "$VOICE" = 1 ]; then
  say "4 · voice (Kokoro + whisper, local)"
  [ "$ARCH" = "arm64" ] || die "voice needs Apple Silicon (mlx)"
  PY="$(command -v python3.12 || command -v python3.11 || command -v python3 || true)"; [ -n "$PY" ] || die "python3 (3.10+) is required for voice"
  [ -d "$STATE/venv" ] || "$PY" -m venv "$STATE/venv"
  "$STATE/venv/bin/pip" install -q --upgrade pip >/dev/null; "$STATE/venv/bin/pip" install -q -r "$REPO/daemon/requirements-voice.txt" && ok "voice packages installed"
  # resolve ffmpeg via imageio_ffmpeg's own API — a colorized `ls` can bake ANSI codes into the path (dangling symlink); also ensure +x
  FF="$("$STATE/venv/bin/python" -c 'import imageio_ffmpeg,sys; sys.stdout.write(imageio_ffmpeg.get_ffmpeg_exe())' 2>/dev/null)"; [ -n "$FF" ] && [ -e "$FF" ] && { chmod +x "$FF" 2>/dev/null || true; ln -sfn "$FF" "$STATE/bin/ffmpeg"; ok "ffmpeg linked"; }
  warn "models download on first start (~2 GB): whisper-large-v3-turbo, whisper-small, Kokoro-82M"
else say "4 · voice — skipped (add --voice later; the app works without it)"; fi

# ---- 5. services --------------------------------------------------------------------------------------------------------
render(){ sed -e "s#__HOME__#$HOME#g; s#__REPO__#$REPO#g; s#__NODE__#$NODE#g; s#__NODEDIR__#$NODEDIR#g" "$REPO/launchd/templates/$1.plist" > "$HOME/Library/LaunchAgents/$1.plist"; }
if [ "$LAUNCHD" = 1 ]; then
  say "5 · background services (launchd)"
  mkdir -p "$HOME/Library/LaunchAgents"; UID_="$(id -u)"
  UNITS="com.nibbi.gateway com.nibbi.host"; [ "$VOICE" = 1 ] && UNITS="$UNITS com.nibbi.kokoro com.nibbi.whisper"
  for u in $UNITS; do render "$u"; launchctl bootout "gui/$UID_/$u" >/dev/null 2>&1 || true; launchctl bootstrap "gui/$UID_" "$HOME/Library/LaunchAgents/$u.plist" && launchctl kickstart -k "gui/$UID_/$u" && ok "$u running"; done
  for i in $(seq 1 30); do sleep 1; curl -sf -m 2 "http://127.0.0.1:$HOST_PORT/nibbi/health" >/dev/null 2>&1 && break; done
  if curl -sf -m 3 "http://127.0.0.1:$HOST_PORT/nibbi/health" | grep -q '"brain":true'; then ok "brain reachable through the host (http://127.0.0.1:$HOST_PORT)"; else warn "host is up but the brain isn't answering yet — check $STATE/logs/launchd.err.log"; fi
else
  say "5 · services — skipped (--no-launchd). Run by hand:"
  echo "    $REPO/daemon/bin/nibbi daemon          # the brain, port $GATEWAY_PORT"
  echo "    node $REPO/server.mjs --port $HOST_PORT   # the app host"
fi

# ---- 6. the desktop app -------------------------------------------------------------------------------------------------
if [ "$APP" = 1 ]; then
  say "6 · desktop app"
  ZIP="$STATE/tmp/Nibbi.app.zip"; URL="${NIBBI_APP_URL:-https://github.com/mcshera/nibbi/releases/latest/download/Nibbi.app.zip}"
  if curl -fsSL -o "$ZIP" "$URL" 2>/dev/null; then
    mkdir -p "$HOME/Applications"; rm -rf "$HOME/Applications/Nibbi.app"; ditto -x -k "$ZIP" "$HOME/Applications/" && xattr -dr com.apple.quarantine "$HOME/Applications/Nibbi.app" 2>/dev/null || true
    ok "Nibbi.app installed in ~/Applications (ad-hoc signed: if macOS complains, right-click → Open once)"
    [ "$LAUNCHD" = 1 ] && open "$HOME/Applications/Nibbi.app" || true
  else
    warn "no prebuilt app for this release; use the browser: http://127.0.0.1:$HOST_PORT  (or build it: cd desktop && npm i && npx tauri build — needs Rust)"
    [ "$LAUNCHD" = 1 ] && open "http://127.0.0.1:$HOST_PORT" || true
  fi
else say "6 · desktop app — skipped; open http://127.0.0.1:$HOST_PORT"; fi

say "done"
echo "  owner: $OWNER · vault: $VAULT · state: $STATE"
echo "  next: if Claude isn't logged in yet, run:  claude   → log in → then say hi to Nibbi."
echo "  health any time:  $STATE/bin/nibbi-doctor"

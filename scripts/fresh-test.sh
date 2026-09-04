#!/bin/bash
# scripts/fresh-test.sh — rehearse a first-time install without touching your real setup.
# Creates a throwaway HOME, clones THIS repo's committed state into it, runs install.sh (no services, no app), boots the
# daemon + host from that sandbox on spare ports, checks health, and tears everything down. ~1–2 minutes (npm ci).
#   npm run test:fresh            # uses the committed tree (what a stranger would clone)
#   scripts/fresh-test.sh --keep  # leave the sandbox in place for poking around
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"; KEEP=0; [ "${1:-}" = "--keep" ] && KEEP=1
BOX="$(mktemp -d /tmp/nibbi-fresh.XXXX)"; export HOME="$BOX/home"; mkdir -p "$HOME/Documents"
GW=4619; HP=4627; PASS=1
ok(){ printf '  \033[32m✓\033[0m %s\n' "$1"; }; bad(){ printf '  \033[31m✗\033[0m %s\n' "$1"; PASS=0; }
echo "fresh-test · sandbox $BOX"
git clone -q --depth 1 "file://$REPO" "$BOX/clone" || { bad "clone of committed tree failed"; exit 1; }
[ -d "$BOX/clone/daemon/src" ] && ok "clone has the daemon" || bad "daemon/ missing from the committed tree (run npm run sync:daemon and commit)"
( cd "$BOX/clone" && bash install.sh --no-launchd --no-app --owner "Fresh Tester" >"$BOX/install.log" 2>&1 ) && ok "install.sh finished" || { bad "install.sh failed — see $BOX/install.log"; tail -20 "$BOX/install.log"; }
[ -f "$HOME/NibbiVault/SOUL.md" ] && grep -q "Fresh Tester" "$HOME/NibbiVault/SOUL.md" && ok "vault created with the owner's name" || bad "vault not created correctly"
[ -f "$HOME/.nibbi/host.json" ] && ok "host.json written" || bad "host.json missing"
( cd "$BOX/clone/daemon" && NIBBI_GATEWAY_PORT=$GW ./bin/nibbi daemon >"$BOX/daemon.log" 2>&1 ) & DPID=$!
( cd "$BOX/clone" && node server.mjs --port $HP --gateway "http://127.0.0.1:$GW" >"$BOX/host.log" 2>&1 ) & HPID=$!
for i in $(seq 1 30); do sleep 1; curl -sf -m 2 "http://127.0.0.1:$HP/nibbi/health" 2>/dev/null | grep -q '"brain":true' && break; done
if curl -sf -m 3 "http://127.0.0.1:$HP/nibbi/health" | grep -q '"brain":true'; then ok "daemon + host up; brain reachable through the host"; else bad "brain not reachable (daemon.log / host.log in $BOX)"; tail -5 "$BOX/daemon.log"; fi
curl -sf -m 3 "http://127.0.0.1:$GW/api/status" | grep -q "\"vault\":\"$HOME/NibbiVault\"" && ok "daemon uses the sandbox vault" || bad "daemon is not using the sandbox vault"
curl -sf -m 3 "http://127.0.0.1:$HP/" | grep -q "nibbi.js" && ok "surface served" || bad "surface not served"
kill $HPID $DPID 2>/dev/null; sleep 1; pkill -f "$BOX/clone" 2>/dev/null || true
if [ "$KEEP" = 1 ]; then echo "  sandbox kept at $BOX"; else rm -rf "$BOX"; fi
[ "$PASS" = 1 ] && { echo "fresh-test: PASS"; exit 0; } || { echo "fresh-test: FAIL"; exit 1; }

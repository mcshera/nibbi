#!/bin/bash
# Rehearse fresh state and legacy migration using explicit isolated directories.
set -euo pipefail
NIBBI_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$NIBBI_REPO"
npm run build
exec node tools/fresh-test.mjs

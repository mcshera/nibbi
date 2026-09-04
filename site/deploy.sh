#!/bin/bash
# site/deploy.sh — publish nibbi.com to Cloudflare Pages (project "nibbi"). Needs `npx wrangler login` once, or CLOUDFLARE_API_TOKEN.
set -euo pipefail
cd "$(dirname "$0")"
cp ../public/nibbi.js ./nibbi.js && cp ../public/favicon.svg ./favicon.svg && cp ../public/icons/icon-512.png ./og.png
npx --yes wrangler@latest pages project create nibbi --production-branch main >/dev/null 2>&1 || true
npx --yes wrangler@latest pages deploy . --project-name nibbi --commit-dirty=true
echo "→ then in the Cloudflare dashboard: Workers & Pages → nibbi → Custom domains → add nibbi.com (DNS is already on Cloudflare)."

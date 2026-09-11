// Contact sheet: node design/character-lab/sheet.mjs <id> [id2 ...] [--reduced] [--energy=1.5] [--tint=#7a4b2a]
// Starts a private loopback server on an ephemeral port, renders sheet.html with local Chrome, writes evidence/sheet-<id>.png.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { listen } from './serve.mjs';
const args = process.argv.slice(2);
const ids = args.filter(a => !a.startsWith('--'));
if (!ids.length) { console.error('usage: node sheet.mjs <option-id> [...]'); process.exit(2); }
const flag = (n, d = null) => { const f = args.find(a => a.startsWith(`--${n}`)); if (!f) return d; const v = f.split('=')[1]; return v === undefined ? true : v; };
const out = fileURLToPath(new URL('./evidence/', import.meta.url)); await mkdir(out, { recursive: true });
const { server, url } = await listen(0);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 2 });
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const qs = new URLSearchParams({ ids: ids.join(','), energy: String(flag('energy', 1)) }); if (flag('reduced')) qs.set('reduced', '1'); if (flag('tint')) qs.set('tint', flag('tint')); if (flag('matrix')) { qs.set('mode', 'matrix'); if (flag('frac')) qs.set('frac', flag('frac')); }
  await page.goto(`${url}sheet.html?${qs}`);
  await page.waitForFunction(() => window.sheetReady, null, { timeout: 20000 });
  const name = flag('matrix') ? `matrix${flag('frac') ? '-' + Math.round(Number(flag('frac')) * 100) : ''}${flag('reduced') ? '-reduced' : ''}.png` : `sheet-${ids.join('+')}${flag('reduced') ? '-reduced' : ''}${flag('tint') ? '-tint' : ''}.png`;
  await page.screenshot({ path: out + name, fullPage: true });
  console.log(`wrote design/character-lab/evidence/${name}`);
  if (errors.length) { console.error('page errors:', errors.join('\n')); process.exitCode = 1; }
} finally { await browser.close(); server.close(); }

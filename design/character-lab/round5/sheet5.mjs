// node design/character-lab/round5/sheet5.mjs <id> [...] [--reduced] [--tint=#7a4b2a] [--matrix] → round5/evidence/sheet-<id>.png
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { listen } from '../serve.mjs';
const args = process.argv.slice(2); const ids = args.filter(a => !a.startsWith('--'));
if (!ids.length) { console.error('usage: node sheet5.mjs <version-id> [...]'); process.exit(2); }
const flag = (n, d = null) => { const f = args.find(a => a.startsWith(`--${n}`)); if (!f) return d; const v = f.split('=')[1]; return v === undefined ? true : v; };
const out = fileURLToPath(new URL('./evidence/', import.meta.url)); await mkdir(out, { recursive: true });
const { server, url } = await listen(0);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 2 });
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
  const qs = new URLSearchParams({ ids: ids.join(',') }); if (flag('reduced')) qs.set('reduced', '1'); if (flag('tint')) qs.set('tint', flag('tint')); if (flag('matrix')) qs.set('mode', 'matrix');
  await page.goto(`${url}round5/sheet5.html?${qs}`);
  await page.waitForFunction(() => window.sheetReady, null, { timeout: 180000 });
  const name = flag('matrix') ? `matrix${flag('reduced') ? '-reduced' : ''}.png` : `sheet-${ids.join('+')}${flag('reduced') ? '-reduced' : ''}${flag('tint') ? '-tint' : ''}.png`;
  await page.screenshot({ path: out + name, fullPage: true });
  console.log(`wrote design/character-lab/round5/evidence/${name}`);
  if (errors.length) { console.error('page errors:', errors.join('\n')); process.exitCode = 1; }
} finally { await browser.close(); server.close(); }

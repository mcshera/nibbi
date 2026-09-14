// node design/sidebar-lab/sheet.mjs <id> [id...] [--matrix] [--flags=all|a,b] [--reduced] [--glass] [--native-mac] [--states=a,b] [--viewports=1180x760,390x844]
// Every option across every moment at two sizes, in one image. Starts its own loopback server.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { listen } from './serve.mjs';
const args = process.argv.slice(2);
const ids = args.filter(a => !a.startsWith('--'));
if (!ids.length) { console.error('usage: node design/sidebar-lab/sheet.mjs <id> [...] [--matrix]'); process.exit(2); }
const flag = (name, fallback = null) => { const f = args.find(a => a === `--${name}` || a.startsWith(`--${name}=`)); return f ? (f.includes('=') ? f.split('=')[1] : true) : fallback; };
const out = fileURLToPath(new URL('./evidence/', import.meta.url));
await mkdir(out, { recursive: true });
const query = new URLSearchParams({ ids: ids.join(',') });
for (const [param, name] of [['flags', 'flags'], ['states', 'states'], ['viewports', 'viewports'], ['scale', 'scale']]) if (flag(name)) query.set(param, flag(name));
if (flag('reduced')) query.set('reduced', '1');
if (flag('glass')) query.set('glass', '1');
if (flag('native-mac')) query.set('nativeMac', '1');
const { server, url } = await listen(0);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${url}sheet.html?${query}`);
  await page.waitForFunction(() => window.sheetReady, null, { timeout: 60000 });
  // Fit the page to the sheet so the screenshot has no empty ground below it.
  const size = await page.evaluate(() => ({ width: Math.ceil(document.body.scrollWidth), height: Math.ceil(document.body.scrollHeight) }));
  await page.setViewportSize({ width: Math.min(size.width + 20, 16000), height: Math.min(size.height + 20, 16000) });
  await page.waitForTimeout(400);
  const name = (flag('matrix') ? 'matrix' : `sheet-${ids.join('+')}`)
    + (flag('flags') ? '-improved' : '') + (flag('reduced') ? '-reduced' : '') + (flag('glass') ? '-glass' : '') + '.png';
  await page.screenshot({ path: out + name, fullPage: true });
  console.log(`wrote design/sidebar-lab/evidence/${name}`);
  if (errors.length) { console.error('page errors:\n' + [...new Set(errors)].join('\n')); process.exitCode = 1; }
} finally { await browser.close(); server.close(); }

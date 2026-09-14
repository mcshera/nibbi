// node design/sidebar-lab/shot.mjs <id> [state=home] [WxH=1180x820] [--flags=a,b|all] [--glass] [--native-mac] [--reduced] [--out name]
// One option, one moment, one size, at its real page viewport. Writes evidence/shot-<id>-<state>-<WxH>.png.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { listen } from './serve.mjs';
const args = process.argv.slice(2);
const plain = args.filter(a => !a.startsWith('--'));
const flag = (name, fallback = null) => { const f = args.find(a => a === `--${name}` || a.startsWith(`--${name}=`)); return f ? (f.includes('=') ? f.split('=')[1] : true) : fallback; };
const id = plain[0];
if (!id) { console.error('usage: node design/sidebar-lab/shot.mjs <id> [state] [WxH]'); process.exit(2); }
const state = plain[1] || 'home';
const size = plain[2] || '1180x820';
const [width, height] = size.split('x').map(Number);
const out = fileURLToPath(new URL('./evidence/', import.meta.url));
await mkdir(out, { recursive: true });
const query = new URLSearchParams({ scale: '1', only: id, frame: size, state });
if (flag('flags')) query.set('flags', flag('flags'));
if (flag('glass')) query.set('glass', '1');
if (flag('native-mac')) query.set('nativeMac', '1');
if (flag('reduced')) query.set('reduced', '1');
const { server, url } = await listen(0);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${url}?${query}`);
  await page.waitForFunction(() => window.sidebarLab?.ready, null, { timeout: 30000 });
  await page.waitForTimeout(500);
  const name = (flag('out') && typeof flag('out') === 'string' ? flag('out') : `shot-${id}-${state}-${size}`) + '.png';
  await page.screenshot({ path: out + name });
  console.log(`wrote design/sidebar-lab/evidence/${name}`);
  if (errors.length) { console.error('page errors:\n' + [...new Set(errors)].join('\n')); process.exitCode = 1; }
} finally { await browser.close(); server.close(); }

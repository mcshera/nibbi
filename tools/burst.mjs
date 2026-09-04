
import { existsSync } from 'node:fs';
const LOCAL = new URL('../node_modules/playwright-core/index.mjs', import.meta.url).pathname;
const PW = process.env.NIBBI_PLAYWRIGHT || (existsSync(LOCAL) ? LOCAL : null);
if (!PW) { console.error('playwright-core not found — run: npm i -D playwright-core  (or set NIBBI_PLAYWRIGHT to its index.mjs)'); process.exit(2); }
const { chromium } = await import(PW);
const CHANNEL = process.env.CI ? undefined : 'chrome';
const [,, url, out, times, msg] = process.argv;
const b = await chromium.launch({ channel: CHANNEL, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const pg = await b.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const errs = []; pg.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
await pg.goto(url, { waitUntil: 'load' }); await pg.waitForTimeout(1500);
await pg.evaluate((m) => { void window.nibbiApp.send(m); }, msg);
let t = 0; const states = [];
for (const [i, ms] of times.split(',').map(Number).entries()) { await pg.waitForTimeout(ms - t); t = ms; states.push(await pg.evaluate(() => { const s = window.nibbi.state(); return [Math.round(s.y), Math.round(s.r), s.mood]; })); await pg.screenshot({ path: `${out}-${i}.png`, clip: { x: 420, y: 0, width: 600, height: 460 } }); }
console.log(JSON.stringify({ errs, states }));
await b.close();

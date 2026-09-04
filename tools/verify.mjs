// tools/verify.mjs — scenario screenshots + probe for the Nibbi surface. Writes .shots/v-*.png and prints a JSON summary.
// usage: node tools/verify.mjs [base=http://127.0.0.1:4527]
import { existsSync } from 'node:fs';
const LOCAL = new URL('../node_modules/playwright-core/index.mjs', import.meta.url).pathname;
const PW = process.env.NIBBI_PLAYWRIGHT || (existsSync(LOCAL) ? LOCAL : null);
if (!PW) { console.error('playwright-core not found — run: npm i -D playwright-core  (or set NIBBI_PLAYWRIGHT to its index.mjs)'); process.exit(2); }
const { chromium } = await import(PW);
const CHANNEL = process.env.CI ? undefined : 'chrome';
const base = process.argv[2] || 'http://127.0.0.1:4527';
const out = new URL('../.shots/', import.meta.url).pathname;
const b = await chromium.launch({ channel: CHANNEL, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const errs = [];
async function page(w, h, dpr) { const pg = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr || 1 }); pg.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 200))); pg.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); }); return pg; }
const probe = (pg) => pg.evaluate(() => ({ mode: document.body.dataset.mode, link: document.body.dataset.link, mood: window.nibbi.mood(), fps: window.nibbi.state().fps, r: Math.round(window.nibbi.state().r), y: Math.round(window.nibbi.state().y), turns: window.nibbiApp.state().turns.length, steps: document.querySelectorAll('.step').length, chips: [...document.querySelectorAll('.chip')].map((c) => c.textContent) }));
const summary = {};
{ const pg = await page(1440, 1000, 2); await pg.goto(base + '/?demo=1'); await pg.waitForTimeout(2200); await pg.screenshot({ path: out + 'v-idle.png' }); summary.idle = await probe(pg);
  await pg.focus('#ask'); await pg.waitForTimeout(900); await pg.screenshot({ path: out + 'v-focus.png' }); summary.focus = await probe(pg);
  await pg.type('#ask', 'fix the bug where the turn lock sticks after an abort'); await pg.waitForTimeout(400); await pg.screenshot({ path: out + 'v-typing.png' });
  await pg.keyboard.press('Enter'); await pg.waitForTimeout(500); await pg.screenshot({ path: out + 'v-thinking.png' }); summary.thinking = await probe(pg);
  await pg.waitForTimeout(2300); await pg.screenshot({ path: out + 'v-working.png' }); summary.working = await probe(pg);
  await pg.waitForTimeout(2200); await pg.screenshot({ path: out + 'v-speaking.png' }); summary.speaking = await probe(pg);
  await pg.waitForTimeout(4200); await pg.screenshot({ path: out + 'v-done.png' }); summary.done = await probe(pg);
  await pg.evaluate(() => { void window.nibbiApp.send('and now make it error'); }); await pg.waitForTimeout(2300); await pg.screenshot({ path: out + 'v-error.png' }); summary.error = await probe(pg);
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(900); await pg.screenshot({ path: out + 'v-tidy.png' }); summary.tidy = await probe(pg);
  await pg.close(); }
{ const pg = await page(430, 780, 2); await pg.goto(base + '/?demo=1'); await pg.waitForTimeout(1800); await pg.screenshot({ path: out + 'v-phone-idle.png' });
  await pg.evaluate(() => { void window.nibbiApp.send('hello, who are you?'); }); await pg.waitForTimeout(7000); await pg.screenshot({ path: out + 'v-phone-talk.png' }); summary.phone = await probe(pg); await pg.close(); }
{ const pg = await page(1440, 1000, 1); await pg.goto(base + '/'); await pg.waitForTimeout(2500); summary.real = await probe(pg); await pg.close(); }
await b.close();
console.log(JSON.stringify({ errors: errs, ...summary }, null, 1));

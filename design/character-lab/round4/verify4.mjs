// Browser checks + screenshots for the round-4 shell. node design/character-lab/round4/verify4.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { listen } from '../serve.mjs';
const out = fileURLToPath(new URL('./evidence/', import.meta.url)); await mkdir(out, { recursive: true });
const { server, url } = await listen(0);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = { checks: [], errors: [], environment: 'local Chrome via Playwright with SwiftShader WebGL; not a device benchmark' };
const check = (name, detail = {}) => { results.checks.push({ name, ...detail }); console.log('PASS', name); };
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => results.errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') results.errors.push(m.text()); });
  await page.goto(url + 'round4/'); await page.waitForFunction(() => window.techLab?.ready, null, { timeout: 60000 }); await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(() => techLab.loaded());
  assert.ok(loaded.every(l => l.hero && l.pill && l.tiny), JSON.stringify(loaded)); check('All techniques mounted at hero/pill/tiny', { loaded });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out + 'lab4-desktop.png', fullPage: true });
  const stageTop = await page.evaluate(() => { const r = document.querySelector('.study .stage').getBoundingClientRect(); return Math.max(0, Math.round(r.top + scrollY - 70)); });
  const clip = { x: 0, y: stageTop, width: 1600, height: 560 };
  for (const a of ['think', 'work', 'success', 'error', 'sleep']) { await page.evaluate(a => techLab.cue(a), a); await page.waitForTimeout(a === 'success' ? 700 : 1300); await page.screenshot({ path: out + `lab4-${a}.png`, clip }); }
  check('Cued think/work/success/error/sleep across all techniques with screenshots');
  const ms = await page.textContent('#fps'); check('Frame cost reported', { fps: ms });
  await page.evaluate(() => techLab.setReduced(true)); await page.evaluate(() => techLab.cue('think')); await page.waitForTimeout(1400);
  await page.screenshot({ path: out + 'lab4-reduced.png', clip });
  await page.evaluate(() => techLab.setReduced(false));
  assert.equal(results.errors.filter(e => !/favicon|WebGL|GPU stall/i.test(e)).length, 0, results.errors.join('\n')); check('No page errors');
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await mobile.goto(url + 'round4/'); await mobile.waitForFunction(() => window.techLab?.ready, null, { timeout: 60000 }); await mobile.waitForTimeout(800);
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); assert.ok(overflow <= 0, `overflow ${overflow}`);
  await mobile.screenshot({ path: out + 'lab4-mobile.png', fullPage: true }); check('Mobile 390 px: no horizontal overflow');
} catch (e) { failed = true; console.log('FAIL', e.message); results.checks.push({ name: 'exception', error: e.message }); }
finally { results.failed = failed; await writeFile(out + 'browser-results.json', JSON.stringify(results, null, 2)); await browser.close(); server.close(); console.log(failed ? 'RESULT: FAILED' : 'RESULT: all browser checks passed'); process.exitCode = failed ? 1 : 0; }

// Browser checks + screenshots for the round-5 shell. node design/character-lab/round5/verify5.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { listen } from '../serve.mjs';
const out = fileURLToPath(new URL('./evidence/', import.meta.url)); await mkdir(out, { recursive: true });
const { server, url } = await listen(0);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = { checks: [], errors: [], environment: 'local Chrome via Playwright with software rendering; not a device benchmark' };
const check = (name, detail = {}) => { results.checks.push({ name, ...detail }); console.log('PASS', name); };
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => results.errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') results.errors.push(m.text()); });
  await page.goto(url + 'round5/'); await page.waitForFunction(() => window.techLab?.ready, null, { timeout: 60000 }); await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(() => techLab.loaded());
  assert.ok(loaded.every(l => l.hero && l.pill && l.tiny), JSON.stringify(loaded)); check('All versions mounted at hero/pill/tiny', { loaded });
  await page.waitForTimeout(1500);
  const shot = async (opts) => { await page.evaluate(() => techLab.pause(true)); await page.screenshot(opts); await page.evaluate(() => techLab.pause(false)); };   // pause the clock while capturing: 30 live canvases starve the compositor under software rendering
  await shot({ path: out + 'lab5-desktop.png', fullPage: true });
  const stageTop = await page.evaluate(() => { const r = document.querySelector('.study .stage').getBoundingClientRect(); return Math.max(0, Math.round(r.top + scrollY - 70)); });
  const clip = { x: 0, y: stageTop, width: 1600, height: 560 };
  for (const a of ['listen', 'think', 'work', 'success', 'error', 'sleep']) { await page.evaluate(a => techLab.cue(a), a); await page.waitForTimeout(a === 'success' ? 700 : 1400); await shot({ path: out + `lab5-${a}.png`, clip, fullPage: true }); }
  check('Cued listen/think/work/success/error/sleep across all versions with screenshots');
  // the beat, live: type into the composer → listen; enter → think → hello
  await page.evaluate(() => techLab.cue('idle')); await page.focus('#say'); await page.waitForTimeout(600);
  const listening = await page.evaluate(() => techLab.action); assert.equal(listening, 'listen', `composer focus should cue listen, got ${listening}`);
  await page.keyboard.type('is the diff viewer ready?'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => techLab.action === 'think', null, { timeout: 3000 }); await page.waitForTimeout(300);
  await shot({ path: out + 'lab5-beat-think.png', clip, fullPage: true });
  await page.waitForFunction(() => techLab.action === 'hello', null, { timeout: 8000 });   // the beat scales with the message; the reply lands as hello
  check('Composer drives the beat: focus → listen, enter → think → reply');
  const ms = await page.textContent('#fps'); check('Frame cost reported', { fps: ms });
  await page.evaluate(() => techLab.setReduced(true)); await page.evaluate(() => techLab.cue('think')); await page.waitForTimeout(1400);
  await shot({ path: out + 'lab5-reduced.png', clip, fullPage: true });
  await page.evaluate(() => techLab.setReduced(false));
  assert.equal(results.errors.filter(e => !/favicon|WebGL|GPU stall/i.test(e)).length, 0, results.errors.join('\n')); check('No page errors');
  await page.close();
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await mobile.goto(url + 'round5/'); await mobile.waitForFunction(() => window.techLab?.ready, null, { timeout: 60000 }); await mobile.waitForTimeout(800);
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); assert.ok(overflow <= 0, `overflow ${overflow}`);
  await mobile.evaluate(() => techLab.pause(true)); await mobile.screenshot({ path: out + 'lab5-mobile.png' });   // viewport only: a full-page mobile capture of 30 live canvases is unreliable under software rendering
  await mobile.evaluate(() => document.querySelector('.study .stage').scrollIntoView({ block: 'center' })); await mobile.waitForTimeout(200); await mobile.screenshot({ path: out + 'lab5-mobile-study.png' });
  check('Mobile 390 px: no horizontal overflow');
} catch (e) { failed = true; console.log('FAIL', e.message); results.checks.push({ name: 'exception', error: e.message }); }
finally { results.failed = failed; await writeFile(out + 'browser-results.json', JSON.stringify(results, null, 2)); await browser.close(); server.close(); console.log(failed ? 'RESULT: FAILED' : 'RESULT: all browser checks passed'); process.exitCode = failed ? 1 : 0; }

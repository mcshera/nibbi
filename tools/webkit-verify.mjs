// WKWebView is the engine Nibbi ships in, and every other suite runs Chromium. This one drives the
// real built app in Playwright's WebKit against an isolated backend: the bar, a streamed reply,
// main's build page and a ticket. Not part of `npm run verify` (launch cost, flake); `npm run verify:webkit`.
// No WebGL claim either way: headless WebKit here reports webgl, a GPU-less runner falls back to
// nibbi.js's canvas2d. The suite prints which backend drew the character and asserts neither.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { webkit } from 'playwright';
import { testBackend } from './test-backend.mjs';

const fixture = await testBackend();
const out = new URL('../output/webkit/', import.meta.url).pathname; mkdirSync(out, { recursive: true });
const errors = [];
let browser, failed = 0;
const hiddenBar = page => page.locator('#workspace-sidebar').getAttribute('aria-hidden');
// Nothing here may wait forever. page.evaluate has no timeout, and headless WebKit on a GPU-less CI
// runner can stop advancing animations: an unbounded settle hung the whole job for 15 minutes with
// no output. Every wait is bounded, and the last step reached is named when one runs out.
let reached = 'launch';
const mark = step => { reached = step; };
const bounded = (promise, ms, what) => { let timer; return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} did not finish in ${ms}ms (last step: ${reached})`)), ms); timer.unref?.(); })]).finally(() => clearTimeout(timer)); };
// Finite animations only: a live turn's pulse runs forever. At most 2s in the page, 10s from here.
const settle = page => bounded(page.evaluate(() => Promise.race([
  Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))),
  new Promise(resolve => setTimeout(resolve, 2000)),
])), 10_000, 'settle');

async function size(width, height) {
  const tag = `${width}x${height}`, phone = width < 900;
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: phone });
  const page = await context.newPage(); page.setDefaultTimeout(15_000);
  page.on('pageerror', error => errors.push(`${tag}: ${error.message}`));
  mark(`${tag} boot`); await page.goto(fixture.base + '/?demo=1&nosw=1');
  await page.waitForFunction(() => window.nibbiApp && window.nibbi);
  assert.ok(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--t2').trim()), `${tag}: tokens.css is linked`);
  const renderer = await page.evaluate(() => { const n = window.nibbi.state(); return n.backend + (n.fallbackReason ? ` (${n.fallbackReason})` : ''); });

  // The bar: a drawer that starts closed on a phone, docked and open on a desktop.
  mark(`${tag} bar`);
  if (phone) {
    assert.equal(await hiddenBar(page), 'true', `${tag}: the drawer starts closed`);
    await page.locator('#sidebar-toggle').click(); await settle(page);
    assert.equal(await hiddenBar(page), 'false', `${tag}: the toggle opens it`);
  } else {
    assert.equal(await hiddenBar(page), 'false', `${tag}: the docked bar starts open`);
    await page.locator('.sidebar-collapse').click(); await settle(page);
    assert.equal(await hiddenBar(page), 'true', `${tag}: collapse closes it`);
    await page.locator('#sidebar-toggle').click(); await settle(page);
    assert.equal(await hiddenBar(page), 'false', `${tag}: and the toggle brings it back`);
  }
  // The Cards bar: one build row (main), the conversations, and rows big enough to hit — a two-line row
  // is 44 tall everywhere; every row and key is 44 in the drawer (≤899px), 32 docked.
  const bar = await page.evaluate(() => {
    const el = document.querySelector('#workspace-sidebar'), shown = list => [...list].filter(n => n.getClientRects().length);
    const h = n => n.getBoundingClientRect().height;
    const two = shown(el.querySelectorAll('.cp-row.cp-two')), rows = shown(el.querySelectorAll('.cp-row, .cp-key, .cp-icon-key'));
    return { builds: el.querySelectorAll('[data-bar-build]').length, conversations: shown(el.querySelectorAll('.project-thread[data-thread-id]')).length,
      minTwo: Math.min(...two.map(h)), minRow: Math.min(...rows.map(h)), overflow: el.scrollWidth - el.clientWidth };
  });
  assert.equal(bar.builds, 1, `${tag}: one build row, main`);
  assert.ok(bar.conversations >= 1, `${tag}: the conversations card lists at least home`);
  assert.ok(bar.minTwo + .5 >= 44, `${tag}: a two-line row is 44 tall: ${bar.minTwo}px`);
  assert.ok(bar.minRow + .5 >= (phone ? 44 : 32), `${tag}: rows and keys are big enough to hit: ${bar.minRow}px`);
  assert.ok(bar.overflow <= 1, `${tag}: the bar does not scroll sideways: ${bar.overflow}px`);
  await page.locator('.margin-switch-trigger').click(); await settle(page);
  assert.ok(await page.evaluate(() => { const m = document.querySelector('.margin-switch-menu').getBoundingClientRect(), b = document.querySelector('#workspace-sidebar').getBoundingClientRect(); return !document.querySelector('.margin-switch-menu').hidden && m.left >= b.left - 1 && m.right <= b.right + 1; }), `${tag}: the switcher opens inside the bar`);
  await page.keyboard.press('Escape'); await settle(page);
  assert.equal(await page.evaluate(() => document.querySelector('.margin-switch-menu').hidden), true, `${tag}: Escape closes the switcher`);
  assert.equal(await hiddenBar(page), 'false', `${tag}: and leaves the bar where it was`);
  await page.screenshot({ path: out + `bar-${tag}.png` });
  if (phone) { await page.locator('.sidebar-collapse').click(); await settle(page); assert.equal(await hiddenBar(page), 'true', `${tag}: collapse closes the drawer`); }

  // A streamed reply: a live tail while it arrives, nothing of it left once it settles.
  mark(`${tag} stream`);
  await page.evaluate(() => { void window.nibbiApp.send('fix the lock bug'); });
  await page.locator('.bubble.live .said-tail').waitFor({ timeout: 20_000 });
  await page.screenshot({ path: out + `stream-${tag}.png` });
  await page.waitForFunction(() => !window.nibbiApp.state().busy, null, { timeout: 30_000 });
  const reply = await page.evaluate(() => { const said = [...document.querySelectorAll('.said')].at(-1); return { tails: document.querySelectorAll('.said-tail').length, items: said.querySelectorAll('li').length, text: said.textContent }; });
  assert.equal(reply.tails, 0, `${tag}: no live tail is left behind`);
  assert.equal(reply.items, 2, `${tag}: both list items settled`);
  assert.match(reply.text, /ship it straight to/, `${tag}: the whole reply is there`);

  // main's build page, on the fixture's runs, and from its list the staged one's ticket.
  mark(`${tag} build page`);
  if (phone) { await page.locator('#sidebar-toggle').click(); await settle(page); }
  await page.locator('[data-bar-build="main"]').click();
  await page.locator('#project-workspace:not([hidden])').waitFor();
  const staged = page.locator('#project-workspace .cp-page[data-cp-page="build"] .cp-imp[data-cp-key="imp-run:fixture-0"]');
  await staged.waitFor();
  await settle(page);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tag}: no horizontal page overflow`);
  await page.screenshot({ path: out + `build-${tag}.png` });
  mark(`${tag} ticket`);
  await staged.click();
  await page.locator('#project-workspace .cp-page[data-cp-page="ticket"][data-cp-id="run:fixture-0"] article.cp-try[data-cp-run="fixture-0"]').waitFor();
  await settle(page);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tag}: no horizontal page overflow on the ticket`);
  await page.screenshot({ path: out + `ticket-${tag}.png` });
  await bounded(context.close(), 15_000, 'context close');
  return { tag, renderer };
}

/** A copy on a phone (docs/BUILDS-AS-COPIES.md §6.5): made on the same backend once main's checks are done,
    with one improvement landed in it. Its row, caret, play and ship are 44; its page does not scroll sideways. */
async function copies() {
  const tag = '390x844 copy';
  mark(`${tag} made`);
  const kit = await fixture.enableCopies();
  const landed = await kit.improve(kit.dev.id, 'Say hello on the title screen');
  assert.equal(landed.status, 'merged', `${tag}: the improvement landed in dev`);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage(); page.setDefaultTimeout(15_000);
  page.on('pageerror', error => errors.push(`${tag}: ${error.message}`));
  await page.goto(fixture.base + '/?demo=1&nosw=1');
  await page.waitForFunction(() => window.nibbiApp && window.nibbi);
  await page.locator('#sidebar-toggle').click(); await settle(page);
  mark(`${tag} bar`);
  await page.locator('#workspace-sidebar [data-bar-build="dev"]').waitFor();
  await page.locator('#workspace-sidebar [data-cp-role="ship-copy"][data-build="dev"]').scrollIntoViewIfNeeded(); await settle(page);
  const keys = await page.evaluate(() => [...document.querySelectorAll('#workspace-sidebar .cp-build[data-build="dev"] button')].filter(n => n.getClientRects().length)
    .map(n => ({ role: n.dataset.cpRole || n.dataset.barBuild || n.dataset.barImprovement || n.className, h: Math.round(n.getBoundingClientRect().height) })));
  for (const role of ['dev', 'build-disclosure', 'play-copy', 'ship-copy']) assert.ok(keys.some(k => k.role === role), `${tag}: ${role} is drawn`);
  assert.deepEqual(keys.filter(k => k.h < 44), [], `${tag}: dev's row and keys are 44`);
  await page.screenshot({ path: out + 'copy-bar-390x844.png' });
  mark(`${tag} page`);
  await page.locator('#workspace-sidebar [data-bar-build="dev"]').click();
  await page.locator('#project-workspace .cp-page[data-cp-page="build"][data-cp-id="dev"]').waitFor();
  await settle(page);
  assert.equal(await page.locator('#project-workspace .cp-copyline').innerText(), 'copy of main · 1 ahead · 0 behind', `${tag}: its page says what it is`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tag}: no horizontal page overflow on the copy's page`);
  await page.screenshot({ path: out + 'copy-page-390x844.png' });
  await bounded(context.close(), 15_000, 'context close');
}

try {
  browser = await webkit.launch();
  const seen = [];
  for (const [width, height] of [[1180, 820], [390, 844]]) {
    try { seen.push(await bounded(size(width, height), 180_000, `webkit ${width}x${height}`)); console.log('PASS', `webkit ${width}x${height}`); }
    catch (error) { failed++; console.error('FAIL', `webkit ${width}x${height}`, '\n', error.stack || error.message); }
  }
  try { await bounded(copies(), 180_000, 'webkit copies'); console.log('PASS', 'webkit a copy at 390x844'); }
  catch (error) { failed++; console.error('FAIL', 'webkit a copy at 390x844', '\n', error.stack || error.message); }
  if (errors.length) { failed++; console.error('FAIL no page errors in WebKit', errors); }
  if (!failed) console.log(`WebKit checks passed (${browser.version()}): the bar, a streamed reply, main's build page and a ticket at 1180x820 and 390x844, and a copy's row, keys and page at 390x844. Renderer: ${seen.map(s => s.tag + ' ' + s.renderer).join('; ')}.`);
} finally { await bounded(browser?.close() ?? Promise.resolve(), 20_000, 'browser close').catch(error => { failed++; console.error('FAIL', error.message); }); await fixture.close(); }
process.exitCode = failed ? 1 : 0;

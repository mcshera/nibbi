// Attention and liveness checks against an isolated backend, vault and repositories. Never the live app.
// One named scenario per concern; each gets a fresh context. Run by `npm run verify` after verify.mjs.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { testBackend } from './test-backend.mjs';

const fixture = await testBackend();
const { runtime } = await import('../daemon/dist/store.js');
const { saveFixer } = await import('../daemon/dist/fixer.js');
const out = new URL('../output/attention/', import.meta.url).pathname; mkdirSync(out, { recursive: true });
const errors = [];
const command = (name, args) => fetch(fixture.base + '/api/commands', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, idempotencyKey: crypto.randomUUID(), args }) }).then(r => r.json());
// The fixture has no provider and no drained queue, so a retried build stays queued. A real failure, or a
// build that stops to ask, is written through the daemon's own saveFixer: the same run.updated a live build emits.
const settle = (id, patch) => { const run = runtime().get('fixers', id); assert.ok(run, 'run ' + id + ' exists'); saveFixer({ ...run, endedAt: new Date().toISOString(), ...patch }); };
const retried = async id => { const r = await command('run.retry', { id }); const next = r.text?.match(/Queued (\S+);/)?.[1]; assert.ok(next, 'run.retry queued a build: ' + JSON.stringify(r)); return next; };

async function open(browser, { width = 1180, height = 820, mobile = false, init } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
  if (init) await context.addInitScript(init);
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !(message.location().url.endsWith('/api/commands') && message.text().includes('400'))) errors.push(message.text() + ' @ ' + message.location().url); });
  await page.goto(fixture.base + '/?nosw=1');
  await page.waitForFunction(() => window.nibbiApp && document.body.dataset.link === 'live');
  return { context, page };
}
const lastNib = page => page.evaluate(() => { const nib = [...document.querySelectorAll('#feed .turn .nib')].at(-1); return nib ? { cls: [...nib.classList], text: nib.querySelector('.said').innerText.replace(/\s+/g, ' ').trim() } : null; });

// A window you are not looking at: notifications allowed, sounds on, audio counted rather than played.
function awayWindow() {
  window.__qaMocks = { notifications: [], tones: 0 };
  class N { static permission = 'granted'; static async requestPermission() { return 'granted'; } constructor(title, options) { this.title = title; this.options = options; __qaMocks.notifications.push(this); } close() { this.closed = true; } }
  Object.defineProperty(window, 'Notification', { value: N, configurable: true });
  document.hasFocus = () => false;
  localStorage.setItem('nibbi.sounds', 'true');
  const node = () => ({ connect() {}, disconnect() {}, start() {}, stop() {}, gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} } });
  window.AudioContext = class { constructor() { this.destination = node(); this.currentTime = 0; this.state = 'running'; } createGain() { return node(); } createOscillator() { __qaMocks.tones++; return node(); } resume() { return Promise.resolve(); } close() { return Promise.resolve(); } };
  window.speechSynthesis = { speak() {}, cancel() {}, getVoices() { return []; } };
}

async function verdicts(browser) {
  const { context, page } = await open(browser, { init: awayWindow });
  const title = await page.title();
  assert.equal(title, '(1) Nibbi', 'the tab counts the one build waiting for review');

  // failed: a verdict — the error bubble, the error sound, a notification that opens the build.
  const failing = await retried('fixture-3');
  settle(failing, { status: 'failed', summary: 'Fixture: failed before any provider was called.' });
  await page.waitForFunction(() => __qaMocks.notifications.length > 0);
  const note = await page.evaluate(() => ({ title: __qaMocks.notifications[0].title, body: __qaMocks.notifications[0].options.body }));
  assert.equal(note.title, 'Build failed');
  assert.match(note.body, / · fixture$/, 'the body names the build and its project');
  await page.waitForFunction(() => /failed on fixture/.test([...document.querySelectorAll('#feed .turn .said')].at(-1)?.innerText || ''));
  assert.ok((await lastNib(page)).cls.includes('error'), 'a failure is the error bubble');
  assert.equal(await page.evaluate(() => __qaMocks.tones), 1, 'and it sounds once');
  assert.equal(await page.title(), title, 'a failure does not change what is waiting on you');
  await page.screenshot({ path: out + 'verdict-failed-1180x820.png' });

  // cancelled: not judged — a notice, no sound, no notification.
  const stopping = await retried('fixture-4');
  assert.match((await command('run.stop', { id: stopping })).text, /Cancelled/);
  await page.waitForFunction(() => /^Stopped /.test([...document.querySelectorAll('#feed .turn .said')].at(-1)?.innerText || ''));
  const stopped = await lastNib(page);
  assert.match(stopped.text, /^Stopped .+ on fixture\. The work is kept; retry when you want\./);
  assert.ok(stopped.cls.includes('notice') && !stopped.cls.includes('error'), 'a stop is a notice, not a failure: ' + stopped.cls);
  assert.equal(await page.evaluate(() => __qaMocks.tones), 1, 'a stop makes no sound');
  assert.equal(await page.evaluate(() => __qaMocks.notifications.length), 1, 'and sends no notification');
  assert.notEqual(await page.evaluate(() => window.nibbi.state().mood), 'happy', 'and the character is not pleased about it');
  await page.screenshot({ path: out + 'verdict-cancelled-1180x820.png' });

  // awaiting_input: no daemon producer yet, so the record is written the way one would be.
  const asking = await retried('fixture-5');
  settle(asking, { status: 'awaiting_input', endedAt: undefined });
  await page.waitForFunction(() => __qaMocks.notifications.length > 1);
  assert.equal(await page.evaluate(() => __qaMocks.notifications[1].title), 'Needs your input');
  await page.waitForFunction(() => / is waiting on you\.$/.test([...document.querySelectorAll('#feed .turn .said')].at(-1)?.innerText.trim() || ''));
  assert.deepEqual(await page.evaluate(() => [...[...document.querySelectorAll('#feed .turn')].at(-1).querySelectorAll('.chip')].map(c => c.textContent)), ['steer', 'stop', 'open build', 'ask nibbi']);
  await page.waitForFunction(() => document.title === '(2) Nibbi');
  await page.waitForFunction(() => document.querySelector('.margin-tab[data-margin-tab="builds"]')?.getAttribute('aria-label') === 'Builds. 1 needs input', null, { timeout: 10000 });
  await page.screenshot({ path: out + 'verdict-waiting-1180x820.png' });

  // Answered, then asked again: the second question is news as well, not a repeat of the first.
  const asked = () => page.evaluate(() => [...document.querySelectorAll('#feed .turn .said')].filter(said => / is waiting on you\.$/.test(said.innerText.trim())).length);
  assert.equal(await asked(), 1);
  settle(asking, { status: 'running', endedAt: undefined });
  await page.waitForFunction(() => document.title === '(1) Nibbi');
  settle(asking, { status: 'awaiting_input', endedAt: undefined });
  await page.waitForFunction(() => __qaMocks.notifications.length > 2);
  assert.equal(await page.evaluate(() => __qaMocks.notifications[2].title), 'Needs your input');
  await page.waitForFunction(() => [...document.querySelectorAll('#feed .turn .said')].filter(said => / is waiting on you\.$/.test(said.innerText.trim())).length === 2);
  await page.waitForTimeout(600);
  assert.equal(await asked(), 2, 'one line per question');
  assert.equal(await page.evaluate(() => __qaMocks.notifications.length), 3, 'and one notification per question');

  // A notification is a way back to the build it is about.
  await page.evaluate(() => __qaMocks.notifications[0].onclick());
  await page.locator('#project-workspace:not([hidden])').waitFor();
  await page.locator(`[data-build-id="${failing}"]`).first().waitFor();
  assert.equal(await page.evaluate(() => __qaMocks.notifications[0].closed), true, 'clicking it closes it');
  await context.close();

  // On a phone the closed bar says it on its toggle, and a focused window gets no notification.
  const phone = await open(browser, { width: 390, height: 844, mobile: true, init: () => { window.__qaMocks = { notifications: [] }; class N { static permission = 'granted'; static async requestPermission() { return 'granted'; } constructor(title) { __qaMocks.notifications.push(title); } } Object.defineProperty(window, 'Notification', { value: N, configurable: true }); document.hasFocus = () => true; } });
  await phone.page.waitForFunction(() => document.querySelector('#sidebar-toggle .sidebar-toggle-count')?.textContent === '1 needs input', null, { timeout: 10000 });
  assert.equal(await phone.page.locator('#sidebar-toggle').getAttribute('aria-label'), 'Open sidebar');
  assert.equal(await phone.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the wider toggle stays on the page');
  await phone.page.screenshot({ path: out + 'toggle-count-390x844.png' });
  const failingAgain = await retried('fixture-6');
  settle(failingAgain, { status: 'failed', summary: 'Fixture: failed while you were looking.' });
  await phone.page.waitForFunction(() => /failed on fixture/.test([...document.querySelectorAll('#feed .turn .said')].at(-1)?.innerText || ''));
  assert.deepEqual(await phone.page.evaluate(() => __qaMocks.notifications), [], 'the window you are looking at gets the bubble, not a notification');
  await phone.page.waitForTimeout(1200);   // the character springs to its talk pose; shoot the settled room
  await phone.page.screenshot({ path: out + 'verdict-failed-390x844.png' });
  await phone.context.close();
}

// The toggle's words beside the character. In the talk pose it sits top-centre, and on a narrow phone the
// words wrap before they reach it rather than painting the toggle over its face. Uses the build verdicts()
// left asking, so the words are "1 needs input".
async function toggleWords(browser) {
  for (const [width, height] of [[320, 568], [360, 740], [390, 844]]) {
    const { context, page } = await open(browser, { width, height, mobile: true });
    await page.waitForFunction(() => document.querySelector('#sidebar-toggle .sidebar-toggle-count')?.textContent === '1 needs input', null, { timeout: 10000 });
    await page.evaluate(() => window.nibbiApp.send('/help'));
    await page.waitForFunction(() => document.body.dataset.mode === 'talk' && document.querySelectorAll('#feed .turn .nib').length > 0);
    await page.waitForTimeout(1200);   // the character springs to its pose; measure and shoot the settled room
    const fit = await page.evaluate(() => {
      const toggle = document.querySelector('#sidebar-toggle').getBoundingClientRect(), count = document.querySelector('#sidebar-toggle-count'), pose = window.nibbi.state();
      return { right: toggle.right, left: pose.tx - pose.tr, clipped: count.scrollHeight > count.clientHeight + 1 || count.scrollWidth > count.clientWidth + 1, lines: Math.round(count.getBoundingClientRect().height / parseFloat(getComputedStyle(count).lineHeight)) };
    });
    assert.ok(fit.right <= fit.left, `${width}x${height}: the toggle ends at ${fit.right}px, before the character at ${fit.left}px`);
    assert.equal(fit.clipped, false, `${width}x${height}: the words fit`);
    assert.ok(fit.lines <= 2, `${width}x${height}: in at most two lines (${fit.lines})`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: out + `toggle-talk-${width}x${height}.png` });
    await context.close();
  }
}

// The Builds lobby while builds change under you. Uses fixture-7..9; verdicts() owns 3..6.
async function lobby(browser) {
  const { context, page } = await open(browser);
  const notices = () => page.getByRole('button', { name: 'Show updates', exact: true }).count();
  await page.locator('.margin-tab[data-margin-tab="builds"]').click();
  await page.locator('#project-workspace [data-build-id="fixture-0"].is-selected').waitFor();
  const staged = page.locator('[data-build-id="fixture-0"]');
  await staged.getByRole('button', { name: 'Log', exact: true }).click();
  await staged.locator('.project-evidence-panel').getByText('No log entries have been reported.').waitFor();
  await staged.getByRole('button', { name: 'Log', exact: true }).focus();

  // A tab holds nothing back: the rows update, and focus comes back to the tab.
  assert.match((await command('run.discard', { id: 'fixture-7' })).text || '', /discard/i);
  await page.waitForFunction(() => document.querySelector('[data-build-id="fixture-7"] .project-build-status')?.textContent === 'Discarded', null, { timeout: 8000 });
  assert.equal(await notices(), 0, 'no "Show updates" under a focused tab');
  assert.deepEqual(await page.evaluate(() => ({ kind: document.activeElement.dataset.kind, build: document.activeElement.closest('[data-build-id]')?.dataset.buildId })), { kind: 'log', build: 'fixture-0' }, 'focus is back on the tab it was on');

  // Typing does: with the search box focused a read waits behind a notice.
  await page.locator('.margin-tab[data-margin-tab="issues"]').click();
  await page.getByLabel('Search issues', { exact: true }).focus();
  await command('run.discard', { id: 'fixture-8' });
  await page.getByRole('button', { name: 'Show updates', exact: true }).waitFor({ timeout: 8000 });
  await page.screenshot({ path: out + 'lobby-held-1180x820.png' });

  // An open Log follows its build: the next event joins the list on screen, and the lobby's own read keeps it.
  await page.locator('.margin-tab[data-margin-tab="builds"]').click();
  await page.locator('[data-build-id="fixture-9"] > summary').click();
  await page.locator('[data-build-id="fixture-9"].is-selected').waitFor();
  settle('fixture-9', { summary: 'Fixture: an event for the log to start from.' });
  await page.waitForTimeout(700);
  const building = page.locator('[data-build-id="fixture-9"]');
  await building.getByRole('button', { name: 'Log', exact: true }).click();
  await building.locator('.project-log-entry').first().waitFor();
  const before = await page.evaluate(() => { window.heldLog = document.querySelector('[data-build-id="fixture-9"] .project-log'); return window.heldLog.children.length; });
  assert.match((await command('run.retry', { id: 'fixture-9' })).text || '', /Queued/);
  await page.waitForFunction(n => window.heldLog.isConnected && window.heldLog.children.length > n, before, { timeout: 8000 });
  assert.match(await page.evaluate(() => window.heldLog.lastElementChild.innerText), /superseded/, 'the new row is the status change');
  await page.waitForTimeout(1200);   // the lobby's own read lands 400ms after the event
  assert.equal(await page.evaluate(() => window.heldLog.isConnected), true, 'the lobby read did not rebuild the open log');
  assert.equal(await page.evaluate(() => window.heldLog.children.length), before + 1, 'and did not add the row twice');
  await page.screenshot({ path: out + 'lobby-log-tail-1180x820.png' });
  await context.close();
}

const scenarios = [['fixer verdicts, notifications and what is waiting on you', verdicts], ['the toggle\'s words stay clear of the character at 320, 360 and 390', toggleWords], ['a Builds lobby that stays live under focus and an open log', lobby]];
let browser, failed = 0;
try {
  browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' });
  for (const [name, run] of scenarios) {
    try { await run(browser); console.log('PASS', name); }
    catch (error) { failed++; console.error('FAIL', name, '\n', error.stack || error.message); }
  }
  if (errors.length) { failed++; console.error('FAIL no unexpected browser errors', errors); }
  if (!failed) console.log(`Attention checks passed: ${scenarios.length} scenarios.`);
} finally { await browser?.close(); await fixture.close(); }
process.exitCode = failed ? 1 : 0;

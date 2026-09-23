// Conversation continuity in a real browser: which conversation a reload lands in, what history
// looks like when it comes back, and a thread's name arriving while you watch. Isolated backend,
// no provider: a turn that needs one is answered by a route, and what the daemon would have logged
// is written through its own history writer so every event is the real one.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { testBackend } from './test-backend.mjs';

const fixture = await testBackend();
const out = new URL('../output/playwright/continuity/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const errors = [];
let browser;

async function open(context, path = '/?nosw=1') {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text() + ' @ ' + message.location().url); });
  await page.goto(fixture.base + path);
  await ready(page);
  return page;
}
const ready = page => page.waitForFunction(() => window.nibbiApp && document.body.dataset.link === 'live');
const placeholderFor = title => 'Message “' + title + '”…';

/* A first boot with nothing saved used to read the vault's home, find nothing, and leave the
   project's own conversation unread: a blank page with history behind it. */
async function homeHistoryOnFirstBoot() {
  fixture.seedChat([
    { role: 'user', text: 'Where did we leave the salvage dice?' },
    { role: 'oracle', text: 'Three dice per salvage, pending a playtest.' },
    { role: 'oracle', text: 'A build finished while you were away.' },
  ]);
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await open(context);
  await page.locator('[data-thread-id="home"][aria-current="true"]').waitFor({ timeout: 10_000 });
  await page.waitForFunction(() => document.querySelectorAll('#feed .turn').length >= 2, null, { timeout: 10_000 });
  const seen = await page.evaluate(() => ({
    turns: document.querySelectorAll('#feed .turn').length,
    emptyYou: document.querySelectorAll('.you:empty').length,
    events: document.querySelectorAll('#feed .turn.event').length,
    mode: document.body.dataset.mode,
    project: window.nibbiApp.state().thread.project,
  }));
  assert.ok(seen.turns >= 2, 'the project home is read from the daemon on a first boot, was ' + seen.turns);
  assert.equal(seen.emptyYou, 0, 'a reply nibbi began has no empty "you" bubble above it');
  assert.equal(seen.events, 1, 'it is an event turn instead');
  assert.equal(seen.mode, 'talk');
  assert.equal(seen.project, 'fixture', 'the conversation belongs to the active project, not the vault');
  await page.screenshot({ path: out + 'home-history-1180x820.png' });
  await context.close();
}

/* The thread you were in comes back after a reload. It was remembered per project and looked up
   under "vault", so it never did. */
async function rememberedThreadAfterReload() {
  const thread = fixture.createThread('Card balance');
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await open(context);
  await page.evaluate(id => localStorage.setItem('nibbi.thread:fixture', JSON.stringify(id)), thread.id);
  await page.reload(); await ready(page);
  await page.waitForFunction(title => document.querySelector('#ask').placeholder === title, placeholderFor('Card balance'), { timeout: 10_000 });
  await page.locator(`[data-thread-id="${thread.id}"][aria-current="true"]`).waitFor({ timeout: 10_000 });
  await context.close();
}

/* The daemon names a thread from its first message. Nothing said so, and the bar and the
   placeholder kept "New thread" until a reload. */
async function newThreadTakesItsName() {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await open(context);
  await page.route('**/api/send', async route => {
    const input = route.request().postDataJSON();
    fixture.seedChat([{ role: 'user', text: input.message, threadId: input.threadId, project: input.project }]);
    await route.fulfill({ json: { text: 'Noted — three dice it is.', costUsd: 0, isError: false } });
  });
  await page.locator('.project-thread-new').click();
  await page.waitForFunction(() => window.nibbiApp.state().thread.id !== 'home', null, { timeout: 10_000 });
  const id = await page.evaluate(() => window.nibbiApp.state().thread.id);
  assert.equal(await page.locator(`[data-thread-id="${id}"]`).getAttribute('title'), 'New thread');
  await page.evaluate(() => window.nibbiApp.send('Rebalance the salvage dice'));
  await page.waitForFunction(id => document.querySelector(`[data-thread-id="${id}"]`)?.title === 'Rebalance the salvage dice', id, { timeout: 10_000 });
  assert.equal(await page.locator('#ask').getAttribute('placeholder'), placeholderFor('Rebalance the salvage dice'), 'the composer names it too');
  assert.match(await page.locator(`[data-thread-id="${id}"]`).getAttribute('aria-label'), /^Rebalance the salvage dice thread in fixture/);
  await page.unroute('**/api/send');
  await context.close();
}

try {
  browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' });
  await homeHistoryOnFirstBoot();
  await rememberedThreadAfterReload();
  await newThreadTakesItsName();
  assert.deepEqual(errors, [], 'No unexpected browser errors');
  console.log('Continuity checks passed: a first boot reads the project home, a reload returns to its thread, and a new thread takes its name live.');
} finally { await browser?.close(); await fixture.close(); }

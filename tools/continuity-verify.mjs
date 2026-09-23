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
const ready = page => page.waitForFunction(() => window.nibbiApp && ['live', 'demo'].includes(document.body.dataset.link));
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

/* One turn runs at a time, but the Chat tab during a reply asks for the conversation that is
   answering — it used to be refused with a toast, so Builds could not be left while nibbi spoke.
   Leaving for another thread is still refused, now in the bar where the click happened. */
async function returningToTheAnsweringThread() {
  const thread = fixture.createThread('Tide tables');
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await open(context, '/?demo=1&nosw=1');
  await page.locator(`[data-thread-id="${thread.id}"]`).waitFor({ timeout: 10_000 });
  await page.evaluate(() => { void window.nibbiApp.send('fix the lock bug'); });
  await page.locator('.bubble.live').waitFor({ timeout: 10_000 });
  await page.locator('.margin-tab[data-margin-tab="builds"]').click();
  await page.locator('#project-workspace:not([hidden])').waitFor();
  await page.locator('.margin-tab[data-margin-tab="chat"]').click();
  await page.waitForFunction(() => document.querySelector('#project-workspace').hidden, null, { timeout: 5_000 });
  const during = await page.evaluate(() => ({ busy: window.nibbiApp.state().busy, live: document.querySelectorAll('.bubble.live').length }));
  assert.deepEqual(during, { busy: true, live: 1 }, 'the Chat tab leaves Builds while the reply is still arriving, and the reply is still there');
  await page.locator(`[data-thread-id="${thread.id}"]`).click();
  const refusal = page.locator('.margin-error:not([hidden])');
  await refusal.waitFor({ timeout: 5_000 });
  assert.equal(await refusal.innerText(), 'nibbi is answering in “Home” — switch when it’s done', 'another thread is refused with one sentence, in the bar');
  assert.equal(await page.evaluate(() => window.nibbiApp.state().thread.id), 'home');
  const colour = await refusal.evaluate(el => {
    const probe = token => { const s = document.createElement('span'); s.style.color = `var(${token})`; document.body.append(s); const c = getComputedStyle(s).color; s.remove(); return c; };
    return { shown: getComputedStyle(el).color, ink: probe('--ink-2'), fail: probe('--fail-text'), kind: el.dataset.kind };
  });
  assert.equal(colour.kind, 'notice');
  assert.equal(colour.shown, colour.ink, 'waiting is not a failure: the refusal reads in ink, not ' + colour.fail);
  await page.screenshot({ path: out + 'busy-refusal-1180x820.png' });
  await page.waitForFunction(() => !window.nibbiApp.state().busy, null, { timeout: 30_000 });
  await page.waitForFunction(() => !document.querySelector('.margin-error:not([hidden])'), null, { timeout: 5_000 });   // and it goes when the reply is done
  await context.close();
}

/* A draft belongs to its conversation: one field for every thread let half a message follow you
   into another. Quoting adds to what is there instead of replacing it. */
async function draftsBelongToTheirThread() {
  const thread = fixture.createThread('Art pipeline');
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await open(context);
  const row = page.locator(`[data-thread-id="${thread.id}"]`);
  await row.waitFor({ timeout: 10_000 });
  await page.locator('#ask').fill('half a thought about the dice');
  await row.click();
  await page.waitForFunction(id => window.nibbiApp.state().thread.id === id, thread.id);
  assert.equal(await page.locator('#ask').inputValue(), '', 'another conversation has its own field');
  await page.locator('#ask').fill('the pipeline note');
  await page.locator('[data-thread-id="home"]').click();
  await page.waitForFunction(() => window.nibbiApp.state().thread.id === 'home');
  assert.equal(await page.locator('#ask').inputValue(), 'half a thought about the dice', 'coming back brings the draft back');
  await page.reload(); await ready(page);
  await page.waitForFunction(() => document.querySelector('#ask').value === 'half a thought about the dice', null, { timeout: 10_000 });
  await row.click();
  await page.waitForFunction(() => document.querySelector('#ask').value === 'the pipeline note', null, { timeout: 10_000 });
  await page.locator('[data-thread-id="home"]').click();
  await page.waitForFunction(() => window.nibbiApp.state().thread.id === 'home' && document.querySelectorAll('#feed .turn').length > 0);
  await page.locator('#feed .turn .metaacts button', { hasText: 'quote' }).last().click();
  const quoted = await page.locator('#ask').inputValue();
  assert.ok(quoted.startsWith('half a thought about the dice\n\n> '), 'a quote is added under the draft, was ' + JSON.stringify(quoted));
  await page.locator('#ask').focus(); await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => localStorage.getItem('nibbi.draft:fixture:home')), null, 'clearing the field clears the saved draft');
  await context.close();
}

/* A file pasted into a workspace field is that field's, not an attachment. And a file that cannot
   be attached says why, with the number, instead of vanishing. */
async function attachmentsSayWhy() {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await open(context);
  const paste = files => page.evaluate(files => {
    const data = new DataTransfer();
    for (const f of files) data.items.add(new File([new Uint8Array(f.size)], f.name, { type: f.type }));
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, files);
  const png = n => Array.from({ length: n }, (_, i) => ({ name: 'shot-' + i + '.png', type: 'image/png', size: 64 }));
  const toast = () => page.locator('#toast').innerText();
  await page.locator('.margin-tab[data-margin-tab="issues"]').click();
  await page.locator('#project-workspace input[type="search"]').focus();
  await paste(png(1));
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#attach').isHidden(), true, 'a paste into a workspace field is not attached to the message');
  await page.locator('.project-close').click();
  await page.waitForFunction(() => document.querySelector('#project-workspace').hidden);
  await page.locator('#ask').focus();
  await paste([{ name: 'notes.txt', type: 'text/plain', size: 12 }]);
  assert.equal(await toast(), 'images only — png, jpeg, webp or gif');
  await paste([{ name: 'huge.png', type: 'image/png', size: 7_000_000 }]);
  assert.equal(await toast(), '7.0 MB — 6 MB is the most one image can be');
  await paste(png(5));
  assert.equal(await toast(), '4 images is the most per message', 'five at once: the fifth is refused before the first four have loaded');
  await page.waitForFunction(() => document.querySelectorAll('#attach img').length === 4);
  await context.close();
}

try {
  browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' });
  await homeHistoryOnFirstBoot();
  await rememberedThreadAfterReload();
  await newThreadTakesItsName();
  await returningToTheAnsweringThread();
  await draftsBelongToTheirThread();
  await attachmentsSayWhy();
  assert.deepEqual(errors, [], 'No unexpected browser errors');
  console.log('Continuity checks passed: a first boot reads the project home, a reload returns to its thread, a new thread takes its name live, the Chat tab returns to a reply in progress, drafts belong to their thread, and attachments say why they were refused.');
} finally { await browser?.close(); await fixture.close(); }

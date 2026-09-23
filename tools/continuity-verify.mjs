// Conversation continuity in a real browser: which conversation a reload lands in, what history
// looks like when it comes back, and a thread's name arriving while you watch. Isolated backend,
// no provider: a turn that needs one is answered by a route, and what the daemon would have logged
// is written through its own history writer so every event is the real one.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { testBackend } from './test-backend.mjs';

const fixture = await testBackend();
const out = new URL('../output/playwright/continuity/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const errors = [];
let browser;

async function open(context, path = '/?nosw=1', { before, expectFailed } = {}) {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !(expectFailed && expectFailed.test(message.location().url))) errors.push(message.text() + ' @ ' + message.location().url); });
  await before?.(page);
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
  // A thread with nothing in it says so; an empty home is the character instead.
  const empty = page.locator('#feed .feed-empty');
  await empty.waitFor({ timeout: 10_000 });
  assert.equal(await empty.innerText(), 'nothing here yet — say what you want built');
  await page.screenshot({ path: out + 'empty-thread-1180x820.png' });
  await page.evaluate(() => window.nibbiApp.send('Rebalance the salvage dice'));
  await page.waitForFunction(id => document.querySelector(`[data-thread-id="${id}"]`)?.title === 'Rebalance the salvage dice', id, { timeout: 10_000 });
  assert.equal(await page.locator('#ask').getAttribute('placeholder'), placeholderFor('Rebalance the salvage dice'), 'the composer names it too');
  assert.match(await page.locator(`[data-thread-id="${id}"]`).getAttribute('aria-label'), /^Rebalance the salvage dice thread in fixture/);
  assert.equal(await empty.isVisible(), false, 'and stops saying so once it has something in it');
  await page.unroute('**/api/send');
  await context.close();
}

/* A reply routed past the provider, logged the way the daemon logs a real one: stamped as it arrives.
   `stamped: false` leaves the backend's seed clock, which runs an hour behind. */
const answered = (page, { stamped = true } = {}) => page.route('**/api/send', async route => {
  const input = route.request().postDataJSON(), reply = 'Noted: ' + input.message, at = Date.now();
  const ts = n => stamped ? { ts: new Date(at + n).toISOString() } : {};
  fixture.seedChat([{ role: 'user', text: input.message, threadId: input.threadId, project: input.project, ...ts(0) }, { role: 'oracle', text: reply, threadId: input.threadId, project: input.project, ...ts(1) }]);
  await route.fulfill({ json: { text: reply, costUsd: 0, isError: false } });
});
const yous = page => page.evaluate(() => [...document.querySelectorAll('#feed .you')].map(el => el.textContent));
const homeRead = page => page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === '/api/history' && url.searchParams.get('threadId') === 'home'; }, { timeout: 10_000 });

/* Tidy clears the table, not the log. Once a home with no saved copy was read back from the daemon,
   a reload laid the tidied conversation straight back. What is said after a tidy still comes back. */
async function tidyStaysTidied() {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await open(context);
  await page.waitForFunction(() => window.nibbiApp.state().thread.project === 'fixture' && !window.nibbiApp.state().busy);
  await answered(page);
  await page.evaluate(() => window.nibbiApp.send('Which deck did we cut?'));
  await page.waitForFunction(() => !window.nibbiApp.state().busy);
  await page.evaluate(() => window.nibbiApp.tidy());
  await page.waitForFunction(() => !document.querySelector('#feed .turn'));
  let read = homeRead(page);
  await page.reload(); await ready(page); await read; await page.waitForTimeout(400);
  assert.deepEqual(await yous(page), [], 'a reload does not lay the tidied conversation back');
  assert.equal(await page.evaluate(() => document.body.dataset.mode), 'idle');
  await page.evaluate(() => window.nibbiApp.send('After the tidy'));
  await page.waitForFunction(() => !window.nibbiApp.state().busy);
  // No saved copy on the next load (the page writes one as it goes, so it is removed as the next one starts).
  await page.addInitScript(() => { for (const key of Object.keys(localStorage)) if (key.startsWith('nibbi.transcript')) localStorage.removeItem(key); });
  read = homeRead(page);
  await page.reload(); await ready(page); await read;
  await page.waitForFunction(() => document.querySelectorAll('#feed .you').length > 0, null, { timeout: 10_000 });
  assert.deepEqual(await yous(page), ['After the tidy'], 'read back from the daemon, only what came after it');
  await page.unroute('**/api/send');
  await context.close();
}

/* Nibbi's own news is not something the owner said. A reload with a brief waiting used to count it as
   typed, stay in Home instead of the thread you were in, and leave Home's history unread. */
async function newsDoesNotHoldYouAtHome() {
  const thread = fixture.createThread('Tide charts');
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  let page = await open(context);
  await page.locator(`[data-thread-id="${thread.id}"]`).click();
  await page.waitForFunction(id => window.nibbiApp.state().thread.id === id, thread.id);
  await page.evaluate(() => { for (const key of Object.keys(localStorage)) if (key.startsWith('nibbi.transcript')) localStorage.removeItem(key); });
  await page.waitForTimeout(800);   // the event cursor is saved, so the next visit replays only what it missed
  await page.close();
  fixture.emit({ type: 'brief', payload: { text: 'While you were away: the tide build finished.' } });
  // The list of projects runs three git commands a project, so it is often the last thing boot hears.
  page = await open(context, '/?nosw=1', { before: page => page.route('**/api/projects', async route => { await new Promise(resolve => setTimeout(resolve, 1500)); await route.continue(); }) });
  await page.waitForFunction(id => window.nibbiApp.state().thread.id === id, thread.id, { timeout: 10_000 });
  assert.equal(await page.locator('#ask').getAttribute('placeholder'), placeholderFor('Tide charts'), 'back in the thread you were in');
  await page.locator('[data-thread-id="home"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('#feed .you')].some(el => el.textContent === 'Where did we leave the salvage dice?'), null, { timeout: 10_000 });
  const saids = await page.evaluate(() => [...document.querySelectorAll('#feed .turn .said')].map(el => el.textContent.trim()));
  assert.equal(saids.at(-1), 'While you were away: the tide build finished.', 'the news waits in Home, under the history that was read above it');
  await context.close();
}

/* A read that failed, then a message, then Home again: the daemon's copy of the message came back
   with the history and was drawn a second time. */
async function aMessageIsDrawnOnce() {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  let failed = 0;
  const page = await open(context, '/?nosw=1', { expectFailed: /\/api\/history/, before: page => page.route(url => url.pathname === '/api/history' && url.searchParams.get('threadId') === 'home', route => failed++ === 0 ? route.abort() : route.continue()) });
  await page.waitForFunction(() => window.nibbiApp.state().thread.project === 'fixture');
  await page.waitForFunction(() => document.body.dataset.link === 'live');
  await page.waitForTimeout(300);
  assert.equal(failed, 1, 'the first read of Home failed');
  await answered(page, { stamped: false });   // an hour behind, so the clock cannot find it on screen: its words have to
  await page.evaluate(() => window.nibbiApp.send('Only said once'));
  await page.waitForFunction(() => !window.nibbiApp.state().busy);
  const read = homeRead(page);
  await page.locator('[data-thread-id="home"]').click();
  await read;
  await page.waitForFunction(() => [...document.querySelectorAll('#feed .you')].some(el => el.textContent === 'Where did we leave the salvage dice?'), null, { timeout: 10_000 });
  const mine = (await yous(page)).filter(text => text === 'Only said once');
  assert.equal(mine.length, 1, 'the history came back above it, without it');
  assert.equal((await yous(page)).at(-1), 'Only said once');
  await page.unroute('**/api/send');
  await context.close();
}

/* A message sent while the project list is on its way goes where the window files it. activeProject()
   read "vault" then, while the window showed the saved project's home. With nothing saved it does go
   to the vault; it stays on screen but is not saved as the project's. */
async function sentBeforeTheListIsFiledWhereItWent() {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const sent = [];
  const held = page => {
    let release; const gate = new Promise(resolve => { release = resolve; });
    return { release: () => release(), route: page.route('**/api/projects', async route => { await gate; await route.continue(); }) };
  };
  let page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  let hold = held(page); await hold.route;
  await page.route('**/api/send', async route => { const input = route.request().postDataJSON(); sent.push(input.project); await route.fulfill({ json: { text: 'Filed.', costUsd: 0, isError: false } }); });
  await page.goto(fixture.base + '/?nosw=1'); await ready(page);
  await page.evaluate(() => window.nibbiApp.send('Nothing saved yet'));
  await page.waitForFunction(() => !window.nibbiApp.state().busy);
  hold.release();
  await page.waitForFunction(() => window.nibbiApp.state().thread.project === 'fixture', null, { timeout: 10_000 });
  await page.waitForTimeout(1400);   // past the transcript's write-behind
  assert.equal((await yous(page)).at(-1), 'Nothing saved yet', 'still on screen after the list arrives, under the project home read above it');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('nibbi.transcript:fixture:home') || 'null')?.rows?.map(row => row.you) ?? []);
  assert.ok(!stored.includes('Nothing saved yet'), 'but not saved as the project’s: the daemon has it in the vault');
  await page.close();
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('nibbi.project', JSON.stringify('fixture')));
  hold = held(page); await hold.route;
  await page.route('**/api/send', async route => { const input = route.request().postDataJSON(); sent.push(input.project); await route.fulfill({ json: { text: 'Filed.', costUsd: 0, isError: false } }); });
  await page.goto(fixture.base + '/?nosw=1'); await ready(page);
  await page.evaluate(() => window.nibbiApp.send('The saved project’s'));
  await page.waitForFunction(() => !window.nibbiApp.state().busy);
  hold.release();
  assert.deepEqual(sent, ['vault', 'fixture'], 'with a project saved, a message before the list goes to it');
  await context.close();
}

/* The bar's list is rebuilt whenever a thread in the project is written to, now that the daemon says
   so. A keyboard on a row's gear dropped to the page each time. */
async function aRebuiltListKeepsYourPlace() {
  const [alpha, beta] = ['Keyboard alpha', 'Keyboard beta'].map(title => fixture.createThread(title));
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await open(context);
  const gear = page.locator(`.project-thread-row:has([data-thread-id="${alpha.id}"]) .project-options`);
  await gear.waitFor({ state: 'attached', timeout: 10_000 });
  await page.locator(`[data-thread-id="${alpha.id}"]`).focus();
  await page.keyboard.press('Tab');
  assert.equal(await gear.evaluate(el => el === document.activeElement), true);
  const before = await page.locator(`[data-thread-id="${beta.id}"]`).getAttribute('data-last-at');
  fixture.seedChat([{ role: 'user', text: 'from the phone', threadId: beta.id }]);
  await page.waitForFunction(([id, was]) => document.querySelector(`[data-thread-id="${id}"]`)?.dataset.lastAt !== was, [beta.id, before], { timeout: 10_000 });
  assert.equal(await gear.evaluate(el => el === document.activeElement), true, 'focus is still on the gear after the list was rebuilt');
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

/* Rename and archive live on the row, through the real daemon commands. No delete. */
async function renameAndArchiveFromTheRow() {
  const thread = fixture.createThread('Old ideas');
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await open(context);
  const row = page.locator(`[data-thread-id="${thread.id}"]`);
  await row.waitFor({ timeout: 10_000 });
  await row.click();
  await page.waitForFunction(title => document.querySelector('#ask').placeholder === title, placeholderFor('Old ideas'));
  await page.locator(`.project-thread-row:has([data-thread-id="${thread.id}"]) .project-options`).click();
  const card = page.locator('.margin-card:not([hidden])');
  assert.equal(await card.locator('h2').innerText(), 'Old ideas');
  await card.locator('input[type="text"]').fill('Salvage odds');
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(id => document.querySelector(`[data-thread-id="${id}"]`)?.title === 'Salvage odds', thread.id);
  assert.equal(await card.locator('h2').innerText(), 'Salvage odds', 'the card follows the new name');
  assert.equal(await page.locator('#ask').getAttribute('placeholder'), placeholderFor('Salvage odds'), 'and so does the composer');
  await page.screenshot({ path: out + 'thread-card-1180x820.png' });
  await card.getByRole('button', { name: 'Archive', exact: true }).click();
  await card.locator('.margin-confirm').getByRole('button', { name: 'Archive', exact: true }).click();
  await row.waitFor({ state: 'detached', timeout: 10_000 });
  await page.waitForFunction(() => window.nibbiApp.state().thread.id === 'home', null, { timeout: 5_000 });
  assert.equal(await page.locator('#toast').innerText(), 'archived — it stays in the log');
  const { threads } = await (await fetch(fixture.base + '/api/threads?project=fixture')).json();
  assert.deepEqual(threads.filter(t => t.id === thread.id).map(t => [t.title, t.archived]), [['Salvage odds', true]], 'archived, not deleted');
  await context.close();
}

/* The first read brings the last sixty messages. There was no way to reach the rest. Loading them
   must not move what you were reading. */
async function loadEarlierKeepsYourPlace() {
  const thread = fixture.createThread('Long history');
  fixture.seedChat(Array.from({ length: 70 }, (_, i) => ({ role: i % 2 ? 'oracle' : 'user', text: (i % 2 ? 'Reply ' : 'Message ') + i, threadId: thread.id })));
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await open(context);
  await page.locator(`[data-thread-id="${thread.id}"]`).click();
  const earlier = page.locator('#feed .earlier');
  await earlier.waitFor({ timeout: 10_000 });
  const first = await page.evaluate(() => ({ turns: document.querySelectorAll('#feed .turn').length, top: document.querySelector('#feed .turn .you')?.textContent }));
  assert.deepEqual(first, { turns: 30, top: 'Message 10' }, 'sixty rows are thirty turns');
  // Scroll to the top the way a reader would, until it holds: while the feed is still settling into
  // talk mode it re-pins the latest on every resize.
  await page.waitForFunction(() => { const f = document.querySelector('#feed'); if (f.scrollTop) f.scrollTop = 0; return f.scrollTop === 0 && !window.nibbiApp.state().stick; }, null, { polling: 100, timeout: 5_000 });
  await page.waitForTimeout(300);
  const anchor = await page.evaluate(() => { window.__anchor = document.querySelector('#feed .turn'); return window.__anchor.getBoundingClientRect().top; });
  await page.screenshot({ path: out + 'load-earlier-1180x820.png' });
  await earlier.click();
  await page.waitForFunction(n => document.querySelectorAll('#feed .turn').length > n, first.turns, { timeout: 10_000 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const after = await page.evaluate(() => ({ turns: document.querySelectorAll('#feed .turn').length, scrollTop: document.querySelector('#feed').scrollTop, anchor: window.__anchor.getBoundingClientRect().top, earlier: document.querySelectorAll('#feed .earlier').length, top: document.querySelector('#feed .turn .you')?.textContent }));
  assert.equal(after.turns, 35, 'the ten rows before them came back');
  assert.equal(after.top, 'Message 0');
  assert.ok(after.scrollTop > 0, 'the view moved down by what was added above it');
  assert.ok(Math.abs(after.anchor - anchor) <= 2, 'so the turn you were reading stayed put: ' + anchor + ' → ' + after.anchor);
  assert.equal(after.earlier, 0, 'and with nothing older there is nothing to press');
  await context.close();
}

/* Three quick clicks used to land the second thread's history in the third. A read that arrives
   after its thread was left is dropped, and read again when you return. */
async function aReadThatLandsLateIsDropped() {
  const [a, b, c] = ['Alpha notes', 'Beta notes', 'Gamma notes'].map(title => fixture.createThread(title));
  for (const [thread, tag] of [[a, 'A'], [b, 'B'], [c, 'C']]) fixture.seedChat([{ role: 'user', text: tag + ': first', threadId: thread.id }, { role: 'oracle', text: tag + ' reply', threadId: thread.id }]);
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await open(context);
  let release; const held = new Promise(resolve => { release = resolve; });
  await page.route(url => url.pathname === '/api/history', async route => {
    const id = new URL(route.request().url()).searchParams.get('threadId');
    if (id === a.id || id === b.id) await held;
    await route.continue();
  });
  for (const thread of [a, b, c]) await page.locator(`[data-thread-id="${thread.id}"]`).waitFor({ timeout: 10_000 });
  for (const thread of [a, b, c]) await page.locator(`[data-thread-id="${thread.id}"]`).click();
  await page.waitForFunction(id => window.nibbiApp.state().thread.id === id && [...document.querySelectorAll('#feed .you')].some(el => el.textContent === 'C: first'), c.id, { timeout: 10_000 });
  release();
  await page.waitForTimeout(600);
  const yours = await page.evaluate(() => [...document.querySelectorAll('#feed .you')].map(el => el.textContent));
  assert.deepEqual(yours, ['C: first'], 'every message on screen belongs to the thread that is open');
  await page.unroute(url => url.pathname === '/api/history');
  await page.locator(`[data-thread-id="${a.id}"]`).click();
  await page.waitForFunction(() => [...document.querySelectorAll('#feed .you')].map(el => el.textContent).join() === 'A: first', null, { timeout: 10_000 });
  await context.close();
}

/* The bar said "Loading projects…" for as long as the daemon was away. It says what happened, retries,
   and has a Retry that asks at once. */
async function projectsThatNeverArriveSaySo() {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await open(context, '/?nosw=1', { before: page => page.route('**/api/projects', route => route.abort()), expectFailed: /\/api\/projects$/ });
  const body = page.locator('.margin-body');
  await body.getByText('couldn’t reach the projects list', { exact: true }).waitFor({ timeout: 10_000 });
  assert.doesNotMatch(await page.locator('#project-rail').innerText(), /Loading projects/);
  await page.screenshot({ path: out + 'projects-unreachable-1180x820.png' });
  await page.unroute('**/api/projects');
  await body.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.locator('.margin-switch-trigger[data-current-project="fixture"]').waitFor({ timeout: 10_000 });
  await page.locator('[data-thread-id="home"][aria-current="true"]').waitFor({ timeout: 10_000 });   // and the conversation it was waiting for follows
  await context.close();
}

/* A first run offered a playtest of "shipless", a project nobody had. With no projects, the chips are
   the two things that make sense, and New project offers both ways in. */
async function firstRunOffersAWayIn() {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const vaultOnly = page => page.route('**/api/projects', async route => { const list = await (await route.fetch()).json(); await route.fulfill({ json: list.filter(p => p.kind === 'brain') }); });
  const page = await open(context, '/?nosw=1', { before: vaultOnly });
  await page.locator('.margin-switch-trigger').getByText('No projects yet').waitFor({ timeout: 10_000 });
  await page.locator('#ask').focus();
  await page.waitForFunction(() => document.querySelectorAll('#chips .chip.in').length > 0);
  assert.deepEqual(await page.locator('#chips .chip').allInnerTexts(), ['new project', 'what can you do?'], 'no playtest of a project that is not there');
  await page.screenshot({ path: out + 'first-run-1180x820.png' });
  await page.locator('#chips .chip', { hasText: 'new project' }).click();
  const offer = page.locator('.turn.event').last();
  await offer.locator('.acts .chip', { hasText: 'register a folder I have' }).waitFor({ timeout: 10_000 });
  assert.deepEqual(await offer.locator('.acts .chip').allInnerTexts(), ['create a new repo', 'register a folder I have']);
  await offer.locator('.acts .chip', { hasText: 'register a folder I have' }).click();
  assert.equal(await page.locator('#ask').inputValue(), '/register ');
  await context.close();
}

/* The daemon could always register an existing repository (mode: 'existing'); nothing in the app
   could ask it to. */
async function registerAFolderYouHave() {
  const repo = join(fixture.directory, 'lantern-repo');
  mkdirSync(repo); execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await open(context);
  await page.locator('.margin-switch-trigger[data-current-project="fixture"]').waitFor({ timeout: 10_000 });
  assert.equal(await page.locator('#project-rail [data-project-id]').count(), 1);
  await page.evaluate(repo => window.nibbiApp.send('/register ' + repo + ' Lantern'), repo);
  await page.waitForFunction(() => !window.nibbiApp.state().busy, null, { timeout: 15_000 });
  const said = await page.locator('.turn').last().locator('.said').innerText();
  assert.match(said, /^lantern is a project now/, 'was ' + JSON.stringify(said));
  await page.waitForFunction(() => document.querySelectorAll('#project-rail [data-project-id]').length === 2, null, { timeout: 10_000 });
  assert.deepEqual((await (await fetch(fixture.base + '/api/projects')).json()).filter(p => p.kind !== 'brain').map(p => p.name).sort(), ['fixture', 'lantern']);
  await page.evaluate(() => window.nibbiApp.send('/register ~/games/lantern'));
  await page.waitForFunction(() => !window.nibbiApp.state().busy);
  assert.match(await page.locator('.turn').last().locator('.said').innerText(), /whole path/, 'a ~ path is refused with the reason, before the daemon sees it');
  await context.close();
}

try {
  browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' });
  await homeHistoryOnFirstBoot();
  await rememberedThreadAfterReload();
  await newThreadTakesItsName();
  await tidyStaysTidied();
  await newsDoesNotHoldYouAtHome();
  await aMessageIsDrawnOnce();
  await sentBeforeTheListIsFiledWhereItWent();
  await aRebuiltListKeepsYourPlace();
  await returningToTheAnsweringThread();
  await draftsBelongToTheirThread();
  await attachmentsSayWhy();
  await renameAndArchiveFromTheRow();
  await loadEarlierKeepsYourPlace();
  await aReadThatLandsLateIsDropped();
  await projectsThatNeverArriveSaySo();
  await firstRunOffersAWayIn();
  await registerAFolderYouHave();
  assert.deepEqual(errors, [], 'No unexpected browser errors');
  console.log('Continuity checks passed: a first boot reads the project home, a reload returns to its thread, a new thread takes its name live, the Chat tab returns to a reply in progress, drafts belong to their thread, attachments say why they were refused, a thread is renamed and archived from its row, earlier history loads without moving the reader, a late read is dropped, an unreachable project list says so and retries, a first run offers a way in, and an existing folder can be registered.');
} finally { await browser?.close(); await fixture.close(); }

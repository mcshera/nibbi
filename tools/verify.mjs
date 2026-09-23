// Browser regression checks use an isolated backend, vault and repositories. Never the live app.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { testBackend } from './test-backend.mjs';
const fixture = await testBackend(); const errors = []; const out = new URL('../output/playwright/', import.meta.url).pathname; mkdirSync(out, { recursive: true });
let browser;
const pendingReleases = [];
const hold = () => { let release; const promise = new Promise(resolve => { release = resolve; }); pendingReleases.push(release); return { promise, release }; };
try {
  browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !(message.location().url.endsWith('/api/commands') && message.text().includes('400'))) errors.push(message.text() + ' @ ' + message.location().url); });
  await page.goto(fixture.base + '/?nosw=1');
  await page.waitForFunction(() => window.nibbiApp && document.body.dataset.link === 'live');
  assert.ok(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--t2').trim()), 'tokens.css is linked: --t2 resolves');
  assert.equal((await (await fetch(fixture.base + '/api/fixers')).json()).length, 15, 'No twelve-run truncation');
  await page.screenshot({ path: out + 'desktop.png' });
  await page.evaluate(() => { document.querySelector('#st-platform').click(); });
  await page.getByRole('dialog').waitFor();
  await page.getByText('No API key is required.', { exact: false }).waitFor();
  // Exercise the controls without invoking a real login or querying user accounts.
  await page.route('**/api/providers', route => route.fulfill({ json: { claude: { connected: true, mode: 'signin', subscription: 'max' }, codex: { connected: false } } }));
  await page.route('**/api/providers/claude/login', route => { assert.equal(route.request().method(), 'POST'); return route.fulfill({ json: { message: 'Fixture sign-in handoff. Complete it, then Check connections.' } }); });
  await page.getByRole('button', { name: 'Check connections', exact: true }).click();
  await page.getByText('Claude: signed in · max', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Sign in with Claude', exact: true }).click();
  await page.getByText('Fixture sign-in handoff.', { exact: false }).waitFor();
  await page.screenshot({ path: out + 'providers.png' });
  await page.getByRole('button', { name: 'Skills', exact: true }).click();
  await page.getByText('nibbi-fixer-brief', { exact: false }).first().waitFor();
  const lead = page.locator('fieldset').filter({ has: page.locator('legend', { hasText: /^lead$/ }) });
  await lead.getByRole('checkbox').first().check();
  await lead.getByRole('button', { name: 'Save lead skills', exact: true }).click();
  await page.getByText('Saved pinned revisions for the next run.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Inspect nibbi-fixer-brief', exact: true }).click();
  await page.getByRole('combobox', { name: 'Skill package file' }).waitFor();
  await page.screenshot({ path: out + 'skills.png' });
  await page.getByRole('button', { name: 'Vault', exact: true }).click();
  await page.getByRole('button', { name: 'MEMORY.md', exact: true }).click();
  await page.getByText('A private, temporary test vault.', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Schedules', exact: true }).click();
  await page.getByRole('button', { name: 'Enable', exact: true }).first().waitFor();
  // A delayed response from a previous tab must never replace the selected view.
  const heldProposals = hold();
  await page.route('**/api/proposals', async route => { await heldProposals.promise; await route.fulfill({ json: [] }); });
  const sawProposals = page.waitForRequest(request => request.url().endsWith('/api/proposals'));
  await page.getByRole('button', { name: 'Proposals', exact: true }).click();
  await sawProposals;
  await page.getByRole('button', { name: 'Schedules', exact: true }).click();
  await page.getByRole('button', { name: 'Enable', exact: true }).first().waitFor();
  const oldTabResponse = page.waitForResponse(response => response.url().endsWith('/api/proposals'));
  heldProposals.release(); await oldTabResponse;
  // Wait for the browser to consume the response and finish its render microtasks.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.ok(await page.getByRole('button', { name: 'Enable', exact: true }).count(), 'A stale tab response must not overwrite Schedules');
  assert.equal(await page.getByText('No proposals to review.', { exact: true }).count(), 0);
  await page.unroute('**/api/proposals');
  // Completing a save after navigating away must not reopen its old tab.
  const heldSchedule = hold();
  await page.route('**/api/commands', async route => {
    if (route.request().postDataJSON().name !== 'schedule.set') return route.fallback();
    await heldSchedule.promise; await route.fulfill({ json: { ok: true, data: {} } });
  });
  const sawSchedule = page.waitForRequest(request => request.url().endsWith('/api/commands') && request.postDataJSON().name === 'schedule.set');
  await page.getByRole('button', { name: 'Enable', exact: true }).first().click();
  await sawSchedule;
  await page.getByRole('button', { name: 'Phone', exact: true }).click();
  await page.getByRole('button', { name: 'Generate one-use pairing code', exact: true }).waitFor();
  const oldSaveResponse = page.waitForResponse(response => response.url().endsWith('/api/commands'));
  heldSchedule.release(); await oldSaveResponse;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.ok(await page.getByRole('button', { name: 'Generate one-use pairing code', exact: true }).count(), 'Finishing a previous tab save must not navigate away from Phone');
  await page.unroute('**/api/commands');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => window.nibbiApp.send('/project fixture'));
  await page.waitForFunction(() => !window.nibbiApp.state().busy);
  // Escape dismisses. It used to clear the conversation from the composer, and before that it was
  // swallowed by the docked bar, so it never reached the composer at all.
  const turnsBeforeEscape = await page.evaluate(() => window.nibbiApp.state().turns.length);
  assert.ok(turnsBeforeEscape > 0, 'there is a conversation to lose');
  await page.locator('#ask').focus();
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.nibbiApp.state().turns.length), turnsBeforeEscape, 'Escape in the composer keeps the conversation');
  assert.equal(await page.locator('#workspace-sidebar').getAttribute('aria-hidden'), 'false', 'and leaves the docked bar open');
  await page.locator('#status').click();
  await page.locator('.margin-card:not([hidden])').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.margin-card:not([hidden])').count(), 0, 'Escape still closes an open card first');
  assert.equal(await page.evaluate(() => window.nibbiApp.state().turns.length), turnsBeforeEscape);
  // A section had no way out of itself: the only exits were a floating button in the far corner and
  // a tab in a bar that is closed by default on a phone.
  await page.locator('.margin-tab[data-margin-tab="builds"], [data-project-section="builds"]').first().click();
  await page.locator('#project-workspace:not([hidden])').waitFor();
  await page.locator('.project-close').click();
  await page.waitForFunction(() => document.querySelector('#project-workspace').hidden, null, { timeout: 5000 });
  assert.equal(await page.evaluate(() => document.body.classList.contains('project-view')), false, 'the close control returns to the conversation');
  await page.locator('.margin-tab[data-margin-tab="builds"], [data-project-section="builds"]').first().click();
  await page.locator('#project-workspace:not([hidden])').waitFor();
  await page.locator('.project-workspace-body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#project-workspace').hidden, null, { timeout: 5000 });
  assert.equal(await page.evaluate(() => document.body.classList.contains('project-view')), false, 'and Escape leaves a section from inside it');
  await page.evaluate(() => window.nibbiApp.send('/goal finish M1'));
  const goal = await (await fetch(fixture.base + '/nibbi/goal')).json(); assert.equal(goal.fixture.focus, 'M1: Fixture'); assert.equal(goal.fixture.mode, 'stage');
  await page.evaluate(() => window.nibbiApp.send('/goal stop'));
  assert.equal((await (await fetch(fixture.base + '/api/auto')).json()).fixture.on, false, 'Stopping a goal disables auto');
  await page.evaluate(() => window.nibbiApp.send('/review'));
  await page.locator('.rhead').waitFor();
  // Make the diff available in the UI without changing the unverified merge gate.
  const before = await page.locator('.rhead').textContent();
  await page.getByRole('button', { name: 'approve & merge (a)', exact: true }).click();
  await page.getByRole('button', { name: 'merge — sure?', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('verified'));
  assert.equal(await page.locator('.rhead').textContent(), before, 'Failed merge keeps the item in review');
  const forbidden = await fetch(fixture.base + '/api/commands', { method: 'POST', headers: { 'content-type': 'application/json', Origin: 'https://untrusted.example' }, body: '{}' });
  assert.equal(forbidden.status, 403, 'Cross-origin mutations are rejected');
  const key = crypto.randomUUID(); const command = { name: 'run.discard', idempotencyKey: key, args: { id: 'fixture-0' } };
  const once = await (await fetch(fixture.base + '/api/commands', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(command) })).json();
  const twice = await (await fetch(fixture.base + '/api/commands', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(command) })).json();
  assert.deepEqual(once, twice, 'Repeated commands have one result');
  const cursor = (await (await fetch(fixture.base + '/api/snapshot')).json()).cursor;
  const replay = await fetch(fixture.base + '/api/events?after=' + (cursor - 1)); const reader = replay.body.getReader(); const chunk = new TextDecoder().decode((await reader.read()).value); await reader.cancel();
  assert.match(chunk, new RegExp('id: ' + cursor + '\\n'), 'Events replay after the saved cursor');
  await context.close();
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phone = await mobile.newPage(); phone.on('pageerror', error => errors.push(error.message)); await phone.goto(fixture.base + '/?nosw=1');
  await phone.waitForFunction(() => !!window.nibbiApp); await phone.evaluate(() => document.querySelector('#st-platform').click());
  await phone.getByRole('button', { name: 'Phone', exact: true }).click();
  await phone.getByRole('button', { name: 'Generate one-use pairing code', exact: true }).waitFor();
  await phone.screenshot({ path: out + 'phone.png' });
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No horizontal overflow on phone');
  await mobile.close();
  assert.deepEqual(errors, [], 'No unexpected browser errors');
  console.log('Browser checks passed: desktop, phone, Claude sign-in controls, skill activation/inspection, vault, schedules, stale settings responses/saves, stage-only goals, failed-review retention, event replay, idempotency and origin protection.');
} finally { for (const release of pendingReleases) release(); await browser?.close(); await fixture.close(); }

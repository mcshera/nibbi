// Review regressions run against temporary state; delayed routes never merge real work.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { testBackend } from './test-backend.mjs';

const fixture = await testBackend();
const snapshot = await (await fetch(fixture.base + '/api/snapshot')).json();
const fixers = snapshot.fixers.slice(0, 3).map((run, index) => ({ ...run, id: 'review-' + index, title: 'Review item ' + index, status: 'staged', endedAt: new Date(index * 1000).toISOString() }));
const gates = new Set(), errors = [];
let browser;
function gate() {
  let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  const timer = setTimeout(release, 8000);
  const result = { ready, wait, started, release: () => { clearTimeout(timer); release(); gates.delete(result); } };
  gates.add(result);
  return result;
}
async function ready(promise) {
  let timer;
  try { await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Expected browser request did not arrive')), 8000); })]); }
  finally { clearTimeout(timer); }
}
const diff = id => ({ game: 'fixture', branch: id, target: 'main', diffstat: id + '.txt | 1 +', diff: 'diff --git a/' + id + '.txt b/' + id + '.txt\n--- a/' + id + '.txt\n+++ b/' + id + '.txt\n@@ -0,0 +1 @@\n+Content for ' + id });
async function withPage(run) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  context.setDefaultTimeout(8000);
  const page = await context.newPage(), calls = [];
  const control = { delayedDiff: null, delayedCommand: null };
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/snapshot', route => route.fulfill({ json: { ...snapshot, fixers } }));
  await page.route('**/api/fixers', route => route.fulfill({ json: fixers }));
  await page.route('**/api/fixer-diff?*', async route => {
    const id = new URL(route.request().url()).searchParams.get('id'), delay = control.delayedDiff;
    if (delay?.id === id) {
      control.delayedDiff = null; delay.gate.started(); await delay.gate.wait;
      if (delay.error) { await route.fulfill({ status: 400, json: { error: 'Old diff failed' } }); return; }
    }
    await route.fulfill({ json: diff(id) });
  });
  await page.route('**/api/commands', async route => {
    const command = route.request().postDataJSON(); calls.push(command);
    const delay = control.delayedCommand; control.delayedCommand = null;
    if (delay) { delay.started(); await delay.wait; }
    await route.fulfill({ json: { ok: true, data: { text: 'Completed ' + command.args.id } } });
  });
  try {
    await page.goto(fixture.base + '/?nosw=1');
    await page.waitForFunction(() => window.nibbiApp && document.body.dataset.link === 'live');
    await run(page, control, calls);
  } finally {
    for (const pending of gates) pending.release();
    await context.close();
  }
}
async function beginReview(page) {
  await page.evaluate(() => { document.activeElement?.blur(); window.reviewOpening = window.nibbiApp.send('/review all'); });
  await page.locator('.review .rhead').waitFor();
}
async function shown(page, id) {
  await page.locator('.review .dstat').filter({ hasText: id + '.txt' }).waitFor();
}
async function confirmAction(page, label, confirmation) {
  await page.locator('.review').getByRole('button', { name: label, exact: true }).click();
  await page.locator('.review').getByRole('button', { name: confirmation, exact: true }).click();
}

try {
  browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' });
  for (const error of [false, true]) await withPage(async (page, control) => {
    const delayed = gate(); control.delayedDiff = { id: 'review-0', gate: delayed, error };
    await beginReview(page); await ready(delayed.ready);
    await page.keyboard.press('j'); await shown(page, 'review-1');
    delayed.release(); await page.evaluate(() => window.reviewOpening);
    assert.match(await page.locator('.review .rhead').textContent(), /Review item 1/);
    assert.equal(await page.locator('.review .diffv').count(), 1, 'Only the selected diff is rendered');
    assert.doesNotMatch(await page.locator('.review .said').textContent(), /Content for review-0|Old diff failed/);
    assert.equal(await page.locator('.review .acts').count(), 1, 'A stale response cannot add a second action row');
  });

  await withPage(async (page, control) => {
    const delayed = gate(); control.delayedDiff = { id: 'review-0', gate: delayed };
    await beginReview(page); await ready(delayed.ready);
    await page.keyboard.press('Escape');
    delayed.release(); await page.evaluate(() => window.reviewOpening);
    assert.equal(await page.locator('.review, .diffv').count(), 0, 'Leaving review invalidates its pending diff');
    assert.equal(await page.evaluate(() => window.nibbiApp.state().mode), 'talk', 'Escape leaves review without tidying the conversation');
  });

  for (const kind of ['approve', 'discard']) await withPage(async (page, control, calls) => {
    await beginReview(page); await shown(page, 'review-0');
    const delayed = gate(); control.delayedCommand = delayed;
    await confirmAction(page, kind === 'approve' ? 'approve & merge (a)' : 'discard (x)', kind === 'approve' ? 'merge — sure?' : 'discard this fixer — sure?');
    await ready(delayed.ready);
    await page.keyboard.press('j'); await shown(page, 'review-1');
    assert.equal(await page.locator('.review [data-review-mutation]:enabled').count(), 0, 'An in-flight action cannot be submitted again');
    delayed.release();
    await page.waitForFunction(() => window.nibbiApp.state().review.ids.length === 2);
    await shown(page, 'review-1');
    assert.deepEqual(await page.evaluate(() => window.nibbiApp.state().review.ids), ['review-1', 'review-2']);
    assert.match(await page.locator('.review .rhead').textContent(), /Review item 1/, 'Completing another item preserves the current selection');
    assert.equal(calls.length, 1); assert.equal(calls[0].args.id, 'review-0');
    assert.equal(await page.locator('.review [data-review-mutation]:disabled').count(), 0);
  });

  await withPage(async (page, control) => {
    await beginReview(page); await shown(page, 'review-0');
    const delayed = gate(); control.delayedCommand = delayed;
    await confirmAction(page, 'discard (x)', 'discard this fixer — sure?'); await ready(delayed.ready);
    await page.keyboard.press('Escape'); await beginReview(page); await shown(page, 'review-0');
    delayed.release();
    await page.getByText('Completed review-0', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.nibbiApp.state().review.ids), ['review-0', 'review-1', 'review-2'], 'An old action cannot mutate a newly opened review');
  });

  await withPage(async (page, _control, calls) => {
    await beginReview(page); await shown(page, 'review-0');
    await page.evaluate(() => document.querySelector('#st-platform').click());
    const field = page.getByRole('dialog').getByLabel('Model (blank uses provider default)').first();
    await field.fill(''); await field.pressSequentially('ajax'); await field.press('ArrowRight');
    assert.equal(await field.inputValue(), 'ajax');
    assert.equal(await field.evaluate(element => element === document.activeElement), true);
    assert.equal(await page.evaluate(() => window.nibbiApp.state().review.i), 0, 'Typing in settings cannot navigate or arm review actions');
    assert.equal(await page.locator('.review .armed').count(), 0); assert.equal(calls.length, 0);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(await page.locator('.review').count(), 1, 'Closing settings preserves review');
    await page.locator('#project .plabel').click();
    const cap = page.locator('#project input[type=number]').first();
    await cap.focus(); await cap.press('a'); await cap.press('ArrowRight');
    assert.equal(await cap.evaluate(element => element === document.activeElement), true);
    assert.equal(await page.evaluate(() => window.nibbiApp.state().review.i), 0, 'Project inputs also own their arrow and letter keys');
    assert.equal(await page.locator('.review .armed').count(), 0); assert.equal(calls.length, 0);
  });
  assert.deepEqual(errors, [], 'No browser exceptions');
  console.log('Review checks passed: stale diffs and errors, closing during load, navigation during merge/discard, old action isolation, and dialog/project input shortcuts.');
} finally {
  for (const pending of gates) pending.release();
  await browser?.close();
  await fixture.close();
}

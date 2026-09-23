// What a streamed reply must do in a real browser: grow without rebuilding itself, keep what the
// reader has already got hold of, and leave nothing behind. Isolated backend, scripted brain.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { testBackend } from './test-backend.mjs';

const fixture = await testBackend();
const out = new URL('../output/playwright/stream/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
let browser;
try {
  browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' });
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const errors = [];
    const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, reducedMotion });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text() + ' @ ' + message.location().url); });
    // Count transcript writes from before the app loads: the point of the change is that a growing
    // reply does not touch storage, and only a spy installed this early can prove it.
    await page.addInitScript(() => {
      window.__transcriptWrites = 0;
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) { if (String(key).includes('transcript')) window.__transcriptWrites++; return setItem.call(this, key, value); };
    });
    await page.goto(fixture.base + '/?demo=1&nosw=1');
    await page.waitForFunction(() => window.nibbiApp);

    await page.evaluate(() => { window.__transcriptWrites = 0; window.nibbiApp.send('fix the lock bug'); });
    const live = page.locator('.bubble.live');
    await live.waitFor({ timeout: 20_000 });
    // The reply is a page-width card from its first frame. Shrink-wrapped, it opened at the width of
    // its steps and jumped to the full measure at the first word.
    const opened = await page.evaluate(() => {
      const bubble = document.querySelector('.bubble.live'), said = bubble.querySelector('.said');
      return { bubble: bubble.getBoundingClientRect().width, body: bubble.closest('.nibbody').getBoundingClientRect().width, stepLive: !!bubble.querySelector('.step.live'), dots: getComputedStyle(said, '::after').display };
    });
    assert.ok(opened.bubble > 0 && opened.bubble === opened.body, 'the live reply is as wide as its column, was ' + JSON.stringify(opened));
    if (!opened.stepLive) assert.notEqual(opened.dots, 'none', 'before any step runs, the dots say the turn is working');

    // Thinking is shown while it happens: a reasoning model that says nothing for ten seconds must
    // not look hung. The step counts, shows the end of what it is thinking, and closes into a verdict.
    await page.locator('.step.think').waitFor({ timeout: 20_000 });
    const thinking = await page.waitForFunction(() => {
      const step = document.querySelector('.step.think');
      const tail = step?.querySelector('.tail')?.textContent ?? '';
      const said = step?.closest('.bubble')?.querySelector('.said');
      return tail.trim() ? { label: step.querySelector('.l').textContent, tail, live: step.classList.contains('live'), dots: said ? getComputedStyle(said, '::after').display : '', saidEmpty: said ? !said.textContent : null, iterations: getComputedStyle(step.querySelector('.b')).animationIterationCount, timings: document.getAnimations().map(a => a.effect.getTiming().iterations) } : null;
    }, null, { timeout: 20_000 }).then(handle => handle.jsonValue());
    assert.equal(thinking.label, 'thinking', 'the live step says what it is doing');
    assert.equal(thinking.live, true);
    assert.ok(thinking.tail.trim().length, 'and shows the end of what is being thought');
    // One working mark at a time: a running step is it, so the dots under it stand down.
    assert.equal(thinking.saidEmpty, true, 'nothing has been said yet');
    assert.equal(thinking.dots, 'none', 'the dots stand down while a step is live');
    if (reducedMotion === 'reduce') {
      // At 1ms an infinite loop does not stand still, it flickers: every animation plays once.
      assert.equal(thinking.iterations, '1', 'the live step dot plays once under reduced motion');
      assert.ok(thinking.timings.every(n => n === 1), 'every running animation plays once, was ' + JSON.stringify(thinking.timings));
    } else assert.equal(thinking.iterations, 'infinite', 'and beats while motion is allowed');
    if (reducedMotion === 'no-preference') await page.screenshot({ path: out + 'thinking-1180x820.png' });

    // The tail is the only part still being rendered; everything above it is finished.
    const tail = page.locator('.bubble.live .said-tail');
    await tail.waitFor({ timeout: 20_000 });
    await page.waitForFunction(() => document.querySelector('.bubble.live .said-tail')?.textContent.trim().length > 0, null, { timeout: 20_000 });
    if (reducedMotion === 'no-preference') await page.screenshot({ path: out + 'mid-stream-1180x820.png' });

    // Hold the first finished block by reference and select it. A marker attribute would change the
    // reply's own markup, which the settle check would then rightly notice, so the node is kept in a
    // variable instead — nothing about the page changes because the test is watching.
    const held = await page.waitForFunction(() => {
      const said = document.querySelector('.bubble.live .said');
      const first = said && [...said.children].find(node => !node.classList.contains('said-tail') && node.textContent.trim());
      if (!first) return null;
      window.__held = first;
      getSelection().selectAllChildren(first);
      return { text: first.textContent, selection: getSelection().toString() };
    }, null, { timeout: 20_000 }).then(handle => handle.jsonValue());
    assert.ok(held.text.trim().length, 'a finished block was rendered before the reply ended');

    // Finished blocks are the ones that must not move. The tail's text legitimately changes as
    // markdown closes — a half-typed `session becomes session.ts — so only the settled part is
    // checked, by watching the marked node rather than by comparing strings.
    let writesWhileStreaming = 0;
    for (let i = 0; i < 12; i++) {
      const kept = await page.evaluate(() => ({ present: window.__held.isConnected, text: window.__held.textContent, busy: window.nibbiApp.state().busy, writes: window.__transcriptWrites }));
      assert.ok(kept.present, 'the finished block stayed in the document for the whole reply');
      assert.equal(kept.text, held.text, 'and its text never changed while the rest streamed');
      if (!kept.busy) break;
      writesWhileStreaming = kept.writes;   // the last count taken while the reply was still arriving
      await page.waitForTimeout(400);
    }
    assert.ok(writesWhileStreaming <= 2, 'a growing reply does not rewrite the transcript, was ' + writesWhileStreaming);

    await page.waitForFunction(() => !window.nibbiApp.state().busy, null, { timeout: 30_000 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    const settled = await page.evaluate(() => {
      const turn = [...document.querySelectorAll('.turn')].at(-1);
      const said = turn.querySelector('.said');
      const probe = window.__held;
      return {
        tails: document.querySelectorAll('.said-tail').length,
        liveBubbles: document.querySelectorAll('.bubble.live').length,
        items: said.querySelectorAll('li').length,
        code: said.querySelectorAll('code').length,
        text: said.textContent,
        probeKept: probe.isConnected && said.contains(probe),
        probeText: probe.textContent,
        selection: getSelection().toString(),
        acc: window.nibbiApp.state().turns.at(-1).acc,
        thought: turn.querySelector('.step.think')?.className ?? '',
        thoughtLabel: turn.querySelector('.step.think .l')?.textContent ?? '',
        thoughtTime: turn.querySelector('.step.think .t')?.textContent ?? '',
        width: turn.querySelector('.bubble').getBoundingClientRect().width,
        bodyWidth: turn.querySelector('.nibbody').getBoundingClientRect().width,
      };
    });
    assert.equal(settled.width, settled.bodyWidth, 'the settled reply is still as wide as its column');
    assert.equal(settled.width, opened.bubble, 'and the card never changed width between its first frame and its last');
    assert.equal(settled.tails, 0, 'the tail is unwrapped when the reply settles');
    assert.equal(settled.liveBubbles, 0, 'the settled reply is no longer live');
    assert.equal(settled.items, 2, 'both list items are in the finished reply');
    assert.ok(settled.code >= 2, 'inline code survived the settle');
    assert.ok(settled.text.includes('ship it straight to'), 'the last sentence of the reply is present');
    assert.ok(settled.probeKept, 'the block marked mid-stream is the same node at the end — finished blocks are never re-rendered');
    assert.equal(settled.probeText, held.text, 'and its text never changed');
    assert.equal(settled.selection, held.selection, 'a selection made while the reply was streaming survives it');
    assert.equal(settled.thoughtLabel, 'thought', 'the thinking step closes into a verdict');
    assert.ok(settled.thought.includes('done'), 'and is marked done, not left running');
    assert.ok(/\ds/.test(settled.thoughtTime), 'with how long it took, was ' + JSON.stringify(settled.thoughtTime));
    assert.ok(!settled.text.includes('`'), 'the markdown was rendered, not shown: no raw backticks survive');
    assert.ok(!/(^|\n)- /.test(settled.text), 'and no raw list markers either');

    if (reducedMotion === 'no-preference') await page.screenshot({ path: out + 'settled-1180x820.png' });
    const writesAfter = await page.evaluate(() => window.__transcriptWrites);
    assert.ok(writesAfter > writesWhileStreaming, 'the settled turn is written once it is done');

    // A reload rebuilds the reply from what was saved. The restored reply renders through the same
    // path a streamed one settles into, so the two must read identically.
    await page.reload();
    await page.waitForFunction(() => window.nibbiApp && document.querySelector('.said')?.textContent.trim().length > 0, null, { timeout: 20_000 });
    const restored = await page.evaluate(() => {
      const said = [...document.querySelectorAll('.said')].at(-1);
      return { text: said.textContent, items: said.querySelectorAll('li').length, tails: document.querySelectorAll('.said-tail').length };
    });
    assert.equal(restored.text, settled.text, 'the restored reply is the reply that was read');
    assert.equal(restored.items, 2, 'its list came back');
    assert.equal(restored.tails, 0, 'a restored reply has no live tail');

    if (reducedMotion === 'no-preference') {
      // Calm motion is the same kill switch as the system setting, carried as a class on body.
      const calm = await page.evaluate(() => {
        document.querySelector('#st-motion').click();
        const turn = document.querySelector('.turn');
        return { on: document.body.classList.contains('calm'), duration: getComputedStyle(turn).animationDuration, iterations: getComputedStyle(turn).animationIterationCount };
      });
      assert.deepEqual(calm, { on: true, duration: '0.001s', iterations: '1' }, 'Calm motion turns on body.calm and the reduced-motion rules with it');
      assert.equal(await page.evaluate(() => { document.querySelector('#st-motion').click(); return document.body.classList.contains('calm'); }), false, 'and turning it off takes them away');
    }
    assert.deepEqual(errors, [], 'No unexpected browser errors (' + reducedMotion + ')');
    await context.close();
  }
  console.log('Streaming checks passed: block-stable rendering, a surviving selection, a clean settle and no transcript writes mid-reply.');
} finally {
  await browser?.close();
  await fixture.close();
}

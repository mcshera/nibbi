// What a streamed reply must do in a real browser: grow without rebuilding itself, keep what the
// reader has already got hold of, and leave nothing behind. Isolated backend, scripted brain.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { testBackend } from './test-backend.mjs';

const fixture = await testBackend();
const out = new URL('../output/playwright/stream/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

/* The two blocks a streamed reply most often gets wrong mid-flight — an open fence and a table — at
   three sizes, one of them under glass. The reply is the demo's "show me the code", asked twice: the
   first answer makes the feed tall enough to scroll away from while the second is still arriving.
   (The demo is read-only for slash commands, so /help cannot fill it.) */
async function streamAtSizes(browser) {
  let paper = null;
  const alpha = value => { const parts = (value.match(/[\d.]+/g) || []).map(Number); return parts.length > 3 ? parts[3] : 1; };
  for (const size of [{ w: 1180, h: 600 }, { w: 390, h: 844 }, { w: 1180, h: 600, glass: true }]) {
    const tag = `${size.w}x${size.h}${size.glass ? '-glass' : ''}`, phone = size.w < 600, errors = [];
    const context = await browser.newContext({ viewport: { width: size.w, height: size.h }, isMobile: phone, hasTouch: phone });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text() + ' @ ' + message.location().url); });
    await page.goto(fixture.base + '/?demo=1&nosw=1');
    await page.waitForFunction(() => window.nibbiApp);
    if (size.glass) await page.evaluate(() => { document.body.classList.add('glass'); document.documentElement.classList.add('glass'); });
    await page.evaluate(() => window.nibbiApp.send('show me the code'));   // the first one is something to scroll up to
    await page.waitForFunction(() => /Two files\.$/.test(window.nibbiApp.state().turns.at(-1)?.acc || '') && !window.nibbiApp.state().busy && !document.querySelector('.bubble.live'), null, { timeout: 20_000 });
    await page.evaluate(() => { void window.nibbiApp.send('show me the code'); });   // do not await: send() resolves when the reply ends

    // The first sentence is a paragraph in the tail, and the caret is on it.
    const caret = await page.waitForFunction(() => {
      const T = window.nibbiApp.state().turns.at(-1), last = document.querySelector('.bubble.live .said-tail')?.lastElementChild;
      if (!T || T.acc.includes('`') || last?.tagName !== 'P') return null;
      return getComputedStyle(last, '::after').content;
    }, null, { timeout: 20_000, polling: 'raf' }).then(handle => handle.jsonValue());
    assert.notEqual(caret, 'none', `${tag}: the caret is on the sentence being written`);

    // While the fence is open it renders as code, not as escaped prose waiting for its closing row.
    await page.waitForFunction(() => {
      const acc = window.nibbiApp.state().turns.at(-1).acc;
      return (acc.match(/^```/gm) || []).length % 2 === 1 && !!document.querySelector('.bubble.live .said-tail pre');
    }, null, { timeout: 20_000, polling: 'raf' });
    await page.screenshot({ path: out + `code-open-${tag}.png` });

    // Read something further up once the first block is finished: what lands below is counted.
    await page.waitForFunction(() => [...(document.querySelector('.bubble.live .said')?.children || [])].some(node => !node.classList.contains('said-tail')), null, { timeout: 20_000 });
    // A programmatic scroll can lose to the pinned feed's own scroll-to-bottom, queued by a render in
    // the same frame; a reader's scroll keeps going, so this one does too until the feed lets go.
    await page.waitForFunction(() => { document.querySelector('#feed').scrollTop = 0; return !window.nibbiApp.state().stick && !document.querySelector('#jump').hidden; }, null, { timeout: 5_000, polling: 50 });
    const jump = await page.waitForFunction(() => {
      const button = document.querySelector('#jump'), label = button?.querySelector('.jumpn')?.textContent || '';
      return button && !button.hidden && /^\d+ new$/.test(label) ? label : null;
    }, null, { timeout: 20_000 }).then(handle => handle.jsonValue());
    assert.match(jump, /^\d+ new$/, `${tag}: a streamed reply counts its finished blocks as new`);
    await page.screenshot({ path: out + `code-jump-${tag}.png` });

    await page.waitForFunction(() => !window.nibbiApp.state().busy, null, { timeout: 30_000 });
    await page.evaluate(() => { document.querySelector('#jump').click(); });
    await page.waitForTimeout(700);
    const read = await page.evaluate(() => {
      const said = [...document.querySelectorAll('.said')].at(-1), wrap = said.querySelector('.tblwrap');
      return {
        pre: said.querySelectorAll('pre').length, rows: said.querySelectorAll('tbody tr').length, tails: document.querySelectorAll('.said-tail').length,
        page: document.documentElement.scrollWidth <= innerWidth, table: wrap ? { scroll: wrap.scrollWidth, client: wrap.clientWidth } : null,
        ink3: getComputedStyle(document.body).getPropertyValue('--ink-3').trim(), color: getComputedStyle(said).color, bubble: getComputedStyle(said.closest('.bubble')).backgroundColor,
      };
    });
    await page.screenshot({ path: out + `code-settled-${tag}.png` });
    assert.equal(read.pre, 1, `${tag}: one code block`);
    assert.equal(read.rows, 2, `${tag}: both table rows`);
    assert.equal(read.tails, 0, `${tag}: no live tail left behind`);
    assert.ok(read.table, `${tag}: the table is wrapped`);
    if (phone) {
      assert.ok(read.page, `${tag}: no horizontal page overflow`);
      assert.ok(read.table.scroll <= read.table.client + 1, `${tag}: the table fits the bubble: ` + JSON.stringify(read.table));
    }
    if (!size.glass) paper ??= read;
    else {
      // No ink fork under glass (tokens.css body.glass): the paper changes, the ink and the reply's surface do not.
      assert.equal(read.ink3, paper.ink3, 'glass keeps --ink-3');
      assert.equal(read.color, paper.color, 'glass keeps the reply\'s ink');
      assert.equal(alpha(read.bubble), alpha(paper.bubble), 'glass keeps the reply surface\'s alpha');
    }
    assert.deepEqual(errors, [], `No unexpected browser errors (${tag})`);
    await context.close();
  }
}

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

    // Thinking is shown while it happens: a reasoning model that says nothing for ten seconds must
    // not look hung. The step counts, shows the end of what it is thinking, and closes into a verdict.
    await page.locator('.step.think').waitFor({ timeout: 20_000 });
    const thinking = await page.waitForFunction(() => {
      const step = document.querySelector('.step.think');
      const tail = step?.querySelector('.tail')?.textContent ?? '';
      return tail.trim() ? { label: step.querySelector('.l').textContent, tail, live: step.classList.contains('live') } : null;
    }, null, { timeout: 20_000 }).then(handle => handle.jsonValue());
    assert.equal(thinking.label, 'thinking', 'the live step says what it is doing');
    assert.equal(thinking.live, true);
    assert.ok(thinking.tail.trim().length, 'and shows the end of what is being thought');
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
      };
    });
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

    assert.deepEqual(errors, [], 'No unexpected browser errors (' + reducedMotion + ')');
    await context.close();
  }
  console.log('Streaming checks passed: block-stable rendering, a surviving selection, a clean settle and no transcript writes mid-reply.');
  await streamAtSizes(browser);
  console.log('Streaming checks passed at 1180x600, 390x844 and under glass: an open fence is code, the caret, a counted jump, a table that fits.');
} finally {
  await browser?.close();
  await fixture.close();
}

// Composition and surfaces: what the page looks like around the conversation, in a real browser.
// Isolated backend, scripted brain. One scenario per concern; each names what it protects.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { testBackend } from './test-backend.mjs';

const fixture = await testBackend();
const out = new URL('../output/playwright/surfaces/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
let browser, failed = false;
async function scenario(name, fn) {
  try { await fn(); console.log('PASS', name); }
  catch (error) { failed = true; console.error('FAIL', name, '\n', error); }
}
async function page(viewport, options = {}, { query = '?demo=1&nosw=1', reply } = {}) {
  const context = await browser.newContext({ viewport, ...options });
  const tab = await context.newPage();
  const errors = [];
  tab.on('pageerror', error => errors.push(error.message));
  tab.on('console', message => { if (message.type() === 'error') errors.push(message.text() + ' @ ' + message.location().url); });
  // A scripted brain answers once with exactly this text, for replies no demo script writes.
  if (reply) await tab.route('**/api/send', route => route.fulfill({ json: { text: reply, costUsd: 0, isError: false } }));
  await tab.goto(fixture.base + '/' + query);
  await tab.waitForFunction(() => window.nibbiApp && window.nibbi && document.querySelector('.margin-tab[data-margin-tab="builds"]'));
  return { context, page: tab, errors };
}
const settled = tab => tab.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity));

try {
  browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' });

  // A section is a room: from idle the character snaps to its header pose instead of shrinking
  // through the header for 600ms, the fixers stay outside, and the header × is the only way back.
  for (const [width, height, touch] of [[1180, 820, false], [390, 844, true]]) {
    await scenario(`a section is a room at ${width}x${height}`, async () => {
      const { context, page: tab, errors } = await page({ width, height }, touch ? { isMobile: true, hasTouch: true } : {});
      try {
        await tab.waitForFunction(() => document.querySelectorAll('#agents .agent').length > 0, null, { timeout: 15_000 });
        const before = await tab.evaluate(() => ({ mode: document.body.dataset.mode, r: window.nibbi.state().r, agents: getComputedStyle(document.querySelector('#agents')).display }));
        assert.equal(before.mode, 'idle', 'the scenario starts from idle');
        if (width >= 900) assert.ok(before.r > 100, 'with the hero at full size, r=' + before.r);
        assert.notEqual(before.agents, 'none', 'and the fixers on their perch, so hiding them is a real change');
        if (width < 900) { await tab.locator('#sidebar-toggle').click(); await tab.waitForFunction(() => document.querySelector('#workspace-sidebar').getAttribute('aria-hidden') === 'false'); }
        await tab.locator('.margin-tab[data-margin-tab="builds"]').click();
        await frames(tab);
        const opened = await tab.evaluate(() => ({ r: window.nibbi.state().r, tr: window.nibbi.state().tr, agents: getComputedStyle(document.querySelector('#agents')).display, launcher: document.querySelectorAll('#project-chat-launcher').length, view: document.body.classList.contains('project-view') }));
        assert.equal(opened.view, true, 'the section is open');
        // Snapped, not sprung: two frames in, the pose is the target. A spring (k=70) is still near where it started.
        assert.ok(opened.tr < before.r, `the header pose is smaller than the hero (${opened.tr} < ${before.r})`);
        assert.ok(Math.abs(opened.r - opened.tr) < 0.5, `two frames after opening, the hero is already in its header pose (r=${opened.r}, target ${opened.tr})`);
        if (width >= 900) assert.ok(opened.r <= 80, 'r=' + opened.r);
        assert.equal(opened.agents, 'none', 'no fixers float over the records');
        assert.equal(opened.launcher, 0, 'and no floating chat launcher covers them');
        // Measure once the section has arrived: it slides in 10px over --t2, and so does the drawer leaving.
        await tab.waitForFunction(() => document.querySelector('#project-workspace').getAttribute('aria-busy') === 'false' && document.getAnimations().every(a => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity));
        const close = tab.locator('.project-close'), box = await close.boundingBox();
        assert.ok(box && box.width >= 44 && box.height >= 44, 'the header × is a 44px target, was ' + JSON.stringify(box));
        assert.ok(box.x >= 0 && box.x + box.width <= width && box.y >= 0, 'inside the viewport');
        await tab.locator('.project-workspace-body').evaluate(el => { el.scrollTop = el.scrollHeight; });
        assert.deepEqual(await close.boundingBox(), box, 'and it stays put while the records scroll');
        await tab.screenshot({ path: `${out}section-${width}x${height}.png` });
        await close.click();
        await tab.waitForFunction(() => document.querySelector('#project-workspace').hidden);
        assert.deepEqual(await tab.evaluate(() => ({ view: document.body.classList.contains('project-view'), focus: document.activeElement?.id, agents: getComputedStyle(document.querySelector('#agents')).display })), { view: false, focus: 'ask', agents: before.agents }, 'the × returns to the composer, and the fixers come back');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  }

  // Below 900 the section header stacks its summary over its controls. The GitHub panels' toolbars are
  // a heading and one button with no actions group, and they keep their row: stacked, the button
  // stretched into a full-width slab.
  for (const [width, height] of [[700, 900], [390, 844]]) {
    await scenario(`the repository toolbar keeps its row at ${width}x${height}`, async () => {
      const { context, page: tab, errors } = await page({ width, height }, { isMobile: true, hasTouch: true });
      try {
        await tab.locator('#sidebar-toggle').click();
        await tab.waitForFunction(() => document.querySelector('#workspace-sidebar').getAttribute('aria-hidden') === 'false');
        await tab.locator('.margin-tab[data-margin-tab="builds"]').click();
        await tab.waitForFunction(() => window.nibbiApp.state().projectView?.section === 'builds' && document.querySelector('#project-workspace').getAttribute('aria-busy') === 'false');
        await tab.getByRole('button', { name: 'Repository & GitHub', exact: true }).first().click();
        await tab.waitForFunction(() => window.nibbiApp.state().projectView?.section === 'repository' && document.querySelector('#project-workspace').getAttribute('aria-busy') === 'false' && document.querySelector('.github-panel .project-toolbar'), null, { timeout: 15_000 });
        await settled(tab);
        const bars = await tab.evaluate(() => [...document.querySelectorAll('.project-toolbar')].filter(bar => bar.getClientRects().length && !bar.querySelector(':scope > .project-toolbar-actions')).map(bar => {
          const box = el => el.getBoundingClientRect(), heading = bar.querySelector(':scope > h2'), button = bar.querySelector(':scope > button');
          return { heading: heading?.textContent, button: button?.textContent, bar: Math.round(box(bar).width), width: Math.round(box(button).width), sameRow: box(button).top < box(heading).bottom && box(heading).top < box(button).bottom };
        }));
        assert.ok(bars.length >= 1, 'the repository panel has its toolbar');
        for (const bar of bars) {
          assert.ok(bar.width < bar.bar / 2, `"${bar.button}" keeps its own width, ${JSON.stringify(bar)}`);
          assert.ok(bar.sameRow, `and sits beside "${bar.heading}", ${JSON.stringify(bar)}`);
        }
        const header = await tab.evaluate(() => { const bar = document.querySelector('.project-toolbar:has(> .project-toolbar-actions)'); return bar && getComputedStyle(bar).flexDirection; });
        if (header) assert.equal(header, 'column', 'while a section header still stacks its summary over its controls');
        await tab.screenshot({ path: `${out}repository-${width}x${height}.png` });
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  }

  // A fixer's card opens for the pointer, for the pin, and for keyboard focus. A click focuses the
  // agent as well, and that focus must not hold the card open once the click has unpinned it.
  await scenario('an agent card closes when it is unpinned', async () => {
    const { context, page: tab, errors } = await page({ width: 1180, height: 820 });
    try {
      await tab.waitForFunction(() => document.querySelectorAll('#agents .agent').length > 0, null, { timeout: 15_000 });
      await settled(tab);
      const agent = tab.locator('#agents .agent').first();
      const card = () => agent.evaluate(el => ({ pinned: el.classList.contains('pinned'), opacity: getComputedStyle(el.querySelector('.card')).opacity, focus: document.activeElement === el ? 'agent' : el.querySelector('.card').contains(document.activeElement) ? 'card' : document.activeElement?.tagName }));
      await agent.click(); await tab.mouse.move(200, 200); await settled(tab);
      assert.deepEqual(await card(), { pinned: true, opacity: '1', focus: 'agent' }, 'a click pins the card open');
      await agent.click(); await tab.mouse.move(200, 200); await settled(tab);
      assert.deepEqual(await card(), { pinned: false, opacity: '0', focus: 'agent' }, 'a second click unpins it, and it closes although the agent keeps focus');
      await tab.locator('#ask').focus();
      await tab.keyboard.press('Shift');   // keyboard modality, so the next focus is a visible one
      await agent.evaluate(el => el.focus()); await settled(tab);
      assert.deepEqual(await card(), { pinned: false, opacity: '1', focus: 'agent' }, 'keyboard focus on the agent opens it');
      assert.ok(await agent.locator('.card').evaluate(el => !!el.querySelector('button, textarea')), 'the click filled the card with its actions');
      await tab.keyboard.press('Tab'); await settled(tab);
      assert.deepEqual(await card(), { pinned: false, opacity: '1', focus: 'card' }, 'and it stays open while focus is inside it');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  // The code block's copy button paints a small pill so it does not sit on the code, and reaches a
  // 44px target through a hit area that stays inside the block.
  const fence = 'Here it is.\n\n```js\n' + Array.from({ length: 4 }, (_, i) => `const line${i} = ${i};`).join('\n') + '\n```\n';
  await scenario('the code block copy button is a 44px target on a phone', async () => {
    const { context, page: tab, errors } = await page({ width: 390, height: 844 }, { isMobile: true, hasTouch: true }, { query: '?nosw=1', reply: fence });
    try {
      await tab.waitForFunction(() => document.body.dataset.link === 'live');
      await tab.evaluate(() => window.nibbiApp.send('show me'));
      await tab.waitForFunction(() => !window.nibbiApp.state().busy && document.querySelector('.turn:last-child pre .copycode'), null, { timeout: 20_000 });
      const hit = await tab.evaluate(() => {
        const b = document.querySelector('.turn:last-child pre .copycode'), r = b.getBoundingClientRect();
        let top = Infinity, bottom = -Infinity, left = Infinity, right = -Infinity;
        for (let y = Math.floor(r.top) - 30; y < r.bottom + 30; y++) for (let x = Math.floor(r.left) - 30; x < r.right + 30; x++) if (document.elementFromPoint(x, y) === b) { top = Math.min(top, y); bottom = Math.max(bottom, y); left = Math.min(left, x); right = Math.max(right, x); }
        return { pill: [Math.round(r.width), Math.round(r.height)], hit: [right - left + 1, bottom - top + 1] };
      });
      assert.ok(hit.pill[1] < 44, 'the pill it paints stays small, ' + JSON.stringify(hit));
      assert.ok(hit.hit[0] >= 44 && hit.hit[1] >= 44, 'and the target it answers is 44px each way, ' + JSON.stringify(hit));
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  // A transcript saved before the step rows were kept holds the summary line alone. There is nothing
  // under it to open, so it must not be announced as a collapsed toggle that never expands.
  await scenario("an older transcript's step summary is a line, not a toggle", async () => {
    const { context, page: tab, errors } = await page({ width: 1180, height: 820 });
    try {
      await tab.evaluate(() => window.nibbiApp.send('fix the lock bug'));
      await tab.waitForFunction(() => !window.nibbiApp.state().busy, null, { timeout: 40_000 });
      // Rewrite what was saved the way an older build saved it, wherever this build keeps it. The page
      // saves again as it unloads, so the older copy goes in as the reloaded page starts, before the app.
      const older = await tab.waitForFunction(() => {
        for (const key of Object.keys(localStorage)) {
          let saved; try { saved = JSON.parse(localStorage.getItem(key)); } catch { continue; }
          const row = saved?.rows?.findLast?.(r => Array.isArray(r.stepRows));
          if (!row) continue;
          for (const r of saved.rows) delete r.stepRows;
          return { key, value: JSON.stringify(saved), summary: row.steps };
        }
        return null;
      }, null, { timeout: 5_000 }).then(handle => handle.jsonValue());
      const summary = older.summary;
      assert.match(summary, /^\d+ steps? in /, 'the finished turn saved its summary');
      await context.addInitScript(({ key, value }) => { if (!sessionStorage.getItem('surfaces.older')) { sessionStorage.setItem('surfaces.older', '1'); localStorage.setItem(key, value); } }, older);
      await tab.reload();
      await tab.waitForFunction(() => window.nibbiApp && document.querySelector('.turn:last-child .steps .fold'));
      const line = await tab.locator('.turn:last-child .steps .fold').evaluate(el => ({ tag: el.tagName, text: el.textContent, expanded: el.getAttribute('aria-expanded'), controls: el.getAttribute('aria-controls'), tabIndex: el.tabIndex, shown: !!el.getClientRects().length, cursor: getComputedStyle(el).cursor }));
      assert.deepEqual(line, { tag: 'DIV', text: summary, expanded: null, controls: null, tabIndex: -1, shown: true, cursor: 'default' }, 'the summary is shown as a line, with no toggle word and no toggle to press');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
} finally {
  await browser?.close();
  await fixture.close();
}
if (failed) process.exitCode = 1;
else console.log('Surface checks passed: a section is a room, the repository toolbar keeps its row, an agent card closes when unpinned, the copy button is a 44px target, and an old step summary is a line.');

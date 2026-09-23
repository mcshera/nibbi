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
async function page(viewport, options = {}) {
  const context = await browser.newContext({ viewport, ...options });
  const tab = await context.newPage();
  const errors = [];
  tab.on('pageerror', error => errors.push(error.message));
  tab.on('console', message => { if (message.type() === 'error') errors.push(message.text() + ' @ ' + message.location().url); });
  await tab.goto(fixture.base + '/?demo=1&nosw=1');
  await tab.waitForFunction(() => window.nibbiApp && window.nibbi && document.querySelector('.margin-tab[data-margin-tab="builds"]'));
  return { context, page: tab, errors };
}

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
} finally {
  await browser?.close();
  await fixture.close();
}
if (failed) process.exitCode = 1;
else console.log('Surface checks passed: a section is a room.');

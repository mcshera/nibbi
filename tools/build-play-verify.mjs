import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { testBackend } from './test-backend.mjs';
import { chooseProject } from './choose-project.mjs';
const fixture = await testBackend();
const browser = await chromium.launch({ channel: 'chrome' });
const out = 'output/playwright/build-play'; mkdirSync(out, { recursive: true });
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(fixture.base + '/?nosw=1');
    await page.waitForFunction(() => window.nibbiApp?.state().projects?.length);
    await page.locator('#ask').fill('Keep this draft while I play');
    if (await page.locator('#sidebar-toggle').isVisible()) await page.locator('#sidebar-toggle').click();
    await chooseProject(page, 'fixture');
    // The staged run's ticket holds its preview now (the lobby's Play build, moved: docs/CONTROL-PANEL.md §5.1 previewRun).
    await page.locator('[data-bar-improvement="run:fixture-0"]').click();
    const ticket = page.locator('#project-workspace .cp-page[data-cp-page="ticket"][data-cp-id="run:fixture-0"]');
    await ticket.waitFor();
    const key = name => ticket.locator('.cp-actions').getByRole('button', { name, exact: true });
    await key('play it').waitFor();
    assert.equal(await key('play it').evaluate(el => el.classList.contains('cp-act-ink')), true, 'play it is the ticket\'s one ink key');
    await page.waitForFunction(() => { const s = nibbi.state(); return Math.abs(s.y-s.ty)<2 && Math.abs(s.r-s.tr)<1; });
    await page.screenshot({ path: `${out}/ready-${viewport.width}.png` });
    const popupReady = page.waitForEvent('popup');
    await key('play it').click();
    const popup = await popupReady;
    await popup.getByRole('heading', { name: 'Your build is running' }).waitFor();
    await popup.getByRole('button', { name: '0', exact: true }).click();
    assert.equal(await popup.getByRole('button', { name: '1', exact: true }).count(), 1);
    await key('open it').waitFor();
    await key('stop playing').waitFor();
    assert.equal(await page.locator('#ask').inputValue(), 'Keep this draft while I play');
    assert.equal(await page.locator('#project-workspace').isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.waitForFunction(() => { const s = nibbi.state(); return Math.abs(s.y-s.ty)<2 && Math.abs(s.r-s.tr)<1; });
    await page.screenshot({ path: `${out}/live-${viewport.width}.png` });
    const again = page.waitForEvent('popup');
    await key('open it').click();
    await (await again).getByRole('heading', { name: 'Your build is running' }).waitFor();
    await key('stop playing').click();
    await key('play it').waitFor();
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS a ticket plays its try, opens it again, stops it, and keeps the draft ${viewport.width}x${viewport.height}`);
  }
} finally { await browser.close(); await fixture.close(); }

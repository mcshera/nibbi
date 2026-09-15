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
    await page.locator('[data-section-project="fixture"][data-project-section="builds"]').click();
    await page.locator('[data-build-id="fixture-0"]').waitFor();
    if (viewport.width < 900) await page.locator('[data-build-id="fixture-0"] > summary').click();
    await page.getByRole('button', { name: 'Play build', exact: true }).waitFor();
    await page.waitForFunction(() => { const s = nibbi.state(); return Math.abs(s.y-s.ty)<2 && Math.abs(s.r-s.tr)<1; });
    await page.screenshot({ path: `${out}/ready-${viewport.width}.png` });
    const popupReady = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Play build', exact: true }).click();
    const popup = await popupReady;
    await popup.getByRole('heading', { name: 'Your build is running' }).waitFor();
    await popup.getByRole('button', { name: '0', exact: true }).click();
    assert.equal(await popup.getByRole('button', { name: '1', exact: true }).count(), 1);
    await page.getByRole('button', { name: 'Open build', exact: true }).waitFor();
    assert.equal(await page.locator('#ask').inputValue(), 'Keep this draft while I play');
    assert.equal(await page.locator('#project-workspace').isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.waitForFunction(() => { const s = nibbi.state(); return Math.abs(s.y-s.ty)<2 && Math.abs(s.r-s.tr)<1; });
    await page.screenshot({ path: `${out}/live-${viewport.width}.png` });
    await page.getByRole('button', { name: 'Stop build preview', exact: true }).click();
    await page.getByRole('button', { name: 'Play build', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS play, interact, stop, draft preservation ${viewport.width}x${viewport.height}`);
  }
} finally { await browser.close(); await fixture.close(); }

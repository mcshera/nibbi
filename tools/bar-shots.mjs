// Evidence for the bar and the reply at the sizes and materials they actually ship on.
// Writes output/playwright/bar/*.png against the isolated fixture backend.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { testBackend } from './test-backend.mjs';

const fixture = await testBackend();
const out = new URL('../output/playwright/bar/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const sizes = [[1180, 820], [520, 480], [390, 844]];
let browser;
try {
  browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' });
  for (const [width, height] of sizes) {
    for (const material of ['paper', 'glass']) {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      await page.goto(fixture.base + '/?demo=1&nosw=1');
      await page.waitForFunction(() => window.nibbiApp);
      if (material === 'glass') await page.evaluate(() => document.body.classList.add('glass'));
      await page.evaluate(() => window.nibbiApp.send('fix the lock bug'));
      await page.waitForFunction(() => !window.nibbiApp.state().busy, null, { timeout: 40_000 });
      await page.evaluate(() => { document.body.classList.remove('rest'); });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}reply-${material}-${width}x${height}.png` });
      // Below 900px the bar is a drawer and starts closed, so it has to be opened to be seen.
      if (width < 900) { await page.locator('#sidebar-toggle').click(); await page.waitForTimeout(300); await page.screenshot({ path: `${out}bar-${material}-${width}x${height}.png` }); }
      else {
        await page.locator('#status').click();
        await page.locator('.margin-card:not([hidden])').waitFor();
        await page.waitForTimeout(250);
        await page.screenshot({ path: `${out}settings-${material}-${width}x${height}.png` });
        await page.keyboard.press('Escape');
      }
      // main's build page, opened from its row: the character in its header pose, no fixers over the page,
      // and the header × as the way back. Below 900 the drawer is already open from the shot above.
      await page.locator('[data-bar-build="main"]').click();
      await page.waitForFunction(() => !document.querySelector('#project-workspace').hidden && document.querySelector('#project-workspace .cp-page')?.getAttribute('aria-busy') === 'false');
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${out}build-${material}-${width}x${height}.png` });
      await context.close();
    }
  }
  // A copy under main (docs/BUILDS-AS-COPIES.md §6.5): made on the same backend once main's shots are taken,
  // with one improvement landed in it, and its build page.
  const kit = await fixture.enableCopies();
  await kit.improve(kit.dev.id, 'Say hello on the title screen');
  for (const [width, height] of [[1180, 820], [390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 900 });
    const page = await context.newPage();
    await page.goto(fixture.base + '/?demo=1&nosw=1');
    await page.waitForFunction(() => window.nibbiApp);
    if (width < 900) { await page.locator('#sidebar-toggle').click(); await page.waitForTimeout(300); }
    await page.locator('[data-bar-build="dev"]').waitFor();
    await page.locator('[data-cp-role="ship-copy"][data-build="dev"]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}copy-bar-${width}x${height}.png` });
    await page.locator('[data-bar-build="dev"]').click();
    await page.waitForFunction(() => document.querySelector('#project-workspace .cp-page')?.dataset.cpId === 'dev' && document.querySelector('#project-workspace .cp-page').getAttribute('aria-busy') === 'false');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}copy-page-${width}x${height}.png` });
    await context.close();
  }
  console.log('Bar shots written to output/playwright/bar/');
} finally { await browser?.close(); await fixture.close(); }

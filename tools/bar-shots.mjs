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
      }
      await context.close();
    }
  }
  console.log('Bar shots written to output/playwright/bar/');
} finally { await browser?.close(); await fixture.close(); }

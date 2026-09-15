import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { testBackend } from './test-backend.mjs';
import { chooseProject } from './choose-project.mjs';
const fixture = await testBackend();
const browser = await chromium.launch({ channel: 'chrome' });
const out = 'output/playwright/kanban'; mkdirSync(out, { recursive: true });
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 390, height: 430 }]) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
    const page = await context.newPage(); const errors = []; page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    const enter = async () => {
      if (await page.locator('#sidebar-toggle').isVisible()) await page.locator('#sidebar-toggle').click();
      await chooseProject(page, 'fixture');
      await page.locator('[data-section-project="fixture"][data-project-section="issues"]').click();
      await page.locator('.project-kanban-column').first().waitFor();
    };
    const column = status => page.locator(`[data-issue-status="${status}"]`);
    const card = () => page.locator('[data-record-id="fixture-focus"]');
    await page.goto(fixture.base + '/?nosw=1');
    await page.waitForFunction(() => window.nibbiApp?.state().projects?.length);
    await page.locator('#ask').fill('Keep this draft while I organize issues');
    await enter();
    assert.equal(await page.locator('.project-kanban-column').count(), 3);
    assert.equal(await column('backlog').locator('.project-issue').count(), 1);
    await card().locator('summary').click();
    await card().getByRole('button', { name: 'Start work', exact: true }).click();
    await column('in-progress').locator('[data-record-id="fixture-focus"]').waitFor();
    assert.equal((await (await fetch(fixture.base + '/api/project-section?project=fixture&section=issues')).json()).items[0].boardStatus, 'in-progress');
    if (!await card().evaluate(el => el.open)) await card().locator('summary').click();
    await card().getByRole('button', { name: 'Complete issue', exact: true }).click();
    await column('done').locator('[data-record-id="fixture-focus"]').waitFor();
    if (viewport.width >= 900) {
      await card().locator('summary').dragTo(column('backlog'));
    } else {
      if (!await card().evaluate(el => el.open)) await card().locator('summary').click();
      await card().getByRole('button', { name: 'Move to backlog', exact: true }).click();
    }
    await column('backlog').locator('[data-record-id="fixture-focus"]').waitFor();
    assert.equal(await page.locator('#ask').inputValue(), 'Keep this draft while I organize issues');
    assert.equal(await page.locator('#project-workspace').isVisible(), true);
    await page.reload(); await page.waitForFunction(() => window.nibbiApp?.state().projects?.length); await enter();
    assert.equal(await column('backlog').locator('.project-issue').count(), 1);
    assert.equal(await column('in-progress').locator('.project-issue').count(), 1);
    assert.equal(await column('done').locator('.project-issue').count(), 1);
    await page.waitForFunction(() => { const s = nibbi.state(); return Math.abs(s.y-s.ty)<2 && Math.abs(s.r-s.tr)<1; });
    const radius = await page.evaluate(() => nibbi.state().r);
    assert(radius >= (viewport.height < 520 ? 31 : 47));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `${out}/issues-${viewport.width}x${viewport.height}.png` });
    assert.deepEqual(errors, []); await context.close();
    console.log(`PASS kanban moves, persistence, draft, larger Nibbi ${viewport.width}x${viewport.height}`);
  }
} finally { await browser.close(); await fixture.close(); }

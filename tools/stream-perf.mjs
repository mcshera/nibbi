// Does a streamed reply still cost the main thread anything, and does the feed's mask matter?
// Runs the scripted brain twice — once as shipped, once with the mask removed — and reports long
// tasks and the worst frame gap. Manual; not part of npm run verify.
import { chromium } from 'playwright';
import { testBackend } from './test-backend.mjs';

const fixture = await testBackend();
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' });
const run = async (label, prepare) => {
  const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
  await page.goto(fixture.base + '/?demo=1&nosw=1');
  await page.waitForFunction(() => window.nibbiApp);
  if (prepare) await page.evaluate(prepare);
  await page.evaluate(() => {
    window.__long = [];
    window.__frames = [];
    new PerformanceObserver(list => { for (const entry of list.getEntries()) window.__long.push(Math.round(entry.duration)); }).observe({ entryTypes: ['longtask'] });
    let last = performance.now();
    const tick = () => { const now = performance.now(); window.__frames.push(now - last); last = now; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    window.nibbiApp.send('fix the lock bug');
  });
  await page.waitForFunction(() => !window.nibbiApp.state().busy, null, { timeout: 40_000 });
  const report = await page.evaluate(() => {
    const frames = window.__frames.slice(5).sort((a, b) => a - b);
    return { longTasks: window.__long, frames: frames.length, median: Math.round(frames[Math.floor(frames.length / 2)]), p95: Math.round(frames[Math.floor(frames.length * 0.95)]), worst: Math.round(frames.at(-1)) };
  });
  console.log(label.padEnd(18), 'long tasks:', JSON.stringify(report.longTasks), '| frame ms median', report.median, 'p95', report.p95, 'worst', report.worst);
  await page.context().close();
};
try {
  await run('as shipped', null);
  await run('mask removed', () => { document.querySelector('.feed').style.maskImage = 'none'; document.querySelector('.feed').style.webkitMaskImage = 'none'; });
} finally { await browser.close(); await fixture.close(); }

// node design/sidebar-lab/options.test.mjs [id ...] — contract checks for one option at a time, in a
// real browser, without screenshots. Authors run this while building; verify.mjs is the full sweep.
import { chromium } from 'playwright';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { listen } from './serve.mjs';
const dir = fileURLToPath(new URL('./options/', import.meta.url));
const ids = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(dir).filter(f => f.endsWith('.mjs')).map(f => f.slice(0, -4));
const { server, url } = await listen(0);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' });
let failed = 0;
try {
  for (const id of ids) {
    const page = await browser.newPage({ viewport: { width: 1700, height: 900 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
    await page.goto(`${url}contract.html?id=${encodeURIComponent(id)}`);
    await page.waitForFunction(() => window.__result, null, { timeout: 120000 });
    const result = await page.evaluate(() => window.__result);
    for (const c of result.checks) console.log(`ok   ${id}: ${c}`);
    for (const f of result.failures) console.log(`FAIL ${id}: ${f}`);
    for (const w of result.warnings || []) console.log(`warn ${id}: ${w}`);
    for (const e of [...new Set([...errors, ...result.errors])]) console.log(`FAIL ${id}: page error: ${e}`);
    if (Object.keys(result.measures).length) console.log(`     ${id}: ${JSON.stringify(result.measures)}`);
    failed += result.failures.length + new Set([...errors, ...result.errors]).size;
    await page.close();
  }
} finally { await browser.close(); server.close(); }
console.log(`\n${failed ? failed + ' failure(s)' : 'all checks passed'} across ${ids.length} option(s)`);
process.exitCode = failed ? 1 : 0;

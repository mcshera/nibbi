// node design/character-lab/round4/tech.test.mjs <id> [id...] — headless-browser contract checks for round-4 techniques.
import { chromium } from 'playwright';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { listen } from '../serve.mjs';
const dir = fileURLToPath(new URL('./techniques/', import.meta.url));
const ids = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(dir).filter(f => f.endsWith('.mjs') && !f.startsWith('_')).map(f => f.slice(0, -4));
const { server, url } = await listen(0);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = 0;
try {
  for (const id of ids) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 500 }, deviceScaleFactor: 1 });
    const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
    await page.goto(`${url}round4/tech-test.html?id=${id}`);
    await page.waitForFunction(() => window.__result, null, { timeout: 120000 });
    const res = await page.evaluate(() => window.__result);
    for (const c of res.checks) console.log(`ok   ${id}: ${c}`);
    for (const f of res.failures) console.log(`FAIL ${id}: ${f}`);
    for (const e of [...errors, ...res.errors]) console.log(`FAIL ${id}: page error: ${e}`);
    if (res.perf) console.log(`     ${id}: perf ${JSON.stringify(res.perf)}`);
    failed += res.failures.length + errors.length + res.errors.length;
    await page.close();
  }
} finally { await browser.close(); server.close(); }
console.log(`\n${failed ? failed + ' failure(s)' : 'all checks passed'} across ${ids.length} technique(s)`);
process.exitCode = failed ? 1 : 0;

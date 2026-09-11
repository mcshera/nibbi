// Browser checks for the character lab. Starts its own loopback server on an ephemeral port; uses local Chrome (Playwright Chromium in CI).
// Writes evidence/browser-results.json, lab-desktop.png, lab-mobile.png, lab-reduced.png. Exit code 1 on any failed assertion.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { listen } from './serve.mjs';
const out = fileURLToPath(new URL('./evidence/', import.meta.url)); await mkdir(out, { recursive: true });
const { server, url } = await listen(0);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' });
const results = { checks: [], errors: [], warnings: [], environment: 'local Chrome via Playwright, Canvas2D; not a real-device performance benchmark' };
const check = (name, detail = {}) => { results.checks.push({ name, ...detail }); console.log('PASS', name); };
const collect = page => { page.on('pageerror', e => results.errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) results.errors.push(m.text()); else if (m.type() === 'warning') results.warnings.push(m.text()); }); };
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1 }); collect(page);
  await page.goto(url); await page.waitForFunction(() => window.characterLab?.ready, null, { timeout: 20000 }); await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  const ids = await page.evaluate(() => characterLab.options);
  assert.equal(ids.length, 5); check('Five options load in the lab', { ids });
  await page.screenshot({ path: out + 'lab-desktop.png', fullPage: true });

  // 1. geometry sweep: bounds inside the stage, eyes inside the body, all sizes/energies/fractions
  const sweep = await page.evaluate(() => {
    const bad = []; let samples = 0;
    for (const a of characterLab.actions) for (const energy of [.5, 1, 1.5]) for (const f of [0, .12, .25, .38, .45, .6, .7, .85, 1]) {
      const snap = characterLab.seek(a.id, f, { energy });
      for (const o of snap.options) for (const size of ['hero', 'pill', 'tiny']) {
        samples++;
        const g = o.geometry[size], R = { hero: 96, pill: 26, tiny: 12 }[size], st = characterLab.stageForR(R);
        const b = g.bounds; const tol = R * .02;
        if (!(b.left >= -tol && b.top >= -tol && b.right <= st.w + tol && b.bottom <= st.h + tol)) bad.push({ id: o.id, size, action: a.id, f, energy, bounds: b });
        if (g.faceContained === false && o.state.blink < .5) bad.push({ id: o.id, size, action: a.id, f, energy, eyes: 'outside body' });
      }
    }
    return { bad, samples };
  });
  if (sweep.bad.length) { failed = true; console.log('FAIL geometry', JSON.stringify(sweep.bad.slice(0, 5))); results.checks.push({ name: 'geometry sweep', failed: sweep.bad.length, examples: sweep.bad.slice(0, 20) }); }
  else check(`${sweep.samples} poses inside the stage with eyes inside the body (5 options × 9 moments × 3 energies × 9 times × 3 sizes)`, { samples: sweep.samples });

  // helpers in page: ink bbox + pixel signature of a canvas + a difference normalised to the union of the two ink boxes
  await page.evaluate(() => {
    window.__inkBox = canvas => { const ctx = canvas.getContext('2d', { willReadFrequently: true }); const { width: w, height: h } = canvas; const d = ctx.getImageData(0, 0, w, h).data; let l = w, t = h, r = -1, b = -1, n = 0; for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) { const i = (y * w + x) * 4; if (d[i] < 120 && d[i + 1] < 120 && d[i + 2] < 120) { n++; if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y; } } return { l, t, r, b, n }; };
    window.__pixels = canvas => canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
    window.__snap = canvas => ({ w: canvas.width, h: canvas.height, px: canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data, box: window.__inkBox(canvas) });
    window.__diff = (a, b) => { let d = 0; for (let i = 0; i < a.length; i += 4) { d += Math.abs(a[i] - b[i]); } return d / (a.length / 4) / 255; };
    // mean |Δ| over the union of both ink boxes (+2px), so a small avatar on a big paper is not diluted by empty paper
    window.__diffNorm = (A, B) => { const l = Math.max(0, Math.min(A.box.l, B.box.l) - 2), t = Math.max(0, Math.min(A.box.t, B.box.t) - 2), r = Math.min(A.w - 1, Math.max(A.box.r, B.box.r) + 2), b = Math.min(A.h - 1, Math.max(A.box.b, B.box.b) + 2); let d = 0, n = 0; for (let y = t; y <= b; y++) for (let x = l; x <= r; x++) { const i = (y * A.w + x) * 4; d += Math.abs(A.px[i] - B.px[i]); n++; } return n ? d / n / 255 : 0; };
  });

  // 2. reduced motion: pixels identical across time for every option and moment
  const reduced = await page.evaluate(() => {
    const bad = [];
    for (const a of characterLab.actions) {
      characterLab.seek(a.id, .2, { reduced: true, time: 1.3 });
      const first = characterLab.options.map(id => window.__pixels(document.querySelector(`[data-option=${id}] canvas.hero`)));
      characterLab.seek(a.id, .8, { reduced: true, time: 7.9 });
      characterLab.options.forEach((id, i) => { const d = window.__diff(first[i], window.__pixels(document.querySelector(`[data-option=${id}] canvas.hero`))); if (d > 0) bad.push({ id, action: a.id, diff: d }); });
    }
    return bad;
  });
  if (reduced.length) { failed = true; console.log('FAIL reduced motion not static', JSON.stringify(reduced.slice(0, 5))); results.checks.push({ name: 'reduced motion static', failed: reduced }); }
  else check('Reduced motion: every option × moment is pixel-identical across time (no motion, no texture drift)');

  // 3. quiet idle: ink bounding box barely moves between two idle instants (no blink window)
  const idle = await page.evaluate(() => {
    const rows = [];
    characterLab.seek('idle', .05, { time: .3 }); const a = characterLab.options.map(id => window.__inkBox(document.querySelector(`[data-option=${id}] canvas.hero`)));
    characterLab.seek('idle', .5, { time: 3.0 }); characterLab.options.forEach((id, i) => { const b = window.__inkBox(document.querySelector(`[data-option=${id}] canvas.hero`)); rows.push({ id, dx: Math.max(Math.abs(a[i].l - b.l), Math.abs(a[i].r - b.r)), dy: Math.max(Math.abs(a[i].t - b.t), Math.abs(a[i].b - b.b)) }); });
    return rows;
  });
  const noisy = idle.filter(r => r.dx > 8 || r.dy > 8);
  if (noisy.length) { failed = true; console.log('FAIL idle moves', JSON.stringify(noisy)); results.checks.push({ name: 'quiet idle', failed: noisy }); } else check('Quiet idle: hero ink box moves ≤ 8 px between idle instants', { idle });

  // 4. legibility evidence: pairwise difference between the nine signature stills, normalised to the ink area, at 24 px and hero,
  //    in normal and reduced-motion mode. A pair below INDISTINCT reads as the same picture (calibrated on Inkdrop idle/tap before the fix ≈ .03).
  const INDISTINCT = .06;
  const legibility = await page.evaluate((INDISTINCT) => {
    const res = {}; const acts = characterLab.actions.map(a => a.id);
    for (const mode of [{ key: 'tiny', size: 'tiny', reduced: false }, { key: 'hero', size: 'hero', reduced: false }, { key: 'heroReduced', size: 'hero', reduced: true }, { key: 'tinyReduced', size: 'tiny', reduced: true }]) {
      const stills = {};
      for (const a of acts) { stills[a] = characterLab.options.map(id => { characterLab.seekStill(id, a, { reduced: mode.reduced, time: 2.2 }); return window.__snap(document.querySelector(`[data-option=${id}] canvas.${mode.size}`)); }); }
      res[mode.key] = {};
      characterLab.options.forEach((id, i) => {
        const pairs = [];
        for (let p = 0; p < acts.length; p++) for (let q = p + 1; q < acts.length; q++) pairs.push({ pair: `${acts[p]}/${acts[q]}`, diff: window.__diffNorm(stills[acts[p]][i], stills[acts[q]][i]) });
        pairs.sort((x, y) => x.diff - y.diff);
        res[mode.key][id] = { indistinct: pairs.filter(p => p.diff < INDISTINCT).map(p => `${p.pair} ${p.diff.toFixed(3)}`), weakestPairs: pairs.slice(0, 3).map(p => ({ pair: p.pair, diff: Number(p.diff.toFixed(3)) })), medianDiff: Number(pairs[Math.floor(pairs.length / 2)].diff.toFixed(3)), distinctFromIdle: acts.filter(a => a !== 'idle' && pairs.find(p => p.pair === `idle/${a}`).diff >= INDISTINCT).length };
      });
    }
    return res;
  }, INDISTINCT);
  results.legibility = { indistinctThreshold: INDISTINCT, method: 'mean |Δ| over the union of both ink bounding boxes (+2px) of each option’s declared signature still; 36 pairs per option', ...legibility };
  const summary = Object.fromEntries(Object.entries(legibility).map(([mode, byId]) => [mode, Object.fromEntries(Object.entries(byId).map(([id, v]) => [id, `${v.distinctFromIdle}/8 states differ from idle · ${v.indistinct.length} indistinct pairs`]))]));
  console.log(JSON.stringify(summary, null, 1));
  check('Legibility evidence recorded (normalised to ink area) for normal and reduced mode at 24 px and hero', summary);
  // hard rule: in normal mode at hero, every option must separate at least 6 of 8 states from idle
  const weak = Object.entries(legibility.hero).filter(([, v]) => v.distinctFromIdle < 6);
  if (weak.length) { failed = true; console.log('FAIL hero stills too similar to idle', JSON.stringify(weak.map(([id, v]) => [id, v.indistinct]))); results.checks.push({ name: 'hero stills distinct from idle', failed: weak }); }
  else check('Hero signature stills: every option separates ≥ 6 of 8 states from idle');

  // 5. controls: cue buttons, keyboard, pause, scrub, tour button exist and work
  await page.evaluate(() => characterLab.resume());
  await page.click('#actions button[data-action=success]');
  const pressed = await page.getAttribute('#actions button[data-action=success]', 'aria-pressed'); assert.equal(pressed, 'true');
  await page.keyboard.press('4'); assert.equal(await page.getAttribute('#actions button[data-action=think]', 'aria-pressed'), 'true');
  await page.keyboard.press(' '); assert.equal(await page.textContent('#pause'), 'Resume');
  await page.keyboard.press(' ');
  check('Controls: cue buttons, number keys, space pause');
  // reduced screenshot
  await page.evaluate(() => characterLab.setReduced(true)); await page.evaluate(() => characterLab.cue('think')); await page.waitForTimeout(300);
  await page.screenshot({ path: out + 'lab-reduced.png', clip: { x: 0, y: 560, width: 1600, height: 640 } });
  await page.evaluate(() => characterLab.setReduced(false));
  assert.equal(results.errors.length, 0, results.errors.join('\n')); check('No console or page errors');

  // 6. mobile layout
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); collect(mobile);
  await mobile.goto(url); await mobile.waitForFunction(() => window.characterLab?.ready, null, { timeout: 20000 }); await mobile.waitForTimeout(400);
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `horizontal overflow ${overflow}px`);
  const benchSticky = await mobile.evaluate(() => getComputedStyle(document.getElementById('bench')).position);
  assert.equal(benchSticky, 'sticky');
  await mobile.screenshot({ path: out + 'lab-mobile.png', fullPage: true });
  check('Mobile 390 px: no horizontal overflow, sticky cue bar', { overflow });
} catch (error) { failed = true; console.log('FAIL', error.message); results.checks.push({ name: 'exception', error: error.message }); }
finally {
  results.failed = failed; results.errors = [...new Set(results.errors)];
  await writeFile(out + 'browser-results.json', JSON.stringify(results, null, 2));
  await browser.close(); server.close();
  console.log(failed ? 'RESULT: FAILED' : 'RESULT: all browser checks passed');
  process.exitCode = failed ? 1 : 0;
}

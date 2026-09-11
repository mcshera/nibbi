// Contract checks for character-lab option modules. Usage: node design/character-lab/options.test.mjs [id ...]
// Runs without a browser using a strict mock Canvas2D context.
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ACTION_IDS, SIZES } from './actions.mjs';
import { isLoop } from './actions.mjs';

const dir = fileURLToPath(new URL('./options/', import.meta.url));
const ids = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(dir).filter(f => f.endsWith('.mjs') && !f.startsWith('_')).map(f => f.slice(0, -4));
const RIG = ['x', 'lift', 'sx', 'sy', 'rotate', 'eyeX', 'eyeY', 'blink', 'wide', 'happy'];
const NUMERIC_METHODS = new Set(['moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'arc', 'ellipse', 'rect', 'fillRect', 'strokeRect', 'clearRect', 'translate', 'rotate', 'scale', 'transform', 'setTransform', 'arcTo', 'roundRect', 'fillText', 'strokeText', 'setLineDash', 'createLinearGradient', 'createRadialGradient', 'drawImage']);

function mockContext() {
  const stats = { ops: 0, depth: 0, maxDepth: 0, bad: [], cleared: 0, fills: 0 };
  const state = {};
  const ctx = new Proxy({}, {
    get(_, prop) {
      if (prop === '__stats') return stats;
      if (prop === 'save') return () => { stats.depth++; stats.maxDepth = Math.max(stats.maxDepth, stats.depth); };
      if (prop === 'restore') return () => { stats.depth--; if (stats.depth < 0) stats.bad.push('restore without save'); };
      if (prop === 'canvas') return { width: 400, height: 400 };
      if (prop === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient' || prop === 'createPattern') return () => ({ addColorStop() {} });
      if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
      if (prop === 'isPointInPath') return () => false;
      if (typeof prop === 'string' && prop in state) return state[prop];
      return (...args) => {
        stats.ops++;
        if (prop === 'clearRect') stats.cleared++;
        if (prop === 'fill' || prop === 'stroke') stats.fills++;
        if (NUMERIC_METHODS.has(prop)) for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) { stats.bad.push(`${prop}(${args.map(x => typeof x === 'number' ? x.toFixed(2) : String(x)).join(',')})`); break; }
      };
    },
    set(_, prop, value) {
      if (typeof value === 'number' && !Number.isFinite(value)) stats.bad.push(`${String(prop)}=${value}`);
      state[prop] = value; return true;
    },
  });
  return ctx;
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;
let failures = 0, checks = 0;
const fail = (id, msg) => { failures++; console.log(`FAIL ${id}: ${msg}`); };
const ok = (id, msg) => { checks++; console.log(`ok   ${id}: ${msg}`); };

for (const id of ids) {
  let mod;
  try { mod = await import(new URL(`./options/${id}.mjs`, import.meta.url)); } catch (e) { fail(id, `import failed: ${e.message}`); continue; }
  const { meta, durationFor, sample, render, geometry } = mod;
  if (!meta || meta.id !== id) fail(id, `meta.id must equal '${id}'`); else ok(id, `meta ${meta.name} — ${meta.tagline}`);
  for (const k of ['name', 'tagline', 'material', 'grammar', 'feeling']) if (!meta?.[k]) fail(id, `meta.${k} missing`);
  if (!Array.isArray(meta?.risks) || !meta.risks.length) fail(id, 'meta.risks must list at least one risk');
  let durOk = true;
  for (const a of ACTION_IDS) { const d = durationFor(a); if (!(Number.isFinite(d) && d > .2 && d <= 12)) { durOk = false; fail(id, `durationFor(${a}) = ${d} (expect .2..12 s)`); } }
  if (durOk) ok(id, 'durations sane');
  // sampling
  const problems = [];
  let idleMotion = 0;
  for (const a of ACTION_IDS) {
    const d = durationFor(a);
    for (const energy of [.5, 1, 1.5]) for (let i = 0; i <= 24; i++) {
      const t = d * i / 24; let s;
      try { s = sample(a, t, { energy }); } catch (e) { problems.push(`${a}@${t.toFixed(2)} threw ${e.message}`); continue; }
      for (const k of RIG) if (!Number.isFinite(s?.[k])) problems.push(`${a}@${t.toFixed(2)} e${energy}: ${k}=${s?.[k]}`);
      if (typeof s?.phase !== 'string') problems.push(`${a}: phase must be a string`);
      if (s && Number.isFinite(s.x) && Math.abs(s.x) > .9) problems.push(`${a}@${t.toFixed(2)}: |x|=${s.x.toFixed(2)} > .9`);
      if (s && (s.lift < -.05 || s.lift > 1.1)) problems.push(`${a}@${t.toFixed(2)}: lift=${s.lift.toFixed(2)}`);
      if (s && (s.sx < .5 || s.sx > 1.6 || s.sy < .5 || s.sy > 1.6)) problems.push(`${a}@${t.toFixed(2)}: scale ${s.sx.toFixed(2)}×${s.sy.toFixed(2)}`);
      if (s && Math.abs(s.rotate) > .6) problems.push(`${a}@${t.toFixed(2)}: rotate=${s.rotate.toFixed(2)}`);
      if (a === 'idle' && s) idleMotion = Math.max(idleMotion, Math.abs(s.x), Math.abs(s.lift));
      try { JSON.stringify(s); } catch { problems.push(`${a}: state not JSON-safe`); }
    }
    if (isLoop(a)) {
      const s0 = sample(a, 0), s1 = sample(a, d);
      for (const k of RIG) if (!near(s0[k], s1[k], k === 'blink' ? .35 : .06)) problems.push(`${a} loop discontinuity: ${k} ${s0[k].toFixed(3)} → ${s1[k].toFixed(3)}`);
    }
    // reduced must be static
    const r0 = sample(a, 0, { reduced: true }), r1 = sample(a, d * .37, { reduced: true }), r2 = sample(a, d * .81, { reduced: true });
    if (JSON.stringify(r0) !== JSON.stringify(r1) || JSON.stringify(r1) !== JSON.stringify(r2)) problems.push(`${a}: reduced state changes over time`);
  }
  if (idleMotion > .025) problems.push(`idle moves ${idleMotion.toFixed(3)}R (max .02R)`);
  // input mutation
  const opts = Object.freeze({ energy: 1, reduced: false }); try { sample('hello', .3, opts); } catch (e) { problems.push('mutates options: ' + e.message); }
  if (problems.length) { for (const p of problems.slice(0, 12)) fail(id, p); if (problems.length > 12) fail(id, `…and ${problems.length - 12} more sampling problems`); } else ok(id, `sampling: ${ACTION_IDS.length} actions × 3 energies × 25 samples finite, bounded, loops continuous, reduced static`);
  // rendering with mock ctx
  const rproblems = []; let maxOps = 0;
  for (const size of SIZES) for (const a of ACTION_IDS) for (const frac of [0, .25, .45, .7, 1]) for (const reduced of [false, true]) {
    const s = sample(a, durationFor(a) * frac, { energy: 1.2, reduced });
    const ctx = mockContext();
    const R = size.R, footX = R * 1.7, footY = R * 3.1;
    try { render(ctx, s, { R, footX, footY, time: 3.7, reduced, tint: frac === .7 ? '#7a4b2a' : null, size: size.id }); }
    catch (e) { rproblems.push(`render ${size.id}/${a}@${frac} threw ${e.stack?.split('\n').slice(0, 2).join(' | ')}`); continue; }
    const st = ctx.__stats;
    if (st.depth !== 0) rproblems.push(`render ${size.id}/${a}@${frac}: save/restore unbalanced (${st.depth})`);
    if (st.bad.length) rproblems.push(`render ${size.id}/${a}@${frac}: non-finite ${st.bad[0]}`);
    if (st.cleared) rproblems.push(`render ${size.id}/${a}@${frac}: must not clearRect (lab paints paper)`);
    if (st.fills === 0) rproblems.push(`render ${size.id}/${a}@${frac}: drew nothing`);
    if (size.id === 'hero') maxOps = Math.max(maxOps, st.ops);
    let g; try { g = geometry(s, { R, footX, footY }); } catch (e) { rproblems.push(`geometry ${a} threw ${e.message}`); continue; }
    const b = g?.bounds; if (!b || ![b.left, b.top, b.right, b.bottom].every(Number.isFinite)) rproblems.push(`geometry ${a}: bounds not finite`);
    else { const stage = { l: footX - 1.7 * R, r: footX + 1.7 * R, t: footY - 3.1 * R, b: footY + .5 * R }; if (b.left < stage.l || b.right > stage.r || b.top < stage.t || b.bottom > stage.b) rproblems.push(`geometry ${size.id}/${a}@${frac}: body leaves the stage ${JSON.stringify(b)}`); }
    if (!Array.isArray(g?.eyes) || g.eyes.length !== 2) rproblems.push(`geometry ${a}: eyes must be 2`);
    else if (!reduced && s.blink < .5 && g.faceContained === false) rproblems.push(`geometry ${size.id}/${a}@${frac}: eyes leave the body`);
  }
  if (rproblems.length) { for (const p of rproblems.slice(0, 12)) fail(id, p); if (rproblems.length > 12) fail(id, `…and ${rproblems.length - 12} more render problems`); } else ok(id, `render: 3 sizes × 9 actions × 5 times × reduced/normal draw, balanced, finite; max hero ops ${maxOps}`);
  if (maxOps > 1400) fail(id, `hero render is heavy: ${maxOps} ctx ops (aim ≤ ~600)`);
}
console.log(`\n${checks} ok, ${failures} failed across ${ids.length} option(s)`);
process.exitCode = failures ? 1 : 0;

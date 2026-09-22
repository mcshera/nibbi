// The ink ramp is derived, not picked. This recomputes it from public/tokens.css and
// fails if a step stops clearing its band, so the ramp cannot drift back into hand-picked
// values. No dependencies. See design/LANGUAGE.md 2.5.
//
//   node tools/contrast-verify.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const css = readFileSync(root + 'public/tokens.css', 'utf8');

// ---------- APCA (SAPC 0.1.9) ----------
const apcaY = ([r, g, b]) => {
  const y = 0.2126729 * (r / 255) ** 2.4 + 0.7151522 * (g / 255) ** 2.4 + 0.0721750 * (b / 255) ** 2.4;
  return y < 0.022 ? y + (0.022 - y) ** 1.414 : y;
};
const apca = (txt, bg) => {
  const Yt = apcaY(txt), Yb = apcaY(bg);
  if (Math.abs(Yb - Yt) < 0.0005) return 0;
  const s = Yb > Yt ? (Yb ** 0.56 - Yt ** 0.57) * 1.14 : (Yb ** 0.65 - Yt ** 0.62) * 1.14;
  const out = Yb > Yt ? (s < 0.1 ? 0 : s - 0.027) : (s > -0.1 ? 0 : s + 0.027);
  return Math.abs(out * 100);
};

// ---------- reading the tokens ----------
const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const token = name => {
  const m = css.match(new RegExp(`^\\s*--${name}:\\s*([^;]+);`, 'm'));
  assert.ok(m, `tokens.css declares --${name}`);
  return m[1].trim();
};
const rgbToken = name => {
  const v = token(name);
  const hex = v.match(/^#[0-9a-f]{6}$/i);
  if (hex) return hex2rgb(v);
  const rgba = v.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)/i);
  assert.ok(rgba, `--${name} is a colour, got ${v}`);
  return { rgb: [1, 2, 3].map(i => +rgba[i]), alpha: rgba[4] === undefined ? 1 : +rgba[4] };
};
// the alpha a token carries inside the body.glass block, not in :root
const glassToken = name => {
  const block = css.match(/body\.glass\s*\{([\s\S]*?)\n\}/);
  assert.ok(block, 'tokens.css has a body.glass block');
  const m = block[1].match(new RegExp(`--${name}:\\s*rgba\\(\\s*(\\d+)[,\\s]+(\\d+)[,\\s]+(\\d+)[,\\s]+([\\d.]+)\\s*\\)`));
  assert.ok(m, `body.glass declares --${name}`);
  return { rgb: [1, 2, 3].map(i => +m[i]), alpha: +m[4] };
};
const over = ({ rgb, alpha }, bg) => rgb.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));

// ---------- the contract ----------
const RAMP = ['ink', 'ink-2', 'ink-3', 'ink-4'].map(n => ({ name: '--' + n, rgb: rgbToken(n) }));

// APCA bands. Opaque surfaces carry the full budget; the glass shell is deliberately
// translucent and buys that with exactly one band, which is why it is stated here.
const OPAQUE_BANDS = { '--ink': 90, '--ink-2': 75, '--ink-3': 65, '--ink-4': 45 };
const GLASS_BANDS = { '--ink': 75, '--ink-2': 65, '--ink-3': 55, '--ink-4': 35 };

const BLACK_DESKTOP = [0, 0, 0];   // the worst case the glass budget is measured against
const surfaces = [
  { label: 'page', bg: hex2rgb(token('paper')), bands: OPAQUE_BANDS },
  { label: 'raised', bg: hex2rgb(token('paper-raised')), bands: OPAQUE_BANDS },
  { label: 'sunken', bg: hex2rgb(token('paper-sunken')), bands: OPAQUE_BANDS },
  { label: 'bar', bg: hex2rgb(token('paper-bar')), bands: OPAQUE_BANDS },
  { label: 'glass paper', bg: over(glassToken('paper'), BLACK_DESKTOP), bands: GLASS_BANDS },
  { label: 'glass pill', bg: over(glassToken('pill-bg'), BLACK_DESKTOP), bands: GLASS_BANDS },
  { label: 'glass chip', bg: over(glassToken('chip-bg'), BLACK_DESKTOP), bands: GLASS_BANDS },
];

const failures = [];
console.log('surface'.padEnd(14) + RAMP.map(r => r.name.padEnd(10)).join(''));
for (const s of surfaces) {
  const cells = RAMP.map(r => {
    const lc = apca(r.rgb, s.bg), band = s.bands[r.name];
    if (lc < band) failures.push(`${r.name} on ${s.label}: Lc ${lc.toFixed(0)}, band ${band}`);
    return (`Lc ${lc.toFixed(0)}` + (lc < band ? ' FAIL' : '')).padEnd(10);
  }).join('');
  console.log(s.label.padEnd(14) + cells);
}

// the ramp must stay a ramp: no fork may reintroduce --ink-3 outside :root
const forks = [...css.matchAll(/^\s*--ink(?:-[234])?:/gm)].length;
assert.equal(forks, 4, `the ink ramp is declared once, in :root (found ${forks} declarations)`);

// and a glass surface that carries text must not drop below the alpha the budget needs
for (const name of ['paper', 'pill-bg', 'chip-bg']) {
  const { alpha } = glassToken(name);
  assert.ok(alpha >= 0.86, `body.glass --${name} alpha ${alpha} is below the .86 the budget needs`);
}

if (failures.length) { console.error('\nFAIL\n' + failures.join('\n')); process.exit(1); }
console.log('\nContrast checks passed: one ink ramp, every step clear of its band on all seven surfaces.');

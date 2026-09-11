/* Round-4 technique: SANDPILE. Nibbi is a pile of ink grains (falling-sand cellular automaton) held in an invisible mould shaped
 * like the silhouette. Cues move, tilt, shrink or open the mould, or fling grains into flight; everything else (slumping, showers,
 * craters refilling, the vacuum back into shape) is the sand rules. Eyes are wall cells the grains cannot enter. */
import * as ink from '../../ink.mjs';
import { ACTION_IDS } from '../../actions.mjs';
const { clamp, mix, TAU, EYES } = ink;

export const meta = {
  id: 'sand', name: 'Sandpile',
  technique: 'falling-sand cellular automaton: ~3k ink grains in an invisible silhouette mould, plus in-flight grains that re-enter the grid',
  tagline: 'A heap of ink sand that leans, boils, collapses and is vacuumed back into shape.',
  look: 'A squat pile of two-tone ink grains with a crisp granular edge (grid pitch R/28 at hero, coarser at pill and tiny, 2–3 sand substeps per frame); two paper holes for eyes with a pinned cluster of grains as pupils.',
  motion: 'The mould only sets a target; the grains have to get there by falling, slumping and showering. Nothing lands the same way twice, collapses spread like real sand and every refill trickles.',
  eyes: 'Two eye regions are wall cells that stay paper; the pupil is a pinned cluster of ink grains that shifts with gaze; sleep closes each region from both sides to a paper slit.',
  fun: ['press and drag: a finger-sized wall ploughs through the pile, grains spill over the top and flow back on release', 'tap: a dent in the crown at the touch, grains spray out and the dent fills back in', 'error: the mould opens and the whole body collapses into a heap, then is vacuumed back up grain by grain', 'success: a fountain of hundreds of grains erupts to over a body-height and showers back; listen: the body slides and tilts toward you'],
  risks: ['grains are invisible inside a solid pile, so only the surface and flights carry motion', 'at pill size the grid is coarse and the pupils are 2 cells', 'eyes are walls: sand behaves oddly when the face sinks through it', 'stills are emergent, timing is approximate'],
  stills: { idle: 2.0, hello: .4, listen: 1.2, think: 1.4, work: 1.6, success: .7, error: .9, sleep: 2.0, tap: .25 },
};

const ONE_SHOT = { hello: 1.5, success: 1.9, error: 3.3, tap: 1.0 }, REDUCED_HOLD = 3;
const NP = 256, PROF = new Float32Array(NP), UP = new Float32Array(NP);
for (let k = 0; k < NP; k++) { const a = k / NP * TAU; PROF[k] = ink.baseProfile(a); UP[k] = Math.max(0, -Math.sin(a)); }
const EMPTY = 0, WALL = 1, EYE = 2;   // wall grid values; sand grid: 0 empty, 1 / 2 two ink tones
const KEYS = ['sx', 'sy', 'lean', 'drop', 'lift', 'faceY', 'faceX', 'lid', 'rot', 'shift', 'orb'];

export function mount(host, { R = 96, seed = 1, tint = null, reduced = false, energy = 1, size = 'hero', paper = true } = {}) {
  const W = Math.round(3.4 * R), H = Math.round(3.6 * R), footX = 1.7 * R, footY = 3.1 * R;
  host.style.width = W + 'px'; host.style.height = H + 'px'; host.style.position = 'relative';
  const dpr = Math.min(2, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1));
  const canvas = document.createElement('canvas'); canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.cssText = `display:block;width:${W}px;height:${H}px;touch-action:none`;
  host.appendChild(canvas); const ctx = canvas.getContext('2d');
  const hero = size === 'hero', tiny = size === 'tiny';
  // --- grid -----------------------------------------------------------------------------------------
  const CPR = hero ? 28 : tiny ? 8 : 14, pitch = R / CPR, SUB = hero ? 3 : 2, scale = hero ? 1 : tiny ? .12 : .3;
  const cols = Math.ceil(3.4 * CPR), rows = Math.ceil(3.6 * CPR), floorRow = Math.round(3.1 * CPR), N = cols * rows;
  const bx = 1.7 * CPR;
  const sand = new Uint8Array(N), wall = new Uint8Array(N), ceil = new Int16Array(cols);
  const off = document.createElement('canvas'); off.width = cols; off.height = rows; const octx = off.getContext('2d'); const img = octx.createImageData(cols, rows), px = img.data;
  const RT = new Float32Array(4096); for (let i = 0; i < 4096; i++) RT[i] = ink.rand(seed, i);   // deterministic random table
  let rc = 0; const rnd = () => RT[(rc = (rc + 1) & 4095)];
  const cellRnd = (x, y, f) => RT[(x * 7 + y * 131 + f * 1543) & 4095];
  // --- state ----------------------------------------------------------------------------------------
  const st = { reduced, energy, tint };
  let action = 'idle', tAction = 0, time = 0, frame = 0, tick = 0, bank = 0, lastKey = '', pressed = null, fly = [], trickleT = 0, dusted = false, orbPhase = 0;
  const M = { sx: 1, sy: 1, lean: 0, drop: 0, lift: 0, faceY: 0, faceX: 0, open: 0, lid: 0, rot: 0, shift: 0, orb: 0 };
  const gaze = { x: 0, y: 0 };
  let liftCells = 0, shiftCells = 0, tilt = 0, slump = 0;
  function targetsFor(a) {
    const t = { sx: 1, sy: 1, lean: 0, drop: 0, lift: 0, faceY: 0, faceX: 0, open: 0, lid: 0, rot: 0, shift: 0, orb: 0, gx: 0, gy: 0, tilt: 0, slump: 0 };
    if (a === 'listen') { t.shift = -.12; t.rot = .16; t.lean = -.12; t.gx = -.9; t.tilt = -.6; }
    if (a === 'think') { t.lean = -.05; t.drop = .2; t.gx = -.8; t.gy = -.8; t.orb = 1; }
    if (a === 'work') { const w = Math.sin(time * TAU / 2); t.sy = .94; t.sx = 1.05; t.gy = .9; t.tilt = .32 * w; t.lean = .1 * w; }
    if (a === 'success') { t.gy = -.35; t.sy = tAction < .35 ? 1.07 : 1; }
    if (a === 'error') { if (tiny) { t.sx = 1.35; t.sy = .5; t.faceY = .05; } else { t.open = tAction < 1.6 ? 1 : 0; t.faceY = .42; t.slump = tAction < 1.6 ? .35 : 0; t.sy = .9; t.sx = 1.08; } t.gy = .95; t.gx = .1; }
    if (a === 'sleep') { t.sx = 1.24; t.sy = .62; t.lid = 1; t.gy = .3; }
    if (a === 'hello') { t.lean = .1; t.gy = -.15; }
    if (a === 'tap') { t.gy = -.2; }
    return t;
  }
  // --- mould ----------------------------------------------------------------------------------------
  const footCX = () => bx + M.shift * CPR;
  const toWorld = (lx, ly) => { const c = Math.cos(M.rot), s = Math.sin(M.rot); return { x: footCX() + lx * c + ly * s, y: floorRow - lx * s + ly * c }; };   // local (about the foot, y up = negative) → grid
  const mcy = () => -(.86 * M.sy + M.lift) * CPR;                          // mould centre (local): the profile bottom stays on the floor
  const eyeC = i => { const w = toWorld((EYES[i].x * M.sx + M.faceX) * CPR, mcy() + (EYES[i].y * M.sy + M.faceY) * CPR); return { x: w.x, y: w.y, rx: EYES[i].rx * CPR * .98, ry: EYES[i].ry * CPR, prx: EYES[i].prx * CPR, pry: EYES[i].pry * CPR }; };
  const crown = () => toWorld((M.lean * .9 + M.faceX) * CPR, mcy() - 1.05 * M.sy * CPR);
  function inside(x, y) {                          // is cell centre (x, y) inside the mould?
    const c = Math.cos(M.rot), s = Math.sin(M.rot), wx = x + .5 - footCX(), wy = y + .5 - floorRow, px = wx * c - wy * s, py = wx * s + wy * c;
    let ly = (py - mcy()) / M.sy, lx = px / M.sx;
    lx -= M.lean * CPR * ink.smooth(.1, 1, -ly / CPR) * .9;
    const d = Math.hypot(lx, ly); if (d > 1.3 * CPR) return false;
    const k = Math.round(Math.atan2(ly, lx) / TAU * NP) & (NP - 1);
    let r = PROF[k]; const u = UP[k]; r += M.drop * (.55 * u ** 6 - .08 * (1 - u));
    return d < r * CPR;
  }
  function rebuild() {
    const es = [eyeC(0), eyeC(1)];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      let w = y >= floorRow ? WALL : (M.open > .5 || inside(x, y)) ? EMPTY : WALL;
      if (w === EMPTY) for (const e of es) { const dx = (x + .5 - e.x) / e.rx, dy = (y + .5 - e.y) / e.ry; if (dx * dx + dy * dy < 1) w = EYE; }
      wall[y * cols + x] = w;
    }
    for (let x = 0; x < cols; x++) { ceil[x] = -1; for (let y = 0; y < rows; y++) if (wall[y * cols + x] === EMPTY) { ceil[x] = y; break; } }
  }
  function squeeze(flyBudget, sinkBudget) {        // grains caught in walls leave the grid: some fly to the crown (vacuum), some sink into the bank (top rows first); the rest wait
    for (let i = 0; i < N; i++) if (sand[i] && wall[i]) {
      if (flyBudget > 0 && !st.reduced && M.open < .5 && fly.length < 1200) { const tx = pickCol(); if (tx >= 0) { flyBudget--; fly.push({ x: (i % cols) + .5, y: (i / cols | 0) + .5, vx: 0, vy: 0, t: sand[i], h: 1, tx: tx + .5, ty: ceil[tx] + .5 }); sand[i] = 0; continue; } }
      if (sinkBudget > 0 || M.open > .5 || st.reduced) { sinkBudget--; sand[i] = 0; bank++; }
    }
  }
  function pickCol() { for (let k = 0; k < 6; k++) { const x = (rnd() * cols) | 0; if (ceil[x] >= 0) return x; } return -1; }
  function place(x, tone) {                        // put a grain on top of the pile in column x (scan up from the floor); false if the column is full
    for (let y = floorRow - 1; y >= 0; y--) { const i = y * cols + x; if (wall[i]) { if (wall[i] === WALL && y < ceil[x]) break; continue; } if (!sand[i]) { sand[i] = tone; return true; } }
    return false;
  }
  function pump(n) { for (let k = 0; k < n && bank > 0; k++) { const x = pickCol(); if (x >= 0 && place(x, 1 + (rnd() < .3 ? 1 : 0))) bank--; else if (x < 0) break; } }
  function fill() { for (let i = 0; i < N; i++) sand[i] = wall[i] ? 0 : 1 + (RT[i & 4095] < .3 ? 1 : 0); bank = 0; fly = []; }
  function shiftGrid(dy) {                         // the whole pile rides with the mould (hop)
    if (dy < 0) { sand.copyWithin(0, -dy * cols); sand.fill(0, N + dy * cols); } else if (dy > 0) { sand.copyWithin(dy * cols, 0, N - dy * cols); sand.fill(0, 0, dy * cols); }
  }
  function shiftGridX(dx) {                        // the whole pile slides with the mould (listen)
    for (let y = 0; y < rows; y++) { const r0 = y * cols; if (dx > 0) { sand.copyWithin(r0 + dx, r0, r0 + cols - dx); sand.fill(0, r0, r0 + dx); } else if (dx < 0) { sand.copyWithin(r0, r0 - dx, r0 + cols); sand.fill(0, r0 + cols + dx, r0 + cols); } }
  }
  // --- sand rules -----------------------------------------------------------------------------------
  const free = (x, y) => x >= 0 && x < cols && y >= 0 && y < rows && !wall[y * cols + x] && !sand[y * cols + x];
  function substep() {
    frame++; const rev = frame & 1, sl = slump + Math.abs(tilt) * .25;
    for (let y = rows - 2; y >= 0; y--) for (let xi = 0; xi < cols; xi++) {
      const x = rev ? cols - 1 - xi : xi, i = y * cols + x, c = sand[i]; if (!c) continue;
      const r = cellRnd(x, y, frame);
      if (free(x, y + 1)) { sand[i] = 0; sand[i + cols] = c; continue; }
      const s = r < .5 + tilt * .45 ? -1 : 1;
      if (free(x + s, y + 1)) { sand[i] = 0; sand[i + cols + s] = c; continue; }
      if (free(x - s, y + 1)) { sand[i] = 0; sand[i + cols - s] = c; continue; }
      if (sl > 0 && cellRnd(x, y, frame + 77) < sl) { const d = tilt ? (tilt < 0 ? -1 : 1) : s; if (free(x + d, y)) { sand[i] = 0; sand[i + d] = c; } }
    }
  }
  function launch(x, y, vx, vy, b = 0) { const i = y * cols + x; if (!sand[i] || fly.length > 1200) return; fly.push({ x: x + .5, y: y + .5, vx, vy, t: sand[i], h: 0, b }); sand[i] = 0; }
  function flyStep(dt) {
    const G = 9 * CPR, keep = [];
    for (const p of fly) {
      if (p.h) { const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy), sp = 6 * CPR * dt; if (d < sp) { keep.push({ x: p.tx, y: p.ty, vx: 0, vy: 0, t: p.t, h: 0, b: 1 }); continue; } p.x += dx / d * sp; p.y += dy / d * sp; keep.push(p); continue; }
      p.vy += G * dt; let nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;
      if (nx < .5 || nx >= cols - .5) { p.vx *= -.5; nx = clamp(nx, .5, cols - .51); }
      if (ny < .5) { ny = .5; p.vy = Math.abs(p.vy) * .3; }
      const ix = nx | 0, iy = ny | 0;
      if (iy >= floorRow || wall[iy * cols + ix] === EYE || sand[iy * cols + ix]) {
        if (p.vy > 2.2 * CPR && p.b < 1 && rnd() < .6) { p.b++; p.vy = -p.vy * .35; p.vx += (rnd() - .5) * 2 * CPR; keep.push(p); continue; }
        let lx = p.x | 0, ly = p.y | 0, ok = false;
        for (let k = 0; k < 8 && ly - k >= 0; k++) if (free(lx, ly - k)) { sand[(ly - k) * cols + lx] = p.t; ok = true; break; }
        if (!ok) bank++;
      } else { p.x = nx; p.y = ny; keep.push(p); }
    }
    fly = keep;
  }
  function fountain(n, v, spread, b = 0) {         // take n grains from the top of the pile near the crown and throw them up
    const cx = crown().x;
    for (let k = 0; k < n; k++) { const x = clamp(Math.round(cx + (rnd() - .5) * spread * CPR), 0, cols - 1); for (let y = 0; y < floorRow; y++) if (sand[y * cols + x]) { launch(x, y, (rnd() - .5) * 1.6 * CPR, -v * CPR * (.7 + rnd() * .4), b); break; } }
  }
  function crater(cx, cy, rad, v) {                // dig a dent at the surface of the pile above (cx, cy): grains spray up and out
    const xc = clamp(cx | 0, 0, cols - 1); for (let y = 0; y < floorRow; y++) if (sand[y * cols + xc]) { cy = Math.min(cy, y + rad * .35); break; }
    const r2 = rad * rad; let n = 0;
    for (let y = Math.max(0, cy - rad | 0); y < Math.min(rows, cy + rad + 1 | 0); y++) for (let x = Math.max(0, cx - rad | 0); x < Math.min(cols, cx + rad + 1 | 0); x++) {
      const dx = x + .5 - cx, dy = y + .5 - cy, d2 = dx * dx + dy * dy; if (d2 > r2 || !sand[y * cols + x] || n > 400) continue;
      const d = Math.sqrt(d2) + .5, f = v * CPR * (.4 + rnd() * .6); launch(x, y, dx / d * f, dy / d * f - 1.6 * CPR, 1); n++;
    }
  }
  function plough(cx, cy, rad) {                   // finger wall: push grains out of a disk to the nearest free cell outward
    for (let y = Math.max(0, cy - rad | 0); y < Math.min(rows, cy + rad + 1 | 0); y++) for (let x = Math.max(0, cx - rad | 0); x < Math.min(cols, cx + rad + 1 | 0); x++) {
      const dx = x + .5 - cx, dy = y + .5 - cy; if (dx * dx + dy * dy > rad * rad) continue; const i = y * cols + x; if (!sand[i]) continue;
      const d = Math.hypot(dx, dy) + .01, ux = dx / d, uy = dy / d; let done = false;
      for (let k = rad; k < rad + 5 && !done; k++) { const nx = Math.round(cx + ux * k - .5), ny = Math.round(cy + uy * k - .5); if (free(nx, ny)) { sand[ny * cols + nx] = sand[i]; done = true; } }
      if (!done) { if (fly.length < 1200) fly.push({ x: x + .5, y: y + .5, vx: ux * 2 * CPR, vy: -3 * CPR + uy * CPR, t: sand[i], h: 0, b: 1 }); else bank++; }
      sand[i] = 0;
    }
  }
  function takeFloor(n) { let k = 0; for (let t = 0; t < n * 4 && k < n; t++) { const x = (rnd() * cols) | 0, i = (floorRow - 1) * cols + x; if (sand[i]) { sand[i] = 0; bank++; k++; } } return k; }
  // --- control --------------------------------------------------------------------------------------
  function relax() {                               // reduced motion: mould at its target, filled with a fixed grain pattern, settled dust on the crown for the bursts
    const t = targetsFor(action); for (const k in M) M[k] = t[k]; gaze.x = t.gx; gaze.y = t.gy;
    if (action === 'error') { M.open = 0; M.sx = 1.4; M.sy = .56; M.faceY = .06; }
    if (action === 'hello') M.lift = .12;
    if (action === 'work') { M.lean = -.1; }
    rebuild(); fill();
    if (action === 'success' || action === 'hello' || action === 'tap') {
      const c = crown(), sp = action === 'success' ? 1.1 : .7, p = action === 'success' ? .55 : .3;
      if (action === 'tap') for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) { const dx = x + .5 - c.x, dy = y + .5 - (c.y + .05 * CPR); if (dx * dx + dy * dy < .16 * CPR * CPR) sand[y * cols + x] = 0; }   // the dent
      for (let x = 0; x < cols; x++) { const dx = Math.abs(x + .5 - c.x) / (sp * CPR); if (dx >= 1 || ceil[x] < 1) continue; let y = ceil[x]; while (y < floorRow && !sand[y * cols + x]) y++; for (let k = 1; k <= 2; k++) if (y - k >= 0 && RT[(x * 13 + k * 29) & 4095] < p * (1 - dx) / k) sand[(y - k) * cols + x] = 1; }
    }
  }
  const ctl = {
    cue(a) {
      if (!ACTION_IDS.includes(a)) return;
      action = a; tAction = 0; pressed = null; dusted = false;
      if (st.reduced) { relax(); return; }
      const e = st.energy;
      if (a === 'success') fountain(Math.round(150 * Math.max(scale, .15)), 4.8 * e, .9);
      if (a === 'tap') { const c = crown(); crater(c.x, c.y, .22 * CPR, 2.2 * e); }
    },
    step(dt) {
      dt = clamp(dt, 0, .1); if (dt <= 0) { draw(); return; }
      time += dt; tAction += dt; tick++;
      if (ONE_SHOT[action] && tAction > (st.reduced ? REDUCED_HOLD : ONE_SHOT[action])) { action = 'idle'; tAction = 0; if (st.reduced) relax(); }
      if (st.reduced) { draw(); return; }
      orbPhase += dt;
      const t = targetsFor(action), e = st.energy;
      if (action === 'hello') { const u = (tAction - .15) / .5; t.lift = u > 0 && u < 1 ? .35 * e * 4 * u * (1 - u) : 0; if (tAction >= .15 && !dusted) { dusted = true; fountain(Math.round(30 * Math.max(scale, .2)), 1.8 * e, 1.6, 1); } }
      if (pressed) { t.gy = .6; t.gx = clamp((pressed.x - bx) / CPR, -1, 1) * .7; }
      const k = 1 - Math.exp(-dt * (action === 'hello' ? 60 : 7));
      for (const key of KEYS) M[key] = mix(M[key], t[key], k);
      M.open = t.open; tilt = mix(tilt, t.tilt, k); slump = t.slump; gaze.x = mix(gaze.x, t.gx, k); gaze.y = mix(gaze.y, t.gy, k);
      const lc = Math.round(M.lift * CPR); if (lc !== liftCells) { shiftGrid(liftCells - lc); liftCells = lc; }
      const sc = Math.round(M.shift * CPR); if (sc !== shiftCells) { shiftGridX(sc - shiftCells); shiftCells = sc; }
      const key = [M.sx, M.sy, M.lean, M.drop, lc, sc, M.faceY, M.faceX, M.open, M.rot].map(v => Math.round(v * 200)).join(',');
      if (key !== lastKey) { lastKey = key; rebuild(); }
      if (action === 'sleep') squeeze(0, hero ? 40 : 12); else if (action === 'work') squeeze(tick % 3 ? 0 : 1, 0); else squeeze(hero ? 70 : 25, 0);
      // per-moment sand work
      if (action === 'error' && tAction >= 1.6 && !tiny) pump(6); else if (action !== 'sleep') pump(hero ? 60 : 20);
      if (action === 'success' && tAction < .35) fountain(Math.round(12 * Math.max(scale, .2) * e), 4.5 * e, 1.3);
      if (action === 'idle' || action === 'sleep') { trickleT += dt; if (trickleT > (action === 'sleep' ? 2.6 : .8)) { trickleT = 0; if (takeFloor(1)) { bank--; const c = crown(), x = clamp(Math.round(c.x + (rnd() - .5) * CPR), 0, cols - 1); fly.push({ x: x + .5, y: Math.max(1, ceil[x] - 1.5), vx: 0, vy: .5 * CPR, t: 1, h: 0, b: 1 }); } } }
      if (pressed) plough(pressed.x, pressed.y, .2 * CPR + 1);
      for (let s = 0; s < SUB; s++) substep();
      flyStep(dt);
      draw();
    },
    setReduced(v) { st.reduced = !!v; if (st.reduced) relax(); else lastKey = ''; },
    setEnergy(e) { st.energy = clamp(e, .5, 1.5); }, setTint(c) { st.tint = c; },
    poke(x, y, kind) {
      const cx = x / pitch, cy = y / pitch;
      if (kind === 'down') { if (ONE_SHOT[action]) { action = 'idle'; tAction = 0; } pressed = { x: cx, y: cy }; }
      if (kind === 'move' && pressed) pressed = { x: cx, y: cy };
      if (kind === 'up') pressed = null;
      if (kind === 'tap') { action = 'tap'; tAction = 0; if (st.reduced) { relax(); return; } crater(cx, cy, .22 * CPR, 2.2 * st.energy); }
    },
    destroy() { for (const [ev, fn] of listeners) host.removeEventListener(ev, fn); canvas.remove(); },
  };
  const listeners = [['pointerdown', e => ctl.poke(e.offsetX, e.offsetY, 'down')], ['pointermove', e => ctl.poke(e.offsetX, e.offsetY, 'move')], ['pointerup', e => ctl.poke(e.offsetX, e.offsetY, 'up')], ['pointerleave', e => ctl.poke(e.offsetX, e.offsetY, 'up')]];
  for (const [ev, fn] of listeners) host.addEventListener(ev, fn);
  // --- draw -----------------------------------------------------------------------------------------
  let rgbKey = null, rgb = [22, 21, 20];
  function inkRGB(c) { if (c === rgbKey) return rgb; rgbKey = c; ctx.fillStyle = ink.inkColor(c); const s = ctx.fillStyle; const m = /^#([0-9a-f]{6})/i.exec(s); rgb = m ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)] : (s.match(/\d+/g) || [22, 21, 20]).slice(0, 3).map(Number); return rgb; }
  function dot(x, y, r, g, b, big) { for (let yy = y | 0; yy <= (y | 0) + (big ? 1 : 0); yy++) for (let xx = x | 0; xx <= (x | 0) + (big ? 1 : 0); xx++) { if (xx < 0 || xx >= cols || yy < 0 || yy >= rows) continue; const j = (yy * cols + xx) * 4; px[j] = r; px[j + 1] = g; px[j + 2] = b; px[j + 3] = 255; } }
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (paper) ink.paper(ctx, W, H, { grain: 0 }); else ctx.clearRect(0, 0, W, H);
    const [r, g, b] = inkRGB(st.tint), r2 = mix(r, 243, .16), g2 = mix(g, 240, .16), b2 = mix(b, 234, .16);
    for (let i = 0, j = 0; i < N; i++, j += 4) { const c = sand[i]; if (c === 1) { px[j] = r; px[j + 1] = g; px[j + 2] = b; px[j + 3] = 255; } else if (c === 2) { px[j] = r2; px[j + 1] = g2; px[j + 2] = b2; px[j + 3] = 255; } else px[j + 3] = 0; }
    for (const p of fly) dot(p.x, p.y, r, g, b, false);
    if (M.orb > .05) {                             // think: a few grains lifted off the crown, orbiting above the head
      const c = crown(), n = 4; for (let k = 0; k < n; k++) { const a = orbPhase * TAU / 2.4 + k * TAU / n; dot(c.x + Math.cos(a) * .3 * CPR, c.y - M.orb * (.25 * CPR + Math.sin(a) * .07 * CPR) - 1, r, g, b, hero); }
    }
    if (!tiny) for (let e = 0; e < 2; e++) {           // eyes: paper region, grain lids, pinned pupil grains
      const E = eyeC(e), pcx = E.x + gaze.x * (E.rx - E.prx) * .95, pcy = E.y + gaze.y * (E.ry - E.pry) * .95, slitY = E.y + .1 * E.ry, half = Math.max(.75, .12 * E.ry);
      const lidTop = mix(E.y - E.ry, slitY - half, M.lid), lidBot = mix(E.y + E.ry, slitY + half, M.lid);
      for (let y = Math.max(0, E.y - E.ry - 1 | 0); y <= Math.min(rows - 1, E.y + E.ry + 1 | 0); y++) for (let x = Math.max(0, E.x - E.rx - 1 | 0); x <= Math.min(cols - 1, E.x + E.rx + 1 | 0); x++) {
        const dx = (x + .5 - E.x) / E.rx, dy = (y + .5 - E.y) / E.ry; if (dx * dx + dy * dy >= 1) continue; const j = (y * cols + x) * 4;
        const qx = (x + .5 - pcx) / E.prx, qy = (y + .5 - pcy) / E.pry, dark = y + .5 < lidTop || y + .5 > lidBot || (M.lid < .8 && qx * qx + qy * qy < 1);
        if (dark) { const t2 = RT[(x * 31 + y * 17) & 4095] < .3; px[j] = t2 ? r2 : r; px[j + 1] = t2 ? g2 : g; px[j + 2] = t2 ? b2 : b; px[j + 3] = 255; } else px[j + 3] = 0;
      }
    }
    octx.putImageData(img, 0, 0);
    const breathe = st.reduced ? 0 : (action === 'sleep' ? .02 : action === 'idle' ? .012 : .004) * Math.sin(time * TAU / (action === 'sleep' ? 5.5 : 4));
    ctx.save(); ctx.imageSmoothingEnabled = !hero; ctx.translate(0, footY); ctx.scale(1, 1 + breathe); ctx.translate(0, -footY);
    ctx.drawImage(off, 0, 0, cols * pitch, rows * pitch); ctx.restore();
    if (tiny) { const E = eyeC(0), E1 = eyeC(1); ctx.save(); ctx.translate((E.x + E1.x) / 2 * pitch, (E.y + E1.y) / 2 * pitch); ctx.rotate(-M.rot); ink.eyes(ctx, R, { eyeX: gaze.x * .7, eyeY: gaze.y * .7, blink: M.lid, faceY: -EYES[0].y }, { ink: ink.inkColor(st.tint), seed }); ctx.restore(); }
  }
  rebuild(); fill();
  if (st.reduced) relax();
  draw();
  return ctl;
}

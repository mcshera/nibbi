/* Round-4 technique: SLIME MOULD. Nibbi is a Physarum simulation: thousands of agents sense a trail field, turn toward
 * the strongest scent, move and deposit; the silhouette is a food field so the network grows and stays inside the body.
 * Every motion is emergent; cues only change food, decay, speed and heading bias. Rendered as a lace of ink veins. */
import * as ink from '../../ink.mjs';
import { ACTION_IDS } from '../../actions.mjs';
const { clamp, mix, TAU, FOOT } = ink;

export const meta = {
  id: 'slime', name: 'Slime mould',
  technique: 'Physarum agent simulation: 3300 agents sense, turn, move and deposit on a decaying trail grid shaped by a food-field silhouette',
  tagline: 'A black Nibbi whose surface is a living slime-mould network: it flows toward whatever it is fed and knits itself back.',
  look: 'Solid ink body on cream paper with thin paper cracks where the veins meet, a ragged living rim, two paper clearings for the eyes with dark pupils.',
  motion: 'Nothing is keyframed. Hello lifts the food field and the agents stream up after it, listen biases them toward the person, work is a peristaltic wave, error thins the trail and lets it drip. The veins keep rewiring, so the surface never repeats.',
  eyes: 'Two repellent discs in the food field: the agents cannot enter them, so the network clears and the paper shows through; the pupils are painted ink spots that follow the gaze.',
  fun: ['press or drag: the pointer becomes food — the whole network flows toward the finger, the body leans after it, and everything flows back when you let go', 'tap: a hole is punched in the surface where you touched and the agents knit it shut again', 'success: a third of the agents burst outward in a ring and are reabsorbed', 'error: the network thins, sags and hangs two drips below the foot line'],
  risks: ['emergent timing: stills are approximate', 'a very fast drag can pull most agents to one side and leave the far side thin for a second', 'the cracks are the vein edges, so they move as a set rather than one by one'],
  stills: { idle: 2, hello: .4, listen: 1.4, think: 1.4, work: 1.6, success: .3, error: 1.0, sleep: 2, tap: .25 },
};

const ONE_SHOT = { hello: 1.5, success: 1.7, error: 1.8, tap: .8 }, REDUCED_HOLD = 3, REP = { hello: .45, success: .5, error: 1, tap: .2 };   // REP: representative time for a reduced-motion still
const CFG = { hero: { c: 80, n: 3300, rs: 1 }, pill: { c: 20, n: 700, rs: 3 }, tiny: { c: 10, n: 250, rs: 4 } };
const OX = 1.7, OY = 3.1 - FOOT;                       // world origin = rest body centre, in R units; y down
const PROF = Array.from({ length: 256 }, (_, k) => ink.baseProfile(k / 256 * TAU));
const prof = a => PROF[((a / TAU * 256) % 256 + 256) % 256 | 0];

export function mount(host, { R = 96, seed = 1, tint = null, reduced = false, energy = 1, size = 'hero', paper = true } = {}) {
  const W = Math.round(3.4 * R), H = Math.round(3.6 * R), footX = 1.7 * R, footY = 3.1 * R;
  host.style.width = W + 'px'; host.style.height = H + 'px'; host.style.position = 'relative';
  const dpr = Math.min(2, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1));
  const canvas = document.createElement('canvas'); canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.cssText = `display:block;width:${W}px;height:${H}px;touch-action:none`;
  host.appendChild(canvas); const ctx = canvas.getContext('2d');
  const hero = size === 'hero', tiny = size === 'tiny', cfg = CFG[size] || CFG.hero;

  // --- grid + agents ---------------------------------------------------------------------------------
  const C = cfg.c, GW = Math.round(3.4 * C), GH = Math.round(3.6 * C), NC = GW * GH;
  let T = new Float32Array(NC), T2 = new Float32Array(NC); const D = new Float32Array(NC);   // D: display field, a short exponential average of T                       // trail field (0..1)
  const M = new Float32Array(NC), MR = new Float32Array(NC), SRC = new Float32Array(NC), OCC = new Uint8Array(NC);   // MR: core weight (1 deep inside, 0 in the outer rim)                   // silhouette/food mask, fixed deposit sources (drips)
  const N = cfg.n, X = new Float32Array(N), Y = new Float32Array(N), HD = new Float32Array(N), B = new Float32Array(N);
  let rc = 0; const rnd = () => ink.rand(seed, (rc = (rc + 1) % 4000000));
  const cellAt = (wx, wy) => { const i = (wx + OX) * C | 0, j = (wy + OY) * C | 0; return i < 0 || j < 0 || i >= GW || j >= GH ? -1 : j * GW + i; };
  const off = document.createElement('canvas'); const RS = cfg.rs, RW = GW * RS, RH = GH * RS; off.width = RW; off.height = RH;
  const octx = off.getContext('2d'); const img = octx.createImageData(RW, RH);

  // --- pose (where the food field is) + simulation parameters, both smoothly followed -----------------
  const pose = { dx: 0, lift: 0, lean: 0, sx: 1, sy: 1, gx: 0, gy: 0, blink: 0, wide: 1, happy: 0, drip: 0, round: 0, drop: 0, rot: 0 };
  const built = { ...pose, drip: -1 };
  const prm = { speed: .3, sens: 4, sang: .75, turn: .5, decay: .96, dep: .015, bx: 0, by: 0, bias: 0, swirl: 0, thr: .06, food: .9, kd: .1 };
  const st = { reduced, energy, tint, rgb: [22, 21, 20] };
  let action = 'idle', tAction = 0, time = 0, acc = 0, frozen = false, free = 0, pressed = false, ptr = { x: 0, y: -.3 }, loose = [];

  function targets(a, t) {                                                        // pose + params for action a at time t after the cue
    const p = { dx: 0, lift: 0, lean: 0, sx: 1, sy: 1, gx: 0, gy: 0, blink: 0, wide: 1, happy: 0, drip: 0, round: 0, drop: 0, rot: 0 };
    const q = { speed: .3, sens: 4, sang: .75, turn: .5, decay: .96, dep: .015, bx: 0, by: 0, bias: 0, swirl: 0, thr: .06, food: .9, kd: .1 };   // speed/sens in hero cells (R/80)
    const e = st.energy;
    if (a === 'hello') { p.lift = .34 * e * ink.bell(t / .75); p.round = .6 * ink.bell(t / 1.1); p.sy = 1.06; p.wide = 1.08; p.gy = -.2; if (t < .3) { q.by = -1; q.bias = .5; q.speed = .8; } }
    if (a === 'listen') { p.lean = -.5 * e; p.dx = -.08; p.sx = 1.05; p.sy = .94; p.gx = -.5; p.wide = 1.05; q.bx = -1; q.bias = .1; q.speed = .35; }
    if (a === 'think') { p.gx = -.55; p.gy = -.75; p.lean = -.18; p.drop = .55; p.sy = 1.04; q.swirl = .9 * e; q.speed = .5; }
    if (a === 'work') { p.gy = .5; p.wide = .96; p.sy = .9; p.sx = 1.09; const w = Math.sin(t * TAU * 1.0); q.dep = .015 * (1 + .6 * w * e); q.speed = .4 * (1 + .5 * w); q.thr = .06 - .015 * w * e; }
    if (a === 'success') { p.lift = .14 * e * ink.bell(t / .7); p.gy = -.3; p.wide = 1.05; p.happy = .6 * ink.bell(t / 1.2); p.sx = p.sy = 1 + .05 * ink.bell(t / .8); q.speed = t < .5 ? .8 : .4; }
    if (a === 'error') { p.gy = .8; p.gx = .15; p.sy = .9; p.sx = 1.05; p.lean = .08; p.drip = ink.smooth(.15, .9, t) * (1 - ink.smooth(1.35, 1.75, t)); q.decay = .93; q.by = 1; q.bias = .3; q.food = .5; q.thr = .075; }
    if (a === 'sleep') { p.sx = 1.12; p.sy = .72; p.blink = 1; q.speed = t < 1.2 ? .4 : .05; q.decay = .985; q.dep = .01; q.turn = .2; }
    if (a === 'tap') { const b = ink.bell(t / .45) * e; p.wide = 1.1; p.blink = t < .1 ? 1 : 0; p.sy = 1 - .16 * b; p.sx = 1 + .1 * b; q.speed = .45; }
    if (pressed && !st.reduced) { const px = clamp(ptr.x, -1.2, 1.2), py = ptr.y; p.dx += px * .2; p.lean += px * .35; p.lift += clamp((-py - 1) * .35, 0, .3); p.sy *= .9; p.sx *= 1.06; p.wide = 1.08; p.gx = clamp(px * 1.2, -1, 1); p.gy = clamp((py + .1) * 1.5, -1, 1); q.speed = .6; }
    return { p, q };
  }
  const poseCenter = () => ({ cx: pose.dx, cy: FOOT * (1 - pose.sy) - pose.lift });  // body centre in world units
  const eyeAt = i => { const e = ink.EYES[i], c = poseCenter(); return { x: c.cx + e.x * pose.sx, y: c.cy + e.y * pose.sy, rx: e.rx * pose.sx * pose.wide, ry: e.ry * pose.sy * pose.wide * Math.max(.1, 1 - pose.blink) }; };

  function buildMask() {                                                          // food field from the silhouette; eyes are holes; drips extend below the foot
    const keys = ['dx', 'lift', 'lean', 'sx', 'sy', 'blink', 'wide', 'drip', 'round', 'drop', 'rot'];
    if (keys.every(k => Math.abs(pose[k] - built[k]) < .007)) return; for (const k of keys) built[k] = pose[k];
    const { cx, cy } = poseCenter(), E = [eyeAt(0), eyeAt(1)], band = tiny ? .12 : .07;
    const drips = pose.drip > 0 ? [[cx - .34, .45], [cx + .22, .28]] : [], cr = Math.cos(pose.rot), sr = Math.sin(pose.rot), dw = Math.max(.05, 1.1 / C);
    for (let j = 0, k = 0; j < GH; j++) for (let i = 0; i < GW; i++, k++) {
      const wx0 = (i + .5) / C - OX - cx, wy0 = (j + .5) / C - OY - cy;
      let lx = (wx0 * cr + wy0 * sr) / pose.sx, ly = (-wx0 * sr + wy0 * cr) / pose.sy;
      if (Math.abs(lx) > 1.45 || Math.abs(ly) > 1.35) { M[k] = 0; MR[k] = 0; SRC[k] = 0; continue; }
      lx -= pose.lean * ink.smooth(.1, 1, -ly) * .9;
      const r = Math.hypot(lx, ly), up = Math.max(0, -ly / (r || 1)); let pr = mix(prof(Math.atan2(ly, lx)), 1, pose.round); pr += pose.drop * (.55 * up ** 6 - .08 * (1 - up)); const d = r - pr;
      let m = clamp((band * .5 - d) / band, 0, 1); MR[k] = ink.smooth(-.09, -.2, d);
      if (m > 0) for (const e of E) { const qx = (lx * pose.sx + cx - e.x) / e.rx, qy = (ly * pose.sy + cy - e.y) / e.ry; m *= ink.smooth(1, 1.25, qx * qx + qy * qy); }
      let s = 0;
      for (const [x0, len] of drips) { const wx = (i + .5) / C - OX, wy = (j + .5) / C - OY; if (Math.abs(wx - x0) < dw && wy > FOOT - .12 && wy < FOOT - .05 + len * pose.drip) { m = 1; s = .9; } }
      M[k] = m; SRC[k] = s;
    }
  }

  function simStep() {                                                            // one Physarum step (1/60 s)
    const c = poseCenter(), v0 = prm.speed / 80 * (hero ? 1 : 2), sd = Math.max(1.5 / C, prm.sens / 80), sa = prm.sang, tr = prm.turn, fw = prm.food;
    const bias = prm.bias, ba = Math.atan2(prm.by, prm.bx), swirl = prm.swirl, pf = pressed && !st.reduced ? 1.6 : 0;
    const sense = (x, y) => { const k = cellAt(x, y); if (k < 0) return -2; let v = T[k] + fw * M[k]; if (pf) { const dx = x - ptr.x, dy = y - ptr.y; v += pf / (1 + 5 * (dx * dx + dy * dy)); } return v; };
    loose.length = 0;
    for (let i = 0; i < N; i++) {
      let h = HD[i], x = X[i], y = Y[i];
      const f = sense(x + Math.cos(h) * sd, y + Math.sin(h) * sd), fl = sense(x + Math.cos(h - sa) * sd, y + Math.sin(h - sa) * sd), fr = sense(x + Math.cos(h + sa) * sd, y + Math.sin(h + sa) * sd);
      if (f > fl && f > fr) { /* keep */ } else if (f < fl && f < fr) h += (rnd() < .5 ? -tr : tr); else if (fl > fr) h -= tr; else if (fr > fl) h += tr;
      if (bias) { let d = ba - h; d = Math.atan2(Math.sin(d), Math.cos(d)); h += d * bias * .25; }
      if (swirl) { const tx = -(y - (c.cy - .45)), ty = x - c.cx; let d = Math.atan2(ty, tx) - h; d = Math.atan2(Math.sin(d), Math.cos(d)); h += d * swirl * .2 * clamp(1.3 - Math.hypot(tx, ty), 0, 1); }
      if (pf) { let d = Math.atan2(ptr.y - y, ptr.x - x) - h; d = Math.atan2(Math.sin(d), Math.cos(d)); h += d * .12; }
      const v = v0 * (1 + B[i] * 3), nx = x + Math.cos(h) * v, ny = y + Math.sin(h) * v;
      const kn = cellAt(nx, ny), ko = cellAt(x, y);
      if (kn < 0) { h += Math.PI + (rnd() - .5); }
      else if (kn !== ko && OCC[kn] && free <= 0) { h = rnd() * TAU; }                                   // one agent per cell (Jones): collisions keep the network foamy
      else if (free > 0 || M[kn] > .5 || M[kn] >= (ko < 0 ? 0 : M[ko])) { x = nx; y = ny; if (ko >= 0) OCC[ko] = 0; OCC[kn] = 1; }
      else { h += Math.PI + (rnd() - .5) * 2; }
      const k = cellAt(x, y);
      if (k >= 0) { if (M[k] < .5) { if (loose.length < 600) loose.push(i); if (free <= 0) { let d = Math.atan2(c.cy - y, c.cx - x) - h; d = Math.atan2(Math.sin(d), Math.cos(d)); h += d * .3; } } else T[k] += prm.dep * (1 + B[i]); }
      X[i] = x; Y[i] = y; HD[i] = h; B[i] *= .93;
    }
    const dec = prm.decay;                                                        // 3×3 box blur + decay + fixed sources
    for (let j = 0; j < GH; j++) { const j0 = Math.max(0, j - 1), j1 = Math.min(GH - 1, j + 1);
      for (let i = 0; i < GW; i++) { const i0 = Math.max(0, i - 1), i1 = Math.min(GW - 1, i + 1); let s = 0;
        for (let jj = j0; jj <= j1; jj++) { const r = jj * GW; s += T[r + i0] + T[r + i] + T[r + i1]; }
        const k = j * GW + i; T2[k] = s / 9 * dec + SRC[k] * .12; } }
    const tmp = T; T = T2; T2 = tmp;
    const kd = prm.kd; for (let k = 0; k < NC; k++) D[k] += (T[k] - D[k]) * kd;
  }

  function seedAgents() {                                                         // scatter agents inside the mask, random headings
    for (let i = 0; i < N; i++) { let x, y, k, tries = 0; do { x = (rnd() - .5) * 2.4; y = (rnd() - .5) * 2.2 + .1; k = cellAt(x, y); } while ((k < 0 || M[k] < .6) && ++tries < 40); X[i] = x; Y[i] = y; HD[i] = rnd() * TAU; B[i] = 0; if (k >= 0) OCC[k] = 1; }
  }
  let accX = 0, accY = 0, prevC = poseCenter(); const OCC2 = new Uint8Array(NC);
  function shiftField(nx, ny) {                                                   // the whole network rides with the body: move trail, display, occupancy and agents by whole cells
    for (const A of [T, D, OCC]) { const tmp = A === OCC ? OCC2 : T2; tmp.fill(0);
      for (let j = 0; j < GH; j++) { const sj = j - ny; if (sj < 0 || sj >= GH) continue; for (let i = 0; i < GW; i++) { const si = i - nx; if (si >= 0 && si < GW) tmp[j * GW + i] = A[sj * GW + si]; } }
      A.set(tmp); }
    for (let i = 0; i < N; i++) { X[i] += nx / C; Y[i] += ny / C; }
  }
  function follow(dt) {                                                           // move pose + params toward the targets of the current action
    const { p, q } = targets(action, st.reduced ? (REP[action] ?? tAction) : tAction), k = st.reduced ? 1 : 1 - Math.exp(-dt * (pressed ? 14 : 9)), kq = st.reduced ? 1 : 1 - Math.exp(-dt * 6);
    for (const key in p) pose[key] = mix(pose[key], p[key], key === 'blink' ? Math.max(k, .4) : key === 'drip' ? 1 : k);
    for (const key in q) prm[key] = mix(prm[key], q[key], kq);
    const c = poseCenter(); accX += (c.cx - prevC.cx) * C; accY += (c.cy - prevC.cy) * C; prevC = c;
    const nx = Math.trunc(accX), ny = Math.trunc(accY); if (nx || ny) { accX -= nx; accY -= ny; shiftField(nx, ny); }
    buildMask();
  }
  function relax() {                                                              // reduced motion: settle the pose, run a fixed number of steps, then hold the field
    pressed = false; free = 0; B.fill(0); loose.length = 0;
    follow(1); for (let s = 0; s < 40; s++) simStep(); frozen = true;
  }

  const ctl = {
    cue(a) {
      if (!ACTION_IDS.includes(a)) return;
      action = a; tAction = 0; frozen = false; const e = st.energy;
      if (!st.reduced) {
        if (a === 'success') { const c = poseCenter(); for (let i = 0; i < N; i += 3) { HD[i] = Math.atan2(Y[i] - c.cy, X[i] - c.cx); B[i] = 3 * e; } free = .32; }   // a third of the agents burst; the rest keep the network
        if (a === 'tap') scatter(ptr.x, ptr.y, 2.2 * e);
        if (a === 'hello') for (let i = 0; i < N; i++) B[i] = Math.max(B[i], .4 * e);
      } else relax();
    },
    step(dt) {
      dt = clamp(dt, 0, .1); if (dt <= 0) { draw(); return; }
      time += dt; tAction += dt;
      if (ONE_SHOT[action] && tAction > (st.reduced ? REDUCED_HOLD : ONE_SHOT[action])) { action = 'idle'; tAction = 0; if (st.reduced) relax(); }
      if (!frozen) {
        follow(dt);
        if (!st.reduced) { acc += dt; let n = 0; while (acc >= 1 / 60 && n < 3) { acc -= 1 / 60; free -= 1 / 60; simStep(); n++; } acc = Math.min(acc, 1 / 60); }
        else relax();
      }
      draw();
    },
    setReduced(v) { st.reduced = !!v; if (st.reduced) relax(); else frozen = false; },
    setEnergy(e) { st.energy = clamp(e, .5, 1.5); }, setTint(c) { st.tint = c; st.rgb = parseColor(ink.inkColor(c)); },
    poke(x, y, kind) {
      ptr = { x: x / R - OX, y: y / R - OY };
      if (kind === 'down') { pressed = true; if (ONE_SHOT[action]) { action = 'idle'; tAction = 0; } if (!st.reduced) scatter(ptr.x, ptr.y, 1.2 * st.energy); }
      if (kind === 'up') pressed = false;
      if (kind === 'tap') { action = 'tap'; tAction = 0; if (!st.reduced) scatter(ptr.x, ptr.y, 2.2 * st.energy); else relax(); }
      if (st.reduced) { frozen = false; relax(); }
    },
    destroy() { for (const [ev, fn] of listeners) host.removeEventListener(ev, fn); canvas.remove(); },
  };
  function scatter(px, py, s) {                                                 // agents near the touch shoot away; the lace under the finger is punched thin
    for (let i = 0; i < N; i++) { const dx = X[i] - px, dy = Y[i] - py, d = Math.hypot(dx, dy); if (d < .35) { HD[i] = Math.atan2(dy, dx) + (rnd() - .5) * .8; B[i] = Math.max(B[i], s * (1 - d / .35)); } }
    const i0 = Math.max(0, (px - .35 + OX) * C | 0), i1 = Math.min(GW - 1, (px + .35 + OX) * C | 0), j0 = Math.max(0, (py - .35 + OY) * C | 0), j1 = Math.min(GH - 1, (py + .35 + OY) * C | 0);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const d = Math.hypot((i + .5) / C - OX - px, (j + .5) / C - OY - py); if (d < .35) { const k = j * GW + i, f = .1 + .9 * (d / .35) ** 2; T[k] *= f; D[k] *= f; } }
  }
  const listeners = [['pointerdown', e => ctl.poke(e.offsetX, e.offsetY, 'down')], ['pointermove', e => ctl.poke(e.offsetX, e.offsetY, 'move')], ['pointerup', e => ctl.poke(e.offsetX, e.offsetY, 'up')], ['pointerleave', e => ctl.poke(e.offsetX, e.offsetY, 'up')]];
  for (const [ev, fn] of listeners) host.addEventListener(ev, fn);

  // --- draw: trail → soft threshold → ink pixels; eyes painted as paper clearings + pupils ------------------
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (paper) ink.paper(ctx, W, H, { grain: 0 }); else ctx.clearRect(0, 0, W, H);
    const [cr, cg, cb] = st.rgb, d = img.data, lo = prm.thr, hi = prm.thr * 3, base = tiny ? .8 : hero ? .8 : .75;
    for (let py = 0, o = 0; py < RH; py++) {
      const gy = clamp((py + .5) / RS - .5, 0, GH - 1.001), j = gy | 0, fy = gy - j, r0 = j * GW, r1 = Math.min(GH - 1, j + 1) * GW;
      for (let px = 0; px < RW; px++, o += 4) {
        const gx = clamp((px + .5) / RS - .5, 0, GW - 1.001), i = gx | 0, fx = gx - i, i1 = Math.min(GW - 1, i + 1);
        const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        const t = D[r0 + i] * w00 + D[r0 + i1] * w10 + D[r1 + i] * w01 + D[r1 + i1] * w11;
        const m = M[r0 + i] * w00 + M[r0 + i1] * w10 + M[r1 + i] * w01 + M[r1 + i1] * w11;
        const a = m * (hero ? base * mix(ink.smooth(lo * .03, lo * .12, t), 1, pose.blink) + (1 - base) * ink.smooth(lo, hi, t) : base + (1 - base) * ink.smooth(lo, hi, t));   // hero: paper windows where no trail, dark base, crisp vein cores
        d[o] = cr; d[o + 1] = cg; d[o + 2] = cb; d[o + 3] = a * 255;
      }
    }
    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.drawImage(off, 0, 0, W, H);
    ctx.fillStyle = ink.inkColor(st.tint);
    if (hero && loose.length) { const s = Math.max(1, R * .045); for (const i of loose) if (B[i] > .02) ctx.fillRect((X[i] + OX) * R - s / 2, (Y[i] + OY) * R - s / 2, s, s); }
    const c = poseCenter();
    ctx.save(); ctx.translate((c.cx + OX) * R, (c.cy + OY) * R); ctx.scale(mix(1, pose.sx, .6), mix(1, pose.sy, .6));
    ink.eyes(ctx, R, { eyeX: pose.gx, eyeY: pose.gy, blink: pose.blink, wide: pose.wide, happy: pose.happy }, { ink: ink.inkColor(st.tint), white: ink.PAPER, seed });
    ctx.restore();
  }
  function parseColor(c) {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c).trim());
    if (m) { let h = m[1]; if (h.length === 3) h = h.split('').map(x => x + x).join(''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
    try { const cv = document.createElement('canvas'); cv.width = cv.height = 1; const x = cv.getContext('2d'); x.fillStyle = c; x.fillRect(0, 0, 1, 1); const p = x.getImageData(0, 0, 1, 1).data; return [p[0], p[1], p[2]]; } catch { return [22, 21, 20]; }
  }

  // --- warm up: grow the network before the first frame so idle starts as a settled body --------------------
  st.rgb = parseColor(ink.inkColor(st.tint));
  buildMask(); seedAgents(); for (let s = 0; s < (hero ? 110 : 90); s++) simStep();
  if (st.reduced) relax();
  draw();
  return ctl;
}

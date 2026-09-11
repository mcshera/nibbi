/* Round-2 technique: SOFT BODY. Nibbi is a ring of mass points with springs + pressure, resting on a floor.
 * Every motion is emergent from forces; cues only apply impulses or change targets (lean / pressure / damping). */
import * as ink from '../../ink.mjs';
import { ACTION_IDS } from '../../actions.mjs';
const { clamp, mix, TAU, FOOT } = ink;

export const meta = {
  id: 'softbody', name: 'Soft body',
  technique: 'Verlet ring of 36 mass points: edge + second-neighbour springs, area pressure, soft shape memory, floor with friction; filled as fuzzy ink',
  tagline: 'A blot of ink that is really a jelly: it jumps, lands with a squash, wobbles and settles on its own.',
  look: 'Fuzzy-edged ink body with a faint bleed halo on the paper; two pip eyes live inside the jelly and tilt, stretch and squash with it.',
  motion: 'Nothing is keyframed. Hello is an upward impulse, error is a pressure drop, sleep is high damping + slow breathing pressure. Overshoot, squash and settle come free from the physics, so no two landings are identical.',
  eyes: 'Two pip eyes drawn in a frame derived from the body centroid, the vector to the crown and the width/height ratio of the ring, so they lean and deform with the body.',
  risks: ['jelly can read as rubber rather than ink', 'fast drags need velocity clamping to stay stable', 'eyes may squash unpleasantly on hard landings', 'stills are emergent, so timing is approximate'],
  stills: { idle: 2, hello: .45, listen: 1.4, think: 1.4, work: 1.3, success: .7, error: 1.0, sleep: 2, tap: .2 },
};

const N = 36, SUB = 5, ONE_SHOT = { hello: 1.5, success: 1.7, error: 1.8, tap: .9 }, REDUCED_HOLD = 3;   // reduced: a still has no motion to read, so hold it longer

export function mount(host, { R = 96, seed = 1, tint = null, reduced = false, energy = 1, size = 'hero', paper = true } = {}) {
  const W = Math.round(3.4 * R), H = Math.round(3.6 * R), footX = 1.7 * R, footY = 3.1 * R;
  host.style.width = W + 'px'; host.style.height = H + 'px'; host.style.position = 'relative';
  const dpr = Math.min(2, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1));
  const canvas = document.createElement('canvas'); canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.cssText = `display:block;width:${W}px;height:${H}px;touch-action:none`;
  host.appendChild(canvas); const ctx = canvas.getContext('2d');
  const hero = size === 'hero', tiny = size === 'tiny';

  // --- body: coordinates in R units, origin at the foot point, y down, floor at y = 0 ------------------
  const rest = ink.blobPoints(1, { n: N, seed, rough: .035 }).map(p => ({ x: p.x, y: p.y - FOOT }));
  const restC = centroid(rest);
  const rel = rest.map(p => ({ x: p.x - restC.x, y: p.y - restC.y }));           // shape memory, relative to centroid
  const restArea = Math.abs(area(rest));
  const restW = width(rest), restH = height(rest);
  const P = rest.map(p => ({ x: p.x, y: p.y, px: p.x, py: p.y }));               // Verlet: position + previous position
  const len1 = rel.map((p, i) => dist(p, rel[(i + 1) % N])), len2 = rel.map((p, i) => dist(p, rel[(i + 2) % N]));
  const crown = rel.map((p, i) => Math.max(0, -p.y / restH * 2 - .15));            // 0..1 weight of "top-ness" per point

  // --- state ---------------------------------------------------------------------------------------
  const st = { reduced, energy, tint };
  let action = 'idle', tAction = 0, time = 0, workTick = 0;
  const T = { pressure: 1, lean: 0, damp: 4.2, breathe: .03, breatheHz: .22 };   // current targets (smoothly followed)
  const tg = { ...T };
  let grab = -1, pointer = { x: 0, y: 0 }, splashes = [];                          // splashes: ink thrown by a hard landing, fades away
  const face = { eyeX: 0, eyeY: 0, blink: 0, wide: 1, happy: 0 }, faceT = { ...face };

  function targetsFor(a) {
    const t = { pressure: 1, lean: 0, damp: 4.2, breathe: .03, breatheHz: .22, eyeX: 0, eyeY: 0, blink: 0, wide: 1, happy: 0 };
    if (a === 'listen') { t.lean = -.32; t.wide = 1.06; t.eyeX = -.25; t.breathe = .015; }
    if (a === 'think') { t.pressure = .93; t.eyeX = -.55; t.eyeY = -.75; t.lean = -.06; }
    if (a === 'work') { t.pressure = 1.1; t.eyeY = .45; t.wide = .96; t.breathe = 0; }
    if (a === 'success') { t.happy = 1; t.eyeY = -.2; t.wide = 1.05; }
    if (a === 'error') { t.pressure = tAction < 1 ? .74 : 1; t.eyeY = .8; t.wide = .9; t.eyeX = .15; }
    if (a === 'sleep') { t.pressure = .72; t.damp = 9; t.breathe = .045; t.breatheHz = .12; t.blink = 1; }
    if (a === 'hello') { t.wide = 1.08; t.lean = .12; t.eyeX = .1; }
    if (a === 'tap') { t.wide = 1.1; t.blink = tAction < .1 ? 1 : 0; }
    return t;
  }

  // --- forces / impulses (cues never set positions) ---------------------------------------------------
  const vel = (p, vx, vy) => { p.px -= vx; p.py -= vy; };                        // add velocity in Verlet terms (units per second, scaled later by h)
  let impulse = [];                                                               // pending {i, vx, vy} applied at the next step
  function impulseAll(vx, vy, w = () => 1) { for (let i = 0; i < N; i++) impulse.push({ i, vx: vx * w(i), vy: vy * w(i) }); }
  function dent(x, y, strength) {                                                 // push points near (x, y) toward the centroid, falloff by distance
    const c = centroid(P);
    for (let i = 0; i < N; i++) {
      const d = dist(P[i], { x, y }), w = Math.max(0, 1 - d / .55);
      if (w <= 0) continue;
      const dx = c.x - P[i].x, dy = c.y - P[i].y, l = Math.hypot(dx, dy) || 1;
      impulse.push({ i, vx: dx / l * strength * w, vy: dy / l * strength * w });
    }
  }

  function simulate(dt) {
    const h = dt / SUB, e = st.energy;
    const A0 = restArea * T.pressure * (1 + T.breathe * Math.sin(time * TAU * T.breatheHz));
    for (let s = 0; s < SUB; s++) {
      if (s === 0 && impulse.length) { for (const im of impulse) { P[im.i].px -= im.vx * h; P[im.i].py -= im.vy * h; } impulse = []; }
      const c = centroid(P), A = Math.abs(area(P)), pForce = (A0 - A) / restArea * 40;
      const lean = T.lean * e;
      // think: slow lateral push on the crown. work: periodic downward nod handled in step().
      const sway = action === 'think' && !st.reduced ? Math.sin(time * TAU * .45) * 1.6 * e : 0;
      for (let i = 0; i < N; i++) {
        const p = P[i], a = P[(i + N - 1) % N], b = P[(i + 1) % N];
        let fx = -c.x * 30, fy = 3.6;                                            // gravity + a weak pull home to the centre column
        // shape memory (soft): target = centroid + sheared rest offset
        const r = rel[i], sh = lean * clamp(-r.y / restH * 2 + .3, 0, 1.3);
        fx += (c.x + r.x + sh - p.x) * 55; fy += (c.y + r.y - p.y) * 55;
        // edge springs
        for (const [q, L, k] of [[b, len1[i], 900], [a, len1[(i + N - 1) % N], 900], [P[(i + 2) % N], len2[i], 320], [P[(i + N - 2) % N], len2[(i + N - 2) % N], 320]]) {
          const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1e-6, f = (d - L) * k / d; fx += dx * f; fy += dy * f;
        }
        // pressure along the outward normal
        let nx = b.y - a.y, ny = -(b.x - a.x); const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
        fx += nx * pForce; fy += ny * pForce;
        fx += sway * crown[i];
        if (grab === i) { fx += (pointer.x - p.x) * 260; fy += (pointer.y - p.y) * 260; }
        // Verlet integrate with damping and a velocity clamp
        let vx = (p.x - p.px) * (1 - T.damp * h), vy = (p.y - p.py) * (1 - T.damp * h);
        const vmax = 7 * h, vl = Math.hypot(vx, vy); if (vl > vmax) { vx *= vmax / vl; vy *= vmax / vl; }
        const nxp = p.x + vx + fx * h * h, nyp = p.y + vy + fy * h * h;
        p.px = p.x; p.py = p.y; p.x = nxp; p.y = nyp;
        // floor: restitution ~.1 and friction
        if (p.y > 0) { const vy = (p.y - p.py) / h; if (vy > 1.9 && !tiny && !st.reduced && splashes.length < 6) splashes.push({ x: p.x, t: 0, s: seed + i, n: Math.min(6, Math.round(vy * 2)) }); p.y = 0; p.py = -(p.py - 0) * .1 + 0; p.px = mix(p.px, p.x, .3); }
        // host bounds (soft walls)
        p.x = clamp(p.x, -1.6, 1.6); p.y = Math.max(p.y, -3.0);
      }
    }
  }

  function relax() { // reduced motion: settle the current targets with heavy damping, then hold
    const keep = { damp: T.damp, breathe: T.breathe }; Object.assign(T, targetsFor(action), { damp: 14, breathe: 0 });
    impulse = []; grab = -1; splashes = [];
    for (let k = 0; k < 90; k++) simulate(1 / 60);
    for (const p of P) { p.px = p.x; p.py = p.y; }
    T.damp = keep.damp;
    Object.assign(face, pick(targetsFor(action)));
  }
  const pick = t => ({ eyeX: t.eyeX, eyeY: t.eyeY, blink: t.blink, wide: t.wide, happy: t.happy });

  const ctl = {
    cue(a) {
      if (!ACTION_IDS.includes(a)) return;
      action = a; tAction = 0; workTick = 0; grab = -1;
      const e = st.energy;
      if (!st.reduced) {
        if (a === 'hello') { impulseAll(.6 * e, -2.2 * e); }
        if (a === 'success') { impulseAll(0, -2.9 * e); }
        if (a === 'tap') { const c = centroid(P); dent(c.x, c.y - restH * .5, 3 * e); }
        if (a === 'error') { impulseAll(0, .6 * e); }
      } else relax();
    },
    step(dt) {
      dt = clamp(dt, 0, .1); if (dt <= 0) { draw(); return; }
      time += dt; tAction += dt;
      const t = targetsFor(action);
      if (action === 'success' && !st.reduced) t.pressure = tAction < .5 ? 1.28 : 1;    // puff at the apex
      if (action === 'work' && !st.reduced) { workTick += dt; if (workTick >= .6) { workTick -= .6; impulseAll(0, 1.6 * st.energy, i => crown[i]); } }
      if (grab >= 0) { t.pressure *= .96; t.wide = 1.05; }
      Object.assign(tg, t);
      const k = st.reduced ? 1 : 1 - Math.exp(-dt * 6);
      for (const key of ['pressure', 'lean', 'damp', 'breathe', 'breatheHz']) T[key] = mix(T[key], tg[key], k);
      const fk = st.reduced ? 1 : 1 - Math.exp(-dt * 9);
      for (const key of ['eyeX', 'eyeY', 'wide', 'happy']) face[key] = mix(face[key], t[key], fk);
      face.blink = mix(face.blink, t.blink, st.reduced ? 1 : 1 - Math.exp(-dt * 16));
      if (!st.reduced && action !== 'sleep' && grab < 0) {                       // rare, deterministic blink
        const ph = ink.fract(time / 5.3 + ink.rand(seed, 7)); if (ph < .05) face.blink = Math.max(face.blink, ink.bell(ph / .05));
      }
      if (!st.reduced) simulate(dt); else if (tAction < 1) relaxStep();
      for (const s of splashes) s.t += dt; splashes = splashes.filter(s => s.t < 1.6);
      if (ONE_SHOT[action] && tAction > (st.reduced ? REDUCED_HOLD : ONE_SHOT[action])) { action = 'idle'; tAction = 0; if (st.reduced) relax(); }
      draw();
    },
    setReduced(v) { st.reduced = !!v; if (st.reduced) relax(); },
    setEnergy(e) { st.energy = clamp(e, .5, 1.5); }, setTint(c) { st.tint = c; },
    poke(x, y, kind) {
      const lx = (x - footX) / R, ly = (y - footY) / R; pointer = { x: lx, y: ly };
      if (kind === 'down') { let best = 1e9; grab = -1; for (let i = 0; i < N; i++) { const d = dist(P[i], pointer); if (d < best) { best = d; grab = i; } } if (best > 1.3) grab = -1; else if (!st.reduced) dent(lx, ly, 2 * st.energy); if (ONE_SHOT[action]) { action = 'idle'; tAction = 0; } }
      if (kind === 'move') { /* pointer already updated */ }
      if (kind === 'up') { grab = -1; }
      if (kind === 'tap') { if (ONE_SHOT[action]) { action = 'idle'; } action = 'tap'; tAction = 0; if (!st.reduced) dent(lx, ly, 3 * st.energy); else relax(); }
    },
    destroy() { for (const [ev, fn] of listeners) host.removeEventListener(ev, fn); canvas.remove(); },
  };
  function relaxStep() { const d = T.damp; T.damp = 14; const b = T.breathe; T.breathe = 0; simulate(1 / 60); T.damp = d; T.breathe = b; }
  const listeners = [
    ['pointerdown', e => ctl.poke(e.offsetX, e.offsetY, 'down')],
    ['pointermove', e => ctl.poke(e.offsetX, e.offsetY, 'move')],
    ['pointerup', e => ctl.poke(e.offsetX, e.offsetY, 'up')],
    ['pointerleave', e => ctl.poke(e.offsetX, e.offsetY, 'up')],
  ];
  for (const [ev, fn] of listeners) host.addEventListener(ev, fn);

  // --- draw -------------------------------------------------------------------------------------------
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (paper) ink.paper(ctx, W, H, { grain: hero ? .045 : 0, seed }); else ctx.clearRect(0, 0, W, H);
    const color = ink.inkColor(st.tint);
    const pts = P.map(p => ({ x: footX + p.x * R, y: footY + p.y * R }));
    // bleed halo: ink soaking into the paper around the body (hero + pill only)
    if (!tiny) { ctx.save(); ctx.globalAlpha = hero ? .22 : .16; ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = R * .14; ink.tracePath(ctx, pts); ctx.fill(); ctx.restore(); }
    for (const s of splashes) ink.specks(ctx, footX + s.x * R, footY - R * .05, R, { count: s.n, seed: s.s, spread: .6, size: .035, color, alpha: .8 * (1 - s.t / 1.6) });
    ink.fuzzyFill(ctx, pts, { color, R, soft: hero ? .05 : tiny ? 0 : .03, tufts: hero ? 16 : tiny ? 0 : 6, seed });
    // eyes in a body frame: centroid, tilt toward the crown, stretch with the ring
    const c = centroid(P); let tx = 0, ty = 0, tw = 0;
    for (let i = 0; i < N; i++) { tx += P[i].x * crown[i]; ty += P[i].y * crown[i]; tw += crown[i]; }
    tx /= tw; ty /= tw;
    const ang = Math.atan2(tx - c.x, -(ty - c.y));
    const sx = clamp(width(P) / restW, .8, 1.25), sy = clamp(height(P) / restH, .8, 1.25);
    ctx.save(); ctx.translate(footX + c.x * R, footY + c.y * R); ctx.rotate(ang * .8); ctx.scale(mix(1, sx, .7), mix(1, sy, .7));
    ink.eyes(ctx, R, { eyeX: face.eyeX, eyeY: face.eyeY, blink: face.blink, wide: face.wide, happy: face.happy, faceY: .02 }, { ink: color, seed });
    ctx.restore();
  }

  // settle onto the floor before the first frame so idle starts calm
  { const d = T.damp; T.damp = 10; for (let k = 0; k < 80; k++) simulate(1 / 60); T.damp = d; splashes = []; }
  if (st.reduced) relax();
  draw();
  return ctl;
}

// --- small geometry helpers -----------------------------------------------------------------------
function centroid(pts) { let x = 0, y = 0; for (const p of pts) { x += p.x; y += p.y; } return { x: x / pts.length, y: y / pts.length }; }
function area(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; } return a / 2; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function width(pts) { let lo = 1e9, hi = -1e9; for (const p of pts) { lo = Math.min(lo, p.x); hi = Math.max(hi, p.x); } return hi - lo; }
function height(pts) { let lo = 1e9, hi = -1e9; for (const p of pts) { lo = Math.min(lo, p.y); hi = Math.max(hi, p.y); } return hi - lo; }

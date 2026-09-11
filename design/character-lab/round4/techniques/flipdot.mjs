/* Round-4 technique: FLIP-DOT BOARD. Nibbi is a mechanical binary display: a grid of discs, each ink-side or paper-side.
 * A per-state target image (silhouette + eyes rasterised at grid resolution) decides which dots should be ink; when it changes,
 * the flips propagate as a wavefront (crown-down, left-to-right scan, outward from a poke). Drag wipes dots to paper; they flip back. */
import * as ink from '../../ink.mjs';
import { ACTION_IDS } from '../../actions.mjs';
const { clamp, TAU, FOOT, EYES } = ink;

export const meta = {
  id: 'flipdot', name: 'Flip-dot board',
  technique: 'Mechanical flip-disc matrix (68 × 72 dots at hero): binary target image per state, 120 ms flips scheduled from a wavefront',
  tagline: 'Nibbi as a railway-station flip-dot sign: every change is a discrete, clattering wave of discs turning over.',
  look: 'Round ink discs on cream paper with a faint matrix of paper-side rings inside the body; a squat pixelated silhouette with two big paper-dot eyes and whole-dot pupils.',
  motion: 'Nothing tweens. The still changes and the dots catch up one by one along a wavefront (crown-down, scan, ripple) with a mechanical stagger, so every cue reads as a physical sign updating.',
  eyes: 'Two discs of dots left on the paper side inside the ink body (≈ 9 dots wide at hero); pupils are ink dots that jump by whole dots with the gaze; sleep flattens them to one paper row.',
  fun: ['drag wipes dots to paper along the finger path and they flip back ≈ .5 s later, so you can draw on Nibbi', 'tap punches a hole that heals inward as a ring', 'every state change is a visible wave of flips (crown-down, left to right on hello, outward from a poke)', 'success sends a ripple of highlighted rings out from the centre across the whole board', 'error flips the body off from the top down into a low heap, then rebuilds from the floor'],
  risks: ['dot pitch makes the eyes coarse at pill', 'waves add latency to every cue (≈ .4 s)', 'a very fast drag may skip cells', 'the highlight ripple is subtle on a bright screen'],
  stills: { idle: 2, hello: .4, listen: 1.2, think: 1.4, work: 1.6, success: .7, error: .9, sleep: 2, tap: .25 },
};

const ONE_SHOT = { hello: 1.3, success: 1.6, error: 2.9, tap: .9 }, REDUCED_HOLD = 3, FLIP = .12, EYE_BAND = [-.15, .3];

export function mount(host, { R = 96, seed = 1, tint = null, reduced = false, energy = 1, size = 'hero', paper = true } = {}) {
  const W = Math.round(3.4 * R), H = Math.round(3.6 * R), footX = 1.7 * R, footY = 3.1 * R, cY = footY - FOOT * R;
  host.style.width = W + 'px'; host.style.height = H + 'px'; host.style.position = 'relative';
  const hero = size === 'hero', tiny = size === 'tiny';
  const dpr = tiny ? 1 : Math.min(2, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1));
  const canvas = document.createElement('canvas'); canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.cssText = `display:block;width:${W}px;height:${H}px;touch-action:none`;
  host.appendChild(canvas); const ctx = canvas.getContext('2d');
  // --- grid ---------------------------------------------------------------------------------------
  const p = tiny ? 1 : hero ? R / 20 : R / 12, C = Math.floor(W / p), RW = Math.floor(H / p), N = C * RW, ox = (W - C * p) / 2, oy = (H - RW * p) / 2, pR = p / R;
  const CX = new Float32Array(N), CY = new Float32Array(N), DC = new Float32Array(N);   // cell centres; distance from the body centre in dots
  for (let j = 0; j < RW; j++) for (let i = 0; i < C; i++) { const k = j * C + i; CX[k] = ox + (i + .5) * p; CY[k] = oy + (j + .5) * p; DC[k] = Math.hypot(CX[k] - footX, CY[k] - cY) / p; }
  const cur = new Uint8Array(N), target = new Uint8Array(N), base = new Uint8Array(N);
  const phase = new Float32Array(N).fill(-1), due = new Float32Array(N).fill(Infinity), delay = new Float32Array(N);
  const wipeUntil = new Float32Array(N), invA = new Float32Array(N).fill(Infinity), invB = new Float32Array(N);
  const hcell = new Float32Array(N); for (let i = 0; i < N; i++) hcell[i] = ink.hash(seed * 31.7 + i * 1.13);
  let edges = [];
  const jTop = Math.floor((footY - 1.75 * R - oy) / p), jBot = Math.floor((footY - oy) / p), rowT = .4 / (jBot - jTop), colT = .45 / (2.3 * R / p), outT = .4 / (1.2 * R / p);
  // feature cells: the work spinner runs along the crown arc (never below the eye line); the think marquee is a row above the eyes
  const arc = []; for (let i = 0; i < N; i++) { const dx = (CX[i] - footX) / R, dy = (CY[i] - cY) / R; if (dy < -.32 && Math.abs(Math.hypot(dx, dy) - .78) < pR * .55) arc.push({ i, a: Math.atan2(dy, dx) }); }
  arc.sort((a, b) => a.a - b.a);
  const marq = []; { const jm = Math.round((cY - .46 * R - oy) / p - .5); for (let i = 0; i < C; i++) { const x = (ox + (i + .5) * p - footX) / R; if (Math.abs(x) < .56) marq.push(jm * C + i); } }
  // --- state --------------------------------------------------------------------------------------
  const st = { reduced, energy, tint };
  let action = 'idle', tAction = 0, time = 0, baseKey = '', errBack = false, helloPhase = 0, flickK = -1, dirty = true, bg = null;
  let pointer = null, holeAt = { x: footX, y: cY - .5 * R }, ripple = -1;
  const q = v => Math.round(v / pR) * pR;   // quantise an R-unit length to whole dots
  const liftRows = Math.max(2, Math.round(.35 * R / p));
  const safeHole = (x, y, r) => { const lo = cY + EYE_BAND[0] * R - r, hi = cY + EYE_BAND[1] * R + r; return y > lo && y < hi ? lo : y; };   // never punch inside the eye band

  function poseFor(a, t) {
    const o = { dx: 0, dy: 0, sy: 1, lean: 0, eyeX: 0, eyeY: 0, open: 1, wide: 1, ring: 0 };
    if (a === 'hello') { o.dy = t >= .15 && t < .5 ? -liftRows : 0; o.wide = 1.1; o.eyeY = -.3; }
    if (a === 'listen') { o.dx = -1; o.lean = -.3; o.eyeX = -1; }
    if (a === 'think') { o.eyeX = -1; o.eyeY = -1; }
    if (a === 'work') { o.eyeY = 1; }
    if (a === 'success') { o.wide = 1.1; o.eyeY = -.6; o.ring = st.reduced ? 1 : 0; }
    if (a === 'error') { o.sy = t < 1.6 ? .42 : 1; o.eyeY = 1; o.eyeX = .2; }
    if (a === 'sleep') { o.sy = .86; o.open = 0; }
    if (a === 'tap') { o.wide = 1.06; o.ring = st.reduced ? 2 : 0; }   // reduced: a static hole stands in for the tap
    return o;
  }
  function rasterise(o) {            // silhouette + eyes → base[] (only when the quantised pose changes)
    const key = [o.dx, o.dy, o.sy.toFixed(3), o.lean, o.eyeX, o.eyeY, o.open, o.wide, o.ring].join();
    if (key === baseKey) return; baseKey = key; dirty = true;
    for (let i = 0; i < N; i++) {
      let v = 0;
      let lx = (CX[i] - o.dx * p - footX) / R; const yl = (CY[i] - o.dy * p - footY) / R / o.sy + FOOT;
      lx -= o.lean * ink.smooth(.1, 1, -yl) * .9;
      const a = Math.atan2(yl, lx), rr = Math.hypot(lx, yl);
      if (rr < ink.baseProfile(a) + .025 * ink.ringNoise(a / TAU, 6, seed, 2)) {
        v = 1;
        for (const e of EYES) {     // canonical ink.EYES geometry: paper disc, ink pupil shifted by whole dots
          const ex = e.x, ey = e.y, erx = e.rx * o.wide, ery = e.ry * o.wide;
          if (!o.open) { if (Math.abs(yl - ey) < pR * .5 && Math.abs(lx - ex) < erx) v = 0; continue; }
          const u = (lx - ex) / erx, w = (yl - ey) / ery;
          if (u * u + w * w < 1) {
            const gx = q(o.eyeX * erx * .42), gy = q(o.eyeY * ery * .35 + ery * .14), pu = (lx - ex - gx) / (e.prx * .8), pv = (yl - ey - gy) / (e.pry * .8);
            v = pu * pu + pv * pv < 1 ? 1 : 0;
          }
        }
      }
      if (o.ring === 1 && Math.abs(DC[i] - 1.45 * R / p) < .6) v = 1 - v;   // reduced success: one static ring of dots
      if (o.ring === 2 && Math.hypot(CX[i] - holeAt.x, CY[i] - holeAt.y) / p <= (hero ? 4 : 2)) v = 0;
      base[i] = v;
    }
    edges = []; for (let i = C; i < N - C; i++) if (base[i] && (!base[i - C] || !base[i + C] || !base[i - 1] || !base[i + 1])) edges.push(i);
  }
  function buildTarget(t) {          // base + animated features (crown spinner, marquee)
    target.set(base);
    if (action === 'work') { const n = arc.length, head = ((t / 4) % 1) * n * 1.25, len = n * .3; for (let k = 0; k < n; k++) { let d = head - k; if (d < 0) d += n * 1.25; if (d < len) target[arc[k].i] = 0; } }
    if (action === 'think') { const n = marq.length; if (n) for (let k = 0; k < 3; k++) target[marq[(Math.floor(t * 5) + k * 2) % n]] = 0; }
  }
  // wavefronts: delay[] in seconds per cell
  const setWave = fn => { for (let i = 0; i < N; i++) delay[i] = fn(i % C, (i / C) | 0, CX[i], CY[i]) + hcell[i] * .025; };
  const waveDown = (s = 1) => setWave((i, j) => Math.max(0, j - jTop) * rowT * s);
  const waveUp = (s = 1) => setWave((i, j) => Math.max(0, jBot - j) * rowT * s);
  const waveScan = () => setWave(i => i * colT);
  const waveOut = (x, y) => setWave((i, j, cx, cy) => Math.hypot(cx - x, cy - y) / p * outT);

  function wipe(x0, y0, x1, y1, rad, t0) {      // force dots near the segment to paper until t0 (+ stagger)
    const r = rad * p, dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1;
    const i0 = Math.max(0, Math.floor((Math.min(x0, x1) - r - ox) / p)), i1 = Math.min(C - 1, Math.ceil((Math.max(x0, x1) + r - ox) / p));
    const j0 = Math.max(0, Math.floor((Math.min(y0, y1) - r - oy) / p)), j1 = Math.min(RW - 1, Math.ceil((Math.max(y0, y1) + r - oy) / p));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * C + i, tt = clamp(((CX[k] - x0) * dx + (CY[k] - y0) * dy) / L2, 0, 1), d = Math.hypot(CX[k] - x0 - dx * tt, CY[k] - y0 - dy * tt);
      if (d <= r) { wipeUntil[k] = Math.max(wipeUntil[k], t0 + hcell[k] * .12); delay[k] = 0; }
    }
  }
  function hole(x, y, rad) {                   // tap: a hole that heals inward as a ring
    const r = rad * p;
    for (let k = 0; k < N; k++) { const d = Math.hypot(CX[k] - x, CY[k] - y); if (d <= r) { wipeUntil[k] = time + .3 + (r - d) / p * .05 + hcell[k] * .03; delay[k] = 0; } }
  }
  function snapAll() { for (let i = 0; i < N; i++) { wipeUntil[i] = 0; invA[i] = Infinity; due[i] = Infinity; phase[i] = -1; } ripple = -1; dirty = true; }

  const ctl = {
    cue(a) {
      if (!ACTION_IDS.includes(a)) return;
      action = a; tAction = 0; errBack = false; helloPhase = 0; dirty = true;
      if (st.reduced) { snapAll(); return; }
      if (a === 'hello') waveScan();
      else if (a === 'success') { ripple = time; waveDown(.5); }
      else if (a === 'tap') { const r = hero ? 4.5 : tiny ? 2.5 : 3; holeAt.y = safeHole(holeAt.x, holeAt.y, r * p); waveOut(holeAt.x, holeAt.y); hole(holeAt.x, holeAt.y, r); }
      else waveDown();
    },
    step(dt) {
      dt = clamp(dt, 0, .1); time += dt; tAction += dt;
      const red = st.reduced, tp = red ? .3 : tAction, o = poseFor(action, tp);
      // breath: the crown rises by exactly one row
      if (!red && (action === 'idle' || action === 'sleep')) { const b = Math.sin(time * TAU / (action === 'sleep' ? 5.2 : 3.4)) > 0 ? 1 : 0; o.sy += b * pR / 1.71; }
      if (action === 'hello' && !red) { if (tAction >= .15 && helloPhase === 0) { helloPhase = 1; waveDown(.3); } if (tAction >= .5 && helloPhase === 1) { helloPhase = 2; waveUp(.4); } }
      if (action === 'error' && tAction >= 1.6 && !errBack) { errBack = true; if (!red) waveUp(); }
      rasterise(o); buildTarget(red ? 0 : time);
      // idle flicker: one dot on the edge turns over now and then
      if (!red && !tiny && action === 'idle' && edges.length) { const k = Math.floor(time / .8); if (k !== flickK) { flickK = k; if (ink.rand(seed, k) < .5) { const i = edges[Math.floor(ink.rand(seed, k + 977) * edges.length)]; invA[i] = time; invB[i] = time + .3; } } }
      const now = time;
      for (let i = 0; i < N; i++) {
        let want = target[i]; if (now >= invA[i] && now < invB[i]) want = 1 - want; if (now < wipeUntil[i]) want = 0;
        if (red || tiny) { if (cur[i] !== want) { cur[i] = want; dirty = true; } continue; }
        if (phase[i] >= 0) { dirty = true; phase[i] += dt / FLIP; if (phase[i] >= 1) { phase[i] = -1; cur[i] = 1 - cur[i]; due[i] = cur[i] !== want ? now + .05 : Infinity; } continue; }
        if (cur[i] === want) { due[i] = Infinity; continue; }
        if (due[i] === Infinity) due[i] = now + delay[i];
        if (now >= due[i]) { phase[i] = 0; due[i] = Infinity; dirty = true; }
      }
      if (ripple >= 0) { dirty = true; if (now - ripple > 1.3) ripple = -1; }
      if (ONE_SHOT[action] && tAction > (red ? REDUCED_HOLD : ONE_SHOT[action])) { action = 'idle'; tAction = 0; if (!red) waveDown(); }
      if (dirty) draw();
    },
    setReduced(v) { st.reduced = !!v; if (st.reduced) snapAll(); },
    setEnergy(e) { st.energy = clamp(e, .5, 1.5); }, setTint(c) { st.tint = c; bg = null; dirty = true; },
    poke(x, y, kind) {
      if (kind === 'down') { pointer = { x, y }; if (ONE_SHOT[action]) { action = 'idle'; tAction = 0; } if (!st.reduced) { const r = hero ? 4 : 2; waveOut(x, y); wipe(x, safeHole(x, y, r * p), x, safeHole(x, y, r * p), r, time + .55); } }
      if (kind === 'move' && pointer && !st.reduced) { wipe(pointer.x, pointer.y, x, y, hero ? 3 : tiny ? 2 : 1.8, time + .55); pointer = { x, y }; }
      if (kind === 'up') pointer = null;
      if (kind === 'tap') { holeAt = { x, y }; ctl.cue('tap'); }
    },
    destroy() { for (const [ev, fn] of listeners) host.removeEventListener(ev, fn); canvas.remove(); },
  };
  const listeners = [
    ['pointerdown', e => ctl.poke(e.offsetX, e.offsetY, 'down')], ['pointermove', e => { if (pointer) ctl.poke(e.offsetX, e.offsetY, 'move'); }],
    ['pointerup', e => ctl.poke(e.offsetX, e.offsetY, 'up')], ['pointerleave', e => ctl.poke(e.offsetX, e.offsetY, 'up')],
  ];
  for (const [ev, fn] of listeners) host.addEventListener(ev, fn);

  // --- draw ----------------------------------------------------------------------------------------
  const inBody = i => { const dx = (CX[i] - footX) / R, dy = (CY[i] - cY) / R; return (dx * dx) / ((1.18 + pR) ** 2) + (dy * dy) / (((dy < 0 ? 1.08 : .7) + pR) ** 2) < 1; };   // body bounding ellipse + 1 dot
  function makeBg() {                     // paper + the faint paper-side rings inside the body's bounding ellipse (hero only), cached
    bg = document.createElement('canvas'); bg.width = W * dpr; bg.height = H * dpr; const c = bg.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (paper) ink.paper(c, W, H, { grain: 0 }); else c.clearRect(0, 0, W, H);
    if (hero) { c.strokeStyle = ink.inkColor(st.tint); c.globalAlpha = .05; c.lineWidth = Math.max(.6, p * .1); c.beginPath(); for (let i = 0; i < N; i++) if (inBody(i)) { c.moveTo(CX[i] + p * .38, CY[i]); c.arc(CX[i], CY[i], p * .38, 0, TAU); } c.stroke(); }
  }
  function draw() {
    dirty = false;
    if (!bg) makeBg();
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bg, 0, 0); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const color = ink.inkColor(st.tint); ctx.fillStyle = color; ctx.strokeStyle = color;
    if (tiny) { ctx.beginPath(); for (let i = 0; i < N; i++) if (cur[i]) ctx.rect(CX[i] - .5, CY[i] - .5, 1, 1); ctx.fill(); return; }
    const r = p * .46;
    if (ripple >= 0) {                                  // success: a ring of highlighted paper-side discs runs outward; the body stays on
      const rad = (time - ripple) * 36, wdt = 2.2; ctx.globalAlpha = .38; ctx.lineWidth = Math.max(.7, p * .16); ctx.beginPath();
      for (let i = 0; i < N; i++) if (!cur[i] && Math.abs(DC[i] - rad) < wdt) { ctx.moveTo(CX[i] + r * .8, CY[i]); ctx.arc(CX[i], CY[i], r * .8, 0, TAU); }
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    ctx.beginPath();
    for (let i = 0; i < N; i++) if (phase[i] < 0 && cur[i]) { ctx.moveTo(CX[i] + r, CY[i]); ctx.arc(CX[i], CY[i], r, 0, TAU); }
    ctx.fill();
    for (let i = 0; i < N; i++) if (phase[i] >= 0) {       // flipping discs: horizontal radius scaled by |cos(π·phase)|, colour swaps at the midpoint
      const side = phase[i] < .5 ? cur[i] : 1 - cur[i], rx = Math.max(.4, r * Math.abs(Math.cos(Math.PI * phase[i])));
      ctx.beginPath(); ctx.ellipse(CX[i], CY[i], rx, r, 0, 0, TAU);
      if (side) ctx.fill(); else { ctx.globalAlpha = .22; ctx.lineWidth = Math.max(.6, p * .1); ctx.stroke(); ctx.globalAlpha = 1; }
    }
  }
  // first frame: the board already shows idle
  rasterise(poseFor('idle', 0)); buildTarget(0); cur.set(target);
  draw();
  return ctl;
}

/* Round-5 · 03 — TIDE (memory). A wet ink body on a paper that remembers: everything the body does deposits ink into a diffusion field
 * that spreads and slowly evaporates, so the last few seconds are visible as a stain around Nibbi. Error stains longest. */
import * as ink from '../../ink.mjs';
import { ACTION_IDS } from '../../actions.mjs';
const { clamp, mix, TAU, FOOT } = ink;

export const meta = {
  id: 'tide', name: 'Tide', faculty: 'memory',
  technique: 'a 72 × 76 diffusion–evaporation field under a spring-posed wet ink body: the body deposits ink where it is, the field blurs and fades, error and touch write into a slower second field',
  tagline: 'Wet ink that leaves a tide line: where Nibbi has just been, what it just heard, and what went wrong stay on the paper for a while.',
  look: 'A dense wet body with a soft edge, sitting in a pale halo of its own recent positions; a listening lean leaves a lean-shaped stain, a drip leaves a mark that outlasts everything else.',
  motion: 'Simple spring poses (lean, hook, squash, one hop) — the memory is the point. Fast field: ~4 s to fade. Slow field: ~40 s. Sleep dries the paper and sharpens the edge; work keeps it wet.',
  eyes: 'Canonical whites and pupils as dry islands in the wet body; the whites are the only thing that never bleeds.',
  thoughtful: [
    'listen: leans toward the person and the lean leaves a stain — you can see it has been listening even after it straightens',
    'error: the drip stains the paper and stays for half a minute; the body straightens but the mark does not pretend it did not happen',
    'success: one hop leaves a ring on the paper that soaks in slowly — the win is allowed to linger without being repeated',
    'touch: your finger writes a wet trail into the paper that soaks in over ten seconds; it does not vanish when you let go',
    'sleep: the halo dries and the edge sharpens — a body that has stopped taking anything in',
  ],
  risks: ['a halo of past positions can read as blur or dirt rather than memory', 'the slow field is invisible at 24 px, so memory only shows at pill size and above', 'the pose grammar is deliberately plain; without the halo it is the round-1 inkdrop'],
  stills: { idle: 2, hello: .7, listen: 1.6, think: 1.5, work: 1.6, success: .9, error: 1.4, sleep: 2.4, tap: .4 },
};

const PERSON = [-.9, .2], WORK = [.2, .85], RECALL = [-.7, -.85], AHEAD = [0, .1], FAIL = [.75, .8];
const BEAT = .16, ONE = { hello: 1.6, success: 2.2, error: 3.0, tap: .9 }, REDUCED_HOLD = 3;
const GW = 72, GH = 76;

export function mount(host, { R = 96, seed = 1, tint = null, reduced = false, energy = 1, size = 'hero', paper = true } = {}) {
  const W = Math.round(3.4 * R), H = Math.round(3.6 * R), footX = 1.7 * R, footY = 3.1 * R;
  host.style.width = W + 'px'; host.style.height = H + 'px'; host.style.position = 'relative';
  const dpr = Math.min(2, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1));
  const canvas = document.createElement('canvas'); canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.cssText = `display:block;width:${W}px;height:${H}px;touch-action:none`;
  host.appendChild(canvas); const ctx = canvas.getContext('2d');
  const hero = size === 'hero', tiny = size === 'tiny';
  const st = { reduced, energy, tint };
  let action = 'idle', tA = 0, time = 0, rc = 0, pressed = false, pressT = 0, finger = { x: 0, y: -.3 }, lastFinger = null, slowTick = 0;
  const sp = v => ({ x: v, v: 0, t: v });
  const S = { x: sp(0), sx: sp(1), sy: sp(1), lean: sp(0), drop: sp(0) }; let lift = 0, wet = 1;
  const gaze = { x: 0, y: .1, tx: 0, ty: .1 }, eye = { blinkT: 1, nextBlink: 3, happy: 0, wide: 1, lid: .08 };
  // fields (grid units: cell = W/GW px)
  const fast = new Float32Array(GW * GH), slow = new Float32Array(GW * GH), tmp = new Float32Array(GW * GH), mask = new Float32Array(GW * GH);
  const field = document.createElement('canvas'); field.width = GW; field.height = GH; const fctx = field.getContext('2d'); const img = fctx.createImageData(GW, GH);
  const cell = W / GW;
  // silhouette profile for the mask (polar, star-shaped about the body centre)
  const PROF = 72; const prof = new Float32Array(PROF);
  function profile(lean, drop, t) { const pts = ink.blobPoints(1, { seed, rough: .04, time: t, lean, drop, n: PROF }); for (let i = 0; i < PROF; i++) prof[i] = Math.hypot(pts[i].x, pts[i].y); }

  function wants(a, t, tm, e) {
    const w = { x: 0, sx: 1, sy: 1, lean: 0, drop: 0, lift: 0, place: AHEAD, lid: .08, happy: 0, wide: 1, evap: .009, deposit: 1, sharp: 0 };
    const breath = Math.sin(tm / 6 * TAU);
    switch (a) {
      case 'idle': w.sy = 1 + .012 * breath; break;
      case 'listen': w.x = -.1 * e; w.lean = -.18 * e; w.sy = .98; w.sx = 1.02; w.place = PERSON; w.lid = 0; w.wide = 1.04; w.deposit = 1; break;
      case 'think': w.lean = .14 * e + .02 * Math.sin(tm * .7); w.drop = .35; w.sy = 1.05; w.sx = .97; w.x = .03; w.place = RECALL; w.lid = .42; break;
      case 'work': w.sy = .93 + .012 * Math.sin(tm * TAU / 2.6); w.sx = 1.05; w.lean = .03; w.place = WORK; w.lid = .3; w.evap = .005; w.deposit = 1; break;
      case 'hello': w.place = PERSON; w.lid = 0; w.wide = 1.06; w.lean = -.06; w.lift = ink.bell((t - .18) / .5) * .34 * e; w.sy = t < .18 ? 1 : t < .28 ? .9 : t < .6 ? 1.08 : 1; break;
      case 'success': w.place = t < 1.2 ? [0, -.3] : PERSON; w.lid = 0; w.happy = t > .3 ? .85 : 0; w.wide = 1.06; w.lift = ink.bell((t - .18) / .62) * .58 * e; w.sy = t < .18 ? 1 : t < .26 ? .9 : t < .8 ? 1.14 : t < .98 ? .94 : 1; w.sx = t < .8 && t >= .26 ? .92 : t < .98 ? 1.05 : 1; break;
      case 'error': w.place = t < 1.1 ? FAIL : PERSON; w.lid = t < 1.1 ? .35 : .2; if (t < 2.4) { w.sy = .9; w.sx = 1.06; w.lean = .05; w.x = .02; } break;
      case 'sleep': w.place = [0, .3]; w.lid = 1; w.sy = .8 + .012 * breath; w.sx = 1.12; w.evap = .03; w.deposit = .35; w.sharp = 1; break;
      case 'tap': w.place = null; w.lid = 0; w.wide = 1.04; if (t >= .12 && t < .3) { w.sy = .84; w.sx = 1.09; } else if (t < .5) { w.sy = 1.05; w.sx = .97; } break;
    }
    return w;
  }
  function snapTo(w) { S.x.x = S.x.t = w.x; S.sx.x = S.sx.t = w.sx; S.sy.x = S.sy.t = w.sy; S.lean.x = S.lean.t = w.lean; S.drop.x = S.drop.t = w.drop; for (const k in S) S[k].v = 0; lift = 0; const p = w.place || [clamp(finger.x * 1.2, -1, 1), clamp(finger.y * 1.5, -1, 1)]; gaze.x = gaze.tx = p[0]; gaze.y = gaze.ty = p[1]; eye.lid = w.lid; eye.happy = w.happy; eye.wide = w.wide; eye.blinkT = 1; wet = 1 - w.sharp; }
  function relax() {
    const w = wants(action, meta.stills[action], 0, st.energy); snapTo(w);
    fast.fill(0); slow.fill(0); rasterise(0);
    for (let i = 0; i < 40; i++) diffuse(fast, .009, 1); // a settled halo for this pose, then frozen
    if (action === 'error') { drip(1); for (let i = 0; i < 3; i++) diffuse(slow, .006, 0); }
    if (action === 'success') { ring(1); for (let i = 0; i < 2; i++) diffuse(slow, .006, 0); }
  }
  // --- field helpers ------------------------------------------------------------------------------------------
  function rasterise(tm) {
    profile(S.lean.x, S.drop.x, tm);
    const cx = footX + S.x.x * R, cy = footY - Math.max(0, lift) * R - FOOT * R * S.sy.x, rx = R * S.sx.x, ry = R * S.sy.x;
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const px = (i + .5) * cell - cx, py = (j + .5) * cell - cy; const nx = px / rx, ny = py / ry; const d = Math.hypot(nx, ny);
      const a = Math.atan2(ny, nx); const k = ((a / TAU) % 1 + 1) % 1 * PROF; const i0 = Math.floor(k) % PROF, i1 = (i0 + 1) % PROF; const r = mix(prof[i0], prof[i1], k - Math.floor(k));
      mask[j * GW + i] = clamp((r - d) * 9 + .5, 0, 1);
    }
  }
  function diffuse(F, evap, deposit) {
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const k = j * GW + i, l = i > 0 ? k - 1 : k, r = i < GW - 1 ? k + 1 : k, u = j > 0 ? k - GW : k, d = j < GH - 1 ? k + GW : k;
      tmp[k] = F[k] * .5 + (F[l] + F[r] + F[u] + F[d]) * .125;
    }
    for (let k = 0; k < GW * GH; k++) { let v = tmp[k] * (1 - evap); if (deposit > 0) v = Math.max(v, mask[k] * deposit); F[k] = v; }
  }
  function stamp(F, gx, gy, rad, amount) { const x0 = Math.max(0, Math.floor(gx - rad)), x1 = Math.min(GW - 1, Math.ceil(gx + rad)), y0 = Math.max(0, Math.floor(gy - rad)), y1 = Math.min(GH - 1, Math.ceil(gy + rad)); for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) { const d = Math.hypot(i - gx, j - gy) / rad; if (d < 1) { const k = j * GW + i; F[k] = Math.max(F[k], amount * (1 - d * d)); } } }
  function drip(strength) { const gx = (footX + (S.x.x + .46) * R) / cell, gy = (footY - .12 * R) / cell; for (let s = 0; s < 8; s++) stamp(slow, gx + s * .12, gy + s * 1.05, 2.3 - s * .1, strength * (1 - s * .06)); }
  function ring(strength) { const gx = (footX + S.x.x * R) / cell, gy = (footY - .05 * R) / cell, rr = (1.05 * R) / cell; for (let a = 0; a < 80; a++) { const t = a / 80 * TAU; stamp(slow, gx + Math.cos(t) * rr, gy + Math.sin(t) * rr * .3, 2.1, strength * .6); } }

  const ctl = {
    cue(a) {
      if (!ACTION_IDS.includes(a)) return;
      action = a; tA = 0;
      if (st.reduced) { relax(); return; }
      const w = wants(a, 0, time, st.energy); if (w.place) { gaze.tx = w.place[0]; gaze.ty = w.place[1]; }
    },
    step(dt) {
      dt = clamp(dt, 0, .1); if (dt <= 0) { draw(); return; }
      tA += dt;
      if (ONE[action] && tA > (st.reduced ? REDUCED_HOLD : ONE[action])) { action = 'idle'; tA = 0; if (st.reduced) relax(); }
      if (!st.reduced) {
        time += dt;
        const e = st.energy, w = wants(action, tA, time, e);
        if (tA >= BEAT) { S.x.t = w.x + (pressed ? clamp(finger.x * .2, -.15, .15) : 0); S.sx.t = pressed ? 1.07 : w.sx; S.sy.t = pressed ? .86 : w.sy; S.lean.t = w.lean + (pressed ? finger.x * .3 : 0); S.drop.t = w.drop; lift = w.lift; }
        { const n = Math.max(1, Math.ceil(dt * 120)), h = dt / n; for (let i = 0; i < n; i++) for (const key in S) { const s = S[key]; s.v += (150 * (s.t - s.x) - 19 * s.v) * h; s.x += s.v * h; } }
        wet = mix(wet, 1 - w.sharp, 1 - Math.exp(-dt * 1.2));
        // memory: the body writes itself into the fast field; marks into the slow one
        rasterise(time);
        const passes = Math.max(1, Math.min(6, Math.round(dt * 60)));   // the field evolves per second, not per frame
        for (let i = 0; i < passes; i++) diffuse(fast, w.evap, w.deposit);
        if (action === 'error' && tA >= .7 && tA - dt < .7) drip(1);
        if (action === 'success' && tA >= .82 && tA - dt < .82) ring(1);
        if (pressed && lastFinger) { const gx = (footX + finger.x * R) / cell, gy = (footY - FOOT * R + finger.y * R) / cell; stamp(slow, gx, gy, 2.1, .9); }
        slowTick += passes; if (slowTick >= 8) { slowTick -= 8; diffuse(slow, .006, 0); }   // the slow field spreads and fades an order of magnitude slower
        // eyes
        if (w.place) { gaze.tx = w.place[0]; gaze.ty = w.place[1]; }
        if (pressed || action === 'tap') { gaze.tx = clamp(finger.x * 1.2, -1, 1); gaze.ty = clamp(finger.y * 1.5, -1, 1); }
        const k = 1 - Math.exp(-dt * 14); gaze.x = mix(gaze.x, gaze.tx, k); gaze.y = mix(gaze.y, gaze.ty, k);
        const kl = 1 - Math.exp(-dt * 9); eye.lid = mix(eye.lid, w.lid, kl); eye.happy = mix(eye.happy, w.happy, kl); eye.wide = mix(eye.wide, w.wide, kl);
        if (action !== 'sleep' && time >= eye.nextBlink) { eye.blinkT = 0; eye.nextBlink = time + 3 + 3 * ink.rand(seed, rc++); }
        eye.blinkT = Math.min(1, eye.blinkT + dt / (action === 'listen' ? .36 : .15));
        lastFinger = pressed ? { ...finger } : null;
      }
      draw();
    },
    setReduced(v) { st.reduced = !!v; if (st.reduced) relax(); },
    setEnergy(e) { st.energy = clamp(e, .5, 1.5); }, setTint(c) { st.tint = c; },
    poke(x, y, kind) {
      finger = { x: (x - footX) / R, y: (y - (footY - FOOT * R)) / R };
      if (kind === 'down') { pressed = true; pressT = time; lastFinger = { ...finger }; if (st.reduced) relax(); }
      else if (kind === 'up') { const short = pressed && time - pressT < .25; pressed = false; lastFinger = null; if (short) ctl.poke(x, y, 'tap'); else if (!st.reduced) S.sy.v += 1.6 * st.energy; }
      else if (kind === 'tap') { action = 'tap'; tA = 0; if (!st.reduced) { const gx = (footX + finger.x * R) / cell, gy = (footY - FOOT * R + finger.y * R) / cell; stamp(slow, gx, gy, 3, 1); } else relax(); }
    },
    destroy() { for (const [ev, fn] of listeners) host.removeEventListener(ev, fn); canvas.remove(); },
  };
  const listeners = [
    ['pointerdown', e => ctl.poke(e.offsetX, e.offsetY, 'down')], ['pointermove', e => { if (pressed) ctl.poke(e.offsetX, e.offsetY, 'move'); }],
    ['pointerup', e => ctl.poke(e.offsetX, e.offsetY, 'up')], ['pointerleave', e => { if (pressed) ctl.poke(e.offsetX, e.offsetY, 'up'); }],
  ];
  for (const [ev, fn] of listeners) host.addEventListener(ev, fn);

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (paper) ink.paper(ctx, W, H, { grain: 0 }); else ctx.clearRect(0, 0, W, H);
    const color = ink.inkColor(st.tint); const rgb = hexRGB(color);
    // the halo: fast field (recent positions) + slow field (marks), as a light stain, feathered by the grid upscale
    const d = img.data; const haloA = tiny ? .3 : .34;
    for (let k = 0; k < GW * GH; k++) {
      const f = fast[k], s = slow[k];
      const fibre = .7 + .6 * ink.hash(k * 1.7 + seed);   // ink soaks into paper fibres unevenly
      const stain = clamp((ink.smooth(.02, .5, f) * haloA * wet + ink.smooth(.02, .55, s) * .6) * fibre, 0, 1);
      const o = k * 4; d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2]; d[o + 3] = Math.round(stain * 255);
    }
    fctx.putImageData(img, 0, 0);
    ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(field, 0, 0, GW, GH, 0, 0, W, H); ctx.restore();
    // the wet body
    ctx.save();
    ink.poseTransform(ctx, footX, footY, R, { x: S.x.x, lift: Math.max(0, lift), sx: S.sx.x, sy: S.sy.x, rotate: 0 });
    ctx.translate(0, -FOOT * R);
    const pts = ink.blobPoints(R, { seed, rough: .04, time: st.reduced ? 0 : time, lean: S.lean.x, drop: S.drop.x });
    ink.fuzzyFill(ctx, pts, { color, R, soft: (hero ? .09 : size === 'pill' ? .05 : 0) * wet + (hero ? .015 : 0), tufts: 0, seed });
    const open = 1 - ink.bell(eye.blinkT), sleeping = action === 'sleep' || eye.lid >= .99;
    const geo = ink.eyes(ctx, R, { eyeX: gaze.x, eyeY: gaze.y, blink: sleeping ? 1 : 1 - open, wide: eye.wide, happy: eye.happy }, { ink: color });
    if (sleeping) { ctx.strokeStyle = '#fbfaf7'; ctx.lineWidth = Math.max(1, R * .03); ctx.lineCap = 'round'; for (const g of geo) { ctx.beginPath(); ctx.moveTo(g.cx - g.rx * .8, g.cy); ctx.quadraticCurveTo(g.cx, g.cy + g.rx * .35, g.cx + g.rx * .8, g.cy); ctx.stroke(); } }
    else if (eye.lid > .03 && !(tiny && eye.lid < .3)) { ctx.fillStyle = color; for (const g of geo) { ctx.save(); ctx.beginPath(); ctx.ellipse(g.cx, g.cy, g.rx, g.ry, 0, 0, TAU); ctx.clip(); const ry0 = ink.EYES[0].ry * R * eye.wide; ctx.beginPath(); ctx.ellipse(g.cx, g.cy - ry0 * (2.1 - 1.6 * eye.lid), g.rx * 1.25, ry0 * 1.05, 0, 0, TAU); ctx.fill(); ctx.restore(); } }
    ctx.restore();
  }
  if (st.reduced) relax(); else { rasterise(0); for (let i = 0; i < 30; i++) diffuse(fast, .009, 1); }
  draw();
  return ctl;
}
function hexRGB(css) { const m = /^#([0-9a-f]{6})$/i.exec(css || ''); if (!m) return [22, 21, 20]; const n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }

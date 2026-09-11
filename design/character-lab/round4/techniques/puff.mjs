/* Round-4 technique: POM-POM. Nibbi is a soft ink core (baseProfile blob) with a short fuzz of hair strands rooted on its edge.
 * Each strand is a Verlet chain that wants to stand a little out from the core, biased slightly down and back; gravity, drag,
 * a slow wind and the pointer bend it. The core is a spring-driven body that hops, leans and slumps; the fur lags behind it,
 * so every motion gets secondary motion for free. The eyes are a bald patch: no strand is rooted in or grows across them. */
import * as ink from '../../ink.mjs';
import { ACTION_IDS } from '../../actions.mjs';
const { clamp, mix, TAU, FOOT } = ink;

export const meta = {
  id: 'puff', name: 'Pom-pom',
  technique: 'strand physics: hundreds of Verlet hair chains rooted on a spring-driven soft ink core',
  tagline: 'A pom-pom of ink hair on a soft core: it stands on end, gets wet and can be combed with a finger.',
  look: 'A Nibbi blob (wider than tall, flat bottom) with a fuzzy edge of short tapered ink strokes, thick at the root and hairline at the tip; two bald patches leave the big white eyes clear.',
  motion: 'Hero ≈ 360 strands, pill ≈ 140, tiny ≈ 60; each a 5-point Verlet chain with a stiffness pull toward its rest direction (outward, biased down and back), gravity, air drag, an ink.noise1 wind, floor collision at the foot line and pointer repulsion. Cues only change gravity, stiffness, wind, rest directions or give the core an impulse: the fur flops on landing, streams in wind, clumps when wet and springs back after a touch.',
  eyes: 'A bald patch: strands whose rest path would cross either eye are never grown, so the two white eyes with dark pupils sit in clearings of the fur; the eyes ride the core and gaze per moment.',
  fun: ['drag through the fur: the finger combs a parting along its path and the hair springs back with a wobble', 'press the core and drag: the whole puff is carried along, fur trailing behind', 'tap: the hair at the touch point parts away and bounces back', 'success: the puff — every strand stands on end and lengthens, then relaxes', 'error: wet dog — the fur clumps and hangs, the core slumps, a drip or two falls', 'listen: a wind from the right streams the fur toward the person'],
  risks: ['dense hair can read as a scribble at pill size', 'strong wind or fast drags can push strands across the eyes', 'stills are emergent, so timing is approximate', 'at 24 px the strands are sub-pixel and a filled silhouette carries the shape'],
  stills: { idle: 2, hello: .55, listen: 1.4, think: 1.4, work: 1.7, success: .5, error: 1.0, sleep: 2, tap: .2 },
};

const K = 5, ONE_SHOT = { hello: 1.6, success: 1.7, error: 3.8, tap: .9 }, REDUCED_HOLD = 3, CORE = .8, ERR_HOLD = 1.2, MAXL = .3;

export function mount(host, { R = 96, seed = 1, tint = null, reduced = false, energy = 1, size = 'hero', paper = true } = {}) {
  const W = Math.round(3.4 * R), H = Math.round(3.6 * R), footX = 1.7 * R, footY = 3.1 * R, cY = footY - FOOT * R;
  host.style.width = W + 'px'; host.style.height = H + 'px'; host.style.position = 'relative';
  const dpr = Math.min(2, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1));
  const canvas = document.createElement('canvas'); canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.cssText = `display:block;width:${W}px;height:${H}px;touch-action:none`;
  host.appendChild(canvas); const ctx = canvas.getContext('2d');
  const hero = size === 'hero', tiny = size === 'tiny';

  // --- core outline + strands: built once. Units are R, origin at the body centre, y down, floor at y = FOOT. ---------
  const outline = ink.blobPoints(CORE, { n: 40, seed, rough: .025 });          // the core is a Nibbi blob (baseProfile), ~.8R
  const B = Math.max(...outline.map(p => p.y));                                // core bottom (≈ the foot line)
  const want = hero ? 360 : tiny ? 60 : 140;
  const ang = [], rx = [], ry = [], seg = [], crown = [];                       // per strand: rest angle, root offset, segment length, top-ness
  for (let i = 0, tries = 0; i < want && tries < want * 4; tries++) {
    const a = (tries / want + ink.rand(seed, tries) * .004) * TAU, ca = Math.cos(a), sa = Math.sin(a);
    const rr = ink.baseProfile(a) * CORE * (.93 + .1 * ink.rand(seed, tries + 900));   // root on the core edge (a little inside/outside)
    let L = Math.min(MAXL, ink.baseProfile(a) * (1.02 + .1 * ink.rand(seed, tries + 1800)) - rr);
    if (sa > 0) L = Math.min(L, (FOOT - .02) / sa - rr);                      // flat bottom: the fur never grows through the floor
    if (L < .05) continue;
    let bald = false;                                                          // bald patch: reject roots whose rest path crosses an eye
    for (let k = 0; k <= K && !bald; k++) { const x = ca * (rr + L * k / K), y = sa * (rr + L * k / K); for (const e of ink.EYES) { const dx = (x - e.x) / (e.rx * 1.22), dy = (y - e.y) / (e.ry * 1.22); if (dx * dx + dy * dy < 1) bald = true; } }
    if (bald) continue;
    ang.push(a); rx.push(ca * rr); ry.push(sa * rr); seg.push(L / (K - 1)); crown.push(clamp(-sa, 0, 1)); i++;
  }
  const N = ang.length, X = new Float64Array(N * K), Y = new Float64Array(N * K), PX = new Float64Array(N * K), PY = new Float64Array(N * K);
  const dirX = new Float64Array(N), dirY = new Float64Array(N), gust = new Float64Array(N), lenMul = new Float64Array(N).fill(1), stiffMul = new Float64Array(N).fill(1);
  let ant = 0; { let best = 9; for (let i = 0; i < N; i++) { const d = Math.abs(ang[i] - TAU * .73); if (d < best) { best = d; ant = i; } } }   // the think antenna: a crown strand, a little left

  // --- state ----------------------------------------------------------------------------------------------
  const st = { reduced, energy, tint };
  let action = 'idle', tAction = 0, time = 0;
  const core = { x: 0, y: 0, vx: 0, vy: 0, air: false };
  const IDLE = { stiff: .24, grav: .4, drag: 3.5, windAmp: .25, wind: 0, lean: 0, tilt: 0, droop: 0, len: 1, coreY: 0, coreX: 0, sq: 1, sw: 1, ant: 0, eyeX: 0, eyeY: 0, blink: 0, wide: 1, happy: 0 };
  const T = { ...IDLE }, face = { eyeX: 0, eyeY: 0, blink: 0, wide: 1, happy: 0 };
  let ptr = { x: 0, y: 0, down: false, grab: false, vx: 0, vy: 0 }, part = null, drips = [];

  function targetsFor(a, t) {
    const o = { ...IDLE };
    if (a === 'hello') { o.eyeY = -.25; o.wide = 1.06; o.windAmp = .2; }
    if (a === 'listen') { o.wind = -4; o.lean = -.5; o.tilt = -.16; o.coreX = -.12; o.eyeX = -.6; o.windAmp = .5; o.stiff = .2; }
    if (a === 'think') { o.eyeX = -.55; o.eyeY = -.75; o.stiff = .3; o.windAmp = .1; o.lean = .08; o.ant = 1; }
    if (a === 'work') { o.eyeY = .5; o.wide = .96; o.windAmp = .12; o.stiff = .32; }
    if (a === 'success') { const p = t < .5 ? 1 : 0; o.stiff = p ? 1 : .4; o.grav = p ? 0 : .4; o.len = p ? 1.6 : 1; o.eyeY = -.3; o.wide = 1.05; o.happy = t < .9 ? .35 : 0; o.windAmp = 0; }
    if (a === 'error') {                                                      // wet dog for the hold, then ease back over ~2.6 s; never above idle length/stiffness
      const w = 1 - ink.smooth(ERR_HOLD, ERR_HOLD + 2.6, t);
      o.grav = mix(.4, 2, w); o.stiff = mix(.24, .07, w); o.droop = .85 * w; o.len = mix(1, .9, w); o.sq = mix(1, .84, w); o.sw = mix(1, 1.06, w);
      o.eyeY = mix(0, .85, w); o.eyeX = .1 * w; o.wide = mix(1, .9, w); o.windAmp = .25 * (1 - w); o.drag = mix(3.5, 5, w);
    }
    if (a === 'sleep') { o.grav = 1; o.stiff = .2; o.droop = .8; o.len = .9; o.sq = .6; o.sw = 1.16; o.blink = 1; o.windAmp = 0; o.drag = 6; }
    if (a === 'tap') { o.wide = 1.08; o.blink = t < .1 ? 1 : 0; o.windAmp = .15; }
    return o;
  }
  const rootX = i => core.x + rx[i] * T.sw, rootY = i => core.y + B + (ry[i] - B) * T.sq;   // roots follow the (squashed) core; the core bottom stays put

  // --- simulation -----------------------------------------------------------------------------------------
  function restDirs() {                                                        // rest direction per strand: outward, biased down + back, lean/tilt, think antenna, work ripple band
    const band = action === 'work' && !st.reduced ? mix(-1, .75, ink.fract(tAction / .8)) : 9, e = st.energy;
    for (let i = 0; i < N; i++) {
      const a = ang[i] + T.tilt * e, ca = Math.cos(a), sa = Math.sin(a);
      let dx = ca + .12 + T.lean * e * (.8 * crown[i] + .5), dy = sa + .22 - Math.abs(T.lean) * .2 * (1 - crown[i]);
      dx = mix(dx, 0, T.droop * .55); dy = mix(dy, 1, T.droop);
      let lm = 1, sm = 1;
      if (band < 9) { const d = Math.abs(ry[i] - band); if (d < .22) { const w = 1 - d / .22; lm += .6 * w; sm += 2 * w; dx -= .12 * w * ca; dy -= .22 * w; } }
      if (i === ant && T.ant > .01) { lm += 2.6 * T.ant; sm = 1 + 4 * T.ant; dx = mix(dx, -.12, T.ant); dy = mix(dy, -1, T.ant); }
      const l = Math.hypot(dx, dy) || 1; dirX[i] = dx / l; dirY[i] = dy / l; lenMul[i] = lm; stiffMul[i] = sm;
    }
  }
  function simulate(dt) {
    const SUB = 2, h = dt / SUB, e = st.energy;
    restDirs();
    const stiff0 = 1 - Math.pow(1 - T.stiff, h * 60), G = T.grav * 4.5;
    for (let i = 0; i < N; i++) gust[i] = T.wind * e + T.windAmp * e * (ink.noise1(time * .45 + ang[i] * .9, seed) + .4 * ink.noise1(time * 1.1 - ang[i] * 2.1, seed + 5));
    for (let s = 0; s < SUB; s++) {
      // core: spring to its target, gravity when airborne, floor at y = 0
      if (ptr.grab) { core.vx += (ptr.x - core.x) * 90 * h - core.vx * 9 * h; core.vy += (ptr.y - .1 - core.y) * 90 * h - core.vy * 9 * h; }
      else { core.vx += ((T.coreX * e - core.x) * 40 - core.vx * 8) * h; if (core.air || core.y < -.001) { core.vy += 9 * h; core.air = true; } else core.vy += ((T.coreY - core.y) * 40 - core.vy * 8) * h; }
      core.x += core.vx * h; core.y += core.vy * h;
      if (core.air && core.y >= 0) { core.y = 0; core.vy = core.vy > 1.5 ? -core.vy * .18 : 0; if (core.vy === 0) core.air = false; }
      core.x = clamp(core.x, -.9, .9); core.y = clamp(core.y, -1.8, .25);
      for (let i = 0; i < N; i++) {
        const b = i * K, L = seg[i] * T.len * lenMul[i], dx0 = dirX[i], dy0 = dirY[i], g = gust[i], stiff = Math.min(1, stiff0 * stiffMul[i]);
        X[b] = rootX(i); Y[b] = rootY(i);
        for (let k = 1; k < K; k++) {
          const j = b + k, f = k / (K - 1);
          let vx = (X[j] - PX[j]) * (1 - T.drag * h), vy = (Y[j] - PY[j]) * (1 - T.drag * h);
          let ax = g * 2.2 * f, ay = G * f;
          if (ptr.down && !ptr.grab) { const ddx = X[j] - ptr.x, ddy = Y[j] - ptr.y, d2 = ddx * ddx + ddy * ddy; if (d2 < .16) { const d = Math.sqrt(d2) || .01, p = (1 - d / .4) * 60; ax += ddx / d * p + ptr.vx * 4; ay += ddy / d * p + ptr.vy * 4; } }
          if (part) { const ddx = X[j] - part.x, ddy = Y[j] - part.y, d2 = ddx * ddx + ddy * ddy; if (d2 < .2) { const d = Math.sqrt(d2) || .01, p = part.s * (1 - d / .45); ax += ddx / d * p; ay += ddy / d * p; } }
          const vl = Math.hypot(vx, vy), vmax = 5 * h; if (vl > vmax) { vx *= vmax / vl; vy *= vmax / vl; }
          const nx = X[j] + vx + ax * h * h, ny = Y[j] + vy + ay * h * h;
          PX[j] = X[j]; PY[j] = Y[j]; X[j] = nx; Y[j] = ny;
        }
        // constraints: stiffness toward the rest chain, then fixed segment length (root side is heavier)
        for (let k = 1; k < K; k++) {
          const j = b + k, f = k / (K - 1), dd = T.droop * f;
          let ddx = mix(dx0, 0, dd), ddy = mix(dy0, 1, dd); const dl = Math.hypot(ddx, ddy) || 1;
          const txp = X[j - 1] + ddx / dl * L, typ = Y[j - 1] + ddy / dl * L, sk = stiff * (1 - .35 * f);
          X[j] += (txp - X[j]) * sk; Y[j] += (typ - Y[j]) * sk;
          const ex = X[j] - X[j - 1], ey = Y[j] - Y[j - 1], el = Math.hypot(ex, ey) || 1e-6, c = (L - el) / el;
          X[j] += ex * c; Y[j] += ey * c;
          if (Y[j] > FOOT) { Y[j] = FOOT; PX[j] = mix(PX[j], X[j], .5); }
          X[j] = clamp(X[j], -1.65, 1.65); Y[j] = Math.max(Y[j], -2.9);
        }
      }
      if (part && (part.t -= h) <= 0) part = null;
    }
  }
  function pose() {                                                            // deterministic still: every strand on its rest chain, core at its target
    core.x = T.coreX * st.energy; core.y = T.coreY; core.vx = core.vy = 0; core.air = false; restDirs();
    for (let i = 0; i < N; i++) {
      const b = i * K, L = seg[i] * T.len * lenMul[i]; X[b] = rootX(i); Y[b] = rootY(i);
      for (let k = 1; k < K; k++) { const j = b + k, dd = T.droop * k / (K - 1); let ddx = mix(dirX[i], 0, dd), ddy = mix(dirY[i], 1, dd); const dl = Math.hypot(ddx, ddy) || 1; X[j] = X[j - 1] + ddx / dl * L; Y[j] = Math.min(FOOT, Y[j - 1] + ddy / dl * L); }
    }
    PX.set(X); PY.set(Y);
  }
  function relax() {                                                           // reduced motion: one deterministic pose per moment
    Object.assign(T, targetsFor(action, .5));
    if (action === 'success') T.len = 1.6; if (action === 'listen') T.lean = -.8;
    if (action === 'hello') { T.coreY = -.3; T.droop = .35; T.len = 1.05; } if (action === 'tap') { T.len = 1.12; T.wide = 1.08; }
    if (action === 'work') { T.len = 1.15; T.droop = .12; }
    Object.assign(face, pick(T)); drips = []; part = null; pose();
  }
  const pick = t => ({ eyeX: t.eyeX, eyeY: t.eyeY, blink: t.blink, wide: t.wide, happy: t.happy });

  const ctl = {
    cue(a) {
      if (!ACTION_IDS.includes(a)) return;
      action = a; tAction = 0; ptr.grab = false; const e = st.energy;
      if (st.reduced) { relax(); return; }
      if (a === 'hello') { core.vy = -4.2 * e; core.vx = .35 * e; core.air = true; }
      if (a === 'success') { core.vy = -1.2 * e; core.air = true; }
      if (a === 'tap') part = { x: core.x, y: core.y - .9, s: 420 * e, t: .3 };
      if (a === 'error') { for (let d = 0; d < 2; d++) drips.push({ x: (ink.rand(seed, d + 40) - .5) * .7, y: .45, vy: 0, t: -.15 - d * .35 }); }
    },
    step(dt) {
      dt = clamp(dt, 0, .1); if (dt <= 0) { draw(); return; }
      time += dt; tAction += dt;
      if (ONE_SHOT[action] && tAction > (st.reduced ? REDUCED_HOLD : ONE_SHOT[action])) { action = 'idle'; tAction = 0; if (st.reduced) relax(); }
      if (!st.reduced) {
        const t = targetsFor(action, tAction), k = 1 - Math.exp(-dt * (action === 'success' ? 14 : 6));
        for (const key in T) T[key] = mix(T[key], t[key], key === 'stiff' && action === 'success' ? 1 : k);
        const fk = 1 - Math.exp(-dt * 9); for (const key of ['eyeX', 'eyeY', 'wide', 'happy']) face[key] = mix(face[key], t[key], fk);
        face.blink = mix(face.blink, t.blink, 1 - Math.exp(-dt * 16));
        if (action !== 'sleep' && !ptr.down) { const ph = ink.fract(time / 5.7 + ink.rand(seed, 7)); if (ph < .05) face.blink = Math.max(face.blink, ink.bell(ph / .05)); }
        simulate(dt);
        for (const d of drips) { d.t += dt; if (d.t > 0) { d.vy += 3 * dt; d.y += d.vy * dt; } } drips = drips.filter(d => d.y < 2.2);
        ptr.vx *= Math.exp(-dt * 12); ptr.vy *= Math.exp(-dt * 12);
      }
      draw();
    },
    setReduced(v) { st.reduced = !!v; if (st.reduced) relax(); },
    setEnergy(e) { st.energy = clamp(e, .5, 1.5); if (st.reduced) relax(); }, setTint(c) { st.tint = c; },
    poke(x, y, kind) {
      const lx = (x - footX) / R, ly = (y - cY) / R;
      if (kind === 'move' && ptr.down) { ptr.vx = (lx - ptr.x) * 60; ptr.vy = (ly - ptr.y) * 60; const vl = Math.hypot(ptr.vx, ptr.vy); if (vl > 6) { ptr.vx *= 6 / vl; ptr.vy *= 6 / vl; } }
      ptr.x = lx; ptr.y = ly;
      if (kind === 'down') { ptr.down = true; ptr.grab = Math.hypot(lx - core.x, ly - core.y) < CORE * .7; if (ONE_SHOT[action]) { action = 'idle'; tAction = 0; } if (st.reduced) relax(); }
      if (kind === 'up') { ptr.down = false; ptr.grab = false; ptr.vx = ptr.vy = 0; }
      if (kind === 'tap') { action = 'tap'; tAction = 0; if (!st.reduced) part = { x: lx, y: ly, s: 480 * st.energy, t: .3 }; else relax(); }
    },
    destroy() { for (const [ev, fn] of listeners) host.removeEventListener(ev, fn); canvas.remove(); },
  };
  const listeners = [
    ['pointerdown', e => ctl.poke(e.offsetX, e.offsetY, 'down')], ['pointermove', e => ctl.poke(e.offsetX, e.offsetY, 'move')],
    ['pointerup', e => ctl.poke(e.offsetX, e.offsetY, 'up')], ['pointerleave', e => ctl.poke(e.offsetX, e.offsetY, 'up')],
  ];
  for (const [ev, fn] of listeners) host.addEventListener(ev, fn);

  // --- draw -------------------------------------------------------------------------------------------------
  const widths = [.045, .03, .018, .008].map(w => Math.max(tiny ? 1 : .6, w * R));
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (paper) ink.paper(ctx, W, H, { grain: hero ? .045 : 0, seed }); else ctx.clearRect(0, 0, W, H);
    const color = ink.inkColor(st.tint), breathe = st.reduced ? 1 : 1 + .015 * Math.sin(time * TAU * (action === 'sleep' ? .12 : .22));
    ctx.save(); ctx.translate(footX, cY); ctx.scale(R, R); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = color; ctx.fillStyle = color;
    if (tiny) {                                                                // 24 px: a filled tuft silhouette carries the shape under the few strands
      ctx.beginPath(); for (let i = 0; i < N; i++) { const j = i * K + K - 1; i ? ctx.lineTo(X[j], Y[j]) : ctx.moveTo(X[j], Y[j]); } ctx.closePath(); ctx.globalAlpha = .55; ctx.fill(); ctx.globalAlpha = 1;
    }
    // core: soft Nibbi blob, squashed about its bottom (drawn under the hair)
    ctx.save(); ctx.translate(core.x, core.y + B); ctx.scale(T.sw * breathe, T.sq * breathe); ctx.translate(0, -B);
    if (hero) { ctx.shadowColor = color; ctx.shadowBlur = .07; }
    ink.tracePath(ctx, outline); ctx.fill(); ctx.restore();
    // strands: batched by segment index so the taper costs four strokes
    for (let k = 1; k < K; k++) {
      ctx.lineWidth = widths[k - 1] / R; ctx.beginPath();
      for (let i = 0; i < N; i++) { const j = i * K + k; ctx.moveTo(X[j - 1], Y[j - 1]); ctx.lineTo(X[j], Y[j]); }
      ctx.stroke();
    }
    ctx.restore();
    // drips (error) + eyes riding the (squashed) core, tilting with the lean
    const cx = footX + core.x * R, cy = cY + (core.y + B * (1 - T.sq)) * R;
    for (const d of drips) if (d.t > 0) { ctx.beginPath(); ctx.ellipse(cx + d.x * R, cy + d.y * R, R * .035, R * .06, 0, 0, TAU); ctx.fill(); }
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(T.lean * st.energy * .25); ctx.scale(breathe * mix(1, T.sw, .5), breathe * mix(1, T.sq, .5));
    ink.eyes(ctx, R, { eyeX: face.eyeX, eyeY: face.eyeY, blink: face.blink, wide: face.wide, happy: face.happy }, { ink: color, seed });
    ctx.restore();
  }

  Object.assign(T, targetsFor('idle', 0)); pose();
  if (!st.reduced) for (let k = 0; k < 40; k++) simulate(1 / 60);            // settle before the first frame
  else relax();
  draw();
  return ctl;
}

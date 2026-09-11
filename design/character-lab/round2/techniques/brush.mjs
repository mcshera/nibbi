/* brush — Nibbi PAINTED every frame with stamp-based raster brush painting. Round-2 technique (experimental). */
import * as ink from '../../ink.mjs';
import { ACTION_IDS } from '../../actions.mjs';
const { clamp, mix, TAU, FOOT, rand, noise1, smooth } = ink;

export const meta = {
  id: 'brush', name: 'Brush painting',
  technique: 'stamp-based raster painting: procedural bristle/dry-brush stamp textures dabbed along authored stroke paths, repainted every frame from a spring-driven pose with a wet→dry state',
  tagline: 'Nibbi is a few strokes of sumi ink, laid fresh each frame — wet and pooling after a cue, drying to streaky dry-brush at rest.',
  look: 'Cream paper. Three or four overlapping brush strokes make the body: a heavy wet belly press that pools dark where the brush sat, a drier arc for the crown, a flick for the peak. Paper grain shows through the dry strands at the edges; pigment darkens where stamps overlap. Eyes are two askew white dabs with a black dab pupil and a glint.',
  motion: 'The painting is redone each frame from a pose that a critically damped spring follows, so the body has weight and settles rather than tweening. Every cue re-wets the strokes: stamps swell, soften and bleed, then dry over ~1.5 s into tighter, streakier marks. Idle is dry and still.',
  eyes: 'two white paper-colour dabs of the same bristle stamp (different sizes, slightly askew), a black dab pupil, a tiny glint dot; sleep = two short dry strokes',
  risks: ['repaint cost at hero (~150 stamps/frame)', 'stamps can read as a uniform soft sprite brush if rotation/size/alpha are not varied', 'four strokes may not fuse into one creature at 24 px', 'wet/dry cycling could be busy — idle must stay dry and still'],
  stills: { idle: 2, hello: .5, listen: 1.3, think: 1.5, work: 1.0, success: .7, error: 1.0, sleep: 2, tap: .25 },
};

// ---- authored strokes (local units, body centre 0,0, radius 1; +y is down) ----------------------
// each: name, control points [x, y, pressure], width (R units), press (ink load), kind 'wet'|'dry'
const STROKES = [
  { n: 'belly', p: [[-.82, .28, .7], [-.4, .48, 1], [.1, .5, 1], [.55, .42, .9], [.86, .2, .6]], w: .78, press: 1.0, kind: 'wet' },
  { n: 'mid', p: [[-1.0, -.1, .8], [-.5, -.14, .95], [.1, -.1, .95], [.6, -.12, .85], [1.0, -.05, .6]], w: .74, press: .8, kind: 'wet' },
  { n: 'crown', p: [[-.78, -.5, .55], [-.35, -.78, .8], [.1, -.84, .8], [.5, -.72, .65], [.8, -.45, .4]], w: .5, press: .62, kind: 'dry' },
  { n: 'flick', p: [[-.22, -.8, .9], [-.06, -.98, .7], [.1, -1.12, .45], [.24, -1.22, .2]], w: .3, press: .9, kind: 'dry' },
];
const ONESHOT = { hello: 1.3, tap: .8, success: 1.7, error: 1.9 };

export function mount(host, { R = 96, seed = 1, tint = null, reduced = false, energy = 1, size = 'hero', paper = true } = {}) {
  const W = Math.round(3.4 * R), H = Math.round(3.6 * R), footX = 1.7 * R, footY = 3.1 * R;
  host.style.width = W + 'px'; host.style.height = H + 'px'; host.style.position = 'relative';
  const dpr = Math.min(2, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1));
  const canvas = document.createElement('canvas'); canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.cssText = `display:block;width:${W}px;height:${H}px;touch-action:none`;
  host.appendChild(canvas); const ctx = canvas.getContext('2d');
  const hero = size === 'hero', tiny = size === 'tiny';
  const DET = hero ? 1 : tiny ? .3 : .55;        // stamp density factor
  const st = { reduced, energy, tint };

  // ---- stamp textures (procedural, deterministic, rebuilt on tint) --------------------------------
  const TEX = hero ? 96 : tiny ? 24 : 48;         // texture px
  let stamps = null;
  function makeStamp(kind, s, color) {
    const c = document.createElement('canvas'); c.width = c.height = TEX; const g = c.getContext('2d');
    const h = TEX / 2; g.fillStyle = color; g.strokeStyle = color;
    if (kind === 'dab') {                          // bristle dab: soft pigment core + jittered dots with gaps, denser at centre
      const rg = g.createRadialGradient(h, h * 1.02, 0, h, h, h * .9); rg.addColorStop(0, color); rg.addColorStop(.45, color); rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg; g.globalAlpha = .5; g.beginPath(); g.ellipse(h, h, h * .88, h * .78, (rand(s, 99) - .5) * .8, 0, TAU); g.fill();
      g.fillStyle = color; const n = hero ? 60 : 22;
      for (let i = 0; i < n; i++) {
        const a = rand(s, i * 4) * TAU, r = Math.sqrt(rand(s, i * 4 + 1)) * .95 * h;
        const x = h + Math.cos(a) * r, y = h + Math.sin(a) * r * .84;
        const rr = h * (.08 + .16 * rand(s, i * 4 + 2)) * (1.1 - .5 * r / h);
        g.globalAlpha = .25 + .45 * rand(s, i * 4 + 3) * (1 - .5 * r / h);
        g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
      }
    } else if (kind === 'streak') {               // dry-brush streak: thin parallel strands with gaps
      const n = hero ? 7 : 4;
      for (let i = 0; i < n; i++) {
        const y = h + (i / (n - 1) - .5) * 1.6 * h + (rand(s, i * 3) - .5) * h * .18;
        g.lineWidth = Math.max(.8, h * (.05 + .12 * rand(s, i * 3 + 1))); g.lineCap = 'round';
        let x = h * (.05 + .3 * rand(s, i * 3 + 2)); const end = TEX - h * (.05 + .3 * rand(s, i * 7 + 5));
        let k = 0;
        while (x < end) { const len = h * (.15 + .45 * rand(s, i * 13 + k * 2)); g.globalAlpha = .35 + .45 * rand(s, i * 13 + k * 2 + 1);
          g.beginPath(); g.moveTo(x, y + (rand(s, i + k * 5) - .5) * 1.2); g.lineTo(Math.min(end, x + len), y + (rand(s, i + k * 5 + 1) - .5) * 1.2); g.stroke();
          x += len + h * (.06 + .22 * rand(s, i * 17 + k)); k++; }
      }
    } else {                                       // blot: dense pool with a rough edge
      const rg = g.createRadialGradient(h, h, 0, h, h, h * .95); rg.addColorStop(0, color); rg.addColorStop(.7, color); rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg; g.globalAlpha = .9; g.beginPath();
      for (let i = 0; i < 28; i++) { const a = i / 28 * TAU, r = h * (.78 + .16 * rand(s, i)); g.lineTo(h + Math.cos(a) * r, h + Math.sin(a) * r); } g.closePath(); g.fill();
    }
    return c;
  }
  function buildStamps() {
    const color = ink.inkColor(st.tint), white = '#fbfaf7';
    stamps = { dab: [makeStamp('dab', seed * 3 + 1, color), makeStamp('dab', seed * 3 + 2, color), makeStamp('dab', seed * 3 + 3, color)],
      streak: [makeStamp('streak', seed * 5 + 1, color), makeStamp('streak', seed * 5 + 2, color)], blot: makeStamp('blot', seed * 7 + 1, color),
      wdab: [makeStamp('dab', seed * 3 + 11, white), makeStamp('dab', seed * 3 + 12, white)], wblot: makeStamp('blot', seed * 7 + 9, white) };
  }
  buildStamps();

  // ---- state -----------------------------------------------------------------------------------
  let action = 'idle', tAction = 0, time = 0, blinkT = 3.5, blink = 0, workT = 0, workK = 0;
  const wet = STROKES.map(() => 0);              // per-stroke wetness 0..1 (1 = just laid)
  const IMP = { x: 0, y: 0, sx: 1, sy: 1, lean: 0, hook: 0, ex: 0, ey: 0, eyeClose: 0, drip: 0, pool: 0, wave: 0 }; // pose params
  const pose = { ...IMP }, vel = Object.fromEntries(Object.keys(IMP).map(k => [k, 0]));
  const tgt = { ...IMP };
  let pointer = null, smear = { x: 0, y: 0 }, dab = null, flourish = 0; // touch state
  const spring = (k, kk, dt) => { const c = 2 * Math.sqrt(kk); vel[k] += (-(pose[k] - tgt[k]) * kk - vel[k] * c) * dt; pose[k] += vel[k] * dt; };
  const rewet = (i, v = 1) => { wet[i] = Math.max(wet[i], v); };
  const rewetAll = v => STROKES.forEach((_, i) => rewet(i, v));

  const ctl = {
    cue(a) {
      if (!ACTION_IDS.includes(a)) return; action = a; tAction = 0; workT = 0; workK = 0; flourish = 0; dab = null;
      const e = st.energy;
      if (a === 'hello') { rewetAll(1); vel.y -= 3.2 * e; }
      if (a === 'listen') { rewetAll(.7); }
      if (a === 'think') { rewet(3, 1); }
      if (a === 'success') { rewetAll(1); vel.y -= 6 * e; flourish = 1e-3; }
      if (a === 'error') { rewet(0, 1); vel.sy -= 1.5; }
      if (a === 'tap') { vel.sy -= 2.4 * e; rewet(0, .6); }
      if (a === 'sleep') { rewetAll(0); }
    },
    step(dt) {
      dt = clamp(dt, 0, .1); time += dt; tAction += dt;
      const e = st.energy, red = st.reduced;
      // --- targets for this moment (the STILL) ---
      Object.assign(tgt, IMP);
      if (pointer) { tgt.sy = .84; tgt.sx = 1.1; }
      switch (action) {
        case 'listen': tgt.lean = -.28 * e; tgt.x = -.14 * e; tgt.ex = -.45; tgt.ey = -.25; tgt.sy = 1.03; break;
        case 'think': tgt.hook = 1; tgt.ex = -.55; tgt.ey = -.55; tgt.lean = .06; break;
        case 'work': tgt.ey = .45; tgt.ex = .12; tgt.sy = .97; break;
        case 'success': tgt.eyeClose = smooth(.15, .45, tAction) * .6 * (1 - smooth(1.0, 1.5, tAction)); break;
        case 'error': tgt.sy = .9; tgt.sx = 1.06; tgt.ey = .6; tgt.pool = 1; tgt.drip = smooth(.2, 1.0, tAction); tgt.eyeClose = .3; break;
        case 'sleep': tgt.sy = .84; tgt.sx = 1.12; tgt.eyeClose = 1; tgt.y = .02; break;
        case 'hello': tgt.ey = -.15; break;
      }
      if (red) { for (const k in pose) { pose[k] = tgt[k]; vel[k] = 0; } for (let i = 0; i < wet.length; i++) wet[i] = 0; blink = 0; smear.x = smear.y = 0; flourish = 0; dab = null; }
      else {
        for (const k in pose) spring(k, k === 'y' || k === 'sy' || k === 'sx' ? 110 : k === 'drip' || k === 'pool' ? 30 : 60, dt);
        if (pose.y > 0 && action !== 'sleep' && tgt.y === 0) { pose.y = 0; vel.y = Math.min(0, vel.y) ; } // ground contact: no sinking through the foot line
        // wetness dries over ~1.5 s (listen holds a damp body)
        const floor = action === 'listen' ? .5 : 0;
        for (let i = 0; i < wet.length; i++) wet[i] = Math.max(floor * (i < 2 ? 1 : .5), wet[i] - dt / 1.5);
        // work: every .5 s one stroke re-wets in turn — the brush at work; body holds still
        if (action === 'work') { workT += dt; if (workT >= .5) { workT -= .5; rewet(workK % STROKES.length, 1); workK++; } }
        // idle blink, rare
        blinkT -= dt; if (blinkT < 0) { blinkT = 4 + 4 * rand(seed, Math.floor(time * 10)); blink = 1; }
        blink = Math.max(0, blink - dt * 8);
        if (flourish > 0) { flourish += dt; if (flourish > 1.6) flourish = 0; }
        smear.x *= Math.exp(-dt * 5); smear.y *= Math.exp(-dt * 5);
        if (dab) { dab.age += dt; if (dab.age > 1.6) dab = null; }
      }
      if (ONESHOT[action] && tAction > ONESHOT[action]) { action = 'idle'; tAction = 0; }
      draw();
    },
    setReduced(v) { st.reduced = !!v; }, setEnergy(e) { st.energy = clamp(e, .5, 1.5); }, setTint(c) { st.tint = c; buildStamps(); draw(); },
    poke(x, y, kind) {
      if (!hero && kind !== 'tap') return;
      if (kind === 'tap') { ctl.cue('tap'); dab = { x, y, age: 0 }; return; }
      if (kind === 'down') { pointer = { x, y }; dab = { x, y, age: 0 }; rewetAll(.8); vel.sy -= 1.2; if (ONESHOT[action]) { action = 'idle'; tAction = 0; } }
      if (kind === 'move' && pointer) { smear.x += (x - pointer.x) * .35; smear.y += (y - pointer.y) * .35; pointer = { x, y }; dab = { x, y, age: Math.min(dab ? dab.age : 0, .3) }; }
      if (kind === 'up') { if (pointer) vel.sy += 1.6; pointer = null; }
    },
    destroy() { host.removeEventListener('pointerdown', onDown); host.removeEventListener('pointermove', onMove); host.removeEventListener('pointerup', onUp); host.removeEventListener('pointercancel', onUp); canvas.remove(); },
  };
  const onDown = e => ctl.poke(e.offsetX, e.offsetY, 'down'), onMove = e => ctl.poke(e.offsetX, e.offsetY, 'move'), onUp = e => ctl.poke(e.offsetX, e.offsetY, 'up');
  host.addEventListener('pointerdown', onDown); host.addEventListener('pointermove', onMove); host.addEventListener('pointerup', onUp); host.addEventListener('pointercancel', onUp);

  // ---- painting --------------------------------------------------------------------------------
  // evaluate a stroke's path (Catmull-Rom through control points) → {x, y, pr}
  function evalPath(P, t) {
    const n = P.length - 1, u = clamp(t, 0, .9999) * n, i = Math.floor(u), f = u - i;
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[Math.min(n, i + 1)], p3 = P[Math.min(n, i + 2)];
    const cr = (a, b, c, d) => .5 * ((2 * b) + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f * f + (-a + 3 * b - 3 * c + d) * f * f * f);
    return { x: cr(p0[0], p1[0], p2[0], p3[0]), y: cr(p0[1], p1[1], p2[1], p3[1]), pr: cr(p0[2], p1[2], p2[2], p3[2]) };
  }
  function stamp(img, x, y, s, rot, alpha) {   // composes with the active (body) transform
    ctx.save(); ctx.globalAlpha = clamp(alpha, 0, 1); ctx.translate(x, y); if (rot) ctx.rotate(rot); ctx.drawImage(img, -s / 2, -s / 2, s, s); ctx.restore();
  }
  // paint one stroke: bristle dabs along the path, dry streaks on the drier passes, pooling where pressure is high
  function paintStroke(si, S, P, w, press, wetness, alphaMul, frozen) {
    const len = P.length; let L = 0; for (let i = 1; i < len; i++) L += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
    const count = Math.max(4, Math.round(L / (w * .14) * DET * (hero ? 1 : 1.4)));
    const wobble = frozen ? 0 : 1;
    for (let k = 0; k <= count; k++) {
      const t = k / count, q = evalPath(P, t), j = si * 1000 + k;
      const pr = q.pr * press;
      const jitter = (.03 + .1 * wetness) * w;
      const x = (q.x + (rand(seed, j) - .5) * jitter + wobble * noise1(time * .6 + k, seed + si) * .003) * R;
      const y = (q.y + (rand(seed, j + 1) - .5) * jitter * .7) * R;
      const sz = w * R * (.55 + .5 * pr) * (1 + .3 * wetness) * (.9 + .2 * rand(seed, j + 2));
      const rot = rand(seed, j + 3) * TAU + wobble * noise1(time * .4 + si, seed + 40 + k) * .15 * wetness;
      const a = (S.kind === 'wet' ? .30 : .16) * (hero ? 1 : 2) * (.5 + .7 * pr) * (1 - .2 * wetness) * alphaMul;
      stamp(stamps.dab[(k + si) % 3], x, y, sz, rot, a);
      if (wetness > .1 && hero && k % 2 === 0) stamp(stamps.dab[(k + 1) % 3], x, y, sz * 1.4, rot + 1, a * .3 * wetness); // faint wet bleed halo
      if (pr > .75 && S.kind === 'wet') stamp(stamps.blot, x, y, sz * .5 * (1 + .25 * wetness), rot, (hero ? .3 : .55) * pr * alphaMul); // ink pools under the heavy press
    }
    if (!hero) return;
    // dry-brush strands: run WITH the stroke, inside its width, strongest at the tail where the brush lifts; gone when wet
    const dry = 1 - wetness; if (dry < .15) return;
    const sc = Math.max(3, Math.round(count * .5));
    for (let k = 0; k <= sc; k++) {
      const t = (k + .5) / (sc + 1), q = evalPath(P, t), q2 = evalPath(P, t + .02), j = si * 1000 + 500 + k;
      const tail = S.kind === 'dry' ? .5 + .5 * t : smooth(.4, .75, t) * (1 - smooth(.8, .95, t)) * .7;       // dry strokes streak all along; wet strokes only at the lift-off
      if (tail < .1) continue;
      const ang = Math.atan2(q2.y - q.y, q2.x - q.x) + (rand(seed, j) - .5) * .12;
      const side = (rand(seed, j + 1) - .5) * w * .6 * (S.kind === 'dry' ? 1 : .4) + (S.kind === 'wet' ? w * .2 : 0);
      const x = (q.x - Math.sin(ang) * side) * R, y = (q.y + Math.cos(ang) * side) * R;
      stamp(stamps.streak[(k + si) % 2], x, y, w * R * (.7 + .4 * rand(seed, j + 2)), ang, .5 * dry * tail * alphaMul);
    }
  }
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (paper) ink.paper(ctx, W, H, { grain: hero ? .045 : 0, seed }); else ctx.clearRect(0, 0, W, H);
    const frozen = st.reduced;
    const sleepy = action === 'sleep' ? 1 - .3 * smooth(0, 1.2, tAction) : 1;   // sleep dries to a lighter grey
    const inkMul = frozen && action === 'sleep' ? .7 : sleepy;
    // body frame: foot-planted pose transform (lift, squash, lean, smear)
    const bx = footX + pose.x * R + smear.x * .6, by = footY + pose.y * R + smear.y * .3;
    const frame = () => { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.translate(bx, by); ctx.scale(pose.sx, pose.sy); ctx.transform(1, 0, -pose.lean * .9, 1, 0, 0); ctx.translate(0, -FOOT * R); };
    // strokes: transform control points for hook (think) and pool/drip (error)
    const pooling = pose.pool;
    for (let si = 0; si < STROKES.length; si++) {
      const S = STROKES[si]; let P = S.p, w = S.w, press = S.press;
      if (si === 3 && pose.hook > .01) {                                         // crown flick curls into a hook and hesitates
        const h = pose.hook, wander = frozen ? 0 : noise1(time * .35, seed + 9) * .12 * h;
        P = [[-.22, -.8, .9], [-.06, -.98 - .04 * h, .75], [.1 + .1 * h, -1.12 - .1 * h, .55], [.24 + .16 * h + wander, -1.22 + .1 * h, .4 + .2 * h], ...(h > .2 ? [[.34 + .12 * h + wander, -1.1 + .06 * h, .45 * h], [.3 + .08 * h + wander * .5, -.96, .3 * h]] : [])];
      }
      if (si === 0 && pooling > .01) { press = S.press * (1 + .7 * pooling); w = S.w * (1 + .12 * pooling); }
      ctx.save(); frame();
      paintStroke(si, S, P, w, press, frozen ? 0 : wet[si], inkMul, frozen);
      ctx.restore();
    }
    // error: a thin drip runs from the pooled belly down past the foot
    if (pose.drip > .01) {
      const d = pose.drip; ctx.save(); frame();
      const n = Math.max(3, Math.round(10 * d * DET + 2));
      for (let k = 0; k < n; k++) { const t = k / n, y = .78 + t * .55 * d; const x = .18 + noise1(k * .7, seed + 3) * .03;
        stamp(stamps.blot, x * R, y * R, R * (.11 - .06 * t) * (1 + .3 * (k === n - 1)), 0, .8 * inkMul); }
      ctx.restore();
    }
    // success: a wet flourish arcs over the head and dries away
    if (flourish > 0) {
      const f = flourish, reveal = smooth(0, .35, f), fade = 1 - smooth(.7, 1.6, f), wetn = 1 - smooth(0, 1.2, f);
      ctx.save(); frame();
      const FP = [[-1.05, -.85, .3], [-.6, -1.35, .8], [.1, -1.55, .9], [.8, -1.4, .6], [1.15, -1.0, .2]];
      const n = Math.round(28 * DET) + 4;
      for (let k = 0; k <= n; k++) { const t = k / n; if (t > reveal) break; const q = evalPath(FP, t), j = 7000 + k;
        const sz = R * .28 * (.5 + .7 * q.pr) * (1 + .4 * wetn); stamp(stamps.dab[k % 3], (q.x + (rand(seed, j) - .5) * .05) * R, q.y * R, sz, rand(seed, j + 1) * TAU, .5 * fade * inkMul * (.5 + .5 * q.pr)); }
      ctx.restore();
    }
    // eyes: two white dabs (askew, different sizes), a black dab pupil, a glint; sleep/closed = short dry strokes
    ctx.save(); frame();
    const close = clamp(Math.max(pose.eyeClose, blink), 0, 1);
    for (let i = 0; i < 2; i++) {
      const E = ink.EYES[i], ex = E.x * R, ey = E.y * R, er = E.rx * R * (i ? 1.0 : .92) * (1 + .06 * (rand(seed, 90 + i) - .5));
      const tilt = (rand(seed, 92 + i) - .5) * .5;
      if (close > .7) { stamp(stamps.streak[i], ex, ey + er * .15, er * 2.1, tilt * .3 + .08, .9 * inkMul); stamp(stamps.blot, ex, ey + er * .15, er * .55, 0, .5 * inkMul); continue; }
      const es = er * (hero ? 1.9 : 2.2) * (1 - .12 * close);
      stamp(stamps.wblot, ex, ey, es * .95, tilt, .95); stamp(stamps.wdab[i], ex, ey, es * 1.2, tilt, .9); stamp(stamps.wdab[1 - i], ex + er * .12, ey - er * .1, es * 1.05, tilt + .7, .85);
      const px = ex + pose.ex * er * .4, py = ey + pose.ey * er * .38 + close * er * .25, pr = E.prx * R * (hero ? .85 : 1) * (1 - .45 * close) * (i ? 1 : .92);
      stamp(stamps.blot, px, py, pr * 2.0, tilt, .95 * inkMul); stamp(stamps.dab[i], px, py, pr * 2.3, tilt + 1.3, .5 * inkMul);
      ctx.globalAlpha = .9; ctx.fillStyle = '#fbfaf7'; ctx.beginPath(); ctx.arc(px - pr * .35, py - pr * .4, Math.max(.6, pr * .28), 0, TAU); ctx.fill();
    }
    ctx.restore();
    // touch: a wet dab where the finger is, drying away
    if (dab) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); const a = 1 - smooth(.4, 1.6, dab.age), sz = R * .3 * (1 + .5 * smooth(0, .3, dab.age));
      stamp(stamps.dab[2], dab.x, dab.y, sz, dab.x * .01, .55 * a * inkMul); stamp(stamps.blot, dab.x, dab.y, sz * .45, 0, .5 * a * inkMul); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 1;
  }
  draw();
  return ctl;
}

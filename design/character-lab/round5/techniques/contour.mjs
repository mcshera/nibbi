/* Round-5 · 04 — CONTOUR (focus). A solid ink body cut by paper-coloured contour lines that converge on a summit — the point of attention.
 * Where the summit sits and how tightly the lines gather is the state: listening pulls the summit toward the person, thinking lifts it to the crown and tightens it, work lets the lines flow steadily inward. */
import * as ink from '../../ink.mjs';
import { ACTION_IDS } from '../../actions.mjs';
const { clamp, mix, TAU, FOOT } = ink;

export const meta = {
  id: 'contour', name: 'Contour', faculty: 'focus',
  technique: 'nested closed curves interpolated between the body outline and a small ellipse at a movable summit (a topographic map of attention), drawn as paper-coloured cuts through solid ink; summit position, ring count and ring spacing are the state',
  tagline: 'A map of where Nibbi’s attention is: the contour lines gather around the thing it is thinking about.',
  look: 'Solid ink silhouette, the current shape, with fine cream contour lines inside it converging on one point; the eyes sit on top like two lakes. Nothing outside the body except a single ring for success.',
  motion: 'The body barely moves (a lean, a hop, a sag). The summit moves — a slow, eased slide, never a spring — and the rings tighten or loosen around it. Work is a steady inward flow of lines; sleep is three wide lines.',
  eyes: 'Canonical crisp whites and pupils; the pupils look where the summit is heading, a moment before it gets there.',
  thoughtful: [
    'listen: the summit slides toward the person and the lines tighten around it — attention has a visible location',
    'think: the summit rises to the crown and the lines crowd tight, then loosen and tighten again on a slow breath — concentration you can watch',
    'work: the lines flow steadily inward toward a low summit, one every two seconds; it is busy but not hurried',
    'error: one contour breaks on the side of the failure and the summit sinks; the break heals only after the eyes have come back to the person',
    'touch: the summit jumps to your finger and eases back to where it was — noticed, then returned to',
  ],
  risks: ['cream lines inside ink read as a woodcut or a fingerprint before they read as attention', 'at 24 px the lines are gone; only the lean and the eyes carry', 'a fixed summit for minutes can look like a target or a bullseye'],
  stills: { idle: 2, hello: .55, listen: 1.7, think: 2.0, work: 1.6, success: .75, error: 1.5, sleep: 2.4, tap: .35 },
};

const PERSON = [-.9, .2], WORK = [.2, .85], RECALL = [-.7, -.85], AHEAD = [0, .1], FAIL = [.75, .8];
const BEAT = .16, ONE = { hello: 1.5, success: 2.2, error: 2.7, tap: 1.0 }, REDUCED_HOLD = 3;

export function mount(host, { R = 96, seed = 1, tint = null, reduced = false, energy = 1, size = 'hero', paper = true } = {}) {
  const W = Math.round(3.4 * R), H = Math.round(3.6 * R), footX = 1.7 * R, footY = 3.1 * R;
  host.style.width = W + 'px'; host.style.height = H + 'px'; host.style.position = 'relative';
  const dpr = Math.min(2, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1));
  const canvas = document.createElement('canvas'); canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.cssText = `display:block;width:${W}px;height:${H}px;touch-action:none`;
  host.appendChild(canvas); const ctx = canvas.getContext('2d');
  const hero = size === 'hero', tiny = size === 'tiny';
  const st = { reduced, energy, tint };
  let action = 'idle', tA = 0, time = 0, rc = 0, pressed = false, pressT = 0, finger = { x: 0, y: -.3 };
  const sp = v => ({ x: v, v: 0, t: v });
  const S = { x: sp(0), sx: sp(1), sy: sp(1), lean: sp(0) }; let lift = 0;
  const summit = { x: 0, y: -.1, tx: 0, ty: -.1 }; let gamma = 1, gammaT = 1, rings = hero ? 5 : 3, ringsT = hero ? 5 : 3, flow = 0, breakAmt = 0, bloom = 0;
  const gaze = { x: 0, y: .1, tx: 0, ty: .1 }, eye = { blinkT: 1, nextBlink: 3, happy: 0, wide: 1, lid: .08 };
  const NPTS = tiny ? 24 : 48;

  function wants(a, t, tm, e) {
    const w = { x: 0, sx: 1, sy: 1, lean: 0, lift: 0, place: AHEAD, lid: .08, happy: 0, wide: 1, sx_: 0, sy_: -.1, gamma: 1, rings: hero ? 5 : 3, flow: 0, brk: 0 };
    const breath = Math.sin(tm / 8 * TAU);
    switch (a) {
      case 'idle': w.sy = 1 + .004 * breath; w.sy_ = -.1; w.gamma = 1; break;
      case 'listen': w.x = -.1 * e; w.lean = -.2 * e; w.sx_ = -.5 * e; w.sy_ = -.05; w.gamma = .62; w.rings = hero ? 8 : 4; w.place = PERSON; w.lid = 0; w.wide = 1.04; break;
      case 'think': w.lean = .1 * e; w.sy = 1.04; w.sx = .98; w.sx_ = -.18; w.sy_ = -.72; w.gamma = .55 + .04 * (.5 + .5 * Math.sin(tm * TAU / 8)); w.rings = hero ? 11 : 5; w.place = RECALL; w.lid = .42; break;
      case 'work': w.sy = .95; w.sx = 1.04; w.sx_ = 0; w.sy_ = .3; w.gamma = 1; w.flow = 1; w.rings = hero ? 7 : 4; w.place = WORK; w.lid = .3; break;
      case 'hello': w.place = PERSON; w.lid = 0; w.wide = 1.06; w.lean = -.05; w.sx_ = -.35; w.sy_ = -.2; w.gamma = .7; w.rings = hero ? 7 : 4; w.lift = ink.bell((t - .18) / .5) * .3 * e; w.sy = t < .18 ? 1 : t < .28 ? .9 : t < .6 ? 1.08 : 1; break;
      case 'success': w.place = t < 1.2 ? [0, -.3] : PERSON; w.lid = 0; w.happy = t > .3 ? .85 : 0; w.wide = 1.06; w.sx_ = 0; w.sy_ = -.15; w.gamma = 1.4; w.lift = ink.bell((t - .18) / .6) * .5 * e; w.sy = t < .18 ? 1 : t < .26 ? .9 : t < .78 ? 1.12 : t < .95 ? .95 : 1; w.sx = t < .78 && t >= .26 ? .93 : 1; break;
      case 'error': w.place = t < 1.1 ? FAIL : PERSON; w.lid = t < 1.1 ? .35 : .2; w.sx_ = .25; w.sy_ = .45; w.gamma = 1.2; w.rings = hero ? 6 : 3; w.brk = t < 2.2 ? 1 : 0; if (t < 2.4) { w.sy = .9; w.sx = 1.06; w.lean = .05; w.x = .02; } break;
      case 'sleep': w.place = [0, .3]; w.lid = 1; w.sy = .8 + .012 * breath; w.sx = 1.12; w.sx_ = 0; w.sy_ = .35; w.gamma = 1; w.rings = 3; break;
      case 'tap': w.place = null; w.lid = 0; w.wide = 1.04; w.sx_ = clamp(finger.x, -.7, .7); w.sy_ = clamp(finger.y, -.8, .5); w.gamma = .75; w.rings = hero ? 7 : 4; if (t >= .12 && t < .3) { w.sy = .86; w.sx = 1.08; } else if (t < .5) { w.sy = 1.05; w.sx = .97; } break;
    }
    return w;
  }
  function snapTo(w) { S.x.x = S.x.t = w.x; S.sx.x = S.sx.t = w.sx; S.sy.x = S.sy.t = w.sy; S.lean.x = S.lean.t = w.lean; for (const k in S) S[k].v = 0; lift = 0; summit.x = summit.tx = w.sx_; summit.y = summit.ty = w.sy_; gamma = gammaT = w.gamma; rings = w.rings; flow = action === 'work' ? .35 : 0; breakAmt = w.brk; bloom = action === 'success' ? .6 : 0; const p = w.place || [clamp(finger.x * 1.2, -1, 1), clamp(finger.y * 1.5, -1, 1)]; gaze.x = gaze.tx = p[0]; gaze.y = gaze.ty = p[1]; eye.lid = w.lid; eye.happy = w.happy; eye.wide = w.wide; eye.blinkT = 1; }
  function relax() { snapTo(wants(action, meta.stills[action], 0, st.energy)); }

  const ctl = {
    cue(a) {
      if (!ACTION_IDS.includes(a)) return;
      action = a; tA = 0;
      if (st.reduced) { relax(); return; }
      const w = wants(a, 0, time, st.energy); if (w.place) { gaze.tx = w.place[0]; gaze.ty = w.place[1]; }
      if (a === 'success') bloom = 1;
    },
    step(dt) {
      dt = clamp(dt, 0, .1); if (dt <= 0) { draw(); return; }
      tA += dt;
      if (ONE[action] && tA > (st.reduced ? REDUCED_HOLD : ONE[action])) { action = 'idle'; tA = 0; if (st.reduced) relax(); }
      if (!st.reduced) {
        time += dt;
        const e = st.energy, w = wants(action, tA, time, e);
        if (tA >= BEAT) { S.x.t = w.x + (pressed ? clamp(finger.x * .2, -.15, .15) : 0); S.sx.t = pressed ? 1.07 : w.sx; S.sy.t = pressed ? .88 : w.sy; S.lean.t = w.lean; lift = w.lift; gammaT = w.gamma; ringsT = w.rings; }
        { const n = Math.max(1, Math.ceil(dt * 120)), h = dt / n; for (let i = 0; i < n; i++) for (const key in S) { const s = S[key]; s.v += (150 * (s.t - s.x) - 19 * s.v) * h; s.x += s.v * h; } }
        // the summit slides, never springs
        summit.tx = pressed ? clamp(finger.x, -.7, .7) : w.sx_; summit.ty = pressed ? clamp(finger.y, -.8, .5) : w.sy_;
        const ks = 1 - Math.exp(-dt * (action === 'tap' || pressed ? 12 : action === 'idle' ? 4.5 : 3.2)); summit.x = mix(summit.x, summit.tx, ks); summit.y = mix(summit.y, summit.ty, ks);
        gamma = mix(gamma, gammaT, 1 - Math.exp(-dt * (action === 'idle' ? 5 : 3))); rings = mix(rings, ringsT, 1 - Math.exp(-dt * 2.5));
        flow = action === 'work' ? (flow + dt * .5) % 1 : mix(flow, 0, 1 - Math.exp(-dt * 4));
        breakAmt = mix(breakAmt, w.brk, 1 - Math.exp(-dt * 8));
        bloom = Math.max(0, bloom - dt * .55);
        if (w.place) { gaze.tx = w.place[0]; gaze.ty = w.place[1]; }
        if (pressed || action === 'tap') { gaze.tx = clamp(finger.x * 1.2, -1, 1); gaze.ty = clamp(finger.y * 1.5, -1, 1); }
        const k = 1 - Math.exp(-dt * 14); gaze.x = mix(gaze.x, gaze.tx, k); gaze.y = mix(gaze.y, gaze.ty, k);
        const kl = 1 - Math.exp(-dt * 9); eye.lid = mix(eye.lid, w.lid, kl); eye.happy = mix(eye.happy, w.happy, kl); eye.wide = mix(eye.wide, w.wide, kl);
        if (action !== 'sleep' && time >= eye.nextBlink) { eye.blinkT = 0; eye.nextBlink = time + 3 + 3 * ink.rand(seed, rc++); }
        eye.blinkT = Math.min(1, eye.blinkT + dt / (action === 'listen' ? .36 : .15));
      }
      draw();
    },
    setReduced(v) { st.reduced = !!v; if (st.reduced) relax(); },
    setEnergy(e) { st.energy = clamp(e, .5, 1.5); }, setTint(c) { st.tint = c; },
    poke(x, y, kind) {
      finger = { x: (x - footX) / R, y: (y - (footY - FOOT * R)) / R };
      if (kind === 'down') { pressed = true; pressT = time; if (st.reduced) relax(); }
      else if (kind === 'up') { const short = pressed && time - pressT < .25; pressed = false; if (short) ctl.poke(x, y, 'tap'); else if (!st.reduced) S.sy.v += 1.4 * st.energy; }
      else if (kind === 'tap') { action = 'tap'; tA = 0; if (st.reduced) relax(); }
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
    const color = ink.inkColor(st.tint), cream = ink.PAPER;
    ctx.save();
    ink.poseTransform(ctx, footX, footY, R, { x: S.x.x, lift: Math.max(0, lift), sx: S.sx.x, sy: S.sy.x, rotate: 0 });
    ctx.translate(0, -FOOT * R);
    const outer = ink.blobPoints(R, { seed, rough: .035, time: st.reduced ? 0 : time, lean: S.lean.x, n: NPTS });
    // success: one ring blooms outward beyond the body
    if (bloom > .01 && !tiny) { ctx.save(); ctx.globalAlpha = bloom * .7; ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, R * .02); const grow = 1 + (1 - bloom) * .55; ctx.beginPath(); for (let i = 0; i < outer.length; i++) { const p = outer[i]; const x = p.x * grow, y = p.y * grow; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.closePath(); ctx.stroke(); ctx.restore(); }
    ctx.fillStyle = color; ink.tracePath(ctx, outer); ctx.fill();
    if (!tiny) {
      // contour lines: interpolate each outline point toward the summit ellipse, spacing by gamma; work adds a steady inward flow
      ctx.save(); ink.tracePath(ctx, outer); ctx.clip();
      ctx.strokeStyle = cream; ctx.lineWidth = hero ? Math.max(1, R * .017) : 1; ctx.lineCap = 'round'; ctx.globalAlpha = .75;
      const sx0 = clamp(summit.x, -.8, .8) * R, sy0 = clamp(summit.y, -.9, .6) * R, sr = .07 * R;
      const N = Math.ceil(rings), frac = rings - Math.floor(rings), gap = breakAmt;
      for (let k = 1; k <= N; k++) {
        let u = (k - flow) / (rings + .5); if (u <= 0.005) continue; if (u >= 1) continue;
        ctx.globalAlpha = .75 * (k === N && frac > 0 ? frac : 1);   // a ring count in transition fades its newest ring in
        const s = Math.pow(u, gamma);
        ctx.beginPath(); let started = false;
        for (let i = 0; i <= outer.length; i++) {
          const p = outer[i % outer.length], a = (i % outer.length) / outer.length * TAU;
          const x = mix(p.x, sx0 + Math.cos(a) * sr, s), y = mix(p.y, sy0 + Math.sin(a) * sr, s);
          // the break: a gap on the right side for the rings nearest the outline, easing shut as breakAmt falls
          const inGap = gap > .05 && u < .55 && Math.abs(a - .35) < .55 * gap;
          if (inGap) { started = false; continue; }
          if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
    const open = 1 - ink.bell(eye.blinkT), sleeping = action === 'sleep' || eye.lid >= .99;
    const geo = ink.eyes(ctx, R, { eyeX: gaze.x, eyeY: gaze.y, blink: sleeping ? 1 : 1 - open, wide: eye.wide, happy: eye.happy }, { ink: color, style: 'paper' });
    if (sleeping) { ctx.strokeStyle = '#fbfaf7'; ctx.lineWidth = Math.max(1, R * .03); ctx.lineCap = 'round'; for (const g of geo) { ctx.beginPath(); ctx.moveTo(g.cx - g.rx * .8, g.cy); ctx.quadraticCurveTo(g.cx, g.cy + g.rx * .35, g.cx + g.rx * .8, g.cy); ctx.stroke(); } }
    else if (eye.lid > .03 && !(tiny && eye.lid < .3)) { ctx.fillStyle = color; for (const g of geo) { ctx.save(); ctx.beginPath(); ctx.ellipse(g.cx, g.cy, g.rx, g.ry, 0, 0, TAU); ctx.clip(); const ry0 = ink.EYES[0].ry * R * eye.wide; ctx.beginPath(); ctx.ellipse(g.cx, g.cy - ry0 * (2.1 - 1.6 * eye.lid), g.rx * 1.25, ry0 * 1.05, 0, 0, TAU); ctx.fill(); ctx.restore(); } }
    ctx.restore();
  }
  if (st.reduced) relax();
  draw();
  return ctl;
}

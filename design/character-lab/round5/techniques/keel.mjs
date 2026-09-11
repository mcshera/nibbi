/* Round-5 · 02 — KEEL (deliberation). A dense ink body with a heavy round base that rocks like a roly-poly and always rights itself.
 * Cues never set the angle: they apply torque or an impulse; the pendulum does the rest. Thinking is weighing — rock to one side, hold, rock to the other. */
import * as ink from '../../ink.mjs';
import { ACTION_IDS } from '../../actions.mjs';
const { clamp, mix, TAU, FOOT } = ink;

export const meta = {
  id: 'keel', name: 'Keel', faculty: 'deliberation',
  technique: 'a rigid pendulum on a curved base (roly-poly): one angle, a restoring torque from the low centre of mass, damping that changes with the moment; the pupils counter-rotate so the gaze stays level',
  tagline: 'A weighted ink body that rocks when it weighs something and always comes back to an even keel.',
  look: 'Dense, smooth, crisp-edged ink; wider and heavier at the base, narrower at the crown, a faint bleed line at the edge and a thin wet ring on the paper where it sits.',
  motion: 'Nothing is placed; everything is pushed. Listen holds a lean against gravity. Think rocks slowly side to side with a hold at each end. Success is one push and a few decaying swings. Error is knocked nearly over, holds, then rights itself. Release it and it overshoots once.',
  eyes: 'Canonical whites and pupils drawn in the body frame; the pupils counter-rotate against the tilt so Nibbi keeps looking at the same point while the body rocks.',
  thoughtful: [
    'think: rocks to the left (recall) and holds, then to the right (compose) and holds — weighing both sides before it settles',
    'listen: holds a steady lean toward the person against its own weight, gaze level on them',
    'error: is knocked almost over and stays there for a beat, eyes on the failure, then rights itself and looks at the person',
    'success: one push, a few decaying swings, then an even keel — it does not keep celebrating',
    'touch: push it and it comes back; hold it tilted and it waits, looking at your finger, then rights itself when you let go',
  ],
  risks: ['a roly-poly is a toy silhouette; the crisp egg can read as a daruma rather than ink', 'the rolling translation moves the body on the pill more than the current character does', 'rocking at 24 px is a two-pixel tilt; error and listen carry, think may not'],
  stills: { idle: 2, hello: .55, listen: 1.6, think: 1.5, work: 1.2, success: .6, error: .9, sleep: 2, tap: .35 },
};

const PERSON = [-.9, .2], WORK = [.2, .85], RECALL = [-.7, -.85], COMPOSE = [.5, -.7], AHEAD = [0, .1], FAIL = [.75, .8];
const BEAT = .18, ONE = { hello: 1.8, success: 2.4, error: 3.0, tap: 1.4 }, REDUCED_HOLD = 3;
const W0 = 3.9;   // natural angular frequency (rad/s) — period ≈ 1.6 s
const RB = 1.15;  // base curvature radius in R (> centre of mass height, so it rights itself)

export function mount(host, { R = 96, seed = 1, tint = null, reduced = false, energy = 1, size = 'hero', paper = true } = {}) {
  const W = Math.round(3.4 * R), H = Math.round(3.6 * R), footX = 1.7 * R, footY = 3.1 * R;
  host.style.width = W + 'px'; host.style.height = H + 'px'; host.style.position = 'relative';
  const dpr = Math.min(2, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1));
  const canvas = document.createElement('canvas'); canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.cssText = `display:block;width:${W}px;height:${H}px;touch-action:none`;
  host.appendChild(canvas); const ctx = canvas.getContext('2d');
  const hero = size === 'hero', tiny = size === 'tiny';
  const st = { reduced, energy, tint };
  let action = 'idle', tA = 0, time = 0, rc = 0, pressed = false, pressT = 0, finger = { x: 0, y: -.3 };
  let th = 0, om = 0;                      // angle, angular velocity
  let sx = 1, sy = 1, vsx = 0, vsy = 0;    // puff/squash springs
  const gaze = { x: 0, y: .1, tx: 0, ty: .1 }, eye = { blinkT: 1, nextBlink: 3, happy: 0, wide: 1, lid: .1 };
  const outline = eggPoints(R, tiny ? 40 : 72, seed);

  function wants(a, t, tm, e) {
    const w = { target: 0, zeta: .25, hold: false, place: AHEAD, lid: .1, happy: 0, wide: 1, sy: 1, sx: 1 };
    const breath = Math.sin(tm / 6 * TAU);
    switch (a) {
      case 'idle': w.sy = 1 + .01 * breath; w.sx = 1 - .006 * breath; break;
      case 'listen': w.target = -.17 * e; w.zeta = .9; w.hold = true; w.place = PERSON; w.lid = 0; w.wide = 1.04; break;
      case 'think': { const ph = t % 4.4; const left = ph < 2.2; w.target = (left ? -1 : 1) * .08 * e; w.zeta = .85; w.hold = true; w.place = left ? RECALL : COMPOSE; w.lid = .42; break; }
      case 'work': w.target = .035 * e * Math.sin(tm * TAU / 1.4); w.zeta = .9; w.hold = true; w.place = WORK; w.lid = .3; w.sy = .96; w.sx = 1.02; break;
      case 'hello': w.place = PERSON; w.lid = 0; w.wide = 1.06; w.zeta = .3; break;
      case 'success': w.place = t < 1.2 ? [0, -.3] : PERSON; w.lid = 0; w.happy = t > .3 ? .85 : 0; w.wide = 1.06; w.zeta = .16; w.sy = 1 + .07 * ink.bell((t - .15) / .7); w.sx = w.sy; break;
      case 'error': if (t < 1.3) { w.target = .44 * e; w.zeta = 1; w.hold = true; w.place = FAIL; w.lid = .35; } else { w.zeta = .7; w.place = PERSON; w.lid = .2; } break;
      case 'sleep': w.zeta = 1; w.hold = true; w.place = [0, .3]; w.lid = 1; w.sy = .86 + .01 * breath; w.sx = 1.08; break;
      case 'tap': w.zeta = .2; w.place = null; w.lid = 0; w.wide = 1.04; break;
    }
    return w;
  }
  const STILL_TH = { idle: 0, hello: -.14, listen: -.17, think: -.08, work: .03, success: .14, error: .44, sleep: 0, tap: .15 };
  function relax() {
    const w = wants(action, meta.stills[action], 0, st.energy);
    th = STILL_TH[action] * (action === 'idle' || action === 'sleep' ? 1 : st.energy); om = 0; sx = w.sx; sy = w.sy; vsx = vsy = 0;
    const p = w.place || [clamp(finger.x * 1.2, -1, 1), clamp(finger.y * 1.5, -1, 1)]; gaze.x = gaze.tx = p[0]; gaze.y = gaze.ty = p[1];
    eye.lid = w.lid; eye.happy = w.happy; eye.wide = w.wide; eye.blinkT = 1;
  }

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
        // impulses land one beat after the cue (eyes have already moved)
        if (tA >= BEAT && tA - dt < BEAT) {
          if (action === 'hello') om -= 2.0 * e;
          if (action === 'success') om -= 2.4 * e;
          if (action === 'tap') om += (finger.x < 0 ? 1 : -1) * 1.5 * e * (1 + .4 * Math.abs(finger.y));
        }
        // pendulum: restoring torque about the low centre of mass, a holding torque toward the moment's target, damping by moment
        let target = w.target, zeta = w.zeta, hold = w.hold;
        if (pressed) { target = clamp(finger.x * .55, -.5, .5); zeta = 1; hold = true; }
        { const n = Math.max(1, Math.ceil(dt * 120)), h = dt / n;   // sub-stepped: stable when the lab drops to 10 fps
          for (let i = 0; i < n; i++) {
            const restore = -W0 * W0 * Math.sin(th);
            const holdT = hold ? W0 * W0 * Math.sin(target) + 14 * (target - th) : 0;
            om += (restore + holdT - 2 * zeta * W0 * om) * h;
            th += om * h; th = clamp(th, -.6, .6);
            vsx += (160 * (w.sx - sx) - 20 * vsx) * h; sx += vsx * h; vsy += (160 * (w.sy - sy) - 20 * vsy) * h; sy += vsy * h;
          } }
        sx = clamp(sx, .6, 1.5); sy = clamp(sy, .6, 1.5);
        if (action === 'hello' && tA >= BEAT && tA < BEAT + .12) sy = mix(sy, .93, .5);
        // eyes
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
      else if (kind === 'up') { const short = pressed && time - pressT < .25; pressed = false; if (short) ctl.poke(x, y, 'tap'); else if (!st.reduced) { om += -th * 2; } }
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
    const color = ink.inkColor(st.tint);
    // rolling contact: the base rolls by RB·θ; the body rotates about the centre of curvature
    const roll = RB * th * R;   // rolling without slipping: the centre of curvature travels RB·θ
    if (!tiny) { ctx.save(); ctx.globalAlpha = .16; ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(footX + roll, footY + R * .02, R * (.62 + .05 * Math.abs(th)), R * .07, 0, 0, TAU); ctx.fill(); ctx.restore(); }
    ctx.save();
    ctx.translate(footX + roll, footY - RB * R); ctx.rotate(th); ctx.translate(0, RB * R);   // pivot at the centre of curvature
    ctx.scale(sx, sy); ctx.translate(0, -FOOT * R);
    ctx.fillStyle = color; ink.tracePath(ctx, outline); ctx.fill();
    if (!tiny) { ctx.strokeStyle = color; ctx.globalAlpha = .35; ctx.lineWidth = Math.max(1, R * .03); ctx.stroke(); ctx.globalAlpha = 1; }
    // eyes: whites in body frame, pupils counter-rotated so the gaze stays level
    const c = Math.cos(-th), s = Math.sin(-th);
    const gx = gaze.x * c - gaze.y * s, gy = gaze.x * s + gaze.y * c;
    const open = 1 - ink.bell(eye.blinkT), sleeping = action === 'sleep' || eye.lid >= .99;
    const geo = ink.eyes(ctx, R, { eyeX: gx, eyeY: gy, blink: sleeping ? 1 : 1 - open, wide: eye.wide, happy: eye.happy }, { ink: color, style: 'paper' });
    if (sleeping) { ctx.strokeStyle = '#fbfaf7'; ctx.lineWidth = Math.max(1, R * .03); ctx.lineCap = 'round'; for (const g of geo) { ctx.beginPath(); ctx.moveTo(g.cx - g.rx * .8, g.cy); ctx.quadraticCurveTo(g.cx, g.cy + g.rx * .35, g.cx + g.rx * .8, g.cy); ctx.stroke(); } }
    else if (eye.lid > .03 && !(tiny && eye.lid < .3)) { ctx.fillStyle = color; for (const g of geo) { ctx.save(); ctx.beginPath(); ctx.ellipse(g.cx, g.cy, g.rx, g.ry, 0, 0, TAU); ctx.clip(); const ry0 = ink.EYES[0].ry * R * eye.wide; ctx.beginPath(); ctx.ellipse(g.cx, g.cy - ry0 * (2.1 - 1.6 * eye.lid), g.rx * 1.25, ry0 * 1.05, 0, 0, TAU); ctx.fill(); ctx.restore(); } }
    ctx.restore();
  }
  if (st.reduced) relax();
  draw();
  return ctl;
}

/* Heavy-bottomed egg: wider below the centre, narrower at the crown, a soft blend with Nibbi's base profile so the silhouette stays family. */
function eggPoints(R, n, seed) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = i / n, a = t * TAU, cx = Math.cos(a), sy = Math.sin(a);
    const down = Math.max(0, sy), up = Math.max(0, -sy);
    // Nibbi's wide, low profile with a heavier base: the crown stays asymmetric so a tilt reads on the silhouette, not only on the eyes
    let r = ink.baseProfile(a) + .1 * down * (1 - .5 * Math.abs(cx)) - .05 * Math.pow(up, 1.6);
    r += .014 * ink.ringNoise(t, 5, seed, 2);
    pts.push({ x: Math.cos(a) * r * R * 1.04, y: Math.sin(a) * r * R * .94 });
  }
  return pts;
}

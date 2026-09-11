/* Option 01 — Inkdrop. A fat drop of wet ink, fresh from a nib. Closest relative of the current Nibbi.
 * Material: dense black core, fuzzy irregular edge, soft bleed halo into the paper fibres, a small crown peak (the drop's tail).
 * Grammar: WET WEIGHT. Moves by leaning its mass and pouring into the next pose; viscous overshoot that damps fast;
 * landings leave a bleed ring that soaks in and fades. Idle is a slow breath of the halo. Nothing jumps unless asked.
 */
import * as ink from '../ink.mjs';
const { clamp, mix, ease, bell, window01, smooth, TAU, FOOT } = ink;

export const meta = {
  id: 'inkdrop',
  name: 'Inkdrop',
  tagline: 'a drop of wet ink from a nib, breathing into the paper',
  material: 'Dense wet ink with the fuzzy irregular edge Nibbi already has, plus a faint bleed halo where the ink soaks into paper fibres and a small crown peak — the tail of the drop.',
  grammar: 'Wet weight. Every move is lean → pour → settle: viscous slow-in, one damped overshoot, a landing ring that soaks in and fades. Idle is a 6 s breath of the halo; sleep spreads into a puddle; error sags and drips once.',
  feeling: 'soft, weighty, quietly alive',
  risks: ['Face can get lost in goo during big shape changes', 'Slow viscous timing can read as sad if overdone', 'Halo and bleed rings cost fill-rate at hero size', 'Mass conservation is faked with reciprocal scale'],
};

const DUR = { idle: 6, hello: 1.6, listen: 4, think: 4.8, work: 3.6, success: 2.1, error: 1.9, sleep: 6, tap: 1.0 };
export function durationFor(action) { return DUR[action] ?? 1; }
// signature still per action (fraction of duration) used by the sheet/matrix
export const stillAt = { hello: .25, error: .5, tap: .18, work: .45, success: .45 };

const REST = () => ({ x: 0, lift: 0, sx: 1, sy: 1, rotate: 0, lean: 0, round: 0, drop: .22, eyeX: 0, eyeY: 0, blink: 0, wide: 1, happy: 0,
  halo: .5, bleed: 0, drip: 0, satellite: 0, specks: 0, phase: 'rest' });
// damped wobble after a landing: t seconds since landing
const wobble = (t, amp, freq = 9, decay = 5.5) => (t <= 0 ? 0 : amp * Math.exp(-decay * t) * Math.sin(t * freq));
const blinkAt = (t, at, len = .22) => bell(window01(t - at, 0, len));

export function sample(action, t, { energy = 1, reduced = false } = {}) {
  const s = REST(); const e = clamp(energy, 0, 1.5); const d = durationFor(action); const u = clamp(t / d, 0, 1);
  if (reduced) {
    switch (action) {
      case 'hello': s.sy = .84; s.sx = 1.2; s.wide = 1.08; s.eyeY = -.1; break;
      case 'listen': s.lean = -.24; s.rotate = -.06; s.x = -.04; s.sy = .96; s.sx = 1.04; s.wide = 1.08; s.eyeX = -.35; s.eyeY = .2; s.halo = .8; break;
      case 'think': s.lean = -.36; s.drop = .6; s.rotate = .06; s.eyeX = -.55; s.eyeY = -.55; break;
      case 'work': s.sy = .93; s.sx = 1.05; s.eyeX = .35; s.eyeY = .45; s.halo = .8; s.satellite = .6; break;
      case 'success': s.happy = .8; s.drop = .35; s.wide = 1.05; s.specks = .6; break;
      case 'error': s.sy = .88; s.sx = 1.1; s.drip = 1; s.eyeY = .6; s.lean = .1; s.drop = .04; break;
      case 'sleep': s.sx = 1.12; s.sy = .84; s.blink = 1; s.drop = 0; s.round = .1; s.halo = .3; break;
      case 'tap': s.wide = 1.08; s.sx = 1.04; s.sy = .97; break;
    }
    s.phase = action; return s;
  }
  switch (action) {
    case 'idle': {
      const br = Math.sin(t / d * TAU);                       // one breath per loop
      s.sy = 1 + .012 * br; s.sx = 1 - .010 * br; s.halo = .5 + .35 * br;
      s.lean = .03 * Math.sin(t / d * TAU * 2 + 1);           // the peak sways twice per breath
      s.eyeX = .18 * Math.sin(t / d * TAU + .7); s.eyeY = .06 * Math.sin(t / d * TAU * 2);
      s.blink = blinkAt(t, 4.1); s.phase = 'idle'; break;
    }
    case 'hello': {
      // a wide squash (the greeting itself), then a modest bob with a small peak, landing ring, wobble. Distinct from success's tall plop.
      const ant = window01(u, 0, .3), up = window01(u, .3, .5), fall = window01(u, .5, .66), post = Math.max(0, t - d * .66);
      const squash = bell(ant * .5 + .5) * (1 - up);
      s.sy = mix(1, .82, squash); s.sx = mix(1, 1.22, squash);
      const arc = Math.sin(Math.PI * (up * .5 + fall * .5));
      s.lift = .22 * e * arc; s.rotate = -.05 * arc; s.lean = -.12 * arc;
      s.drop = mix(.22, .4, smooth(.2, 1, up) * (1 - fall * .9));
      if (fall >= 1) { s.sy = 1 + wobble(post, .1 * e); s.sx = 1 / s.sy; s.bleed = .8 * Math.exp(-post * 3.2); }
      s.wide = 1 + .08 * bell(window01(u, 0, .6)); s.eyeY = -.15 * arc; s.eyeX = -.1 * squash; s.phase = u < .3 ? 'squash' : u < .66 ? 'bob' : 'settle'; break;
    }
    case 'listen': {
      const ph = t / d * TAU; const bob = Math.sin(ph * 2);
      s.lean = -.24 + .025 * bob; s.rotate = -.06; s.x = -.04; s.sy = .96 + .01 * bob; s.sx = 1.04 - .008 * bob;
      s.wide = 1.08; s.eyeX = -.35 + .05 * Math.sin(ph); s.eyeY = .2; s.halo = .8;
      s.blink = blinkAt(t, 2.9); s.phase = 'listen'; break;
    }
    case 'think': {
      const ph = t / d * TAU; const sway = Math.sin(ph);
      s.x = .04 * sway; s.rotate = .06 + .04 * sway; s.lean = -.36 + .08 * Math.sin(ph + 1.2); s.drop = .6 + .1 * Math.sin(ph * 2);
      s.sy = 1 + .015 * Math.sin(ph * 2); s.sx = 1 / s.sy;
      s.eyeX = -.55 + .1 * sway; s.eyeY = -.55 + .08 * Math.sin(ph * 2); s.halo = .6 + .2 * Math.sin(ph * 3);
      s.blink = blinkAt(t, 3.3); s.phase = 'think'; break;
    }
    case 'work': {
      // three nib-dips per loop, each a little different; a bead lifts off the crown and returns
      const beats = 3, bt = (t / d) * beats, k = Math.floor(bt), f = bt - k;
      const dip = bell(window01(f, 0, .5)), var_ = [1, .7, .85][k % 3];
      s.sy = .94 - .03 * dip * var_; s.sx = 1.04 + .025 * dip * var_; s.lift = .03 * e * bell(window01(f, .1, .6)) * var_;
      s.satellite = bell(window01(f, .15, .75)) * var_; s.drop = .22 + .15 * dip;
      s.eyeX = .35 - .15 * dip; s.eyeY = .45 - .35 * dip; s.halo = .8; s.blink = k === 1 ? blinkAt(f, .7, .18) : 0;
      s.phase = f < .5 ? 'dip' : 'write'; break;
    }
    case 'success': {
      const ant = window01(u, 0, .18), air = window01(u, .18, .62), post = Math.max(0, t - d * .62);
      s.sy = mix(1, .78, bell(ant * .5 + .5) * (1 - air)); s.sx = 1 / s.sy;
      s.lift = Math.min(.95, .85 * e) * Math.sin(Math.PI * air) * (air < 1 ? 1 : 0);
      s.drop = mix(.22, .75, Math.sin(Math.PI * air)); s.round = .2 * Math.sin(Math.PI * air);
      s.satellite = bell(window01(air, .3, 1)) * .9; s.rotate = .06 * Math.sin(Math.PI * air);
      if (air >= 1) { const w = wobble(post, .3 * e, 8.5, 4.8); s.sy = clamp(1 + w, .68, 1.3); s.sx = 1 / s.sy; s.bleed = Math.exp(-post * 2.2); s.specks = Math.exp(-post * 1.6); }
      s.happy = u > .3 ? clamp((u - .3) / .2, 0, 1) * (1 - window01(u, .88, 1)) : 0; s.wide = 1 + .05 * bell(u); s.eyeY = -.3 * Math.sin(Math.PI * air);
      s.phase = u < .18 ? 'lean' : u < .62 ? 'plop' : 'land'; break;
    }
    case 'error': {
      // sag early, drip through the middle, recover late — the still at 50% shows both
      const sag = smooth(0, .22, u) * (1 - smooth(.78, 1, u));
      s.sy = 1 - .12 * sag; s.sx = 1 + .1 * sag; s.lean = .1 * sag; s.drop = mix(.22, .04, sag);
      s.drip = u < .8 ? smooth(.16, .5, u) : (1 - smooth(.8, 1, u));
      s.eyeY = .6 * sag; s.eyeX = .1 * sag; s.halo = .3; s.blink = blinkAt(t, d * .52, .3) * .6;
      s.phase = u < .22 ? 'sag' : u < .78 ? 'drip' : 'recover'; break;
    }
    case 'sleep': {
      const br = Math.sin(t / d * TAU);
      s.sx = 1.12 + .01 * br; s.sy = .84 - .008 * br; s.blink = 1; s.drop = 0; s.round = .1; s.halo = .3 + .1 * br; s.phase = 'sleep'; break;
    }
    case 'tap': {
      const w = wobble(t, .11 * e, 14, 4.2); s.sy = 1 + w; s.sx = 1 - w * .9;
      s.wide = 1 + .08 * Math.exp(-t * 3); s.eyeY = -.1 * Math.exp(-t * 3); s.bleed = .5 * Math.exp(-t * 4); s.phase = t < .3 ? 'jiggle' : 'settle'; break;
    }
    default: s.phase = action;
  }
  return s;
}

const SEED = 7;
const bodyPoints = (R, s, time, reduced) => ink.blobPoints(R, { seed: SEED, rough: .075, boil: .18, time: reduced ? 0 : time, lean: s.lean, round: s.round, drop: s.drop });

export function render(ctx, s, { R, footX, footY, time = 0, reduced = false, tint = null, size = 'hero' }) {
  const color = ink.inkColor(tint); const hero = size === 'hero', tiny = size === 'tiny';
  ctx.save();
  // world-space marks that stay on the paper: landing ring, drip
  if (!tiny && s.bleed > .01) ink.bleedRing(ctx, footX + s.x * R, footY, R * s.sx, s.bleed, { color, seed: SEED });
  if (s.drip > .01) {
    const len = s.drip * (tiny ? .3 : .42) * R, x = footX + s.x * R + R * .18, y0 = footY - .04 * R;
    ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1, R * .06 * (1 - .5 * s.drip));
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + len); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y0 + len, Math.max(1, R * .07), 0, TAU); ctx.fill(); ctx.restore();
  }
  if (!tiny && s.specks > .01) ink.specks(ctx, footX + s.x * R, footY - .2 * R, R, { count: 5, seed: SEED + 2, spread: 1.1, color, alpha: s.specks });
  ink.poseTransform(ctx, footX, footY, R, s);
  ctx.translate(0, -FOOT * R);
  const pts = bodyPoints(R, s, time, reduced);
  if (hero && s.halo > .02) { // bleed halo: ink soaking into paper fibres
    ctx.save(); ctx.globalAlpha = .085 * s.halo; ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = R * .22;
    ctx.scale(1.1, 1.08); ink.tracePath(ctx, pts); ctx.fill(); ctx.restore();
  }
  ink.fuzzyFill(ctx, pts, { color, R, soft: hero ? .06 : (tiny ? 0 : .03), tufts: hero ? 30 : (tiny ? 0 : 10), seed: SEED });
  if (!tiny && s.satellite > .02) { // a bead lifting off the crown
    const k = s.satellite, bx = -.12 * R, by = -(1.02 + .55 * k) * R * (1 + .4 * s.drop);
    ctx.save(); ctx.fillStyle = color; ctx.globalAlpha = .95; ctx.beginPath(); ctx.ellipse(bx, by, R * .075 * bell(k * .5 + .5) + .5, R * .09 * bell(k * .5 + .5) + .5, 0, 0, TAU); ctx.fill(); ctx.restore();
  }
  ink.eyes(ctx, R, s, { style: 'ink', ink: color, seed: SEED });
  ctx.restore();
}

export function geometry(s, { R, footX, footY }) {
  const pts = bodyPoints(R, s, 0, true);
  const b = ink.bounds(footX, footY, R, s, pts);
  const eyes = ink.EYES.map(e => { const m = ink.mapPoint(footX, footY, R, s, e.x * R, (e.y - FOOT) * R); return { cx: m.x, cy: m.y, rx: e.rx * R * s.wide * s.sx, ry: e.ry * R * s.wide * s.sy }; });
  const faceContained = eyes.every(e => e.cx - e.rx >= b.left && e.cx + e.rx <= b.right && e.cy - e.ry >= b.top && e.cy + e.ry <= b.bottom);
  return { bounds: b, eyes, faceContained };
}

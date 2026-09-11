/* SUMI STROKE — Nibbi as one confident sumi-e brush stroke: a wet pressed head carrying the eyes,
 * trailing into a dry-brush tail that is the gesture line. Grammar: REDRAWN, NOT MOVED. */
import * as ink from '../ink.mjs';
const { clamp, mix, ease, bell, window01, TAU, FOOT } = ink;

export const meta = {
  id: 'sumi', name: 'Sumi stroke',
  tagline: 'One brush stroke: a wet pressed head and a dry tail that re-lays itself for every gesture.',
  material: 'Dense wet ink head (rough blob, a few tufts) fusing into a thinning dry-brush tail of broken bristle streaks; ink goes from wet black at the head to dry grey at the tip. Eyes are brush-dab whites. One optional tiny vermilion hanko dot on success.',
  grammar: 'Redrawn, not moved: a pose change lifts the old stroke (ghost thins and lightens in ~120 ms) while the new tail is laid down along its path (reveal 0→1 over ~250 ms, fast then a slow press at the end). Between gestures: calligrapher stillness. Idle is blink, gaze, and a hair of ink settle. Work writes short tally flicks every 0.6 s; think re-lays hesitant curls; success is one wide flourish over the head that fades; error is a pressed-too-hard blot with a single drip; sleep is the stroke drying to grey.',
  feeling: 'decisive, calm, brushy, dry wit',
  risks: [
    'Variable silhouette (tail redrawn per action) weakens instant identity; the head + eyes have to carry it.',
    'Stroke paths need tuning per action; some tails could read as a limb or pointer rather than a stroke.',
    'The vermilion seal on success is the only colour accent and may fight a strict monochrome brand.',
    'Dry-brush bristles cost draw ops; tiny sizes drop to a solid tail and lose the material.',
  ],
};

const DUR = { idle: 6, hello: 1.4, listen: 4, think: 4, work: 3.6, success: 1.8, error: 1.6, sleep: 6, tap: .9 };
export function durationFor(action) { return DUR[action] ?? 1; }
// Signature still per action (fraction of duration) — the frame where the tail shape is complete.
export const stillAt = { hello: .5, think: .7, success: .45, error: .6, tap: .4 };

// Tail poses: angle (rad, 0 = right, negative = up), curl (-1..1, negative bends up/over), len (R units), dry (0..1)
const TAILS = {
  rest:   { angle: -.10, curl: .35, len: .95, dry: .35 },
  flick:  { angle: -1.00, curl: 1.6, len: 1.20, dry: .30, wave: 1 },   // hello: S-wave
  listen: { angle: Math.PI + .50, curl: .45, len: .95, dry: .40 },
  think0: { angle: -1.55, curl: 1.45, len: 1.30, dry: .30 },   // think: pen circling
  think1: { angle: -1.35, curl: 1.30, len: 1.25, dry: .35 },
  think2: { angle: -1.70, curl: 1.55, len: 1.30, dry: .30 },
  flourish: { angle: -1.30, curl: -1.0, len: 1.45, dry: .35 },
  limp:   { angle: .30, curl: .40, len: .80, dry: .60 },
  sleep:  { angle: .04, curl: .02, len: .95, dry: .55 },
  tap:    { angle: -.15, curl: -.40, len: .60, dry: .40 },   // tap: short flick right
};
const WORK = [ // tally-like short strokes, one per 0.6 s
  { angle: -.20, curl: .30, len: .90, dry: .45 }, { angle: -.55, curl: -.30, len: .84, dry: .50 },
  { angle: -.05, curl: .55, len: .95, dry: .40 }, { angle: -.40, curl: .10, len: .82, dry: .55 },
  { angle: -.30, curl: -.50, len: .92, dry: .45 }, { angle: -.65, curl: .40, len: .86, dry: .50 },
];

const REST = () => ({
  x: 0, lift: 0, sx: 1, sy: 1, rotate: 0, eyeX: 0, eyeY: 0, blink: 0, wide: 1, happy: 0, phase: 'rest',
  tail: { ...TAILS.rest }, reveal: 1, ghost: null, alpha: 1, blot: 0, drip: 0, seal: 0, settle: 0, press: 0,
});

// Stroke re-lay: at tt (seconds since the change), the old tail lifts (ghost) while the new one is revealed.
function relay(s, from, to, tt, dur = .26) {
  if (tt < 0) { s.tail = { ...from }; return; }
  s.tail = { ...to };
  if (tt < dur) {
    const u = tt / dur;
    s.reveal = clamp(1 - Math.pow(1 - u, 2.4), 0, 1);         // fast in the middle, slow press at the end
    const g = 1 - clamp(tt / .12, 0, 1);
    s.ghost = g > 0 ? { ...from, alpha: g * .55 } : null;
    s.press = bell(u) * .5;                                   // brush pressure while laying down
  }
}

// The still for each action (what a person sees in one frame). Also the reduced-motion expression.
function still(s, action) {
  switch (action) {
    case 'hello':   s.tail = { ...TAILS.flick }; s.wide = 1.03; break;
    case 'listen':  s.tail = { ...TAILS.listen }; s.rotate = -.10; s.wide = 1.05; s.eyeX = -.35; break;
    case 'think':   s.tail = { ...TAILS.think0 }; s.eyeX = -.5; s.eyeY = -.6; break;
    case 'work':    s.tail = { ...WORK[2] }; s.eyeX = .4; s.eyeY = .35; break;
    case 'success': s.tail = { ...TAILS.flourish }; s.happy = .8; s.seal = 1; break;
    case 'error':   s.tail = { ...TAILS.limp }; s.blot = 1; s.drip = .8; s.eyeY = .65; s.sy = .96; break;
    case 'sleep':   s.tail = { ...TAILS.sleep }; s.blink = 1; s.alpha = .75; s.sy = .92; break;
    case 'tap':     s.tail = { ...TAILS.tap }; s.wide = 1.02; break;
    default: break;
  }
  s.phase = action; return s;
}

export function sample(action, t, { energy = 1, reduced = false } = {}) {
  const s = REST(); const e = clamp(energy, .5, 1.5); const d = durationFor(action); const u = clamp(t / d, 0, 1);
  if (reduced) return still(s, action);
  switch (action) {
    case 'idle': {
      s.blink = bell(window01((t % 6) - 4.1, 0, .22));
      s.eyeX = .18 * Math.sin(t / 6 * TAU); s.eyeY = .06 * Math.sin(t / 6 * TAU * 2);
      s.settle = .02 * Math.sin(t / 6 * TAU);                 // hair of ink settle in the tail
      s.tail.curl += .04 * Math.sin(t / 6 * TAU);
      s.phase = 'idle'; break;
    }
    case 'hello': {
      s.sy = 1 - .10 * Math.min(e, 1) * bell(window01(t, 0, .3)); s.sx = 1 / s.sy;   // head presses first (capped so the tail stays on the stage)
      relay(s, TAILS.rest, TAILS.flick, t - .18, .28);                  // then a fresh flick sweeps up
      if (t > .95) relay(s, TAILS.flick, TAILS.rest, t - .95, .3);      // and returns to rest
      s.wide = 1 + .04 * bell(u); s.eyeY = -.2 * bell(u);
      s.phase = t < .18 ? 'press' : t < .95 ? 'flick' : 'settle'; break;
    }
    case 'listen': {
      still(s, 'listen');
      s.rotate = -.10 - .012 * Math.sin(t / 4 * TAU);
      s.eyeX = -.35 + .05 * Math.sin(t / 4 * TAU); s.blink = bell(window01((t % 4) - 2.6, 0, .2));
      s.tail.curl += .03 * Math.sin(t / 4 * TAU); break;
    }
    case 'think': {
      const seg = 4 / 3, k = Math.floor(clamp(t, 0, 3.999) / seg), tt = t - k * seg;
      const poses = [TAILS.think0, TAILS.think1, TAILS.think2];
      relay(s, poses[(k + 2) % 3], poses[k], tt, .34);
      s.tail.curl += .10 * e * Math.sin(t / 4 * TAU * 3);               // hesitation wander in the hold
      s.eyeX = -.5; s.eyeY = -.6 + .05 * Math.sin(t / 4 * TAU);
      s.blink = bell(window01(t - 3.1, 0, .2));
      s.phase = 'think' + k; break;
    }
    case 'work': {
      const seg = .6, k = Math.floor(clamp(t, 0, 3.599) / seg), tt = t - k * seg;
      relay(s, WORK[(k + 5) % 6], WORK[k], tt, .22);
      s.lift = .03 * e * bell(clamp(tt / .3, 0, 1));                     // head bobs as it writes
      s.eyeX = .4; s.eyeY = .35 - .05 * bell(clamp(tt / .3, 0, 1));
      s.phase = 'stroke' + k; break;
    }
    case 'success': {
      relay(s, TAILS.rest, TAILS.flourish, t - .05, .34);
      const fade = window01(t, .85, 1.25);                              // flourish dries away
      if (t > 1.05) relay(s, TAILS.flourish, TAILS.rest, t - 1.05, .3); else s.tail.fade = fade;
      s.lift = .10 * e * bell(window01(t, .05, .6));
      s.sy = 1 + .06 * e * bell(window01(t, .05, .6)); s.sx = 1 / s.sy;
      s.happy = .85 * bell(window01(t, .15, 1.7)) * Math.min(1, 1.6);
      s.seal = bell(window01(t, .45, 1.55));
      s.eyeY = -.15 * bell(window01(t, .05, .8));
      s.phase = t < .45 ? 'flourish' : t < 1.05 ? 'seal' : 'settle'; break;
    }
    case 'error': {
      relay(s, TAILS.rest, TAILS.limp, t - .08, .3);
      const on = window01(t, .05, .3), off = 1 - window01(t, 1.2, 1.55);
      s.blot = on * off; s.drip = window01(t, .3, .9) * off;
      s.sy = 1 - .04 * on * off; s.eyeY = .65 * on * off; s.eyeX = .1 * on * off;
      if (t > 1.25) relay(s, TAILS.limp, TAILS.rest, t - 1.25, .3);
      s.phase = t < .3 ? 'press' : t < 1.25 ? 'drip' : 'settle'; break;
    }
    case 'sleep': {
      still(s, 'sleep');
      s.sy = .92 + .015 * Math.sin(t / 6 * TAU); break;
    }
    case 'tap': {
      relay(s, TAILS.rest, TAILS.tap, t - .04, .2);
      if (t > .5) relay(s, TAILS.tap, TAILS.rest, t - .5, .24);
      const j = .08 * e * Math.sin(t * 14) * Math.exp(-t * 4) * (t > .04 ? 1 : 0);
      s.sy = 1 + j; s.sx = 1 - j * .8; s.wide = 1 + .03 * bell(u); s.eyeY = -.1 * bell(u);
      s.phase = t < .5 ? 'restroke' : 'settle'; break;
    }
    default: still(s, action);
  }
  s.sx = clamp(s.sx, .5, 1.6); s.sy = clamp(s.sy, .5, 1.6);
  return s;
}

// ---- geometry of the stroke (body-local, head centre at 0,0) -------------------------------------------
const HEAD_R = .80;
function headPoints(R, time = 0) { return ink.blobPoints(R * HEAD_R, { seed: 7, rough: .05, round: .3, time, boil: .08, n: 48 }); } // a pressed brush head: wider than tall, flatter base — Nibbi's profile, not a circle
function tailPoints(R, tail, n = 26) {
  const pts = []; const start = .60 * R; const L = tail.len * R;
  let x = Math.cos(tail.angle) * start, y = Math.sin(tail.angle) * start, a = tail.angle;
  const step = L / (n - 1), bend = tail.curl * 1.7 / (n - 1), wave = tail.wave ? 1 : 0;
  for (let i = 0; i < n; i++) {
    pts.push({ x, y });
    if (wave) a += bend * (i < n / 2 ? 1 : -1) * 1.3;                   // wave: S-curve, bend flips at the midpoint
    else a += bend * (0.6 + 0.8 * (i / n));                             // curl tightens toward the dry tip
    x += Math.cos(a) * step; y += Math.sin(a) * step;
  }
  return pts;
}
const tailWidth = (R, press = 0) => t => R * (.50 * (1 + press * .12) * Math.pow(1 - t, 1.05) + .03);

export function render(ctx, s, { R, footX, footY, time = 0, reduced = false, tint = null, size = 'hero' }) {
  const color = ink.inkColor(tint); const T = reduced ? 0 : time;
  const hero = size === 'hero', tiny = size === 'tiny';
  ctx.save();
  ctx.globalAlpha = clamp(s.alpha ?? 1, 0, 1);
  ink.poseTransform(ctx, footX, footY, R, s);
  ctx.translate(0, -FOOT * R);                                          // head centre
  // ghost of the lifted stroke
  if (s.ghost && !reduced && !tiny) {
    ink.brushStroke(ctx, tailPoints(R, s.ghost), tailWidth(R), { color, bristles: 0, dry: .8, alpha: s.ghost.alpha * .6, seed: 11 });
  }
  // the tail: wet root → dry breaking tip
  const tail = s.tail ?? TAILS.rest; const fade = 1 - clamp(tail.fade ?? 0, 0, 1);
  const tp = tailPoints(R, tail, tiny ? 10 : 26);
  if (tiny) ink.brushStroke(ctx, tp, t => R * (.42 * (1 - t) + .08), { color, bristles: 0, dry: 0, reveal: s.reveal, alpha: fade });
  else ink.brushStroke(ctx, tp, tailWidth(R, s.press), { color, bristles: hero ? 7 : 3, dry: tail.dry ?? .4, seed: 5, reveal: s.reveal, alpha: fade });
  // the head: a wet press-down
  const hp = headPoints(R, T);
  ink.fuzzyFill(ctx, hp, { color, R, soft: hero ? .04 : 0, tufts: hero ? 10 : 0, seed: 7 });
  if (s.blot > 0.01) {                                                  // pressed too hard: heavy bulge + drip
    ctx.fillStyle = color; ctx.globalAlpha = clamp(s.alpha ?? 1, 0, 1);
    ctx.beginPath(); ctx.ellipse(-.45 * R * s.blot, .28 * R, R * (.62 + .18 * s.blot), R * (.50 + .08 * s.blot), .1, 0, TAU); ctx.fill();
    if (s.drip > 0.01 && !tiny) {
      const y0 = .70 * R, y1 = y0 + s.drip * .22 * R;
      ctx.lineCap = 'round'; ctx.strokeStyle = color; ctx.lineWidth = R * .07;
      ctx.beginPath(); ctx.moveTo(-.55 * R, y0); ctx.lineTo(-.55 * R, y1); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(-.55 * R, y1, R * .07, R * .085, 0, 0, TAU); ctx.fill();
    }
  }
  ink.eyes(ctx, R, s, { style: 'brush', ink: color, seed: 2 });
  if (s.seal > 0.01 && !tiny) {                                         // tiny vermilion hanko, bottom-right
    ctx.globalAlpha = s.seal * .9; ctx.fillStyle = '#b8352b';
    const sz = R * .17; ctx.beginPath(); ctx.roundRect(.72 * R - sz / 2, .58 * R - sz / 2, sz, sz, sz * .2); ctx.fill();
  }
  ctx.restore();
}

export function geometry(s, { R, footX, footY }) {
  const hp = headPoints(R); const tail = s.tail ?? TAILS.rest;
  const tp = tailPoints(R, tail, 26).slice(0, Math.max(2, Math.floor(26 * clamp(s.reveal ?? 1, 0, 1))));
  const pad = tp.map((p, i) => { const w = tailWidth(R)(i / 25) / 2; return [{ x: p.x - w, y: p.y - w }, { x: p.x + w, y: p.y + w }]; }).flat();
  const b = ink.bounds(footX, footY, R, s, hp.concat(pad));
  if (s.drip > 0.01) b.bottom = Math.max(b.bottom, ink.mapPoint(footX, footY, R, s, -.22 * R, (.70 + .22 * s.drip + .085 - FOOT) * R).y);
  if (s.blot > 0.01) b.left = Math.min(b.left, ink.mapPoint(footX, footY, R, s, (-.45 * s.blot - .62 - .18 * s.blot) * R, (.28 - FOOT) * R).x);
  const hb = ink.bounds(footX, footY, R, s, hp);
  const eyes = ink.EYES.map(e => { const m = ink.mapPoint(footX, footY, R, s, e.x * R, (e.y - FOOT) * R); return { cx: m.x, cy: m.y, rx: e.rx * R * s.wide * s.sx, ry: e.ry * R * s.wide * s.sy }; });
  const faceContained = eyes.every(e => e.cx - e.rx >= hb.left && e.cx + e.rx <= hb.right && e.cy - e.ry >= hb.top && e.cy + e.ry <= hb.bottom);
  return { bounds: b, eyes, faceContained };
}

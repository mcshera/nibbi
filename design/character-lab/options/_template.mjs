/* TEMPLATE — copy this shape for a new option. Replace everything marked TODO. */
import * as ink from '../ink.mjs';
const { clamp, mix, ease, bell, window01, TAU, FOOT } = ink;

export const meta = {
  id: 'template', name: 'Template', tagline: 'TODO', material: 'TODO', grammar: 'TODO', feeling: 'TODO', risks: ['TODO'],
};
const DUR = { idle: 6, hello: 1.4, listen: 4, think: 4, work: 3, success: 1.8, error: 1.6, sleep: 6, tap: .9 };
export function durationFor(action) { return DUR[action] ?? 1; }

const REST = () => ({ x: 0, lift: 0, sx: 1, sy: 1, rotate: 0, lean: 0, eyeX: 0, eyeY: 0, blink: 0, wide: 1, happy: 0, phase: 'rest' });

export function sample(action, t, { energy = 1, reduced = false } = {}) {
  const s = REST(); const e = clamp(energy, 0, 1.5); const d = durationFor(action); const u = clamp(t / d, 0, 1);
  if (reduced) { // static expressions only
    if (action === 'sleep') s.blink = 1; if (action === 'success') s.happy = .8; if (action === 'error') s.eyeY = .5; if (action === 'listen') s.wide = 1.08; if (action === 'think') s.eyeX = -.5, s.eyeY = -.5;
    s.phase = action; return s;
  }
  switch (action) {
    case 'idle': s.blink = bell(window01((t % 6) - 4.1, 0, .25)); s.eyeX = .15 * Math.sin(t / 6 * TAU); s.phase = 'idle'; break;
    case 'hello': s.lift = .3 * e * bell(u); s.sy = 1 + .1 * Math.sin(u * TAU); s.sx = 1 / s.sy; s.phase = u < .5 ? 'up' : 'down'; break;
    // TODO: listen, think, work, success, error, sleep, tap
    default: s.phase = action;
  }
  return s;
}

export function render(ctx, s, { R, footX, footY, time = 0, reduced = false, tint = null, size = 'hero' }) {
  const color = ink.inkColor(tint);
  ctx.save();
  ink.poseTransform(ctx, footX, footY, R, s);
  ctx.translate(0, -FOOT * R);                                   // body centre
  const pts = ink.blobPoints(R, { seed: 3, rough: .05, time: reduced ? 0 : time, lean: s.lean });
  ink.fuzzyFill(ctx, pts, { color, R, soft: size === 'hero' ? .05 : 0, tufts: size === 'hero' ? 24 : 0 });
  ink.eyes(ctx, R, s, { style: 'ink', ink: color });
  ctx.restore();
}

export function geometry(s, { R, footX, footY }) {
  const pts = ink.blobPoints(R, { seed: 3, rough: .05, lean: s.lean });
  const b = ink.bounds(footX, footY, R, s, pts);
  const eyes = ink.EYES.map(e => { const m = ink.mapPoint(footX, footY, R, s, e.x * R, (e.y - FOOT) * R); return { cx: m.x, cy: m.y, rx: e.rx * R * s.wide * s.sx, ry: e.ry * R * s.wide * s.sy }; });
  const faceContained = eyes.every(e => e.cx - e.rx >= b.left && e.cx + e.rx <= b.right && e.cy - e.ry >= b.top && e.cy + e.ry <= b.bottom);
  return { bounds: b, eyes, faceContained };
}

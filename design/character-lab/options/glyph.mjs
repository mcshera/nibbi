/* OPTION 'glyph' — Typesetter. Nibbi as an ink blot set as type: a heavy printed blot on a baseline whose
 * poses quote punctuation ( . , … | ! * — ). Motion is typographic rhythm: hard cuts with a 2-frame settle, holds between. */
import * as ink from '../ink.mjs';
const { clamp, mix, bell, window01, fract, TAU, FOOT } = ink;

export const meta = {
  id: 'glyph', name: 'Typesetter',
  tagline: 'An ink blot set as type on a baseline; every pose quotes a punctuation mark.',
  material: 'Ink stays near-black at all times (error = 40% paper hatch over the ink, not a lighter fill). Heavy rounded typeset blot (blobPoints round .55, rough .015) with a clean printed edge and a faint letterpress squash (same body at alpha .35, scale 1.03, under the solid). Sits on a 1px hairline baseline (alpha .12, ±1.4R). Eyes are crisp print counters (ink.eyes style print) like the holes in letters. Monochrome ink; tint swaps ink only. Tiny drops baseline + squash and keeps the marks.',
  grammar: 'Typographic rhythm. Pose changes are hard cuts followed by one 60ms 8% overshoot, then hold; never long eases. Idle is metronomic: a cursor-style blink exactly every 4.0s, gaze cuts between three positions, nothing else moves. rest=. listen=, (comma tail, lean toward the person) think=… (compressed body, three faint dots at typing cadence, then clear) work=typing (≤.02R nod at 4 Hz, 1 Hz cursor bar, set dots slide left on the baseline) success=! (snap tall, dot below the foot, snap back once) error=* (asterisk footnote, body reads set-in-grey via a paper hatch, eyes down, restore, no shake) sleep=— (em dash lying flat, eyes closed, ±.01 sx breath only) hello=half ! tap=one bold frame with a kerning nudge that returns.',
  feeling: 'dry, precise, literate, patient',
  risks: [
    'Gimmicky / emoji-like if the punctuation quotes are overdone or too frequent.',
    'Hard cuts can feel cold or mechanical rather than alive.',
    'Punctuation silhouettes may not read as a creature to everyone (especially the — dash).',
    'The three think dots can be mistaken for the other party\'s typing indicator.',
  ],
};

const DUR = { idle: 4, hello: 1.2, listen: 4, think: 3.6, work: 3, success: 1.8, error: 1.6, sleep: 6, tap: .6 };
export function durationFor(action) { return DUR[action] ?? 1; }

/* Signature still per action (fraction of duration) — the frame where the mark is fully present. */
export const stillAt = { idle: .45, hello: .25, listen: .45, think: .6, work: .45, success: .35, error: .45, sleep: .45, tap: .1 };

/* Whole-face offset (R units) so the eye centres stay at their rest height above the foot while the body stretches ABOVE them. */
const EYE_REST_Y = 13 / 135;
const faceYFor = sy => (FOOT - (FOOT - EYE_REST_Y) / sy) - EYE_REST_Y;

const REST = () => ({ x: 0, lift: 0, sx: 1, sy: 1, rotate: 0, eyeX: 0, eyeY: 0, blink: 0, wide: 1, happy: 0, faceY: 0, phase: 'rest',
  grey: 0, tail: 0, dots: 0, cursor: 0, set: [], bang: 0, star: 0, dash: 0 });

/* Hard cut at t0: 0 before, then 1 with a single 8% overshoot over the next 60ms (the "2-frame settle"). */
const cut = (t, t0, over = .08) => (t < t0 ? 0 : 1 + over * bell((t - t0) / .06));
/* 1 between a and b (cut in at a, cut out at b), 0 elsewhere. */
const hold = (t, a, b) => cut(t, a) - cut(t, b);
/* Cursor blink: a 160ms closed window centred at c (bell so it is continuous at the loop seam). */
const wink = (t, c) => bell(window01(t - c, -.08, .08));

export function sample(action, t, { energy = 1, reduced = false } = {}) {
  const s = REST(); const e = clamp(energy, .5, 1.5); const k = .6 + .4 * e; // amplitude scale .8..1.2
  const d = durationFor(action); t = clamp(t, 0, d); s.phase = action;
  if (reduced) {
    switch (action) {
      case 'listen': s.rotate = -.08; s.tail = 1; s.eyeX = -.3; s.wide = 1.06; break;
      case 'think': s.sy = .94; s.sx = 1.03; s.x = -.14; s.dots = 3; s.eyeX = -.5; s.eyeY = -.6; s.faceY = faceYFor(s.sy); break;
      case 'work': s.cursor = 1; s.x = -.1; s.eyeX = .35; s.eyeY = .5; s.set = [{ x: 1.32, a: .6, r: .07 }, { x: 1.5, a: .35, r: .07 }]; break;
      case 'success': s.sy = 1.26; s.sx = .8; s.lift = .7; s.bang = 1; s.happy = 1; s.faceY = faceYFor(s.sy); break;
      case 'error': s.star = 1; s.grey = 1; s.eyeY = .6; s.eyeX = .15; break;
      case 'sleep': s.sx = 1.45; s.sy = .55; s.blink = 1; s.dash = 1; s.faceY = faceYFor(s.sy); break;
      case 'hello': s.sy = 1.15; s.sx = .92; s.wide = 1.1; s.happy = .4; s.faceY = faceYFor(s.sy); break;
      case 'tap': s.sx = s.sy = 1.08; s.x = .03; s.wide = 1.08; break;
    }
    return s;
  }
  switch (action) {
    case 'idle': { // metronome: blink at 2.0 of every 4.0s; gaze cuts, nothing else
      s.blink = wink(t, 2);
      s.eyeX = .28 * hold(t, 1.3, 2.6) - .18 * hold(t, 3.1, 3.9); s.eyeY = .12 * hold(t, 1.3, 2.6);
      break; }
    case 'listen': { // ',' — comma tail, lean toward the person (left)
      s.rotate = -.08 * k; s.tail = 1; s.x = .02; s.eyeX = -.3 - .1 * hold(t, 1.8, 3.2); s.eyeY = -.05; s.wide = 1.06;
      s.blink = wink(t, 2.4); break; }
    case 'think': { // '…' — compress, dots type in at .45s cadence, hold, clear
      s.sy = .94; s.sx = 1.03; s.x = -.14; s.eyeX = -.5; s.eyeY = -.6; // body shifts left to make room for the dots
      s.dots = t < .45 ? 0 : t < .9 ? 1 : t < 1.35 ? 2 : t < 2.7 ? 3 : 0;
      s.eyeX += .12 * hold(t, 2.7, 3.4); s.blink = wink(t, 3.05); s.faceY = faceYFor(s.sy); break; }
    case 'work': { // typing: 4 Hz nod ≤ .02R, 1 Hz cursor, set dots slide left on the baseline
      const beat = .25, nb = Math.round(d / beat); const ph = fract(t / beat);
      const nod = .02 * k * bell(ph / .4); s.x = -.1; s.sy = 1 - nod; s.sx = 1 + nod * .6;
      s.cursor = fract(t) < .5 ? 1 : 0; s.eyeX = .35; s.eyeY = .5;
      for (let i = 0; i < nb; i++) { // dot born at i*beat, lives 1.4s, slides left from 2.15R to 1.35R, fades
        const age = ((t - i * beat) % d + d) % d; if (age > 1.4) continue;
        const life = age / 1.4; const life2 = Math.floor(age / .2) * .2 / 1.4; // set type moves in steps
        s.set.push({ x: mix(1.56, 1.24, life2) + .03 * (ink.rand(11, i) - .5), a: (1 - life) * (.5 + .5 * ink.rand(12, i)), r: .06 + .03 * ink.rand(13, i) });
      }
      s.blink = wink(t, 1.5); break; }
    case 'success': { // '!' — snap tall, dot below the foot, snap back; then settle
      const h = hold(t, .1, 1.0); const amp = Math.min(k, 1); // the bar must stay inside the stage top
      s.sy = 1 + .26 * amp * h; s.sx = 1 - .2 * amp * h; s.lift = .7 * amp * h; s.bang = t >= .1 && t < 1.0 ? 1 : 0;
      s.happy = hold(t, .1, 1.45); s.wide = 1 + .04 * h; s.faceY = faceYFor(s.sy); break; }
    case 'error': { // '*' — footnote mark cuts in, body goes semi-bold grey, eyes down; restore, no shake
      const h = hold(t, .08, .95); s.star = t >= .08 && t < .95 ? 1 : 0; s.grey = clamp(h, 0, 1);
      s.eyeY = .6 * h; s.eyeX = .15 * h; s.sy = 1 - .02 * h; s.sx = 1 + .015 * h; break; }
    case 'sleep': { // '—' em dash lying flat; eyes closed; breath is a ±.01 sx change only
      s.sx = 1.45 + .01 * Math.sin(t / d * TAU); s.sy = .55; s.blink = 1; s.dash = 1; s.faceY = faceYFor(s.sy); break; }
    case 'hello': { // half '!' snap, hold, cut back
      const h = hold(t, .08, .72); s.sy = 1 + .15 * k * h; s.sx = 1 - .08 * k * h; s.wide = 1 + .1 * h; s.happy = .4 * hold(t, .08, .95); s.faceY = faceYFor(s.sy); break; }
    case 'tap': { // one bold frame and a kerning nudge that returns
      const b = t >= .02 && t < .1 ? 1 : 0; s.sx = s.sy = 1 + .08 * b; s.x = .03 * k * (hold(t, .02, .34) - .5 * hold(t, .34, .46));
      s.wide = 1 + .08 * hold(t, .02, .4); break; }
  }
  return s;
}

const BODY = (R, time = 0) => ink.blobPoints(R, { seed: 7, round: .55, rough: .015, time, boil: .08 });

export function render(ctx, s, { R, footX, footY, time = 0, reduced = false, tint = null, size = 'hero' }) {
  const color = ink.inkColor(tint); const tiny = size === 'tiny'; const hero = size === 'hero';
  ctx.save();
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineCap = 'butt';
  // baseline hairline (canvas space, unaffected by the pose)
  if (!tiny) { ctx.globalAlpha = .12; ctx.fillRect(footX - 1.4 * R, footY - .5, 2.8 * R, 1); ctx.globalAlpha = 1; }

  // ---- body (posed) ----
  ctx.save();
  ink.poseTransform(ctx, footX, footY, R, s);
  ctx.translate(0, -FOOT * R);
  const pts = BODY(R, reduced ? 0 : time);
  if (hero) { ctx.save(); ctx.scale(1.03, 1.03); ctx.globalAlpha = .35; ink.tracePath(ctx, pts); ctx.fill(); ctx.restore(); } // letterpress squash edge
  ink.tracePath(ctx, pts); ctx.fill();
  if (s.grey > 0) { // 'set in grey': a 40% paper-coloured diagonal hatch over the black ink (ink itself stays black)
    const sp = Math.max(2, .12 * R);
    ink.hatch(ctx, pts, { color: ink.PAPER, spacing: sp, angle: -.7, width: Math.max(1, .035 * R), seed: 5, jitter: tiny ? 0 : .3, alpha: .4 * clamp(s.grey, 0, 1) });
  }
  if (s.tail > 0) { // comma tail: a tapered curl from the lower-left foot, hanging below the baseline
    ctx.globalAlpha = clamp(s.tail, 0, 1);
    ctx.beginPath(); ctx.moveTo(-.55 * R, .45 * R); ctx.quadraticCurveTo(-.45 * R, .9 * R, -.82 * R, 1.06 * R);
    ctx.quadraticCurveTo(-.58 * R, .92 * R, -.15 * R, .62 * R); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
  }
  ink.eyes(ctx, R, s, { style: 'print', ink: color });
  if (s.blink >= .98) { // closed eyes: explicit paper ticks so they read even on the flattened dash at 24px
    ctx.strokeStyle = ink.PAPER; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1 / s.sy, .045 * R);
    for (const e of ink.EYES) { const cy = (e.y + s.faceY) * R, rx = e.rx * R * s.wide * (tiny ? .6 : .85); ctx.beginPath(); ctx.moveTo(e.x * R - rx, cy); ctx.lineTo(e.x * R + rx, cy); ctx.stroke(); }
  }
  ctx.restore();

  // ---- punctuation marks (canvas space, crisp, no pose scale) ----
  ctx.save(); ctx.translate(footX + (s.phase === 'tap' ? s.x * R : 0), footY);
  const dotR = tiny ? 1.1 : Math.max(1.2, .09 * R); const dotGap = tiny ? .27 : .22; // tiny: wider gaps so the three dots stay separate
  if (s.dots > 0) { ctx.globalAlpha = tiny ? .8 : .6; for (let i = 0; i < Math.min(3, s.dots); i++) { ctx.beginPath(); ctx.arc((1.06 + i * dotGap) * R, -dotR, dotR, 0, TAU); ctx.fill(); } ctx.globalAlpha = 1; }
  if (s.cursor > 0) { const w = Math.max(1.5, .025 * R); ctx.globalAlpha = .9 * s.cursor; ctx.fillRect(1.12 * R - w / 2, -.62 * R, w, .6 * R); ctx.globalAlpha = 1; }
  if (s.set && s.set.length) { for (const p of s.set) { const r = Math.max(tiny ? 1 : .8, p.r * R); ctx.globalAlpha = clamp(p.a, 0, 1) * .55; ctx.beginPath(); ctx.arc(p.x * R, -r, r, 0, TAU); ctx.fill(); } ctx.globalAlpha = 1; }
  if (s.bang > 0) { const r = Math.max(1.5, .14 * R); ctx.globalAlpha = s.bang; ctx.beginPath(); ctx.arc(0, -r, r, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; }
  if (s.star > 0) { // asterisk footnote above-right of the body
    const cx = 1.05 * R, cy = -(FOOT + 1.05) * R - .08 * R, len = Math.max(2.5, .2 * R);
    ctx.lineWidth = Math.max(1, .045 * R); ctx.globalAlpha = .85 * s.star; ctx.beginPath();
    for (let i = 0; i < 3; i++) { const a = Math.PI / 2 + i * Math.PI / 3; ctx.moveTo(cx - Math.cos(a) * len, cy - Math.sin(a) * len); ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len); }
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  ctx.restore();
  ctx.restore();
}

export function geometry(s, { R, footX, footY }) {
  const pts = BODY(R);
  const b = ink.bounds(footX, footY, R, s, pts);
  const eyes = ink.EYES.map(e => { const m = ink.mapPoint(footX, footY, R, s, e.x * R, (e.y + (s.faceY || 0) - FOOT) * R); return { cx: m.x, cy: m.y, rx: e.rx * R * s.wide * s.sx, ry: e.ry * R * s.wide * s.sy }; });
  const faceContained = eyes.every(e => e.cx - e.rx >= b.left && e.cx + e.rx <= b.right && e.cy - e.ry >= b.top && e.cy + e.ry <= b.bottom);
  return { bounds: b, eyes, faceContained };
}

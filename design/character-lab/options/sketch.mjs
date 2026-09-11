/* OPTION 'sketch' — Nibbi as a loose pen contour on paper, partly hatched. Drawn, not moved. */
import * as ink from '../ink.mjs';
const { clamp, mix, ease, bell, window01, smooth, TAU, FOOT } = ink;

export const meta = {
  id: 'sketch', name: 'Sketch line',
  tagline: 'A loose pen contour of Nibbi, partly hatched, that redraws itself instead of moving.',
  material: 'A 1.6–2px ink pen line with a slight hand wobble and overlapping ends, plus a fainter construction contour offset ~1.5px. The interior is paper, filled from the bottom with diagonal pen hatching (amount = state field `inked`, rest ≈ .35). Eyes are outlined pen circles with dot pupils. Success inks the whole contour solid black for a beat; sleep fades the line to pencil grey.',
  grammar: 'Drawn, not moved. (1) Line boil: the contour is redrawn with fresh jitter on an 8 fps grid — ≤ .4px in idle, 0 when listening, 1.2px when nervous. (2) Drawn-on transitions: a new contour draws itself along its path over ~250ms while the old one fades. Poses squash/stretch moderately; the fill level of the hatching is the main carrier of work progress.',
  feeling: 'observant, unfinished, dry, patient',
  risks: [
    'Line boil can look busy or cheap if it is not kept very subtle (idle must stay ≤ .4px).',
    'A thin line on cream has low contrast at pill/tiny sizes; the tiny variant needs a solid 2px contour to survive.',
    'Too much process messaging (hatching that fills, guide lines) could read as a progress bar in disguise.',
  ],
};

const DUR = { idle: 6, hello: 1.4, listen: 4, think: 4, work: 4, success: 1.8, error: 1.6, sleep: 6, tap: .9 };
export function durationFor(action) { return DUR[action] ?? 1; }

const REST = () => ({
  x: 0, lift: 0, sx: 1, sy: 1, rotate: 0, lean: 0, eyeX: 0, eyeY: 0, blink: 0, wide: 1, happy: 0, phase: 'rest',
  // style fields
  inked: .35,       // hatch fill amount 0..1 (from the bottom)
  hatchAngle: -.7,  // hatch direction (rad)
  boil: .35,        // contour jitter in px at hero size
  reveal: 1,        // 0..1 how much of the contour has been drawn on
  ghost: 0,         // alpha of the previous (fading) contour
  ghostInked: .35,  // hatch amount of the ghost contour
  solid: 0,         // 0..1 fully inked body
  sparkle: 0,       // 0..1 tiny pen ticks around the crown
  guides: 0,        // 0..1 construction guide lines above the crown
  cross: 0,         // 0..1 cross-out scribble (draw-on)
  smudge: 0,        // 0..1 eraser smudge
  grey: 0,          // 0..1 pencil-grey line (sleep)
  sketchy: 0,       // 0..1 loose extra construction passes (just redrawn)
});

export function sample(action, t, { energy = 1, reduced = false } = {}) {
  const s = REST(); const e = clamp(energy, .5, 1.5); const d = durationFor(action); const u = clamp(t / d, 0, 1);
  s.phase = action;
  if (reduced) {
    switch (action) {
      case 'hello': s.wide = 1.12; s.sx = 1.04; s.sy = .98; s.sketchy = 1; break;
      case 'listen': s.boil = 0; s.lean = -.06; s.rotate = -.04; s.hatchAngle = -1.1; s.eyeX = .35; s.eyeY = .1; s.wide = 1.06; break;
      case 'think': s.eyeX = -.5; s.eyeY = -.55; s.guides = 1; s.rotate = -.03; break;
      case 'work': s.inked = .7; s.eyeY = .45; s.eyeX = .15; break;
      case 'success': s.solid = 1; s.inked = 1; s.happy = .8; s.sparkle = 1; s.lift = .06; break;
      case 'error': s.cross = 1; s.eyeY = .55; s.sy = .97; s.sx = 1.02; break;
      case 'sleep': s.blink = 1; s.grey = 1; s.inked = .15; s.boil = 0; s.sy = .98; break;
      case 'tap': s.sy = .9; s.sx = 1.08; break;
    }
    s.boil = action === 'listen' || action === 'sleep' ? 0 : s.boil; return s;
  }
  switch (action) {
    case 'idle': {
      s.boil = .35; s.blink = bell(window01((t % 6) - 3.5, 0, .25));
      s.eyeX = .18 * Math.sin(u * TAU) ; s.eyeY = .08 * Math.sin(u * TAU * 2 + 1);
      s.sy = 1 + .006 * Math.sin(u * TAU); s.sx = 1 / s.sy;
      s.inked = .35 + .01 * Math.sin(u * TAU); break;
    }
    case 'hello': {
      const draw = window01(t, 0, .25);                 // the new contour draws on
      s.reveal = ease.out(draw); s.ghost = 1 - draw; s.ghostInked = .35;
      const over = 1 - ease.outBack(clamp(t / .6, 0, 1), 2.2);
      s.sx = 1 + .06 * e * over + .06 * e * bell(window01(t, 0, .5)); s.sy = 1 / s.sx;
      s.lift = .08 * e * bell(window01(t, .05, .6));
      s.wide = 1 + .14 * bell(window01(t, .1, .9)); s.boil = .6 * bell(window01(t, 0, .5)) + .3; s.sketchy = ease.out(draw) * (1 - window01(t, .8, 1.35));
      s.eyeX = .1 * bell(window01(t, .2, 1.2)); s.phase = t < .5 ? 'redraw' : 'settle'; break;
    }
    case 'listen': {
      s.boil = 0; s.lean = -.06; s.rotate = -.04; s.hatchAngle = -1.1;
      s.eyeX = .35 + .04 * Math.sin(u * TAU); s.eyeY = .1; s.wide = 1.06;
      s.blink = bell(window01((t % 4) - 1.6, 0, .22)); s.sy = 1 + .004 * Math.sin(u * TAU); s.sx = 1 / s.sy; break;
    }
    case 'think': {
      // guides draw on 0→.25, hold, erase .55→.8, gone until the loop seam
      const on = ease.out(window01(u, 0, .25)), off = window01(u, .55, .8);
      s.guides = on * (1 - off); s.eyeX = -.5; s.eyeY = -.55 + .05 * Math.sin(u * TAU);
      s.inked = .35 + .03 * Math.sin(u * TAU * 2); s.rotate = -.03; s.boil = .3;
      s.blink = bell(window01((t % 4) - 3.3, 0, .22)); break;
    }
    case 'work': {
      // seam: last 3% the .9-inked contour hands over to a ghost, first 6% the .35 contour draws itself on
      const drawOn = ease.out(window01(u, 0, .06)), handOff = window01(u, .97, 1);
      s.reveal = drawOn * (1 - handOff); s.ghost = 1 - s.reveal; s.ghostInked = .9;
      // rhythmic fill: 8 steps of quick hatch-writing across the loop
      const p = clamp((u - .06) / .91, 0, 1), k = Math.floor(p * 8), f = p * 8 - k;
      const prog = (k + ease.out(clamp(f * 2.2, 0, 1))) / 8;      // write quickly, then hold
      s.inked = mix(.35, .9, clamp(prog, 0, 1));
      s.sy = 1 + .012 * e * bell(clamp(f * 2.2, 0, 1)) ; s.sx = 1 / s.sy;
      s.eyeY = .45; s.eyeX = .15 + .12 * Math.sin(prog * TAU * 2); s.boil = .3;
      s.blink = bell(window01((t % 4) - 1.2, 0, .2)); s.phase = u < .06 ? 'redraw' : 'inking'; break;
    }
    case 'success': {
      const g = bell(window01(u, .05, .95));
      s.solid = smooth(.18, .38, u) * (1 - smooth(.62, .85, u)); s.inked = mix(.35, 1, s.solid);
      s.lift = .12 * e * bell(window01(u, 0, .55)); s.sx = 1 + .05 * e * Math.sin(u * TAU) * (1 - u); s.sy = 1 / s.sx;
      s.happy = .8 * bell(window01(u, .12, .95)); s.sparkle = bell(window01(u, .22, .78));
      s.wide = 1 + .06 * g; s.boil = .3; s.phase = u < .6 ? 'inked' : 'settle'; break;
    }
    case 'error': {
      s.cross = ease.out(window01(t, 0, .2)) * (1 - window01(t, .85, 1.05));
      s.smudge = bell(window01(t, .8, 1.6)) ; s.boil = mix(1.2, .35, smooth(.35, .6, t));
      s.eyeY = .55 * smooth(0, .25, t) * (1 - .4 * smooth(1.2, 1.6, t)); s.eyeX = -.05;
      s.sy = 1 - .03 * bell(window01(t, .1, 1.4)); s.sx = 1 + .02 * bell(window01(t, .1, 1.4));
      s.rotate = .012 * Math.sin(t * 40) * e * (1 - smooth(.3, .55, t)); s.phase = t < .55 ? 'nervous' : 'erase'; break;
    }
    case 'sleep': {
      s.blink = 1; s.grey = 1; s.inked = .15; s.boil = 0;
      s.sy = 1 - .02 * .5 * (1 - Math.cos(u * TAU)); s.sx = 1 / s.sy; break;
    }
    case 'tap': {
      const sq = bell(window01(u, 0, .55)), wob = Math.sin(u * TAU * 2.5) * smooth(.4, .6, u) * (1 - u); // squash, then a sketchy overshoot
      s.sy = 1 - .18 * e * sq + .06 * e * wob; s.sx = 1 + .13 * e * sq - .04 * e * wob;
      s.boil = mix(1.1, .35, window01(t, .15, .35)); s.blink = bell(window01(t, 0, .18)); s.eyeY = .15 * bell(u); break;
    }
  }
  return s;
}

const GREY = '#7d766c', PENCIL = '#8b857b';
const bodyPts = (R, s) => ink.blobPoints(R, { seed: 5, rough: .045, time: 0, lean: s.lean });
const loopPts = pts => pts.concat(pts.slice(0, 5));               // ends overlap like a real sketch

function contour(ctx, pts, { color, width, jitter, seed, reveal = 1, alpha = 1, construction = false, sketchy = 0 }) {
  const lp = loopPts(pts);
  if (construction) {
    const d = 1.4 + 2.6 * sketchy, off = lp.map(p => ({ x: p.x + d, y: p.y + d * .8 }));
    ink.penLine(ctx, off, { color, width: width * .65, jitter: jitter * .8 + sketchy * .8, seed: seed + 11, closed: false, reveal, alpha: alpha * (.35 + .25 * sketchy) });
    if (sketchy > .05) { const off2 = lp.map(p => ({ x: p.x * (1 + .03 * sketchy) - d * .6, y: p.y * (1 + .03 * sketchy) })); ink.penLine(ctx, off2, { color, width: width * .6, jitter: .7, seed: seed + 23, closed: false, reveal, alpha: alpha * .4 * sketchy }); }
  }
  ink.penLine(ctx, lp, { color, width, jitter, seed, closed: false, reveal, alpha });
}

export function render(ctx, s, { R, footX, footY, time = 0, reduced = false, tint = null, size = 'hero' }) {
  const hero = size === 'hero', tiny = size === 'tiny';
  const baseColor = ink.inkColor(tint);
  const lineColor = s.grey > .5 ? (tint || GREY) : baseColor;
  const lineAlpha = s.grey > .5 ? .8 : 1;
  const frame = reduced ? 0 : Math.floor(ink.stepped(time, 8) * 8);          // 8 fps boil seed
  const jitter = tiny || reduced ? 0 : clamp(s.boil, 0, 1.4) * clamp(R / 60, .4, 1);
  const width = tiny ? 2 : hero ? 1.8 : 1.6;
  ctx.save();
  ink.poseTransform(ctx, footX, footY, R, s);
  ctx.translate(0, -FOOT * R);
  const pts = bodyPts(R, s);
  // ghost: the previous contour fading out while the new one draws on
  if (s.ghost > .01) {
    contour(ctx, pts, { color: lineColor, width, jitter, seed: 40 + frame, alpha: lineAlpha * s.ghost });
    if (!tiny) ink.hatch(ctx, pts, { color: baseColor, spacing: hero ? R * .085 : R * .15, angle: s.hatchAngle, amount: s.ghostInked, width: hero ? 1.1 : 1, seed: 2, alpha: .75 * s.ghost });
  }
  // hatching (paper interior, filled from the bottom)
  if (!tiny && s.inked > 0 && s.solid < .98) ink.hatch(ctx, pts, { color: baseColor, spacing: hero ? R * .085 : R * .15, angle: s.hatchAngle, amount: s.inked, width: hero ? 1.1 : 1, seed: 2, alpha: .75 * s.reveal * (1 - s.solid) });
  // solid ink (success)
  if (s.solid > .01) ink.fuzzyFill(ctx, pts, { color: baseColor, R, soft: hero ? .03 : 0, tufts: 0, alpha: s.solid });
  // the pen contour
  if (s.reveal > .02) contour(ctx, pts, { color: lineColor, width, jitter, seed: frame, reveal: s.reveal, alpha: lineAlpha, construction: hero && s.solid < .5, sketchy: s.sketchy });
  // eyes: pen style, always
  ink.eyes(ctx, R, s, { style: 'pen', ink: lineColor, lineWidth: Math.max(1, R * .03) });
  if (tiny && s.inked > .45 && s.solid < .5) {         // tiny work: one rising ink level instead of hatching
    ctx.save(); ink.tracePath(ctx, pts); ctx.clip(); ctx.fillStyle = baseColor; ctx.globalAlpha = .85 * clamp((s.inked - .35) / .55, 0, 1);
    const top = R * (1 - 2 * s.inked) * 1.05; ctx.fillRect(-1.3 * R, top, 2.6 * R, 1.4 * R - top); ctx.restore();
    ink.eyes(ctx, R, s, { style: 'pen', ink: lineColor, lineWidth: Math.max(1, R * .03) });
  }
  if (tiny && s.cross > .01) {                        // one clean mark so error survives at 24px
    ctx.save(); ctx.strokeStyle = baseColor; ctx.lineWidth = 1.6; ctx.lineCap = 'round'; ctx.globalAlpha = clamp(s.cross * 1.5, 0, 1);
    const cx = .5 * R, cy = -.62 * R, l = .3 * R; ctx.beginPath(); ctx.moveTo(cx - l, cy - l); ctx.lineTo(cx + l, cy + l); ctx.moveTo(cx + l, cy - l); ctx.lineTo(cx - l, cy + l); ctx.stroke(); ctx.restore();
  }
  if (!tiny) {
    // think: construction guide lines above the crown, drawn on / erased
    if (s.guides > .01) {
      ctx.save(); ctx.strokeStyle = tint || PENCIL; ctx.lineWidth = 1; ctx.lineCap = 'round'; ctx.globalAlpha = .3 + .1 * s.guides;
      const G = [[-.55, -1.12, .05, -1.22], [-.2, -1.3, .45, -1.26], [.15, -1.08, .6, -1.16]];
      G.forEach(([ax, ay, bx, by], i) => { const r = clamp(s.guides * 3 - i * .7, 0, 1); if (r <= 0) return; ctx.beginPath(); ctx.moveTo(ax * R, ay * R); ctx.lineTo(mix(ax, bx, r) * R, mix(ay, by, r) * R); ctx.stroke(); });
      ctx.restore();
    }
    // success: tiny sparkle scribbles (pen ticks) around the crown
    if (s.sparkle > .01) {
      ctx.save(); ctx.strokeStyle = baseColor; ctx.lineWidth = 1.4; ctx.lineCap = 'round'; ctx.globalAlpha = s.sparkle;
      for (let i = 0; i < 4; i++) {
        const a = -Math.PI * (.2 + .6 * (i / 3)) + (ink.rand(7, i) - .5) * .25, d = R * (1.08 + .12 * ink.rand(7, i + 10) + .1 * s.sparkle);
        const x = Math.cos(a) * d, y = Math.sin(a) * d - .05 * R, l = R * .06;
        ctx.beginPath(); ctx.moveTo(x - l, y); ctx.lineTo(x + l, y); ctx.moveTo(x, y - l); ctx.lineTo(x, y + l); ctx.stroke();
      }
      ctx.restore();
    }
    // error: cross-out scribble over the upper right, then an eraser smudge
    if (s.cross > .01) {
      const cx = .42 * R, cy = -.5 * R, l = .26 * R;
      for (let pass = 0; pass < 3; pass++) {
        const seed = 60 + pass;
        const A = [{ x: cx - l, y: cy - l }, { x: cx - l * .3, y: cy - l * .3 }, { x: cx + l * .35, y: cy + l * .35 }, { x: cx + l, y: cy + l }];
        const B = [{ x: cx + l, y: cy - l }, { x: cx + l * .3, y: cy - l * .3 }, { x: cx - l * .35, y: cy + l * .35 }, { x: cx - l, y: cy + l }];
        ink.penLine(ctx, A, { color: baseColor, width: 1.5, jitter: 1.6, seed, reveal: clamp(s.cross * 2, 0, 1), alpha: .85 });
        if (s.cross > .5) ink.penLine(ctx, B, { color: baseColor, width: 1.5, jitter: 1.6, seed: seed + 5, reveal: clamp(s.cross * 2 - 1, 0, 1), alpha: .85 });
      }
    }
    if (s.smudge > .01) {
      ctx.save(); ctx.fillStyle = tint || GREY; ctx.globalAlpha = .25 * s.smudge;
      ctx.beginPath(); ctx.ellipse(.42 * R, -.5 * R, .34 * R, .2 * R, -.5, 0, TAU); ctx.fill(); ctx.restore();
    }
  }
  ctx.restore();
}

export function geometry(s, { R, footX, footY }) {
  const pts = bodyPts(R, s);
  const b = ink.bounds(footX, footY, R, s, pts);
  const eyes = ink.EYES.map(e => { const m = ink.mapPoint(footX, footY, R, s, e.x * R, (e.y - FOOT) * R); return { cx: m.x, cy: m.y, rx: e.rx * R * s.wide * s.sx, ry: e.ry * R * s.wide * s.sy }; });
  const faceContained = eyes.every(e => e.cx - e.rx >= b.left && e.cx + e.rx <= b.right && e.cy - e.ry >= b.top && e.cy + e.ry <= b.bottom);
  return { bounds: b, eyes, faceContained };
}

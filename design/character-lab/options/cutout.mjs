/* Paper cutout — Nibbi as a torn scrap of black paper, animated stop-motion on a 12 fps grid. */
import * as ink from '../ink.mjs';
const { clamp, TAU, FOOT, rand } = ink;

export const meta = {
  id: 'cutout',
  name: 'Paper cutout',
  tagline: 'A blob torn from black paper and laid flat on the page, moved by hand one frame at a time.',
  material: 'Matte black paper torn into the Nibbi blob: high-frequency torn edge with a thin white fibrous fringe behind it, a hard-edged paper-thin offset shadow (2px down-right, alpha .3, no blur) that shows it is a layer, and two white paper punch-out eyes glued on slightly askew with black paper pupils. Crisp, no blur, no gradients.',
  grammar: 'Stop-motion replacement animation. Every moving quantity is sampled on a 12 fps grid and held. The body swaps between a small set of pose scraps (rest, squash, stretch, tilt-left, tilt-right, crumpled) instead of deforming continuously; each swap adds a ±1px hand-placement jitter. Rotation hinges at the foot (tilts also slide the scrap ~.12R so a round piece visibly leans). Hops are 4–5 frames. Idle is a still photograph with a one-frame blink every ~4.5s and one re-placement nudge per loop.',
  feeling: 'handmade, deliberate, dry, tactile',
  risks: [
    'Stepped 12 fps motion could be mistaken for lag or a performance problem rather than a style.',
    'Crisp torn edges lose the soft ink identity the other options share; it reads as paper, not ink.',
    'Keeps a permanent offset shadow on purpose, which breaks the older "no permanent shadow" rule.',
    'Replacement poses are coarse: subtle emotions (listen vs think) lean on the eyes more than the silhouette.',
  ],
};

const FPS = 12;
const DUR = { idle: 9, hello: 1, listen: 4, think: 4.2, work: 4, success: 2, error: 1.4, sleep: 3, tap: .5 };
export const stillAt = { hello: .35, think: .2, success: .45, error: .3 };   // signature still per action
export function durationFor(action) { return DUR[action] ?? 1; }
const LOOPS = new Set(['idle', 'listen', 'think', 'work', 'sleep']);

// Pose scraps: discrete paper pieces swapped frame to frame.
const SCRAPS = {
  rest:    { sx: 1,    sy: 1,   rotate: 0,    amp: .04, seed: 5 },
  squash:  { sx: 1.12, sy: .86, rotate: 0,    amp: .04, seed: 5 },
  stretch: { sx: .9,   sy: 1.16, rotate: 0,   amp: .04, seed: 5 },
  tiltL:   { sx: .96,  sy: 1.05, rotate: -.22, amp: .04, seed: 5 },
  tiltR:   { sx: .96,  sy: 1.05, rotate: .22,  amp: .04, seed: 5 },
  halfL:   { sx: .98,  sy: 1.02, rotate: -.11, amp: .04, seed: 5 },
  crumple: { sx: 1.08, sy: .85, rotate: 0,    amp: .1,  seed: 11 },
  uncrump: { sx: 1.04, sy: .92, rotate: 0,    amp: .065, seed: 8 },
  flat:    { sx: 1.06, sy: .9,  rotate: 0,    amp: .04, seed: 5 },
  flat2:   { sx: 1.06, sy: .92, rotate: 0,    amp: .04, seed: 5 },
  bob:     { sx: 1.015, sy: .97, rotate: 0,   amp: .04, seed: 5 },
  bobT:    { sx: 1.01, sy: .98, rotate: .05,  amp: .04, seed: 5 },
  work:    { sx: 1.05, sy: .93, rotate: 0,    amp: .04, seed: 5 },
};

const REST = () => ({ x: 0, lift: 0, sx: 1, sy: 1, rotate: 0, eyeX: 0, eyeY: 0, blink: 0, wide: 1, happy: 0,
  phase: 'rest', scrap: 'rest', amp: .04, seed: 5, bits: [], thought: 0 });

// Small torn bit (confetti / offcut / thought scrap) in R units relative to the foot; a = rotation.
const bit = (x, y, s, a) => ({ x, y, s, a });

// Frame plan: which scrap, lift and eyes for integer frame f of an action. Pure, no jitter.
function plan(action, f, e) {
  const p = { scrap: 'rest', lift: 0, eyeX: 0, eyeY: 0, blink: 0, wide: 1, happy: 0, bits: [], thought: 0, phase: action };
  switch (action) {
    case 'idle': {
      if (f === 52 || f === 104) p.blink = 1;                    // one-frame blinks at ~4.3s and ~8.7s
      p.eyeX = f < 30 ? .1 : f < 78 ? -.12 : .05;                // gaze parks in 3 positions
      p.scrap = f >= 24 && f < 84 ? 'rest' : 'rest';
      p.nudge = f >= 24 && f < 84 ? .01 : 0;                     // one re-placement nudge per loop
      break;
    }
    case 'hello': {
      const seq = ['rest', 'rest', 'squash', 'squash', 'stretch', 'stretch', 'squash', 'squash', 'rest', 'rest', 'rest', 'rest'];
      p.scrap = seq[Math.min(f, seq.length - 1)];
      p.lift = (f === 4 || f === 5) ? .22 * e : 0;
      p.wide = f >= 2 && f < 9 ? 1.12 : 1;
      p.phase = f < 2 ? 'ready' : f < 4 ? 'squash' : f < 6 ? 'up' : f < 8 ? 'down' : 'settle';
      break;
    }
    case 'listen': {
      p.scrap = f < 2 || f >= 46 ? 'rest' : (f === 2 || f === 45) ? 'halfL' : 'tiltL';
      p.wide = p.scrap === 'rest' ? 1 : 1.14; p.eyeX = p.scrap === 'rest' ? 0 : -.35; p.eyeY = -.1;
      p.phase = p.scrap === 'tiltL' ? 'hold' : 'lean';
      break;
    }
    case 'think': {
      const slot = Math.floor(f / 8.4) % 6;                       // ~0.7s per pose
      p.scrap = ['tiltL', 'tiltL', 'tiltR', 'tiltR', 'rest', 'rest'][slot];
      p.eyeX = -.55; p.eyeY = -.7; p.blink = f === 40 ? 1 : 0;
      if (slot === 1 || slot === 2 || slot === 3) { p.thought = 1; p.bits = [bit(.92, -1.85, .12, .3 + .15 * slot)]; }
      p.phase = 'rock';
      break;
    }
    case 'work': {
      const beat = Math.floor(f / 4) % 12, k = f % 4;
      p.scrap = beat % 4 === 3 ? (k < 2 ? 'bobT' : 'rest') : (k < 2 ? 'bob' : 'rest');
      p.eyeX = .1; p.eyeY = .45; p.blink = f === 22 ? 1 : 0;
      for (let i = 0; i < 3; i++) {                               // offcuts shuffle beside the foot each beat
        const b = Math.floor((f + i * 5) / 8);
        p.bits.push(bit(.85 + .35 * rand(3 + i, b) + i * .12, -.06 - .07 * rand(9 + i, b), .07 + .03 * rand(5 + i, b), rand(7 + i, b) * TAU));
      }
      p.phase = 'bob';
      break;
    }
    case 'success': {
      const seq = ['squash', 'stretch', 'stretch', 'stretch', 'stretch', 'squash'];
      p.scrap = f < 6 ? seq[f] : 'rest';
      p.lift = f === 1 ? .18 * e : f === 2 ? .35 * e : f === 3 ? .35 * e : f === 4 ? .12 * e : 0;
      p.happy = f >= 2 && f < 20 ? 1 : f < 23 ? .4 : 0; p.wide = f >= 1 && f < 6 ? 1.06 : 1;
      if (f >= 2 && f < 18) {                                     // paper confetti: 7 torn bits burst up (visible to ~70%), settle, vanish
        const k = f - 2;
        for (let i = 0; i < 7; i++) {
          const ang = TAU * .16 + TAU * .68 * (i / 6) + (rand(21, i) - .5) * .2, sp = (.13 + .05 * rand(22, i)) * e;
          let x = Math.cos(ang) * sp * k, y = -1.3 - Math.sin(ang) * sp * k + .0075 * k * k;
          y = Math.min(y, -.03 - .04 * rand(23, i));                // land on the paper
          p.bits.push(bit(x, y, .06 + .03 * rand(24, i), (rand(25, i) * 3 + k * .6) % TAU));
        }
      }
      p.phase = f < 6 ? 'hop' : f < 18 ? 'confetti' : 'settle';
      break;
    }
    case 'error': {
      p.scrap = f < 2 ? 'rest' : f < 9 ? 'crumple' : f < 11 ? 'uncrump' : 'rest';
      p.eyeY = f >= 2 ? .65 : 0; p.eyeX = f >= 2 ? -.1 : 0; p.wide = f >= 2 && f < 11 ? .92 : 1;
      p.phase = f < 2 ? 'stop' : f < 9 ? 'crumpled' : 'flatten';
      break;
    }
    case 'sleep': {
      p.scrap = f < 18 ? 'flat' : 'flat2'; p.blink = 1; p.phase = f < 18 ? 'out' : 'in';
      break;
    }
    case 'tap': {
      p.scrap = f < 2 ? 'squash' : f < 4 ? 'stretch' : 'rest'; p.wide = f < 4 ? 1.08 : 1; p.phase = p.scrap;
      break;
    }
  }
  return p;
}
const key = (action, f, e) => { const p = plan(action, f, e); return p.scrap + '|' + p.lift.toFixed(2); };

export function sample(action, t, { energy = 1, reduced = false } = {}) {
  const s = REST(); const e = clamp(energy, .5, 1.5);
  if (reduced) {
    const still = { idle: 'rest', hello: 'stretch', listen: 'tiltL', think: 'tiltR', work: 'work', success: 'stretch', error: 'crumple', sleep: 'flat', tap: 'squash' }[action] || 'rest';
    Object.assign(s, SCRAPS[still], { scrap: still });
    if (action === 'hello') { s.lift = .22; s.wide = 1.1; }
    if (action === 'listen') { s.wide = 1.14; s.eyeX = -.35; s.eyeY = -.1; s.x = -.12; }
    if (action === 'think') { s.eyeX = -.55; s.eyeY = -.7; s.thought = 1; s.x = .12; s.bits = [bit(.92, -1.85, .12, .4)]; }
    if (action === 'work') { s.eyeY = .45; s.eyeX = .1; s.bits = [bit(1.0, -.08, .09, .4), bit(1.3, -.06, .08, 2.1)]; }
    if (action === 'success') { s.happy = 1; s.wide = 1.04; s.lift = .35; s.bits = [bit(-1.2, -1.9, .08, .5), bit(0, -2.55, .07, 2.2), bit(1.15, -1.7, .09, 4.1)]; }
    if (action === 'error') { s.eyeY = .65; s.eyeX = -.1; s.wide = .92; }
    if (action === 'sleep') s.blink = 1;
    s.phase = action; return s;
  }
  const N = Math.round(durationFor(action) * FPS);
  let f = Math.floor(clamp(t, 0, 1e6) * FPS);
  f = LOOPS.has(action) ? ((f % N) + N) % N : Math.min(f, N - 1);
  const p = plan(action, f, e);
  // hand-placement jitter: fixed while a pose is held, re-rolled when the scrap changes
  let k = f; while (k > 0 && key(action, k - 1, e) === key(action, k, e)) k--;
  const seedA = action.length * 7 + action.charCodeAt(0);
  const jx = (rand(seedA, k) - .5) * .02, jr = (rand(seedA + 1, k) - .5) * .02;
  const sc = SCRAPS[p.scrap];
  const shift = p.scrap === 'tiltL' ? -.12 : p.scrap === 'tiltR' ? .12 : p.scrap === 'halfL' ? -.06 : 0;
  s.scrap = p.scrap; s.amp = sc.amp; s.seed = sc.seed; s.phase = p.phase;
  s.sx = sc.sx; s.sy = sc.sy; s.rotate = sc.rotate + (k > 0 ? jr : 0);
  s.x = (k > 0 ? jx : 0) + (p.nudge || 0) + shift; s.lift = p.lift;
  s.eyeX = p.eyeX; s.eyeY = p.eyeY; s.blink = p.blink; s.wide = p.wide; s.happy = p.happy; s.bits = p.bits; s.thought = p.thought;
  return s;
}

// ---- drawing -------------------------------------------------------------------------------------
function bodyPoints(R, s, size) {
  const n = size === 'tiny' ? 26 : 44;
  const pts = ink.blobPoints(R, { n, seed: s.seed, rough: s.scrap === 'crumple' ? .1 : .04, drop: .22, time: 0 });
  return ink.tornPoints(pts, { seed: s.seed + 1, amp: size === 'tiny' ? .04 : s.amp, R });
}
// torn paper: straight segments between the jags, never smoothed
function tornPath(ctx, pts) { ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y); ctx.closePath(); }
function tornTri(ctx, x, y, r, a, color) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(-r, r * .7); ctx.lineTo(-r * .2, -r * .95); ctx.lineTo(r * .3, -r * .5); ctx.lineTo(r, r * .3); ctx.lineTo(r * .15, r * .85); ctx.closePath(); ctx.fill();
  ctx.restore();
}
// Two white paper punch-outs glued on slightly askew, black paper pupils, one glint. Matches ink.EYES layout.
const ASKEW = [{ rot: -.12, dx: -.03, dy: .02 }, { rot: .12, dx: .03, dy: -.03 }];
function paperEyes(ctx, R, s, color, size) {
  const white = '#fbfaf7', open = 1 - clamp(s.blink, 0, 1), tiny = size === 'tiny';
  for (let i = 0; i < 2; i++) {
    const e = ink.EYES[i], a = ASKEW[i];
    const cx = (e.x + (tiny ? 0 : a.dx)) * R, cy = (e.y + (tiny ? 0 : a.dy)) * R;
    const rx = e.rx * R * s.wide, ry = e.ry * R * s.wide * (1 - .22 * s.happy);
    ctx.save(); ctx.translate(cx, cy); if (!tiny) ctx.rotate(a.rot);
    if (open < .1) {                                              // closed: a short paper sliver
      ctx.fillStyle = white; ctx.beginPath(); ctx.ellipse(0, 0, rx * .8, Math.max(1, R * .04), 0, 0, TAU); ctx.fill();
    } else {
      ctx.fillStyle = white; ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, TAU); ctx.clip();
      const gx = clamp(s.eyeX, -1, 1) * rx * .42, gy = clamp(s.eyeY, -1, 1) * ry * .35 + ry * .14;
      const prx = e.prx * R * s.wide, pry = Math.min(e.pry * R * s.wide, ry * .95);
      ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(gx, gy, prx, pry, 0, 0, TAU); ctx.fill();
      if (!tiny) { ctx.fillStyle = white; ctx.beginPath(); ctx.arc(gx + prx * .38, gy - pry * .38, Math.max(.7, prx * .22), 0, TAU); ctx.fill(); }
      if (s.happy > 0) { ctx.fillStyle = color; ctx.globalAlpha = s.happy; ctx.beginPath(); ctx.ellipse(0, ry * 1.2, rx * 1.1, ry * .7, 0, 0, TAU); ctx.fill(); }
    }
    ctx.restore();
  }
}

export function render(ctx, s, { R, footX, footY, time = 0, reduced = false, tint = null, size = 'hero' }) {
  const color = ink.inkColor(tint), tiny = size === 'tiny', hero = size === 'hero';
  ctx.save();
  ctx.translate(footX, footY);
  // loose torn bits (offcuts / confetti / thought scrap) lie on the paper, in R units from the foot
  for (const b of s.bits || []) {
    if (!tiny || s.thought) tornTri(ctx, b.x * R, b.y * R, b.s * R * (tiny ? 1.4 : 1), b.a, color);
  }
  ctx.translate(-footX, -footY);
  ink.poseTransform(ctx, footX, footY, R, s);
  ctx.translate(0, -FOOT * R);                                   // body centre
  const pts = bodyPoints(R, s, size);
  if (!tiny) {
    ctx.save(); ctx.translate(2 / s.sx, 2 / s.sy); ctx.globalAlpha = .3; ctx.fillStyle = color;   // paper-thin layer shadow
    tornPath(ctx, pts); ctx.fill(); ctx.restore();
    ctx.save(); ctx.scale(1.05, 1.05); ctx.translate(-R * .012, -R * .015); ctx.fillStyle = '#e9e4da'; // fibrous white fringe
    tornPath(ctx, pts); ctx.fill(); ctx.restore();
  }
  ctx.fillStyle = color; tornPath(ctx, pts); ctx.fill();    // the black torn scrap itself
  if (hero && s.scrap === 'crumple') {                            // two crease lines in the crumpled scrap
    ctx.strokeStyle = '#e9e4da'; ctx.globalAlpha = .35; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-R * .9, -R * .3); ctx.lineTo(-R * .5, -R * .55); ctx.lineTo(-R * .3, -R * 1.0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(R * .2, -R * 1.0); ctx.lineTo(R * .35, -R * .55); ctx.lineTo(R * .95, -R * .4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-R * .6, R * .55); ctx.lineTo(-R * .2, R * .35); ctx.lineTo(R * .15, R * .75); ctx.stroke(); ctx.globalAlpha = 1;
  }
  paperEyes(ctx, R, s, color, size);
  ctx.restore();
}

export function geometry(s, { R, footX, footY }) {
  const pts = bodyPoints(R, s, 'hero');
  const b = ink.bounds(footX, footY, R, s, pts);
  const eyes = ink.EYES.map((e, i) => {
    const a = ASKEW[i]; const m = ink.mapPoint(footX, footY, R, s, (e.x + a.dx) * R, (e.y + a.dy - FOOT) * R);
    return { cx: m.x, cy: m.y, rx: e.rx * R * s.wide * s.sx, ry: e.ry * R * s.wide * s.sy };
  });
  const faceContained = eyes.every(e => e.cx - e.rx >= b.left && e.cx + e.rx <= b.right && e.cy - e.ry >= b.top && e.cy + e.ry <= b.bottom);
  return { bounds: b, eyes, faceContained };
}

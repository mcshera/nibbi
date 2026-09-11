/* Shared ink/paper drawing helpers for the Nibbi character lab (Canvas2D, dependency-free).
 * Deterministic: every function is pure given its arguments; no timers, no RAF, no DOM lookups.
 * Options may use any subset. Nothing here touches production files.
 */
export const TAU = Math.PI * 2;
export const FOOT = 0.66;                // foot line sits 0.66R below the body centre (same as the app rig)
export const INK = '#161514';
export const PAPER = '#f3f0ea';
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const mix = (a, b, t) => a + (b - a) * t;
export const finite = (x, f = 0) => (Number.isFinite(x) ? x : f);
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const fract = x => x - Math.floor(x);

// ---- easing -------------------------------------------------------------
export const ease = {
  inOut: t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  out: t => 1 - Math.pow(1 - t, 3),
  in: t => t * t * t,
  outBack: (t, s = 1.7) => { const c = s + 1; return 1 + c * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2); },
  outElastic: t => (t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1),
  outBounce: t => { const n = 7.5625, d = 2.75; if (t < 1 / d) return n * t * t; if (t < 2 / d) return n * (t -= 1.5 / d) * t + .75; if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + .9375; return n * (t -= 2.625 / d) * t + .984375; },
};
// bell(t) rises 0→1→0 over 0..1 ; pulse windows are handy for one-shots
export const bell = t => (t <= 0 || t >= 1 ? 0 : Math.sin(Math.PI * clamp(t, 0, 1)));
export const window01 = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
// stepped time for stop-motion; fps frames per second
export const stepped = (t, fps = 12) => Math.floor(t * fps) / fps;

// ---- deterministic noise -------------------------------------------------
export const hash = n => { let x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return fract(x); };
export const hash2 = (x, y) => hash(x * 1.31 + y * 7.77 + 13.13);
export const rand = (seed, i) => hash(seed * 17.17 + i * 3.71 + 0.5);
export function noise1(x, seed = 0) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return mix(hash(i + seed * 91.7), hash(i + 1 + seed * 91.7), u) * 2 - 1;
}
export function fbm1(x, seed = 0, octaves = 3) {
  let v = 0, a = .5, s = 0;
  for (let o = 0; o < octaves; o++) { v += a * noise1(x, seed + o * 7.3); s += a; x = x * 2.03 + 17.1; a *= .5; }
  return v / s;
}
// periodic noise around a closed outline (angle in turns 0..1); k = lobes
export function ringNoise(turns, k, seed = 0, octaves = 3) {
  let v = 0, a = .5, s = 0, freq = k;
  for (let o = 0; o < octaves; o++) {
    const x = turns * freq; const i = Math.floor(x); const f = x - i; const u = f * f * (3 - 2 * f);
    const h0 = hash(((i % freq) + freq) % freq + seed * 91.7 + o * 7.3), h1 = hash((((i + 1) % freq) + freq) % freq + seed * 91.7 + o * 7.3);
    v += a * (mix(h0, h1, u) * 2 - 1); s += a; freq *= 2; a *= .5;
  }
  return v / s;
}

// ---- paper ---------------------------------------------------------------
export function paper(ctx, w, h, { tone = PAPER, grain = .045, seed = 1 } = {}) {
  ctx.save();
  ctx.fillStyle = tone; ctx.fillRect(0, 0, w, h);
  if (grain > 0) {
    ctx.globalAlpha = grain;
    const n = Math.min(900, Math.floor(w * h / 220));
    for (let i = 0; i < n; i++) {
      const x = rand(seed, i * 2) * w, y = rand(seed, i * 2 + 1) * h;
      ctx.fillStyle = i % 3 ? '#8a8378' : '#ffffff';
      ctx.fillRect(x, y, 1, 1);
    }
  }
  ctx.restore();
}
export const inkColor = (tint = null) => tint || INK;

// ---- geometry / transforms ------------------------------------------------
/* Apply the shared pose transform about the planted foot.
 * cx, footY: foot point on the canvas. R: base radius. pose: {x, lift, sx, sy, rotate}. x/lift in R units.
 * After this call, draw the body around local (0, -FOOT*R). Caller must ctx.save()/restore(). */
export function poseTransform(ctx, cx, footY, R, pose) {
  ctx.translate(cx + finite(pose.x) * R, footY - finite(pose.lift) * R);
  ctx.rotate(finite(pose.rotate));
  ctx.scale(finite(pose.sx, 1), finite(pose.sy, 1));
}
/* Map a local point (relative to the foot, before scale/rotate) to canvas space for diagnostics. */
export function mapPoint(cx, footY, R, pose, lx, ly) {
  const sx = finite(pose.sx, 1), sy = finite(pose.sy, 1), r = finite(pose.rotate);
  const x = lx * sx, y = ly * sy; const c = Math.cos(r), s = Math.sin(r);
  return { x: cx + finite(pose.x) * R + x * c - y * s, y: footY - finite(pose.lift) * R + x * s + y * c };
}

/* Nibbi's signature silhouette: wider than tall, rounded crown, flatter base, slight left-high crown.
 * Returns radius multiplier for angle a (radians, 0 = right, +y down). */
export function baseProfile(a) {
  const cx = Math.cos(a), sy = Math.sin(a); // sy>0 is downward
  let r = 1 + .16 * cx * cx;                // wide sides
  r -= .14 * smooth(.2, 1, sy);             // flatten bottom
  r += .05 * smooth(.2, 1, -sy) * (1 - .6 * Math.abs(cx)); // gentle crown
  r += .03 * Math.max(0, -cx) * Math.max(0, -sy); // slightly higher crown on the left
  return r;
}

/* Fuzzy blob outline points. Uses the base profile plus shape weights and a rough, slowly moving ink edge.
 * opts: {n=72, seed=0, rough=.05, boil=0 (time-based drift), time=0, lean=0, round=0, star=0, drop=0, squash=1}
 * Points are local (centre 0,0), radius R. */
export function blobPoints(R, opts = {}) {
  const { n = 72, seed = 0, rough = .05, time = 0, lean = 0, round = 0, star = 0, drop = 0, boil = .15 } = opts;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = i / n, a = t * TAU;
    let r = baseProfile(a);
    r = mix(r, 1, clamp(round, 0, 1));                            // round: towards a circle
    r += star * .28 * Math.max(0, Math.cos(5 * a + Math.PI * .5)) ** 1.5;  // soft 5-point star
    const up = Math.max(0, -Math.sin(a));                          // drop: pull the crown up into a point
    r += drop * (.55 * Math.pow(up, 6) - .08 * (1 - up));
    r += rough * ringNoise(t + time * boil * .02, 6, seed, 3) + rough * .45 * ringNoise(t - time * boil * .031, 14, seed + 3, 2);
    let x = Math.cos(a) * r * R, y = Math.sin(a) * r * R;
    x += lean * R * smooth(.1, 1, -y / R) * .9;                    // lean: bend the crown sideways
    pts.push({ x, y });
  }
  return pts;
}
/* Smooth closed path through points (Catmull-Rom → cubic bezier). */
export function tracePath(ctx, pts, closed = true) {
  const n = pts.length; if (n < 2) return;
  ctx.beginPath();
  const P = i => pts[closed ? (i + n) % n : clamp(i, 0, n - 1)];
  ctx.moveTo(pts[0].x, pts[0].y);
  const end = closed ? n : n - 1;
  for (let i = 0; i < end; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    ctx.bezierCurveTo(p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6, p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6, p2.x, p2.y);
  }
  if (closed) ctx.closePath();
}
/* Fill a closed outline with a feathered ink edge and a few edge tufts (Nibbi's fuzzy look).
 * opts: {color, soft = R*.06 blur, tufts = 26, seed, R, time, alpha}. */
export function fuzzyFill(ctx, pts, opts = {}) {
  const { color = INK, R = 60, soft = .05, tufts = 24, seed = 0, alpha = 1 } = opts;
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = Math.max(0, soft * R);
  tracePath(ctx, pts); ctx.fill();
  ctx.shadowBlur = 0;
  // ragged tufts around the edge
  const n = pts.length;
  for (let i = 0; i < tufts; i++) {
    const k = Math.floor(rand(seed, i) * n), p = pts[k], q = pts[(k + 1) % n];
    const nx = -(q.y - p.y), ny = q.x - p.x, len = Math.hypot(nx, ny) || 1;
    const out = (rand(seed, i + 100) * .9 - .25) * R * .07;
    const rr = R * (.025 + rand(seed, i + 200) * .045);
    ctx.globalAlpha = alpha * (.55 + rand(seed, i + 300) * .45);
    ctx.beginPath(); ctx.ellipse(p.x + nx / len * out, p.y + ny / len * out, rr, rr * .75, rand(seed, i + 400) * TAU, 0, TAU); ctx.fill();
  }
  ctx.restore();
}
/* Small ink specks scattered around a point. */
export function specks(ctx, x, y, R, { count = 6, seed = 0, spread = 1.3, size = .03, color = INK, alpha = 1 } = {}) {
  ctx.save(); ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const a = rand(seed, i) * TAU, d = (0.9 + rand(seed, i + 50) * spread) * R, r = (0.3 + rand(seed, i + 90)) * size * R;
    ctx.globalAlpha = alpha * (.6 + .4 * rand(seed, i + 130));
    ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d * .7, r, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

// ---- eyes -----------------------------------------------------------------
/* Identity constant across all options: two separate oversized whites, low on the face, dark pupils, one glint.
 * Layout in R units (from the app rig): centres at x=±35/135, y=+13/135; whites 29/135 × 34/135; pupils 16/135 × 19/135.
 * face: {eyeX, eyeY, blink (0 open..1 closed), wide (scale), happy (0..1 lifts lower lid), faceY (R offset), faceSpread}. Passing a whole state object is fine: only these keys are read.
 * style: 'ink' (soft), 'paper' (crisp cut), 'pen' (outlined, hollow), 'brush' (dab), 'print' (crisp with counter)
 * Draw in body-local space (centre 0,0, radius R). Returns geometry for diagnostics. */
export const EYES = [
  { x: -35 / 135, y: 13 / 135, rx: 29 / 135, ry: 33.75 / 135, prx: 15.9 / 135, pry: 18.75 / 135 },
  { x: 35 / 135, y: 12 / 135, rx: 29.9 / 135, ry: 34.4 / 135, prx: 16.4 / 135, pry: 19.1 / 135 },
];
export function eyes(ctx, R, face = {}, opts = {}) {
  const { eyeX = 0, eyeY = 0, blink = 0, wide = 1, happy = 0, faceSpread = 1, faceY = 0 } = face; // faceY/faceSpread: optional whole-face offset (R units) / horizontal spread
  const { style = 'ink', ink = INK, white = '#fbfaf7', lineWidth = R * .035, seed = 0 } = opts;
  const geo = [];
  const open = 1 - clamp(blink, 0, 1);
  for (let i = 0; i < 2; i++) {
    const e = EYES[i];
    const cx = e.x * R * faceSpread, cy = (e.y + faceY) * R;
    const rx = e.rx * R * wide, ry = e.ry * R * wide * Math.max(.06, open) * (1 - .25 * happy);
    ctx.save();
    if (style === 'pen') {
      ctx.strokeStyle = ink; ctx.lineWidth = lineWidth; ctx.fillStyle = white;
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU); ctx.fill(); ctx.stroke();
    } else if (style === 'brush') {
      ctx.fillStyle = white; ctx.globalAlpha = .96;
      for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.ellipse(cx + (rand(seed, k) - .5) * R * .02, cy + (rand(seed, k + 9) - .5) * R * .02, rx * (1 - k * .06), ry * (1 - k * .05), (rand(seed, k + 3) - .5) * .4, 0, TAU); ctx.fill(); }
    } else if (style === 'paper' || style === 'print') {
      ctx.fillStyle = white; ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU); ctx.fill();
    } else {
      ctx.fillStyle = white; ctx.shadowColor = white; ctx.shadowBlur = R * .02;
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
    }
    // pupil, clipped to the white
    if (open > .08) {
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU); ctx.clip();
      const gx = clamp(eyeX, -1, 1) * rx * .42, gy = clamp(eyeY, -1, 1) * ry * .35 + ry * .14;
      const prx = e.prx * R * wide, pry = e.pry * R * wide * (style === 'pen' ? .8 : 1);
      ctx.fillStyle = ink; ctx.beginPath(); ctx.ellipse(cx + gx, cy + gy, prx, Math.min(pry, ry * .95), 0, 0, TAU); ctx.fill();
      ctx.fillStyle = white; ctx.beginPath(); ctx.arc(cx + gx + prx * .38, cy + gy - pry * .38, Math.max(.6, prx * .22), 0, TAU); ctx.fill();
      if (happy > 0) { ctx.fillStyle = ink; ctx.globalAlpha = happy; ctx.beginPath(); ctx.ellipse(cx, cy + ry * 1.25, rx * 1.1, ry * .7, 0, 0, TAU); ctx.fill(); }
    } else if (style === 'pen' || style === 'paper') {
      ctx.strokeStyle = ink; ctx.lineWidth = Math.max(1, lineWidth); ctx.beginPath(); ctx.moveTo(cx - rx, cy); ctx.lineTo(cx + rx, cy); ctx.stroke();
    }
    ctx.restore();
    geo.push({ cx, cy, rx, ry });
  }
  return geo;
}

// ---- strokes / textures -------------------------------------------------
/* Dry-brush stroke along points with a width function w(t 0..1). Bristles are thin jittered sub-strokes.
 * opts: {color, bristles=9, dry=.35 (0 wet..1 very dry), seed, alpha, reveal=1 (0..1 fraction of the path drawn)} */
export function brushStroke(ctx, pts, w, opts = {}) {
  const { color = INK, bristles = 9, dry = .35, seed = 0, alpha = 1, reveal = 1 } = opts;
  const n = Math.max(2, Math.floor(pts.length * clamp(reveal, 0, 1)));
  if (n < 2) return;
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = color;
  // solid core
  ctx.globalAlpha = alpha * (1 - dry * .5);
  for (let i = 1; i < n; i++) {
    const t = i / (pts.length - 1); ctx.lineWidth = Math.max(.5, w(t) * (1 - dry * .45));
    ctx.beginPath(); ctx.moveTo(pts[i - 1].x, pts[i - 1].y); ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke();
  }
  // bristles
  for (let b = 0; b < bristles; b++) {
    const off = (rand(seed, b) - .5), wob = rand(seed, b + 40);
    ctx.globalAlpha = alpha * (.25 + .6 * rand(seed, b + 80)) * (1 - dry * .3);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const t = i / (pts.length - 1), p = pts[i], q = pts[Math.min(pts.length - 1, i + 1)], pp = pts[Math.max(0, i - 1)];
      const nx = -(q.y - pp.y), ny = q.x - pp.x, len = Math.hypot(nx, ny) || 1;
      const d = off * w(t) * (1 + dry * .8) + Math.sin(t * 9 + wob * 6) * w(t) * .08;
      const gap = dry > 0 && rand(seed, b * 131 + i) < dry * t * .6; // dry tail breaks up
      const x = p.x + nx / len * d, y = p.y + ny / len * d;
      if (i === 0 || gap) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.lineWidth = Math.max(.5, w(.5) * (.05 + .1 * rand(seed, b + 120)));
    ctx.stroke();
  }
  ctx.restore();
}
/* Pen line with slight hand wobble along a point list; boil shifts the jitter pattern. reveal 0..1 draws part. */
export function penLine(ctx, pts, { color = INK, width = 1.8, jitter = .6, seed = 0, closed = false, reveal = 1, alpha = 1 } = {}) {
  const n = Math.max(2, Math.floor(pts.length * clamp(reveal, 0, 1)));
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = alpha;
  const jp = pts.slice(0, n).map((p, i) => ({ x: p.x + (rand(seed, i) - .5) * jitter * 2, y: p.y + (rand(seed, i + 500) - .5) * jitter * 2 }));
  tracePath(ctx, jp, closed && n === pts.length); ctx.stroke(); ctx.restore();
}
/* Torn-paper outline: add high-frequency jags to a smooth outline. */
export function tornPoints(pts, { seed = 0, amp = .03, R = 60 } = {}) {
  const n = pts.length;
  return pts.map((p, i) => {
    const q = pts[(i + 1) % n], pp = pts[(i - 1 + n) % n];
    const nx = -(q.y - pp.y), ny = q.x - pp.x, len = Math.hypot(nx, ny) || 1;
    const d = (rand(seed, i) - .5) * amp * R * 2 + (rand(seed, i + 777) < .12 ? amp * R * 1.6 : 0);
    return { x: p.x + nx / len * d, y: p.y + ny / len * d };
  });
}
/* Diagonal hatching clipped to the current path. amount 0..1 = how much of the area is hatched (fills from the bottom). */
export function hatch(ctx, pts, { color = INK, spacing = 5, angle = -.7, amount = 1, width = 1.2, seed = 0, jitter = .8, alpha = .9 } = {}) {
  if (amount <= 0) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  ctx.save(); tracePath(ctx, pts); ctx.clip();
  // fill level from the bottom
  const level = maxY - (maxY - minY) * clamp(amount, 0, 1);
  ctx.beginPath(); ctx.rect(minX - 10, level, maxX - minX + 20, maxY - level + 10); ctx.clip();
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.globalAlpha = alpha;
  const diag = Math.hypot(maxX - minX, maxY - minY), cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  ctx.translate(cx, cy); ctx.rotate(angle);
  for (let x = -diag / 2, i = 0; x <= diag / 2; x += spacing, i++) {
    const j = (rand(seed, i) - .5) * jitter;
    ctx.beginPath(); ctx.moveTo(x + j, -diag / 2 + rand(seed, i + 300) * spacing); ctx.lineTo(x - j + (rand(seed, i + 600) - .5) * jitter, diag / 2 - rand(seed, i + 900) * spacing); ctx.stroke();
  }
  ctx.restore();
}
/* Landing/impact ink ring that soaks in: strength 0..1. */
export function bleedRing(ctx, x, y, R, strength, { color = INK, seed = 0 } = {}) {
  if (strength <= 0.001) return;
  ctx.save(); ctx.globalAlpha = .28 * strength; ctx.fillStyle = color;
  const pts = []; const n = 40;
  for (let i = 0; i < n; i++) { const a = i / n * TAU; const r = R * (1.02 + .35 * (1 - strength)) * (1 + .09 * ringNoise(i / n, 7, seed)); pts.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r * .28 }); }
  ctx.shadowColor = color; ctx.shadowBlur = R * .12; tracePath(ctx, pts); ctx.fill(); ctx.restore();
}
/* Bounding box of points after an affine transform via mapPoint. */
export function bounds(cx, footY, R, pose, pts, offsetY = -FOOT) {
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const p of pts) { const m = mapPoint(cx, footY, R, pose, p.x, p.y + offsetY * R); l = Math.min(l, m.x); r = Math.max(r, m.x); t = Math.min(t, m.y); b = Math.max(b, m.y); }
  return { left: l, top: t, right: r, bottom: b };
}

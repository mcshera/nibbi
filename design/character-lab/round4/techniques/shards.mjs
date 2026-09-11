/* Round-4 technique: MOSAIC (shards). Nibbi is a Voronoi mosaic of ~70 rigid ink tiles on springs.
 * Cues never set positions: they change spring targets / stiffness or fire impulses; the tiles do the rest. */
import * as ink from '../../ink.mjs';
import { ACTION_IDS } from '../../actions.mjs';
const { clamp, mix, TAU, FOOT } = ink;

export const meta = {
  id: 'shards', name: 'Mosaic',
  technique: 'Voronoi mosaic (jittered sites, 3 Lloyd relaxations, half-plane clipped cells) of ~70 rigid tiles, each a spring-damped body tied to its home pose and to its neighbours',
  tagline: 'An ink mosaic that is secretly a pile of loose tiles: it leans with lag, shatters, and clicks back together.',
  look: 'Flat ink tiles with fine cream grout cracks between them; two big feature tiles carry paper-white eyes with a pupil that slides with the gaze.',
  motion: 'Every tile is a rigid body. Cues only move the targets or kick the tiles, so leans lag from the foot up, hops settle with a jiggle, success bursts and snaps, and error really breaks and re-seats — nothing is keyframed.',
  eyes: 'The two Voronoi sites nearest the eye centres are pinned onto them; those tiles are drawn with a white ellipse and a pupil clipped inside the tile, so the eyes fall, spin and re-seat with their tiles.',
  fun: ['press a tile and drag it out: it comes away, stretches its neighbours on their springs and snaps back on release', 'tap anywhere: a shockwave shoves the nearby tiles outward with a twist, then they spring home', 'error shatters the whole mosaic to the floor and reassembles it after a beat', 'success blows the tiles outward and snaps them back with a ripple', 'think lets a few crown tiles loosen and orbit above the head until they re-seat'],
  risks: ['too many tiles make the eyes small at pill size', 'reassembly after error can jam if tiles collide while springs pull', 'grout lines shimmer at 24 px', 'rigid tiles read as ceramic more than as ink'],
  stills: { idle: 2, hello: .5, listen: 1.2, think: 1.6, work: 1.6, success: .45, error: 1.0, sleep: 2, tap: .25 },
};

const ONE_SHOT = { hello: 1.5, success: 1.6, error: 3.4, tap: .9 }, REDUCED_HOLD = 3;
const EYE = { rx: .2, ry: .22, pr: .11 };

export function mount(host, { R = 96, seed = 1, tint = null, reduced = false, energy = 1, size = 'hero', paper = true } = {}) {
  const W = Math.round(3.4 * R), H = Math.round(3.6 * R), footX = 1.7 * R, footY = 3.1 * R;
  host.style.width = W + 'px'; host.style.height = H + 'px'; host.style.position = 'relative';
  const dpr = Math.min(2, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1));
  const canvas = document.createElement('canvas'); canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.cssText = `display:block;width:${W}px;height:${H}px;touch-action:none`;
  host.appendChild(canvas); const ctx = canvas.getContext('2d');
  const hero = size === 'hero', tiny = size === 'tiny';

  // --- mosaic (R units, origin = body centre, y down) --------------------------------------------------
  const M = tessellate(seed, hero ? 70 : tiny ? 16 : 36, hero ? 48 : tiny ? 24 : 36);
  const T = M.tiles, N = T.length, FLOOR = M.floor;
  const grout = tiny ? .012 : hero ? .012 : .016;
  for (const t of T) { t.local = inset(t.poly.map(p => ({ x: p.x - t.hx, y: p.y - t.hy })), hero ? .017 : grout + .012); t.rad = Math.sqrt(t.area / Math.PI) * .9; t.x = t.hx; t.y = t.hy; t.a = 0; t.vx = t.vy = t.va = 0; t.s = 1; t.hf = clamp((FLOOR - t.hy) / (FLOOR + 1), 0, 1); t.row = Math.floor((t.hy + 1.3) / .24); }
  const crownTiles = T.map((t, i) => i).filter(i => !T[i].eye).sort((a, b) => T[a].hy - T[b].hy).slice(0, tiny ? 2 : hero ? 4 : 3);
  const springs = M.pairs.map(([i, j]) => ({ i, j, dx: T[j].hx - T[i].hx, dy: T[j].hy - T[i].hy }));

  // --- state ---------------------------------------------------------------------------------------
  const st = { reduced, energy, tint };
  let action = 'idle', tAction = 0, time = 0, grab = -1, pointer = { x: 0, y: 0 }, rc = 0, tapPt = { x: 0, y: -.25 };   // rc: rand counter
  const face = { eyeX: 0, eyeY: 0, blink: 0 };
  const K = { home: 150, damp: 14, nb: 50, ang: 40, gravity: 0, collide: false };
  const nudge = { i: -1, x: 0, y: 0 };

  function params(a, t) {   // spring parameters for the current action and time
    const p = { home: 150, damp: 14, nb: 50, ang: 40, gravity: 0, collide: false };
    if (a === 'sleep') { p.damp = 22; p.home = 120; }
    if (a === 'listen') { p.home = 110; p.nb = 90; p.damp = 12; }
    if (a === 'tap' && t < .4) { p.home = 90; p.nb = 40; p.damp = 10; }
    if (a === 'success') { if (t < .42) { p.home = 12; p.nb = 5; p.damp = 2.5; p.ang = 4; } else { p.home = 420; p.damp = 26; p.nb = 90; } }
    if (a === 'error') { if (t < 1.6) { p.home = 0; p.nb = 0; p.ang = 0; p.damp = 1.2; p.gravity = 7; p.collide = true; } else { const r = clamp((t - 1.6) / .5, 0, 1); p.home = 40 + 200 * r; p.nb = 60 * r; p.damp = 22; p.ang = 50; } }
    return p;
  }
  function targets(a, t, i, out) {   // home target pose for tile i under action a at action-time t (writes out.x/out.y/out.a)
    const T0 = T[i], e = st.energy; let x = T0.hx, y = T0.hy, ang = 0;
    if (a === 'listen') { const l = T0.hf * T0.hf, th = -.16 * e, c = Math.cos(th), s = Math.sin(th), ry = y - FLOOR; x = x * c - ry * s - .12 * e; y = FLOOR + x * 0 + (T0.hx * s + ry * c); x += -.14 * e * l; ang = th - .06 * l; }
    if (a === 'sleep') { y = FLOOR - (FLOOR - y) * .75; x *= 1.15; }
    if (a === 'work') { const ph = time * TAU * .45 - T0.hx * 3.2; const w = Math.max(0, Math.sin(ph)); y -= .11 * e * w * w * (.3 + .7 * T0.hf); x += (T0.row % 2 ? .03 : -.03) * e * w; ang = .16 * e * w * Math.cos(ph); }
    if (a === 'hello') { const d = (1 - T0.hf) * .03, u = (t - d) / (.55 - d); y -= .8 * e * ink.bell(u) * (1 + .12 * T0.hf); }
    if (a === 'think') { const k = crownTiles.indexOf(i); if (k >= 0) { const ph = time * 1.1 + k * TAU / crownTiles.length, r = .22 + .06 * k; x = -.18 + Math.cos(ph) * r * 1.3; y = -1.32 - k * .08 + Math.sin(ph) * r * .55; ang = ph * .6; } else { y += .015 * T0.hf; } }
    if (a === 'error' && st.reduced) { rc = i * 3; x += (ink.rand(seed + 5, rc) - .5) * .06; y += (ink.rand(seed + 5, rc + 1)) * .05 + .02 * T0.hf; ang = (ink.rand(seed + 5, rc + 2) - .5) * .3; }
    if (a === 'tap' && (t < .4 || st.reduced)) { const d = Math.hypot(x - tapPt.x, y - tapPt.y) || 1e-3, w = Math.max(0, 1 - d / .75); x += (x - tapPt.x) / d * .2 * w; y += (y - tapPt.y) / d * .2 * w; ang += (ink.rand(seed + 6, i) - .5) * .4 * w; }
    if (st.reduced) {   // static expressions for the one-shots (the animated ones are impulses, which a still cannot show)
      if (a === 'hello') y -= .14 * e * (1 + .1 * T0.hf);
      if (a === 'success') { x *= 1.16; y = -.1 + (y + .1) * 1.16; ang = (ink.rand(seed + 6, i) - .5) * .35; }
    }
    if (grab === i) { x = pointer.x; y = pointer.y; }
    if (nudge.i === i) { x += nudge.x; y += nudge.y; }
    out.x = x; out.y = y; out.a = ang;
  }
  const tg = { x: 0, y: 0, a: 0 };

  function simulate(dt) {
    const p = params(action, tAction); Object.assign(K, p);
    const SUB = 2, h = dt / SUB;
    for (let s = 0; s < SUB; s++) {
      for (let i = 0; i < N; i++) {
        const t = T[i]; targets(action, tAction, i, tg); t.tx = tg.x; t.ty = tg.y;
        const kh = grab === i ? 900 : K.home * (action === 'listen' ? mix(1, .25, t.hf) : 1);
        t.fx = (tg.x - t.x) * kh - t.vx * K.damp; t.fy = (tg.y - t.y) * kh - t.vy * K.damp + K.gravity;
        t.ta = (tg.a - t.a) * K.ang - t.va * (K.damp * .8);
      }
      if (K.nb > 0) for (const sp of springs) {   // neighbour springs keep the *target* relative offsets, so lag comes from mass/damping, not from fighting the pose
        const a = T[sp.i], b = T[sp.j], ex = (b.x - a.x) - (b.tx - a.tx), ey = (b.y - a.y) - (b.ty - a.ty), k = K.nb;
        a.fx += ex * k; a.fy += ey * k; b.fx -= ex * k; b.fy -= ey * k;
        a.ta += (sp.dx * ey - sp.dy * ex) * k * .15; b.ta += (sp.dx * ey - sp.dy * ex) * k * .15;
      }
      if (K.collide) for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
        const a = T[i], b = T[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1e-4, m = a.rad + b.rad;
        if (d < m) { const push = (m - d) / d * .5; a.x -= dx * push; a.y -= dy * push; b.x += dx * push; b.y += dy * push; const vn = (b.vx - a.vx) * dx / d + (b.vy - a.vy) * dy / d; if (vn < 0) { a.vx += vn * dx / d * .5; a.vy += vn * dy / d * .5; b.vx -= vn * dx / d * .5; b.vy -= vn * dy / d * .5; } }
      }
      for (const t of T) {
        t.vx += t.fx * h; t.vy += t.fy * h; t.va += t.ta * h;
        const vl = Math.hypot(t.vx, t.vy); if (vl > 9) { t.vx *= 9 / vl; t.vy *= 9 / vl; }
        t.x += t.vx * h; t.y += t.vy * h; t.a += t.va * h;
        const fl = FLOOR - (K.collide ? t.rad : (t.hy > FLOOR - .25 ? FLOOR - t.hy : t.rad));
        if (t.y > fl) { t.y = fl; if (t.vy > 0) t.vy = -t.vy * .12; t.vx *= K.collide ? .8 : .96; t.va *= .9; }
        t.x = clamp(t.x, -1.62, 1.62); t.y = Math.max(t.y, -2.95);
        if (t.a > Math.PI) t.a -= TAU; else if (t.a < -Math.PI) t.a += TAU;
      }
    }
  }
  function snap() { for (let i = 0; i < N; i++) { const t = T[i]; targets(action, tAction, i, tg); t.x = tg.x; t.y = tg.y; t.a = tg.a; t.vx = t.vy = t.va = 0; t.s = 1; } }
  function relax() { time = 2.7; snap(); Object.assign(face, faceFor(action)); }     // reduced: frozen deterministic pose (orbits and waves frozen at one phase)
  function faceFor(a) {
    const f = { eyeX: 0, eyeY: 0, blink: 0 };
    if (a === 'listen') f.eyeX = -.9;
    if (a === 'think') { f.eyeX = -.8; f.eyeY = -.9; }
    if (a === 'work') f.eyeY = .8;
    if (a === 'error') { f.eyeY = 1; f.eyeX = .2; }
    if (a === 'sleep') f.blink = 1;
    if (a === 'hello') f.eyeY = -.3;
    if (a === 'success') f.eyeY = -.4;
    if (grab >= 0) { const g = T[grab]; f.eyeX = clamp(g.x * 1.5, -1, 1); f.eyeY = clamp((g.y + .1) * 1.5, -1, 1); }
    return f;
  }
  function kick(x, y, strength, radius, twist, eyeW = 1) {
    for (const t of T) { if (t.eye && eyeW <= 0) continue; const dx = t.x - x, dy = t.y - y, d = Math.hypot(dx, dy) || 1e-3, w = Math.max(0, 1 - d / radius); if (w <= 0) continue; if (t.eye) w *= eyeW; t.vx += dx / d * strength * w; t.vy += dy / d * strength * w; t.va += (ink.rand(seed, rc++) - .5) * twist * w; }
  }

  const ctl = {
    cue(a) {
      if (!ACTION_IDS.includes(a)) return;
      action = a; tAction = 0; grab = -1; nudge.i = -1;
      const e = st.energy;
      if (st.reduced) { relax(); return; }
      if (a === 'success') { if (!tiny) { kick(0, -.1, 2.4 * e, 3, 12, 0); for (const t of T) if (!t.eye) t.vy -= .6 * e; } else for (const t of T) t.vy -= .9 * e; }
      if (a === 'error') { for (const t of T) { t.va += (ink.rand(seed, rc++) - .5) * 6 * e; t.vx += (ink.rand(seed, rc++) - .5) * .6; } }
      if (a === 'tap') { tapPt = { x: 0, y: -.25 }; kick(0, -.25, 2 * e, .9, 8); }
    },
    step(dt) {
      dt = clamp(dt, 0, .1); if (dt <= 0) { draw(); return; }
      tAction += dt;
      if (!st.reduced) {
        time += dt;
        // idle: now and then one tile shifts a hair
        if (action === 'idle') { const slot = Math.floor(time / 1.7); const ph = time / 1.7 - slot; if (ph < .5) { nudge.i = Math.floor(ink.rand(seed + 3, slot) * N); nudge.x = (ink.rand(seed + 4, slot) - .5) * .025; nudge.y = (ink.rand(seed + 4, slot + 1) - .5) * .02; } else nudge.i = -1; }
        else nudge.i = -1;
        const fk = 1 - Math.exp(-dt * 9), ft = faceFor(action);
        face.eyeX = mix(face.eyeX, ft.eyeX, fk); face.eyeY = mix(face.eyeY, ft.eyeY, fk); face.blink = mix(face.blink, ft.blink, 1 - Math.exp(-dt * 12));
        if (action !== 'sleep' && grab < 0 && action !== 'error') { const ph = ink.fract(time / 5.7 + ink.rand(seed, 7)); if (ph < .04) face.blink = Math.max(face.blink, ink.bell(ph / .04)); }
        simulate(dt);
        const br = action === 'idle' ? .012 : action === 'sleep' ? .02 : 0, base = action === 'sleep' ? 1.05 : 1;
        for (const t of T) t.s = base + br * Math.sin(time * TAU * (action === 'sleep' ? .12 : .22) - t.hy * 1.4);
      }
      if (ONE_SHOT[action] && tAction > (st.reduced ? REDUCED_HOLD : ONE_SHOT[action])) { action = 'idle'; tAction = 0; if (st.reduced) relax(); }
      draw();
    },
    setReduced(v) { st.reduced = !!v; if (st.reduced) relax(); },
    setEnergy(e) { st.energy = clamp(e, .5, 1.5); }, setTint(c) { st.tint = c; },
    poke(x, y, kind) {
      const lx = (x - footX) / R, ly = (y - footY) / R + FLOOR; pointer = { x: lx, y: ly };
      if (kind === 'down') { let best = 1e9; grab = -1; for (let i = 0; i < N; i++) { const d = Math.hypot(T[i].x - lx, T[i].y - ly); if (d < best) { best = d; grab = i; } } if (best > .5) grab = -1; if (ONE_SHOT[action]) { action = 'idle'; tAction = 0; } if (st.reduced) snap(); }
      if (kind === 'move' && st.reduced && grab >= 0) snap();
      if (kind === 'up') { if (grab >= 0 && !st.reduced) { const g = T[grab]; g.va += (ink.rand(seed, rc++) - .5) * 6; } grab = -1; if (st.reduced) snap(); }
      if (kind === 'tap') { action = 'tap'; tAction = 0; grab = -1; tapPt = { x: lx, y: ly }; if (!st.reduced) kick(lx, ly, 2.4 * st.energy, .8, 10); else relax(); }
    },
    destroy() { for (const [ev, fn] of listeners) host.removeEventListener(ev, fn); canvas.remove(); },
  };
  const listeners = [
    ['pointerdown', e => ctl.poke(e.offsetX, e.offsetY, 'down')], ['pointermove', e => ctl.poke(e.offsetX, e.offsetY, 'move')],
    ['pointerup', e => ctl.poke(e.offsetX, e.offsetY, 'up')], ['pointerleave', e => ctl.poke(e.offsetX, e.offsetY, 'up')],
  ];
  for (const [ev, fn] of listeners) host.addEventListener(ev, fn);

  // --- draw -------------------------------------------------------------------------------------------
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (paper) ink.paper(ctx, W, H, { grain: 0 }); else ctx.clearRect(0, 0, W, H);
    const color = ink.inkColor(st.tint), white = '#fbfaf7';
    ctx.save(); ctx.translate(footX, footY - FLOOR * R); ctx.scale(R, R);
    ctx.lineJoin = 'round'; ctx.lineWidth = .024; ctx.strokeStyle = color; ctx.fillStyle = color;
    const open = 1 - clamp(face.blink, 0, 1), sleepy = action === 'sleep';
    for (const t of T) {
      ctx.save(); ctx.translate(t.x, t.y); ctx.rotate(t.a); if (t.s !== 1) ctx.scale(t.s, t.s);
      const L = t.local; ctx.beginPath(); ctx.moveTo(L[0].x, L[0].y); for (let k = 1; k < L.length; k++) ctx.lineTo(L[k].x, L[k].y); ctx.closePath();
      ctx.fill(); ctx.stroke();
      if (t.eye) {
        ctx.clip();
        const ex = t.ex - t.hx, ey = t.ey - t.hy, ry = Math.max(.03, EYE.ry * open);
        ctx.fillStyle = white; ctx.beginPath(); ctx.ellipse(ex, ey, EYE.rx, ry, 0, 0, TAU); ctx.fill();
        if (open > .1 && !sleepy) {
          ctx.clip(); const gx = clamp(face.eyeX, -1, 1) * .075, gy = clamp(face.eyeY, -1, 1) * .07 + .03;
          ctx.fillStyle = color; ctx.beginPath(); ctx.arc(ex + gx, ey + gy, EYE.pr, 0, TAU); ctx.fill();
          if (!tiny) { ctx.fillStyle = white; ctx.beginPath(); ctx.arc(ex + gx + .04, ey + gy - .04, .026, 0, TAU); ctx.fill(); }
        }
      }
      ctx.restore();
    }
    if (tiny && action === 'success') {   // R = 12: keep the silhouette, celebrate with a ring of six chips
      const u = st.reduced ? .5 : clamp(tAction / 1.1, 0, 1), rr = 1.3 * (st.reduced ? 1 : .7 + .5 * u); ctx.globalAlpha = st.reduced ? 1 : 1 - u * u; ctx.fillStyle = color;
      for (let k = 0; k < 6; k++) { const a = k * TAU / 6 + .4; ctx.save(); ctx.translate(Math.cos(a) * rr, -.15 + Math.sin(a) * rr * .8); ctx.rotate(a); ctx.fillRect(-.09, -.07, .18, .14); ctx.restore(); }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
  if (st.reduced) relax();
  draw();
  return ctl;
}

// --- tessellation: jittered sites inside the silhouette, Lloyd relaxation, Voronoi by half-plane clipping ---------
export function tessellate(seed, count, n) {
  const poly = ink.blobPoints(1, { n, seed, rough: .03 });
  let floor = -1e9; for (const p of poly) floor = Math.max(floor, p.y);
  const A = Math.abs(area(poly)), eyes = ink.EYES.map(e => ({ x: e.x, y: e.y + .02 })), EX = .5;
  const step = Math.sqrt((A - 1.25) / Math.max(1, count - 2)) * 1.05;
  let sites = [], rc = 0;
  for (let gy = -1.25; gy < floor; gy += step) for (let gx = -1.3; gx < 1.3; gx += step * 1.02) {
    const x = gx + (ink.rand(seed, rc++) - .5) * step * .7, y = gy + (ink.rand(seed, rc++) - .5) * step * .7;
    if (inside(poly, x, y) && eyes.every(e => Math.hypot(x - e.x, y - e.y) > EX * .8)) sites.push({ x, y, eye: false });
  }
  for (const e of eyes) sites.push({ x: e.x, y: e.y, eye: true, ex: e.x, ey: e.y });
  let cells;
  for (let it = 0; it < 4; it++) {
    cells = sites.map((s, i) => cell(poly, sites, i));
    if (it === 3) break;
    sites = sites.map((s, i) => { if (s.eye) return s; const c = centroid(cells[i]); let x = c.x, y = c.y; for (const e of eyes) { const dx = x - e.x, dy = y - e.y, d = Math.hypot(dx, dy); if (d < EX) { x = e.x + dx / d * EX; y = e.y + dy / d * EX; } } return { x, y, eye: false }; });
  }
  const tiles = sites.map((s, i) => { const c = centroid(cells[i]); return { poly: cells[i], hx: c.x, hy: c.y, area: Math.abs(area(cells[i])), eye: s.eye, ex: s.ex, ey: s.ey }; });
  const pairs = [];
  for (let i = 0; i < sites.length; i++) for (let j = i + 1; j < sites.length; j++) {
    let hits = 0; for (const v of cells[i]) if (Math.abs(Math.hypot(v.x - sites[i].x, v.y - sites[i].y) - Math.hypot(v.x - sites[j].x, v.y - sites[j].y)) < 1e-6) hits++;
    if (hits >= 2) pairs.push([i, j]);
  }
  return { tiles, pairs, floor };
}
function cell(poly, sites, i) {
  let out = poly.map(p => ({ x: p.x, y: p.y })); const s = sites[i];
  for (let j = 0; j < sites.length && out.length; j++) {
    if (j === i) continue; const q = sites[j], mx = (s.x + q.x) / 2, my = (s.y + q.y) / 2, nx = q.x - s.x, ny = q.y - s.y;
    const res = [];
    for (let k = 0; k < out.length; k++) {
      const a = out[k], b = out[(k + 1) % out.length], da = (a.x - mx) * nx + (a.y - my) * ny, db = (b.x - mx) * nx + (b.y - my) * ny;
      if (da <= 0) res.push(a);
      if ((da < 0) !== (db < 0)) { const t = da / (da - db); res.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }); }
    }
    out = res;
  }
  return out;
}
function inset(P, g) {   // offset polygon edges inward by g (miter), P assumed simple; orientation-agnostic via signed area
  const n = P.length, sgn = area(P) > 0 ? 1 : -1, out = [];
  for (let k = 0; k < n; k++) {
    const p0 = P[(k + n - 1) % n], p1 = P[k], p2 = P[(k + 1) % n];
    const n1 = norm(p0, p1, sgn), n2 = norm(p1, p2, sgn), d = 1 + n1.x * n2.x + n1.y * n2.y;
    const f = d > .3 ? g / d : g / .3;
    out.push({ x: p1.x + (n1.x + n2.x) * f, y: p1.y + (n1.y + n2.y) * f });
  }
  return out;
}
function norm(a, b, sgn) { const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1; return { x: -dy / l * sgn, y: dx / l * sgn }; }
function inside(poly, x, y) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) c = !c; } return c; }
function area(P) { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p.x * q.y - q.x * p.y; } return a / 2; }
function centroid(P) { let x = 0, y = 0, a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length], c = p.x * q.y - q.x * p.y; x += (p.x + q.x) * c; y += (p.y + q.y) * c; a += c; } if (Math.abs(a) < 1e-9) { for (const p of P) { x += p.x; y += p.y; } return { x: x / P.length, y: y / P.length }; } return { x: x / (3 * a), y: y / (3 * a) }; }

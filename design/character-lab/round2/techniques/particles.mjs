/* Round-2 technique: PARTICLE INK. Nibbi is a swarm of ink grains held to a target silhouette by springs,
 * stirred by curl-ish noise, with two eye CLEARINGS (grains are pushed out of two discs so the paper shows)
 * and a dense pupil cluster inside each. Cues move the HOMES; the grains lag, overshoot and trail. */
import * as ink from '../../ink.mjs';
import { ACTION_IDS } from '../../actions.mjs';
const { clamp, mix, smooth, bell, TAU, FOOT, rand, noise1 } = ink;

export const meta = {
  id: 'particles', name: 'Particle ink',
  technique: '~2500 ink grains (300 pill / 90 tiny) spring-bound to homes sampled inside the silhouette, stirred by noise, drawn as small soft dots with overlapping alpha (Canvas2D drawImage sprites)',
  tagline: 'A little heap of ink grain that holds a shape only because it wants to.',
  look: 'Granular ink on cream paper: dense in the middle, a shimmering, slightly ragged edge like drying ink. Two clearings low on the face where the paper shows through, each with a dark pupil cluster.',
  motion: 'Nothing is keyframed on the body: cues move the home points and the grains follow on springs, so every gesture overshoots, lags and leaves a few trailing grains. Streams of grains leave the body for work and error and are recycled.',
  eyes: 'Two discs repel the grains (clearings); a small attractor inside each gathers a pupil cluster that tracks a gaze target. Blink = the repulsion switches off for 120 ms and the clearing collapses; sleep closes it fully; success squints it.',
  risks: ['grain shimmer may read as noise next to text', 'cost at hero (2500 grains × noise × draw)', 'clearings may read as holes rather than eyes', 'success scatter can look like a burst of dust'],
  stills: { idle: 2, hello: .5, listen: 1.2, think: 1.5, work: 1.2, success: .8, error: 1.0, sleep: 2, tap: .2 },
};

const RECT = true; // fillRect grains (fast); false → soft sprite grains via drawImage
const ONESHOT = { hello: 1.15, tap: .55, success: 1.45, error: 1.7 };
const EYE = { x: .26, y: .1, r: .21, pr: .085 };

export function mount(host, { R = 96, seed = 1, tint = null, reduced = false, energy = 1, size = 'hero', paper = true } = {}) {
  const W = Math.round(3.4 * R), H = Math.round(3.6 * R), footX = 1.7 * R, footY = 3.1 * R, CY = footY - FOOT * R;
  host.style.width = W + 'px'; host.style.height = H + 'px'; host.style.position = 'relative';
  const dpr = Math.min(2, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1));
  const canvas = document.createElement('canvas'); canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.cssText = `display:block;width:${W}px;height:${H}px;touch-action:none`;
  host.appendChild(canvas); const ctx = canvas.getContext('2d');

  // --- population --------------------------------------------------------------------------------------------
  const N = size === 'tiny' ? 110 : size === 'pill' ? 320 : 2500;
  const grain = size === 'tiny' ? R * .16 : size === 'pill' ? R * .1 : R * .038;   // grain diameter in px
  const alpha = size === 'tiny' ? .85 : size === 'pill' ? .7 : .6;
  const ES = size === 'tiny' ? 1.4 : 1;                          // tiny: bigger clearings so the eyes survive 24 px
  const NP = Math.max(4, Math.round(N * .032));                    // pupil grains per eye
  const NS = Math.max(3, Math.round(N * .07));                     // stream grains (work / error)
  const NO = size === 'hero' ? 12 : size === 'pill' ? 5 : 2;       // think orbiters
  const bx = new Float32Array(N), by = new Float32Array(N), px = new Float32Array(N), py = new Float32Array(N);
  const vx = new Float32Array(N), vy = new Float32Array(N), ph = new Float32Array(N), kk = new Float32Array(N);
  const jw = new Float32Array(N); const role = new Uint8Array(N); // 0 body, 1 pupil L, 2 pupil R, 3 stream, 4 orbiter
  let ri = 0;
  for (let i = 0; i < N; i++) {
    // rejection-sample a home inside the silhouette (slightly denser toward the edge so the outline stays solid)
    let x = 0, y = 0, rr = 0;
    for (let tries = 0; tries < 40; tries++) {
      x = (rand(seed, ri++) * 2 - 1) * 1.25; y = (rand(seed, ri++) * 2 - 1) * 1.25;
      const a = Math.atan2(y, x); rr = Math.hypot(x, y) / (ink.baseProfile(a) + .02 * noise1(a * 3 + seed, 5));
      if (rr < 1) break;
    }
    jw[i] = .06 + smooth(.8, 1, rr);                           // only the rim shimmers (ink drying); the core sits still
    bx[i] = x; by[i] = y; ph[i] = rand(seed, ri++); kk[i] = .8 + .5 * rand(seed, ri++);
    if (i < NP) role[i] = 1; else if (i < 2 * NP) role[i] = 2; else if (i < 2 * NP + NS) role[i] = 3; else if (i < 2 * NP + NS + NO) role[i] = 4;
    if (role[i] === 1 || role[i] === 2) { const a = ph[i] * TAU, r = Math.sqrt(rand(seed, ri++)) * EYE.pr * ES; bx[i] = Math.cos(a) * r; by[i] = Math.sin(a) * r * .9; kk[i] *= 2.4; }
  }

  // --- state -----------------------------------------------------------------------------------------------------
  const st = { reduced, energy, tint };
  let action = 'idle', tA = 0, time = 0, blinkAt = 4.6 + rand(seed, 9001) * 2, blinkT = 9, bi = 0;
  const pose = { dx: 0, dy: 0, sx: 1, sy: 1, lean: 0, hook: 0, jit: 1, open: 1, gx: 0, gy: 0, happy: 0 };
  const tgt = { ...pose };
  let pointer = null, pressed = false, downX = 0, downY = 0, dragX = 0, dragY = 0, tapX = 0, tapY = 0, tapT = 9;
  let sprite = null, spriteKey = '';

  // --- home = base point through the current pose (all in R units, then px) ------------------------------------
  const H2 = [0, 0];
  function poseXY(x, y) {
    const u = smooth(-.3, -1.1, y);
    x += pose.hook * .38 * u * u; y -= pose.hook * .32 * u;                    // think: crown curls up-right into a hook
    x += pose.lean * smooth(FOOT, -1, y) * .9;                                // lean the crown sideways
    y = FOOT + (y - FOOT) * pose.sy; x *= pose.sx;                             // squash about the foot
    H2[0] = footX + (x + pose.dx) * R; H2[1] = CY + (y + pose.dy) * R; return H2;
  }
  function home(i) {
    const r = role[i];
    if (r === 1 || r === 2) { const s = r === 1 ? -1 : 1; const h = poseXY(EYE.x * s + pose.gx * EYE.r * .5, EYE.y + pose.gy * EYE.r * .5 - pose.happy * .06); return [h[0] + bx[i] * R * (1 - .45 * pose.happy), h[1] + by[i] * R * (1 - .6 * pose.happy) * mix(.35, 1, pose.open)]; }
    const h = poseXY(bx[i], by[i]); return [h[0], h[1]];
  }

  // --- pose targets per action --------------------------------------------------------------------------------------
  function setTargets(T) {
    const e = st.energy, t = tA;
    Object.assign(tgt, { dx: 0, dy: 0, sx: 1, sy: 1, lean: 0, hook: 0, jit: 1, open: 1, gx: 0, gy: 0, happy: 0 });
    const breathe = st.reduced ? 0 : Math.sin(T * .8) * .0025;
    tgt.sy = 1 + breathe; tgt.sx = 1 - breathe * .6;
    switch (action) {
      case 'hello': { const up = t < .7 ? Math.sin(Math.PI * t / .7) : 0; tgt.dy = -.25 * e * up; tgt.sy += .1 * up - .12 * bell((t - .65) / .4) * e; tgt.sx += .08 * bell((t - .65) / .4) * e; tgt.lean = .1 * up; tgt.gy = -.3 * up; break; }
      case 'listen': tgt.dx = -.12 * e; tgt.lean = -.24 * e; tgt.sy += .03; tgt.sx -= .04; tgt.jit = .3; tgt.gx = -.55; tgt.gy = -.2; break;
      case 'think': tgt.hook = 1 * e; tgt.jit = .5; tgt.gx = -.45; tgt.gy = -.65; tgt.sx -= .02; break;
      case 'work': { const beat = st.reduced ? 0 : Math.max(0, Math.sin(T * TAU * .8)); tgt.sx = .92 + .035 * beat; tgt.sy = .94 + .04 * beat; tgt.jit = .55; tgt.gx = .35; tgt.gy = .5; break; }
      case 'success': { const up = t < .55 ? Math.sin(Math.PI * t / .55) : 0; tgt.dy = -.8 * e * up; tgt.sy += .12 * up - .1 * bell((t - .55) / .35); tgt.sx += .1 * bell((t - .55) / .35); tgt.happy = smooth(.05, .3, t) * (1 - smooth(1.1, 1.45, t)); tgt.gy = -.2 * up; break; }
      case 'error': { const w = smooth(.05, .45, t) * (1 - smooth(1.3, 1.7, t)); tgt.sy = 1 - .13 * w * e; tgt.sx = 1 + .1 * w * e; tgt.lean = .05 * w; tgt.gy = .8 * w; tgt.gx = .1 * w; tgt.open = 1 - .35 * w; tgt.jit = .4; break; }
      case 'sleep': tgt.sy = .62 + breathe * .5; tgt.sx = 1.24; tgt.jit = 0; tgt.open = 0; tgt.gy = .6; break;
      case 'tap': { const w = bell(t / .5); tgt.sy -= .08 * w * e; tgt.sx += .06 * w * e; tgt.gy = .3 * w; break; }
    }
    if (pressed) { tgt.sy -= .06; tgt.sx += .05; tgt.jit = .35; }
    tgt.dx += dragX; tgt.dy += dragY;
    if (blinkT < .12) tgt.open = 0;
  }

  const ctl = {
    cue(a) {
      if (!ACTION_IDS.includes(a)) return; action = a; tA = 0;
      if (a === 'success' && !st.reduced) { // 20% of the body scatters outward; the springs gather it back
        for (let i = 0; i < N; i++) if (role[i] === 0 && ph[i] < .2) { const dx = px[i] - footX, dy = py[i] - CY, d = Math.hypot(dx, dy) + 1e-3; const s = (3.2 + 2 * rand(seed, i + 7000)) * R * st.energy; vx[i] += dx / d * s; vy[i] += (dy / d - .5) * s; }
      }
      if (a === 'tap' && !st.reduced) push(tapX || footX, tapY || CY - .75 * R, .45 * R, 3 * R);
    },
    step(dt) {
      dt = clamp(dt, 0, .1); const red = st.reduced;
      if (!red) { time += dt; tA += dt; blinkT += dt; tapT += dt; if (time > blinkAt && action !== 'sleep') { blinkT = 0; blinkAt = time + 2.5 + rand(seed, 9100 + (bi++)) * 3.5; } }
      else { tA = meta.stills[action] || 0; blinkT = 9; }
      if (ONESHOT[action] && tA >= ONESHOT[action]) { action = 'idle'; tA = 0; }
      setTargets(red ? 0 : time);
      const f = red ? 1 : 1 - Math.exp(-dt * 9);
      for (const k in pose) pose[k] = mix(pose[k], tgt[k], f);
      if (red) { dragX = dragY = 0; } else { dragX -= dragX * Math.min(1, dt * 6) * (pressed ? 0 : 1); dragY -= dragY * Math.min(1, dt * 6) * (pressed ? 0 : 1); }
      simulate(dt);
      draw();
    },
    setReduced(v) { st.reduced = !!v; }, setEnergy(e) { st.energy = clamp(e, .5, 1.5); }, setTint(c) { st.tint = c; },
    poke(x, y, kind) {
      if (kind === 'down') { pressed = true; downX = x; downY = y; pointer = [x, y]; action = 'idle'; tA = 0; }
      else if (kind === 'move') { pointer = [x, y]; if (pressed) { dragX = clamp((x - downX) / R * .5, -.3, .3); dragY = clamp((y - downY) / R * .5, -.3, .3); } }
      else if (kind === 'up') { pressed = false; pointer = null; }
      else if (kind === 'tap') { tapX = x; tapY = y; ctl.cue('tap'); }
    },
    destroy() { for (const [n, fn] of L) host.removeEventListener(n, fn); canvas.remove(); },
  };
  const L = [['pointerdown', e => ctl.poke(e.offsetX, e.offsetY, 'down')], ['pointermove', e => ctl.poke(e.offsetX, e.offsetY, 'move')],
             ['pointerup', e => ctl.poke(e.offsetX, e.offsetY, 'up')], ['pointercancel', e => ctl.poke(0, 0, 'up')], ['pointerleave', e => { if (!pressed) pointer = null; }]];
  for (const [n, fn] of L) host.addEventListener(n, fn);

  function push(x, y, rad, s) { for (let i = 0; i < N; i++) { const dx = px[i] - x, dy = py[i] - y, d = Math.hypot(dx, dy); if (d < rad && d > .01) { const q = (1 - d / rad) * s / d; vx[i] += dx * q; vy[i] += dy * q; } } }

  // --- simulation --------------------------------------------------------------------------------------------------
  function simulate(dt) {
    const red = st.reduced, c = 7.5;
    const K = 32, jitAmp = red ? 0 : pose.jit * .014 * R * st.energy, jitSpeed = action === 'think' ? .2 : .35;
    const eyeL = poseXY(-EYE.x, EYE.y); const ex0 = eyeL[0], ey0 = eyeL[1]; const eyeR = poseXY(EYE.x, EYE.y); const ex1 = eyeR[0], ey1 = eyeR[1];
    const open = Math.max(0, pose.open); const rx = EYE.r * R * ES * pose.sx * (1 + .15 * pose.happy), ry = EYE.r * R * ES * pose.sy * mix(.05, 1, open) * (1 - .55 * pose.happy);
    const ryShift = pose.happy * .06 * R;
    const streamOn = action === 'work' ? 1 : action === 'error' ? 2 : 0;
    const orbitOn = action === 'think' && pose.hook > .5;
    for (let i = 0; i < N; i++) {
      let hx, hy; const r = role[i];
      if (r === 3 && streamOn && !red) {                       // streams: work = down the right side into the work; error = drips off the bottom
        const speed = streamOn === 1 ? .55 : .45, f = (time * speed + ph[i]) % 1;
        if (streamOn === 1) { const a = ph[i] * TAU; hx = footX + (.5 + .4 * f + (ph[i] - .5) * .25 + .1 * Math.sin(a + f * 6)) * R * pose.sx; hy = CY + (-.4 + 1.5 * f) * R; }
        else { hx = footX + (ph[i] - .5) * .7 * R * pose.sx; hy = CY + (.45 + .7 * f) * R; }
        if (f < .04 && (streamOn === 1 ? py[i] > CY + .9 * R : py[i] > CY + 1.0 * R)) { px[i] = hx; py[i] = hy; vx[i] = vy[i] = 0; }
      } else if (r === 4 && orbitOn) {                        // think: a few grains orbit loosely above the hook
        const a = (red ? 0 : time * (.6 + .3 * kk[i])) * TAU * .3 + ph[i] * TAU; const cx = footX + .35 * R * pose.sx, cy = CY - 1.55 * R;
        hx = cx + Math.cos(a) * .32 * R; hy = cy + Math.sin(a) * .13 * R;
      } else { const h = home(i); hx = h[0]; hy = h[1]; }
      if (red) { px[i] = hx; py[i] = hy; vx[i] = vy[i] = 0; }
      else {
        if (jitAmp > 0) { const tt = time * jitSpeed; const a = jitAmp * jw[i]; hx += noise1(ph[i] * 40 + tt, i & 63) * a; hy += noise1(ph[i] * 40 + tt + 17.3, (i >> 6) & 63) * a; }
        let ax = (hx - px[i]) * K * kk[i] - vx[i] * c, ay = (hy - py[i]) * K * kk[i] - vy[i] * c;
        if (pointer) { const dx = px[i] - pointer[0], dy = py[i] - pointer[1], d = Math.hypot(dx, dy); if (d < .5 * R && d > .01) { const q = (1 - d / (.5 * R)) * 220 * R / 96 / d; ax += dx * q; ay += dy * q; } }
        vx[i] += ax * dt; vy[i] += ay * dt;
        px[i] += vx[i] * dt; py[i] += vy[i] * dt;
      }
      if (r === 0 || r === 3 || r === 4) {                      // eye clearings: project grains out of the two discs
        for (let e = 0; e < 2; e++) { const ex = e ? ex1 : ex0, ey = (e ? ey1 : ey0) - ryShift; const dx = (px[i] - ex) / rx, dy = (py[i] - ey) / ry, q = dx * dx + dy * dy; if (q < 1) { const d = Math.sqrt(q) + 1e-4, g = 1 / d; px[i] = ex + dx * g * rx; py[i] = ey + dy * g * ry; vx[i] *= .5; vy[i] *= .5; } }
      }
      if (px[i] < grain) { px[i] = grain; vx[i] *= -.3; } else if (px[i] > W - grain) { px[i] = W - grain; vx[i] *= -.3; }
      if (py[i] < grain) { py[i] = grain; vy[i] *= -.3; } else if (py[i] > H - grain) { py[i] = H - grain; vy[i] *= -.3; }
    }
  }

  // --- draw --------------------------------------------------------------------------------------------------------
  function makeSprite(color) {
    const d = Math.max(2, Math.ceil(grain * dpr)), s = d + 2, c = document.createElement('canvas'); c.width = c.height = s; const g = c.getContext('2d');
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); gr.addColorStop(0, color); gr.addColorStop(.62, color); gr.addColorStop(1, color + '00');
    g.fillStyle = gr; g.fillRect(0, 0, s, s); return c;
  }
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (paper) ink.paper(ctx, W, H, { grain: size === 'hero' ? .04 : 0, seed }); else ctx.clearRect(0, 0, W, H);
    const color = ink.inkColor(st.tint); const key = color + '|' + grain;
    if (key !== spriteKey) { sprite = makeSprite(hexish(color)); spriteKey = key; }
    const s = sprite.width / dpr, h = s / 2;
    ctx.globalAlpha = alpha;
    if (RECT) { ctx.fillStyle = color; const g = grain, hg = g / 2; for (let i = 2 * NP; i < N; i++) ctx.fillRect(px[i] - hg, py[i] - hg, g, g); }
    else for (let i = 2 * NP; i < N; i++) ctx.drawImage(sprite, px[i] - h, py[i] - h, s, s);
    ctx.globalAlpha = Math.min(1, alpha + .35); const ps = s * (size === 'tiny' ? 1.5 : 1.15);
    for (let i = 0; i < 2 * NP; i++) ctx.drawImage(sprite, px[i] - ps / 2, py[i] - ps / 2, ps, ps);
    ctx.globalAlpha = 1;
  }
  // radial gradients need a colour we can append '00' to → normalise any CSS colour to #rrggbb via the canvas
  function hexish(c) { if (/^#[0-9a-f]{6}$/i.test(c)) return c; ctx.fillStyle = c; const v = ctx.fillStyle; if (/^#[0-9a-f]{6}$/i.test(v)) return v; const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(v); return m ? '#' + [m[1], m[2], m[3]].map(n => (+n).toString(16).padStart(2, '0')).join('') : ink.INK; }

  for (let i = 0; i < N; i++) { const h = home(i); px[i] = h[0]; py[i] = h[1]; }
  draw();
  return ctl;
}

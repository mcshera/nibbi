/* Round-5 · 05 — PEBBLE (patience). A matte ink stone that turns instead of bouncing. Three angles — yaw, pitch, roll — eased, never sprung,
 * and every turn ends in a hold. The least motion of the five; the point is that it turns toward you and stays. */
import * as ink from '../../ink.mjs';
import { ACTION_IDS } from '../../actions.mjs';
const { clamp, mix, TAU, FOOT } = ink;

export const meta = {
  id: 'pebble', name: 'Pebble', faculty: 'patience',
  technique: 'a lit matte stone (soft top-left light, contact shadow, no gloss) with a faked three-axis head: yaw slides and foreshortens the eyes, pitch raises or lowers the face, roll tilts the whole stone; angles are rate-limited eases with holds',
  tagline: 'A stone that turns to face you and does not look away until you are done.',
  look: 'A low, wide, smooth ink stone with a faint matte light on its upper left and a soft shadow on the paper; two canonical eyes set into the surface that foreshorten as it turns.',
  motion: 'Turning, not moving. Listen turns toward the person and holds. Think tilts the face up and turns slowly from one side to the other. Work looks down and checks in every six seconds. Success is one considered rise and set-down. Error turns away, then turns back.',
  eyes: 'Canonical whites and pupils; yaw slides them across the face and shrinks the far one, pitch moves them up or down the face, so a turn reads even without a silhouette change.',
  thoughtful: [
    'listen: turns toward the person and holds there for as long as they talk — it does not glance around',
    'think: face up, a slow turn from left to right and back over ten seconds, lids half down: one long consideration, not fidgeting',
    'work: face down on the work, with a look up at the person every six seconds and a return to it',
    'error: turns away toward the failure for a moment, then turns back and faces the person — it does not stay turned away',
    'touch: turns toward your finger and waits; when you let go it turns back to the person, slowly, instead of snapping to rest',
  ],
  risks: ['a lit stone is an object, not ink — the matte light must stay subtle or it is a rock with eyes', 'yaw is faked with eye offsets; large turns can look like the eyes sliding on a flat face', 'the quietest of the five: at 24 px only the eye position carries most states'],
  stills: { idle: 2, hello: .6, listen: 1.6, think: 2.2, work: 1.6, success: .8, error: 1.7, sleep: 2.4, tap: .5 },
};

const PERSON = [-.9, .2], WORK = [.2, .85], RECALL = [-.7, -.85], COMPOSE = [.5, -.7], AHEAD = [0, .1], FAIL = [.75, .8];
const BEAT = .2, ONE = { hello: 1.6, success: 2.3, error: 3.2, tap: 1.6 }, REDUCED_HOLD = 3;

export function mount(host, { R = 96, seed = 1, tint = null, reduced = false, energy = 1, size = 'hero', paper = true } = {}) {
  const W = Math.round(3.4 * R), H = Math.round(3.6 * R), footX = 1.7 * R, footY = 3.1 * R;
  host.style.width = W + 'px'; host.style.height = H + 'px'; host.style.position = 'relative';
  const dpr = Math.min(2, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1));
  const canvas = document.createElement('canvas'); canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.cssText = `display:block;width:${W}px;height:${H}px;touch-action:none`;
  host.appendChild(canvas); const ctx = canvas.getContext('2d');
  const hero = size === 'hero', tiny = size === 'tiny';
  const st = { reduced, energy, tint };
  let action = 'idle', tA = 0, time = 0, rc = 0, pressed = false, pressT = 0, finger = { x: 0, y: -.3 }, afterTouch = 0;
  const head = { yaw: 0, pitch: 0, roll: 0, x: 0, sy: 1, tyaw: 0, tpitch: 0, troll: 0, tx: 0, tsy: 1, rollV: 0 }; let lift = 0, liftV = 0, liftT = 0;
  const gaze = { x: 0, y: .1, tx: 0, ty: .1 }, eye = { blinkT: 1, nextBlink: 3, happy: 0, wide: 1, lid: .08, nextGlance: 6, glance: 0 };
  const outline = stonePoints(R, tiny ? 32 : 64, seed);

  function wants(a, t, tm, e) {
    const w = { yaw: 0, pitch: 0, roll: 0, x: 0, sy: 1, lift: 0, place: AHEAD, lid: .08, happy: 0, wide: 1, rate: 3.2 };
    const breath = Math.sin(tm / 8 * TAU);
    switch (a) {
      case 'idle': w.sy = 1 + .008 * breath; break;
      case 'listen': w.yaw = -.55 * e; w.pitch = -.06; w.roll = -.06 * e; w.x = -.1 * e; w.place = PERSON; w.lid = 0; w.wide = 1.04; break;
      case 'think': { const u = .5 + .5 * Math.sin(tm * TAU / 10); w.yaw = mix(-.28, .28, u) * e; w.pitch = -.5; w.roll = .03; w.place = u < .5 ? RECALL : COMPOSE; w.lid = .42; w.rate = 2.2; break; }
      case 'work': { const ph = tm % 6; const up = ph > 4.6 && ph < 5.6; w.pitch = up ? 0 : .45; w.yaw = up ? -.35 : 0; w.place = up ? PERSON : WORK; w.lid = up ? .1 : .3; w.sy = .97; break; }
      case 'hello': w.place = PERSON; w.lid = 0; w.wide = 1.06; w.yaw = -.3; w.pitch = t > .2 && t < .7 ? .32 : 0; w.rate = 6; break;
      case 'success': w.place = t < 1.3 ? [0, -.3] : PERSON; w.lid = 0; w.happy = t > .35 ? .85 : 0; w.wide = 1.06; w.pitch = -.15; w.lift = t < .2 ? 0 : t < .75 ? .24 * e : 0; break;
      case 'error': if (t < 1.2) { w.yaw = .5; w.pitch = .4; w.roll = .12; w.place = FAIL; w.lid = .35; } else { w.yaw = -.4; w.pitch = 0; w.roll = -.02; w.place = PERSON; w.lid = .2; } w.sy = t < 2.6 ? .95 : 1; break;
      case 'sleep': w.pitch = .38; w.sy = .9 + .008 * breath; w.place = [0, .3]; w.lid = 1; w.rate = 2; break;
      case 'tap': w.place = null; w.lid = 0; w.wide = 1.04; w.yaw = clamp(finger.x * .7, -.6, .6); w.pitch = clamp(finger.y * .8, -.6, .5); w.rate = 8; break;
    }
    return w;
  }
  function snapTo(w) { head.yaw = head.tyaw = w.yaw; head.pitch = head.tpitch = w.pitch; head.roll = head.troll = w.roll; head.x = head.tx = w.x; head.sy = head.tsy = w.sy; head.rollV = 0; lift = liftT = w.lift; liftV = 0; const p = w.place || [clamp(finger.x * 1.2, -1, 1), clamp(finger.y * 1.5, -1, 1)]; gaze.x = gaze.tx = p[0]; gaze.y = gaze.ty = p[1]; eye.lid = w.lid; eye.happy = w.happy; eye.wide = w.wide; eye.blinkT = 1; eye.glance = 0; }
  function relax() { snapTo(wants(action, meta.stills[action], 0, st.energy)); }

  const ctl = {
    cue(a) {
      if (!ACTION_IDS.includes(a)) return;
      action = a; tA = 0; afterTouch = 0;
      if (st.reduced) { relax(); return; }
      const w = wants(a, 0, time, st.energy); if (w.place) { gaze.tx = w.place[0]; gaze.ty = w.place[1]; }
    },
    step(dt) {
      dt = clamp(dt, 0, .1); if (dt <= 0) { draw(); return; }
      tA += dt;
      if (ONE[action] && tA > (st.reduced ? REDUCED_HOLD : ONE[action])) { action = 'idle'; tA = 0; if (st.reduced) relax(); else if (afterTouch > 0) { /* after a touch, come back to the person first */ } }
      if (!st.reduced) {
        time += dt;
        const e = st.energy, w = wants(action, tA, time, e);
        // idle: now and then a slow glance to one side, and back
        if (action === 'idle') { if (time >= eye.nextGlance) { eye.glance = (ink.rand(seed, rc++) < .5 ? -1 : 1) * .18; eye.nextGlance = time + 7 + 5 * ink.rand(seed, rc++); } if (eye.glance !== 0 && time > eye.nextGlance - 5.5) eye.glance = 0; }
        else eye.glance = 0;
        if (afterTouch > 0) { afterTouch -= dt; w.yaw = -.4; w.pitch = 0; w.place = PERSON; w.lid = 0; w.rate = 2.4; }
        if (tA >= BEAT || pressed) {
          head.tyaw = pressed ? clamp(finger.x * .7, -.6, .6) : w.yaw + eye.glance; head.tpitch = pressed ? clamp(finger.y * .8, -.6, .5) : w.pitch; head.troll = w.roll; head.tx = w.x; head.tsy = w.sy; liftT = w.lift;
        }
        const rate = pressed ? 8 : w.rate, k = 1 - Math.exp(-dt * rate);
        head.yaw = mix(head.yaw, head.tyaw, k); head.pitch = mix(head.pitch, head.tpitch, k); head.x = mix(head.x, head.tx, k); head.sy = mix(head.sy, head.tsy, 1 - Math.exp(-dt * 4));
        { const n = Math.max(1, Math.ceil(dt * 120)), h = dt / n; for (let i = 0; i < n; i++) { head.rollV += (90 * (head.troll - head.roll) - 12 * head.rollV) * h; head.roll += head.rollV * h; liftV += (70 * (liftT - lift) - 15 * liftV) * h; lift += liftV * h; } }   // roll is the one axis with a little bounce (a tap rocks it); sub-stepped
        if (w.place) { gaze.tx = w.place[0]; gaze.ty = w.place[1]; }
        if (pressed || action === 'tap') { gaze.tx = clamp(finger.x * 1.2, -1, 1); gaze.ty = clamp(finger.y * 1.5, -1, 1); }
        const kg = 1 - Math.exp(-dt * 12); gaze.x = mix(gaze.x, gaze.tx, kg); gaze.y = mix(gaze.y, gaze.ty, kg);
        const kl = 1 - Math.exp(-dt * 8); eye.lid = mix(eye.lid, w.lid, kl); eye.happy = mix(eye.happy, w.happy, kl); eye.wide = mix(eye.wide, w.wide, kl);
        if (action !== 'sleep' && time >= eye.nextBlink) { eye.blinkT = 0; eye.nextBlink = time + 3.5 + 3 * ink.rand(seed, rc++); }
        eye.blinkT = Math.min(1, eye.blinkT + dt / (action === 'listen' ? .4 : .16));
      }
      draw();
    },
    setReduced(v) { st.reduced = !!v; if (st.reduced) relax(); },
    setEnergy(e) { st.energy = clamp(e, .5, 1.5); }, setTint(c) { st.tint = c; },
    poke(x, y, kind) {
      finger = { x: (x - footX) / R, y: (y - (footY - FOOT * R)) / R };
      if (kind === 'down') { pressed = true; pressT = time; if (st.reduced) relax(); }
      else if (kind === 'up') { const short = pressed && time - pressT < .25; pressed = false; if (short) ctl.poke(x, y, 'tap'); else if (!st.reduced) afterTouch = 1.4; }
      else if (kind === 'tap') { action = 'tap'; tA = 0; if (st.reduced) relax(); else head.rollV += (finger.x < 0 ? -1 : 1) * 1.6 * st.energy; }
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
    const color = ink.inkColor(st.tint), white = '#fbfaf7';
    const cx = footX + head.x * R, base = footY - Math.max(0, lift) * R;
    // contact shadow (soft, to the lower right, away from the light)
    if (!tiny) { ctx.save(); ctx.globalAlpha = .16; ctx.fillStyle = color; if (hero) { ctx.shadowColor = color; ctx.shadowBlur = R * .12; } ctx.beginPath(); ctx.ellipse(cx + R * .08, footY + R * .03, R * (1.0 - .12 * Math.max(0, lift)), R * .12, 0, 0, TAU); ctx.fill(); ctx.restore(); }
    ctx.save();
    ctx.translate(cx, base); ctx.rotate(head.roll); ctx.scale(1 / Math.sqrt(head.sy), head.sy); ctx.translate(0, -FOOT * R * .92);
    ctx.fillStyle = color; ink.tracePath(ctx, outline); ctx.fill();
    // matte light: a soft lighter region on the upper left that slides with the yaw
    if (!tiny) {
      ctx.save(); ink.tracePath(ctx, outline); ctx.clip();
      const lx = -.38 * R - head.yaw * .25 * R, ly = -.42 * R + head.pitch * .2 * R;
      const g = ctx.createRadialGradient(lx, ly, R * .05, lx, ly, R * 1.15);
      const lit = st.tint ? 'rgba(255,255,255,.22)' : 'rgba(255,255,255,.17)';
      g.addColorStop(0, lit); g.addColorStop(.55, 'rgba(255,255,255,.05)'); g.addColorStop(1, 'rgba(0,0,0,.18)');
      ctx.fillStyle = g; ctx.fillRect(-2 * R, -2 * R, 4 * R, 4 * R); ctx.restore();
    }
    // eyes: yaw slides and foreshortens, pitch raises/lowers the face
    const open = 1 - ink.bell(eye.blinkT), sleeping = action === 'sleep' || eye.lid >= .99;
    const yaw = clamp(head.yaw, -.7, .7), pitch = clamp(head.pitch, -.7, .7);
    const geo = [];
    for (let i = 0; i < 2; i++) {
      const e = ink.EYES[i], side = i === 0 ? -1 : 1;
      const ecx = (e.x * Math.cos(yaw) + Math.sin(yaw) * .42) * R, ecy = (e.y + pitch * .28) * R;
      const fore = 1 - .38 * Math.max(0, side * Math.sin(yaw)) * Math.abs(Math.sin(yaw)) * 1.6;
      const rx = e.rx * R * eye.wide * clamp(fore, .55, 1), ry0 = e.ry * R * eye.wide * (1 - .18 * Math.abs(pitch));
      const op = sleeping ? 0 : open, ry = ry0 * Math.max(.06, op) * (1 - .22 * eye.happy);
      ctx.save();
      if (op <= .08) { ctx.strokeStyle = white; ctx.lineWidth = Math.max(1, R * .03); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(ecx - rx * .8, ecy + ry0 * .1); ctx.quadraticCurveTo(ecx, ecy + ry0 * .35, ecx + rx * .8, ecy + ry0 * .1); ctx.stroke(); ctx.restore(); geo.push({ cx: ecx, cy: ecy, rx, ry: ry0 }); continue; }
      ctx.fillStyle = white; ctx.beginPath(); ctx.ellipse(ecx, ecy, rx, ry, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(ecx, ecy, rx, ry, 0, 0, TAU); ctx.clip();
      const gx = clamp(gaze.x - yaw * .6, -1, 1) * rx * .42, gy = clamp(gaze.y - pitch * .5, -1, 1) * ry * .35 + ry * .12;
      const prx = e.prx * R * eye.wide * clamp(fore, .55, 1), pry = Math.min(e.pry * R * eye.wide, ry * .95);
      ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(ecx + gx, ecy + gy, prx, pry, 0, 0, TAU); ctx.fill();
      if (!tiny) { ctx.fillStyle = white; ctx.beginPath(); ctx.arc(ecx + gx + prx * .36, ecy + gy - pry * .38, Math.max(.6, prx * .22), 0, TAU); ctx.fill(); }
      if (eye.happy > .01) { ctx.fillStyle = color; ctx.globalAlpha = eye.happy; ctx.beginPath(); ctx.ellipse(ecx, ecy + ry * 1.25, rx * 1.1, ry * .7, 0, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; }
      const lid = clamp(eye.lid, 0, 1); if (lid > .03 && !(tiny && lid < .3)) { ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(ecx, ecy - ry0 * (2.1 - 1.6 * lid), rx * 1.25, ry0 * 1.05, 0, 0, TAU); ctx.fill(); }
      ctx.restore(); geo.push({ cx: ecx, cy: ecy, rx, ry });
    }
    ctx.restore();
  }
  if (st.reduced) relax();
  draw();
  return ctl;
}

/* A river stone: low and wide, flatter on the bottom, a soft asymmetric crown. */
function stonePoints(R, n, seed) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = i / n, a = t * TAU, cx = Math.cos(a), sy = Math.sin(a);
    let r = 1 + .22 * cx * cx - .12 * ink.smooth(.25, 1, sy) + .03 * Math.max(0, -sy) * (1 - .5 * Math.abs(cx)) + .02 * Math.max(0, -cx) * Math.max(0, -sy);
    r += .01 * ink.ringNoise(t, 4, seed, 2);
    pts.push({ x: Math.cos(a) * r * R * 1.02, y: Math.sin(a) * r * R * .8 });
  }
  return pts;
}

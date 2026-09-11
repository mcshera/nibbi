/* Round-5 · 01 — REGARD (attention). Today's fuzzy ink blot with a real gaze model and weighted upper lids.
 * The rule of this body: eyes first, body second. Every cue moves the eyes at once; the body follows one beat (180 ms) later. */
import * as ink from '../../ink.mjs';
import { ACTION_IDS } from '../../actions.mjs';
const { clamp, mix, TAU, FOOT } = ink;

export const meta = {
  id: 'regard', name: 'Regard', faculty: 'attention',
  technique: 'the fuzzy ink blot with a fixation/saccade gaze model (1–4 s fixations, 40 ms saccades), weighted upper lids, pupils that dilate with interest; the body follows the eyes with a 180 ms beat',
  tagline: 'Nibbi looks before it moves: the eyes land first, hold, and the body follows a beat later.',
  look: 'Today’s dense fuzzy blot. Two big pip eyes with a heavy upper lid that lowers when considering and lifts when interested; pupils that dilate toward the person.',
  motion: 'Named places for the gaze: the person (left), the work (down), recall (up-left), composing (up-right), the finger. Every cue moves the eyes at once and the body 180 ms later with one damped lean. Idle is fixations and blinks, nothing else.',
  eyes: 'Whites and pupils in the canonical layout, plus a drawn upper lid (weight 0..1) and a pupil scale (0.85 narrowed .. 1.2 dilated). The lid is the visual signature: half down is “considering”, up is “interested”.',
  thoughtful: [
    'listen: fixes on the person and holds — no wandering — with one slow blink every four seconds as acknowledgement',
    'think: looks up-left to recall, then up-right to compose, lids half down; the body leans only after the eyes have settled',
    'work: eyes down on the work, lids narrowed; every five seconds a glance up to the person, then back to it',
    'error: looks at the failure first, then looks the person in the eye and stays there while the body sags',
    'touch: looks at your finger before the body reacts; holding it for a second is answered with a slow blink',
  ],
  risks: ['gaze detail vanishes at 24 px; only the lean and the lid carry there', 'a heavy lid can read as sleepy or bored rather than considering', 'nearest to today’s character — the least visually new of the five'],
  stills: { idle: 2, hello: .5, listen: 1.4, think: 1.8, work: 1.6, success: .7, error: 1.6, sleep: 2, tap: .3 },
};

const PERSON = [-.9, .2], WORK = [.2, .85], RECALL = [-.7, -.85], COMPOSE = [.5, -.7], AHEAD = [0, .1], TEXT = [-.6, .4], PILL = [0, .75], FAIL = [.75, .8];
const IDLE_PLACES = [AHEAD, TEXT, PILL, PERSON, AHEAD, TEXT];
const BEAT = .18, ONE = { hello: 1.5, success: 2.0, error: 2.8, tap: .9 }, REDUCED_HOLD = 3;

export function mount(host, { R = 96, seed = 1, tint = null, reduced = false, energy = 1, size = 'hero', paper = true } = {}) {
  const W = Math.round(3.4 * R), H = Math.round(3.6 * R), footX = 1.7 * R, footY = 3.1 * R;
  host.style.width = W + 'px'; host.style.height = H + 'px'; host.style.position = 'relative';
  const dpr = Math.min(2, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1));
  const canvas = document.createElement('canvas'); canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.cssText = `display:block;width:${W}px;height:${H}px;touch-action:none`;
  host.appendChild(canvas); const ctx = canvas.getContext('2d');
  const hero = size === 'hero', tiny = size === 'tiny';
  const st = { reduced, energy, tint };
  let action = 'idle', tA = 0, time = 0, rc = 0, pressed = false, pressT = 0, pressBlinked = false, finger = { x: 0, y: -.3 }, drag = 0;
  const gaze = { x: 0, y: .1, tx: 0, ty: .1, fromX: 0, fromY: .1, sacT: 1, sacDur: .04, nextFix: 1.6, slot: -1, nextJitter: 0 };
  const eye = { lid: .1, dilate: 1, blinkT: 1, blinkDur: .15, nextBlink: 3.2, happy: 0, wide: 1 };
  const sp = v => ({ x: v, v: 0, t: v });
  const S = { x: sp(0), sx: sp(1), sy: sp(1), lean: sp(0), rot: sp(0) };
  let lift = 0;

  function lookAt(p, jitter = 0) {
    const jx = jitter ? (ink.rand(seed, rc++) - .5) * jitter : 0, jy = jitter ? (ink.rand(seed, rc++) - .5) * jitter : 0;
    const tx = clamp(p[0] + jx, -1, 1), ty = clamp(p[1] + jy, -1, 1);
    if (Math.abs(tx - gaze.tx) < .015 && Math.abs(ty - gaze.ty) < .015) return;
    gaze.fromX = gaze.x; gaze.fromY = gaze.y; gaze.tx = tx; gaze.ty = ty; gaze.sacT = 0;
    gaze.sacDur = .03 + .04 * Math.hypot(tx - gaze.fromX, ty - gaze.fromY);
  }
  function blink(dur = .15) { if (eye.blinkT >= 1) { eye.blinkT = 0; eye.blinkDur = dur; } }

  /* Pure description of what this body wants at (action, tA, time): where the eyes go, lid/dilation, and the body pose. */
  function wants(a, t, tm, e) {
    const w = { place: AHEAD, lid: .1, dilate: 1, wide: 1, happy: 0, x: 0, sx: 1, sy: 1, lean: 0, rot: 0, lift: 0, slowBlink: false };
    const breath = Math.sin(tm / 6 * TAU);
    switch (a) {
      case 'idle': w.sy = 1 + .012 * breath; break;
      case 'listen': w.place = PERSON; w.lid = 0; w.dilate = 1.2; w.wide = 1.04; w.x = -.1 * e; w.lean = -.2 * e; w.rot = -.06 * e; w.sy = .99 + .01 * Math.sin(tm * 1.1); w.sx = 1.01; break;
      case 'think': { const ph = t % 5.2; w.place = ph < 2.4 ? RECALL : ph < 4.6 ? COMPOSE : PERSON; w.lid = .45; w.x = .03; w.lean = .14 * e + .015 * Math.sin(tm * .8); w.rot = .05 * e; w.sy = 1.04; w.sx = .98; break; }
      case 'work': { const ph = tm % 5; w.place = ph > 3.7 && ph < 4.5 ? PERSON : WORK; w.lid = .3; w.dilate = .9; w.sy = .94 + .01 * Math.sin(tm * TAU / 2); w.sx = 1.04; w.lean = .04; break; }
      case 'hello': w.place = PERSON; w.lid = 0; w.dilate = 1.15; w.wide = 1.06; w.lean = -.05; w.lift = ink.bell((t - .2) / .5) * .32 * e; w.sy = t < .2 ? 1 : t < .3 ? .9 : t < .6 ? 1.08 : 1; w.sx = t < .3 && t >= .2 ? 1.06 : 1; w.slowBlink = t > .8 && t < .9; break;
      case 'success': w.place = t < 1.1 ? [0, -.3] : PERSON; w.lid = 0; w.dilate = 1.15; w.wide = 1.06; w.happy = t > .3 ? .85 : 0; w.lift = ink.bell((t - .2) / .6) * .55 * e; w.sy = t < .2 ? 1 : t < .27 ? .9 : t < .78 ? 1.12 : t < .95 ? .95 : 1; w.sx = t < .27 && t >= .2 ? 1.08 : t < .78 ? .93 : t < .95 ? 1.04 : 1; w.slowBlink = t > 1.15 && t < 1.25; break;
      case 'error': w.place = t < 1.1 ? FAIL : PERSON; w.lid = t < 1.1 ? .35 : .2; w.dilate = .85; if (t < 2.3) { w.sy = .86; w.sx = 1.1; w.lean = .08; w.rot = .06; w.x = .03; } break;
      case 'sleep': w.place = [0, .3]; w.lid = 1; w.sy = .78 + .012 * breath; w.sx = 1.14; break;
      case 'tap': w.place = null; w.lid = 0; w.dilate = 1.15; if (t >= .12 && t < .3) { w.sy = .82; w.sx = 1.1; } else if (t < .5) { w.sy = 1.06; w.sx = .97; } break;
    }
    return w;
  }
  function still(a) { const t = meta.stills[a], w = wants(a, t, 0, st.energy); w.lift = 0; w.place = w.place || [clamp(finger.x * 1.2, -1, 1), clamp(finger.y * 1.5, -1, 1)]; return w; }
  function snapTo(w) { S.x.x = S.x.t = w.x; S.sx.x = S.sx.t = w.sx; S.sy.x = S.sy.t = w.sy; S.lean.x = S.lean.t = w.lean; S.rot.x = S.rot.t = w.rot; for (const k in S) S[k].v = 0; lift = 0; gaze.x = gaze.tx = w.place[0]; gaze.y = gaze.ty = w.place[1]; gaze.sacT = 1; eye.lid = w.lid; eye.dilate = w.dilate; eye.wide = w.wide; eye.happy = w.happy; eye.blinkT = 1; }
  function relax() { snapTo(still(action)); }

  const ctl = {
    cue(a) {
      if (!ACTION_IDS.includes(a)) return;
      action = a; tA = 0; pressBlinked = false;
      if (st.reduced) { relax(); return; }
      const w = wants(a, 0, time, st.energy);
      if (w.place) lookAt(w.place, a === 'idle' ? .1 : 0); else lookAt([clamp(finger.x * 1.2, -1, 1), clamp(finger.y * 1.5, -1, 1)]);
      if (a === 'idle') gaze.nextFix = time + 1.2 + 2 * ink.rand(seed, rc++);
      if (a === 'listen') eye.nextBlink = time + 2.4;
    },
    step(dt) {
      dt = clamp(dt, 0, .1); if (dt <= 0) { draw(); return; }
      tA += dt;
      if (ONE[action] && tA > (st.reduced ? REDUCED_HOLD : ONE[action])) { action = 'idle'; tA = 0; if (st.reduced) relax(); else { lookAt(IDLE_PLACES[0], .1); gaze.nextFix = time + 1.5; } }
      if (!st.reduced) {
        time += dt;
        const e = st.energy, w = wants(action, tA, time, e);
        // eyes: at once
        if (action === 'idle') { if (time >= gaze.nextFix) { gaze.slot++; lookAt(IDLE_PLACES[gaze.slot % IDLE_PLACES.length], .12); gaze.nextFix = time + 1.5 + 2.5 * ink.rand(seed, rc++); } }
        else if (action === 'listen') { if (time >= gaze.nextJitter) { lookAt(PERSON, .05); gaze.nextJitter = time + .6 + .5 * ink.rand(seed, rc++); } }
        else if (w.place) lookAt(w.place);
        if (pressed) lookAt([clamp(finger.x * 1.2, -1, 1), clamp(finger.y * 1.5, -1, 1)]);
        gaze.sacT = Math.min(1, gaze.sacT + dt / gaze.sacDur); const u = ink.ease.inOut(gaze.sacT); gaze.x = mix(gaze.fromX, gaze.tx, u); gaze.y = mix(gaze.fromY, gaze.ty, u);
        const k = 1 - Math.exp(-dt * 9); eye.lid = mix(eye.lid, w.lid, k); eye.dilate = mix(eye.dilate, w.dilate, k); eye.wide = mix(eye.wide, w.wide, k); eye.happy = mix(eye.happy, w.happy, 1 - Math.exp(-dt * 12));
        // blinks: ordinary on a schedule, slow ones as acknowledgement
        if (action !== 'sleep') { if (time >= eye.nextBlink) { blink(action === 'listen' ? .38 : .15); eye.nextBlink = time + (action === 'listen' ? 4 : 2.8 + 3 * ink.rand(seed, rc++)); } if (w.slowBlink) blink(.4); }
        if (pressed && time - pressT > .9 && !pressBlinked) { blink(.4); pressBlinked = true; }
        eye.blinkT = Math.min(1, eye.blinkT + dt / eye.blinkDur);
        // body: one beat later
        if (tA >= BEAT) { S.x.t = w.x + (pressed ? drag : 0); S.sx.t = pressed ? 1.07 : w.sx; S.sy.t = pressed ? .86 : w.sy; S.lean.t = w.lean + (pressed ? drag * .8 : 0); S.rot.t = w.rot; lift = w.lift; }
        { const n = Math.max(1, Math.ceil(dt * 120)), h = dt / n; for (let i = 0; i < n; i++) for (const key in S) { const s = S[key]; const kk = 140, c = 19; s.v += (kk * (s.t - s.x) - c * s.v) * h; s.x += s.v * h; } }   // sub-stepped: stable when the lab drops to 10 fps
      }
      draw();
    },
    setReduced(v) { st.reduced = !!v; if (st.reduced) relax(); },
    setEnergy(e) { st.energy = clamp(e, .5, 1.5); }, setTint(c) { st.tint = c; },
    poke(x, y, kind) {
      finger = { x: (x - footX) / R, y: (y - (footY - FOOT * R)) / R };
      if (kind === 'down') { pressed = true; pressT = time; pressBlinked = false; drag = 0; if (st.reduced) { relax(); } }
      else if (kind === 'move' && pressed) { drag = clamp(finger.x * .25, -.2, .2); }
      else if (kind === 'up') { const short = pressed && time - pressT < .25 && Math.abs(drag) < .05; pressed = false; drag = 0; if (short) ctl.poke(x, y, 'tap'); else if (!st.reduced) { S.sy.v += 1.6 * st.energy; lookAt(action === 'listen' ? PERSON : wants(action, tA, time, st.energy).place || AHEAD); } }
      else if (kind === 'tap') { action = 'tap'; tA = 0; if (st.reduced) relax(); else lookAt([clamp(finger.x * 1.2, -1, 1), clamp(finger.y * 1.5, -1, 1)]); }
    },
    destroy() { for (const [ev, fn] of listeners) host.removeEventListener(ev, fn); canvas.remove(); },
  };
  const listeners = [
    ['pointerdown', e => ctl.poke(e.offsetX, e.offsetY, 'down')], ['pointermove', e => ctl.poke(e.offsetX, e.offsetY, 'move')],
    ['pointerup', e => ctl.poke(e.offsetX, e.offsetY, 'up')], ['pointerleave', e => { if (pressed) ctl.poke(e.offsetX, e.offsetY, 'up'); }],
  ];
  for (const [ev, fn] of listeners) host.addEventListener(ev, fn);

  function drawEyes(color) {
    const white = '#fbfaf7', open = 1 - ink.bell(eye.blinkT) * (action === 'sleep' || eye.lid >= .99 ? 0 : 1);
    const closed = action === 'sleep' || (st.reduced && eye.lid >= .99);
    for (let i = 0; i < 2; i++) {
      const e = ink.EYES[i], cx = e.x * R, cy = e.y * R, wide = eye.wide, rx = e.rx * R * wide, ry0 = e.ry * R * wide;
      const op = closed ? 0 : open, ry = ry0 * Math.max(.06, op) * (1 - .22 * eye.happy);
      ctx.save();
      if (op <= .08) { ctx.strokeStyle = white; ctx.lineWidth = Math.max(1, R * .03); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(cx - rx * .8, cy + ry0 * .1); ctx.quadraticCurveTo(cx, cy + ry0 * .35, cx + rx * .8, cy + ry0 * .1); ctx.stroke(); ctx.restore(); continue; }
      ctx.fillStyle = white; if (hero) { ctx.shadowColor = white; ctx.shadowBlur = R * .02; } ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU); ctx.clip();
      const gx = clamp(gaze.x, -1, 1) * rx * .42, gy = clamp(gaze.y, -1, 1) * ry * .35 + ry * .12;
      const prx = e.prx * R * wide * eye.dilate, pry = Math.min(e.pry * R * wide * eye.dilate, ry * .95);
      ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(cx + gx, cy + gy, prx, pry, 0, 0, TAU); ctx.fill();
      if (!tiny) { ctx.fillStyle = white; ctx.beginPath(); ctx.arc(cx + gx + prx * .36, cy + gy - pry * .38, Math.max(.6, prx * .22), 0, TAU); ctx.fill(); }
      if (eye.happy > .01) { ctx.fillStyle = color; ctx.globalAlpha = eye.happy; ctx.beginPath(); ctx.ellipse(cx, cy + ry * 1.25, rx * 1.1, ry * .7, 0, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; }
      const lid = clamp(eye.lid, 0, 1); if (lid > .03 && !(tiny && lid < .3)) { ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(cx, cy - ry0 * (2.1 - 1.6 * lid), rx * 1.25, ry0 * 1.05, 0, 0, TAU); ctx.fill(); }
      ctx.restore();
    }
  }
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (paper) ink.paper(ctx, W, H, { grain: 0 }); else ctx.clearRect(0, 0, W, H);
    const color = ink.inkColor(st.tint);
    ctx.save();
    ink.poseTransform(ctx, footX, footY, R, { x: S.x.x, lift: Math.max(0, lift), sx: S.sx.x, sy: S.sy.x, rotate: S.rot.x });
    ctx.translate(0, -FOOT * R);
    const pts = ink.blobPoints(R, { seed, rough: .05, time: st.reduced ? 0 : time, lean: S.lean.x });
    ink.fuzzyFill(ctx, pts, { color, R, soft: hero ? .05 : size === 'pill' ? .03 : 0, tufts: hero ? 22 : size === 'pill' ? 8 : 0, seed });
    drawEyes(color);
    ctx.restore();
  }
  if (st.reduced) relax();
  draw();
  return ctl;
}

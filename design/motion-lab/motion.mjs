/** Experimental Nibbi motion. Pure time samples; no clocks, state, or physics. */
export const STYLES = Object.freeze([
  Object.freeze({
    id: 'elastic', name: 'Elastic', short: 'Soft mochi',
    description: 'A soft crouch, a generous arc, and a small springy settle.',
  }),
  Object.freeze({
    id: 'liquid', name: 'Liquid', short: 'Flowing ink',
    description: 'Slow teardrops and puddle-like squash, with a bead that rejoins.',
  }),
  Object.freeze({
    id: 'mischief', name: 'Mischief', short: 'Scoot + boing',
    description: 'An off-centre scoot, expressive tilts, and star–round–drop changes.',
  }),
]);

export const ACTIONS = Object.freeze([
  { id: 'idle', label: 'Idle' }, { id: 'hop', label: 'Hop' },
  { id: 'morph', label: 'Morph' }, { id: 'hello', label: 'Hello' },
  { id: 'success', label: 'Success' }, { id: 'think', label: 'Think' },
].map(Object.freeze));

const NEUTRAL = Object.freeze({
  x: 0, lift: 0, sx: 1, sy: 1, rotate: 0, lean: 0,
  round: 0, star: 0, drop: 0, satellite: 0, trail: 0, impact: 0,
  eyeX: 0, eyeY: 0, blink: 0, wide: 1, happy: 0, phase: 'rest',
});
const DURATIONS = {
  elastic: { idle: 6.8, hop: 1.8, morph: 2.8, hello: 1.9, success: 2.65, think: 4.2 },
  liquid: { idle: 8.4, hop: 2.65, morph: 3.5, hello: 2.5, success: 3.45, think: 5.2 },
  mischief: { idle: 7.2, hop: 1.85, morph: 2.9, hello: 1.9, success: 2.75, think: 4.1 },
};
// anticipation start, takeoff, end of launch, touchdown, end of landing, rest
const PHASES = {
  elastic: [.02, .23, .34, .66, .78, .94],
  liquid: [.025, .31, .44, .72, .85, .96],
  mischief: [.02, .20, .30, .61, .74, .95],
};
const PHASE_NAMES = ['rest', 'anticipation', 'launch', 'air', 'landing', 'settle'];
const LINEAR = ['x', 'lift', 'rotate', 'lean', 'round', 'star', 'drop', 'satellite',
  'trail', 'impact', 'eyeX', 'eyeY', 'happy'];
const TAU = 2 * Math.PI;
const LOG_SCALE_LIMIT = Math.log(1.5);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const styleId = (id) => typeof id === 'string' && Object.hasOwn(DURATIONS, id) ? id : 'elastic';
const actionId = (id) => typeof id === 'string' && Object.hasOwn(DURATIONS.elastic, id) ? id : 'idle';

export function neutralPose() { return { ...NEUTRAL }; }

/** Seconds; idle repeats. Unknown IDs use elastic / idle. */
export function durationFor(style, action) {
  return DURATIONS[styleId(style)][actionId(action)];
}

// Quintic ramps have zero first and second derivatives at both ends.
function ease(u) {
  u = clamp(u, 0, 1);
  return clamp(u * u * u * (u * (u * 6 - 15) + 10), 0, 1);
}
function pulse(t, start, peak, end) {
  if (t <= start || t >= end) return 0;
  return ease(t < peak ? (t - start) / (peak - start) : (end - t) / (end - peak));
}
function hold(t, start, enter, leave, end) {
  return ease((t - start) / (enter - start)) * ease((end - t) / (end - leave));
}
// Compact, signed oscillation. Its sin² envelope makes both ends C1.
function wobble(t, start, end, cycles = 1) {
  if (t <= start || t >= end) return 0;
  const u = (t - start) / (end - start);
  return Math.sin(TAU * cycles * u) * Math.sin(Math.PI * u) ** 2;
}
// A soft airborne arc has zero vertical velocity at takeoff and touchdown.
function arc(t, start, end, skew = 0) {
  if (t <= start || t >= end) return 0;
  const u = (t - start) / (end - start);
  return Math.sin(Math.PI * (u + skew * u * (1 - u))) ** 2;
}
function draft() { return { ...NEUTRAL, stretch: 0 }; }
function bouncePhase(style, t) {
  const i = PHASES[style].findIndex((edge) => t < edge);
  return i < 0 ? 'rest' : PHASE_NAMES[i];
}
function attenuate(p, gain) {
  for (const key of [...LINEAR, 'stretch', 'blink']) p[key] *= gain;
  p.wide = 1 + (p.wide - 1) * gain;
  return p;
}

function bounce(style, t) {
  const p = draft();
  p.phase = bouncePhase(style, t);
  if (style === 'elastic') {
    const crouch = pulse(t, .02, .165, .28);
    const stretch = pulse(t, .17, .30, .46);
    const air = arc(t, .23, .66);
    const land = pulse(t, .60, .715, .83);
    p.lift = .72 * air;
    p.stretch = -.26 * crouch + .29 * stretch - .25 * land + .06 * wobble(t, .80, .94);
    p.rotate = .028 * wobble(t, .23, .66);
    p.lean = .035 * wobble(t, .23, .65, .5);
    p.round = .20 * crouch + .20 * land + .08 * air;
    p.drop = .22 * stretch;
    p.eyeY = .035 * crouch - .08 * air + .06 * land;
    p.wide = 1 + .13 * air - .12 * (crouch + land);
    p.blink = .72 * pulse(t, .69, .715, .76);
    p.impact = .50 * pulse(t, .66, .70, .80);
    p.happy = .12 * air;
  } else if (style === 'liquid') {
    const crouch = pulse(t, .025, .21, .39);
    const stretch = pulse(t, .27, .44, .65);
    const air = arc(t, .31, .72, .17);
    const land = pulse(t, .67, .785, .90);
    p.lift = .46 * air;
    p.stretch = -.38 * crouch + .34 * stretch - .39 * land + .075 * wobble(t, .86, .96);
    p.x = .055 * wobble(t, .31, .76, .5);
    p.rotate = .05 * wobble(t, .25, .88);
    p.lean = .13 * wobble(t, .20, .82);
    p.round = .18 * crouch + .28 * land;
    p.drop = .60 * pulse(t, .24, .47, .74);
    p.satellite = .62 * pulse(t, .37, .56, .77);
    p.trail = .23 * air;
    p.eyeX = .022 * wobble(t, .23, .85);
    p.eyeY = -.065 * air + .07 * land;
    p.wide = 1 - .11 * crouch + .11 * air - .10 * land;
    p.blink = .55 * pulse(t, .755, .785, .83);
    p.impact = .45 * pulse(t, .72, .775, .88);
  } else {
    const crouch = pulse(t, .02, .13, .24);
    const stretch = pulse(t, .16, .27, .43);
    const air = arc(t, .20, .61, .42);
    const land = pulse(t, .57, .66, .78);
    p.lift = .62 * air;
    p.stretch = -.18 * crouch + .21 * stretch - .23 * land + .105 * wobble(t, .74, .94, 1.5);
    p.x = -.09 * pulse(t, .035, .15, .24) + .21 * pulse(t, .17, .45, .76)
      - .06 * pulse(t, .68, .80, .93);
    p.rotate = -.14 * pulse(t, .04, .15, .27) + .26 * wobble(t, .19, .78, .5)
      - .08 * pulse(t, .74, .82, .94);
    p.lean = -.11 * crouch + .13 * air - .06 * land;
    p.star = .54 * pulse(t, .26, .35, .49);
    p.round = .45 * pulse(t, .41, .52, .64) + .12 * land;
    p.drop = .47 * pulse(t, .54, .62, .79);
    p.eyeX = .055 * pulse(t, .17, .44, .78);
    p.eyeY = -.05 * air + .035 * land;
    p.wide = 1 + .20 * air - .09 * land;
    p.blink = .70 * pulse(t, .64, .67, .715);
    p.impact = .53 * pulse(t, .61, .66, .78);
    p.happy = .17 * air;
  }
  return p;
}

function hello(style, t) {
  const p = attenuate(bounce(style, t), .30);
  const greeting = hold(t, .05, .23, .72, .94);
  const wag = wobble(t, .20, .78, style === 'liquid' ? 1 : style === 'mischief' ? 2 : 1.5);
  p.rotate += (style === 'liquid' ? .07 : style === 'mischief' ? .18 : .11) * wag;
  p.lean += .075 * wag;
  p.eyeX += .045 * wag;
  p.wide += .10 * greeting;
  p.happy = .56 * greeting;
  if (style === 'liquid') {
    p.drop += .18 * pulse(t, .22, .44, .72);
    p.satellite += .22 * pulse(t, .32, .53, .78);
  } else if (style === 'mischief') {
    p.star += .22 * pulse(t, .40, .50, .63);
  }
  return p;
}

function success(style, t) {
  // Two separate arcs: a small yes, then a larger celebration.
  const p = t < .43
    ? attenuate(bounce(style, t / .43), .64)
    : attenuate(bounce(style, (t - .43) / .52), .98);
  const joy = hold(t, .035, .20, .80, .96);
  p.happy = .62 * joy;
  p.wide += .045 * joy;
  if (style === 'elastic') p.star = .50 * pulse(t, .55, .655, .79);
  if (p.phase === 'rest' && joy > 0) p.phase = 'settle';
  return p;
}

function morph(style, t) {
  const p = draft();
  p.phase = t < .025 ? 'rest' : t < .18 ? 'anticipation' : t < .79 ? 'morph' : 'settle';
  if (style === 'elastic') {
    const round = pulse(t, .10, .28, .49);
    const star = pulse(t, .34, .53, .72);
    const drop = pulse(t, .61, .76, .91);
    p.round = .62 * round;
    p.star = .55 * star;
    p.drop = .48 * drop;
    p.stretch = -.10 * pulse(t, .025, .12, .23) - .16 * round + .12 * star
      + .16 * drop + .035 * wobble(t, .85, .96);
    p.rotate = .06 * wobble(t, .20, .85);
    p.lean = .08 * wobble(t, .20, .85);
  } else if (style === 'liquid') {
    const drop = hold(t, .16, .33, .54, .77);
    const puddle = pulse(t, .50, .71, .90);
    p.drop = .64 * drop;
    p.round = .48 * puddle;
    p.satellite = .62 * pulse(t, .33, .54, .82);
    p.trail = .15 * drop;
    p.stretch = -.10 * pulse(t, .025, .12, .25) + .31 * drop - .38 * puddle;
    p.lean = .20 * wobble(t, .11, .91);
    p.x = .04 * wobble(t, .11, .91);
    p.rotate = .05 * wobble(t, .11, .91);
  } else {
    const star = pulse(t, .13, .27, .45);
    const round = pulse(t, .35, .51, .68);
    const drop = pulse(t, .58, .74, .91);
    p.star = .63 * star;
    p.round = .60 * round;
    p.drop = .61 * drop;
    p.stretch = -.08 * pulse(t, .025, .10, .20) - .11 * star + .09 * round + .18 * drop;
    p.rotate = -.16 * pulse(t, .09, .22, .41) + .22 * pulse(t, .39, .56, .75)
      - .12 * pulse(t, .67, .79, .94);
    p.x = -.05 * star + .07 * round;
    p.lean = -.13 * star + .16 * round - .08 * drop;
  }
  p.eyeX = .25 * p.lean;
  p.eyeY = -.025 * p.drop;
  p.wide = 1 + .08 * p.star - .06 * p.round;
  p.blink = .55 * pulse(t, .84, .87, .90);
  p.happy = .12 * hold(t, .08, .25, .75, .95);
  return p;
}

function think(style, t) {
  const p = draft();
  const focus = hold(t, .025, .20, .75, .96);
  const glance = -.065 * pulse(t, .08, .28, .53) + .07 * pulse(t, .44, .66, .87);
  p.phase = t < .025 ? 'rest' : t < .16 ? 'anticipation' : t < .79 ? 'think' : 'settle';
  p.eyeX = glance;
  p.eyeY = -.09 * focus;
  p.wide = 1 + .12 * focus;
  p.blink = .72 * pulse(t, .42, .446, .48);
  if (style === 'elastic') {
    p.stretch = -.05 * focus + .012 * wobble(t, .18, .78);
    p.rotate = -.055 * focus;
    p.lean = -.045 * focus;
    p.round = .13 * focus;
  } else if (style === 'liquid') {
    p.stretch = -.10 * focus + .04 * pulse(t, .28, .51, .77);
    p.lean = .10 * wobble(t, .12, .91);
    p.rotate = .04 * wobble(t, .12, .91);
    p.drop = .17 * focus;
    p.satellite = .30 * pulse(t, .28, .51, .77);
  } else {
    const left = pulse(t, .025, .25, .54);
    const right = pulse(t, .42, .69, .96);
    p.rotate = .13 * left - .11 * right;
    p.lean = .10 * left - .085 * right;
    p.x = .02 * wobble(t, .12, .91);
    p.stretch = -.035 * focus;
    p.star = .17 * left;
    p.drop = .14 * right;
    p.eyeX = -glance;
    p.wide += .05 * focus;
  }
  return p;
}

function idle(style, t) {
  const p = draft();
  const breath = Math.sin(TAU * t);
  p.phase = 'idle';
  p.stretch = (style === 'liquid' ? .020 : .012) * breath;
  p.rotate = (style === 'mischief' ? .014 : .007) * breath;
  p.lean = (style === 'liquid' ? .019 : .008) * breath;
  p.eyeX = .006 * breath;
  p.eyeY = .004 * breath;
  p.wide = 1 + .010 * breath;
  p.blink = pulse(t, .61, .624, .648);
  if (style === 'liquid') p.drop = .025 * (1 - Math.cos(TAU * t)) / 2;
  if (style === 'mischief') p.x = .004 * Math.sin(2 * TAU * t);
  return p;
}

/** Analytic poses are independent of sample order and display refresh rate.
 * Intensity clamps to 0..1.5. Bad times rest; reduced motion is fully static.
 * Scale is limited smoothly in log space: sx * sy = 1, each within 2/3..1.5.
 */
export function sampleMotion(style, action, seconds, { intensity = 1, reduced = false } = {}) {
  const gain = typeof intensity === 'number' && !Number.isNaN(intensity) ? clamp(intensity, 0, 1.5) : 1;
  if (reduced || gain === 0 || !Number.isFinite(seconds) || seconds < 0) return neutralPose();
  style = styleId(style);
  action = actionId(action);
  const duration = durationFor(style, action);
  // Compare seconds directly so the exact 96% endpoint survives float division.
  if (action !== 'idle' && (seconds === 0 || seconds >= duration * .96)) return neutralPose();
  const t = action === 'idle' ? (seconds % duration) / duration : seconds / duration;
  // The neutral tail provides a clean handoff to idle or another app action.
  const raw = action === 'idle' ? idle(style, t)
    : action === 'hop' ? bounce(style, t)
      : action === 'hello' ? hello(style, t)
        : action === 'success' ? success(style, t)
          : action === 'morph' ? morph(style, t) : think(style, t);
  const p = neutralPose();
  for (const key of LINEAR) p[key] = raw[key] === 0 ? 0 : raw[key] * gain;
  p.sy = Math.exp(LOG_SCALE_LIMIT * Math.tanh(raw.stretch * gain / LOG_SCALE_LIMIT));
  p.sx = 1 / p.sy;
  // Blink depth saturates by intensity, not by time: no clipping cusp.
  p.blink = raw.blink * Math.min(gain, 1);
  // Widen smoothly below 1.14 so the eye whites stay separate. Keep squints.
  const eyeDelta = (raw.wide - 1) * gain;
  p.wide = 1 + (eyeDelta > 0 ? .14 * Math.tanh(eyeDelta / .14) : eyeDelta);
  p.phase = raw.phase;
  return p;
}

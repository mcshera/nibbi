/* Pocket spring: pure analytic poses and a small simulation-clock director.
 * Classic script; no DOM, timers, randomness, or renderer dependencies.
 */
(function (root) {
  'use strict';
  const BASE = Object.freeze({
    x: 0, lift: 0, sx: 1, sy: 1, rotate: 0, lean: 0, round: 0, star: 0,
    drop: 0, satellite: 0, trail: 0, impact: 0, eyeX: 0, eyeY: 0,
    blink: 0, wide: 1, happy: 0, phase: 'rest',
  });
  const catalog = Object.freeze([
    ['hello', 'Hello', 'Greetings', 1.7, 'A small spring and a friendly crown wave.'],
    ['nod', 'Nod', 'Greetings', 1.25, 'Two soft, planted nods of agreement.'],
    ['bow', 'Bow', 'Greetings', 1.9, 'A slow low bow, a pause, and a polite recovery.'],
    ['peek', 'Peek', 'Greetings', 2.0, 'Lean out, look sideways, then tuck back in.'],
    ['hop', 'Hop', 'Bounces', 1.8, 'Mochi anticipation, a full arc, and a soft landing.'],
    ['boing', 'Boing', 'Bounces', 2.15, 'A long spring stretch and a rippling recovery.'],
    ['double-hop', 'Double hop', 'Bounces', 2.65, 'A small yes followed by a bigger yes.'],
    ['triple-hop', 'Triple hop', 'Bounces', 3.15, 'Three rising springs with clear planted landings.'],
    ['squish', 'Squish', 'Shape tricks', 1.65, 'A quick soft squeeze and a tiny rebound.'],
    ['stretch', 'Stretch', 'Shape tricks', 1.95, 'Reach tall, hold, then fold gently back.'],
    ['puff', 'Puff', 'Shape tricks', 2.0, 'Round out like a proud little mochi.'],
    ['star', 'Star', 'Shape tricks', 2.3, 'Bloom into a soft ink star and fold back in.'],
    ['drop', 'Drop', 'Shape tricks', 2.1, 'Pull into a springy droplet, without shedding ink.'],
    ['pancake', 'Pancake', 'Shape tricks', 2.15, 'A deep wide flatten, a long pause, and a peel-up.'],
    ['wiggle', 'Wiggle', 'Delight', 1.75, 'Three planted crown sways.'],
    ['giggle', 'Giggle', 'Delight', 2.0, 'Three tiny happy bobs and smiling pip eyes.'],
    ['ta-da', 'Ta-da', 'Delight', 2.25, 'A presenting spring that opens into a soft star.'],
    ['proud', 'Proud', 'Delight', 2.4, 'Stand a little taller and hold a pleased pose.'],
    ['curious', 'Curious', 'Attention', 2.6, 'Questioning tilts in two directions.'],
    ['think', 'Think', 'Attention', 3.8, 'A thoughtful lean and a deliberate two-part gaze.'],
    ['listen', 'Listen', 'Attention', 2.8, 'Lean closer, focus, and softly acknowledge.'],
    ['yawn', 'Yawn', 'Rest / reaction', 3.2, 'A sleepy stretch, heavy lids, and a soft sigh.'],
    ['wake', 'Wake', 'Rest / reaction', 2.0, 'Uncurl, spring awake, and find the ground.'],
    ['oops', 'Oops', 'Rest / reaction', 1.25, 'A restrained recoil and a sheepish recovery.'],
  ].map(([id, label, group, duration, description]) => Object.freeze({ id, label, group, duration, description })));
  const byId = new Map(catalog.map((item) => [item.id, item]));
  const MOODS = new Set(['idle', 'listening', 'thinking', 'working', 'speaking', 'happy', 'error', 'sleep']);
  const TAU = Math.PI * 2;
  const LOG_LIMIT = Math.log(1.5);
  const FIELDS = ['x', 'lift', 'stretch', 'rotate', 'lean', 'round', 'star', 'drop',
    'impact', 'eyeX', 'eyeY', 'blink', 'wide', 'happy'];
  const ZERO = { ...BASE, stretch: 0 };
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const finite = (n, fallback = 0) => typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  const energyOf = (n = 1) => typeof n === 'number' && !Number.isNaN(n) ? clamp(n, 0, 1.5) : 1;
  const neutral = () => ({ ...BASE });
  const draft = () => ({ ...ZERO });
  function ease(u) {
    u = clamp(u, 0, 1);
    return clamp(u * u * u * (u * (u * 6 - 15) + 10), 0, 1);
  }
  function pulse(t, a, b, c) {
    return t <= a || t >= c ? 0 : ease(t < b ? (t - a) / (b - a) : (c - t) / (c - b));
  }
  function hold(t, a, b, c, d) { return ease((t - a) / (b - a)) * ease((d - t) / (d - c)); }
  function wobble(t, a, b, cycles = 1) {
    if (t <= a || t >= b) return 0;
    const u = (t - a) / (b - a);
    return Math.sin(TAU * cycles * u) * Math.sin(Math.PI * u) ** 2;
  }
  function arc(t, a, b, skew = 0) {
    if (t <= a || t >= b) return 0;
    const u = (t - a) / (b - a);
    return Math.sin(Math.PI * (u + skew * u * (1 - u))) ** 2;
  }
  function scaleRaw(p, gain) {
    for (const key of FIELDS) p[key] = key === 'wide' ? 1 + (p[key] - 1) * gain : p[key] * gain;
    return p;
  }
  function applyOptions(p, options) {
    const gain = energyOf(options.energy);
    scaleRaw(p, gain);
    p.blink = gain > 1 ? p.blink / gain : p.blink;
    if (options.compact) {
      p.x *= .35; p.lift *= .42; p.stretch *= .58;
      p.rotate *= .45; p.lean *= .50; p.impact *= .4;
      p.round *= .55; p.star *= .55; p.drop *= .55;
    }
    return p;
  }
  // One final constraint map, also used after blends. No area drift in transitions.
  function finish(raw) {
    const p = neutral();
    p.x = .3 * Math.tanh(raw.x / .3);
    p.lift = clamp(raw.lift, 0, 1.1);
    p.sy = Math.exp(LOG_LIMIT * Math.tanh(raw.stretch / LOG_LIMIT));
    p.sx = 1 / p.sy;
    p.rotate = .35 * Math.tanh(raw.rotate / .35);
    p.lean = .35 * Math.tanh(raw.lean / .35);
    for (const key of ['round', 'star', 'drop', 'impact', 'blink', 'happy']) p[key] = clamp(raw[key], 0, 1);
    p.eyeX = .2 * Math.tanh(raw.eyeX / .2);
    p.eyeY = .2 * Math.tanh(raw.eyeY / .2);
    const delta = raw.wide - 1;
    p.wide = 1 + (delta > 0 ? .14 * Math.tanh(delta / .14) : .45 * Math.tanh(delta / .45));
    p.phase = raw.phase;
    for (const key of Object.keys(BASE)) if (p[key] === 0) p[key] = 0;
    return p;
  }
  function spring(t, height = .72, boing = false) {
    const p = draft();
    const crouch = pulse(t, .02, .165, .28);
    const launch = pulse(t, .17, boing ? .36 : .30, boing ? .57 : .46);
    const air = arc(t, .23, .66, boing ? -.18 : 0);
    const land = pulse(t, .60, .715, .83);
    p.phase = t < .02 ? 'rest' : t < .23 ? 'anticipation' : t < .34 ? 'launch'
      : t < .66 ? 'air' : t < .78 ? 'landing' : t < .95 ? 'settle' : 'rest';
    p.lift = height * air;
    p.stretch = -(boing ? .31 : .26) * crouch + (boing ? .48 : .29) * launch
      - .25 * land + (boing ? .16 : .06) * wobble(t, .79, .95, boing ? 2 : 1);
    p.round = .20 * crouch + .20 * land + .07 * air;
    p.drop = (boing ? .32 : .16) * launch;
    p.lean = .025 * wobble(t, .23, .65, .5);
    p.rotate = .02 * wobble(t, .23, .66);
    p.eyeY = .035 * crouch - .07 * air + .05 * land;
    p.wide = 1 + .13 * air - .10 * (crouch + land);
    p.blink = .65 * pulse(t, .69, .715, .76);
    p.impact = .48 * pulse(t, .66, .70, .81);
    return p;
  }
  function sequence(t, spans, heights) {
    let start = 0;
    for (let i = 0; i < spans.length; i++) {
      const end = start + spans[i];
      if (t < end) return spring((t - start) / spans[i], heights[i]);
      start = end;
    }
    return draft();
  }
  function actionRaw(id, seconds) {
    const item = byId.get(id);
    if (!item || !Number.isFinite(seconds) || seconds <= 0 || seconds >= item.duration * .96) return draft();
    const t = seconds / item.duration;
    let p = draft();
    const active = hold(t, .025, .20, .74, .96);
    p.phase = t < .025 ? 'rest' : t < .18 ? 'anticipation' : t < .78 ? id : 'settle';
    switch (id) {
      case 'hop': return spring(t);
      case 'boing': return spring(t, .72, true);
      case 'double-hop':
        p = sequence(t, [.43, .52], [.48, .72]);
        p.happy = .43 * active;
        return p;
      case 'triple-hop':
        p = sequence(t, [.29, .31, .35], [.38, .52, .67]);
        p.happy = .48 * active;
        return p;
      case 'hello': {
        p = scaleRaw(spring(t), .28);
        const wave = wobble(t, .20, .79, 1.5);
        p.rotate += .11 * wave; p.lean += .07 * wave; p.eyeX += .035 * wave;
        p.happy = .55 * active; p.wide += .07 * active;
        return p;
      }
      case 'nod': {
        const a = pulse(t, .04, .25, .47), b = pulse(t, .40, .62, .88);
        p.stretch = -.13 * a - .085 * b; p.lean = .07 * a + .045 * b;
        p.eyeY = .045 * a + .03 * b; p.round = .12 * a + .08 * b;
        p.blink = .32 * a; p.happy = .22 * active;
        break;
      }
      case 'bow': {
        const bow = hold(t, .04, .29, .53, .91);
        p.stretch = -.23 * bow; p.rotate = .10 * bow; p.lean = .18 * bow;
        p.round = .16 * bow; p.eyeY = .075 * bow; p.wide = 1 - .11 * bow;
        p.blink = .45 * bow; p.happy = .20 * active;
        break;
      }
      case 'peek': {
        const peek = hold(t, .08, .31, .58, .91);
        p.x = .10 * peek; p.rotate = -.12 * peek; p.lean = -.13 * peek;
        p.stretch = -.035 * peek; p.eyeX = .10 * peek; p.eyeY = -.025 * peek;
        p.wide = 1 + .10 * peek; p.blink = .5 * pulse(t, .62, .65, .70);
        break;
      }
      case 'squish': {
        const squeeze = pulse(t, .025, .30, .62);
        p.stretch = -.43 * squeeze + .14 * pulse(t, .51, .69, .89);
        p.round = .28 * squeeze; p.eyeY = .05 * squeeze; p.wide = 1 - .10 * squeeze;
        p.lean = .025 * wobble(t, .64, .95); p.blink = .35 * squeeze;
        break;
      }
      case 'stretch': {
        const reach = hold(t, .04, .31, .57, .90);
        p.stretch = .50 * reach - .07 * pulse(t, .73, .83, .95);
        p.drop = .19 * reach; p.eyeY = -.065 * reach; p.wide = 1 + .07 * reach;
        break;
      }
      case 'puff': {
        const puff = hold(t, .04, .28, .59, .92);
        p.round = .64 * puff; p.stretch = -.08 * puff + .04 * wobble(t, .65, .95);
        p.eyeY = -.025 * puff; p.wide = 1 + .10 * puff; p.happy = .32 * puff;
        break;
      }
      case 'star': {
        const bloom = hold(t, .10, .36, .58, .91);
        p.star = .64 * bloom; p.stretch = -.09 * pulse(t, .025, .15, .30) + .12 * bloom;
        p.rotate = .085 * wobble(t, .24, .87); p.happy = .45 * bloom; p.wide = 1 + .11 * bloom;
        break;
      }
      case 'drop': {
        const pull = hold(t, .08, .34, .58, .90);
        p.drop = .63 * pull; p.stretch = .23 * pull - .10 * pulse(t, .73, .84, .95);
        p.lean = .035 * pull; p.eyeY = -.04 * pull; p.round = .12 * pulse(t, .76, .85, .95);
        break;
      }
      case 'pancake': {
        const flat = hold(t, .03, .24, .62, .92);
        p.stretch = -.65 * flat + .11 * pulse(t, .80, .89, .96);
        p.round = .30 * flat; p.eyeY = .065 * flat; p.wide = 1 - .13 * flat;
        p.blink = .35 * pulse(t, .28, .34, .43);
        break;
      }
      case 'wiggle': {
        const wag = wobble(t, .07, .92, 3);
        p.rotate = .17 * wag; p.lean = .15 * wag; p.x = .012 * wag;
        p.stretch = -.045 * active + .035 * wobble(t, .07, .92, 6);
        p.eyeX = -.025 * wag; p.happy = .44 * active; p.round = .10 * active;
        break;
      }
      case 'giggle': {
        for (const start of [.12, .35, .58]) {
          const bob = arc(t, start, start + .19);
          p.lift += .055 * bob; p.stretch += -.085 * pulse(t, start - .03, start + .02, start + .09) + .065 * bob;
          p.blink += .42 * pulse(t, start, start + .07, start + .18);
        }
        p.happy = .62 * active; p.round = .22 * active; p.rotate = .05 * wobble(t, .10, .90, 2);
        break;
      }
      case 'ta-da': {
        p = scaleRaw(spring(t), .65);
        const present = hold(t, .30, .47, .60, .87);
        p.star = .58 * present; p.happy = .64 * active; p.wide += .07 * present;
        p.lean += .03 * present;
        return p;
      }
      case 'proud': {
        const pride = hold(t, .04, .30, .69, .94);
        p.stretch = .11 * pride; p.round = .28 * pride; p.eyeY = -.04 * pride;
        p.rotate = -.035 * pride; p.lean = -.03 * pride; p.happy = .58 * pride; p.wide = 1 + .08 * pride;
        break;
      }
      case 'curious': {
        const left = pulse(t, .04, .27, .53), right = pulse(t, .43, .69, .94);
        p.rotate = -.12 * left + .085 * right; p.lean = -.07 * left + .05 * right;
        p.eyeX = -.06 * left + .07 * right; p.eyeY = -.065 * active;
        p.stretch = -.025 * active; p.wide = 1 + .14 * active;
        break;
      }
      case 'think': {
        p.stretch = -.05 * active + .012 * wobble(t, .18, .78);
        p.rotate = -.05 * active; p.lean = -.04 * active; p.round = .12 * active;
        p.eyeX = -.065 * pulse(t, .08, .28, .53) + .07 * pulse(t, .44, .66, .87);
        p.eyeY = -.09 * active; p.wide = 1 + .10 * active;
        p.blink = .70 * pulse(t, .42, .446, .48);
        break;
      }
      case 'listen': {
        const focus = hold(t, .04, .23, .67, .94);
        p.lean = .10 * focus; p.rotate = -.045 * focus; p.stretch = -.04 * focus;
        p.eyeX = .055 * focus; p.eyeY = -.03 * focus; p.wide = 1 + .12 * focus;
        p.blink = .25 * pulse(t, .72, .77, .86); p.round = .08 * focus;
        break;
      }
      case 'yawn': {
        const yawn = hold(t, .08, .33, .54, .78);
        const sigh = pulse(t, .64, .80, .95);
        p.stretch = .32 * yawn - .15 * sigh; p.round = .15 * sigh;
        p.eyeY = .035 * yawn; p.blink = .88 * yawn; p.wide = 1 - .16 * yawn;
        p.lean = -.035 * yawn; p.happy = .08 * sigh;
        break;
      }
      case 'wake': {
        const curl = pulse(t, .025, .18, .35);
        const awake = arc(t, .31, .68);
        const land = pulse(t, .63, .74, .89);
        p.lift = .32 * awake; p.stretch = -.22 * curl + .34 * pulse(t, .23, .39, .61) - .18 * land;
        p.blink = .73 * curl; p.round = .18 * curl + .12 * land;
        p.wide = 1 - .13 * curl + .17 * awake; p.happy = .25 * awake;
        p.eyeY = -.06 * awake; p.impact = .25 * pulse(t, .68, .74, .87);
        p.phase = t < .025 ? 'rest' : t < .31 ? 'anticipation' : t < .42 ? 'launch'
          : t < .68 ? 'air' : t < .81 ? 'landing' : 'settle';
        break;
      }
      case 'oops': {
        const recoil = pulse(t, .025, .20, .52);
        const recover = pulse(t, .37, .59, .90);
        p.x = -.035 * recoil; p.rotate = -.095 * recoil + .03 * recover;
        p.lean = -.075 * recoil; p.stretch = -.14 * recoil + .04 * recover;
        p.eyeY = -.035 * recoil + .025 * recover; p.wide = 1 + .09 * recoil - .045 * recover;
        p.blink = .55 * pulse(t, .43, .49, .59); p.round = .14 * recoil;
        break;
      }
    }
    return p;
  }
  function staticPose(cue) {
    const p = neutral();
    if (['hello', 'nod', 'puff', 'giggle', 'ta-da', 'proud', 'happy'].includes(cue)) p.happy = .18;
    if (['think', 'listen', 'curious', 'thinking', 'listening', 'working'].includes(cue)) p.wide = 1.035;
    if (cue === 'sleep' || cue === 'yawn') p.wide = .93;
    if (cue === 'error' || cue === 'oops') p.wide = 1.025;
    return p;
  }
  function sample(id, seconds, options = {}) {
    options = options || {};
    if (!byId.has(id) || energyOf(options.energy) === 0) return neutral();
    if (options.reduced) return staticPose(id);
    return finish(applyOptions(actionRaw(id, seconds), options));
  }
  function ambientRaw(mood, seconds, speech = 0) {
    const p = draft();
    const secondsSafe = Math.max(0, finite(seconds));
    const t = (secondsSafe % 7.2) / 7.2;
    const breath = Math.sin(TAU * t);
    p.stretch = .008 * breath; p.eyeX = .003 * breath; p.eyeY = .002 * breath;
    p.blink = pulse(t, .61, .624, .648);
    p.phase = mood === 'idle' ? 'rest' : mood;
    switch (mood) {
      case 'listening':
        p.lean = .018 + .008 * breath; p.eyeX += .024; p.eyeY -= .022;
        p.wide += .035; p.stretch -= .008;
        break;
      case 'thinking':
        p.eyeX = .027 * Math.sin(TAU * ((secondsSafe % 5.8) / 5.8)); p.eyeY = -.038;
        p.rotate = -.009 + .006 * breath; p.wide += .04;
        break;
      case 'working': {
        const work = Math.sin(TAU * ((secondsSafe % 2.4) / 2.4));
        p.stretch = .014 * work; p.lean = .008 * work; p.eyeY = .008 * work;
        p.round = .010 * (1 - Math.cos(TAU * t)) / 2;
        break;
      }
      case 'speaking': {
        const voice = clamp(finite(speech), 0, 1);
        const syllable = Math.sin(TAU * ((secondsSafe % .83) / .83));
        p.stretch += voice * (-.020 + .012 * syllable); p.lean = .009 * voice * syllable;
        p.wide += .035 * voice; p.round = .012 * voice; p.happy = .08 * voice;
        break;
      }
      case 'sleep':
        p.stretch = -.036 + .009 * breath; p.eyeX = 0; p.eyeY = .025;
        p.wide = .94; p.blink = .82; p.lean = -.008;
        break;
      case 'happy': p.happy = .20; p.wide += .045; break;
      case 'error': p.stretch -= .015; p.eyeY = .018; p.wide += .02; break;
    }
    return p;
  }
  function ambient(mood, seconds, options = {}) {
    options = options || {};
    mood = MOODS.has(mood) ? mood : 'idle';
    if (energyOf(options.energy) === 0) return neutral();
    if (options.reduced) return staticPose(mood);
    return finish(applyOptions(ambientRaw(mood, seconds, options.speech), options));
  }

  // All blends occur before the log-scale / eye-gap constraint map.
  function blend(a, b, amount) {
    const p = draft();
    for (const key of FIELDS) p[key] = a[key] + (b[key] - a[key]) * amount;
    p.phase = amount < .5 ? a.phase : b.phase;
    return p;
  }
  function compose(a, b) {
    const p = draft();
    for (const key of FIELDS) p[key] = a[key] + b[key] - ZERO[key];
    p.blink = 1 - (1 - a.blink) * (1 - b.blink);
    p.happy = 1 - (1 - a.happy) * (1 - b.happy);
    p.phase = a.phase === 'rest' ? b.phase : a.phase;
    return p;
  }
  const CONTROL_LIMITS = {
    x: [-.6, .6], lift: [0, 1.1], stretch: [-1.2, 1.2], rotate: [-.7, .7], lean: [-.7, .7],
    round: [0, .98], star: [0, .98], drop: [0, .98], impact: [0, .98],
    eyeX: [-.3, .3], eyeY: [-.3, .3], blink: [0, 1], wide: [.6, 1.8], happy: [0, .98],
  };
  function transitionFrom(read, duration = .28) {
    const a = read(0), before = read(-1e-4), after = read(1e-4), control = draft();
    for (const key of FIELDS) {
      const velocity = (after[key] - before[key]) / 2e-4;
      // Bounded Bezier controls keep repeated interruption safe. Tangents are
      // preserved except when they would leave the legal control hull.
      control[key] = clamp(a[key] + velocity * duration / 3, ...CONTROL_LIMITS[key]);
    }
    return { a, control, elapsed: 0, duration };
  }
  function transitionPose(transition, target, offset) {
    if (!transition) return target;
    const u = clamp((transition.elapsed + offset) / transition.duration, 0, 1);
    const coast = draft(), v = 1 - u;
    for (const key of FIELDS) {
      coast[key] = v ** 3 * transition.a[key] + 3 * v * v * u * transition.control[key]
        + (3 * v * u * u + u ** 3) * ZERO[key];
    }
    coast.phase = 'settle';
    return blend(coast, target, ease(u));
  }
  function createDirector({ seed = 7 } = {}) {
    let mood = 'idle', clock = 0, current = null, queued = null;
    let transition = null, moodTransition = null;
    let options = { energy: 1, reduced: false, compact: false, speech: 0 };
    let randomState = finite(seed, 7) >>> 0, lastPositive = -1;
    function actionAt(offset = 0) {
      const p = current ? applyOptions(actionRaw(current.id, current.elapsed + offset), {
        ...options, energy: energyOf(options.energy * current.energy),
      }) : draft();
      return transitionPose(transition, p, offset);
    }
    function moodAt(offset = 0) {
      const p = applyOptions(ambientRaw(mood, clock + offset, options.speech), options);
      return transitionPose(moodTransition, p, offset);
    }
    function pose() {
      if (options.energy === 0) return neutral();
      if (options.reduced) return staticPose(mood);
      return finish(compose(actionAt(), moodAt()));
    }
    function begin(cue, smooth) {
      transition = smooth ? transitionFrom(actionAt) : null;
      current = { ...cue, elapsed: 0 };
    }
    function play(id, playOptions = {}) {
      playOptions = playOptions || {};
      if (!byId.has(id) || options.reduced) return false;
      const cue = { id, energy: energyOf(playOptions.energy), priority: clamp(finite(playOptions.priority, 50), 0, 100) };
      if (cue.energy === 0 || current?.id === id || queued?.id === id) return false;
      if (!current) { begin(cue, !!transition); return true; }
      if (cue.priority < current.priority) return false;
      if (playOptions.interrupt) { queued = null; begin(cue, true); return true; }
      if (queued && cue.priority < queued.priority) return false;
      queued = cue;
      return true;
    }
    function setMood(next) {
      if (!MOODS.has(next) || next === mood) return false;
      moodTransition = options.reduced ? null : transitionFrom(moodAt, .42);
      mood = next;
      const entries = {
        listening: ['listen', .28, 10], thinking: ['think', .25, 10], working: ['nod', .22, 10],
        speaking: ['hello', .22, 10], sleep: ['yawn', .6, 30], error: ['oops', .55, 90],
      };
      if (next === 'happy') {
        randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
        const choices = ['nod', 'puff', 'giggle', 'proud'];
        lastPositive = lastPositive < 0 ? randomState % choices.length : (lastPositive + 1 + randomState % 3) % choices.length;
        play(choices[lastPositive], { energy: .4, priority: 20 });
      } else if (entries[next]) {
        const [id, energy, priority] = entries[next];
        play(id, { energy, priority, interrupt: next === 'error' });
      }
      return true;
    }
    function stop() {
      queued = null;
      transition = options.reduced ? null : current || transition ? transitionFrom(actionAt) : null;
      current = null;
    }
    function advance(dt) {
      let left = dt;
      while (left > 0) {
        const untilEnd = current ? Math.max(0, byId.get(current.id).duration - current.elapsed) : Infinity;
        const step = Math.min(left, untilEnd);
        clock = Math.min(1e12, clock + step);
        if (current) current.elapsed += step;
        for (const active of [transition, moodTransition]) if (active) active.elapsed += step;
        if (transition && transition.elapsed >= transition.duration) transition = null;
        if (moodTransition && moodTransition.elapsed >= moodTransition.duration) moodTransition = null;
        left -= step;
        if (current && step === untilEnd) {
          current = null;
          if (queued) { const next = queued; queued = null; begin(next, false); }
        } else break;
      }
    }
    function update(dtSeconds, updateOptions = {}) {
      updateOptions = updateOptions || {};
      options = {
        energy: energyOf(updateOptions.energy), reduced: !!updateOptions.reduced,
        compact: !!updateOptions.compact, speech: clamp(finite(updateOptions.speech), 0, 1),
      };
      if (options.reduced) {
        current = null; queued = null; transition = null; moodTransition = null;
      } else if (!updateOptions.hidden) advance(Math.max(0, finite(dtSeconds)));
      return pose();
    }
    function state() {
      return {
        action: current?.id || null, phase: pose().phase, elapsed: current?.elapsed || 0,
        duration: current ? byId.get(current.id).duration : 0, queue: queued ? [queued.id] : [],
        mood, clock, transitioning: !!transition, reduced: options.reduced,
        priority: current?.priority || 0,
      };
    }
    return Object.freeze({ play, setMood, update, stop, state });
  }
  const api = Object.freeze({ catalog, neutral, sample, ambient, createDirector });
  root.NibbiPocketMotion = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis === 'object' ? globalThis : this);

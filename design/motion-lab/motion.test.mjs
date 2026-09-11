import test from 'node:test';
import assert from 'node:assert/strict';
import { STYLES, ACTIONS, durationFor, neutralPose, sampleMotion } from './motion.mjs';

const styles = ['elastic', 'liquid', 'mischief'];
const actions = ['idle', 'hop', 'morph', 'hello', 'success', 'think'];
const finiteActions = actions.filter((id) => id !== 'idle');
const neutral = neutralPose();
const scalars = Object.keys(neutral).filter((key) => key !== 'phase');
const weights = ['round', 'star', 'drop', 'satellite', 'trail', 'impact', 'blink', 'happy'];
const linear = ['x', 'lift', 'rotate', 'lean', 'round', 'star', 'drop', 'satellite',
  'trail', 'impact', 'eyeX', 'eyeY', 'happy'];
const phaseEdges = {
  elastic: [.02, .23, .34, .66, .78, .94],
  liquid: [.025, .31, .44, .72, .85, .96],
  mischief: [.02, .20, .30, .61, .74, .95],
};
function at(style, action, u, intensity = 1) {
  return sampleMotion(style, action, u * durationFor(style, action), { intensity });
}
function samples(style, action, intensity = 1, count = 512) {
  return Array.from({ length: count + 1 }, (_, i) => at(style, action, i / count, intensity));
}
function maximum(poses, field) { return Math.max(...poses.map((p) => p[field])); }
function magnitude(poses, field) { return Math.max(...poses.map((p) => Math.abs(p[field]))); }
function near(a, b, tolerance = 1e-12, label = '') {
  assert.ok(Math.abs(a - b) <= tolerance, `${label}: ${a} ≠ ${b} (±${tolerance})`);
}

test('public catalog and neutral pose match the contract', () => {
  assert.deepEqual(STYLES.map((s) => s.id), styles);
  assert.deepEqual(ACTIONS.map((a) => a.id), actions);
  for (const style of STYLES) {
    for (const field of ['name', 'short', 'description']) assert.ok(style[field].length > 0);
  }
  for (const action of ACTIONS) assert.ok(action.label.length > 0);
  assert.deepEqual(neutral, {
    x: 0, lift: 0, sx: 1, sy: 1, rotate: 0, lean: 0, round: 0, star: 0,
    drop: 0, satellite: 0, trail: 0, impact: 0, eyeX: 0, eyeY: 0,
    blink: 0, wide: 1, happy: 0, phase: 'rest',
  });
  const changed = neutralPose();
  changed.sx = 99;
  assert.deepEqual(neutralPose(), neutral);
  for (const style of styles) for (const action of actions) {
    assert.ok(Number.isFinite(durationFor(style, action)));
    assert.ok(durationFor(style, action) > 1);
    assert.ok(durationFor(style, action) < 10);
  }
});

test('every complete finite action starts and ends neutral, with a neutral tail', () => {
  for (const style of styles) for (const action of finiteActions) {
    for (const gain of [.5, 1, 1.5]) {
      for (const u of [0, .96, .98, 1, 1.2, 100]) {
        assert.deepEqual(at(style, action, u, gain), neutral, `${style}/${action}/${u}`);
      }
      const poses = samples(style, action, gain);
      assert.ok(poses.some((p) => scalars.some((key) => p[key] !== neutral[key])), `${style}/${action} is active`);
      assert.equal(poses.at(-1).satellite, 0);
      assert.equal(poses.at(-1).impact, 0);
    }
  }
});

test('all action trajectories are finite, JSON-safe, bounded, and volume preserving', () => {
  for (const style of styles) for (const action of actions) for (const gain of [0, .5, 1, 1.5]) {
    for (const p of samples(style, action, gain, 480)) {
      const label = `${style}/${action}/${gain}/${p.phase}`;
      assert.deepEqual(Object.keys(p), Object.keys(neutral), label);
      for (const key of scalars) assert.ok(Number.isFinite(p[key]), `${label}.${key}`);
      assert.deepEqual(JSON.parse(JSON.stringify(p)), p, label);
      for (const key of weights) assert.ok(p[key] >= 0 && p[key] <= 1, `${label}.${key}: ${p[key]}`);
      assert.ok(p.lift >= 0 && p.lift <= 1.1, label);
      assert.ok(p.sx >= 2 / 3 && p.sx <= 1.5, label);
      assert.ok(p.sy >= 2 / 3 && p.sy <= 1.5, label);
      near(p.sx * p.sy, 1, 3e-16, `${label}.area`);
      assert.ok(Math.abs(p.x) <= .4 && Math.abs(p.rotate) <= .6 && Math.abs(p.lean) <= .4, label);
      assert.ok(Math.abs(p.eyeX) <= .2 && Math.abs(p.eyeY) <= .2, label);
      assert.ok(p.wide >= .6 && p.wide <= 1.14, label);
      assert.equal(typeof p.phase, 'string');
    }
  }
});

test('eye whites stay separate at maximum energy while landing squints remain', () => {
  // Native eye spacing and the sum of both horizontal white radii, in R.
  const spacing = 70 / 135;
  const whiteDiameters = 58.9 / 135;
  for (const style of styles) for (const action of actions) {
    for (const p of samples(style, action, 1.5, 1024)) {
      assert.ok(p.wide <= 1.14, `${style}/${action} widened too far`);
      assert.ok(spacing - whiteDiameters * p.wide > .02, `${style}/${action} eye gap`);
    }
  }
  const hop = samples('elastic', 'hop', 1.5);
  assert.ok(hop.some((p) => p.phase === 'landing' && p.wide < .9));
  assert.ok(hop.some((p) => p.phase === 'air' && p.wide > 1.10));
});

test('C1 numeric continuity across phase boundaries, joins, rest tails, and dense interior samples', () => {
  // Include shape peaks and blink knots as well as the public phase changes.
  const knots = [0, .025, .035, .08, .10, .12, .13, .15, .16, .165, .17, .18,
    .20, .21, .22, .23, .24, .25, .26, .27, .28, .30, .31, .32, .33, .34,
    .35, .37, .39, .40, .41, .42, .43, .44, .446, .45, .46, .47, .48,
    .49, .50, .51, .52, .53, .54, .55, .56, .57, .58, .60, .61, .62,
    .624, .63, .64, .648, .65, .655, .66, .67, .68, .69, .70, .71,
    .715, .72, .74, .75, .755, .76, .77, .775, .78, .785, .79, .80,
    .82, .83, .84, .85, .86, .87, .88, .90, .91, .93, .94, .95, .96, 1];
  const epsilon = 1e-6;
  for (const style of styles) for (const action of actions) {
    const boundaries = action === 'success'
      ? [...phaseEdges[style].map((u) => u * .43), .43,
        ...phaseEdges[style].map((u) => .43 + u * .52)]
      : phaseEdges[style];
    const points = new Set([...knots, ...boundaries, ...Array.from({ length: 256 }, (_, i) => i / 256)]);
    for (let u of points) {
      if (action === 'idle' && u === 0) u = 1; // Test the loop seam, not negative time.
      const left = at(style, action, u - epsilon, 1.5);
      const center = at(style, action, u, 1.5);
      const right = at(style, action, u + epsilon, 1.5);
      for (const key of scalars) {
        const label = `${style}/${action}/${u}/${key}`;
        near(left[key], right[key], 5e-4, `${label} position`);
        const before = (center[key] - left[key]) / epsilon;
        const after = (right[key] - center[key]) / epsilon;
        near(before, after, .07, `${label} velocity`);
      }
    }
  }
});

test('jump phases are labelled and the crouch, touchdown, and settle stay planted', () => {
  for (const style of styles) for (const action of ['hop', 'hello', 'success']) {
    const poses = samples(style, action, 1.5, 1024);
    const phases = new Set(poses.map((p) => p.phase));
    for (const phase of ['anticipation', 'launch', 'air', 'landing', 'settle', 'rest']) {
      assert.ok(phases.has(phase), `${style}/${action} missing ${phase}`);
    }
    for (const p of poses) {
      if (['anticipation', 'landing', 'settle', 'rest'].includes(p.phase)) assert.equal(p.lift, 0);
      if (p.phase === 'air') assert.ok(p.lift > 0);
    }
    assert.ok(poses.some((p) => p.phase === 'anticipation' && p.sy < .99));
    assert.ok(poses.some((p) => p.phase === 'landing' && p.sy < .99));
    assert.ok(poses.some((p) => p.phase === 'landing' && p.impact > .05));
  }
  for (const style of styles) for (const action of ['morph', 'think']) {
    for (const p of samples(style, action)) {
      assert.equal(p.lift, 0);
      assert.equal(p.impact, 0);
    }
  }
});

test('sampling is deterministic, input-independent, and refresh-rate independent', () => {
  for (const style of styles) for (const action of actions) {
    const d = durationFor(style, action);
    const times = [0, .13, .37, .69, .91, 1.1].map((u) => u * d);
    const options = Object.freeze({ intensity: 1.2, reduced: false });
    const expected = times.map((t) => sampleMotion(style, action, t, options));
    for (const hz of [30, 60, 90, 144]) {
      for (let frame = 0; frame < Math.ceil(d * hz); frame++) sampleMotion(style, action, frame / hz, options);
      assert.deepEqual(times.map((t) => sampleMotion(style, action, t, options)), expected);
      assert.deepEqual([...times].reverse().map((t) => sampleMotion(style, action, t, options)), [...expected].reverse());
    }
    const changed = sampleMotion(style, action, times[2], options);
    changed.x = 999;
    changed.phase = 'changed';
    assert.deepEqual(sampleMotion(style, action, times[2], options), expected[2]);
    assert.deepEqual(options, { intensity: 1.2, reduced: false });
  }
});

test('idle loops quietly without hops, bead emissions, or landing marks', () => {
  for (const style of styles) {
    for (const p of samples(style, 'idle', 1.5, 1024)) {
      assert.equal(p.lift, 0);
      assert.equal(p.impact, 0);
      assert.equal(p.satellite, 0);
      assert.equal(p.trail, 0);
      assert.ok(Math.abs(p.x) <= .0061);
      assert.ok(Math.abs(p.rotate) <= .022);
      assert.ok(Math.abs(p.lean) <= .03);
      assert.ok(Math.abs(p.sy - 1) < .031);
    }
    for (const u of [.07, .24, .624, .8]) {
      const before = at(style, 'idle', u);
      const after = at(style, 'idle', u + 12);
      for (const key of scalars) near(before[key], after[key], 1e-12);
    }
  }
});

test('reduced motion is spatially and temporally static, including blink and expression', () => {
  for (const style of styles) for (const action of actions) for (const intensity of [0, .5, 1, 1.5]) {
    for (const seconds of [0, .1, .7, 2, 8, 10000]) {
      assert.deepEqual(sampleMotion(style, action, seconds, { intensity, reduced: true }), neutral);
    }
  }
});

test('intensity clamps safely and scales geometry without changing phase timing or area', () => {
  for (const style of styles) for (const action of actions) for (const u of [.12, .37, .71]) {
    const p = at(style, action, u);
    const half = at(style, action, u, .5);
    const max = at(style, action, u, 1.5);
    assert.deepEqual(at(style, action, u, 20), max);
    assert.deepEqual(at(style, action, u, Infinity), max);
    assert.deepEqual(at(style, action, u, -2), neutral);
    assert.deepEqual(at(style, action, u, -Infinity), neutral);
    assert.deepEqual(at(style, action, u, 0), neutral);
    assert.deepEqual(at(style, action, u, NaN), p);
    for (const key of linear) {
      near(half[key], p[key] * .5);
      near(max[key], p[key] * 1.5);
    }
    assert.equal(half.phase, p.phase);
    assert.equal(max.phase, p.phase);
    assert.ok(Math.abs(Math.log(half.sy)) <= Math.abs(Math.log(p.sy)) + 1e-15);
    assert.ok(Math.abs(Math.log(p.sy)) <= Math.abs(Math.log(max.sy)) + 1e-15);
  }
});

test('invalid times rest, unknown IDs fall back, and huge valid times remain finite', () => {
  for (const style of styles) for (const action of actions) {
    for (const t of [-1, NaN, Infinity, -Infinity, undefined, null, '1']) {
      assert.deepEqual(sampleMotion(style, action, t), neutral);
    }
    for (const key of scalars) assert.ok(Number.isFinite(sampleMotion(style, action, 1e100)[key]));
  }
  assert.equal(durationFor('unknown', 'unknown'), durationFor('elastic', 'idle'));
  assert.deepEqual(sampleMotion('unknown', 'unknown', .4), sampleMotion('elastic', 'idle', .4));
  assert.deepEqual(sampleMotion('__proto__', 'toString', .4), sampleMotion('elastic', 'idle', .4));
});

test('profiles differ in mechanics, not just duration or amplitude', () => {
  const elastic = samples('elastic', 'hop');
  const liquid = samples('liquid', 'hop');
  const mischief = samples('mischief', 'hop');
  assert.ok(maximum(elastic, 'lift') > .71);
  assert.ok(maximum(mischief, 'lift') > .61 && maximum(mischief, 'lift') < .63);
  assert.ok(maximum(liquid, 'lift') > .45 && maximum(liquid, 'lift') < .47);
  assert.equal(magnitude(elastic, 'x'), 0);
  assert.ok(magnitude(liquid, 'x') < .06);
  assert.ok(magnitude(mischief, 'x') > .20);
  assert.ok(magnitude(mischief, 'rotate') > .24);
  assert.ok(maximum(liquid, 'drop') > .59 && maximum(liquid, 'satellite') > .61);
  assert.equal(maximum(elastic, 'satellite'), 0);
  assert.equal(maximum(mischief, 'satellite'), 0);
  assert.ok(Math.min(...liquid.map((p) => p.sy)) < Math.min(...elastic.map((p) => p.sy)));
  for (const action of actions) assert.ok(durationFor('liquid', action) > durationFor('elastic', action));
  const bead = [.56, .61, .68, .74, .78].map((u) => at('liquid', 'hop', u).satellite);
  assert.ok(bead.every((value, i) => i === 0 || value < bead[i - 1]));
  assert.equal(bead.at(-1), 0);
  for (const action of ['hop', 'morph']) {
    const poses = samples('mischief', action, 1, 1024);
    const peaks = ['star', 'round', 'drop'].map((key) => {
      const max = maximum(poses, key);
      assert.ok(max > .4);
      return poses.findIndex((p) => p[key] === max);
    });
    assert.ok(peaks[0] < peaks[1] && peaks[1] < peaks[2], `ordered ${action} shape sequence`);
  }
});

test('hello, success, think, and morph have distinct app-readable gestures', () => {
  for (const style of styles) {
    const greeting = samples(style, 'hello');
    const celebration = samples(style, 'success', 1, 1024);
    const thinking = samples(style, 'think');
    const morphing = samples(style, 'morph');
    assert.ok(maximum(greeting, 'lift') < .23);
    assert.ok(maximum(greeting, 'happy') > .5);
    assert.ok(maximum(celebration, 'happy') > .6);
    let arcs = 0;
    let airborne = false;
    for (const p of celebration) {
      const next = p.lift > 1e-5;
      if (next && !airborne) arcs++;
      airborne = next;
    }
    assert.equal(arcs, 2, `${style} celebrates twice`);
    assert.equal(maximum(thinking, 'lift'), 0);
    assert.ok(magnitude(thinking, 'eyeX') > .06 && magnitude(thinking, 'eyeY') > .08);
    assert.ok(thinking.some((p) => p.phase === 'think'));
    assert.equal(maximum(morphing, 'lift'), 0);
    assert.ok(Math.max(...['round', 'star', 'drop'].map((key) => maximum(morphing, key))) > .6);
    assert.ok(morphing.some((p) => p.phase === 'morph'));
    const signatures = actions.map((action) => JSON.stringify([.2, .4, .6, .8].map((u) => at(style, action, u))));
    assert.equal(new Set(signatures).size, actions.length);
  }
});

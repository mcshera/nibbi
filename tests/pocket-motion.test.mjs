import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../public/pocket-motion.js';

const { catalog, neutral, sample, ambient, createDirector } = globalThis.NibbiPocketMotion;
const ids = ['hello', 'nod', 'bow', 'peek', 'hop', 'boing', 'double-hop', 'triple-hop',
  'squish', 'stretch', 'puff', 'star', 'drop', 'pancake', 'wiggle', 'giggle', 'ta-da', 'proud',
  'curious', 'think', 'listen', 'yawn', 'wake', 'oops'];
const moods = ['idle', 'listening', 'thinking', 'working', 'speaking', 'happy', 'error', 'sleep'];
const base = neutral();
const keys = Object.keys(base).filter((key) => key !== 'phase');
const spatial = keys.filter((key) => !['happy', 'wide'].includes(key));
const duration = (id) => catalog.find((item) => item.id === id).duration;
const at = (id, u, options) => sample(id, u * duration(id), options);
const samples = (id, options = {}, count = 512) => Array.from({ length: count + 1 }, (_, i) => at(id, i / count, options));
const max = (poses, key) => Math.max(...poses.map((p) => p[key]));
const min = (poses, key) => Math.min(...poses.map((p) => p[key]));
function near(a, b, eps = 1e-11, label = '') {
  assert.ok(Math.abs(a - b) <= eps, `${label}: ${a} != ${b} (±${eps})`);
}
function nearPose(a, b, eps = 1e-11) { for (const key of keys) near(a[key], b[key], eps, key); }
function bounds(p, label = '') {
  assert.deepEqual(Object.keys(p), Object.keys(base));
  for (const key of keys) assert.ok(Number.isFinite(p[key]), `${label}.${key} finite`);
  assert.deepEqual(JSON.parse(JSON.stringify(p)), p, label);
  for (const key of ['round', 'star', 'drop', 'impact', 'blink', 'happy']) assert.ok(p[key] >= 0 && p[key] <= 1, `${label}.${key}`);
  assert.ok(p.lift >= 0 && p.lift <= 1.1, `${label}.lift`);
  assert.ok(Math.abs(p.x) <= .3 && Math.abs(p.rotate) <= .35 && Math.abs(p.lean) <= .35, `${label}.travel`);
  assert.ok(p.sx >= 2 / 3 && p.sx <= 1.5 && p.sy >= 2 / 3 && p.sy <= 1.5, `${label}.scale`);
  near(p.sx * p.sy, 1, 3e-16, `${label}.area`);
  assert.ok(p.wide >= .55 && p.wide <= 1.14, `${label}.wide`);
  assert.ok(70 / 135 - (58.9 / 135) * p.wide > .02, `${label}.eye-gap`);
  assert.ok(Math.abs(p.eyeX) <= .2 && Math.abs(p.eyeY) <= .2, `${label}.gaze`);
  assert.equal(p.satellite, 0); assert.equal(p.trail, 0);
  assert.equal(typeof p.phase, 'string');
}
function runTo(director, seconds, hz = 60, options = {}) {
  let elapsed = 0, p = director.update(0, options);
  while (elapsed < seconds) {
    const dt = Math.min(1 / hz, seconds - elapsed);
    p = director.update(dt, options);
    elapsed += dt;
  }
  return p;
}

test('classic script publishes a frozen 24-action API without browser or timer dependencies', () => {
  const source = readFileSync(new URL('../public/pocket-motion.js', import.meta.url), 'utf8');
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(source, sandbox);
  assert.equal(sandbox.module.exports, sandbox.NibbiPocketMotion);
  assert.deepEqual(catalog.map((item) => item.id), ids);
  assert.ok(Object.isFrozen(catalog));
  assert.ok(Object.isFrozen(globalThis.NibbiPocketMotion));
  for (const item of catalog) {
    assert.ok(Object.isFrozen(item));
    for (const key of ['label', 'group', 'description']) assert.ok(item[key].length > 0);
    assert.ok(item.duration > 1 && item.duration < 5);
  }
  assert.equal(new Set(catalog.map((item) => item.group)).size, 6);
});

test('neutral is fresh and exact; all actions have exact neutral endpoints and a fixed neutral tail', () => {
  assert.deepEqual(base, {
    x: 0, lift: 0, sx: 1, sy: 1, rotate: 0, lean: 0, round: 0, star: 0, drop: 0,
    satellite: 0, trail: 0, impact: 0, eyeX: 0, eyeY: 0, blink: 0, wide: 1, happy: 0, phase: 'rest',
  });
  const changed = neutral(); changed.sx = 42;
  assert.deepEqual(neutral(), base);
  for (const id of ids) for (const energy of [.5, 1, 1.5]) {
    for (const u of [0, .96, .99, 1, 3, 1e100]) assert.deepEqual(at(id, u, { energy }), base, `${id}/${u}`);
    assert.ok(samples(id).some((p) => keys.some((key) => p[key] !== base[key])), `${id} is active`);
  }
});

test('24 complete trajectories preserve area, eye gap, Pocket-only shape and geometric bounds at all energies', () => {
  for (const id of ids) for (const energy of [0, .5, 1, 1.5]) for (const compact of [false, true]) {
    for (const p of samples(id, { energy, compact }, 320)) bounds(p, `${id}/${energy}/${compact}`);
  }
});

test('C1 continuity includes phase changes, blink knots, repeat joins and neutral tails', () => {
  const epsilon = 1e-6;
  const knots = [0, .02, .025, .04, .08, .10, .12, .13, .15, .165, .17, .18, .20, .23, .24,
    .25, .27, .28, .29, .30, .31, .33, .34, .35, .36, .37, .39, .40, .42, .43, .44,
    .446, .45, .46, .47, .48, .49, .50, .51, .52, .53, .54, .55, .57, .58, .59,
    .60, .61, .62, .63, .64, .65, .66, .67, .68, .69, .70, .715, .72, .73, .74,
    .75, .76, .77, .78, .79, .80, .81, .83, .84, .85, .86, .87, .88, .89, .90,
    .91, .92, .94, .95, .96, 1];
  const springKnots = [.02, .165, .23, .30, .34, .66, .70, .715, .76, .78, .83, .95];
  for (const id of ids) {
    const repeats = id === 'double-hop' ? [[0, .43], [.43, .52]] : id === 'triple-hop' ? [[0, .29], [.29, .31], [.60, .35]] : [];
    const points = new Set([...knots, ...repeats.flatMap(([a, length]) => springKnots.map((u) => a + u * length)),
      ...Array.from({ length: 384 }, (_, i) => i / 384)]);
    for (const u of points) {
      const a = at(id, u - epsilon, { energy: 1.5 });
      const b = at(id, u, { energy: 1.5 });
      const c = at(id, u + epsilon, { energy: 1.5 });
      for (const key of keys) {
        near(a[key], c[key], .0006, `${id}/${u}/${key} position`);
        near((b[key] - a[key]) / epsilon, (c[key] - b[key]) / epsilon, .16, `${id}/${u}/${key} velocity`);
      }
    }
  }
});

test('action sampling is pure, immutable and independent of playback history or refresh rate', () => {
  for (const id of ids) {
    const options = Object.freeze({ energy: 1.2, reduced: false, compact: false });
    const times = [.1, .29, .45, .71, .98].map((u) => u * duration(id));
    const expected = times.map((time) => sample(id, time, options));
    for (const hz of [30, 60, 144]) {
      for (let frame = 0; frame < duration(id) * hz; frame++) sample(id, frame / hz, options);
      assert.deepEqual(times.map((time) => sample(id, time, options)), expected);
      assert.deepEqual([...times].reverse().map((time) => sample(id, time, options)), [...expected].reverse());
    }
    const changed = sample(id, times[0], options); changed.lift = 100;
    assert.deepEqual(sample(id, times[0], options), expected[0]);
    assert.deepEqual(options, { energy: 1.2, reduced: false, compact: false });
  }
});

test('24 action choreographies differ numerically, not just by names or duration', () => {
  const signatures = ids.map((id) => JSON.stringify([.1, .2, .3, .4, .5, .6, .7, .8, .9]
    .map((u) => { const p = at(id, u); return keys.map((key) => p[key]); })));
  assert.equal(new Set(signatures).size, 24);
  for (const [id, expected] of [['hop', 1], ['boing', 1], ['double-hop', 2], ['triple-hop', 3], ['giggle', 3], ['wake', 1]]) {
    let count = 0, flying = false;
    for (const p of samples(id, {}, 2048)) {
      const next = p.lift > 1e-5;
      if (next && !flying) count++;
      flying = next;
    }
    assert.equal(count, expected, id);
  }
  assert.ok(max(samples('hello'), 'lift') < .21);
  assert.ok(max(samples('hop'), 'lift') > .71);
  assert.ok(max(samples('boing'), 'sy') > max(samples('hop'), 'sy') + .06);
  assert.ok(min(samples('pancake'), 'sy') < min(samples('squish'), 'sy') - .02);
  assert.ok(max(samples('star'), 'star') > .63);
  assert.ok(max(samples('drop'), 'drop') > .62);
  assert.ok(max(samples('puff'), 'round') > .63);
  assert.ok(max(samples('ta-da'), 'star') > .57 && max(samples('ta-da'), 'lift') > .46);
  for (const id of ['nod', 'bow', 'peek', 'squish', 'stretch', 'puff', 'star', 'drop', 'pancake',
    'wiggle', 'proud', 'curious', 'think', 'listen', 'yawn', 'oops']) assert.equal(max(samples(id), 'lift'), 0, id);
});

test('hop-family anticipation and landing are planted and include temporary impact only', () => {
  for (const id of ['hop', 'boing', 'hello', 'double-hop', 'triple-hop', 'ta-da', 'wake']) {
    const poses = samples(id, { energy: 1.5 }, 1024);
    const phases = new Set(poses.map((p) => p.phase));
    for (const phase of ['anticipation', 'launch', 'air', 'landing', 'settle']) assert.ok(phases.has(phase), `${id}/${phase}`);
    for (const p of poses) {
      if (['anticipation', 'landing', 'settle', 'rest'].includes(p.phase)) assert.equal(p.lift, 0, `${id}/${p.phase}`);
      if (p.phase === 'air') assert.ok(p.lift > 0);
    }
    assert.ok(poses.some((p) => p.phase === 'landing' && p.sy < .99 && p.impact > 0));
    assert.equal(poses.at(-1).impact, 0);
  }
});

test('energy clamps, invalid inputs stay safe, and compact genuinely attenuates travel and shape', () => {
  for (const id of ids) {
    for (const badTime of [NaN, Infinity, -Infinity, undefined, null, '1', -1]) assert.deepEqual(sample(id, badTime), base);
    for (const u of [.12, .35, .64, .83]) {
      assert.deepEqual(at(id, u, { energy: 100 }), at(id, u, { energy: 1.5 }));
      assert.deepEqual(at(id, u, { energy: Infinity }), at(id, u, { energy: 1.5 }));
      assert.deepEqual(at(id, u, { energy: -1 }), base);
      assert.deepEqual(at(id, u, { energy: 0 }), base);
      assert.deepEqual(at(id, u, { energy: NaN }), at(id, u));
      const full = at(id, u, { energy: 1.5 }), small = at(id, u, { energy: 1.5, compact: true });
      for (const key of ['x', 'lift', 'rotate', 'lean', 'round', 'star', 'drop']) assert.ok(Math.abs(small[key]) <= Math.abs(full[key]) + 1e-15, `${id}/${key}`);
      assert.ok(Math.abs(Math.log(small.sy)) <= Math.abs(Math.log(full.sy)) + 1e-15);
    }
  }
  for (const id of ['unknown', '__proto__', 'toString', null, 0, {}]) assert.deepEqual(sample(id, 1), base);
});

test('ambient moods are distinct, quiet, Pocket-only and safe with speech input', () => {
  const signatures = [];
  for (const mood of moods) {
    signatures.push(JSON.stringify([.7, 1.9, 4.2].map((t) => ambient(mood, t, { speech: .8 }))));
    for (let i = 0; i <= 720; i++) {
      const p = ambient(mood, i / 50, { energy: 1.5, speech: .8 });
      bounds(p, mood);
      assert.equal(p.lift, 0); assert.equal(p.x, 0); assert.equal(p.impact, 0);
      assert.equal(p.star, 0); assert.equal(p.drop, 0);
      assert.ok(Math.abs(p.rotate) < .025 && Math.abs(p.lean) < .04);
      assert.ok(p.sy > .9 && p.sy < 1.04);
      assert.ok(p.round < .02);
    }
    for (const t of [NaN, Infinity, -1, 1e300]) bounds(ambient(mood, t, { speech: Infinity }));
  }
  assert.equal(new Set(signatures).size, moods.length);
  assert.notDeepEqual(ambient('speaking', .8, { speech: 0 }), ambient('speaking', .8, { speech: 1 }));
  assert.deepEqual(ambient('unknown', 1), ambient('idle', 1));
});

test('reduced action and ambient samples freeze all spatial fields, eyes and blink; feedback stays static', () => {
  for (const id of ids) {
    const expected = sample(id, 0, { reduced: true });
    for (const t of [0, .2, 1, 10, 1000]) {
      const p = sample(id, t, { reduced: true });
      assert.deepEqual(p, expected);
      for (const key of spatial) assert.equal(p[key], base[key], `${id}/${key}`);
    }
  }
  for (const mood of moods) {
    const expected = ambient(mood, 0, { reduced: true });
    for (const t of [0, .2, 1, 100]) {
      const p = ambient(mood, t, { reduced: true, speech: t % 1 });
      assert.deepEqual(p, expected);
      for (const key of spatial) assert.equal(p[key], base[key]);
    }
  }
  assert.ok(ambient('happy', 0, { reduced: true }).happy > 0);
  assert.ok(ambient('sleep', 0, { reduced: true }).wide < 1);
});

test('director has a bounded latest queue, coalesces duplicates and honors user/error priority', () => {
  const d = createDirector();
  assert.equal(d.play('missing'), false);
  assert.equal(d.play('hop', { priority: 80 }), true);
  d.update(.3);
  const elapsed = d.state().elapsed;
  assert.equal(d.play('hop', { priority: 80, interrupt: true }), false);
  assert.equal(d.state().elapsed, elapsed);
  assert.equal(d.play('puff', { priority: 20 }), false);
  assert.equal(d.play('star', { priority: 80 }), true);
  assert.equal(d.play('star', { priority: 80 }), false);
  assert.equal(d.play('pancake', { priority: 80 }), true);
  assert.deepEqual(d.state().queue, ['pancake']);
  assert.equal(d.play('nod', { priority: 79 }), false);
  d.setMood('happy');
  assert.equal(d.state().action, 'hop');
  assert.deepEqual(d.state().queue, ['pancake']);
  d.setMood('error');
  assert.equal(d.state().action, 'oops');
  assert.deepEqual(d.state().queue, []);
  assert.equal(d.state().priority, 90);
  const state = d.state(); state.queue.push('changed');
  assert.deepEqual(d.state().queue, []);
  assert.deepEqual(JSON.parse(JSON.stringify(d.state())), d.state());
});

test('queue handoffs consume overshoot deterministically at all refresh rates', () => {
  const results = [];
  for (const hz of [30, 60, 90, 144]) {
    const d = createDirector();
    d.play('double-hop'); d.play('star');
    const p = runTo(d, 3.4, hz);
    assert.equal(d.state().action, 'star');
    near(d.state().elapsed, 3.4 - duration('double-hop'));
    results.push(p);
  }
  for (const result of results) nearPose(result, results[0]);
  const single = createDirector(); single.play('double-hop'); single.play('star');
  nearPose(single.update(3.4), results[0]);
  single.update(1e300);
  assert.equal(single.state().action, null);
  assert.deepEqual(single.state().queue, []);
  bounds(single.update(Infinity));
});

test('interruption and stop preserve current pose and useful incoming velocity, then settle', () => {
  for (const stop of [false, true]) {
    const d = createDirector(), reference = createDirector();
    d.play('hop'); reference.play('hop');
    const epsilon = 1e-5, time = .54;
    const before = reference.update(time - epsilon);
    const center = reference.update(epsilon);
    nearPose(d.update(time), center);
    if (stop) d.stop(); else assert.equal(d.play('wiggle', { priority: 80, interrupt: true }), true);
    nearPose(d.update(0), center, 1e-13);
    const next = d.update(epsilon);
    for (const key of keys) near((center[key] - before[key]) / epsilon, (next[key] - center[key]) / epsilon, .02, key);
    for (let i = 0; i < 40; i++) bounds(d.update(.01, { energy: 1 }));
    assert.equal(d.state().transitioning, false);
    if (stop) {
      assert.equal(d.state().action, null);
      nearPose(d.update(0), ambient('idle', d.state().clock));
    }
  }
});

test('stop clears queue, remains smooth when repeated, and allows a clean restart during settle', () => {
  const d = createDirector(); d.play('hop'); d.play('star');
  const before = d.update(.7);
  d.stop();
  assert.deepEqual(d.state().queue, []); assert.equal(d.state().action, null);
  nearPose(d.update(0), before);
  const halfway = d.update(.08); d.stop(); nearPose(d.update(0), halfway);
  assert.equal(d.play('hello'), true); nearPose(d.update(0), halfway);
  runTo(d, duration('hello') + .4);
  assert.equal(d.state().action, null); assert.equal(d.state().transitioning, false);
});

test('repeated interrupted poses stay bounded with compact, speech and mood composition', () => {
  const d = createDirector({ seed: 19 });
  for (let i = 0; i < 900; i++) {
    const options = { energy: 1.5, compact: i % 3 === 0, speech: (i % 7) / 6 };
    if (i % 15 === 0) d.setMood(moods[Math.floor(i / 15) % moods.length]);
    d.play(ids[i % ids.length], { energy: 1.5, priority: 100, interrupt: true });
    bounds(d.update(.013, options), `interruption ${i}`);
    assert.ok(d.state().queue.length <= 1);
    if (i % 11 === 0) { const before = d.update(0, options); d.stop(); nearPose(d.update(0, options), before); }
  }
});

test('all composed action/mood combinations stay bounded at maximum energy', () => {
  for (const mood of moods) for (const id of ids) {
    const d = createDirector(); d.setMood(mood);
    d.play(id, { priority: 100, energy: 1.5, interrupt: true });
    for (let i = 0; i < 128; i++) bounds(d.update(duration(id) / 128, { energy: 1.5, speech: 1 }), `${mood}/${id}`);
  }
});

test('hidden updates freeze action, queue, mood transition and ambient clocks', () => {
  const d = createDirector(); d.setMood('thinking'); d.play('hop', { priority: 80, interrupt: true }); d.play('star', { priority: 80 });
  const before = d.update(.4, { speech: .4 });
  const state = d.state();
  for (const dt of [1, 20, 1e10]) {
    nearPose(d.update(dt, { speech: .4, hidden: true }), before);
    assert.deepEqual(d.state(), state);
  }
  const after = d.update(.1, { speech: .4 });
  near(d.state().elapsed, state.elapsed + .1);
  assert.notDeepEqual(after, before);
});

test('reduced director cancels actions, transitions and queue immediately and blocks replay', () => {
  const d = createDirector(); d.setMood('happy'); d.play('hop', { priority: 80, interrupt: true }); d.play('star', { priority: 80 });
  d.update(.5);
  const reduced = d.update(0, { reduced: true });
  for (const key of spatial) assert.equal(reduced[key], base[key]);
  assert.equal(d.state().action, null); assert.deepEqual(d.state().queue, []); assert.equal(d.state().transitioning, false);
  assert.equal(d.play('hello'), false);
  for (const dt of [0, .1, 10]) assert.deepEqual(d.update(dt, { reduced: true }), reduced);
  d.stop(); assert.deepEqual(d.update(0, { reduced: true }), reduced);
  d.setMood('sleep');
  const sleeping = d.update(1, { reduced: true });
  for (const key of spatial) assert.equal(sleeping[key], base[key]);
  assert.equal(sleeping.wide, .93);
  d.update(0); assert.equal(d.play('hello'), true);
});

test('mood entries happen once; positive choices vary deterministically, error is restrained, sleep calms', () => {
  function happySequence(seed) {
    const d = createDirector({ seed }), choices = [];
    for (let i = 0; i < 9; i++) {
      d.setMood('happy'); choices.push(d.state().action);
      const state = d.state(); assert.equal(d.setMood('happy'), false); assert.deepEqual(d.state(), state);
      d.update(5); d.setMood('idle'); d.update(.5);
    }
    return choices;
  }
  const sequence = happySequence(7);
  assert.deepEqual(sequence, happySequence(7));
  assert.ok(new Set(sequence).size >= 3);
  assert.ok(sequence.every((id, i) => ['nod', 'puff', 'giggle', 'proud'].includes(id) && (i === 0 || id !== sequence[i - 1])));
  for (const [mood, id] of [['listening', 'listen'], ['thinking', 'think'], ['working', 'nod'], ['speaking', 'hello'], ['sleep', 'yawn'], ['error', 'oops']]) {
    const d = createDirector(); assert.equal(d.setMood(mood), true); assert.equal(d.state().action, id);
    d.update(.2); const elapsed = d.state().elapsed;
    assert.equal(d.setMood(mood), false); assert.equal(d.state().elapsed, elapsed); assert.deepEqual(d.state().queue, []);
    const p = d.update(5); assert.equal(d.state().action, null); assert.equal(p.lift, 0);
    if (mood === 'sleep') assert.ok(p.blink > .7);
  }
});

test('director inputs and output snapshots never mutate callers or produce NaN', () => {
  const d = createDirector({ seed: NaN });
  const playOptions = Object.freeze({ energy: 1.5, priority: 80, interrupt: true });
  const updateOptions = Object.freeze({ energy: 1.2, compact: true, speech: .4, hidden: false });
  d.play('hop', playOptions);
  for (const dt of [undefined, null, NaN, Infinity, -1, '1']) bounds(d.update(dt, updateOptions));
  assert.equal(d.state().elapsed, 0);
  const p = d.update(.3, updateOptions); p.x = 100;
  bounds(d.update(0, updateOptions));
  assert.equal(d.setMood('__proto__'), false);
  assert.deepEqual(playOptions, { energy: 1.5, priority: 80, interrupt: true });
  assert.deepEqual(updateOptions, { energy: 1.2, compact: true, speech: .4, hidden: false });
});

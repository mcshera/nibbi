import test from 'node:test';
import assert from 'node:assert/strict';
import { createMicCapture } from '../public/lib/mic-capture.js';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function stream() {
  const track = { stopped: 0, listeners: {}, stop() { this.stopped++; }, addEventListener(name, fn) { this.listeners[name] = fn; } };
  return { track, getTracks: () => [track] };
}
function fixture(overrides = {}) {
  let clock = 0, amplitude = 0, allowed = true, timer, timerId = 0;
  const timers = new Map();
  const streams = [], contexts = [], recorders = [], utterances = [], errors = [];
  let starts = 0;
  const node = () => ({ connect() {}, disconnect() { this.disconnected = true; } });
  class Context {
    constructor() { this.state = 'running'; contexts.push(this); }
    resume() { return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    createMediaStreamSource() { return node(); }
    createAnalyser() { return { ...node(), getByteTimeDomainData(data) { data.fill(128 + amplitude); } }; }
    createDelay() { return { ...node(), delayTime: {} }; }
    createMediaStreamDestination() { const out = stream(); streams.push(out); return { ...node(), stream: out }; }
  }
  class Recorder {
    static isTypeSupported() { return true; }
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; recorders.push(this); }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.stopped = true; }
    complete() { this.ondataavailable?.({ data: new Blob(['audio']) }); this.onstop?.(); }
  }
  const mic = createMicCapture({
    getUserMedia: async () => { const input = stream(); streams.push(input); return input; },
    AudioContextClass: Context, Recorder,
    setTick: fn => { timer = fn; return 1; }, clearTick: () => { timer = null; }, now: () => clock,
    setTimer: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, at: clock + ms }); return id; },
    clearTimer: id => timers.delete(id),
    onUtterance: blob => utterances.push(blob), onSpeechStart: () => { starts++; }, onError: error => errors.push(error),
    canCapture: () => allowed, ...overrides,
  });
  return { mic, streams, contexts, recorders, utterances, errors, get starts() { return starts; },
    timers, allow: value => { allowed = value; }, tick: (value = 0, elapsed = 50) => {
      amplitude = value; clock += elapsed; timer?.();
      for (const [id, item] of [...timers]) if (item.at <= clock && timers.delete(id)) item.fn();
    } };
}

test('pending permission off/re-enable releases late stream without stopping new session', async () => {
  const old = deferred(), fresh = deferred(); let calls = 0;
  const f = fixture({ getUserMedia: () => (++calls === 1 ? old.promise : fresh.promise) });
  const stale = f.mic.start(); f.mic.stop(); const current = f.mic.start();
  const live = stream(); fresh.resolve(live); assert.equal(await current, true);
  const late = stream(); old.resolve(late); assert.equal(await stale, false);
  assert.equal(late.track.stopped, 1); assert.equal(live.track.stopped, 0);
  assert.equal(f.contexts[0].state, 'closed'); assert.equal(f.mic.snapshot().active, true);
  f.mic.stop(); assert.equal(live.track.stopped, 1);
});

test('idle never records/uploads; short noise never holds followup or uploads', async () => {
  const f = fixture(); await f.mic.start();
  for (let i = 0; i < 30; i++) f.tick();
  assert.equal(f.recorders.length, 0);
  f.tick(10); f.tick(10); f.tick(0, 800);
  f.recorders[0].complete();
  assert.equal(f.starts, 0); assert.equal(f.utterances.length, 0);
  f.mic.stop();
});

test('minimum sustained speech holds once and uploads only after silence', async () => {
  const f = fixture(); await f.mic.start();
  f.tick(10); f.tick(10); f.tick(10);
  assert.equal(f.starts, 0);
  f.tick(10); assert.equal(f.starts, 1);
  f.tick(10); assert.equal(f.starts, 1);
  assert.equal(f.utterances.length, 0);
  f.tick(0, 800); assert.equal(f.recorders[0].stopped, true);
  f.recorders[0].complete();
  assert.equal(f.utterances.length, 1); assert.equal(f.utterances[0].size, 5);
  f.mic.stop(); assert.ok(f.streams.every(s => s.track.stopped > 0));
});

for (const point of ['recording', 'onstop']) {
  test(`stop at ${point} prevents late uploads`, async () => {
    const f = fixture(); await f.mic.start();
    for (let i = 0; i < 4; i++) f.tick(10);
    if (point === 'onstop') f.tick(0, 800);
    f.mic.stop(); f.recorders[0].complete();
    assert.equal(f.utterances.length, 0); assert.equal(f.mic.snapshot().active, false);
  });
}

test('suspension discards current speech and prevents captures', async () => {
  const f = fixture(); await f.mic.start();
  for (let i = 0; i < 4; i++) f.tick(10);
  f.allow(false); f.tick(10); f.recorders[0].complete();
  f.tick(10); assert.equal(f.recorders.length, 1); assert.equal(f.utterances.length, 0);
  f.allow(true); f.tick(10); assert.equal(f.recorders.length, 2);
  f.mic.stop();
});

for (const reason of ['disconnect', 'context suspension']) {
  test(`${reason} stops tracks and reports error`, async () => {
    const f = fixture(); await f.mic.start();
    if (reason === 'disconnect') f.streams[0].track.listeners.ended();
    else { f.contexts[0].state = 'suspended'; f.tick(); }
    assert.equal(f.mic.snapshot().active, false); assert.equal(f.errors.length, 1);
    assert.ok(f.streams.every(s => s.track.stopped > 0));
  });
}

test('suspension during pending onstop permanently discards that utterance', async () => {
  const f = fixture(); await f.mic.start();
  for (let i = 0; i < 4; i++) f.tick(10);
  f.tick(0, 800); f.allow(false); f.tick(); f.allow(true);
  f.recorders[0].complete();
  assert.equal(f.utterances.length, 0);
  f.mic.stop();
});


test('manual finish keeps recording for the delayed tail, then starts the stop watchdog', async () => {
  const f = fixture(); await f.mic.start();
  for (let i = 0; i < 4; i++) f.tick(10);
  const rec = f.recorders[0];
  assert.equal(f.mic.finishUtterance(), true);
  assert.deepEqual(f.mic.snapshot(), { active: true, recording: false, finishing: true });
  assert.equal(f.mic.finishUtterance(), false);
  f.tick(0, 199); assert.equal(rec.state, 'recording');
  // A fake delayed sample arrives before stop, just like the final syllable.
  rec.ondataavailable({ data: new Blob(['tail']) });
  f.tick(0, 1); assert.equal(rec.state, 'inactive');
  rec.complete();
  assert.equal(await f.utterances[0].text(), 'tailaudio');
  assert.equal(f.timers.size, 0); f.mic.stop();
});

for (const interruption of ['off', 'suspension', 'restart']) {
  test(`${interruption} during manual tail discards immediately and ignores late tail callbacks`, async () => {
    const f = fixture(); await f.mic.start();
    for (let i = 0; i < 4; i++) f.tick(10);
    f.mic.finishUtterance(); const staleTail = [...f.timers.values()][0].fn;
    if (interruption === 'suspension') { f.allow(false); f.tick(); f.allow(true); }
    else if (interruption === 'restart') await f.mic.start();
    else f.mic.stop();
    assert.equal(f.recorders[0].state, 'inactive');
    staleTail(); f.recorders[0].complete();
    assert.equal(f.utterances.length, 0); assert.equal(f.timers.size, 0);
    if (interruption !== 'off') {
      for (let i = 0; i < 4; i++) f.tick(10);
      f.tick(0, 800); f.recorders[1].complete();
      assert.equal(f.utterances.length, 1);
    }
    f.mic.stop();
  });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { createMicCapture } from '../public/lib/mic-capture.js';

// Deterministic byte-domain RMS, using the same units as mic-capture.test.mjs.
// amplitude 2 => RMS .015625: below .018 start, above old .0117 active cutoff.
function fixture(options = {}) {
  let clock = 0, amplitude = 0, timer, allowed = true;
  const recorders = [], utterances = [], events = [], errors = [], tracks = [];
  const timeouts = new Map(); let nextTimer = 0;
  const stream = () => {
    const track = { stopped: 0, stop() { this.stopped++; }, addEventListener() {} };
    tracks.push(track); return { getTracks: () => [track] };
  };
  const node = () => ({ connect() {}, disconnect() {} });
  class Context {
    state = 'running';
    resume() { return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    createMediaStreamSource() { return node(); }
    createAnalyser() { return { ...node(), getByteTimeDomainData(data) { data.fill(128 + amplitude); } }; }
    createDelay() { return { ...node(), delayTime: {} }; }
    createMediaStreamDestination() { return { ...node(), stream: stream() }; }
  }
  class Recorder {
    static isTypeSupported() { return true; }
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; this.stopCalls = 0; recorders.push(this); }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.stopCalls++; }
    complete(payload = 'audio') { this.ondataavailable?.({ data: new Blob([payload]) }); this.onstop?.(); }
  }
  const mic = createMicCapture({
    getUserMedia: async () => stream(), AudioContextClass: Context, Recorder,
    setTick: fn => { timer = fn; return 1; }, clearTick: () => { timer = null; }, now: () => clock,
    setTimer: (fn, ms) => { const id = ++nextTimer; timeouts.set(id, { fn, due: clock + ms }); return id; },
    clearTimer: id => timeouts.delete(id),
    onSpeechStart: () => events.push('start'), onSpeechEnd: () => events.push('end'),
    onUtterance: blob => utterances.push(blob), onError: error => errors.push(error),
    canCapture: () => allowed, ...options,
  });
  return { mic, recorders, utterances, events, errors, tracks,
    allow(value) { allowed = value; },
    advance(value, duration) {
      assert.equal(duration % 50, 0);
      for (let elapsed = 0; elapsed < duration; elapsed += 50) {
        amplitude = value; clock += 50; timer?.();
        for (const [id, task] of [...timeouts]) {
          if (task.due <= clock && timeouts.delete(id)) task.fn();
        }
      }
    },
  };
}
async function started(t, options) {
  const f = fixture(options); t.after(() => f.mic.stop());
  assert.equal(await f.mic.start(), true); return f;
}

for (const learnedFloor of [null, 1, 2]) {
  test(`speech endpoints with nonzero residual floor (learned=${learnedFloor})`, async t => {
    const f = await started(t);
    if (learnedFloor !== null) f.advance(learnedFloor, 3000);
    assert.equal(f.recorders.length, 0, 'ambient floor must not create an utterance');
    f.advance(10, 400);
    assert.equal(f.events.filter(e => e === 'start').length, 1);
    f.advance(2, 1000);
    assert.equal(f.recorders[0].stopCalls, 1, 'residual noise must not hold recording open');
    assert.equal(f.mic.snapshot().recording, false);
    assert.equal(f.utterances.length, 0, 'wait for recorder data before delivery');
    f.recorders[0].complete();
    assert.equal(f.utterances.length, 1);
    assert.equal(f.errors.length, 0);
  });
}

test('short nonzero pause preserves utterance; trailing nonzero silence ends it', async t => {
  const f = await started(t);
  f.advance(10, 400); f.advance(2, 350);
  assert.equal(f.recorders[0].stopCalls, 0, 'do not truncate a normal short pause');
  f.advance(10, 300); f.advance(2, 1000);
  assert.equal(f.recorders.length, 1);
  assert.equal(f.recorders[0].stopCalls, 1);
  f.recorders[0].complete(); assert.equal(f.utterances.length, 1);
});

test('continuous below-start ambient noise stays idle after a bounded endpoint', async t => {
  const f = await started(t);
  f.advance(10, 400); f.advance(2, 1500);
  assert.equal(f.recorders[0].stopCalls, 1, 'endpoint must occur well before 25s cap');
  f.recorders[0].complete(); f.advance(2, 30000);
  assert.equal(f.recorders.length, 1, 'ambient tail must not repeatedly reopen recordings');
  assert.equal(f.utterances.length, 1);
});

test('sustained loud input still has a finite maximum capture duration', async t => {
  const f = await started(t, { maxUtteranceMs: 1500 });
  f.advance(10, 1500); assert.equal(f.recorders[0].stopCalls, 0);
  f.advance(10, 50); assert.equal(f.recorders[0].stopCalls, 1);
  assert.equal(f.mic.snapshot().recording, false);
  f.recorders[0].complete(); assert.equal(f.utterances.length, 1);
});

test('speech end fires once at endpoint, not after asynchronous recorder completion', async t => {
  const f = await started(t);
  f.advance(10, 400); f.advance(0, 1000);
  assert.deepEqual(f.events, ['start', 'end']);
  f.advance(0, 2000); assert.deepEqual(f.events, ['start', 'end']);
  f.recorders[0].complete(); f.mic.stop();
  assert.deepEqual(f.events, ['start', 'end']);
  assert.equal(f.utterances.length, 1);
});

test('unconfirmed short noise produces neither speech-end event nor upload', async t => {
  const f = await started(t);
  f.advance(10, 100); f.advance(0, 1000); f.recorders[0].complete();
  assert.deepEqual(f.events, []); assert.equal(f.utterances.length, 0);
});

for (const cancellation of ['stop', 'capture gate']) {
  test(`${cancellation} during recorder stop discards late audio without repeated speech end`, async t => {
    const f = await started(t);
    f.advance(10, 400); f.advance(0, 1000);
    assert.equal(f.recorders[0].stopCalls, 1);
    if (cancellation === 'stop') f.mic.stop();
    else { f.allow(false); f.advance(0, 50); f.allow(true); }
    f.recorders[0].complete();
    assert.equal(f.utterances.length, 0);
    assert.deepEqual(f.events, ['start', 'end']);
    assert.equal(f.recorders[0].stopCalls, 1);
  });
}


test('manual finish closes announced speech once and waits for final data', async t => {
  const f = await started(t);
  assert.equal(f.mic.finishUtterance(), false, 'idle finish is a no-op');
  f.advance(10, 400);
  assert.equal(f.mic.finishUtterance(), true);
  assert.deepEqual(f.events, ['start', 'end']);
  assert.equal(f.mic.snapshot().finishing, true);
  assert.equal(f.mic.finishUtterance(), false, 'pending finish cannot stop twice');
  assert.equal(f.recorders[0].stopCalls, 0, 'manual finish preserves the delayed audio tail');
  f.advance(0, 150); assert.equal(f.recorders[0].stopCalls, 0);
  f.advance(0, 50);
  assert.equal(f.recorders[0].stopCalls, 1); assert.equal(f.utterances.length, 0);
  f.recorders[0].complete();
  assert.equal(f.mic.snapshot().finishing, false);
  assert.equal(f.utterances.length, 1);
  f.advance(0, 3500); assert.equal(f.errors.length, 0, 'successful onstop clears watchdog');
});

test('stalled recorder onstop expires 3000ms after the delayed stop and rejects late audio', async t => {
  const f = await started(t);
  f.advance(10, 400); f.mic.finishUtterance();
  f.advance(0, 200); assert.equal(f.recorders[0].stopCalls, 1);
  f.advance(0, 2950); assert.equal(f.errors.length, 0);
  assert.equal(f.mic.snapshot().finishing, true);
  f.advance(0, 50);
  assert.equal(f.errors.length, 1);
  assert.equal(f.mic.snapshot().active, false);
  assert.equal(f.mic.snapshot().finishing, false);
  assert.ok(f.tracks.every(track => track.stopped > 0));
  f.recorders[0].complete(); f.advance(0, 5000);
  assert.equal(f.utterances.length, 0); assert.equal(f.errors.length, 1);
  assert.deepEqual(f.events, ['start', 'end']);
});

for (const cancellation of ['stop', 'capture gate']) {
  test(`${cancellation} during active speech ends it once and suppresses watchdog`, async t => {
    const f = await started(t); f.advance(10, 400);
    if (cancellation === 'stop') f.mic.stop();
    else { f.allow(false); f.advance(0, 50); f.allow(true); }
    assert.deepEqual(f.events, ['start', 'end']);
    f.recorders[0].complete(); f.advance(0, 3500);
    assert.equal(f.utterances.length, 0); assert.equal(f.errors.length, 0);
    assert.deepEqual(f.events, ['start', 'end']);
  });
}


test('learned-floor start-ineligible tail above absolute minimum also endpoints', async t => {
  const f = await started(t);
  f.advance(2, 3000); // Learns RMS floor ~.0141; onset threshold ~.0395.
  f.advance(10, 400);
  f.advance(4, 1000); // RMS .03125: below onset but above old hysteresis cutoff.
  assert.equal(f.recorders[0].stopCalls, 1);
  f.recorders[0].complete(); f.advance(4, 3000);
  assert.equal(f.recorders.length, 1); assert.equal(f.utterances.length, 1);
});

test('900ms followup quiet interval preserves short pause without prolonging final tail', async t => {
  const f = await started(t, { silenceMs: () => 900 });
  f.advance(10, 400); f.advance(2, 850);
  assert.equal(f.recorders[0].stopCalls, 0);
  f.advance(2, 50); assert.equal(f.recorders[0].stopCalls, 1);
  assert.deepEqual(f.events, ['start', 'end']);
  f.recorders[0].complete(); assert.equal(f.utterances.length, 1);
});


test('empty completed speech fails closed instead of holding a pending utterance', async t => {
  const f = await started(t);
  f.advance(10, 400); f.mic.finishUtterance(); f.advance(0, 200); f.recorders[0].complete('');
  assert.equal(f.utterances.length, 0);
  assert.equal(f.errors.length, 1);
  assert.equal(f.mic.snapshot().active, false);
  assert.equal(f.mic.snapshot().finishing, false);
  assert.ok(f.tracks.every(track => track.stopped > 0));
  assert.deepEqual(f.events, ['start', 'end']);
  f.advance(0, 3500); assert.equal(f.errors.length, 1, 'empty result clears watchdog');
});

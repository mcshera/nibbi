import test from 'node:test';
import assert from 'node:assert/strict';
import { createWakeVoice, parseWakePhrase, WAKE_GREETING } from '../public/lib/wake-voice.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
function fixture(overrides = {}) {
  const sent = [], greetings = [], states = [], errors = [], timers = new Map();
  let id = 0;
  const voice = createWakeVoice({
    transcribe: async (blob) => blob,
    greet: async (text) => { greetings.push(text); },
    send: async (text) => { sent.push(text); },
    onState: (state) => states.push(state),
    onError: (error) => errors.push(error),
    setTimer: (callback, ms) => { const key = ++id; timers.set(key, { callback, ms }); return key; },
    clearTimer: (key) => timers.delete(key),
    ...overrides,
  });
  const expire = () => {
    const active = [...timers.values()]; timers.clear();
    for (const timer of active) timer.callback();
  };
  return { voice, sent, greetings, states, errors, timers, expire };
}

test('wake phrase is anchored, case/punctuation tolerant, with narrow alias', () => {
  for (const text of ['hey nibbi', 'HEY NIBBI!', '  “Hey, Nibbi!” ', 'hey-nibby']) {
    assert.deepEqual(parseWakePhrase(text), { command: '' });
  }
  assert.deepEqual(parseWakePhrase('Hey, Nibbi: what is next?'), { command: 'what is next?' });
  for (const text of ['maybe', 'maybe hey nibbi', 'they nibbi', 'hey nibble', 'hey nibbiish', 'hey nibbi_foo', 'hey nibbié', 'heynibbi', '', null]) {
    assert.equal(parseWakePhrase(text), null, String(text));
  }
});

test('off gate, ambient ignores, wake greets once, following command sends and rearms', async () => {
  const f = fixture();
  assert.deepEqual(f.voice.snapshot(), { enabled: false, phase: 'off' });
  await f.voice.submit('hey nibbi');
  assert.equal(f.greetings.length, 0);
  f.voice.enable();
  await f.voice.submit('ordinary room conversation');
  assert.equal(f.voice.snapshot().phase, 'armed');
  assert.equal(f.greetings.length, 0);
  await f.voice.submit('hey nibbi');
  assert.deepEqual(f.greetings, ["What's up, Matty?"]);
  assert.equal(f.voice.snapshot().phase, 'listening');
  assert.equal([...f.timers.values()][0].ms, 12000);
  await f.voice.submit('Hey Nibbi, show my tasks');
  assert.deepEqual(f.sent, ['show my tasks']);
  assert.equal(f.greetings.length, 1);
  assert.equal(f.voice.snapshot().phase, 'armed');
  assert.equal(f.timers.size, 0);
  assert.ok(f.states.every(s => Object.keys(s).join(',') === 'enabled,phase'));
});

test('inline command sends only after greeting resolves', async () => {
  const greeting = deferred();
  const f = fixture({ greet: () => greeting.promise });
  f.voice.enable();
  const job = f.voice.submit('hey nibbi, help me plan');
  await flush();
  assert.equal(f.voice.snapshot().phase, 'greeting');
  assert.deepEqual(f.sent, []);
  greeting.resolve(); await job;
  assert.deepEqual(f.sent, ['help me plan']);
  assert.equal(f.voice.snapshot().phase, 'armed');
});

test('listening silence/repeated wake stays listening, timeout rearms, hold cancels timeout', async () => {
  const f = fixture({ followupMs: 123 });
  f.voice.enable();
  f.voice.holdFollowup();
  await f.voice.submit('hey nibbi');
  assert.equal([...f.timers.values()][0].ms, 123);
  await f.voice.submit('   ');
  await f.voice.submit('HEY NIBBI');
  assert.equal(f.voice.snapshot().phase, 'listening');
  assert.equal(f.greetings.length, 1);
  f.voice.holdFollowup();
  assert.equal(f.timers.size, 0);
  f.expire();
  assert.equal(f.voice.snapshot().phase, 'listening');
  await f.voice.submit('');
  f.expire();
  assert.equal(f.voice.snapshot().phase, 'armed');
  assert.deepEqual(f.sent, []);
});

test('STT is single flight; submits during greeting and sending are ignored', async () => {
  const stt = deferred(), greeting = deferred(), sending = deferred();
  let calls = 0;
  const f = fixture({ transcribe: () => { calls++; return stt.promise; }, greet: () => greeting.promise, send: () => sending.promise });
  f.voice.enable();
  const job = f.voice.submit('blob');
  await f.voice.submit('duplicate');
  assert.equal(calls, 1);
  stt.resolve('hey nibbi, do this'); await flush();
  await f.voice.submit('duplicate'); assert.equal(calls, 1);
  greeting.resolve(); await flush();
  assert.equal(f.voice.snapshot().phase, 'sending');
  await f.voice.submit('duplicate'); assert.equal(calls, 1);
  sending.resolve(); await job;
  assert.equal(f.voice.snapshot().phase, 'armed');
});

for (const at of ['transcribing', 'greeting', 'listening', 'sending']) {
  for (const action of ['disable', 'suspend']) {
    test(`${action} during ${at} aborts/invalidates late work`, async () => {
      const pending = deferred(); let signal;
      const f = fixture({
        ...(at === 'transcribing' ? { transcribe: (_, s) => { signal = s; return pending.promise; } } : {}),
        ...(at === 'greeting' ? { greet: (_, s) => { signal = s; return pending.promise; } } : {}),
        ...(at === 'sending' ? { send: () => pending.promise } : {}),
      });
      f.voice.enable();
      const job = f.voice.submit(at === 'listening' ? 'hey nibbi' : 'hey nibbi, command');
      await flush();
      assert.equal(f.voice.snapshot().phase, at);
      if (action === 'disable') f.voice.disable(); else f.voice.setSuspended(true);
      assert.deepEqual(f.voice.snapshot(), { enabled: action !== 'disable', phase: action === 'disable' ? 'off' : 'paused' });
      if (signal) assert.equal(signal.aborted, true);
      assert.equal(f.timers.size, 0);
      await f.voice.submit('hey nibbi, should not run');
      pending.resolve('hey nibbi, stale'); await job;
      assert.deepEqual(f.sent, []);
      assert.equal(f.voice.snapshot().phase, action === 'disable' ? 'off' : 'paused');
      if (action === 'disable') f.voice.enable(); else f.voice.setSuspended(false);
      assert.equal(f.voice.snapshot().phase, 'armed');
    });
  }
}

test('rapid disable/re-enable isolates pending generations and stale finally', async () => {
  const old = deferred(), fresh = deferred(); let calls = 0;
  const f = fixture({ transcribe: () => (++calls === 1 ? old.promise : fresh.promise) });
  f.voice.enable();
  const stale = f.voice.submit('old');
  f.voice.disable(); f.voice.enable();
  const current = f.voice.submit('fresh');
  old.resolve('hey nibbi, stale command'); await stale;
  assert.equal(f.voice.snapshot().phase, 'transcribing');
  await f.voice.submit('extra'); assert.equal(calls, 2);
  fresh.resolve('hey nibbi, current command'); await current;
  assert.deepEqual(f.sent, ['current command']);
  assert.deepEqual(f.greetings, [WAKE_GREETING]);
});

test('greeting failure reports and listens instead of faking inline success', async () => {
  const error = new Error('speaker unavailable');
  const f = fixture({ greet: async () => { throw error; } });
  f.voice.enable(); await f.voice.submit('hey nibbi, inline');
  assert.deepEqual(f.errors, [error]);
  assert.deepEqual(f.sent, []);
  assert.equal(f.voice.snapshot().phase, 'listening');
  await f.voice.submit('next command');
  assert.deepEqual(f.sent, ['next command']);
});

test('provider errors recover, AbortError is quiet, observer errors cannot wedge state', async () => {
  const error = new Error('STT failed');
  const f = fixture({ transcribe: async () => { throw error; } });
  f.voice.enable(); await f.voice.submit('blob');
  assert.deepEqual(f.errors, [error]);
  assert.equal(f.voice.snapshot().phase, 'armed');
  const g = fixture({ transcribe: async () => { throw new DOMException('stopped', 'AbortError'); } });
  g.voice.enable(); await g.voice.submit('blob');
  assert.deepEqual(g.errors, []);
  const h = fixture({ onState: () => { throw error; }, onError: () => { throw error; } });
  h.voice.enable(); await h.voice.submit('hey nibbi, command');
  assert.deepEqual(h.sent, ['command']);
  assert.equal(h.voice.snapshot().phase, 'armed');
  const i = fixture({ send: async () => { throw error; } });
  i.voice.enable(); await i.voice.submit('hey nibbi, command');
  assert.deepEqual(i.errors, [error]);
  assert.equal(i.voice.snapshot().phase, 'armed');
});

test('suspension persists through enable, and callback suspension blocks sends', async () => {
  const f = fixture();
  f.voice.setSuspended(true); f.voice.enable();
  assert.deepEqual(f.voice.snapshot(), { enabled: true, phase: 'paused' });
  await f.voice.submit('hey nibbi, nope');
  assert.deepEqual(f.sent, []);
  f.voice.setSuspended(false);
  await f.voice.submit('plain ambient');
  assert.deepEqual(f.sent, []);
  let voice;
  const g = fixture({ onState: ({ phase }) => { if (phase === 'sending') voice.setSuspended(true); } });
  voice = g.voice; voice.enable(); await voice.submit('hey nibbi, no');
  assert.deepEqual(g.sent, []);
  assert.equal(voice.snapshot().phase, 'paused');
});


test('failed followup transcription restarts timeout after speech hold', async () => {
  let calls = 0;
  const error = new Error('local transcription failed');
  const f = fixture({ transcribe: async () => { if (++calls === 1) return 'hey nibbi'; throw error; } });
  f.voice.enable(); await f.voice.submit('wake');
  f.voice.holdFollowup();
  assert.equal(f.timers.size, 0);
  await f.voice.submit('failed');
  assert.deepEqual(f.errors, [error]);
  assert.equal(f.voice.snapshot().phase, 'listening');
  assert.equal(f.timers.size, 1);
  f.expire();
  assert.equal(f.voice.snapshot().phase, 'armed');
});

test('stale rejection after suspension/resume stays quiet and cannot change fresh state', async () => {
  const old = deferred(); let calls = 0;
  const f = fixture({ transcribe: async () => { if (++calls === 1) return old.promise; return 'hey nibbi'; } });
  f.voice.enable(); const pending = f.voice.submit('old');
  f.voice.setSuspended(true); f.voice.setSuspended(false);
  await f.voice.submit('fresh');
  old.reject(new Error('late provider failure')); await pending;
  assert.equal(f.voice.snapshot().phase, 'listening');
  assert.deepEqual(f.errors, []);
  assert.deepEqual(f.greetings, [WAKE_GREETING]);
});

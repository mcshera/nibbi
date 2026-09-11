import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoicePlayer } from '../public/lib/voice-player.js';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
function fixture(overrides = {}) {
  const contexts = [], sources = [], requests = [], ticks = new Map(), timers = new Map();
  let starts = 0, ends = 0, id = 0;
  class Context {
    constructor() { contexts.push(this); this.destination = {}; }
    resume() { return overrides.resume ? overrides.resume() : Promise.resolve(); }
    decodeAudioData() { return overrides.decode ? overrides.decode() : Promise.resolve({}); }
    createBufferSource() {
      const s = { connect() {}, disconnect() { this.disconnected = true; }, start() { this.started = true; }, stop() { this.stopped = true; } };
      sources.push(s); return s;
    }
    createAnalyser() { return { connect() {}, disconnect() {}, getByteTimeDomainData(data) { data.fill(128); } }; }
  }
  const response = { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
  const player = createVoicePlayer({
    AudioContextClass: Context,
    fetchAudio: (url, options) => { requests.push({ url, ...options }); return overrides.fetch ? overrides.fetch(url, options) : Promise.resolve(response); },
    onStart: () => { starts++; }, onEnd: () => { ends++; },
    setTick: fn => { const key = ++id; ticks.set(key, fn); return key; }, clearTick: key => ticks.delete(key),
    setTimer: (fn, ms) => { const key = ++id; timers.set(key, { fn, ms }); return key; }, clearTimer: key => timers.delete(key),
  });
  return { player, contexts, sources, requests, ticks, timers, response, get starts() { return starts; }, get ends() { return ends; } };
}

test('play fetches local voice, ends cleanly, reuses unlocked audio context', async () => {
  const f = fixture(); await f.player.unlock();
  const job = f.player.play("What's up, Matty?"); await flush();
  assert.equal(f.contexts.length, 1); assert.equal(f.starts, 1);
  assert.equal(f.requests[0].url, '/api/say?text=' + encodeURIComponent("What's up, Matty?"));
  assert.equal(f.requests[0].cache, 'no-store');
  f.sources[0].onended(); await job;
  assert.equal(f.ends, 1); assert.equal(f.ticks.size, 0); assert.equal(f.sources[0].disconnected, true);
});

test('stop aborts pending fetch and ignores response arriving late', async () => {
  const pending = deferred(); const f = fixture({ fetch: () => pending.promise });
  const job = f.player.play('hello'); const rejected = assert.rejects(job, { name: 'AbortError' });
  await flush(); f.player.stop();
  assert.equal(f.requests[0].signal.aborted, true);
  pending.resolve(f.response); await rejected;
  assert.equal(f.starts, 0); assert.equal(f.ends, 1); assert.equal(f.sources.length, 0);
});

test('stop during decode prevents source creation after late decode completion', async () => {
  const pending = deferred(); const f = fixture({ decode: () => pending.promise });
  const job = f.player.play('hello'); const rejected = assert.rejects(job, { name: 'AbortError' });
  await flush(); f.player.stop(); pending.resolve({}); await rejected;
  assert.equal(f.starts, 0); assert.equal(f.sources.length, 0);
});

test('stop during playback cleans up, late ended callback cannot finish replacement', async () => {
  const f = fixture();
  const old = f.player.play('old'); const rejected = assert.rejects(old, { name: 'AbortError' });
  await flush(); const lateEnd = f.sources[0].onended;
  const current = f.player.play('new'); await flush(); await rejected;
  assert.equal(f.sources[0].stopped, true); assert.equal(f.sources[0].disconnected, true);
  assert.equal(f.ends, 0); assert.equal(f.starts, 2);
  lateEnd(); await flush(); assert.equal(f.ends, 0);
  f.sources[1].onended(); await current;
  assert.equal(f.ends, 1); assert.equal(f.ticks.size, 0);
});

test('external abort before and during playback suppresses/ends output', async () => {
  const f = fixture(); const early = new AbortController(); early.abort();
  await assert.rejects(f.player.play('no', early.signal), { name: 'AbortError' });
  assert.equal(f.requests.length, 0);
  const live = new AbortController();
  const job = f.player.play('yes', live.signal); const rejected = assert.rejects(job, { name: 'AbortError' });
  await flush(); live.abort(); await rejected;
  assert.equal(f.sources[0].stopped, true); assert.equal(f.ticks.size, 0);
});

test('late old fetch cannot create source or end a replacement playback', async () => {
  const pending = deferred(); let calls = 0;
  const f = fixture({ fetch: () => (++calls === 1 ? pending.promise : Promise.resolve(f.response)) });
  const old = f.player.play('old'); const rejected = assert.rejects(old, { name: 'AbortError' });
  await flush(); const fresh = f.player.play('fresh'); await flush();
  pending.resolve(f.response); await rejected;
  assert.equal(f.sources.length, 1); assert.equal(f.starts, 1); assert.equal(f.ends, 0);
  f.sources[0].onended(); await fresh; assert.equal(f.ends, 1);
});

test('failed voice response reports failure without onStart', async () => {
  const f = fixture({ fetch: async () => ({ ok: false }) });
  await assert.rejects(f.player.play('hello'), /voice is unavailable/);
  assert.equal(f.starts, 0); assert.equal(f.ends, 1); assert.equal(f.ticks.size, 0);
});


for (const stage of ['resume', 'decode']) for (const reason of ['stop', 'watchdog']) {
  test(`${reason} settles unresolved ${stage}; stale resolution cannot affect replacement`, async () => {
    const pending = deferred(); let calls = 0;
    const f = fixture({ [stage]: () => ++calls === 1 ? pending.promise : Promise.resolve(stage === 'decode' ? {} : undefined) });
    let settled = false;
    const old = f.player.play('old');
    const rejected = assert.rejects(old, reason === 'stop' ? { name: 'AbortError' } : /took too long/).then(() => { settled = true; });
    await flush();
    if (reason === 'stop') f.player.stop();
    else {
      const watchdog = [...f.timers.values()][0]; assert.equal(watchdog.ms, 30000); watchdog.fn();
    }
    await flush();
    // Do not resolve the native promise to make cancellation pass.
    assert.equal(settled, true); await rejected;
    assert.equal(f.starts, 0); assert.equal(f.ends, 1); assert.equal(f.timers.size, 0);
    const fresh = f.player.play('fresh'); await flush();
    assert.equal(f.sources.length, 1); assert.equal(f.starts, 1);
    pending.resolve(stage === 'decode' ? {} : undefined); await flush();
    assert.equal(f.sources.length, 1); assert.equal(f.ends, 1);
    assert.equal(f.sources[0].stopped, undefined);
    f.sources[0].onended(); await fresh;
    assert.equal(f.ends, 2); assert.equal(f.timers.size, 0); assert.equal(f.ticks.size, 0);
  });
}

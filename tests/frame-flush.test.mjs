import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameFlush } from '../public/lib/frame-flush.js';

/** A hand-driven clock: rAF callbacks run when the test says a frame happened, timers when it says
 *  the delay elapsed, so the scheduler is tested without waiting for either. */
function harness({ hidden = () => false } = {}) {
  let nextHandle = 1;
  const frames = new Map(), timers = new Map();
  const drawn = [];
  const flush = createFrameFlush({
    onFlush: () => drawn.push(drawn.length),
    raf: (fn) => { const id = nextHandle++; frames.set(id, fn); return id; },
    caf: (id) => frames.delete(id),
    setTimeout: (fn) => { const id = nextHandle++; timers.set(id, fn); return id; },
    clearTimeout: (id) => timers.delete(id),
    hidden,
  });
  return {
    flush, drawn,
    frame() { const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(); },
    tick() { const pending = [...timers.values()]; timers.clear(); for (const fn of pending) fn(); },
    scheduled: () => frames.size + timers.size,
    timersPending: () => timers.size,
  };
}

test('a burst of marks inside one frame costs one render', () => {
  const h = harness();
  for (let i = 0; i < 40; i++) h.flush.mark();
  assert.equal(h.drawn.length, 0, 'nothing is drawn before the frame');
  assert.equal(h.scheduled(), 1, 'forty marks schedule one callback');
  h.frame();
  assert.equal(h.drawn.length, 1);
});

test('marks in successive frames render once per frame', () => {
  const h = harness();
  h.flush.mark(); h.frame();
  h.flush.mark(); h.frame();
  h.flush.mark(); h.frame();
  assert.equal(h.drawn.length, 3);
});

test('a frame with nothing pending draws nothing', () => {
  const h = harness();
  h.flush.mark(); h.frame();
  h.frame();
  assert.equal(h.drawn.length, 1);
});

test('flushNow draws immediately and cancels the pending frame', () => {
  const h = harness();
  h.flush.mark();
  assert.equal(h.flush.flushNow(), true);
  assert.equal(h.drawn.length, 1);
  assert.equal(h.scheduled(), 0, 'the pending callback was cancelled, not left to fire again');
  h.frame();
  assert.equal(h.drawn.length, 1);
});

test('flushNow with nothing pending draws nothing and says so', () => {
  const h = harness();
  assert.equal(h.flush.flushNow(), false);
  assert.equal(h.drawn.length, 0);
});

test('finish draws what is pending and ignores every later mark', () => {
  const h = harness();
  h.flush.mark();
  h.flush.finish();
  assert.equal(h.drawn.length, 1);
  h.flush.mark();
  assert.equal(h.scheduled(), 0);
  h.frame();
  assert.equal(h.drawn.length, 1, 'the stream is over; nothing more is drawn');
});

test('cancel drops what is pending without drawing it', () => {
  const h = harness();
  h.flush.mark();
  h.flush.cancel();
  h.frame();
  assert.equal(h.drawn.length, 0);
  assert.equal(h.flush.dirty(), false);
  assert.equal(h.flush.done(), true);
});

test('a hidden tab falls back to a timer, and flushNow makes it current', () => {
  let away = true;
  const h = harness({ hidden: () => away });
  h.flush.mark();
  assert.equal(h.timersPending(), 1, 'no frames are coming, so it waits on a timer instead');
  h.frame();
  assert.equal(h.drawn.length, 0);
  h.tick();
  assert.equal(h.drawn.length, 1);
  away = false;
  h.flush.mark();
  assert.equal(h.timersPending(), 0, 'back in view, it schedules a frame again');
  h.flush.flushNow();
  assert.equal(h.drawn.length, 2);
});

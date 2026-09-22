/* lib/frame-flush.js — one render per frame, however many tokens arrived in it.
   No DOM, no state beyond a dirty flag and a handle. Unit-tested in tests/frame-flush.test.mjs.

   A stream does not need to be paced to feel fluid; it needs to never ask for more work than a
   frame can absorb. The caller keeps the text — this only decides when to draw. Scheduling on
   requestAnimationFrame rather than a timer means the render lands with the frame rather than at
   an arbitrary point inside it, and a burst of forty tokens costs one render, not forty.

   A hidden tab stops firing rAF, so marks there fall back to a coarse timer: the text stays within
   about a second of the network for anything that reads the DOM, and flushNow() on the way back
   makes it current before the first frame the reader sees. */
export function createFrameFlush({ onFlush, raf = requestAnimationFrame, caf = cancelAnimationFrame, setTimeout: delay = setTimeout, clearTimeout: undelay = clearTimeout, hidden = () => false, hiddenDelay = 1000 }) {
  let dirty = false, done = false, handle = 0, timed = false;
  const cancelPending = () => { if (!handle) return; (timed ? undelay : caf)(handle); handle = 0; timed = false; };
  const run = () => { handle = 0; timed = false; if (!dirty) return; dirty = false; onFlush(); };
  return {
    mark() {
      if (done) return;
      dirty = true;
      if (handle) return;
      timed = hidden();
      handle = timed ? delay(run, hiddenDelay) : raf(run);
    },
    /** Draw now if anything is pending. Returns whether it drew. */
    flushNow() { cancelPending(); if (!dirty) return false; dirty = false; onFlush(); return true; },
    /** Last draw of this stream; later marks are ignored. */
    finish() { const drew = this.flushNow(); done = true; return drew; },
    /** Drop what is pending without drawing — for a caller about to render different text. */
    cancel() { cancelPending(); dirty = false; done = true; },
    dirty: () => dirty,
    done: () => done,
  };
}

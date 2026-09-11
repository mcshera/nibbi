# Round 3 — technique contract (experimental, not production)

Round 1 drew every option as authored vector shapes sampled from a pure pose function. Round 3 changes the **technique**: each option is a self-contained *live* module (simulation, filter, painter or shader) that the shell drives with `step(dt)`. Same nine moments, same three sizes, same paper.

One standalone ES module at `design/character-lab/round3/techniques/<id>.mjs`. Allowed imports: `../../ink.mjs` (deterministic noise/easing helpers) and `../../actions.mjs`. No other dependencies, no fetch, no timers, no requestAnimationFrame, **no Math.random** (use `ink.rand(seed, i)` / `ink.noise1`). The module may create its own `<canvas>` / `<svg>` / WebGL context inside the host and attach pointer listeners to the host.

```js
import * as ink from '../../ink.mjs';
export const meta = {
  id: 'particles',                       // === file name
  name: 'Particle ink',
  technique: 'one line: the rendering/motion technology (e.g. "4k ink grains attracted to a signed-distance field")',
  tagline: 'one sentence, what it is',
  look: 'what you see (material, edge, eyes)',
  motion: 'how it moves and why it feels different from authored curves',
  eyes: 'how the two eyes are made in this technique',
  risks: ['...'],
  stills: { idle: 2.0, hello: 0.55, listen: 1.2, think: 1.4, work: 1.6, success: 0.7, error: 0.9, sleep: 2.0, tap: 0.25 }, // seconds after cue() at which the sheet takes its still
};

// Mount into an empty <div>. Set host.style.width/height to (3.4R)px × (3.6R)px yourself. Foot line at y = 3.1R, centre column x = 1.7R.
// opts: { R = 96, seed = 1, tint = null, reduced = false, energy = 1, size = 'hero'|'pill'|'tiny', paper = true }
// Return a controller. The shell calls step(dt) about 60×/s with dt in seconds (clamped ≤ .1); nothing animates unless step() is called.
export function mount(host, opts = {}) {
  return {
    cue(action) {},          // one of the nine moments. One-shots (hello, success, error, tap) return to idle by themselves; loops run until the next cue.
    step(dt) {},             // advance the simulation/animation by dt and draw. Deterministic for a given seed and sequence of calls.
    setReduced(v) {},        // true → converge to a static expression for the current action within 1 s, then produce identical frames (no drift, no noise animation).
    setEnergy(e) {},         // .5..1.5 amplitude
    setTint(c) {},           // null or a CSS colour that replaces the ink colour (companion fixers)
    poke(x, y, kind) {},     // optional programmatic pointer: kind 'down'|'move'|'up'|'tap', coords in host px. The module may also listen to real pointer events on host.
    destroy() {},            // remove listeners and DOM
  };
}
```

## Rules (the goals behind them)

- **Ink on cream paper.** The shell paints nothing; the module paints its own paper unless `paper: false` (then leave the background transparent). Monochrome ink; `tint` replaces ink colour only.
- **Two eyes, no mouth, no limbs** — but the eyes are made *in the technique* (clearings in a swarm, un-inked paper under a filter, two dabs of a brush, highlights on a bead). They need not be the round-1 pip eyes.
- **Quiet idle.** Idle may breathe and drift a little, but no jumping and no constant churn that competes with text.
- **The character carries state.** Each moment must be recognisable in a single frame at hero size and still distinguishable at R = 12. Design the still first.
- **Touch it.** The body must respond physically to pointerdown/drag/up on the host at hero size (that is the point of round 2). Direct play interrupts a cue.
- **Sleep really settles; success is one gesture; error never celebrates; work loops for minutes.**
- **Reduced motion** as above. **Bounds:** stay inside the host. **Cost:** hero step+draw ≲ 4 ms on a laptop; tiny instances must be cheap (fewer particles / no filters / lower resolution).
- The module must survive `mount` at R = 12 and R = 26 and look like the same character.

## Check your technique without the shell

```sh
cd /Users/Matty/Documents/Nibbi
node design/character-lab/round3/tech.test.mjs <id>     # loads the module in a headless browser: mounts 3 sizes, cues every moment, steps, pokes, reduced-motion stability, no errors
node design/character-lab/round3/sheet2.mjs <id>        # writes round3/evidence/sheet-<id>.png (moments × time, plus pill and 24 px)
```

Look at the sheet before you call it done. Do not edit the shell (`index.html`, `lab2.mjs`), `ink.mjs`, or another technique.

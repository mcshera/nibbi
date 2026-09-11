# Round 4 — technique contract (experimental, not production)

Round 2 made Nibbi *live* (particles, soft body, wet-ink filter, brush painter, raymarched bead). Round 3 (a parallel session) stays with the raymarched bead and varies the premise. **Round 4 asks a different question: what other kinds of motion technology could Nibbi be made of?** Five techniques that have never appeared in the lab, each a different class of motion — a cellular automaton, an agent simulation, rigid tiles on springs, strand physics, a mechanical dot display — and each one a *toy*: something you want to poke again.

The API is the round-2 contract, unchanged, so round 4 can be judged with the same tools and against the same nine moments and three sizes.

One standalone ES module at `design/character-lab/round4/techniques/<id>.mjs`. Allowed imports: `../../ink.mjs` (deterministic noise/easing helpers, paper, eyes) and `../../actions.mjs`. No other dependencies, no fetch, no timers, no requestAnimationFrame, **no Math.random** (use `ink.rand(seed, i)` / `ink.noise1` / `ink.hash`). The module may create its own `<canvas>` (2D or WebGL) inside the host and attach pointer listeners to the host.

```js
import * as ink from '../../ink.mjs';
export const meta = {
  id: 'sand',                            // === file name
  name: 'Sandglass',
  technique: 'one line: the motion technology (e.g. "falling-sand cellular automaton, ~4k grains in an invisible mould")',
  tagline: 'one sentence, what it is',
  look: 'what you see (material, edge, eyes)',
  motion: 'how it moves and why it feels different from authored curves',
  eyes: 'how the two eyes are made in this technique',
  fun: ['three or more toy behaviours that are this technique’s own — what a person will do twice', '...', '...'],
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
    poke(x, y, kind) {},     // programmatic pointer: kind 'down'|'move'|'up'|'tap', coords in host px. Also listen to real pointer events on host.
    destroy() {},            // remove listeners and DOM
  };
}
```

## Rules (the goals behind them)

- **Ink on cream paper.** The shell paints nothing; the module paints its own paper (`ink.paper(ctx, W, H, { grain: 0 })`) unless `paper: false` (then leave the background transparent). Monochrome ink; `tint` replaces ink colour only (`ink.inkColor(tint)`).
- **Two eyes, no mouth, no limbs.** The eyes are the identity: two oversized, separate, low-set eyes with dark pupils (see `ink.EYES` / `ink.eyes()` for the canonical placement: centres at x = ±0.26R, y ≈ +0.09R from the body centre, radius ≈ 0.22R, pupils ≈ 0.12R). Make them *in the technique* (cells the grains cannot enter, a clearing in the lace, un-inked tiles, a bald patch in the fur, unflipped dots) — but at every size the two eyes must read at a glance. Gaze may shift: think looks up-left, listen looks toward the person (left), work looks down, error looks down, sleep closes.
- **Quiet idle.** Idle may breathe and drift a little, but no jumping and no constant churn that competes with text (the harness fails idle if the mean pixel change over 2 s exceeds .02).
- **The character carries state.** Each moment must be recognisable in a single frame at hero size and still distinguishable at R = 12. Design the still first, then the motion into it.
- **Fun is a requirement.** Each technique must own at least three toy behaviours (`meta.fun`): things that only this technology can do, that a person will want to trigger twice. Touch is the first one: pointerdown / drag / up on the host must do something physical and specific to the technique (grains scatter, tiles shove, strands ruffle, dots flip under the finger). Direct play interrupts a cue.
- **Sleep really settles; success is one gesture; error never celebrates; work loops for minutes.**
- **Reduced motion** as above: converge to a still and hold it pixel-identical. **Bounds:** stay inside the host. **Cost:** hero step+draw ≲ 4 ms on a laptop (the harness fails at 8 ms); pill and tiny instances must be cheap (fewer cells/agents/strands/dots, lower resolution). The lab mounts about 30 instances at once.
- The module must survive `mount` at R = 12 and R = 26 and look like the same character. At R = 12 it is acceptable to simplify the technique (fewer elements, or a direct silhouette + eyes) as long as the state reads.
- Deterministic: same seed + same sequence of `cue/step/poke` → same frames. Use `ink.rand(seed, i)` with a counter, never `Math.random`.

## Check your technique without the shell

```sh
cd /Users/Matty/Documents/Nibbi
node design/character-lab/round4/tech.test.mjs <id>     # loads the module in a headless browser: mounts 3 sizes, cues every moment, steps, pokes, reduced-motion stability, no errors, perf
node design/character-lab/round4/sheet4.mjs <id>        # writes round4/evidence/sheet-<id>.png (moments × time, plus pill and 24 px) — look at it before you call it done
node design/character-lab/round4/sheet4.mjs <id> --reduced   # the reduced-motion stills
```

Look at the sheet before you call it done. Do not edit the shell (`index.html`, `lab4.mjs`), the tools, `ink.mjs`, or another technique.

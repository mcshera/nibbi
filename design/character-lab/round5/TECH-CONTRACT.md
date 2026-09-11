# Round 5 — technique contract (experimental, not production)

Round 1 varied the style. Round 2 made Nibbi live. Round 3 kept the bead and varied the premise. Round 4 asked which technology is a toy. **Round 5 asks one question: what makes a body read as thoughtful?** Five versions, each built around one faculty of a thoughtful companion — attention, deliberation, memory, focus, patience — and judged on the moments where thoughtfulness shows: listen, think, work, error, and the beat between them.

The API is the round-2/4 contract, unchanged, so round 5 can be judged with the same tools and against rounds 2–4. One field changes: `meta.fun` (toy behaviours) becomes `meta.thoughtful` (what this body does that a thoughtless body would not).

One standalone ES module at `design/character-lab/round5/techniques/<id>.mjs`. Allowed imports: `../../ink.mjs` and `../../actions.mjs`. No other dependencies, no fetch, no timers, no requestAnimationFrame, **no Math.random** (use `ink.rand(seed, i)` / `ink.noise1` / `ink.hash`). The module may create its own `<canvas>` inside the host and attach pointer listeners to the host.

```js
import * as ink from '../../ink.mjs';
export const meta = {
  id: 'regard',                          // === file name
  name: 'Regard',
  faculty: 'attention',                  // the one faculty this version is built around (attention · deliberation · memory · focus · patience)
  technique: 'one line: what the body is made of and what drives it',
  tagline: 'one sentence, what it is',
  look: 'what you see (material, edge, eyes)',
  motion: 'how it moves, and what its idea of a pause is',
  eyes: 'how the two eyes are made and what they do that is specific to this version',
  thoughtful: ['three or more behaviours that show attention, consideration or restraint — things a thoughtless body would not do', '...', '...'],
  risks: ['...'],
  stills: { idle: 2.0, hello: 0.55, listen: 1.2, think: 1.4, work: 1.6, success: 0.7, error: 0.9, sleep: 2.0, tap: 0.25 }, // seconds after cue() at which the sheet takes its still
};

// Mount into an empty <div>. Set host.style.width/height to (3.4R)px × (3.6R)px yourself. Foot line at y = 3.1R, centre column x = 1.7R.
// opts: { R = 96, seed = 1, tint = null, reduced = false, energy = 1, size = 'hero'|'pill'|'tiny', paper = true }
// Return a controller. The shell calls step(dt) about 60×/s with dt in seconds (clamped ≤ .1); nothing animates unless step() is called.
export function mount(host, opts = {}) {
  return {
    cue(action) {},          // one of the nine moments. One-shots (hello, success, error, tap) return to idle by themselves; loops run until the next cue.
    step(dt) {},             // advance and draw. Deterministic for a given seed and sequence of calls.
    setReduced(v) {},        // true → converge to a static expression for the current action within 1 s, then produce identical frames.
    setEnergy(e) {},         // .5..1.5 amplitude
    setTint(c) {},           // null or a CSS colour that replaces the ink colour (companion fixers)
    poke(x, y, kind) {},     // programmatic pointer: kind 'down'|'move'|'up'|'tap', coords in host px. Also listen to real pointer events on host.
    destroy() {},            // remove listeners and DOM
  };
}
```

## Rules (the goals behind them)

- **Ink on cream paper.** The module paints its own paper (`ink.paper(ctx, W, H, { grain: 0 })`) unless `paper: false`. Monochrome ink; `tint` replaces ink colour only (`ink.inkColor(tint)`). Tonal range is allowed where the material earns it (a lit matte object, a wash) but the core of the body stays ink-dark.
- **Two eyes, no mouth, no limbs.** Canonical placement in `ink.EYES`: centres at x = ±0.26R, y ≈ +0.09R from the body centre, radius ≈ 0.22R, pupils ≈ 0.12R. Lids are part of the eyes and are allowed. At every size the two eyes must read at a glance.
- **The person is to the left.** Listen leans, looks or turns toward the left (where the conversation text sits beside a 24 px avatar). The harness measures it: the ink centroid at listen's still must sit ≥ 0.05R left of idle's.
- **A beat before a response.** Eyes first, body second. On a cue the body may take up to ~250 ms to move; the eyes may move at once. The harness reports the beat (time until the first visible change after `cue('hello')`); it does not gate it.
- **No fidgeting.** Idle, listen and think may breathe, blink and shift gaze; they must not churn. Mean pixel change over 2 s: idle ≤ .02, listen ≤ .02, think ≤ .025, work ≤ .03. Work loops for minutes and must stay watchable beside text.
- **The character carries state.** Each moment must be recognisable in a single frame at hero size and still distinguishable at R = 12. Design the still first, then the motion into it.
- **Sleep really settles; success is one gesture; error never celebrates.** Error is owned: after the failure lands, the body returns its attention to the person rather than hiding.
- **Reduced motion:** converge to a still and hold it pixel-identical. **Bounds:** stay inside the host. **Cost:** hero step+draw ≲ 4 ms on a laptop (the harness fails at 8 ms); pill and tiny instances must be cheap. The lab mounts about 30 instances at once.
- The module must survive `mount` at R = 12 and R = 26 and look like the same character. At R = 12 it is acceptable to simplify the technique as long as the state reads.
- Deterministic: same seed + same sequence of `cue/step/poke` → same frames.

## Check your version without the shell

```sh
cd /Users/Matty/Documents/Nibbi
node design/character-lab/round5/tech.test.mjs <id>     # headless: mounts 3 sizes, cues every moment, measures attention, calm, the beat, reduced motion, touch, tint, perf
node design/character-lab/round5/sheet5.mjs <id>        # writes round5/evidence/sheet-<id>.png (moments × time, plus pill and 24 px) — look at it before you call it done
node design/character-lab/round5/sheet5.mjs <id> --reduced
```

Look at the sheet before you call it done. Do not edit the shell (`index.html`, `lab5.mjs`), the tools, `ink.mjs`, or another version.

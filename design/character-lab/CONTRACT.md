# Character lab option contract (experimental, not production)

Every option is ONE standalone ES module at `design/character-lab/options/<id>.mjs`. No dependencies except `../ink.mjs` and `../actions.mjs`. No DOM, timers, RAF, globals, fetch, or event listeners. Deterministic: same inputs → same drawing. Never mutate inputs. Nothing under `public/` or any production file is touched.

```js
import * as ink from '../ink.mjs';          // helpers: noise, easing, blobPoints, fuzzyFill, eyes, brushStroke, penLine, hatch, tornPoints, specks, bleedRing, poseTransform, mapPoint, bounds
import { ACTION_IDS } from '../actions.mjs'; // 'idle','hello','listen','think','work','success','error','sleep','tap'

export const meta = {
  id: 'inkdrop',                 // === file name
  name: 'Inkdrop',               // short display name
  tagline: 'one sentence, what it is',
  material: 'what the body is made of and how it is drawn',
  grammar: 'how it moves: timing, physics, transitions, idle rule',
  feeling: '3–5 words',
  risks: ['...', '...'],
};

// Optional: the signature still per action, as a fraction of its duration (default .45). The matrix and the
// legibility checks sample here. Declare it where the state is most readable in one frame.
export const stillAt = { hello: .3, error: .7 };

// Seconds. Loops (idle, listen, think, work, sleep) return one loop period and must be continuous:
// sample(id, 0) ≈ sample(id, durationFor(id)). One-shots (hello, success, error, tap) include the return to rest.
export function durationFor(action) {}

// Pure. t = seconds since the action started. energy 0.5..1.5 scales amplitude, never timing sanity.
// reduced=true → a spatially static expression for that action, identical for every t (no motion, no flashing).
// Returns a JSON-safe object. It MUST contain the shared rig fields (R units, foot-anchored, lift positive up):
//   x, lift, sx, sy, rotate, eyeX, eyeY, blink (0 open..1 closed), wide (eye scale), happy (0..1), phase (string)
// plus any style-specific fields you need for render(). Every number finite.
export function sample(action, t, { energy = 1, reduced = false } = {}) {}

// Draw the character onto a Canvas2D context. 1 unit = 1 CSS px (the lab already scaled for DPR).
// The lab has painted the paper; do NOT clear or paint a background. Use ctx.save()/restore(); leave state balanced.
// R = base body radius in px. (footX, footY) = the planted foot point on the canvas; the rest body centre is at footY - 0.66R.
// time = global seconds for ambient texture (boil, drift). With reduced=true you must ignore time completely.
// tint = null or a CSS colour that REPLACES the ink colour (used for companion fixers). size = 'hero' | 'pill' | 'tiny'.
// At 'pill' (R≈26) and 'tiny' (R≈12) drop fine detail (halos, hatching, bristles, specks) and keep eyes/ink legible.
export function render(ctx, state, { R, footX, footY, time = 0, reduced = false, tint = null, size = 'hero' }) {}

// Diagnostics in canvas px for the same inputs render() would draw with:
// { bounds: {left, top, right, bottom}, eyes: [{cx, cy, rx, ry}, {cx, cy, rx, ry}], faceContained: boolean }
// bounds = ink extent of the body (approximate is fine, transient specks may be excluded). faceContained = both eye whites inside the body ink.
export function geometry(state, { R, footX, footY }) {}
```

## Rules every option follows (the goals behind them)

- **Ink on cream paper, monochrome.** `tint` swaps the ink colour, nothing else. No gradients that read as glossy plastic.
- **Identity constant: two separate oversized pip eyes, low on the face, dark pupils, one glint.** Use `ink.eyes()` (any style) or match its layout. No mouth, no limbs. A stroke tail or paper edge is not a limb.
- **Quiet idle.** Nothing on screen competes with the conversation. Idle: blink, gaze, slow texture; |x| ≤ .02R, lift ≤ .02R, no jumping.
- **The character carries state before any panel does.** Each action must be distinguishable from the others in a single still frame at 45% of its duration AND at tiny size (eyes + silhouette + maybe one mark). Design the still first, then the motion.
- **Sleep really settles**: eyes closed, slow breath only, no other motion. **Work** loops for minutes without nagging: small periodic motion with variation over the loop. **Success** is one gesture, then settle; never loops. **Error** is restrained and never celebratory.
- **Bounds:** |x| ≤ .9R, 0 ≤ lift ≤ 1.1R, .5 ≤ sx,sy ≤ 1.6, |rotate| ≤ .6 rad. Eyes stay inside the body. Everything must fit the stage: 3.4R wide × 3.6R tall with the foot at (1.7R, 3.1R) from the top-left — i.e. nothing above footY − 3.1R, below footY + .5R, or beyond footX ± 1.7R.
- **Reduced motion:** static per-action expression; no time-based texture; `render` ignores `time`.
- **Performance:** hero render ≤ ~2 ms typical on a laptop; aim for ≤ ~250 path ops and prefer fewer, bigger shapes. `options.test.mjs` reports the count and fails only above 1,400 — the budget is a guide, not a gate.

## Check your option without a browser

```sh
cd /Users/Matty/Documents/Nibbi
node design/character-lab/options.test.mjs <id>      # contract: finiteness, bounds, loops, reduced static, ctx balance
node design/character-lab/sheet.mjs <id>             # writes design/character-lab/evidence/sheet-<id>.png (actions × time, 3 sizes)
```

Look at the sheet PNG before you call it done. The parent integrates modules into the lab shell; do not edit `index.html`, `lab.mjs`, `ink.mjs`, `actions.mjs`, or another option.

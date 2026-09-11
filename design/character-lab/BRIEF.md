# Nibbi character lab — brief

*Five options for who Nibbi is and how Nibbi moves. Working Canvas2D prototypes, side by side, with the reasoning behind each. Nothing in the app changed.*

Open the lab: `node design/character-lab/serve.mjs` → **http://127.0.0.1:4538/design/character-lab/**. Overview image: [`evidence/matrix.png`](evidence/matrix.png) (five options × nine moments at each option's signature still, hero and 24 px); [`evidence/matrix-reduced.png`](evidence/matrix-reduced.png) shows the reduced-motion stills. Independent review: [`REVIEW.md`](REVIEW.md).

## 1. The ask, and what it is really about

"Make 5 different options for Nibbi's character and animation style; think about the goals and theme."

The earlier motion lab answered a narrower question — *same body, three ways to jump* — and Pocket spring won. This lab asks the wider one: **what is Nibbi made of, and what is the grammar of its movement?** Each option pairs a *material* (what the body is) with a *motion grammar* (how it changes), because those two decide each other: wet ink pours, paper is placed, a pen line is redrawn, type is set.

## 2. Goals → design requirements

Nibbi is "a local build partner with a face." From the plan and personality docs, the goals that constrain a character are:

| Goal (from the project) | What it demands of the character |
|---|---|
| "Nothing on screen unless it's needed; the character carries state before any panel does." | Nine moments must read from the body alone: idle, hello, listen, think, work, success, error, sleep, tap. Design the *still* first; motion second. |
| One character across hero stage, the conversation pill, 24 px chat rows and the phone | Every state must survive at R = 12 px. If it only works big, it does not exist. |
| A companion you live with for hours: "observant, quietly opinionated ally … comfortable with silence" | Quiet idle. No mascot antics. Work runs for minutes and must stay watchable without nagging. Success lands once; error never looks like a celebration. |
| Fixers/foremen appear as tinted companions | The material must recolour cleanly (tint swaps ink colour only) and still read at pill size. |
| Accessibility: OS reduced motion and the saved calm preference | Each state needs a static expression; no time-based texture in reduced mode. |
| Procedural, dependency-free, deterministic, cheap | No asset pipeline; pure pose samplers; a hero frame in ~2 ms. |
| Direct play (tap / hold / pull / stroke) already exists | Every option needs a physical, interruptible "tap" response that fits its material. |

## 3. Theme — what stays constant

- **Ink on cream paper, monochrome.** Warm paper, near-black ink. Colour belongs to companions (and, in one option, a single vermilion seal).
- **The eyes are Nibbi.** Two separate oversized whites, low on the face, dark pupils, one glint. Every option keeps this layout (drawn in its own material) — it is the through-line that makes five bodies one character.
- **No mouth, no limbs.** The body and eyes act. A stroke tail or a paper edge is material, not anatomy.
- **The name.** *Nibbi* — nib, nibble. Small; born from a pen. Option 1 leans into this directly; all of them stay on the page rather than floating above it.

## 4. The design space

Axes explored: **material** (wet ink · brush stroke · torn paper · pen line · printed type), **motion grammar** (viscous pour · redrawn stroke · 12 fps stop-motion · drawn-on line with boil · hard typographic cuts), **how state is carried** (silhouette · marks on the paper · fill level · gesture line), and **distance from today's Nibbi** (Inkdrop nearest → Typesetter furthest in behaviour, Sketch furthest in look).

Deliberately *not* explored: limbs, mouths, 3D/clay, sprites, fluid simulation, and a weightless "ink wash cloud" (see §8).

**What survives at 24 px.** Below about 32 px the material does not survive; only silhouette and marks do. The five collapse to three silhouettes in a chat row: *blob* (Inkdrop, Cutout, Typesetter), *blob + tail* (Sumi) and *outline* (Sketch). So at the size that decides everything, the real choice is: a blot with or without marks beside it, a tail, or an outline. Judge 1/3/5 at 24 px on their marks and silhouette changes; judge 2 and 4 on silhouette alone. The hero stage is where material and grammar earn their keep.

## 5. The five options

Each option is one module in `options/`. Durations, stills and motion are in code; the tables below describe intent and what the sheets show.

### 01 · Inkdrop — *a drop of wet ink from a nib, breathing into the paper*
**Material.** Today's dense fuzzy blot, plus a faint bleed halo where ink soaks into the fibres and a small crown peak — the tail of the drop. Nearest relative of the current character; the name made literal.
**Grammar — wet weight.** Every move is *lean → pour → settle*: viscous slow-in, one damped overshoot, and a landing ring that soaks in and fades. Idle is a 6 s breath of the halo.
**Stills.** hello: a wide squash, then a small bob with a landing ring · listen: leans toward the person, halo brightens · think: the crown hooks over like a question mark, weight sways · work: compressed, a bead lifts off the crown three times per loop, like dipping a nib · success: one big plop with a tall drop-shaped apex, bleed ring and specks · error: the body sags and one drip runs down by mid-gesture · sleep: spreads into a puddle · tap: jelly wobble.
**24 px.** Halo, specks and beads drop out; eyes and the silhouette carry it: a lean for listen, a hooked crown for think, a squash for hello, the drip for error. Idle, work and tap still look alike in a still — this is the option that most needs motion, or marks (§7).
**Companions.** Tint swaps the ink; the halo tints with it.
**Fit.** Highest identity continuity and warmth; directly extends the existing SDF renderer and Pocket spring library (add halo, bleed ring, peak/lean weights).
**Risks.** Face lost in goo during big shape changes; viscous timing reads sad if slow; halo/bleed cost fill-rate; mass is faked.

### 02 · Sumi stroke — *one brush stroke: a wet pressed head and a dry tail that re-lays itself for every gesture*
**Material.** A single sumi-e stroke. Wet, dense head carrying the eyes; a dry-brush tail with bristle streaks and breaking ink. Ink density varies along the stroke.
**Grammar — redrawn, not moved.** A pose change is the old stroke lifting (~120 ms) while the new one is laid down in one sweep (~250 ms reveal with a brush-speed profile), then calligrapher's stillness. The tail is the gesture line.
**Stills.** listen: tail sweeps to the front-left · think: tail curls upward in hesitation loops · work: short tally-like flicks, six per loop · success: a flourish over the head and a small vermilion hanko for a second — "signed" · error: pressed too hard, a blot bulge and one drip, limp tail · sleep: the stroke dries to grey.
**24 px.** Head plus a short solid tail; the tail's angle still distinguishes listen / think / success.
**Fit.** Decisive and elegant — matches "have taste, explain the reason." Strong still-legibility because the tail points. Calligraphy sits naturally on the paper theme.
**Risks.** Variable silhouette weakens identity; the tail can read as a limb or a tadpole; the head is a smaller Nibbi than the blot; the seal adds colour; stroke paths need authoring per gesture.

### 03 · Paper cutout — *a blob torn from black paper, laid flat on the page, moved by hand one frame at a time*
**Material.** Matte torn paper: large straight jags with a white fibrous fringe behind, a 2 px paper-thin layer shadow (deliberately kept), white punch-out eyes glued on slightly askew.
**Grammar — stop-motion.** Everything samples on a 12 fps grid. Replacement animation: a dozen discrete pose scraps swapped frame to frame, with hand-placement jitter; hinged rotation about the foot. A hop is four or five frames.
**Stills.** think: a torn thought-scrap above · work: offcuts shuffle by the foot · success: hop then seven confetti bits that settle · error: swaps to a crumpled variant with crease lines · sleep: flat with paper-sliver eyes.
**24 px.** Torn outline simplified; fringe and shadow dropped.
**Fit.** Handmade delight, very cheap to render, honest about being made of paper. Good for "a little delight without noise" because nothing moves between frames.
**Risks.** Stepped motion can be mistaken for lag; crisp edges lose the soft ink identity; the permanent shadow reverses an earlier rule; tilts read through the eyes more than the silhouette.

### 04 · Sketch line — *a loose pen contour of Nibbi, partly hatched, that redraws itself instead of moving*
**Material.** A 1.6–2 px pen contour with overlapping ends and a faint construction line; paper inside, hatched from the bottom. The hatched amount is a state (`inked`).
**Grammar — drawn, not moved.** Two layers of life: a very subtle 8 fps line boil (tighter when attentive, nervous on error), and drawn-on transitions where the new contour draws itself while the old fades.
**Stills.** listen: line tightens, hatching leans · think: pencil guide lines appear and erase above the crown · work: hatching fills across the loop — progress you can watch · success: the body becomes **fully inked** — it literally becomes today's Nibbi for a moment — with pen-tick sparkles · error: a scribbled cross-out, then an eraser smudge · sleep: pencil grey, dash eyes, hatching drains.
**24 px.** Solid contour + pen eyes; a single rising ink level for work, one clean cross for error.
**Fit.** The strongest *metaphor* for building: a draft that gets inked. Matches "honest progress" and the sketchbook feel of a workshop.
**Risks.** Thin line has low contrast on cream at small sizes; idle / listen / think collapse at 24 px; the fill level is a progress bar in disguise; the companion looks unfinished all day; heaviest render (~560 ctx ops with hatching).

### 05 · Typesetter — *an ink blot set as type on a baseline; every pose quotes a punctuation mark*
**Material.** A heavy typeset blot with a faint letterpress squash, sitting on a hairline baseline; eyes as crisp counters.
**Grammar — typographic rhythm.** Hard cuts with one 60 ms overshoot, then holds. Idle blinks exactly every 4.0 s like a cursor.
**Stills.** listen `,` a comma tail at the foot and a lean · think `…` three dots appear at typing cadence · work: a blinking text cursor and "set" dots sliding along the baseline · success `!` the body snaps tall with a dot below · error `*` a footnote mark and the body goes half-grey · sleep `—` an em dash, eyes closed · tap: bold for one frame.
**24 px.** The best of the five: marks are designed to read at text size.
**Fit.** Maximum state legibility; dry wit; it belongs to a text conversation. Still a blot at rest, so identity survives.
**Risks.** Gimmicky if overdone; hard cuts can feel cold; `…` is easily mistaken for the other party typing; `—` barely reads as a creature at 24 px.

## 6. Side-by-side (1 = weak · 5 = strong)

| | Inkdrop | Sumi | Cutout | Sketch | Typesetter |
|---|---|---|---|---|---|
| Still Nibbi (identity, warmth) | 5 | 3 | 4 | 2 | 4 |
| State reads in one still — hero | 3 | 4 | 4 | 4 | 5 |
| State reads — 24 px chat row | 3 | 4 | 3 | 3 | 5 |
| Quiet idle / lives beside you | 5 | 4 | 5 | 3 (line boil is visible motion at rest) | 4 |
| Work stays watchable for minutes | 4 | 4 | 3 | 5 | 4 |
| Theme fit (ink, paper, nib) | 5 | 5 | 4 | 4 | 4 |
| Personality fit (opinionated, dry, warm) | 4 | 5 | 3 | 4 | 4 |
| Companion tint | 5 | 4 | 5 | 2 | 5 |
| Build cost from today's engine | 5 (extend) | 2 (new stroke rig) | 4 (2D polygons) | 2 (new line renderer) | 4 (marks overlay) |
| Render cost (hero ctx ops, measured) | ~340 | ~430 | ~250 | ~560 | ~200 (~370 during error) |
| Biggest risk | relies on motion for state | tail = limb/tadpole | looks like lag | thin at small sizes; a draft all day | cold / emoji-like |
| **Measured** states distinct from idle, 24 px (normal · reduced) | 6/8 · 6/8 | 6/8 · 6/8 | 6/8 · 8/8 | 6/8 · 7/8 | 7/8 · 8/8 |
| **Measured** states distinct from idle, hero (normal · reduced) | 6/8 · 6/8 | 6/8 · 6/8 | 6/8 · 8/8 | 6/8 · 7/8 | 8/8 · 8/8 |
| **Measured** weakest pair at 24 px | hello/work, idle/tap | idle/work, idle/tap | idle/success, work/success | idle/hello, idle/think | idle/listen |

The 1–5 rows are the author's reading of `evidence/matrix.png` and the per-option sheets; they are judgment, not user data. The **measured** rows come from `verify.mjs` (`evidence/browser-results.json`, `legibility`): for each option, the nine signature stills are compared pairwise by mean pixel difference over the union of their ink bounding boxes (so a small avatar is not diluted by empty paper); a pair under .06 counts as "the same picture". The two states every option struggles to separate from idle are **tap** (a motion, not a still) and **work** (designed to be calm), so 6/8 is the practical ceiling for a body without marks — Typesetter and Cutout's marks/scraps are what push them past it. The metric rewards silhouette change and extra marks; it cannot tell you whether a person would *name* the state correctly. That needs the test in §7.

## 7. Recommendation

**Pick: Inkdrop's body and grammar at hero and pill size, with Typesetter's marks at 24 px.** Reason: Inkdrop is the only option that is unmistakably today's Nibbi and gives the existing renderer a reason to move the way it does (a drop from a nib); Typesetter's `…` / cursor / `*` are the only device in the lab that makes think, work and error legible in a chat row without motion. Said plainly: this is Typesetter's 24 px behaviour with Inkdrop's edge, halo and timing at hero. Keep one material and one motion grammar; the marks are ink on the same paper, appear only where the body cannot act (below ~32 px), and do not change how the body moves.

**What would overturn it:** show five people the nine 24 px stills from `evidence/matrix.png` for the pick and ask them to name the moment. If fewer than 7 of 9 are named correctly, choose Typesetter outright (its marks did the work anyway). If people read `…` as *the other party is typing*, replace that one mark with the crown hook from Inkdrop's think.

The decision guide for the other four is in the appendix. Two things I would not do in any case: adopt Sketch's fill level as the everyday body (a progress bar in disguise, and the companion looks unfinished all day), or ship Sumi's tail without the naming test (the most beautiful sheet and the most likely to be read as a tadpole).

## 8. Directions considered and parked

- **Ink wash cloud** (weightless, floating, diluted grey): calm, but it floats above the page and reads as fog; conflicts with "grounded, opinionated."
- **Splat / kinetic** (bursts into droplets and re-forms): violates quiet idle; a second character's worth of beads.
- **Limbs or a mouth**: more expressive, less Nibbi; every other option gains legibility without them.
- **Sprite or alpha-video accents, full fluid simulation, 3D/clay**: asset pipelines, weak interruption, off-theme (see the motion-lab plan's technical notes).

## 9. What this lab proves — and does not

Proves: five coherent material/grammar pairs exist, each carries the nine moments at hero size, and each has a static reduced-motion expression per moment (measured distinct from idle in 6–8 of 8 cases, table in §6). `options.test.mjs` passes for all five: finiteness, bounds, loop continuity, reduced-static, save/restore balance. The browser sweep in `verify.mjs` passes: 3,645 poses inside the stage with eyes inside the body, reduced mode pixel-identical across time, quiet idle, no console errors, mobile layout. The path-op budget in CONTRACT.md is a guide, not a gate: the test reports the count and fails only above 1,400; Inkdrop (~340), Sumi (~430) and Sketch (~560) exceed the ~250 guide and would need simplification or the SDF route in production.

An independent review (`REVIEW.md`) was run against the first version. Fixed since: Inkdrop's hello/think/error stills (a squash, a real hook, a drip by 50 %); reduced-motion stills for Inkdrop and Cutout; Typesetter's eyes staying low during `!`, black ink under a hatch instead of grey for error, visible closed eyes at 24 px; Sumi's tail shapes (loop / wave / flick); Cutout's hop, confetti, hard shadow and askew eyes; a legibility metric normalised to ink area with a threshold that a known look-alike pair fails; declared signature stills per option (`stillAt`) used by the matrix; a 24 px chat strip in the lab; one recommendation instead of three. Not addressed: the hero cards still collapse to a single column on a phone.

Does not prove: how any option feels in motion beside a real conversation (open the lab and play the tour), real-device performance, WebGL parity with `public/nibbi.js`, Safari/WKWebView behaviour, or what other people read into the tail, the dots or the shadow. Nothing here is integrated with `pocket-motion.js` or the interaction map.

## 10. Next steps

1. **You choose** — the pick above, or one of the five. Shortlist in the lab is browser-local; say the name.
2. **Run the naming test** (§7) on the 24 px stills before tuning anything.
3. **Tune that one** in this lab for a day: stills first in the chat strip, then the work loop, then idle beside real text.
4. **Integrate through the existing route:** pose fields → `pocket-motion.js` actions; material → the SDF renderer (Inkdrop, Typesetter marks) or a new Canvas2D material (Cutout) behind the `createNibbi()` API; keep `?motion=legacy` as the escape hatch. Real-device and reduced-motion QA before any install.

## Appendix — decision guide

*Warmth and continuity* → Inkdrop · *taste and elegance* → Sumi · *handmade charm, lowest cost* → Cutout · *"we are building something"* → Sketch · *clarity in text-sized places* → Typesetter.

Sketch's risk list should be read with one more line: at rest the companion is a draft, so it looks unfinished all day; its success moment (fully inked) is the strongest single image in the lab precisely because rest is not.

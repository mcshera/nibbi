# Round 4 — five new techniques

*Five toys for Nibbi, built for the goal: "5 new versions of Nibbi using new and unique animation techniques — fun and different — building off the character lab".*

Open: `node design/character-lab/serve.mjs` → **http://127.0.0.1:4538/design/character-lab/round4/**. Overview: [`evidence/matrix.png`](evidence/matrix.png) · reduced-motion stills: [`evidence/matrix-reduced.png`](evidence/matrix-reduced.png) · per-technique sheets: `evidence/sheet-<id>.png`.

## What this round asks

Round 1 varied the *style* (five drawn options). Round 2 made Nibbi *live* (particles, soft body, wet-ink filter, brush painter, raymarched bead) and the owner liked the bead. Round 3, built in a parallel session, keeps the raymarched bead and varies the premise. Round 4 asks a different question: **what other kinds of motion technology could Nibbi be made of, and which of them is a toy?** Each option here is a different class of motion tech that had not appeared in the lab, and each has to own at least three "toy behaviours" — things only that technology can do, that a person will want to trigger twice (`meta.fun`, listed on every card). Same nine moments, same three sizes, same paper, same round-2 API, so they can be judged with the same tools and against rounds 2 and 3.

| | Technique | What it actually is | The toy |
|---|---|---|---|
| 01 | **Sandglass** (`sand`) | Falling-sand cellular automaton: ~3k ink grains in an invisible silhouette mould (R/28 grid, 3 substeps) plus a small in-flight particle list | Drag a finger wall through the pile; tap a crater; error opens the mould and the body slumps into a heap, then is vacuumed back grain by grain; success is a fountain |
| 02 | **Slime mould** (`slime`) | Physarum agent simulation: ~2.5k agents sense / turn / move / deposit on a blurred, decaying trail grid; the silhouette is the food field, the eyes are repellent holes | Press and the pointer becomes food — the lace flows to the finger and follows it; tap punches a hole; the network never repeats |
| 03 | **Mosaic** (`shards`) | Voronoi mosaic of ~70 rigid tiles (jittered sites, Lloyd relaxation, half-plane clipping), each a spring-damped body tied to its home pose and its neighbours | Pull a tile out and it snaps back; error shatters the whole mosaic into a pile and it reassembles; success explodes and snaps; think sends crown tiles into orbit |
| 04 | **Pom-pom** (`puff`) | Strand physics: ~360 Verlet hair chains rooted on a spring-driven soft core, with stiffness toward a rest direction, gravity, drag, noise wind, a floor and pointer repulsion | Comb a parting with a finger; carry the puff by its core with the fur trailing; success stands every strand on end; error is a wet dog |
| 05 | **Flip-dot board** (`flipdot`) | Mechanical flip-disc matrix (≈ 44 × 47 dots at hero): a binary target image per state, 120 ms disc flips scheduled from a wavefront with a hash stagger | Drag wipes dots so you can draw on Nibbi (they flip back half a second later); tap punches a hole that heals in a ring; every cue is a visible wave of flips |

Each keeps the theme constants — ink on cream paper, two eyes, no mouth, no limbs — and makes the eyes *in the technique*: cells the grains cannot enter, repellent clearings in the lace, two paper-white tiles, a bald patch in the fur, dots left unflipped.

## How to judge them

1. **Touch first.** Press, drag, flick, tap. The question this round is *would you do it twice?*
2. **Chat strip.** 24 px beside text still decides. All five keep a solid silhouette with two eyes at 24 px; the technique itself is only visible at pill size and above.
3. **Idle and Work for a minute.** Sandglass and Slime keep a slow internal life (a grain bubbling up, the lace rewiring); Mosaic, Pom-pom and Flip-dot are calmer.
4. **Error after Success.** Every error here is a collapse of the material (heap, sag, shatter, wet dog, flip-off), never a celebration.
5. **Reduced motion.** All five converge to a still within a second and hold it (verified pixel-identical frames).

## First reading (author's, from the sheets — not a decision)

- **Most fun to touch**: Sandglass (the finger wall through a pile, the crater, the spill-and-refill) and Mosaic (pulling a tile out and letting it snap back; the shatter). Both give something back on every touch.
- **Most "Nibbi"**: Mosaic and Flip-dot keep the exact silhouette and the canonical eyes; Sandglass keeps them at pill and 24 px. Pom-pom changes the outline into fur, which is charming at hero but drifts toward a soot-sprite likeness that is not ours.
- **Most alive without touch**: Slime mould (the lace never repeats) and Sandglass (one grain bubbling up). Both stay under the idle-drift budget, but they are the two to watch for an hour beside real text.
- **Clearest states in one frame**: Sandglass (heap, fountain, loaf), Mosaic (orbiting tiles, explode, shatter, slits), Pom-pom (puff, wet dog, flat). Flip-dot reads by silhouette shifts and eye rows; Slime mould reads by silhouette now, but its work and tap stills lean on the pupils.
- **Most different from rounds 1–3**: Flip-dot board (nothing else in the lab is quantised or mechanical) and Slime mould (nothing else grows).
- **Cheapest**: all five run at 0.07–2.1 ms per hero frame in the harness; Slime mould is the only one above 1 ms.

If one has to go forward: **Sandglass** for the toy, **Mosaic** for the character, **Flip-dot** if the app wants a signature that is unmistakably a display. Pom-pom and Slime mould are the material experiments — worth keeping in the lab as textures a future body could borrow (the fur's secondary motion; the lace as an idle texture on a solid body).


## Techniques considered and not built (and why)

- **Eulerian fluid (stable-fluids dye in water)**: mesmerising, but a third grid simulation next to sand and slime; the lace already gives "ink that moves on its own".
- **Origami / folding paper**: a real fold engine is heavy and the eyes would not survive a fold at 24 px.
- **Mesh puppet warp (Live2D-style deformation of a painted bitmap)**: a well-known technique, but visually close to round 2's soft body.
- **One-line scribble (a pen that never lifts)** and **boids**: too close to round 1's sketch and round 2's particles.
- **Pixel-sprite / Tamagotchi**: fun, but the flip-dot board covers the quantised, mechanical charm while staying ink-on-paper.

## What this round proves — and does not

Proves: five techniques exist, each passes `tech.test.mjs` (mount at 3 sizes, every moment renders and differs from idle at its still, one-shots return to idle within 4 s, reduced motion converges to pixel-identical frames, a press/drag changes the body, tint recolours, destroy cleans up, and at least three toy behaviours are declared) and the shell check `verify4.mjs` (all mounted at hero/pill/tiny, cued, no page errors, mobile 390 px without overflow). Hero CPU cost per frame in the harness: Sandglass 0.24 ms, Slime mould 2.3 ms, Mosaic 0.10 ms, Pom-pom 0.47 ms, Flip-dot 0.15 ms (software rendering; not a device benchmark). Idle drift over 2 s is 0.0006–0.0094 mean pixel change (budget .02).

Does not prove: feel on a touchscreen, real-device performance (Slime mould's mask rebuilds peak at 6–9 ms on a cue), Safari/WKWebView behaviour, or how any of these sits beside a real conversation for an hour. Nothing is integrated with the app; the production character (Pocket spring) is unchanged. An independent review is in [`REVIEW.md`](REVIEW.md); §Fixes below lists what changed in response.


## Files

`techniques/*.mjs` (five modules + `_template.mjs`), `TECH-CONTRACT.md` (round-2 API plus `meta.fun`), `index.html` / `lab4.mjs` / `lab4.css` (shell), `tech-test.html` + `tech.test.mjs` (headless contract checks, now also requiring three toy behaviours), `sheet4.html` + `sheet4.mjs` (per-technique sheets and the matrix), `verify4.mjs` (shell checks and screenshots), `evidence/`, `REVIEW.md` (independent design review).

# Round 2 — different techniques

*Five live techniques for Nibbi, built after the owner saw round 1 and said: "I don't like any of them really — is there a different technique you can try?"*

Open: `node design/character-lab/serve.mjs` → **http://127.0.0.1:4538/design/character-lab/round2/**. Overview: [`evidence/matrix.png`](evidence/matrix.png) · reduced-motion stills: [`evidence/matrix-reduced.png`](evidence/matrix-reduced.png).

## What changed, and why

Round 1 varied the *style* but kept one technique: authored vector shapes sampled from a pose function and filled on a canvas. Every option therefore shared a family resemblance — a computer-drawn blob with two cartoon eyes — and the motion was curves, not weight. Round 2 changes the **technique**. Each option is a live module driven by `step(dt)`; motion comes from simulation, filters, paint or light, and every one responds physically to touch (press, drag, release). The same nine moments and three sizes apply, so they can be judged against round 1 and against each other.

| | Technique | What it actually is | What is different to the eye and hand |
|---|---|---|---|
| 01 | **Particle ink** | ~2,500 ink grains spring-bound to homes inside the silhouette; eyes are clearings the grains avoid | Granular, shimmering edge like drying ink; poke it and grains scatter and regather; success bursts, error drips grains |
| 02 | **Soft body** | Verlet ring of 36 masses with springs and area pressure on a floor, filled with the fuzzy ink | Real weight: jumps overshoot, land with a squash, wobble; you can dent and stretch it; nothing is keyframed |
| 03 | **Wet ink filter** | SVG path morph through feTurbulence + feDisplacementMap + goo threshold, bleed halo, paper grain | An edge that creeps and bleeds like real wet ink; wetness is a state (touch and cues re-wet, sleep dries sharp) |
| 04 | **Brush painting** | Stamp-based raster painter: bristle and dry-streak stamps along a few strokes, repainted every frame, wet→dry over 1.5 s | Pigment, not fill: pooling where the brush pressed, dry strands at the lift-off; a wash rather than a silhouette |
| 05 | **Ink bead** | GLSL raymarched 3D drop with glossy wet shading, contact shadow, eyes set into the surface; springs drive the shape | A real object on the paper: highlight, shadow, a poured crown; hello and success rise into a teardrop |

Each keeps the theme constants — ink on cream paper, two eyes, no mouth, no limbs — but the eyes are made in the technique (clearings, un-inked spots, white dabs, enamel spheres), so they are no longer the round-1 pip eyes.

## How to judge them

1. **Touch first.** Press, drag, flick. The question is *does it feel like ink or like rubber?* Round 1 could not ask this.
2. **Chat strip.** 24 px beside text still decides. Particle ink and Brush painting lose the most here; Soft body, Wet ink and Bead survive.
3. **Idle and Work for a minute.** Particle shimmer and brush re-inking are the busiest; Bead and Wet ink are the calmest.
4. **Error after Success.** Bead's drip and Wet ink's drip are the clearest errors; Particle ink's falling grains are subtle.
5. **Reduced motion.** All five converge to a still within a second and hold it (verified pixel-identical frames).

## First reading (author's, from the sheets — not a decision)

- **Most "ink"**: Wet ink filter (the edge behaves like ink) and Brush painting (pigment pools and dries). Brush is also the furthest from a silhouette and the hardest to read small.
- **Most alive to touch**: Soft body and Particle ink. Soft body is the direct heir of Pocket spring — the elasticity the owner already liked, but real.
- **Most different**: Ink bead. It is a photograph of ink, not a drawing of it. It may be too glossy for a paper interface, or exactly the object the pill was missing.
- **Most legible at 24 px**: Soft body and Wet ink (they keep a solid silhouette and crisp eyes).

If none of these land either, the likely reason is not technique but **premise**: a black blob with two eyes. The next round should then vary the premise — a creature that is *not* a blob (a drop with a tail, a brush-mark bird, a folded paper shape, an inkwell with a lid), or no creature at all (a living ink mark that writes). Say which itch it is.

## Techniques considered and not built (and why)

- **AI-painted concept art / video loops** (image model → still → image-to-video idle loop): the fastest way to explore radically different *looks* (watercolour creature, woodblock print, clay). Not built: the Higgsfield account has 0.13 credits; say the word and top up, and I will run six concept directions.
- **Reaction–diffusion / ink-spreading GPU sim**: real bleed physics; heavy to make interactive and legible; the SVG filter gets 80 % of the look for 5 % of the cost.
- **Hand-drawn frame-by-frame sprites**: needs drawing, not code; would lose gaze and touch response.
- **1-bit dithered bitmap**: a distinct retro technique, but off the ink-and-paper theme.

## What this round proves — and does not

Proves: five techniques exist, each passes `tech.test.mjs` (mount at 3 sizes, every moment renders and differs from idle at its still, one-shots return to idle, reduced motion converges to identical frames, touch changes the body, tint recolours, destroy cleans up) and the shell check `verify2.mjs` (all mounted, cued, no page errors, mobile without overflow). Hero CPU cost per frame is 0.02–1.4 ms in the harness; SVG filter compositing cost is not measured by it.

Does not prove: real-device GPU behaviour (Bead, SVG filters on Safari/WKWebView), feel on a touchscreen, or how any of these sits beside a real conversation for an hour. Nothing is integrated with the app.

## Files

`techniques/*.mjs` (five modules + `_template.mjs`), `TECH-CONTRACT.md`, `index.html` / `lab2.mjs` / `lab2.css` (shell), `tech-test.html` + `tech.test.mjs` (headless contract checks), `sheet2.html` + `sheet2.mjs` (per-technique sheets and the matrix), `verify2.mjs` (shell checks and screenshots), `evidence/`.

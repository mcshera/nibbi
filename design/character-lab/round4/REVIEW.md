# Round 4 — design review (review only, nothing edited)

Evidence read: `evidence/matrix.png`, `matrix-reduced.png`, the five `sheet-*.png` (cropped to native scale per row), `lab4-desktop.png`, `lab4-mobile.png`, the cued `lab4-*.png` clips, the round-2 matrix as reference, the `meta` blocks, `index.html`, `TECH-CONTRACT.md`.

## Top 10 (highest impact first)

### 1. Slime mould loses Nibbi at hero — it reads as a brain / grey mould, and it is a different material at pill and 24 px
**Where:** `slime.mjs`, every moment on `sheet-slime.png`; card 02 hero on `lab4-desktop.png`.
**Why:** The body is mid-grey (≈ #3c3c3c) with darker blotches and a blurred edge. It is the only technique that is not black ink, and the blotch pattern reads as cortex/coral, not a squat ink blob. The contract says "Monochrome ink" and "look like the same character" at every size — but pill and tiny render as a soft solid black blob with a Gaussian edge, so the hero and the chat-row are not the same creature. This is the technique most likely to be rejected on sight.
**Fix:** Render the trail field with a hard threshold into the ink colour (`ink.inkColor`) so the core saturates to solid ink and the lace only shows at the outer ~0.15R rim; drop the grey ramp (map trail ≥ 0.35 → 1.0 ink, < 0.15 → paper, narrow soft band between). Kill the blur on the pill/tiny canvases (draw at 2× then threshold, or use `imageSmoothingEnabled=false`) so the edge is crisp like the other four. Keep the veins visible only as thin paper cracks (≤ 1.5 px at hero) so the "living network" is a surface texture on Nibbi, not the whole silhouette.

### 2. Pom-pom is a Ghibli soot sprite, and error/sleep turn it into a different character
**Where:** `puff.mjs`; `sheet-puff.png` idle/hello/success (radial spikes) and error/sleep (tall bell with a fringe).
**Why:** A black fuzzy ball with radial hair and two big white eyes is the Susuwatari from *Totoro* / *Spirited Away* — the brief lists "soot sprite" as a fail. Worse, the wet-dog error and the sleep still collapse the fur into a tall hooded bell (taller than idle) that reads as a ghost / Cousin Itt, not a settled Nibbi. And at 2.6 s after error the fur has re-fluffed *larger* than idle (sheet row Error, col 2.6 s) — that shake-off is a celebration after an error.
**Fix:** Cap strand rest length at ≈ 0.3R (currently ~0.5R+) and taper more, so the silhouette is a blob with a fuzzy edge rather than a spiked star; add a mild directional bias (strands lean down-back) so it reads as a tuft, not a starburst. Error: keep the core slumped on the foot line and the fur clumped for the whole hold; recovery back to idle should ease over 3 s with stiffness clamped so the fur never exceeds idle length (no overshoot). Sleep: set gravity down and drop the core to the foot line so the still is a low, wide mound (height ≤ 0.8× idle), not a bell.

### 3. Flip-dot: eyes are not eyes, and the module paints a grey display plate instead of paper
**Where:** `flipdot.mjs`; every hero cell on `sheet-flipdot.png`, card 05 hero.
**Why:** At 44 × 47 dots the eye is a 4–5-dot paper blob with a single ink dot in it — it reads as the glyph "8" / a ring / a nut, and in work and tap the pupil rows make shapes that look like a mouth (Work 1.6 s: a paper arc under the right eye) or a nose (Tap: paper hole between the eyes). The whole card is also drawn as a light-grey rectangle, so the character sits on a "display", which breaks "ink on cream paper" and makes it the odd one out on the matrix. The 24 px version is a plain silhouette with clean eyes, so hero and chat-row do not match.
**Fix:** Either raise resolution to ≈ 64 × 68 dots at hero (cost is fine, it is a lookup) or enlarge the eye discs to a 7-dot-wide paper disc with a 2 × 2 ink pupil (eye radius 0.22R at pitch R/32 ≈ 7 dots — matches `ink.EYES`). Remove the plate: draw the paper-side rings at ≤ 5 % alpha only inside the body's bounding ellipse + 1 dot, and keep the rest of the host `ink.paper`. Work: move the moving "cursor" dots to the crown row and never below the eye line; tap: punch the hole where the finger is, but never inside the eye band (y between −0.15R and +0.3R).

### 4. Five moments are near-identical to idle in one frame (sand, slime, puff, shards)
**Where:** matrix.png rows; sheets, ★ columns for listen / think / work / tap.
**Why:** The contract says each moment must be recognisable in a single frame. Per technique at hero: **Sand** — idle ≈ listen ≈ tap; **Slime** — idle ≈ hello ≈ think ≈ work ≈ tap (five of nine); **Puff** — idle ≈ listen ≈ think ≈ work ≈ tap ≈ success (2.6 s); **Shards** — idle ≈ work ≈ tap. At 24 px only error, sleep and (sometimes) success survive for any of them. Gaze alone does not carry state at R = 12.
**Fix (design the still first):** Listen → translate the body centre 0.12R toward the person and tilt the mould/food field/rest direction 8–10° (all four currently only shift the pupils). Think → an object above the crown that persists (shards already does this; sand: three grains hovering; slime: a small clearing that "bubbles" up the body; puff: a single tall strand standing up like an antenna). Work → a visible loop in the body: shards shear alternate tile rows ±2 px; puff: a ripple that runs through the fur crown-to-foot every 0.8 s; slime: raise the peristaltic wave contrast so a band is visible; sand: see item 6. Tap → keep the poke mark for the whole 0.25 s still (a crater/parting/dent 0.2R wide), not a tiny halo.

### 5. Hello barely lifts for sand, slime and flip-dot
**Where:** `sheet-sand.png`, `sheet-slime.png`, `sheet-flipdot.png` row Hello, cols 0.15–0.55 s.
**Why:** Round 2's soft body / ink bead hello is a clear hop (the reference the owner liked). Here sand's hello is a dust puff on a body that does not move; slime's hello is indistinguishable from idle in every column; flip-dot's is a faint scan stripe. Hello is the first thing the tour shows, and three of five say nothing.
**Fix:** Lift the target (mould / food field / binary image) by 0.35R between 0.15 s and 0.5 s and let the material lag: grains shower back into the mould, agents stream up after the field, dots flip crown-first then foot. Take the still at the apex (0.4 s) rather than 0.55 s.

### 6. Sand: hello, work and success share one motif ("dust above the crown"), and work is a permanent boil
**Where:** `sheet-sand.png` rows Hello / Work / Success; matrix row 1 at 24 px.
**Why:** All three stills are a body with a cloud over the head — at 24 px they are the same picture. Work keeps a dust cloud across 0.15 → 2.6 s, which is exactly the "constant churn that competes with text" the contract forbids, and it makes success (the fountain) less special.
**Fix:** Work → no crown emission; instead a slow internal slump: tilt gravity ±4° on a 2 s sine so the pile leans left/right and grains trickle along the surface only (surface flux ≤ 20 grains/s). Hello → the hop from item 5 with ≤ 30 grains of dust that settle within 0.4 s. Success keeps the fountain, but raise it: ≥ 300 grains, 1.2R high, so it is unmistakably the biggest event.

### 7. Shards: the success still loses the face; the 24 px success is noise
**Where:** `sheet-shards.png` row Success col ★ 0.3 s and pill/24 px; matrix row 3.
**Why:** The eye tiles are blown out with the rest, so the still shows two detached hexagonal white chips floating in a cloud of tiles — a broken face rather than a happy one. At 24 px it is a grey scatter with no eyes at all.
**Fix:** Exempt the two pinned eye tiles from the burst impulse (or give them 15 %) and keep them on the core; take the still at 0.45 s when the ring has opened but the body is still legible; at R = 12 draw the silhouette plus a ring of six chips at 1.3R instead of scattering every tile.

### 8. Sleep is not settled in three techniques
**Where:** `sheet-puff.png` Sleep (tall bell, taller than idle); `sheet-sand.png` Sleep cols 0.15–0.4 s (a spray of grains erupts from the crown as sleep begins); `sheet-shards.png` Sleep (tiles re-arrange into a radial "cracked egg" pattern).
**Why:** Sleep should be the lowest, quietest still. A spray at sleep onset reads as a startle; the bell reads as standing; the radial crack pattern reads as damage and is a pattern that appears in no other moment.
**Fix:** Sand: lower the mould without opening its top (drop the crown by shrinking the mould ellipse from the top only, so grains flow down inside, not out). Puff: gravity 1.0 + stiffness 0.2 + core y → foot line − 0.9R. Shards: keep the idle Voronoi topology and only squash the targets (scale y 0.75, x 1.15); do not re-seed sites for sleep.

### 9. Copy: wrong round in the matrix title, taglines that fight the picture, and repetition
**Where:** `matrix.png` and `matrix-reduced.png` titles read "round 2 techniques"; card taglines and fun lists on the page.
**Why / fix:**
- Matrix title → "Nibbi — round 4 techniques × nine moments (…)". This is the artefact people will screenshot.
- Sandglass tagline "An hourglass that is a creature…" — nothing on the sheet looks like an hourglass; the tagline is also 24 words. → "A heap of ink sand that leans, boils, collapses and is vacuumed back into shape." (Also the name: the sheets show a sandpile, not a glass; consider "Sandpile".)
- Slime mould: "never repeats" appears in the tagline, the motion line and the fifth fun bullet. Keep it once (motion). The fifth fun item is not a toy behaviour (nothing to trigger) — cut it so the list is four real ones.
- Pom-pom tagline lists four verbs; the sheet shows two (stands on end, wet). Trim to what is visible: "A pom-pom of ink hair on a soft core: it stands on end, gets wet and can be combed with a finger."
- Flip-dot fun: "drag WIPES dots" — no caps for emphasis; "left→right" → "left to right". Its tagline says "railway-station" (hyphen is right) but the card shows a grey plate that a sign would not have (see item 3).
- Page intro: "A pom-pom of ink strands that ruffles, droops and fluffs." → "…that ruffles, droops and fluffs up." (reads as a noun list otherwise); "Same nine moments, same three sizes, same paper — different physics under each one." is good — but "same paper" is false for flip-dot and slime until items 1 and 3 land.
- Technique lines vary from 12 to 38 words (pom-pom is the longest), which is what misaligns the card stages (item 10). Cap at 20 words; move the parameter detail ("R/28 grid, 3 substeps", "5 points each") into the notes block.

### 10. Lab page: mobile masthead breaks mid-word; desktop card stages misalign; the cued clips capture no character
**Where:** `lab4-mobile.png` top 260 px; `lab4-desktop.png` y ≈ 1000–1400; `lab4-think/work/success/error/sleep/reduced.png`.
**Why:** At 390 px the five masthead links are laid out as five narrow columns, so "Read the round-4 brief ↗" wraps into four lines ("Read / the / round- / 4 brief"), and "Current character ↗" into three. On desktop the pom-pom stage starts ≈ 25 px lower than the others because its technique line is one row longer, so the five heroes do not sit on a line. The six cued screenshots are 1600 × 200 crops of the card headers — they show no hero, so they are not evidence for the cued states.
**Fix:** `.masthead .links` → `flex-wrap: wrap; gap: 8px 16px; white-space: nowrap` and drop to one row under the wordmark below 600 px (or collapse to "Brief · R1 · R2 · R3 · Current"). Give `.technique` a fixed min-height (3 lines) or `grid-template-rows` on `.study` so `.stage` aligns across cards. Re-take the cued clips with the viewport scrolled to the studies section (clip y from the first `.stage` and height ≈ 420 px).

## Also
- Chat strip shows the tinted "Fixer 2" rows even when "Show a tinted fixer on each card" is unchecked; ten rows push the studies below the fold at 1600 × 900. Show five rows by default and add the fixer rows only with the checkbox.
- Sand think: the vertical slot cut from the crown reads as a coin slot / a split head, not "thinking". Replace with the crown-grain hover from item 4.
- Sand tap: the still is a thin arc of grains above the head (a halo). Make the crater itself visible: a 0.3R-wide dent in the crown that fills over 0.4 s.
- Slime success: the "ring of agents" is a few stray pixels at 0.15 s and is gone by the still; raise agent count in the burst to ≥ 30 % of the population and take the still at 0.3 s.
- Flip-dot success: the ripple flips the body *off* so the still is a target/logo with a faint face. Ripple the paper-side rings only (a wave of unflipped "highlight" dots) and keep the body on.
- Sand 24 px error is a low bar with two specks; at that size use the silhouette + eyes rule from the contract (a heap 1.4R wide, 0.55R high, both eyes 3 px).
- Slime 24 px is a blurred disc in every moment (the whole row on `matrix.png`); listen/think/work/tap are the same pixel-for-pixel.
- Reduced motion: sand's reduced success keeps a frozen dust cloud and reduced hello keeps a frozen spray — a frozen mid-air particle field looks like a rendering glitch; converge to the body + eyes and a settled dusting on the crown.
- `browser-results.json` reports 19.7 ms/frame for all instances (≈ 50 fps on SwiftShader). Fine as a smoke test, but not evidence for the 4 ms hero budget; note that on the card or drop the fps readout.
- Mosaic risk line "rigid tiles read as ceramic more than as ink" is accurate — a 1 px cream grout at hero (vs ~2 px now) keeps it as ink with cracks rather than a turtle shell.
- The wordmark dot in the masthead (`nibbi●`) drops to a second line at 390 px.

## Verdict
1. **Put forward: Mosaic.** It is the only one that stays Nibbi at all three sizes without help, its toy behaviours (shatter, orbiting crown tiles, tile drag) are visible on the sheet, error and sleep are honest, and it is unlike anything in rounds 1–3. It needs item 7 and the sleep pattern fix only.
2. **Second: Sandglass** — identity and ink-on-paper are solid, error (heap) and success (fountain) are the clearest in the round; it needs the hello/work/think rework (items 4–6) before it can be judged on fun.
3. **Conditional: Flip-dot** — the most distinct *idea* and the best 24 px, but it is not a character until the eyes and the plate are fixed (item 3).
4. **Pom-pom** is the most fun to touch and the most legible at hero, but it is a soot sprite with a costume change for error/sleep; without the strand-length and silhouette changes in item 2 it cannot go forward.
5. **Weakest: Slime mould** — grey brain, five moments indistinguishable, and a different material at pill and 24 px. It is the one to cut or rebuild from the threshold render up.

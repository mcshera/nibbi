# Nibbi character lab — design review

Review only. Inputs: BRIEF.md, README.md, CONTRACT.md, `evidence/matrix-45*.png`, the five `sheet-*.png`, `lab-*.png`, `browser-results.json`, and the legibility code path in `verify.mjs`. Nothing was edited or re-run.

## Top 10 (highest impact first)

### 1. Inkdrop — the recommended body — does not carry state in a still. Seven of nine moments are the same picture.
**Where.** `matrix-45.png` row 1; `sheet-inkdrop.png`. Idle, listen, think, work, tap are one blob with different gaze. Hello and success are the same tall drop. Error at 45 % shows no drip (it appears at 70–90 %). `browser-results.json` agrees: inkdrop hero idle/tap diff 0.0059, idle/work 0.0167, tiny idle/tap 0.009 — the lowest numbers in the file.
**Why.** The first goal is "the character carries state before any panel does." The brief scores Inkdrop 3 (hero) / 2 (24 px) and still recommends it. A body that needs motion to mean anything fails the stated goal, and the "+ Typesetter marks" patch only covers think / work / error — hello vs success and idle vs listen stay identical.
**Fix.** Before recommending Inkdrop, give it silhouette states, not gaze states: listen = lean 0.12R toward the pill with the crown peak pointing there; think = a real hook (the brief promises one; the sheet shows ≈ 0); hello = wide squash (sx 1.25, sy 0.85) so it stops sharing the tall-drop silhouette with success; error = drip visible at 45 % (start the drip at t = 0.25·duration, not 0.6) plus a 0.94 sy sag. Re-run the sheet and require every 45 % still to differ from idle in silhouette, not only eyes.

### 2. Reduced-motion stills do not exist for Inkdrop and Cutout, and the brief says they do.
**Where.** `matrix-45-reduced.png`: Inkdrop idle/hello/listen/think/work/success/tap are pixel-identical blobs; only error (drip) and sleep differ. Cutout: six of nine identical. §9 claims "each has a defensible static reduced-motion expression"; the "How to look" list says "Each option should still carry state as a still expression."
**Why.** Reduced motion is a project requirement (OS setting + saved calm preference). In that mode two of five options carry two states out of nine. The verify check "pixel-identical across time" proves the stills are static, not that they are distinct — a blank canvas would pass it.
**Fix.** Add a check to `verify.mjs`: with `reduced=true`, pairwise diff over the *ink bounding box* (not the canvas) for all 36 pairs, fail below a threshold you set from a known-bad pair (e.g. Inkdrop idle/tap). Then author reduced stills per option: Inkdrop reduced think = the lab's leaning drop (note `lab-reduced.png` already shows a lean for Inkdrop think that the matrix does not — the two artefacts disagree; regenerate both from the same code). Correct §9 to "static, and distinct for Sumi, Sketch, Typesetter; not yet for Inkdrop, Cutout."

### 3. The legibility metric cannot support the §6 scores, and the "0 indistinct pairs" pass is empty.
**Where.** `verify.mjs`: diff = mean |Δred| over the whole canvas / 255; `indistinct` threshold 0.004. `browser-results.json` medians at 24 px: glyph .116, cutout .112, inkdrop .085, sketch .075, sumi .058. §6 gives 24 px scores 5, 2, 2, 2, 4 in that order — Cutout's second-best number gets a 2, Sumi's worst number gets a 4.
**Why.** Whole-canvas mean difference measures how much ink area moved, not whether a human can name the state. It is dominated by silhouette size (Cutout's jaggy edge and Typesetter's tall `!` score high for area reasons). A threshold of 0.004 is below the value of pairs that are visually identical (0.0059 idle/tap). So "indistinctPairsAt24px: 0" is not evidence; a reader will take it as one.
**Fix.** Either drop the number from the brief and README ("plus pixel-difference evidence" → remove), or make it meaningful: (a) normalise by the union of the two ink bounding boxes, (b) compute on the 24 px render at 1× DPR only, (c) set the threshold so Inkdrop idle/tap fails (≈ 0.03 on the normalised scale), (d) report the count. Add one sentence per option in §6 naming the weakest pair from the JSON so the table and the data visibly agree.

### 4. The recommendation is three recommendations. A decision-maker cannot act on §7.
**Where.** §7 gives: "most Nibbi → Inkdrop", "carries state best → Typesetter", "my pick → Inkdrop body + Typesetter marks", then a five-way decision guide, then two "would not do" items. The motion lab's own warning against blending styles is quoted and then overridden.
**Why.** The ask was five options and an opinion. The reader is asked to pick a question before they can pick an answer. And the pick as described (blot + `…` / cursor / `*` marks at small sizes) is what Typesetter *already is* at 24 px — see item 5 — so the brief recommends option 5 without saying so.
**Fix.** Replace §7 with one pick, one sentence of reason, and the test that would overturn it: "Pick: Inkdrop body with Typesetter's three marks at pill/tiny. Overturn if, in a 5-person naming test of the nine 24 px stills, fewer than 7/9 are named correctly." Move the decision guide to an appendix. State plainly: "This is Typesetter's 24 px behaviour with Inkdrop's edge and timing at hero."

### 5. Inkdrop, Cutout and Typesetter are one material at 24 px, and Inkdrop and Typesetter are nearly one material at hero.
**Where.** `matrix-45.png` tiny rows 1, 3, 5: idle, hello, listen, tap are indistinguishable across the three options (a black blob with two eyes). At hero, Inkdrop vs Typesetter differ by edge fuzz, a hairline baseline, and marks.
**Why.** The brief's claim is "five coherent material/grammar pairs." At the size the brief calls decisive (24 px), the lab has three materials (blob, blob-with-tail, outline) and two grammars visible in a still (body / marks). The choice is really: *blot with or without marks*, *tail*, or *outline*. Saying so would sharpen the decision.
**Fix.** Add a §4 paragraph: "At 24 px the five collapse to three silhouettes: blob (1, 3, 5), blob + tail (2), outline (4). Below 32 px the material does not survive; only silhouette and marks do." Then judge 1/3/5 at 24 px on marks alone and 2/4 on silhouette.

### 6. Typesetter breaks the identity rule it is scored highest on; Sketch is not Nibbi at rest.
**Where.** `sheet-glyph.png` success 20–45 %: eyes move to the top third of the tall body (contract: "low on the face"). Error: body at ~50 % grey — the contract says tint swaps ink only, and the brief's theme is near-black ink. Sleep `—` at 24 px is a 2 px line with no eyes visible — it reads as a rule, not a creature. Sketch at 24 px is a ring with two dots; §6 gives it "Still Nibbi 3", the same as Sumi, which keeps the dense black head.
**Why.** "The eyes are Nibbi" is the through-line the brief uses to justify five bodies as one character. Any option that moves or drops the eyes in a common state (success fires every completed job; sleep is hours) has left the character.
**Fix.** Typesetter success: keep eyes at 0.66R above the foot and let the body stretch *above* them (sy 1.5 anchored at eye line), so `!` reads from the top. Error: keep ink black, express "grey" as a 40 % alpha *hatch* or halftone over the body rather than a lighter fill. Sleep at tiny: keep the em dash but draw the two closed-eye ticks at 1 px minimum contrast, or use the pill's shape at 24 px. Sketch: lower "Still Nibbi" to 2 and say why (an outline is a drawing *of* Nibbi, not Nibbi).

### 7. Three options exceed the contract's own performance rule, and §9 says the contract passes.
**Where.** CONTRACT.md: "hero render ≤ ~2 ms typical (≤ ~250 path ops)." §6 render cost: Inkdrop ~340, Sumi ~430, Sketch ~560. §9: "Contract checks pass for all five."
**Why.** Either the rule is wrong or the claim is. A decision-maker reading "contract passes" will assume the perf budget is met; the WebGL production renderer is a different engine, but the brief presents these numbers as the cost comparison.
**Fix.** Change §9 to "Contract checks pass (finiteness, bounds, loops, reduced-static, ctx balance). The path-op budget is not checked; three options exceed it (Inkdrop 340, Sumi 430, Sketch 560) and would need simplification or the SDF route." Or add a path-op count to `options.test.mjs` and make it a warning, not a pass.

### 8. The 45 % sampling rule chooses the wrong frame for several states and hides working stills.
**Where.** Inkdrop error drip at 70–90 % only; Cutout think scrap at 20 % only, confetti gone by 90 %; Cutout crumple at 20–45 % then back to normal by 70 %; Sumi hello/think/tap/success all pass through "tail up" near 45 % (`sheet-sumi.png`), so the matrix shows four look-alikes for an option whose tail is otherwise a good pointer.
**Why.** "Design the still first" needs a *declared* still, not an accidental one. The matrix is the artefact the decision is made from, and it under-reports two options and over-reports none.
**Fix.** Add `stillAt(action)` (fraction of duration) to the contract with a default of 0.45, let each option declare its signature frame per action, and have `sheet.mjs --matrix` use it. For one-shots (hello, success, error, tap) also require that the *rest* silhouette after the gesture differs from idle for ≥ 40 % of the duration, or the state is invisible in any snapshot.

### 9. The lab never shows a 24 px avatar beside text, which is the one context the brief says decides everything.
**Where.** `lab-desktop.png`: the "chat row" tile is a lone 24 px avatar in a padded box under a 2R-wide hero. The matrix tiny row is on blank paper. §10 step 2 defers "idle beside real text" to later.
**Why.** Contrast against 14 px body type, alignment to the line box, and whether a `…` mark reads as "Nibbi is thinking" or "someone is typing" can only be judged in a real row. The lab has the renderer; it costs one component.
**Fix.** Add a "Chat strip" section above the option cards: five fake transcript rows (one per option), each with the 24 px avatar, a 14 px line of real copy, and the current moment applied. Include one row with a tinted fixer at 24 px (the matrix has no tint at tiny; §6 scores companion tint anyway).

### 10. The lab page hierarchy buries the instructions and the risks, and the mobile cue bar eats the viewport.
**Where.** "How to look" (the five things to check) sits at the bottom, after ~2,000 words of Material/Motion prose in ~11 px type; "Risks" is collapsed on every card; the cue bar says "1 Rest" while every other artefact says "idle"; canvas caption reads "idle · idle 10 %" (action · phase, but the phase strings equal the action names so it looks like a bug). `lab-mobile.png`: the sticky cue bar is ~600 px tall (three rows of cue buttons, an orphaned Pause button, three control rows, scrub) on a 844 px viewport; the five cards stack to 12,962 px so no side-by-side comparison exists on the phone.
**Fix.** Move "How to look" directly under the hero lede as five short checkboxes. Expand Risks by default (it is the most decision-relevant text on the card) and cut Material/Motion to ≤ 60 words each with a "more" toggle. Rename "Rest" → "Idle". Caption: show `phase` only when it differs from the action. Mobile: collapse the cue bar to one row (moment `select` + Play/Pause + a "⋯" for energy/speed/reduced/tint/loop) at ≤ 96 px, and add a horizontal 24 px strip (item 9) so the phone can still compare five at once.

## Also
- Cutout's "hop then seven confetti bits" is invisible on the sheet; success at 45 % is idle with three specks. Either raise the hop to 0.35R or drop the claim.
- Cutout: "eyes glued slightly askew" is not visible at any size; the shadow is grey on cream and reads as a blur, not a layer. Try a hard 2 px offset with alpha .3 and no blur.
- Sumi's tail has three real directions (right, up, front-left) shared by nine states; think and hello and tap all curl up. Give think a *loop* (spiral), hello a *wave* (S-curve), and keep tap as a flick.
- Sketch success = Inkdrop idle. Good metaphor, but say what it implies: Sketch is "Nibbi before inking", so at rest the companion is a draft — the brief's own risk list should include "the companion looks unfinished all day."
- §6 "Quiet idle" gives Sketch 3 with no reason; the JSON shows Sketch idle drift dy = 2 px, same as Inkdrop and Typesetter (5 and 4). State the reason (line boil) or level the scores.
- README says legibility scores are "the author's reading of the sheets plus pixel-difference evidence"; BRIEF §6 says "not user data." Align both to one sentence.
- Tinted fixer is on by default, so the first screen has colour on all five cards — contrary to "monochrome" being the first thing a reviewer should judge. Default off.
- Controls use browser-default blue range/checkbox chrome on a cream/ink page; style `accent-color: #1c1b18`.
- `willReadFrequently` warning ×10 in the JSON — pass `{ willReadFrequently: true }` in `verify.mjs` so the warnings list is empty and real warnings are visible.
- "the app is unchanged" appears in the lede, the footer, the README and the brief. Once is enough on the page.

## What is sound
- The framing (material × grammar, still before motion, 24 px as the gate) is the right frame, and the contract is a genuinely reusable spec for future options.
- Sumi and Typesetter stills mostly do the job at hero; Sketch's inked-success and Typesetter's `…`/cursor/`*` are the strongest single ideas in the lab.
- The deterministic sheet/matrix pipeline and the "does not prove" section in §9 are honest tooling; the problems above are in what the numbers are allowed to claim.

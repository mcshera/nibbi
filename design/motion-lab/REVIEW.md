# Motion lab review

Read-only source review of `index.html`, `lab.mjs`, `serve.mjs`, `PLAN.md`, plus the motion/renderer/CSS/reference files present at review time. No browser or visual tests run here. Line numbers refer to that snapshot. Only this review file was added.

## P1 — Back navigation can restore a dead lab

**`lab.mjs:136–137`** destroys all renderers, clears canvases, disconnects observers and permanently sets `destroyed = true` on every `pagehide`. There is no `pageshow` recovery. If the browser restores this page from BFCache after visiting the plan, audit or baseline, it restores those destroyed objects rather than running the module again.

**Fix:** on a persisted `pagehide`, pause instead of destroying; resume on persisted `pageshow`. Otherwise rebuild on restore. **Check:** open baseline → browser Back → play/scrub; repeat with a paused/reduced lab.

## P2 — Reduced-mode expression feedback is claimed but absent

**`motion.mjs:287`; `lab.mjs:46,66,101,140`.** Every reduced sample returns the same `neutralPose()`, regardless of action. The renderer supports static `happy`/`wide`, but the sampler never supplies them. “Still · expressive” and “Expressions still acknowledge the cue” are therefore inaccurate. Only the text/status/control selection changes.

**Fix:** either return distinct, static per-action expression values without time-varying motion, or explicitly say feedback is text-only. The complete spatial/texture stop is good; preserve it.

## P2 — Enabling Loop overrides an inspection pause

**`lab.mjs:20,45,120`.** Scrubbing makes `isActive()` false. Checking Loop then calls `start()`, which clears inspection and forces `paused = false`. A configuration change unexpectedly starts moving the character and loses the inspected pose.

**Check:** Jump → scrub to 50% → check Loop. **Fix:** store the loop setting while paused; restart only on an explicit Resume/Play. Consider making Rest interrupt with the existing short pose blend instead of queuing behind a long gesture (`49–52`).

## P2 — Mobile comparison controls are separated from the animation

**`lab.css:6`; `index.html:18–29`.** Mobile stacks three tall cards. All cue controls remain above card one; the scrubber is below card three. By the time a person scrolls from the shared Jump button to Living ink or Little oddball, a one-shot may have finished. Offscreen culling is sensible, but it does not make those styles replay when revealed.

**Fix:** provide a small sticky transport, per-card Replay, or a mobile single-card selector. **Check:** at 390px width, operate each style and inspect its landing without scrolling away from the moving character.

## P2 — A material threshold may introduce a bottom-edge pop

**`renderer.mjs:89–91,149`.** The native skirt clamp disappears entirely when `satellite` crosses 0.001, even when the bead is essentially invisible. That changes the main body's distance function discontinuously rather than only revealing a bead. This is a source-level continuity risk; its visible severity needs the parent's frame check.

**Fix:** preserve the skirt treatment on the main-body distance before unioning beads, or blend that treatment continuously. **Check:** liquid hop/morph just before and after satellite onset and disappearance, with the texture clock fixed. Inspect the belly edge, not only the beads.

## P3 — Finish evidence and clarify fallback navigation

- `PLAN.md:135` refers to `TEST-RESULTS.md`, which was not present in this review snapshot. Add the actual results and their limits before handoff; do not imply visual/device checks have already passed.
- `PLAN.md:27` places “`?2d` forces the simplified fallback” immediately after the baseline reference. The query is implemented only by the lab, not `baseline.html`. Give the exact link `/design/motion-lab/?2d`.

## What is sound

- The local server restricts paths, resolves real paths before serving, binds loopback, and does not load the app backend. No obvious traversal escape was found in this source review.
- The renderer uses the same deformation map for ink and eyes. Deterministic sampling, strict motion stop, backend reporting and fallback disclosure are useful foundations.
- The plan correctly separates this experiment from production. It explicitly limits mass-conservation, performance and platform claims. Keep those limits after browser checks; a good hero preview does not prove tiny-avatar behavior or app-state integration.

## Follow-up: high-energy eye overlap

**P2 — `renderer.mjs:13–15,113,378`; `motion.mjs:145`.** The two white eye radii sum to `58.9/135R × wide`, while their centers are only `70/135R` apart. Their vertical offset is negligible. They begin to overlap around `wide = 1.1885`. Mischief's high-energy apex reaches the renderer's 1.3 limit, giving approximately 0.0487R of overlap (2.9px at R60). Because both outlines receive the same invertible transform, registration does not prevent this merge.

Inspect Jump/Success at maximum Energy. If the white shapes merge, cap wide near 1.18 or adjust spacing with an explicit face-containment check. This finding is analytic geometry, not a rendered-image observation.

### Parent-reported fixes after the initial snapshot

The parent reports that reduced-mode copy now describes static-face/text acknowledgement, and persisted pagehide/pageshow now suspends/resumes instead of destroying the lab. Browser verification is in progress; those changes were not independently tested here.


## Parent resolution after implementation and browser tests

The listed prototype issues were addressed: persisted navigation now suspends/resumes; reduced copy is text-only; Loop preserves an inspected pause; mobile has sticky transport and a compact scrub; skirt influence fades continuously; wide eyes have a smooth sampler limit and renderer safety cap. Exact fallback URL and TEST-RESULTS.md are present. The final suite passes 13 Node tests and 21 browser checks, including eye-outline containment, separate whites, navigation, controls and mobile geometry. Shader-wide continuity, tiny avatars and real-device performance remain explicit integration limits. See TEST-RESULTS.md for evidence rather than treating this original source review as a visual approval.

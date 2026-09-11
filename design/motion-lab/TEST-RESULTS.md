# Motion lab: actual test results

Validated on 2026-09-05. Scope: the isolated prototypes in `design/motion-lab/`, not the production app.

## Result

- **13/13 Node motion tests passed.** `evidence/unit-results.txt`.
- **21/21 browser checks passed.** No page or console errors. `evidence/browser-results.json`.
- **486 sampled poses:** all six actions × three styles × three energies × nine gesture positions. Conservative bounds stayed inside the canvas. Both full 64-point eye outlines stayed inside the body shape field. Eye whites stayed separate.
- **45 independent high-energy pixel readbacks:** ink was present; no nontrivial alpha reached the two-pixel canvas edge band.
- **Video:** 411 actual rendered frames, 30 fps, 13.7 seconds, 1200×540, VP8 WebM. Exported offline so a slow capture machine cannot drop motion frames. Browser metadata and decoded-frame seek check passed (4.333s frame), recorded in `evidence/video-check.json`. The server supports byte-range requests (206; 101 bytes returned for bytes=0–100), so the reel can be scrubbed reliably.

## What was tested

### Motion math

- Analytic time sampling, finite values, safe ranges and invalid-input handling.
- Neutral start/end and neutral tail for every finite action; quiet continuous idle loops.
- Numeric C1 continuity across phase joins and dense interior samples.
- Anticipation, takeoff, air, landing and settle labels; planted anchor during grounded phases.
- Determinism, input non-mutation and matching samples at different refresh schedules.
- Reciprocal scale: `sx × sy = 1`. This is a scale constraint, **not a measurement of conserved ink area through morphs**.
- Energy clamps, separate eye whites at maximum energy, retained landing squints.
- Fully static reduced samples, including blink and expression.
- Real profile/action differences, ordered shape changes and returning liquid beads.

### Browser / renderer / controls

- All three shaders compile and report WebGL, rather than silently falling back.
- Geometry and pixel checks described above. Minimum sampled face-field margin: **0.077R**. This is an approximate local signed-distance margin, not a physical clearance measurement.
- Smallest safety-fit factor: **0.9783**. Some strongest poses shrink about 2.2% to remain framed; production needs precomputed action envelopes rather than relying on this prototype fit.
- Queued repeat cues; pause stops scheduling; scrub pauses; Loop does not unpause inspection.
- Half speed, flow/boil texture choice and browser-local shortlist controls.
- Reduced mode freezes the whole drawn image across changed time/cues. OS preference works at load and after a live preference change.
- Persisted pagehide/pageshow keeps renderers alive. Original-reference → browser Back remains usable.
- 390px mobile and 768px tablet: no horizontal overflow. Mobile controls stay available at the third style; the compact scrub works.
- Forced Canvas2D fallback at DPR2: all styles render inside their bounds. Texture is intentionally simpler than WebGL.

## Visual evidence reviewed

Actual screenshots/frame contact sheets were inspected, not only numeric geometry:

- `evidence/desktop.png` — complete comparison surface.
- `evidence/mobile.png`, `mobile-inspect.png` — stacked layout and sticky transport.
- `evidence/hop-storyboard.png` — anticipation, extension, air, contact and neutral return for all three styles.
- `evidence/morph-storyboard.png` — distinct round/star/drop and liquid-bead silhouettes.
- `evidence/fallback.png`, `reduced-motion.png` — alternate rendering/policy checks.
- `evidence/comparison.webm` — normal-timing moving comparison. `video-frame.png` is a decoded frame from that file.

The eyes stay recognizable. Pocket spring reads as the clearest everyday motion; Living ink sells material change; Little oddball is most useful as a rare accent. This is a design judgment, not a user study.

## Issues caught and fixed in the prototypes

1. High energy could merge the white eyes. The sampler now smoothly limits widening to 1.14; the renderer defensively caps arbitrary poses at 1.16. Added a regression test.
2. The native skirt treatment toggled at a bead threshold. Its influence now fades continuously over satellite amount 0–0.18 instead of popping at 0.001.
3. Unconditional pagehide cleanup could break browser Back. Persisted pages now suspend and resume; true unload still releases resources.
4. Loop could restart a paused inspection. It now preserves the pause.
5. Mobile controls were far from the second and third previews. Added sticky controls and an inline scrub.
6. Reduced-mode copy promised expressions that were not implemented. The lab now accurately states that the neutral character stays still and text acknowledges cues. Static per-mood expressions remain in the integration plan.
7. An initial real-time software-rendered recording dropped frames. Replaced it with a deterministic offline 30fps render; the reel must not be used as a live-performance benchmark.

## Limits / not yet verified

- No production state integration, deployment, commits or changes to `public/nibbi.js`. That file remained byte-identical to the initial task snapshot. Existing/concurrent work elsewhere in the repository was left alone.
- No physical fluid simulation, exact silhouette-area conservation, exhaustive pixel-level face containment proof, or formal perceptual study.
- C1 pose tests do not prove pixel continuity in every shader fragment. The skirt fix removes the identified discrete gate, but dense production motion/texture review is still needed.
- Browser checks used local Google Chrome with **SwiftShader software WebGL**. Driver ReadPixels/readback performance warnings were recorded. These are not frame-rate measurements on target hardware.
- Real-device GPU profiling, Safari/WKWebView/Tauri, context-loss recovery, tiny app/mirror sizes, live speech, layout travel, and app-state priority/interruption remain integration gates in `PLAN.md`.
- The prototype queues gestures and uses a short pose blend after inspection. It does not implement a production inertial/velocity-preserving transition system.

The requested plan, working style tests and implementation options are complete. The user subsequently preferred Pocket spring. Refining and integrating that direction into the live app remain next steps; no production integration was performed here.

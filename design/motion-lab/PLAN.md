# Nibbi: more life, still Nibbi

## Preferred direction — Pocket spring

**The user prefers Pocket spring.** Use it as the direction for the next refinement pass, replacing the earlier hybrid recommendation. Keep Living ink and Little oddball as comparison studies, not default additions.

Focus on the elastic wind-up, clean jump, rounded apex, soft landing and small after-wobble. Keep the existing ink texture and oversized eyes. Refine the round → soft star → drop shape play already in Pocket spring. This records a creative preference; it does not approve or perform a production rollout.

Keep Nibbi quiet while you read or type. Motion should answer something: your greeting, a real completion, a curious glance. Do not make every streaming token a jump. This is a plan and a working style lab, not a replacement of the app.

## Open the tests

From `/Users/Matty/Documents/Nibbi`:

```sh
node design/motion-lab/serve.mjs
```

Open **http://127.0.0.1:4536/design/motion-lab/**. The server binds loopback only and serves the lab, the existing renderer reference, and local fonts. It does not start the daemon or access agents, voice, projects, or accounts. If the port is busy, use `NIBBI_MOTION_PORT=4537 node design/motion-lab/serve.mjs`.

1. Press **Play the comparison** for jump → morph → hello → celebration.
2. Try **Jump**, then **½ speed**. Notice preload, stretch at takeoff, apex, landing, and recovery.
3. Try **Shapeshift**. All three should stay recognizable while changing silhouette.
4. Scrub to compare the same percentage of each style’s gesture. Their durations differ by design. Resume restarts the cue together.
5. Compare **Continuous flow** and **Stepped boil**. This changes the texture timing, not the gesture.
6. Set **Reduced motion**. The lab stops spatial movement and moving texture, not just the big jump.
7. Shortlist any combination. This saves only in your browser; it does not select a production design.

`baseline.html` loads the unchanged current engine for reference. Open `http://127.0.0.1:4536/design/motion-lab/?2d` to force the lab’s simplified fallback. Stage previews exaggerate the range so choices are clear; they are not intended as the always-on idle behavior.

## Three creative directions

| | 01 · Pocket spring | 02 · Living ink | 03 · Little oddball |
|---|---|---|---|
| Feeling | Soft, weighty, responsive | Curious, viscous, quietly alive | Asymmetric, surprising, proud |
| Jump | Crouch → quick extension → round apex → broad landing → diminishing settle | Longer pull-up with a drop-like crest and trailing bead | Sideways wind-up, tilted skip, cheeky recovery |
| Shape play | Round → soft star → drop, within a coherent elastic body | Puddle-like spread → teardrop → small bead → return | Wonky star → round/drop → return |
| Everyday use | Greeting, click reaction, finished reply | Thinking, listening, moving between layouts | Explicit play and meaningful completion |
| Main risk | Generic rubber-ball feel if too symmetrical | Face lost in goo; shader cost; detached bead can read as a second character | Too distracting; star can look like an unrelated mascot |
| Guardrail | Keep ink edge; short flight; grounded landing; eyes lead the response | One main face-bearing mass; sparse beads; slow surface flow | No constant antics, full spins, limbs or mouth; long calm holds |
| Relative implementation | Lowest: reusable action layer and transform correction | Medium: morph targets, smooth unions, face-safe geometry | Highest: richer choreography, interruption rules, more bounds tuning |

Pocket spring is the preferred direction. The other studies remain available for reference, but the next pass should tune Pocket spring rather than expand it into a hybrid.

### Suggested personality rules

- **Idle:** subtle breath and occasional glance; no repeated jumping. Sleep must really settle.
- **Hello / deliberate click:** one responsive hop with anticipation; gaze toward the person or pointer.
- **Thinking / working:** a low-amplitude lean or soft compression toward the work, not frantic shaking.
- **Speaking:** a filtered audio-energy envelope layered lightly on the rig; no hop per token.
- **Success:** one larger spring, perhaps a brief star on a meaningful milestone. Coalesce bursts of completions.
- **Error:** a readable static expression or short restrained recoil. Never look celebratory.
- **Reduced motion:** static expression feedback; no translation, squash, morph, particles, texture drift, blink loop, or sway. Layout changes still redraw at the correct position and size.

## How to build it: technical options

### Recommended: procedural action layer + the existing ink shader

The app already uses WebGL SDF ink and a 2D face. Preserve those materials and the `createNibbi()` public API. Add a renderer-independent normalized pose, sample authored motion in seconds, then map that same pose to body, face, attachments, bounds, and hit targets. Keep ambient texture separate from gesture timing.

- Best fit for live gaze, voice, changing size, arbitrary state changes and tinted companions.
- No new runtime dependency or asset pipeline is needed for the first version.
- Authored round/drop/star distances can be blended smoothly; keep a face-safe central mass.
- Biggest work is transform correctness, interruption policy, fallback parity, and all the small app sizes. The lab proves direction, not production readiness.

### Alternative: authored vector rig (Rive or SVG paths)

Use designer-authored pose transitions with a runtime state machine; drive gaze and voice parameters separately.

- Better if a motion designer needs direct timeline control and distinctive hand-authored poses.
- Requires a new asset/workflow and a proof of the textured ink look. Raster-like feathering is not free in vector art.
- SVG path morphs need compatible topology. Split/rejoin goo still needs a special treatment.
- Prototype one greeting and one morph before changing renderers. No such rig has been built or benchmarked here.

### Alternative: short sprite/alpha-video accents

Render a few special one-shot gestures offline and composite them over the normal character.

- Good for a rare elaborate celebration or promo, not the everyday interactive body.
- Costs: assets at multiple sizes, seam matching, memory/decode cost, weak interruption, baked gaze, and platform alpha-video support.
- Keep the procedural character for the live companion. Do not replace responsive eyes with a looped clip.

**Avoid a full fluid simulation for v1.** It adds tuning/performance risk and makes a stable face harder. Controlled morphs can sell liquid ink without physically simulating it. The current lab approximates mass through reciprocal scale; it does not prove constant area across changing silhouettes or simulate liquid physics.

## Staged implementation plan

These are relative work packages, not delivery promises. No production rollout is included in this lab.

### 1. Repair the common rig first

- One foot-anchored body/eye map, including squash, width, lean and rotation. Use a face-safe region for strong shapes.
- Put the current APIs behind a central reduced-motion policy. Clear moving particles when enabled.
- Replace redraw heuristics with explicit dirty state for target, radius, fade, expression and resize.
- Time-sample hop/shake; use exact exponential damping or stable substeps for interactive springs. Do not add shake back into persistent lean every frame.
- Preserve existing API signatures and current neutral appearance. Add feature flag and rollback switch.

**Done when:** the current app looks the same at rest; eyes track the body within 1 CSS px at the tested extremes; reduced mode can move/resize/fade the static character without freezing or leaving the face behind.

### 2. Ship one elastic motion vocabulary behind the flag

- Add anticipation, push-off, air, contact and settle phases in radius-relative units.
- Use a short/coalescing action queue. Error/user interruption outranks celebration; speech is a low-energy layer.
- Fade ambient energy down during reading and talk layout. Bound all jumps to the available screen region.
- Update companion/mirror crops and hit-testing; do not just increase the old 30px hop constant.

**Done when:** repeated events do not restart/snap the body, no clipped peaks, no overlap with controls, and 30/60/120Hz samples agree. Test delayed frames and hidden-tab behavior deliberately.

### 3. Refine Pocket spring’s shape play

- Preserve Pocket spring’s ink treatment; texture flow and stepped boil remain independent of its movement.
- Tune its existing round → soft star → drop sequence so the elastic body stays readable and returns cleanly to Nibbi.
- Keep liquid beads and oddball sideways skips out of the default scope. The preferred style is Pocket spring, not a blend of all three.
- Measure silhouette area and face containment, not only reciprocal scale. Tune neutral-return seams at full and small sizes.

**Done when:** Nibbi stays recognizable at every sampled frame, face never leaves the body, shape bounds are stable, and the result still feels like the paper-and-ink character.

### 4. Wire real states and validate on target devices

- Map existing `setMood`, `pulse`, `hop`, `shake`, `splash` and companions to the new pose layer.
- Hero radius 56–150, talk radius 34–52, mirrors 58×46 and 44×36. Reduce embellishment by available size.
- Chrome, Safari/WKWebView/Tauri, DPR 1/2, resize, reduced-motion load/toggle, hidden/resume, WebGL unavailable/context loss.
- Profile one character plus the maximum normal companions on real hardware. Target a stable 60Hz UI where supported; choose a character-render budget after measuring the rest of the app. Software-renderer test timings are not a shipping benchmark.
- Rebuild the served app, verify cache behavior, then synchronize the marketing renderer from a canonical source. Story-mode face studies remain separate.

**Done when:** all regression gates pass, no noisy idle/voice behavior in a real conversation, and the selected style can be switched off without changing chat logic.

## Acceptance and review checklist

- [x] Record the user’s preferred direction: Pocket spring.
- [ ] Review largest squash, push-off, apex, contact and neutral return at normal and half speed.
- [ ] Check face containment during every morph; pure shared transforms are necessary but not sufficient.
- [ ] Check actual ink area continuity; sx × sy = 1 only covers scale.
- [ ] Verify event interruptions, bursts, size transitions, visibility and true reduced motion in the app.
- [ ] Test and tune talk/mirror sizes, not just hero previews.
- [ ] Benchmark target devices and validate Safari/Tauri before rollout.

See `AUDIT.md` for the code-level reasons behind this plan. See `TEST-RESULTS.md` for the actual checks run on these prototypes and their limits.

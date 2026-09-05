# Nibbi motion audit

Scope: source review only. No production files changed. Findings below are from code, not a browser performance or visual test.

## What actually renders

- **App source:** `public/nibbi.js`, created in `public/app.js:18`; `public/index.html:65` loads it before the app module. WebGL draws the ink; a separate Canvas2D layer draws eyes, beads and spatter. This is not a CSS/SVG character.
- **Served app:** Vite copies that file unchanged to `dist/ui/nibbi.js` (`vite.config.ts:7–18`). The daemon serves `dist/ui` (`daemon/src/main.ts:37,62`); desktop opens that daemon. The current built renderer matches the source byte-for-byte. Editing only the source does not update an already-built app.
- **Marketing:** `site/index.html:64–74` loads `site/nibbi.js`, currently identical to the app renderer. It adds scroll fading and CTA gaze/happiness. It is a separate copy, not the app entry point.
- **Story prototype:** `nibbi-story/` has its own server and older renderer. Its `soft/mochi/pip/wisp` options are face studies, not active app motion styles. Do not use it as the production integration target.
- Preserve the strong identity: asymmetric feathered ink, paper grain, low oversized pip eyes, two catchlights, no permanent shadow. The shader explicitly has no pool despite old comments mentioning one.

## Highest-priority findings

### 1. Reduced motion has both policy gaps and a redraw bug

`public/nibbi.js:310,382–390,442,557–574`:

- `hop()` and the automatic happy hop ignore `reduced`. Direct `spatter()` and `drip()` also bypass it; error schedules flattening and spatter. Existing particles keep moving. `splash()` is guarded, but that does not protect the other APIs.
- Idle gaze and blinks still run. Speech can still add crown sway through `leanT` even though its bob is disabled.
- A settled reduced-mode pose eases toward new targets **without updating velocity**. The WebGL `need` condition checks velocity, not target/pose changes. It also ignores changing fade, mood shape and resize. Thus the ink can remain at an old position/size while the 2D eyes move, or remain blank after resize. Turning reduced motion on during travel can retain stale velocity and defeat the freeze optimization.
- The app listens for preference changes (`app.js:1242`); the marketing page only gets the renderer's initial preference. CSS shortens durations to 1ms but does not remove infinite iteration (`styles.css:189–191`), so it is not a full stop policy.

**First integration gate:** one policy must guard every action and ongoing effect. Reduced mode should keep static mood feedback, cancel spatial/texture motion, snap layout changes and redraw all dirty visual state.

### 2. Hop timing is clock-based, but the choreography is weak

`public/nibbi.js:287–290,381–387,568`:

| Milestone | Current timing |
| --- | --- |
| Anticipation | 0–110ms, vertical scale 1 → 0.86 |
| Launch / apex | Lift starts at 110ms; apex at 330ms |
| Contact / recovery | Contact at 520ms; squash ends at 620ms |
| Other clocks | 700ms retrigger guard; poof through 1000ms; redraw flag through 1400ms |

Maximum lift is only `30/135 = 0.222R`: about 7.6–11.6px at the app's talk radius. Launch begins fully compressed and stretches slowly to 1.06 **at the apex**. That makes it read more like a bob than a forceful jump. Lift is continuous, but takeoff/contact change velocity abruptly; compression, flight and follow-through do not share one event model. A new hop can reset the remaining poof. This is not a “700ms flight” or a frame-counted hop.

**Direction:** explicit anticipation → push-off → flight → contact → settle phases. Stretch at push-off, round near apex, compress at contact, then one decaying wobble. Keep jump height and travel bounds relative to radius.

### 3. Eyes are not registered to body deformation

The shader squashes around the planted foot, widens the body through `u_sq * 0.55 + 0.45`, then bends the crown (`nibbi.js:86–91`). Eyes use an approximate `lean * 0.55`; their centers never receive squash and their heights receive only 10% of it (`496–497,521–525`). At radius 135 and scale 0.86, the left eye's expected foot-relative anchor shifts about **10.7px**, but its current center does not.

Larger squash or morphs will expose this mismatch. Companion eyes also omit their body's working squash. Use one shared local-to-world deformation map for ink, eye anchors and attached beads. Keep eyelid expression separate from body geometry. Morphs also need an interior face-safe region; shared transforms alone cannot keep eyes inside a split silhouette.

### 4. Some motion remains refresh-dependent

`nibbi.js:297,305–315,362,385,390–395`:

- The spring integrates only one step, capped at 33ms. Slower frames discard simulation time, while hop ages still use wall time. Droplets use a different 50ms cap.
- `sm()` uses linear `dt * k` damping, not exact exponential damping.
- Shake adds an offset back into persistent `leanAmt` every frame. It is not a sampled transient offset, so refresh rate changes its accumulated amplitude.
- Hidden tabs pause RAF, but event ages use wall time on return. Decide explicitly whether actions finish or pause; do not accidentally mix both.

Use pure time-sampled authored actions; exponential smoothing or bounded fixed substeps for interactive springs; compose shake onto the base pose without feeding it back.

### 5. More wobble is not genuine shapeshifting

`nibbi.js:93–129,293,337–345` builds one truncated radial dome with four harmonics, one directional puff and textured fringe. It can make mild lobes; it has no authored shape targets, smooth unions, split/rejoin body parts or rotation rig. Increasing harmonic amplitude alone risks noisy edges, not readable transformations.

The three-offset boil intentionally changes at roughly 5–15Hz by mood, faster with speech. That stepped redraw can look jittery even at high FPS. Keep it as a **texture option**, independent of smooth body movement. Test continuous ink flow against deliberate hand-drawn boil; do not erase the ink texture to gain fluidity.

### 6. Integration has small-size and bounds constraints

- App layout springs between an idle radius of 56–150 and talk radius of 34–52 (`app.js:39–56`). Most production motion is small. Do not cover the feed, composer or controls; canvas is below UI (`styles.css:31–32,54,143`).
- Existing calls already map work to thinking/working/speaking, success to happy, failure to error, pointer to gaze, and audio to `pulse()`. Preserve that contract rather than replacing app orchestration (`app.js:815–864,1170–1219`). Add action priority/coalescing so repeated completions do not create a carnival.
- Mirrors are 58×46, with mobile companions 44×36. Their fixed crop extends only about 1.75R above center (`nibbi.js:502`); a much higher hop can clip. Shader early-out is about 2.7R from center, and hit-testing remains an undeformed 1.35R circle. Bounds and interaction must follow any new motion.
- The 2D fallback is a simpler oval/fringe and does not share all GL transforms or fade. It has no companion rendering path; WebGL context-loss recovery is absent. Test and report fallback honestly.

## Three style options to compare

| Lab direction | Distinctive motion language | Identity guardrail |
| --- | --- | --- |
| **Elastic / Stamp hopper** | Deep but brief preload; quick teardrop launch; rounded apex; broad ink-stamp landing with two diminishing edge ripples. A playful, readable success gesture. | Weighty ink, not a rubber ball. No glossy highlight or permanent ground shadow. |
| **Liquid / Curious puddle** | Mass rolls across a planted foot, stretches into a comma, pulls a small satellite bead, then rejoins. Thinking becomes a slow traveling bulge; success becomes a liquid leap. | One main face-bearing mass; sparse satellites; maintain perceived ink volume. Avoid a generic metaball screensaver. |
| **Mischief / Brushstroke trickster** | A gaze-led double take, asymmetric crouch, short sideways skip and briefly scalloped/star-like silhouette, then a shy return. Rare surprise, long calm holds. | No limbs, mouth or full spins. Protect the low pip face and imperfect ink outline. Personality comes from timing, not nonstop motion. |

## Staged plan and test gates

1. **Isolate now.** Keep all options in `design/motion-lab/`. Show the same idle, hop, morph, hello, success and thinking sequence with pause, scrub, slow motion and replay. No production replacement during style review.
2. **Establish the common rig.** Deterministic pose sampling, shared body/eye transforms, bounded shape weights, stable volume and strict reduced motion. Separate action motion from texture flow/boil. Retain the current silhouette as the neutral baseline.
3. **Choose through tests, not an idle screenshot.** Compare all three at hero size, talk radius, mirror size and mobile size. Inspect anticipation, launch, apex, contact, recovery and exact neutral return. Check 30/60/120Hz, 100–250ms frame gaps, repeated triggers, resize and hidden-tab resume. Check eyes at strongest flatten/lean/morph; target ≤1 CSS px registration error. Test reduced motion both at load and mid-action, with every public action and layout/fade change. Run WebGL and forced fallback. Check clipping and frame cost with several companions/mirrors.
4. **Integrate only after selection.** Add a small action/pose layer behind an opt-in flag while preserving `createNibbi` and its existing API. Fix redraw/reduced-motion and transform registration before raising motion amplitude. Prefer event-led accents with quiet idle. Keep rollback to the current renderer.
5. **Promote deliberately.** Rebuild `dist/ui`, verify desktop/browser/offline-cache behavior, then synchronize the marketing copy from a canonical source. Keep story-mode face studies separate. Add motion-specific tests; the current unit test directory contains only text tests, and the UI verifier does not validate choreography.

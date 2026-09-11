# Nibbi motion lab

Three working style options for a more fluid, playful ink companion. **No production files or live app state are changed.**

## Preview

```sh
cd /Users/Matty/Documents/Nibbi
node design/motion-lab/serve.mjs
```

Open **http://127.0.0.1:4536/design/motion-lab/** and press **Play the comparison**.

- **Pocket spring:** elastic preload, jump, soft landing and after-wobble.
- **Living ink:** slower teardrop/puddle-like shapes and rejoining beads.
- **Little oddball:** asymmetric skips, a wonky star and expressive shape changes.

Try jump, shapeshift, hello, celebration and thinking. Change speed, energy and ink texture. Pause, scrub, loop or enable reduced motion. On mobile, controls stay nearby as you scroll. Shortlisting is browser-local only.

**Preferred direction: Pocket spring.** The user picked its elastic character. The next pass focuses on its jumps, soft landings and existing shape play; the other styles remain reference studies, not default additions. The plan also compares implementation routes. Production integration has not started.

## Read / share

- [PLAN.md](PLAN.md) — preferred Pocket spring direction, technical routes and staged integration gates.
- [AUDIT.md](AUDIT.md) — current app engine findings and constraints.
- [TEST-RESULTS.md](TEST-RESULTS.md) — measured checks, evidence and known limits.
- [Jump storyboard](evidence/hop-storyboard.png) · [Morph storyboard](evidence/morph-storyboard.png).
- [Comparison video](evidence/comparison.webm) — deterministic 30fps export of actual rendered prototype poses, not a hardware benchmark.
- [Original engine reference](baseline.html) — unchanged `public/nibbi.js` loaded directly.
- [Forced Canvas2D fallback](http://127.0.0.1:4536/design/motion-lab/?2d) — simpler texture, same pose rig.

## Reproduce checks

Use the repo’s installed Node and Playwright dependencies. The local server must be running for browser checks/export.

```sh
node --test design/motion-lab/motion.test.mjs
node design/motion-lab/verify.mjs
node design/motion-lab/record.mjs
node design/motion-lab/check-video.mjs
```

`verify.mjs` uses local Google Chrome (bundled Chromium in CI) with SwiftShader for repeatable WebGL. It writes evidence and a JSON report. `record.mjs` samples every frame offline before encoding; it uses Playwright’s cached FFmpeg or `FFMPEG_PATH`. It temporarily writes MJPEG to ignored `output/nibbi-motion-lab/`, then removes it after success. No dependency or global configuration changes are required on this machine.

Environment overrides: `NIBBI_MOTION_PORT` for the server, `NIBBI_MOTION_URL` for checks/export, `FFMPEG_PATH` for video encoding.

## Files / limits

`motion.mjs` is a pure normalized pose sampler. `renderer.mjs` adapts Nibbi’s existing ink shader and eye proportions into an isolated shared-transform rig. `lab.mjs` controls the preview only. No external requests, accounts, agent calls or generated video assets.

The lab is not production-ready wiring. Smooth sampled motion does not establish real-device performance. Reciprocal scale does not prove conserved ink area through morphs. Reduced mode currently keeps a static neutral character and acknowledges cues in text; per-mood static expressions are a production-plan item. See the plan for tiny-avatar, speech, interaction interruption and Safari/Tauri gates.

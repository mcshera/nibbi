# Interactive Pocket browser QA

## Run

From `/Users/Matty/Documents/Nibbi`, after `npm run build`:

```sh
node tools/pocket-verify.mjs --harness-only
node tools/pocket-verify.mjs --app-only
node tools/pocket-app-extras.mjs
```

The scripts use this project's Playwright and installed Chrome. They do not install dependencies. Start long commands in the background and inspect their logs when done. `--quick` retains the six-action renderer smoke test; it is not the full gate. `--headed` and `NIBBI_QA_CHANNEL` remain supported by the main verifier.

## Isolation and evidence

- The renderer harness route-fulfills its source files and uses its existing manual clock. Its 24-action checks are unchanged. The prior 223 checks are retained. The current runner also checks source stability (224 total).
- Actual-app tests run built `dist/ui` against `tools/test-backend.mjs`: a temporary backend, vault, work directory and fixture project. No live provider is called. Direct-input tests use normal mode without sending turns. Conversation tests use `demo=1`; success-cycle tests submit the read-only local `/help` command. Milestone tests emit isolated fixture `run.updated` records through the real backend SSE stream.
- Browser routes reject every mutation except same-origin POST `/nibbi/state` and `/nibbi/client-log`. These two passive report paths are recorded separately. Agent, account, login and provider mutations are not excluded. External HTTP requests are blocked.
- Reports record source and built-asset SHA-256 hashes, final snapshot stability, input sequences, interaction diagnostics and real screenshots. Actual-app tests never call `interactions.event()` or an animation chooser. Renderer-only tests still call the library directly.
- Default evidence: `output/pocket-interactions/` and `output/pocket-interactions/extras/`. Set `NIBBI_POCKET_QA_OUT` to retain a candidate-specific run. Each report also has a timestamped copy.

## Actual-app checks

- No shelf, action buttons, chooser, or old selector markup in the app or build.
- Real pointer/touch region taps, rapid taps, hold previews/releases, upward flick/slow pull, downward/horizontal drag, and mouse tickle.
- Body-start hit gating. Empty canvas and ordinary UI cannot trigger a tap. Only the FX canvas restricts touch gestures.
- Keyboard Enter and Space; Escape, pointer cancel, outside release, visibility cancellation and calm cancellation clear gesture state without sending chat.
- General `#st-motion` preference, persisted local choice, OS OR local policy, and touch-only menu access.
- Real composer focus/type, image acceptance, send, busy nod, demo success, tidy, error, abort and idle sleep/wake paths. No manual semantic event calls count as browser acceptance.
- Legacy renderer compatibility. Uncaught browser errors fail the run.

## Renderer gate retained

All 24 actions at nine temporal samples, four viewports, WebGL and Canvas2D. The existing checks cover finite bounded poses, scale area, eye/body geometry, crop-edge pixels, mirrors/companions, reduced motion, stable radius, queue/interrupt/stop, hidden time, context loss and renderer cleanup. The renderer and motion library are not edited by this QA adaptation.

## Limits

Installed Chrome with SwiftShader is not a Safari/WKWebView/Tauri certificate or real-GPU performance result. Screenshots do not prove motion quality. Image paste and visibility tests dispatch DOM events; they are not OS clipboard/window tests. Sleep uses Playwright's clock, followed by real pointer movement. Fast CDP touch inputs queue ordered start/move/end messages together so protocol/paint waits do not turn a flick into a slow pull. Demo replies exercise the real send/completion UI without certifying a provider. Pure policy tests separately cover all semantic mappings. The browser also checks success/milestone rotation through actual completion paths; it does not claim all 24 actions were independently reached.

## Current status

- Ordinary app regression: **PASS**, `npm run verify`, 7.57 seconds (parent-run).
- Full renderer gate: **224/224 passed**. This includes all prior 223 checks plus source stability. Evidence: `output/pocket-interactions/renderer-final/results.json`.
- First frozen app run: **23/24 passed**. Its mobile flick was delivered too slowly by awaited CDP paint responses and correctly became a drop. `app-final/` retains this failure evidence.
- Final queued-input rerun: **24/24 passed**, `output/pocket-interactions/app-final3/`. Fast mouse and touch sequences both pass. Keyboard focus/AT and source pins pass.
- Final real app paths/preferences: **18/18 passed**, `output/pocket-interactions/extras-final4/`. A terminal success must either be accepted or demonstrably coalesced behind an active higher-priority nod. Two trusted real Send clicks prove the second aborts pending work. All three local success rotations and both fixture SSE milestone rotations pass. No failed groups.
- Held pancake and post-release boing screenshots: **passed**, `output/pocket-interactions/gesture-shots/`. `tools/pocket-interaction-shots.mjs` captures real desktop/mouse and mobile/touch input. The post-release target is 230 ms, and renderer elapsed time is recorded.

Old shelf screenshots and passes are historical, not acceptance for this correction. Generated JSON reports are the source of truth. SHA pins include production files and all built UI assets. No live app, provider, deployment or agent/account action is used.

All QA browsers and temporary fixtures closed after the final sequence. The main renderer, app and screenshot reports passed their source/build stability checks. Earlier extras failures remain in candidate reports; no production code was changed to hide them.

Supplemental already-started admission-trace run: `output/pocket-interactions/extras-final5/`, **18/18 passed**. This run finished after final4 had satisfied acceptance. Browser and fixture cleanup completed. No further runs or source edits followed.

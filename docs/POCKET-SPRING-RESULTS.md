# Pocket spring — interactive app acceptance

2026-09-05. This record supersedes the former Tricks shelf acceptance. The user asked for animations in the actual game/app, happening interactively, with no Tricks panel. The source and local build now use direct interaction. No deployment or installed-app replacement was performed.

## Requirement audit

| Requirement | Current implementation and evidence |
| --- | --- |
| Actual app, not just a motion lab | `public/app.js` installs `public/lib/pocket-interactions.js` on the real FX canvas. Current Vite output contains the module. Browser tests use the built app and isolated backend, not the lab. |
| No Tricks panel | The shelf module, stylesheet, imports, button, right-click opener, and shelf-specific layout are removed. A source/built-text scan found no old panel selectors. The only motion setting is a calm toggle in the existing connection menu. |
| Direct play | Center/zone taps, double/triple taps, squish/long hold, upward/downward/sideways drag, flick/release, and mouse tickle use real pointer/touch input. Enter, Space, Escape, and assistive click activation act on the character. Gesture input never selects a catalog button. |
| Natural app/game reactions | Real greeting, composer focus/typing, accepted image, send, success, game/work milestone, tidy, and wake paths call semantic cues. Existing mood/speech wiring handles think/listen/yawn/oops and audio response. The parent retains application state authority. |
| Pocket spring character | The 24-action motion library and textured WebGL/Canvas2D rig are unchanged from the start of this correction. No hybrid, limbs, mouth, permanent shadow, or random idle bounce was added. The eyes and original fuzzy ink remain. |
| Input safety | Radius-scaled thresholds, one captured pointer, bounded diagnostics, cooldowns, busy nods, and cancellation for Escape/blur/hidden/reduced/destroy. Multi-taps no longer invoke tidy. Native error feedback wins motion priorities, including cancelled/outside releases. |
| Calm and accessibility | Saved `nibbi.pocketCalm` OR system reduced motion gates both input and renderer. System reduction cannot be overridden. Canvas button semantics, body-sized focus ring, keyboard controls, and zero-detail assistive activation are present. Live screen-reader software is not certified. |
| Preserve the application | Animation code does not call provider, account, agent, or action endpoints. Browser fixtures reject such mutations and record existing passive UI reports separately. No backend source, account, deployment, or service changes were made by this correction. Unrelated dirty work was retained. |

## Verification status

- `npm run build`: passed on the current interaction source.
- `npm run typecheck`: passed on the current interaction source.
- `PATH="$HOME/.nibbi/bin:$PATH" npm test`: **80/80** (22 interaction +20 motion +7 text +31 daemon). The PATH uses an existing ripgrep; no dependency was installed.
- Full renderer QA: **224/224**, including the prior 223 checks plus source stability; **1,728 sampled poses** (24 actions ×9 times ×4 sizes ×2 renderers). Renderer/library hashes remain unchanged.
- Actual-input browser acceptance: **24/24 passed** in `app-final3`. Real desktop and touch gestures, fast/slow releases, keyboard, assistive activation, cancellation, calm and non-mutation checks pass. CDP input now queues fast gestures without artificial command-acknowledgement delays; the gesture assertions and production source were not relaxed.
- Natural-event/preference browser acceptance: **18/18 passed** in `extras-final4`. Real composer/image/send/busy/error/stop/tidy/wake paths, saved/system calm policy, all three eligible completion cues and both fixture SSE milestone rotations pass. A stronger active send/busy nod may intentionally coalesce a lower-priority success cue; the test verifies that exact priority condition. Earlier fixture/timing failures remain recorded, not hidden.
- Existing `npm run verify`: **passed**, run alone after Pocket QA browsers closed (7.57 seconds). Desktop/phone, provider controls, skills, vault, schedules, review failure retention, replay, idempotency and origin protection passed.
- Real gesture screenshots: **passed** and visually reviewed. Desktop/mobile held and release poses retain the fuzzy ink and separate eyes. Keyboard focus is visible near the body, and no chooser covers the scene. Final source-pin audit checks 25 production/built files per app, extras and gesture report, with **zero mismatches**. Targeted `git diff --check` passed.

## Evidence

Current evidence is under `output/pocket-interactions/`. Use final run names listed in [POCKET-QA.md](POCKET-QA.md), not the failed candidates. Native build/typecheck/test logs and `final-build-sources.json` are recorded there. `before/` and `app-interactions.patch` preserve the scoped parent change. The earlier shelf record is retained as `output/pocket-spring/HISTORICAL-SHELF-ACCEPTANCE.md`; its screenshots and UI instructions are historical only.

The current module SHA-256 is `c985df66b70d4c4769a15a268f0315b2c90759d8d9e2dc7797c2f54e2de2d9c9`. Production remains unchanged during final browser acceptance.

## Try it and scope limits

Run `npm run fixture` from the repository after building, then open the printed URL with `?nosw=1&demo=1`. Tap, hold, or drag Nibbi itself. The demo does not call a live provider. See [POCKET-SPRING.md](POCKET-SPRING.md) for gestures.

The tests use installed Chrome with SwiftShader and Canvas2D. They do not certify real-GPU frame rate, Safari/WKWebView/Tauri, an installed application, a live microphone, an OS clipboard, or live screen-reader software. Synthetic visibility/clipboard cases and test-clock sleep are identified in QA evidence. Screenshots alone are not timing proof. The legacy renderer is an escape hatch, not a claim of identical new interactions. `site/nibbi.js` and other marketing surfaces were not changed or deployed.

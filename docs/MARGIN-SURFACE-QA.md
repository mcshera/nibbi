# Margin surface QA

Status: **PASS — 16/16 checks**, final frozen frontend; evidence-only rerun completed 2026-09-07 02:10 UTC. Browser and static server closed. Source/frontend pins stayed stable and still match after review.

## Baseline review

Reviewed the three supplied native screenshots in `output/margin-polish/`.

- Paper: conversation text bleeds through the card, especially after scrolling. An opaque warm paper surface is justified.
- Hierarchy: metadata labels compete with preference names. Muted values wrap densely on desktop.
- Dismissal: scrolling the minimum-height card hides its title and close button completely. Keep the header outside the body scrollport.
- Feedback: preference rows resemble plain text. Pill borders are faint. The source cascade lets `.margin-pill:hover:not(:disabled)` replace a primary button's dark fill with translucent pale ink while its text stays light.

## Bounded verifier

Run only against the parent's frozen `dist/ui`:

```sh
node tools/margin-surface-verify.mjs
```

The tool serves static files on a fresh loopback port. It imports no backend, daemon, native bridge, or build script. Playwright routes every API read to a known fixture. Unknown API reads, external requests, and action writes are blocked and fail the audit. Passive state/log writes receive mock acknowledgements. No ship confirmation is clicked; real mouse-down tests `:active`, then releases outside the button. Audio and notification effects are mocked.

Sixteen checks cover:

- Actual wheel scroll and pinned, hit-testable header at 520×480 native, 390×430 mobile, and 1180×713 desktop. A fully fitting desktop body must remain stationary.
- Forward and reverse keyboard traversal: focused body controls stay inside the scrollport and hit-test correctly.
- Actual periodic fixture refresh, stable scroll DOM/position, and spend-cap draft.
- Close and Escape restore the settings trigger and preserve a seeded real-app conversation and composer draft.
- Settings/project width containment at 320, 390, 520, 1180, and 1440; long headings do not cover close.
- Opaque primary backgrounds and text contrast ≥4.5 at true rest, hover, and active.
- Exact existing metadata/provenance strings and preference ARIA states, including OS reduced motion.
- Frontend/source SHA-256 pins, network/error audit, and browser/static-server cleanup. No daemon pins.

Evidence: `output/margin-surface/results.json` and PNGs. Chrome emulates the native-Mac platform marker; it does not certify OS traffic lights or native window rendering.

## Result and independent final review

Final run: `output/margin-surface/results.json` and `run.log`. The final candidate run and evidence-only rerun each completed in about 18 seconds. All 16 checks passed. There were no page/console errors, unknown API reads, external requests, failed requests, or action writes. Passive state/log posts were mocked. Frozen source pins and all built frontend pins matched before/after, and matched the on-disk files at review. Cleanup confirms Chrome and the static server closed.

| Evidence | Result |
| --- | --- |
| Native 520×480 | Rails at 48px, card at 104px, max height 360px. Real wheel moves body 0→136px; header stays fixed and close hit-tests. |
| Mobile 390×430 | Real wheel moves body 0→216px; title and close remain visible. |
| Desktop 1180×713 | Tidy fully visible at initial rest with at least 12px bottom clearance. All content fits. |
| Keyboard | Forward/reverse Tab keeps each enabled body control fully visible and hit-testable in all three sizes. Focusable scroll region is included. |
| Refresh/dismissal | Periodic same-model project read preserves body DOM and scroll position. Spend-cap draft remains 73. Close and Escape restore Settings focus; conversation and unsent composer draft survive. |
| Width/title | No horizontal overflow at 320/390/520/1180/1440. Long title wraps without covering close. |
| Primary contrast | Rest **16.47:1**, true hover **11.42:1**, true active **17.93:1**; all backgrounds opaque. No ship action dispatched. |
| Metadata/preferences | Exact provenance strings and all five preference ARIA states unchanged; OS reduced-motion state remains authoritative. |

### Independent visual verdict

**No blocking surface issue found.** Reviewed final desktop settings, native/mobile scrolled settings, 320px long project, and all three primary-state PNGs.

- Opaque warm paper removes the conversation bleed seen in the supplied baseline. The card remains visually related to the page without sacrificing text clarity.
- Muted metadata labels, darker values, and stronger preference names provide a clearer reading order. Subtle state capsules make preferences look interactive without adding visual noise.
- Header/title/close remain stable at the bottom of short cards. The body can clip content at its edge while scrolling; keyboard checks confirm controls are revealed rather than hidden under the header.
- The final desktop height fixes the earlier partly clipped Tidy button. Its whole outline is now visible at rest.
- The primary button remains dark and legible while hover/press gives visible feedback. Long project headings keep a separate close-button area.

### Initial-run correction

The first run passed 15/16 (`results-initial.json`, `run-initial.log`). The dismissal helper incorrectly required downward motion after reopening a card already at its preserved bottom position. With parent approval, the helper now uses a real upward wheel to establish the top before asserting strict downward motion. No visibility, contrast, or input-safety assertion was weakened. The parent separately increased desktop height to remove the observed 16px Tidy clipping; compact native/mobile geometry was unchanged.

The focused surface phase used no native operations, backend/daemon imports, production edits, or dependency installs. The separately authorized existing regression phase below used isolated fixture backends.


## Existing isolated regression suites

Parent authorized these runs after the backend owner froze `daemon/dist`. They ran sequentially, with explicit async completion notifications. No live/native UI operations or builds ran.

| Command / evidence | Result |
| --- | --- |
| `NIBBI_MARGIN_QA_OUT=output/margin-surface/regression node tools/margin-ui-verify.mjs` | **18/18 pass**, exit 0. `regression/results.json`, `regression.log`. |
| `NIBBI_MARGIN_POLISH_QA_OUT=output/margin-surface/compact-regression node tools/margin-polish-verify.mjs` | **13/13 pass**, exit 0. `compact-regression/results.json`, `compact-regression.log`. Pins stable. |
| `npm run verify` | Both browser and review suites pass, exit 0. `ordinary-verify.log`. |

The ordinary suite covers existing desktop/phone, provider controls, skill inspection, vault, schedules, stale settings responses/saves, stage-only goals, failed-review retention, event replay, idempotency/origin protection, review races, and input shortcuts. These are the repository's existing tests against temporary fixture backends, not live-state claims.

Cleanup: margin UI reports browser/fixture closed and temporary state removed. Compact QA reports browser closed and fixture removed. Both ordinary scripts await browser and fixture cleanup in `finally`; their successful exits and an empty listener check on all four logged fixture ports support completed cleanup. `regression-summary.json` records stage exits/durations and the listener check. Current frontend/source pins still match the focused final run (zero mismatches). No further reruns were needed.


## Native screenshot-only review

Reviewed the four parent-supplied native captures directly. This worker performed no native/browser actions for this review.

- `native/desktop-settings.png`: Settings is genuinely open. Its opaque paper hides the live conversation underneath. The full Tidy conversation button is visible. Native traffic lights and side rails remain separate from the card.
- `native/minimum-settings.png`: the 520×480 native window shows the open card below the titlebar/rails. Settings and the close glyph are plainly visible; metadata is readable with no conversation bleed.
- `native/minimum-bottom.png`: the scrollbar is at the lower end and the final action row is visible. Settings and the close glyph remain in the same header position while the body has scrolled. The titlebar/rails remain clear.
- `native/minimum-closed.png`: the card is absent, the settings glyph is no longer filled, and the underlying conversation and composer are visible. This visually supports successful dismissal, rather than relying on process exit alone.

**Native visual verdict: pass for the requested surface checks.** These still images establish visibility and dismissal, not keyboard focus, hit-testing, or draft preservation; those are covered by the isolated browser assertions above. The parent reports the native batch and restore both exited 0, with restored bounds `50, 29, 1180, 712`; restoration is parent-reported, not inferred from these four images.

Native screenshots are kept separately under `output/margin-surface/native/`; the parent moved them without changing their image bytes. The focused static verifier was rerun only to restore its own PNG evidence paths. Final result remains **16/16 pass**, exit 0, with stable source/frontend pins and both browser/static-server cleanup flags true. The current hashes match the final report. Direct inspection confirms `output/margin-surface/native-minimum-settings.png` is again the **520×480 fixture browser image**, not a native capture. Initial harness-failure records remain preserved.

The parent also reviewed `native/restored.png` and reports the restored 1180×712 window has its card closed with conversation/composer preserved; this worker did not operate the native window or independently review that fifth image. No further tests or actions are required for this QA scope.

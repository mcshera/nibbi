# Margin UI QA

Status: **accepted on 2026-09-06**. Final actual-app QA passed **18/18**. Ordinary browser and review regression passed. Source and built-file pins matched throughout the final run. Browser and temporary backend state were cleaned up.

## Run

From the Nibbi repository: `node tools/margin-ui-verify.mjs`. Build first with `npm run build`. Ordinary regression follows with `npm run verify`.

## Safety and evidence

The script starts `testBackend` with temporary state. Browser reads use explicit seeded project, milestone, auto, goal and status fixtures. External requests and all agent/account/provider mutations are blocked. Passive UI state/log writes, notification prompts, speech and audio are mocked. No live account or provider is used.

Artifacts are `output/margin-ui/results.json` and PNGs beside it. Results include source and built-file SHA-256 hashes, fixtures, browser errors, network attempts and cleanup status. Milestone progress is seeded through `/api/milestones`, not inferred from mock automation totals. Project selection is tested against an existing conversation created through the actual composer with `/plan fixture`.

## Coverage

- Actual built app project selection preserves the conversation and sends no backend mutation.
- Milestone progress, branch, goal, spend and automation map from read models. Unknown progress has no invented percentage.
- Native Space activates Settings, Voice and project controls. Focused rail letters cannot navigate or arm real fixture review.
- Outside click and Escape close cards. Escape restores trigger focus without tidying.
- A spend-cap draft survives a real periodic project response. The response changes a visible branch marker. The original input, focus and edited value must survive that rendered update.
- Voice, sound, notifications and calm preferences persist. Mock OS notification permission persists across reload. OS reduced motion disables the local off control.
- Advanced settings remain project-scoped and keyboard-safe. The selected tab must have readable rest and hover contrast.
- Baseline rails clear the character, composer and chat. Cards fit 1440/1180/390/320 widths and short viewports. Short cards scroll to their lower actions.
- Long names, many projects, empty projects and delayed loading remain usable.

## Final evidence

- `output/margin-ui/results.json`: 18 passes, zero failures, zero browser exceptions, zero attempted backend mutations, source/build SHA-256 pins and cleanup confirmation. Completed 2026-09-06 at 18:30:52 UTC.
- `output/margin-ui/run.log`: final fixture QA log.
- `output/margin-ui/ordinary-verify.log`: passing `npm run verify`, including browser and review regression.
- `output/margin-ui/final-build-type-unit.log`: parent build, typecheck and 74 unit-test acceptance.
- Final screenshots: `desktop-1440.png`, `populated-chat-1440.png`, `project-card-1440.png`, `quick-settings-1440.png`, `glyph-keyboard-label-1440.png`, `glyph-hover-label-1440.png`, `cap-draft-after-refresh.png`, `advanced-settings-1440.png`, plus baseline/project/settings/advanced images at 1180×820, 390×844, 320×568, 1440×480 and 390×430.

The selected Providers tab is now opaque `rgb(21, 20, 19)` with `rgb(250, 248, 243)` text at rest and during true pointer hover. Contrast is 17.34:1. It has no background animation. The final test requires alpha ≥ .99 and contrast ≥ 4.5:1.

## Candidate findings and fixes

The first run passed 16 of 17 checks. The sole failure was the QA clock being installed after app timers. The rerun armed the clock before navigation and passed cap preservation. Its only failure was the expected source-pin mismatch from the requested gear glyph change during the run. Both runs cleaned up browser and temporary backend state.

Independent screenshot review found one blocking issue: selected Providers text was almost white on a pale tab. The platform owner fixed the selected hover/active cascade. A subsequent actual-app check exposed a background transition that could leave the white label over a transparent fill while frames were delayed. The owner removed the tab background transition. Final computed-style checks and desktop/mobile screenshots confirm the fix. The advanced test also closes its dialog in `finally`, so a failure cannot contaminate the following glyph-focus check.

Preserved candidates: `results-first-run.json`, `results-candidate-before-gear.json`, and `results-final-attempt3.json`. The latter records the contrast failure and its downstream focus failure. Bounded diagnostic evidence remains in `preference-diagnostic/`, `prefix-diagnostic/` and `contrast-diagnostic.json`. These are historical diagnostics, not the accepted final result.

## Independent final visual review

Final screenshots were independently viewed after the passing run. **No remaining blocking visual issue was found.** The selected tab is readable at desktop and 320px. The Settings control is now a gear, not a brightness symbol. Keyboard and hover captions visibly reveal beside the circular controls.

The desktop uses the requested 5c2 rings and always-visible names, 5c1 circular glyph controls, and 5c3 floating paper cards. Long names truncate in the rail and wrap fully in the project card. Compact layouts leave only Projects and Settings around Nibbi. Project and quick-settings cards can cover the character while open on narrow screens; they remain dismissible and internally scrollable. This is expected modeless-card behavior, not a baseline overlap.

Reference files: `design/projects-settings/v5c2.png` (left), `v5c1.png` (right), and `v5c3.png` (cards).

This verifies Chrome with isolated fixtures. It does not certify Safari, native Tauri, OS account permission dialogs or live provider operations.

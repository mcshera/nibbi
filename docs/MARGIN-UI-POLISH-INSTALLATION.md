# Margin polish — installed delivery

2026-09-06. Follow-up goal: `improve` (`1c3b0a9b-5b55-42d4-bb5b-2e9a79b06449`). Scope and evidence: `MARGIN-UI-POLISH.md`, `MARGIN-UI-POLISH-QA.md`, and `output/margin-polish/`.

## Improvements

- Compact Mac shell controls now clear the window buttons. Actual520×480 before/after screenshots show the fix. Native compact rails start at48px; cards start at104px and scroll within the remaining height. Ordinary browser, phone and Windows layouts keep their prior spacing.
- Settings show a concise real session identifier and a clearly labelled brain override when no project model is reported. Explicit project settings still win. Unknown provider means `Not reported`, not `Not configured`. Known zero metrics remain zero; missing or invalid metrics are not fabricated.
- Original character, Pocket engine/interactions, chat, composer, project actions, keyboard ownership and reduced-motion authority remain unchanged.

## Fresh checks

- Frontend Vite build and UI TypeScript check pass;85 unit tests pass, including10 new pure-metadata tests.
- Focused current-app matrix:13/13 pass. Existing margin regressions:18/18 pass. `npm run verify` passes ordinary browser and review checks.
- Current source/frontend/daemon pins match. Browser fixtures close and temporary state is removed. No live account/provider/project mutation was used by UI QA.
- Native shell was safely reopened after an empty-draft screenshot and idle health check. Same conversation remains visible. Actual native Settings shows Ready, real session/model/context data and an explicitly unknown provider. Native scrolling exposes lower preferences and advanced actions at520×480 without activating them.

## Delivery boundaries

Only the existing native shell was reopened; no binary replacement, dependency install, migration or backend restart by this UI task. A separate owner-approved personality adoption restarted backend15087→14561 before the UI refresh. This task waited for its smoke completion and kept14561 running.

The original window was at50,29 with width1180 and height713. macOS returned height712 on restore requests for both713 and714. The original position and width were restored; this one-point height clamp is recorded, not hidden. Native keyboard/device/voice/OS-permission certification is not claimed. Browser keyboard regressions pass.

Evidence: `output/margin-polish/ACCEPTANCE.json`, `INSTALLED.json`, `served-build.json`, `source-pins.json`, logs, native PNGs, and browser/regression results. These are the current polish results. Earlier `output/margin-ui/` records remain historical baseline evidence.

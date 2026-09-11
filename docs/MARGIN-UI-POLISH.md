# Bounded margin polish

Active follow-up goal: improve (1c3b0a9b-5b55-42d4-bb5b-2e9a79b06449).
Parent chooses two evidence-backed UI improvements, retaining selected5c2left/5c1right/5c3cards.

1. Compact native Mac windows: current rails move to14/18px from the top, overlapping the thin Tauri shell's traffic lights in narrow/short windows. Confirm with native520x480 screenshot, then add native-Mac-only spacing. Keep ordinary browser/phone layout unchanged. Cards remain scrollable. Restore native window size/position after checks.
2. Live settings metadata: current game project rows omit settings; live status has modelOverride and sessionId, not sessionShort. UI should show available brain model with explicit provenance and a concise real session ID, while unknown provider stays Not reported. Explicit project settings remain authoritative. No invented configuration.

Parent owns app.js/margins.css integration and bounded QA. Metadata worker owns ONLY new public/lib/margin-metadata.js +tests/margin-metadata.test.mjs. Helper pure marginMetadata({status,project,busy,link,demo,sessionCost,sessionTurns}) returns string brain/session/context/model/provider.

Preserve existing dirty UI/personality changes. No backend/account/provider actions, restarts, migrations or dependency installs. Do not edit Pocket files. Parent delivers via UI build+safe native shell refresh after tests, preserving draft/history. This UI task will not restart the backend. Concurrent owner-approved personality adoption may restart it; coordinate and record the new PID before UI delivery. Do not build daemon during that restart.

Use current native metadata/screenshot evidence, helper unit tests, targeted compact browser/native checks and existing margin/ordinary regressions. Keep bounded; no new feature panels or unrequested behavior changes.

## Current evidence

- Actual native520×480 before screenshot confirms the project ring intersects the red window button. Read-only C/CoreGraphics helper identifies the exact window; no foreground-screen ambiguity.
- Production patch: native-mac class scoped to Mac +native/app marker; compact rails48px, cards104px, max-height100dvh−120px. No ordinary browser changes.
- Pure metadata helper integrated;10 isolated helper tests +all85 unit tests pass. Frontend Vite build +UI TypeScript check pass.
- Focused actual-app fixture matrix13/13 PASS, exact source/dist/daemon pins and cleanup, output/margin-polish/browser/results.json. Fresh18/18 margin regressions and ordinary/review checks pass. Installed delivery verified; see MARGIN-UI-POLISH-INSTALLATION.md.
- Concurrent approved personality activation changed backend15087→14561 at2026-09-06T20:05:43Z. This UI task did not restart it or adopt prompts. Native refresh waits for that owner’s live smoke to finish.

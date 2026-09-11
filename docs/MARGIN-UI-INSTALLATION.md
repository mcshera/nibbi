# Installed margin UI update

2026-09-06. User references: left5c2, right5c1, floating cards5c3 in `design/projects-settings/mock.html`.

- New labeled project rings and right-side icon controls use real project/settings read models.
- Paper project/quick-settings cards and matching advanced settings preserve actions, keyboard ownership, focus and drafts.
- Pocket character, animation engine and interactions are unchanged. No Tricks panel.
- Build/typecheck and74 unit checks passed at the UI freeze.18/18 current UI checks and ordinary/review regressions passed. Candidate failures/fixes are retained, not hidden.
- Reopened the existing `~/Applications/Nibbi.app` to load the accepted UI from `http://localhost:4527/?app=1`. Native1180×713 window was visually confirmed with retained chat and new rails.
- No backend restart, native binary replacement, migration, account change or dependency installation. Backend PID15087 stayed unchanged. Existing native backup remains `~/Applications/Nibbi.app.backup-20260905-161255`.

Evidence: `output/margin-ui/ACCEPTANCE.md`, `INSTALLED.json`, `results.json`, `served-build.json`, logs and screenshots. Detailed QA: `docs/MARGIN-UI-QA.md`.

This is native launch/visual smoke plus isolated Chrome acceptance, not full WKWebView, physical-device, voice or OS-permission certification. Concurrent personality changes were preserved and are separate from this UI update.

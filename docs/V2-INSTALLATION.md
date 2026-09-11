# Local v2 UI installed

Installed at 2026-09-07T19:32:08.165359+00:00 after explicit owner approval to update the app and discard the single draft character. The input was empty at the final refresh checks; no draft contents were saved in the evidence.

- Current UI asset: `assets/index-BwJZEAd3.js`.
- All 20 candidate files served over local HTTP matched the tested build hashes.
- The native app was relaunched: PID 9995 → 24763. The service worker is network-first, and the app reported fresh state after relaunch.
- Backend stayed on PID 85648; no backend/Whisper restart or native binary replacement.
- Window geometry stayed `50, 29, 1180, 712`. The final app check was idle, empty-input and microphone off.
- All 257 compared backend record hashes, all 814 messages, settings/session data, 85 staged runs, disabled automation and SOUL/AGENTS/MEMORY hashes matched before/after.

The manual-Finish audio-tail and pending-playback cancellation fixes are now in the local UI. Validation remains 238 unit/daemon tests, both typechecks, and 22 isolated browser checks each on desktop/mobile. No real microphone/STT test or provider conversation was generated for this installation. The proposed personality draft was not adopted. No Git commit or remote deployment occurred.

Evidence: `output/v2-install/INSTALLED.json`, `publication.json`, `before-state.json`, `after-state.json`, candidate hashes and browser review. Previous UI files remain in `output/v2-install/pre-refresh-ui` and `replaced-ui`; old hashed assets were retained in the published tree. Any rollback must preserve current drafts/work and should restore only the UI, not runtime data.

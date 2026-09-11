# Hey Nibbi control follow-up

The side-rail microphone now controls wake listening, just like the composer microphone and Settings → **Hey Nibbi microphone**. All three show the same on/off state. Say **Hey Nibbi** to trigger **What's up, Matty?**, then speak your message.

The speaker icon is now **Spoken replies**. It only controls answer audio. **Sound effects** remains available in Settings. The microphone stays off until explicitly enabled; no startup permission or hidden capture was added.

## Why this changed

Installed diagnostic events showed repeated spoken-reply toggles while the actual microphone stayed off. The microphone-shaped rail control dispatched `voice` rather than the wake-listening toggle. This was a control-mapping/discovery gap, not evidence that the wake parser failed.

## Validation and installation

Source: `public/app.js`, `public/lib/margin-ui.js`. Regression coverage: `tests/margin-ui.test.mjs` and `tools/voice-verify.mjs`. New acceptance checks cover shared state across rail/settings/composer, speaker controls never requesting the microphone, and cancellation while a permission request is pending. Desktop and mobile wake/greeting/followup/cancellation tests pass with synthetic microphone data and real local audio playback of a test clip. Unit tests and typecheck pass.

Evidence, immutable build hashes, screenshots, native preflight and installation results: `output/voice-trigger-followup/`. This is a frontend-only update. The existing gateway, native binary, user history, projects, providers, settings values and protected personality files were not changed. Native physical microphone permissions and room-acoustic accuracy were not exercised.

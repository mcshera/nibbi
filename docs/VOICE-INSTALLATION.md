# Installed microphone toggle

The tested UI is active in the existing Nibbi app. The native shell was refreshed, not replaced. Window geometry remains 50,29,1180,712. The mic is visibly available and off by default.

- Click the mic (or press ⌥ Space) to turn wake listening on/off.
- Say “Hey Nibbi”. Nibbi plays “What's up, Matty?”, then listens for one message.
- No hold-to-talk. After the reply, wake listening resumes while enabled. Hiding/reloading or changing projects turns capture off.
- Spoken reply settings remain separate; the wake greeting still plays.

## Evidence

`output/voice-toggle/INSTALLED.json` records the installation. `browser-build-hashes.json` pins the tested UI; live HTTP bytes match `assets/index-BFWRhv45.js`, SHA256 `60a1bd84d532430424a3c3ae1b70628b8903a79e0fa9b82e4ff64c9b52eb0b1a`. `native-after.png` and native `/nibbi/state?client=app` confirm the refreshed app with mic off.

Voice-only backend build changed only `api.js` and its source map. Graceful gateway restart 85030→85648 preserved all checked records, 814 messages, 85 staged runs, and protected/MEMORY hashes. The endpoint's exclusive file creation establishes ownership before cleanup; regression tests preserve colliding existing files and clean partially written owned files. A synthetic installed request returned `Hey Nibbi!`, removed its new upload and left all 1905 preexisting audio files unchanged. Whisper-only PID80726 is healthy with transcript diagnostic redaction.

Checks: 120 unit tests (35 voice-specific), 84 daemon tests, typecheck, Python privacy test, desktop/mobile wake acceptance, and general/review browser regression checks pass. The real browser audio probe used synthetic input through real WebAudio/MediaRecorder and local Whisper; ambient speech was ignored, the exact local OGG greeting played, and only the following command reached a mocked lead. Warm wake STT was 581ms; greeting playback took about 2.8s. Cold/resumed service timing varies.

No real user microphone, physical-room accuracy, native microphone permission prompt, or live provider conversation was exercised. The owner must grant microphone permission on first use. Tests never generated a real chat turn. No protected personality changes, provider/account changes, native binary replacement, commit or remote deployment were performed.

Backups and detailed test output are under `output/voice-toggle/pre-activation/` and `output/voice-toggle/`. Old hashed UI assets remain available for open clients and rollback.

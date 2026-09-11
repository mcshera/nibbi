# Microphone toggle and “Hey Nibbi”

## Daily use

1. Click either microphone button once (side rail or composer), use Settings → Hey Nibbi microphone, or press ⌥ Space. These all toggle the same wake listener. Allow microphone access if asked.
2. The dark mic and **Say “Hey Nibbi”** status mean wake listening is on.
3. Say **“Hey Nibbi”**. Nibbi says **“What's up, Matty?”** and shows **Listening — go ahead**.
4. Say your message. After about 0.9 seconds of quiet, Nibbi finishes the recording and sends it once. **Processing speech · mic paused** means recording has ended and transcription is running. It returns to waiting for “Hey Nibbi” after the reply. While speaking, you can also press **Send** or Enter to finish immediately.
5. Click the mic again to turn it fully off. Holding/releasing the shortcut is not push-to-talk.

“Hey Nibbi, [message]” also works in one utterance. The wake phrase is removed before the message is sent. The greeting plays even if **Spoken replies** is off. The speaker icon and Settings → Spoken replies control normal answer audio only; they never turn the microphone on. **Sound effects** remains a separate Settings control.

Silence for 12 seconds after the greeting returns to wake listening. Wake recognition pauses during Nibbi's own speech, active turns and typed/image drafts. Drafts are not overwritten. Changing projects, hiding/leaving the app, losing the mic, or reloading switches capture off; it never silently re-enables. It needs the open app, not an OS-wide background Siri service.

## Privacy and limits

- This is an explicit opt-in local speech gate, not browser/cloud SpeechRecognition. While the mic is on, detected speech segments go to the Mac's local Whisper service to look for the wake phrase. Ambient words are not sent to the conversation provider or chat history.
- Audio requests are temporary and removed after transcription finishes, including failures. Stopping the mic aborts the browser upload/response and invalidates all late results; a local transcription already running may finish, but cannot send a chat message.
- Whisper diagnostic logs contain timing and model choice, not transcript snippets. Existing historical files/logs are not deleted by this change.
- After activation, the actual message goes to Nibbi's configured provider, under the same approval rules as typed messages. Local reply synthesis keeps its existing TTS cache.
- The wake phrase is matched at the start of a locally transcribed utterance; case/punctuation and the narrow “Nibby” spelling are accepted. This is not a dedicated low-power keyword model. Accuracy and delay depend on the microphone, room, and local Whisper service.
- Mac/browser microphone permission and an available local speech service are required. Paired phones use the Mac's local backend over paired HTTPS. Hidden/mobile-suspended pages do not keep listening.

## Implementation

- `public/lib/wake-voice.js`: abortable, generation-guarded wake/followup gate.
- `public/lib/mic-capture.js`: local speech activity detection, the same onset/end noise cutoff, 200 ms pre-roll delay, bounded 25-second segments, a 3-second recorder-finalization watchdog, and track/context cleanup. End detection does not require digital silence. Loud background speech can still need manual Send.
- `public/lib/voice-player.js`: cancellable local synthesis playback through a gesture-unlocked WebAudio context (including Safari/WKWebView).
- `public/app.js`, `public/voice.css`, `public/index.html`: visible toggle, status, keyboard/native shortcut, and reply integration.
- Backend transcription request cleanup and Whisper logging are part of the activation boundary. Do not enable continuous wake listening against the old retaining endpoint.

## Checks

Run `npm run test:unit` and `npm run typecheck`. The speech-service privacy check is `~/.nibbi/venv/bin/python tests/whisper-privacy.py` (mocked models; no socket or microphone). Browser checks use `node tools/voice-verify.mjs` with an isolated backend, fake microphone levels/recorded input, synthetic transcripts, silent real WebAudio playback, and mocked lead responses. No real provider conversation is needed. Set `NIBBI_VOICE_UI_DIR` to a separately staged UI build to avoid changing the live app while testing.

Build the candidate with `node_modules/.bin/vite build --outDir ../output/voice-toggle/ui-candidate`. The static-shell plugin honors this output path. Install only after tests and backend privacy changes pass. Keep the previous UI tree/hashed assets for rollback. Runtime/installation evidence is recorded under `output/voice-toggle/`.

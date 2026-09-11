# Installed speech-end repair

The speech recorder no longer lowers its noise cutoff after speech starts. That bug let quiet room noise keep a message recording even though the same noise could not start a message. The follow-up pause is now 900ms; wake phrase capture remains 750ms. This does not require digital silence.

While speaking, Send or Enter can finish the voice message immediately. Once capture ends, the display says **Processing speech · mic paused**. After the reply, it returns to **Waiting for “Hey Nibbi”**. The mic toggle remains enabled for the opt-in wake session; it does not secretly enable itself on startup.

A recorder that never finishes now errors after3seconds rather than leaving the app stuck. Empty audio errors and turns capture off. Cancellation still releases tracks and rejects late uploads. A 25-second maximum recording remains as a safety bound. Loud background speech or noise above the learned speech threshold can still need manual Send; this is not a dedicated speaker-separation model.

Validation:137unit tests (including17 independent endpoint regressions), typecheck, and desktop/mobile voice acceptance pass. The acceptance suite now leaves nonzero background noise after every wake/followup utterance, requires prompt endpointing, and tests Send while input remains loud. Independent review found no release blocker. See `output/voice-endpoint/REVIEW.md`, saved logs, `browser-build-hashes.json`, and `INSTALLED.json` for exact tested/installed evidence.

This is frontend-only. No backend/Whisper/native-binary restart, provider/account/personality change or real user microphone/provider test was performed. The native shell is refreshed only after idle, empty-draft, mic-off checks. Existing history and settings are left alone.

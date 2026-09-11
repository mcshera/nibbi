# Projects sidebar and composer wake toggle

Nibbi keeps its paper surface and Velvet pool character. Project navigation now lives in a single collapsible left column, with Settings at the bottom. The composer includes a visible Hey Nibbi toggle immediately before Send.

The desktop column is 256px wide. The conversation, character, command suggestions, and composer share the remaining workspace center. The desktop open/closed preference persists locally. Below 900px the column becomes a drawer, initially closed, with a backdrop, keyboard focus containment, and Escape dismissal. Project and Settings details remain available within the viewport, including short windows. Escape closes details before the sidebar.

Project selection, live progress, automation confirmation, spend caps, and existing preference actions retain their original authority. Project rows update in place so polling does not erase focused fields or unsaved spending drafts. Closing the sidebar preserves the conversation and composer draft.

Hey Nibbi uses the existing microphone control and wake pipeline. Its label remains visible in both states; the switch reflects the actual microphone state. On small screens, typing occupies the first row and Hey Nibbi and Send sit together below. Permission cancellation, Alt+Space, wake filtering, follow-up capture, Send-to-finish, and microphone-off-on-reload behavior remain intact. Spoken replies stays a separate setting.

Implementation: `public/lib/margin-ui.js`, `public/margins.css`, `public/index.html`, `public/voice.css`, and the workspace layout, keyboard ownership, and microphone title in `public/app.js`.

Validation:

- `node --test tests/margin-ui.test.mjs`: seven widths (320–1440px), keyboard/focus behavior, draft preservation, safe action handling, and 60 projects with Settings remaining visible.
- `NIBBI_SIDEBAR_UI=<built-ui> node tools/sidebar-verify.mjs`: six window sizes, project selection and send context, actual composer geometry, character alignment, settings, and collapse persistence. All requests are intercepted fixtures.
- `NIBBI_VOICE_UI_DIR=<built-ui> node tools/voice-verify.mjs`: 22 voice acceptance categories on both desktop and mobile, using a synthetic microphone and temporary backend.
- Impeccable layout scan: no findings. Rendered desktop/mobile inspection preserves the established visual identity.

Installation evidence is in `output/sidebar-install/`. Its isolated control build reproduces the previously installed JavaScript and CSS exactly. The publication candidate incorporates only the requested five UI files and excludes the existing unpublished local-fallback changes. Renderer and native/backend binaries are unchanged; older hashed assets remain available for already-open clients.

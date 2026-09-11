# Fresh-install acceptance

Use a second Mac or a separate macOS user for the real installation check. Never use a real vault as a test fixture.

## Automated rehearsal

Run `npm ci`, then `npm run test:fresh`. This builds the current checkout and rehearses installer state preparation, vault creation, legacy JSON backup/import and backend restart using explicit temporary directories and a free port. It does not change HOME, launchd, credentials, the installed app, or the real vault. It does not test dependency downloading or GUI installation.

Also run `npm test`, `npm run typecheck` and `npm run verify`.

## Real release acceptance

1. Follow [the migration guide](PLATFORM-MIGRATION.md), or install on an unused account with `bash install.sh`. Expect one backend service, not separate host and gateway owners.
2. Open the browser URL. Confirm the character, conversation pill and Settings work. The doctor should identify Nibbi protocol version 1.
3. Install Claude Code, then use Settings → Providers → Sign in with Claude. Complete the official CLI's Terminal/browser flow and use Check connections to confirm subscription sign-in. No API key or token copying is needed. Install the tested Codex CLI and connect it from Settings. Test a small lead turn with each provider; confirm Claude does not switch to API billing if sign-in fails.
4. Create a disposable project. Configure a meaningful check. Test Claude and Codex independently as fixer, including provider/model selection and a selected skill.
5. Confirm the lead cannot edit project source or protected vault instructions directly. The fixer must not write outside its worktree, alter Git metadata, publish, or read credential files.
6. Stage a change, inspect its exact diff, introduce a conflicting owner change and confirm merge refusal. Confirm an unrelated owner commit is preserved during successful integration.
7. Cancel a lead and a fixer, restart the backend and inspect retained state. Failed verification must not become a successful merge. Try explicit retained-commit verification.
8. Confirm goals start in stage mode, ship requires explicit selection, schedules start off, and stopping a goal turns auto off.
9. Build the desktop shell with `npm run deploy`. Check tray, shortcut, microphone permissions, notifications and hiding/reopening the window.
10. Opt into remote mode. Trust the local CA on a physical phone, pair once, install the PWA, reconnect after the Mac sleeps, and revoke access.
11. If desired, test optional voice with `bash install.sh --voice` on Apple Silicon with FFmpeg installed.

Record failures without pasting keys, tokens or private chat history. Keep disposable test data separate; do not reset by recursively deleting personal state, vaults or worktrees.

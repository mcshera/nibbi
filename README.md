# Nibbi

A local build partner with a face. Nibbi’s ink character, conversation, project controls and reviews share one responsive interface across the browser, Mac app and paired phone.

<p align="center"><img src="docs/hero.png" width="720" alt="Nibbi: the ink character and conversation pill"></p>

Nibbi remembers in a Git-versioned Markdown vault, delegates code changes to isolated Git worktrees, and keeps verification and merge authority in the backend. Claude and Codex can each serve as conversation lead or coding fixer.

## Start here

Requires macOS, Git, ripgrep (`rg`) and Node 22.14 or later. Optional local voice requires Apple Silicon, Python and FFmpeg.

Existing installation? Read [the migration and rollback guide](docs/PLATFORM-MIGRATION.md) before starting this checkout against your state.

For an isolated, account-free preview:

```bash
npm ci
npm run build
npm run fixture
```

Open the temporary URL printed by the fixture. It disables the scheduler, seeds review examples and uses temporary state, vault and project folders.

To install the real backend, explicitly run `bash install.sh`. This prepares the vault and one launchd service, `com.nibbi.gateway`, serving the app and API on `127.0.0.1:4527`. It does not install an unrelated release of the desktop app. `npm run deploy` builds this checkout’s Tauri shell and preserves the previous app alongside it.

## Providers and skills

Open Settings → Providers to configure each project’s lead and fixer independently.

- Claude uses your sign-in to the installed, unmodified Claude Code CLI. Settings → Providers → Sign in with Claude opens its official Terminal/browser flow. Existing Claude Code sign-in is reused; no API key is required and Nibbi never copies login tokens. Your plan limits apply.
- Codex uses the locally installed Codex CLI’s App Server and its supported login. Connect it explicitly from Settings.
- There is no silent provider fallback. Missing credentials, failed results and interrupted streams remain errors.
- Settings → Skills imports standard `SKILL.md` folders, inspects their files and pins revisions by project and role. Importing or updating does not enable a skill.
- Learned workflows need observations from at least two terminal runs, review of the exact revision, and separate activation.

The bundled `nibbi-fixer-brief` and `nibbi-verify-change` workflows are available but off by default. See [skill format and execution boundaries](docs/PLATFORM-IMPLEMENTATION.md).

Claude API billing is an explicit advanced option only: set `NIBBI_CLAUDE_AUTH=api-key` and provide `NIBBI_CLAUDE_API_KEY` or a Keychain entry (service `com.nibbi.claude`, account `api-key`). Keys are ignored in the default sign-in mode. `NIBBI_CLAUDE_BIN` can select a nonstandard Claude Code executable. Subscription dollar estimates are not presented as API charges; spend-cap automation pauses when actual costs are unavailable.

## Daily use

- `/new <name> [web|game]` creates a project; `/project <name>` switches context.
- `/fix <task>` dispatches work. `/diff <id>` and `/review` inspect it. A missing check can stage work for inspection but cannot authorize a merge.
- `/preview <id>` previews a retained branch; `/play <project>` starts the project preview.
- `/goal finish M1` focuses an existing milestone in stage mode. Use `/goal roadmap` for the whole existing plan. Plan a new milestone in conversation before enabling it.
- `/auto <project> ship` is an explicit choice and requires a real verification command. `/goal stop` turns auto off; it does not discard running work.
- Stop cancels an active lead turn. `/stop <id>` cancels a fixer. Failed, cancelled and interrupted work is retained.
- Settings exposes project verification commands, schedules, the vault, protected-file proposals, retained runs and skill review.
- Vault checkpoints are explicit. Nibbi does not automatically commit your unrelated vault edits.

## Phone

Start the backend with `--remote` (or `NIBBI_REMOTE=1`) to enable HTTPS on port 4528. Settings → Phone explains local-CA trust, five-minute one-use pairing codes and device revocation. The Mac must remain reachable. This is not an internet-facing service.

## Development and checks

```bash
npm run typecheck   # contracts, backend, backend tests and typed UI modules
npm test            # offline provider contracts, policy, store, skills and lifecycle
npm run build       # contracts + backend + Vite UI
npm run verify      # isolated real-browser desktop/phone regressions
npm run test:fresh  # isolated fresh-state and JSON migration rehearsal
```

Browser checks use Chrome locally and Playwright Chromium in CI. No check needs a paid provider account. Live authentication, real provider turns, signed app distribution and physical-phone behavior still require a release acceptance pass.

Source ownership: `shared/` contracts; `daemon/src/` backend; `public/` character/interface; `skills/` bundled workflows; `desktop/` native shell. The retired Oracle dashboard is not served. Historical design notes in `docs/` are not current setup instructions.

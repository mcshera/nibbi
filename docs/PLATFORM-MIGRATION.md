# Local platform migration and rollback

This is a source migration, not an automatic production deployment. The implementation and test runs do not replace the installed app, change live launchd services, sign in to providers, or modify the owner vault.

## Before switching

1. Finish or explicitly stop old lead/fixer runs. Inspect their worktrees; do not delete branches, force-reset repositories or assume a legacy “done” status means verified.
2. Make a separate backup of the existing state directory, vault, host configuration and launchd definitions. Keep all project repositories and worktrees. The installer’s backups supplement this backup; they are not a full-machine restore point.
3. Run `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `npm run verify` and `npm run test:fresh` in this checkout. The runtime checks use temporary directories and no paid accounts.
4. Keep a known-good copy of the old source and desktop app. Do not use the old uninstall purge option to prepare migration.

The Mac needs Git, Node 22.14+ and ripgrep (`rg`). Installation records the detected ripgrep executable in the state bin directory so the sandbox can initialize under launchd’s minimal PATH. If that executable moves, rerun the installer after stopping active work.

## Switch deliberately

Run `bash install.sh` only when ready to switch. The installer rejects active runs, stops the old launchd-owned host/gateway before replacing dependencies, waits for the backend owner to exit, builds the workspace, and registers one `com.nibbi.gateway` service pointing directly at this checkout’s `server.mjs`. A manually launched backend must be stopped separately.

Existing host configuration and launchd templates are backed up under `STATE/backups/installer-<timestamp>`. Existing vault content is not replaced. The obsolete `com.nibbi.host` template is moved into the backup.

The default locations are:

| Purpose | Default | Override |
| --- | --- | --- |
| Runtime database, logs, skill revisions, backups | `~/.nibbi` | `NIBBI_STATE_DIR` |
| Markdown memory and plans | `~/NibbiVault` | `NIBBI_VAULT_DIR` |
| Isolated fixer and integration worktrees | `~/NibbiWork/fixers` | `NIBBI_WORK_DIR` |
| New project repositories | `~/NibbiProjects` | `NIBBI_PROJECTS_DIR` |
| Browser/API port | 4527 | `NIBBI_PORT` |

Use all four directory overrides when testing against alternate state; never repurpose HOME. The native shell uses port 4527; custom-port installations use the browser.

On first startup, supported legacy JSON/JSONL files are copied into a timestamped `pre-platform-*` backup with SHA-256 manifest, then imported transactionally into `runtime.sqlite`. Originals remain untouched. A parse failure stops startup instead of importing a partial registry. The migration marker prevents duplicate history on restart.

Legacy active runs become interrupted. Legacy completed work becomes unverified review work. Imported auto settings start off, and schedules default off. No old PID is used to kill a preview. No automatic recovery commits, branch deletion, retry or merge is performed.

Port 4527 now serves both the interface and API. The installed service optionally exposes the same backend on loopback port 4519 for compatibility; it is not a second daemon. Set `NIBBI_LEGACY_API=0` when that compatibility listener is no longer needed.

## Configure and accept

- Install Claude Code and choose Settings → Providers → Sign in with Claude. The installed, unmodified CLI opens its own browser flow from Terminal and owns credential storage/refresh; Nibbi does not collect or copy OAuth tokens. Existing Claude Code subscription sign-in is reused. A credential-only check worked with CLI 2.1.259; real turns still need acceptance. Use `NIBBI_CLAUDE_BIN` for a nonstandard executable location.
- Claude defaults to `NIBBI_CLAUDE_AUTH=signin`; inherited API keys, gateways and OAuth-token environment overrides are not used. API mode remains available only through an explicit `NIBBI_CLAUDE_AUTH=api-key` choice, with `NIBBI_CLAUDE_API_KEY` or Keychain service `com.nibbi.claude`, account `api-key`. There is no automatic switch to API billing when sign-in fails or plan limits are reached.
- Install a compatible Codex CLI and connect it from Settings → Providers. Protocol work was checked against locally generated Codex 0.153.4 types; the lockfile pins the SDK dependencies. Run the real-account acceptance matrix before relying on unattended work.
- Select lead and fixer providers/models per project. Confirm meaningful install/check commands. Default “true” is not a verification gate and cannot permit a merge.
- Import and inspect skills, then enable exact revisions. Bundled skills are off by default. Learned drafts are not executable until reviewed and separately selected.
- For legacy committed work, Settings → Activity → Verify retained commit checks a clean worktree belonging to the registered repository and inside the configured work directory. Uncommitted work requires manual inspection first. Verification never commits those edits for you.
- Review protected SOUL/AGENTS proposals in Settings. Adoption checks both the proposal revision and current target hash, backs up the old file, and does not silently commit the vault. Checkpoints are explicit owner actions.
- Test both providers as lead and fixer, cancellation, skills and verified integration on a disposable project. Follow [the release acceptance checklist](FRESH-INSTALL.md).

Claude subscription runs do not report SDK dollar estimates as actual API charges. Spend-cap automation pauses on unavailable costs instead of treating them as zero. Anthropic's guidance distinguishes user sign-in to its unmodified CLI from an app collecting or intermediating credentials: [credential use](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use). Plan limits remain Anthropic-controlled: [current Agent SDK plan guidance](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan).

Only after browser acceptance, run `npm run deploy` if you want to replace the desktop shell. It preserves the previous app alongside the new one. Native window/tray/microphone behavior still needs an interactive acceptance check.

## Phone access

Remote access is off by default. Use `NIBBI_REMOTE=1` in the service environment, or `node server.mjs --remote` when running manually. Do not start a second backend against an already-owned state directory.

HTTPS listens on the app port plus one. Settings → Phone explains how to trust the generated local CA on your phone and enter a one-use pairing code. Codes expire after five minutes; paired cookies expire after 30 days and are HttpOnly, Secure and SameSite=Strict. Revocation blocks future API access but cannot erase chat data already cached on a device. Keep this listener on a trusted LAN; do not expose it through router port forwarding.

## Recovery and rollback

If a check, provider or merge fails, inspect Activity and the retained worktree. A merge is tested in a separate integration worktree; failure does not fall back to an unchecked merge. The original branch stays available. A durable merge intent lets startup recognize a completed integration after a crash.

For code-only rollback within this database schema, stop the new backend cleanly first, preserve a fresh state backup, restore the compatible source/app and restart one owner. An older binary must not open a database with a newer schema version.

To return to the pre-platform installation, stop the new backend, back up its state and all newly created work, restore the old source/app/launchd definitions from your pre-switch backup, and use the corresponding pre-switch JSON state. Do not merely restart the old daemon against stale JSON: it does not know about new SQLite runs or new merges. Preserve and reconcile that work explicitly; never reset project branches to make metadata match.

`bash uninstall.sh` now moves the app and service definitions into a recoverable backup. It keeps state, vaults, projects and worktrees. Automatic purge is disabled.

No automatic evidence cleanup is included in this release. Retained worktrees, sandbox scratch folders, events, transcripts and skill revisions consume disk space. Review retention before prolonged unattended use; never remove work while a run or integration is active.

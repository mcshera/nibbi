# Platform implementation

This tracks implementation of the agreed local platform plan. The production installation and owner vault are not test fixtures.

## Agreed boundaries

- One local Mac backend; one responsive interface for Tauri, browser, and paired phone.
- Claude Agent SDK driving the installed, unmodified Claude Code CLI with the owner's subscription sign-in by default; Codex App Server with its supported login. API-key-only Claude authentication was superseded by the owner's sign-in requirement.
- Both providers support lead and fixer roles. Claude remains the configured default; no silent provider fallback.
- SQLite runtime state; Git-versioned Markdown memory and plans; pinned standard SKILL.md packages.
- Backend-owned queue, verification, commits, merges, approvals, process supervision, and durable events.
- Curated skills first; learned skills remain drafts until validation and review.

## Delivery checklist

- [x] Execution policy, lifecycle, merge, and review regressions.
- [x] Shared TypeScript contracts, workspace build, configuration and SQLite migration.
- [x] One scheduler and backend owner; supervised processes and stable roadmap IDs.
- [x] Claude and Codex adapters, shared tools, authentication, cancellation and session isolation.
- [x] Skill catalog, immutable revisions, per-project/role activation, validation and learning review.
- [x] One responsive UI with shared commands, event replay and on-demand views.
- [x] LAN pairing/PWA, Tauri, installer and compatibility migration code.
- [x] Offline tests, browser checks, build and rollout documentation.
- [ ] Production rollout and real-account/device acceptance (deliberately separate).

## Baseline

The working tree was clean. Seven text-helper tests and daemon typecheck passed during planning. The existing scenario runner does not fail on collected console errors. The installed gateway points at ~/Nibbi/app; source matched daemon/src at inspection time. Runtime smoke tests must use explicit NIBBI_STATE_DIR, NIBBI_VAULT_DIR, NIBBI_WORK_DIR, and NIBBI_PROJECTS_DIR overrides.

## Ownership after implementation

| Concern | Owner |
| --- | --- |
| Process, listeners, startup reconciliation | `daemon/src/main.ts` |
| Durable records, commands, event replay and migration | `store.ts`, `events.ts` |
| Validated mutations / compatibility URLs | `command-service.ts`, `api.ts`, `commands.ts` |
| Lead sessions and scoped dispatch | `session.ts` |
| Provider protocols / authentication | `providers/`, `auth.ts` |
| Shared scoped tool service / OS sandbox | `tool-service.ts`, `policy.ts`, `sandbox.ts`, `sandbox-worker.ts` |
| Queue, staging, verification and integration | `fixer.ts`, `processes.ts` |
| Projects, stable task IDs, schedules and goals | `projects.ts`, `roadmap.ts`, `scheduler.ts` |
| Skill revision catalog and native packaging | `skills.ts` |
| Client commands, streaming and on-demand settings | `public/lib/client.ts`, `public/lib/platform.ts` |

`server.mjs` is now only a bootstrap. There is no host proxy, independent watchdog, second scheduler, copied daemon deployment tree, one-shot provider fallback or separately served Oracle dashboard. Old gamification/golden/TTS orchestration modules and workspace-local npm lockfiles were retired; root npm workspaces share a lockfile. The optional local voice servers remain separate services.

The existing character and conversation renderer remain plain JavaScript. This is an incremental interface refactor, not a claim that the entire UI has been converted to TypeScript or a new framework.

## Execution invariants

1. All dispatch paths enter the same bounded queue. A run pins its provider, model, skill revisions, target branch and base commit.
2. Provider errors, cancellation and missing terminal results never become success. Before checking or committing, the provider tool lease is revoked and all its in-flight actions are aborted and drained.
3. The lead writes only unprotected vault content. Coding work belongs in a fixer worktree. Native provider shell/write paths and inherited MCP/plugin configuration are disabled; actions use Nibbi’s governed tools.
4. Each shell/install/check runs in a separate sandbox worker. SRT 0.0.42 supplies network and filesystem policy; a validated, non-shell argv adapter appends credential-file denial last in the same macOS profile because SRT read allowances override its read denials. Unsupported wrapper formats fail closed. Non-macOS execution is not supported.
5. Checks run independently of the provider’s claimed results. No configured check means visibly unverified review work, never merge authorization.
6. Integration uses a separate worktree, re-runs checks and only fast-forwards an unchanged, clean target. Conflicts, changed targets and failed checks retain evidence. A persisted merge intent supports crash reconciliation; there is no force-reset/unchecked fallback.
7. State plus its event commit together. Idempotency keys reject different payloads and do not silently repeat interrupted commands. UI failures keep review items visible.
8. Auto and schedules start off. New UI goals stage against an existing roadmap milestone; ship is explicit. Repeated failures pause dispatch instead of causing retry loops. Stable task markers replace fuzzy completion.

## Skills

Packages are standard directories containing `SKILL.md` with YAML `name` and `description`, plus optional `references/`, `scripts/` and assets. Validation bounds file count and size, rejects symlinks/configuration injection, and hashes every file. Imported revisions are copied into runtime-owned storage and rechecked before use.

Optional compatibility metadata:

```yaml
metadata:
  nibbi:
    providers: [claude, codex]
    roles: [fixer]
    dependencies: [bin:node, tool:shell]
```

Dependency declarations use `bin:<executable>` or `tool:<governed-tool>`; unavailable dependencies stop selection and are never automatically installed or authorized. Declaring a dependency does not grant filesystem/network access. Claude receives controlled native skill plugins; Codex receives explicitly selected native skill paths. Inherited provider skills and external integrations are not silently activated.

The two bundled workflows were authored and validated using the skill-creator guidance: concise triggers, bounded instructions and honest evidence, without trying to turn a skill into extra authority. Learned drafts require distinct terminal run evidence and separate review/activation. This release provides a reviewed drafting workflow; it does not autonomously distill and publish a skill marketplace.

## Verification and release boundaries

Claude authentication uses the CLI's own `auth status --json` and interactive `auth login --claudeai`. Before releasing a prompt, the SDK verifies the actual subprocess account is a first-party subscription account without an API-key source. Settings offers a host-only Terminal/browser sign-in handoff, not a custom OAuth client. Tests reject API fallback, strip inherited auth overrides, check the credential-free handoff, and distinguish subscription usage from explicit API costs. A real credential-only handshake confirmed the owner's existing CLI sign-in without a model request or login change.

Offline tests cover both provider contracts, failure/terminal handling, Codex steering/cancellation, policy hooks, symlink and hard-link boundaries, tool revocation/drain, resistant subprocess cleanup, native shell confinement, real npm verification, credential-file denial, queue capacity, failed checks, merge conflicts, retained-commit verification, crash reconciliation, stable task identities, skill pinning/review, SQLite transactions/idempotency/migration and pairing/revocation.

Browser checks exercise desktop/phone layout, skill selection and inspection, vault/schedules, stage-only goals, failed-review retention, command idempotency, event replay and hostile origins. The fresh-state rehearsal confirms backup/import, the compiled sandbox under a minimal launcher PATH, and restart without touching live state. Typecheck includes backend tests and the extracted TypeScript UI modules. CI is configured to build and test the single Mac backend.

Not exercised here: paid live Claude/Codex runs or login changes, launchd installation into the owner account, actual app deployment/signing, optional speech models, physical-phone certificate trust/PWA behavior, full dependency-download installation, or hosted CI execution. See [migration](PLATFORM-MIGRATION.md) and [acceptance](FRESH-INSTALL.md).

Further work after acceptance: reviewed disk-retention controls, broader adversarial provider evals, and incremental extraction of the remaining conversation/voice JavaScript. Evidence is retained rather than automatically deleted.

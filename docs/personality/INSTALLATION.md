# Personality installation — 2026-09-06

**Status: adopted and active.** The owner approved the presented version with “do it.” This is the installation follow-up to the earlier design/tuning pass, not another personality revision.

## Applied through the native review gate

- `004-companion-personality.md` → installed `SOUL.md`.
- `005-companion-memory-consent.md` → installed `AGENTS.md` (only the two approved capture/journal changes).
- Used loopback `POST /api/commands`, `proposal.adopt`, with each exact revision, current base hash, and a distinct idempotency key. No direct protected-file edits or automatic vault commit.
- Native adoption records, events, backup contents, and installed hashes were independently verified. The proposal files remain unchanged as review evidence; their pre-adoption status headers are historical, not current installation status.

| Target | Installed SHA-256 | Previous content backup |
|---|---|---|
| `SOUL.md` | `db9de1e37c6855c60027715fb4b66b3232cf070c363334a7b32c8386222bbc3b` | `/Users/Matty/.nibbi/backups/proposal-1788724896021/SOUL.md` |
| `AGENTS.md` | `494fa4febeffce5cd40cdd65b5cfbbd3a07898a8e794f86df1076d1ebdc29cd4` | `/Users/Matty/.nibbi/backups/proposal-1788724896030/AGENTS.md` |

The evaluated snapshots are generic templates. The installed proposal deliberately substitutes Matty, preserves Oracle/SHIPLESS continuity, keeps the stricter existing explicit-action approval rule, and retains the existing app-command limits. The complete new character/response/next-step/voice-anchor core matches revision 4. No extra personality change was introduced during adoption.

## Activation and preservation

- `npm run build -w @nibbi/daemon` passed. Only `session.js`, its map, and the new `lead-instructions.js`/map differed from the previous compiled backend. No frontend build or provider-setting change by this task.
- Graceful `launchctl kill SIGTERM gui/503/com.nibbi.gateway`; the existing `KeepAlive` setting restarted the service. It was idle, automation was off, and no active fixers were interrupted.
- Healthy service observed after restart: old PID `15087` → new PID `14561`, HTTP 200. All fixer/draft states and goals matched before/after. No session reset or conversation deletion.
- The compiled prompt loader includes both adopted files. The compiled execution helper matches the evaluated source and text (including the evaluator’s two-newline separator); `session.js` passes actual `lease.names`. No hidden persona override or generic footer.
- Probe used a read-only installed SQLite connection, an owned temporary copy of minimal configuration, and the real vault read-only. No private prompt content was saved. Temporary state was removed.

## Actual installed reply check

Two clearly labelled, non-personal installation messages went through native `/api/send`. No model overrides, tools, extra memory saves, or background work were requested. The ordinary chat history retains the two labelled test exchanges; none of the owner’s history was reset or removed.

- **2/2 completed**, in 6.902 seconds, with no error or tool events.
- Actual provider transcript metadata reports **`claude-opus-5`** for both replies. Existing configured `opus` was preserved.
- First turn created a fresh vault session without replacing the existing project session. The second reused the same returned and persisted session ID: fresh **and** resumed behavior exercised.
- First reply ended: “Ready when you want to run check 2/2.”
- Closing reply ended: “Installation check complete. I'll be here when you need me.” It asked no more questions and added no tasks.
- Vault-content hashes, semantic provider/project/skill settings, and host configuration hashes were unchanged during the smoke. Ordinary session/usage counters changed as expected.
- Both owned runs finished; the service returned idle. No cancellation or lingering test worker was needed.

This is an installation check, not a broad re-evaluation of the personality. The model’s own “checks passed” wording was not used as proof. The app normally preloads vault context; “no tools” does not mean no context was supplied. Earlier Sonnet social-advice overcoaching/unsupported assumptions remain documented in [LIVE-TUNING.md](LIVE-TUNING.md). Two successful Opus replies do not establish universal adherence.

## Validation and evidence

- Narrow daemon build: passed.
- Native adoption/backups/effective-prompt/compiled-helper probe: passed.
- Post-install focused regressions: **3 capability + 25 personality tests passed**.
- Prior tuning verification: **75 unit + 38 daemon tests and typecheck passed**; this task did not rerun unrelated UI suites while the UI owner was working.
- Evidence: `output/personality-review/installation/` (gitignored). Live smoke: `smoke-2026-09-06T20-08-47.226Z/report.json`.
- Two verification-tool corrections are retained in the evidence: a read during graceful SQLite shutdown initially hit a lock; probing after health with a 1500 ms connection timeout passed. The first text-hash assertion omitted the evaluator’s `\n\n` separator; the corrected exact-byte comparison passed. Neither required changing installed behavior.

No commit, remote deployment, project merge, history deletion, or provider setting change was performed. Future protected personality changes still require a new owner-reviewed proposal.

**Next step:** use Nibbi normally and note any response whose tone or ending feels wrong. Use that real example for the next bounded tuning pass.

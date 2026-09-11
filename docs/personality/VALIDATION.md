# Personality pass: verification and handoff

> **Installation update (2026-09-06):** the owner subsequently approved both proposals. They are adopted and active, with a healthy restarted backend and two successful fresh/resumed installed replies. See [INSTALLATION.md](INSTALLATION.md). Statements below about pending approval or no installation describe the earlier tuning pass.

2026-09-06. Prompt-design changes are ready for owner review. Installed personality and generated-model behavior are not claimed complete.

## Checked

- Latest `npm test`: **75/75 unit tests and 38/38 daemon tests passed**, including 25 personality-policy/reference-fixture tests and 3 capability-policy tests. The tree also contains concurrent UI work; this is not a clean-commit release check. Evidence: `output/personality-review/full-tests-v4.log`.
- `npm run typecheck`: **passed**.
- `git diff --check`: **passed**.
- Native proposal inspector: **passed** for `004-companion-personality.md` and `005-companion-memory-consent.md`. Each proposal's declared base matches the current protected file. A temporary copy of the vault loaded both candidate revisions in the next `buildSystemPrompt()` call. Temporary state was removed. No provider was called by this inspector and no installed file was adopted. Separate live-provider evidence is recorded in [LIVE-TUNING.md](LIVE-TUNING.md).
- Installed `SOUL.md` and `AGENTS.md`: byte-identical to the pre-change versions.
- Independent source review: no blocking personality issues. Follow-up changes made capture consent explicit during consolidation/self-review and adjusted the repair example to actual run evidence.

The first `npm test` run had four daemon failures: three missing-`rg` sandbox errors and one `busy`/`conflict` mismatch. The existing installed ripgrep is at `~/.nibbi/bin/rg`, not a standard search path in this agent environment. Re-running with `~/.nibbi/bin` prepended to PATH passed: **74/74 unit tests and 35/35 daemon tests, exit 0**. All four failures cleared without changing code, tests, or dependencies. The initial failure log is retained; the successful rerun is `output/personality-review/full-tests-with-rg.log`.

```bash
PATH="$HOME/.nibbi/bin:$PATH" npm test
```

Local evidence (gitignored): `output/personality-review/{unit-tests,full-tests,typecheck,proposal-check}.log`. The native inspector script there runs from the daemon workspace so its `tsx` dependency resolves:

```text
cd daemon
node --import tsx ../output/personality-review/verify-proposals.mjs /Users/Matty/Documents/NibbiVault
```

## Goal audit

| Requirement | Evidence and state |
|---|---|
| Think at a high level about a life companion and teammate | `docs/PERSONALITY.md`: attention, values, judgment, stance, expression, continuity; independent design review |
| Tune the LLM's personality and response style | Updated fresh-install SOUL; stable character, flexible register, judgment and voice anchors; reviewable installed SOUL proposal |
| Always end messages with next steps | Explicit source policy and optional-chip distinction, 19 authored scenarios / 25 reference turns, and 64 real-provider replies across four revisions. Natural next steps include action, listening, rest, or closure; exact-output exceptions preserve requested formats. This implements and exercises the requested response rule; universal and installed compliance are **not claimed** |
| Avoid silently changing protected personality | Two pending proposals and indexed vault log; actual protected files unchanged; no backend override |

The requested high-level personality design and tuning work is complete: source defaults, response-style policy, voice examples, protected-file proposals, and bounded real-model iterations are delivered. Installation is a separate owner-gated action, not something these tests authorize. Isolated real-provider evidence and remaining social-advice limitations are recorded in [LIVE-TUNING.md](LIVE-TUNING.md). Neither static assertions nor 64 sampled replies prove universal LLM adherence. No release, commit, restart, or deployment was performed.

**Next steps:** review the voice and exact proposals; test the accepted wording with an isolated provider conversation; adopt only after explicit owner review; then check fresh and resumed installed conversations.

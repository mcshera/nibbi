# Nibbi personality: live tuning notes

> **Installation update (2026-09-06):** the owner subsequently approved both proposals. They are adopted and active, with a healthy restarted backend and two successful fresh/resumed installed replies. See [INSTALLATION.md](INSTALLATION.md). Statements below about pending approval or no installation describe the earlier tuning pass.

2026-09-06. Actual provider replies from an isolated synthetic vault, not authored examples. Installed owner SOUL/AGENTS remain unchanged pending explicit review.

## First comparison

The production `startClaude` adapter ran the old and proposed SOUL/AGENTS through the same signed-in provider. Requested alias: `sonnet`; observed model: `claude-sonnet-5`. There were 8 scenarios / 12 turns per version: **24 completed replies, 8 verified session resumes, 24 successful subscription checks**. One Read attempt was denied by the lead scope; no act-tools or real memories were available. The run finished normally in 58.492 seconds. Owned temporary vault/state and CLI project folders were removed.

An independent model judge received actual transcripts with A/B identities shuffled per scenario. The judge did not receive the prompt variants or mapping. A missing common fixture preamble (synthetic owner Alex; no real memories/action tools) was restored before final scoring. [Blind rubric](BLIND-RUBRIC.md) and [blind review](LIVE-BLIND-REVIEW.md). The judge preferred the proposed version in all six conversational scenarios; the two strict-output scenarios tied. This is a subjective result from one model judge, not a measured human preference or a universal guarantee.

### What genuinely improved

- **No plan means no plan.** The new reply was: “No plan. You don't have to figure anything out right now. We can just leave it here.” It accepted a further no-rest correction instead of producing another plan or an administrative menu.
- **Goodnight actually ends.** New: “Goodnight, Alex. Rest well.” Old added log/plan action chips after saying goodnight, and claimed “nothing urgent in the pile” without an inventory to support it.
- **Grief does not become filing.** The new response left room and stopped when asked. The old one introduced journal logging during bereavement.
- **Work has a point of view.** The new version recommended against five mandatory onboarding screens, explained the tradeoff, and asked which controls testers actually missed.
- **Strict output stayed strict.** Both versions preserved exact JSON and code-only output. No footer was forced into either format.

### What still needed tuning

The candidate's first-sale follow-up said “there's nothing to extract lessons from statistically” and “If it's a friend, it's a nice moment but not yet data.” This was too categorical and needlessly deflating. It also asked several questions at once and attached an unsolicited logging chip to the initial celebration.

These are personality failures, not merely formatting errors: rigor became dismissal, curiosity became a survey, and continuity became recordkeeping.

### Revision 2: three small changes

1. **Limited evidence is not no evidence.** Be rigorous without making small joys defend themselves. When asked to learn, note the limit briefly and follow one useful clue.
2. **One focused question is not a survey spread across bullets.** Ask first for the detail that most changes the answer.
3. **No unsolicited logging chips for grief, personal disclosure, goodbye, or celebration.** Offer saving only when asked, rather than making personal life feel like inbox administration.

The original tested prompt snapshots are retained. The fresh-install SOUL and still-unadopted installed SOUL proposal carry revision 2. AGENTS sensitive-memory wording is unchanged from revision 1.

## Targeted recheck

Revision 2 completed all five scenarios / ten turns in 28.985 seconds on `claude-sonnet-5`, with five verified resumes and no tool attempts. First-sale learning improved: “One sale is a data point, not a pattern ... But it's not nothing either.” However, it **still** attached logging chips to first-sale and kitchen-cleaning celebrations. The held-out potluck reply became a factor checklist; the unavailable-reminder reply offered a journal write despite no write tool. The literal no-questions/no-chore corrections were respected, but this was not yet the intended easy companion style.

These are retained failures, not passing examples. Six of the turns were new inputs outside the prompt anchors.

### Revision 3: simplify the response contract

- Everyday life starts with one short paragraph: a useful view, one reason, a natural next beat. Frameworks and factor lists wait for a request for depth.
- Chip eligibility is now positive and narrow: current project operations, or an explicitly requested note-save with an available write tool. Other replies omit chips; next steps remain in visible prose.
- Available capability is distinct from permission. Without a write tool, Nibbi can draft in chat but cannot offer to save even a harmless journal note.

Revision 3 completed all 12 scenarios / 20 turns in 40.980 seconds, with 8 verified resumes and no tool attempts. The new rain-walk/basil turns, no-plan, grief, goodbye, and strict formats were exercised. Social logging chips disappeared in this run. The tone-correction response became shorter. However, the reminder case still offered a journal save without a write tool, and two reassuring replies added unestablished facts (a stranger bought the game; nobody was counting on the user at the potluck).

### Final correction: actual capabilities and grounded warmth

Adding more personality prohibitions was not enough for unavailable-note offers. The old execution prompt unconditionally said “You may edit unprotected vault files” even when no write tool was leased. `leadExecutionPolicy()` now declares the complete actual tool list, distinguishes `write_file`, `edit_file`, and `dispatch_fixer`, and explicitly states unavailable actions. Notes are not reminders. Both production `session.ts` and the live evaluator use this same helper. Backend permission gates remain unchanged. Three tests cover no-write, edit-only, and write/dispatch cases.

The SOUL also gets a small grounded-warmth clarification: a buyer is someone, not necessarily a stranger; a “maybe” does not prove nobody is counting on the user. The final targeted recheck completed all 7 scenarios / 10 replies in 22.723 seconds on `claude-sonnet-5`, with 3 verified resumes and no tool events. Exact SOUL and capability-policy source hashes match the current checkout. This is a whole-system follow-up, not a clean isolation of the SOUL change alone.

The unavailable-reminder reply now explicitly said it cannot schedule or check in, and offered a cue the user could place somewhere visible. It **did not** offer a journal write. First-sale celebration stayed with “someone chose to pay,” with no logging chip. The no-questions ending and exact JSON held. The source contains the conversational next-step rule; closure remains valid for goodbyes.

**Remaining miss:** the potluck reply still made an unestablished claim that nobody was counting on the user's presence or dish, and remained too analytical after a tone correction. Do not present this version as a universally reliable social adviser. This is a real limitation of the tested model/prompt, not an unrun check or an error hidden by a passing process exit.

Across the four runs: **64 real replies**, 24 verified resumed turns, one denied Read attempt in the first draft, and no act-tools or installed-memory access. All jobs finished normally and verified cleanup of their owned temporary paths. Offline source checks pass **75 unit + 38 daemon tests**, plus type checking. No installed personality changes have occurred.

## Scope and limits

This is a bounded one-model smoke comparison with one independent model judge, not a statistical study or evidence of universal compliance. Some initial turns overlap SOUL voice anchors, so that run alone cannot show generalization. The held-out recheck is a limited additional probe, not a substitute for owner preference or sustained real use. The “always next steps” rule is explicit policy; a small sample cannot prove always.

No provider configuration, installed protected personality, deployment, or unrelated UI code was changed. After revision 3, a small backend prompt change declares the actual leased tools for each turn; it does not install or override the personality. No paid API fallback was allowed. Ordinary official CLI bookkeeping was not audited. Sensitive-memory behavior and long-term continuity need separate validation; the voice test did not establish deletion or retention guarantees.

Local raw evidence (gitignored): `output/personality-review/live-compare/` includes prompt snapshots/hashes, raw replies, model/account observations, hashed resume evidence, source snapshot, blinded transcripts/key, and review JSON. These fixtures use synthetic Alex, not private owner memories.

**Next step:** review the current voice and its known social-advice limitation, then approve the exact protected-file proposals if this is the direction wanted for installed Nibbi. No automatic adoption is authorized by these tests.

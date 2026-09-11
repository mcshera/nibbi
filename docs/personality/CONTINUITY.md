# Grounded continuity and follow-through

This repair preserves the approved SOUL.md and AGENTS.md. It adds factual context and read-only tools, not a second personality prompt. The owner wants a life companion and teammate, with natural next steps rather than a task footer.

## Changes

- Each queued turn captures bounded, same-scope conversation history before writing the incoming user message. The snapshot reports the previous visible user message, its exact recorded time, and a valid elapsed interval or explicit unknown. A last message is not automatically a previous visit.
- `recent_chat` and `search_chat` retrieve retained chat. A missing daily journal does not mean chat disappeared. General/vault history is NULL/literal `vault`, not all project history. Project history cannot widen its scope. New chat rows carry their lead run ID for correct user/reply pairing; legacy nearest-user association remains explicitly uncertain.
- `read_activity` returns compact current work facts, with verification, timing, filters and omission/pagination metadata. `list_fixers` remains a no-argument tool alias, but now returns the bounded envelope, not the old giant array. The HTTP/UI fixer facade is unchanged.
- `read_roadmap` supplies canonical task IDs without writing markers. Human labels must be resolved rather than discarded after an invalid taskId. This provides the correct IDs; it does not prove every future model dispatch will use them.
- Current configured schedule flags come from the same defaults/settings as the scheduler. Reading them starts no timers and changes nothing. Enabled configuration is not a promise of delivery. No schedule was enabled by this repair.
- Execution guidance lists the actual leased tools and governed file-read roots. A worker-status summary does not grant access to its isolated worktree. Read-only queries do not authorize retries, recovery, commits or merges.
- Stale unprotected MEMORY facts were corrected with nine targeted deltas and a private rollback copy. No new personal identity facts were saved. Protected personality files remain unchanged.

## Limits

The current registered projects have ordinary short slugs. Very long legacy project IDs are not covered: registration historically had no length cap, while activity queries cap slugs at 120 characters and continuity at 128. This compatibility edge needs a separate aligned registry/scope contract; IDs must never be silently truncated.

History is minimized, not a secret detector. Old messages without turn IDs cannot always be paired perfectly; unlabelled legacy test traffic cannot always be distinguished from a person. Search/pagination and excerpt limits are explicit. Current activity is not a reconstructed historical snapshot. A failed/unverified worker is not completed work; a staged/verified change is not merged. A reported summary is not independent verification. Read scopes and current capabilities limit any proposed next step.

## Verification status

Final native checks passed: **85 unit tests + 79 daemon tests**, typecheck and `git diff --check`. The build was limited to contracts/daemon; no frontend build was run by this repair. Mechanical coverage includes the real native MCP lease with a fake provider, preserved/fresh/queued session IDs, prompt and tool refresh, exact file roots, run-ID writer/reader pairing, schedule query-only reads, scope/budget/path guards, current-status races and canonical task lookup.

The isolated comparison used actual subscription Claude Opus 5. Exact model labels `claude-opus-5` and `claude-opus-5[1m]` were retained, along with real resume evidence. There were **16 actual replies total**: two invalid early validator/channel checks, six valid baseline replies and eight candidate replies. Only six prompt/sequence pairs are directly comparable; the candidate's additional decision/ending checks are not paired wins. The four-hour gap was seeded only in disposable SQLite rows; it was not a real four-hour wait. All owned evaluation fixtures/CLI project folders were removed.

### What improved, and what did not

- The fresh-session candidate recovered the prior amber-highlight/paper-texture decision from retained chat. The baseline said the record was unavailable and requested another note.
- Current work reads distinguished failed/unverified, staged/verified and not merged. Candidate offers to inspect inaccessible worktrees fell from three baseline replies to none in the paired sample.
- Greetings were still too work-heavy. Note offers and task-like endings remained. This is **not** an eight-of-eight personality pass.
- The candidate still implied chat needed a vault note to become durable and inferred that verification never ran from an unverified status. Two factual runtime clarifications were added afterwards and mechanically tested. The final installed build is therefore **not identical** to the eight-reply candidate snapshot.
- One candidate event-only query omitted two untracked legacy records, then claimed there were no changes. The fixture happened to be unchanged, but that partial read did not establish the claim. Consumers must respect omission metadata and read the relevant current records when event coverage is incomplete.

The approved personality remains unchanged. These repairs improve factual continuity; they do not establish universal warmth, brevity, restraint or next-step quality. Further protected personality edits still need a fresh owner-reviewed proposal.

### Native activation

The final build was activated through the existing launchd KeepAlive service: **PID 14561 → 53164**. Fresh checks found no active leads, queued/running fixers, automation, enabled schedules, or live previews before restart. The frontend owner cleared the restart. After restart, all existing configuration/skill-setting/schedule/fixer/session record hashes and all 810 existing messages matched. The 85 staged runs and failed Battalion run were preserved. All 88 compiled daemon artifacts matched the final validation hashes. No UI source was touched by this repair; separate owner-authorized visual polish is concurrent.

Two ordinary installed Battalion replies completed on the existing session and actual `claude-opus-5`. Only `read_activity` was called. All vault/settings/fixer/session checks passed, with four correctly paired new chat rows and no action attempts. These are generated verification messages, not new personal facts.

The catch-up correctly found the failed/unverified run and acknowledged that its retained worktree is outside the lead's file-read roots. But it was long. The greeting repeated project status and invented “five minutes ago” despite only seconds passing. **The installed style/timing quality check failed.** The repair goal remains active. The context/time/provenance follow-up is recorded below; any additional protected personality change remains owner-review-gated.


### Follow-up context activation — conversational quality not yet retested

The installed greeting failure led to three small context/provenance changes, with no protected personality edit:

- `previousUser.elapsedText` supplies the exact elapsed duration, including milliseconds, at `observedAt`. It describes time since the recorded human message, not a visit interval. Missing, invalid or future timestamps do not produce a duration claim.
- Resumed provider sessions and nonvisible background turns omit automatic chat excerpts (`maxMessages:0`). They retain the previous-human/time/scope facts and scoped history tools. Fresh visible turns receive at most four excerpts. This avoids repeating old assistant prose when the provider already has the conversation.
- Ordinary `/api/send` diagnostic turns can opt into owner-only `historySource:"test"`. Both retained rows carry `metadata.source=test` and their existing run ID/cost fields. Unmarked request fingerprints remain compatible. This is provenance, **not** a read-only mode, sandbox, or permission restriction; slash-command behavior is unchanged. SQLite continuity retrieval excludes the marked rows, but the existing provider transcript and UI history still retain them.

Full native follow-up source checks passed **85 unit + 83 daemon tests**, typecheck and whole-tree/scoped `git diff --check`. The diff check does not cover untracked files. The independent integration review found no blocking defect and recorded remaining test-coverage limits. Hashes/logs are under `output/continuity-repair/validation/followup-source/`.

The four owned installed-check rows (811–814) were separately annotated with `source:test`. No text, timestamps, roles, channel, run IDs or costs changed; all original 810 rows remained unchanged. The private backup and proof are recorded in `owned-test-origin-correction.json`.

The context-only follow-up is now **activated**. The existing launchd service restarted **PID 53164 → 85030** after fresh idle/work/automation/schedule/preview checks and coordination with the UI and voice owners. The character-lab work was reported as design files and independent static previews; it was notified, and its files/processes were not touched. All 88 compiled files matched the pinned follow-up build. Before/after hashes preserved all 232 configuration/skill-setting/schedule/fixer/session records, all 814 retained messages, and session IDs. The 85 staged runs and failed Battalion run were preserved. SOUL, AGENTS and corrected MEMORY stayed unchanged. Evidence: `output/continuity-repair/activation-followup/{guard,before-state,after-state,completed}.json`.

A read-only compiled probe recovered real Battalion human message 809 rather than the four generated tests, supplied exact elapsedText, and returned zero automatic excerpts. An invalid empty `/api/send` request confirmed the new historySource schema rejects an invalid marker without a model turn. **The activation and its probes generated no real Nibbi replies.** The later isolated comparison is recorded below. These are mechanical/context checks, not proof that the earlier failed greeting is now warm, relevant or well judged.

Two review coverage gaps were also closed: search_chat excludes both diagnostic rows while still finding ordinary text; and completed diagnostic requests reject remote/unmarked replays while the permitted replay leaves rows, provider-call count and command record unchanged. The focused four-test file passed with the added assertions. Runtime source and compiled artifacts did not change. Evidence: `validation/followup-coverage/`.

### Owner-authorized personality comparison — stopped without a comparison

The dedicated dry runner remains dry-only. A separate live runner used the pinned 88-file context snapshot, not the later voice build. The owner explicitly authorized one four-turn comparison in `output/personality-followup/OWNER-GO-4.json`. Independent source review and final no-model normal/abnormal/descendant checks passed on runner SHA256 `0a623327d19786f51f4bff182a576cbede149bfbc7fbcec86585f9758bf78211`. Root released execution on that exact source. The original 16-reply comparison remains closed.

The real run at 17:00 UTC admitted **two first turns**, one per variant. Both passed Claude Max / first-party / no-API-key checks and released the ordinary catch-up prompt. The approved variant A completed **one Opus 5 reply**. Its init/assistant labels were `claude-opus-5[1m]` and `claude-opus-5`, and its init/result/returned session hashes matched.

The evaluator then rejected an additional `claude-haiku-4-5-20251001` key in the result's aggregate `modelUsage` map. It had applied the reply-model allowlist to usage accounting too. The specific purpose of that Haiku usage is not established by the retained evidence; it is not evidence that Haiku wrote the observed reply. This validation failure triggered the global stop and terminated B before a completed answer was retained. **Neither greeting ran. Genuine fresh-to-resume behavior was not tested. There is no completed A/B comparison.** The raw summary's `fakeReplies:2` counts begun turn records, not two completed replies.

The one completed answer distinguished failed/unverified from staged/verified and not merged. It stated its evidence limits, but still ended by offering a project-review command. This single catch-up does not establish companion-style or greeting quality, and it cannot show whether the draft is better.

Both owned process groups were confirmed absent before exact fixture/CLI-folder cleanup. Root independently verified those paths were gone and canonical SOUL/AGENTS hashes were unchanged. The one-shot claim and admission ledger remain intact: two consumed admissions, two unreserved slots, **no retry or reset**. No installed-service, UI, microphone, STT, live-history or current-build actions were taken for this comparison. Evidence: `output/personality-followup/live-2026-09-07-four-replies/{ROOT-AUDIT.json,RESULT.md,FAILURE-REVIEW.md,A.json,B.json,summary.json}`.

The two-hunk SOUL draft at `output/continuity-repair/personality-followup/PROPOSED-DIFF.md` remains outside the vault and unadopted. A model began its first candidate turn, but no completed candidate answer was retained. There is no basis here to recommend adoption. The repair goal remains active. A future evaluator must distinguish observed reply-model labels from aggregate usage keys without inventing the purpose of extra usage. Further model execution needs a new explicit decision; the closed one-shot authorization cannot be replayed. Protected adoption is a separate decision.

### Separate voice installation — complete

The voice owner subsequently corrected the exclusive-create cleanup bug, completed independent 204-test validation, and activated the privacy endpoint **85030 → 85648**. They also installed Whisper log redaction and published/refreshed the voice UI, with the microphone off at their final check. Their installation evidence is `output/voice-toggle/INSTALLED.json` and `docs/VOICE-INSTALLATION.md`. This work is complete; there is no pending build, restart or native refresh for this repair. The user may now be using the app. Leave the character-lab files and static servers untouched. The immutable context snapshot remains separate from that later voice build.

### Offline evaluator repair on v2

The evaluator defect above is now corrected in source, without another real run. Init/assistant labels are separate from aggregate usage; missing or wrong primary labels fail, while extra usage is retained as unattributed and review-required. Attempted/completed/fake/native reply counts are separate. Nine pure tests and seven fake-only native cases cover the change, including missing labels after valid labels, cancellation, and owned descendant cleanup. The closed claim, original failed-run evidence and canonical personality files are unchanged. This does not turn the failed comparison into a completed one or authorize another model run. See `docs/V2-PREPARATION.md` for the additional voice source fixes and the 238-test validation.

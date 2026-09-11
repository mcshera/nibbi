# v2 preparation

**Later installation:** the owner-authorized local UI update is now installed. See [V2-INSTALLATION.md](V2-INSTALLATION.md). The preparation-only boundaries below describe the earlier phase. No commit or protected personality adoption was made.

`v2` was created from `codex/improve-nibbi` at `45e319361a53f002baea7149a8676386a5eef30a`. All 204 modified/untracked paths inventoried before the switch matched afterwards. No stash, reset, merge, commit or file discard was used. Existing continuity, personality-template, UI, voice, docs and character-lab work remains in the working tree.

**This is an uncommitted working branch.** A branch name alone does not store uncommitted changes in Git history. No commit or publication is claimed.

## Bugs fixed in source

1. **Evaluator model evidence.** Init and assistant model labels are now checked separately and strictly. Missing or wrong primary labels still fail. Aggregate usage keys, including Haiku or unknown names, remain visible as unattributed and review-required; they are not treated as the replying model. A pure helper and nine tests cover this boundary. Fake integration includes mixed valid/missing labels.
2. **Evaluator reply counts.** Attempt records, successful responses, fake replies and completed native replies are distinct. Cancellation or a post-response validation failure cannot turn an attempted record into a completed reply or label a real response fake.
3. **Manual voice Finish.** The recorder waits for the 200 ms delayed audio tail. Off, suspension and a new capture generation still discard pending audio. The recorder watchdog remains 3000 ms after the recorder is stopped.
4. **Voice cancellation.** Stop and the watchdog settle pending audio resume, fetch, body-read and decode waits. Late native results have no playback authority. Tests cover unresolved resume/decode, replacement playback and stale completion.

The full unit run caught two older endpoint assertions that assumed immediate recorder stop. They now verify the tail boundary and the watchdog relative to actual stop. Empty-result coverage also waits for the real stop boundary. No tests were skipped.

## Validation

- **154 Node unit + 84 daemon tests = 238 passed**, zero failures/skips.
- Daemon and UI typechecks passed with no emit/build.
- Whole-tree `git diff --check` passed. The eight changed/new evaluator and voice files also passed an explicit whitespace check because most were already untracked.
- Seven fake-only native evaluator cases passed their expected outcomes: normal, wrong model, missing model, auth rejection, forbidden tool, abnormal exit and resistant descendants.
- Every evaluator case made **zero real model/auth calls**. Normal completed four fake replies while retaining extra usage as review-required. Fault cases preserved accurate attempted/completed counts and stopped/cleaned owned processes and paths.
- The prior owner GO, one-shot claim and authority hashes stayed unchanged. The aborted real comparison remains closed; it was not replayed or reclassified.
- Canonical SOUL/AGENTS hashes remain unchanged. No protected adoption occurred.

Evidence: `output/v2-prep/{before-branch.json,branch-preservation.json,VALIDATION.json,BACKEND-AUDIT.md,UI-AUDIT.md,UI-VOICE-HANDOFF.md}` and `output/personality-followup/offline-metadata-v1/VALIDATION.md`.

## Boundaries and next decision

These are source changes, not an installed update. No UI build, native refresh, microphone/STT test, service restart or new real-model comparison was performed. Device audio behavior and companion-style improvement are not newly proven. The installed voice/UI version and the exact protected personality stay untouched.

The requested working-branch preparation and source bug fixes are complete. Committing the snapshot is an optional follow-up, not a requirement that was explicitly included in this preparation goal. Git history still does not contain the pending changes. Do not silently stage/commit other work, reset the closed evaluation claim, adopt the proposed SOUL, or publish these source fixes. Any later commit, model evaluation or app installation needs its own explicit decision.

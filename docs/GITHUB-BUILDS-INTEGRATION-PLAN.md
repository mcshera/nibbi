# GitHub-connected Builds: integration plan

September 9, 2026. This is an implementation plan grounded in the current source, local repositories, installed build records, and read-only GitHub inspection. The private Battalion repository has been created and its local origin connected, as separately authorized. The in-app integration described below is planned work.

## 1. Product outcome and decisions

Nibbi becomes Matty’s main place to understand ongoing work and deliver updates for Shipless, Nibbi, and Battalion. From a Build, Matty can see its repository, branch, changes, local checks, published commit, pull request, GitHub checks, reviews, and next action. He can push an update, revise a PR, merge it, and see whether the result has reached the project’s release branch or running application.

**Confirmed:** Shipless uses `mcshera/derelict`; Battalion gets a private `mcshera/battalion`; separate Builds must have separate branches. Nibbi already uses `mcshera/nibbi`.

**Recommended delivery workflow:** build branch → draft PR → checks/review → merge into the project’s integration branch → promotion to `main` where applicable. This is the working assumption for “push updates”; direct pushes to a shared integration/release branch are not the normal Build workflow. Releases and deployment can appear as evidence, but new deployment automation is a separately defined extension. The existing Nibbi installation workflow remains distinct from publishing its code.

**Scope:** a complete usable GitHub workflow for all three projects, including adopting existing local changes, updating the same Build/PR, handling external GitHub changes, recovering interrupted operations, and migrating retained work. The work is a refinement of the current Builds, Issues, Plans, and project settings surfaces. Preserve the paper interface, Velvet Pool, chat drafts, attachments, voice controls, and local execution capabilities.

## 2. What exists today

| Project | Local repository | GitHub repository | Observed branch relationship | Readiness gap |
| --- | --- | --- | --- | --- |
| Shipless | `/Users/Matty/Documents/Board Game Test` | `mcshera/derelict`, private; explicitly confirmed | Local `staging` and `main` equal GitHub `main` at `adf91911d760`; `staging` has no upstream. GitHub currently has only `main`. | No Actions workflows/checks; explicit integration target is missing from Nibbi’s project registration. |
| Nibbi | `/Users/Matty/Documents/Nibbi` | `mcshera/nibbi`, public | Local `v2` is three commits ahead of GitHub `main` at `f2ace12e3790`, plus substantial uncommitted work. No upstream; GitHub has `main`, `phone`, `irene-test`, but no `v2`. | Current GitHub `verify` run fails at the browser verification step; project target is not explicitly saved. |
| Battalion | `/Users/Matty/NibbiProjects/battalion` | Private `mcshera/battalion`, created following the user’s instruction | Local `main` has substantial uncommitted work. The new GitHub repository starts empty. | Needs an inspected baseline import, a saved integration target, and CI. The local origin is connected and verified; there is no remote branch or upstream yet. |

The initial inventory found 29 tracked changes and 259 untracked files in Nibbi, and 52 tracked changes and 143 untracked files in Battalion. These are snapshot counts, not an instruction to publish those files. Shipless’s primary checkout was clean. Retained work spans 98 Shipless worktrees, two Nibbi worktrees, and 21 Battalion worktrees; several contain edits.

GitHub CLI `2.87.3` is installed. The active account is `mcshera`, authenticated through the keyring; an inactive `devMatta` account also exists. API access to an owned repository does not by itself prove that Git transport works from the native daemon. Verify both separately during setup.

Shipless’s and the newly created Battalion repository’s protection/ruleset APIs returned a 403 explaining that the current private-repository plan does not provide the feature. Nibbi has no branch protection or rulesets. Neither mapped repository had an open PR. Nibbi’s [observed failing main workflow](https://github.com/mcshera/nibbi/actions/runs/33935189866) is an existing baseline problem, not evidence that this proposed integration failed. Fix and recheck it during rollout. Do not infer “checks pending” from the legacy status endpoint returning an empty list.

Current implementation facts:

- `daemon/src/fixer.ts` already reserves a unique `fx-<UUID>`, branch `nibbi/<runId>`, and isolated worktree for every new Build. The branch is created when execution starts.
- Execution starts from a local target branch, records `baseSha`, runs configured verification, creates a backend-owned commit, records its SHA, and stages it for review. It does not publish to GitHub.
- All three live project registrations omit `targetBranch`. Dispatch currently snapshots whichever branch is checked out. That must become an explicit project setting.
- `run.merge` currently integrates locally and completes linked local tasks/issues. It proves nothing about remote publication, PR merge, release, or installation.
- Retry creates a new Build and branch. Its broad record-copying path could accidentally inherit future PR/publication metadata; replace that copy before adding those fields.
- Provider shell policy denies raw `gh` and Git writes. Keep remote authority in typed backend commands.
- Existing SQLite records, events, command fingerprints, project read models, and inline Build evidence provide the implementation foundation.
- The 227 historic Build records have no GitHub/PR associations. Many legacy records lack reliable base/head/target data. Preserve uncertainty rather than retroactively labelling them delivered.

Source anchors: [project registration](../daemon/src/projects.ts), [build lifecycle](../daemon/src/fixer.ts), [governed commands](../daemon/src/command-service.ts), [provider policy](../daemon/src/policy.ts), [persistence](../daemon/src/store.ts), [current section UI](../public/lib/project-workspace.js).

## 3. Repository and branch topology

Save one verified connection for each project, with a named integration branch. The recommended initial mapping preserves the existing work lanes:

| Project | Build PR base | Release branch | Initialization required before enabling that base |
| --- | --- | --- | --- |
| Shipless → `mcshera/derelict` | `staging` | `main` | Publish `staging` at the inspected existing `main` commit, then set the explicit mapping. |
| Nibbi → `mcshera/nibbi` | `v2` | `main` | Review the three existing local commits and publish the intended `v2` baseline. Uncommitted work enters separate Builds. |
| Battalion → `mcshera/battalion` | `main` | `main` | Review the existing committed baseline and initialize the empty repository. Adopt current edits into separate Builds afterward. |

These are proposed branch settings, not Git mutations performed by this plan. Show the exact repository, base branch and commit before initializing or changing a connection. A repository’s GitHub default branch, local working branch, local integration target, and Build PR base must have separate labels and fields. Changing the checked-out branch must not change a future Build’s destination.

A Build owns exactly one repository identity and one distinct branch for its lifetime. Continue the existing unique `nibbi/fx-<UUID>` naming initially; display the human purpose beside it. Record and show `branch → base`. Branch names are not guessed from titles. Check namespace collisions before creation or first publication; an unrelated existing remote branch is a conflict.

In GitHub mode, queueing reserves the Build identity and destination; execution fetches the selected remote integration ref into controlled local refs, records the resolved SHA, and starts its worktree from that exact commit independently of the owner checkout. It must not use a stale or dirty local `v2`, `staging`, or `main` as an implicit baseline. If remote freshness cannot be established, default to waiting with a clear connection state; an explicit “Start from last fetched base” action may use a labelled cached SHA and must refresh/compare before publication. Local-only mode retains local-target behavior.

Two concurrent Builds of the same project start from their recorded remote integration baseline into separate worktrees and branches. Different projects retain separate repository identities even if branch names happen to match. Every remote write uses the pinned repository/ref, never the currently selected UI project or shell directory.

Make the distinction between two actions explicit:

- **Update this build:** a new execution attempt adds commits to the existing Build branch and updates its existing PR. It has a new attempt ID, logs, verification and cost evidence, while the Build/branch/PR identity stays stable.
- **Start replacement build:** today’s retry behavior, presented honestly. It creates a new Build ID, branch and eventual PR, with an explicit `replacesBuildId` link. It never inherits the old branch’s publication or PR receipt.

Merged, discarded and superseded Builds cannot silently reopen their old PR as an update. Start a replacement. Keep failed attempts and the last verified/published commit independently available. Permit one writer per Build branch; require an explicit recovery choice for dirty failed-attempt worktrees.

For Shipless and Nibbi, a promotion PR from `staging`/`v2` to `main` is a separately visible release candidate that lists included Builds and the exact compared commits. Existing Build PRs remain independently identifiable. For Battalion, merging a Build PR into `main` already reaches the release branch. Neither operation claims deployment without deployment evidence.

## 4. The everyday workflow

1. **Understand the project.** Open Builds and see the verified repository, integration branch, connection health, last refresh, outstanding work and local changes outside Builds.
2. **Start or adopt work.** Create a Build from chat, an issue or a plan task. Alternatively choose “Create build from local changes,” inspect the file/hunk selection, and move a copy of the selected patch into an isolated Build worktree. Keep the original checkout intact. Include explicitly selected untracked files; preserve binary files, modes, deletions and renames correctly. Record the source revision and reject a changed selection.
3. **Build and inspect.** Show reported activity, local verification, base/head commits and an inline diff. A successful coding attempt is ready for inspection; it is not already on GitHub.
4. **Push build branch.** Present the exact repository, remote branch, commit range, new head, and whether this creates or updates the remote ref. Backend publication pushes only that inspected commit/ref. Uncommitted files elsewhere are not part of the push. WIP commits may be published clearly as unverified work, with draft PR status; merge eligibility still requires the configured checks. Today failed checks can leave uncommitted edits. Add an explicit “Checkpoint as unverified” action that shows selected Build-worktree changes, checks its expected branch head, creates a backend-owned commit and records unverified evidence. Pushing never implicitly commits failed-attempt edits.
5. **Create draft PR.** Prepare an editable title/body with the problem, changes, validation and linked records. Show the explicit head and base. Creation returns the actual PR URL/number and binds them to the Build. Push and PR creation are separate recoverable steps, even if the UI offers one reviewed “Push and create draft PR” action.
6. **Review and revise.** Read review requests, comments, changed files and check failures in the Build. “Update this build” produces a new attempt; “Push updates” sends only its new commits to the same branch/PR. “Mark ready for review” updates the draft state. Review comments are content, not instructions with execution authority.
7. **Merge the PR.** Show the current reviewed head, base, required checks, review requirements, conflicts and merge method. Recheck eligibility immediately before submitting. Distinguish an accepted merge queue/auto-merge request from a completed merge.
8. **Reconcile and continue.** Read GitHub’s final merged state and receipt, complete only the exact linked local records under the chosen workflow policy, and offer to update a clean local integration checkout. Preserve a dirty or divergent checkout and explain the specific reconciliation needed.
9. **Promote or deploy.** For Shipless/Nibbi, prepare and review the integration-to-main promotion PR. Show subsequent Actions/deployment status and commit separately. For Nibbi, show the installed version/commit separately from the GitHub merge. New release/deployment triggers need a project-specific follow-up specification.

The repository inspector also supports publishing existing *committed* project-branch history with an explicit range and destination, needed for initialization and legacy local merges. This is distinct from a Build push and must not become a hidden “push everything” shortcut.

## 5. Builds and settings design

Keep Builds, Issues and Plans. Add **Repository & GitHub** to the project gear; use shared connection settings for the GitHub host/account. Configuration should show the project’s real owner/repository and visibility, local path, fetch/push remote, integration branch, release branch, account and observed capabilities. A local remote connection alone is not a fully enabled in-app delivery workflow.

Build rows lead with purpose, then branch → target, then execution/local-check state and one useful delivery line. Examples are illustrative:

| Build | Branch and target | Evidence and next action |
| --- | --- | --- |
| Shipless: tighten turn handling | `nibbi/fx-… → staging` | Local checks passed · Not pushed → Push build branch |
| Nibbi: improve project navigation | `nibbi/fx-… → v2` | PR #… · 2 new local commits → Push updates |
| Battalion: improve movement | `nibbi/fx-… → main` | PR #… · Changes requested → Update this build |

The expanded view contains Summary, Changes, Checks, GitHub, and Log. Checks separates local verification from GitHub CI, each tied to its tested commit. GitHub includes PR state, reviews, remote branch/head, pending operations, merge blockers, and delivery events. Surface one appropriate primary action; keep provider/cost details secondary. Retain the focused Build detail and Back to build list on narrow screens.

Add counted filters **Active**, **Review**, **To push**, **Pull requests**, **Needs attention**, and **History**, plus All. Define these as potentially overlapping filters with a canonical “next action” grouping for an unfiltered list, so rows do not appear twice in the list. Local merges that still need publication must remain discoverable in To push. Open/queued PRs do not disappear into History. Clearly separate “execution failed,” “CI failed,” and “push failed.”

Sidebar and tab counts use that same read model. Prefer an actionable badge such as `2 to push`, `1 PR ready`, or `1 needs attention`, with at most one supporting line. The repository inspector handles larger commit/branch details. Show No tracking branch rather than fabricated ahead/behind counts; Unavailable rather than zero; and the last confirmed facts with a stale timestamp during outages.

Reuse the existing form/draft/focus protection. Background refreshes cannot replace a pressed button or move it via a notice before click dispatch. Changing projects while a push completes must leave the receipt with its original Build. GitHub screens and operations preserve the conversation draft, attachments, scroll, selected evidence and microphone state.

## 6. Backend contracts and ownership

Use additive records rather than rewriting all historic Builds. The existing fixer UUID remains the Build identity. New attempt records retain execution history beneath a Build when revisions are supported.

| Record | Required information |
| --- | --- |
| Project GitHub connection | Connection revision; host; immutable repository ID/node ID; owner/name and URL; visibility; expected account; canonical local Git common directory; fetch/push remote and sanitized URL fingerprint; integration/local target/release branches; workflow mode; app-required workflow/job/context identities, expected producer identity and accepted conclusions; observed permissions/rules; freshness/error. |
| Build GitHub binding | Build/project IDs; connection revision snapshot; repository/head-repository IDs; branch; pinned base branch/SHA; workflow/completion policy; intended remote ref; last verified candidate SHA; last confirmed pushed SHA; PR repository ID/number/node ID/URL; replacement lineage. |
| Execution attempt | Attempt ID and parent Build; input head/base; worktree ownership; execution state; immutable output candidate/check result; logs/tool leases/preview attribution; timestamps/cost; preserved failure evidence. Root Build fields may project the latest attempt but do not replace older evidence. |
| Remote observation | PR state/draft/head/base; mergeability and review decision; individual check runs/status contexts/requirements; merge queue/auto-merge state; confirmed merge receipt; observed time/ETag/error. |
| Publication operation | Operation ID/idempotency fingerprint; actor; exact destination and expected SHAs; connection revision; reviewed payload; phase/attempt; external receipt; failure or unknown-outcome state; reconciliation history. |

Keep execution, publication, PR/review/CI, local synchronization and deployment as separate dimensions. For example, a failed update attempt can coexist with a previously verified, published PR head. “No checks configured,” skipped/cancelled checks, pending checks, failed checks and unreadable checks are distinct.

Proposed modules and changes:

- `daemon/src/github-cli.ts`: bounded `gh` adapter, explicit arguments, noninteractive environment, JSON parsing, host/account verification, capability detection and redacted errors.
- `daemon/src/github-repositories.ts`: project binding, repository/ref inspection, local comparison and canonical remote parsing, including SSH/HTTPS, separate push URLs, forks and repository renames.
- `daemon/src/github-builds.ts`: publication/PR/update/merge intent and reconciliation, keyed by Build and exact commits.
- Extend `projects.ts`, `fixer.ts`, `command-service.ts`, `read-models.ts`, `project-workspace.ts`, `main.ts`, `store.ts` and shared contracts. Audit `scheduler.ts`, previews, logs, events, tool leases, costs and every run-ID consumer when introducing attempts.
- Extend `public/lib/project-data.js`, `project-summary.js`, `project-workspace.js`, `margin-ui.js`, `public/app.js`, settings and their CSS.

Proposed commands: `github.connect`, `github.refresh`, `build.adoptChanges`, `build.update`, `build.checkpoint`, `build.updateBase`, `build.publish`, `build.prCreate`, `build.prReady`, `build.prMerge`, `project.syncTarget`, and `project.preparePromotion`. Existing `run.retry` remains the replacement path after its metadata-copy bug is fixed. Names are new contracts to implement, not existing API claims. Reads extend the current project section/summary endpoints and add selected-Build GitHub detail; mutations stay in the governed command service.

Each mutation receives a server-issued operation/review reference or equivalent validated payload bound to connection revision, repository, Build/ref and expected head. The UI’s allowed actions are advisory. Recheck authority and preconditions on the server; reuse a valid existing authorization for the same concrete operation rather than requesting repeated generic approval.

Keep raw `gh` and Git write access out of provider tools. Give the conversational lead structured read tools for project/build/PR facts so “what are we working on?” is answered from current evidence. If chat initiates a push or merge, route it through the same typed operation and destination review as the button.

## 7. Git and GitHub CLI implementation

Git handles local history, worktrees and ref transport. `gh` handles authenticated GitHub metadata, PRs, checks, reviews and merge requests. Using `gh` does not remove the need to execute a carefully scoped Git push.

| Capability | Command/API shape and contract |
| --- | --- |
| CLI/account discovery | `gh --version`; `gh auth status --active --hostname github.com --json hosts`; `gh api user`. Inspect JSON account status, not exit zero alone. Never request or display tokens. |
| Repository inspection | `gh repo view OWNER/REPO --json id,nameWithOwner,url,visibility,defaultBranchRef,viewerPermission`; explicit REST reads for permissions, branch rules and refs when needed. |
| Remote reads | `git ls-remote` for exact refs; scoped fetch into controlled refs when objects are needed. `gh pr list/view --repo OWNER/REPO --json …` with pagination and exact head-repository/base matching. |
| Publish a candidate | `git push <validated-remote> <expected-head-sha>:refs/heads/<build-branch>` under the repository/Build lock, after rereading the expected local and remote facts. Normal fast-forward semantics; a non-fast-forward result enters conflict recovery. Read the remote ref back. |
| Create a PR | `gh pr create --repo OWNER/REPO --head BRANCH --base BASE --draft --title TITLE --body-file FILE`. For a supported fork, qualify the head owner/branch and verify the head repository ID. Push separately and specify both refs to prevent implicit branch selection/forking; unsupported fork-owner combinations stay explicitly unavailable. Respect repository PR templates and edit the prepared body before submission. |
| Inspect CI/review | `gh pr view NUMBER --repo OWNER/REPO --json …`; `gh pr checks NUMBER --repo OWNER/REPO --required --json name,state,bucket,link,workflow`; inspect all checks separately; selected `gh run view` for details/logs. Match check evidence to the observed current head or applicable merge-group commit. |
| Merge | `gh pr merge NUMBER --repo OWNER/REPO --match-head-commit SHA` with the permitted explicit method or the repository’s merge-queue path. No administrator bypass. Poll/read back until actually merged. |
| Promotion | Create an explicit integration-to-main PR, review its entire compared range, use the same merge/check/receipt machinery, and record included Builds. |

GitHub documents that PR creation can otherwise push/fork implicitly, and even its `--dry-run` may push. Therefore the preview in Nibbi is built from read-only facts and prepared text, not that flag. See [PR creation](https://cli.github.com/manual/gh_pr_create). `--match-head-commit` binds a merge to the reviewed tip, while queue entry is not merge completion: [PR merge](https://cli.github.com/manual/gh_pr_merge). Checks can return exit code 8 for pending work and have distinct buckets: [PR checks](https://cli.github.com/manual/gh_pr_checks). Auth JSON can exit successfully while reporting authentication problems: [auth status](https://cli.github.com/manual/gh_auth_status).

Run subprocesses with argument arrays, a verified executable, bounded output/time, no shell interpolation, and no interactive prompts/editors/pagers. Keep PR text in a temporary file with intentional newlines. For REST reads, pass `--method GET` explicitly where fields would otherwise change the default method; use static GraphQL queries and typed variables. See [gh api](https://cli.github.com/manual/gh_api).

The native launchd/backend environment must resolve `gh` and access its configured keyring and Git transport without depending on an interactive terminal. Existing sandbox token stripping stays intact; use a dedicated backend credential boundary. Pin expected host/account and stop on account or repository-identity mismatch. Do not silently switch the globally active account between concurrent projects. A repository move can update display metadata only after verifying its immutable identity.

Cache by account/host/repository/ref, not project display name. Use one coordinator for all clients; bounded concurrency (initially two remote reads per host and one mutation per repository), coalesced invalidation and conditional requests where supported. Refresh visible/active PRs around 15–30 seconds, idle expanded project summaries around 60 seconds, and selected detail on demand; suspend unnecessary polling when hidden. Honor rate-limit/retry headers and back off with jitter. A targeted refresh follows mutation completion or reconnection. See [GitHub API best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api).

## 8. Delivery correctness and recovery

1. **Pin each destination.** Project configuration changes apply to future Builds. Existing Builds retain their connection/base snapshot until an explicit migration. Remote URL rewrites, push URLs and repository IDs must be checked before publication.
2. **Publish the reviewed commit.** A changed head or file selection invalidates the prepared operation. Never stage the whole owner checkout as part of pushing. Normal pushes must not overwrite a divergent remote branch. Git’s refspec/fast-forward behavior is described in [git push](https://git-scm.com/docs/git-push).
3. **Preserve evidence through updates.** Local verification and approvals reference immutable SHAs. New commits invalidate old head-specific eligibility. Checks or approvals for an older head remain historical evidence, not permission to merge the new one. “Update from base” merges the current remote integration baseline into the Build through a new attempt, with a reviewed conflict-resolution path and fresh checks; it does not force-rewrite a published branch.
4. **Account for base movement.** Re-evaluate mergeability and applicable checks if the PR base advances. For repositories without usable server-required checks, Nibbi performs current integration-candidate verification and records that its enforcement cannot govern independent GitHub clients. Persist the actual remote merge receipt, then run verification on the exact merged commit whenever existing evidence does not prove that resulting code was tested. Until it passes, show “Merged on GitHub · Verification pending/failed” and keep linked records pending. This also applies to external merges with a head/base different from the verified candidate; it cannot undo an already accepted remote merge or guarantee server-side exclusion of another client.
5. **Respect GitHub rules.** Discover required checks/reviews and allowed merge methods. Missing permission, absent rules and unavailable features are different states. Do not make private repos public or change billing/settings to bypass the observed protection gap. Shipless/Battalion can use Nibbi’s explicit merge gates while the user chooses whether stronger server enforcement is needed. Configure app-required workflows/jobs/status contexts and trusted producer identities per project, with success as the default accepted conclusion. Empty or unavailable GitHub `--required` output does not waive these requirements. Missing, pending or failed configured checks block merge even where GitHub itself permits it.
6. **Recover unknown outcomes.** Persist intent before launching push, PR creation or merge. A timeout, process cancellation or restart can happen after GitHub accepted the mutation. Inspect the exact remote ref/PR before retrying. Reuse a found exact PR association; never create duplicates based on a title match. If proof is insufficient, retain “Outcome unknown” with a recheck action.
7. **Handle external work.** Poll/adopt PRs created outside Nibbi through an explicit exact repository/branch association. New commits from another client trigger “Remote branch changed,” comparison and deliberate adoption/update. Closed-without-merge, reopened, renamed, externally merged and queued PRs each have specific states.
8. **Complete the right records.** New GitHub-mode Builds complete linked local tasks/issues only after a verified GitHub merge into their pinned integration target. Local-only Builds retain existing local completion semantics. Migration must not reopen previously completed records or mark legacy local merges as remotely delivered. A PR merged into an unexpected base needs reconciliation rather than automatic completion. Persist merge receipt → actual-commit verification → linked-record completion as separate durable phases. Resume unfinished verification/completion after restart; apply completion idempotently once per receipt/record and preserve a later user reopening. The server must reject the local `run.merge` path for GitHub-mode Builds, including legacy approve/chat/agent-card routes.
9. **Keep GitHub Issues distinct.** Store GitHub issue repository/number/node IDs separately from local issue UUIDs. Use explicit links. Closing keywords only operate against the repository’s default branch, so a merge into `staging` or `v2` must not claim that GitHub automatically closed an issue. Use references there and closing links on the promotion PR where appropriate. See [GitHub issue/PR linking](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue).
10. **Synchronize safely.** After remote merge, fetch the confirmed target and fast-forward a clean expected local integration checkout when possible. Dirty, locally ahead, divergent or switched checkouts retain their files and receive an explicit comparison/recovery route. Never automatically reset, stash, clean or rebase them.
11. **Retain branches and worktrees.** Successful remote merge does not immediately delete recovery evidence. Cleanup is a separate retained-work action checking previews, active attempts, uncommitted files and unpushed commits. Do not combine `--delete-branch` with the first merge implementation.
12. **Keep automation authority stable.** Existing scheduler `ship` means local automatic integration. Do not reinterpret it as permission for remote push/PR/merge. When enabling GitHub mode, preserve the mode pinned on existing Builds and pause the project’s legacy automatic `ship` policy with a clear migration notice. The scheduler must never locally integrate a GitHub-mode Build; legacy local-only Builds retain their original semantics. Add separately scoped remote policies only after the interactive workflow is proven; default them off for migrated projects.
13. **Separate release from installation.** Show “Merged into v2,” “Merged into main,” “Deployment succeeded at SHA,” and “Installed Nibbi version” from their own receipts. A queued merge, local preview, green CI or published branch cannot stand in for another result.

## 9. Delivery sequence and acceptance gates

| Phase | Work | Completion gate |
| --- | --- | --- |
| 1. Connections and read-only understanding | Persist all three verified repo/account identities and explicit target mapping; add repository settings, Build branch identity, PR/check summaries and useful counts. Correct legacy unknown states. | All three projects resolve to their own repositories; a project/branch/account switch cannot change a retained Build destination; offline/rate-limit reads preserve facts. |
| 2. Baselines and real checks | Review/publish Shipless `staging` and Nibbi `v2` baselines; import Battalion’s selected committed baseline; fix Nibbi’s existing verification failure; introduce meaningful Shipless/Battalion workflows. Recheck available branch controls without changing visibility. | Remote base refs exist at reviewed SHAs. Each repo has a demonstrated passing workflow on a test branch and a deliberately failing fixture is reported as failed. All owner edits remain intact. |
| 3. Push and draft PRs | Implement typed intents/reconciliation, exact-commit publishing, PR creation/editable body, identity-based adoption and “Create build from local changes.” | One real isolated test Build per project has its own branch and exact PR association. Duplicate clicks/restarts do not duplicate pushes/PRs. Only inspected changes are included. |
| 4. Updates, review and remote merge | Add attempts for Update this build, replacement semantics, review/check detail, exact-head merging, queues, linked completion and safe local synchronization. | A review update adds commits to the same PR; replacement gets a new branch; old checks cannot authorize new head; only actual intended merge completes linked records. |
| 5. Main-branch delivery and migration | Add Shipless/Nibbi promotion PRs, linked release evidence, inspection/adoption of existing branches/PRs, retained-work cleanup route and local-only compatibility. | Matty can identify which Builds reached integration and which reached main. Legacy work remains recoverable. Remote delivery and installed/deployed version remain separate. |
| 6. Native rollout and everyday use | Verify all three project flows in the native app plus narrow/short browser layouts; publish only reviewed Nibbi source changes; test daemon authentication and restart recovery. | Entire flow works without terminal use after connection setup, with preserved chat/attachments/voice and accurate cross-project counts. |

Each phase should be a reviewable implementation unit with its own meaningful tests and a usable app state. Phases 1–3 deliver visibility and pushing; they are not completion of the full integration. Completion requires phases 4–6 as well. No fixed time estimate is asserted before implementing the connection and legacy-migration contracts.

The current dirty Nibbi tree contains substantial unrelated work. Build and deploy this feature from an isolated checkout/control plus an explicit change set; do not publish the entire dirty tree. Preserve existing source, runtime records, worktrees and installed app state during rollout.

## 10. Verification matrix

| Requirement | Evidence required before calling the integration complete |
| --- | --- |
| Three correct GitHub connections | Actual immutable repo IDs and private/public visibility; Shipless=derelict, Nibbi=nibbi, Battalion=private battalion; native daemon authentication and Git transport verified. |
| Distinct Build branches | Concurrent Builds on each project produce unique branches/worktrees; exact base/ref mapping verified in real temporary Git repositories and a controlled GitHub acceptance run. |
| Stable same-Build updates | Two attempts produce two immutable verification/log records but one branch/PR; failed update preserves prior usable head; only one writer admitted. |
| Honest replacement | New branch/PR for replacement; retained old evidence; no copied PR/merge/publication fields through retry or redispatch. |
| Existing edits can ship selectively | Text/binary/untracked/rename/deletion selection; source changes during adoption rejected; unrelated and dirty files preserved byte-for-byte. |
| Accurate local/remote status | No upstream, ahead/behind/diverged, no checks, stale, failed auth, inaccessible rules, CI failure and remote publication failure remain distinct. |
| Correct push and PR creation | Explicit repo/head/base; failed-attempt WIP requires an explicit unverified checkpoint; no implicit fork/push; exact remote SHA readback; repeated clicks, timeout-after-success and restart reconciliation produce one association. |
| Review evidence matches commits | Older head checks/approvals cannot merge a new head; missing app-required checks block despite empty GitHub required-check lists; changed base/head and merge-group checks handled; draft/changes-requested states respected. |
| Remote merge and completion | Merge/squash/rebase/queue/external-merge evidence; durable post-merge verification/completion resumes after restart; failed actual-commit verification leaves linked records pending; closed-but-unmerged and unexpected-base PRs do not complete tasks; local and GitHub issue identities remain separate. |
| Project isolation | Simultaneous operations and UI/account/remote changes cannot redirect a push/receipt; forks with matching branch names are not confused. |
| Safe local synchronization | New GitHub-mode Builds use the recorded remote base even when the owner checkout is stale/dirty; cached offline starts are explicit; clean fast-forward works; dirty/ahead/divergent/switched checkouts preserved; remote merge remains recorded even if local update is blocked. |
| Full delivery tracking | Shipless/Nibbi promotion PRs list included Builds; Battalion lands in main directly; release/deployment/installed version states require their own commit-linked evidence. |
| Useful Builds UI | Counts equal canonical visible records; branch/base and next action readable; PR links and failures actionable; sidebar, tabs and conversation agree. |
| Native/mobile resilience | Real native gh/keyring setup, keyboard/focus, long branch names, 44px controls, short composer, offline refresh, draft/attachment/voice preservation and restart recovery. |
| Historic preservation | Inventory and checksums for retained worktrees; conservative metadata migration; no automatic publication/deletion or fabricated delivery status for legacy runs. |
| Automation boundary | Existing local `ship` configuration cannot trigger remote writes after upgrade; migration pauses/reconfigures it; direct `run.merge`, legacy approve and scheduler routes cannot locally complete GitHub-mode Builds; remote policy requires its own explicit scope and receipts. |

Use deterministic CLI/API fixtures for race/error coverage, real temporary Git repositories for branch/ref/adoption tests, and a controlled GitHub branch/PR smoke test per named repository when the feature is ready. Inspect current GitHub facts rather than treating mocked green checks as proof of delivery. Native verification must run from the installed daemon environment, not only a terminal.

## 11. Decisions carried into implementation

- Keep the confirmed repositories. Battalion remains private.
- Use the explicit proposed `staging`, `v2`, and `main` integration lanes after their reviewed baseline setup. Present any changed target as a concrete configuration change, not an implicit fallback.
- Use branch/PR delivery as the primary workflow, with same-Build updates and separate replacement Builds. A direct shared-branch push is a specific initialization/legacy-history operation.
- Keep GitHub issue synchronization optional and explicit; local issues/plans already provide identities and links. Reading and using their related PRs is core; wholesale bidirectional issue mirroring is not required.
- New deployment automation is not yet specified. Keep project release/deployment evidence visible, and define each deploy command, environment, rollback and artifact provenance before adding a deploy trigger.
- The private-repository protection limitation is recorded. The app must expose what it can enforce locally versus what GitHub enforces; a billing or visibility change is not assumed.

This document is the deliverable for the planning goal. It does not claim that the application integration, branch initialization, CI repairs, pushes, PRs or deployments have been implemented. The separately authorized Battalion repository creation/connection has its own verified evidence under `output/github-integration-plan/`.

## Planning completion audit

The requested plan covers GitHub CLI integration (sections 6–8), Nibbi as the main understanding/pushing workflow (sections 4–5 and 9), all three named repository mappings (sections 2–3), and separate branches per Build with explicit update/replacement semantics (section 3). It includes code boundaries, migration, implementation order, material failure cases and acceptance evidence for the eventual implementation. Independent source/UX reviews were incorporated, including remote-base selection, legacy local-merge bypass prevention, WIP checkpointing and durable post-merge verification.

The additional concrete request is complete: private `mcshera/battalion` (repository ID `1363335093`, node ID `R_kgDOUULXtQ`) exists and Battalion’s local origin is `https://github.com/mcshera/battalion.git`. A fresh read confirmed PRIVATE, ADMIN access and an empty repository. HEAD, local refs, worktrees and all 195 dirty-file contents were preserved; Shipless still points to `mcshera/derelict`. See [creation/connection evidence](../output/github-integration-plan/battalion-connection.json). No code was committed or pushed, and the installed app was not changed during planning.

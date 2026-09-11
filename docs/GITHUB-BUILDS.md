# GitHub-connected Builds

Builds can deliver changes through a GitHub branch and pull request. Each Build keeps its own repository, branch and target. Updating a Build creates a new execution attempt on the same branch and PR; starting a replacement creates a separate Build and branch.

## Connect a project

Open the project gear and choose **Repository & GitHub**. Inspect the local repository, fetch and push remotes, GitHub account, repository visibility and branch targets. Save the reviewed connection with an explicit integration branch and release branch. The default GitHub branch, checked-out local branch and Build destination are separate facts.

The daemon uses an installed GitHub CLI and its configured credentials. It verifies the expected account and immutable repository identity without switching accounts. API access and Git transport are checked separately. Unsupported fork or push-remote mappings remain unavailable until explicitly resolved.

Configure meaningful local verification commands and required GitHub checks. Required checks identify their trusted producer and workflow as well as their job name. Missing, unreadable, skipped, pending and failed checks do not count as successful checks. Where GitHub branch rules are unavailable, Nibbi's merge gates apply to actions performed through Nibbi; other GitHub clients remain governed by the repository's actual rules.

## Work on a Build

1. Start a Build from chat, an issue or a plan task, or choose **Create build from local changes**. For adoption, inspect and select files or text hunks. Nibbi copies only that selection into an isolated worktree and leaves the owner checkout intact. Binary files, renames, deletions and modes can be selected as whole-file changes.
2. Inspect the Build's **Summary**, **Changes**, **Checks**, **GitHub** and **Log**. Local and GitHub verification each name the commit they tested. Each execution attempt retains its own result, log and cost evidence.
3. Choose **Push build branch** and review the exact repository, branch and commit. Publishing sends that commit with normal fast-forward Git semantics and reads the remote ref back. It does not commit uncommitted files.
4. Create a draft PR with the explicit head and base. Repository PR templates are read from a pinned commit and remain editable content. With multiple templates, the selector keeps edits to each draft while the form is open. The submitted body is the reviewed body.
5. Use **Update this build** to make another attempt on the same branch and PR. Review and push the new commit, then mark the PR ready. A failed update preserves its evidence and the previous verified commit.
6. Review current checks, reviews, conflicts, head and base before merging. A changed head or base invalidates an earlier merge review. An accepted queue request stays pending until GitHub confirms the actual merge.

New GitHub Builds start from a freshly fetched integration commit even when the owner checkout is dirty, stale or on another branch. If freshness cannot be established, the Build waits with a connection error. Only one writer can change a Build branch at a time.

Failed worktree edits can be retained with **Checkpoint as unverified** after reviewing a file or hunk selection. This creates an explicitly unverified commit. Publishing unverified work requires a draft PR and does not waive merge checks. **Update from base** merges the current remote integration commit through a separate verified attempt; conflicts and failed checks retain recovery evidence.

## Understand delivery

Build filters overlap intentionally: **Active**, **Review**, **To push**, **Pull requests**, **Needs attention** and **History** describe different reasons to revisit work. The unfiltered list contains each Build once. Sidebar and tab counts use the same Build summary.

A GitHub merge receipt, verification of the actual merged commit and completion of linked local records are separate durable steps. Failed result verification leaves linked records pending. Recovery resumes unfinished steps after restart and preserves a later user reopening of a completed issue or task. A remote merge remains recorded if updating the local checkout is blocked.

After a merge, **Update local integration branch** can fast-forward a clean checkout on the expected branch. Dirty, switched, locally ahead or divergent checkouts retain their contents and require deliberate reconciliation. Nibbi does not automatically stash, reset, clean or rebase the owner checkout.

If integration and release branches differ, create a promotion PR. Its review lists the exact compared commits and the linked Builds newly included in that range. Explicitly linked GitHub issues use closing references when the promotion targets the repository's default branch, and ordinary references otherwise. Local issue UUIDs and GitHub issue identities remain separate.

Integration merge, release-branch merge, deployment evidence and installed Nibbi version have distinct receipts. Publishing or merging code does not install or deploy it. This integration does not add deployment triggers.

## Existing work and recovery

Historic local Builds keep their evidence. A known local merge commit with no remote association is labelled **Publication not tracked** and remains discoverable in **To push**. Missing historical commits remain uncertain. Existing branches and PRs can be linked only after reviewing their exact repository and branch identity.

If another client pushes commits to a Build's pull request, the Build shows **Remote branch changed** and needs attention. Readiness, merge, push and update actions are withheld until **Adopt commits from GitHub** fast-forwards the Build branch to the exact remote head after review. The adopted head is unverified until local checks run on it; GitHub checks are evaluated for that head separately. A remote branch that diverged from the Build (rewritten history) is never merged or overwritten; start a replacement Build or reconcile the branch explicitly.

Remote operations persist their intent before execution. If a timeout or restart leaves the outcome unknown, recheck the exact remote branch or PR before retrying. Recovery reuses a confirmed association rather than creating another PR by title.

Connecting a project pauses legacy automatic local `ship` behavior. It does not grant automatic remote publication or merge authority. GitHub-mode Builds cannot use local merge, legacy approve or scheduler paths to bypass remote delivery checks. Local-only Builds retain their original completion policy.

Worktrees are retained after merge. Cleanup is a separate reviewed action that checks active attempts, previews, uncommitted files and unpublished commits; the branch remains available.

## Verification

The source includes deterministic GitHub fixtures for identity, stale checks, operation recovery, merge completion and promotion behavior, plus real temporary Git repositories for selective adoption, fresh bases and attempt isolation. `npm test` runs the unit suites. After building, `node tools/github-workflow-verify.mjs` exercises the browser workflow against an isolated daemon and Git fixture, including responsive layouts and draft preservation. Its GitHub transport is a fixture; real GitHub acceptance is performed separately during rollout.

Nibbi's own Build-local checks use typecheck and build under confinement. Its full daemon tests include tests of the confinement boundary itself and run on the CI host, alongside browser and fresh-install verification. The required GitHub workflow remains responsible for that complete suite.

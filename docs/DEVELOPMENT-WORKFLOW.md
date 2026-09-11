# Development workflow

Nibbi uses `mcshera/nibbi` on GitHub. Keep each Nibbi Build on its own `nibbi/fx-…` branch and open its pull request against `v2`.

## Work on a change

Inspect the Build's selected changes and local checks before pushing its branch. Create a draft pull request, then use **Update this build** for revisions that belong to the same change. Each revision keeps the Build branch and pull request; a replacement Build gets a new branch.

## Verify the current commit

Install the locked dependencies with `npm ci`, then run:

```sh
npm run typecheck
npm test
npm run build
CI=1 npm run verify
```

Nibbi's confined Build worker runs `npm run typecheck && npm run build` locally. The full test suite includes security fixtures that intentionally create protected files and start their own sandbox, so run that suite from a trusted development checkout or GitHub CI. The required GitHub job still runs the full commands above before merge.

GitHub's `verify` workflow reports the `local-platform` job for the current pull request commit. A green result for an older commit does not verify a later revision. The workflow runs for pushes, pull requests and merge groups.

## Merge and deliver

Merge the reviewed Build pull request into `v2`. Promotion from `v2` to `main` is a separate reviewed pull request covering the complete integration range.

A GitHub merge is distinct from deploying or installing the application. Retain branches and worktrees until their uncommitted and unpublished work has been inspected.

## Bring existing edits into a Build

Select the files to adopt, including any intended untracked files, and inspect that selection before creating the Build. Nibbi copies the selected changes into the Build worktree; the original checkout remains intact. If the source selection changes, review it again before proceeding. After a remote merge, update a local integration checkout only when it is clean and can safely fast-forward.

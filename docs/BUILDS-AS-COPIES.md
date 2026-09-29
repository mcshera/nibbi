# Builds as copies — phase 2

The spec three builders follow in parallel, and the integrator after them. It binds. It extends
[CONTROL-PANEL.md](CONTROL-PANEL.md) (phase 1, as built, §10 included): where the two disagree this one
wins; where this one is silent, phase 1 holds. Shapes, action names and words are in
`public/lib/control-panel-contract.js` (this commit); a builder who finds it wrong conforms to it and
says so in their commit.

```
branch      ui/builds-branches  (from ui/control-panel @ af616c8 = draft PR #24's head; this becomes #25 on #24)
worktree    /Users/Matty/Documents/Nibbi/.claude/worktrees/builds-branches
contract    public/lib/control-panel-contract.js   (PHASE 2: COPY, COPY_*, CARD_BADGE, the copy ACTIONS, WORDS.copy, typedefs)
sources     cp-lab design/sidebar-lab/{ROUND4,ROUND5}.md, options/tree-console.mjs (the copy's page), options/bar-cards-shell.mjs
            (the builds card), research/round4/data.md (checked against af616c8 — §9); ~/.claude/plans/control-panel-bar.md "Phase 2"
baseline    af616c8: typecheck clean · unit 306/306 (306/306 again with this contract) · daemon 328/328 · verify:all green · CI green on #24
```

The owner, verbatim: *"A build should be a literally clone of the application like main and dev, dev1,
ect like github branches."* · *"improvements should be part of builds. So a build would have
improvements inside of them."* He approved phase 1 (draft PR #24: the Cards bar and the Console pages,
main only) and asked for phase 2: real copies — dev, dev1…, + New build, improvements that land on a
copy, Play a copy, Ship to main, catch up and retire.

**Phase 2 in one line.** A copy is a real branch (`nibbi/copy/dev`) checked out in its own worktree
under the work dir, made from main's head; improvements aimed at it are built as today's runs and land
in it with `--ff-only` *inside its own worktree* once their checks pass on its tree; Ship to main sends
its head through the same verified merge into main, where main is checked out; catch up brings main's
newest into it the same way; retire takes it off the machine; one build plays at a time. Main's own path
is unchanged.

---

## 0. Rules every builder keeps

Everything in CONTROL-PANEL.md §0 still holds (tokens only, three motions, `--ease`, one ink key per
surface, words carry state, colour only on verdicts, 44px at coarse/narrow, focus rings, lowercase
spoken copy, `data-bar-build` / `data-bar-improvement` and never `data-build-id`, the pinned ids, the
`!important` budget, the commit form). Added for phase 2:

| rule | why |
|---|---|
| no new dependencies; node_modules are APFS clones — never `npm install` | the owner |
| every git operation in a test runs in a temporary repo under the OS temp dir (`mkdtempSync(tmpdir())`, `NIBBI_STATE_DIR/VAULT_DIR/WORK_DIR/PROJECTS_DIR` pointed inside it, as `daemon/test/lifecycle.test.ts:7-10`). Never `/Users/Matty/Documents/Nibbi`, another worktree, the live daemon, `~/.nibbi` or `~/NibbiWork` | the orchestrator |
| a copy's paths derive from `config.workDir` (never a hard-coded `~/NibbiWork/...`), so `NIBBI_WORK_DIR` isolates tests and the existing `within(config.workDir, …)` guards cover copies | §9.1 |
| nothing moves a branch from outside the worktree that has it checked out: no `update-ref`, `branch -f`, `checkout -B` or `reset` on a copy's branch or main, ever. A branch changes only by `merge --ff-only` run *in its own checkout* | data.md's probe: update-ref from elsewhere leaves that worktree stale |
| `tests/local-fallback-ui.test.mjs`' literal strings in app.js's send loop stay untouched: `send` (app.js:1591), its stream-event if / else-if chain and the literal `updateLocalReply(T, m); setSaid(T, m.text` the suite greps (tests/local-fallback-ui.test.mjs:67) | the suite |
| long commands (`npm test`, `npm run verify`, `verify:all`, webkit) run with `run_in_background` and are polled; `PATH="$HOME/.nibbi/bin:$PATH"` for daemon tests and browser tools, `CI=1` for browser tools; `npm run build` after touching `public/` or `daemon/` (the fixtures serve `dist/ui` and import `daemon/dist`) | the orchestrator |

---

## 1. Decisions

The four the orchestrator took (the owner can override; the PR says so):

| # | default | where it bites |
|---|---|---|
| D1 | An improvement on a copy counts as **done when that copy ships to main** — its issues.md checkbox, its roadmap task and its progress delivery happen at ship, not at landing | §2.4.6; fixer.ts:310-311, :353-354 gated |
| D2 | Copies are made **from main only** for now (no "copy of dev1") | §2.4.1; the form has no base picker |
| D3 | **One plays at a time**: playing a copy stops main's preview and every other copy's; playing main stops the copies' | §2.4.8; previews.ts:43-48 |
| D4 | In code the noun is **copy** (`copy.*` commands, `project-copies.ts`, `copyId`); on screen it is a **build**. No rename of today's run-as-"Build" words | §2.5 |

Taken here (also for the owner to override; the PR lists them):

| # | decision | why |
|---|---|---|
| D5 | **An improvement lands in its copy on its own once its checks pass** on the copy's tree — no review step inside a copy. Main's improvements keep phase 1's review (approve & merge, asked twice). The confirmed, reviewed step for a copy is **Ship to main** | ROUND4's states for an improvement in a build are up next / building / in / failed (no review); tree-console.mjs shows none; the orchestrator's check "+ improvement on dev → it lands in dev" has no ask while ship and retire do. Flip: drop the auto-land call in §2.4.4 and copy runs wait at *ready to review* like main's |
| D6 | A copy's branch is **`nibbi/copy/<name>`**; the UI says only the name | never collides with a `dev` the owner already has; Nibbi owns everything under `nibbi/`; publishing it later is one rule at github-builds.ts:313 |
| D7 | **After shipping, the copy stays**, level with main (0 ahead · 0 behind), and keeps taking improvements | the orchestrator's model; data.md's `'shipped'` status is dropped |
| D8 | **Ship requires the copy to be caught up** (0 behind). Main then fast-forwards to exactly the head you played | a ship with main moved on would make a merge commit nobody played; the lab's confirm says "catch up first" |
| D9 | While a copy **plays**: an improvement that passed **waits** and lands when it stops; **catch up asks** before stopping it; **retire** stops it (its confirm says so); **ship** doesn't touch the copy's worktree so it doesn't care | a copy's files never change under a running game without the owner saying so |
| D10 | **Retire removes the copy's worktree and its branch** (never forced); the record stays as a tombstone with `retiredHead`, so ship history and recovery survive | the orchestrator ("remove worktree and branch"); data.md kept the branch |
| D11 | At most **5 live copies per project** (`COPY.limit`) | each is a worktree plus its install; `~/NibbiWork/fixers` is already 127 worktrees / 22 GB (data.md §1) |
| D12 | A copy needs a **real project check** (fixer.ts:94's rule): without one, + New build opens in its *can't* state and says so | nothing can land in or ship from a copy without a check (fixer.ts:333) — it would be a dead end |
| D13 | **GitHub-mode projects: copies are local-only in phase 2** — + New build opens in its *can't* state with the reason (§2.7), the daemon refuses every copy command but retire; the GitHub promotion path is deferred (§8) | §2.7 |
| D14 | Play main still plays **the owner's checkout** (phase 1 §9.3). A detached worktree at main's head is deferred | not needed for one-at-a-time; it would add a worktree per project |
| D15 | Runs started by the lead (chat `dispatch_fixer`, session.ts:105-114), plan execution (plan-proposals.ts:92) and automation keep targeting main; **auto ship never ships a copy** and never lands a copy's runs a second way (scheduler.ts:70) | automation stays on what it knows; copies are the owner's |
| D16 | Commands take the copy's **id** (`copy-<uuid>`), never its name; the UI keys pages and rows by the **name** | a stale page can't ship a new "dev" made after the old one was retired |

---

## 2. Daemon

### 2.1 The record

Bucket **`project-copies`**, id **`copy-` + randomUUID()** (not `<project>:<branch>` — a name is reused
after retire, and runs point at the id). Shape: `CopyRecord` in the contract. In short:

| field | value |
|---|---|
| `id`, `project`, `name` | `name` matches `COPY.namePattern`, unique among the project's live copies |
| `branch` | `COPY.branchPrefix + name` → `nibbi/copy/dev` |
| `base`, `baseSha` | main's branch when it was made — `cfg.targetBranch ?? mergeTarget(cfg.repo)`, fixer.ts:179's local rule — and its head then |
| `worktree` | `join(config.workDir, 'copies', project, name)` — under the work dir, so `NIBBI_WORK_DIR` isolates it |
| `headSha` | the head nibbi last put there (made · landed · caught up); the read compares the branch and the worktree with it |
| `lastVerifiedSha`, `lastVerifiedAt` | the head whose tree last passed the project check (a landing or a catch-up); null for a fresh copy |
| `status` | `COPY_STATUS`: creating · ready · shipping · catching_up · retiring · broken · retired |
| `createdAt`, `updatedAt`, `lastLandedAt`, `playedAt`, `error` | `lastLandedAt` moves with every head change; `playedAt` with every `copy.play` |
| `ships[]`, `catchUps[]` | newest first, ≤ 20 each (`ShipRecord`, `CatchUpRecord`) |
| `intent` | a ship or catch-up between writing its intent and finishing its bookkeeping (§2.4.10) |
| `retiredAt`, `retiredHead` | the tombstone; ≤ 50 tombstones per project are kept, the oldest dropped |

A second bucket, **`issue-copies`**, id `<project>:<issueId>` → `{ copyId, at }`: an issue put "up next"
on a copy (§2.4.3). Fixer records gain three optional fields (fixer.ts:28-41):
`copyId?: string` · `landing?: { state: 'waiting' | 'failed', reason?: string, detail?: string, at: string }` ·
`shipped?: { at: string, sha: string, copyId: string }`.

### 2.2 Modules

| file | holds | imports |
|---|---|---|
| `daemon/src/copy-records.ts` (new, a leaf) | the types, `COPY_*` rules (name pattern, prefix, limit), `copyPath()`, `liveCopies(project)`, `copyById(id)`, `requireLiveCopy(project, id)`, `saveCopy(record)` (the only writer: `runtime().put('project-copies', id, rec, { type: 'copy.updated', projectId, payload: { copy: rec } })`), `issueCopy(project, issueId)` / `setIssueCopy(…)` | store, config, projects |
| `daemon/src/verified-merge.ts` (new, a leaf) | `verifiedFastForward(cfg, dest, source, hooks)` — the one verified-merge sequence §2.4.4 describes, used by `integrate()` (runs → main or a copy), `copy.ship` and `copy.catchUp` | processes, sandbox, config |
| `daemon/src/project-copies.ts` (new) | `copiesView`, `createCopy`, `shipCopy`, `catchUpCopy`, `retireCopy`, `playCopy`, `stopCopy`, `landWaiting`, `reconcileCopies`, `stopCopyWork` | copy-records, verified-merge, fixer, previews, projects, github-repositories, project-issues, roadmap |
| `daemon/src/fixer.ts` | `integrate()` gains a destination; `landOnCopy(runId)`; queueFix takes `copyId` | + copy-records, verified-merge (no import of project-copies: no cycle) |

The builder may fold `copy-records.ts` into `project-copies.ts` if no import cycle results; the exported
names above are what tests and api.ts use.

### 2.3 Names

`createCopy` refuses, before anything is written, with the same words as `WORDS.copy.*` as its message
(the daemon keeps its own copy of these strings; it never imports `public/`):
empty (`nameEmpty`); not `COPY.namePattern` (`nameShape`; the client lowercases and turns spaces into
dashes first); longer than 32 (`nameLong`); in `COPY.reserved` (`nameReserved`); a live copy already has
it (`nameTaken`); `COPY.limit` live copies (`tooMany`); `git check-ref-format --branch nibbi/copy/<name>`
fails; `refs/heads/nibbi/copy/<name>` already exists ("a branch called nibbi/copy/dev is already in the
repository"); the worktree path exists. All checked **inside** `withRepoLock(cfg.repo)`, so two creates
of one name can't both pass.

### 2.4 Operations — the git and store steps, and what a failure leaves

Every operation that touches git holds `withRepoLock(cfg.repo)` (processes.ts:54-60) for its git part,
as executeFixer's worktree creation (fixer.ts:216-229) and integrate (:330) do; long installs of a new
copy run outside it (as executeFixer's install does, fixer.ts:230).

#### 2.4.1 Create — `copy.create { name }`

1. `cfg = games()[project]`; refuse GitHub mode (`connectionFor(project)?.workflowMode === 'github'` →
   `githubMode`) and a check that isn't real (`noCheck`).
2. Lock. The §2.3 name checks. `base = cfg.targetBranch ?? mergeTarget(cfg.repo)`; `baseSha = git rev-parse --verify base^{commit}`.
3. Write the record with `status: 'creating'`, `headSha = baseSha` (`copy.updated`).
4. `mkdir -p dirname(worktree)`; **`git -C cfg.repo worktree add -b nibbi/copy/<name> <worktree> <baseSha>`** —
   one command makes the branch and checks it out in the new worktree, and nowhere else.
   Failure → delete the record (and the branch if it exists and still points at `baseSha`), emit
   `copy.updated` with `{ copy, removed: true }`, refuse with git's first line. Unlock.
5. Return the `CopyView` now (the bar shows "making the copy", pulsing).
6. In the background (tracked, abortable by `stopCopyWork`): `cfg.install` (unless `'true'`) through
   `sandboxCommand(worktree, cfg.install, { domains: cfg.installDomains ?? ['registry.npmjs.org'], readableRoots: [cfg.repo] })`;
   then `git -C worktree status --porcelain` must be empty (an install that dirties tracked files would
   ship them). Pass → `status: 'ready'`. Fail or abort → `status: 'broken'`, `error` = the first line;
   only retire works on it.

Main and `cfg.repo` are read, never written.

#### 2.4.2 The read — `GET /api/project-copies?project=` → `CopiesRead`

`copiesView(project)` (async; api.ts GET switch, beside `/api/project-section` at :159). Unknown
project → 404; `vault` → 400. For each live copy, in `cfg.repo`:

- `ahead`/`behind`: **`git rev-list --left-right --count <base>...<branch>`** (right = ahead, left = behind);
- health: worktree missing → `missing`; `git -C worktree symbolic-ref --quiet --short HEAD` ≠ branch, or
  the branch or `rev-parse HEAD` ≠ `headSha` → `moved`; `status --porcelain` non-empty → `dirty`
  (`dirtyFiles`, ≤ 5 paths); else `ok`;
- `play`: `previewStatus('copy:<project>:<id>')` + playable: `cfg.play` a URL → `{ kind: 'url', playable: false }`;
  a command → `{ kind: 'server', playable: true }`; else `previewCommand(worktree)` (previews.ts:11-15) decides.

Plus `mode`, `disabled` (`'github'` · `'no_check'` · `''`), `limit`, `main: { branch: base-or-current, sha }`,
`retired` (≤ 20 tombstones, newest first) and `ships` (every ShipRecord of live and retired copies,
newest first, ≤ 20, with `copyId` and `name`). **Improvements per copy and the state words are not in
the read**: every run already reaches the client live in `S.fixers` with its `copyId`, so the model
groups them (§4.2) and says the words from `WORDS` — one source for both. The read is git facts only.

#### 2.4.3 Runs that target a copy

| where | change |
|---|---|
| `run.dispatch` / `run.queue` zod (command-service.ts:33) | `+ copyId: z.string().regex(/^copy-[0-9a-f-]{36}$/).optional()` |
| `FixerOpts` (fixer.ts:42) | `+ copyId?: string` |
| `replacementOptions` (fixer.ts:96-99) | carries `copyId`, so Try again (`requeueFix` :292-296, `redispatchFixer` :297-302) stays on the copy |
| `queueFix` (fixer.ts:160-183, synchronous) | after :162: `const copy = opts.copyId ? requireLiveCopy(game, opts.copyId) : undefined` — from the record alone: refuses a GitHub-mode project, a copy that is gone ("dev was retired — start it on main") or not `ready` (`notReady`); git health is checked when the run starts (next row); :175 `copyId: copy?.id`; **:179 `targetBranch: copy ? copy.branch : <today's expression>`** |
| executeFixer (fixer.ts:226) | unchanged — `rev-parse <targetBranch>^{commit}` in `cfg.repo` reads the copy's branch (refs are shared). For a copy run, also require that sha === the copy's `headSha`, else fail the run: "dev changed outside nibbi" |
| `issue.create` (project-workspace.ts:16 `.strict()` schema, :157-160) | schema `+ copyId` (same regex, optional); after the write, `setIssueCopy(project, itemId, copyId)` when given |
| issues read (project-workspace.ts:62-65 `view`) | each issue item `+ copyId: string \| null` — the stored one, only while that copy is live |
| `issue.build` (project-workspace.ts:185-196) | `copyId = input.copyId ?? the item's live stored copy`; :194's args gain `copyId` **only when set** (a spread), so project-workspace.test.ts:112's dispatch stays as it is |
| duplicate guards (fixer.ts:170, :172; project-workspace.ts:190) | unchanged: an issue has one live try anywhere, whichever build |
| `allowedRunActions` (fixer.ts:156) | `run.merge` also needs `!f.copyId` — a copy's run lands on its own (D5). `run.merge` sent anyway still goes through `integrate()` and lands it in its copy (the same guarded path) |
| lead / plans / automation | unchanged (D15): `session.ts:112`, `plan-proposals.ts:92`, `build-attempts.ts:190` pass no `copyId` |

#### 2.4.4 Landing an improvement — `integrate()` with a destination

`integrate(input)` (fixer.ts:327-360) keeps its guards :328 (GitHub), :332 (busy), :333 (unverified),
:334 (gone) and :338 (the run's worktree unchanged since verification). Then it picks a **destination**:

- **main** (no `copyId`): `{ checkout: cfg.repo, branch: f.targetBranch, retainOnFailure: true }` —
  exactly today's :337 guard, :339-351 sequence and :352-356 bookkeeping.
- **a copy**: `copy = copyById(f.copyId)` must be live and `ready` (else `busy`); `f.targetBranch === copy.branch`
  (else `changed`); the copy's preview `copy:<project>:<id>` not running (else the new reason
  **`'waiting'`**, IntegrateResult at fixer.ts:326); `{ checkout: copy.worktree, branch: copy.branch, expectHead: copy.headSha, retainOnFailure: false }`.

Then **`verifiedFastForward(cfg, dest, f.commitSha, hooks)`** (verified-merge.ts), the sequence today's
integrate runs, lifted out whole:

1. `git -C dest.checkout symbolic-ref --quiet --short HEAD` === `dest.branch` and `status --porcelain`
   empty, else `changed` — "Target branch changed or has local edits" (today's :337 words, for main).
2. `targetSha = git -C cfg.repo rev-parse <branch>`; `expectHead` given and ≠ → `changed`.
3. `integration = join(config.workDir, 'merge-' + randomUUID())`; `git -C cfg.repo worktree add --detach <integration> <targetSha>` (:340-341).
4. `git -C integration merge --no-edit <source>` (:342). Conflict → `conflicts = git diff --name-only --diff-filter=U`;
   `retainOnFailure` → keep it (today: "Target unchanged. Integration worktree retained: …"), else
   `merge --abort` and remove it. → `conflict`.
5. install (unless `'true'`) and `cfg.check` through `sandboxCommand` in the integration worktree (:344-346) → `checkfail`.
6. `candidate = rev-parse HEAD`; the integration worktree must be clean (:347-348) → `changed`.
7. Re-guard (:349): step 1 again, and `git -C dest.checkout rev-parse HEAD` === `targetSha` → `changed`
   "Target changed during verification; no merge performed".
8. `hooks.onIntent({ candidate, targetSha, integration })` — for a run, `f.mergeIntent` (:350).
9. **`git -C dest.checkout merge --ff-only <candidate>`** (:351, with `cfg.repo` replaced by `dest.checkout`).
10. remove the integration worktree (:356). On every failure before 9 with `retainOnFailure: false`,
    remove it too — `worktree remove --force` is allowed **only** on a `merge-<uuid>` worktree the call
    itself made (today integrate leaks one per failed merge — §9.6).

After an ok landing:
- main: :352-354 as today (merged, `completeTask`, `completeLinkedIssues`, `noteDelivery`).
- a copy: `f.status = 'merged'`, `f.endedAt`, `f.landing = undefined`, save — **no** completion, **no**
  delivery (D1). The copy: `headSha = lastVerifiedSha = candidate`, `lastVerifiedAt = lastLandedAt = now`,
  `saveCopy`. If `git diff --name-only <old> <candidate>` touches `package.json`, `package-lock.json`,
  `npm-shrinkwrap.json`, `yarn.lock` or `pnpm-lock.yaml`, run `cfg.install` in the copy's worktree
  (sandboxed); a failure is recorded (`copy.error`, the page says it) and never undoes the landing.

**Auto-land.** `landOnCopy(runId)` (fixer.ts, exported): a staged run with `copyId` and
`verification.status === 'passed'` → `integrate(f)`. Ok → done. `'waiting'` → `f.landing = { state: 'waiting', at, detail }`,
stays `staged`. `'busy'` → the same, with `reason: 'busy'` (ship, catch-up and `copy.stop` call `landWaiting` when they finish). Anything else → **the run fails**:
`status: 'failed'`, `summary: 'It didn’t land in dev: <detail>'`, `landing: { state: 'failed', reason, detail, at }`,
`endedAt`; the copy is unchanged; Try again starts a new run on the copy's new head. Called from:
- drainQueues (fixer.ts:196): `control.done = executeFixer(…).finally(() => live.delete(f.id)).then(() => landOnCopy(f.id).catch(() => undefined))`
  (so `waitForFixer` in tests waits for the landing too);
- runBuildAttempt (fixer.ts:129-144): after :143's `await control.done`, when it ended staged;
- `landWaiting(project, copyId?)` (project-copies.ts): every staged run of that copy with
  `landing.state === 'waiting'` — from `stopCopy`, the copy preview's `onEnd`, and `reconcileCopies`.

#### 2.4.5 Ship to main — `copy.ship { id, expectedHead }`

Lock. Refusals leave main and the copy exactly as they were:

1. GitHub mode; `!hasCheck(cfg.check)`; copy not live or not `ready`; health not `ok`; `expectedHead ≠ headSha` (`headMoved` — the confirm listed another head).
2. **Behind**: `git merge-base --is-ancestor <base> <headSha>` fails → `shipBehind` (D8).
3. **Nothing**: `git rev-list --count <base>..<headSha>` === 0 → `shipNothing`.
4. `status: 'shipping'`, save.
5. `verifiedFastForward(cfg, { checkout: cfg.repo, branch: copy.base, retainOnFailure: false }, copy.headSha, { onIntent: i => copy.intent = { kind: 'ship', ...i, at } + save })`.
   Step 1 of it is today's main guard — **main must be checked out in `cfg.repo`, on `base`, clean**
   (`shipCheckoutOther` / `shipCheckoutDirty` in words). Because the copy is 0 behind, the merge in the
   verification worktree is a fast-forward and `candidate === copy.headSha`; anything else → `changed`.
   The checks run again on that tree (install + check), and **`git -C cfg.repo merge --ff-only <candidate>`**
   moves main.
6. Refused → `status: 'ready'`, `intent: null`, save; return the words (for a conflict or checkfail, the
   first line of the detail).
7. Ok → `finishShip(copy, candidate, targetSha)`: every run with this `copyId`, `status === 'merged'`,
   no `shipped`, and `git merge-base --is-ancestor <commitSha> <candidate>` → `shipped = { at, sha: candidate, copyId }`,
   `saveFixer` (run.updated), then `completeTask(game, taskId)`, `completeLinkedIssues(game, issueIds)`
   (try/catch → `roadmap.update_failed`, as :353) and `noteDelivery(f)` (exported from fixer.ts:323).
   `copy.ships.unshift({ id: 'ship-' + uuid, at, sha: candidate, mainBefore: targetSha, runIds })` (≤ 20),
   `intent: null`, `status: 'ready'`, save. **The copy stays**, level with main (D7).

Returns `{ copy: CopyView, shippedSha, runIds }`. Never automatic: nothing but this command ships.

#### 2.4.6 Issue completion

A copy's improvement is done when its copy ships (D1). The two completion sites in fixer.ts both skip
a run with `copyId`: :353 (the merge) and **:310 (crash recovery)**, and so do their `noteDelivery`
calls (:354, :311). `finishShip` completes them. A copy retired before it ships completes nothing; its
issues stay open and fall back to main (§4.2).

#### 2.4.7 Catch up — `copy.catchUp { id, expectedHead, stopPlay? }`

Lock. 1) GitHub mode; copy not live/`ready`; health not `ok`; `expectedHead ≠ headSha`. 2) `behind`
(`rev-list --count <headSha>..<base>`) === 0 → `catchUpLevel`. 3) Playing and not `stopPlay` → refuse
(code words: "dev is playing — stop it first"); with `stopPlay`, `stopAndWait('copy:<p>:<id>')`.
4) `status: 'catching_up'`. 5) `mainSha = rev-parse <base>`;
`verifiedFastForward(cfg, { checkout: copy.worktree, branch: copy.branch, expectHead: copy.headSha, retainOnFailure: false }, mainSha, { onIntent: kind 'catchUp' })` —
main merged into the copy in a `merge-<uuid>` verification worktree at the copy's head, checked, then
**`git -C copy.worktree merge --ff-only <candidate>`**. 6) Refused → `status: 'ready'`,
`catchUps.unshift({ ok: false, mainSha, from: headSha, to: null, reason, detail, conflicts })`; the
copy and main are unchanged and the words say which files (`catchUpConflict`) or that the checks failed
(`catchUpCheckfail`). 7) Ok → `headSha = lastVerifiedSha = candidate`, `lastLandedAt = now`,
`catchUps.unshift({ ok: true, … to: candidate })`, `status: 'ready'`, the install rule of §2.4.4, then
`landWaiting` (anything that waited for play). Main is only read.

#### 2.4.8 Play — `copy.play { id }` / `copy.stop { id }`

previews.ts gains: `previewCommand(cwd)` (export of :11-15); `start(id, cwd, cmd, { onEnd })` (a
per-id done promise; `onEnd` runs in :25-27's finally); `stopAndWait(id, ms = 10_000)`; `playStart`
(:43-48) becomes async and first `stopAndWait`s every owned id starting `copy:<project>:`.

`playCopy`: copy live and `ready`, not GitHub mode; command = `cfg.play` when it is a command (not a
URL) run in the copy's worktree, else `previewCommand(copy.worktree)`; `cfg.play` a URL → refuse
(`fixedAddress`); none → refuse (`nothingToPlay`). Then `stopAndWait('project:<project>')` and every
other `copy:<project>:*` (D3); `start('copy:<project>:<id>', copy.worktree, cmd, { onEnd: () => void landWaiting(project, id) })`;
`playedAt = now`, save. Returns `{ url?, starting }`; the client polls `GET /api/preview?id=copy:<p>:<id>`
(api.ts:186 already serves any id). `stopCopy`: `stopAndWait`, then `landWaiting`.

#### 2.4.9 Retire — `copy.retire { id, expectedHead }`

The confirm is the owner's (the page asks); the daemon demands the head that confirm showed. Lock.
1) Copy live, status `ready` or `broken` (else `notReady`). 2) **Refuse while any run with this `copyId`
is live, active (`installing` · `running` · `verifying` · `awaiting_input`) or `queued`** (`retireBuilding`).
3) `expectedHead ≠ headSha` → `headMoved` (a `broken` copy's head is `baseSha`). 4) `status: 'retiring'`, save.
5) `stopAndWait` its preview. 6) If the worktree exists: `status --porcelain` must be empty, else back to
`ready` and refuse with ≤ 5 paths (`retireDirty`) — **never `--force`**; `git worktree list --porcelain`
must show the branch checked out at this worktree only; `git -C cfg.repo worktree remove <worktree>`.
7) If the branch exists and no worktree has it checked out: `git -C cfg.repo branch -D <branch>`. 8) The
record becomes a tombstone: `status: 'retired'`, `retiredAt`, `retiredHead = headSha`, save. Main,
`cfg.repo`, other copies, and every run's `nibbi/fx-*` worktree and branch (which still hold the landed
commits) are untouched. Staged runs of the copy stay as they are (the model settles them).

#### 2.4.10 Crash recovery — `reconcileCopies()` (main.ts:43, after `reconcileFixers()`)

- `creating` → `broken`, error "the backend stopped while it was being made".
- `shipping` with `intent.kind === 'ship'`: candidate an ancestor of `base` → `finishShip` (idempotent:
  runs already `shipped` are skipped; `recordDelivery` is exactly-once per run, progress.ts:46-47);
  else drop the intent. → `ready`.
- `catching_up` with an intent: the branch at (or past) the candidate → `headSha = candidate` and the
  catch-up is recorded; else drop it. → `ready`.
- `retiring` → finish the removal if the worktree is already gone, else back to `ready`.
- A landing interrupted after its fast-forward: reconcileFixers (fixer.ts:306-316) marks the run merged
  as today (its `mergeIntent.candidate` is an ancestor of the copy's branch) — with :310-311 gated — and
  reconcileCopies sets the copy's `headSha` to the branch head when that head is such a candidate.
- Then `landWaiting` for every copy.

`stopCopyWork()` (main.ts:86's shutdown list) aborts a copy's background install; its record becomes `broken`.

### 2.5 Commands — command-service.ts

New cases **before** `default:` (:86, which sends every unknown name to `executeGithubCommand` — the
`build.*` GitHub router, github-builds.ts:39-41). Ids are checked with `COPY.idPattern`; the project with
`projectId()` (:21).

| command | args | data | notes |
|---|---|---|---|
| `copy.create` | `{ name }` | `CopyView` | §2.4.1 |
| `copy.ship` | `{ id, expectedHead }` | `{ copy, shippedSha, runIds }` | §2.4.5 |
| `copy.catchUp` | `{ id, expectedHead, stopPlay?: boolean }` | `{ copy }` | §2.4.7 |
| `copy.retire` | `{ id, expectedHead }` | `{ copy: RetiredCopy }` | §2.4.9 |
| `copy.play` | `{ id }` | `{ url?, starting }` | §2.4.8 |
| `copy.stop` | `{ id }` | message | §2.4.8 |
| `run.dispatch`, `run.queue` | `+ copyId?` | as today | §2.4.3 |
| `play.start` (:84) | — | as today | `await playStart(…)` (it stops copies first) |

`/api/commands` (api.ts:61-64) needs no owner-only rule for `copy.*` (as `run.merge`/`run.discard`).
Neither the lead's tools nor MCP expose them.

### 2.6 Events

Every `saveCopy` emits **`copy.updated`** `{ copy: CopyRecord }` (projectId = the project; a rolled-back
create adds `removed: true`). Runs keep emitting `run.updated` (a landing, a failed landing, a waiting
landing, a ship's `shipped`). The client refreshes on both (§6.1); a commit the owner makes on main outside
Nibbi emits nothing, so "main moved on" shows on the next read (a project select, a page open, any run
event, the 60s page tick) — accepted.

### 2.7 GitHub-mode projects

Copies are local-only in phase 2. The daemon refuses `copy.create`/`ship`/`catchUp`/`play` and
`run.dispatch`/`issue.build` with a `copyId` in a project whose connection is `workflowMode: 'github'`
(`copy.retire` still works, to clean up copies made before connecting). The read says `mode: 'github'`,
`disabled: 'github'`. **The UI shows copies disabled with the reason, where you reach for them**: the
builds card's `+` is drawn (its `title` says `WORDS.copy.githubMode`, "copies are local for now — nibbi
ships through GitHub pull requests"); pressing it opens the build form in its *can't* state — the note
says those words, the name field and **make it** are disabled, × closes it. Nothing sits in the bar
permanently (a line under every GitHub project's builds header would be noise). Main's page's
"copies of main" says the same words in place of its empty line; a copy made before the project
connected is listed with every key disabled with those words, except retire. The same *can't* form
serves a project with no real check (`noCheck`), the fifth copy (`tooMany`) and demo (`demoChange`).

Deferred (§8): per-run `binding.baseBranch` (github-builds.ts:54, :299), a promotion per copy
(:357-364, one open per branch pair :361), publishing `nibbi/copy/*` (lift the `nibbi/` refusal at :313
for copy branches).

### 2.8 Every hook into existing code

| file:line | today | phase 2 |
|---|---|---|
| fixer.ts:28-41 `Fixer` | — | `+ copyId?`, `landing?`, `shipped?` |
| fixer.ts:42 `FixerOpts` | no target | `+ copyId?` |
| fixer.ts:96-99 `replacementOptions` | copies opts | `+ copyId` |
| fixer.ts:129-144 `runBuildAttempt` | staged at :139 | after :143, `await landOnCopy(id)` when it ended staged |
| fixer.ts:156 `run.merge` gate | local, staged, passed… | `&& !f.copyId` |
| fixer.ts:160-183 `queueFix` | :179 computes the target | copy resolved after :162; `copyId` at :175; :179 `copy ? copy.branch : …` |
| fixer.ts:196 drainQueues | `.finally(live.delete)` | `.then(() => landOnCopy(f.id))` |
| fixer.ts:226 base | `rev-parse <target>^{commit}` | + a copy run's sha must equal the copy's `headSha` |
| fixer.ts:303-318 `reconcileFixers` | :310-311 complete + deliver | skipped for `copyId` runs |
| fixer.ts:322-325 `noteDelivery` | private | exported |
| fixer.ts:326 `IntegrateResult` | 6 reasons | `+ 'waiting'` |
| fixer.ts:327-360 `integrate` | main only | destination + `verifiedFastForward` (§2.4.4); main's behaviour identical |
| command-service.ts:6, :32-36, :84, :86 | — | imports; `copyId`; `await playStart`; the `copy.*` cases |
| previews.ts:11-15, :16-30, :31, :43-48 | — | `previewCommand` export; `onEnd` + done map; `stopAndWait`; async `playStart` that stops copies |
| project-workspace.ts:16, :62-65, :157-160, :185-196 | — | `copyId` in the schema; items' `copyId`; `setIssueCopy`; `issue.build`'s copy |
| scheduler.ts:70 | `for (const run of stagedFor(project))` | `stagedFor(project).filter(run => !run.copyId)` (D15) |
| api.ts:33, :154-205 | — | import; `case '/api/project-copies': json(res, 200, await copiesView(q.get('project') ?? ''))` |
| main.ts:43, :86 | — | `await reconcileCopies()`; `stopCopyWork()` |
| read-models.ts:20 `snapshot` | spreads each run | unchanged: `S.fixers` gets `copyId`, `landing`, `shipped` for free |
| project-issues.ts:24-37, progress.ts:44 | called at merge | called at ship for copy runs; unchanged code |
| github-builds.ts | — | untouched (copy.* never reach it) |
| store.ts, config.ts, projects.ts | — | untouched (buckets are free-form; paths derive from `config.workDir`; `mergeTarget` reused) |

---

## 3. Invariants — each with the daemon test that proves it

All in **`daemon/test/project-copies.test.ts`** (new), in the pattern of lifecycle.test.ts: a temp
dir for state/vault/work/projects, `createProject` (git init -b main), a deterministic provider via
`replaceProviderForTest` that writes a file named by the prompt (so tests can make two improvements
collide), a real check (`test -f <file>` style, run through `sandboxCommand`), and `cfg.play` set to a
long-running command that prints a `http://127.0.0.1:<port>` line where play matters. Every assertion
about "unchanged" compares `git rev-parse` of main and the copy's branch, `git -C <checkout> rev-parse HEAD`
and `status --porcelain`, before and after.

| # | invariant | test |
|---|---|---|
| 1 | **Main changes only through the verified path**: a ship re-runs install + check on the candidate in a `merge-<uuid>` worktree and moves main only by `merge --ff-only` in `cfg.repo` | `ship runs the checks again and fast-forwards main where it is checked out` — a check that fails only on the copy's head makes ship refuse `checkfail`, main and copy unchanged, no `merge-*` left; with a passing check main === the copy's head |
| 2 | Ship **refuses** when main's checkout is dirty or on another branch, when main moved on, or when the copy's head moved since the confirm (`expectedHead`), is dirty, or moved outside nibbi — changing nothing | `ship refuses and changes nothing` — five cases |
| 3 | After a ship **the copy stays**, level with main: record `ready`, `ahead 0 · behind 0`, its worktree HEAD = branch = `headSha` = main | `ship leaves the copy level with main` |
| 4 | An improvement on a copy **lands only inside the copy's worktree**, `--ff-only`, after its merged tree passes; main's ref, `cfg.repo`'s HEAD and working tree are untouched; the copy's worktree is clean at the new head (no stale worktree: the file is there, `status --porcelain` empty) | `an improvement lands in its copy, and main is untouched` |
| 5 | **A failed improvement leaves the copy unchanged** (and main): the agent fails, its own check fails, the merged tree fails the check, or it conflicts with one that landed first | `a failed improvement leaves the copy and main unchanged` — four cases; the conflict one runs two improvements editing one file |
| 6 | **Nothing moves a branch from outside** its checkout | `nothing moves a branch from outside its worktree` — a scan of copy-records.ts, verified-merge.ts and project-copies.ts finds no `update-ref`, `'branch', '-f'`, `'-B'`, `'reset'`, `'checkout'`, and `--force` only in the one merge-worktree removal; plus #4's clean-worktree check |
| 7 | **Catch up** merges main into the copy in a verification worktree and fast-forwards the copy's own worktree; main is only read | `catch up brings main's newest into the copy` |
| 8 | **A failed catch-up leaves main and the copy unchanged** and says why (a conflict names its files; a failed check says so) | `a catch-up conflict or failed check changes nothing and says which files` |
| 9 | **Retire refuses while an improvement is running or queued on the copy** | `retire refuses while an improvement is building or queued` — a held provider |
| 10 | **Retire needs the head its confirm saw, and removes only the copy's own worktree and branch** — main, `cfg.repo`, another copy, and run worktrees/branches untouched; the record is a tombstone | `retire removes only its own worktree and branch` |
| 11 | **Retire never forces**: a copy with files nibbi didn't make is refused, nothing removed | `retire leaves a copy with files nibbi didn't make` |
| 12 | **Issue completion waits for ship**: an issue whose run lands in a copy stays open, with no progress delivery; the ship marks it done and records one delivery per run; a second reconcile adds none | covered by #4 and #3's tests, plus `a recovered ship completes once` |
| 13 | **One plays at a time**: `copy.play` stops main's preview and other copies'; `play.start` stops copies' | `one plays at a time` |
| 14 | **A landing waits while its copy plays** and lands when it stops (copy.stop or the preview ending) | `a landing waits for play, then lands` |
| 15 | **Names are refused before anything is written**; a copy is made at main's head on `nibbi/copy/<name>`, checked out only in its own worktree under `NIBBI_WORK_DIR` | `names are refused before anything is written` · `a copy is made at main's head on its own branch` |
| 16 | **GitHub-mode projects keep copies local-only**: create/ship/catch-up/play and a `copyId` dispatch are refused, nothing written | `GitHub-mode projects refuse copies` (a `github-connections` record put in the temp store) |
| 17 | **copy.* never reach the GitHub router**; `build.*` still do | `copy commands route away from build.*` — `executeCommand` with `copy.create` returns the view; `build.cleanup` still answers from github-builds |
| 18 | **Try again stays on its copy**; a retired copy's run can't be retried onto it | `a retry stays on its copy` |
| 19 | **Crash recovery**: a ship whose fast-forward landed completes once; an interrupted landing updates the copy's head and completes nothing | `a recovered ship completes once` · `a recovered landing moves the copy's head` |
| 20 | **Main's path is unchanged**: a main run's merge, its issue completion and its retained worktree on failure behave as before | daemon/test/lifecycle.test.ts, project-workspace.test.ts, build-attempts.test.ts, steer.test.ts pass **unedited**; plus `a main run merges into main while a copy exists` |
| 21 | **Auto ship never ships a copy** nor lands a copy's run | `auto ship leaves copies alone` (schedulerCycle with mode ship, as auto.test.ts drives it) |
| 22 | **The read tells the truth**: ahead/behind by rev-list, health moved/dirty/missing | `the read says ahead, behind and health` |
| 23 | **Retire never drops a commit nibbi didn't make**: a copy whose branch or folder moved outside nibbi is refused, nothing removed; an owner's commit kept on a branch of theirs outlives the retire | `retire keeps commits nibbi didn't make` |

---

## 4. Client

### 4.1 Inputs

`CpInput` gains `copies: CopiesRead | null` (the integrator reads it beside the builds and issues
sections) and `project.dirty` (already on `/api/projects`, read-models.ts:24). Runs in `S.fixers`
carry `copyId`, `landing`, `shipped`; issue items carry `copyId`.

### 4.2 The model — `public/lib/builds-model.js`

Keep every phase-1 export and behaviour (the unit suite's 306 must pass as they are). Add:

```js
export function buildsCard(input /* CpInput */) /* → BuildsCardVM: { builds: [main, ...copies], badge, attention, newCopy } */
export function buildOf(input, name /* 'main' | a copy's name */) /* → BuildVM | null (null: that copy is gone) */
export function nextCopyName(taken /* string[] */) /* → 'dev', then 'dev1', 'dev2' … the first free */
export function copyNameProblem(name, taken) /* → '' or WORDS.copy.name* / tooMany words */
export function normalizeCopyName(text) /* → trimmed, lowercased, spaces and underscores to '-' */
```

`buildMain(input)` stays main's BuildVM and now counts only main's improvements; `ticketOf(input, id)`
resolves the ticket's build.

**Which build an improvement lives in** (ImprovementVM.build):

| its latest try (the record's basis, else latest) | build | state |
|---|---|---|
| no `copyId` | main | phase 1 |
| `copyId`, `shipped` set | main | `in`, `when = { verb: 'shipped', at: shipped.at }`, context `shippedContext` |
| `copyId` of a live copy | that copy | staged → `landing`, or `waiting_to_land` when `landing.state === 'waiting'` (COPY_RUN_STATES); merged → `in` (verb 'landed'); the rest as phase 1 |
| `copyId` not live, not shipped (retired) | main | `discarded`, settled, context `retiredBefore` — an issue then goes back to up next (phase 1's rule) |
| `copyId` and `copies` still null (not read yet) | **held**: drawn nowhere, counted nowhere, until the read lands | — |
| no try at all (an up-next issue) | the item's `copyId` when that copy is live, else main | up next |

Main's `branch` inference (builds-model.js:209-210, "the newest run's targetBranch") **must skip runs
with a `copyId`** — otherwise the first copy run renames main's branch to `nibbi/copy/dev` (§9.3).

**A copy's BuildVM** (every field in the contract's BuildVM): `id = name = copy.name`, `kind 'copy'`,
`copyId`, `branch`, `line = WORDS.copy.line`, `note` = `line` or `lineAhead` when `ahead > 0`, `count` =
`"{in} in"`, `"{failed} failed"`, `"playing"` joined by " · ", `copyLine` = `copyLine` filled,
`ahead`/`behind` from the read, `head` (7), `status`, `health` + `healthWords`, `verified` (when
`lastVerifiedSha === headSha`), `checks` = `[{ name: check command, ok: verified ? true : null, note: 'verified <ago> on <sha>' | 'not run on dev yet' }]`,
`madeAt`, `madeFrom`, `badge` (BADGE over its improvements), `counts` (phase 1's keys; `building` counts
the whole building group), `play`, `check`, `github`, `improvements`/`settled` (GROUPS order and
PAGE_LIMITS as main), `list`, `blocked`, `ship`, `catchUp`, `retire`, `history`, `copies: []`.

**Its headline** (`state`/`word`/`tone`/`live`): the first of COPY_STATES that holds —
`making` (status creating) · `broken` · `retiring` · `shipping` · `catching_up` · `missing` · `changed`
(health moved or dirty) · `building` (its building group > 0; `{n}` = that count) · `behind` (behind > 0) ·
`waiting` (its waiting group > 0; the word is its BADGE text) · `ready_to_ship` / `ready_to_play` (in > 0:
`playedAt ≥ lastLandedAt` → ship, else play — never a gate, only the word) · `up_next` · `nothing`.
`detail` joins what the headline didn't say (`2 in`, `1 failed`, `1 up next`, `behind main`).

**Blocked words** (first that applies):

| key | order |
|---|---|
| start (+ improvement → start now) | demo `demoStart` · busy `busy` · `disabled === 'github'` `githubMode` · status ≠ ready `notReady` · health ≠ ok `healthWords` |
| queue (up next) | demo `demoChange` · github · status · health · list not ready `noList` |
| play | demo `demoPlay` · github · status · health · `play.kind === 'url'` `fixedAddress` · not playable `nothingToPlay` |
| ship (ShipVM.why) | demo `demoChange` · github `githubMode` · no check `noCheck` · status `notReady` · health · in = 0 `shipNothing` · behind > 0 `shipBehind` · `project.branch ≠ copy.base` `shipCheckoutOther` · `project.dirty > 0` `shipCheckoutDirty` |
| catch up | demo · github · status · health · behind = 0 `catchUpLevel` |
| retire | demo · status creating/shipping/catching_up/retiring `notReady` · a building-group try or a queued run on it `retireBuilding` |

**ShipVM**: `ready` = no why; `ships` = its `in` improvements, `stays` = its other non-settled ones;
`lead` = `shipLeadOne`/`shipLeadMany` (or the why); `checks`; `checksLine` = `shipChecks` with the check
command; `facts` = [`shipPlayed` with ago, or `shipNotPlayed`] and [`shipLevel` when behind = 0];
`yes` = `shipYesOne`/`shipYesMany`, `no` = `shipNo`; `payload = { copyId, expectedHead: headSha }` (the
full sha). **CatchUpVM**: `needed = behind > 0`; `confirm` only while it plays (`catchUpPlaying`,
`catchUpYes`, `catchUpNo`, armed false); `payload = { copyId, expectedHead, stopPlay: play.running }`;
`last` from `catchUps[0]` in words. **RetireVM**: `note = retireNote`; `confirm = { words: retireConfirm
(+ retireUnshippedOne/Many when in > 0) (+ retirePlaying while playing), yes: retireYes, no: retireNo, armed: true }`;
`unshipped = in`; `payload = { copyId, expectedHead }`. **HistoryVM** (newest first, ≤ 30): made
(`made` with baseSha7) · each try started (active while live) / landed (pass) / failed (error, its reason)
· each ship (`shipped`) · each catch-up (`caughtUp` / `catchUpFailed`).

**The copy's PlayVM**: from the read's `play`; `blocked` above; `note = playNote` (name, head7);
`stops` = 'main' when main's play is a running `server`, else the name of another playing copy, else
''; `kind`, `playedAt`. **Main's PlayVM** gains `stops` = the playing copy's name.

**Main's BuildVM** gains `kind: 'main'`, `copyId: null`, `state: 'live'`, `tone: 'quiet'`, `live: false`,
`note` (its line without the leading `live · `), `count` ('playing' while it plays), `copyLine = line`,
`ahead/behind: null`, `head: ''`, `status: 'live'`, `health: 'ok'`, `healthWords: ''`, `verified: null`,
`checks: []`, `madeAt/madeFrom: null`, `ship/catchUp/retire: null`, `blocked.ship = WORDS.copy.mainShips`,
`blocked.catchUp/retire: ''`, `history` (landed in main + one `shipped` row per `CopiesRead.ships`
entry, "{name} shipped {n}"), `copies` (CopySummaryVM per live copy).

**The card**: `badge` by CARD_BADGE across every build (improvement rows count ImprovementVMs by state,
copy rows count copies by headline; `{name}` for one); `attention` = the badge when its tone is in
ATTENTION_TONES, else its building words, else ''; `newCopy` = `{ blocked, why, suggested: nextCopyName(taken), taken, limit }` —
`blocked` (the form's *can't* state and the `+`'s title): demo `demoChange` · `disabled` github / no_check
words · `tooMany` · copies unread `reading`; `why` = only the project-wide reasons (github / no_check),
which main's page says in its "copies of main" section.

**Tickets of a copy's improvements**: `build`, `buildKind`, `copyId`, `branch` from its build; the
`build` fact says the name; statusLine by state — landing `landing`, waiting_to_land `waitingToLand`,
in (copy) `inCopy`, in (shipped) `shippedFrom`, failed `{reason} — {name} is unchanged`, stopped
`you stopped it — {name} is unchanged`; stop's confirm fills `{branch}` with the copy's name. Keys:
landing → play it (when previewable) · discard; waiting_to_land → ★ `copyKeys.stopPlayingCopy` (playCopy
stop) · discard; **never approve & merge** for a copy's try; failed / stopped / discarded → Try again as
phase 1, blocked with `retiredBefore` when its copy is gone; an up-next issue in a copy → ★ build it now
with `{ issueId, copyId }`. At most one ink, as phase 1.

**Test** (`tests/builds-model.test.mjs`, node:test, pure fixtures): every row of the "which build"
table (held while unread; retired → main settled; shipped → main); main's branch skips copy runs; each
headline in precedence order; ready to play → ready to ship on `playedAt`; every blocked word; ShipVM
ready and each why; CatchUpVM confirm only while playing; RetireVM refuses a building or queued try;
CARD_BADGE across builds (improvement rows and copy rows, `{name}` vs `{n}`); `nextCopyName`
(dev → dev1 → dev2, gaps filled); `copyNameProblem` for every name rule; a copy ticket never offers
merge; the phase-1 cases untouched.

### 4.3 The bar — `public/lib/margin-ui.js`, `public/margins.css`

Source: bar-cards-shell.mjs (`group()` with the builds `+`, `makeBuildForm`, `copyRow`, `catchRow`,
`buildBody`, `playKey`, `shipKey`, `keysRow`, `keysWhy`) and bar-cards-shell.css, dressed as phase 1's
production classes.

```
section.cp-card.cp-group[data-cp-group="builds"]
  div.cp-card-head.cp-group-head   [lead] h2 "builds" · span.cp-badge (BarProjectVM.buildsBadge ?? builds[0].badge)
     · button.cp-icon-key.cp-trail[data-cp-role="new-build"][aria-expanded][aria-controls=<form id>]
         aria-label WORDS.copy.newLabel ("New build"); title newTitle, or newCopy.blocked when it can't; + glyph; never
         disabled (touch has no title: pressing it shows why) — drawn only when BarProjectVM.newCopy is present, so
         phase-1 VMs keep the header as it was
  form.cp-form.cp-build-form[data-cp-role="build-form"][hidden]   opens under the header (the lab's formSlot); with newCopy.blocked
                                                                  it opens in its can't state: the note says the words, field and key disabled
     top: label.cp-form-label WORDS.copy.formLabel + × (close, title WORDS.form.close)
     input.cp-form-field[data-cp-role="build-name"] maxlength 32, autocapitalize off, spellcheck false, value = newCopy.suggested (selected)
     p.cp-form-sub WORDS.copy.formSub ("a copy of main, as it is now")
     p.cp-form-note[role=status]                                 copyNameProblem words, or the daemon's refusal
     button.cp-primary-key[type=submit][data-cp-role="make-build"] WORDS.copy.make + ↵ cap (the bar's one ink key while open)
  div.cp-builds
     div.cp-build[data-build="main"]                              phase 1, unchanged (row + ▶ + always-open body)
     div.cp-build.cp-copy[data-build="<name>"][data-copy-id="<id>"]   one per copy, BuildsCardVM order
        div.cp-rowwrap.cp-copyrow[.is-current]
           button.cp-row.cp-two.cp-copy-row[data-bar-build="<name>"]   branch glyph · line 1: name + word (data-tone, pulses when live)
                                                                      · line 2: note (left) + count (right) → openBuild(name)
           button.cp-icon-key.cp-trail[data-cp-role="build-disclosure"][aria-expanded][aria-controls]   the caret; folds/unfolds
        div.cp-build-body[data-bar-build-body="<name>"][role=group][aria-label="inside <name>"]   when unfolded; one step in, on the trunk
           button.cp-row.cp-two.cp-catch[data-cp-role="catch-up"][data-build]   behind > 0: catchUpRow / catchUpNote; aria-busy while out;
                                                                             last failure's words on line two until the next try
           improvement rows, fold rows, empty line (WORDS.copy.emptyImprovements) — phase 1's rows and BAR_LIMITS
           the shared + improvement form, when open for this build
           button.cp-row.cp-add[data-cp-role="new-improvement"][data-build="<name>"]   "+ improvement"
           div.cp-build-keys: button.cp-key.cp-play[data-cp-role="play-copy"] (▶ + stable label play/playing, aria-pressed, aria-busy)
                              · button.cp-key.cp-ship[data-cp-role="ship-copy"] WORDS.copy.shipKey (disabled + title = ship.why when not ready)
           div.cp-why.cp-keys-why   blocked.play / ship.why words, when any
```

- **Folding**: copies start unfolded; the caret folds; remembered per project + copy for the session
  (the phase-1 `folds` set). The copy whose page or ticket is open is always unfolded.
- **+ New build**: opens the build form (closing an open improvement form — one form at a time);
  Enter or **make it** → `copyNameProblem` first (words in the note, focus stays); then `newCopy { name }`;
  the key holds `aria-busy`; ok → the form closes, the field clears, and focus goes to the new copy's
  row once it is drawn (else back to `+`); a refusal keeps the name and says the words. Escape closes it
  (order: phase 1 §6.4 step 3). Allowed while nibbi answers.
- **+ improvement** in a copy: the one form, now owned by (project, build); drafts are kept per
  project + build; placeholder `formPlaceholder`, hint `formHint`; **start now** → `startImprovement
  { text, copyId }`, **up next** → `queueImprovement { text, copyId }`; blocked words from that build's
  `blocked`. Main's form is phase 1's.
- **Play, one per build**, where bar-cards-shell puts it: main's ▶ alone on its row's trailing column (phase 1);
  a copy's play key, with its word, in its body's keys row (its row's trailing column is the caret) →
  `playCopy { copyId, action: start|stop }`; its title says `play.stops` as `oneAtATime` when set. A
  folded copy is played from its page (or unfold it).
- **Ship to main** in the bar → `openShip(name)`: its page with the confirm open. The bar never ships.
- **Catch up** row → `catchUpCopy(catchUp.payload)` when `catchUp.confirm` is null; while it plays →
  `openBuild(name)` (the page asks).
- **Marking**: a copy row carries `aria-current="page"` while its page is open — exactly one row marked
  in the bar, as phase 1.
- **Keys** (treeKeys, margin-ui.js:1111): ArrowUp/Down/Home/End over every visible row of every build;
  ArrowLeft from an improvement → its build's row; on a copy row ArrowLeft folds, ArrowRight unfolds.
  Never a printable key.
- CSS: no new token; `.cp-copy-row` is the two-line row; the caret is the trailing-column key;
  `.cp-build-keys` sits on the words' edge; 44px at coarse and ≤899px for every row and key; press
  states and `--t1` transitions as phase 1 §2.1.5; the copy word pulses with `cp-bar-pulse`.

**Test** (`tests/margin-ui.test.mjs`): re-point :530 (the builds header now holds exactly one key,
`[data-cp-role="new-build"]`, 32px, 44 at coarse; with `newCopy.blocked` it opens the form in its can't
state, the words in the note, field and make it disabled; absent when `newCopy` is) and :127's message; new: copies render under main in order, each `[data-bar-build]`
dispatches `openBuild(name)`; the caret folds and is remembered; the build form (suggested name
selected, name problems in words, Enter, Escape, focus to the new row); a copy's + improvement sends its
`copyId`; play-copy and ship-copy dispatch `playCopy` / `openShip`; the catch-up row sends `catchUpCopy`
or `openBuild` when it plays; the GitHub-mode can't form; exactly one `aria-current="page"` with a copy page
open; 44px rows and keys at 390 coarse; press states on the new controls; no `data-build-id`.

### 4.4 The pages — `public/lib/project-pages.js`, `public/project-pages.css`

`drawBuild()` (project-pages.js:927) branches on `M.build.kind`; `M.build === null` on a build page →
the gone page (`WORDS.copy.gone` + `goneNote`, only ×). Source: tree-console.mjs `drawBuild`,
`shipPanel`, `previewCard`, `tiles`, `improvementsSection`, `historySection`, `retireRow`,
`copiesSection`.

```
div.cp-page.cp-build.cp-copy-page[data-cp-page="build"][data-cp-id="<name>"]
 header.cp-page-head
   div.cp-title   p.cp-kicker (branch glyph · WORDS.copy.kicker) · div.cp-title-row: h1[tabindex=-1] name + span.cp-page-word.cp-head-state (word, tone)
                  · p.cp-copyline copyLine ("copy of main · 3 ahead · 0 behind")
   button.cp-act[data-cp-key="ship"][aria-expanded]  WORDS.copy.shipKey — ink when ship.ready and the panel is closed; when not: disabled, title = why,
                                                      and the why once as a quiet line under the copyline (phase 1's blocked-key rule) unless the
                                                      headline already says it (nothing, behind)
   button.project-close (as phase 1)
 div.cp-page-body
   notice                                   shipDone / shipDoneMany + a "see main" link (openBuild main) · catchUpDone · errors
   section.cp-ship (when open)              h2 shipTitle · p lead · ol: each `ships` improvement (word "in" pass · its title as a link → openImprovement · "landed 2h ago")
                                            · p shipStays · checks: checksLine + the CheckVM list · p facts
                                            · keys: [data-cp-key="ship-no"] no · [data-cp-key="ship-yes"] yes (ink when ready; disabled + why when not)
   section.cp-preview                       Play <name> ([data-cp-key="play"]) / "<name> is playing" + open it + stop playing / "this one can’t be played" + blocked
                                            · hint: oneAtATime when play.stops · foot: madeFrom (ago) + baseSha
   dl.cp-tiles                              improvements (count · counts) | checks on <name> (passed / not run yet; "verified 2h ago on a1b2c3d") |
                                            against main ("N ahead"; "M behind — main moved on" / "0 behind — main hasn’t moved on";
                                            extra: [data-cp-key="catch-up"] when needed)
   div.cp-confirm (catch-up, when it plays) catchUpPlaying · [catch-up-no] · [catch-up-yes]
   section.cp-improvements                  phase 1's section; + improvement sends { text, copyId }
   section.cp-history "history"             HistoryVM timeline
   div.cp-retire                            quiet: retireNote + button.cp-link[data-cp-key="retire"] retireKey →
                                            confirm strip (armed): words · [retire-no] retireNo · [retire-yes].armed retireYes; blocked → disabled + its words shown
```

- **Ship asks twice**: `ship` opens the panel with focus on `ship-no`; only `ship-yes` sends
  `shipCopy(ship.payload)`; Escape or no closes it and focus returns to `ship`. `PageRef.intent === 'ship'`
  (openShip) opens the panel on open, once. Nothing is sent on the first press.
- **One ink key per page**, first that applies: `ship-yes` (panel open, ready) · `ship` (ready, panel
  closed) · `play` (playable, not running, not blocked) · the improvement form's start now (open) · none.
- **Catch up**: `catch-up` sends `catchUpCopy(payload)` directly, or opens the confirm when
  `catchUp.confirm` is set (it plays); a refusal says the daemon's words in the notice (kind error).
- **Retire**: `retire` opens the strip with focus on `retire-no`; `retire-yes` sends `retireCopy(payload)`;
  ok → the page becomes the gone page on the next model.
- **Escape** on a copy page, newest first: the ship panel · the catch-up confirm · the retire strip ·
  the add form · the failed fold (then the frame's Escape returns to chat, phase 1 §6.4).
- **Main's page** adds `section.cp-copies` "copies of main" (`copiesTitle`) after its improvements: a
  row per CopySummaryVM (`button.cp-imp.cp-copy[data-cp-key="copy-<name>"]` → `openBuild(name)`: branch
  glyph · name · note · word) or `copiesEmpty` / `githubMode`; its history interleaves `shipped` rows.
- **The ticket**: the crumb (project-pages.js:277-283) draws the ticket's build — branch glyph and name
  for a copy — and opens `openBuild(t.build)`; "build it now starts try 1 on {build}" already uses
  `t.build` (:646).
- **Stable under updates** as phase 1: an open ship panel, catch-up confirm and retire strip survive a
  model refresh; if the ship's `payload.expectedHead` changes while the panel is open, the panel
  redraws its list (the new head) and moves focus to `ship-no`.
- Narrow (≤640px) and 44px rules as phase 1; the ship panel's keys full width.

**Test** (`tests/project-pages-ui.test.mjs`, the route-served harness, literal VMs): a copy page in each
headline; the ship panel asks twice (no `shipCopy` until yes; Escape and no close it); ship's one ink
rule in every combination; the ship key disabled with its why (behind, nothing, checkout on another
branch); openShip's intent opens the panel; catch up direct vs confirm while playing; retire asks,
armed, blocked while building; the gone copy page; main's copies section and its GitHub words; the
ticket crumb for a copy; 390×844 touch: every key ≥ 44, no sideways scroll; the phase-1 cases untouched.

### 4.5 Routing

`S.projectView = { project, page: 'build', id: 'main' | <copy name>, intent? }`.

| from | goes to |
|---|---|
| a copy's bar row; a copy row on main's page; a ticket's crumb (a copy's) | that copy's build page |
| the bar's ship to main | that copy's page with the ship panel open (`intent: 'ship'`) |
| the bar's catch-up row while the copy plays | that copy's page (the confirm is there) |
| choosing another project while a copy's page is open | the other project's **main** build page |
| a copy retired or gone while its page is open | the page stays and says `WORDS.copy.gone` |
| a notification, chip or "open it" for a copy's run | its ticket (improvementIdForRun, unchanged) |

### 4.6 Every new or changed action

The bar and pages call `onAction(name, projectId, value)`; the integrator answers in
`handleControlPanelAction` (app.js:2146). WAITS_FOR_REPLY is unchanged: nothing about a copy waits for
nibbi's reply.

| action | sent by | value | calls | while nibbi answers | demo |
|---|---|---|---|---|---|
| openBuild | build rows, copy rows, crumbs | `'main'` \| name | `openProjectPage(p, 'build', name)` | yes | yes |
| openShip | bar ship-copy | name | `openProjectPage(p, 'build', name, { intent: 'ship' })` | yes | yes |
| newCopy | bar build form | `{ name }` | `api.command('copy.create', { name }, p)` → accept the view into `S.cp`; refresh | yes | refused `demoChange` |
| shipCopy | page ship-yes | `{ copyId, expectedHead }` | `api.command('copy.ship', { id: copyId, expectedHead }, p)`; `sound('land')`; refresh | yes | refused |
| catchUpCopy | bar catch-up row, page catch-up / its yes | `{ copyId, expectedHead, stopPlay }` | `api.command('copy.catchUp', { id: copyId, expectedHead, stopPlay }, p)`; refresh | yes | refused |
| retireCopy | page retire-yes | `{ copyId, expectedHead }` | `api.command('copy.retire', { id: copyId, expectedHead }, p)`; refresh | yes | refused |
| playCopy | bar play-copy, page preview, a waiting ticket | `{ copyId, action }` | start: `copy.play { id }` → poll `GET /api/preview?id=copy:<p>:<id>` every 500ms ≤ 60s → `openUrl(url)`; stop: `copy.stop { id }` → poll until not running; open: `openUrl(play.url)`; then refresh (main's play too) | yes | refused (not `open`) |
| startImprovement | bar / page forms | `{ text, copyId? }` | `run.dispatch { issue, title, copyId? }` (`copyId` only when set) | refused `busy` | refused |
| queueImprovement | bar / page forms | `{ text, copyId? }` | projectCommand `issue.create { title, description, copyId? }` | yes | refused |
| buildIssue | ticket | `{ issueId, copyId? }` | projectCommand `issue.build { id, copyId? }` | refused `busy` | refused |

---

## 5. File ownership — three builders, disjoint

Each builder edits only their files, imports only what is listed, writes their tests, and commits once
(plus fixes) on `ui/builds-branches` with the commit form of §0. Nobody but the integrator touches
`public/lib/control-panel-contract.js`; a builder who finds it wrong conforms and says so in their commit.

| builder | files | imports | depends on |
|---|---|---|---|
| **DAEMON** | `daemon/src/**` (fixer.ts, previews.ts, command-service.ts, api.ts incl. the `/api/project-copies` route, project-workspace.ts, scheduler.ts, main.ts, new copy-records.ts / verified-merge.ts / project-copies.ts) and `daemon/test/**` (new project-copies.test.ts; others untouched unless a phase-2 field breaks an exact `deepEqual`, said in the commit) | the daemon's own modules; no new package | this spec §2–§3; the contract's `CopyRecord` / `CopyView` / `CopiesRead` shapes, `COPY`, `WORDS.copy` (for the refusal messages) |
| **MODEL + BAR** | `public/lib/builds-model.js`, `public/lib/margin-ui.js`, `public/margins.css`, `tests/builds-model.test.mjs`, `tests/margin-ui.test.mjs` | `./control-panel-contract.js`, `./empty.js` (as phase 1) | §4.1–§4.3, §4.6 |
| **PAGES** | `public/lib/project-pages.js`, `public/project-pages.css`, `tests/project-pages-ui.test.mjs` | `./control-panel-contract.js`, `./github-ui.js`, `./transcript.js` (as phase 1) — not builds-model.js | §4.4–§4.6 |
| **integrator** | `public/app.js`, `public/lib/project-data.js` (the API client), `public/index.html` (no change expected), `public/styles.css`, `tools/**`, `docs/**` other than this spec (CONTROL-PANEL.md pointer, GITHUB-BUILDS.md note), `design/LANGUAGE.md`, `CHANGELOG.md`, `package.json` scripts, this spec and the contract when a builder reports them wrong | — | everything, after the three land |

---

## 6. Integration checklist

### 6.1 app.js, by function

| where | change |
|---|---|
| imports (app.js:14-15) | + `buildsCard, buildOf` from builds-model.js; + `COPY, COPY_COMMANDS` from the contract; + `loadProjectCopies` from project-data.js |
| `cpEntry` (app.js:1933) | the entry gains `copies: null` |
| `refreshControlPanel` (app.js:1954) | a fourth read in the `allSettled`: `loadProjectCopies({ project })` → `e.copies` (a failure keeps the last good one) |
| `cpInput` (app.js:1974) | `+ copies: e?.copies ?? null` |
| `mainFor` (app.js:1981) → `cardFor(p, now)` | memoised as today, the key + `e?.copies`; returns `buildsCard(cpInput(p, now))` (main stays `card.builds[0]`) |
| `pagesModel` (app.js:2001) | page 'build': `build = buildOf(input, v.id)` (null → gone); page 'ticket': the ticket's build; `+ builds: card.builds` |
| `syncMargins` (app.js:2009) | per project: `builds: card.builds, buildsBadge: card.badge, attention: card.attention, newCopy: card.newCopy` |
| `PANEL_FROM_BAR` (app.js:2065) | `+ 'openShip', 'newCopy', 'catchUpCopy', 'playCopy'` |
| `handleMarginAction` `selectProject` (app.js:2071-2078) | a copy's page (`v.page === 'build' && v.id !== MAIN`) → the other project's main page |
| `handleControlPanelAction` (app.js:2146) | §4.6: `openBuild` takes the name; the six copy cases; `copyId` passed through `startImprovement` / `queueImprovement` / `buildIssue` |
| new `copyCommand(project, name, args)` | `api.command(name, args, project)` → `acceptCopy(project, result)` → `void refreshControlPanel(project)`; a refusal throws its words (`notice` for the not-ready ones) |
| new `acceptCopy(project, viewOrRecord)` | merge by id into `S.cp.get(project).copies.copies` (a record keeps the view's ahead/behind/health/play until the read; `status: 'retired'` or `removed` drops it); `syncMargins()` |
| new `playCopyFlow(project, copyId, action)` | as `runPreview` (app.js:2242) with the copy's preview id, then `refreshPlay(project)` too (main may have stopped) |
| `openProjectPage` (app.js:2264-2279) | `id: page === 'build' ? String(pageId || MAIN) : …`; `+ intent` from the options into `S.projectView` |
| `connectEvents` (app.js:1309) | the refresh regex gains `copy\.`; `copy.updated` → `acceptCopy(event.projectId, event.payload.copy)` first |
| `playProject` (app.js:2225) | after start, `refreshControlPanel(project)` (a copy may have stopped) |
| untouched | `send` (app.js:1591): its if / else-if chain and `updateLocalReply(T, m); setSaid(T, m.text` (tests/local-fallback-ui.test.mjs:67) |

### 6.2 public/lib/project-data.js

`loadProjectCopies({ project, signal, fetcher })` → `request(COPY.route + '?project=' + …)`, validated:
`value.project === project`, `Array.isArray(value.copies)`, each copy's `project` matches and `id`
matches `COPY.idPattern`; else `ProjectDataError('copies', …)`.

### 6.3 Fixtures

`tools/project-workflow-fixture.mjs` (control-panel-verify runs on it: real routes, real git, a
deterministic fixer provider, a real check) gains:
- `holdFixer()` → a gate like `holdChat` for `input.role === 'fixer'`; returns its release;
- `git(project, ...args)` → `processes.git(games()[project].repo, ...args)`;
- `prepareCopies(project)` → writes `package.json` `{ "scripts": { "dev": "node serve.mjs" } }` and a
  `serve.mjs` that prints `http://127.0.0.1:<port>` into the project's repo, commits them on main,
  `updateProject(project, { install: 'true', play: undefined })` — so main and its copies both play as
  servers; the check stays the fixture's real `test -n "$(ls fixture-change-*.txt)"` (a landed or shipped
  tree has one);
- `copies(project)` → `fetch(base + COPY.route + '?project=' + project)`;
- `githubMode(project)` → puts a minimal `github-connections` record (`workflowMode: 'github'`,
  `integrationBranch: 'staging'`, `releaseBranch: 'main'`, `repository: 'owner/<project>'`); returns an undo.

`tools/test-backend.mjs` (the bar-shots / webkit / margin-ui-verify backend) gains an opt-in
**`testBackend({ copies: true })`**: `updateProject('fixture', { check: 'test -f README.md', install: 'true' })`,
a deterministic fixer provider (as projectWorkflowFixture's, only under this flag), and a copy `dev`
made through `daemon/dist/project-copies.js createCopy('fixture', 'dev')` — real git, temp state, so a
copy can be made, take an improvement, ship, catch up and retire. Returns `{ …, copies: { createCopy, git } }`.
Off by default: every existing suite's counts (`[data-bar-build]` = ['main']) stay as they are.

### 6.4 tools/control-panel-verify.mjs — checks 14–21

On observatory after `fixture.prepareCopies('observatory')`, 1180×820 unless said; PASS/FAIL lines; the
network log proves "asks twice" (no POST before yes).

14. **+ New build → dev appears, a copy of main** — the builds `+` → the form, `build-name` = "dev"
    selected, "a copy of main, as it is now" → Enter → one `copy.create` POST; `[data-bar-build="dev"]`
    with line two "copy of main"; its word pulses "making the copy", then "nothing to ship yet";
    `fixture.copies()` has dev on `nibbi/copy/dev` at main's sha, its worktree under `NIBBI_WORK_DIR`;
    `git worktree list --porcelain` shows the branch at that worktree only; `projectView` still null.
15. **+ improvement on dev → it lands in dev, main unchanged** — note main's sha; dev's
    `+ improvement` → type → start now → the run (copyId = dev's) ends `merged`; main's sha unchanged;
    dev's worktree clean with the change; its row `data-state="in"` inside dev's body, not main's; dev
    says "ready to play" and "copy of main · 1 ahead"; its page's copyline "copy of main · 1 ahead · 0 behind".
    Then **up next** on dev → an `issue:` row in dev's body → its ticket → build it now → lands in dev →
    the issue is still open in `fixture.section('observatory','issues')`.
16. **Ship to main asks twice, then main has it and dev is level** — dev's page → `ship` (ink) → the panel
    lists 2 improvements and the checks, no `copy.ship` POST → `ship-yes` → one POST → main's sha === dev's
    head; dev "0 ahead · 0 behind", "nothing to ship yet"; both improvements now under main as `in`
    ("shipped from dev"); the issue is done in issues.md **now**; the notice says "shipped 2 to main".
17. **main moves on → dev says catch up → catch up** — `fixture.git('observatory', …)` commits
    `main-moved.txt` on main → reselect the project → dev's word "main moved on · catch up", the
    catch-up row in its body, the tile "1 behind" → the row → one `copy.catchUp` POST (no confirm: not
    playing) → dev "0 behind"; `git merge-base --is-ancestor main nibbi/copy/dev`; main unchanged; dev's
    worktree clean with `main-moved.txt`.
18. **One plays at a time** — main's ▶ → `/api/play` running; dev's page hint "one plays at a time —
    this stops main" → play dev → main's `/api/play` not running, dev's preview running with a URL;
    stop dev.
19. **Retire asks, refuses while running, then dev is gone** — `holdFixer()`; start an improvement on
    dev → building; dev's page → `retire` disabled with "an improvement is building on dev — stop it or
    let it land first"; release → it lands → `retire` → the armed strip naming "the 1 improvement in it
    that hasn’t shipped", no POST → `retire-yes` → one `copy.retire` POST; dev's row gone; its worktree
    directory gone; `git rev-parse --verify refs/heads/nibbi/copy/dev` fails; main unchanged; the page
    says "this build is gone".
20. **A GitHub-mode project shows copies disabled with a reason** — `githubMode('weekend-notes')` →
    choose it → the builds `+` has the title `WORDS.copy.githubMode`; pressing it opens the build form
    whose note says those words, with `build-name` and `make-build` disabled; no `copy.create` POST; main's
    page's "copies of main" says them too; a direct `copy.create` POST answers `ok: false`; undo.
21. **Copies at 390 touch** — make dev again; open the drawer: its row, caret, play and ship keys ≥ 44;
    a copy row closes the drawer before its page opens; the copy's page keys ≥ 44; no sideways scroll.

Check 10 (44px) and check 11 (press states) add the builds `+` and a copy row. The closing summary line
names the new checks.

### 6.5 Suites to re-point or extend

| file:line | why | phase 2 |
|---|---|---|
| tests/margin-ui.test.mjs:530 | "no + New build in phase 1" | MODEL+BAR builder (§4.3) |
| tests/margin-ui.test.mjs:127 | message "one build in phase 1" | MODEL+BAR builder |
| tests/builds-model.test.mjs, tests/project-pages-ui.test.mjs | phase-1 cases | must pass unchanged; the builders add cases |
| daemon/test/lifecycle.test.ts, project-workspace.test.ts, build-attempts.test.ts, steer.test.ts | main path | pass **unedited** (invariant 20) |
| tools/control-panel-verify.mjs (checks 10, 11, summary) | the new `+`, copy rows | §6.4 |
| tools/margin-ui-verify.mjs:33 (`geometry`, `baselineFit`) | the builds header gains a key in every project | re-run; the new `+` must not overlap the badge or the header's edge |
| tools/webkit-verify.mjs:52-57 | counts `[data-bar-build]`; `minRow` over every `.cp-icon-key` | `builds` stays 1 (no copies by default); the new `+` joins `minRow` (32 docked, 44 in the drawer); add one check on `testBackend({ copies: true })`: dev's row and keys ≥ 44 at 390, its page without sideways scroll |
| tools/bar-shots.mjs:37 | shots | add a copy shot on `testBackend({ copies: true })` |
| tools/attention-verify.mjs:83 | card badge text | unchanged text (only main there); now from `buildsCard` |
| tools/sidebar-verify.mjs:57, :68 | `['main']` | unchanged |
| tools/style-verify.mjs:17, :25-29 | budgets, verdict hooks | new CSS must pass as is; the retire yes uses `.armed` |
| tests/local-fallback-ui.test.mjs | app.js send loop | untouched |
| package.json `verify` | runs control-panel-verify | unchanged (the checks join it) |

### 6.6 Docs

CHANGELOG entry; CONTROL-PANEL.md's header points here for phase 2; GITHUB-BUILDS.md says copies are
local-only for now; LANGUAGE.md §9 adds the copy row, the build form, the ship panel; §15 records
phase 2. The PR body lists D1–D16 as defaults the owner can override.

---

## 7. Order of work

The three builders start together from this commit. DAEMON is the long pole; MODEL+BAR and PAGES work
from literal VMs and the contract. The integrator then: `npm run build` (daemon + ui), wires §6.1-§6.2,
adds the fixtures and checks (§6.3-§6.4), and runs typecheck · `npm test` · `CI=1 npm run verify` ·
`verify:webkit` · `verify:all` · github-workflow-verify, each in the background.

---

## 8. Deferred, or open for the owner

- **The GitHub path** for copies: per-run `binding.baseBranch` = the copy's branch (github-builds.ts:54,
  :299), publishing `nibbi/copy/*` (lift :313's refusal for copy branches), a promotion PR copy → release
  per copy (:357-364; one open per branch pair, :361). Nibbi's own `v2` (integration) is already "a dev
  build shipped to main" for one build.
- **Play main at main's head** (a detached worktree), instead of the owner's checkout (D14).
- **A copy of a copy** (D2), and choosing the base in the form.
- **Disk**: show each copy's size; clean the local run worktrees nothing needs (still never cleaned, data.md §1).
- **Review inside a copy** (D5's flip), and whether automation may target a copy (D15).
- Whether "both of them" pinned open (ROUND5 decided 1) should also mean every copy starts unfolded —
  phase 2 unfolds them all by default (§4.3); folding is remembered.

---

## 9. What research/round4/data.md got wrong, checked against af616c8

data.md was written against `ui/r2-attention @ 9cb24f0`; its line numbers still hold for the daemon
(fixer.ts, command-service.ts, previews.ts, project-workspace.ts, scheduler.ts are unchanged in those
regions). Its git probes hold. These do not:

1. **The copy's worktree path** — `~/NibbiWork/builds/<project>/<branch>` is outside `config.workDir`
   (`~/NibbiWork/fixers`, config.ts:8). `NIBBI_WORK_DIR` would not isolate it (tests and fixtures would
   write into the real `~/NibbiWork`), and the guards that scope Nibbi-owned worktrees to the work dir
   (fixer.ts:103, github-builds.ts:383) would not cover it. → `join(config.workDir, 'copies', project, name)`.
2. **"builds section returns records + runs grouped (project-workspace.ts:54)"** — `projectSection` is
   synchronous; ahead/behind and health need git. → a separate async read, `/api/project-copies`.
3. **"grouping is a client-side groupBy(run.targetBranch)"** — branch names come back after a retire and
   a remake, and phase 1's main-branch rule (builds-model.js:209-210, "the newest run's targetBranch")
   would read the first copy run and rename main's branch to `nibbi/copy/dev`. → group by `copyId`; main's
   rule skips copy runs.
4. **Issue completion "fixer.ts:353"** — there are two completion sites: :353 (the merge) and **:310**
   (crash recovery), each with a `noteDelivery` (:354, :311). Both must wait for ship, and so must the
   progress delivery — data.md only named :353.
5. **"The existing guards refuse to change a worktree whose preview is running (fixer.ts:118, :132;
   build-attempts.ts:105)"** — those check the *run's own* preview (`previewStatus(run id)`). `integrate()`
   has no preview guard at all, so nothing would stop an improvement landing in a copy that is playing. →
   the new `'waiting'` guard on the copy's preview id.
6. **"integrate returns conflict and keeps the integration worktree (fixer.ts:343)"** — it keeps it on
   **every** failure: conflict :343, checkfail :346, changed :348 and :349 all return before the removal
   at :356. Auto-landing would leak a `merge-*` worktree per failed landing. → the new paths remove theirs;
   main's keeps today's behaviour.
7. **"a run takes a build: FixerOpts.build; targetBranch = record.branch (fixer.ts:42, :179; zod
   command-service.ts:33)"** — not enough: `replacementOptions` (fixer.ts:96-99) drops it, so Try again
   (`requeueFix` :294, `redispatchFixer` :299) would land the retry on main; and `allowedRunActions`
   (:156) would still offer `run.merge` on a copy's run. Also `project-workspace.ts:16` is `.strict()`,
   so `issue.build`/`issue.create` refuse a new field until the schema has it.
8. **The record** — id `<project>:<branch>` collides with a retired copy's tombstone when the name is
   reused, and runs need a stable handle (→ `copy-<uuid>`); status `'shipped'` is wrong for the model (a
   shipped copy stays, level with main); `retire (remove worktree, keep branch)` is overridden (remove both).
9. **"create: `git branch <n> <baseSha>` + `git worktree add <dir> <n>`"** — two steps leave a stray
   branch when the second fails; `git worktree add -b <branch> <dir> <sha>` is one.
10. **"update-ref … never use it"** needs its precise form: the daemon already calls `update-ref` once,
    build-attempts.ts:219 (a checkpoint), from *inside* the run's own worktree where that branch is checked
    out, followed by `reset --mixed` — safe, and untouched. The rule is: never move a branch from a
    worktree that doesn't have it checked out.
11. **"client allowlist + handleMarginAction cases (public/app.js:2106)"** — moved by phase 1: control-panel
    actions go through `handleControlPanelAction` (app.js:2146) and run commands through
    `handleProjectAction`'s `buildCommand` allowlist (app.js:2323); copy commands get their own path
    (§6.1), not the allowlist.
12. **"play main needs a --detach worktree at main's SHA"** — true for playing main's head, but not needed
    for one-at-a-time (previews are keyed by id, previews.ts:9); deferred (D14).

---

## 10. As built — where the build departed from this spec

The three builders' departures (each said in their commit) and the integrator's. D1–D16 stand as written.

| where | the spec said | as built, and why |
|---|---|---|
| previews.ts | `start(id, cwd, cmd, { onEnd })` | exported as `startPreview`; `start` stays the module's private name |
| copy-records.ts names | empty · shape · long | length is tested before shape: the pattern alone caps a name at 32, so `nameLong` could never be said |
| verified-merge.ts, main's path | remove the merge worktree after the bookkeeping | right after the fast-forward, before it; a conflict also reports its files. An install failure in the verification worktree is still `changed`, as today |
| copy.ship | step 1 is the merge sequence's own guard | ship checks main's checkout (branch, clean) first so it can refuse in its own words, and merges with `--ff-only` in the verification worktree, so a `merge.ff=false` setting can't make a commit nobody played |
| daemon words | `WORDS.copy` | plus daemon-only ones: `copyGone`, `retired`, `stillPlaying`, `changedOutside`, `branchExists`, `folderExists`, `stoppedWhileMaking`, `shipFailed`, `catchUpRefused`, `notNibbis`, `retireMoved` |
| copy.retire | remove the worktree if git lists it | refuses with `notNibbis` unless git lists the folder with the copy's branch checked out there and nowhere else; a folder already gone but still listed gets a plain `worktree remove` first; a run waiting to land stays as it is. **Refuses a copy that moved outside nibbi** — its branch, or its folder's HEAD, isn't `headSha` — before anything changes: `retireMoved` names the commits past `headSha` (≤ 5), else the `moved` words; `branch -D` checks the branch is still at `headSha` right before it runs. `-D` alone dropped an owner's commit on the copy's branch (review F1) |
| issue.create with `copyId` | store it after the write | checks the copy (live, ready, not GitHub) before anything is written; in GitHub mode `issue.build` ignores a stored copy and builds on main |
| copy.play | live and ready | also refuses unless its health is ok, the model's play rule |
| recovery | — | startup doesn't wait for `landWaiting`; passed copy runs that never got a landing attempt try once; a copy stuck `retiring` goes back to `broken` if it has an error, else `ready` |
| builds-model.js `buildMain` | main's BuildVM | phase 1's `blocked` and `play` shapes when the input has no `copies` key (phase 1's suite compares them whole); with one, `buildsCard(input).builds[0]` |
| margin-ui.js name rule | import `copyNameProblem` | its own copy (the bar imports only the contract); a test holds the two to the same words |
| bar folding | copies start unfolded; the open one always unfolded | a copy unfolds when its page or a ticket of it opens, and the caret can fold it again; folds are remembered by copy id, so a remade "dev" starts unfolded |
| bar why-lines | play's and ship's words | a copy's health words alone when it has any; none while making, retiring, shipping or catching up; ship's reason skipped when the headline says it |
| RetireVM.blocked | building-group or queued runs | also `awaiting_input` (the daemon refuses it too, as active); the model also blocks on landing and waiting-to-land runs, which the daemon doesn't refuse; and on health `moved`, with the `moved` words |
| project-pages.js ink order | §4.4's four | the catch-up question's yes takes the ink while it is open; the armed retire strip has none |
| pages questions | — | one open at a time (ship, catch up, retire); a question stays as asked while its yes is out; retire's refusal is said at its foot |
| contract `shipLevel` | "main hasn’t moved on since {name} caught up" | "{name} has everything main has": the old words were said of a copy that had never caught up (the lab said "since dev was copied") |
| app.js cards | `mainFor` → `cardFor` | `cardFor` memoises `buildsCard`; the page's build is found in `card.builds` rather than a second `buildOf` pass |
| app.js reads | a failed copies read keeps the last good one | and a `copy.updated` that lands while a read is out wins over it (the read runs again), without discarding that read's builds and issues |
| app.js pages | a copy page whose copy is gone → the gone page | a copy page before the project's copies were first read is not drawn at all, then opens when they land — never "gone" before anyone looked |
| project-copies.ts `copiesView` | the read, as listed in §2.4.2 | every store read (records, ships, each copy's play) before its first git await: a read cut off by shutdown otherwise opened the store again after close (2 of 2 probe runs left a `runtime.sqlite` in a removed fixture folder; 0 of 5 after) |
| app.js events | `copy.updated` → `acceptCopy` | a record whose head moved (a landing, a catch-up) reads again at once rather than after the 400ms event debounce: ahead and behind trail the "2 in" beside them by one read, 51–67ms over 8 landings measured on the copies fixture |
| app.js ship | refresh | also reads `/api/projects` again: main's last commit, on its page's play foot, moved |
| app.js refusals | the daemon's words | "… is busy — …" ones are a notice (ink), not an error |
| tools/test-backend.mjs | `testBackend({ copies: true })` | also `enableCopies()`, for a suite that checks main alone first: one backend per process (the daemon's modules are singletons). It sets `NODE_ENV=test` only there, for its deterministic fixer |
| control-panel-verify check 9 | `.cp-form-note` | scoped to `.cp-improvement-form`: the build form has a note too |
| control-panel-verify check 14 | "making the copy", then "nothing to ship yet" | `install: 'sleep 2'` for that one create, so the first word is on screen long enough to be read |
| control-panel-verify check 18 | main's ▶, then play dev | waits for main's address first: playing a copy while main is still starting stops it, and main's ▶ then says "it didn't come up — check the play command in settings" (open, below) |
| control-panel-verify check 20 | choose weekend-notes | reload first: the GitHub connection is put straight into the store, and the page's copies words read `project.github` from `/api/projects` |

Open after the build:

- Playing a copy while main's ▶ is still waiting for its address stops main, and main's ▶ then reports it didn't come up; it should say it was stopped for the copy.
- A page's notice ("shipped 2 to main …") stays on the copy's page until the next action there, across closing and reopening it.
- `/api/projects` (read-models.ts `projectsView`) reads the store (`connectionFor`) after its git calls, the shape the copies read had; a request cut off by shutdown can open the store again after close. Not seen in the suites.


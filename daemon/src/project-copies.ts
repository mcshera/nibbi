// Builds as copies (docs/BUILDS-AS-COPIES.md §2.4): make a copy of main, read it, ship it to main, catch it up
// with main, play it, retire it, and recover any of that after a crash. Landing a run in a copy is fixer.ts'
// integrate(); every merge — landing, ship, catch up — is verified-merge.ts' one sequence.
// Nothing here moves a branch from outside the checkout that has it checked out.
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runtime } from './store.js';
import { games, mergeTarget, type GameCfg } from './projects.js';
import { git, withRepoLock } from './processes.js';
import { sandboxCommand } from './sandbox.js';
import { canonicalPath, within } from './paths.js';
import { config } from './config.js';
import { HttpError } from './http.js';
import { connectionFor } from './github-repositories.js';
import { completeTask } from './roadmap.js';
import { completeLinkedIssues } from './project-issues.js';
import { buildIsActive, hasCheck, landOnCopy, listFixers, noteDelivery, saveFixer, type Fixer } from './fixer.js';
import { previewCommand, previewStatus, startPreview, stopAndWait, ownedPreviews } from './previews.js';
import { changedPaths, firstLine, refreshInstall, statusEntries, verifiedFastForward, type MergeFailure } from './verified-merge.js';
import {
  COPY_RULES, COPY_WORDS, CopyRefusal, allCopies, copyBranch, copyById, copyPath, copyPreviewId, fill, liveCopies, notReadyWords,
  patchCopy, pruneTombstones, refuse, removeCopyRecord, requireLiveCopy, retiredCopies, saveCopy,
  type CopyHealth, type CopyRecord, type ShipRecord,
} from './copy-records.js';

export type { CopyRecord } from './copy-records.js';
export interface CopyPlay { running: boolean; starting: boolean; url: string | null; playable: boolean; kind: 'server' | 'url' | 'none'; error: string | null }
export type CopyView = CopyRecord & { ahead: number; behind: number; health: CopyHealth; dirtyFiles: string[]; play: CopyPlay };
export interface RetiredCopy { id: string; name: string; branch: string; retiredAt: string; retiredHead: string | null; ships: ShipRecord[] }
export interface CopiesRead {
  project: string; mode: 'local' | 'github'; disabled: '' | 'github' | 'no_check'; limit: number; main: { branch: string; sha: string };
  copies: CopyView[]; retired: RetiredCopy[]; ships: Array<ShipRecord & { copyId: string; name: string }>; fetchedAt: number;
}

const ACTIVE = new Set(['installing', 'running', 'verifying', 'awaiting_input']);
const isGithub = (project: string): boolean => connectionFor(project)?.workflowMode === 'github';
const now = (): string => new Date().toISOString();
function projectConfig(project: string): GameCfg { const cfg = games()[project]; if (!cfg) throw new Error('Unknown project'); return cfg; }
/** A copy of this project, live, whatever its status. */
const liveCopy = (project: string, id: string): CopyRecord => requireLiveCopy(project, id, { ready: false });
const mainBranch = (cfg: GameCfg): string => cfg.targetBranch ?? mergeTarget(cfg.repo);
const isAncestor = (cfg: GameCfg, older: string, newer: string): Promise<boolean> => git(cfg.repo, 'merge-base', '--is-ancestor', older, newer).then(() => true, () => false);
const branchHead = (cfg: GameCfg, branch: string): Promise<string> => git(cfg.repo, 'rev-parse', '--verify', '--quiet', 'refs/heads/' + branch).catch(() => '');
const count = async (cfg: GameCfg, range: string): Promise<number> => Number(await git(cfg.repo, 'rev-list', '--count', range));

/* ------------------------------------------------------------------------------------------ the read */

/** What git says about a copy now: its worktree is there, on its branch, at the head nibbi recorded, and clean. */
export async function copyHealth(cfg: GameCfg, copy: CopyRecord): Promise<{ health: CopyHealth; dirtyFiles: string[] }> {
  if (!existsSync(copy.worktree)) return { health: 'missing', dirtyFiles: [] };
  const [on, branch, head] = await Promise.all([
    git(copy.worktree, 'symbolic-ref', '--quiet', '--short', 'HEAD').catch(() => ''),
    branchHead(cfg, copy.branch),
    git(copy.worktree, 'rev-parse', 'HEAD').catch(() => ''),
  ]);
  if (on !== copy.branch || branch !== copy.headSha || head !== copy.headSha) return { health: 'moved', dirtyFiles: [] };
  const dirty = await changedPaths(copy.worktree).catch(() => ['(unreadable)']);
  return dirty.length ? { health: 'dirty', dirtyFiles: dirty.slice(0, 5) } : { health: 'ok', dirtyFiles: [] };
}
const healthWords = (copy: CopyRecord, health: CopyHealth): string => health === 'ok' ? '' : fill(COPY_WORDS[health], { name: copy.name });
function playOf(cfg: GameCfg, copy: CopyRecord): CopyPlay {
  const preview = previewStatus(copyPreviewId(copy.project, copy.id)) as { running: boolean; starting?: boolean; url?: string; error?: string };
  const url = !!cfg.play && /^https?:\/\//.test(cfg.play);
  const kind = url ? 'url' : cfg.play || previewCommand(copy.worktree) ? 'server' : 'none';
  return { running: preview.running, starting: !!(preview.running && preview.starting), url: preview.running ? preview.url ?? null : null, playable: kind === 'server', kind, error: preview.error ?? null };
}
// The store before git: a read still out when the backend closes must not open the store again after it.
async function viewOf(cfg: GameCfg, copy: CopyRecord, play: CopyPlay = playOf(cfg, copy)): Promise<CopyView> {
  const { health, dirtyFiles } = await copyHealth(cfg, copy);
  let ahead = 0, behind = 0;
  try { [behind, ahead] = (await git(cfg.repo, 'rev-list', '--left-right', '--count', `refs/heads/${copy.base}...refs/heads/${copy.branch}`)).split(/\s+/).map(Number); }
  catch { /* the branch is gone: health says so */ }
  return { ...copy, ahead, behind, health, dirtyFiles, play };
}
const retiredView = (copy: CopyRecord): RetiredCopy => ({ id: copy.id, name: copy.name, branch: copy.branch, retiredAt: copy.retiredAt ?? copy.updatedAt, retiredHead: copy.retiredHead, ships: copy.ships });
/** GET /api/project-copies?project= — git facts only; the client groups runs by copyId itself. */
export async function copiesView(project: string): Promise<CopiesRead> {
  if (project === 'vault') throw new HttpError(400, 'The brain has no builds');
  const cfg = games()[project]; if (!cfg) throw new HttpError(404, 'Unknown project');
  // every store read happens before the first await (see viewOf)
  const github = isGithub(project), live = liveCopies(project), retired = retiredCopies(project).slice(0, 20).map(retiredView);
  const ships = allCopies().filter(copy => copy.project === project).flatMap(copy => copy.ships.map(ship => ({ ...ship, copyId: copy.id, name: copy.name })))
    .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20);
  const plays = live.map(copy => playOf(cfg, copy));
  let branch = '', sha = '';
  try { branch = mainBranch(cfg); sha = await git(cfg.repo, 'rev-parse', '--verify', branch + '^{commit}'); } catch { /* an empty or detached repository */ }
  const copies = await Promise.all(live.map((copy, i) => viewOf(cfg, copy, plays[i])));
  return { project, mode: github ? 'github' : 'local', disabled: github ? 'github' : hasCheck(cfg.check) ? '' : 'no_check', limit: COPY_RULES.limit,
    main: { branch, sha }, copies, retired, ships, fetchedAt: Date.now() };
}
export async function copyView(project: string, id: string): Promise<CopyView> { return viewOf(projectConfig(project), liveCopy(project, id)); }

/* ------------------------------------------------------------------------------------------ create */

const work = new Map<string, { abort: AbortController; done: Promise<void> }>();
function nameProblem(project: string, name: string): CopyRefusal | undefined {
  if (!name) return refuse('nameEmpty');
  if (name.length > COPY_RULES.nameMax) return refuse('nameLong');
  if (!COPY_RULES.namePattern.test(name)) return refuse('nameShape');
  if (COPY_RULES.reserved.includes(name)) return refuse('nameReserved', { name });
  const live = liveCopies(project);
  if (live.some(copy => copy.name === name)) return refuse('nameTaken', { name });
  if (live.length >= COPY_RULES.limit) return refuse('tooMany');
}
/** copy.create — a real branch nibbi/copy/<name> at main's head, checked out in its own worktree under the work dir, and nowhere else.
    Every refusal happens before anything is written. Returns while its install runs (status 'creating'). */
export async function createCopy(project: string, rawName: string): Promise<CopyView> {
  const cfg = projectConfig(project);
  if (isGithub(project)) throw refuse('githubMode', { project });
  if (!hasCheck(cfg.check)) throw refuse('noCheck');
  const name = String(rawName ?? '');
  const record = await withRepoLock(cfg.repo, async () => {
    const problem = nameProblem(project, name); if (problem) throw problem;
    const branch = copyBranch(name), worktree = copyPath(project, name);
    try { await git(cfg.repo, 'check-ref-format', '--branch', branch); } catch { throw refuse('nameShape'); }
    if (await branchHead(cfg, branch)) throw refuse('branchExists', { branch });
    if (existsSync(worktree)) throw refuse('folderExists', { name, path: worktree });
    const base = mainBranch(cfg), baseSha = await git(cfg.repo, 'rev-parse', '--verify', base + '^{commit}');
    const at = now();
    const copy: CopyRecord = { id: 'copy-' + randomUUID(), project, name, branch, base, baseSha, worktree, headSha: baseSha, lastVerifiedSha: null, lastVerifiedAt: null,
      status: 'creating', createdAt: at, updatedAt: at, lastLandedAt: null, playedAt: null, error: null, ships: [], catchUps: [], intent: null, retiredAt: null, retiredHead: null };
    saveCopy(copy);
    try {
      mkdirSync(dirname(worktree), { recursive: true });
      // One command makes the branch and checks it out here: no stray branch if it fails.
      await git(cfg.repo, 'worktree', 'add', '-b', branch, worktree, baseSha);
    } catch (error) {
      try { if (await branchHead(cfg, branch) === baseSha && !(await checkedOutAt(cfg, branch)).length) await git(cfg.repo, 'branch', '-D', branch); }
      catch { /* leave what git left; the record still goes */ }
      removeCopyRecord(copy);
      throw new CopyRefusal('createFailed', firstLine(error));
    }
    return copy;
  });
  installCopy(cfg, record);
  return viewOf(cfg, copyById(record.id) ?? record);
}
function installCopy(cfg: GameCfg, copy: CopyRecord): void {
  const abort = new AbortController();
  const done = (async () => {
    try {
      if (cfg.install && cfg.install !== 'true') await sandboxCommand(copy.worktree, cfg.install, { signal: abort.signal, domains: cfg.installDomains ?? ['registry.npmjs.org'], readableRoots: [cfg.repo] });
      abort.signal.throwIfAborted();
      // A copy whose install changes files in it would never be clean: nothing could land or ship. It is broken.
      const dirty = await changedPaths(copy.worktree);
      if (dirty.length) throw new Error('its install changed files in it: ' + dirty.slice(0, 5).join(', '));
      if (copyById(copy.id)?.status === 'creating') patchCopy(copy.id, record => { record.status = 'ready'; record.error = null; });
    } catch (error) {
      if (copyById(copy.id)?.status === 'creating') {
        // What its own install changed goes back first, so retire (never forced) can remove the broken copy.
        await putBackInstall(copy).catch(() => undefined);
        patchCopy(copy.id, record => { record.status = 'broken'; record.error = abort.signal.aborted ? COPY_WORDS.stoppedWhileMaking : firstLine(error); });
      }
    } finally { work.delete(copy.id); }
  })();
  work.set(copy.id, { abort, done });
}
/** A copy still being made whose install changed files in it: each goes back as its checkout had it — a tracked file restored,
    a new one removed. Nothing of the owner's is in a copy before it is made; what git ignores (its node_modules) stays. */
async function putBackInstall(copy: CopyRecord): Promise<void> {
  const entries = await statusEntries(copy.worktree);
  const tracked = entries.filter(entry => entry.code !== '??').map(entry => entry.path);
  if (tracked.length) await git(copy.worktree, 'restore', '--worktree', '--', ...tracked);
  for (const entry of entries.filter(entry => entry.code === '??')) {
    const target = join(copy.worktree, entry.path);
    if (within(copy.worktree, target)) rmSync(target, { force: true });
  }
}
/** Tests and the fixtures: wait until a copy's background install has finished. */
export async function waitForCopy(id: string): Promise<void> { await work.get(id)?.done; }
/** Shutdown: a copy still being installed is stopped, and becomes broken. */
export async function stopCopyWork(): Promise<void> {
  for (const job of work.values()) job.abort.abort(new Error('Backend shutdown'));
  await Promise.allSettled([...work.values()].map(job => job.done));
}

/* ------------------------------------------------------------------------------------------ ship */

async function requireSteady(cfg: GameCfg, copy: CopyRecord, expectedHead: string): Promise<void> {
  if (copy.status !== 'ready') throw new CopyRefusal('notReady', notReadyWords(copy));
  const { health } = await copyHealth(cfg, copy); if (health !== 'ok') throw new CopyRefusal(health, healthWords(copy, health));
  if (expectedHead !== copy.headSha) throw refuse('headMoved', { name: copy.name });
}
/** copy.ship — the copy's head goes into main through the verified merge, where main is checked out. The copy stays, level with main. */
export async function shipCopy(project: string, id: string, expectedHead: string): Promise<{ copy: CopyView; shippedSha: string; runIds: string[] }> {
  const cfg = projectConfig(project);
  if (isGithub(project)) throw refuse('githubMode', { project });
  if (!hasCheck(cfg.check)) throw refuse('noCheck');
  try {
    return await withRepoLock(cfg.repo, async () => {
      const copy = liveCopy(project, id);
      await requireSteady(cfg, copy, expectedHead);
      if (!(await isAncestor(cfg, copy.base, copy.headSha))) throw refuse('shipBehind', { name: copy.name });
      if (await count(cfg, `${copy.base}..${copy.headSha}`) === 0) throw refuse('shipNothing', { name: copy.name });
      let on = ''; try { on = mergeTarget(cfg.repo); } catch { on = 'no branch'; }
      if (on !== copy.base) throw refuse('shipCheckoutOther', { branch: on, base: copy.base });
      if ((await changedPaths(cfg.repo)).length) throw refuse('shipCheckoutDirty');
      patchCopy(copy.id, record => { record.status = 'shipping'; });
      const result = await verifiedFastForward(cfg, { checkout: cfg.repo, branch: copy.base, retainOnFailure: false, expectCandidate: copy.headSha }, copy.headSha, {
        onIntent: intent => { patchCopy(copy.id, record => { record.intent = { kind: 'ship', ...intent, at: now() }; }); },
      });
      if (!result.ok) { patchCopy(copy.id, record => { record.status = 'ready'; record.intent = null; }); throw shipRefusal(result); }
      const runIds = await finishShip(cfg, copyById(copy.id)!, result.candidate, result.targetSha);
      return { copy: await viewOf(cfg, copyById(copy.id)!), shippedSha: result.candidate, runIds };
    });
  } finally { void landWaiting(project, id); }
}
function shipRefusal(result: MergeFailure): CopyRefusal {
  if (result.detail === 'Target branch changed or has local edits' || result.detail.startsWith('Target changed during verification')) return new CopyRefusal('changed', fill(COPY_WORDS.shipFailed, { detail: 'your project folder changed while nibbi checked it' }));
  return new CopyRefusal(result.reason, fill(COPY_WORDS.shipFailed, { detail: (result.reason === 'checkfail' ? 'the checks didn’t pass on what main would become: ' : '') + firstLine(new Error(result.detail)) }));
}
/** The bookkeeping of a ship, idempotent (crash recovery runs it again): every landed run of this copy that main now holds is done. */
async function finishShip(cfg: GameCfg, copy: CopyRecord, candidate: string, mainBefore: string): Promise<string[]> {
  const at = now();
  for (const run of listFixers().filter(run => run.copyId === copy.id && run.status === 'merged' && !run.shipped && run.commitSha)) {
    if (!(await isAncestor(cfg, run.commitSha!, candidate))) continue;
    const f = runtime().get<Fixer>('fixers', run.id)!;
    f.shipped = { at, sha: candidate, copyId: copy.id }; saveFixer(f);
    try { completeTask(f.game, f.taskId); completeLinkedIssues(f.game, f.issueIds); } catch (error) { runtime().emit({ type: 'roadmap.update_failed', runId: f.id, projectId: f.game, payload: { message: (error as Error).message } }); }
    noteDelivery(f);
  }
  const runIds = listFixers().filter(run => run.shipped?.copyId === copy.id && run.shipped.sha === candidate).map(run => run.id);
  patchCopy(copy.id, record => {
    if (!record.ships.some(ship => ship.sha === candidate && ship.mainBefore === mainBefore)) record.ships = [{ id: 'ship-' + randomUUID(), at, sha: candidate, mainBefore, runIds }, ...record.ships].slice(0, COPY_RULES.history);
    record.intent = null; record.status = 'ready';
  });
  return runIds;
}

/* ------------------------------------------------------------------------------------------ catch up */

/** copy.catchUp — main's newest merged into the copy in a verification worktree, checked, then fast-forwarded inside the copy's own worktree. Main is only read. */
export async function catchUpCopy(project: string, id: string, expectedHead: string, stopPlay = false): Promise<{ copy: CopyView }> {
  const cfg = projectConfig(project);
  if (isGithub(project)) throw refuse('githubMode', { project });
  try {
    return await withRepoLock(cfg.repo, async () => {
      const copy = liveCopy(project, id), preview = copyPreviewId(project, id);
      await requireSteady(cfg, copy, expectedHead);
      if (await count(cfg, `${copy.headSha}..${copy.base}`) === 0) throw refuse('catchUpLevel', { name: copy.name });
      if (previewStatus(preview).running) { if (!stopPlay) throw refuse('stillPlaying', { name: copy.name }); await stopAndWait(preview); }
      patchCopy(copy.id, record => { record.status = 'catching_up'; });
      const from = copy.headSha, mainSha = await git(cfg.repo, 'rev-parse', '--verify', copy.base + '^{commit}');
      const result = await verifiedFastForward(cfg, { checkout: copy.worktree, branch: copy.branch, expectHead: copy.headSha, retainOnFailure: false }, mainSha, {
        hold: () => previewStatus(preview).running ? fill(COPY_WORDS.stillPlaying, { name: copy.name }) : undefined,
        onIntent: intent => { patchCopy(copy.id, record => { record.intent = { kind: 'catchUp', ...intent, at: now() }; }); },
      });
      const at = now();
      if (!result.ok) {
        const reason = result.reason === 'waiting' ? 'changed' : result.reason;
        patchCopy(copy.id, record => { record.status = 'ready'; record.intent = null; record.catchUps = [{ at, ok: false, mainSha, from, to: null, reason, detail: result.detail, conflicts: result.conflicts }, ...record.catchUps].slice(0, COPY_RULES.history); });
        if (result.reason === 'conflict') throw refuse('catchUpConflict', { name: copy.name, files: result.conflicts.slice(0, 5).join(', ') || 'the same files' });
        if (result.reason === 'checkfail') throw refuse('catchUpCheckfail', { name: copy.name });
        throw new CopyRefusal(result.reason, result.reason === 'waiting' ? result.detail : fill(COPY_WORDS.catchUpRefused, { name: copy.name, detail: firstLine(new Error(result.detail)) }));
      }
      patchCopy(copy.id, record => {
        record.headSha = result.candidate; record.lastVerifiedSha = result.candidate; record.lastVerifiedAt = at; record.lastLandedAt = at; record.intent = null; record.status = 'ready';
        record.catchUps = [{ at, ok: true, mainSha, from, to: result.candidate, reason: '' as const, detail: '', conflicts: [] }, ...record.catchUps].slice(0, COPY_RULES.history);
      });
      const installError = await refreshInstall(cfg, copy.worktree, from, result.candidate);
      if (installError) patchCopy(copy.id, record => { record.error = installError; });
      return { copy: await viewOf(cfg, copyById(copy.id)!) };
    });
  } finally { void landWaiting(project, id); }
}

/* ------------------------------------------------------------------------------------------ play */

/** copy.play — one plays at a time: main's preview and every other copy's stop first (D3). */
export async function playCopy(project: string, id: string): Promise<{ url?: string; starting: boolean }> {
  const cfg = projectConfig(project);
  if (isGithub(project)) throw refuse('githubMode', { project });
  const copy = liveCopy(project, id);
  if (copy.status !== 'ready') throw new CopyRefusal('notReady', notReadyWords(copy));
  const { health } = await copyHealth(cfg, copy); if (health !== 'ok') throw new CopyRefusal(health, healthWords(copy, health));
  if (cfg.play && /^https?:\/\//.test(cfg.play)) throw refuse('fixedAddress', { project });
  const command = cfg.play || previewCommand(copy.worktree); if (!command) throw refuse('nothingToPlay', { name: copy.name });
  const own = copyPreviewId(project, id);
  await stopAndWait('project:' + project);
  for (const other of ownedPreviews().filter(preview => preview.startsWith('copy:' + project + ':') && preview !== own)) await stopAndWait(other);
  const preview = startPreview(own, copy.worktree, command, { onEnd: () => { void landWaiting(project, id); } });
  patchCopy(copy.id, record => { record.playedAt = now(); });
  return { ...(preview.url ? { url: preview.url } : {}), starting: preview.starting };
}
/** copy.stop — and then whatever waited for it lands. */
export async function stopCopy(project: string, id: string): Promise<string> {
  const copy = copyById(id); if (!copy || copy.project !== project) throw refuse('copyGone');
  await stopAndWait(copyPreviewId(project, id));
  await landWaiting(project, id);
  return copy.name + ' stopped playing';
}

/** Every staged run of a copy that waited (its copy played, or was busy) tries to land again, one at a time. */
export async function landWaiting(project: string, copyId?: string, options: { unattempted?: boolean } = {}): Promise<void> {
  const waiting = listFixers().filter(run => run.game === project && run.copyId && (!copyId || run.copyId === copyId) && ['staged', 'done'].includes(run.status)
    && run.verification?.status === 'passed' && (run.landing?.state === 'waiting' || options.unattempted && !run.landing));
  for (const run of waiting) await landOnCopy(run.id).catch(() => undefined);
}

/* ------------------------------------------------------------------------------------------ retire */

/** The repository's worktrees (git worktree list --porcelain): where each is and which branch it has checked out. */
async function worktrees(cfg: GameCfg): Promise<Array<{ path: string; branch: string }>> {
  const out = await git(cfg.repo, 'worktree', 'list', '--porcelain');
  return out.split('\n\n').map(block => block.split('\n')).map(lines => ({
    path: lines.find(line => line.startsWith('worktree '))?.slice('worktree '.length) ?? '',
    branch: lines.find(line => line.startsWith('branch refs/heads/'))?.slice('branch refs/heads/'.length) ?? '',
  })).filter(entry => entry.path);
}
const samePath = (a: string, b: string): boolean => canonicalPath(a) === canonicalPath(b);
async function checkedOutAt(cfg: GameCfg, branch: string): Promise<string[]> { return (await worktrees(cfg)).filter(entry => entry.branch === branch).map(entry => entry.path); }
/** copy.retire — the copy's own worktree and branch come off the machine, never forced, and only while they hold nothing but what
    nibbi put there; the record stays as a tombstone. */
export async function retireCopy(project: string, id: string, expectedHead: string): Promise<{ copy: RetiredCopy }> {
  const cfg = projectConfig(project);
  return withRepoLock(cfg.repo, async () => {
    const copy = liveCopy(project, id), previous = copy.status;
    if (previous !== 'ready' && previous !== 'broken') throw new CopyRefusal('notReady', notReadyWords(copy));
    if (listFixers().some(run => run.copyId === id && (buildIsActive(run.id) || ACTIVE.has(run.status) || run.status === 'queued'))) throw refuse('retireBuilding', { name: copy.name });
    if (expectedHead !== copy.headSha) throw refuse('headMoved', { name: copy.name });
    if (!within(config.workDir, copy.worktree)) throw refuse('notNibbis', { name: copy.name });
    const moved = await movedRefusal(cfg, copy); if (moved) throw moved;
    patchCopy(id, record => { record.status = 'retiring'; });
    try {
      await stopAndWait(copyPreviewId(project, id));
      await removeCopyWorktree(cfg, copy);
      await deleteBranch(cfg, copy);
    } catch (error) {
      patchCopy(id, record => { record.status = previous; });
      throw error instanceof CopyRefusal ? error : new CopyRefusal('retireFailed', firstLine(error));
    }
    const retired = patchCopy(id, record => { record.status = 'retired'; record.retiredAt = now(); record.retiredHead = record.headSha; record.intent = null; });
    pruneTombstones(project);
    return { copy: retiredView(retired) };
  });
}
/** Only the copy's own worktree, only clean, never forced: git must list it here with the copy's branch and nothing else there. */
async function removeCopyWorktree(cfg: GameCfg, copy: CopyRecord): Promise<void> {
  const listed = (await worktrees(cfg)).find(entry => samePath(entry.path, copy.worktree));
  if (!existsSync(copy.worktree)) { if (listed) await git(cfg.repo, 'worktree', 'remove', copy.worktree); return; }   // the folder went; git still lists it
  const dirty = await changedPaths(copy.worktree);
  if (dirty.length) throw refuse('retireDirty', { name: copy.name, files: dirty.slice(0, 5).join(', ') });
  const at = await checkedOutAt(cfg, copy.branch);
  if (!listed || at.length !== 1 || !samePath(at[0], copy.worktree)) throw refuse('notNibbis', { name: copy.name });
  await git(cfg.repo, 'worktree', 'remove', copy.worktree);
}
/** The copy's branch, or its folder's HEAD, isn't the head nibbi recorded: retire would drop what moved it, so it refuses —
    naming the commits past that head when there are any. (`branch -d` can't decide it: a copy's landings aren't in main.) */
async function movedRefusal(cfg: GameCfg, copy: CopyRecord): Promise<CopyRefusal | undefined> {
  const tips = [await branchHead(cfg, copy.branch)];
  let on = copy.branch;
  if (existsSync(copy.worktree)) {
    on = await git(copy.worktree, 'symbolic-ref', '--quiet', '--short', 'HEAD').catch(() => '');
    tips.push(await git(copy.worktree, 'rev-parse', '--verify', '--quiet', 'HEAD').catch(() => ''));
  }
  const moved = [...new Set(tips.filter(tip => tip && tip !== copy.headSha))];
  if (!moved.length && on === copy.branch) return undefined;
  const commits = moved.length ? (await git(cfg.repo, 'log', '--format=%h %s', '--max-count=5', ...moved, '--not', copy.headSha).catch(() => '')).split('\n').filter(Boolean) : [];
  return commits.length ? refuse('retireMoved', { name: copy.name, commits: commits.map(line => line.slice(0, 72)).join(', ') }) : new CopyRefusal('moved', fill(COPY_WORDS.moved, { name: copy.name }));
}
async function deleteBranch(cfg: GameCfg, copy: CopyRecord): Promise<void> {
  const tip = await branchHead(cfg, copy.branch); if (!tip) return;
  if ((await checkedOutAt(cfg, copy.branch)).length) throw refuse('notNibbis', { name: copy.name });
  // Checked again right before -D: nothing that isn't nibbi's head goes with the branch.
  if (tip !== copy.headSha) throw await movedRefusal(cfg, copy) ?? refuse('moved', { name: copy.name });
  await git(cfg.repo, 'branch', '-D', copy.branch);
}

/* ------------------------------------------------------------------------------------------ recovery */

/** main.ts, after reconcileFixers(): finish or drop what a crash interrupted, then let waiting landings land. */
export async function reconcileCopies(): Promise<void> {
  const projects = new Set<string>();
  for (const copy of allCopies()) {
    if (copy.status === 'retired') continue;
    const cfg = games()[copy.project]; if (!cfg) continue;
    projects.add(copy.project);
    try {
      if (copy.status === 'creating') patchCopy(copy.id, record => { record.status = 'broken'; record.error = COPY_WORDS.stoppedWhileMaking; });
      else if (copy.status === 'shipping') {
        const intent = copy.intent;
        if (intent?.kind === 'ship' && await isAncestor(cfg, intent.candidate, copy.base)) await finishShip(cfg, copy, intent.candidate, intent.targetSha);
        else patchCopy(copy.id, record => { record.intent = null; record.status = 'ready'; });
      } else if (copy.status === 'catching_up') {
        const intent = copy.intent, head = await branchHead(cfg, copy.branch);
        if (intent?.kind === 'catchUp' && head && (head === intent.candidate || await isAncestor(cfg, intent.candidate, head))) patchCopy(copy.id, record => {
          const at = now();
          record.catchUps = [{ at, ok: true, mainSha: '', from: record.headSha, to: intent.candidate, reason: '' as const, detail: '', conflicts: [] }, ...record.catchUps].slice(0, COPY_RULES.history);
          record.headSha = intent.candidate; record.lastVerifiedSha = intent.candidate; record.lastVerifiedAt = at; record.lastLandedAt = at; record.intent = null; record.status = 'ready';
        });
        else patchCopy(copy.id, record => { record.intent = null; record.status = 'ready'; });
      } else if (copy.status === 'retiring') {
        if (!existsSync(copy.worktree)) {
          await removeCopyWorktree(cfg, copy).then(() => deleteBranch(cfg, copy)).catch(() => undefined);
          patchCopy(copy.id, record => { record.status = 'retired'; record.retiredAt = now(); record.retiredHead = record.headSha; record.intent = null; });
        } else patchCopy(copy.id, record => { record.status = record.error ? 'broken' : 'ready'; });
      }
      // A landing interrupted after its fast-forward: reconcileFixers marked the run merged; the copy's head follows the branch.
      const current = copyById(copy.id)!;
      if (current.status !== 'retired') {
        const head = await branchHead(cfg, current.branch);
        if (head && head !== current.headSha && listFixers().some(run => run.copyId === current.id && run.status === 'merged' && run.mergeIntent?.candidate === head) && await isAncestor(cfg, current.headSha, head)) {
          const at = now();
          patchCopy(current.id, record => { record.headSha = head; record.lastVerifiedSha = head; record.lastVerifiedAt = at; record.lastLandedAt = at; });
        }
      }
    } catch (error) { runtime().emit({ type: 'copy.reconcile_failed', projectId: copy.project, payload: { copyId: copy.id, message: (error as Error).message } }); }
  }
  for (const project of projects) void landWaiting(project, undefined, { unattempted: true });
}

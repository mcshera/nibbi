import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { games, mergeTarget } from './projects.js';
import { runtime } from './store.js';
import { config } from './config.js';
import { safeEnvironment, git, withRepoLock } from './processes.js';
import { sandboxCommand } from './sandbox.js';
import { connectionFor, fetchGithubBranch } from './github-repositories.js';
import { bindingFor, isGithubBuild, prepareBuildBinding } from './github-builds.js';
import { queueFix, saveFixer, assertBuildWorktree, buildIsActive, runBuildAttempt, updateFixer, type Fixer } from './fixer.js';
import { previewStatus } from './previews.js';
import { canonicalPath } from './paths.js';

const runFile = promisify(execFile);
const digest = (text: string): string => createHash('sha256').update(text).digest('hex');
const maximumPatch = 20 * 1024 * 1024;
interface ChangeHunk { id: string; header: string; patch: string }
interface ChangeFile { path: string; originalPath?: string; status: string; binary: boolean; mode?: string; hunks: ChangeHunk[]; patch: string }
export interface LocalChanges { project: string; buildId?: string; sourceRevision: string; headSha: string; files: ChangeFile[] }
interface Selection { path: string; hunkIds?: string[] }
export interface LocalBuildReview {
  project: string; buildId?: string; sourceRevision?: string; headSha: string; selection?: Selection[];
  title?: string; instruction?: string; baseSha?: string; destination?: string; files?: Array<{ path: string; hunks: number; binary: boolean }>;
  scope?: { repo: string; gitCommonDir: string; connectionRevision: number; targetBranch: string };
}
async function reviewScope(project: string, buildId?: string): Promise<NonNullable<LocalBuildReview['scope']>> {
  const cfg = games()[project]; if (!cfg) throw new Error('Unknown project');
  const build = buildId ? runtime().get<Fixer>('fixers', buildId) : undefined;
  if (buildId && (!build || build.game !== project)) throw new Error('Build belongs to another project');
  const connection = buildId ? bindingFor(buildId)?.connection : connectionFor(project);
  return { repo: canonicalPath(cfg.repo), gitCommonDir: canonicalPath(await git(cfg.repo, 'rev-parse', '--path-format=absolute', '--git-common-dir')),
    connectionRevision: connection?.revision ?? 0, targetBranch: build?.targetBranch ?? (connection?.workflowMode === 'github' ? connection.integrationBranch : cfg.targetBranch ?? mergeTarget(cfg.repo)) };
}
async function indexGit(cwd: string, index: string, ...args: string[]): Promise<string> {
  const result = await runFile('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.quotePath=false', ...args], {
    cwd, env: { ...safeEnvironment(), GIT_INDEX_FILE: index, GIT_TERMINAL_PROMPT: '0' }, timeout: 30_000, maxBuffer: maximumPatch, encoding: 'utf8',
  });
  return result.stdout;
}
function splitHunks(patch: string): ChangeHunk[] {
  const starts = [...patch.matchAll(/^@@ .*@@.*$/gm)];
  return starts.map((match, i) => {
    const part = patch.slice(match.index, starts[i + 1]?.index ?? patch.length);
    return { id: digest(part), header: match[0], patch: part };
  });
}
async function source(project: string, buildId?: string): Promise<{ cwd: string; f?: Fixer }> {
  const cfg = games()[project]; if (!cfg) throw new Error('Unknown project');
  if (!buildId) return { cwd: cfg.repo };
  const f = runtime().get<Fixer>('fixers', buildId); if (!f || f.game !== project) throw new Error('Build belongs to another project');
  if (buildIsActive(buildId)) throw new Error('Wait for the active Build attempt to finish');
  await assertBuildWorktree(f); return { cwd: f.worktree, f };
}

/** A private index reads the final working files. The owner's index and checkout are never changed. */
export async function localChangesView(project: string, args: { buildId?: string } = {}): Promise<LocalChanges> {
  const { cwd } = await source(project, args.buildId);
  const folder = mkdtempSync(join(tmpdir(), 'nibbi-review-index-')), index = join(folder, 'index');
  try {
    const headSha = await git(cwd, 'rev-parse', '--verify', 'HEAD');
    await indexGit(cwd, index, 'read-tree', headSha);
    await indexGit(cwd, index, 'add', '--all', '--', '.');
    const names = (await indexGit(cwd, index, 'diff', '--cached', '--name-status', '-z', '--find-renames', headSha)).split('\0');
    const files: ChangeFile[] = [];
    for (let i = 0; i < names.length && names[i];) {
      const status = names[i++], first = names[i++];
      const path = /^[RC]/.test(status) ? names[i++] : first, originalPath = /^[RC]/.test(status) ? first : undefined;
      const patch = await indexGit(cwd, index, 'diff', '--cached', '--binary', '--full-index', '--no-ext-diff', '--no-textconv', '--find-renames', headSha, '--', ...new Set([path, ...(originalPath ? [originalPath] : [])]));
      const binary = patch.includes('GIT binary patch');
      files.push({ path, ...(originalPath ? { originalPath } : {}), status, binary,
        mode: patch.match(/^(?:new file mode|new mode|deleted file mode) (\d+)$/m)?.[1], hunks: binary || originalPath ? [] : splitHunks(patch), patch });
      if (files.length > 2500) throw new Error('Too many changed files; narrow the working checkout before reviewing');
    }
    if (await git(cwd, 'rev-parse', 'HEAD') !== headSha) throw new Error('Source branch changed during inspection; refresh');
    const sourceRevision = digest(JSON.stringify([headSha, files.map(f => [f.path, f.originalPath, f.patch])]));
    return { project, ...(args.buildId ? { buildId: args.buildId } : {}), sourceRevision, headSha, files };
  } finally { rmSync(folder, { recursive: true, force: true }); }
}
function selectedPatch(view: LocalChanges, input: unknown): { selection: Selection[]; patch: string } {
  if (!Array.isArray(input) || !input.length) throw new Error('Select at least one changed file or hunk');
  const selection: Selection[] = [], seen = new Set<string>(), patches: string[] = [];
  for (const item of input) {
    if (!item || typeof item.path !== 'string' || seen.has(item.path)) throw new Error('Invalid or duplicate file selection');
    const file = view.files.find(f => f.path === item.path); if (!file) throw new Error('Selected file changed or is no longer available');
    seen.add(item.path);
    if (item.hunkIds === undefined) { selection.push({ path: file.path }); patches.push(file.patch); continue; }
    if (!Array.isArray(item.hunkIds) || !item.hunkIds.length || !file.hunks.length || file.mode || file.originalPath) throw new Error('Select the whole binary, renamed, added, deleted, or mode-changed file');
    const ids: string[] = [...new Set(item.hunkIds as string[])];
    if (ids.some(id => !file.hunks.some(h => h.id === id))) throw new Error('A selected hunk changed; review again');
    const header = file.patch.slice(0, file.patch.indexOf('@@ '));
    patches.push(header + file.hunks.filter(h => ids.includes(h.id)).map(h => h.patch).join(''));
    selection.push({ path: file.path, hunkIds: ids });
  }
  const patch = patches.join(''); if (Buffer.byteLength(patch) > maximumPatch) throw new Error('Selected patch exceeds the 20 MB review limit');
  return { selection, patch };
}
function buildFor(project: string, id: unknown): Fixer {
  if (typeof id !== 'string') throw new Error('Select a Build');
  const f = runtime().get<Fixer>('fixers', id); if (!f || f.game !== project) throw new Error('Build belongs to another project');
  if (buildIsActive(id) || ['merged', 'discarded', 'superseded'].includes(f.status)) throw new Error('Build is not available for updates; start a replacement Build');
  if (previewStatus(id).running) throw new Error('Stop the Build preview before modifying it');
  return f;
}
export async function prepareLocalBuildOperation(name: string, project: string, args: Record<string, unknown>): Promise<LocalBuildReview> {
  const scope = await reviewScope(project, typeof args.buildId === 'string' ? args.buildId : undefined);
  if (name === 'build.adoptChanges' || name === 'build.checkpoint') {
    const f = name === 'build.checkpoint' ? buildFor(project, args.buildId) : undefined;
    const view = await localChangesView(project, { buildId: f?.id });
    if (view.sourceRevision !== args.sourceRevision) throw new Error('Local changes changed; review the selection again');
    const { selection } = selectedPatch(view, args.selection);
    const title = typeof args.title === 'string' ? args.title.trim().slice(0, 150) : '';
    if (!title) throw new Error('Give this change a title');
    return { project, buildId: f?.id, sourceRevision: view.sourceRevision, headSha: view.headSha, selection, title, scope,
      destination: f?.branch ?? connectionFor(project)?.integrationBranch ?? games()[project].targetBranch,
      files: selection.map(s => { const f = view.files.find(f => f.path === s.path)!; return { path: s.path, hunks: s.hunkIds?.length ?? f.hunks.length, binary: f.binary }; }) };
  }
  const f = buildFor(project, args.buildId); await assertBuildWorktree(f);
  const headSha = await git(f.worktree, 'rev-parse', 'HEAD');
  if (!f.commitSha || headSha !== f.commitSha || await git(f.worktree, 'status', '--porcelain')) throw new Error('Inspect and checkpoint retained edits before starting another attempt');
  if (name === 'build.update') {
    const instruction = typeof args.instruction === 'string' ? args.instruction.trim().slice(0, 100_000) : '';
    if (!instruction) throw new Error('Describe the requested update');
    return { project, buildId: f.id, headSha, instruction, destination: f.branch, scope };
  }
  if (name === 'build.updateBase') {
    const binding = bindingFor(f.id); if (!binding) throw new Error('This Build has no pinned GitHub integration base');
    const baseSha = await fetchGithubBranch(binding.connection, binding.baseBranch, 'build-base-review-' + f.id);
    return { project, buildId: f.id, headSha, baseSha, destination: f.branch, scope };
  }
  throw new Error('Unknown local Build operation');
}

async function applyReviewedPatch(worktree: string, patch: string, indexed = true): Promise<void> {
  const folder = mkdtempSync(join(tmpdir(), 'nibbi-reviewed-patch-')), file = join(folder, 'selection.patch');
  try {
    writeFileSync(file, patch, { mode: 0o600 });
    await git(worktree, 'apply', '--recount', ...(indexed ? ['--index'] : []), '--whitespace=nowarn', file);
  } finally { rmSync(folder, { recursive: true, force: true }); }
}
async function verifyAttempt(f: Fixer, signal: AbortSignal): Promise<void> {
  const cfg = games()[f.game];
  if (!cfg.check?.trim() || /^(true|:|echo\b.*)$/.test(cfg.check.trim())) return;
  f.status = 'verifying'; saveFixer(f);
  try {
    await sandboxCommand(f.worktree, cfg.check, { signal, readableRoots: [cfg.repo], onOutput: text => runtime().emit({ type: 'process.output', runId: f.id, projectId: f.game, payload: { text, phase: 'check', attemptId: f.attemptId } }) });
    f.verification = { status: 'passed', command: cfg.check, at: new Date().toISOString() };
  } catch (error) { f.verification = { status: 'failed', command: cfg.check, at: new Date().toISOString(), detail: (error as Error).message }; throw error; }
}
async function finishCommit(f: Fixer, title: string): Promise<void> {
  await git(f.worktree, 'commit', '-m', title);
  f.commitSha = await git(f.worktree, 'rev-parse', 'HEAD');
  f.verification = { ...(f.verification ?? { status: 'unverified' as const }), commitSha: f.commitSha };
  if (f.verification.status === 'passed') f.lastVerifiedSha = f.commitSha;
  f.diffstat = await git(f.worktree, 'diff', '--stat', f.baseSha!, f.commitSha);
  f.summary = title;
}
export async function executeLocalBuildOperation(name: string, project: string, review: LocalBuildReview, notify: (text: string) => Promise<void> = async () => undefined): Promise<Fixer> {
  if (review.project !== project) throw new Error('Review belongs to a different project');
  if (!review.scope || JSON.stringify(await reviewScope(project, review.buildId)) !== JSON.stringify(review.scope)) throw new Error('Reviewed repository, connection, or integration target changed; review this operation again');
  if (name === 'build.update') return updateFixer(buildFor(project, review.buildId).id, review.instruction ?? '', notify, review.headSha);
  if (name === 'build.updateBase') {
    const original = buildFor(project, review.buildId), binding = bindingFor(original.id);
    if (!binding || !review.baseSha) throw new Error('Review has no pinned base');
    return runBuildAttempt(original.id, 'updateBase', async (f, signal) => withRepoLock(f.repo!, async () => {
      await assertBuildWorktree(f);
      if (await git(f.worktree, 'rev-parse', 'HEAD') !== review.headSha || await git(f.worktree, 'status', '--porcelain')) throw new Error('Build changed since review');
      const base = await fetchGithubBranch(binding.connection, binding.baseBranch, 'build-base-' + f.id);
      if (base !== review.baseSha) throw new Error('Integration base changed; review again');
      let alreadyIncluded = false;
      try { await git(f.worktree, 'merge-base', '--is-ancestor', base, review.headSha); alreadyIncluded = true; } catch { /* The new base has commits to integrate. */ }
      if (alreadyIncluded) throw new Error('This Build already includes the current integration base');
      f.attemptBaseSha = base; saveFixer(f);
      signal.throwIfAborted();
      // --no-commit preserves a failed/conflicted merge for inspection without moving the verified branch head.
      await git(f.worktree, 'merge', '--no-ff', '--no-commit', base);
      await verifyAttempt(f, signal); signal.throwIfAborted();
      if (await git(f.worktree, 'rev-parse', 'HEAD') !== review.headSha) throw new Error('Verification changed Build history');
      await finishCommit(f, 'Update from ' + binding.baseBranch);
    }));
  }
  if (name !== 'build.adoptChanges' && name !== 'build.checkpoint') throw new Error('Unknown local Build operation');
  const original = name === 'build.checkpoint' ? buildFor(project, review.buildId) : undefined;
  const view = await localChangesView(project, { buildId: original?.id });
  if (view.headSha !== review.headSha || view.sourceRevision !== review.sourceRevision) throw new Error('Local changes changed after review; select them again');
  const { patch } = selectedPatch(view, review.selection);
  const f = original ?? queueFix(project, review.title!, { title: review.title }, 'adopt');
  return runBuildAttempt(f.id, original ? 'checkpoint' : 'adopt', async (current, signal) => withRepoLock(current.repo!, async () => {
    if (!original) {
      current.baseSha = isGithubBuild(current.id) ? (await prepareBuildBinding(project, current.id, current.branch))!.baseSha : await git(current.repo!, 'rev-parse', current.targetBranch!);
      mkdirSync(config.workDir, { recursive: true });
      await git(current.repo!, 'worktree', 'add', '-b', current.branch, current.worktree, current.baseSha!);
      await applyReviewedPatch(current.worktree, patch);
      const cfg = games()[project];
      if (cfg.install && cfg.install !== 'true') await sandboxCommand(current.worktree, cfg.install, { signal, readableRoots: [cfg.repo], domains: cfg.installDomains ?? ['registry.npmjs.org'] });
      await verifyAttempt(current, signal); signal.throwIfAborted();
      if (await git(current.worktree, 'rev-parse', 'HEAD') !== current.baseSha) throw new Error('Verification changed Build history');
      // Check execution may change files. Only the reviewed patch is committed; reject extra edits.
      if (await git(current.worktree, 'diff', '--name-only') || await git(current.worktree, 'ls-files', '--others', '--exclude-standard')) throw new Error('Verification changed files; inspect the retained work before checkpointing');
      await finishCommit(current, review.title!);
    } else {
      await assertBuildWorktree(current);
      // Build the selected commit in a private index, leaving all unselected edits and the real index intact.
      const folder = mkdtempSync(join(tmpdir(), 'nibbi-checkpoint-index-')), index = join(folder, 'index'), patchFile = join(folder, 'selection.patch');
      try {
        if (await git(current.worktree, 'rev-parse', 'HEAD') !== review.headSha) throw new Error('Build head changed since review');
        // Resolved base merges retain their second parent; partial or unresolved merges cannot be checkpointed.
        const mergeHead = await git(current.worktree, 'rev-parse', '--verify', '-q', 'MERGE_HEAD').catch(() => '');
        if (mergeHead && (await git(current.worktree, 'ls-files', '--unmerged') || review.selection?.some(s => s.hunkIds) || review.selection?.length !== view.files.length)) throw new Error('Resolve the base-merge conflicts and select every changed file before checkpointing this merge');
        await indexGit(current.worktree, index, 'read-tree', review.headSha);
        writeFileSync(patchFile, patch, { mode: 0o600 });
        await indexGit(current.worktree, index, 'apply', '--cached', '--recount', patchFile);
        const tree = (await indexGit(current.worktree, index, 'write-tree')).trim();
        const sha = await git(current.worktree, 'commit-tree', tree, '-p', review.headSha, ...(mergeHead ? ['-p', mergeHead] : []), '-m', review.title!);
        signal.throwIfAborted();
        await git(current.worktree, 'update-ref', 'refs/heads/' + current.branch, sha, review.headSha);
        // Mixed reset updates only this backend-owned worktree's index to the new head, preserving every working file.
        await git(current.worktree, 'reset', '--mixed', sha);
        current.commitSha = sha; current.verification = { status: 'unverified', commitSha: sha, detail: 'Explicit checkpoint; checks have not passed for this commit' };
        current.diffstat = await git(current.worktree, 'diff', '--stat', current.baseSha ?? review.headSha, sha); current.summary = review.title;
      } finally { rmSync(folder, { recursive: true, force: true }); }
    }
  }));
}

export interface RemoteAdoptionReview { buildId: string; headSha: string; remoteSha: string; branch: string; worktree: string }
/** Fast-forward the Build branch to commits another client published. Never merges, rebases or rewrites; the new head is unverified. */
export async function adoptRemoteCommits(project: string, review: RemoteAdoptionReview): Promise<Fixer> {
  const original = buildFor(project, review.buildId), binding = bindingFor(original.id);
  if (!binding || binding.branch !== review.branch) throw new Error('This Build has no pinned GitHub destination for that branch');
  const cfg = games()[project]; if (!cfg) throw new Error('Unknown project');
  return runBuildAttempt(original.id, 'adoptRemote', async (f, signal) => withRepoLock(cfg.repo, async () => {
    await assertBuildWorktree(f);
    if (f.worktree !== review.worktree || await git(f.worktree, 'rev-parse', 'HEAD') !== review.headSha || f.commitSha !== review.headSha) throw new Error('Build head changed since review; review the remote commits again');
    if (await git(f.worktree, 'status', '--porcelain')) throw new Error('Retained edits need an explicit checkpoint before adopting remote commits');
    const fetched = await fetchGithubBranch(binding.connection, binding.branch, 'build-remote-' + f.id);
    if (fetched !== review.remoteSha) throw new Error('Remote branch changed after review; refresh and review again');
    let fastForward = false;
    try { await git(f.worktree, 'merge-base', '--is-ancestor', review.headSha, review.remoteSha); fastForward = true; } catch { /* Divergent history is rejected below. */ }
    if (!fastForward) throw new Error('Remote branch diverged from this Build; Nibbi will not merge or rewrite it');
    signal.throwIfAborted();
    await git(f.worktree, 'merge', '--ff-only', review.remoteSha);
    if (await git(f.worktree, 'rev-parse', 'HEAD') !== review.remoteSha) throw new Error('Fast-forward did not reach the reviewed remote head');
    f.attemptBaseSha = f.baseSha; f.commitSha = review.remoteSha;
    f.verification = { status: 'unverified', commitSha: review.remoteSha, detail: 'Adopted commits published outside Nibbi; checks have not run for this head' };
    f.diffstat = await git(f.worktree, 'diff', '--stat', f.baseSha ?? review.headSha, review.remoteSha);
    f.summary = 'Adopted remote commits ' + review.headSha.slice(0, 12) + '..' + review.remoteSha.slice(0, 12) + ' from ' + binding.connection.repository;
  }));
}

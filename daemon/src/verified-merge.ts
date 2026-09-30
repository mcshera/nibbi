// The one verified-merge sequence (docs/BUILDS-AS-COPIES.md §2.4.4): lifted whole from integrate(), with a
// destination. Runs landing in main or in a copy, a copy shipping to main, and a copy catching up all go
// through it. A branch only ever moves by `merge --ff-only` run inside the checkout that has it checked out,
// after the checks passed on exactly that tree in a throwaway merge-<uuid> worktree.
// The caller holds withRepoLock(cfg.repo); nothing here takes it.
import { existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { execute, git, ProcessFailure } from './processes.js';
import { sandboxCommand } from './sandbox.js';
import { mergeTarget, type GameCfg } from './projects.js';
import { canonicalPath, within } from './paths.js';
import { runtime } from './store.js';

export interface MergeDestination {
  /** The checkout that has `branch` checked out: cfg.repo for main, the copy's worktree for a copy. */
  checkout: string;
  branch: string;
  /** A copy's recorded head: the branch must still be there. */
  expectHead?: string;
  /** Main keeps today's behaviour (a failed merge's worktree stays for inspection); copies remove theirs. */
  retainOnFailure: boolean;
  /** Ship: the merge must be a fast-forward to exactly this commit (the head that was played). */
  expectCandidate?: string;
}
export interface MergeIntent { candidate: string; targetSha: string; integration: string }
export interface MergeHooks {
  /** After the destination guard, before anything is made: a reason the source changed (integrate's :338 guard). */
  preflight?: () => Promise<string | undefined>;
  /** Checked again just before the fast-forward: a reason to wait (a copy that started playing). */
  hold?: () => string | undefined;
  /** The intent is recorded before the destination moves, so crash recovery can finish or drop it. */
  onIntent?: (intent: MergeIntent) => void | Promise<void>;
}
/** A copy destination's throwaway, written down before it exists (bucket pending-merges, id = its folder's name): a crash
    between `worktree add` and its removal would otherwise leave it on disk and in git's list for good. */
interface PendingMerge { id: string; repo: string; integration: string; at: string }
const PENDING = 'pending-merges';
/** This process's own throwaways, still in use: boot's sweep never touches one. */
const inUse = new Set<string>();
export type MergeFailure = { ok: false; reason: 'conflict' | 'checkfail' | 'changed' | 'waiting'; detail: string; conflicts: string[] };
export type MergeResult = { ok: true; candidate: string; targetSha: string; integration: string } | MergeFailure;

export const firstLine = (error: unknown): string => {
  const text = error instanceof ProcessFailure ? (error.result.stderr || error.result.stdout).trim() || error.message : (error as Error)?.message ?? String(error);
  return text.split('\n').map(line => line.trim()).find(Boolean) ?? 'failed';
};
/** Porcelain paths, untrimmed (git() trims the first line's leading status column away). */
export async function changedPaths(cwd: string): Promise<string[]> {
  const out = (await execute(cwd, 'git', ['-c', 'core.hooksPath=/dev/null', 'status', '--porcelain', '--untracked-files=all'])).stdout;
  return out.split('\n').filter(Boolean).map(line => line.slice(3));
}
/** `status --porcelain -z`: each entry's two-letter code and its path, read without quoting. `ignored` lists what git ignores
    too ('!!'; a folder that is ignored whole is one entry ending in '/'), and untracked folders as one entry each. */
export async function statusEntries(cwd: string, options: { ignored?: boolean } = {}): Promise<Array<{ code: string; path: string }>> {
  const out = (await execute(cwd, 'git', ['-c', 'core.hooksPath=/dev/null', 'status', '--porcelain', '-z', ...(options.ignored ? ['--ignored'] : ['--untracked-files=all'])])).stdout;
  const fields = out.split('\0'), entries: Array<{ code: string; path: string }> = [];
  for (let i = 0; i < fields.length; i++) {
    if (!fields[i]) continue;
    entries.push({ code: fields[i].slice(0, 2), path: fields[i].slice(3) });
    if (/^[RC]/.test(fields[i])) i++;   // a rename's original path follows it
  }
  return entries;
}
/** What git ignores in a checkout: `git status --porcelain` never lists it, and `worktree remove` deletes it without --force. */
export async function ignoredPaths(cwd: string): Promise<string[]> {
  return (await statusEntries(cwd, { ignored: true })).filter(entry => entry.code === '!!').map(entry => entry.path);
}
const clean = async (cwd: string): Promise<boolean> => !(await git(cwd, 'status', '--porcelain'));
const isMergeWorktree = (path: string): boolean => /^merge-[0-9a-f-]{36}$/.test(basename(path)) && within(config.workDir, path);

export async function verifiedFastForward(cfg: GameCfg, dest: MergeDestination, source: string, hooks: MergeHooks = {}): Promise<MergeResult> {
  let integration = '';
  const fail = async (reason: MergeFailure['reason'], detail: string, conflicts: string[] = []): Promise<MergeFailure> => {
    if (integration && !dest.retainOnFailure) await discard(cfg.repo, integration);
    return { ok: false, reason, detail, conflicts };
  };
  try {
    // 1. The destination is checked out where we expect, on its branch, clean.
    if (mergeTarget(dest.checkout) !== dest.branch || !(await clean(dest.checkout))) return fail('changed', 'Target branch changed or has local edits');
    const early = await hooks.preflight?.(); if (early) return fail('changed', early);
    // 2. Its head, as the shared refs say.
    const targetSha = await git(cfg.repo, 'rev-parse', dest.branch);
    if (dest.expectHead && targetSha !== dest.expectHead) return fail('changed', 'The branch moved outside nibbi; nothing was merged');
    // 3. A throwaway worktree at that head.
    mkdirSync(config.workDir, { recursive: true });
    integration = join(config.workDir, 'merge-' + randomUUID());
    if (!dest.retainOnFailure) { inUse.add(integration); runtime().put<PendingMerge>(PENDING, basename(integration), { id: basename(integration), repo: cfg.repo, integration, at: new Date().toISOString() }); }
    await git(cfg.repo, 'worktree', 'add', '--detach', integration, targetSha);
    // 4. The merge, off to the side.
    try { await git(integration, 'merge', '--no-edit', ...(dest.expectCandidate ? ['--ff-only'] : []), source); }
    catch {
      const conflicts = (await git(integration, 'diff', '--name-only', '--diff-filter=U').catch(() => '')).split('\n').filter(Boolean);
      if (dest.retainOnFailure) return fail('conflict', 'Target unchanged. Integration worktree retained: ' + integration, conflicts);
      await git(integration, 'merge', '--abort').catch(() => undefined);
      return fail('conflict', conflicts.length ? 'Target unchanged. Both changed: ' + conflicts.join(', ') : 'Target unchanged. The merge could not be made', conflicts);
    }
    // 5. The checks, on exactly the tree the destination would become.
    if (cfg.install && cfg.install !== 'true') await sandboxCommand(integration, cfg.install, { domains: cfg.installDomains ?? ['registry.npmjs.org'], readableRoots: [cfg.repo] });
    try { await sandboxCommand(integration, cfg.check, { readableRoots: [cfg.repo] }); }
    catch (error) { return fail('checkfail', (error as Error).message); }
    // 6. What passed is what moves.
    const candidate = await git(integration, 'rev-parse', 'HEAD');
    if (!(await clean(integration))) return fail('changed', 'Verification changed tracked/untracked files; inspect ' + integration);
    if (dest.expectCandidate && candidate !== dest.expectCandidate) return fail('changed', 'The merged head is not the one that was played; nothing was merged');
    // 7. Nothing moved while it was checked.
    if (mergeTarget(dest.checkout) !== dest.branch || await git(dest.checkout, 'rev-parse', 'HEAD') !== targetSha || !(await clean(dest.checkout))) return fail('changed', 'Target changed during verification; no merge performed');
    const held = hooks.hold?.(); if (held) return fail('waiting', held);
    // 8–9. The intent, then the one move: a fast-forward inside the destination's own checkout.
    await hooks.onIntent?.({ candidate, targetSha, integration });
    await git(dest.checkout, 'merge', '--ff-only', candidate);
    // 10. The throwaway goes. Main keeps today's gentle removal; a copy's may hold an install, so it goes whole.
    if (dest.retainOnFailure) await git(cfg.repo, 'worktree', 'remove', integration).catch(() => undefined);
    else await discard(cfg.repo, integration);
    return { ok: true, candidate, targetSha, integration };
  } catch (error) { return fail('changed', (error as Error).message); }
}

/** Removes a merge-<uuid> worktree this module made — the only place anything is removed with force — and, once it is gone
    from disk, what was written down about it. A folder already gone but still in git's list goes from the list too. */
async function discard(repo: string, integration: string): Promise<void> {
  if (!isMergeWorktree(integration) || canonicalPath(integration) === canonicalPath(repo)) return;
  await git(repo, 'worktree', 'remove', '--force', integration).catch(() => undefined);
  if (!existsSync(integration)) { runtime().remove(PENDING, basename(integration)); inUse.delete(integration); }
}
/** Boot (reconcileCopies, before anything lands): a copy's throwaway written down and never removed — the backend stopped in the
    middle of a landing, a ship or a catch-up — goes now. Recovery reads refs and intents, never a throwaway. */
export async function discardPendingMerges(): Promise<void> {
  for (const pending of runtime().list<PendingMerge>(PENDING)) {
    if (inUse.has(pending.integration)) continue;
    if (!isMergeWorktree(pending.integration)) { runtime().remove(PENDING, pending.id); continue; }
    await discard(pending.repo, pending.integration);
  }
}

const LOCKFILES = new Set(['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml']);
/** After a copy's head changed: reinstall in its worktree when the dependency files changed. `error` is '' or the failure's first
    line; `installed`, what git ignores that the install left there and that wasn't there before it (nibbi's, for retire). */
export async function refreshInstall(cfg: GameCfg, worktree: string, from: string, to: string): Promise<{ error: string; installed: string[] }> {
  if (!cfg.install || cfg.install === 'true' || from === to) return { error: '', installed: [] };
  let before: string[] | undefined;
  const added = async (): Promise<string[]> => before ? (await ignoredPaths(worktree).catch(() => [])).filter(path => !before!.includes(path)) : [];
  try {
    const changed = (await git(cfg.repo, 'diff', '--name-only', from, to)).split('\n').filter(Boolean);
    if (!changed.some(path => LOCKFILES.has(basename(path)))) return { error: '', installed: [] };
    before = await ignoredPaths(worktree);
    await sandboxCommand(worktree, cfg.install, { domains: cfg.installDomains ?? ['registry.npmjs.org'], readableRoots: [cfg.repo] });
    return { error: '', installed: await added() };
  } catch (error) { return { error: 'its install failed after the change landed: ' + firstLine(error), installed: await added() }; }
}

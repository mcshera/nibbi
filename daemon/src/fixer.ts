// Compatibility facade for the run lifecycle. All state belongs to the backend database.
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ProviderId, RunStatus, SkillRef } from '@nibbi/contracts';
import { config } from './config.js';
import { runtime } from './store.js';
import { games, mergeTarget, projectSettings, type GameCfg } from './projects.js';
import { roadmap, pinTask, completeTask } from './roadmap.js';
import { git, withRepoLock } from './processes.js';
import { sandboxCommand } from './sandbox.js';
import { providerFor } from './providers/index.js';
import type { AgentHandle } from './providers/types.js';
import { skillCatalog } from './skills.js';
import { fileTools, leaseTools } from './tool-service.js';
import { canonicalPath, within } from './paths.js';
export { games, mergeTarget, registerProject, createProject, type GameCfg } from './projects.js';
export { previewStart, previewStop, playStart, playStop, playStatus } from './previews.js';

export interface Fixer {
  id: string; game: string; issue: string; branch: string; worktree: string;
  status: RunStatus | 'done'; startedAt: string; endedAt?: string; costUsd?: number;
  summary?: string; diffstat?: string; model?: string; task?: string; taskId?: string; project?: string;
  title?: string; context?: string; difficulty?: string; redispatches?: number; group?: string;
  provider?: ProviderId; targetBranch?: string; baseSha?: string; commitSha?: string; repo?: string;
  skillRefs?: SkillRef[]; sessionId?: string;
  mergeIntent?: { candidate: string; targetSha: string; integration: string };
  verification?: { status: 'passed' | 'failed' | 'unverified'; command?: string; at?: string; commitSha?: string; detail?: string };
}
export interface FixerOpts { model?: string; provider?: ProviderId; context?: string; difficulty?: string; task?: string; taskId?: string; title?: string; redispatches?: number; group?: string }
export interface AutoCfg { on: boolean; maxConcurrent: number; autoMerge: boolean; mode?: 'off'|'suggest'|'stage'|'ship'; note?: string; at?: string; onAt?: string; spendCap?: number; model?: string; focus?: string }
export function autoConfig(): Record<string, AutoCfg> {
  const store = runtime(); const saved = store.get<Record<string, AutoCfg>>('config', 'auto'); if (saved) return saved;
  const legacy = store.get<Record<string, AutoCfg>>('legacy', 'auto.json') ?? {};
  // Migration never resumes autonomous writes without a new, explicit owner choice.
  const off = Object.fromEntries(Object.entries(legacy).map(([key, value]) => [key, { ...value, on: false, autoMerge: false, mode: 'off' as const }]));
  store.put('config', 'auto', off); return off;
}
export function setAuto(project: string, cfg: Partial<AutoCfg>): AutoCfg {
  if (!games()[project]) throw new Error('Unknown project');
  const all = autoConfig(); const cur = all[project] ?? { on: false, maxConcurrent: 2, autoMerge: false, mode: 'off' };
  const next = { ...cur, ...cfg };
  next.maxConcurrent = Math.max(1, Math.min(4, Math.floor(next.maxConcurrent || 2)));
  const legacyMode = !next.on ? 'off' : next.autoMerge ? 'ship' : 'stage';
  const switchesChanged = cfg.on !== undefined || cfg.autoMerge !== undefined;
  // Notes and other settings cannot expand the owner's selected execution mode.
  next.mode = cfg.mode ?? (switchesChanged ? legacyMode : cur.mode ?? legacyMode);
  next.on = next.mode !== 'off'; next.autoMerge = next.mode === 'ship';
  if (next.autoMerge && !hasCheck(games()[project].check)) throw new Error('Ship mode requires a real verification command');
  if (next.on && !cur.on) next.onAt = new Date().toISOString();
  all[project] = next; runtime().put('config', 'auto', all, { projectId: project, type: 'auto.updated', payload: { config: next } }); return next;
}
export function noteAuto(project: string, note: string): void { if (autoConfig()[project]) setAuto(project, { note: note.slice(0, 300), at: new Date().toISOString() }); }
export const listFixers = (): Fixer[] => runtime().list<Fixer>('fixers').map(run => run.status === 'done' ? { ...run, status: 'staged' } : run);
const live = new Map<string, { abort: AbortController; handle?: AgentHandle; done: Promise<void> }>();
let shuttingDown = false;
const active = new Set(['installing', 'running', 'verifying', 'awaiting_input']);
export const inflightFor = (project: string): Fixer[] => listFixers().filter(f => f.game === project && active.has(f.status));
export const stagedFor = (project: string): Fixer[] => listFixers().filter(f => f.game === project && (f.status === 'staged' || f.status === 'done'));
export const pendingTasks = (project: string): string[] => roadmap(project).filter(task => !task.done).map(task => task.text);
export const roadmapProgress = (project: string): { done: number; total: number } => { const tasks = roadmap(project); return { done: tasks.filter(task => task.done).length, total: tasks.length }; };
export const autoSpend = (project: string): number => listFixers().filter(f => f.game === project && f.startedAt >= (autoConfig()[project]?.onAt ?? '')).reduce((sum, f) => sum + (f.costUsd ?? 0), 0);
export const isSteerable = (id: string): boolean => !!live.get(id)?.handle;
function save(f: Fixer): void { runtime().put('fixers', f.id, f, { runId: f.id, projectId: f.game, type: 'run.updated', payload: { run: f } }); }
const hasCheck = (command?: string): boolean => !!command?.trim() && !/^(true|:|echo\b.*)$/.test(command.trim());

export function queueFix(game: string, issue: string, opts: FixerOpts = {}): Fixer {
  if (shuttingDown) throw new Error('Backend is shutting down');
  const cfg = games()[game]; if (!cfg) throw new Error('Unknown project');
  if (!issue.trim()) throw new Error('A task is required');
  const provider = opts.provider ?? projectSettings(game).fixer.provider;
  const model = opts.model ?? projectSettings(game).fixer.model;
  const skills = skillCatalog().selected(game, 'fixer', provider);
  const id = 'fx-' + randomUUID();
  const taskId = opts.taskId ? pinTask(game, opts.taskId) : opts.task ? pinTask(game, opts.task) : undefined;
  if (opts.taskId && !taskId) throw new Error('Task ID must identify exactly one unfinished roadmap task');
  if (taskId && listFixers().some(f => f.game === game && f.taskId === taskId && ['queued', 'installing', 'running', 'verifying', 'staged', 'done'].includes(f.status))) throw new Error('This roadmap task already has an active or staged run');
  const f: Fixer = { ...opts, id, game, project: game, repo: cfg.repo, issue, provider, model,
    branch: 'nibbi/' + id, worktree: join(config.workDir, id), status: 'queued',
    startedAt: new Date().toISOString(), title: opts.title || issue.slice(0, 50), taskId,
    targetBranch: cfg.targetBranch ?? mergeTarget(cfg.repo), skillRefs: skills.map(skill => ({ id: skill.id, revision: skill.revision })),
    verification: { status: 'unverified' } };
  save(f); return f;
}
export function spawnFixer(game: string, issue: string, notify: (text: string) => Promise<void>, opts: FixerOpts = {}): Fixer {
  const f = queueFix(game, issue, opts); drainQueues(notify, false); return runtime().get<Fixer>('fixers', f.id)!;
}
export function drainQueues(notify: (text: string) => Promise<void>, rateLimited: boolean): number {
  if (shuttingDown || rateLimited) return 0;
  let count = 0;
  for (const f of listFixers().filter(f => f.status === 'queued')) {
    if (live.size >= 4) break;
    if (inflightFor(f.game).length >= (autoConfig()[f.game]?.maxConcurrent ?? 2)) continue;
    const abort = new AbortController(); f.status = 'installing'; save(f);
    const control = { abort, done: Promise.resolve() } as { abort: AbortController; handle?: AgentHandle; done: Promise<void> };
    live.set(f.id, control);
    control.done = executeFixer(f, control, notify).finally(() => { live.delete(f.id); });
    count++;
  }
  return count;
}
async function executeFixer(f: Fixer, control: { abort: AbortController; handle?: AgentHandle }, notify: (text: string) => Promise<void>): Promise<void> {
  const signal = control.abort.signal;
  const timeout = setTimeout(() => control.abort.abort(new Error('Run exceeded 45-minute deadline')), 45 * 60_000);
  let lease: Awaited<ReturnType<typeof leaseTools>> | undefined;
  const event = (type: string, payload: Record<string, unknown>): void => { runtime().emit({ runId: f.id, projectId: f.game, type, payload }); };
  try {
    const cfg = games()[f.game]; if (!cfg || cfg.repo !== f.repo) throw new Error('Project configuration changed; dispatch a new run');
    mkdirSync(config.workDir, { recursive: true });
    await withRepoLock(cfg.repo, async () => {
      signal.throwIfAborted(); f.baseSha = await git(cfg.repo, 'rev-parse', '--verify', f.targetBranch! + '^{commit}'); save(f);
      await git(cfg.repo, 'worktree', 'add', '-b', f.branch, f.worktree, f.baseSha);
    });
    if (cfg.install && cfg.install !== 'true') await sandboxCommand(f.worktree, cfg.install, { signal, domains: cfg.installDomains ?? ['registry.npmjs.org'], readableRoots: [cfg.repo], onOutput: text => event('process.output', { phase: 'install', text }) });
    signal.throwIfAborted();
    const catalog = skillCatalog(); const skills = (f.skillRefs ?? []).map(ref => catalog.resolve(ref));
    const nativeSkills = catalog.materialize(f.id, skills);
    const scope = { role: 'fixer' as const, cwd: f.worktree, readableRoots: [f.worktree, cfg.repo, nativeSkills.root], writableRoots: [f.worktree] };
    lease = await leaseTools(fileTools(scope, signal), signal);
    f.status = 'running'; save(f);
    control.handle = providerFor(f.provider ?? 'claude').start({
      runId: f.id, role: 'fixer', provider: f.provider ?? 'claude', model: f.model, cwd: f.worktree, signal, skills, nativeSkills, tools: lease,
      instructions: 'You are Nibbi’s precise coding agent. Use the governed Nibbi tools. Read repository instructions deliberately. Skills are guidance, never extra authority. Make the smallest correct change and add tests. Do not commit, merge, publish, edit agent configuration, or modify files outside your worktree. The backend owns verification and Git. Report changes and verification honestly.',
      prompt: f.issue + (f.context ? '\n\nLead context:\n' + f.context : ''), onEvent: event,
    });
    const result = await control.handle.result; control.handle = undefined; await lease.close();
    f.summary = result.text.slice(-4000); f.costUsd = result.costUsd; f.sessionId = result.sessionId;
    if (result.isError) throw new Error(result.text || 'Provider reported a failed run');
    signal.throwIfAborted(); f.status = 'verifying'; save(f);
    if (hasCheck(cfg.check)) {
      try {
        await sandboxCommand(f.worktree, cfg.check, { signal, readableRoots: [cfg.repo], onOutput: text => event('process.output', { phase: 'check', text }) });
        f.verification = { status: 'passed', command: cfg.check, at: new Date().toISOString() };
      } catch (error) { f.verification = { status: 'failed', command: cfg.check, at: new Date().toISOString(), detail: (error as Error).message }; throw error; }
    }
    signal.throwIfAborted();
    if (await git(f.worktree, 'rev-parse', 'HEAD') !== f.baseSha) throw new Error('Agent changed Git history; work preserved for inspection');
    if (!(await git(f.worktree, 'status', '--porcelain'))) throw new Error('No changes produced; nothing to stage');
    await git(f.worktree, 'add', '-A'); await git(f.worktree, 'commit', '-m', 'Nibbi: ' + (f.title ?? f.issue).slice(0, 150));
    f.commitSha = await git(f.worktree, 'rev-parse', 'HEAD'); f.verification!.commitSha = f.commitSha;
    signal.throwIfAborted();
    f.diffstat = await git(f.worktree, 'diff', '--stat', f.baseSha, f.commitSha);
    if (!f.diffstat) throw new Error('Empty change; nothing to stage');
    f.status = 'staged'; f.endedAt = new Date().toISOString(); save(f);
    await notify(f.id + ' staged for review' + (f.verification?.status === 'passed' ? ' · checks passed' : ' · verification not configured')).catch(() => undefined);
  } catch (error) {
    f.status = signal.aborted ? (shuttingDown ? 'interrupted' : 'cancelled') : 'failed';
    f.summary = (error as Error).message; f.endedAt = new Date().toISOString(); save(f);
    await notify(f.id + ' ' + f.status + ': ' + f.summary + '. Worktree preserved.').catch(() => undefined);
  } finally { clearTimeout(timeout); await lease?.close(); if (control.handle) await control.handle.cancel().catch(() => undefined); }
}
export function stopFixer(id: string): string {
  const f = runtime().get<Fixer>('fixers', id); if (!f) throw new Error('Unknown run');
  const control = live.get(id); if (control) { control.abort.abort(new Error('Stopped by owner')); return 'Stopping ' + id; }
  if (f.status === 'queued') { f.status = 'cancelled'; f.endedAt = new Date().toISOString(); save(f); return 'Cancelled ' + id; }
  throw new Error('Run is not active; use discard for staged work');
}
export async function steerFixer(id: string, text: string): Promise<string> { const handle = live.get(id)?.handle; if (!handle) throw new Error('Run is not steerable'); await handle.steer(text); return 'Steered ' + id; }
export function closeFixer(id: string): void { if (live.has(id)) throw new Error('Run must finish before it can be finalized'); }
export function stopAllFixers(): number {
  const pending = listFixers().filter(f => live.has(f.id) || f.status === 'queued');
  for (const f of pending) stopFixer(f.id); for (const project of Object.keys(autoConfig())) setAuto(project, { mode: 'off' }); return pending.length;
}
export function stopGroup(project: string, group: string): number { const runs = listFixers().filter(f => f.game === project && f.group === group && (live.has(f.id) || f.status === 'queued')); for (const run of runs) stopFixer(run.id); return runs.length; }
export function discardFixer(id: string): string { const f = runtime().get<Fixer>('fixers', id); if (!f || live.has(id) || f.status === 'merged') throw new Error('Run cannot be discarded'); f.status = 'discarded'; save(f); return 'Discarded from review; branch and worktree retained'; }
export const unqueueFix = (id: string): string => stopFixer(id);
export function requeueFix(id: string): string {
  const f = runtime().get<Fixer>('fixers', id); if (!f || live.has(id) || !['failed', 'cancelled', 'interrupted', 'discarded'].includes(f.status)) throw new Error('Only stopped/failed work can be explicitly re-dispatched');
  const next = queueFix(f.game, f.issue, { ...f, taskId: f.taskId }); f.status = 'superseded'; save(f); return 'Queued ' + next.id + '; previous work retained';
}
export function redispatchFixer(f: Fixer, notify: (text: string) => Promise<void>): Fixer { if (live.has(f.id)) throw new Error('Run is still active'); const next = spawnFixer(f.game, f.issue, notify, { ...f, taskId: undefined, task: undefined }); f.status = 'superseded'; save(f); return next; }
export async function reconcileFixers(): Promise<void> {
  for (const f of listFixers()) {
    if (active.has(f.status)) { f.status = 'interrupted'; f.summary = 'Backend stopped mid-run. Work retained; inspect before an explicit retry.'; f.endedAt = new Date().toISOString(); save(f); }
    if (f.mergeIntent && f.status !== 'merged' && f.repo && f.targetBranch) {
      try {
        await git(f.repo, 'merge-base', '--is-ancestor', f.mergeIntent.candidate, f.targetBranch);
        f.status = 'merged'; f.endedAt = new Date().toISOString(); save(f);
        try { completeTask(f.game, f.taskId); } catch { /* Preserve successful Git outcome. */ }
        runtime().emit({ type: 'run.merge_recovered', runId: f.id, projectId: f.game, payload: { candidate: f.mergeIntent.candidate } });
      } catch {
        runtime().emit({ type: 'run.merge_interrupted', runId: f.id, projectId: f.game, payload: { message: 'No completed merge found. Retained work needs review.' } });
      }
    }
  }
}
export async function shutdownFixers(): Promise<void> { shuttingDown = true; for (const control of live.values()) control.abort.abort(new Error('Backend shutdown')); await Promise.all([...live.values()].map(control => control.done)); }
export async function waitForFixer(id: string): Promise<void> { await live.get(id)?.done; }

export type IntegrateResult = { ok: boolean; reason?: 'conflict' | 'checkfail' | 'gone' | 'unverified' | 'busy' | 'changed'; detail?: string };
export async function integrate(input: Fixer): Promise<IntegrateResult> {
  const cfg = games()[input.game]; if (!cfg) return { ok: false, reason: 'gone', detail: 'Unknown project' };
  return withRepoLock(cfg.repo, async () => {
    const f = runtime().get<Fixer>('fixers', input.id);
    if (!f || !['staged', 'done'].includes(f.status) || live.has(f.id)) return { ok: false, reason: 'busy', detail: 'Run is not fully staged' };
    if (!f.targetBranch || !f.commitSha || f.verification?.status !== 'passed' || !hasCheck(cfg.check)) return { ok: false, reason: 'unverified', detail: 'A verified pinned commit is required. Legacy work is retained for review.' };
    if (cfg.repo !== f.repo || !existsSync(f.worktree)) return { ok: false, reason: 'gone', detail: 'Worktree or original project is unavailable' };
    let integration = '';
    try {
      if (mergeTarget(cfg.repo) !== f.targetBranch || await git(cfg.repo, 'status', '--porcelain')) return { ok: false, reason: 'changed', detail: 'Target branch changed or has local edits' };
      if (await git(f.worktree, 'status', '--porcelain') || await git(f.worktree, 'rev-parse', 'HEAD') !== f.commitSha) return { ok: false, reason: 'changed', detail: 'Staged worktree changed after verification' };
      const targetSha = await git(cfg.repo, 'rev-parse', f.targetBranch);
      integration = join(config.workDir, 'merge-' + randomUUID());
      await git(cfg.repo, 'worktree', 'add', '--detach', integration, targetSha);
      try { await git(integration, 'merge', '--no-edit', f.commitSha); }
      catch (error) { return { ok: false, reason: 'conflict', detail: 'Target unchanged. Integration worktree retained: ' + integration }; }
      if (cfg.install && cfg.install !== 'true') await sandboxCommand(integration, cfg.install, { domains: cfg.installDomains ?? ['registry.npmjs.org'], readableRoots: [cfg.repo] });
      try { await sandboxCommand(integration, cfg.check, { readableRoots: [cfg.repo] }); }
      catch (error) { return { ok: false, reason: 'checkfail', detail: (error as Error).message }; }
      const candidate = await git(integration, 'rev-parse', 'HEAD');
      if (await git(integration, 'status', '--porcelain')) return { ok: false, reason: 'changed', detail: 'Verification changed tracked/untracked files; inspect ' + integration };
      if (mergeTarget(cfg.repo) !== f.targetBranch || await git(cfg.repo, 'rev-parse', 'HEAD') !== targetSha || await git(cfg.repo, 'status', '--porcelain')) return { ok: false, reason: 'changed', detail: 'Target changed during verification; no merge performed' };
      f.mergeIntent = { candidate, targetSha, integration }; save(f);
      await git(cfg.repo, 'merge', '--ff-only', candidate);
      f.status = 'merged'; f.endedAt = new Date().toISOString(); save(f);
      try { completeTask(f.game, f.taskId); } catch (error) { runtime().emit({ type: 'roadmap.update_failed', runId: f.id, projectId: f.game, payload: { message: (error as Error).message } }); }
      // No forced cleanup: the original evidence branch/worktree remains recoverable.
      await git(cfg.repo, 'worktree', 'remove', integration).catch(() => undefined);
      return { ok: true };
    } catch (error) { return { ok: false, reason: 'changed', detail: (error as Error).message }; }
  });
}
/** Explicit owner recovery of a retained, clean commit; never adopts unfinished edits. */
export async function verifyRetained(id: string): Promise<string> {
  const f = runtime().get<Fixer>('fixers', id); if (!f || live.has(id) || !['done', 'staged', 'failed', 'interrupted'].includes(f.status)) throw new Error('Run is not available for retained-commit verification');
  const cfg = games()[f.game]; if (!cfg || !hasCheck(cfg.check)) throw new Error('Configure a real project check first');
  return withRepoLock(cfg.repo, async () => {
    if (!within(config.workDir, f.worktree) || canonicalPath(f.worktree) === canonicalPath(cfg.repo)) throw new Error('Retained worktree must be inside Nibbi’s configured work directory');
    const common = await git(f.worktree, 'rev-parse', '--path-format=absolute', '--git-common-dir');
    if (canonicalPath(common) !== canonicalPath(await git(cfg.repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'))) throw new Error('Retained worktree belongs to another repository');
    if (await git(f.worktree, 'status', '--porcelain')) throw new Error('Retained work has uncommitted edits. Inspect and commit them manually before verification.');
    const commit = await git(f.worktree, 'rev-parse', 'HEAD');
    await sandboxCommand(f.worktree, cfg.check, { readableRoots: [cfg.repo] });
    if (await git(f.worktree, 'status', '--porcelain') || await git(f.worktree, 'rev-parse', 'HEAD') !== commit) throw new Error('Verification changed retained work; inspect it before retrying');
    f.repo = cfg.repo; f.targetBranch = cfg.targetBranch ?? mergeTarget(cfg.repo); f.commitSha = commit;
    f.baseSha = await git(cfg.repo, 'merge-base', f.targetBranch, commit);
    f.diffstat = await git(cfg.repo, 'diff', '--stat', f.baseSha, commit);
    if (!f.diffstat) throw new Error('Retained commit has no change to review');
    f.verification = { status: 'passed', command: cfg.check, at: new Date().toISOString(), commitSha: commit };
    f.status = 'staged'; save(f); return 'Retained commit verified and staged; merge still requires approval';
  });
}
export async function approveFixer(id: string): Promise<string> { const f = runtime().get<Fixer>('fixers', id); if (!f) throw new Error('Unknown run'); const result = await integrate(f); if (!result.ok) throw new Error(result.detail || result.reason); return 'Merged verified change into ' + f.targetBranch; }
export async function mergeGroup(project: string, group: string, _notify?: (text: string) => Promise<void>): Promise<string> { let merged = 0; for (const f of stagedFor(project).filter(f => f.group === group)) { const result = await integrate(f); if (!result.ok) throw new Error('Merged ' + merged + '; stopped: ' + result.detail); merged++; } return 'Merged ' + merged + ' changes'; }
export async function getFixerDiff(id: string): Promise<{ branch: string; target: string; game: string; diffstat: string; diff: string; truncated: boolean }> {
  const f = runtime().get<Fixer>('fixers', id); if (!f) throw new Error('Unknown run'); const cfg = games()[f.game]; if (!cfg) throw new Error('Unknown project');
  const target = f.targetBranch ?? cfg.targetBranch ?? mergeTarget(cfg.repo);
  const diff = await git(cfg.repo, 'diff', (f.baseSha ?? target) + '...' + (f.commitSha ?? f.branch));
  return { branch: f.branch, target, game: f.game, diffstat: f.diffstat ?? '', diff: diff.slice(0, 100_000), truncated: diff.length > 100_000 };
}
export function buildReport(hours = 16): string {
  const cutoff = Date.now() - hours * 3600_000;
  return listFixers().filter(f => f.endedAt && Date.parse(f.endedAt) >= cutoff).map(f => f.game + ' · ' + f.status + ' · ' + (f.title ?? f.id) + (f.costUsd === undefined ? ' · cost unavailable' : ' · $' + f.costUsd.toFixed(2))).join('\n');
}

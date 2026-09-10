// Compatibility facade for the run lifecycle. All state belongs to the backend database.
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ProviderId, RunStatus, SkillRef } from '@nibbi/contracts';
import { config } from './config.js';
import { runtime } from './store.js';
import { games, mergeTarget, projectSettings, type GameCfg } from './projects.js';
import { roadmap, pinTask, completeTask } from './roadmap.js';
import { pinIssueIds, completeLinkedIssues } from './project-issues.js';
import { git, withRepoLock } from './processes.js';
import { sandboxCommand } from './sandbox.js';
import { providerFor } from './providers/index.js';
import type { AgentHandle } from './providers/types.js';
import { skillCatalog } from './skills.js';
import { fileTools, leaseTools } from './tool-service.js';
import { canonicalPath, within } from './paths.js';
import { allowedPreviewActions, previewStatus } from './previews.js';
import { beginAttempt, recordAttempt, type BuildAttempt } from './build-attempt-records.js';
import { connectionFor } from './github-repositories.js';
import { isGithubBuild, reserveBuildBinding, prepareBuildBinding, githubBuildSummary } from './github-builds.js';
export { games, mergeTarget, registerProject, createProject, type GameCfg } from './projects.js';
export { previewStart, previewStop, playStart, playStop, playStatus } from './previews.js';

export interface Fixer {
  id: string; game: string; issue: string; branch: string; worktree: string;
  status: RunStatus | 'done'; startedAt: string; endedAt?: string; costUsd?: number;
  summary?: string; diffstat?: string; model?: string; task?: string; taskId?: string; project?: string;
  title?: string; context?: string; difficulty?: string; redispatches?: number; group?: string; issueIds?: string[];
  provider?: ProviderId; targetBranch?: string; baseSha?: string; commitSha?: string; repo?: string;
  skillRefs?: SkillRef[]; sessionId?: string;
  attemptId?: string; attemptKind?: BuildAttempt['kind']; attemptInstruction?: string; inputHead?: string;
  attemptCostUsd?: number; attemptBaseSha?: string; latestAttemptStartedAt?: string; lastVerifiedSha?: string; replacesBuildId?: string; executionKind?: 'provider' | 'adopt'; nextRetryAt?: number;
  workflowMode?: 'github' | 'local';
  remoteMerge?: { sha: string; pr: number; url: string; at: string };
  mergeIntent?: { candidate: string; targetSha: string; integration: string };
  verification?: { status: 'passed' | 'failed' | 'unverified'; command?: string; at?: string; commitSha?: string; detail?: string };
}
export interface FixerOpts { model?: string; provider?: ProviderId; context?: string; difficulty?: string; task?: string; taskId?: string; title?: string; redispatches?: number; group?: string; issueIds?: string[] }
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
  if (next.autoMerge && connectionFor(project)?.workflowMode === 'github') throw new Error('GitHub projects require reviewed PR merges. Choose stage mode.');
  if (next.autoMerge && !hasCheck(games()[project].check)) throw new Error('Ship mode requires a real verification command');
  if (next.on && !cur.on) next.onAt = new Date().toISOString();
  all[project] = next; runtime().put('config', 'auto', all, { projectId: project, type: 'auto.updated', payload: { config: next } }); return next;
}
export function noteAuto(project: string, note: string): void { if (autoConfig()[project]) setAuto(project, { note: note.slice(0, 300), at: new Date().toISOString() }); }
export const listFixers = (): Fixer[] => runtime().list<Fixer>('fixers').map(run => run.status === 'done' ? { ...run, status: 'staged' } : run);
const live = new Map<string, { abort: AbortController; handle?: AgentHandle; done: Promise<void> }>();
const deliveryLeases = new Map<string, { abort: AbortController; done: Promise<void> }>();
let shuttingDown = false;
const active = new Set(['installing', 'running', 'verifying', 'awaiting_input']);
export const inflightFor = (project: string): Fixer[] => listFixers().filter(f => f.game === project && active.has(f.status));
export const stagedFor = (project: string): Fixer[] => listFixers().filter(f => f.game === project && (f.status === 'staged' || f.status === 'done'));
export const pendingTasks = (project: string): string[] => roadmap(project).filter(task => !task.done).map(task => task.text);
export const roadmapProgress = (project: string): { done: number; total: number } => { const tasks = roadmap(project); return { done: tasks.filter(task => task.done).length, total: tasks.length }; };
export const autoSpend = (project: string): number => {
  const since = autoConfig()[project]?.onAt ?? '', attempts = runtime().list<BuildAttempt>('build-attempts'), tracked = new Set(attempts.map(a => a.buildId));
  return attempts.filter(a => a.project === project && a.startedAt >= since).reduce((sum, a) => sum + (a.costUsd ?? 0), 0)
    + listFixers().filter(f => f.game === project && !tracked.has(f.id) && f.startedAt >= since).reduce((sum, f) => sum + (f.costUsd ?? 0), 0);
};
export const isSteerable = (id: string): boolean => !!live.get(id)?.handle;
export function saveFixer(f: Fixer): void { recordAttempt(f); runtime().put('fixers', f.id, f, { runId: f.id, projectId: f.game, type: 'run.updated', payload: { run: { ...f, github: githubBuildSummary(f.id, f) }, attemptId: f.attemptId } }); }
const save = saveFixer;
export const buildIsActive = (id: string): boolean => live.has(id) || deliveryLeases.has(id) || runtime().get<Fixer>('fixers', id)?.status === 'queued';
export function acquireBuildDeliveryLease(id: string): (() => void) & { signal: AbortSignal } {
  const f = runtime().get<Fixer>('fixers', id);
  if (!f || shuttingDown || buildIsActive(id) || active.has(f.status)) throw new Error('Build already has an active attempt or delivery operation');
  let finish!: () => void;
  const lease = { abort: new AbortController(), done: new Promise<void>(resolve => { finish = resolve; }) };
  deliveryLeases.set(id, lease);
  const release = Object.assign(() => { if (deliveryLeases.get(id) === lease) deliveryLeases.delete(id); finish(); }, { signal: lease.abort.signal });
  return release;
}
const hasCheck = (command?: string): boolean => !!command?.trim() && !/^(true|:|echo\b.*)$/.test(command.trim());

function replacementOptions(f: FixerOpts): FixerOpts {
  return { model: f.model, provider: f.provider, context: f.context, difficulty: f.difficulty,
    task: f.task, taskId: f.taskId, title: f.title, redispatches: f.redispatches, group: f.group, issueIds: f.issueIds ? [...f.issueIds] : undefined };
}
/** Common directory and checked-out branch are checked before every backend-owned write. */
export async function assertBuildWorktree(f: Fixer): Promise<void> {
  const cfg = games()[f.game];
  if (!cfg || (f.repo && cfg.repo !== f.repo) || !within(config.workDir, f.worktree) || !existsSync(f.worktree) || canonicalPath(f.worktree) === canonicalPath(cfg.repo)) throw new Error('Build worktree or project identity changed');
  const [actual, expected, branch] = await Promise.all([
    git(f.worktree, 'rev-parse', '--path-format=absolute', '--git-common-dir'),
    git(cfg.repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'),
    git(f.worktree, 'symbolic-ref', '--quiet', '--short', 'HEAD'),
  ]);
  if (canonicalPath(actual) !== canonicalPath(expected) || branch !== f.branch) throw new Error('Build worktree belongs to a different repository or branch');
}

export async function updateFixer(id: string, instruction: string, notify: (text: string) => Promise<void>, expectedHead: string): Promise<Fixer> {
  if (!instruction.trim()) throw new Error('Describe the requested update');
  const original = runtime().get<Fixer>('fixers', id); if (!original?.repo) throw new Error('Unknown Build');
  const next = await withRepoLock(original.repo, async () => {
    const f = runtime().get<Fixer>('fixers', id)!;
    if (buildIsActive(id) || !['staged', 'done', 'failed', 'cancelled', 'interrupted'].includes(f.status)) throw new Error('This Build cannot be updated; start a replacement Build');
    if (previewStatus(id).running) throw new Error('Stop the Build preview before starting an update');
    await assertBuildWorktree(f);
    if (await git(f.worktree, 'rev-parse', 'HEAD') !== expectedHead || f.commitSha !== expectedHead) throw new Error('Build head changed; review the update again');
    if (await git(f.worktree, 'status', '--porcelain')) throw new Error('Retained edits need an explicit checkpoint before updating this Build');
    beginAttempt(f, 'update', instruction); f.status = 'queued'; f.executionKind = 'provider';
    f.verification = { status: 'unverified' }; f.summary = undefined; f.nextRetryAt = undefined; save(f); return f;
  });
  drainQueues(notify, false); return runtime().get<Fixer>('fixers', next.id)!;
}

/** Shares the same one-writer registry and cancellation/shutdown lifecycle as provider attempts. */
export async function runBuildAttempt(id: string, kind: BuildAttempt['kind'], action: (f: Fixer, signal: AbortSignal) => Promise<void>): Promise<Fixer> {
  const f = runtime().get<Fixer>('fixers', id); if (!f || live.has(id) || deliveryLeases.has(id) || (f.status === 'queued' && f.executionKind !== 'adopt')) throw new Error('Build already has an active writer');
  if (shuttingDown || ['merged', 'discarded', 'superseded'].includes(f.status)) throw new Error('Build is not available for updates');
  if (previewStatus(id).running) throw new Error('Stop the Build preview before changing its worktree');
  if (kind !== 'adopt') beginAttempt(f, kind, kind === 'checkpoint' ? 'Checkpoint reviewed edits as unverified' : kind === 'adoptRemote' ? 'Adopt commits published to the Build branch outside Nibbi' : 'Update Build from its integration base');
  f.status = 'installing'; f.verification = { status: 'unverified' }; save(f);
  const control = { abort: new AbortController(), done: Promise.resolve() };
  live.set(id, control);
  let failure: unknown;
  control.done = (async () => {
    try { await action(f, control.abort.signal); f.status = 'staged'; f.endedAt = new Date().toISOString(); save(f); }
    catch (error) { failure = error; f.status = control.abort.signal.aborted ? (shuttingDown ? 'interrupted' : 'cancelled') : 'failed'; f.summary = (error as Error).message; f.endedAt = new Date().toISOString(); save(f); }
    finally { live.delete(id); }
  })();
  await control.done; if (failure) throw failure; return runtime().get<Fixer>('fixers', id)!;
}

/** Advertise lifecycle commands only when their existing guards allow an attempt. Verification remains independent of status. */
export function allowedRunActions(f: Fixer): string[] {
  const actions: string[] = [], running = live.has(f.id) || deliveryLeases.has(f.id);
  const cfg = runtime().get<Record<string, GameCfg>>('config', 'projects')?.[f.game] ?? runtime().get<Record<string, GameCfg>>('legacy', 'games.json')?.[f.game];
  if (running || f.status === 'queued') actions.push('run.stop');
  if (!running && ['failed', 'cancelled', 'interrupted', 'discarded', 'merged', 'superseded'].includes(f.status)) actions.push('run.retry');
  if (!running && ['done', 'staged', 'failed', 'interrupted'].includes(f.status) && hasCheck(cfg?.check) && existsSync(f.worktree)) actions.push('run.verify');
  if (!running && !['merged', 'discarded', 'superseded', 'queued'].includes(f.status)) actions.push('run.discard');
  actions.push(...allowedPreviewActions(f.id, f.worktree));
  if (!isGithubBuild(f.id) && f.workflowMode !== 'github' && !running && ['staged', 'done'].includes(f.status) && f.verification?.status === 'passed' && f.commitSha && f.targetBranch && hasCheck(cfg?.check) && existsSync(f.worktree)) actions.push('run.merge');
  return actions;
}

export function queueFix(game: string, issue: string, opts: FixerOpts = {}, executionKind: 'provider' | 'adopt' = 'provider'): Fixer {
  if (shuttingDown) throw new Error('Backend is shutting down');
  const cfg = games()[game]; if (!cfg) throw new Error('Unknown project');
  if (!issue.trim()) throw new Error('A task is required');
  const provider = opts.provider ?? projectSettings(game).fixer.provider;
  const model = opts.model ?? projectSettings(game).fixer.model;
  const skills = skillCatalog().selected(game, 'fixer', provider);
  const id = 'fx-' + randomUUID();
  const taskId = opts.taskId ? pinTask(game, opts.taskId) : opts.task ? pinTask(game, opts.task) : undefined;
  if (opts.taskId && !taskId) throw new Error('Task ID must identify exactly one unfinished roadmap task');
  if (taskId && listFixers().some(f => f.game === game && f.taskId === taskId && (active.has(f.status) || ['queued', 'staged', 'done'].includes(f.status)))) throw new Error('This roadmap task already has an active or staged run');
  const issueIds = pinIssueIds(game, [...new Set([...(opts.issueIds ?? []), ...(taskId ? roadmap(game).find(task => task.id === taskId)?.issueIds ?? [] : [])])]);
  if (issueIds.length && listFixers().some(f => f.game === game && f.issueIds?.some(id => issueIds.includes(id)) && (active.has(f.status) || ['queued', 'staged', 'done'].includes(f.status)))) throw new Error('This issue already has an active or staged run');
  const selected = replacementOptions(opts);
  const connection = connectionFor(game);
  const f: Fixer = { ...selected, id, game, project: game, repo: cfg.repo, issue, provider, model, executionKind,
    workflowMode: connection?.workflowMode === 'github' ? 'github' : 'local',
    branch: 'nibbi/' + id, worktree: join(config.workDir, id), status: 'queued',
    startedAt: new Date().toISOString(), title: opts.title || issue.slice(0, 50), taskId, issueIds,
    targetBranch: connection?.workflowMode === 'github' ? connection.integrationBranch : cfg.targetBranch ?? mergeTarget(cfg.repo), skillRefs: skills.map(skill => ({ id: skill.id, revision: skill.revision })),
    verification: { status: 'unverified' } };
  if (f.workflowMode === 'github') reserveBuildBinding(game, id, f.branch);
  beginAttempt(f, executionKind === 'adopt' ? 'adopt' : 'initial', issue); save(f); return f;
}
export function spawnFixer(game: string, issue: string, notify: (text: string) => Promise<void>, opts: FixerOpts = {}): Fixer {
  const f = queueFix(game, issue, opts); drainQueues(notify, false); return runtime().get<Fixer>('fixers', f.id)!;
}
export function drainQueues(notify: (text: string) => Promise<void>, rateLimited: boolean): number {
  if (shuttingDown || rateLimited) return 0;
  let count = 0;
  for (const f of listFixers().filter(f => f.status === 'queued' && f.executionKind !== 'adopt' && (!f.nextRetryAt || f.nextRetryAt <= Date.now()))) {
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
  let remoteBaseUnavailable = false;
  const event = (type: string, payload: Record<string, unknown>): void => { runtime().emit({ runId: f.id, projectId: f.game, type, payload: { ...payload, attemptId: f.attemptId } }); };
  try {
    const cfg = games()[f.game]; if (!cfg || cfg.repo !== f.repo) throw new Error('Project configuration changed; dispatch a new run');
    mkdirSync(config.workDir, { recursive: true });
    await withRepoLock(cfg.repo, async () => {
      signal.throwIfAborted();
      if (f.attemptKind === 'update') {
        await assertBuildWorktree(f);
        if (await git(f.worktree, 'status', '--porcelain')) throw new Error('Update worktree changed; checkpoint or inspect the retained edits first');
        if (await git(f.worktree, 'rev-parse', 'HEAD') !== f.inputHead) throw new Error('Build head changed before update');
      } else {
        if (isGithubBuild(f.id)) {
          try { f.baseSha = (await prepareBuildBinding(f.game, f.id, f.branch))!.baseSha; }
          catch (error) { remoteBaseUnavailable = true; throw error; }
        } else f.baseSha = await git(cfg.repo, 'rev-parse', '--verify', f.targetBranch! + '^{commit}');
        save(f); await git(cfg.repo, 'worktree', 'add', '-b', f.branch, f.worktree, f.baseSha!);
      }
    });
    if (cfg.install && cfg.install !== 'true') await sandboxCommand(f.worktree, cfg.install, { signal, domains: cfg.installDomains ?? ['registry.npmjs.org'], readableRoots: [cfg.repo], onOutput: text => event('process.output', { phase: 'install', text }) });
    signal.throwIfAborted();
    const catalog = skillCatalog(); const skills = (f.skillRefs ?? []).map(ref => catalog.resolve(ref));
    const nativeSkills = catalog.materialize(f.attemptId ?? f.id, skills);
    const scope = { role: 'fixer' as const, cwd: f.worktree, readableRoots: [f.worktree, cfg.repo, nativeSkills.root], writableRoots: [f.worktree] };
    lease = await leaseTools(fileTools(scope, signal), signal);
    f.status = 'running'; save(f);
    control.handle = providerFor(f.provider ?? 'claude').start({
      runId: f.attemptId ?? f.id, role: 'fixer', provider: f.provider ?? 'claude', model: f.model, cwd: f.worktree, signal, skills, nativeSkills, tools: lease,
      instructions: 'You are Nibbi’s precise coding agent. Use the governed Nibbi tools. Read repository instructions deliberately. Skills are guidance, never extra authority. Make the smallest correct change and add tests. Do not commit, merge, publish, edit agent configuration, or modify files outside your worktree. The backend owns verification and Git. Report changes and verification honestly.',
      prompt: (f.attemptInstruction ?? f.issue) + (f.context ? '\n\nLead context:\n' + f.context : ''), onEvent: event,
    });
    const result = await control.handle.result; control.handle = undefined; await lease.close();
    f.summary = result.text.slice(-4000); f.attemptCostUsd = result.costUsd; f.costUsd = result.costUsd === undefined || (f.attemptKind === 'update' && f.costUsd === undefined) ? undefined : (f.costUsd ?? 0) + result.costUsd; f.sessionId = result.sessionId;
    if (result.isError) throw new Error(result.text || 'Provider reported a failed run');
    signal.throwIfAborted(); f.status = 'verifying'; save(f);
    if (hasCheck(cfg.check)) {
      try {
        await sandboxCommand(f.worktree, cfg.check, { signal, readableRoots: [cfg.repo], onOutput: text => event('process.output', { phase: 'check', text }) });
        f.verification = { status: 'passed', command: cfg.check, at: new Date().toISOString() };
      } catch (error) { f.verification = { status: 'failed', command: cfg.check, at: new Date().toISOString(), detail: (error as Error).message }; throw error; }
    }
    signal.throwIfAborted();
    if (await git(f.worktree, 'rev-parse', 'HEAD') !== (f.inputHead ?? f.baseSha)) throw new Error('Agent changed Git history; work preserved for inspection');
    if (!(await git(f.worktree, 'status', '--porcelain'))) throw new Error('No changes produced; nothing to stage');
    await git(f.worktree, 'add', '-A'); await git(f.worktree, 'commit', '-m', 'Nibbi: ' + (f.title ?? f.issue).slice(0, 150));
    f.commitSha = await git(f.worktree, 'rev-parse', 'HEAD'); f.verification!.commitSha = f.commitSha;
    if (f.verification?.status === 'passed') f.lastVerifiedSha = f.commitSha;
    signal.throwIfAborted();
    f.diffstat = await git(f.worktree, 'diff', '--stat', f.baseSha!, f.commitSha);
    if (!f.diffstat) throw new Error('Empty change; nothing to stage');
    f.status = 'staged'; f.endedAt = new Date().toISOString(); save(f);
    await notify(f.id + ' staged for review' + (f.verification?.status === 'passed' ? ' · checks passed' : ' · verification not configured')).catch(() => undefined);
  } catch (error) {
    if (!signal.aborted && remoteBaseUnavailable && !existsSync(f.worktree)) {
      f.status = 'queued'; f.nextRetryAt = Date.now() + 30_000; f.summary = 'Waiting for a fresh GitHub base: ' + (error as Error).message; save(f); return;
    }
    f.status = signal.aborted ? (shuttingDown ? 'interrupted' : 'cancelled') : 'failed';
    f.summary = (error as Error).message; f.endedAt = new Date().toISOString(); save(f);
    await notify(f.id + ' ' + f.status + ': ' + f.summary + '. Worktree preserved.').catch(() => undefined);
  } finally { clearTimeout(timeout); await lease?.close(); if (control.handle) await control.handle.cancel().catch(() => undefined); }
}
export function stopFixer(id: string): string {
  const f = runtime().get<Fixer>('fixers', id); if (!f) throw new Error('Unknown run');
  const delivery = deliveryLeases.get(id); if (delivery) { delivery.abort.abort(new Error('Stopped by owner')); return 'Stopping delivery; its remote outcome will be reconciled'; }
  const control = live.get(id); if (control) { control.abort.abort(new Error('Stopped by owner')); return 'Stopping ' + id; }
  if (f.status === 'queued') { f.status = 'cancelled'; f.endedAt = new Date().toISOString(); save(f); return 'Cancelled ' + id; }
  throw new Error('Run is not active; use discard for staged work');
}
export async function steerFixer(id: string, text: string): Promise<string> { const handle = live.get(id)?.handle; if (!handle) throw new Error('Run is not steerable'); await handle.steer(text); return 'Steered ' + id; }
export function closeFixer(id: string): void { if (live.has(id) || deliveryLeases.has(id)) throw new Error('Run must finish before it can be finalized'); }
export function stopAllFixers(): number {
  const pending = listFixers().filter(f => live.has(f.id) || deliveryLeases.has(f.id) || f.status === 'queued');
  for (const f of pending) stopFixer(f.id); for (const project of Object.keys(autoConfig())) setAuto(project, { mode: 'off' }); return pending.length;
}
export function stopGroup(project: string, group: string): number { const runs = listFixers().filter(f => f.game === project && f.group === group && (live.has(f.id) || deliveryLeases.has(f.id) || f.status === 'queued')); for (const run of runs) stopFixer(run.id); return runs.length; }
export function discardFixer(id: string): string { const f = runtime().get<Fixer>('fixers', id); if (!f || live.has(id) || deliveryLeases.has(id) || f.status === 'merged') throw new Error('Run cannot be discarded'); f.status = 'discarded'; save(f); return 'Discarded from review; branch and worktree retained'; }
export const unqueueFix = (id: string): string => stopFixer(id);
export function requeueFix(id: string): string {
  const f = runtime().get<Fixer>('fixers', id); if (!f || live.has(id) || deliveryLeases.has(id) || !['failed', 'cancelled', 'interrupted', 'discarded', 'merged', 'superseded'].includes(f.status)) throw new Error('Only stopped/failed work can be explicitly re-dispatched');
  const opts = replacementOptions(f); if (opts.taskId && !roadmap(f.game).some(task => task.id === opts.taskId && !task.done)) { opts.taskId = undefined; opts.task = undefined; }
  const next = queueFix(f.game, f.issue, opts); next.replacesBuildId = f.id; save(next); if (f.status !== 'merged') { f.status = 'superseded'; save(f); } return 'Queued ' + next.id + '; previous work retained';
}
export function redispatchFixer(input: Fixer, notify: (text: string) => Promise<void>): Fixer {
  const f = runtime().get<Fixer>('fixers', input.id); if (!f || buildIsActive(f.id)) throw new Error('Run is missing or still active');
  const next = queueFix(f.game, f.issue, { ...replacementOptions(f), taskId: undefined, task: undefined });
  next.replacesBuildId = f.id; save(next); if (f.status !== 'merged') { f.status = 'superseded'; save(f); }
  drainQueues(notify, false); return runtime().get<Fixer>('fixers', next.id)!;
}
export async function reconcileFixers(): Promise<void> {
  for (const f of listFixers()) {
    if (active.has(f.status) || f.status === 'queued' && f.executionKind === 'adopt') { f.status = 'interrupted'; f.summary = 'Backend stopped mid-run. Work retained; inspect before an explicit retry.'; f.endedAt = new Date().toISOString(); save(f); }
    if (!isGithubBuild(f.id) && f.workflowMode !== 'github' && f.mergeIntent && f.status !== 'merged' && f.repo && f.targetBranch) {
      try {
        await git(f.repo, 'merge-base', '--is-ancestor', f.mergeIntent.candidate, f.targetBranch);
        f.status = 'merged'; f.endedAt = new Date().toISOString(); save(f);
        try { completeTask(f.game, f.taskId); completeLinkedIssues(f.game, f.issueIds); } catch { /* Preserve successful Git outcome. */ }
        runtime().emit({ type: 'run.merge_recovered', runId: f.id, projectId: f.game, payload: { candidate: f.mergeIntent.candidate } });
      } catch {
        runtime().emit({ type: 'run.merge_interrupted', runId: f.id, projectId: f.game, payload: { message: 'No completed merge found. Retained work needs review.' } });
      }
    }
  }
}
export async function shutdownFixers(): Promise<void> { shuttingDown = true; for (const control of [...live.values(), ...deliveryLeases.values()]) control.abort.abort(new Error('Backend shutdown')); await Promise.all([...live.values(), ...deliveryLeases.values()].map(control => control.done)); }
export async function waitForFixer(id: string): Promise<void> { await live.get(id)?.done; }

export type IntegrateResult = { ok: boolean; reason?: 'conflict' | 'checkfail' | 'gone' | 'unverified' | 'busy' | 'changed'; detail?: string };
export async function integrate(input: Fixer): Promise<IntegrateResult> {
  if (isGithubBuild(input.id) || input.workflowMode === 'github') return { ok: false, reason: 'unverified', detail: 'This Build uses GitHub. Review and merge its PR; local integration cannot complete it.' };
  const cfg = games()[input.game]; if (!cfg) return { ok: false, reason: 'gone', detail: 'Unknown project' };
  return withRepoLock(cfg.repo, async () => {
    const f = runtime().get<Fixer>('fixers', input.id);
    if (!f || !['staged', 'done'].includes(f.status) || live.has(f.id) || deliveryLeases.has(f.id)) return { ok: false, reason: 'busy', detail: 'Run is not fully staged' };
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
      try { completeTask(f.game, f.taskId); completeLinkedIssues(f.game, f.issueIds); } catch (error) { runtime().emit({ type: 'roadmap.update_failed', runId: f.id, projectId: f.game, payload: { message: (error as Error).message } }); }
      // No forced cleanup: the original evidence branch/worktree remains recoverable.
      await git(cfg.repo, 'worktree', 'remove', integration).catch(() => undefined);
      return { ok: true };
    } catch (error) { return { ok: false, reason: 'changed', detail: (error as Error).message }; }
  });
}
/** Explicit owner recovery of a retained, clean commit; never adopts unfinished edits. */
export async function verifyRetained(id: string): Promise<string> {
  const original = runtime().get<Fixer>('fixers', id); if (!original || live.has(id) || !['done', 'staged', 'failed', 'interrupted'].includes(original.status)) throw new Error('Run is not available for retained-commit verification');
  const cfg = games()[original.game]; if (!cfg || !hasCheck(cfg.check)) throw new Error('Configure a real project check first');
  await runBuildAttempt(id, 'verify', async (f, signal) => withRepoLock(cfg.repo, async () => {
    await assertBuildWorktree(f);
    if (await git(f.worktree, 'status', '--porcelain')) throw new Error('Retained work has uncommitted edits. Inspect and checkpoint them before verification.');
    const commit = await git(f.worktree, 'rev-parse', 'HEAD');
    f.status = 'verifying'; save(f);
    try { await sandboxCommand(f.worktree, cfg.check, { signal, readableRoots: [cfg.repo], onOutput: text => runtime().emit({ type: 'process.output', runId: f.id, projectId: f.game, payload: { text, phase: 'check', attemptId: f.attemptId } }) }); }
    catch (error) { f.verification = { status: 'failed', command: cfg.check, at: new Date().toISOString(), detail: (error as Error).message }; throw error; }
    if (await git(f.worktree, 'status', '--porcelain') || await git(f.worktree, 'rev-parse', 'HEAD') !== commit) throw new Error('Verification changed retained work; inspect it before retrying');
    f.repo = cfg.repo; f.targetBranch ??= cfg.targetBranch ?? mergeTarget(cfg.repo); f.commitSha = commit;
    f.baseSha ??= await git(cfg.repo, 'merge-base', f.targetBranch, commit);
    f.diffstat = await git(cfg.repo, 'diff', '--stat', f.baseSha, commit);
    if (!f.diffstat) throw new Error('Retained commit has no change to review');
    f.verification = { status: 'passed', command: cfg.check, at: new Date().toISOString(), commitSha: commit };
    f.lastVerifiedSha = commit;
  }));
  return 'Retained commit verified and staged; merge still requires approval';
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

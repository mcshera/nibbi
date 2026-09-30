import { Cron } from 'croner';
import { randomUUID } from 'node:crypto';
import { runtime } from './store.js';
import { AUTO_WORDS, autoConfig, autoSpend, drainQueues, inflightFor, integrate, listFixers, noteAuto, setAuto, settleAutoTarget, stagedFor, type AutoCfg, type Fixer } from './fixer.js';
import { leadBusy, runTurn } from './session.js';
import { games } from './projects.js';
import { roadmap } from './roadmap.js';
import { connectionFor } from './github-repositories.js';
import { progressFacts } from './progress.js';
import { projectCommand, projectSection } from './project-workspace.js';
import { automationQueue, openIssues, suggestionsFrom } from './auto-queue.js';
import { copyById, fill } from './copy-records.js';

import { scheduleSettings, type Schedule } from './schedule-config.js';
export type { Schedule } from './schedule-config.js';

export function schedules(): Schedule[] {
  return scheduleSettings().map(result => {
    const cron = new Cron(result.pattern, { paused: true }); result.next = cron.nextRun()?.toISOString(); cron.stop(); return result;
  });
}
export function configureSchedule(id: string, enabled: boolean): Schedule {
  const entry = schedules().find(entry => entry.id === id); if (!entry) throw new Error('Unknown schedule');
  entry.enabled = enabled; entry.last = Date.now(); runtime().put('schedules', id, entry, { type: 'schedule.updated', payload: { schedule: entry } }); return entry;
}
export interface Goal { text: string; focus?: string; mode: 'stage' | 'ship'; startedAt: number; done?: boolean }
export function goals(): Record<string, Goal> { return runtime().get('config', 'goals') ?? {}; }
export function setGoal(project: string, value: Partial<Goal> & { stop?: boolean }): Record<string, Goal> {
  if (!games()[project]) throw new Error('Unknown project');
  const all = goals();
  if (value.stop) { delete all[project]; setAuto(project, { mode: 'off', focus: '' }); }
  else {
    if (!value.text?.trim()) throw new Error('Goal text is required');
    if (value.focus && !roadmap(project).some(task => task.milestone === value.focus)) throw new Error('Goal focus must match a roadmap milestone heading exactly');
    const mode = value.mode ?? 'stage'; setAuto(project, { mode, focus: value.focus ?? '' });
    all[project] = { text: value.text, focus: value.focus, mode, startedAt: Date.now() };
  }
  runtime().put('config', 'goals', all, { projectId: project, type: 'goal.updated', payload: { goal: all[project] ?? null } }); return all;
}
const PROGRESS_SCHEDULES = new Set(['brief', 'review']);
const SUGGESTIONS = 3;   // at most, per ask
let timer: ReturnType<typeof setInterval> | undefined, busy = false, lastAuto = 0, stopped = false;
let activeCycle: Promise<void> | undefined;
export async function schedulerCycle(notify: (message: string) => Promise<void>): Promise<void> {
  if (busy || stopped) return; busy = true;
  try {
    drainQueues(notify, false);
    if (leadBusy()) return;
    const now = Date.now();
    for (const schedule of schedules().filter(schedule => schedule.enabled)) {
      const cron = new Cron(schedule.pattern, { paused: true }); const due = cron.previousRun() ?? cron.nextRun(new Date(schedule.last ?? now)); cron.stop();
      if (!due || due.getTime() > now) continue;
      const key = 'schedule:' + schedule.id + ':' + due.toISOString();
      if (runtime().claimCommand(key, { id: schedule.id, at: due.toISOString() }).state !== 'new') continue;
      try {
        // Brief and review read progress as data; heartbeat/consolidate never see it, so nothing there can turn into a nudge.
        const prompt = PROGRESS_SCHEDULES.has(schedule.id) ? schedule.prompt + '\n\nPROGRESS FACTS (backend-derived from verified merges; data, not a target or a reason to push):\n' + JSON.stringify(progressFacts()) : schedule.prompt;
        const result = await runTurn(prompt, undefined, 'cron', undefined, undefined, undefined, undefined, false, { allowDispatch: false });
        if (result.isError) throw new Error(result.text);
        if (!result.text.includes('HEARTBEAT_OK')) await notify(result.text);
        runtime().finishCommand(key, { ok: true }); schedule.error = undefined;
      } catch (error) { schedule.error = (error as Error).message; runtime().finishCommand(key, { ok: false, error: schedule.error }); }
      schedule.last = now; runtime().put('schedules', schedule.id, schedule);
      if (stopped) return;
    }
    if (now - lastAuto < 90_000) return; lastAuto = now;
    await automationCycle(notify);
  } finally { busy = false; }
}
/** One pass of every project's automation (the owner's decision, 2026-09-29; docs/CONTROL-PANEL.md §12). suggest adds its
    suggestions to up next; stage and ship build what is up next, into main or the copy chosen on the card, up to capacity and
    the spend cap; a set /goal keeps the roadmap, as before. The scheduler runs it every 90 seconds at most; tests drive it. */
export async function automationCycle(notify: (message: string) => Promise<void>): Promise<void> {
  for (const project of Object.keys(autoConfig())) {
    if (stopped) return;
    if (!games()[project] || !autoConfig()[project]?.on) continue;
    try { await automate(project, notify); }
    catch (error) { setAuto(project, { mode: 'off', note: (error as Error).message }); }
  }
}
async function automate(project: string, notify: (message: string) => Promise<void>): Promise<void> {
  settleAutoTarget(project);
  const cfg = autoConfig()[project]; if (!cfg.on) return;
  if (cfg.mode === 'ship' && connectionFor(project)?.workflowMode === 'github') { setAuto(project, { mode: 'off', note: 'GitHub delivery requires reviewed PR actions. Legacy ship automation is paused.' }); return; }
  const recent = listFixers().filter(run => run.game === project && (run.latestAttemptStartedAt ?? run.startedAt) >= (cfg.onAt ?? ''));
  if (recent.some(run => ['failed', 'interrupted', 'cancelled'].includes(run.status))) { setAuto(project, { mode: 'off', note: 'A run needs review. Work is preserved; automatic retries are paused.' }); return; }
  if (cfg.spendCap && (autoSpend(project) >= cfg.spendCap || recent.some(run => ['staged', 'done', 'merged'].includes(run.status) && run.costUsd === undefined))) {
    setAuto(project, { mode: 'off', note: 'Spend cap reached, or provider cost is unavailable. Review before resuming.' }); return;
  }
  const target = cfg.copyId ?? null;
  // Auto ship lands main's runs only, and only while automation builds into main: a copy's runs land on their own, and nothing
  // but the owner's confirm ships a copy (D15). Building into a copy, ship never merges main.
  if (cfg.mode === 'ship' && !target) for (const run of stagedFor(project).filter(run => !run.copyId)) {
    const result = await integrate(run);
    if (!result.ok) { setAuto(project, { mode: 'stage', note: 'Merge paused: ' + result.detail }); break; }
    await notify('Merged ' + (run.title ?? run.id) + ' on ' + project);
  }
  const goal = goals()[project];
  if (cfg.mode !== 'suggest' && goal && !goal.done) return roadmapTurn(project, autoConfig()[project], recent);
  if (cfg.mode === 'suggest') return suggestTurn(project);
  return buildUpNext(project, autoConfig()[project], target, notify);
}
/** A set /goal: the lead reads the roadmap and dispatches its next tasks, exactly as before up next was the queue. */
async function roadmapTurn(project: string, cfg: AutoCfg, recent: Fixer[]): Promise<void> {
  const focused = roadmap(project).filter(task => !cfg.focus || task.milestone === cfg.focus);
  if (cfg.focus && !focused.length) { setAuto(project, { mode: 'off', note: 'Focused milestone is missing; review the roadmap.' }); return; }
  const pending = focused.filter(task => !task.done).map(task => task.text), inFlight = inflightFor(project), staged = stagedFor(project);
  if (!pending.length) {
    if (!inFlight.length && !staged.length) { setAuto(project, { mode: 'off', note: 'Roadmap complete' }); const goal = goals()[project]; if (goal) { const all = goals(); all[project] = { ...goal, done: true }; runtime().put('config', 'goals', all, { type: 'goal.completed', projectId: project, payload: { text: goal.text } }); } }
    return;
  }
  const capacity = cfg.maxConcurrent - inFlight.length; if (capacity <= 0) return;
  const signature = JSON.stringify({ pending, runs: recent.map(run => [run.id, run.status]), focus: cfg.focus, mode: cfg.mode });
  if (runtime().get('scheduler-signatures', project) === signature) return;
  runtime().put('scheduler-signatures', project, signature);
  const prompt = 'Project ' + project + '. Read its roadmap. Focus: ' + (cfg.focus || 'next independent tasks') + '. Capacity: ' + capacity + '.\n' +
    'Already active or staged (do not duplicate): ' + JSON.stringify([...inFlight, ...staged].map(run => ({ id: run.id, taskId: run.taskId, task: run.task ?? run.issue }))) + '\n' +
    'Dispatch only independently testable tasks, with exact task text or stable ID, up to capacity. Never dispatch a dependency before its prerequisite is merged. Never merge or enable skills.';
  const result = await runTurn(prompt, undefined, 'auto', undefined, undefined, undefined, undefined, true, { project, allowDispatch: true });
  if (result.isError) throw new Error(result.text);
  noteAuto(project, result.text);
}
/** stage and ship: the top of up next, in issues.md order, through issue.build (its duplicate guard, its copy rules), while the
    project has room — queued and running tries count against maxConcurrent. No model chooses what goes next. */
async function buildUpNext(project: string, cfg: AutoCfg, target: string | null, notify: (message: string) => Promise<void>): Promise<void> {
  const queued = listFixers().filter(run => run.game === project && run.status === 'queued').length;
  const room = cfg.maxConcurrent - inflightFor(project).length - queued; if (room <= 0) return;
  const copy = target ? copyById(target) : undefined;
  if (copy && copy.status !== 'ready') return;   // being made, shipping or catching up: it builds into it once it's ready
  const next = automationQueue(project, target, cfg.onAt).slice(0, room); if (!next.length) return;
  const { executeCommand } = await import('./command-service.js');
  const started: string[] = [];
  for (const item of next) {
    if (stopped) break;
    const built = await projectCommand({ project, action: 'issue.build', id: item.id, expectedRevision: projectSection(project, 'issues').revision, idempotencyKey: 'auto-build:' + randomUUID(), ...(target ? { copyId: target } : {}) },
      { dispatch: input => executeCommand(input, notify) });
    if (!built.ok) { setAuto(project, { mode: 'off', note: fill(AUTO_WORDS.buildFailed, { title: item.title, why: built.error.message }) }); return; }
    started.push(item.title);
  }
  if (started.length) noteAuto(project, fill(started.length === 1 ? AUTO_WORDS.buildingOne : AUTO_WORDS.building, { title: started[0], n: started.length, name: copy?.name ?? 'main' }));
}
/** suggest: the lead is asked for a few improvements, and each goes into main's up next marked nibbi suggested, for the owner to
    build or mark done. It builds nothing. It asks again only once none of its last ones is still up next, and the list moved. */
async function suggestTurn(project: string): Promise<void> {
  if (openIssues(project).some(item => item.suggested && item.upNext)) return;
  // Everything in the list, done too: marked done is an answer, and it isn't suggested again.
  const items = projectSection(project, 'issues').items as Array<{ id: string; text: string; done: boolean }>, listed = items.map(item => item.text);
  const signature = JSON.stringify(items.map(item => [item.id, item.text, item.done])), key = project + ':suggest';
  if (runtime().get('scheduler-signatures', key) === signature) return;
  runtime().put('scheduler-signatures', key, signature);
  const prompt = 'Project ' + project + '. Suggest up to ' + SUGGESTIONS + ' small improvements worth building next, each one independently testable. Read the project as you need to.\n' +
    'Already in the list, open or done (do not repeat): ' + JSON.stringify(listed.slice(-100)) + '\n' +
    'Each goes into the up-next list marked "nibbi suggested"; the owner builds it or marks it done. Reply with only the list: one per line, each line starting with "- ", one short spoken sentence saying what should change. Do not dispatch.';
  const result = await runTurn(prompt, undefined, 'auto', undefined, undefined, undefined, undefined, true, { project, allowDispatch: false });
  if (result.isError) throw new Error(result.text);
  const titles = suggestionsFrom(result.text, listed, SUGGESTIONS);
  if (!titles.length) { noteAuto(project, result.text); return; }
  let added = 0;
  for (const title of titles) {
    const made = await projectCommand({ project, action: 'issue.create', title, expectedRevision: projectSection(project, 'issues').revision, idempotencyKey: 'auto-suggest:' + randomUUID() }, { origin: 'suggested' });
    if (!made.ok) { noteAuto(project, fill(AUTO_WORDS.suggestFailed, { why: made.error.message })); break; }
    added++;
  }
  if (added) noteAuto(project, fill(added === 1 ? AUTO_WORDS.suggestedOne : AUTO_WORDS.suggested, { n: added }));
}
export function startScheduler(notify: (message: string) => Promise<void>): void {
  if (timer) throw new Error('Scheduler already started'); stopped = false;
  const tick = (): void => { activeCycle = schedulerCycle(notify).catch(error => { runtime().emit({ type: 'scheduler.error', payload: { message: (error as Error).message } }); }); };
  timer = setInterval(tick, 10_000); tick();
}
export async function stopScheduler(): Promise<void> { stopped = true; if (timer) clearInterval(timer); timer = undefined; await activeCycle; }

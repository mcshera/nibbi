import { Cron } from 'croner';
import { runtime } from './store.js';
import { autoConfig, autoSpend, drainQueues, inflightFor, integrate, listFixers, noteAuto, pendingTasks, setAuto, stagedFor, buildReport } from './fixer.js';
import { leadBusy, runTurn } from './session.js';
import { games } from './projects.js';
import { roadmap } from './roadmap.js';

export interface Schedule { id: string; name: string; pattern: string; when: string; desc: string; prompt: string; enabled: boolean; next?: string; last?: number; error?: string }
const defaults: Schedule[] = [
  { id: 'heartbeat', name: 'heartbeat', pattern: '*/30 8-23 * * *', when: 'every 30 min · 8am–11pm', desc: 'Read the watching list; report only what needs attention.', prompt: 'Read HEARTBEAT.md. Report only what needs attention; otherwise reply HEARTBEAT_OK. Do not dispatch work.', enabled: false },
  { id: 'brief', name: 'morning brief', pattern: '30 7 * * *', when: '7:30 AM daily', desc: 'A short brief from journal, issues and inbox.', prompt: 'Read recent journal, issues and inbox. Compose a concise morning brief.', enabled: false },
  { id: 'consolidate', name: 'consolidation', pattern: '0 3 * * *', when: '3:00 AM daily', desc: 'File durable notes into unprotected vault pages.', prompt: 'Review recent journal and inbox. File durable facts into unprotected vault pages. Do not remove source evidence or activate skills.', enabled: false },
  { id: 'review', name: 'weekly self-review', pattern: '0 18 * * 0', when: 'Sundays 6:00 PM', desc: 'Review lessons; propose improvements for owner review.', prompt: 'Review recent journal and work. Write a weekly brief with shipped work, repeated lessons and possible skill candidates. Learned skills require two evidence runs and owner review; never enable them yourself.', enabled: false },
];
export function schedules(): Schedule[] {
  return defaults.map(def => {
    const saved = runtime().get<Partial<Schedule>>('schedules', def.id) ?? {};
    const result = { ...def, ...saved }; const cron = new Cron(result.pattern, { paused: true }); result.next = cron.nextRun()?.toISOString(); cron.stop(); return result;
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
        const result = await runTurn(schedule.prompt, undefined, 'cron', undefined, undefined, undefined, undefined, false, { allowDispatch: false });
        if (result.isError) throw new Error(result.text);
        if (!result.text.includes('HEARTBEAT_OK')) await notify(result.text);
        runtime().finishCommand(key, { ok: true }); schedule.error = undefined;
      } catch (error) { schedule.error = (error as Error).message; runtime().finishCommand(key, { ok: false, error: schedule.error }); }
      schedule.last = now; runtime().put('schedules', schedule.id, schedule);
      if (stopped) return;
    }
    if (now - lastAuto < 90_000) return; lastAuto = now;
    for (const [project, cfg] of Object.entries(autoConfig())) {
      if (!cfg.on || stopped) continue;
      const recent = listFixers().filter(run => run.game === project && run.startedAt >= (cfg.onAt ?? ''));
      if (recent.some(run => ['failed', 'interrupted', 'cancelled'].includes(run.status))) { setAuto(project, { mode: 'off', note: 'A run needs review. Work is preserved; automatic retries are paused.' }); continue; }
      if (cfg.spendCap && (autoSpend(project) >= cfg.spendCap || recent.some(run => ['staged', 'done', 'merged'].includes(run.status) && run.costUsd === undefined))) {
        setAuto(project, { mode: 'off', note: 'Spend cap reached, or provider cost is unavailable. Review before resuming.' }); continue;
      }
      if (cfg.mode === 'ship') for (const run of stagedFor(project)) {
        const result = await integrate(run);
        if (!result.ok) { setAuto(project, { mode: 'stage', note: 'Merge paused: ' + result.detail }); break; }
        await notify('Merged ' + (run.title ?? run.id) + ' on ' + project);
      }
      const focused = roadmap(project).filter(task => !cfg.focus || task.milestone === cfg.focus);
      if (cfg.focus && !focused.length) { setAuto(project, { mode: 'off', note: 'Focused milestone is missing; review the roadmap.' }); continue; }
      const pending = focused.filter(task => !task.done).map(task => task.text), inFlight = inflightFor(project), staged = stagedFor(project);
      if (!pending.length) {
        if (!inFlight.length && !staged.length) { setAuto(project, { mode: 'off', note: 'Roadmap complete' }); const goal = goals()[project]; if (goal) { const all = goals(); all[project] = { ...goal, done: true }; runtime().put('config', 'goals', all, { type: 'goal.completed', projectId: project, payload: { text: goal.text } }); } }
        continue;
      }
      const capacity = cfg.maxConcurrent - inFlight.length; if (capacity <= 0) continue;
      const signature = JSON.stringify({ pending, runs: recent.map(run => [run.id, run.status]), focus: cfg.focus, mode: cfg.mode });
      if (runtime().get('scheduler-signatures', project) === signature) continue;
      runtime().put('scheduler-signatures', project, signature);
      const prompt = 'Project ' + project + '. Read its roadmap. Focus: ' + (cfg.focus || 'next independent tasks') + '. Capacity: ' + capacity + '.\n' +
        'Already active or staged (do not duplicate): ' + JSON.stringify([...inFlight, ...staged].map(run => ({ id: run.id, taskId: run.taskId, task: run.task ?? run.issue }))) + '\n' +
        (cfg.mode === 'suggest' ? 'Suggest the next tasks only. Do not dispatch.' : 'Dispatch only independently testable tasks, with exact task text or stable ID, up to capacity. Never dispatch a dependency before its prerequisite is merged. Never merge or enable skills.');
      try { const result = await runTurn(prompt, undefined, 'auto', undefined, undefined, undefined, undefined, true, { project, allowDispatch: cfg.mode !== 'suggest' }); if (result.isError) throw new Error(result.text); noteAuto(project, result.text); }
      catch (error) { setAuto(project, { mode: 'off', note: (error as Error).message }); }
    }
  } finally { busy = false; }
}
export function startScheduler(notify: (message: string) => Promise<void>): void {
  if (timer) throw new Error('Scheduler already started'); stopped = false;
  const tick = (): void => { activeCycle = schedulerCycle(notify).catch(error => { runtime().emit({ type: 'scheduler.error', payload: { message: (error as Error).message } }); }); };
  timer = setInterval(tick, 10_000); tick();
}
export async function stopScheduler(): Promise<void> { stopped = true; if (timer) clearInterval(timer); timer = undefined; await activeCycle; }

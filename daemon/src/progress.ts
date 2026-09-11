// Durable progress rollup. Only verified merges count; records are derived from re-read roadmap/issue documents, never from run intent.
import { runtime, type RuntimeStore } from './store.js';
import type { Fixer } from './fixer.js';
import { planPath, parseProjectDocument } from './roadmap.js';
import { issueDocument } from './project-issues.js';
import { readDocument } from './workspace-documents.js';

export interface DeliveryReceipt { prNumber: number; mergeSha: string }
export interface ProgressDelivery { key: string; runId: string; project: string; title: string; taskId?: string; issueIds?: string[]; milestoneId?: string; receipt?: DeliveryReceipt; at: string }
export interface ProgressDay {
  day: string; deliveries: ProgressDelivery[];
  tasksCompleted: Array<{ project: string; taskId: string; text: string; milestoneId?: string; runId: string; at: string }>;
  issuesCompleted: Array<{ project: string; issueId: string; text: string; runId: string; at: string }>;
  milestonesCompleted: Array<{ project: string; milestoneId: string; name: string; total: number; runId: string; at: string }>;
  updatedAt: string;
}
export interface ProgressCounts { deliveries: number; tasks: number; issues: number; milestones: number }
export interface ProgressSummary { today: ProgressCounts; week: ProgressCounts; streak: number; lastDeliveryAt: string | null; recent: Array<{ title: string; project: string; at: string; milestone?: string }>; available: true }
export type DeliveryResult = { recorded: false } | { recorded: true; day: string; delta: ProgressCounts; milestone?: { milestoneId: string; name: string; total: number } };

const localDay = (date: Date): string => date.toLocaleDateString('en-CA');
const dayBefore = (date: Date, days: number): string => localDay(new Date(date.getFullYear(), date.getMonth(), date.getDate() - days));
const counts = (days: ProgressDay[]): ProgressCounts => ({ deliveries: days.reduce((sum, day) => sum + day.deliveries.length, 0), tasks: days.reduce((sum, day) => sum + day.tasksCompleted.length, 0), issues: days.reduce((sum, day) => sum + day.issuesCompleted.length, 0), milestones: days.reduce((sum, day) => sum + day.milestonesCompleted.length, 0) });
const emptyDay = (day: string, at: string): ProgressDay => ({ day, deliveries: [], tasksCompleted: [], issuesCompleted: [], milestonesCompleted: [], updatedAt: at });

function summarize(days: ProgressDay[], now: Date): ProgressSummary {
  const byDay = new Map(days.map(day => [day.day, day]));
  const today = byDay.get(localDay(now));
  const week = Array.from({ length: 7 }, (_, offset) => byDay.get(dayBefore(now, offset))).filter((day): day is ProgressDay => !!day);
  const delivered = (offset: number): boolean => (byDay.get(dayBefore(now, offset))?.deliveries.length ?? 0) > 0;
  let streak = 0;
  if (delivered(0) || delivered(1)) for (let offset = delivered(0) ? 0 : 1; delivered(offset); offset++) streak++;
  const deliveries = days.flatMap(day => day.deliveries).sort((a, b) => b.at.localeCompare(a.at));
  const milestoneByRun = new Map(days.flatMap(day => day.milestonesCompleted).map(item => [item.runId, item.name]));
  return {
    today: counts(today ? [today] : []), week: counts(week), streak,
    lastDeliveryAt: deliveries[0]?.at ?? null,
    recent: deliveries.slice(0, 5).map(item => { const milestone = milestoneByRun.get(item.runId); return { title: item.title, project: item.project, at: item.at, ...(milestone ? { milestone } : {}) }; }),
    available: true,
  };
}

/** Exactly once per run across local and GitHub completion paths. Synchronous: the claim and the writes cannot interleave with another delivery. */
export function recordDelivery(input: { run: Fixer; receipt?: DeliveryReceipt; now?: Date }, store: RuntimeStore = runtime()): DeliveryResult {
  const { run, receipt } = input, now = input.now ?? new Date();
  const key = 'merge:' + run.id;
  if (store.get('progress-deliveries', key)) return { recorded: false };
  const project = run.game, at = now.toISOString(), day = localDay(now);
  // Completion writes already happened; only the documents decide what is done.
  let plan: ReturnType<typeof parseProjectDocument> | undefined, issues: ReturnType<typeof parseProjectDocument> | undefined;
  try { plan = parseProjectDocument(readDocument(planPath(project)).markdown); } catch { plan = undefined; }
  if (run.issueIds?.length) { try { issues = parseProjectDocument(issueDocument(project).markdown, 'issue'); } catch { issues = undefined; } }
  const task = run.taskId ? plan?.items.find(item => item.id === run.taskId) : undefined;
  const milestone = task?.milestoneId ? plan?.milestones.find(item => item.id === task.milestoneId) : undefined;
  const delivery: ProgressDelivery = { key, runId: run.id, project, title: run.title || run.issue.slice(0, 50) || run.id, at,
    ...(run.taskId ? { taskId: run.taskId } : {}), ...(run.issueIds?.length ? { issueIds: [...run.issueIds] } : {}), ...(task?.milestoneId ? { milestoneId: task.milestoneId } : {}),
    ...(receipt ? { receipt: { prNumber: receipt.prNumber, mergeSha: receipt.mergeSha } } : {}) };
  const current = store.get<ProgressDay>('progress-days', day) ?? emptyDay(day, at);
  const next: ProgressDay = { ...current, deliveries: [...current.deliveries, delivery], tasksCompleted: [...current.tasksCompleted], issuesCompleted: [...current.issuesCompleted], milestonesCompleted: [...current.milestonesCompleted], updatedAt: at };
  if (task?.done && run.taskId) next.tasksCompleted.push({ project, taskId: run.taskId, text: task.text, ...(task.milestoneId ? { milestoneId: task.milestoneId } : {}), runId: run.id, at });
  for (const issueId of run.issueIds ?? []) { const item = issues?.items.find(entry => entry.id === issueId); if (item?.done) next.issuesCompleted.push({ project, issueId, text: item.text, runId: run.id, at }); }
  const flip = milestone && task?.done && milestone.total > 0 && milestone.done === milestone.total && !store.get('progress-milestones', project + ':' + milestone.id) ? milestone : undefined;
  if (flip) next.milestonesCompleted.push({ project, milestoneId: flip.id, name: flip.name, total: flip.total, runId: run.id, at });
  const delta: ProgressCounts = { deliveries: 1, tasks: next.tasksCompleted.length - current.tasksCompleted.length, issues: next.issuesCompleted.length - current.issuesCompleted.length, milestones: flip ? 1 : 0 };
  const summary = summarize([...store.list<ProgressDay>('progress-days').filter(item => item.day !== day), next], now);
  // One transaction: the exactly-once claim, the milestone record and the day rollup land together or not at all, so a failed write leaves the delivery recordable by the next completion path.
  store.db.transaction(() => {
    store.put('progress-deliveries', key, { at, source: receipt ? 'github' : 'local', ...(receipt ? { mergeSha: receipt.mergeSha } : {}) });
    if (flip) store.put('progress-milestones', project + ':' + flip.id, { name: flip.name, completedAt: at, byRunId: run.id }, { type: 'milestone.completed', runId: run.id, projectId: project, payload: { project, milestoneId: flip.id, name: flip.name, total: flip.total, runId: run.id } });
    store.put('progress-days', day, next, { type: 'progress.updated', runId: run.id, projectId: project, payload: { day, delta, summary } });
  })();
  return { recorded: true, day, delta, ...(flip ? { milestone: { milestoneId: flip.id, name: flip.name, total: flip.total } } : {}) };
}

export function progressSummary(now: Date = new Date(), store: RuntimeStore = runtime()): ProgressSummary { return summarize(store.list<ProgressDay>('progress-days'), now); }
/** Compact facts for scheduled prompts: data about verified merges, never a target. */
export function progressFacts(now: Date = new Date(), store: RuntimeStore = runtime()): { today: ProgressCounts; week: ProgressCounts; streak: number; lastDeliveryAt: string | null; recent: Array<{ title: string; project: string; at: string }> } {
  const summary = progressSummary(now, store);
  return { today: summary.today, week: summary.week, streak: summary.streak, lastDeliveryAt: summary.lastDeliveryAt, recent: summary.recent.map(({ title, project, at }) => ({ title, project, at })) };
}

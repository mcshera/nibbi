import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Fixer } from '../src/fixer.js';
import type { ProgressDay } from '../src/progress.js';
import type { RunEvent } from '@nibbi/contracts';

const directory = mkdtempSync(join(tmpdir(), 'nibbi-progress-'));
process.env.NODE_ENV = 'test'; process.env.NIBBI_PORT = '0';
process.env.NIBBI_STATE_DIR = join(directory, 'state'); process.env.NIBBI_VAULT_DIR = join(directory, 'vault');
process.env.NIBBI_WORK_DIR = join(directory, 'work'); process.env.NIBBI_PROJECTS_DIR = join(directory, 'projects');
const vault = process.env.NIBBI_VAULT_DIR, repo = join(directory, 'projects', 'demo');
for (const path of [join(vault, 'plans'), join(vault, 'games', 'demo'), repo]) mkdirSync(path, { recursive: true });
for (const [name, text] of Object.entries({ 'SOUL.md': 'fixture-soul', 'AGENTS.md': 'fixture-agents', 'MEMORY.md': 'fixture-memory', 'index.md': 'fixture-index' })) writeFileSync(join(vault, name), text);
writeFileSync(join(vault, 'plans', 'demo.md'), [
  '# Demo', '', '## First light <!-- nibbi-milestone:m1 -->', '- [ ] Boot screen <!-- nibbi-task:t1 -->', '- [ ] Title music <!-- nibbi-task:t2 -->', '',
  '## Second wind <!-- nibbi-milestone:m2 -->', '- [ ] Save slots <!-- nibbi-task:t3 -->', '',
].join('\n'));
writeFileSync(join(vault, 'games', 'demo', 'issues.md'), '- [ ] Crash on load <!-- nibbi-issue:i1 -->\n');
const { runtime, closeRuntime, RuntimeStore } = await import('../src/store.js');
const { recordDelivery, progressSummary, progressFacts } = await import('../src/progress.js');
const { completeTask } = await import('../src/roadmap.js');
const { completeLinkedIssues } = await import('../src/project-issues.js');
const { schedulerCycle } = await import('../src/scheduler.js');
const { shutdownSessions } = await import('../src/session.js');
const { replaceProviderForTest } = await import('../src/providers/index.js');
const { closeToolService } = await import('../src/tool-service.js');
runtime().put('config', 'projects', { demo: { repo, install: 'true', check: 'true' } });
const isolated: InstanceType<typeof RuntimeStore>[] = [];
const freshStore = (name: string) => { const store = new RuntimeStore(join(directory, name)); isolated.push(store); return store; };
/** Fails the next write to one bucket, standing in for a disk error between the rollup's records. */
class FlakyStore extends RuntimeStore {
  failNext = '';
  override put<T>(bucket: string, id: string, value: T, event?: Omit<RunEvent, 'id' | 'at'>, expectedRevision?: number): T {
    if (bucket === this.failNext) { this.failNext = ''; throw new Error('disk full'); }
    return super.put(bucket, id, value, event, expectedRevision);
  }
}
after(async () => { await shutdownSessions(); await closeToolService(); for (const store of isolated) store.close(); closeRuntime(); rmSync(directory, { recursive: true, force: true }); });

const run = (id: string, extra: Partial<Fixer> = {}): Fixer => ({ id, game: 'demo', project: 'demo', issue: 'Do ' + id, title: 'Title ' + id, branch: 'nibbi/' + id, worktree: join(directory, 'work', id), status: 'merged', startedAt: new Date().toISOString(), ...extra });
const localDay = (date: Date): string => date.toLocaleDateString('en-CA');
const today = () => runtime().get<ProgressDay>('progress-days', localDay(new Date()))!;
const eventsSince = (cursor: number, type: string) => runtime().replay(cursor).filter(event => event.type === type);
const receipt = { prNumber: 7, mergeSha: 'a'.repeat(40) };

test('a merge is counted once across the local and later GitHub completion paths', () => {
  const cursor = runtime().cursor();
  const first = recordDelivery({ run: run('fx-once') });
  assert.equal(first.recorded, true);
  const second = recordDelivery({ run: run('fx-once'), receipt });
  assert.equal(second.recorded, false);
  assert.equal(progressSummary().today.deliveries, 1);
  assert.equal(today().deliveries.filter(item => item.runId === 'fx-once').length, 1);
  assert.deepEqual(runtime().get('progress-deliveries', 'merge:fx-once'), { at: today().deliveries[0].at, source: 'local' });
  const updated = eventsSince(cursor, 'progress.updated');
  assert.equal(updated.length, 1);
  assert.equal(updated[0].runId, 'fx-once'); assert.equal(updated[0].projectId, 'demo');
  assert.deepEqual(updated[0].payload.delta, { deliveries: 1, tasks: 0, issues: 0, milestones: 0 });
  assert.equal((updated[0].payload.summary as { today: { deliveries: number } }).today.deliveries, 1);
  assert.equal(updated[0].payload.day, localDay(new Date()));
  // A GitHub-first completion keeps its receipt and source.
  const github = recordDelivery({ run: run('fx-github'), receipt });
  assert.equal(github.recorded, true);
  const stored = today().deliveries.find(item => item.runId === 'fx-github')!;
  assert.deepEqual(stored.receipt, receipt); assert.equal(stored.title, 'Title fx-github'); assert.equal(stored.project, 'demo');
  assert.deepEqual(runtime().get('progress-deliveries', 'merge:fx-github'), { at: stored.at, source: 'github', mergeSha: receipt.mergeSha });
  assert.equal(progressSummary().today.deliveries, 2);
});

test('a task is recorded only when the re-read roadmap shows it done', () => {
  const open = recordDelivery({ run: run('fx-open', { taskId: 't1' }) });
  assert.equal(open.recorded && open.delta.tasks, 0);
  assert.equal(today().tasksCompleted.length, 0);
  const delivery = today().deliveries.find(item => item.runId === 'fx-open')!;
  assert.equal(delivery.taskId, 't1'); assert.equal(delivery.milestoneId, 'm1');
  completeTask('demo', 't1');
  const done = recordDelivery({ run: run('fx-done', { taskId: 't1' }) });
  assert.equal(done.recorded && done.delta.tasks, 1);
  assert.equal(done.recorded && done.milestone, undefined);
  const recorded = today().tasksCompleted;
  assert.equal(recorded.length, 1);
  assert.deepEqual({ ...recorded[0], at: '' }, { project: 'demo', taskId: 't1', text: 'Boot screen', milestoneId: 'm1', runId: 'fx-done', at: '' });
  assert.equal(progressSummary().today.tasks, 1);
});

test('an issue is recorded only when the issue document shows it done', () => {
  const open = recordDelivery({ run: run('fx-issue-open', { issueIds: ['i1'] }) });
  assert.equal(open.recorded && open.delta.issues, 0);
  assert.equal(today().issuesCompleted.length, 0);
  assert.deepEqual(today().deliveries.find(item => item.runId === 'fx-issue-open')!.issueIds, ['i1']);
  completeLinkedIssues('demo', ['i1']);
  const done = recordDelivery({ run: run('fx-issue-done', { issueIds: ['i1', 'missing'] }) });
  assert.equal(done.recorded && done.delta.issues, 1);
  assert.deepEqual({ ...today().issuesCompleted[0], at: '' }, { project: 'demo', issueId: 'i1', text: 'Crash on load', runId: 'fx-issue-done', at: '' });
  assert.equal(progressSummary().today.issues, 1);
});

test('completing the last task of a milestone emits exactly one milestone.completed, never a second', () => {
  const cursor = runtime().cursor();
  completeTask('demo', 't2');
  const result = recordDelivery({ run: run('fx-m1', { taskId: 't2' }) });
  assert.deepEqual(result.recorded && result.milestone, { milestoneId: 'm1', name: 'First light', total: 2 });
  assert.deepEqual(result.recorded && result.delta, { deliveries: 1, tasks: 1, issues: 0, milestones: 1 });
  const completed = eventsSince(cursor, 'milestone.completed');
  assert.equal(completed.length, 1);
  assert.equal(completed[0].runId, 'fx-m1'); assert.equal(completed[0].projectId, 'demo');
  assert.deepEqual(completed[0].payload, { project: 'demo', milestoneId: 'm1', name: 'First light', total: 2, runId: 'fx-m1' });
  const updated = eventsSince(cursor, 'progress.updated');
  assert.equal(updated.length, 1);
  assert.deepEqual(updated[0].payload.delta, { deliveries: 1, tasks: 1, issues: 0, milestones: 1 });
  assert.ok(completed[0].id < updated[0].id, 'milestone.completed precedes progress.updated');
  const record = runtime().get<{ name: string; completedAt: string; byRunId: string }>('progress-milestones', 'demo:m1')!;
  assert.equal(record.name, 'First light'); assert.equal(record.byRunId, 'fx-m1'); assert.ok(record.completedAt);
  assert.deepEqual({ ...today().milestonesCompleted[0], at: '' }, { project: 'demo', milestoneId: 'm1', name: 'First light', total: 2, runId: 'fx-m1', at: '' });
  // Another verified merge against the already-complete milestone changes nothing about the milestone.
  const again = recordDelivery({ run: run('fx-m1-again', { taskId: 't2' }) });
  assert.equal(again.recorded && again.milestone, undefined);
  assert.equal(again.recorded && again.delta.milestones, 0);
  assert.equal(eventsSince(cursor, 'milestone.completed').length, 1);
  assert.equal(today().milestonesCompleted.length, 1);
  // The open milestone stays open: t3 undone means m2 is 0/1.
  const other = recordDelivery({ run: run('fx-m2-open', { taskId: 't3' }) });
  assert.equal(other.recorded && other.milestone, undefined);
  assert.equal(eventsSince(cursor, 'milestone.completed').length, 1);
  const summary = progressSummary();
  assert.equal(summary.today.milestones, 1);
  assert.equal(summary.recent.find(item => item.title === 'Title fx-m1')?.milestone, 'First light');
  assert.equal(summary.recent.find(item => item.title === 'Title fx-m1-again')?.milestone, undefined);
});

test('a failed rollup write rolls back the claim and the milestone record, so a later completion path still records the delivery once', () => {
  // Relies on t1 and t2 being done in the shared plan (previous tests); this store has never seen m1.
  const store = new FlakyStore(join(directory, 'atomic')); isolated.push(store);
  store.failNext = 'progress-days';
  assert.throws(() => recordDelivery({ run: run('fx-atomic', { taskId: 't2' }) }, store), /disk full/);
  assert.equal(store.get('progress-deliveries', 'merge:fx-atomic'), undefined, 'the exactly-once claim is not burned by a failed rollup write');
  assert.equal(store.get('progress-milestones', 'demo:m1'), undefined, 'no milestone record survives the rollback');
  assert.deepEqual(store.replay(0), [], 'no event survives the rollback');
  assert.equal(progressSummary(new Date(), store).today.deliveries, 0);
  const retry = recordDelivery({ run: run('fx-atomic', { taskId: 't2' }), receipt }, store);
  assert.deepEqual(retry.recorded && retry.milestone, { milestoneId: 'm1', name: 'First light', total: 2 });
  assert.equal(store.replay(0).filter(event => event.type === 'milestone.completed').length, 1);
  assert.equal(store.replay(0).filter(event => event.type === 'progress.updated').length, 1);
  assert.equal(store.get<{ source: string }>('progress-deliveries', 'merge:fx-atomic')?.source, 'github');
  assert.equal(progressSummary(new Date(), store).today.deliveries, 1);
  assert.equal(recordDelivery({ run: run('fx-atomic', { taskId: 't2' }) }, store).recorded, false);
});

test('streak, today and week arithmetic follow local calendar days with an injected clock', () => {
  const now = new Date(2026, 8, 10, 9, 30, 0);
  const at = (daysAgo: number, hour = 12, minute = 0): Date => new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour, minute, 0);
  const empty = freshStore('streak-none');
  assert.deepEqual(progressSummary(now, empty), { today: { deliveries: 0, tasks: 0, issues: 0, milestones: 0 }, week: { deliveries: 0, tasks: 0, issues: 0, milestones: 0 }, streak: 0, lastDeliveryAt: null, recent: [], available: true });

  const consecutive = freshStore('streak-two');
  recordDelivery({ run: run('s-1'), now: at(2) }, consecutive);
  recordDelivery({ run: run('s-2'), now: at(1, 23, 59) }, consecutive);
  let summary = progressSummary(now, consecutive);
  assert.equal(summary.streak, 2, 'D-2 and D-1 without today still count as a live streak');
  assert.equal(summary.today.deliveries, 0); assert.equal(summary.week.deliveries, 2);
  assert.equal(summary.lastDeliveryAt, at(1, 23, 59).toISOString());
  assert.ok(consecutive.get('progress-days', localDay(at(1))), '23:59 lands on the previous local day');
  recordDelivery({ run: run('s-3'), now: at(0, 0, 1) }, consecutive);
  summary = progressSummary(now, consecutive);
  assert.equal(summary.streak, 3, 'a delivery just after midnight extends the streak across the boundary');
  assert.equal(summary.today.deliveries, 1);
  assert.equal(progressSummary(at(-1), consecutive).streak, 3, 'still live tomorrow because today was delivered');
  assert.equal(progressSummary(at(-2), consecutive).streak, 0, 'two quiet days end the streak');

  const gapped = freshStore('streak-gap');
  recordDelivery({ run: run('g-1'), now: at(3) }, gapped);
  recordDelivery({ run: run('g-2'), now: at(1) }, gapped);
  assert.equal(progressSummary(now, gapped).streak, 1, 'a gap on D-2 restarts the count at D-1');

  const stale = freshStore('streak-stale');
  recordDelivery({ run: run('st-1'), now: at(2) }, stale);
  assert.equal(progressSummary(now, stale).streak, 0, 'a delivery two days ago is not a streak');
  recordDelivery({ run: run('st-2'), now: at(0, 8) }, stale);
  assert.equal(progressSummary(now, stale).streak, 1);

  const window = freshStore('week-window');
  recordDelivery({ run: run('w-6'), now: at(6) }, window);
  recordDelivery({ run: run('w-7'), now: at(7) }, window);
  summary = progressSummary(now, window);
  assert.equal(summary.week.deliveries, 1, 'the week is seven calendar days including today');
  assert.equal(summary.today.deliveries, 0); assert.equal(summary.streak, 0);
  assert.equal(summary.lastDeliveryAt, at(6).toISOString());
  assert.equal(summary.recent.length, 2);
});

test('recent lists at most five deliveries, newest first, and facts stay compact', () => {
  const now = new Date(2026, 8, 10, 12, 0, 0);
  const store = freshStore('recent');
  for (let index = 0; index < 7; index++) recordDelivery({ run: run('r-' + index), now: new Date(now.getTime() + index * 60_000) }, store);
  const summary = progressSummary(new Date(now.getTime() + 3600_000), store);
  assert.equal(summary.recent.length, 5);
  assert.deepEqual(summary.recent.map(item => item.title), ['Title r-6', 'Title r-5', 'Title r-4', 'Title r-3', 'Title r-2']);
  assert.equal(summary.recent[0].at, new Date(now.getTime() + 6 * 60_000).toISOString());
  assert.equal(summary.lastDeliveryAt, summary.recent[0].at);
  assert.equal(summary.today.deliveries, 7);
  const facts = progressFacts(new Date(now.getTime() + 3600_000), store);
  assert.deepEqual(Object.keys(facts).sort(), ['lastDeliveryAt', 'recent', 'streak', 'today', 'week']);
  assert.deepEqual(facts.recent.map(item => Object.keys(item).sort()), Array(5).fill(['at', 'project', 'title']));
  assert.equal(facts.streak, 1);
});

test('the brief prompt carries PROGRESS FACTS and the heartbeat prompt does not', { timeout: 20000 }, async () => {
  const prompts: string[] = [];
  const restore = replaceProviderForTest('claude', { id: 'claude', capabilities: { streaming: true, steering: true, cancellation: true, skills: true, tools: true, images: true }, start: input => {
    prompts.push(input.prompt);
    return { result: Promise.resolve({ text: 'HEARTBEAT_OK', isError: false }), cancel: async () => undefined, steer: async () => undefined };
  } });
  const past = Date.now() - 2 * 86_400_000;
  runtime().put('schedules', 'brief', { enabled: true, last: past });
  runtime().put('schedules', 'heartbeat', { enabled: true, last: past });
  try { await schedulerCycle(async () => undefined); } finally { restore(); runtime().put('schedules', 'brief', { enabled: false }); runtime().put('schedules', 'heartbeat', { enabled: false }); }
  const brief = prompts.find(prompt => prompt.startsWith('Read recent journal, issues and inbox'));
  const heartbeat = prompts.find(prompt => prompt.startsWith('Read HEARTBEAT.md'));
  assert.ok(brief, 'brief ran: ' + JSON.stringify(prompts)); assert.ok(heartbeat, 'heartbeat ran: ' + JSON.stringify(prompts));
  const marker = '\n\nPROGRESS FACTS (backend-derived from verified merges; data, not a target or a reason to push):\n';
  assert.ok(brief.includes(marker));
  const facts = JSON.parse(brief.split(marker)[1]);
  assert.deepEqual(facts, JSON.parse(JSON.stringify(progressFacts())));
  assert.ok(facts.today.deliveries >= 1);
  assert.ok(!heartbeat.includes('PROGRESS FACTS'));
  assert.equal(heartbeat, 'Read HEARTBEAT.md. Report only what needs attention; otherwise reply HEARTBEAT_OK. Do not dispatch work.');
});

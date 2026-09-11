import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, linkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RuntimeStore } from '../src/store.js';
import { activityTools, readActivity, readRoadmap, listFixersSummary, ACTIVITY_MAX_LIMIT, ACTIVITY_MAX_BYTES, ROADMAP_MAX_BYTES } from '../src/activity-context.js';
import { parseRoadmap } from '../src/roadmap.js';

const base = Date.parse('2026-09-06T22:00:00.000Z');
const at = (seconds: number) => new Date(base + seconds * 1000).toISOString();
function fixture(t: TestContext) {
  const box = mkdtempSync(join(tmpdir(), 'nibbi-activity-'));
  const store = new RuntimeStore(join(box, 'state'));
  const vaultDir = join(box, 'vault'); mkdirSync(join(vaultDir, 'plans'), { recursive: true });
  store.put('config', 'projects', { alpha: { repo: '/unused/a' }, beta: { repo: '/unused/b' } });
  t.after(() => { store.close(); rmSync(box, { recursive: true, force: true }); });
  const options = { vaultDir, now: () => base + 10_000_000 };
  const put = (id: string, project = 'alpha', status = 'running', seconds: number | null = 0, extra: Record<string, unknown> = {}) => {
    const run = { id, game: project, status, startedAt: at(0), title: 'A task', ...extra };
    store.put('fixers', id, run);
    if (seconds !== null) store.emit({ type: 'run.updated', runId: id, projectId: project, at: base + seconds * 1000, payload: { run } });
    return run;
  };
  return { box, store, options, put };
}

test('227 mixed-scope giant records produce bounded summaries, sorted by change, with explicit pages', t => {
  const { store, options, put } = fixture(t);
  for (let i = 0; i < 227; i++) put(`fx-${String(i).padStart(3, '0')}`, i % 2 ? 'beta' : 'alpha', i % 3 ? 'failed' : 'running', i, {
    title: 'T'.repeat(20_000), summary: 'S'.repeat(60_000), issue: 'secret issue'.repeat(5000), context: 'private context', worktree: '/private/worktree',
  });
  const first = readActivity('alpha', {}, store, options);
  assert.equal(first.total, 114); assert.equal(first.returned, 8); assert.equal(first.hasMore, true); assert.equal(first.nextOffset, 8);
  assert.equal(first.scope.project, 'alpha'); assert.equal(first.items[0].id, 'fx-226');
  assert(first.items.every(item => item.project === 'alpha' && item.title.length === 180 && item.result.length === 600 && item.titleTruncated && item.resultTruncated));
  assert(!JSON.stringify(first).includes('secret issue')); assert(!JSON.stringify(first).includes('/private/worktree')); assert(!JSON.stringify(first).includes('private context'));
  assert(Buffer.byteLength(JSON.stringify(first)) < 22_000);
  const max = readActivity(undefined, { limit: ACTIVITY_MAX_LIMIT }, store, options);
  assert.equal(max.total, 227); assert.equal(max.items.length, 25); assert.equal(max.scope.mode, 'registered-projects');
  assert(Buffer.byteLength(JSON.stringify(max)) < 60_000);
  const seen: string[] = [];
  for (let offset = 0; offset < first.total; offset += 25) seen.push(...readActivity('alpha', { offset, limit: 25 }, store, options).items.map(item => item.id!));
  assert.equal(new Set(seen).size, 114); assert.equal(seen[0], 'fx-226'); assert.equal(seen.at(-1), 'fx-000');
  const last = readActivity('alpha', { offset: 100, limit: 25 }, store, options);
  assert.equal(last.returned, 14); assert.equal(last.hasMore, false); assert.equal(last.nextOffset, null);
  const alias = listFixersSummary('alpha', store, options);
  assert.deepEqual(alias, first);
});

test('scope cannot be widened; general reads only registered projects and exact IDs never resolve prefixes', t => {
  const { store, options, put } = fixture(t);
  put('fx-aaa'); put('fx-aab'); put('fx-bbb', 'beta'); put('fx-hidden', 'unregistered');
  assert.throws(() => readActivity('alpha', { project: 'beta' }, store, options), /scoped/);
  assert.throws(() => readActivity('alpha', { project: '*' }, store, options));
  assert.throws(() => readActivity(undefined, { project: 'unregistered' }, store, options), /registered/);
  assert.throws(() => readActivity('unregistered', {}, store, options), /registered/);
  assert.equal(readActivity('alpha', { runId: 'fx-bbb' }, store, options).total, 0);
  assert.equal(readActivity(undefined, { runId: 'fx-hidden' }, store, options).total, 0);
  assert.equal(readActivity(undefined, {}, store, options).total, 3);
  assert.equal(readActivity(undefined, { project: 'beta' }, store, options).total, 1);
  assert.equal(readActivity('alpha', { runId: 'fx-a' }, store, options).total, 0);
  assert.equal(readActivity('alpha', { runId: 'fx-aa' }, store, options).total, 0);
  assert.deepEqual(readActivity('alpha', { runId: 'fx-aaa' }, store, options).items.map(item => item.id), ['fx-aaa']);
});

test('strict input rejects malformed, unknown, fractional, negative and oversized arguments', async t => {
  const { store, options } = fixture(t);
  const invalid = [null, [], { limit: 0 }, { limit: 26 }, { limit: 1.2 }, { offset: -1 }, { offset: 1.1 }, { limit: '8' }, { status: 'done' }, { status: ['running'] }, { runId: '' }, { runId: 'x'.repeat(201) }, { id: 'fx-a' }, { project: '../beta' }, { changedSince: 'yesterday' }, { changedSince: '2026-02-30T00:00:00Z' }, { changedSince: 123 }, { changedSince: at(0), afterEventId: 0 }, { afterEventId: -1 }, { afterEventId: 0.5 }, { afterEventId: Number.MAX_SAFE_INTEGER + 1 }, { cursor: 'old' }];
  for (const value of invalid) assert.throws(() => readActivity('alpha', value as never, store, options), JSON.stringify(value));
  const tools = activityTools('alpha', store, options);
  assert.deepEqual(tools.map(tool => tool.name), ['read_activity', 'read_roadmap']);
  for (const tool of tools) {
    assert.equal(tool.inputSchema.additionalProperties, false);
    await assert.rejects(tool.call({ extra: true }, new AbortController().signal));
    await assert.rejects(tool.call({}, AbortSignal.abort()), /abort/i);
  }
});

test('safe empty and untracked legacy results never claim no activity or invent update timestamps', t => {
  const { store, options, put } = fixture(t);
  const empty = readActivity('alpha', {}, store, options);
  assert.equal(empty.total, 0); assert.equal(empty.hasMore, false); assert.match(empty.emptyMeaning!, /does not establish no activity/);
  put('fx-legacy', 'alpha', 'done', null, { endedAt: at(30), summary: 'All done, tests passed!' });
  put('fx-undated', 'alpha', 'failed', null, { startedAt: undefined });
  const all = readActivity('alpha', {}, store, options);
  const legacy = all.items.find(item => item.id === 'fx-legacy')!;
  assert.equal(legacy.status, 'staged'); assert.equal(legacy.storedStatus, 'done'); assert.equal(legacy.verificationStatus, 'unverified');
  assert.equal(legacy.updatedAt, null); assert.equal(legacy.lastStatusChangeAt, null); assert.equal(legacy.lastRecordedChangeAt, at(30)); assert.equal(legacy.changeTimeSource, 'legacy-start/end');
  assert.equal(all.untrackedRunCount, 2); assert.equal(all.unknownChangeTimeCount, 1);
  assert.equal(readActivity('alpha', { changedSince: at(29) }, store, options).total, 1);
  const after = readActivity('alpha', { afterEventId: 0 }, store, options);
  assert.equal(after.total, 0); assert.equal(after.untrackedRunCount, 2);
  assert.equal(readActivity('alpha', { status: 'staged' }, store, options).total, 1);
  store.remove('config', 'projects'); store.put('legacy', 'games.json', { alpha: {} });
  assert.equal(readActivity(undefined, {}, store, options).total, 2);
  assert.equal(store.get('config', 'projects'), undefined, 'legacy registry read must not persist migration');
  store.remove('legacy', 'games.json'); assert.equal(readActivity(undefined, {}, store, options).total, 0);
});

test('exclusive timestamp/event cutoffs and ordering use recorded evidence, not insertion or old snapshots', t => {
  const { store, options, put } = fixture(t);
  put('fx-old', 'alpha', 'queued', 0); put('fx-new', 'alpha', 'queued', 10);
  put('fx-old', 'alpha', 'running', 20);
  const marker = store.cursor();
  put('fx-old', 'alpha', 'failed', 30, { endedAt: at(30) });
  put('fx-new', 'alpha', 'running', 30);
  const all = readActivity('alpha', {}, store, options);
  assert.deepEqual(all.items.map(item => item.id), ['fx-new', 'fx-old']);
  assert.equal(all.items[1].lastStatusChangeAt, at(30));
  assert.equal(readActivity('alpha', { changedSince: at(30) }, store, options).total, 0);
  assert.equal(readActivity('alpha', { changedSince: '2026-09-06T23:00:29+01:00' }, store, options).total, 2);
  assert.equal(readActivity('alpha', { afterEventId: marker }, store, options).total, 2);
  assert.equal(readActivity('alpha', { afterEventId: store.cursor() }, store, options).total, 0);
  put('fx-old', 'alpha', 'failed', 40, { endedAt: at(30) });
  const repeated = readActivity('alpha', { runId: 'fx-old' }, store, options).items[0];
  assert.equal(repeated.updatedAt, at(40)); assert.equal(repeated.lastStatusChangeAt, at(30));
  const past = readActivity('alpha', { changedSince: at(0), runId: 'fx-old' }, store, options).items[0];
  assert.equal(past.status, 'failed', 'changedSince returns current status, never a historical snapshot');
  put('fx-old', 'alpha', 'failed', 15);
  assert.equal(readActivity('alpha', { changedSince: at(39), runId: 'fx-old' }, store, options).total, 1, 'wall-clock rollback must not hide a qualifying earlier event');
});

test('failure after a read never rewrites the earlier running observation; next read exposes failure', t => {
  const { store, options, put } = fixture(t);
  put('fx-race', 'alpha', 'installing', 1); put('fx-race', 'alpha', 'running', 2);
  const earlier = readActivity('alpha', { runId: 'fx-race' }, store, { ...options, now: () => base + 3000 });
  const frozen = JSON.stringify(earlier);
  put('fx-race', 'alpha', 'failed', 37, { endedAt: at(37), summary: 'Reached maximum number of turns (80)', verification: { status: 'unverified' } });
  const later = readActivity('alpha', { afterEventId: earlier.eventCursor }, store, { ...options, now: () => base + 38000 });
  assert.equal(JSON.stringify(earlier), frozen); assert.equal(earlier.items[0].status, 'running'); assert.equal(earlier.observedAt, at(3));
  assert.equal(later.items[0].status, 'failed'); assert.equal(later.items[0].verificationStatus, 'unverified');
  assert.equal(later.items[0].error, 'Reached maximum number of turns (80)'); assert.equal(later.items[0].lastStatusChangeAt, at(37)); assert.equal(later.observedAt, at(38));
});

test('status, verification, reported result and roadmap linkage remain separate', t => {
  const { store, options, put } = fixture(t);
  put('fx-a', 'alpha', 'failed', 1, { summary: 'The task is complete'.repeat(500) + '\nReached maximum number of turns (80)', verification: { status: 'unverified' } });
  put('fx-b', 'alpha', 'staged', 2, { verification: { status: 'passed', at: at(2) }, taskId: 'canonical-task' });
  put('fx-c', 'alpha', 'merged', 3);
  put('fx-d', 'alpha', 'failed', 4, { verification: { status: 'failed', at: at(4) } });
  const items = readActivity('alpha', {}, store, options).items;
  assert.equal(items.find(item => item.id === 'fx-a')!.status, 'failed');
  assert.match(items.find(item => item.id === 'fx-a')!.error!, /Reached maximum number of turns \(80\)$/);
  assert.equal(items.find(item => item.id === 'fx-a')!.resultEvidence, 'reported-text-not-independent-verification');
  assert.equal(items.find(item => item.id === 'fx-b')!.status, 'staged');
  assert.equal(items.find(item => item.id === 'fx-b')!.verificationStatus, 'passed');
  assert.equal(items.find(item => item.id === 'fx-b')!.taskId, 'canonical-task');
  assert.equal(items.find(item => item.id === 'fx-c')!.verificationStatus, 'unverified');
  assert.equal(items.find(item => item.id === 'fx-d')!.verificationStatus, 'failed');
  assert.equal(items.find(item => item.id === 'fx-c')!.roadmapLinked, false);
  assert(items.every(item => item.lastStatusChangeAt === null), 'first seen nonqueued status is not a proven transition');
});

test('roadmap resolves human labels to canonical hashes/markers and exact text without any writes', async t => {
  const { store, options } = fixture(t);
  const file = join(options.vaultDir, 'plans/alpha.md');
  const text = '## M12 — Effects\n- [ ] M12.4 **Extend the effect grammar** with Event verbs.\n- [x] Finished <!-- nibbi-task:pinned-done -->\n- [ ] Stable task <!-- nibbi-task:stable-id -->\n- [ ] Duplicate\n- [ ] Duplicate\n';
  writeFileSync(file, text);
  const beforeRows = store.db.prepare('SELECT * FROM records').all(); const cursor = store.cursor();
  const pending = readRoadmap('alpha', {}, store, options);
  assert.equal(pending.totalTasks, 5); assert.equal(pending.done, 1); assert.equal(pending.total, 4);
  assert.equal(pending.items[0].text, 'M12.4 **Extend the effect grammar** with Event verbs.');
  assert.equal(pending.items[0].id, parseRoadmap(text)[0].id); assert.notEqual(pending.items[0].id, 'M12.4');
  assert.equal(pending.items[0].explicit, false); assert.equal(pending.items[0].milestone, 'M12 — Effects');
  assert.equal(pending.items[1].id, 'stable-id'); assert.equal(pending.items[1].explicit, true);
  assert.notEqual(pending.items[2].id, pending.items[3].id, 'duplicate task text has occurrence-specific hashes');
  assert.equal(readRoadmap('alpha', { taskId: 'M12.4' }, store, options).total, 0);
  assert.equal(readRoadmap(undefined, { project: 'alpha', query: 'M12.4' }, store, options).items[0].id, pending.items[0].id);
  assert.equal(readRoadmap('alpha', { taskId: pending.items[0].id! }, store, options).total, 1);
  assert.equal(readRoadmap('alpha', { status: 'all' }, store, options).total, 5);
  assert.equal(readRoadmap('alpha', { status: 'all', taskId: 'pinned-done' }, store, options).items[0].dispatchable, false);
  const tool = activityTools('alpha', store, options)[1];
  assert.equal((await tool.call({ query: 'M12.4' }, new AbortController().signal) as typeof pending).total, 1);
  assert.equal(readFileSync(file, 'utf8'), text); assert.deepEqual(readdirSync(join(options.vaultDir, 'plans')), ['alpha.md']);
  assert.deepEqual(store.db.prepare('SELECT * FROM records').all(), beforeRows); assert.equal(store.cursor(), cursor);
});

test('roadmap scope, registration, traversal, symlink confinement, missing files and malformed input', t => {
  const { store, options, box } = fixture(t);
  assert.throws(() => readRoadmap(undefined, {}, store, options), /must select/);
  assert.throws(() => readRoadmap('alpha', { project: 'beta' }, store, options), /scoped/);
  assert.throws(() => readRoadmap(undefined, { project: 'unknown' }, store, options), /registered/);
  for (const args of [{ project: '../beta' }, { status: 'done' }, { limit: 26 }, { offset: -1 }, { query: '' }, { taskId: '' }, { path: '/tmp/secret' }]) assert.throws(() => readRoadmap('alpha', args as never, store, options));
  const missing = readRoadmap('alpha', {}, store, options);
  assert.equal(missing.exists, false); assert.equal(missing.total, 0); assert.equal(missing.hasMore, false);
  const outside = join(box, 'private.md'); writeFileSync(outside, '- [ ] private task');
  symlinkSync(outside, join(options.vaultDir, 'plans/alpha.md'));
  assert.throws(() => readRoadmap('alpha', {}, store, options), /outside/);
});

test('roadmap pagination and gigantic strings are bounded with explicit truncation and dispatch safety', t => {
  const { store, options } = fixture(t);
  const file = join(options.vaultDir, 'plans/alpha.md');
  const text = '## ' + 'M'.repeat(5000) + '\n' + Array.from({ length: 60 }, (_, i) => `- [ ] Task ${i} ` + 'T'.repeat(4000)).join('\n')
    + '\n- [ ] Huge marker <!-- nibbi-task:' + 'I'.repeat(5000) + ' -->\n- [ ] One <!-- nibbi-task:duplicate -->\n- [ ] Two <!-- nibbi-task:duplicate -->';
  writeFileSync(file, text);
  const first = readRoadmap('alpha', { limit: 25 }, store, options);
  assert.equal(first.total, 63); assert.equal(first.items.length, 25); assert.equal(first.hasMore, true); assert.equal(first.nextOffset, 25);
  assert(first.items.every(task => task.text.length === 2000 && task.textTruncated && task.milestone?.length === 180 && task.milestoneTruncated && task.dispatchable));
  assert(Buffer.byteLength(JSON.stringify(first)) < 65_000);
  const last = readRoadmap('alpha', { offset: 50, limit: 25 }, store, options);
  assert.equal(last.items.length, 13); assert.equal(last.hasMore, false); assert.equal(last.nextOffset, null);
  const huge = readRoadmap('alpha', { query: 'Huge marker' }, store, options).items[0];
  assert.equal(huge.id, null); assert.equal(huge.idUnavailable, true); assert.equal(huge.dispatchable, false);
  assert(readRoadmap('alpha', { taskId: 'duplicate' }, store, options).items.every(task => !task.dispatchable));
  assert.equal(readFileSync(file, 'utf8'), text);
});


test('all stored scalars and canonical IDs are bounded or explicitly unavailable, never silently clipped', t => {
  const { store, options, put } = fixture(t);
  const huge = 'X'.repeat(1_000_000);
  put('fx-big', 'alpha', 'running', null, { taskId: huge, startedAt: huge, endedAt: { secret: huge }, verification: { status: huge, at: huge } });
  put(huge, 'alpha', huge, null, { startedAt: 'not a time', taskId: { invalid: true }, verification: { status: 'passed', at: '2026-02-30T00:00:00Z' } });
  put('bad id with controls\n', 'alpha', 'running', null, { taskId: 'invalid task/id' });
  store.db.pragma('query_only=ON');
  const result = readActivity('alpha', { limit: 25 }, store, options);
  assert.equal(result.total, 3); assert.equal(result.returned, 3); assert.equal(result.unavailableIdCount, 2); assert.equal(result.unknownStatusCount, 1);
  assert(Buffer.byteLength(JSON.stringify(result)) <= ACTIVITY_MAX_BYTES);
  assert(!JSON.stringify(result).includes('X'.repeat(1000)));
  const first = result.items.find(item => item.id === 'fx-big')!;
  assert.equal(first.taskId, null); assert.equal(first.taskIdUnavailable, true); assert.equal(first.roadmapLinked, null);
  assert.equal(first.startedAt, null); assert.equal(first.endedAt, null); assert.equal(first.verificationAt, null);
  assert.equal(first.verificationStatus, 'unverified');
  for (const field of ['taskId', 'startedAt', 'endedAt', 'verificationAt', 'verificationStatus']) assert(first.unavailableFields.includes(field));
  const unknown = result.items.find(item => item.status === 'unknown')!;
  assert.equal(unknown.id, null); assert.equal(unknown.idUnavailable, true); assert.equal(unknown.storedStatus, null);
  assert(unknown.unavailableFields.includes('status'));
  assert.equal(unknown.timeStatus.verificationAt, 'invalid');
  assert(result.items.filter(item => item.idUnavailable).every(item => item.id === null));
  assert.equal(readActivity('alpha', { runId: 'X'.repeat(200) }, store, options).total, 0, 'a prefix of an unavailable ID is not a usable ID');
});

test('hard serialized UTF-8 byte caps hold for Unicode/escaped activity and roadmap output', t => {
  const { store, options, put } = fixture(t);
  for (let i = 0; i < 25; i++) put(`fx-${i}-` + 'I'.repeat(180), 'alpha', 'failed', i, {
    title: '\u0001"\\'.repeat(1000), summary: '🌋漢\u0001"\\'.repeat(5000), taskId: 'T'.repeat(200),
    verification: { status: 'failed', at: at(i) }, endedAt: at(i),
  });
  const result = readActivity('alpha', { limit: 25 }, store, options);
  assert.equal(result.returned, 25); assert(result.payloadTruncated);
  assert(Buffer.byteLength(JSON.stringify(result)) <= ACTIVITY_MAX_BYTES);
  assert.equal(result.maxBytes, ACTIVITY_MAX_BYTES);
  assert(result.items.every(item => item.id?.length === 186 || item.id?.length === 185));
  assert(result.items.every(item => item.taskId === 'T'.repeat(200) && item.error === (item.result || null)));
  writeFileSync(join(options.vaultDir, 'plans/alpha.md'), '## ' + '🌋"\\'.repeat(200) + '\n'
    + Array.from({ length: 25 }, (_, i) => `- [ ] ${'🌋漢"\\'.repeat(1000)} <!-- nibbi-task:id-${i} -->`).join('\n'));
  const plan = readRoadmap('alpha', { limit: 25 }, store, options);
  assert.equal(plan.returned, 25); assert(plan.payloadTruncated);
  assert(Buffer.byteLength(JSON.stringify(plan)) <= ROADMAP_MAX_BYTES);
  assert.equal(plan.maxBytes, ROADMAP_MAX_BYTES);
  assert(plan.items.every((item, i) => item.id === `id-${i}` && item.dispatchable && item.textTruncated));
});

test('matching project is mandatory for latest events, deltas, and transitions; NULL legacy events remain untracked', t => {
  const { store, options, put } = fixture(t);
  put('fx-same', 'alpha', 'running', 1);
  const marker = store.cursor();
  store.put('fixers', 'fx-same', { id: 'fx-same', game: 'alpha', status: 'failed', startedAt: at(0) });
  store.emit({ type: 'run.updated', runId: 'fx-same', projectId: 'beta', at: base + 2000, payload: { run: { game: 'beta', status: 'failed' } } });
  store.emit({ type: 'run.updated', runId: 'fx-same', at: base + 3000, payload: { run: { game: 'alpha', status: 'failed' } } });
  put('fx-null-only', 'alpha', 'running', null);
  store.emit({ type: 'run.updated', runId: 'fx-null-only', at: base + 4000, payload: { run: { game: 'alpha', status: 'running' } } });
  store.db.pragma('query_only=ON');
  const all = readActivity('alpha', {}, store, options);
  const item = all.items.find(item => item.id === 'fx-same')!;
  assert.equal(item.updatedAt, at(1)); assert.equal(item.lastStatusChangeAt, null); assert.equal(item.lastEventId, marker);
  assert.equal(item.ignoredEventCount, 2); assert.equal(all.ignoredEventCount, 3);
  assert.equal(readActivity('alpha', { afterEventId: marker }, store, options).total, 0);
  assert.equal(readActivity('alpha', { changedSince: at(1) }, store, options).total, 0);
  const legacy = all.items.find(item => item.id === 'fx-null-only')!;
  assert.equal(legacy.updatedAt, null); assert.equal(legacy.lastEventId, null); assert.equal(legacy.changeTimeSource, 'legacy-start/end');
  assert.equal(all.untrackedRunCount, 1); assert.match(all.semantics, /NULL\/conflicting-project events are omitted/);
});

test('out-of-range/malformed event and record times are explicit unknowns; future times are qualified', t => {
  const { store, options, put } = fixture(t);
  put('fx-date', 'alpha', 'queued', 1);
  put('fx-date', 'alpha', 'failed', null, { startedAt: '2026-02-30T00:00:00Z', endedAt: 'no date', verification: { at: '2026-09-06T22:00:00Z\u0000hidden' } });
  store.emit({ type: 'run.updated', runId: 'fx-date', projectId: 'alpha', at: 1e16, payload: { run: { status: 'failed' } } });
  const result = readActivity('alpha', {}, store, options);
  const item = result.items[0];
  assert.equal(item.updatedAt, null); assert.equal(item.lastStatusChangeAt, null); assert.equal(item.lastRecordedChangeAt, null);
  assert.equal(item.startedAt, null); assert.equal(item.endedAt, null); assert.equal(item.verificationAt, null);
  assert.equal(result.unknownChangeTimeCount, 1); assert.equal(item.changeTimeSource, 'unknown');
  for (const key of ['startedAt', 'endedAt', 'updatedAt', 'lastStatusChangeAt', 'verificationAt'] as const) assert.equal(item.timeStatus[key], 'invalid');
  assert.equal(readActivity('alpha', { changedSince: at(2) }, store, options).total, 0, 'invalid future evidence cannot satisfy a time cutoff');
  const delta = readActivity('alpha', { afterEventId: 0 }, store, options);
  assert.equal(delta.total, 1, 'event ID evidence still returns current status with unknown time');
  store.db.prepare("INSERT INTO events(run_id,project_id,type,at,payload) VALUES(?,?,?,?,?)").run('fx-date', 'alpha', 'run.updated', 'X'.repeat(1_000_000), JSON.stringify({ run: { status: 'running' } }));
  const malformed = readActivity('alpha', { runId: 'fx-date' }, store, options).items[0];
  assert.equal(malformed.updatedAt, null); assert.equal(malformed.timeStatus.updatedAt, 'invalid');
  assert(Buffer.byteLength(JSON.stringify(malformed)) < 3000);
  put('fx-future', 'alpha', 'running', 30_000, { startedAt: at(30_000), verification: { at: at(30_000) } });
  const future = readActivity('alpha', { runId: 'fx-future' }, store, options).items[0];
  assert.equal(future.timeStatus.startedAt, 'future'); assert.equal(future.timeStatus.updatedAt, 'future'); assert.equal(future.timeStatus.verificationAt, 'future');
  assert.throws(() => readActivity('alpha', {}, store, { ...options, now: () => 1e16 }), /observation/);
});

test('roadmap rejects inside-vault project aliases, directory aliases, hardlinks, and nonregular files without writes', t => {
  const { store, options } = fixture(t);
  const plans = join(options.vaultDir, 'plans'), alpha = join(plans, 'alpha.md'), beta = join(plans, 'beta.md');
  writeFileSync(beta, '- [ ] PRIVATE BETA CHECKBOX');
  symlinkSync(beta, alpha);
  assert.throws(() => readRoadmap('alpha', {}, store, options), /alias|identity/);
  rmSync(alpha); linkSync(beta, alpha);
  assert.throws(() => readRoadmap('alpha', {}, store, options), /alias|identity/);
  rmSync(alpha); mkdirSync(alpha);
  assert.throws(() => readRoadmap('alpha', {}, store, options), /nonregular/);
  rmSync(alpha, { recursive: true });
  const alias = join(options.vaultDir, 'other-plans'); mkdirSync(alias);
  rmSync(plans, { recursive: true }); symlinkSync(alias, plans);
  assert.throws(() => readRoadmap('alpha', {}, store, options), /directory alias/);
});

test('roadmap file-descriptor reads reject oversize files and leave SQLite/files unchanged', t => {
  const { store, options } = fixture(t);
  const file = join(options.vaultDir, 'plans/alpha.md');
  writeFileSync(file, 'x'.repeat(5_000_001));
  assert.throws(() => readRoadmap('alpha', {}, store, options), /exceeds 5 MB/);
  const text = '- [ ] Read-only item <!-- nibbi-task:stable -->'; writeFileSync(file, text);
  store.db.pragma('query_only=ON');
  const before = store.db.prepare('SELECT total_changes() AS n').get();
  for (let i = 0; i < 10; i++) assert.equal(readRoadmap('alpha', {}, store, options).items[0].id, 'stable');
  readActivity('alpha', {}, store, options);
  assert.deepEqual(store.db.prepare('SELECT total_changes() AS n').get(), before);
  assert.equal(readFileSync(file, 'utf8'), text); assert.deepEqual(readdirSync(join(options.vaultDir, 'plans')), ['alpha.md']);
});

test('first-page watermark recovers a run that moves ahead of a live offset during pagination', t => {
  const { store, options, put } = fixture(t);
  put('fx-a', 'alpha', 'running', 3); put('fx-b', 'alpha', 'running', 2); put('fx-c', 'alpha', 'running', 1);
  const first = readActivity('alpha', { limit: 1 }, store, options);
  assert.equal(first.items[0].id, 'fx-a');
  put('fx-b', 'alpha', 'failed', 4);
  const later = readActivity('alpha', { limit: 25, offset: 1 }, store, options);
  assert(!later.items.some(item => item.id === 'fx-b'));
  assert.equal(readActivity('alpha', { afterEventId: later.eventCursor }, store, options).total, 0);
  assert.equal(readActivity('alpha', { afterEventId: first.eventCursor }, store, options).items[0].id, 'fx-b');
  assert.match(first.semantics, /FIRST page eventCursor/); assert.match(first.semantics, /NEVER the final page cursor/);
});

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentInput, AgentResult } from '../src/providers/types.js';

const root = mkdtempSync(join(tmpdir(), 'nibbi-steer-'));
process.env.NODE_ENV = 'test';
process.env.NIBBI_STATE_DIR = join(root, 'state'); process.env.NIBBI_VAULT_DIR = join(root, 'vault');
process.env.NIBBI_WORK_DIR = join(root, 'work'); process.env.NIBBI_PROJECTS_DIR = join(root, 'projects');
process.env.NIBBI_OWNER = 'Fixture Owner'; process.env.NIBBI_PORT = '0';
for (const path of [process.env.NIBBI_VAULT_DIR, join(root, 'projects/demo')]) mkdirSync(path, { recursive: true });
for (const name of ['SOUL.md', 'AGENTS.md', 'MEMORY.md', 'index.md']) writeFileSync(join(process.env.NIBBI_VAULT_DIR, name), 'FIXTURE ' + name);
const { runtime, closeRuntime } = await import('../src/store.js');
const { runTurn, steerTurn, activeTurns, shutdownSessions } = await import('../src/session.js');
const { replaceProviderForTest } = await import('../src/providers/index.js');
const { replaceLocalChatForTest, clearUsageLimit } = await import('../src/local-fallback.js');
const { closeToolService } = await import('../src/tool-service.js');
const { status } = await import('../src/read-models.js');
const { createProject } = await import('../src/projects.js');
const fixer = await import('../src/fixer.js');
const store = runtime();
store.put('config', 'projects', { demo: { repo: join(root, 'projects/demo'), settings: { lead: { provider: 'claude', model: 'fixture-primary' } } } });
after(async () => { await shutdownSessions(); await fixer.shutdownFixers(); await closeToolService(); closeRuntime(); rmSync(root, { recursive: true, force: true }); });

const caps = (steering: boolean) => ({ streaming: true, steering, cancellation: true, skills: true, tools: true, images: true });
type Ready = { runId: string; steerable: boolean };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
/** Fake provider whose result waits for release(); steer texts are recorded; cancel releases so aborted turns never hang. */
function gated(steering = true, hooks: { onStart?: (input: AgentInput) => void; beforeResult?: (input: AgentInput) => void } = {}) {
  const started = deferred<AgentInput>(), result = deferred<AgentResult>(); const steers: string[] = [];
  const restore = replaceProviderForTest('claude', { id: 'claude', capabilities: caps(steering), start: input => {
    hooks.onStart?.(input); started.resolve(input);
    return { result: result.promise.then(value => { hooks.beforeResult?.(input); return value; }), cancel: async () => result.resolve({ text: 'cancelled', isError: true }), steer: async text => { steers.push(text); } };
  } });
  return { steers, started: started.promise, release: (text = 'Fixture reply') => result.resolve({ text, isError: false }), restore };
}
const steerRows = () => store.db.prepare("SELECT role,channel,project_id,text,metadata FROM messages WHERE text LIKE '[STEER] %' ORDER BY id").all() as { role: string; channel: string; project_id: string; text: string; metadata: string }[];
const steeredEvents = (cursor: number) => store.replay(cursor, 500).filter(event => event.type === 'turn.steered');
const chat = (prompt: string, options: Parameters<typeof runTurn>[8]) => runTurn(prompt, undefined, 'app', undefined, undefined, undefined, undefined, false, options);

test('steerTurn reaches only a live primary handle and leaves an event plus an honest [STEER] history row', { timeout: 20_000 }, async () => {
  await assert.rejects(steerTurn('lead-bogus', 'anything'), /Turn is not active/);
  let duringStart: Promise<unknown> | undefined;
  const fake = gated(true, { onStart: input => { duringStart = steerTurn(input.runId, 'before the handle exists').catch(error => error); } });
  const cursor = store.cursor(), ready = deferred<Ready>();
  let beforeControl: Promise<unknown> | undefined;
  const turn = chat('Draft the export preview copy.', { project: 'demo', onStart: id => { beforeControl = steerTurn(id, 'before the control exists').catch(error => error); }, onReady: (runId, info) => ready.resolve({ runId, ...info }) });
  try {
    const { runId, steerable } = await ready.promise;
    assert.equal(steerable, true);
    assert.match((await beforeControl as Error).message, /Turn is not active/);
    assert.match((await duringStart as Error).message, /still starting/);
    assert.deepEqual(status().activeTurn, { runId, provider: 'claude', steerable: true });
    assert.deepEqual(activeTurns(), [{ runId, provider: 'claude', steerable: true, project: 'demo' }]);
    await assert.rejects(steerTurn(runId, '   '), /1-20000/);
    await assert.rejects(steerTurn(runId, 'x'.repeat(20_001)), /1-20000/);
    assert.deepEqual(fake.steers, []); assert.equal(steerRows().length, 0);
    await steerTurn(runId, '  Keep the amber highlight.  ');
    assert.deepEqual(fake.steers, ['Keep the amber highlight.']);
    const events = steeredEvents(cursor);
    assert.equal(events.length, 1); assert.equal(events[0].runId, runId); assert.equal(events[0].projectId, 'demo'); assert.deepEqual(events[0].payload, { text: 'Keep the amber highlight.' });
    const rows = steerRows(); assert.equal(rows.length, 1);
    assert.equal(rows[0].role, 'user'); assert.equal(rows[0].channel, 'app'); assert.equal(rows[0].project_id, 'demo');
    assert.equal(rows[0].text, '[STEER] Keep the amber highlight.'); assert.equal(JSON.parse(rows[0].metadata).runId, runId);
    const long = 'y'.repeat(1000); await steerTurn(runId, long);
    assert.equal(fake.steers[1], long); assert.equal(String(steeredEvents(cursor)[1].payload.text).length, 400); assert.equal(steerRows()[1].text, '[STEER] ' + long);
    fake.release('Fixture reply');
    const result = await turn; assert.equal(result.runId, runId); assert.equal(result.text, 'Fixture reply'); assert.equal(result.isError, false);
    await assert.rejects(steerTurn(runId, 'too late'), /Turn is not active/);
    assert.equal(status().activeTurn, null); assert.deepEqual(activeTurns(), []);
    assert.equal(fake.steers.length, 2); assert.equal(steerRows().length, 2);
  } finally { fake.release(); await turn.catch(() => undefined); fake.restore(); }
});

test('a provider without steering capability refuses guidance and reports steerable:false', { timeout: 20_000 }, async () => {
  const fake = gated(false); const cursor = store.cursor(), ready = deferred<Ready>(), before = steerRows().length;
  const turn = chat('Question two.', { project: 'demo', onReady: (runId, info) => ready.resolve({ runId, ...info }) });
  try {
    const { runId, steerable } = await ready.promise;
    assert.equal(steerable, false);
    assert.deepEqual(status().activeTurn, { runId, provider: 'claude', steerable: false });
    await assert.rejects(steerTurn(runId, 'guide it'), /claude provider cannot take guidance/);
    assert.deepEqual(fake.steers, []); assert.equal(steeredEvents(cursor).length, 0); assert.equal(steerRows().length, before);
    fake.release(); const result = await turn; assert.equal(result.runId, runId);
    await assert.rejects(steerTurn(runId, 'late'), /Turn is not active/); assert.equal(status().activeTurn, null);
  } finally { fake.release(); await turn.catch(() => undefined); fake.restore(); }
});

test('LOCAL fallback refuses guidance even though a local handle is live', { timeout: 20_000 }, async () => {
  clearUsageLimit(store, 'claude');
  const quota: AgentResult = { text: 'Provider diagnostic', isError: true, usageLimit: { kind: 'usage_limit', provider: 'claude', resetAtMs: Date.now() + 60_000 }, evidence: { toolAttempted: false, ordinaryTextProduced: false } };
  const restorePrimary = replaceProviderForTest('claude', { id: 'claude', capabilities: caps(true), start: () => ({ result: Promise.resolve(quota), cancel: async () => undefined, steer: async () => undefined }) });
  const localStarted = deferred<void>(), localDone = deferred<void>(); const localSteers: string[] = [];
  const restoreLocal = replaceLocalChatForTest(input => {
    localStarted.resolve();
    return { result: localDone.promise.then(() => ({ text: 'LOCAL answer', localModel: input.model!, isError: false, costUsd: 0, ctxTokens: 5 })), cancel: async () => localDone.resolve(), steer: async text => { localSteers.push(text); } };
  }, async () => undefined);
  const cursor = store.cursor(), before = steerRows().length; let runId = '';
  const turn = chat('Question three.', { project: 'demo', onStart: id => { runId = id; } });
  try {
    await localStarted.promise;
    assert.deepEqual(status().activeTurn, { runId, provider: 'claude', steerable: false });
    await assert.rejects(steerTurn(runId, 'guide it'), /LOCAL chat cannot take guidance/);
    assert.deepEqual(localSteers, []); assert.equal(steeredEvents(cursor).length, 0); assert.equal(steerRows().length, before);
    localDone.resolve(); const result = await turn; assert.equal(result.local, true); assert.equal(result.text, 'LOCAL answer');
    assert.equal(status().activeTurn, null);
  } finally { localDone.resolve(); await turn.catch(() => undefined); restorePrimary(); restoreLocal(); clearUsageLimit(store, 'claude'); }
});

test('status().activeTurn prefers the interactive turn over a concurrent scheduled one', { timeout: 20_000 }, async () => {
  const cron = gated(true); const cronTurn = runTurn('Scheduled sweep.', undefined, 'cron', undefined, undefined, undefined, undefined, false, { provider: 'claude', allowDispatch: false });
  let app: ReturnType<typeof gated> | undefined; let appTurn: Promise<unknown> | undefined;
  try {
    const cronRun = (await cron.started).runId;
    assert.deepEqual(status().activeTurn, { runId: cronRun, provider: 'claude', steerable: true });
    app = gated(true); const ready = deferred<Ready>();
    appTurn = chat('Question four.', { project: 'demo', onReady: (runId, info) => ready.resolve({ runId, ...info }) });
    const { runId } = await ready.promise;
    assert.deepEqual(activeTurns().map(turn => turn.runId), [runId, cronRun]);
    assert.deepEqual(status().activeTurn, { runId, provider: 'claude', steerable: true });
    await steerTurn(runId, 'Stay on the export copy.');
    assert.deepEqual(app.steers, ['Stay on the export copy.']); assert.deepEqual(cron.steers, []);
    assert.equal(steerRows().at(-1)?.channel, 'app');
    app.release(); await appTurn;
    assert.deepEqual(status().activeTurn, { runId: cronRun, provider: 'claude', steerable: true });
    cron.release(); await cronTurn; assert.equal(status().activeTurn, null);
  } finally { app?.release(); cron.release(); await Promise.allSettled([appTurn, cronTurn]); app?.restore(); cron.restore(); }
});

test('run.steer is advertised only while a fixer holds a live handle', { timeout: 30_000 }, async () => {
  await createProject('steer-fixer');
  const fake = gated(true, { beforeResult: input => writeFileSync(join(input.cwd, 'feature.txt'), 'steered change\n') });
  const build = fixer.spawnFixer('steer-fixer', 'Add a feature', async () => undefined);
  try {
    assert.equal(fixer.isSteerable(build.id), false);
    assert.deepEqual(fixer.allowedRunActions(build).filter(action => action.startsWith('run.st')), ['run.stop']);
    await fake.started;
    assert.equal(fixer.isSteerable(build.id), true);
    const actions = fixer.allowedRunActions(runtime().get<import('../src/fixer.js').Fixer>('fixers', build.id)!);
    assert.deepEqual(actions.slice(0, 2), ['run.stop', 'run.steer']);
    await fixer.steerFixer(build.id, 'Prefer the smallest diff.'); assert.deepEqual(fake.steers, ['Prefer the smallest diff.']);
    fake.release('Fixture update'); await fixer.waitForFixer(build.id);
    const done = runtime().get<import('../src/fixer.js').Fixer>('fixers', build.id)!;
    assert.equal(done.status, 'staged'); assert.equal(fixer.isSteerable(build.id), false);
    assert.equal(fixer.allowedRunActions(done).includes('run.steer'), false);
    await assert.rejects(fixer.steerFixer(build.id, 'late'), /not steerable/);
  } finally { fake.release(); await fixer.waitForFixer(build.id); fake.restore(); }
});

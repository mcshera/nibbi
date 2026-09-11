import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { AgentInput, AgentResult, AgentProvider } from '../src/providers/types.js';
import type { LocalChatInput, LocalChatHandle } from '../src/providers/local.js';

const root = mkdtempSync(join(tmpdir(), 'nibbi-local-fallback-'));
process.env.NODE_ENV = 'test';
process.env.NIBBI_STATE_DIR = join(root, 'state'); process.env.NIBBI_VAULT_DIR = join(root, 'vault');
process.env.NIBBI_WORK_DIR = join(root, 'work'); process.env.NIBBI_PROJECTS_DIR = join(root, 'projects');
process.env.NIBBI_OWNER = 'Fixture Owner'; process.env.NIBBI_PORT = '0';
for (const path of [process.env.NIBBI_VAULT_DIR, join(root, 'projects/demo'), join(root, 'projects/other')]) mkdirSync(path, { recursive: true });
for (const name of ['SOUL.md', 'AGENTS.md', 'MEMORY.md', 'index.md']) writeFileSync(join(process.env.NIBBI_VAULT_DIR, name), 'CANONICAL FIXTURE ' + name);
const { runtime, closeRuntime } = await import('../src/store.js');
const { runTurn, shutdownSessions, cancelTurn } = await import('../src/session.js');
const { replaceProviderForTest } = await import('../src/providers/index.js');
const { ProviderTurnError } = await import('../src/providers/failure.js');
const { replaceLocalChatForTest: replaceLocalForTest, rememberUsageLimit, clearUsageLimit, activeUsageLimit, primaryLocalBridge } = await import('../src/local-fallback.js');
// All orchestration transports, including metadata preflight, are fake here.
const replaceLocalChatForTest = (start: (input: LocalChatInput) => LocalChatHandle) => replaceLocalForTest(start, async () => undefined);
const { closeToolService } = await import('../src/tool-service.js');
const { loadState, saveState } = await import('../src/state.js');
const { readChat } = await import('../src/history.js');
const store = runtime();
store.put('config', 'projects', { demo: { repo: join(root, 'projects/demo'), settings: { lead: { provider: 'claude', model: 'fixture-primary' } } }, other: { repo: join(root, 'projects/other') } });
const refs = createHash('sha256').update('[]').digest('hex');
const sessionKey = 'demo:claude:' + refs;
const caps = { streaming: true, steering: true, cancellation: true, skills: true, tools: true, images: true };
const quota = (provider: 'claude' | 'codex' = 'claude', resetAtMs?: number): AgentResult => ({ text: 'Provider diagnostic, not ordinary response', isError: true,
  usageLimit: { kind: 'usage_limit', provider, ...(resetAtMs ? { resetAtMs } : {}) }, evidence: { toolAttempted: false, ordinaryTextProduced: false }, costUsd: 0.25, sessionId: 'failed-new-id' });
const makePrimary = (start: AgentProvider['start'], id: 'claude' | 'codex' = 'claude'): AgentProvider => ({ id, capabilities: caps, start });
const primaryResult = (result: AgentResult) => makePrimary(() => ({ result: Promise.resolve(result), cancel: async () => undefined, steer: async () => undefined }));
const fakeLocal = (text = 'LOCAL fixture answer'): ((input: LocalChatInput) => LocalChatHandle) => input => ({ result: Promise.resolve({ text, localModel: input.model!, isError: false, costUsd: 0, ctxTokens: 77 }), cancel: async () => undefined, steer: async () => { throw new Error('no local steering'); } });
const countMessages = () => (store.db.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number }).n;
function seed() {
  clearUsageLimit(store, 'claude'); clearUsageLimit(store, 'codex');
  store.db.prepare("DELETE FROM records WHERE bucket='local-chat-bridges'").run();
  store.put('sessions', sessionKey, { id: 'preserved-primary-id', provider: 'claude' });
  saveState({ turns: 10, costUsdTotal: 3, sessionId: 'preserved-global-id', ctxTokens: 999, modelOverride: 'preserved-model', rateLimit: { status: 'rejected', resetsAt: Date.now() / 1000 + 999 } });
}
after(async () => { await shutdownSessions(); await closeToolService(); closeRuntime(); rmSync(root, { recursive: true, force: true }); });

test('one in-run quota transition preserves sessions/settings/history/accounting and revokes tools before local', async () => {
  seed(); const before = countMessages(); const cursor = store.cursor(); const primaryInputs: AgentInput[] = []; const localInputs: LocalChatInput[] = []; const order: string[] = [];
  const settings = JSON.stringify(store.get('config', 'projects'));
  const restorePrimary = replaceProviderForTest('claude', makePrimary(input => {
    primaryInputs.push(input); return { result: Promise.resolve(quota()), cancel: async () => { order.push('primary-cancelled'); }, steer: async () => undefined };
  }));
  const restoreLocal = replaceLocalChatForTest(input => {
    order.push('local-started'); localInputs.push(input);
    return { ...fakeLocal()(input), result: (async () => {
      const primary = primaryInputs[0];
      const revoked = await fetch(primary.tools.url, { method: 'POST', headers: { authorization: 'Bearer ' + primary.tools.token }, body: '{}' });
      assert.equal(revoked.status, 403);
      input.onDelta?.('LOCAL fixture answer'); return { text: 'LOCAL fixture answer', localModel: input.model!, isError: false, costUsd: 0, ctxTokens: 77 };
    })() };
  });
  const starts: string[] = []; const notices: unknown[] = []; const deltas: string[] = [];
  try {
    const result = await runTurn('Current request stays whole.', undefined, 'app', undefined, t => deltas.push(t), undefined, undefined, false,
      { project: 'demo', onStart: id => starts.push(id), onFallback: info => { order.push('fallback-notice'); notices.push(info); } });
    assert.equal(result.local, true); assert.equal(result.localModel, 'llama3.2:1b'); assert.equal(result.costUsd, 0.25);
    assert.equal(result.sessionId, undefined); assert.equal(result.ctxTokens, 77); assert.equal(result.isError, false);
    assert.equal(primaryInputs.length, 1); assert.equal(localInputs.length, 1); assert.equal(starts.length, 1); assert.equal(notices.length, 1);
    assert.deepEqual(order, ['primary-cancelled', 'fallback-notice', 'local-started']); assert.deepEqual(deltas, ['LOCAL fixture answer']);
    assert.deepEqual(Object.keys(localInputs[0]).sort(), ['messages', 'model', 'onDelta', 'signal']);
    assert.equal(localInputs[0].messages.at(-1)!.content, 'Current request stays whole.');
    assert.match(localInputs[0].messages[0].content, /CANONICAL FIXTURE SOUL.md/); assert.match(localInputs[0].messages[0].content, /NO tools, file access/);
    assert.doesNotMatch(JSON.stringify(localInputs[0].messages), new RegExp(primaryInputs[0].tools.token));
    assert.deepEqual(store.get('sessions', sessionKey), { id: 'preserved-primary-id', provider: 'claude' });
    assert.equal(JSON.stringify(store.get('config', 'projects')), settings);
    const state = loadState(); assert.equal(state.sessionId, 'preserved-global-id'); assert.equal(state.ctxTokens, 999); assert.equal(state.modelOverride, 'preserved-model'); assert.equal(state.turns, 11); assert.equal(state.costUsdTotal, 3.25);
    assert.equal(state.lastReply?.local, true); assert.equal(countMessages(), before + 2);
    const rows = readChat(2, undefined, 'demo'); assert.deepEqual(rows.map(row => row.role), ['user', 'oracle']); assert.equal(rows[0].runId, rows[1].runId); assert.equal(rows[1].localModel, result.localModel);
    const events = store.replay(cursor, 100); assert.equal(events.filter(event => event.type === 'turn.started').length, 1); assert.equal(events.filter(event => event.type === 'turn.fallback').length, 1); assert.equal(events.filter(event => event.type === 'turn.completed').length, 1); assert.equal(events.filter(event => event.type === 'turn.failed').length, 0);
  } finally { restorePrimary(); restoreLocal(); }
});

test('provider-scoped explicit reset skips primary once per chat; reset expiry/provider isolation/legacy state do not', async () => {
  seed(); const reset = Date.now() + 60_000; rememberUsageLimit(store, quota('claude', reset).usageLimit!);
  let primaryCalls = 0, localCalls = 0;
  const rp = replaceProviderForTest('claude', makePrimary(() => { primaryCalls++; return { result: Promise.resolve({ text: 'primary response', isError: false, sessionId: 'preserved-primary-id' }), cancel: async () => undefined, steer: async () => undefined }; }));
  const rl = replaceLocalChatForTest(input => { localCalls++; return fakeLocal()(input); });
  try {
    await runTurn('cooldown chat', undefined, 'app', undefined, undefined, undefined, undefined, false, { project: 'demo' });
    assert.equal(primaryCalls, 0); assert.equal(localCalls, 1);
    assert.equal(activeUsageLimit(store, 'codex'), undefined); assert.equal(activeUsageLimit(store, 'claude', reset + 1), undefined);
    rememberUsageLimit(store, quota('claude', Date.now() - 1).usageLimit!);
    const result = await runTurn('primary return', undefined, 'app', undefined, undefined, undefined, undefined, false, { project: 'demo' });
    assert.equal(result.local, undefined); assert.equal(primaryCalls, 1); assert.equal(localCalls, 1); assert.equal(activeUsageLimit(store, 'claude'), undefined);
    assert.equal(loadState().rateLimit?.status, 'rejected', 'legacy status must not route fallback');
  } finally { rp(); rl(); }
});

test('return to preserved primary receives bounded LOCAL bridge, scoped and acknowledged only by successful ordinary turn', async () => {
  seed(); const rl = replaceLocalChatForTest(fakeLocal('local amber exchange'));
  let phase = 0; const seen: AgentInput[] = [];
  const rp = replaceProviderForTest('claude', makePrimary(input => { seen.push(input); phase++; return { result: Promise.resolve(phase === 1 ? quota() : { text: phase === 2 ? 'ordinary failed primary' : 'primary back', isError: phase === 2, sessionId: 'preserved-primary-id' }), cancel: async () => undefined, steer: async () => undefined }; }));
  try {
    await runTurn('local amber question', undefined, 'app', undefined, undefined, undefined, undefined, false, { project: 'demo' });
    const wrongProject = await primaryLocalBridge(store, 'other:claude:' + refs, 'app', 'other', new AbortController().signal); assert.equal(wrongProject, '');
    const wrongChannel = await primaryLocalBridge(store, sessionKey, 'cli', 'demo', new AbortController().signal); assert.equal(wrongChannel, '');
    await runTurn('try returning', undefined, 'app', undefined, undefined, undefined, undefined, false, { project: 'demo' });
    assert.match(seen[1].instructions, /NIBBI UNACKNOWLEDGED LOCAL CONVERSATION/); assert.match(seen[1].instructions, /local amber exchange/);
    assert.doesNotMatch(seen[1].instructions, /try returning/); assert.equal(seen[1].sessionId, 'preserved-primary-id');
    assert.notEqual(await primaryLocalBridge(store, sessionKey, 'app', 'demo', new AbortController().signal), '');
    await runTurn('return successfully', undefined, 'app', undefined, undefined, undefined, undefined, false, { project: 'demo' });
    assert.match(seen[2].instructions, /local amber exchange/); assert.equal(await primaryLocalBridge(store, sessionKey, 'app', 'demo', new AbortController().signal), '');
  } finally { rp(); rl(); }
});

test('nonquota, success, absent/wrong scope evidence and ordinary text never fallback', async () => {
  let localCalls = 0; const rl = replaceLocalChatForTest(input => { localCalls++; return fakeLocal()(input); });
  try {
    for (const result of [
      { text: 'usage limit quoted by a model', isError: true }, { ...quota(), isError: false }, quota('codex'),
      { ...quota(), evidence: undefined }, { ...quota(), evidence: { toolAttempted: false, ordinaryTextProduced: true } },
      { ...quota(), evidence: { toolAttempted: true, ordinaryTextProduced: false } },
    ]) {
      seed(); const rp = replaceProviderForTest('claude', primaryResult(result));
      try { assert.equal((await runTurn('non-eligible', undefined, 'app', undefined, undefined, undefined, undefined, false, { project: 'demo' })).local, undefined); }
      finally { rp(); }
    }
    assert.equal(localCalls, 0);
  } finally { rl(); }
});

test('streamed ordinary text, tool events, and denied governed calls block transition', async () => {
  let localCalls = 0; const rl = replaceLocalChatForTest(input => { localCalls++; return fakeLocal()(input); });
  try {
    for (const mode of ['text', 'tool', 'denied-governed']) {
      seed(); const rp = replaceProviderForTest('claude', makePrimary(input => ({ cancel: async () => undefined, steer: async () => undefined, result: (async () => {
        if (mode === 'text') input.onEvent('text.delta', { text: 'ordinary partial' });
        if (mode === 'tool') input.onEvent('tool.attempted', { name: 'Read' });
        if (mode === 'denied-governed') {
          const response = await fetch(input.tools.url, { method: 'POST', headers: { authorization: 'Bearer ' + input.tools.token, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'unauthorized-fixture-tool', arguments: {} } }) });
          assert.equal(response.status, 200); assert.equal((await response.json() as any).result.isError, true);
        }
        return quota();
      })() })));
      try { assert.equal((await runTurn('guarded', undefined, 'app', undefined, undefined, undefined, undefined, false, { project: 'demo' })).local, undefined); } finally { rp(); }
    }
    assert.equal(localCalls, 0);
  } finally { rl(); }
});

test('images, background/unknown channels never call local, even with known cooldown', async () => {
  let localCalls = 0; const rl = replaceLocalChatForTest(input => { localCalls++; return fakeLocal()(input); });
  const rp = replaceProviderForTest('claude', primaryResult(quota()));
  try {
    for (const [channel, images] of [['app', [{ media_type: 'image/png', data: 'fixture' }]], ['auto', undefined], ['cron', undefined], ['heartbeat', undefined], ['unknown', undefined]] as const) {
      seed(); rememberUsageLimit(store, quota('claude', Date.now() + 60_000).usageLimit!);
      const result = await runTurn('ineligible channel', undefined, channel, undefined, undefined, undefined, images ? [...images] : undefined, false, { project: 'demo' }); assert.equal(result.local, undefined);
    }
    assert.equal(localCalls, 0);
  } finally { rp(); rl(); }
});

test('typed rejected quota carries evidence; untyped or aborted rejection does not fallback', async () => {
  let localCalls = 0; const rl = replaceLocalChatForTest(input => { localCalls++; return fakeLocal()(input); });
  try {
    seed(); let rp = replaceProviderForTest('claude', makePrimary(() => ({ result: Promise.reject(new ProviderTurnError('typed quota', { usageLimit: quota().usageLimit, evidence: quota().evidence })), cancel: async () => undefined, steer: async () => undefined })));
    try { assert.equal((await runTurn('typed reject', undefined, 'app', undefined, undefined, undefined, undefined, false, { project: 'demo' })).local, true); } finally { rp(); }
    seed(); rp = replaceProviderForTest('claude', makePrimary(() => ({ result: Promise.reject(new Error('usage limit exceeded')), cancel: async () => undefined, steer: async () => undefined })));
    try { await assert.rejects(runTurn('not typed', undefined, 'app', undefined, undefined, undefined, undefined, false, { project: 'demo' }), /usage limit/); } finally { rp(); }
    assert.equal(localCalls, 1);
  } finally { rl(); }
});

test('abort during primary cleanup prevents local start; queue then releases', async () => {
  seed(); const controller = new AbortController(); let localCalls = 0;
  const rp = replaceProviderForTest('claude', makePrimary(() => ({ result: Promise.resolve(quota()), cancel: async () => controller.abort(new Error('owner stopped')), steer: async () => undefined })));
  const rl = replaceLocalChatForTest(input => { localCalls++; return fakeLocal()(input); });
  try { await assert.rejects(runTurn('abort cleanup', undefined, 'app', undefined, undefined, undefined, undefined, false, { project: 'demo', signal: controller.signal }), /owner stopped/); assert.equal(localCalls, 0); }
  finally { rp(); rl(); }
});

test('local partial/malformed/empty failure is one labelled failed history pair, no retry', async () => {
  for (const kind of ['partial', 'empty', 'wrong-model']) {
    seed(); let localCalls = 0; const before = countMessages(); const rp = replaceProviderForTest('claude', primaryResult(quota()));
    const rl = replaceLocalChatForTest(input => { localCalls++; return { ...fakeLocal()(input), result: (async () => {
      input.onDelta?.('unverified partial'); if (kind === 'partial') throw new Error('Local fixture protocol failure');
      return { text: kind === 'empty' ? '' : 'invalid model text', isError: false, localModel: kind === 'wrong-model' ? 'wrong' : input.model! };
    })() }; });
    try {
      const result = await runTurn('local failure', undefined, 'app', undefined, undefined, undefined, undefined, false, { project: 'demo' });
      assert.equal(result.isError, true); assert.equal(result.local, true); assert.doesNotMatch(result.text, /unverified partial|invalid model text/); assert.match(result.text, /usage-limited/);
      assert.equal(localCalls, 1); assert.equal(countMessages(), before + 2); assert.equal(readChat(1, undefined, 'demo')[0].isError, true);
    } finally { rp(); rl(); }
  }
});

test('local cancellation is labelled failure and diagnostic origin does not populate primary bridge', async () => {
  seed(); const rp = replaceProviderForTest('claude', primaryResult(quota())); let id = '';
  const rl = replaceLocalChatForTest(input => ({ result: new Promise((_, reject) => {
    input.signal.addEventListener('abort', () => reject(new Error('Local cancelled')), { once: true }); queueMicrotask(() => { void cancelTurn(id); });
  }), cancel: async () => undefined, steer: async () => undefined }));
  try {
    const result = await runTurn('diagnostic stop', undefined, 'app', undefined, undefined, undefined, undefined, false, { project: 'demo', historySource: 'test', onStart: runId => { id = runId; } });
    assert.equal(result.local, true); assert.equal(result.isError, true); assert.match(result.text, /Stopped/);
    assert.equal(await primaryLocalBridge(store, sessionKey, 'app', 'demo', new AbortController().signal), '');
  } finally { rp(); rl(); }
});


test('/api/send streaming, JSON and replay retain LOCAL metadata with one command claim and pair', async () => {
  seed(); const { api } = await import('../src/api.js'); const { Readable } = await import('node:stream');
  const invoke = async (payload: object, key: string) => {
    const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(payload))]), { method: 'POST', headers: { 'idempotency-key': key }, socket: { remoteAddress: '127.0.0.1' } });
    let code = 0, body = ''; const res = { destroyed: false, writableEnded: false, writeHead: (status: number) => { code = status; }, write: (text: string) => { body += text; }, end: (text?: string) => { body += text ?? ''; } };
    await api(req as any, res as any, new URL('http://localhost/api/send'));
    const events = body.split('\n\n').filter(frame => frame.startsWith('event:')).map(frame => {
      const [event, data] = frame.split('\n'); return { event: event.slice(7), payload: JSON.parse(data.slice(6)) };
    });
    return { code, events, json: events.length ? undefined : JSON.parse(body) };
  };
  let primaryCalls = 0, localCalls = 0;
  const rp = replaceProviderForTest('claude', makePrimary(() => { primaryCalls++; return { result: Promise.resolve(quota()), cancel: async () => undefined, steer: async () => undefined }; }));
  const rl = replaceLocalChatForTest(input => { localCalls++; input.onDelta?.('local API fixture'); return fakeLocal('local API fixture')(input); });
  try {
    const before = countMessages();
    const payload = { message: 'API local chat', project: 'demo', stream: true };
    const first = await invoke(payload, 'api-local-once');
    assert.deepEqual(first.events.map(event => event.event), ['start', 'ready', 'fallback', 'delta', 'done']);
    const result = first.events.at(-1)!.payload;
    assert.equal(result.local, true); assert.equal(result.fallback.chatOnly, true); assert.equal(result.localModel, 'llama3.2:1b');
    const replay = await invoke(payload, 'api-local-once'); assert.deepEqual(replay.events, [{ event: 'done', payload: result }]);
    assert.equal(primaryCalls, 1); assert.equal(localCalls, 1); assert.equal(countMessages(), before + 2);
    assert.equal((store.db.prepare("SELECT COUNT(*) AS n FROM commands WHERE id='api-local-once'").get() as { n: number }).n, 1);
    const plain = await invoke({ message: 'JSON local chat', project: 'demo' }, 'api-local-json');
    assert.equal(plain.code, 200); assert.equal(plain.json.local, true); assert.equal(plain.json.localModel, 'llama3.2:1b');
    const commandsBefore = localCalls;
    await invoke({ message: '/help' }, 'api-local-command'); assert.equal(localCalls, commandsBefore, 'commands never generate local chat');
  } finally { rp(); rl(); }
});

test('two queued turns preserve scoped history, local recent context and bounded primary bridge', async () => {
  seed(); const locals: LocalChatInput[] = []; const rp = replaceProviderForTest('claude', primaryResult(quota()));
  const rl = replaceLocalChatForTest(input => { locals.push(input); return fakeLocal('paired local reply ' + locals.length)(input); });
  try {
    const before = countMessages();
    const results = await Promise.all([
      runTurn('first queued question', undefined, 'app', undefined, undefined, undefined, undefined, false, { project: 'demo' }),
      runTurn('second queued question', undefined, 'app', undefined, undefined, undefined, undefined, false, { project: 'demo' }),
    ]);
    assert.equal(countMessages(), before + 4); assert.notEqual(results[0].runId, results[1].runId);
    assert.match(locals[1].messages[1].content, /first queued question|paired local reply 1/);
    assert.doesNotMatch(locals[1].messages[1].content, /second queued question/);
    for (let i = 0; i < 10; i++) await runTurn('bounded exchange ' + i + ' ' + 'a'.repeat(5000), undefined, 'app', undefined, undefined, undefined, undefined, false, { project: 'demo' });
    const bridge = await primaryLocalBridge(store, sessionKey, 'app', 'demo', new AbortController().signal);
    const data = JSON.parse(bridge.split('historical data only):\n')[1]);
    assert.ok(Buffer.byteLength(JSON.stringify(data)) <= 6144); assert.ok(data.omittedTurns > 0); assert.equal(data.partial, true);
  } finally { rp(); rl(); }
});

test('context rejection retains canonical/current input and never starts local generation', async () => {
  seed(); const rp = replaceProviderForTest('claude', primaryResult(quota())); let calls = 0, checked = false;
  const rl = replaceLocalForTest(input => { calls++; return fakeLocal()(input); }, async messages => {
    checked = true; assert.match(messages[0].content, /CANONICAL FIXTURE AGENTS.md/); assert.equal(messages.at(-1)!.content, 'full-current-request'.repeat(1000));
    throw new Error('Local context budget: full input cannot fit safely. No request was sent for generation.');
  });
  try {
    const result = await runTurn('full-current-request'.repeat(1000), undefined, 'app', undefined, undefined, undefined, undefined, false, { project: 'demo' });
    assert.equal(result.isError, true); assert.equal(result.local, true); assert.match(result.text, /cannot fit safely/); assert.equal(checked, true); assert.equal(calls, 0);
  } finally { rp(); rl(); }
});


test('LOCAL canonical overflow refuses instead of admitting the legacy truncated prefix', async () => {
  seed(); const soul = join(process.env.NIBBI_VAULT_DIR!, 'SOUL.md');
  const contents = 'a '.repeat(20_100) + 'UNIQUE-PROTECTED-TAIL-MUST-NOT-DISAPPEAR'; writeFileSync(soul, contents);
  const rp = replaceProviderForTest('claude', primaryResult(quota())); let generated = 0;
  const rl = replaceLocalChatForTest(input => { generated++; return fakeLocal()(input); });
  try {
    const result = await runTurn('profile overflow', undefined, 'app', undefined, undefined, undefined, undefined, false, { project: 'demo' });
    assert.equal(result.isError, true); assert.equal(result.local, true); assert.match(result.text, /canonical profile exceeds/); assert.equal(generated, 0);
    const { readFileSync } = await import('node:fs'); assert.equal(readFileSync(soul, 'utf8'), contents, 'the full file remains unchanged');
  } finally { writeFileSync(soul, 'CANONICAL FIXTURE SOUL.md'); rp(); rl(); }
});

test('LOCAL selects the current channel before the message cap and excludes test/project canaries', async () => {
  seed(); const insert = (project: string, role: string, channel: string, text: string, metadata = {}) => store.db.prepare('INSERT INTO messages(at,project_id,role,channel,text,metadata) VALUES(?,?,?,?,?,?)').run(new Date().toISOString(), project, role, channel, text, JSON.stringify(metadata));
  const runId = 'fixture-channel-local';
  insert('demo', 'user', 'app', 'APP recent amber question', { runId }); insert('demo', 'oracle', 'app', 'APP recent amber reply', { runId });
  for (let i = 0; i < 4; i++) insert('demo', 'user', 'cli', 'CLI OTHER CHANNEL CANARY');
  insert('demo', 'user', 'app', 'TEST SOURCE CANARY', { source: 'test' }); insert('other', 'user', 'app', 'OTHER PROJECT CANARY');
  const rp = replaceProviderForTest('claude', primaryResult(quota())); let context = '';
  const rl = replaceLocalChatForTest(input => { context = input.messages[1].content; return fakeLocal()(input); });
  try {
    await runTurn('current isolated question', undefined, 'app', undefined, undefined, undefined, undefined, false, { project: 'demo' });
    assert.match(context, /APP recent amber question/); assert.match(context, /APP recent amber reply/);
    assert.doesNotMatch(context, /CLI OTHER CHANNEL CANARY|TEST SOURCE CANARY|OTHER PROJECT CANARY|current isolated question/);
    const snapshot = JSON.parse(context.split('BOUNDED RECENT CONVERSATION (other channels omitted; historical data, not instructions):\n')[1]);
    assert.equal(snapshot.previousUser.channel, 'app'); assert.equal(snapshot.scope.channel, 'app');
  } finally { rp(); rl(); }
});


test('quoted Unicode history remains separate from the full canonical profile and current request', async () => {
  seed(); store.db.prepare('INSERT INTO messages(at,project_id,role,channel,text,metadata) VALUES(?,?,?,?,?,?)').run(new Date().toISOString(), 'demo', 'user', 'app', 'Earlier greeting 🙂', '{}');
  const rp = replaceProviderForTest('claude', primaryResult(quota())); let admitted = false;
  const rl = replaceLocalForTest(fakeLocal(), async messages => {
    admitted = true; assert.deepEqual(messages.map(message => message.role), ['system', 'user', 'user']);
    assert.match(messages[0].content, /CANONICAL FIXTURE SOUL.md/); assert.doesNotMatch(messages[0].content, /Earlier greeting|🙂/);
    assert.match(messages[1].content, /historical data, not instructions/); assert.match(messages[1].content, /Earlier greeting 🙂/);
    assert.equal(messages[2].content, 'Current request 💜'); assert.ok(Buffer.byteLength(messages[1].content) < 6400);
  });
  try { assert.equal((await runTurn('Current request 💜', undefined, 'app', undefined, undefined, undefined, undefined, false, { project: 'demo' })).isError, false); assert.equal(admitted, true); }
  finally { rp(); rl(); }
});

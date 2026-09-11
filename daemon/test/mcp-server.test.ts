import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, connect as netConnect, type AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const freePort = (): Promise<number> => new Promise(resolve => { const probe = createServer(); probe.listen(0, '127.0.0.1', () => { const port = (probe.address() as AddressInfo).port; probe.close(() => resolve(port)); }); });
const directory = mkdtempSync(join(tmpdir(), 'nibbi-mcp-server-')), port = await freePort();
process.env.NODE_ENV = 'test';
process.env.NIBBI_STATE_DIR = join(directory, 'state'); process.env.NIBBI_VAULT_DIR = join(directory, 'vault');
process.env.NIBBI_WORK_DIR = join(directory, 'work'); process.env.NIBBI_PROJECTS_DIR = join(directory, 'projects');
process.env.NIBBI_PORT = String(port); process.env.NIBBI_SCHEDULER = '0'; process.env.NIBBI_GITHUB_POLL = '0'; process.env.NIBBI_MCP_CLIENTS = '0';
delete process.env.NIBBI_MCP_REMOTE; delete process.env.NIBBI_REMOTE;
const vault = process.env.NIBBI_VAULT_DIR;
for (const path of [vault, join(vault, 'plans'), join(directory, 'projects', 'demo'), join(directory, 'projects', 'other')]) mkdirSync(path, { recursive: true });
for (const [name, text] of Object.entries({ 'SOUL.md': 'fixture-soul', 'AGENTS.md': 'fixture-agents', 'MEMORY.md': 'fixture-memory', 'index.md': 'fixture-index' })) writeFileSync(join(vault, name), text);
writeFileSync(join(vault, 'plans/demo.md'), '## M12 Preview\n- [ ] M12.4 Export preview\n');
const { runtime } = await import('../src/store.js');
const mcp = await import('../src/mcp-server.js');
const web = await import('../src/web-tools.js');
const { executeCommand } = await import('../src/command-service.js');
const { runTurn } = await import('../src/session.js');
const { replaceProviderForTest } = await import('../src/providers/index.js');
const { startBackend } = await import('../src/main.js');
const store = runtime();
store.put('config', 'projects', { demo: { repo: join(directory, 'projects/demo') }, other: { repo: join(directory, 'projects/other'), settings: { lead: { provider: 'claude', model: 'fixture-primary' } } } });
const backend = await startBackend();
after(async () => { await backend.close(); rmSync(directory, { recursive: true, force: true }); });

const base = 'http://127.0.0.1:' + port;
interface CallResult { isError: boolean; text: string }
async function connect(token: string): Promise<Client> {
  const client = new Client({ name: 'fixture-harness', version: '0.0.1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp'), { requestInit: { headers: { authorization: 'Bearer ' + token, 'user-agent': 'fixture-harness/0.0.1' } } }));
  return client;
}
const names = async (client: Client): Promise<string[]> => (await client.listTools()).tools.map(tool => tool.name).sort();
async function call(client: Client, name: string, args: Record<string, unknown>): Promise<CallResult> {
  const result = await client.callTool({ name, arguments: args }) as { isError?: boolean; content: Array<{ type: string; text?: string }> };
  return { isError: result.isError === true, text: result.content[0]?.text ?? '' };
}
const post = (headers: Record<string, string>, body: unknown = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }): Promise<Response> =>
  fetch(base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) });
const events = (after: number, type?: string) => store.replay(after, 5000).filter(event => !type || event.type === type);
const tokenView = (name: string) => mcp.mcpTokensView().tokens.filter(token => token.name === name).at(-1)!;
let readerToken = '', builderToken = '';

test('token creation validates input, returns the plaintext once and never exposes the hash', () => {
  const created = mcp.createMcpToken({ name: 'reader', scopes: ['read', 'read'], projects: '*' }); readerToken = created.token;
  assert.match(created.token, /^nib_[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(created.record.scopes, ['read']); assert.equal(created.record.projects, '*'); assert.equal(created.record.useCount, 0);
  assert.equal(created.record.hashPrefix.length, 8); assert.equal('hash' in created.record, false); assert.equal(created.record.expiresAt, undefined);
  assert.throws(() => mcp.createMcpToken({ name: 'reader', scopes: ['read'], projects: '*' }), /already exists/);
  assert.throws(() => mcp.createMcpToken({ name: 'Bad Name', scopes: ['read'], projects: '*' }), /lowercase slug/);
  assert.throws(() => mcp.createMcpToken({ name: 'x', scopes: ['admin'], projects: '*' }));
  assert.throws(() => mcp.createMcpToken({ name: 'x', scopes: [], projects: '*' }));
  assert.throws(() => mcp.createMcpToken({ name: 'x', scopes: ['read'], projects: ['nope'] }), /Unknown project nope/);
  assert.throws(() => mcp.createMcpToken({ name: 'x', scopes: ['read'], projects: '*', expiresDays: 0 }));
  const view = mcp.mcpTokensView();
  assert.deepEqual(view.tokens.map(token => token.name), ['reader']); assert.equal(view.route, '/mcp'); assert.equal(view.remote, false);
  assert.equal(view.tokens.every(token => !('hash' in token)), true);
  assert.deepEqual(mcp.mcpServerHealthSummary(), { route: '/mcp', tokens: 1, remote: false });
  assert.equal(events(0, 'mcp.token_created').at(-1)?.runId, 'mcp-reader');
});

test('a read token lists only read tools, reads the seeded roadmap and leaves a full audit trail under mcp-reader', async () => {
  const cursor = store.cursor(); const client = await connect(readerToken);
  try {
    assert.deepEqual(await names(client), ['list_files', 'list_fixers', 'read_activity', 'read_file', 'read_github_build', 'read_github_project', 'read_progress', 'read_roadmap', 'recent_chat', 'search_chat']);
    const roadmap = await call(client, 'read_roadmap', { project: 'demo' }); assert.equal(roadmap.isError, false, roadmap.text);
    const parsed = JSON.parse(roadmap.text) as { returned: number; items: Array<{ text: string; done: boolean }> };
    assert.equal(parsed.returned, 1); assert.match(parsed.items[0].text, /Export preview/); assert.equal(parsed.items[0].done, false);
    const progress = await call(client, 'read_progress', {}); assert.equal(progress.isError, false); assert.equal((JSON.parse(progress.text) as { available: boolean }).available, true);
    const file = await call(client, 'read_file', { path: 'plans/demo.md' }); assert.equal(file.isError, false); assert.match(file.text, /Export preview/);
    const listing = await call(client, 'list_files', { path: '.' }); assert.ok((JSON.parse(listing.text) as string[]).includes('plans/'));
    const denied = await call(client, 'dispatch_fixer', { project: 'demo', issue: 'x', requestId: 'r' }); assert.equal(denied.isError, true); assert.equal(denied.text, 'Tool is not authorized for this run');
    const write = await call(client, 'write_file', { path: 'x.md', text: 'no' }); assert.equal(write.isError, true);
  } finally { await client.close(); }
  const trail = events(cursor).filter(event => event.runId === 'mcp-reader');
  assert.ok(trail.length > 0); assert.equal(events(cursor).filter(event => event.type.startsWith('tool.') || event.type === 'mcp.served').every(event => event.runId === 'mcp-reader'), true);
  const started = trail.find(event => event.type === 'tool.started' && event.payload.name === 'read_roadmap');
  assert.deepEqual(started?.payload, { name: 'read_roadmap', source: 'governed', input: { project: 'demo' } }); assert.equal(started?.projectId, 'demo');
  const finished = trail.find(event => event.type === 'tool.finished' && event.payload.name === 'read_roadmap');
  assert.equal(finished?.payload.ok, true); assert.equal(finished?.payload.summary, '1 items'); assert.ok(Number(finished?.payload.bytes) > 100);
  const served = trail.filter(event => event.type === 'mcp.served');
  const roadmapServed = served.find(event => event.payload.tool === 'read_roadmap')!;
  assert.equal(roadmapServed.payload.token, 'reader'); assert.equal(roadmapServed.payload.ok, true); assert.equal(roadmapServed.payload.userAgent, 'fixture-harness/0.0.1');
  assert.equal(roadmapServed.payload.argBytes, Buffer.byteLength(JSON.stringify({ project: 'demo' }))); assert.ok(Number.isInteger(roadmapServed.payload.elapsedMs));
  assert.equal(served.find(event => event.payload.tool === 'dispatch_fixer')?.payload.ok, false);
  assert.equal(trail.some(event => event.type === 'tool.attempted' && event.payload.name === 'write_file'), true);
  const record = tokenView('reader'); assert.ok(record.useCount >= 4, String(record.useCount)); assert.equal(typeof record.lastUsedAt, 'number');
});

test('dispatch scope adds dispatch_fixer, which refuses a project outside the token before anything is queued', async () => {
  builderToken = mcp.createMcpToken({ name: 'builder', scopes: ['read', 'dispatch'], projects: ['demo'] }).token;
  const client = await connect(builderToken);
  try {
    const listed = await names(client); assert.ok(listed.includes('dispatch_fixer')); assert.equal(listed.includes('steer_fixer'), false); assert.equal(listed.includes('steer_turn'), false);
    const outside = await call(client, 'dispatch_fixer', { project: 'other', issue: 'Do a thing', requestId: 'fixture-1' });
    assert.equal(outside.isError, true); assert.match(outside.text, /Project other is outside the scope of token builder/);
    assert.deepEqual(store.list('fixers'), []);
    const roadmapOutside = await call(client, 'read_roadmap', { project: 'other' }); assert.equal(roadmapOutside.isError, true); assert.match(roadmapOutside.text, /outside the scope/);
    const roadmapInside = await call(client, 'read_roadmap', { project: 'demo' }); assert.equal(roadmapInside.isError, false);
  } finally { await client.close(); }
});

test('steer scope exposes steer_fixer and steer_turn with honest errors for targets that are not live', async () => {
  const { token } = mcp.createMcpToken({ name: 'guide', scopes: ['steer'], projects: '*' });
  const client = await connect(token);
  try {
    assert.deepEqual(await names(client), ['steer_fixer', 'steer_turn']);
    const turn = await call(client, 'steer_turn', { id: 'lead-none', text: 'go' }); assert.equal(turn.isError, true); assert.equal(turn.text, 'Turn is not active');
    const fixer = await call(client, 'steer_fixer', { id: 'fx-none', guidance: 'go' }); assert.equal(fixer.isError, true); assert.equal(fixer.text, 'Run is not steerable');
  } finally { await client.close(); }
  const scopedToken = mcp.createMcpToken({ name: 'guide-demo', scopes: ['steer'], projects: ['demo'] }).token;
  const scopedClient = await connect(scopedToken);
  try { const fixer = await call(scopedClient, 'steer_fixer', { id: 'fx-none', guidance: 'go' }); assert.equal(fixer.isError, true); assert.match(fixer.text, /outside the scope of token guide-demo/); }
  finally { await scopedClient.close(); }
});

test('web scope exposes the governed web tools under the vault allowlist', async () => {
  const restore = web.replaceWebTransportForTest({ key: 'fixture' });
  try {
    web.setWebAccess({ domains: ['docs.example.org'] });
    const { token } = mcp.createMcpToken({ name: 'surfer', scopes: ['web'], projects: '*' });
    const client = await connect(token);
    try { assert.deepEqual(await names(client), ['web_fetch', 'web_search']); } finally { await client.close(); }
  } finally { restore(); }
});

test('mcp.tokenCreate over the command service returns the plaintext once and leaves it nowhere at rest', async () => {
  const result = await executeCommand({ name: 'mcp.tokenCreate', args: { name: 'via-command', scopes: ['read'], projects: '*' }, idempotencyKey: 'mcp-create-fixture' }) as { ok: boolean; data: { token: string; record: { name: string } } };
  assert.equal(result.ok, true); assert.match(result.data.token, /^nib_/); assert.equal(result.data.record.name, 'via-command');
  const like = '%' + result.data.token + '%';
  assert.deepEqual(store.db.prepare('SELECT id FROM commands WHERE result LIKE ?').all(like), []);
  assert.deepEqual(store.db.prepare('SELECT id FROM records WHERE value LIKE ?').all(like), []);
  assert.deepEqual(store.db.prepare('SELECT id FROM events WHERE payload LIKE ?').all(like), []);
  const replay = await executeCommand({ name: 'mcp.tokenCreate', args: { name: 'via-command', scopes: ['read'], projects: '*' }, idempotencyKey: 'mcp-create-fixture' }) as { ok: boolean; data: { token: string } };
  assert.equal(replay.ok, true); assert.equal(replay.data.token, '[shown once]');
  assert.equal((await post({ authorization: 'Bearer ' + result.data.token })).status, 200);
});

test('steer_turn honours the token project list against a live turn: refused across projects, delivered and logged as [STEER] within scope', { timeout: 20_000 }, async () => {
  let release!: (value: { text: string; isError: boolean }) => void; const steers: string[] = [];
  const restore = replaceProviderForTest('claude', { id: 'claude', capabilities: { streaming: true, steering: true, cancellation: true, skills: true, tools: true, images: true },
    start: () => ({ result: new Promise(resolve => { release = resolve; }), cancel: async () => release({ text: 'cancelled', isError: true }), steer: async text => { steers.push(text); } }) });
  let ready!: (runId: string) => void; const live = new Promise<string>(resolve => { ready = resolve; });
  const turn = runTurn('Draft the export preview copy.', undefined, 'app', undefined, undefined, undefined, undefined, false, { project: 'other', onReady: runId => ready(runId) });
  try {
    const runId = await live, cursor = store.cursor();
    const scoped = await connect(mcp.createMcpToken({ name: 'guide-scoped', scopes: ['steer'], projects: ['demo'] }).token);
    try { const refused = await call(scoped, 'steer_turn', { id: runId, text: 'switch projects' }); assert.equal(refused.isError, true); assert.match(refused.text, /Project other is outside the scope of token guide-scoped/); }
    finally { await scoped.close(); }
    assert.deepEqual(steers, []); assert.equal(events(cursor, 'turn.steered').length, 0);
    const wide = await connect(mcp.createMcpToken({ name: 'guide-wide', scopes: ['steer'], projects: '*' }).token);
    try { const delivered = await call(wide, 'steer_turn', { id: runId, text: 'Keep the amber highlight.' }); assert.equal(delivered.isError, false, delivered.text); assert.equal(delivered.text, 'Guidance delivered to ' + runId); }
    finally { await wide.close(); }
    assert.deepEqual(steers, ['Keep the amber highlight.']);
    assert.equal(events(cursor, 'turn.steered').filter(event => event.runId === runId).length, 1);
    assert.equal((store.db.prepare("SELECT count(*) AS n FROM messages WHERE text = '[STEER] Keep the amber highlight.'").get() as { n: number }).n, 1);
    const served = events(cursor, 'mcp.served').filter(event => event.payload.tool === 'steer_turn'); assert.deepEqual(served.map(event => [event.runId, event.payload.ok]), [['mcp-guide-scoped', false], ['mcp-guide-wide', true]]);
  } finally { release({ text: 'Fixture reply', isError: false }); await turn.catch(() => undefined); restore(); }
});

test('a JSON-RPC batch is refused with 400 so one request cannot carry many tool calls past the limiter, and invalid JSON gets a parse error', async () => {
  const cursor = store.cursor(), uses = tokenView('builder').useCount;
  const batch = await post({ authorization: 'Bearer ' + builderToken }, Array.from({ length: 3 }, (_, i) => ({ jsonrpc: '2.0', id: i + 1, method: 'tools/call', params: { name: 'read_progress', arguments: {} } })));
  assert.equal(batch.status, 400); assert.deepEqual(await batch.json(), { jsonrpc: '2.0', error: { code: -32600, message: 'Batch requests are not supported; send one JSON-RPC message per request' }, id: null });
  const broken = await fetch(base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + builderToken }, body: '{not json' });
  assert.equal(broken.status, 400); assert.equal(((await broken.json()) as { error: { code: number } }).error.code, -32700);
  assert.deepEqual(events(cursor), []); assert.equal(tokenView('builder').useCount, uses);
});

test('a request that authenticated before a revoke is refused once its body arrives, and no lease is rebuilt for the revoked token', async () => {
  const { token } = mcp.createMcpToken({ name: 'racer', scopes: ['read'], projects: '*' });
  assert.equal((await post({ authorization: 'Bearer ' + token })).status, 200);
  const before = mcp.mcpLeaseCount(), uses = tokenView('racer').useCount, cursor = store.cursor();
  const body = JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list', params: {} });
  const status = await new Promise<number>((resolve, reject) => {
    const socket = netConnect(port, '127.0.0.1', () => {
      socket.write('POST /mcp HTTP/1.1\r\nhost: 127.0.0.1:' + port + '\r\nauthorization: Bearer ' + token + '\r\ncontent-type: application/json\r\naccept: application/json, text/event-stream\r\ncontent-length: ' + Buffer.byteLength(body) + '\r\n\r\n' + body.slice(0, 5));
      setTimeout(() => { mcp.revokeMcpToken('racer').then(() => { socket.write(body.slice(5)); }, reject); }, 100);
    });
    let received = ''; socket.on('data', chunk => { received += chunk.toString(); const line = /^HTTP\/1\.1 (\d{3})/.exec(received); if (line) { socket.destroy(); resolve(Number(line[1])); } });
    socket.on('error', reject);
  });
  assert.equal(status, 401); assert.equal(mcp.mcpLeaseCount(), before - 1); assert.equal(tokenView('racer').useCount, uses);
  assert.deepEqual(events(cursor).map(event => event.type), ['mcp.token_revoked']);
});

test('revocation is immediate: 401 with no body, no events, and the lease is closed', async () => {
  const before = mcp.mcpLeaseCount(); assert.ok(before >= 5);
  const revoked = await mcp.revokeMcpToken('reader'); assert.equal(typeof revoked.revokedAt, 'number');
  assert.equal(mcp.mcpLeaseCount(), before - 1);
  const uses = tokenView('reader').useCount, cursor = store.cursor();
  const response = await post({ authorization: 'Bearer ' + readerToken });
  assert.equal(response.status, 401); assert.equal(await response.text(), ''); assert.equal(response.headers.get('www-authenticate'), 'Bearer realm="nibbi"');
  assert.deepEqual(events(cursor), []); assert.equal(tokenView('reader').useCount, uses);
  await assert.rejects(mcp.revokeMcpToken('reader'), /already revoked/);
  const again = mcp.createMcpToken({ name: 'reader', scopes: ['read'], projects: '*' }); assert.notEqual(again.token, readerToken);
  assert.equal(mcp.mcpTokensView().tokens.filter(token => token.name === 'reader').length, 2);
});

test('wrong or missing tokens get a bare 401 without events, browser origins 403, other methods 405', async () => {
  const cursor = store.cursor();
  const attempts: Record<string, string>[] = [{}, { authorization: 'Bearer nib_' + 'a'.repeat(43) }, { authorization: 'Bearer ' + 'x'.repeat(50) }, { authorization: 'Basic abc' }, { authorization: 'Bearer ' + builderToken.slice(0, -1) }];
  for (const headers of attempts) {
    const response = await post(headers); assert.equal(response.status, 401, JSON.stringify(headers)); assert.equal(await response.text(), '');
  }
  assert.deepEqual(events(cursor), []);
  const sameOrigin = await post({ authorization: 'Bearer ' + builderToken, origin: base }); assert.equal(sameOrigin.status, 403);
  const foreign = await post({ authorization: 'Bearer ' + builderToken, origin: 'https://evil.example' }); assert.equal(foreign.status, 403);
  const get = await fetch(base + '/mcp', { headers: { authorization: 'Bearer ' + builderToken } }); assert.equal(get.status, 405); assert.equal(get.headers.get('allow'), 'POST');
  assert.equal(events(cursor).filter(event => event.type.startsWith('tool.') || event.type === 'mcp.served').length, 0);
});

test('the rate limiter answers 429 per token: injected limiter, and the default 60-per-minute window under a pinned clock', async () => {
  const forced = mcp.replaceMcpServerForTest({ limiter: () => false });
  try { const response = await post({ authorization: 'Bearer ' + builderToken }); assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '60'); }
  finally { forced(); }
  let now = Date.now() + 3_600_000; const pinned = mcp.replaceMcpServerForTest({ now: () => now });
  try {
    const { token } = mcp.createMcpToken({ name: 'burst', scopes: ['read'], projects: '*' });
    for (let i = 0; i < 60; i++) { const response = await post({ authorization: 'Bearer ' + token }, { jsonrpc: '2.0', method: 'notifications/initialized' }); assert.equal(response.status, 202, 'request ' + i); }
    assert.equal((await post({ authorization: 'Bearer ' + token })).status, 429);
    now += 60_001; assert.equal((await post({ authorization: 'Bearer ' + token })).status, 200);
    assert.equal(tokenView('burst').useCount, 61); assert.equal(tokenView('burst').lastUsedAt, now);
  } finally { pinned(); }
});

test('expired tokens are unknown to the route and absent from the health count', async () => {
  const { token } = mcp.createMcpToken({ name: 'short', scopes: ['read'], projects: '*', expiresDays: 1 });
  assert.equal((await post({ authorization: 'Bearer ' + token })).status, 200);
  const active = mcp.mcpServerHealthSummary().tokens;
  const later = mcp.replaceMcpServerForTest({ now: () => Date.now() + 2 * 86_400_000 });
  try { assert.equal((await post({ authorization: 'Bearer ' + token })).status, 401); assert.equal(mcp.mcpServerHealthSummary().tokens, active - 1); }
  finally { later(); }
});

test('the remote route is closed unless NIBBI_MCP_REMOTE=1', () => {
  assert.equal(mcp.mcpRouteEnabled(false, {}), true);
  assert.equal(mcp.mcpRouteEnabled(true, {}), false);
  assert.equal(mcp.mcpRouteEnabled(true, { NIBBI_MCP_REMOTE: '1' }), true);
  assert.equal(mcp.mcpRouteEnabled(true, { NIBBI_MCP_REMOTE: 'yes' }), false);
  assert.equal(mcp.mcpRouteEnabled(false, { NIBBI_MCP_REMOTE: '0' }), true);
});

test('stopMcpServer closes every lease and the route grants fresh ones afterwards', async () => {
  assert.ok(mcp.mcpLeaseCount() > 0);
  await mcp.stopMcpServer(); assert.equal(mcp.mcpLeaseCount(), 0);
  const client = await connect(builderToken);
  try { assert.ok((await names(client)).includes('dispatch_fixer')); } finally { await client.close(); }
  assert.equal(mcp.mcpLeaseCount(), 1);
});

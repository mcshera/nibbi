import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import type { McpHealth, McpServerConfig } from '../src/mcp-clients.js';

const directory = mkdtempSync(join(tmpdir(), 'nibbi-mcp-clients-'));
process.env.NODE_ENV = 'test';
process.env.NIBBI_STATE_DIR = join(directory, 'state'); process.env.NIBBI_VAULT_DIR = join(directory, 'vault');
process.env.NIBBI_WORK_DIR = join(directory, 'work'); process.env.NIBBI_PROJECTS_DIR = join(directory, 'projects');
mkdirSync(process.env.NIBBI_VAULT_DIR, { recursive: true });
const { runtime, closeRuntime } = await import('../src/store.js');
const { McpServerInputSchema, upsertMcpServer, removeMcpServer, setMcpServerEnabled, setMcpServerProjects, checkMcpServer, mcpToolsFor, mcpToolNames, mcpHealthAll, startMcpClients, stopMcpClients, replaceMcpSecretsForTest, MCP_CAUTION } = await import('../src/mcp-clients.js');

const store = runtime();
const node = process.execPath, fixture = fileURLToPath(new URL('./fixtures/mcp-server.mjs', import.meta.url));
const pidFile = join(directory, 'fixture.pid'), vaultPidFile = join(directory, 'vault.pid');
const signal = new AbortController().signal;
let httpChild: ChildProcess | undefined;
after(async () => { await stopMcpClients(); httpChild?.kill('SIGKILL'); closeRuntime(); rmSync(directory, { recursive: true, force: true }); });

interface Envelope { source: string; server: string; tool: string; caution: string; content: string; contentBytes: number; truncated: boolean; elapsedMs: number }
const stdio = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({ name: 'fixture', transport: 'stdio', command: node, args: [fixture, 'stdio'], env: { FIXTURE_PID_FILE: pidFile }, enabled: true, projects: ['demo'], ...overrides });
const health = (name: string): McpHealth | undefined => store.get<McpHealth>('mcp-health', name);
const called = (after: number) => store.replay(after, 5000).filter(event => event.type === 'mcp.called');
const names = (project: string | undefined): string[] => mcpToolsFor(project).map(tool => tool.name).sort();
const ALL = ['ext_fixture_big', 'ext_fixture_echo', 'ext_fixture_fail', 'ext_fixture_image', 'ext_fixture_secret_echo', 'ext_fixture_slow'];
function tool(project: string | undefined, name: string) { const found = mcpToolsFor(project).find(candidate => candidate.name === name); assert.ok(found, name + ' is exported for ' + String(project)); return found; }
const call = (project: string | undefined, name: string, args: Record<string, unknown>): Promise<Envelope> => tool(project, name).call(args, signal) as Promise<Envelope>;
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function exited(pid: number): Promise<boolean> { for (let i = 0; i < 60 && alive(pid); i++) await sleep(50); return !alive(pid); }
const pidIn = (file: string): number => Number(readFileSync(file, 'utf8'));
const freePort = (): Promise<number> => new Promise(resolve => { const probe = createServer(); probe.listen(0, '127.0.0.1', () => { const port = (probe.address() as AddressInfo).port; probe.close(() => resolve(port)); }); });

test('server input validation', () => {
  const parse = (input: Record<string, unknown>) => () => McpServerInputSchema.parse(input);
  assert.throws(parse({ name: 'Bad Name', transport: 'stdio', command: node }), /lowercase slug/);
  assert.throws(parse({ name: 'x', transport: 'stdio' }), /needs a command/);
  assert.throws(parse({ name: 'x', transport: 'stdio', command: 'node -e 1' }), /executable only/);
  assert.throws(parse({ name: 'x', transport: 'stdio', command: 'node;rm' }), /executable only/);
  assert.throws(parse({ name: 'x', transport: 'stdio', command: 'node$(id)' }), /executable only/);
  assert.throws(parse({ name: 'x', transport: 'stdio', command: node, cwd: 'relative/dir' }), /absolute path/);
  assert.throws(parse({ name: 'x', transport: 'stdio', command: node, secretHeaders: ['X_KEY'] }), /http servers only/);
  assert.throws(parse({ name: 'x', transport: 'http' }), /http\(s\) URL/);
  assert.throws(parse({ name: 'x', transport: 'http', url: 'ftp://example.test/mcp' }), /http\(s\) URL/);
  assert.throws(parse({ name: 'x', transport: 'http', url: 'http://127.0.0.1:1/mcp', command: node }), /stdio servers only/);
  assert.throws(parse({ name: 'x', transport: 'stdio', command: node, env: { API_KEY: 'abc' } }), /Keychain/);
  assert.throws(parse({ name: 'x', transport: 'stdio', command: node, env: { 'lower_case': 'abc' } }), /UPPER_SNAKE_CASE/);
  assert.throws(parse({ name: 'x', transport: 'stdio', command: node, limits: { timeoutMs: 10 } }), /timeoutMs/);
  assert.throws(() => upsertMcpServer({ name: 'x', transport: 'stdio', command: node, extra: true }), /Unrecognized key/);
  assert.equal(store.get('mcp-servers', 'x'), undefined);

  const first = upsertMcpServer({ name: 'fixture', transport: 'stdio', command: node, args: [fixture, 'stdio'] });
  assert.deepEqual(first.limits, { timeoutMs: 30_000, maxArgBytes: 16_384, maxResultBytes: 49_152 });
  assert.equal(first.enabled, false); assert.deepEqual(first.projects, []);
  assert.equal(health('fixture')?.state, 'disabled');
  const second = upsertMcpServer({ name: 'fixture', transport: 'stdio', command: node, args: [fixture, 'stdio'], enabled: true, projects: ['demo'], limits: { timeoutMs: 5000 } });
  assert.equal(second.createdAt, first.createdAt); assert.ok(second.updatedAt >= first.updatedAt);
  assert.deepEqual(second.limits, { timeoutMs: 5000, maxArgBytes: 16_384, maxResultBytes: 49_152 });
  assert.equal(store.list<McpServerConfig>('mcp-servers').length, 1);
  assert.equal(health('fixture')?.state, 'disconnected');
  assert.equal(store.replay(0, 5000).filter(event => event.type === 'mcp.server_updated').length, 2);
});

test('tools export only for enabled, checked servers within project scope', { timeout: 10_000 }, async () => {
  upsertMcpServer(stdio({ enabled: false }));
  assert.equal(health('fixture')?.state, 'disabled'); assert.deepEqual(mcpToolsFor('demo'), []);
  assert.deepEqual(await checkMcpServer('fixture'), { ...health('fixture'), state: 'disabled', tools: [], toolCount: 0 });
  setMcpServerEnabled('fixture', true);
  assert.equal(health('fixture')?.state, 'disconnected'); assert.deepEqual(mcpToolsFor('demo'), []); assert.deepEqual(mcpToolNames(), []);
  const checked = await checkMcpServer('fixture');
  assert.equal(checked.state, 'connected', checked.lastError ?? ''); assert.equal(checked.toolCount, 6); assert.equal(typeof checked.lastConnectedAt, 'number');
  assert.deepEqual(checked.tools.find(remote => remote.name === 'echo')?.inputSchema, { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] });
  assert.deepEqual(names('demo'), ALL);
  for (const exported of mcpToolsFor('demo')) assert.ok(exported.description.startsWith('[External MCP: fixture] '), exported.description);
  assert.equal(tool('demo', 'ext_fixture_echo').description, '[External MCP: fixture] Returns the text');
  assert.deepEqual(mcpToolsFor('other'), []); assert.deepEqual(mcpToolsFor(undefined), []);
  assert.deepEqual(mcpToolNames().sort(), ALL);
  assert.equal(mcpHealthAll().find(entry => entry.server === 'fixture')?.state, 'connected');

  setMcpServerProjects('fixture', '*');
  assert.equal(health('fixture')?.state, 'disconnected', 'any config change demotes until the next check');
  assert.deepEqual(mcpToolsFor('demo'), []);
  assert.equal((await checkMcpServer('fixture')).state, 'connected');
  assert.deepEqual(names(undefined), ALL); assert.deepEqual(names('anything'), ALL);
});

test('allowTools and denyTools filter the exported set', { timeout: 10_000 }, async () => {
  upsertMcpServer(stdio({ projects: '*', allowTools: ['echo', 'slow', 'big'], denyTools: ['slow'] }));
  assert.equal((await checkMcpServer('fixture')).state, 'connected');
  assert.deepEqual(names('demo'), ['ext_fixture_big', 'ext_fixture_echo']);
  assert.deepEqual(mcpToolNames().sort(), ['ext_fixture_big', 'ext_fixture_echo'], 'mcpToolNames() applies allow/deny like mcpToolsFor');
  upsertMcpServer(stdio({ projects: '*', denyTools: ['fail'] }));
  assert.equal((await checkMcpServer('fixture')).state, 'connected');
  assert.deepEqual(names('demo'), ALL.filter(name => name !== 'ext_fixture_fail'));
});

test('echo returns a governed envelope and records mcp.called', { timeout: 10_000 }, async () => {
  upsertMcpServer(stdio({ projects: '*', limits: { timeoutMs: 1000, maxArgBytes: 1024, maxResultBytes: 2048 } }));
  assert.equal((await checkMcpServer('fixture')).state, 'connected');
  const cursor = store.cursor();
  const { elapsedMs, ...result } = await call('demo', 'ext_fixture_echo', { text: 'hi' });
  assert.deepEqual(result, { source: 'mcp', server: 'fixture', tool: 'echo', caution: MCP_CAUTION, content: 'hi', contentBytes: 2, truncated: false });
  assert.equal(typeof elapsedMs, 'number'); assert.ok(elapsedMs >= 0);
  const events = called(cursor); assert.equal(events.length, 1);
  assert.equal(events[0].projectId, 'demo');
  assert.deepEqual({ ...events[0].payload, elapsedMs: 0 }, { server: 'fixture', tool: 'echo', name: 'ext_fixture_echo', argBytes: Buffer.byteLength(JSON.stringify({ text: 'hi' })), resultBytes: 2, elapsedMs: 0, ok: true, decision: 'allowed', truncated: false });
});

test('oversized arguments are denied before reaching the server', async () => {
  const cursor = store.cursor();
  await assert.rejects(call('demo', 'ext_fixture_echo', { text: 'y'.repeat(1500) }), /1024-byte limit for fixture/);
  const events = called(cursor); assert.equal(events.length, 1);
  assert.equal(events[0].payload.decision, 'denied'); assert.equal(events[0].payload.ok, false); assert.equal(events[0].payload.resultBytes, 0);
  assert.ok(Number(events[0].payload.argBytes) > 1024); assert.match(String(events[0].payload.error), /exceed 1024 bytes/);
  assert.equal(health('fixture')?.state, 'connected', 'a denied call does not demote the server');
});

test('a timed-out call demotes the server until the next successful check', { timeout: 10_000 }, async () => {
  const pid = pidIn(pidFile); assert.ok(alive(pid));
  const cursor = store.cursor();
  await assert.rejects(call('demo', 'ext_fixture_slow', { ms: 10_000 }), /External MCP server fixture failed: .*timed out/i);
  const events = called(cursor); assert.equal(events.length, 1);
  assert.equal(events[0].payload.ok, false); assert.equal(events[0].payload.decision, 'allowed'); assert.match(String(events[0].payload.error), /timed out/i);
  assert.equal(health('fixture')?.state, 'error'); assert.match(health('fixture')?.lastError ?? '', /timed out/i); assert.equal(health('fixture')?.toolCount, 0);
  assert.deepEqual(mcpToolsFor('demo'), []); assert.deepEqual(mcpToolNames(), []);
  assert.ok(await exited(pid), 'the stdio child is gone after demotion');
  const rechecked = await checkMcpServer('fixture');
  assert.equal(rechecked.state, 'connected', rechecked.lastError ?? ''); assert.deepEqual(names('demo'), ALL);
  assert.notEqual(pidIn(pidFile), pid, 'the recheck spawned a fresh child');
});

test('oversized results are truncated to maxResultBytes', async () => {
  const cursor = store.cursor();
  const result = await call('demo', 'ext_fixture_big', { bytes: 5000 });
  assert.equal(result.truncated, true); assert.equal(result.contentBytes, 5000);
  assert.equal(Buffer.byteLength(result.content), 2048); assert.equal(result.content, 'x'.repeat(2048));
  assert.deepEqual(called(cursor).map(event => [event.payload.truncated, event.payload.resultBytes]), [[true, 5000]]);
});

test('a tool-reported error surfaces its message', { timeout: 10_000 }, async () => {
  const cursor = store.cursor();
  await assert.rejects(call('demo', 'ext_fixture_fail', {}), /External MCP server fixture failed: fixture failure/);
  const events = called(cursor); assert.equal(events.length, 1);
  assert.equal(events[0].payload.ok, false); assert.equal(events[0].payload.decision, 'allowed'); assert.equal(events[0].payload.error, 'fixture failure');
  // A tool-reported error is content for the model; the transport is healthy, so the server stays connected.
  assert.equal(health('fixture')?.state, 'connected'); assert.equal(health('fixture')?.lastError, undefined);
  const again = await call('demo', 'ext_fixture_echo', { text: 'still up' }); assert.equal(again.content, 'still up');
});

test('image content flattens to a placeholder plus the caption', async () => {
  const result = await call('demo', 'ext_fixture_image', {});
  assert.equal(result.content, '[image omitted: image/png]\ncaption'); assert.equal(result.truncated, false);
});

test('a server that dies on start reports its last stderr line', { timeout: 10_000 }, async () => {
  upsertMcpServer({ name: 'broken', transport: 'stdio', command: node, args: [fixture, 'nope'], enabled: true, projects: '*' });
  const checked = await checkMcpServer('broken');
  assert.equal(checked.state, 'error'); assert.match(checked.lastError ?? '', /usage: mcp-server\.mjs stdio \| http <port>/);
  assert.deepEqual(mcpToolsFor('demo').filter(exported => exported.name.startsWith('ext_broken_')), []);
  removeMcpServer('broken');
});

test('secretEnv values come from the resolver and never reach the store or events', { timeout: 10_000 }, async () => {
  const restore = replaceMcpSecretsForTest(async (server, key) => key === 'FIXTURE_SECRET' ? 'from-keychain' : 'other');
  try {
    upsertMcpServer({ name: 'vault', transport: 'stdio', command: node, args: [fixture, 'stdio'], env: { FIXTURE_PID_FILE: vaultPidFile }, secretEnv: ['FIXTURE_SECRET'], enabled: true, projects: '*' });
    const checked = await checkMcpServer('vault'); assert.equal(checked.state, 'connected', checked.lastError ?? '');
    assert.equal((await call('demo', 'ext_vault_secret_echo', {})).content, 'from-keychain');
    assert.equal((await call('demo', 'ext_fixture_secret_echo', {})).content, 'unset', 'a server without secretEnv never sees the value');
    assert.ok(!JSON.stringify(store.list('mcp-servers')).includes('from-keychain'), 'server records hold only the secret name');
    assert.ok(!JSON.stringify(store.list('mcp-health')).includes('from-keychain'));
    assert.ok(!JSON.stringify(store.replay(0, 5000)).includes('from-keychain'), 'no event carries the secret');
    assert.deepEqual(store.get<McpServerConfig>('mcp-servers', 'vault')?.secretEnv, ['FIXTURE_SECRET']);
  } finally { restore(); }
});

test('http transport sends secret headers as lowercase dashed names', { timeout: 10_000 }, async () => {
  const port = await freePort();
  httpChild = spawn(node, [fixture, 'http', String(port)], { env: { ...process.env, FIXTURE_REQUIRED_HEADER: 'abc' }, stdio: ['ignore', 'ignore', 'pipe'] });
  await new Promise<void>((resolve, reject) => {
    let stderr = ''; const timer = setTimeout(() => reject(new Error('http fixture did not start: ' + stderr)), 8000);
    httpChild!.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString(); if (stderr.includes('fixture ready')) { clearTimeout(timer); resolve(); } });
    httpChild!.once('exit', code => { clearTimeout(timer); reject(new Error('http fixture exited ' + String(code) + ': ' + stderr)); });
  });
  const url = 'http://127.0.0.1:' + port + '/mcp';
  upsertMcpServer({ name: 'remote-open', transport: 'http', url, enabled: true, projects: '*' });
  const denied = await checkMcpServer('remote-open');
  assert.equal(denied.state, 'error'); assert.match(denied.lastError ?? '', /x-fixture-key header required/);
  assert.deepEqual(mcpToolsFor('demo').filter(exported => exported.name.startsWith('ext_remote')), []);

  const seen: string[] = [];
  const restore = replaceMcpSecretsForTest(async (server, key) => { seen.push(server + '/' + key); return 'abc'; });
  try {
    upsertMcpServer({ name: 'remote', transport: 'http', url, secretHeaders: ['X_FIXTURE_KEY'], enabled: true, projects: ['demo'] });
    const checked = await checkMcpServer('remote');
    assert.equal(checked.state, 'connected', checked.lastError ?? ''); assert.equal(checked.toolCount, 6);
    assert.deepEqual(seen, ['remote/X_FIXTURE_KEY']);
    const result = await call('demo', 'ext_remote_echo', { text: 'over http' });
    assert.equal(result.content, 'over http'); assert.equal(result.server, 'remote');
    assert.ok(mcpToolNames().includes('ext_remote_echo')); assert.deepEqual(mcpToolsFor('other').filter(exported => exported.name.startsWith('ext_remote_')), []);
    assert.ok(!JSON.stringify(store.list('mcp-servers')).includes('abc"'), 'header values are never persisted');
  } finally { restore(); }
  removeMcpServer('remote'); removeMcpServer('remote-open');
  assert.ok(!mcpToolNames().some(name => name.startsWith('ext_remote')));
});

test('removing a server drops its tools, health and child process', { timeout: 10_000 }, async () => {
  assert.equal(health('vault')?.state, 'connected');
  const pid = pidIn(vaultPidFile); assert.ok(alive(pid));
  const cursor = store.cursor();
  removeMcpServer('vault');
  assert.deepEqual(mcpToolsFor('demo').filter(exported => exported.name.startsWith('ext_vault_')), []);
  assert.equal(store.get('mcp-servers', 'vault'), undefined); assert.equal(health('vault'), undefined);
  assert.ok(!mcpHealthAll().some(entry => entry.server === 'vault'));
  assert.ok(!mcpToolNames().some(name => name.startsWith('ext_vault_')));
  assert.deepEqual(store.replay(cursor, 5000).map(event => event.type), ['mcp.server_removed']);
  assert.throws(() => removeMcpServer('vault'), /Unknown MCP server/);
  assert.ok(await exited(pid), 'the stdio child is gone after removal');
});

test('stopMcpClients kills children and startMcpClients re-arms connections', { timeout: 10_000 }, async () => {
  assert.equal(health('fixture')?.state, 'connected');
  const pid = pidIn(pidFile); assert.ok(alive(pid));
  await stopMcpClients();
  assert.equal(health('fixture')?.state, 'disconnected'); assert.equal(health('fixture')?.toolCount, 0);
  assert.deepEqual(mcpToolsFor('demo'), []); assert.deepEqual(mcpToolNames(), []);
  assert.ok(await exited(pid), 'no stdio child survives stopMcpClients');
  // Pins current behavior: stop is terminal. connect() refuses with 'Backend is shutting down' until startMcpClients() clears the flag.
  const refused = await checkMcpServer('fixture');
  assert.equal(refused.state, 'error'); assert.match(refused.lastError ?? '', /shutting down/);
  startMcpClients();
  const reconnected = await checkMcpServer('fixture');
  assert.equal(reconnected.state, 'connected', reconnected.lastError ?? ''); assert.deepEqual(names('demo'), ALL);
  const next = pidIn(pidFile); assert.notEqual(next, pid); assert.ok(alive(next));
  assert.equal((await call('demo', 'ext_fixture_echo', { text: 'again' })).content, 'again');
});

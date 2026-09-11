import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, linkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { leaseTools, closeToolService, fileTools, type ToolCallInfo, type ToolResultInfo } from '../src/tool-service.js';
after(closeToolService);
const rpc = (lease: { url: string; token: string }, name: string, args: Record<string, unknown>, id = 1) => fetch(lease.url, { method: 'POST', headers: { authorization: 'Bearer ' + lease.token, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) });
test('revoking a tool lease aborts and waits for in-flight actions before verification', { timeout: 5000 }, async () => {
  let entered!: () => void, stopped = false; const running = new Promise<void>(resolve => { entered = resolve; }); const results: ToolResultInfo[] = [];
  const lease = await leaseTools([{ name: 'wait_for_stop', description: 'Fixture only', inputSchema: { type: 'object' }, call: async (_args, signal) => {
    entered(); await new Promise<void>(resolve => { signal.addEventListener('abort', () => setTimeout(() => { stopped = true; resolve(); }, 20), { once: true }); }); return 'Stopped';
  } }], new AbortController().signal, { onResult: info => { results.push(info); } });
  const call = () => rpc(lease, 'wait_for_stop', {});
  const pending = call().catch(() => undefined);
  try { await running; await lease.close(); assert.deepEqual(results.map(info => [info.name, info.ok]), [['wait_for_stop', true]]); await pending; }
  finally { await lease.close(); }
  assert.equal(stopped, true); assert.equal((await call()).status, 403);
});
test('lease hooks report each call in order for a success, a tool error and an unknown tool, even when hooks throw', async () => {
  const calls: ToolCallInfo[] = [], results: ToolResultInfo[] = [];
  const lease = await leaseTools([
    { name: 'echo', description: 'Fixture only', inputSchema: { type: 'object' }, call: async args => ({ echoed: args }) },
    { name: 'fail', description: 'Fixture only', inputSchema: { type: 'object' }, call: async () => { throw new Error('Fixture failure'); } },
  ], new AbortController().signal, { onAttempt: () => { throw new Error('hook failures stay out of the call'); }, onCall: info => { calls.push(info); throw new Error('hook failures stay out of the call'); }, onResult: info => { results.push(info); throw new Error('hook failures stay out of the call'); } });
  const call = async (name: string, args: Record<string, unknown>, id: number) => ((await (await rpc(lease, name, args, id)).json()) as { result: { isError?: boolean; content: { text: string }[] } }).result;
  try {
    const ok = await call('echo', { path: 'a.txt', apiKey: 'shh' }, 1);
    assert.equal(ok.isError, undefined); assert.deepEqual(JSON.parse(ok.content[0].text), { echoed: { path: 'a.txt', apiKey: 'shh' } });
    const failed = await call('fail', {}, 2); assert.equal(failed.isError, true); assert.equal(failed.content[0].text, 'Fixture failure');
    const unknown = await call('nope', { x: 1 }, 3); assert.equal(unknown.isError, true); assert.equal(unknown.content[0].text, 'Tool is not authorized for this run');
  } finally { await lease.close(); }
  assert.deepEqual(calls, [{ name: 'echo', args: { path: 'a.txt', apiKey: 'shh' } }, { name: 'fail', args: {} }, { name: 'nope', args: { x: 1 } }]);
  assert.equal(results.length, 3);
  const [first, second, third] = results;
  assert.deepEqual({ ...first, elapsedMs: 0 }, { name: 'echo', ok: true, result: { echoed: { path: 'a.txt', apiKey: 'shh' } }, elapsedMs: 0, bytes: Buffer.byteLength(JSON.stringify({ echoed: { path: 'a.txt', apiKey: 'shh' } })) });
  assert.deepEqual({ ...second, elapsedMs: 0 }, { name: 'fail', ok: false, error: 'Fixture failure', elapsedMs: 0, bytes: Buffer.byteLength('Fixture failure') });
  assert.deepEqual({ ...third, elapsedMs: 0 }, { name: 'nope', ok: false, error: 'Tool is not authorized for this run', elapsedMs: 0, bytes: Buffer.byteLength('Tool is not authorized for this run') });
  for (const info of results) assert.ok(Number.isInteger(info.elapsedMs) && info.elapsedMs >= 0);
});
test('file edits replace only the scoped directory entry, not an external hard-linked inode', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nibbi-edit-')); const work = join(directory, 'work'); mkdirSync(work);
  try {
    const outside = join(directory, 'owner.txt'); writeFileSync(outside, 'owner text'); linkSync(outside, join(work, 'alias.txt'));
    const signal = new AbortController().signal, tools = fileTools({ role: 'fixer', cwd: work, readableRoots: [work], writableRoots: [work] }, signal);
    await tools.find(tool => tool.name === 'edit_file')!.call({ path: 'alias.txt', oldText: 'owner text', newText: 'scoped text' }, signal);
    assert.equal(readFileSync(outside, 'utf8'), 'owner text'); assert.equal(readFileSync(join(work, 'alias.txt'), 'utf8'), 'scoped text');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, linkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { leaseTools, closeToolService, fileTools } from '../src/tool-service.js';
after(closeToolService);
test('revoking a tool lease aborts and waits for in-flight actions before verification', { timeout: 5000 }, async () => {
  let entered!: () => void, stopped = false; const running = new Promise<void>(resolve => { entered = resolve; });
  const lease = await leaseTools([{ name: 'wait_for_stop', description: 'Fixture only', inputSchema: { type: 'object' }, call: async (_args, signal) => {
    entered(); await new Promise<void>(resolve => { signal.addEventListener('abort', () => setTimeout(() => { stopped = true; resolve(); }, 20), { once: true }); }); return 'Stopped';
  } }], new AbortController().signal);
  const call = () => fetch(lease.url, { method: 'POST', headers: { authorization: 'Bearer ' + lease.token, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'wait_for_stop', arguments: {} } }) });
  const pending = call().catch(() => undefined);
  try { await running; await lease.close(); await pending; }
  finally { await lease.close(); }
  assert.equal(stopped, true); assert.equal((await call()).status, 403);
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

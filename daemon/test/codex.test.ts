import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startCodex } from '../src/providers/codex.js';
import type { AgentInput } from '../src/providers/types.js';

const directory = mkdtempSync(join(tmpdir(), 'nibbi-codex-contract-'));
const fixture = fileURLToPath(new URL('./fixtures/codex-server.mjs', import.meta.url));
chmodSync(fixture, 0o755);
process.env.NIBBI_CODEX_BIN = fixture;
after(() => { rmSync(directory, { recursive: true, force: true }); });
function setup(scenario: string, resume = false) {
  process.env.NIBBI_TEST_SCENARIO = scenario;
  const transcript = join(directory, scenario + '.jsonl'); process.env.NIBBI_TEST_TRANSCRIPT = transcript;
  const abort = new AbortController(); const events: string[] = [];
  const input: AgentInput = { runId: scenario, provider: 'codex', role: 'lead', cwd: directory, prompt: 'Fixture only', instructions: 'Lead scope only', model: 'test-model',
    signal: abort.signal, skills: [], nativeSkills: { root: '/pinned', paths: ['/pinned/skills/test/SKILL.md'] },
    tools: { url: 'http://127.0.0.1:9999/mcp', token: 'ephemeral-test-token', names: ['read_file'], async close() {} },
    ...(resume ? { sessionId: 'saved-thread' } : {}), onEvent: type => events.push(type) };
  const messages = (): Array<{ method?: string; id?: string; params: any; result?: any }> => { try { return readFileSync(transcript, 'utf8').trim().split('\n').map(line => JSON.parse(line)); } catch { return []; } };
  return { abort, events, messages, handle: startCodex(input) };
}
test('Codex uses pinned scopes, disables inherited capabilities, streams and requires a terminal result', async () => {
  const run = setup('completed'); const result = await run.handle.result;
  assert.equal(result.isError, false); assert.equal(result.text, 'Hello'); assert.equal(result.costUsd, undefined);
  assert.ok(run.events.includes('text.delta'));
  const messages = run.messages(), thread = messages.find(message => message.method === 'thread/start')!.params;
  assert.equal(thread.approvalPolicy, 'never'); assert.equal(thread.sandbox, 'read-only'); assert.equal(thread.cwd, directory);
  assert.deepEqual(thread.config.mcp_servers.nibbi, { enabled: false });
  assert.deepEqual(thread.config.mcp_servers['third.party'], { enabled: false });
  assert.deepEqual(thread.config.mcp_servers['quoted"name'], { enabled: false });
  assert.deepEqual(thread.config.plugins['inherited.plugin'], { enabled: false });
  assert.ok(Object.keys(thread.config).every(key => !key.startsWith('mcp_servers.') && !key.startsWith('plugins.')));
  assert.deepEqual(thread.config['skills.config'], [{ path: '/untrusted', enabled: false }, { path: '/pinned/skills/test', enabled: true }]);
  const owned = Object.entries(thread.config.mcp_servers).find(([key]) => /^nibbi_/.test(key))![1] as any;
  assert.deepEqual(owned.enabled_tools, ['read_file']); assert.equal(owned.command, undefined);
  assert.equal(messages.find(message => message.id === 'approval')?.result.decision, 'decline');
  assert.equal(messages.find(message => message.method === 'turn/start')!.params.sandboxPolicy.networkAccess, false);
});
test('Codex preserves failed terminal status and resumes only the requested thread', async () => {
  const run = setup('failed', true); const result = await run.handle.result;
  assert.equal(result.isError, true); assert.match(result.text, /Fixture failure/);
  assert.equal(run.messages().find(message => message.method === 'thread/resume')!.params.threadId, 'saved-thread');
  assert.equal(run.messages().filter(message => message.method === 'thread/start').length, 0);
});
test('Codex disconnect is failure, never an empty successful response', async () => {
  await assert.rejects(setup('disconnect').handle.result, /connection closed/);
});
test('Codex steering targets the active turn and cancellation shuts down the transport', async () => {
  const run = setup('hold'); const result = assert.rejects(run.handle.result, /cancel|closed|abort/i);
  const deadline = Date.now() + 5000;
  while (!run.messages().some(message => message.method === 'turn/start')) { assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 10)); }
  await new Promise(resolve => setTimeout(resolve, 20));
  await run.handle.steer('Keep the original scope'); run.abort.abort(new Error('Owner cancelled'));
  await result;
  assert.equal(run.messages().find(message => message.method === 'turn/steer')!.params.expectedTurnId, 'turn-test');
  assert.ok(run.messages().some(message => message.method === 'turn/interrupt'));
});

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentInput } from '../src/providers/types.js';

const directory = mkdtempSync(join(tmpdir(), 'nibbi-web-lease-'));
process.env.NODE_ENV = 'test';
process.env.NIBBI_STATE_DIR = join(directory, 'state'); process.env.NIBBI_VAULT_DIR = join(directory, 'vault');
process.env.NIBBI_WORK_DIR = join(directory, 'work'); process.env.NIBBI_PROJECTS_DIR = join(directory, 'projects');
process.env.NIBBI_PORT = '0';
const vault = process.env.NIBBI_VAULT_DIR;
mkdirSync(vault, { recursive: true }); mkdirSync(join(directory, 'projects', 'demo'), { recursive: true });
for (const [name, text] of Object.entries({ 'SOUL.md': 'fixture-soul', 'AGENTS.md': 'fixture-agents', 'MEMORY.md': 'fixture-memory', 'index.md': 'fixture-index' })) writeFileSync(join(vault, name), text);
const { runtime, closeRuntime } = await import('../src/store.js');
const { runTurn, shutdownSessions } = await import('../src/session.js');
const { replaceProviderForTest } = await import('../src/providers/index.js');
const { closeToolService, fileTools } = await import('../src/tool-service.js');
const web = await import('../src/web-tools.js');
const store = runtime();
store.put('config', 'projects', { demo: { repo: join(directory, 'projects/demo'), install: 'true', check: 'true', webDomains: ['docs.example.org'] } });
after(async () => { await shutdownSessions(); await closeToolService(); closeRuntime(); rmSync(directory, { recursive: true, force: true }); });

async function leaseNames(channel: string, project?: string): Promise<{ names: string[]; facts: string }> {
  const inputs: AgentInput[] = [];
  const restore = replaceProviderForTest('claude', { id: 'claude', capabilities: { streaming: true, steering: true, cancellation: true, skills: true, tools: true, images: true }, start: input => { inputs.push(input); return { cancel: async () => undefined, steer: async () => undefined, result: Promise.resolve({ text: 'ok', isError: false }) }; } });
  try { await runTurn('hello', undefined, channel, undefined, undefined, undefined, undefined, undefined, { project, allowDispatch: channel !== 'cron' }); }
  finally { restore(); }
  return { names: [...inputs[0].tools.names].sort(), facts: inputs[0].instructions };
}

test('web tools join the lead lease for interactive and scheduled turns when configured, and are narrated when absent', async () => {
  const noKey = web.replaceWebTransportForTest({ key: null });
  try {
    web.setWebAccess({ domains: [] });
    const bare = await leaseNames('app');
    assert.equal(bare.names.some(name => name.startsWith('web_')), false);
    assert.match(bare.facts, /No web_search or web_fetch tool is available/);
    const projectFetch = await leaseNames('app', 'demo');
    assert.ok(projectFetch.names.includes('web_fetch')); assert.equal(projectFetch.names.includes('web_search'), false);
    assert.match(projectFetch.facts, /No web_search tool is available/);
  } finally { noKey(); }
  const withKey = web.replaceWebTransportForTest({ key: 'fixture' });
  try {
    web.setWebAccess({ domains: ['example.com'] });
    for (const channel of ['app', 'cron']) {
      const turn = await leaseNames(channel, 'demo');
      assert.ok(turn.names.includes('web_search'), channel); assert.ok(turn.names.includes('web_fetch'), channel);
      assert.match(turn.facts, /Web access is available only through web_search and web_fetch/);
      const facts = JSON.parse(turn.facts.split('CURRENT CAPABILITY FACTS (complete governed tool list for this turn): ')[1].split('\n')[0]) as string[];
      assert.deepEqual(facts, turn.names);
    }
  } finally { withKey(); }
});

test('fixer file tools never include web access', () => {
  const scope = { role: 'fixer' as const, cwd: directory, readableRoots: [directory], writableRoots: [directory] };
  const names = fileTools(scope, new AbortController().signal).map(tool => tool.name);
  assert.deepEqual(names, ['read_file', 'list_files', 'write_file', 'edit_file', 'shell']);
});

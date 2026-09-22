import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentInput, AgentProvider } from '../src/providers/types.js';

const root = mkdtempSync(join(tmpdir(), 'nibbi-stream-events-'));
process.env.NODE_ENV = 'test';
process.env.NIBBI_STATE_DIR = join(root, 'state'); process.env.NIBBI_VAULT_DIR = join(root, 'vault');
process.env.NIBBI_WORK_DIR = join(root, 'work'); process.env.NIBBI_PROJECTS_DIR = join(root, 'projects');
process.env.NIBBI_OWNER = 'Fixture Owner'; process.env.NIBBI_PORT = '0';
for (const path of [process.env.NIBBI_VAULT_DIR, join(root, 'projects/demo')]) mkdirSync(path, { recursive: true });
for (const name of ['SOUL.md', 'AGENTS.md', 'MEMORY.md', 'index.md']) writeFileSync(join(process.env.NIBBI_VAULT_DIR, name), 'CANONICAL FIXTURE ' + name);
const { runtime, closeRuntime } = await import('../src/store.js');
const { runTurn, shutdownSessions } = await import('../src/session.js');
const { replaceProviderForTest } = await import('../src/providers/index.js');
const { closeToolService } = await import('../src/tool-service.js');
const store = runtime();
store.put('config', 'projects', { demo: { repo: join(root, 'projects/demo'), settings: { lead: { provider: 'claude', model: 'fixture' } } } });
const caps = { streaming: true, steering: true, cancellation: true, skills: true, tools: true, images: true };
const provider = (start: AgentProvider['start']): AgentProvider => ({ id: 'claude', capabilities: caps, start });
const rowsSince = (cursor: number): Array<{ type: string; payload: Record<string, unknown> }> => store.replay(cursor, 5000).map(event => ({ type: event.type, payload: event.payload as Record<string, unknown> }));

after(async () => { await shutdownSessions(); await closeToolService(); closeRuntime(); rmSync(root, { recursive: true, force: true }); });

test('every token is forwarded, but the trail keeps far fewer rows saying the same words', async () => {
  const cursor = store.cursor();
  const words = Array.from({ length: 60 }, (_, i) => 'word' + i + ' ');
  const restore = replaceProviderForTest('claude', provider((input: AgentInput) => ({
    result: (async () => {
      for (const word of words) input.onEvent('text.delta', { text: word });
      input.onEvent('tool.started', { name: 'Read' });
      for (const word of words) input.onEvent('text.delta', { text: word });
      return { text: words.join('') + words.join(''), isError: false };
    })(),
    cancel: async () => undefined, steer: async () => undefined,
  })));
  const forwarded: string[] = [];
  try { await runTurn('stream please', undefined, 'app', undefined, text => forwarded.push(text), undefined, undefined, false, { project: 'demo' }); }
  finally { restore(); }

  assert.equal(forwarded.length, 120, 'the surface hears every token as it arrives');
  const rows = rowsSince(cursor);
  const textRows = rows.filter(row => row.type === 'text.delta');
  assert.ok(textRows.length < 30, 'the trail coalesces them, was ' + textRows.length + ' rows for 120 tokens');
  assert.equal(textRows.map(row => String(row.payload.text)).join(''), forwarded.join(''), 'and records exactly the same text');

  // A tool row must not land in the middle of the text that preceded it.
  const order = rows.filter(row => row.type === 'text.delta' || row.type === 'tool.started').map(row => row.type);
  const firstTool = order.indexOf('tool.started');
  assert.ok(firstTool > 0, 'the tool row follows the text that came before it');
  const before = rows.filter(row => row.type === 'text.delta').slice(0, order.slice(0, firstTool).length).map(row => String(row.payload.text)).join('');
  assert.equal(before, words.join(''), 'and everything said before the tool was written before it');
});

test('thinking is shown while it happens and remembered as one line', async () => {
  const cursor = store.cursor();
  const restore = replaceProviderForTest('claude', provider((input: AgentInput) => ({
    result: (async () => {
      input.onEvent('thinking.delta', { text: '' });
      input.onEvent('thinking.delta', { text: 'weighing the lock' });
      input.onEvent('thinking.delta', { text: ' against the abort path' });
      input.onEvent('text.delta', { text: 'Found it.' });
      return { text: 'Found it.', isError: false };
    })(),
    cancel: async () => undefined, steer: async () => undefined,
  })));
  const thoughts: string[] = [];
  try { await runTurn('think please', undefined, 'app', undefined, undefined, undefined, undefined, false, { project: 'demo', onThinking: text => thoughts.push(text) }); }
  finally { restore(); }

  assert.equal(thoughts.length, 3, 'every reasoning delta reaches the surface');
  assert.equal(thoughts.join(''), 'weighing the lock against the abort path');
  const rows = rowsSince(cursor);
  assert.equal(rows.filter(row => row.type === 'thinking.delta').length, 0, 'reasoning text is never written down');
  const summaries = rows.filter(row => row.type === 'thinking.summary');
  assert.equal(summaries.length, 1, 'one line says it happened');
  assert.equal(summaries[0].payload.chars, 'weighing the lock against the abort path'.length);
  assert.ok(typeof summaries[0].payload.ms === 'number');
  const types = rows.map(row => row.type);
  assert.ok(types.indexOf('thinking.summary') < types.indexOf('text.delta'), 'thought, then said');
});

test('a reply with nothing to think about records no thinking at all', async () => {
  const cursor = store.cursor();
  const restore = replaceProviderForTest('claude', provider((input: AgentInput) => ({
    result: (async () => { input.onEvent('text.delta', { text: 'Straight to it.' }); return { text: 'Straight to it.', isError: false }; })(),
    cancel: async () => undefined, steer: async () => undefined,
  })));
  try { await runTurn('no thinking', undefined, 'app', undefined, undefined, undefined, undefined, false, { project: 'demo' }); }
  finally { restore(); }
  assert.equal(rowsSince(cursor).filter(row => row.type.startsWith('thinking.')).length, 0);
});

test('a subscriber can ask not to be sent the types it has no use for', () => {
  const cursor = store.cursor();
  store.emit({ type: 'text.delta', runId: 'r1', payload: { text: 'noise' } });
  store.emit({ type: 'run.updated', runId: 'r1', payload: { run: { id: 'r1' } } });
  store.emit({ type: 'text.delta', runId: 'r1', payload: { text: 'more noise' } });
  const all = store.replay(cursor, 250);
  const filtered = store.replay(cursor, 250, ['text.delta']);
  assert.equal(all.length, 3);
  assert.deepEqual(filtered.map(event => event.type), ['run.updated']);
  assert.equal(filtered[0].id, all[1].id, 'the ids the subscriber sees are still the real ones');
});

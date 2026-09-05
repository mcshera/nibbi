import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { query } from '@anthropic-ai/claude-agent-sdk';
import { startClaude } from '../src/providers/claude.js';
import type { AgentInput } from '../src/providers/types.js';
import type { ClaudeConnection } from '../src/providers/claude-auth.js';
const connect = async (): Promise<ClaudeConnection> => ({ mode: 'signin', env: {}, executable: '/fixture/claude' });
const accountInfo = async () => ({ subscriptionType: 'Claude Max', apiProvider: 'firstParty' as const });
const input = (): AgentInput => ({ runId: 'claude-contract', provider: 'claude', role: 'fixer', cwd: '/tmp', prompt: 'Fixture', instructions: 'Worktree only', model: 'test-model', signal: new AbortController().signal,
  skills: [], nativeSkills: { root: '/tmp/pinned-skills', paths: [] }, tools: { url: 'http://127.0.0.1:9999/mcp', token: 'test', names: ['read_file'], async close() {} }, onEvent() {} });
test('Claude explicitly disables inherited settings and skills, and honors SDK is_error', async () => {
  let options: any, closed = false;
  const fake = ((args: any) => { options = args.options; return { async *[Symbol.asyncIterator]() {
    yield { type: 'system', subtype: 'init', session_id: 'fixture' };
    yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Partial work' }] } };
    yield { type: 'result', is_error: true, errors: ['Provider failed'], total_cost_usd: 0.01, session_id: 'fixture', usage: {} };
  }, accountInfo, close() { closed = true; }, async interrupt() {} }; }) as typeof query;
  const result = await startClaude(input(), fake, connect).result;
  assert.equal(result.isError, true); assert.match(result.text, /Provider failed/); assert.equal(closed, true);
  assert.deepEqual(options.settingSources, []); assert.deepEqual(options.skills, []); assert.deepEqual(options.plugins, []);
  assert.deepEqual(options.tools, ['Skill', 'Read']); assert.ok(options.hooks.PreToolUse.length);
  assert.equal(options.env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  assert.equal(options.env.ANTHROPIC_API_KEY, undefined); assert.equal(options.pathToClaudeCodeExecutable, '/fixture/claude');
  assert.deepEqual(options.settings, { forceLoginMethod: 'claudeai' }); assert.equal(result.costUsd, undefined, 'subscription estimates are not API charges');
  const denied = await options.canUseTool('Bash', { command: 'echo unauthorized' }); assert.equal(denied.behavior, 'deny');
});
test('Claude stream without a terminal result is a failure and closes its session', async () => {
  let closed = false;
  const fake = (() => ({ async *[Symbol.asyncIterator]() {}, accountInfo, close() { closed = true; }, async interrupt() {} })) as unknown as typeof query;
  await assert.rejects(startClaude(input(), fake, connect).result, /without a terminal result/); assert.equal(closed, true);
});
test('Claude checks the running CLI account before releasing a prompt and rejects API fallback', async () => {
  let delivered = false, closed = false, iterator: AsyncIterator<unknown>;
  const fake = ((args: any) => {
    iterator = args.prompt[Symbol.asyncIterator](); void iterator.next().then(value => { if (!value.done) delivered = true; });
    return { async *[Symbol.asyncIterator]() {}, async accountInfo() { return { subscriptionType: 'Claude Max', apiProvider: 'firstParty', apiKeySource: 'ANTHROPIC_API_KEY' }; }, close() { closed = true; }, async interrupt() {} };
  }) as unknown as typeof query;
  await assert.rejects(startClaude(input(), fake, connect).result, /no prompt was sent/);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(delivered, false); assert.equal(closed, true);
});
test('explicit Claude API mode still records API costs without requiring subscription login', async () => {
  const fake = (() => ({ async *[Symbol.asyncIterator]() { yield { type: 'result', is_error: false, total_cost_usd: 0.02, session_id: 'fixture', usage: {} }; }, close() {}, async interrupt() {} })) as unknown as typeof query;
  const result = await startClaude(input(), fake, async () => ({ mode: 'api-key', env: { ANTHROPIC_API_KEY: 'fixture-only' } })).result;
  assert.equal(result.isError, false); assert.equal(result.costUsd, 0.02);
});

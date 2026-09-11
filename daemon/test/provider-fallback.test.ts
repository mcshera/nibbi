import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { query } from '@anthropic-ai/claude-agent-sdk';
import { startClaude } from '../src/providers/claude.js';
import { ProviderTurnError } from '../src/providers/failure.js';
import type { AgentInput } from '../src/providers/types.js';

const base = (): AgentInput => ({ runId: 'quota-fixture', role: 'lead', provider: 'claude', cwd: '/tmp', prompt: 'fixture', instructions: 'fixture',
  skills: [], nativeSkills: { root: '/tmp', paths: [] }, tools: { url: 'http://127.0.0.1:1', token: 'fixture', names: [], async close() {} },
  signal: new AbortController().signal, onEvent() {} });
const terminal = (subtype = 'error_during_execution', is_error = true) => ({ type: 'result', subtype, is_error, errors: ['diagnostic'], session_id: 'primary', usage: {}, total_cost_usd: 0 });
const assistant = (error?: string, text = 'quota diagnostic') => ({ type: 'assistant', error, parent_tool_use_id: null, message: { content: [{ type: 'text', text }] } });
const limit = (status: string) => ({ type: 'rate_limit_event', rate_limit_info: { status, resetsAt: 2_000_000_000 } });
function run(messages: any[], input = base(), before?: (options: any) => Promise<void>, crash = false) {
  const fake = ((args: any) => ({ async *[Symbol.asyncIterator]() { await before?.(args.options); for (const message of messages) yield message; if (crash) throw new Error('usage limit text is not classification'); }, close() {}, async interrupt() {} })) as unknown as typeof query;
  return startClaude(input, fake, async () => ({ mode: 'api-key', env: {} })).result;
}
test('Claude typed quota result has evidence, normalized reset and no ordinary diagnostic text', async () => {
  const events: string[] = [], input = base(); input.onEvent = type => events.push(type);
  const result = await run([limit('rejected'), assistant('rate_limit'), terminal()], input);
  assert.deepEqual(result.usageLimit, { kind: 'usage_limit', provider: 'claude', resetAtMs: 2_000_000_000_000 });
  assert.deepEqual(result.evidence, { toolAttempted: false, ordinaryTextProduced: false }); assert.deepEqual(events, []);
});
test('Claude never classifies successful/warning/other failure/turn-limit/text-only cases as usage exhaustion', async () => {
  const cases = [
    [limit('rejected'), assistant('rate_limit'), terminal('success', false)],
    [limit('allowed_warning'), terminal()], [limit('rejected'), limit('allowed'), terminal()],
    [assistant(undefined, 'usage limit exceeded'), terminal()],
    ...['authentication_failed', 'billing_error', 'account_on_hold', 'overloaded', 'invalid_request', 'max_output_tokens', 'unknown'].map(error => [limit('rejected'), assistant(error), terminal()]),
    ...['error_max_turns', 'error_max_budget_usd', 'error_max_structured_output_retries'].map(subtype => [assistant('rate_limit'), terminal(subtype)]),
  ];
  for (const messages of cases) assert.equal((await run(messages)).usageLimit, undefined, JSON.stringify(messages));
});
test('Claude counts complete and streamed ordinary output independently of quota classification', async () => {
  for (const first of [assistant(undefined, 'hello'), { type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } } }]) {
    const result = await run([first, assistant('rate_limit'), terminal()]); assert.equal(result.evidence?.ordinaryTextProduced, true);
  }
});
test('Claude evidence counts native/child/denied tools and both permission paths before checking policy', async () => {
  for (const message of [
    { type: 'assistant', parent_tool_use_id: 'child', message: { content: [{ type: 'tool_use', name: 'Read' }] } },
    { type: 'stream_event', parent_tool_use_id: 'child', event: { type: 'content_block_start', content_block: { type: 'server_tool_use', name: 'search' } } },
    { type: 'system', subtype: 'permission_denied', tool_name: 'Bash' },
    { type: 'tool_progress', tool_name: 'Read' },
  ]) assert.equal((await run([message, assistant('rate_limit'), terminal()])).evidence?.toolAttempted, true);
  const events: string[] = [], input = base(); input.onEvent = type => events.push(type);
  const result = await run([assistant('rate_limit'), terminal()], input, async options => {
    const denied = await options.canUseTool('Bash', {}); assert.equal(events[0], 'tool.attempted'); assert.equal(denied.behavior, 'deny');
    await options.hooks.PreToolUse[0].hooks[0]({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {} });
  });
  assert.equal(result.evidence?.toolAttempted, true); assert.equal(events.length, 2);
});
test('Claude rejections retain evidence but never infer quota from error text or an incomplete stream', async () => {
  await assert.rejects(run([assistant(undefined, 'hello'), limit('rejected')], base(), undefined, true), error => {
    assert.ok(error instanceof ProviderTurnError); assert.equal(error.usageLimit, undefined); assert.equal(error.evidence?.ordinaryTextProduced, true); return true;
  });
  const input = base(), abort = new AbortController(); input.signal = abort.signal; abort.abort(new Error('cancelled'));
  await assert.rejects(run([assistant('rate_limit'), terminal()], input), error => { assert.ok(error instanceof ProviderTurnError); assert.equal(error.usageLimit, undefined); return true; });
});

test('nonempty ordinary result text never leaves evidence absent (including nonstreaming failures)', async () => {
  for (const failed of [true, false]) {
    const result = await run([assistant(undefined, 'ordinary unstreamed response'), terminal(failed ? 'error_during_execution' : 'success', failed)]);
    assert.ok(result.text.trim()); assert.ok(result.evidence, 'session must not need to guess whether text is diagnostic');
    assert.equal(result.evidence.ordinaryTextProduced, true);
  }
});

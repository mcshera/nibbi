#!/usr/bin/env node
// Deterministic App Server contract fixture. Never connects to a provider.
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
const notify = (method, params) => send({ method, params });
const mode = process.env.NIBBI_TEST_SCENARIO;
const completed = () => {
  notify('item/agentMessage/delta', { threadId: 'thread-test', delta: 'Hello' });
  notify('item/completed', { threadId: 'thread-test', item: { type: 'agentMessage', text: 'Hello' } });
  notify('turn/completed', { threadId: 'thread-test', turn: { id: 'turn-test', status: mode === 'failed' ? 'failed' : 'completed', ...(mode === 'failed' ? { error: { message: 'Fixture failure' } } : {}) } });
};
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  appendFileSync(process.env.NIBBI_TEST_TRANSCRIPT, line + '\n');
  if (!message.method || message.id === undefined) return;
  const result = {
    initialize: {}, 'account/read': { account: { type: 'chatgpt' } },
    'config/read': { config: { mcp_servers: { nibbi: { command: 'unsafe' }, 'third.party': { command: 'unsafe' }, 'quoted"name': { command: 'unsafe' } }, plugins: { 'inherited.plugin': {} } } },
    'skills/list': { data: [{ skills: [{ path: '/untrusted/SKILL.md' }, { path: '/pinned/skills/test/SKILL.md' }] }] },
    'thread/start': { thread: { id: 'thread-test' } }, 'thread/resume': { thread: { id: 'thread-test' } },
    'turn/start': { turn: { id: 'turn-test' } }, 'turn/steer': {}, 'turn/interrupt': {},
  }[message.method] ?? {};
  if (mode === 'quota-rpc' && message.method === 'turn/start') {
    send({ id: message.id, error: { code: -32000, message: 'usage limit exceeded', data: { codexErrorInfo: 'usageLimitExceeded' } } }); return;
  }
  send({ id: message.id, result });
  if (message.method === 'turn/start') {
    if (mode?.startsWith('quota-')) {
      if (mode === 'quota-approval') send({ id: 'approval', method: 'item/commandExecution/requestApproval', params: {} });
      const item = mode === 'quota-reasoning' ? { type: 'reasoning' } : mode === 'quota-tool' ? { type: 'mcpToolCall', tool: 'read_file' } : mode === 'quota-unknown' ? { type: 'futureAction' } : undefined;
      if (item) notify('item/started', { threadId: 'thread-test', item });
      if (mode === 'quota-text') notify('item/agentMessage/delta', { threadId: 'thread-test', delta: 'visible' });
      const codexErrorInfo = { 'quota-rate': 'rateLimitExceeded', 'quota-budget': 'sessionBudgetExceeded', 'quota-auth': 'unauthorized', 'quota-429': { httpConnectionFailed: { httpStatusCode: 429 } }, 'quota-english': null }[mode] ?? 'usageLimitExceeded';
      setTimeout(() => notify('turn/completed', { threadId: 'thread-test', turn: { id: 'turn-test', status: mode === 'quota-interrupted' ? 'interrupted' : mode === 'quota-success' ? 'completed' : 'failed', error: { message: 'usage limit exceeded', codexErrorInfo: mode === 'quota-english' ? null : codexErrorInfo }, items: mode === 'quota-terminal-tool' ? [{ type: 'commandExecution' }] : [] } }), 10); return;
    }
    if (mode === 'disconnect') { process.exit(0); return; }
    send({ id: 'approval', method: 'item/commandExecution/requestApproval', params: {} });
    if (mode !== 'hold') setTimeout(completed, 30);
  }
  if (message.method === 'turn/interrupt') notify('turn/completed', { threadId: 'thread-test', turn: { id: 'turn-test', status: 'interrupted' } });
});

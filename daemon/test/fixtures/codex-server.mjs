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
  send({ id: message.id, result });
  if (message.method === 'turn/start') {
    if (mode === 'disconnect') { process.exit(0); return; }
    send({ id: 'approval', method: 'item/commandExecution/requestApproval', params: {} });
    if (mode !== 'hold') setTimeout(completed, 30);
  }
  if (message.method === 'turn/interrupt') notify('turn/completed', { threadId: 'thread-test', turn: { id: 'turn-test', status: 'interrupted' } });
});

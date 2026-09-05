import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execute } from '../src/processes.js';
const directory = mkdtempSync(join(tmpdir(), 'nibbi-claude-auth-'));
process.env.NIBBI_STATE_DIR = directory;
process.env.NIBBI_CLAUDE_BIN = process.execPath; // Runner is mocked; never executes a real provider/login.
const { claudeStatus, prepareClaude, loginClaude, claudeEnvironment } = await import('../src/providers/claude-auth.js');
after(() => rmSync(directory, { recursive: true, force: true }));
const response = (value: unknown) => ({ code: 0, stdout: JSON.stringify(value), stderr: '' });
test('Claude defaults to native sign-in and ignores API keys, OAuth overrides, profiles and gateways', async () => {
  delete process.env.NIBBI_CLAUDE_AUTH;
  process.env.NIBBI_CLAUDE_API_KEY = 'fixture-key'; process.env.ANTHROPIC_API_KEY = 'fixture-key';
  process.env.CLAUDE_CODE_OAUTH_TOKEN = 'fixture-token'; process.env.ANTHROPIC_PROFILE = 'fixture'; process.env.ANTHROPIC_BASE_URL = 'https://invalid.example'; process.env.CLAUDE_CODE_USE_BEDROCK = '1';
  const calls: string[][] = [];
  const connection = await prepareClaude(async (_cwd, _command, args, options) => {
    calls.push(args); assert.deepEqual(args.slice(-3), ['auth', 'status', '--json']);
    assert.equal(options?.env?.ANTHROPIC_API_KEY, undefined);
    return response({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', subscriptionType: 'max', email: 'private@example.test' });
  });
  assert.equal(connection.mode, 'signin'); assert.equal(calls.length, 1);
  for (const key of ['NIBBI_CLAUDE_API_KEY', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_PROFILE', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK']) assert.equal(connection.env[key], undefined, key);
  assert.ok(!JSON.stringify(connection).includes('private@example.test'));
});
test('missing or API-authenticated Claude sessions never silently fall back to a stored key', async () => {
  for (const value of [{ loggedIn: false }, { loggedIn: true, authMethod: 'api_key', apiProvider: 'firstParty' }]) {
    const run: typeof execute = async () => response(value);
    assert.equal((await claudeStatus(run)).connected, false);
    await assert.rejects(prepareClaude(run), /will not fall back/);
  }
  const unavailable = await claudeStatus(async () => { throw new Error('fixture offline'); }); assert.equal(unavailable.connected, false);
});
test('Claude API credentials are read only after an explicit API-mode choice', async () => {
  process.env.NIBBI_CLAUDE_AUTH = 'api-key';
  try { const connection = await prepareClaude(async () => { throw new Error('unexpected subprocess'); }); assert.equal(connection.mode, 'api-key'); assert.equal(connection.env.ANTHROPIC_API_KEY, 'fixture-key'); }
  finally { delete process.env.NIBBI_CLAUDE_AUTH; }
});
test('Claude sign-in opens only the official CLI flow and creates no token-bearing handoff', async () => {
  let file = '';
  const result = await loginClaude(async (_cwd, command, args) => { assert.equal(command, '/usr/bin/open'); assert.deepEqual(args.slice(0, 2), ['-a', 'Terminal']); file = args[2]; return { code: 0, stdout: '', stderr: '' }; });
  const script = readFileSync(file, 'utf8'); assert.match(script, /auth login --claudeai/); assert.match(script, /ANTHROPIC_\*/); assert.match(script, /forceLoginMethod/);
  assert.ok(!script.includes('fixture-key')); assert.ok(!script.includes('fixture-token')); assert.equal(statSync(file).mode & 0o777, 0o700);
  await execute(tmpdir(), '/bin/bash', ['-n', file], { env: claudeEnvironment() });
  assert.match(result.message, /Check connections/);
});

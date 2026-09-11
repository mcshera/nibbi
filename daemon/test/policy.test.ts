import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { within } from '../src/paths.js';
import { decideTool, policyHook, type ToolScope } from '../src/policy.js';

test('scope rejects sibling paths and symlink escapes, including not-yet-created files', t => {
  const box = mkdtempSync(join(tmpdir(), 'nibbi-policy-'));
  t.after(() => rmSync(box, { recursive: true, force: true }));
  const vault = join(box, 'vault'), sibling = join(box, 'vault-other');
  mkdirSync(vault); mkdirSync(sibling); symlinkSync(sibling, join(vault, 'link'));
  assert.equal(within(vault, join(vault, 'new', 'file.md')), true);
  assert.equal(within(vault, join(sibling, 'file.md')), false);
  assert.equal(within(vault, join(vault, 'link', 'file.md')), false);
  const scope: ToolScope = { role: 'lead', cwd: vault, readableRoots: [vault], writableRoots: [vault] };
  writeFileSync(join(vault, 'SOUL.md'), 'protected'); symlinkSync(join(vault, 'SOUL.md'), join(vault, 'alias.md'));
  for (const file_path of [join(sibling, 'x.md'), join(vault, 'link', 'x.md'), join(vault, 'alias.md'), '.git/config']) {
    assert.equal(decideTool(scope, 'Write', { file_path }).allowed, false, file_path);
  }
  assert.equal(decideTool(scope, 'Write', { file_path: 'journal.md' }).allowed, true);
  writeFileSync(join(vault, '.env'), 'API_KEY=test-only'); symlinkSync(join(vault, '.env'), join(vault, 'secret-alias'));
  assert.equal(decideTool(scope, 'Read', { file_path: '.env' }).allowed, false);
  assert.equal(decideTool(scope, 'Read', { file_path: 'secret-alias' }).allowed, false);
});

test('lead cannot turn a read permission into a system action or unknown MCP mutation', async () => {
  const scope: ToolScope = { role: 'lead', cwd: tmpdir(), readableRoots: [tmpdir()], writableRoots: [] };
  for (const command of ['git push origin main', 'git config alias.x status', 'node /tmp/probe.js', 'lsanything']) {
    assert.equal(decideTool(scope, 'Bash', { command }).allowed, false);
  }
  assert.equal(decideTool(scope, 'mcp__unknown__delete_record', {}).allowed, false);
  const hook = await policyHook(scope)({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git push' }, tool_use_id: '1', session_id: 's', transcript_path: '', cwd: tmpdir() }, '1', { signal: new AbortController().signal });
  assert.equal((hook as any).hookSpecificOutput.permissionDecision, 'deny');
});


test('provider-native web tools are denied so the governed web tools are the only path', () => {
  for (const role of ['lead', 'fixer'] as const) {
    const scope: ToolScope = { role, cwd: '/tmp/nibbi-policy-web', readableRoots: ['/tmp/nibbi-policy-web'], writableRoots: ['/tmp/nibbi-policy-web'] };
    for (const tool of ['WebSearch', 'WebFetch']) {
      const decision = decideTool(scope, tool, { url: 'https://example.com', query: 'anything' });
      assert.equal(decision.allowed, false, role + ' ' + tool);
      assert.match(decision.reason ?? '', /governed web_search and web_fetch tools/);
    }
    assert.equal(decideTool(scope, 'TodoWrite', {}).allowed, true);
  }
});

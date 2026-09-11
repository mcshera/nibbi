import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundedInput, summarizeResult, diffFor } from '../src/tool-transcript.js';

test('boundedInput redacts secret-looking keys at every depth and keeps the rest', () => {
  const out = boundedInput({ path: 'a.txt', token: 'x', apiKey: 'y', API_KEY: 'z', api_key: 'w', Authorization: 'Bearer q', cookie: 'c', secretRef: 's', passwordHash: 'p', nested: { password: 'p', keep: 1 }, list: [{ token: 't', n: 2 }] });
  assert.deepEqual(out, { path: 'a.txt', token: '[redacted]', apiKey: '[redacted]', API_KEY: '[redacted]', api_key: '[redacted]', Authorization: '[redacted]', cookie: '[redacted]', secretRef: '[redacted]', passwordHash: '[redacted]', nested: { password: '[redacted]', keep: 1 }, list: [{ token: '[redacted]', n: 2 }] });
});
test('boundedInput clips long strings to 400 chars with an ellipsis and preserves primitives', () => {
  const out = boundedInput({ text: 'x'.repeat(1000), short: 'ok', n: 3, flag: false, none: null, missing: undefined });
  assert.equal((out.text as string).length, 400); assert.ok((out.text as string).endsWith('…'));
  assert.equal(out.short, 'ok'); assert.equal(out.n, 3); assert.equal(out.flag, false); assert.equal(out.none, null); assert.equal(out.missing, null);
});
test('boundedInput caps the whole record at 2 KB by eliding the largest values first', () => {
  const args: Record<string, unknown> = { small: 'keep me' }; for (let i = 0; i < 12; i++) args['field' + i] = 'y'.repeat(399);
  const out = boundedInput(args);
  assert.ok(Buffer.byteLength(JSON.stringify(out)) <= 2048);
  assert.equal(out.small, 'keep me');
  const elided = Object.values(out).filter(value => value === '[…]').length, kept = Object.values(out).filter(value => typeof value === 'string' && value.length === 399).length;
  assert.ok(elided >= 7 && kept >= 4, `elided ${elided}, kept ${kept}`);
  assert.deepEqual(Object.keys(out), Object.keys(args));
});
test('boundedInput bounds depth, entry counts and non-record inputs', () => {
  const deep = boundedInput({ a: { b: { c: { d: { e: 1 } } } } });
  assert.deepEqual(deep, { a: { b: { c: { d: '[…]' } } } });
  const wide = boundedInput({ list: Array.from({ length: 60 }, (_, i) => i) }) as { list: unknown[] };
  assert.equal(wide.list.length, 51); assert.equal(wide.list[50], '[…]');
  assert.deepEqual(boundedInput(null), {}); assert.deepEqual(boundedInput(undefined), {});
  assert.deepEqual(boundedInput('plain'), { value: 'plain' }); assert.deepEqual(boundedInput([1, 2]), { value: [1, 2] });
  assert.deepEqual(boundedInput({ blob: new Uint8Array(4) }), { blob: '[…]' });
  const many: Record<string, unknown> = {}; for (let i = 0; i < 400; i++) many['k' + i] = 'v'.repeat(30);
  assert.ok(Buffer.byteLength(JSON.stringify(boundedInput(many))) <= 2048);
});

test('summarizeResult phrases each governed tool and stays under 300 chars', () => {
  assert.equal(summarizeResult('read_file', { path: 'src/a.ts' }, 'hello world'), 'read 11 chars of src/a.ts');
  assert.equal(summarizeResult('list_files', { path: 'src' }, ['a.ts', 'lib/']), '2 entries in src');
  assert.equal(summarizeResult('write_file', { path: 'new.md', text: '# hi' }, 'Created'), 'wrote new.md');
  assert.equal(summarizeResult('edit_file', { path: 'a.ts', oldText: 'x', newText: 'y' }, 'Updated'), 'updated a.ts');
  assert.equal(summarizeResult('dispatch_fixer', { project: 'p', issue: 'Fix the door', requestId: 'r1' }, { id: 'fix-42', title: 'Door hinge', issue: 'Fix the door' }), 'queued build fix-42: Door hinge');
  assert.equal(summarizeResult('dispatch_fixer', { project: 'p', issue: 'Fix the door', requestId: 'r1' }, { id: 'fix-43', issue: 'Fix the door' }), 'queued build fix-43: Fix the door');
  assert.equal(summarizeResult('steer_fixer', { id: 'fix-42', guidance: 'Use hinges' }, 'Steered fix-42'), 'steered fix-42');
  assert.equal(summarizeResult('web_search', { query: 'godot signals' }, { query: 'godot signals', results: [{}, {}, {}], resultCount: 3 }), '3 results for godot signals');
  assert.equal(summarizeResult('web_fetch', { url: 'https://docs.example.org/x' }, { title: 'Signals — Docs', text: 'a'.repeat(1234), finalUrl: 'https://docs.example.org/x' }), 'Signals — Docs, 1234 chars');
  assert.equal(summarizeResult('web_fetch', { url: 'https://docs.example.org/x' }, { title: '', text: 'abc', finalUrl: 'https://docs.example.org/y' }), 'docs.example.org, 3 chars');
  assert.equal(summarizeResult('web_fetch', { url: 'https://evil.example/x' }, { decision: 'denied', code: 'NOT_ALLOWLISTED', url: 'https://evil.example/x', reason: 'Host is not allowlisted' }), 'evil.example: denied (NOT_ALLOWLISTED)');
  assert.equal(summarizeResult('read_roadmap', {}, { returned: 4, items: [{}, {}, {}, {}] }), '4 items');
  assert.equal(summarizeResult('read_activity', {}, { items: [{}, {}] }), '2 items');
  assert.equal(summarizeResult('list_fixers', {}, { returned: 0, items: [] }), '0 items');
  assert.equal(summarizeResult('shell', { command: 'ls' }, { code: 0, stdout: 'a\nb\n', stderr: '' }), 'exit 0, 4 chars');
  assert.equal(summarizeResult('ext_notion_search', { query: 'q' }, { source: 'mcp', server: 'notion', tool: 'search', content: 'x'.repeat(512), contentBytes: 512 }), 'notion: 512 chars');
  assert.equal(summarizeResult('mystery_tool', { a: 1 }, { ok: true, count: 2 }), '{"ok":true,"count":2}');
  assert.equal(summarizeResult('mystery_tool', {}, 'plain   text\nwith\tspace'), 'plain text with space');
  const long = summarizeResult('mystery_tool', {}, { blob: 'z'.repeat(5000) });
  assert.equal(long.length, 300); assert.ok(long.endsWith('…')); assert.ok(long.startsWith('{"blob":"zzz'));
  const clipped = summarizeResult('dispatch_fixer', {}, { id: 'fix-1', title: 't'.repeat(400) });
  assert.ok(clipped.length <= 300 && clipped.endsWith('…'), clipped);
});
test('summarizeResult never throws on results JSON cannot serialize', () => {
  const cyclic: Record<string, unknown> = { a: 1 }; cyclic.self = cyclic;
  assert.equal(summarizeResult('mystery_tool', {}, cyclic), '[object Object]');
  assert.equal(summarizeResult('mystery_tool', {}, { n: 10n }), '[object Object]');
  assert.equal(summarizeResult('mystery_tool', {}, undefined), 'null');
  const spaced = summarizeResult('mystery_tool', {}, 'a ' + ' '.repeat(5000) + 'b');
  assert.ok(spaced.length <= 300 && spaced.startsWith('a ') && spaced.endsWith('…'), spaced);
});

test('diffFor renders edit_file as a unified diff with context lines and block-relative hunk positions', () => {
  const oldText = ['a', 'b', 'c', 'd', 'e', 'old line', 'f', 'g', 'h', 'i'].join('\n'), newText = ['a', 'b', 'c', 'd', 'e', 'new line', 'extra', 'f', 'g', 'h', 'i'].join('\n');
  const diff = diffFor('edit_file', { path: 'src/thing.ts', oldText, newText });
  assert.equal(diff, ['diff --git a/src/thing.ts b/src/thing.ts', '--- a/src/thing.ts', '+++ b/src/thing.ts', '@@ -3,7 +3,8 @@', ' c', ' d', ' e', '-old line', '+new line', '+extra', ' f', ' g', ' h'].join('\n'));
});
test('diffFor keeps common lines inside a change as context and handles removals and trailing newlines', () => {
  const diff = diffFor('edit_file', { path: 'x.md', oldText: 'one\ntwo\nthree\nfour\n', newText: 'one\nthree\n' });
  assert.equal(diff, ['diff --git a/x.md b/x.md', '--- a/x.md', '+++ b/x.md', '@@ -1,4 +1,2 @@', ' one', '-two', ' three', '-four'].join('\n'));
  const emptied = diffFor('edit_file', { path: 'x.md', oldText: 'gone', newText: '' });
  assert.equal(emptied, ['diff --git a/x.md b/x.md', '--- a/x.md', '+++ b/x.md', '@@ -1,1 +1,0 @@', '-gone'].join('\n'));
});
test('diffFor renders write_file as an all-plus diff against /dev/null', () => {
  const diff = diffFor('write_file', { path: 'notes/new.md', text: '# Title\n\nbody\n' });
  assert.equal(diff, ['diff --git a/notes/new.md b/notes/new.md', '--- /dev/null', '+++ b/notes/new.md', '@@ -0,0 +1,3 @@', '+# Title', '+', '+body'].join('\n'));
});
test('diffFor truncates at 4 KB with a trailing marker, clips very long lines, and skips other tools', () => {
  const big = diffFor('write_file', { path: 'big.txt', text: Array.from({ length: 500 }, (_, i) => 'line number ' + i + ' ' + 'x'.repeat(40)).join('\n') })!;
  assert.ok(Buffer.byteLength(big) <= 4096, String(Buffer.byteLength(big)));
  const lines = big.split('\n');
  assert.equal(lines[lines.length - 1], '… (truncated)'); assert.equal(lines[0], 'diff --git a/big.txt b/big.txt'); assert.ok(lines.length > 40);
  const wide = diffFor('write_file', { path: 'w.txt', text: 'y'.repeat(3000) })!;
  assert.ok(wide.split('\n')[4].length <= 501 && wide.split('\n')[4].endsWith('…'));
  const bulk = diffFor('edit_file', { path: 'e.txt', oldText: Array.from({ length: 3000 }, (_, i) => 'o' + i).join('\n'), newText: Array.from({ length: 3000 }, (_, i) => 'n' + i).join('\n') })!;
  assert.ok(Buffer.byteLength(bulk) <= 4096); assert.ok(bulk.endsWith('… (truncated)'));
  assert.equal(diffFor('read_file', { path: 'a' }), undefined);
  assert.equal(diffFor('edit_file', { path: 'a', oldText: 'x' }), undefined);
  assert.equal(diffFor('write_file', { path: 'a' }), undefined);
});

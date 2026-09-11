import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeToolEvent, formatBytes, stepSummaryLine, elapsedLabel, inputLine, toolKind } from '../public/lib/transcript.js';

test('governed started event: friendly label, exact name, input line, no verdict yet', () => {
  const r = describeToolEvent({ name: 'mcp__nibbi__web_fetch', phase: 'started', source: 'governed', input: { url: 'https://docs.example.com/guide', maxBytes: 20000 } });
  assert.equal(r.label, 'reading a page');
  assert.equal(r.name, 'web_fetch');
  assert.equal(r.detail, 'https://docs.example.com/guide');
  assert.equal(r.ok, null);
  assert.equal(r.elapsedLabel, '');
  assert.equal(r.phase, 'started');
  assert.equal(r.kind, 'web');
  assert.equal(r.source, 'governed');
  // daemon may emit the stripped name; label and name still resolve
  const s = describeToolEvent({ name: 'edit_file', phase: 'started', source: 'governed', input: { path: 'src/a.ts', oldText: 'x', newText: 'y' } });
  assert.equal(s.label, 'editing'); assert.equal(s.name, 'edit_file'); assert.equal(s.detail, 'src/a.ts'); assert.equal(s.kind, 'file');
});

test('governed finished event: summary, ok, elapsed, bytes, diff pass through', () => {
  const diff = 'diff --git a/src/a.ts b/src/a.ts\n-x\n+y\n';
  const r = describeToolEvent({ name: 'edit_file', phase: 'finished', source: 'governed', ok: true, summary: 'Replaced 1 match in src/a.ts', bytes: 1229, elapsedMs: 420, diff });
  assert.equal(r.label, 'editing');
  assert.equal(r.detail, 'Replaced 1 match in src/a.ts');
  assert.equal(r.ok, true);
  assert.equal(r.elapsedLabel, '0.4s');
  assert.equal(r.elapsedMs, 420);
  assert.equal(r.bytesLabel, '1.2 KB');
  assert.equal(r.diff, diff);
  assert.equal(r.phase, 'finished');
});

test('denied governed call: ok false, error becomes the detail', () => {
  const r = describeToolEvent({ name: 'mcp__nibbi__web_fetch', phase: 'finished', source: 'governed', ok: false, error: 'Host evil.example is not in the project or vault web allowlist.', elapsedMs: 12 });
  assert.equal(r.ok, false);
  assert.equal(r.detail, 'Host evil.example is not in the project or vault web allowlist.');
  assert.equal(r.elapsedLabel, '0.0s');
  // error wins over summary on failure; summary wins on success
  assert.equal(describeToolEvent({ name: 'shell', phase: 'finished', source: 'governed', ok: false, summary: 'exit 1', error: 'command not found' }).detail, 'command not found');
  assert.equal(describeToolEvent({ name: 'shell', phase: 'finished', source: 'governed', ok: true, summary: 'exit 0', error: 'ignored' }).detail, 'exit 0');
  assert.equal(describeToolEvent({ name: 'shell', phase: 'finished', source: 'governed', ok: false }).detail, '');
});

test('native name-only event stays name-only', () => {
  const r = describeToolEvent({ name: 'Read', phase: 'started', source: 'native' });
  assert.deepEqual([r.label, r.name, r.detail, r.ok, r.elapsedLabel, r.phase, r.kind], ['reading', 'Read', '', null, '', 'started', 'native']);
  const skill = describeToolEvent({ name: 'Skill' });
  assert.equal(skill.phase, 'started'); assert.equal(skill.label, 'skill'); assert.equal(skill.source, 'native');
  const gh = describeToolEvent({ name: 'mcp__github__list_issues', source: 'native', phase: 'finished', ok: true });
  assert.equal(gh.label, 'on github'); assert.equal(gh.name, 'mcp__github__list_issues'); assert.equal(gh.kind, 'native');
});

test('external mcp event: using <server>, kind mcp', () => {
  const r = describeToolEvent({ name: 'ext_notion_search', phase: 'started', source: 'mcp', input: { query: 'roadmap milestones' } });
  assert.equal(r.label, 'using notion'); assert.equal(r.name, 'ext_notion_search'); assert.equal(r.kind, 'mcp'); assert.equal(r.detail, 'roadmap milestones');
  const prefixed = describeToolEvent({ name: 'mcp__nibbi__ext_notion_search', phase: 'finished', ok: true, summary: '3 pages', elapsedMs: 12_000 });
  assert.equal(prefixed.name, 'ext_notion_search'); assert.equal(prefixed.kind, 'mcp'); assert.equal(prefixed.elapsedLabel, '12s');
  assert.equal(describeToolEvent({ name: 'someserver_tool', source: 'mcp', phase: 'started' }).kind, 'mcp');
  // a raw mcp__<server>__ name under source mcp keeps toolLabel's own resolution instead of a double-prefixed mangle
  const rawMcp = describeToolEvent({ name: 'mcp__notion__search', source: 'mcp', phase: 'started' });
  assert.equal(rawMcp.label, 'using notion'); assert.equal(rawMcp.name, 'mcp__notion__search'); assert.equal(rawMcp.kind, 'mcp');
});

test('malformed events degrade, never throw or leak [object Object]', () => {
  // unknown source falls back to inference; native names keep their friendly label
  const weird = describeToolEvent({ name: 'Read', source: 'weird', phase: 'started' });
  assert.equal(weird.source, 'native'); assert.equal(weird.label, 'reading');
  assert.equal(describeToolEvent({ name: 'web_fetch', source: 42 }).source, 'governed');
  // object-shaped summary/error render their message, not their toString
  assert.equal(describeToolEvent({ name: 'shell', source: 'governed', phase: 'finished', ok: false, error: { message: 'boom' } }).detail, 'boom');
  assert.equal(describeToolEvent({ name: 'shell', source: 'governed', phase: 'finished', ok: true, summary: { a: 1 } }).detail, '');
  // non-object event / non-string name
  assert.deepEqual([describeToolEvent('tool.started').name, describeToolEvent(null).phase, describeToolEvent({ name: { x: 1 } }).name], ['', 'started', '']);
  assert.equal(toolKind('mcp__nibbi__web_fetch'), 'web');
  assert.equal(toolKind(undefined), 'native');
});

test('kind mapping', () => {
  const kinds = { web_search: 'web', web_fetch: 'web', ext_github_x: 'mcp', read_file: 'file', list_files: 'file', write_file: 'file', edit_file: 'file', dispatch_fixer: 'build', steer_fixer: 'build', list_fixers: 'build', read_activity: 'build', recent_chat: 'memory', search_chat: 'memory', read_roadmap: 'plan', shell: 'native', Read: 'native', read_progress: 'native' };
  for (const [name, kind] of Object.entries(kinds)) assert.equal(toolKind(name), kind, name);
  for (const [name, kind] of Object.entries(kinds)) assert.equal(describeToolEvent({ name, source: name[0] === name[0].toUpperCase() ? 'native' : 'governed' }).kind, kind, name);
});

test('redaction is the daemon\'s job: input passes through untouched', () => {
  const input = { url: 'https://api.example.com/v1?token=sk-live-123', authorization: 'Bearer sk-live-123' };
  const r = describeToolEvent({ name: 'web_fetch', phase: 'started', source: 'governed', input });
  assert.equal(r.input, input);
  assert.deepEqual(r.input, { url: 'https://api.example.com/v1?token=sk-live-123', authorization: 'Bearer sk-live-123' });
  assert.equal(r.detail, 'https://api.example.com/v1?token=sk-live-123');
  const secretOnly = describeToolEvent({ name: 'ext_x_y', phase: 'started', source: 'mcp', input: { apiKey: 'sk-live-123' } });
  assert.equal(secretOnly.detail, 'sk-live-123');
});

test('inputLine: key priority, first string fallback, JSON fallback, one line ≤120', () => {
  assert.equal(inputLine({ offset: 10, path: 'a/b.md', query: 'x' }), 'a/b.md');
  assert.equal(inputLine({ url: 'https://a.b', query: 'x' }), 'https://a.b');
  assert.equal(inputLine({ nonsense: 'first string', other: 'second' }), 'first string');
  assert.equal(inputLine({ limit: 5 }), '{"limit":5}');
  assert.equal(inputLine({}), '');
  assert.equal(inputLine(undefined), '');
  assert.equal(inputLine(null), '');
  assert.equal(inputLine('plain string'), 'plain string');
  assert.equal(inputLine({ command: 'npm test\n  && echo   done' }), 'npm test && echo done');
  const long = inputLine({ path: 'x'.repeat(300) });
  assert.equal(long.length, 120); assert.ok(long.endsWith('…'));
});

test('elapsed formatting boundaries', () => {
  assert.equal(elapsedLabel(undefined), '');
  assert.equal(elapsedLabel(null), '');
  assert.equal(elapsedLabel(NaN), '');
  assert.equal(elapsedLabel(-1), '');
  assert.equal(elapsedLabel(0), '0.0s');
  assert.equal(elapsedLabel(400), '0.4s');
  assert.equal(elapsedLabel(9_949), '9.9s');
  assert.equal(elapsedLabel(9_950), '10s');
  assert.equal(elapsedLabel(12_000), '12s');
  assert.equal(elapsedLabel(59_499), '59s');
  assert.equal(elapsedLabel(59_500), '1m 00s');
  assert.equal(elapsedLabel(60_000), '1m 00s');
  assert.equal(elapsedLabel(125_000), '2m 05s');
  assert.equal(elapsedLabel(3_600_000), '60m 00s');
  // started events never carry an elapsed label
  assert.equal(describeToolEvent({ name: 'Read', phase: 'started', elapsedMs: 5000 }).elapsedLabel, '');
  assert.equal(describeToolEvent({ name: 'Read', phase: 'started', elapsedMs: 5000 }).elapsedMs, null);
});

test('bytes formatting', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(842), '842 B');
  assert.equal(formatBytes(1023), '1023 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(12_698), '12.4 KB');
  assert.equal(formatBytes(1_258_291), '1.2 MB');
  assert.equal(formatBytes(2.5 * 1024 ** 3), '2.5 GB');
  // unit boundaries round up instead of printing 1024 B / 1024.0 KB
  assert.equal(formatBytes(1023.6), '1.0 KB');
  assert.equal(formatBytes(1_048_550), '1.0 MB');
  assert.equal(formatBytes(1_073_700_000), '1.0 GB');
  assert.equal(formatBytes(1023.4), '1023 B');
  assert.equal(formatBytes(-5), '');
  assert.equal(formatBytes(NaN), '');
  assert.equal(formatBytes(undefined), '');
  assert.equal(formatBytes('842'), '');
});

test('stepSummaryLine with and without failures', () => {
  const ev = (ok, elapsedMs) => describeToolEvent({ name: 'read_file', phase: 'finished', source: 'governed', ok, elapsedMs });
  const steps = [ev(true, 2000), ev(true, 3000), ev(true, 1000), ev(false, 4000), ev(true, 2500), ev(true, 1500)];
  assert.equal(stepSummaryLine(steps), '6 steps in 14s · 1 failed');
  assert.equal(stepSummaryLine(steps.map((s) => ({ ...s, ok: true }))), '6 steps in 14s');
  assert.equal(stepSummaryLine([ev(true, 400)]), '1 step in 0.4s');
  assert.equal(stepSummaryLine([ev(false, 400), ev(false, 600)]), '2 steps in 1.0s · 2 failed');
  // live (started) steps have no elapsed; still counted
  const started = describeToolEvent({ name: 'Read', phase: 'started', source: 'native' });
  assert.equal(stepSummaryLine([started, started]), '2 steps');
  assert.equal(stepSummaryLine([started, ev(true, 125_000)]), '2 steps in 2m 05s');
  // wall-clock override
  assert.equal(stepSummaryLine(steps, 20_000), '6 steps in 20s · 1 failed');
  assert.equal(stepSummaryLine([]), '');
  assert.equal(stepSummaryLine(undefined), '');
});

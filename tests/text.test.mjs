import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseActs, questionActs, humanError, toolLabel, stripMd, firstSentences, parseDiff, relTime, escapeHtml } from '../public/lib/text.js';

test('parseActs strips the »acts: line and yields up to 4 chips', () => {
  const r = parseActs('Done.\n»acts: dispatch 8.2 | show the diff | not now | a | b\nMore text.');
  assert.deepEqual(r.acts, ['dispatch 8.2', 'show the diff', 'not now', 'a']);
  assert.equal(r.clean, 'Done.\nMore text.');
  assert.deepEqual(parseActs('plain reply').acts, []);
});

test('questionActs: yes/no only for yes/no questions', () => {
  assert.deepEqual(questionActs("hey. what're we building?"), []);
  assert.deepEqual(questionActs('how are you? :)'), []);
  assert.deepEqual(questionActs('Which direction — A, B or C?'), []);
  assert.deepEqual(questionActs('Want me to launch it, or hold until M8 lands?'), []);
  assert.deepEqual(questionActs('Want me to dispatch 8.2?').map((a) => a.label), ['yes, dispatch 8.2', 'not now']);
  assert.deepEqual(questionActs('Next up is M8.2 (market slot cap). Want me to dispatch 8.2?').map((a) => a.text), ['yes, dispatch 8.2', 'not now']);
  assert.deepEqual(questionActs('Is it safe to merge this to main now?').map((a) => a.label), ['yes', 'no']);
  assert.deepEqual(questionActs('Done. Two files changed, checks green.'), []);
});

test('humanError maps gateway failures to nibbi lines and keeps the rest', () => {
  assert.match(humanError('error: Failed to authenticate: OAuth session expired'), /spilled the ink pot/);
  assert.match(humanError('gateway offline'), /gateway isn.t answering/);
  assert.match(humanError('HTTP 502'), /choked/);
  assert.match(humanError('rate limit exceeded'), /rate-limited/);
  assert.match(humanError('Something odd'), /lost the thread — something odd/);
});

test('toolLabel is human', () => {
  assert.equal(toolLabel('Read'), 'reading');
  assert.equal(toolLabel('mcp__github__list_issues'), 'on github');
  assert.equal(toolLabel('mcp__notion__search'), 'using notion');
  assert.equal(toolLabel('Frobnicate'), 'frobnicate');
});

test('stripMd / firstSentences', () => {
  assert.equal(stripMd('**bold** `code` [link](http://x) ![img](y)\n- item'), 'bold code link item');
  assert.equal(firstSentences('One. Two! Three?', 2, 100), 'One. Two!');
  assert.equal(firstSentences('A very long sentence indeed.', 2, 10).length <= 10, true);
});

test('parseDiff groups hunks per file with counts', () => {
  const d = 'diff --git a/x.js b/x.js\nindex 1..2 100644\n--- a/x.js\n+++ b/x.js\n@@ -1,2 +1,3 @@\n a\n+b\n-c\ndiff --git a/y.md b/y.md\n@@ -1 +1 @@\n-old\n+new\n+more';
  const f = parseDiff(d);
  assert.equal(f.length, 2); assert.equal(f[0].name, 'x.js'); assert.equal(f[0].add, 1); assert.equal(f[0].del, 1); assert.equal(f[1].add, 2); assert.equal(f[1].del, 1);
  assert.ok(!f[0].lines.some((l) => l.startsWith('index ') || l.startsWith('--- ')));
});

test('relTime and escapeHtml', () => {
  assert.equal(relTime(Date.now() - 5000), 'just now');
  assert.equal(relTime(Date.now() - 5 * 60000), '5 min ago');
  assert.equal(escapeHtml('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
});

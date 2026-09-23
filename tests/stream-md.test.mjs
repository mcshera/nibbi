import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanReply, splitBlocks } from '../public/lib/stream-md.js';

const settled = (text) => splitBlocks(text).slice(0, -1);
const tail = (text) => splitBlocks(text).at(-1);

test('cleanReply strips the protocol lines a reader never sees', () => {
  assert.equal(cleanReply('Found it.\n»voice: found it\nTwo files.'), 'Found it.\nTwo files.');
  assert.equal(cleanReply('Done.\n»acts: show the diff | not now'), 'Done.');
});

test('cleanReply hides a marker that is only half typed', () => {
  for (const partialMarker of ['»', '»v', '»voice', '»voice:', '»ac', '»acts: show the di']) {
    assert.equal(cleanReply('Done.\n' + partialMarker, { partial: true }), 'Done.', 'half-typed ' + partialMarker + ' must never paint');
  }
});

test('cleanReply keeps a half-typed marker once the reply is final', () => {
  assert.equal(cleanReply('Done.\n»ac'), 'Done.\n»ac');
});

test('cleanReply leaves prose that merely starts with a guillemet, once complete', () => {
  assert.equal(cleanReply('»quoted line\nmore'), '»quoted line\nmore');
});

test('cleanReply normalises line endings', () => {
  assert.equal(cleanReply('a\r\n\r\nb'), 'a\n\nb');
});

test('a blank line finishes the block before it', () => {
  assert.deepEqual(splitBlocks('one\n\ntwo\n\nthree'), ['one', 'two', 'three']);
});

test('nothing is finished until something follows it', () => {
  assert.deepEqual(settled('one'), []);
  assert.deepEqual(settled('one\n\n'), [], 'a trailing blank line could still be the start of a loose list');
});

test('a blank line inside an open fence is not a boundary', () => {
  const text = '```js\nconst a = 1;\n\nconst b = 2;\n';
  assert.deepEqual(settled(text), []);
  assert.equal(tail(text), text);
});

test('a closed fence is a block, and what follows it is the tail', () => {
  assert.deepEqual(splitBlocks('```\ncode\n```\n\ndone'), ['```\ncode\n```', 'done']);
});

test('a fence closes only on the same character, at least as long, with no info string', () => {
  assert.deepEqual(settled('```\na\n~~~\n\nb'), [], 'a tilde row does not close a backtick fence');
  assert.deepEqual(settled('````\na\n```\n\nb'), [], 'a shorter row does not close a longer fence');
  assert.deepEqual(settled('```\na\n``` js\n\nb'), [], 'a row with an info string is not a closing fence');
  assert.deepEqual(splitBlocks('~~~\na\n~~~\n\nb'), ['~~~\na\n~~~', 'b'], 'tilde fences close too');
});

test('an indented fence still opens and closes', () => {
  assert.deepEqual(splitBlocks('  ```\n  a\n  ```\n\nb'), ['  ```\n  a\n  ```', 'b']);
});

test('a loose list stays one block', () => {
  const text = '- one\n\n- two\n\n- three\n\ndone';
  assert.deepEqual(splitBlocks(text), ['- one\n\n- two\n\n- three', 'done']);
});

test('an indented continuation keeps its list item', () => {
  assert.deepEqual(settled('- one\n\n  still one\n\nafter'), ['- one\n\n  still one']);
});

test('a paragraph before a list is finished by it', () => {
  assert.deepEqual(settled('intro\n\n- one\n\n- two'), ['intro'], 'the paragraph is done; the list is still growing');
});

test('ordered lists count as lists', () => {
  assert.deepEqual(splitBlocks('1. one\n\n2. two\n\nafter'), ['1. one\n\n2. two', 'after']);
});

test('the tail is always the last element, and there is always one', () => {
  for (const text of ['', 'a', 'a\n\nb', '```\nopen']) {
    const blocks = splitBlocks(text);
    assert.ok(blocks.length >= 1);
    assert.equal(blocks.at(-1), tail(text));
  }
  assert.deepEqual(splitBlocks(''), ['']);
});

/* The guarantee the renderer is built on: a block that has been rendered and left alone is still
   correct when the rest of the reply arrives. If this fails, a finished block would have to be
   re-rendered and the whole scheme is unsound. */
test('what is finished stays finished, for every prefix of a reply', () => {
  const replies = [
    'Found it.\n\nTwo files touched, tests still green.\n\n- `session.ts` — the turn lock now clears on abort\n- `webapp.ts` — the stream sends a done even when the model bails\n\nWant me to stage it?',
    'Here:\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nThat is the whole change.',
    '# Heading\n\nA paragraph.\n\n1. one\n\n2. two\n\n> a quote\n\nlast',
    'no blank lines at all in this one',
    'A\n\n\n\nB\n\nC',
    'Counts:\n\n| file | lines |\n|---|---|\n| a.ts | 12 |\n| b.ts | 4 |\n\nThat is all.',
    '- outer\n\n  - nested\n\n  - also nested\n\n- back out\n\nafter the list',
    'Steps:\n\n1. first\n\n   ```sh\n   npm test\n   ```\n\n2. second\n\ndone',
    'Staged it.\n\n»voice: staged it\n»acts: show the diff | ship it',
  ];
  for (const reply of replies) {
    const full = settled(cleanReply(reply));
    for (let i = 1; i <= reply.length; i++) {
      const prefix = settled(cleanReply(reply.slice(0, i), { partial: true }));
      assert.ok(prefix.length <= full.length, 'a prefix cannot have more finished blocks than the whole reply: ' + JSON.stringify(reply.slice(0, i)));
      assert.deepEqual(prefix, full.slice(0, prefix.length), 'finished blocks diverged at ' + JSON.stringify(reply.slice(0, i)));
    }
  }
});

/* The demo's "show me the code" reply, the fixture the browser suites stream at three sizes. While
   its fence is open — blank line inside and all — the fence is one block: the tail. */
test('an open fence stays one block while it streams, and settles whole', () => {
  const reply = 'Here is the change.\n\n```ts\nexport function lock(): Lock {\n  return new TurnLock({ clearOnAbort: true });\n}\n\nexport default lock;\n```\n\n| file | change |\n|---|---|\n| `session.ts` | clears on abort |\n| `webapp.ts` | always sends done |\n\nTwo files.';
  const open = reply.indexOf('```ts'), close = reply.indexOf('\n```\n', open) + 4;
  for (let i = open + 3; i < close; i++) {
    const text = cleanReply(reply.slice(0, i), { partial: true });
    assert.deepEqual(settled(text), ['Here is the change.'], 'nothing inside the open fence is finished at ' + JSON.stringify(reply.slice(open, i)));
    assert.ok(tail(text).startsWith('```'), 'the whole open fence is the tail');
  }
  assert.deepEqual(splitBlocks(cleanReply(reply)), ['Here is the change.', reply.slice(open, close), '| file | change |\n|---|---|\n| `session.ts` | clears on abort |\n| `webapp.ts` | always sends done |', 'Two files.']);
});

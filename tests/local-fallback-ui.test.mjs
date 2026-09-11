import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localReplyMetadata, localReplyLabel, updateLocalReply, settleLocalReply, rateLimitNotice } from '../public/lib/local-fallback.js';
const fallback = { primaryProvider: 'claude', localModel: 'llama3.2:3b', reason: 'usage_limit', chatOnly: true, resetAtMs: 1788820200000 };
const result = { text: 'Hello.', local: true, localModel: 'llama3.2:3b', fallback, isError: false };
const makeTurn = () => ({ provenance: { hidden: true, textContent: '' } });
test('fallback labels before first token; repeated event/done is idempotent', () => {
  const turn = makeTurn();
  updateLocalReply(turn, fallback);
  assert.equal(turn.provenance.textContent, 'LOCAL · llama3.2:3b · chat only');
  assert.equal(turn.provenance.hidden, false);
  updateLocalReply(turn, fallback); updateLocalReply(turn, result);
  assert.equal(turn.provenance.textContent, 'LOCAL · llama3.2:3b · chat only');
  assert.deepEqual(localReplyMetadata(turn), localReplyMetadata(result));
});
test('terminal-only replay/nonstream and history have the same label', () => {
  for (const data of [result, { ...result, ts: '2026-09-07', role: 'assistant' }, { fallback }, { ...result, localModel: 'custom/raw:Q4' }]) {
    const turn = makeTurn(); updateLocalReply(turn, data);
    assert.equal(turn.provenance.textContent, localReplyLabel(data));
  }
  assert.equal(localReplyLabel({ ...result, localModel: 'custom/raw:Q4' }), 'LOCAL · custom/raw:Q4 · chat only');
});
test('reload preserves metadata without converting primary provider configuration', () => {
  const turn = makeTurn(); updateLocalReply(turn, result);
  const saved = JSON.parse(JSON.stringify({ acc: result.text, ...localReplyMetadata(turn) }));
  const restored = makeTurn(); updateLocalReply(restored, saved);
  assert.equal(restored.provenance.textContent, turn.provenance.textContent);
  assert.equal(saved.fallback.primaryProvider, 'claude');
  assert.equal('provider' in saved, false);
});
test('missing model is unknown, never default or ready; primary replies unlabelled', () => {
  assert.equal(localReplyLabel({ local: true }), 'LOCAL · model not reported · chat only');
  for (const data of [null, {}, { local: false }, { localModel: 'llama3.2:3b' }]) assert.equal(localReplyLabel(data), '');
  const turn = makeTurn(); updateLocalReply(turn, {}); assert.equal(turn.provenance.hidden, true);
});
test('failed/stopped partial local reply is discarded, silent, and remains labelled', () => {
  for (const failure of [{ isError: true }, { aborted: true, isError: false }]) {
    const failed = settleLocalReply({ text: 'partial unsupported claim', voice: 'speak this', ...failure }, result);
    assert.equal(failed.isError, true); assert.equal(failed.voice, undefined);
    assert.match(failed.text, /incomplete response was discarded/);
    assert.doesNotMatch(failed.text, /unsupported claim/);
    assert.equal(localReplyLabel(failed), 'LOCAL · llama3.2:3b · chat only');
    assert.deepEqual(settleLocalReply(failed, result), failed);
  }
  assert.equal(settleLocalReply(result, {} ).text, 'Hello.');
  const primary = { text: 'normal', isError: false }; assert.equal(settleLocalReply(primary, {}), primary);
});
test('rate notices distinguish allowed/warning/rejected and normalize time exactly once', () => {
  assert.equal(rateLimitNotice({ status: 'allowed' }), '');
  assert.match(rateLimitNotice({ status: 'allowed_warning' }), /still allowed/);
  for (const time of [{ resetAtMs: 1788820200000 }, { resetsAt: 1788820200000 }, { resetsAt: 1788820200 }]) {
    let actual; const text = rateLimitNotice({ status: 'rejected', ...time }, ms => { actual = ms; return '12:30'; });
    assert.equal(actual, 1788820200000); assert.match(text, /resets at 12:30/);
  }
  for (const resetsAt of [undefined, null, 0, -1, NaN, Infinity, '1788820200']) {
    assert.match(rateLimitNotice({ status: 'rejected', resetsAt }), /reset time is not available/);
  }
});
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
test('app wires label before said, fallback before delta, done-only JSON and history', () => {
  assert.match(app, /bubble.append\(provenance, steps, said\)/);
  assert.match(app, /provenance.style.opacity = '1'/);
  assert.ok(app.indexOf("e.ev === 'fallback'") < app.indexOf("e.ev === 'delta'", app.indexOf("e.ev === 'fallback'")));
  assert.match(app, /e.ev === 'done'\) \{ updateLocalReply\(T, e\)/);
  assert.match(app, /application\/json.*ev: 'done'/);
  assert.match(app, /updateLocalReply\(T, m\); setSaid\(T, m.text/);
  assert.match(app, /cost: T.cost \|\| 0, \.\.\.localReplyMetadata\(T\)/);
  assert.match(app, /setMeta\(T, \{ costUsd: r.cost, \.\.\.localReplyMetadata\(r\)/);
  assert.doesNotMatch(app, /trying anyway|resetsAt \|\| 0/);
});
test('app blocks local streaming voice, stops on failure, and offers no generated local action chips', () => {
  assert.match(app, /if \(!T.local\) streamSpeech\(T\)/);
  assert.match(app, /result = settleLocalReply\(result, T\)/);
  assert.match(app, /T.local && \(result.isError \|\| result.aborted\)\) \{ stopSpeaking\(\)/);
  assert.match(app, /e.name && !T.local/);
  assert.match(app, /!isCommand && !T.local && ok/);
  assert.match(app, /isCommand && ok && !T.local/);
});

test('bounded trusted terminal cause survives; partial or arbitrary error text never does', () => {
  const prefix = 'The primary provider is usage-limited. LOCAL chat only — ';
  for (const cause of ['context exceeds the input token budget.', 'model is unavailable.']) {
    const terminal = { ...result, ev: 'done', isError: true, text: prefix + cause };
    const settled = settleLocalReply(terminal, { ...result, acc: 'STREAMED PARTIAL CLAIM' });
    assert.match(settled.text, new RegExp(cause.replace(/[.]/g, '\\.')));
    assert.match(settled.text, /incomplete response was discarded/);
    assert.doesNotMatch(settled.text, /STREAMED PARTIAL CLAIM/);
    assert.deepEqual(settleLocalReply(settled, result), settled);
  }
  for (const failure of [
    { isError: true, text: prefix + 'untrusted exception' },
    { ev: 'done', isError: true, text: 'arbitrary raw diagnostics' },
  ]) assert.doesNotMatch(settleLocalReply(failure, result).text, /untrusted exception|raw diagnostics/);
  assert.ok(settleLocalReply({ ev: 'done', isError: true, text: prefix + 'x'.repeat(10000) }, result).text.length < 650);
  assert.match(settleLocalReply({ ev: 'done', isError: true, aborted: true, text: prefix + 'context issue' }, result).text, /^Local reply stopped/);
  assert.match(app, /T.local \? \[\{ label: 'try again', run: \(\) => send\(T.text\) \}\] : errorActs\(result.text\)/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { marginMetadata } from '../public/lib/margin-metadata.js';

const missing = { brain: 'Waking', session: 'Not available', context: 'Not available', model: 'Not available', provider: 'Not reported' };

test('missing and malformed data stay unknown, not zero or unconfigured', () => {
  for (const input of [undefined, null, false, 0, '', [], {}, { status: null }, { status: false }, { status: [] }]) {
    assert.deepEqual(marginMetadata(input), missing);
  }
  for (const value of [undefined, null, '', '0', '12', false, true, NaN, Infinity, -Infinity, -1, {}, []]) {
    const result = marginMetadata({ status: { ctxTokens: value, turns: value, costUsdTotal: value, sessionId: value, sessionShort: value, modelOverride: value }, sessionCost: value, sessionTurns: value });
    assert.equal(result.context, 'Not available');
    assert.equal(result.session, typeof value === 'string' && value ? value : 'Not available');
    assert.equal(result.model, typeof value === 'string' && value ? value + ' · Brain override' : 'Not available');
    assert.equal(result.provider, 'Not reported');
  }
});

test('explicit selected project model and provider win over global brain override', () => {
  const result = marginMetadata({ project: { name: 'selected', settings: { lead: { model: 'project-model', provider: 'codex' } } }, status: { modelOverride: 'opus' } });
  assert.equal(result.model, 'project-model');
  assert.equal(result.provider, 'codex');
  assert.equal(marginMetadata({ project: { settings: { lead: { model: 'project-model' } } }, status: { modelOverride: 'opus' } }).provider, 'Not reported');
});

test('configured project provider without a model uses provider default, not brain override', () => {
  for (const model of [undefined, null, '', '   ', 12, false, {}]) {
    const result = marginMetadata({ project: { settings: { lead: { provider: 'claude', model } } }, status: { modelOverride: 'opus' } });
    assert.equal(result.model, 'Provider default');
    assert.equal(result.provider, 'claude');
  }
});

test('omitted or invalid project lead exposes only labelled brain model provenance', () => {
  for (const project of [undefined, null, { name: 'game' }, { settings: {} }, { settings: { lead: null } }, { settings: { lead: {} } }, { settings: { lead: 'claude' } }, { settings: { lead: [] } }, { settings: { lead: { provider: false, model: 5 } } }]) {
    const result = marginMetadata({ project, status: { modelOverride: ' opus ' } });
    assert.equal(result.model, 'opus · Brain override');
    assert.equal(result.provider, 'Not reported');
  }
  assert.equal(marginMetadata({ status: { modelOverride: ' ' } }).model, 'Not available');
});

test('session short wins; sessionId fallback is a concise real prefix', () => {
  const sessionId = '12345678-abcd-4321-abcd-123456789abc';
  assert.equal(marginMetadata({ status: { sessionShort: ' current ', sessionId } }).session, 'current');
  for (const sessionShort of [undefined, null, '', ' ', false, 5]) {
    assert.equal(marginMetadata({ status: { sessionShort, sessionId } }).session, '12345678');
  }
  assert.equal(marginMetadata({ status: { sessionId: 'tiny' } }).session, 'tiny');
});

test('real busy, offline, demo and waking states keep their priority', () => {
  const cases = [
    [{}, 'Waking'], [{ busy: true }, 'Waking'], [{ status: {} }, 'Ready'],
    [{ status: {}, busy: true }, 'Working'], [{ status: { busy: true } }, 'Working'],
    [{ status: { busy: false } }, 'Ready'], [{ status: { busy: 'false' }, busy: 'false' }, 'Ready'],
    [{ status: { busy: true }, link: 'offline' }, 'Offline'], [{ link: 'offline' }, 'Offline'],
    [{ status: { busy: true }, link: 'offline', demo: true }, 'Demo · scripted replies'],
    [{ demo: true }, 'Demo · scripted replies'],
  ];
  for (const [input, expected] of cases) assert.equal(marginMetadata(input).brain, expected);
});

test('known sitting and lifetime data keep their scope and descriptors', () => {
  const result = marginMetadata({ status: { sessionShort: 'abc', ctxTokens: 12345, turns: 7, costUsdTotal: 9.75, rateLimit: { status: 'rejected' } }, sessionCost: 1.25, sessionTurns: 3 });
  assert.equal(result.session, 'abc · rate-limited · $1.25 known sitting cost / 3 turns');
  assert.equal(result.context, '12k tokens · 7 turns · $9.75 known lifetime cost');
});

test('explicit zero is valid, and partial metrics do not fabricate companions', () => {
  const zero = marginMetadata({ status: { ctxTokens: 0, turns: 0, costUsdTotal: 0 }, sessionCost: 0, sessionTurns: 0 });
  assert.equal(zero.context, '0 tokens · 0 turns · $0.00 known lifetime cost');
  assert.equal(zero.session, 'Not available · $0.00 known sitting cost / 0 turns');
  assert.equal(marginMetadata({ sessionTurns: 2 }).session, 'Not available · 2 sitting turns');
  assert.equal(marginMetadata({ sessionCost: 0 }).session, 'Not available · $0.00 known sitting cost');
  assert.equal(marginMetadata({ status: { turns: 0 } }).context, '0 turns');
  assert.equal(marginMetadata({ status: { ctxTokens: 1 } }).context, '1 tokens');
  assert.equal(marginMetadata({ status: { ctxTokens: 1.5, turns: 1.5 }, sessionTurns: 1.5 }).context, 'Not available');
  assert.equal(marginMetadata({ sessionTurns: 1.5 }).session, 'Not available');
});

test('absent or invalid rate limit does not claim rate-limited', () => {
  for (const rateLimit of [undefined, null, {}, [], false, { status: '' }, { status: 3 }, { status: 'allowed' }]) {
    assert.equal(marginMetadata({ status: { sessionShort: 'abc', rateLimit } }).session, 'abc');
  }
});

test('formatting is deterministic and does not mutate inputs', () => {
  const input = Object.freeze({ status: Object.freeze({ sessionId: 'actual-session-id', turns: 3 }), project: Object.freeze({ settings: Object.freeze({ lead: Object.freeze({ provider: 'codex', model: ' m ' }) }) }), sessionCost: 2 });
  const first = marginMetadata(input);
  assert.deepEqual(marginMetadata(input), first);
  assert.equal(input.project.settings.lead.model, ' m ');
  assert.deepEqual(Object.keys(first), ['brain', 'session', 'context', 'model', 'provider']);
  assert.ok(Object.values(first).every(value => typeof value === 'string'));
});

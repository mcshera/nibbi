import test from 'node:test';
import assert from 'node:assert/strict';
import {assessModelEvidence, summarizeReplyCounts} from '../tools/continuity-model-evidence.mjs';

const opus = {initModels: ['claude-opus-5[1m]'], assistantModels: ['claude-opus-5'], modelUsageKeys: ['claude-opus-5[1m]']};

test('retains exact init and response labels, including the context qualifier', () => {
  const result = assessModelEvidence(opus);
  assert.equal(result.responseModelEvidenceValid, true);
  assert.deepEqual(result.initModels, opus.initModels);
  assert.deepEqual(result.assistantModels, opus.assistantModels);
  assert.deepEqual(result.unattributedUsageModels, []);
  assert.equal(result.requiresUsageReview, false);
});

test('observed Opus response plus Haiku usage is retained without inventing its role', () => {
  const keys = ['claude-haiku-4-5-20251001', 'claude-opus-5[1m]'];
  const result = assessModelEvidence({...opus, modelUsageKeys: keys});
  assert.equal(result.responseModelEvidenceValid, true);
  assert.deepEqual(result.modelUsageKeys, keys);
  assert.deepEqual(result.unattributedUsageModels, ['claude-haiku-4-5-20251001']);
  assert.equal(result.requiresUsageReview, true);
  assert.equal(result.usageAttribution, 'not-established-by-usage-keys');
});

test('unknown accounting labels stay visible rather than silently disappearing', () => {
  const result = assessModelEvidence({...opus, modelUsageKeys: ['unknown-model']});
  assert.deepEqual(result.unattributedUsageModels, ['unknown-model']);
  assert.equal(result.requiresUsageReview, true);
});

test('Opus accounting cannot excuse an actual wrong init or assistant model', () => {
  for (const field of ['initModels', 'assistantModels']) {
    assert.throws(() => assessModelEvidence({...opus, [field]: ['claude-haiku-4-5-20251001']}), /Actual .* model mismatch/);
  }
  assert.throws(() => assessModelEvidence({...opus, assistantModels: ['claude-opus-5', 'other']}), /Actual assistant model mismatch/);
});

test('usage cannot replace missing primary model evidence', () => {
  for (const field of ['initModels', 'assistantModels']) {
    assert.throws(() => assessModelEvidence({...opus, [field]: []}), /Missing .* model evidence/);
  }
});

test('malformed and normalized-looking labels fail closed', () => {
  assert.throws(() => assessModelEvidence({...opus, assistantModels: [' claude-opus-5']}), /mismatch/);
  assert.throws(() => assessModelEvidence({...opus, initModels: [null]}), /missing model label/);
  for (const field of ['initModels', 'assistantModels']) {
    assert.throws(() => assessModelEvidence({...opus, [field]: ['claude-opus-5', undefined]}), /missing model label/);
  }
  assert.throws(() => assessModelEvidence({...opus, modelUsageKeys: 'claude-opus-5'}), /array of raw labels/);
});

test('missing usage does not invent zero usage or erase response evidence', () => {
  const result = assessModelEvidence({initModels: opus.initModels, assistantModels: opus.assistantModels});
  assert.equal(result.responseModelEvidenceValid, true);
  assert.deepEqual(result.modelUsageKeys, []);
  assert.equal(result.usageAttribution, 'not-established-by-usage-keys');
});

test('counts attempted, completed and fake replies separately after cancellation', () => {
  const reports = [{turns: [{terminalSubtype: 'success', isError: false, output: 'Completed.'}]}, {turns: [{startedAt: 'now'}]}];
  assert.deepEqual(summarizeReplyCounts(reports, false), {attemptedTurns: 2, completedReplies: 1, fakeReplies: 0, completedNativeReplies: 1, requiresUsageReview: false});
  const fake = summarizeReplyCounts(reports, true);
  assert.equal(fake.fakeReplies, 1);
  assert.equal(fake.completedNativeReplies, 0);
});

test('an error body is not a successful reply and extra usage stays reviewable', () => {
  const reports = [{turns: [{terminalSubtype: 'success', isError: true, output: 'error'}, {terminalSubtype: 'success', isError: false, output: 'ok', modelEvidence: {requiresUsageReview: true}}]}];
  const counts = summarizeReplyCounts(reports, false);
  assert.equal(counts.attemptedTurns, 2);
  assert.equal(counts.completedNativeReplies, 1);
  assert.equal(counts.requiresUsageReview, true);
});

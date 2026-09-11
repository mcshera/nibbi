import assert from 'node:assert/strict';

const RESPONSE_MODELS = new Set(['claude-opus-5', 'claude-opus-5[1m]']);

function rawLabels(value, source) {
  assert.ok(Array.isArray(value), `${source} must be an array of raw labels`);
  for (const label of value) {
    assert.ok(typeof label === 'string' && label.length > 0, `${source} contains a missing model label`);
  }
  return [...new Set(value)];
}

// A result's modelUsage map accounts for the whole query. It does not attribute
// each usage entry to the response. Keep that evidence separate and visible.
export function assessModelEvidence({initModels = [], assistantModels = [], modelUsageKeys = []}) {
  const init = rawLabels(initModels, 'initModels');
  const assistant = rawLabels(assistantModels, 'assistantModels');
  const usage = rawLabels(modelUsageKeys, 'modelUsageKeys');
  assert.ok(init.length > 0, 'Missing init model evidence');
  assert.ok(assistant.length > 0, 'Missing assistant model evidence');
  for (const [source, labels] of [['init', init], ['assistant', assistant]]) {
    for (const label of labels) {
      assert.ok(RESPONSE_MODELS.has(label), `Actual ${source} model mismatch consumes turn; no rerun: ${label}`);
    }
  }
  const unattributedUsageModels = usage.filter(label => !RESPONSE_MODELS.has(label));
  return {
    responseModelEvidenceValid: true,
    initModels: init,
    assistantModels: assistant,
    modelUsageKeys: usage,
    unattributedUsageModels,
    requiresUsageReview: unattributedUsageModels.length > 0,
    usageAttribution: 'not-established-by-usage-keys',
  };
}

// Attempt records are created before a provider can answer. Count completion
// separately; a failed model check must not turn a real reply into a fake one.
export function summarizeReplyCounts(reports, fake) {
  const turns = reports.flatMap(report => report.turns ?? []);
  const completed = turns.filter(turn => turn.terminalSubtype === 'success' &&
    turn.isError === false && typeof turn.output === 'string' && turn.output.length > 0).length;
  return {
    attemptedTurns: turns.length,
    completedReplies: completed,
    fakeReplies: fake ? completed : 0,
    completedNativeReplies: fake ? 0 : completed,
    requiresUsageReview: turns.some(turn => turn.modelEvidence?.requiresUsageReview === true),
  };
}

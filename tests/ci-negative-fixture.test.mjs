// Deliberate CI rejection fixture. Never merge this branch.
import test from 'node:test';
import assert from 'node:assert/strict';
test('CI rejects a deliberately failing fixture', () => assert.equal(true, false));

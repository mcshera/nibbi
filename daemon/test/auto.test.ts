import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AutoCfg } from '../src/fixer.js';

const directory = mkdtempSync(join(tmpdir(), 'nibbi-auto-'));
process.env.NODE_ENV = 'test';
process.env.NIBBI_STATE_DIR = join(directory, 'state');
process.env.NIBBI_VAULT_DIR = join(directory, 'vault');
process.env.NIBBI_WORK_DIR = join(directory, 'work');
process.env.NIBBI_PROJECTS_DIR = join(directory, 'projects');
const { autoConfig, noteAuto, setAuto } = await import('../src/fixer.js');
const { runtime, closeRuntime } = await import('../src/store.js');
runtime().put('config', 'projects', {
  example: { repo: join(directory, 'projects', 'example'), install: 'true', check: 'npm test' },
  unverified: { repo: join(directory, 'projects', 'unverified'), install: 'true', check: 'true' },
});
after(() => { closeRuntime(); rmSync(directory, { recursive: true, force: true }); });

test('recording a scheduler suggestion preserves suggestion-only authority', () => {
  setAuto('example', { mode: 'suggest' });
  const cursor = runtime().cursor();
  noteAuto('example', 'Consider the next independent roadmap task.');
  const saved = autoConfig().example;
  assert.equal(saved.mode, 'suggest');
  assert.equal(saved.on, true);
  assert.equal(saved.autoMerge, false);
  assert.equal(saved.note, 'Consider the next independent roadmap task.');
  assert.ok(saved.at);
  const event = runtime().replay(cursor).find(event => event.type === 'auto.updated');
  assert.equal((event?.payload.config as AutoCfg).mode, 'suggest');
});

test('unrelated configuration updates preserve every explicitly selected mode', () => {
  const updates: Partial<AutoCfg>[] = [
    {}, { note: 'Status update', at: new Date().toISOString() }, { focus: 'M1' },
    { maxConcurrent: 3 }, { spendCap: 5 }, { model: 'configured-model' },
  ];
  for (const mode of ['off', 'suggest', 'stage', 'ship'] as const) {
    setAuto('example', { mode });
    for (const update of updates) {
      const next = setAuto('example', update);
      assert.equal(next.mode, mode, `${mode} changed after ${JSON.stringify(update)}`);
      assert.equal(next.on, mode !== 'off');
      assert.equal(next.autoMerge, mode === 'ship');
    }
  }
});

test('explicit legacy switches still change modes and explicit mode takes precedence', () => {
  setAuto('example', { mode: 'off' });
  assert.equal(setAuto('example', { on: true }).mode, 'stage');
  assert.equal(setAuto('example', { autoMerge: true }).mode, 'ship');
  assert.equal(setAuto('example', { autoMerge: false }).mode, 'stage');
  assert.equal(setAuto('example', { on: false }).mode, 'off');
  assert.equal(setAuto('example', { on: true, autoMerge: true }).mode, 'ship');
  const explicit = setAuto('example', { mode: 'suggest', on: false, autoMerge: true });
  assert.equal(explicit.mode, 'suggest');
  assert.equal(explicit.on, true);
  assert.equal(explicit.autoMerge, false);
});

test('legacy ship requests still require a real verification command', () => {
  setAuto('unverified', { mode: 'suggest' });
  assert.throws(() => setAuto('unverified', { autoMerge: true }), /verification/);
  assert.equal(autoConfig().unverified.mode, 'suggest');
});

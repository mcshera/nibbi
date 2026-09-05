import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RuntimeStore, RevisionConflict } from '../src/store.js';

test('state transitions and replay survive a restart; stale updates emit no event', t => {
  const box = mkdtempSync(join(tmpdir(), 'nibbi-store-'));
  let store = new RuntimeStore(box);
  t.after(() => { store.close(); rmSync(box, { recursive: true, force: true }); });
  store.put('runs', 'r1', { status: 'running' }, { type: 'run', runId: 'r1', payload: { status: 'running' } }, 0);
  assert.throws(() => store.put('runs', 'r1', { status: 'failed' }, { type: 'run', payload: {} }, 0), RevisionConflict);
  const cursor = store.cursor();
  store.close(); store = new RuntimeStore(box);
  assert.deepEqual(store.get('runs', 'r1'), { status: 'running' });
  assert.equal(store.replay().length, 1);
  assert.deepEqual(store.replay(cursor), []);
  assert.equal(store.claimCommand('key', { x: 1 }).state, 'new');
  assert.equal(store.claimCommand('key', { x: 1 }).state, 'running');
  assert.throws(() => store.claimCommand('key', { x: 2 }));
  store.finishCommand('key', { ok: true });
  assert.deepEqual(store.claimCommand('key', { x: 1 }).result, { ok: true });
});

test('legacy migration is backed up, idempotent, and never invents verification', t => {
  const box = mkdtempSync(join(tmpdir(), 'nibbi-migrate-'));
  writeFileSync(join(box, 'fixers.json'), JSON.stringify([{ id: 'fx1', game: 'demo', status: 'done', worktree: '/preserve/me' }]));
  const store = new RuntimeStore(box);
  t.after(() => { store.close(); rmSync(box, { recursive: true, force: true }); });
  store.migrateLegacy(); store.migrateLegacy();
  assert.equal(store.list('fixers').length, 1);
  assert.equal((store.get<any>('fixers', 'fx1')).verification.status, 'unverified');
  assert.equal(existsSync(join(store.get<any>('system', 'legacy-import').backup, 'fixers.json')), true);
  assert.equal(existsSync(join(box, 'fixers.json')), true);
});

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { githubFixture } from './helpers/github-fixture.js';

const fixture = await githubFixture();
const { git, project, bare, folder, runtime, state, engine } = fixture;
const fixer = await import('../src/fixer.js');
const { attemptsFor } = await import('../src/build-attempt-records.js');
const local = await import('../src/build-attempts.js');
const { updateProject } = await import('../src/projects.js');
const { replaceProviderForTest } = await import('../src/providers/index.js');
const { closeToolService } = await import('../src/tool-service.js');
const restore = replaceProviderForTest('claude', { id: 'claude', capabilities: { streaming: true, steering: true, cancellation: true, skills: true, tools: true, images: true }, start: input => ({
  result: Promise.resolve().then(() => { writeFileSync(join(input.cwd, 'feature.txt'), 'Feature for ' + input.runId); return { text: 'A scoped fixture change', isError: false }; }),
  cancel: async () => undefined, steer: async () => undefined,
}) });
after(async () => { restore(); await closeToolService(); await fixture.cleanup(); });
const notify = async (): Promise<void> => undefined;
let first: import('../src/fixer.js').Fixer, second: import('../src/fixer.js').Fixer, advancing = 0;
async function advanceRemote(): Promise<string> {
  const worktree = join(folder, 'remote-' + ++advancing);
  await git(project.repo, 'fetch', bare, 'refs/heads/main');
  await git(project.repo, 'worktree', 'add', '--detach', worktree, 'FETCH_HEAD');
  writeFileSync(join(worktree, 'remote-' + advancing + '.txt'), 'Remote change ' + advancing);
  await git(worktree, 'add', '-A'); await git(worktree, 'commit', '-m', 'Remote integration advance');
  await git(worktree, 'push', bare, 'HEAD:refs/heads/main'); return git(worktree, 'rev-parse', 'HEAD');
}

test('concurrent GitHub Builds use the fresh remote baseline with unique branches despite stale, dirty, switched owner checkout', async () => {
  const original = await git(project.repo, 'rev-parse', 'HEAD'), remote = await advanceRemote();
  await git(project.repo, 'checkout', '-b', 'owner-work'); writeFileSync(join(project.repo, 'private.txt'), 'Keep owner changes');
  const status = await git(project.repo, 'status', '--porcelain');
  first = fixer.spawnFixer('fixture', 'First independent feature', notify);
  second = fixer.spawnFixer('fixture', 'Second independent feature', notify);
  await Promise.all([fixer.waitForFixer(first.id), fixer.waitForFixer(second.id)]);
  first = runtime().get('fixers', first.id)!; second = runtime().get('fixers', second.id)!;
  assert.notEqual(first.branch, second.branch); assert.notEqual(first.worktree, second.worktree); assert.notEqual(first.attemptId, second.attemptId);
  for (const build of [first, second]) {
    assert.equal(build.status, 'staged', build.summary ?? ''); assert.equal(build.baseSha, remote); assert.equal(build.targetBranch, 'main');
    assert.equal(engine.bindingFor(build.id)?.baseSha, remote); assert.equal(existsSync(join(build.worktree, 'private.txt')), false);
    assert.equal(readFileSync(join(build.worktree, 'remote-1.txt'), 'utf8'), 'Remote change 1');
  }
  assert.equal(await git(project.repo, 'rev-parse', 'HEAD'), original); assert.equal(await git(project.repo, 'symbolic-ref', '--short', 'HEAD'), 'owner-work'); assert.equal(await git(project.repo, 'status', '--porcelain'), status);
});

test('updating from base adds a verified merge attempt without replacing the branch or older evidence', async () => {
  const before = attemptsFor(first.id), remote = await advanceRemote();
  const review = await local.prepareLocalBuildOperation('build.updateBase', 'fixture', { buildId: first.id }); assert.equal(review.baseSha, remote);
  const updated = await local.executeLocalBuildOperation('build.updateBase', 'fixture', review);
  assert.equal(updated.id, first.id); assert.equal(updated.branch, first.branch); assert.equal(updated.verification?.status, 'passed');
  assert.deepEqual(attemptsFor(first.id).slice(0, before.length), before);
  assert.equal(attemptsFor(first.id).at(-1)?.baseSha, remote); assert.equal(attemptsFor(first.id).at(-1)?.inputHead, first.commitSha);
  assert.equal((await git(updated.worktree, 'rev-list', '--parents', '-n', '1', 'HEAD')).split(' ').length, 3);
  first = updated;
});

test('failed base-update checks keep the verified head; explicit full checkpoint preserves the merge parent', async () => {
  const remote = await advanceRemote(); updateProject('fixture', { check: 'exit 17' });
  const review = await local.prepareLocalBuildOperation('build.updateBase', 'fixture', { buildId: first.id });
  await assert.rejects(local.executeLocalBuildOperation('build.updateBase', 'fixture', review), /17/);
  let saved = runtime().get<import('../src/fixer.js').Fixer>('fixers', first.id)!;
  assert.equal(saved.status, 'failed'); assert.equal(saved.commitSha, first.commitSha); assert.equal(saved.lastVerifiedSha, first.commitSha);
  assert.equal(await git(saved.worktree, 'rev-parse', 'HEAD'), first.commitSha); assert.equal(await git(saved.worktree, 'rev-parse', 'MERGE_HEAD'), remote);
  const view = await local.localChangesView('fixture', { buildId: first.id });
  const checkpoint = await local.prepareLocalBuildOperation('build.checkpoint', 'fixture', { buildId: first.id, sourceRevision: view.sourceRevision, selection: view.files.map(f => ({ path: f.path })), title: 'Retain resolved merge as unverified' });
  saved = await local.executeLocalBuildOperation('build.checkpoint', 'fixture', checkpoint);
  assert.equal(saved.verification?.status, 'unverified'); assert.equal((await git(saved.worktree, 'rev-list', '--parents', '-n', '1', 'HEAD')).split(' ').length, 3);
  updateProject('fixture', { check: 'test -f README.md' }); await fixer.verifyRetained(first.id);
  assert.equal(runtime().get<import('../src/fixer.js').Fixer>('fixers', first.id)?.verification?.status, 'passed');
});

test('unavailable fresh remote identity waits instead of silently starting from a stale owner branch', async () => {
  state.account = 'other-account';
  const waiting = fixer.spawnFixer('fixture', 'Wait for the expected account', notify); await fixer.waitForFixer(waiting.id);
  const saved = runtime().get<import('../src/fixer.js').Fixer>('fixers', waiting.id)!;
  assert.equal(saved.status, 'queued'); assert.match(saved.summary!, /Waiting for a fresh GitHub base/); assert.equal(existsSync(saved.worktree), false);
  assert.equal(saved.baseSha, undefined); assert.ok(saved.nextRetryAt! > Date.now()); fixer.stopFixer(waiting.id); state.account = 'owner';
});

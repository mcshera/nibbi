import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, renameSync, chmodSync, statSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const folder = mkdtempSync(join(tmpdir(), 'nibbi-build-attempts-'));
process.env.NODE_ENV = 'test';
process.env.NIBBI_STATE_DIR = join(folder, 'state'); process.env.NIBBI_VAULT_DIR = join(folder, 'vault');
process.env.NIBBI_WORK_DIR = join(folder, 'work'); process.env.NIBBI_PROJECTS_DIR = join(folder, 'projects');
mkdirSync(process.env.NIBBI_VAULT_DIR, { recursive: true });
const { git } = await import('../src/processes.js');
const { createProject, updateProject } = await import('../src/projects.js');
const fixer = await import('../src/fixer.js');
const local = await import('../src/build-attempts.js');
const { attemptsFor } = await import('../src/build-attempt-records.js');
const { replaceProviderForTest } = await import('../src/providers/index.js');
const { runtime, closeRuntime } = await import('../src/store.js');
const { closeToolService } = await import('../src/tool-service.js');
after(async () => { await closeToolService(); closeRuntime(); rmSync(folder, { recursive: true, force: true }); });
const notify = async (): Promise<void> => undefined;
function fake(change: (cwd: string) => void, failure = false) {
  return replaceProviderForTest('claude', { id: 'claude', capabilities: { streaming: true, steering: true, cancellation: true, skills: true, tools: true, images: true }, start: input => ({
    result: Promise.resolve().then(() => { change(input.cwd); input.onEvent('fixture', { text: 'Attempt output' }); return { text: 'Fixture update', isError: failure, costUsd: 0.02 }; }),
    cancel: async () => undefined, steer: async () => undefined,
  }) });
}
async function adopt(project: string, selection?: Array<{ path: string; hunkIds?: string[] }>) {
  const view = await local.localChangesView(project);
  const review = await local.prepareLocalBuildOperation('build.adoptChanges', project, { sourceRevision: view.sourceRevision, selection: selection ?? view.files.map(f => ({ path: f.path })), title: 'Adopt reviewed changes' });
  return local.executeLocalBuildOperation('build.adoptChanges', project, review);
}

test('adoption copies selected binary, rename, deletion, untracked and mode changes without touching owner files or index', async () => {
  const project = await createProject('adopt-files');
  writeFileSync(join(project.repo, 'rename.txt'), 'rename me\n'); writeFileSync(join(project.repo, 'delete.txt'), 'delete me\n'); writeFileSync(join(project.repo, 'script.sh'), '#!/bin/sh\nexit 0\n');
  await git(project.repo, 'add', '-A'); await git(project.repo, 'commit', '-m', 'Fixture baseline');
  renameSync(join(project.repo, 'rename.txt'), join(project.repo, 'renamed.txt')); rmSync(join(project.repo, 'delete.txt')); chmodSync(join(project.repo, 'script.sh'), 0o755);
  writeFileSync(join(project.repo, 'image.bin'), Buffer.from([0, 255, 7, 128])); writeFileSync(join(project.repo, 'keep.txt'), 'unselected owner edit');
  const beforeStatus = await git(project.repo, 'status', '--porcelain'), beforeIndex = await git(project.repo, 'write-tree'), head = await git(project.repo, 'rev-parse', 'HEAD');
  const view = await local.localChangesView('adopt-files');
  assert.ok(view.files.find(f => f.path === 'image.bin')?.binary);
  const build = await adopt('adopt-files', view.files.filter(f => f.path !== 'keep.txt').map(f => ({ path: f.path })));
  assert.equal(build.status, 'staged'); assert.equal(build.verification?.status, 'unverified');
  assert.deepEqual(readFileSync(join(build.worktree, 'image.bin')), Buffer.from([0, 255, 7, 128]));
  assert.equal(readFileSync(join(build.worktree, 'renamed.txt'), 'utf8'), 'rename me\n');
  assert.equal(existsSync(join(build.worktree, 'rename.txt')), false); assert.equal(existsSync(join(build.worktree, 'delete.txt')), false);
  assert.ok(statSync(join(build.worktree, 'script.sh')).mode & 0o111); assert.equal(existsSync(join(build.worktree, 'keep.txt')), false);
  assert.equal(await git(project.repo, 'status', '--porcelain'), beforeStatus); assert.equal(await git(project.repo, 'write-tree'), beforeIndex); assert.equal(await git(project.repo, 'rev-parse', 'HEAD'), head);
});

test('hunk adoption selects only the reviewed hunk and rejects stale file contents', async () => {
  const project = await createProject('adopt-hunk');
  const lines = Array.from({ length: 40 }, (_, i) => 'original line ' + i);
  writeFileSync(join(project.repo, 'text.txt'), lines.join('\n') + '\n'); await git(project.repo, 'add', '-A'); await git(project.repo, 'commit', '-m', 'Fixture text');
  const edited = [...lines]; edited[2] = 'first change'; edited[35] = 'second change'; writeFileSync(join(project.repo, 'text.txt'), edited.join('\n') + '\n');
  const view = await local.localChangesView('adopt-hunk'), file = view.files.find(f => f.path === 'text.txt')!; assert.equal(file.hunks.length, 2);
  const args = { sourceRevision: view.sourceRevision, selection: [{ path: file.path, hunkIds: [file.hunks[0].id] }], title: 'First hunk' };
  const review = await local.prepareLocalBuildOperation('build.adoptChanges', 'adopt-hunk', args);
  const build = await local.executeLocalBuildOperation('build.adoptChanges', 'adopt-hunk', review);
  assert.match(readFileSync(join(build.worktree, 'text.txt'), 'utf8'), /first change/); assert.doesNotMatch(readFileSync(join(build.worktree, 'text.txt'), 'utf8'), /second change/);
  writeFileSync(join(project.repo, 'text.txt'), 'concurrent owner work');
  await assert.rejects(local.executeLocalBuildOperation('build.adoptChanges', 'adopt-hunk', review), /changed/);
  assert.equal(readFileSync(join(project.repo, 'text.txt'), 'utf8'), 'concurrent owner work');
});

test('updates keep Build and branch identity, preserve immutable attempts and last verified candidate on failure', async () => {
  await createProject('update-build'); updateProject('update-build', { check: 'test -f feature.txt' });
  let restore = fake(cwd => writeFileSync(join(cwd, 'feature.txt'), 'version one'));
  let build: import('../src/fixer.js').Fixer;
  try { build = fixer.spawnFixer('update-build', 'First version', notify); await fixer.waitForFixer(build.id); } finally { restore(); }
  const first = runtime().get<import('../src/fixer.js').Fixer>('fixers', build!.id)!, firstAttempt = attemptsFor(first.id)[0];
  assert.equal(first.verification?.status, 'passed');
  restore = fake(cwd => writeFileSync(join(cwd, 'feature.txt'), 'version two'));
  try {
    await fixer.updateFixer(first.id, 'Improve this version', notify, first.commitSha!); await fixer.waitForFixer(first.id);
  } finally { restore(); }
  const second = runtime().get<import('../src/fixer.js').Fixer>('fixers', first.id)!;
  assert.equal(second.branch, first.branch); assert.equal(second.worktree, first.worktree); assert.notEqual(second.commitSha, first.commitSha); assert.notEqual(second.attemptId, first.attemptId);
  assert.deepEqual(attemptsFor(first.id)[0], firstAttempt); assert.equal(attemptsFor(first.id).length, 2); assert.equal(second.costUsd, 0.04);
  restore = fake(cwd => writeFileSync(join(cwd, 'feature.txt'), 'failed retained edits'), true);
  try { await fixer.updateFixer(first.id, 'Attempt that fails', notify, second.commitSha!); await fixer.waitForFixer(first.id); } finally { restore(); }
  const failed = runtime().get<import('../src/fixer.js').Fixer>('fixers', first.id)!;
  assert.equal(failed.status, 'failed'); assert.equal(failed.commitSha, second.commitSha); assert.equal(failed.lastVerifiedSha, second.commitSha); assert.equal(attemptsFor(first.id).length, 3);
  assert.equal(await git(first.worktree, 'rev-parse', 'HEAD'), second.commitSha);
  await assert.rejects(fixer.updateFixer(first.id, 'Do not silently discard failed work', notify, second.commitSha!), /checkpoint/);
  const events = runtime().db.prepare("SELECT payload FROM events WHERE run_id=? AND type='fixture'").all(first.id) as Array<{ payload: string }>;
  assert.equal(new Set(events.map(e => JSON.parse(e.payload).attemptId)).size, 3);
});

test('checkpoint commits only selected failed-attempt edits and keeps unselected working files', async () => {
  const project = await createProject('checkpoint'); writeFileSync(join(project.repo, 'feature.txt'), 'initial');
  const build = await adopt('checkpoint');
  writeFileSync(join(build.worktree, 'feature.txt'), 'checkpoint this'); writeFileSync(join(build.worktree, 'keep.txt'), 'retain this edit');
  const view = await local.localChangesView('checkpoint', { buildId: build.id });
  const review = await local.prepareLocalBuildOperation('build.checkpoint', 'checkpoint', { buildId: build.id, sourceRevision: view.sourceRevision, selection: [{ path: 'feature.txt' }], title: 'Unverified checkpoint' });
  const changed = await local.executeLocalBuildOperation('build.checkpoint', 'checkpoint', review);
  assert.equal(changed.id, build.id); assert.equal(changed.branch, build.branch); assert.equal(changed.verification?.status, 'unverified');
  assert.equal(await git(changed.worktree, 'show', 'HEAD:feature.txt'), 'checkpoint this');
  await assert.rejects(git(changed.worktree, 'show', 'HEAD:keep.txt'));
  assert.equal(readFileSync(join(changed.worktree, 'keep.txt'), 'utf8'), 'retain this edit');
  assert.equal(readFileSync(join(project.repo, 'feature.txt'), 'utf8'), 'initial'); assert.equal(attemptsFor(build.id).length, 2);
});

test('replacement never inherits a prior candidate, verification, attempt, publication or execution kind', async () => {
  const project = await createProject('replacement'); writeFileSync(join(project.repo, 'feature.txt'), 'version one');
  const build = await adopt('replacement'); fixer.discardFixer(build.id);
  const old = runtime().get<import('../src/fixer.js').Fixer>('fixers', build.id)!;
  runtime().put('fixers', old.id, { ...old, remoteMerge: { sha: 'legacy', pr: 1, url: 'https://example.test/1', at: 'old' }, sessionId: 'old', mergeIntent: { candidate: 'old', targetSha: 'old', integration: 'old' } });
  fixer.requeueFix(build.id);
  const next = fixer.listFixers().find(f => f.replacesBuildId === build.id)!;
  assert.ok(next); assert.notEqual(next.branch, old.branch); assert.notEqual(next.attemptId, old.attemptId); assert.equal(next.commitSha, undefined); assert.equal(next.remoteMerge, undefined); assert.equal(next.mergeIntent, undefined); assert.equal(next.sessionId, undefined); assert.equal(next.executionKind, 'provider'); assert.equal(next.verification?.status, 'unverified');
});

test('verification adds its own immutable attempt instead of overwriting the adopted evidence', async () => {
  const project = await createProject('verify-attempt'); writeFileSync(join(project.repo, 'feature.txt'), 'version one');
  const build = await adopt('verify-attempt'), first = attemptsFor(build.id)[0]; updateProject('verify-attempt', { check: 'test -f feature.txt' });
  await fixer.verifyRetained(build.id); const attempts = attemptsFor(build.id);
  assert.equal(attempts.length, 2); assert.deepEqual(attempts[0], first); assert.equal(attempts[1].kind, 'verify'); assert.equal(attempts[1].verification?.status, 'passed'); assert.equal(attempts[1].candidateSha, build.commitSha);
});

test('all local integration entry points reject a GitHub-mode Build even without a live connection', async () => {
  const project = await createProject('no-bypass'); writeFileSync(join(project.repo, 'feature.txt'), 'version one');
  const build = await adopt('no-bypass'); updateProject('no-bypass', { check: 'test -f feature.txt' }); await fixer.verifyRetained(build.id);
  const current = runtime().get<import('../src/fixer.js').Fixer>('fixers', build.id)!; current.workflowMode = 'github'; runtime().put('fixers', current.id, current);
  assert.equal(fixer.allowedRunActions(current).includes('run.merge'), false);
  assert.equal((await fixer.integrate(current)).ok, false); await assert.rejects(fixer.approveFixer(current.id), /GitHub/);
  assert.equal(await git(project.repo, 'rev-parse', 'HEAD'), build.baseSha);
});

test('a Build admits one writer while an update is running', async () => {
  const project = await createProject('one-writer'); writeFileSync(join(project.repo, 'feature.txt'), 'first');
  const build = await adopt('one-writer');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const restore = replaceProviderForTest('claude', { id: 'claude', capabilities: { streaming: true, steering: true, cancellation: true, skills: true, tools: true, images: true }, start: input => ({
    result: gate.then(() => { writeFileSync(join(input.cwd, 'feature.txt'), 'second'); return { text: 'Updated', isError: false }; }),
    cancel: async () => { release(); }, steer: async () => undefined,
  }) });
  try {
    await fixer.updateFixer(build.id, 'Update once', notify, build.commitSha!);
    await assert.rejects(fixer.updateFixer(build.id, 'Competing update', notify, build.commitSha!), /cannot be updated/);
    await assert.rejects(local.localChangesView('one-writer', { buildId: build.id }), /active/);
    await assert.rejects(fixer.runBuildAttempt(build.id, 'checkpoint', async () => undefined), /active writer/);
    release(); await fixer.waitForFixer(build.id);
    assert.equal(attemptsFor(build.id).length, 2);
  } finally { release(); restore(); }
});

test('a prepared adoption cannot follow a changed integration target or race a delivery lease', async () => {
  const project = await createProject('pinned-adoption'); writeFileSync(join(project.repo, 'feature.txt'), 'selected');
  const view = await local.localChangesView('pinned-adoption');
  const review = await local.prepareLocalBuildOperation('build.adoptChanges', 'pinned-adoption', { sourceRevision: view.sourceRevision, selection: [{ path: 'feature.txt' }], title: 'Pinned' });
  await git(project.repo, 'branch', 'other'); updateProject('pinned-adoption', { targetBranch: 'other' });
  await assert.rejects(local.executeLocalBuildOperation('build.adoptChanges', 'pinned-adoption', review), /target changed/);
  updateProject('pinned-adoption', { targetBranch: 'main' }); const build = await local.executeLocalBuildOperation('build.adoptChanges', 'pinned-adoption', review);
  const release = fixer.acquireBuildDeliveryLease(build.id);
  try {
    await assert.rejects(fixer.updateFixer(build.id, 'Competing update', notify, build.commitSha!), /cannot be updated/);
    assert.throws(() => fixer.discardFixer(build.id), /cannot be discarded/);
    assert.throws(() => fixer.acquireBuildDeliveryLease(build.id), /active/);
  } finally { release(); }
  assert.equal(fixer.buildIsActive(build.id), false);
});

test('older attempt logs remain available after newer attempts exceed the default log window', async () => {
  const { runEvents } = await import('../src/read-models.js');
  runtime().emit({ runId: 'log-build', projectId: 'fixture', type: 'process.output', payload: { attemptId: 'old-attempt', text: 'Original verification evidence' } });
  for (let i = 0; i < 260; i++) runtime().emit({ runId: 'log-build', projectId: 'fixture', type: 'process.output', payload: { attemptId: 'new-attempt', text: 'New output ' + i } });
  assert.equal(runEvents('log-build').length, 250);
  assert.deepEqual(runEvents('log-build', 'old-attempt').map(e => e.text), ['Original verification evidence']);
});

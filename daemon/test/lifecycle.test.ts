import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const directory = mkdtempSync(join(tmpdir(), 'nibbi-lifecycle-'));
process.env.NODE_ENV = 'test';
process.env.NIBBI_STATE_DIR = join(directory, 'state'); process.env.NIBBI_VAULT_DIR = join(directory, 'vault');
process.env.NIBBI_WORK_DIR = join(directory, 'work'); process.env.NIBBI_PROJECTS_DIR = join(directory, 'projects');
mkdirSync(process.env.NIBBI_VAULT_DIR, { recursive: true });
const { git } = await import('../src/processes.js');
const { createProject, updateProject } = await import('../src/projects.js');
const fixer = await import('../src/fixer.js');
const { replaceProviderForTest } = await import('../src/providers/index.js');
const { runtime, closeRuntime } = await import('../src/store.js');
const { closeToolService } = await import('../src/tool-service.js');
const { sandboxCommand } = await import('../src/sandbox.js');
const { parseRoadmap } = await import('../src/roadmap.js');
after(async () => { await closeToolService(); closeRuntime(); rmSync(directory, { recursive: true, force: true }); });
const notify = async (): Promise<void> => undefined;
const fake = (error = false) => replaceProviderForTest('claude', { id: 'claude', capabilities: { streaming: true, steering: true, cancellation: true, skills: true, tools: true, images: true }, start: input => ({
  result: Promise.resolve().then(() => { writeFileSync(join(input.cwd, 'change.txt'), 'useful work'); return { text: error ? 'Provider failed' : 'Changed one file', isError: error }; }),
  cancel: async () => undefined, steer: async () => undefined,
}) });

test('provider failure preserves work and cannot become staged or merged', async () => {
  await createProject('failure'); const restore = fake(true);
  try {
    const run = fixer.spawnFixer('failure', 'Produce a change', notify); await fixer.waitForFixer(run.id);
    const saved = runtime().get<import('../src/fixer.js').Fixer>('fixers', run.id)!;
    assert.equal(saved.status, 'failed'); assert.equal(readFileSync(join(saved.worktree, 'change.txt'), 'utf8'), 'useful work');
    assert.equal((await fixer.integrate(saved)).ok, false);
  } finally { restore(); }
});
test('missing checks stage explicitly unverified and cannot merge', async () => {
  await createProject('unverified'); const restore = fake();
  try {
    const run = fixer.spawnFixer('unverified', 'Produce a change', notify); await fixer.waitForFixer(run.id);
    const saved = runtime().get<import('../src/fixer.js').Fixer>('fixers', run.id)!;
    assert.equal(saved.status, 'staged'); assert.equal(saved.verification?.status, 'unverified');
    assert.equal((await fixer.integrate(saved)).reason, 'unverified');
    assert.throws(() => fixer.setAuto('unverified', { mode: 'ship' }), /verification/);
    fixer.discardFixer(saved.id); assert.equal(existsSync(saved.worktree), true);
  } finally { restore(); }
});
test('all dispatch paths respect capacity and queued cancellation is terminal', async () => {
  await createProject('capacity'); fixer.setAuto('capacity', { maxConcurrent: 1 }); const restore = fake();
  try {
    const first = fixer.spawnFixer('capacity', 'First', notify);
    const second = fixer.spawnFixer('capacity', 'Second', notify);
    assert.equal(second.status, 'queued'); fixer.stopFixer(second.id);
    await fixer.waitForFixer(first.id);
    assert.equal(runtime().get<import('../src/fixer.js').Fixer>('fixers', second.id)?.status, 'cancelled');
  } finally { restore(); }
});
test('native sandbox confines writes and verification gates the integration commit', async () => {
  const project = await createProject('verified'); updateProject('verified', { check: 'test -f change.txt' }); const restore = fake();
  try {
    await assert.rejects(sandboxCommand(project.repo, 'touch ' + join(directory, 'escaped'))); assert.equal(existsSync(join(directory, 'escaped')), false);
    writeFileSync(join(project.repo, '.env'), 'TEST_SECRET=fixture-only'); await assert.rejects(sandboxCommand(project.repo, 'cat .env'));
    await assert.rejects(sandboxCommand(project.repo, 'ln .env exposed && cat exposed'));
    assert.equal(existsSync(join(project.repo, 'exposed')), false);
    rmSync(join(project.repo, '.env')); // Exact fixture file created by this test, never a user credential.
    const run = fixer.spawnFixer('verified', 'Produce verified change', notify); await fixer.waitForFixer(run.id);
    const saved = runtime().get<import('../src/fixer.js').Fixer>('fixers', run.id)!;
    assert.equal(saved.status, 'staged', saved.summary ?? ''); assert.equal(saved.verification?.status, 'passed');
    writeFileSync(join(project.repo, 'local.txt'), 'owner work');
    assert.equal((await fixer.integrate(saved)).reason, 'changed');
    await git(project.repo, 'add', 'local.txt'); await git(project.repo, 'commit', '-m', 'Owner work');
    const result = await fixer.integrate(saved); assert.equal(result.ok, true, result.detail ?? '');
    assert.equal(readFileSync(join(project.repo, 'local.txt'), 'utf8'), 'owner work');
    assert.equal(readFileSync(join(project.repo, 'change.txt'), 'utf8'), 'useful work');
    const merged = runtime().get<import('../src/fixer.js').Fixer>('fixers', saved.id)!;
    assert.ok(merged.mergeIntent); merged.status = 'staged'; runtime().put('fixers', merged.id, merged);
    await fixer.reconcileFixers(); assert.equal(runtime().get<import('../src/fixer.js').Fixer>('fixers', merged.id)?.status, 'merged');
  } finally { restore(); }
});
test('a real npm verification command works inside the pinned sandbox', async () => {
  const project = await createProject('npm-check');
  writeFileSync(join(project.repo, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'test -f change.txt' } }));
  await git(project.repo, 'add', 'package.json'); await git(project.repo, 'commit', '-m', 'Configure test');
  updateProject('npm-check', { check: 'npm test' }); const restore = fake();
  try { const run = fixer.spawnFixer('npm-check', 'Produce a change', notify); await fixer.waitForFixer(run.id); const saved = runtime().get<import('../src/fixer.js').Fixer>('fixers', run.id)!; assert.equal(saved.status, 'staged', saved.summary ?? ''); }
  finally { restore(); }
});
test('failed checks and integration conflicts preserve evidence and leave the target unchanged', async () => {
  const project = await createProject('conflict'); updateProject('conflict', { check: 'test -f change.txt' }); const restore = fake();
  try {
    const run = fixer.spawnFixer('conflict', 'Produce change', notify); await fixer.waitForFixer(run.id);
    const saved = runtime().get<import('../src/fixer.js').Fixer>('fixers', run.id)!;
    writeFileSync(join(project.repo, 'change.txt'), 'owner version'); await git(project.repo, 'add', 'change.txt'); await git(project.repo, 'commit', '-m', 'Owner edits same file');
    const head = await git(project.repo, 'rev-parse', 'HEAD'); const result = await fixer.integrate(saved);
    assert.equal(result.reason, 'conflict'); assert.equal(await git(project.repo, 'rev-parse', 'HEAD'), head); assert.equal(existsSync(saved.worktree), true);
    await createProject('bad-check'); updateProject('bad-check', { check: 'exit 17' });
    const failing = fixer.spawnFixer('bad-check', 'Fails verification', notify); await fixer.waitForFixer(failing.id);
    const failed = runtime().get<import('../src/fixer.js').Fixer>('fixers', failing.id)!;
    assert.equal(failed.status, 'failed'); assert.equal(failed.verification?.status, 'failed'); assert.equal(existsSync(join(failed.worktree, 'change.txt')), true);
  } finally { restore(); }
});
test('an unverified retained commit can be explicitly checked without rerunning the provider', async () => {
  await createProject('retained'); const restore = fake();
  try {
    const run = fixer.spawnFixer('retained', 'Retain change', notify); await fixer.waitForFixer(run.id);
    updateProject('retained', { check: 'test -f change.txt' });
    await fixer.verifyRetained(run.id); const saved = runtime().get<import('../src/fixer.js').Fixer>('fixers', run.id)!;
    assert.equal(saved.status, 'staged'); assert.equal(saved.verification?.status, 'passed');
  } finally { restore(); }
});
test('roadmap identities distinguish duplicates and preserve explicit IDs', () => {
  const tasks = parseRoadmap('- [ ] Same\n- [ ] Same\n- [ ] Changed wording <!-- nibbi-task:stable -->');
  assert.notEqual(tasks[0].id, tasks[1].id); assert.equal(tasks[2].id, 'stable');
});

test('captured issue flows through its linked plan task, staged review and verified merge without early completion', async () => {
  const { projectSection, projectCommand } = await import('../src/project-workspace.js');
  const { randomUUID } = await import('node:crypto');
  const project = 'workspace-merge'; await createProject(project); updateProject(project, { check: 'test -f change.txt' });
  const act = (action: string, args: Record<string, unknown> = {}) => projectCommand({ project, action, expectedRevision: projectSection(project, action.startsWith('issue.') ? 'issues' : 'plans').revision, idempotencyKey: randomUUID(), ...args });
  const issue = await act('issue.create', { title: 'Capture the observed problem', description: 'A reproducible fixture problem.' });
  assert.equal(issue.ok, true); if (!issue.ok) return;
  const planned = await act('issue.plan', { id: issue.itemId, planRevision: projectSection(project, 'plans').revision });
  assert.equal(planned.ok, true); if (!planned.ok) return;
  const restore = fake();
  try {
    const dispatched = await act('task.build', { id: planned.itemId }); assert.equal(dispatched.ok, true); if (!dispatched.ok) return;
    const run = dispatched.run as import('../src/fixer.js').Fixer; await fixer.waitForFixer(run.id);
    const staged = runtime().get<import('../src/fixer.js').Fixer>('fixers', run.id)!;
    assert.equal(staged.status, 'staged'); assert.equal(staged.verification?.status, 'passed');
    assert.equal(staged.taskId, planned.itemId); assert.deepEqual(staged.issueIds, [issue.itemId]);
    assert.equal(projectSection(project, 'plans').items[0].done, false);
    assert.equal(projectSection(project, 'issues').items[0].done, false);
    await fixer.approveFixer(run.id);
    assert.equal(runtime().get<import('../src/fixer.js').Fixer>('fixers', run.id)?.status, 'merged');
    assert.equal(projectSection(project, 'plans').items[0].done, true);
    assert.equal(projectSection(project, 'issues').items[0].done, true);
    assert.equal(projectSection(project, 'issues').items[0].linkedBuilds[0].status, 'merged');
  } finally { restore(); }
});

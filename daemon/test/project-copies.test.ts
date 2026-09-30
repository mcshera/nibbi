// Builds as copies — docs/BUILDS-AS-COPIES.md §3: every invariant, each proven against real git in temporary repositories.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const directory = mkdtempSync(join(tmpdir(), 'nibbi-copies-'));
process.env.NODE_ENV = 'test';
process.env.NIBBI_STATE_DIR = join(directory, 'state'); process.env.NIBBI_VAULT_DIR = join(directory, 'vault');
process.env.NIBBI_WORK_DIR = join(directory, 'work'); process.env.NIBBI_PROJECTS_DIR = join(directory, 'projects');
mkdirSync(process.env.NIBBI_VAULT_DIR, { recursive: true });
const workDir = process.env.NIBBI_WORK_DIR;
const { git } = await import('../src/processes.js');
const { createProject, updateProject, games } = await import('../src/projects.js');
const fixer = await import('../src/fixer.js');
const copies = await import('../src/project-copies.js');
const records = await import('../src/copy-records.js');
const previews = await import('../src/previews.js');
const { replaceProviderForTest } = await import('../src/providers/index.js');
const { runtime, closeRuntime } = await import('../src/store.js');
const { closeToolService } = await import('../src/tool-service.js');
const { executeCommand } = await import('../src/command-service.js');
const { projectSection, projectCommand } = await import('../src/project-workspace.js');
const { schedulerCycle } = await import('../src/scheduler.js');
const { canonicalPath, within } = await import('../src/paths.js');
type Fixer = import('../src/fixer.js').Fixer;
type CopyRecord = import('../src/copy-records.js').CopyRecord;

// A deterministic agent: the prompt's first line is "<file> <content…>" and it writes exactly that file.
// "FAIL" makes the agent report failure. While `held` is set, every agent waits for its release (or its abort).
let held: Promise<void> | undefined;
const restoreProvider = replaceProviderForTest('claude', { id: 'claude', capabilities: { streaming: true, steering: true, cancellation: true, skills: true, tools: true, images: true }, start: input => ({
  result: (async () => {
    if (held) await Promise.race([held, new Promise(resolve => input.signal.addEventListener('abort', resolve, { once: true }))]);
    const [file, ...rest] = input.prompt.split('\n')[0].split(' ');
    if (file === 'FAIL') return { text: 'Provider failed', isError: true };
    writeFileSync(join(input.cwd, file), (rest.join(' ') || file) + '\n');
    return { text: 'wrote ' + file, isError: false };
  })(),
  cancel: async () => undefined, steer: async () => undefined,
}) });
function hold(): () => void { let release!: () => void; held = new Promise<void>(resolve => { release = resolve; }); return () => { held = undefined; release(); }; }
after(async () => { restoreProvider(); await previews.stopPreviews(); await copies.stopCopyWork(); await closeToolService(); closeRuntime(); rmSync(directory, { recursive: true, force: true }); });

const notify = async (): Promise<void> => undefined;
// A real check: no bad.txt, and never x.txt and y.txt together (each passes alone; merged they fail).
const CHECK = '! test -f bad.txt && ! (test -f x.txt && test -f y.txt)';
const PLAY = 'echo http://127.0.0.1:4599/ && sleep 300';
const run = (id: string): Fixer => runtime().get<Fixer>('fixers', id)!;
const copyOf = (id: string): CopyRecord => records.copyById(id)!;
const sha = (repo: string, ref: string): Promise<string> => git(repo, 'rev-parse', '--verify', ref);
const exists = (repo: string, ref: string): Promise<boolean> => git(repo, 'rev-parse', '--verify', '--quiet', ref).then(() => true, () => false);
const merges = (): string[] => existsSync(workDir) ? readdirSync(workDir).filter(name => name.startsWith('merge-')) : [];
async function until(predicate: () => boolean | Promise<boolean>, what: string, ms = 30_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await predicate())) { if (Date.now() > end) throw new Error('timed out waiting for ' + what); await new Promise(resolve => setTimeout(resolve, 50)); }
}
async function project(name: string, changes: Parameters<typeof updateProject>[1] = {}): Promise<string> {
  const { repo } = await createProject(name); updateProject(name, { check: CHECK, ...changes }); return repo;
}
async function makeCopy(projectName: string, name = 'dev'): Promise<CopyRecord> {
  const view = await copies.createCopy(projectName, name); await copies.waitForCopy(view.id);
  const copy = copyOf(view.id); assert.equal(copy.status, 'ready', copy.error ?? ''); return copy;
}
/** Start an improvement (on a copy when given) and wait until it has finished — landing included. */
async function improve(projectName: string, issue: string, copy?: CopyRecord): Promise<Fixer> {
  const started = fixer.spawnFixer(projectName, issue, notify, copy ? { copyId: copy.id } : {});
  await fixer.waitForFixer(started.id); await fixer.landOnCopy(started.id); return run(started.id);
}
/** Every ref, head and working tree an operation could change. */
async function snapshot(repo: string, copy?: CopyRecord): Promise<Record<string, string>> {
  const state: Record<string, string> = { main: await sha(repo, 'refs/heads/main'), repoHead: await sha(repo, 'HEAD'), repoOn: await git(repo, 'symbolic-ref', '--short', 'HEAD'), repoStatus: await git(repo, 'status', '--porcelain') };
  if (copy) Object.assign(state, { branch: await sha(repo, 'refs/heads/' + copy.branch), copyHead: await sha(copy.worktree, 'HEAD'), copyOn: await git(copy.worktree, 'symbolic-ref', '--short', 'HEAD'), copyStatus: await git(copy.worktree, 'status', '--porcelain'), record: copyOf(copy.id).headSha, status: copyOf(copy.id).status });
  return state;
}
async function refused(action: Promise<unknown>, words: RegExp | string): Promise<void> {
  await assert.rejects(action, error => { const message = (error as Error).message; assert.ok(typeof words === 'string' ? message === words : words.test(message), 'got: ' + message); return true; });
}
const W = records.COPY_WORDS;
const fill = records.fill;
const act = (projectName: string, action: string, args: Record<string, unknown> = {}) => projectCommand({ project: projectName, action, expectedRevision: projectSection(projectName, 'issues').revision, idempotencyKey: randomUUID(), ...args });
const deliveries = (runId: string): number => runtime().list<{ deliveries: Array<{ runId: string }> }>('progress-days').flatMap(day => day.deliveries).filter(item => item.runId === runId).length;

test('the daemon’s rules and refusal words match the contract', async () => {
  const contract = await import(new URL('../../public/lib/control-panel-contract.js', import.meta.url).href) as { COPY: Record<string, any>; WORDS: { copy: Record<string, any> } };
  let shared = 0;
  for (const [key, words] of Object.entries(W)) if (key in contract.WORDS.copy) { assert.equal(words, contract.WORDS.copy[key], key); shared++; }
  assert.ok(shared >= 20, 'shared words: ' + shared);
  assert.deepEqual(records.COPY_STATUS_WORDS, { ...contract.WORDS.copy.statusWords });
  assert.equal(records.COPY_RULES.branchPrefix, contract.COPY.branchPrefix); assert.equal(records.COPY_RULES.namePattern.source, contract.COPY.namePattern);
  assert.equal(records.COPY_RULES.nameMax, contract.COPY.nameMax); assert.deepEqual([...records.COPY_RULES.reserved], [...contract.COPY.reserved]);
  assert.equal(records.COPY_RULES.limit, contract.COPY.limit); assert.equal(records.COPY_RULES.idPattern.source, contract.COPY.idPattern);
  assert.equal(records.copyPreviewId('p', 'copy-1'), contract.COPY.preview.replace('{project}', 'p').replace('{copyId}', 'copy-1'));
});

test('names are refused before anything is written', async () => {
  const repo = await project('names');
  const before = async () => ({ records: records.allCopies().length, branches: await git(repo, 'branch', '--list', 'nibbi/*'), worktrees: await git(repo, 'worktree', 'list', '--porcelain') });
  const initial = await before();
  await refused(copies.createCopy('names', ''), W.nameEmpty);
  await refused(copies.createCopy('names', 'Dev'), W.nameShape);
  await refused(copies.createCopy('names', 'dev_1'), W.nameShape);
  await refused(copies.createCopy('names', '-dev'), W.nameShape);
  await refused(copies.createCopy('names', 'a'.repeat(33)), W.nameLong);
  await refused(copies.createCopy('names', 'main'), fill(W.nameReserved, { name: 'main' }));
  await git(repo, 'branch', 'nibbi/copy/taken');
  const withBranch = await before();
  await refused(copies.createCopy('names', 'taken'), fill(W.branchExists, { branch: 'nibbi/copy/taken' }));
  mkdirSync(records.copyPath('names', 'folder'), { recursive: true });
  await refused(copies.createCopy('names', 'folder'), /already a folder for folder/);
  assert.deepEqual(await before(), withBranch);
  await git(repo, 'branch', '-D', 'nibbi/copy/taken'); rmSync(records.copyPath('names', 'folder'), { recursive: true });
  assert.deepEqual(await before(), initial);
  // Two creates of one name can't both pass: the checks run inside the repository lock.
  const both = await Promise.allSettled([copies.createCopy('names', 'dev'), copies.createCopy('names', 'dev')]);
  assert.equal(both.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((both.find(result => result.status === 'rejected') as PromiseRejectedResult).reason.message, fill(W.nameTaken, { name: 'dev' }));
  for (const name of ['dev1', 'dev2', 'dev3', 'dev4']) await copies.createCopy('names', name);
  for (const copy of records.liveCopies('names')) await copies.waitForCopy(copy.id);
  const five = await before();
  await refused(copies.createCopy('names', 'dev5'), W.tooMany);
  assert.deepEqual(await before(), five);
  // No real check, no copy: nothing could land in it or ship from it.
  await project('names-nocheck', { check: 'true' });
  await refused(copies.createCopy('names-nocheck', 'dev'), W.noCheck);
  assert.equal(records.liveCopies('names-nocheck').length, 0);
  // A create that fails part way (its folder's parent can't be made) leaves no record and no branch.
  await project('names-broken'); mkdirSync(join(workDir, 'copies'), { recursive: true }); writeFileSync(join(workDir, 'copies', 'names-broken'), 'not a folder');
  const cursor = runtime().cursor();
  await assert.rejects(copies.createCopy('names-broken', 'dev'));
  assert.equal(records.allCopies().filter(copy => copy.project === 'names-broken').length, 0);
  assert.equal(await exists(games()['names-broken'].repo, 'refs/heads/nibbi/copy/dev'), false);
  assert.ok(runtime().replay(cursor).some(event => event.type === 'copy.updated' && event.payload.removed === true));
  rmSync(join(workDir, 'copies', 'names-broken'));
});

test('a copy is made at main’s head on its own branch', async () => {
  const repo = await project('made'); const main = await sha(repo, 'refs/heads/main'); const cursor = runtime().cursor();
  const view = await copies.createCopy('made', 'dev');
  assert.equal(view.status, 'creating'); assert.equal(view.name, 'dev'); assert.match(view.id, records.COPY_RULES.idPattern);
  await copies.waitForCopy(view.id);
  const copy = copyOf(view.id);
  assert.equal(copy.status, 'ready'); assert.equal(copy.branch, 'nibbi/copy/dev'); assert.equal(copy.base, 'main');
  assert.equal(copy.baseSha, main); assert.equal(copy.headSha, main); assert.equal(copy.lastVerifiedSha, null);
  assert.equal(copy.worktree, join(workDir, 'copies', 'made', 'dev')); assert.ok(within(workDir, copy.worktree));
  assert.equal(await sha(repo, 'refs/heads/nibbi/copy/dev'), main);
  assert.equal(await git(copy.worktree, 'symbolic-ref', '--short', 'HEAD'), 'nibbi/copy/dev');
  const listed = (await git(repo, 'worktree', 'list', '--porcelain')).split('\n\n').filter(block => block.includes('branch refs/heads/nibbi/copy/dev'));
  assert.equal(listed.length, 1); assert.equal(canonicalPath(listed[0].split('\n')[0].slice('worktree '.length)), canonicalPath(copy.worktree));
  assert.equal(await sha(repo, 'HEAD'), main); assert.equal(await git(repo, 'symbolic-ref', '--short', 'HEAD'), 'main'); assert.equal(await git(repo, 'status', '--porcelain'), '');
  const events = runtime().replay(cursor).filter(event => event.type === 'copy.updated' && (event.payload.copy as CopyRecord).id === copy.id);
  assert.deepEqual(events.map(event => (event.payload.copy as CopyRecord).status), ['creating', 'ready']); assert.equal(events[0].projectId, 'made');
  const read = await copies.copiesView('made');
  assert.deepEqual({ mode: read.mode, disabled: read.disabled, limit: read.limit, main: read.main }, { mode: 'local', disabled: '', limit: 5, main: { branch: 'main', sha: main } });
  assert.equal(read.copies.length, 1); assert.deepEqual({ ahead: read.copies[0].ahead, behind: read.copies[0].behind, health: read.copies[0].health }, { ahead: 0, behind: 0, health: 'ok' });
});

test('the read says ahead, behind and health', async () => {
  const repo = await project('read'); const copy = await makeCopy('read');
  const one = async () => (await copies.copiesView('read')).copies[0];
  assert.equal((await improve('read', 'a.txt from dev', copy)).status, 'merged');
  assert.deepEqual([(await one()).ahead, (await one()).behind], [1, 0]);
  writeFileSync(join(repo, 'main-moved.txt'), 'main\n'); await git(repo, 'add', '.'); await git(repo, 'commit', '-m', 'main moves on');
  assert.deepEqual([(await one()).ahead, (await one()).behind, (await one()).health], [1, 1, 'ok']);
  writeFileSync(join(copy.worktree, 'stray.txt'), 'not nibbi\n');
  assert.deepEqual([(await one()).health, (await one()).dirtyFiles], ['dirty', ['stray.txt']]);
  rmSync(join(copy.worktree, 'stray.txt'));
  const head = copyOf(copy.id).headSha;
  writeFileSync(join(copy.worktree, 'commit.txt'), 'owner\n'); await git(copy.worktree, 'add', '.'); await git(copy.worktree, 'commit', '-m', 'owner commits in dev');
  assert.equal((await one()).health, 'moved');
  await git(copy.worktree, 'reset', '--hard', head);   // the test puts it back; nibbi never would
  assert.equal((await one()).health, 'ok');
  renameSync(copy.worktree, copy.worktree + '-away'); assert.equal((await one()).health, 'missing');
  renameSync(copy.worktree + '-away', copy.worktree); assert.equal((await one()).health, 'ok');
  await assert.rejects(copies.copiesView('vault'), (error: Error & { status?: number }) => error.status === 400);
  await assert.rejects(copies.copiesView('nope'), (error: Error & { status?: number }) => error.status === 404);
});

test('an improvement lands in its copy, and main is untouched', async () => {
  const repo = await project('land'); const copy = await makeCopy('land'); const before = await snapshot(repo);
  const issue = await act('land', 'issue.create', { title: 'a.txt landed in dev', copyId: copy.id }); assert.equal(issue.ok, true); if (!issue.ok) return;
  assert.equal(projectSection('land', 'issues').items[0].copyId, copy.id);
  const built = await act('land', 'issue.build', { id: issue.itemId }); assert.equal(built.ok, true, built.ok ? '' : built.error.message); if (!built.ok) return;
  const started = built.run as Fixer; assert.equal(started.copyId, copy.id); assert.equal(started.targetBranch, 'nibbi/copy/dev');
  await fixer.waitForFixer(started.id); await fixer.landOnCopy(started.id);
  const landed = run(started.id), after = copyOf(copy.id);
  assert.equal(landed.status, 'merged', landed.summary ?? ''); assert.equal(landed.shipped, undefined); assert.equal(landed.landing, undefined);
  assert.deepEqual(await snapshot(repo), before);   // main's ref, the owner's HEAD and working tree
  assert.notEqual(after.headSha, copy.headSha); assert.equal(after.headSha, landed.mergeIntent?.candidate);
  assert.equal(await sha(repo, 'refs/heads/nibbi/copy/dev'), after.headSha); assert.equal(await sha(copy.worktree, 'HEAD'), after.headSha);
  assert.equal(readFileSync(join(copy.worktree, 'a.txt'), 'utf8'), 'landed in dev\n');   // not a stale worktree
  assert.equal(await git(copy.worktree, 'status', '--porcelain'), '');
  assert.equal(after.lastVerifiedSha, after.headSha); assert.ok(after.lastLandedAt);
  assert.equal(existsSync(join(repo, 'a.txt')), false);
  // Done only when dev ships (D1): the issue is open and nothing was delivered.
  assert.equal(projectSection('land', 'issues').items[0].done, false); assert.equal(deliveries(landed.id), 0);
  assert.deepEqual(merges(), []);
  // A copy's try is never offered approve & merge; a main one in the same state is.
  const staged = { ...landed, status: 'staged' as const };
  assert.equal(fixer.allowedRunActions(staged).includes('run.merge'), false);
  const { copyId: _copyId, ...mainTwin } = staged; assert.equal(fixer.allowedRunActions(mainTwin).includes('run.merge'), true);
});

test('ship runs the checks again and fast-forwards main where it is checked out', async () => {
  const repo = await project('ship'); const copy = await makeCopy('ship');
  const issue = await act('ship', 'issue.create', { title: 'a.txt shipped', copyId: copy.id }); assert.equal(issue.ok, true); if (!issue.ok) return;
  const built = await act('ship', 'issue.build', { id: issue.itemId }); if (!built.ok) throw new Error(built.error.message);
  const runId = (built.run as Fixer).id; await fixer.waitForFixer(runId); await fixer.landOnCopy(runId);
  const landed = copyOf(copy.id); assert.equal(run(runId).status, 'merged');
  // A check that fails only on dev's head: ship refuses, and nothing changed anywhere.
  updateProject('ship', { check: CHECK + ' && ! test -f a.txt' });
  const before = await snapshot(repo, landed);
  await refused(copies.shipCopy('ship', copy.id, landed.headSha), /^main is unchanged — the checks didn’t pass/);
  assert.deepEqual(await snapshot(repo, landed), before); assert.deepEqual(merges(), []);
  assert.equal(copyOf(copy.id).intent, null); assert.equal(run(runId).shipped, undefined); assert.equal(projectSection('ship', 'issues').items[0].done, false);
  updateProject('ship', { check: CHECK });
  const mainBefore = await sha(repo, 'refs/heads/main');
  const shipped = await copies.shipCopy('ship', copy.id, landed.headSha);
  assert.equal(shipped.shippedSha, landed.headSha); assert.deepEqual(shipped.runIds, [runId]);
  assert.equal(await sha(repo, 'refs/heads/main'), landed.headSha); assert.equal(await sha(repo, 'HEAD'), landed.headSha);
  assert.equal(await git(repo, 'status', '--porcelain'), ''); assert.equal(readFileSync(join(repo, 'a.txt'), 'utf8'), 'shipped\n');
  assert.deepEqual(merges(), []);
  // Done now: the run is shipped, its issue checked, one delivery.
  assert.deepEqual(run(runId).shipped, { at: run(runId).shipped!.at, sha: landed.headSha, copyId: copy.id });
  assert.equal(projectSection('ship', 'issues').items[0].done, true); assert.equal(deliveries(runId), 1);
  const record = copyOf(copy.id);
  assert.equal(record.ships.length, 1); assert.deepEqual({ ...record.ships[0], id: '', at: '' }, { id: '', at: '', sha: landed.headSha, mainBefore, runIds: [runId] });
  const read = await copies.copiesView('ship'); assert.equal(read.ships[0].name, 'dev'); assert.equal(read.ships[0].copyId, copy.id);
});

test('ship leaves the copy level with main', async () => {
  const repo = await project('level'); const copy = await makeCopy('level');
  await improve('level', 'a.txt one', copy); await improve('level', 'b.txt two', copy);
  const head = copyOf(copy.id).headSha;
  await copies.shipCopy('level', copy.id, head);
  const record = copyOf(copy.id), view = (await copies.copiesView('level')).copies[0];
  assert.equal(record.status, 'ready'); assert.equal(record.intent, null);
  assert.deepEqual([view.ahead, view.behind, view.health], [0, 0, 'ok']);
  assert.equal(await sha(repo, 'refs/heads/main'), head); assert.equal(await sha(repo, 'refs/heads/nibbi/copy/dev'), head);
  assert.equal(await sha(copy.worktree, 'HEAD'), head); assert.equal(record.headSha, head);
  await refused(copies.shipCopy('level', copy.id, head), fill(W.shipNothing, { name: 'dev' }));
  // It keeps taking improvements after it shipped.
  assert.equal((await improve('level', 'c.txt three', copy)).status, 'merged');
  assert.deepEqual([(await copies.copiesView('level')).copies[0].ahead, (await copies.copiesView('level')).copies[0].behind], [1, 0]);
});

test('ship refuses and changes nothing', async () => {
  const repo = await project('refuse'); const copy = await makeCopy('refuse');
  await improve('refuse', 'a.txt in dev', copy); const head = copyOf(copy.id).headSha;
  const same = async (): Promise<void> => { assert.deepEqual(await snapshot(repo, copy), before); assert.deepEqual(merges(), []); assert.equal(copyOf(copy.id).status, 'ready'); assert.equal(copyOf(copy.id).ships.length, 0); };
  const before = await snapshot(repo, copy);
  // The confirm listed another head.
  await refused(copies.shipCopy('refuse', copy.id, 'f'.repeat(40)), fill(W.headMoved, { name: 'dev' })); await same();
  // Main's checkout has edits.
  writeFileSync(join(repo, 'owner.txt'), 'owner work\n');
  await refused(copies.shipCopy('refuse', copy.id, head), W.shipCheckoutDirty);
  rmSync(join(repo, 'owner.txt')); await same();
  // Main's checkout is on another branch.
  await git(repo, 'checkout', '-q', '-b', 'side');
  await refused(copies.shipCopy('refuse', copy.id, head), fill(W.shipCheckoutOther, { branch: 'side', base: 'main' }));
  await git(repo, 'checkout', '-q', 'main'); await git(repo, 'branch', '-D', 'side'); await same();
  // The copy's folder has edits nibbi didn't make.
  writeFileSync(join(copy.worktree, 'stray.txt'), 'x\n');
  await refused(copies.shipCopy('refuse', copy.id, head), fill(W.dirty, { name: 'dev' }));
  rmSync(join(copy.worktree, 'stray.txt')); await same();
  // The copy moved outside nibbi.
  writeFileSync(join(copy.worktree, 'owner.txt'), 'x\n'); await git(copy.worktree, 'add', '.'); await git(copy.worktree, 'commit', '-m', 'outside');
  await refused(copies.shipCopy('refuse', copy.id, head), fill(W.moved, { name: 'dev' }));
  await git(copy.worktree, 'reset', '--hard', head); await same();
  // Main moved on: catch up first (D8).
  writeFileSync(join(repo, 'main.txt'), 'main\n'); await git(repo, 'add', '.'); await git(repo, 'commit', '-m', 'main moves');
  const moved = await snapshot(repo, copy);
  await refused(copies.shipCopy('refuse', copy.id, head), fill(W.shipBehind, { name: 'dev' }));
  assert.deepEqual(await snapshot(repo, copy), moved); assert.deepEqual(merges(), []);
});

test('a failed improvement leaves the copy and main unchanged', async () => {
  const repo = await project('fail'); const copy = await makeCopy('fail');
  const before = await snapshot(repo, copy);
  // The agent fails.
  const agent = await improve('fail', 'FAIL please', copy);
  assert.equal(agent.status, 'failed'); assert.deepEqual(await snapshot(repo, copy), before);
  // Its own check fails.
  const own = await improve('fail', 'bad.txt breaks the check', copy);
  assert.equal(own.status, 'failed'); assert.equal(own.verification?.status, 'failed'); assert.deepEqual(await snapshot(repo, copy), before);
  // Each passes alone; together the merged tree fails the check. The second to land fails, and dev keeps the first.
  let release = hold();
  const x = fixer.spawnFixer('fail', 'x.txt alone', notify, { copyId: copy.id }), y = fixer.spawnFixer('fail', 'y.txt alone', notify, { copyId: copy.id });
  await until(() => run(x.id).status === 'running' && run(y.id).status === 'running', 'both running');
  assert.equal(run(x.id).baseSha, run(y.id).baseSha);
  release(); await Promise.all([fixer.waitForFixer(x.id), fixer.waitForFixer(y.id)]); await Promise.all([fixer.landOnCopy(x.id), fixer.landOnCopy(y.id)]);
  const pair = [run(x.id), run(y.id)], merged = pair.find(f => f.status === 'merged')!, failed = pair.find(f => f.status === 'failed')!;
  assert.ok(merged && failed, pair.map(f => f.status + ' ' + f.summary).join(' | '));
  assert.equal(failed.landing?.state, 'failed'); assert.equal(failed.landing?.reason, 'checkfail'); assert.match(failed.summary ?? '', /^It didn’t land in dev: /);
  const afterFirst = copyOf(copy.id); assert.equal(afterFirst.headSha, merged.mergeIntent?.candidate);
  assert.equal(await sha(repo, 'refs/heads/main'), before.main); assert.equal(await sha(copy.worktree, 'HEAD'), afterFirst.headSha);
  assert.equal(await git(copy.worktree, 'status', '--porcelain'), ''); assert.deepEqual(merges(), []);
  // Two improvements editing one file: the second conflicts, and dev is unchanged by it.
  release = hold();
  const one = fixer.spawnFixer('fail', 'shared.txt one', notify, { copyId: copy.id }), two = fixer.spawnFixer('fail', 'shared.txt two', notify, { copyId: copy.id });
  await until(() => run(one.id).status === 'running' && run(two.id).status === 'running', 'both running');
  release(); await Promise.all([fixer.waitForFixer(one.id), fixer.waitForFixer(two.id)]); await Promise.all([fixer.landOnCopy(one.id), fixer.landOnCopy(two.id)]);
  const both = [run(one.id), run(two.id)], first = both.find(f => f.status === 'merged')!, second = both.find(f => f.status === 'failed')!;
  assert.ok(first && second, both.map(f => f.status + ' ' + f.summary).join(' | '));
  assert.equal(second.landing?.reason, 'conflict'); assert.match(second.landing?.detail ?? '', /shared\.txt/);
  const final = copyOf(copy.id); assert.equal(final.headSha, first.mergeIntent?.candidate);
  assert.equal(await sha(copy.worktree, 'HEAD'), final.headSha); assert.equal(await git(copy.worktree, 'status', '--porcelain'), '');
  assert.equal(readFileSync(join(copy.worktree, 'shared.txt'), 'utf8'), first.issue.split(' ')[1] + '\n');
  assert.equal(await sha(repo, 'refs/heads/main'), before.main); assert.deepEqual(merges(), []);
  // Every run keeps its own worktree; no merge worktree is left in git's list either.
  assert.equal((await git(repo, 'worktree', 'list', '--porcelain')).includes('/merge-'), false);
});

test('nothing moves a branch from outside its worktree', () => {
  for (const file of ['copy-records.ts', 'verified-merge.ts', 'project-copies.ts']) {
    const source = readFileSync(new URL('../src/' + file, import.meta.url), 'utf8');
    for (const forbidden of ["'update-ref'", "'reset'", "'checkout'", "'switch'", "'-B'", "'-f'", "'branch', '-f'", "'branch', '--force'", "'--hard'"]) assert.equal(source.includes(forbidden), false, file + ' uses ' + forbidden);
    assert.equal((source.match(/'--force'/g) ?? []).length, file === 'verified-merge.ts' ? 1 : 0, file + ' --force');
    // Every merge that moves a branch is --ff-only (the verification worktree's own merge is detached).
    for (const line of source.split('\n').filter(line => /git\([^)]*'merge'/.test(line) && !line.includes("'--abort'") && !line.includes('integration'))) assert.ok(line.includes("'--ff-only'"), file + ': ' + line.trim());
  }
  const merge = readFileSync(new URL('../src/verified-merge.ts', import.meta.url), 'utf8');
  assert.match(merge, /isMergeWorktree\(integration\)[\s\S]*'worktree', 'remove', '--force', integration/);
});

test('catch up brings main’s newest into the copy', async () => {
  const repo = await project('catchup'); const copy = await makeCopy('catchup');
  await improve('catchup', 'a.txt from dev', copy);
  writeFileSync(join(repo, 'main-moved.txt'), 'main\n'); await git(repo, 'add', '.'); await git(repo, 'commit', '-m', 'main moves on');
  const main = await sha(repo, 'refs/heads/main'), mainState = await snapshot(repo);
  assert.equal((await copies.copiesView('catchup')).copies[0].behind, 1);
  const head = copyOf(copy.id).headSha;
  const { copy: view } = await copies.catchUpCopy('catchup', copy.id, head);
  const record = copyOf(copy.id);
  assert.deepEqual(await snapshot(repo), mainState);   // main is only read
  assert.notEqual(record.headSha, head); assert.equal(view.behind, 0); assert.equal(view.health, 'ok');
  assert.equal(await sha(repo, 'refs/heads/nibbi/copy/dev'), record.headSha); assert.equal(await sha(copy.worktree, 'HEAD'), record.headSha);
  await git(repo, 'merge-base', '--is-ancestor', main, 'nibbi/copy/dev');
  assert.equal(readFileSync(join(copy.worktree, 'main-moved.txt'), 'utf8'), 'main\n'); assert.ok(existsSync(join(copy.worktree, 'a.txt')));
  assert.equal(await git(copy.worktree, 'status', '--porcelain'), '');
  assert.deepEqual({ ...record.catchUps[0], at: '' }, { at: '', ok: true, mainSha: main, from: head, to: record.headSha, reason: '', detail: '', conflicts: [] });
  assert.equal(record.lastVerifiedSha, record.headSha); assert.deepEqual(merges(), []);
  await refused(copies.catchUpCopy('catchup', copy.id, record.headSha), fill(W.catchUpLevel, { name: 'dev' }));
  // Level again, it ships: main fast-forwards to exactly the caught-up head.
  await copies.shipCopy('catchup', copy.id, record.headSha);
  assert.equal(await sha(repo, 'refs/heads/main'), record.headSha);
});

test('a catch-up conflict or failed check changes nothing and says which files', async () => {
  const repo = await project('catchfail'); const copy = await makeCopy('catchfail');
  await improve('catchfail', 'shared.txt dev’s words', copy);
  writeFileSync(join(repo, 'shared.txt'), 'main’s words\n'); await git(repo, 'add', '.'); await git(repo, 'commit', '-m', 'main edits the same file');
  let before = await snapshot(repo, copy);
  await refused(copies.catchUpCopy('catchfail', copy.id, copyOf(copy.id).headSha), fill(W.catchUpConflict, { name: 'dev', files: 'shared.txt' }));
  assert.deepEqual(await snapshot(repo, copy), before); assert.deepEqual(merges(), []);
  const conflict = copyOf(copy.id).catchUps[0];
  assert.deepEqual([conflict.ok, conflict.reason, conflict.conflicts, conflict.to], [false, 'conflict', ['shared.txt'], null]);
  // A second copy that takes x.txt; main takes y.txt; together they fail the check.
  const other = await makeCopy('catchfail', 'dev2');
  await improve('catchfail', 'x.txt in dev2', other);
  writeFileSync(join(repo, 'y.txt'), 'main\n'); await git(repo, 'add', '.'); await git(repo, 'commit', '-m', 'main takes y');
  before = await snapshot(repo, other);
  await refused(copies.catchUpCopy('catchfail', other.id, copyOf(other.id).headSha), fill(W.catchUpCheckfail, { name: 'dev2' }));
  assert.deepEqual(await snapshot(repo, other), before); assert.deepEqual(merges(), []);
  assert.equal(copyOf(other.id).catchUps[0].reason, 'checkfail'); assert.equal(copyOf(other.id).status, 'ready');
});

test('retire refuses while an improvement is building or queued', async () => {
  await project('retire-busy'); const copy = await makeCopy('retire-busy');
  const release = hold();
  const building = fixer.spawnFixer('retire-busy', 'a.txt building', notify, { copyId: copy.id });
  await until(() => run(building.id).status === 'running', 'running');
  await refused(copies.retireCopy('retire-busy', copy.id, copy.headSha), fill(W.retireBuilding, { name: 'dev' }));
  assert.equal(copyOf(copy.id).status, 'ready'); assert.ok(existsSync(copy.worktree));
  const queued = fixer.queueFix('retire-busy', 'b.txt queued', { copyId: copy.id }); assert.equal(queued.status, 'queued');
  release(); await fixer.waitForFixer(building.id); await fixer.landOnCopy(building.id);
  assert.equal(run(building.id).status, 'merged');
  const head = copyOf(copy.id).headSha;
  await refused(copies.retireCopy('retire-busy', copy.id, head), fill(W.retireBuilding, { name: 'dev' }));
  fixer.stopFixer(queued.id); assert.equal(run(queued.id).status, 'cancelled');
  await refused(copies.retireCopy('retire-busy', copy.id, copy.headSha), fill(W.headMoved, { name: 'dev' }));
  assert.equal((await copies.retireCopy('retire-busy', copy.id, head)).copy.name, 'dev');
});

test('retire removes only its own worktree and branch', async () => {
  const repo = await project('retire'); const dev = await makeCopy('retire'); const dev1 = await makeCopy('retire', 'dev1');
  const landed = await improve('retire', 'a.txt in dev', dev); assert.equal(landed.status, 'merged');
  const head = copyOf(dev.id).headSha, main = await snapshot(repo), other = await snapshot(repo, dev1);
  const { copy: retired } = await copies.retireCopy('retire', dev.id, head);
  assert.deepEqual({ ...retired, retiredAt: '' }, { id: dev.id, name: 'dev', branch: 'nibbi/copy/dev', retiredAt: '', retiredHead: head, ships: [] });
  assert.equal(existsSync(dev.worktree), false); assert.equal(await exists(repo, 'refs/heads/nibbi/copy/dev'), false);
  assert.deepEqual(await snapshot(repo), main); assert.deepEqual(await snapshot(repo, dev1), other);
  // The run's own worktree and branch still hold the landed commit.
  assert.ok(existsSync(landed.worktree)); assert.equal(await sha(repo, 'refs/heads/' + landed.branch), landed.commitSha);
  const tomb = copyOf(dev.id); assert.equal(tomb.status, 'retired'); assert.equal(tomb.retiredHead, head); assert.ok(tomb.retiredAt);
  const read = await copies.copiesView('retire');
  assert.deepEqual(read.copies.map(copy => copy.name), ['dev1']); assert.deepEqual(read.retired.map(copy => copy.name), ['dev']);
  await refused(copies.retireCopy('retire', dev.id, head), fill(W.retired, { name: 'dev' }));
  // The name comes back as a new copy with a new id; the old run can't be retried onto either.
  const again = await makeCopy('retire', 'dev'); assert.notEqual(again.id, dev.id);
  assert.throws(() => fixer.requeueFix(landed.id), { message: fill(W.retired, { name: 'dev' }) });
});

test('retire leaves a copy with files nibbi didn’t make', async () => {
  const repo = await project('retire-dirty'); const copy = await makeCopy('retire-dirty');
  writeFileSync(join(copy.worktree, 'mine.txt'), 'the owner’s\n');
  await refused(copies.retireCopy('retire-dirty', copy.id, copy.headSha), fill(W.retireDirty, { name: 'dev', files: 'mine.txt' }));
  assert.equal(readFileSync(join(copy.worktree, 'mine.txt'), 'utf8'), 'the owner’s\n');
  assert.equal(await exists(repo, 'refs/heads/nibbi/copy/dev'), true); assert.equal(copyOf(copy.id).status, 'ready');
  // A copy whose folder is already gone retires cleanly: git forgets the worktree, the branch goes.
  rmSync(copy.worktree, { recursive: true });
  await copies.retireCopy('retire-dirty', copy.id, copy.headSha);
  assert.equal(await exists(repo, 'refs/heads/nibbi/copy/dev'), false); assert.equal((await git(repo, 'worktree', 'list', '--porcelain')).includes('copies/retire-dirty/dev'), false);
});

test('retire leaves files git ignores unless nibbi’s install left them', async () => {
  // Its install leaves node_modules, and a build folder too once there is a package.json; the owner's saves are *.local.
  const repo = await project('retire-ignored', { install: 'mkdir -p node_modules && touch node_modules/stamp && if [ -f package.json ]; then mkdir -p build && touch build/out; fi' });
  writeFileSync(join(repo, '.gitignore'), 'node_modules\nbuild\n*.local\n'); await git(repo, 'add', '.'); await git(repo, 'commit', '-m', 'ignore installs and saves');
  const copy = await makeCopy('retire-ignored');
  const retire = (target: CopyRecord) => copies.retireCopy('retire-ignored', target.id, copyOf(target.id).headSha);
  // A save git ignores: `status --porcelain` says the folder is clean, and `worktree remove` would delete it without a word.
  writeFileSync(join(copy.worktree, 'save.local'), 'the owner’s save\n');
  assert.equal(await git(copy.worktree, 'status', '--porcelain'), '');
  const before = await snapshot(repo, copy);
  await refused(retire(copy), fill(W.retireDirty, { name: 'dev', files: 'save.local' }));
  assert.equal(readFileSync(join(copy.worktree, 'save.local'), 'utf8'), 'the owner’s save\n'); assert.ok(existsSync(join(copy.worktree, 'node_modules', 'stamp')));
  assert.deepEqual(await snapshot(repo, copy), before);
  // A landing that changes the dependency files reinstalls: what that install left is nibbi's too, and only the save is named.
  assert.equal((await improve('retire-ignored', 'package.json {}', copy)).status, 'merged'); assert.ok(existsSync(join(copy.worktree, 'build', 'out')));
  assert.deepEqual(copyOf(copy.id).installed, ['node_modules/', 'build/']);
  await refused(retire(copy), fill(W.retireDirty, { name: 'dev', files: 'save.local' }));
  assert.ok(existsSync(join(copy.worktree, 'save.local'))); assert.equal(copyOf(copy.id).status, 'ready');
  // The save gone, retire goes, and what nibbi's installs left goes with the folder.
  rmSync(join(copy.worktree, 'save.local'));
  await retire(copy);
  assert.equal(copyOf(copy.id).status, 'retired'); assert.equal(existsSync(copy.worktree), false); assert.equal(await exists(repo, 'refs/heads/nibbi/copy/dev'), false);
  // A copy made before nibbi wrote down what its install left: its node_modules is nibbi's, and nothing else git ignores.
  const old = await makeCopy('retire-ignored', 'dev1');
  records.patchCopy(old.id, record => { delete record.installed; });
  writeFileSync(join(old.worktree, 'notes.local'), 'the owner’s notes\n');
  await refused(retire(old), fill(W.retireDirty, { name: 'dev1', files: 'notes.local' }));
  assert.ok(existsSync(join(old.worktree, 'notes.local')));
  rmSync(join(old.worktree, 'notes.local'));
  await retire(old); assert.equal(copyOf(old.id).status, 'retired'); assert.equal(existsSync(old.worktree), false);
});

test('an install that changes files makes a broken copy, and retire still removes it', async () => {
  // A lockless npm project's shape: its install writes a lockfile main doesn't have (a stand-in for `npm install`).
  const repo = await project('install-dirty', { install: 'mkdir -p node_modules && touch node_modules/stamp && echo {} > package-lock.json' });
  writeFileSync(join(repo, '.gitignore'), 'node_modules\n'); await git(repo, 'add', '.'); await git(repo, 'commit', '-m', 'ignore installs');
  const made = await copies.createCopy('install-dirty', 'dev'); await copies.waitForCopy(made.id);
  const copy = copyOf(made.id);
  assert.equal(copy.status, 'broken'); assert.equal(copy.error, 'its install changed files in it: package-lock.json');
  // What its install changed is put back as the checkout had it; what git ignores is left for retire.
  assert.equal(await git(copy.worktree, 'status', '--porcelain'), ''); assert.equal(existsSync(join(copy.worktree, 'package-lock.json')), false);
  const main = await snapshot(repo);
  await copies.retireCopy('install-dirty', copy.id, copy.headSha);
  assert.equal(copyOf(copy.id).status, 'retired'); assert.equal(existsSync(copy.worktree), false); assert.equal(await exists(repo, 'refs/heads/nibbi/copy/dev'), false);
  assert.deepEqual(await snapshot(repo), main);
  // An install that rewrites a file main tracks: broken too, put back, and the name is free again after retire.
  updateProject('install-dirty', { install: 'echo more >> README.md' });
  const again = await copies.createCopy('install-dirty', 'dev'); await copies.waitForCopy(again.id);
  assert.equal(copyOf(again.id).status, 'broken'); assert.equal(copyOf(again.id).error, 'its install changed files in it: README.md');
  assert.equal(await git(again.worktree, 'status', '--porcelain'), ''); assert.equal(readFileSync(join(again.worktree, 'README.md'), 'utf8'), readFileSync(join(repo, 'README.md'), 'utf8'));
  await copies.retireCopy('install-dirty', again.id, copyOf(again.id).headSha); assert.equal(copyOf(again.id).status, 'retired');
  assert.deepEqual(await snapshot(repo), main);
});

test('retire keeps commits nibbi didn’t make', async () => {
  const repo = await project('retire-moved'); const copy = await makeCopy('retire-moved');
  const holders = (commit: string): Promise<string> => git(repo, 'for-each-ref', '--contains', commit, '--format=%(refname)');
  // The owner commits in the copy's folder: that commit is on the copy's branch and nowhere else.
  writeFileSync(join(copy.worktree, 'mine.txt'), 'the owner’s\n'); await git(copy.worktree, 'add', '.'); await git(copy.worktree, 'commit', '-m', 'the owner’s commit');
  const mine = await sha(copy.worktree, 'HEAD'), short = await git(repo, 'rev-parse', '--short', mine);
  assert.equal((await copies.copiesView('retire-moved')).copies[0].health, 'moved'); assert.equal(await holders(mine), 'refs/heads/nibbi/copy/dev');
  const before = await snapshot(repo, copy);
  await refused(copies.retireCopy('retire-moved', copy.id, copy.headSha), fill(W.retireMoved, { name: 'dev', commits: short + ' the owner’s commit' }));
  assert.deepEqual(await snapshot(repo, copy), before); assert.equal(await holders(mine), 'refs/heads/nibbi/copy/dev'); assert.ok(existsSync(join(copy.worktree, 'mine.txt')));
  // The folder on another branch, at nibbi's head: nothing to name, and still not retired.
  await git(copy.worktree, 'reset', '--hard', copy.headSha); await git(copy.worktree, 'switch', '-q', '-c', 'side');
  await refused(copies.retireCopy('retire-moved', copy.id, copy.headSha), fill(W.moved, { name: 'dev' }));
  assert.ok(existsSync(copy.worktree)); assert.equal(copyOf(copy.id).status, 'ready');
  // Kept on a branch of the owner's and put back: retire goes, and the owner's commit outlives the copy.
  await git(copy.worktree, 'switch', '-q', 'nibbi/copy/dev'); await git(repo, 'branch', '-D', 'side'); await git(repo, 'branch', 'mine', mine);
  await copies.retireCopy('retire-moved', copy.id, copy.headSha);
  assert.equal(copyOf(copy.id).status, 'retired'); assert.equal(existsSync(copy.worktree), false);
  assert.equal(await holders(mine), 'refs/heads/mine'); assert.equal(await exists(repo, 'refs/heads/nibbi/copy/dev'), false);
});

test('one plays at a time', async () => {
  await project('play', { play: PLAY }); const dev = await makeCopy('play'); const dev1 = await makeCopy('play', 'dev1');
  const main = 'project:play', a = records.copyPreviewId('play', dev.id), b = records.copyPreviewId('play', dev1.id);
  const running = (id: string): boolean => previews.previewStatus(id).running;
  try {
    assert.equal((await previews.playStart('play')).error, undefined); assert.equal(running(main), true);
    const started = await copies.playCopy('play', dev.id);
    assert.equal(running(main), false); assert.equal(running(a), true); assert.equal(typeof started.starting, 'boolean');
    assert.ok(copyOf(dev.id).playedAt);
    await until(() => !!(previews.previewStatus(a) as { url?: string }).url, 'a url');
    const view = (await copies.copiesView('play')).copies.find(copy => copy.id === dev.id)!;
    assert.deepEqual({ ...view.play, starting: false }, { running: true, starting: false, url: 'http://127.0.0.1:4599/', playable: true, kind: 'server', error: null });
    await copies.playCopy('play', dev1.id);
    assert.equal(running(a), false); assert.equal(running(b), true); assert.equal(running(main), false);
    await previews.playStart('play');
    assert.equal(running(b), false); assert.equal(running(main), true);
  } finally { await previews.stopAndWait(main); await previews.stopAndWait(a); await previews.stopAndWait(b); }
  updateProject('play', { play: 'http://127.0.0.1:1/' });
  await refused(copies.playCopy('play', dev.id), fill(W.fixedAddress, { project: 'play' }));
  updateProject('play', { play: undefined });
  await refused(copies.playCopy('play', dev.id), fill(W.nothingToPlay, { name: 'dev' }));
});

test('a landing waits for play, then lands', async () => {
  const repo = await project('wait', { play: PLAY }); const copy = await makeCopy('wait');
  const preview = records.copyPreviewId('wait', copy.id);
  try {
    await copies.playCopy('wait', copy.id);
    const first = await improve('wait', 'a.txt while playing', copy);
    assert.equal(first.status, 'staged'); assert.equal(first.landing?.state, 'waiting'); assert.equal(copyOf(copy.id).headSha, copy.headSha);
    assert.equal(existsSync(join(copy.worktree, 'a.txt')), false);   // the files never change under a running game
    assert.equal(await copies.stopCopy('wait', copy.id), 'dev stopped playing');
    assert.equal(run(first.id).status, 'merged'); assert.equal(run(first.id).landing, undefined); assert.ok(existsSync(join(copy.worktree, 'a.txt')));
    // The preview ending on its own lands what waited, too.
    await copies.playCopy('wait', copy.id);
    const second = await improve('wait', 'b.txt while playing', copy); assert.equal(second.landing?.state, 'waiting');
    previews.previewStop(preview);
    await until(() => run(second.id).status === 'merged', 'the waiting landing');
    assert.equal(copyOf(copy.id).headSha, run(second.id).mergeIntent?.candidate);
    // Catch up asks before it stops a playing copy (D9).
    writeFileSync(join(repo, 'main.txt'), 'main\n'); await git(repo, 'add', '.'); await git(repo, 'commit', '-m', 'main moves');
    await copies.playCopy('wait', copy.id);
    const head = copyOf(copy.id).headSha, before = await snapshot(repo, copy);
    await refused(copies.catchUpCopy('wait', copy.id, head), fill(W.stillPlaying, { name: 'dev' }));
    assert.deepEqual(await snapshot(repo, copy), before); assert.equal(previews.previewStatus(preview).running, true);
    await copies.catchUpCopy('wait', copy.id, head, true);
    assert.equal(previews.previewStatus(preview).running, false); assert.ok(existsSync(join(copy.worktree, 'main.txt')));
  } finally { await previews.stopAndWait(preview); }
});

test('GitHub-mode projects refuse copies', async () => {
  const repo = await project('gh', { play: PLAY }); const copy = await makeCopy('gh');
  runtime().put('github-connections', 'gh', { project: 'gh', workflowMode: 'github', integrationBranch: 'staging', releaseBranch: 'main', repository: 'owner/gh', repo });
  try {
    const words = fill(W.githubMode, { project: 'gh' }), count = () => ({ copies: records.allCopies().length, runs: fixer.listFixers().length, issues: projectSection('gh', 'issues').revision });
    const before = count(), state = await snapshot(repo, copy);
    await refused(copies.createCopy('gh', 'dev1'), words);
    await refused(copies.shipCopy('gh', copy.id, copy.headSha), words);
    await refused(copies.catchUpCopy('gh', copy.id, copy.headSha), words);
    await refused(copies.playCopy('gh', copy.id), words);
    assert.throws(() => fixer.spawnFixer('gh', 'a.txt', notify, { copyId: copy.id }), { message: words });
    const queued = await act('gh', 'issue.create', { title: 'a.txt later', copyId: copy.id }); assert.equal(queued.ok, false); if (!queued.ok) assert.equal(queued.error.message, words);
    assert.deepEqual(count(), before); assert.deepEqual(await snapshot(repo, copy), state);
    const read = await copies.copiesView('gh'); assert.deepEqual([read.mode, read.disabled, read.copies.length], ['github', 'github', 1]);
    // A copy made before the project connected can still be cleaned up.
    await copies.retireCopy('gh', copy.id, copy.headSha); assert.equal(copyOf(copy.id).status, 'retired');
  } finally { runtime().remove('github-connections', 'gh'); }
});

test('copy commands route away from build.*', async () => {
  await project('route');
  const command = (name: string, args: Record<string, unknown>) => executeCommand({ name, projectId: 'route', args, idempotencyKey: randomUUID() });
  const made = await command('copy.create', { name: 'dev' }); assert.equal(made.ok, true, made.ok ? '' : made.error.message); if (!made.ok) return;
  const view = made.data as { id: string; name: string; branch: string; status: string };
  assert.deepEqual([view.name, view.branch, view.status], ['dev', 'nibbi/copy/dev', 'creating']);
  await copies.waitForCopy(view.id);
  const unknown = await command('copy.nope', {}); assert.equal(unknown.ok, false); if (!unknown.ok) assert.equal(unknown.error.message, 'Unknown build command');
  const shape = await command('copy.ship', { id: view.id, expectedHead: 'not-a-sha' }); assert.equal(shape.ok, false);
  const nothing = await command('copy.ship', { id: view.id, expectedHead: copyOf(view.id).headSha }); assert.equal(nothing.ok, false); if (!nothing.ok) assert.equal(nothing.error.message, fill(W.shipNothing, { name: 'dev' }));
  // build.* still reach the GitHub router.
  const cleanup = await command('build.cleanup', { operationId: 'ghop-' + randomUUID() }); assert.equal(cleanup.ok, false); if (!cleanup.ok) assert.match(cleanup.error.message, /reviewed operation/);
  // The read route, as api.ts serves it.
  const { api } = await import('../src/api.js');
  const server = createServer((req, res) => { void api(req, res, new URL(req.url ?? '/', 'http://127.0.0.1')).catch(error => { res.writeHead((error as { status?: number }).status ?? 400); res.end(JSON.stringify({ error: (error as Error).message })); }); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
    const read = await fetch(base + '/api/project-copies?project=route'); assert.equal(read.status, 200);
    const body = await read.json() as { project: string; copies: Array<{ id: string; project: string }> }; assert.equal(body.project, 'route'); assert.deepEqual(body.copies.map(copy => copy.id), [view.id]);
    assert.equal((await fetch(base + '/api/project-copies?project=vault')).status, 400);
    assert.equal((await fetch(base + '/api/project-copies?project=missing')).status, 404);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  const gone = await command('copy.retire', { id: view.id, expectedHead: copyOf(view.id).headSha }); assert.equal(gone.ok, true);
});

test('a retry stays on its copy', async () => {
  await project('retry'); const copy = await makeCopy('retry');
  const failed = await improve('retry', 'FAIL once', copy); assert.equal(failed.status, 'failed');
  assert.ok(fixer.allowedRunActions(failed).includes('run.retry'));
  fixer.requeueFix(failed.id);
  const next = fixer.listFixers().find(f => f.replacesBuildId === failed.id)!;
  assert.deepEqual([next.status, next.copyId, next.targetBranch], ['queued', copy.id, 'nibbi/copy/dev']);
  fixer.stopFixer(next.id);
  const redispatched = fixer.redispatchFixer(run(next.id), notify);
  assert.deepEqual([redispatched.copyId, redispatched.targetBranch], [copy.id, 'nibbi/copy/dev']);
  await fixer.waitForFixer(redispatched.id);
});

test('a recovered ship completes once', async () => {
  const repo = await project('recover-ship'); const copy = await makeCopy('recover-ship');
  const issue = await act('recover-ship', 'issue.create', { title: 'a.txt recovered', copyId: copy.id }); if (!issue.ok) throw new Error(issue.error.message);
  const built = await act('recover-ship', 'issue.build', { id: issue.itemId }); if (!built.ok) throw new Error(built.error.message);
  const runId = (built.run as Fixer).id; await fixer.waitForFixer(runId); await fixer.landOnCopy(runId);
  const head = copyOf(copy.id).headSha, main = await sha(repo, 'refs/heads/main');
  const crash = (): void => { records.patchCopy(copy.id, record => { record.status = 'shipping'; record.intent = { kind: 'ship', candidate: head, targetSha: main, integration: join(workDir, 'merge-' + randomUUID()), at: new Date().toISOString() }; }); };
  // A crash before main moved: the intent is dropped, nothing is done.
  crash(); await copies.reconcileCopies();
  assert.equal(copyOf(copy.id).status, 'ready'); assert.equal(copyOf(copy.id).intent, null); assert.equal(await sha(repo, 'refs/heads/main'), main);
  assert.equal(run(runId).shipped, undefined); assert.equal(projectSection('recover-ship', 'issues').items[0].done, false);
  // A crash after main fast-forwarded: recovery finishes the ship's bookkeeping, exactly once.
  crash(); await git(repo, 'merge', '--ff-only', head);
  await copies.reconcileCopies();
  assert.equal(copyOf(copy.id).status, 'ready'); assert.equal(copyOf(copy.id).ships.length, 1); assert.deepEqual(copyOf(copy.id).ships[0].runIds, [runId]);
  assert.equal(run(runId).shipped?.sha, head); assert.equal(projectSection('recover-ship', 'issues').items[0].done, true); assert.equal(deliveries(runId), 1);
  await fixer.reconcileFixers(); await copies.reconcileCopies();
  assert.equal(copyOf(copy.id).ships.length, 1); assert.equal(deliveries(runId), 1);
});

test('a crash in the middle of a ship, a catch-up or a landing leaves no merge worktree behind', async () => {
  // Its own backend, in processes of its own: `start` hangs three checks in their merge worktrees and is SIGKILLed there; `boot` starts again.
  const root = mkdtempSync(join(tmpdir(), 'nibbi-copy-crash-'));
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'test', NIBBI_STATE_DIR: join(root, 'state'), NIBBI_VAULT_DIR: join(root, 'vault'), NIBBI_WORK_DIR: join(root, 'work'), NIBBI_PROJECTS_DIR: join(root, 'projects') };
  delete env.NODE_TEST_CONTEXT; mkdirSync(env.NIBBI_VAULT_DIR!, { recursive: true });
  const helper = fileURLToPath(new URL('./helpers/copy-crash.ts', import.meta.url)), cwd = fileURLToPath(new URL('..', import.meta.url));
  const spawned: Array<ReturnType<typeof spawn>> = [];
  const child = (...args: string[]) => { const proc = spawn(process.execPath, ['--import', 'tsx', helper, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] }); spawned.push(proc); let out = ''; proc.stdout.on('data', chunk => { out += chunk; }); proc.stderr.on('data', chunk => { out += chunk; }); return { proc, out: () => out, exited: new Promise<number | null>(resolve => proc.once('exit', code => resolve(code))) }; };
  const line = (out: string, key: string) => JSON.parse(out.split('\n').find(text => text.startsWith('{"' + key + '"')) ?? (() => { throw new Error(out); })());
  try {
    const start = child('start');
    const work = env.NIBBI_WORK_DIR!, hung = (): number => existsSync(work) ? readdirSync(work).filter(name => name.startsWith('merge-') && existsSync(join(work, name, 'hung.flag'))).length : 0;
    await until(() => hung() === 3 || start.proc.exitCode !== null, 'three checks hanging in their merge worktrees', 90_000);
    assert.equal(start.proc.exitCode, null, start.out());
    start.proc.kill('SIGKILL'); await start.exited;
    const started = line(start.out(), 'started') as { repos: Record<string, string>; before: Record<string, { main: string; head: string }>; run: string };
    for (const repo of Object.values(started.repos)) { rmSync(join(repo, 'hang.flag')); assert.equal((await git(repo, 'worktree', 'list', '--porcelain')).split('/merge-').length - 1, 1, 'the crash left one'); }
    const boot = child('boot', started.run); assert.equal(await boot.exited, 0, boot.out());
    const report = line(boot.out(), 'boot') as { run: string; projects: Record<string, { status: string; intent: unknown; head: string; branch: string; main: string; mergeWorktrees: string[] }>; mergeDirs: string[]; pending: number };
    // Recovery: every copy ready with no intent; main and each copy where they were; the interrupted landing landed again.
    for (const [name, state] of Object.entries(report.projects)) {
      assert.deepEqual([state.status, state.intent, state.mergeWorktrees], ['ready', null, []], name);
      assert.equal(state.main, started.before[name].main, name + ': main');
      if (name !== 'crash-land') assert.deepEqual([state.head, state.branch], [started.before[name].head, started.before[name].head], name + ': the copy');
    }
    assert.equal(report.run, 'merged'); assert.notEqual(report.projects['crash-land'].head, started.before['crash-land'].head);
    // And nothing of the three throwaways is left: not in git's lists, not on disk, not in the store.
    assert.deepEqual(report.mergeDirs, []); assert.equal(report.pending, 0);
  } finally { for (const proc of spawned) if (proc.exitCode === null) proc.kill('SIGKILL'); rmSync(root, { recursive: true, force: true }); }
});

test('a recovered landing moves the copy’s head', async () => {
  await project('recover-land'); const copy = await makeCopy('recover-land');
  const issue = await act('recover-land', 'issue.create', { title: 'a.txt interrupted', copyId: copy.id }); if (!issue.ok) throw new Error(issue.error.message);
  const built = await act('recover-land', 'issue.build', { id: issue.itemId }); if (!built.ok) throw new Error(built.error.message);
  const runId = (built.run as Fixer).id; await fixer.waitForFixer(runId); await fixer.landOnCopy(runId);
  const landedHead = copyOf(copy.id).headSha;
  // As if the backend stopped right after the fast-forward: the branch moved, the bookkeeping didn't.
  const f = run(runId); f.status = 'staged'; runtime().put('fixers', f.id, f);
  records.patchCopy(copy.id, record => { record.headSha = copy.headSha; });
  assert.equal((await copies.copiesView('recover-land')).copies[0].health, 'moved');
  await fixer.reconcileFixers(); await copies.reconcileCopies();
  assert.equal(run(runId).status, 'merged'); assert.equal(copyOf(copy.id).headSha, landedHead);
  assert.equal((await copies.copiesView('recover-land')).copies[0].health, 'ok');
  assert.equal(projectSection('recover-land', 'issues').items[0].done, false); assert.equal(deliveries(runId), 0);
  // A copy the backend stopped while making is broken, and only retire works on it.
  records.patchCopy(copy.id, record => { record.status = 'creating'; });
  await copies.reconcileCopies();
  assert.equal(copyOf(copy.id).status, 'broken'); assert.equal(copyOf(copy.id).error, W.stoppedWhileMaking);
  assert.throws(() => fixer.queueFix('recover-land', 'b.txt', { copyId: copy.id }), /dev is busy — it couldn’t be made/);
  await copies.retireCopy('recover-land', copy.id, landedHead); assert.equal(copyOf(copy.id).status, 'retired');
});

test('a main run merges into main while a copy exists', async () => {
  const repo = await project('mainpath'); const copy = await makeCopy('mainpath');
  const staged = await improve('mainpath', 'm.txt on main');
  assert.equal(staged.status, 'staged'); assert.equal(staged.copyId, undefined); assert.equal(staged.targetBranch, 'main');
  assert.ok(fixer.allowedRunActions(staged).includes('run.merge'));
  await fixer.approveFixer(staged.id);
  assert.equal(run(staged.id).status, 'merged'); assert.ok(existsSync(join(repo, 'm.txt')));
  assert.equal(await sha(repo, 'refs/heads/nibbi/copy/dev'), copy.headSha);
  const view = (await copies.copiesView('mainpath')).copies[0]; assert.deepEqual([view.health, view.behind, view.ahead], ['ok', 1, 0]);
  assert.equal(deliveries(staged.id), 1);
});

test('auto ship leaves copies alone', async () => {
  const repo = await project('autoship', { play: PLAY }); const copy = await makeCopy('autoship');
  const preview = records.copyPreviewId('autoship', copy.id);
  try {
    await copies.playCopy('autoship', copy.id);
    const waiting = await improve('autoship', 'c.txt in dev', copy); assert.equal(waiting.landing?.state, 'waiting');
    const onMain = await improve('autoship', 'm.txt on main'); assert.equal(onMain.status, 'staged');
    fixer.setAuto('autoship', { mode: 'ship' });
    await schedulerCycle(notify);
    assert.equal(run(onMain.id).status, 'merged'); assert.ok(existsSync(join(repo, 'm.txt')));
    assert.equal(run(waiting.id).status, 'staged'); assert.equal(copyOf(copy.id).headSha, copy.headSha); assert.equal(copyOf(copy.id).ships.length, 0);
    assert.equal(existsSync(join(repo, 'c.txt')), false);
  } finally { fixer.setAuto('autoship', { mode: 'off' }); await previews.stopAndWait(preview); }
});

test('a landing that changes the dependency files reinstalls in the copy', async () => {
  const repo = await project('install', { install: 'mkdir -p node_modules && touch node_modules/stamp' });
  writeFileSync(join(repo, '.gitignore'), 'node_modules\n'); await git(repo, 'add', '.'); await git(repo, 'commit', '-m', 'ignore installs');
  const copy = await makeCopy('install'); const stamp = join(copy.worktree, 'node_modules', 'stamp');
  assert.ok(existsSync(stamp)); rmSync(stamp);
  assert.equal((await improve('install', 'z.txt no dependencies', copy)).status, 'merged'); assert.equal(existsSync(stamp), false);
  assert.equal((await improve('install', 'package.json {}', copy)).status, 'merged'); assert.ok(existsSync(stamp));
  assert.equal(copyOf(copy.id).error, null); assert.deepEqual(merges(), []);
});

test('retire refuses while a try waits to land, and after retire its issue builds on main', async () => {
  const repo = await project('retire-play', { play: PLAY }); const copy = await makeCopy('retire-play');
  const preview = records.copyPreviewId('retire-play', copy.id), main = await snapshot(repo);
  try {
    await copies.playCopy('retire-play', copy.id);
    const issue = await act('retire-play', 'issue.create', { title: 'a.txt waits to land', copyId: copy.id }); if (!issue.ok) throw new Error(issue.error.message);
    const built = await act('retire-play', 'issue.build', { id: issue.itemId }); if (!built.ok) throw new Error(built.error.message);
    const runId = (built.run as Fixer).id; await fixer.waitForFixer(runId); await fixer.landOnCopy(runId);
    assert.deepEqual([run(runId).status, run(runId).landing?.state], ['staged', 'waiting']);
    // The model's rule: a try that passed and hasn't landed holds retire, and the refusal stops nothing.
    const before = await snapshot(repo, copy);
    await refused(copies.retireCopy('retire-play', copy.id, copy.headSha), fill(W.retireBuilding, { name: 'dev' }));
    assert.deepEqual(await snapshot(repo, copy), before); assert.equal(previews.previewStatus(preview).running, true);
    assert.deepEqual([run(runId).status, run(runId).landing?.state], ['staged', 'waiting']);
    // It lands once dev stops playing; then retire stops a playing dev and goes.
    await copies.stopCopy('retire-play', copy.id); assert.equal(run(runId).status, 'merged');
    await copies.playCopy('retire-play', copy.id);
    await copies.retireCopy('retire-play', copy.id, copyOf(copy.id).headSha);
    assert.equal(previews.previewStatus(preview).running, false); assert.equal(copyOf(copy.id).status, 'retired');
    assert.equal(existsSync(copy.worktree), false); assert.deepEqual(await snapshot(repo), main);
    // Its landed, never-shipped try doesn't hold the issue: it builds again, on main.
    const again = await act('retire-play', 'issue.build', { id: issue.itemId }); assert.equal(again.ok, true, again.ok ? '' : again.error.message); if (!again.ok) return;
    const next = again.run as Fixer; assert.deepEqual([next.copyId, next.targetBranch], [undefined, 'main']);
    await fixer.waitForFixer(next.id); assert.equal(run(next.id).status, 'staged');
  } finally { await previews.stopAndWait(preview); }
});

test('an interrupted ship recovered by two passes at once completes each run once', async () => {
  const repo = await project('recover-twice'); const copy = await makeCopy('recover-twice');
  const one = await improve('recover-twice', 'a.txt one', copy), two = await improve('recover-twice', 'b.txt two', copy);
  assert.deepEqual([one.status, two.status], ['merged', 'merged']);
  const head = copyOf(copy.id).headSha, main = await sha(repo, 'refs/heads/main');
  // The backend stopped in the ship's bookkeeping: main fast-forwarded, the first run was marked shipped and delivered, the
  // second wasn't reached, and the record still says shipping with its intent.
  await git(repo, 'merge', '--ff-only', head);
  records.patchCopy(copy.id, record => { record.status = 'shipping'; record.intent = { kind: 'ship', candidate: head, targetSha: main, integration: join(workDir, 'merge-' + randomUUID()), at: new Date().toISOString() }; });
  const marked = { at: '2026-01-01T00:00:00.000Z', sha: head, copyId: copy.id };
  const first = run(one.id); first.shipped = marked; fixer.saveFixer(first); fixer.noteDelivery(first);
  assert.deepEqual([deliveries(one.id), deliveries(two.id)], [1, 0]);
  const cursor = runtime().cursor();
  // Two recoveries over it, the second reading the record before the first has finished it; then one more.
  await Promise.all([copies.reconcileCopies(), copies.reconcileCopies()]);
  await copies.reconcileCopies();
  const record = copyOf(copy.id);
  assert.deepEqual([record.status, record.intent], ['ready', null]);
  assert.equal(record.ships.length, 1); assert.deepEqual([...record.ships[0].runIds].sort(), [one.id, two.id].sort());
  assert.deepEqual({ ...record.ships[0], id: '', at: '', runIds: [] }, { id: '', at: '', sha: head, mainBefore: main, runIds: [] });
  assert.deepEqual([deliveries(one.id), deliveries(two.id)], [1, 1]);
  // The run marked before the stop stays as it was marked; only the one not reached is shipped now.
  assert.deepEqual(run(one.id).shipped, marked);
  assert.equal(runtime().replay(cursor).filter(event => event.type === 'run.updated' && event.runId === one.id).length, 0);
  assert.equal(run(two.id).shipped?.sha, head); assert.equal(await sha(repo, 'refs/heads/main'), head);
});

test('recovery lands a passed try that never got to land', async () => {
  const repo = await project('recover-unattempted'); const copy = await makeCopy('recover-unattempted');
  const main = await sha(repo, 'refs/heads/main');
  // As if the backend stopped between the try staging and its landing: staged, checks passed, no landing written.
  // (It is made by letting it pass while its copy is busy, then taking the waiting landing off.)
  const release = hold();
  const started = fixer.spawnFixer('recover-unattempted', 'a.txt never got to land', notify, { copyId: copy.id });
  await until(() => run(started.id).status === 'running', 'running');
  records.patchCopy(copy.id, record => { record.status = 'catching_up'; });
  release(); await fixer.waitForFixer(started.id);
  assert.deepEqual([run(started.id).status, run(started.id).verification?.status, run(started.id).landing?.state], ['staged', 'passed', 'waiting']);
  const f = run(started.id); delete f.landing; runtime().put('fixers', f.id, f);
  records.patchCopy(copy.id, record => { record.status = 'ready'; });
  assert.equal(copyOf(copy.id).headSha, copy.headSha);
  await copies.reconcileCopies();
  await until(() => run(started.id).status === 'merged', 'the try to land', 15_000); await fixer.landOnCopy(started.id);
  const landed = copyOf(copy.id);
  assert.notEqual(landed.headSha, copy.headSha); assert.equal(landed.headSha, run(started.id).mergeIntent?.candidate);
  assert.equal(await sha(repo, 'refs/heads/nibbi/copy/dev'), landed.headSha); assert.equal(await sha(copy.worktree, 'HEAD'), landed.headSha);
  assert.ok(existsSync(join(copy.worktree, 'a.txt'))); assert.equal(await git(copy.worktree, 'status', '--porcelain'), '');
  assert.equal(await sha(repo, 'refs/heads/main'), main);
});

test('a try waiting in the queue fails before it starts when its copy moved outside nibbi', async () => {
  const repo = await project('moved-queued'); const copy = await makeCopy('moved-queued');
  const queued = fixer.queueFix('moved-queued', 'a.txt on a moved copy', { copyId: copy.id }); assert.equal(queued.status, 'queued');
  // The owner commits in the copy's folder while the try waits.
  writeFileSync(join(copy.worktree, 'mine.txt'), 'the owner’s\n'); await git(copy.worktree, 'add', '.'); await git(copy.worktree, 'commit', '-m', 'the owner’s commit');
  const before = await snapshot(repo, copy);
  fixer.drainQueues(notify, false); await fixer.waitForFixer(queued.id);
  const failed = run(queued.id);
  assert.deepEqual([failed.status, failed.summary], ['failed', fill(W.changedOutside, { name: 'dev' })]);
  // Nothing was built on the owner's commit: no worktree, no branch, no landing; the copy is as the owner left it.
  assert.equal(existsSync(failed.worktree), false); assert.equal(await exists(repo, 'refs/heads/' + failed.branch), false); assert.equal(failed.landing, undefined);
  assert.deepEqual(await snapshot(repo, copy), before); assert.equal(copyOf(copy.id).headSha, copy.headSha); assert.deepEqual(merges(), []);
});

test('a merge into main refuses when main changes while its checks run', async () => {
  // The check holds in its merge-<uuid> worktree while <repo>/hold.flag exists, so the owner can act while it runs.
  // (No single quotes in it: the sandbox's wrapper would then escape CHECK's `!`.)
  const { repo } = await createProject('reguard'); assert.doesNotMatch(repo, /\s/);
  updateProject('reguard', { check: `if [ -f ${repo}/hold.flag ]; then case "$(pwd)" in */merge-*) touch held.flag; while [ -f ${repo}/hold.flag ]; do sleep 0.05; done;; esac; fi; ${CHECK}` });
  writeFileSync(join(repo, '.gitignore'), '*.flag\n'); await git(repo, 'add', '.gitignore'); await git(repo, 'commit', '-m', 'flags are not the project’s');
  const staged = await improve('reguard', 'r.txt on main'); assert.equal(staged.status, 'staged', staged.summary ?? '');
  /** Approve the run; while its check holds, the owner does `change` in the project folder. The refusal, if any. */
  const whileChecking = async (change: () => Promise<void>): Promise<Error | undefined> => {
    const earlier = new Set(merges());
    writeFileSync(join(repo, 'hold.flag'), '');
    const approving = fixer.approveFixer(staged.id).then(() => undefined, (error: Error) => error);
    await until(() => merges().some(name => !earlier.has(name) && existsSync(join(workDir, name, 'held.flag'))), 'the check to hold');
    await change(); rmSync(join(repo, 'hold.flag'));
    const refusal = await approving;
    for (const name of merges().filter(name => !earlier.has(name))) await git(repo, 'worktree', 'remove', '--force', join(workDir, name));   // main's path keeps a failed one; the test tidies it
    return refusal;
  };
  // The owner commits on main: main stays at their commit, nothing was written about a merge, and nothing tried to move it.
  let owners = '';
  const committed = await whileChecking(async () => { writeFileSync(join(repo, 'owner.txt'), 'the owner’s\n'); await git(repo, 'add', 'owner.txt'); await git(repo, 'commit', '-m', 'the owner commits on main'); owners = await sha(repo, 'HEAD'); });
  assert.equal(committed?.message, 'Target changed during verification; no merge performed');
  assert.equal(await sha(repo, 'refs/heads/main'), owners); assert.equal(existsSync(join(repo, 'r.txt')), false);
  assert.deepEqual([run(staged.id).status, run(staged.id).mergeIntent], ['staged', undefined]);
  // The owner switches the folder to a branch of theirs at main's head: a fast-forward there would move their branch, not main.
  const switched = await whileChecking(async () => { await git(repo, 'switch', '-q', '-c', 'side'); });
  assert.equal(switched?.message, 'Target changed during verification; no merge performed');
  assert.deepEqual([await sha(repo, 'refs/heads/side'), await sha(repo, 'refs/heads/main')], [owners, owners]);
  assert.deepEqual([run(staged.id).status, run(staged.id).mergeIntent], ['staged', undefined]); assert.equal(deliveries(staged.id), 0);
  await git(repo, 'switch', '-q', 'main'); await git(repo, 'branch', '-D', 'side');
  assert.deepEqual(merges(), []);
});

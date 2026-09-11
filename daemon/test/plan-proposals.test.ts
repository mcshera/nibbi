import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { FixerOpts } from '../src/fixer.js';
import type { Proposal, ProposeOptions, SpawnStep } from '../src/plan-proposals.js';

const directory = mkdtempSync(join(tmpdir(), 'nibbi-plan-'));
process.env.NODE_ENV = 'test';
process.env.NIBBI_STATE_DIR = join(directory, 'state');
process.env.NIBBI_VAULT_DIR = join(directory, 'vault');
process.env.NIBBI_WORK_DIR = join(directory, 'work');
process.env.NIBBI_PROJECTS_DIR = join(directory, 'projects');
const { runtime, closeRuntime } = await import('../src/store.js');
const { planPath } = await import('../src/roadmap.js');
const { PLAN_INSTRUCTION, parseProposal, buildProposal, proposePlan, inspectProposal, listProposals, cancelPlan, executePlan, fingerprintFor } = await import('../src/plan-proposals.js');
const repo = join(directory, 'projects', 'demo'); mkdirSync(repo, { recursive: true });
runtime().put('config', 'projects', { demo: { repo, install: 'true', check: 'true' } });
const PLAN = '# Demo\n\nShip the demo.\n\n## M1 Core <!-- nibbi-milestone:m1 -->\n- [ ] Add login form <!-- nibbi-task:login -->\n- [x] Set up repo <!-- nibbi-task:setup -->\n- [ ] Add logout button <!-- nibbi-task:logout --> <!-- nibbi-issue-ref:iss1 -->\n';
mkdirSync(join(directory, 'vault', 'plans'), { recursive: true });
beforeEach(() => writeFileSync(planPath('demo'), PLAN));
after(() => { closeRuntime(); rmSync(directory, { recursive: true, force: true }); });

const notify = async (): Promise<void> => undefined;
const fence = (value: unknown): string => '```json\n' + JSON.stringify(value, null, 1) + '\n```';
const STEPS = [{ title: 'Login form', task: 'Build the login form with tests', taskId: 'login' }, { title: 'Logout button', task: 'Add a logout button', taskId: 'logout', context: 'Reuse the auth store', dependsOn: [1] }];
const REPLY = 'Two independent slices.\n\n' + fence({ summary: 'Login then logout', steps: STEPS }) + '\n';
const propose = (text = REPLY): Proposal => buildProposal('demo', 'ship auth', 'lead-1', text);
const events = (cursor: number, type: string) => runtime().replay(cursor).filter(event => event.type === type);
function fakeSpawn(failAt?: number): { calls: Array<{ project: string; issue: string; opts: FixerOpts }>; spawn: SpawnStep } {
  const calls: Array<{ project: string; issue: string; opts: FixerOpts }> = [];
  const spawn: SpawnStep = (project, issue, _notify, opts) => { calls.push({ project, issue, opts }); if (calls.length === failAt) throw new Error('Backend is shutting down'); return { id: 'fx-' + calls.length }; };
  return { calls, spawn };
}

test('parseProposal extracts the single json fence and keeps the rationale', () => {
  const parsed = parseProposal(REPLY);
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.rationale, 'Two independent slices.');
  assert.equal(parsed.parsed?.summary, 'Login then logout');
  assert.deepEqual(parsed.parsed?.steps, STEPS);
  const nullish = parseProposal(fence({ summary: 's', steps: [{ title: 't', task: 'do it', taskId: null, context: null, dependsOn: [] }] }));
  assert.deepEqual(nullish.parsed?.steps, [{ title: 't', task: 'do it' }]);
});

test('parseProposal rejects missing, doubled, malformed and out-of-shape fences', () => {
  assert.match(parseProposal('Just prose, no plan.').error!, /did not contain/);
  assert.equal(parseProposal('Just prose, no plan.').rationale, 'Just prose, no plan.');
  assert.match(parseProposal(fence({ summary: 'a', steps: STEPS }) + '\n' + fence({ summary: 'b', steps: STEPS })).error!, /exactly one/);
  assert.match(parseProposal('```json\n{ not json\n```').error!, /valid JSON/);
  assert.match(parseProposal(fence({ summary: 'a', steps: [] })).error!, /steps/);
  assert.match(parseProposal(fence({ summary: 'a', steps: [{ title: 'x'.repeat(121), task: 'y' }] })).error!, /title/);
  assert.match(parseProposal(fence({ summary: 'a', steps: [{ title: 'x', task: 'y', dependsOn: ['one'] }] })).error!, /dependsOn/);
  assert.match(parseProposal(fence({ summary: 'a', steps: Array.from({ length: 13 }, () => ({ title: 'x', task: 'y' })) })).error!, /steps/);
  assert.match(parseProposal(fence({ summary: 'x'.repeat(501), steps: STEPS })).error!, /summary/);
});

test('buildProposal pins existing undone tasks with milestone, issues and dependencies', () => {
  const cursor = runtime().cursor(), proposal = propose();
  assert.match(proposal.id, /^plan-[0-9a-f-]{36}$/);
  assert.equal(proposal.state, 'prepared');
  assert.equal(proposal.project, 'demo'); assert.equal(proposal.prompt, 'ship auth'); assert.equal(proposal.leadRunId, 'lead-1');
  assert.equal(proposal.rationale, 'Two independent slices.');
  assert.equal(proposal.expiresAt - proposal.createdAt, 30 * 60_000);
  assert.deepEqual(proposal.review.warnings, []);
  assert.deepEqual(proposal.steps, [
    { n: 1, title: 'Login form', issue: 'Build the login form with tests', taskId: 'login', taskText: 'Add login form', issueIds: [] },
    { n: 2, title: 'Logout button', issue: 'Add a logout button', taskId: 'logout', taskText: 'Add logout button', issueIds: ['iss1'], context: 'Reuse the auth store', dependsOn: [1] },
  ]);
  assert.deepEqual(proposal.review.steps, [
    { n: 1, title: 'Login form', task: { id: 'login', text: 'Add login form', milestone: 'M1 Core' }, issueIds: [], context: '', dependsOn: [] },
    { n: 2, title: 'Logout button', task: { id: 'logout', text: 'Add logout button', milestone: 'M1 Core' }, issueIds: ['iss1'], context: 'Reuse the auth store', dependsOn: [1] },
  ]);
  assert.equal(proposal.fingerprint, fingerprintFor(proposal.steps, proposal.review.roadmapRevision));
  assert.deepEqual(inspectProposal(proposal.id), proposal);
  const [event] = events(cursor, 'plan.proposed');
  assert.equal(event.projectId, 'demo');
  assert.deepEqual(event.payload, { id: proposal.id, steps: [{ n: 1, title: 'Login form', taskId: 'login' }, { n: 2, title: 'Logout button', taskId: 'logout' }] });
});

test('buildProposal keeps steps but drops done, unknown, duplicate task ids and stray dependencies with warnings', () => {
  const proposal = propose(fence({ summary: 'Mixed', steps: [
    { title: 'Done', task: 'Redo setup', taskId: 'setup' }, { title: 'Unknown', task: 'Mystery', taskId: 'nope' },
    { title: 'First login', task: 'Login A', taskId: 'login' }, { title: 'Second login', task: 'Login B', taskId: 'login', dependsOn: [4, 9] },
  ] }));
  assert.equal(proposal.state, 'prepared');
  assert.equal(proposal.steps.length, 4);
  assert.deepEqual(proposal.steps.map(step => step.taskId), [undefined, undefined, 'login', undefined]);
  assert.deepEqual(proposal.review.steps.map(step => step.task?.id ?? null), [null, null, 'login', null]);
  assert.deepEqual(proposal.steps[3].dependsOn, undefined);
  assert.equal(proposal.review.warnings.length, 4);
  assert.match(proposal.review.warnings[0], /Step 1: taskId "setup" is already done/);
  assert.match(proposal.review.warnings[1], /Step 2: taskId "nope" is not in the roadmap/);
  assert.match(proposal.review.warnings[2], /Step 4: taskId "login" is already pinned by step 3/);
  assert.match(proposal.review.warnings[3], /Step 4: dropped dependencies/);
});

test('buildProposal stores a failed record with the error and raw rationale when parsing fails', () => {
  const cursor = runtime().cursor(), proposal = propose('I would rather explain than plan.');
  assert.equal(proposal.state, 'failed');
  assert.match(proposal.error!, /did not contain/);
  assert.equal(proposal.rationale, 'I would rather explain than plan.');
  assert.deepEqual(proposal.steps, []);
  assert.equal(events(cursor, 'plan.proposed').length, 0);
  assert.deepEqual(events(cursor, 'plan.failed')[0].payload, { id: proposal.id, error: proposal.error });
});

test('fingerprint changes when the roadmap file changes even though the steps are identical', () => {
  const before = propose();
  appendFileSync(planPath('demo'), '- [ ] Extra <!-- nibbi-task:extra -->\n');
  const afterEdit = propose();
  assert.deepEqual(afterEdit.steps, before.steps);
  assert.notEqual(afterEdit.review.roadmapRevision, before.review.roadmapRevision);
  assert.notEqual(afterEdit.fingerprint, before.fingerprint);
});

test('executePlan dispatches every step with its exact pinned task and records results', async () => {
  const cursor = runtime().cursor(), proposal = propose(), { calls, spawn } = fakeSpawn();
  const executed = await executePlan(proposal.id, proposal.fingerprint, notify, spawn);
  assert.equal(executed.state, 'executed');
  assert.ok(executed.executedAt);
  assert.deepEqual(executed.results, [{ n: 1, runId: 'fx-1' }, { n: 2, runId: 'fx-2' }]);
  assert.deepEqual(calls.map(call => [call.project, call.issue, call.opts.taskId, call.opts.title, call.opts.context, call.opts.issueIds]), [
    ['demo', 'Build the login form with tests', 'login', 'Login form', undefined, []],
    ['demo', 'Add a logout button', 'logout', 'Logout button', 'Reuse the auth store', ['iss1']],
  ]);
  assert.deepEqual(inspectProposal(proposal.id), executed);
  const [event] = events(cursor, 'plan.executed');
  assert.equal(event.projectId, 'demo');
  assert.deepEqual(event.payload, { id: proposal.id, runIds: ['fx-1', 'fx-2'] });
});

test('repeated execute is idempotent and spawns once', async () => {
  const proposal = propose(), { calls, spawn } = fakeSpawn();
  const first = await executePlan(proposal.id, proposal.fingerprint, notify, spawn);
  const second = await executePlan(proposal.id, proposal.fingerprint, notify, spawn);
  assert.equal(calls.length, 2);
  assert.deepEqual(second, first);
});

test('an edited roadmap blocks execution with REVIEW_CHANGED and nothing is dispatched', async () => {
  const cursor = runtime().cursor(), proposal = propose(), { calls, spawn } = fakeSpawn();
  writeFileSync(planPath('demo'), PLAN.replace('[ ] Add login form', '[x] Add login form'));
  await assert.rejects(executePlan(proposal.id, proposal.fingerprint, notify, spawn), /^Error: REVIEW_CHANGED: the roadmap changed/);
  assert.equal(calls.length, 0);
  const current = inspectProposal(proposal.id);
  assert.equal(current.state, 'failed');
  assert.match(current.error!, /^REVIEW_CHANGED/);
  assert.equal(events(cursor, 'plan.failed').length, 1);
  await assert.rejects(executePlan(proposal.id, proposal.fingerprint, notify, spawn), /REVIEW_CHANGED/);
  assert.equal(calls.length, 0);
});

test('a stale approval fingerprint is refused without touching the prepared plan', async () => {
  const proposal = propose(), { calls, spawn } = fakeSpawn();
  await assert.rejects(executePlan(proposal.id, 'deadbeef', notify, spawn), /^Error: REVIEW_CHANGED/);
  assert.equal(calls.length, 0);
  assert.equal(inspectProposal(proposal.id).state, 'prepared');
  assert.equal((await executePlan(proposal.id, proposal.fingerprint, notify, spawn)).state, 'executed');
  assert.equal(calls.length, 2);
});

test('expired plans are rejected and marked expired on read', async () => {
  const proposal = propose(), { calls, spawn } = fakeSpawn();
  runtime().put('plan-proposals', proposal.id, { ...proposal, expiresAt: Date.now() - 1 });
  await assert.rejects(executePlan(proposal.id, proposal.fingerprint, notify, spawn), /^Error: PLAN_EXPIRED/);
  assert.equal(calls.length, 0);
  assert.equal(inspectProposal(proposal.id).state, 'expired');
  const other = propose();
  runtime().put('plan-proposals', other.id, { ...other, expiresAt: Date.now() - 1 });
  assert.equal(listProposals('demo').find(item => item.id === other.id)?.state, 'expired');
  assert.throws(() => cancelPlan(other.id), /PLAN_EXPIRED/);
});

test('cancel moves a prepared plan to cancelled and blocks execution', async () => {
  const cursor = runtime().cursor(), proposal = propose(), { calls, spawn } = fakeSpawn();
  assert.equal(cancelPlan(proposal.id).state, 'cancelled');
  assert.deepEqual(events(cursor, 'plan.cancelled')[0].payload, { id: proposal.id });
  assert.equal(events(cursor, 'plan.cancelled')[0].projectId, 'demo');
  await assert.rejects(executePlan(proposal.id, proposal.fingerprint, notify, spawn), /^Error: PLAN_CANCELLED/);
  assert.equal(calls.length, 0);
  assert.throws(() => cancelPlan(proposal.id), /PLAN_CANCELLED/);
  assert.throws(() => inspectProposal('plan-missing'), /Unknown plan/);
});

test('a spawn error records a failed plan with partial results', async () => {
  const cursor = runtime().cursor(), proposal = propose(), { calls, spawn } = fakeSpawn(2);
  await assert.rejects(executePlan(proposal.id, proposal.fingerprint, notify, spawn), /shutting down/);
  assert.equal(calls.length, 2);
  const failed = inspectProposal(proposal.id);
  assert.equal(failed.state, 'failed');
  assert.deepEqual(failed.results, [{ n: 1, runId: 'fx-1' }]);
  assert.equal(failed.error, 'Backend is shutting down');
  assert.deepEqual(events(cursor, 'plan.failed')[0].payload, { id: proposal.id, error: 'Backend is shutting down', runIds: ['fx-1'] });
  await assert.rejects(executePlan(proposal.id, proposal.fingerprint, notify, spawn), /shutting down/);
  assert.equal(calls.length, 2);
});

test('a plan interrupted by a restart settles as failed instead of blocking forever', async () => {
  const cursor = runtime().cursor(), proposal = propose(), { calls, spawn } = fakeSpawn();
  runtime().claimCommand('plan-execute:' + proposal.id, { id: proposal.id, fingerprint: proposal.fingerprint });
  runtime().put('plan-proposals', proposal.id, { ...proposal, state: 'executing' });
  runtime().interruptCommands();
  await assert.rejects(executePlan(proposal.id, proposal.fingerprint, notify, spawn), /^Error: PLAN_INTERRUPTED/);
  const failed = inspectProposal(proposal.id);
  assert.equal(failed.state, 'failed');
  assert.match(failed.error!, /^PLAN_INTERRUPTED/);
  assert.equal(events(cursor, 'plan.failed').length, 1);
  await assert.rejects(executePlan(proposal.id, proposal.fingerprint, notify, spawn), /PLAN_INTERRUPTED/);
  assert.equal(calls.length, 0);
});

test('executePlan never integrates branches', () => {
  const source = readFileSync(new URL('../src/plan-proposals.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /merge|approveFixer|integrate\(|mergeGroup/i);
});

test('proposePlan runs one dispatch-free lead turn with the planning instruction and records the lead run id', async () => {
  const calls: Array<{ prompt: string; channel: string; fast: boolean | undefined; options: Parameters<ProposeOptions['runTurn']>[8] }> = [];
  const runTurn: ProposeOptions['runTurn'] = async (prompt, _onText, channel = 'cli', _model, onDelta, _onTool, _images, fast, options) => {
    calls.push({ prompt, channel, fast, options }); options?.onStart?.('lead-run-9'); onDelta?.('streamed'); return { text: REPLY, isError: false };
  };
  const deltas: string[] = [], ref: { current?: string } = {};
  const { result, proposal } = await proposePlan('demo', 'ship auth', { runTurn, onDelta: text => { deltas.push(text); }, leadRunIdRef: ref });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].prompt, 'ship auth\n\n' + PLAN_INSTRUCTION);
  assert.equal(calls[0].channel, 'app');
  assert.equal(calls[0].fast, true);
  assert.equal(calls[0].options?.project, 'demo');
  assert.equal(calls[0].options?.allowDispatch, false);
  assert.deepEqual(deltas, ['streamed']);
  assert.equal(ref.current, 'lead-run-9');
  assert.equal(result.text, REPLY);
  assert.equal(proposal.leadRunId, 'lead-run-9');
  assert.equal(proposal.state, 'prepared');
  assert.equal(proposal.prompt, 'ship auth');
  await assert.rejects(proposePlan('Bad Project', 'x', { runTurn }), /Invalid project/);
  assert.equal(calls.length, 1);
});

test('a failed lead turn stores the turn error rather than a missing-fence complaint', async () => {
  const cursor = runtime().cursor();
  const runTurn: ProposeOptions['runTurn'] = async () => ({ text: 'The primary provider is usage-limited. LOCAL chat only — Local model unavailable.', isError: true });
  const { proposal } = await proposePlan('demo', 'ship auth', { runTurn });
  assert.equal(proposal.state, 'failed');
  assert.equal(proposal.error, 'The primary provider is usage-limited. LOCAL chat only — Local model unavailable.');
  assert.deepEqual(proposal.steps, []);
  assert.deepEqual(events(cursor, 'plan.failed')[0].payload, { id: proposal.id, error: proposal.error });
  assert.equal(events(cursor, 'plan.proposed').length, 0);
});

test('listProposals filters by project, newest first, bounded by limit', () => {
  const older = propose(), newer = buildProposal('other', 'elsewhere', 'lead-2', REPLY);
  const demo = listProposals('demo');
  assert.ok(demo.every(item => item.project === 'demo'));
  assert.ok(demo.some(item => item.id === older.id));
  assert.ok(!demo.some(item => item.id === newer.id));
  assert.equal(listProposals(undefined, 1).length, 1);
  assert.equal(listProposals(undefined, 1)[0].id, newer.id);
  const all = listProposals();
  for (let index = 1; index < all.length; index++) assert.ok(all[index - 1].createdAt >= all[index].createdAt);
});

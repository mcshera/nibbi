// The control panel's model (public/lib/builds-model.js), against pure fixtures shaped like the daemon's
// records: Fixer rows as S.fixers holds them (fixer.ts:28-41, with read-models.ts's github summary), the
// builds section's runView extras (project-workspace.ts:32) and the issues section's items (:55-70).
// docs/CONTROL-PANEL.md §3–§5 is what these hold it to.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMain, ticketOf, improvementIdForRun, mergeRuns, conversationsFor, previewText, splitImprovementText, parseDiffstat,
} from '../public/lib/builds-model.js';
import { RUN_STATES, STATE_WORDS, STATE_TONES, GROUPS, WORDS, BADGE, PAGE_LIMITS } from '../public/lib/control-panel-contract.js';

const NOW = Date.parse('2026-09-28T12:00:00.000Z');
const ago = minutes => new Date(NOW - minutes * 60_000).toISOString();
const REV = 'a'.repeat(64);
const ALL_REVIEW = ['run.verify', 'run.discard', 'preview.start', 'run.merge'];

const run = (id, extra = {}) => ({
  id, game: 'garden', project: 'garden', title: 'title ' + id, issue: 'do ' + id, branch: 'nibbi/' + id, worktree: '/work/' + id,
  targetBranch: 'main', status: 'staged', startedAt: ago(30), endedAt: ago(20), verification: { status: 'unverified' },
  github: { mode: 'local' }, attemptId: 'attempt-' + id, ...extra,
});
/** The builds section's copy of a run: the same record plus what only the read knows. */
const read = (r, allowedActions = [], extra = {}) => ({ ...r, allowedActions, preview: { running: false }, groupStatus: 'review', ...extra });
const item = (id, text, extra = {}) => ({
  id, text, title: text, done: false, checked: false, explicit: true, heading: 'Garden issues', description: '', issueIds: [],
  githubIssueLinks: [], linkedTaskIds: [], linkedBuilds: [], line: 3, ...extra,
});
const input = (over = {}) => ({
  project: { name: 'garden', branch: 'main', lastCommit: 'a1b2c3d tidy the beds (2 hours ago)', check: 'npm test', github: null },
  runs: [], sectionRuns: null, issues: { status: 'ready', revision: REV, items: [] }, list: 'ready',
  play: { running: false, playable: true, kind: 'server' }, maxConcurrent: 2, busy: false, demo: false, now: NOW, ...over,
});
/** One run, its section read agreeing, as the page sees it once the read lands. */
const withRead = (r, allowed = ALL_REVIEW, over = {}) => input({ runs: [r], sectionRuns: [read(r, allowed)], ...over });
const only = model => { assert.equal(model.improvements.length + model.settled.length, 1, 'one improvement'); return model.improvements[0] || model.settled[0]; };
const keys = ticket => ticket.actions.map(a => a.key);
const action = (ticket, key) => ticket.actions.find(a => a.key === key);
const inks = ticket => ticket.actions.filter(a => a.tone === 'ink').map(a => a.key);

function deepFreeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const v of Object.values(value)) deepFreeze(v); } return value; }

/* ------------------------------------------------------------------------------------------ §4.1 */

test('every run status is one state, one word, one tone, one group and one line-two verb (§4.1)', () => {
  const table = {
    queued: ['up_next', 'up_next', 'queued'], preparing: ['building', 'building', 'started'], installing: ['building', 'building', 'started'],
    running: ['building', 'building', 'started'], checking: ['building', 'building', 'started'], verifying: ['building', 'building', 'started'],
    merging: ['building', 'building', 'started'], awaiting_input: ['needs_you', 'waiting', 'asked you'], staged: ['ready', 'waiting', 'staged'],
    done: ['ready', 'waiting', 'staged'], merged: ['in', 'in', 'landed'], failed: ['failed', 'failed', 'failed'],
    interrupted: ['interrupted', 'failed', 'stopped'], cancelled: ['stopped', 'settled', 'stopped'], discarded: ['discarded', 'settled', 'discarded'],
  };
  assert.deepEqual(Object.keys(table).sort(), Object.keys(RUN_STATES).filter(s => RUN_STATES[s] !== null).sort(), 'the table covers RUN_STATES');
  for (const [status, [state, group, verb]] of Object.entries(table)) {
    const vm = only(buildMain(input({ runs: [run('r', { status })] })));
    assert.equal(vm.state, state, status);
    assert.equal(vm.word, STATE_WORDS[state], status);
    assert.equal(vm.tone, STATE_TONES[state], status);
    assert.equal(vm.group, group, status);
    assert.equal(vm.live, state === 'building', status);
    assert.equal(vm.when?.verb, verb, status);
    assert.equal(vm.id, 'run:r'); assert.equal(vm.kind, 'run'); assert.deepEqual(vm.runIds, ['r']); assert.equal(vm.latestRunId, 'r');
  }
  // the words the orchestrator fixed (D4), and colour only on machine verdicts
  assert.equal(only(buildMain(input({ runs: [run('r', { status: 'awaiting_input' })] }))).word, 'needs you');
  assert.equal(only(buildMain(input({ runs: [run('r', { status: 'staged' })] }))).word, 'ready to review');
  assert.equal(only(buildMain(input({ runs: [run('r', { status: 'merged' })] }))).tone, 'pass');
  assert.equal(only(buildMain(input({ runs: [run('r', { status: 'failed' })] }))).tone, 'error');
});

test('line two says when in the state’s own time: queued at its start, building since the attempt, landed at the merge', () => {
  const queued = only(buildMain(input({ runs: [run('q', { status: 'queued', startedAt: ago(2), endedAt: undefined })] })));
  assert.deepEqual(queued.when, { verb: 'queued', at: ago(2) });
  const building = only(buildMain(input({ runs: [run('b', { status: 'running', startedAt: ago(90), latestAttemptStartedAt: ago(4), endedAt: undefined })] })));
  assert.deepEqual(building.when, { verb: 'started', at: ago(4) });
  // a GitHub completion keeps the staging endedAt (github-builds.ts:265); the receipt's mergedAt is when it landed
  const landed = only(buildMain(input({ runs: [run('m', { status: 'merged', endedAt: ago(300), remoteMerge: { mergedAt: ago(10), prNumber: 12 }, github: { mode: 'github', delivery: 'merged' } })] })));
  assert.deepEqual(landed.when, { verb: 'landed', at: ago(10) });
  const noTime = only(buildMain(input({ runs: [run('x', { status: 'failed', startedAt: undefined, endedAt: undefined })] })));
  assert.equal(noTime.when, null);
});

test('a superseded run is an earlier try, never a state: it says “replaced” on its card', () => {
  const t = ticketOf(input({ runs: [run('r1', { status: 'superseded' }), run('r2', { status: 'failed', replacesBuildId: 'r1', startedAt: ago(10), endedAt: ago(5), summary: 'type error in beds.ts' })] }), 'run:r1');
  assert.equal(t.attempts[0].word, 'replaced'); assert.equal(t.attempts[0].tone, 'quiet');
  assert.equal(t.improvement.state, 'failed');
  // alone (its replacement is not in the list), the chain settles as discarded: its work kept, try again offered
  const alone = buildMain(input({ runs: [run('r1', { status: 'superseded' })] }));
  assert.equal(alone.improvements.length, 0); assert.equal(alone.settled[0].state, 'discarded');
  assert.deepEqual(keys(ticketOf(input({ runs: [run('r1', { status: 'superseded' })] }), 'run:r1')), ['retry']);
});

test('interrupted is not a verdict: its own word in ink, in the failed group, never the failed colour', () => {
  const m = buildMain(input({ runs: [run('i', { status: 'interrupted', summary: 'Backend stopped mid-run. Work retained; inspect before an explicit retry.' })] }));
  const vm = only(m);
  assert.equal(vm.word, 'interrupted'); assert.equal(vm.tone, 'attention'); assert.equal(vm.group, 'failed');
  assert.equal(vm.reason, 'Backend stopped mid-run. Work retained; inspect before an explicit retry.');
  assert.deepEqual(m.badge, { text: '1 interrupted', tone: 'attention' });
  assert.equal(m.counts.failed, 0); assert.equal(m.counts.interrupted, 1);
  const t = ticketOf(input({ runs: [run('i', { status: 'interrupted' })] }), 'run:i');
  assert.equal(t.statusLine, 'the backend stopped mid-run — its work is kept; try again when you’re ready');
  assert.deepEqual(keys(t), ['ask', 'discard', 'retry']); assert.deepEqual(inks(t), ['retry']);
  assert.equal(action(t, 'discard').blocked, WORDS.reading, 'discard waits on the read that says the run allows it');
  // a failed one outranks it in the badge, in the verdict colour
  assert.deepEqual(buildMain(input({ runs: [run('i', { status: 'interrupted' }), run('f', { status: 'failed' })] })).badge, { text: '1 failed', tone: 'error' });
});

test('awaiting_input asks for you: the badge, the status line, guide it in ink when the run takes steering', () => {
  const asking = run('a', { status: 'awaiting_input', endedAt: undefined });
  const m = buildMain(input({ runs: [asking] }));
  assert.deepEqual(m.badge, { text: '1 needs you', tone: 'attention' }); assert.deepEqual(m.attention, m.badge);
  assert.equal(m.counts.needsYou, 1); assert.equal(m.counts.waiting, 1);
  const t = ticketOf(withRead(asking, ['run.stop', 'run.steer']), 'run:a');
  assert.equal(t.statusLine, 'it stopped to ask you something — guide it, or stop it');
  assert.deepEqual(keys(t), ['guide', 'stop']); assert.deepEqual(inks(t), ['guide']);
  assert.equal(action(t, 'guide').opens, 'form'); assert.deepEqual(action(t, 'guide').payload, { runId: 'a', text: '' });
  assert.deepEqual(action(t, 'stop').confirm, { words: 'stop try 1? what it has done so far stays in its worktree — main is unchanged.', yes: 'stop it', no: 'keep building', armed: true });
  // not steerable: guide is not drawn; not read yet: drawn, waiting on the read
  assert.deepEqual(keys(ticketOf(withRead(asking, ['run.stop']), 'run:a')), ['stop']);
  assert.equal(action(ticketOf(input({ runs: [asking] }), 'run:a'), 'guide').blocked, WORDS.reading);
});

test('a building try says what it is doing, how long, which try; stop asks twice; nothing is ink', () => {
  const r = run('b', { status: 'running', startedAt: ago(10), latestAttemptStartedAt: ago(4), endedAt: undefined });
  const t = ticketOf(input({ runs: [r], sectionRuns: [read(r, ['run.stop', 'run.steer'], { currentActivity: 'Reading beds.ts\n\nwrite_file src/beds.ts' })] }), 'run:b');
  assert.equal(t.statusLine, 'write_file src/beds.ts · 4m in · try 1');
  assert.equal(t.attempts[0].activity, 'write_file src/beds.ts'); assert.equal(t.attempts[0].live, true); assert.equal(t.attempts[0].endedAt, null);
  assert.deepEqual(keys(t), ['guide', 'stop']); assert.deepEqual(inks(t), []);
  const quiet = ticketOf(input({ runs: [run('v', { status: 'verifying', latestAttemptStartedAt: ago(1), endedAt: undefined })] }), 'run:v');
  assert.equal(quiet.statusLine, 'running the checks · 1m in · try 1');
  assert.equal(ticketOf(input({ runs: [run('n', { status: 'installing', latestAttemptStartedAt: ago(0.5), endedAt: undefined })] }), 'run:n').statusLine, 'installing · 30s in · try 1');
});

test('a queued run is up next: it waits for a slot, and cancelling it asks nothing (nothing ran)', () => {
  const q = run('q', { status: 'queued', startedAt: ago(1), endedAt: undefined });
  const t = ticketOf(withRead(q, ['run.stop']), 'run:q');
  assert.equal(t.improvement.state, 'up_next'); assert.equal(t.statusLine, 'queued — it starts when one of the 2 slots frees');
  assert.deepEqual(t.actions.map(a => [a.key, a.action, a.label, a.tone, a.confirm]), [['cancel', 'stopRun', 'cancel it', 'seated', null]]);
  assert.equal(ticketOf(withRead(q, ['run.stop'], { maxConcurrent: 1 }), 'run:q').statusLine, 'queued — it starts when its one slot frees');
  assert.deepEqual(t.attempts[0].steps.map(s => s.state), ['waiting', 'waiting', 'waiting', 'waiting']);
});

/* ------------------------------------------------------------------------------------------ §4.2 */

test('each GitHub flag on a staged run decides its state, first flag first; none is “ready” (§4.2)', () => {
  const gh = (flags, extra = {}) => run('g', { workflowMode: 'github', targetBranch: 'v2', commitSha: 'c0ffee1234567890', verification: { status: 'passed', command: 'npm test' },
    github: { mode: 'github', baseBranch: 'v2', delivery: 'pull_request', pr: { number: 12, url: 'https://github.com/owner/garden/pull/12', draft: false }, checks: { status: 'blocked', blockers: ['ci: in_progress'] }, toPush: false, pullRequest: false, readyPR: false, needsAttention: false, remoteChanged: false, ...flags }, ...extra });
  const cases = [
    [{ needsAttention: true }, 'needs_attention', 'pull request #12 needs a look — ci: in_progress'],
    [{ remoteChanged: true, pullRequest: true, notice: 'Remote branch changed: the pull request has commits Nibbi did not publish.' }, 'needs_attention', 'Remote branch changed: the pull request has commits Nibbi did not publish.'],
    [{ readyPR: true, pullRequest: true }, 'pr_ready', 'pull request #12 is ready to merge — it merges on GitHub'],
    [{ pullRequest: true, toPush: true }, 'pull_request', 'pull request #12 is open — it merges on GitHub'],
    [{ toPush: true, pr: undefined }, 'to_push', 'checks passed here — push it to open a pull request'],
    [{ pr: undefined, delivery: 'published' }, 'ready', 'pushed — open a pull request from its github steps'],
    [{ needsAttention: true, readyPR: true, pullRequest: true }, 'needs_attention', null],
  ];
  const project = { name: 'garden', branch: 'v2', check: 'npm test', lastCommit: '', github: { workflowMode: 'github', repository: 'owner/garden', integrationBranch: 'v2', releaseBranch: 'main' } };
  for (const [flags, state, line] of cases) {
    const r = gh(flags), m = buildMain(withRead(r, ['run.discard', 'run.verify'], { project }));
    assert.equal(only(m).state, state, JSON.stringify(flags));
    const t = ticketOf(withRead(r, ['run.discard', 'run.verify'], { project }), 'run:g');
    if (line) assert.equal(t.statusLine, line, JSON.stringify(flags));
    // run.merge is never offered in GitHub mode (fixer.ts:156): the one ink key selects the GitHub tab
    assert.deepEqual(keys(t), ['github-steps', 'discard'], JSON.stringify(flags));
    assert.deepEqual(inks(t), ['github-steps']);
    assert.equal(action(t, 'github-steps').tab, 'github');
    assert.equal(t.attempts[0].initialTab, 'github'); assert.ok(t.attempts[0].tabs.includes('github'));
    assert.equal(t.attempts[0].github.prNumber, 'pr' in flags ? null : 12);
  }
  const m = buildMain(withRead(gh({ pullRequest: true }), [], { project }));
  assert.deepEqual(m.badge, { text: '1 pull request open', tone: 'attention' });
  assert.equal(m.branch, 'v2'); assert.equal(m.line, 'live · lands on v2');
  assert.deepEqual(m.github, { mode: 'github', repository: 'owner/garden', integrationBranch: 'v2', releaseBranch: 'main' });
  const t = ticketOf(withRead(gh({ pullRequest: true }), [], { project }), 'run:g');
  assert.equal(t.attempts[0].target, 'v2'); assert.equal(t.attempts[0].branch, 'nibbi/g');
  assert.deepEqual(t.attempts[0].checks, [{ name: 'npm test', ok: true, note: '' }, { name: 'github checks', ok: null, note: 'ci: in_progress' }]);
  assert.equal(t.facts.find(f => f.label === 'checks').value, 'passed · github waiting');
});

test('GitHub merges land as “in”, in their own words; a local merge in a GitHub project says it isn’t on GitHub yet', () => {
  const merged = run('m', { status: 'merged', workflowMode: 'github', targetBranch: 'v2', remoteMerge: { prNumber: 12, prUrl: 'https://github.com/o/g/pull/12', baseBranch: 'v2', mergedAt: ago(60) },
    github: { mode: 'github', delivery: 'merged', baseBranch: 'v2', pr: { number: 12, url: 'https://github.com/o/g/pull/12' }, checks: { status: 'passed', blockers: [] } } });
  const t = ticketOf(input({ runs: [merged] }), 'run:m');
  assert.equal(t.improvement.state, 'in'); assert.equal(t.statusLine, 'merged into v2 via pull request #12');
  assert.equal(t.attempts[0].checks[1].ok, true);
  const here = run('h', { status: 'merged', commitSha: 'f'.repeat(40), github: { mode: 'local', delivery: 'local_merge_unpublished', toPush: true, pullRequest: false, readyPR: false, needsAttention: false } });
  const th = ticketOf(input({ runs: [here] }), 'run:h');
  assert.equal(th.improvement.state, 'in'); assert.equal(th.statusLine, 'merged here — not on GitHub yet');
  assert.equal(th.attempts[0].github.mode, 'local'); assert.ok(th.attempts[0].tabs.includes('github'));
  // a failed GitHub check is a verdict; blocked alone is waiting
  const failing = run('x', { status: 'staged', github: { mode: 'github', needsAttention: true, pullRequest: true, checks: { status: 'blocked', blockers: ['ci: failure'] } } });
  assert.equal(ticketOf(input({ runs: [failing] }), 'run:x').attempts[0].checks[1].ok, false);
});

/* ------------------------------------------------------------------------------------------ §4.3, §4.4 */

test('a retry chain is one ticket with two tries, whichever run a notification names (§4.4)', () => {
  const r1 = run('r1', { status: 'superseded', startedAt: ago(60), endedAt: ago(50), summary: 'first attempt' });
  const r2 = run('r2', { status: 'staged', replacesBuildId: 'r1', startedAt: ago(20), endedAt: ago(5), title: 'title r1', commitSha: 'b'.repeat(40), diffstat: ' 1 file changed, 2 insertions(+)' });
  const m = buildMain(input({ runs: [r2, r1] }));
  assert.equal(m.improvements.length, 1);
  const vm = m.improvements[0];
  assert.equal(vm.id, 'run:r1'); assert.deepEqual(vm.runIds, ['r1', 'r2']); assert.equal(vm.latestRunId, 'r2'); assert.equal(vm.state, 'ready');
  assert.equal(improvementIdForRun([r1, r2], [], 'r2'), 'run:r1'); assert.equal(improvementIdForRun([r1, r2], [], 'r1'), 'run:r1');
  const t = ticketOf(input({ runs: [r1, r2] }), 'run:r1');
  assert.deepEqual(t.attempts.map(a => [a.n, a.runId, a.word]), [[1, 'r1', 'replaced'], [2, 'r2', 'ready to review']]);
  assert.equal(t.facts.find(f => f.label === 'tries').value, '2');
  // a missing link ends the chain there: runs that still exist
  const r3 = run('r3', { status: 'failed', replacesBuildId: 'gone' });
  assert.equal(improvementIdForRun([r3], null, 'r3'), 'run:r3');
  // a cycle cannot hang it
  assert.ok(['run:c1', 'run:c2'].includes(improvementIdForRun([run('c1', { replacesBuildId: 'c2' }), run('c2', { replacesBuildId: 'c1' })], null, 'c1')));
  assert.equal(improvementIdForRun([r3], null, 'nope'), null);
});

test('an issue is its item plus every run that names it; a run naming two issues is a try in both (§4.3)', () => {
  const both = run('two', { status: 'running', issueIds: ['i-a', 'i-b'], endedAt: undefined, latestAttemptStartedAt: ago(3) });
  const issues = { status: 'ready', revision: REV, items: [item('i-a', 'seedlings overlap'), item('i-b', 'rows drift', { line: 5 })] };
  const m = buildMain(input({ runs: [both], issues }));
  assert.deepEqual(m.improvements.map(vm => [vm.id, vm.kind, vm.state, vm.title, vm.issueId]), [
    ['issue:i-a', 'issue', 'building', 'seedlings overlap', 'i-a'], ['issue:i-b', 'issue', 'building', 'rows drift', 'i-b']]);
  assert.deepEqual(ticketOf(input({ runs: [both], issues }), 'issue:i-b').attempts.map(a => a.runId), ['two']);
  assert.equal(improvementIdForRun([both], issues.items, 'two'), 'issue:i-a');
  assert.equal(improvementIdForRun([both], issues, 'two'), 'issue:i-a', 'the section object works too');
  assert.equal(improvementIdForRun([both], [item('i-b', 'rows drift')], 'two'), 'issue:i-b', 'the first still in issues.md');
  assert.equal(improvementIdForRun([both], null, 'two'), 'issue:i-a', 'the first at all while the list is unread');
  assert.equal(improvementIdForRun([both], [], 'two'), 'run:two', 'none left: its own chain');
});

test('an open issue with no try is up next: it waits, in words; build it now is the one ink key', () => {
  const issues = { status: 'ready', revision: REV, items: [item('i', 'seedlings overlap', { description: 'Two seedlings share a cell.\nSee row 3.', githubIssueLinks: [
    { issueId: 'i', repository: 'owner/paper-garden', number: 7, url: 'https://github.com/owner/paper-garden/issues/7' }, { issueId: 'i', repository: 'x/y', number: 8, url: 'javascript:alert(1)' }] })] };
  const m = buildMain(input({ issues }));
  const vm = only(m);
  assert.equal(vm.state, 'up_next'); assert.equal(vm.when, null); assert.equal(vm.context, 'Garden issues');
  const t = ticketOf(input({ issues }), 'issue:i');
  assert.equal(t.statusLine, 'it waits here until you start it — nothing builds it on its own');
  assert.deepEqual(t.actions.map(a => [a.key, a.action, a.label, a.tone]), [
    ['edit', 'editImprovement', 'edit the words', 'seated'], ['mark-done', 'completeImprovement', 'mark it done', 'seated'], ['build-now', 'buildIssue', 'build it now', 'ink']]);
  // the words carry the list's revision they were read at: a save after the list moved is refused, not written over it
  assert.deepEqual(action(t, 'edit').payload, { issueId: 'i', title: 'seedlings overlap', description: 'Two seedlings share a cell.\nSee row 3.', revision: REV });
  assert.equal(action(t, 'edit').opens, 'form');
  assert.deepEqual(action(t, 'build-now').payload, { issueId: 'i' });
  assert.deepEqual(t.asked, { text: 'seedlings overlap', description: 'Two seedlings share a cell.\nSee row 3.', context: '', at: null, source: 'issue' });
  assert.deepEqual(t.links, [{ label: 'GitHub issue · owner/paper-garden #7', url: 'https://github.com/owner/paper-garden/issues/7' }], 'only http(s) links');
  assert.deepEqual(t.attempts, []);
  assert.deepEqual(t.facts.map(f => [f.label, f.value]), [['build', 'main'], ['asked', 'from issues.md'], ['tries', 'none yet'], ['time', 'not started'], ['changes', 'none yet'], ['checks', 'not run yet']]);
  // with no heading, the description's first line; marked in progress, it says so
  assert.equal(only(buildMain(input({ issues: { ...issues, items: [item('i', 's', { heading: null, description: 'Two seedlings share a cell.\nSee row 3.' })] } }))).context, 'Two seedlings share a cell.');
  assert.equal(only(buildMain(input({ issues: { ...issues, items: [item('i', 's', { boardStatus: 'in-progress' })] } }))).context, 'you marked it in progress');
});

test('an open issue whose last try was stopped or discarded is up next again, and says why', () => {
  for (const status of ['cancelled', 'discarded']) {
    const r = run('r', { status, issueIds: ['i'] });
    const t = ticketOf(input({ runs: [r], issues: { status: 'ready', revision: REV, items: [item('i', 'rows drift')] } }), 'issue:i');
    assert.equal(t.improvement.state, 'up_next');
    assert.equal(t.improvement.context, status === 'cancelled' ? 'its last try was stopped' : 'its last try was discarded');
    assert.equal(t.improvement.when, null);
    assert.deepEqual(keys(t), ['edit', 'mark-done', 'build-now']);
    assert.equal(t.attempts.length, 1);
  }
  // a free-text chain keeps its own words
  assert.equal(only(buildMain(input({ runs: [run('r', { status: 'cancelled' })] }))).state, 'stopped');
});

test('a done issue is in when a try merged, done when none did; an open issue with a merged try is in (§4.3)', () => {
  const doneItem = item('i', 'rows drift', { done: true, checked: true });
  const merged = run('m', { status: 'merged', issueIds: ['i'], endedAt: ago(120), commitSha: 'd'.repeat(40), diffstat: ' 2 files changed, 5 insertions(+), 1 deletion(-)' });
  const later = run('f', { status: 'failed', issueIds: ['i'], startedAt: ago(10), endedAt: ago(5) });
  const inTicket = ticketOf(input({ runs: [merged, later], issues: { status: 'ready', revision: REV, items: [doneItem] } }), 'issue:i');
  assert.equal(inTicket.improvement.state, 'in'); assert.deepEqual(inTicket.improvement.when, { verb: 'landed', at: ago(120) });
  assert.equal(inTicket.statusLine, 'in main since 2h · landed with try 1');
  assert.deepEqual(keys(inTicket), ['see-changes']); assert.equal(action(inTicket, 'see-changes').tab, 'changes');
  assert.deepEqual(action(inTicket, 'see-changes').payload, { id: 'm', kind: 'changes', attemptId: 'attempt-m' });

  const done = ticketOf(input({ issues: { status: 'ready', revision: REV, items: [doneItem] } }), 'issue:i');
  assert.equal(done.improvement.state, 'done'); assert.equal(done.improvement.group, 'settled');
  assert.equal(done.statusLine, 'marked done in issues.md'); assert.deepEqual(keys(done), ['reopen']);
  const m = buildMain(input({ issues: { status: 'ready', revision: REV, items: [doneItem] } }));
  assert.equal(m.improvements.length, 0); assert.equal(m.settled[0].state, 'done');

  const open = ticketOf(input({ runs: [merged], issues: { status: 'ready', revision: REV, items: [item('i', 'rows drift')] } }), 'issue:i');
  assert.equal(open.improvement.state, 'in', 'the completion write failed (fixer.ts:353), the work still landed');
});

test('a done issue with a try still in play shows that try, so a running agent never leaves the bar', () => {
  const building = run('b', { status: 'running', issueIds: ['i'], endedAt: undefined });
  const vm = only(buildMain(input({ runs: [building], issues: { status: 'ready', revision: REV, items: [item('i', 'rows drift', { done: true })] } })));
  assert.equal(vm.state, 'building'); assert.equal(vm.group, 'building');
});

test('a run whose issue left issues.md is its own chain in the bar; the old issue ticket still renders from it (§4.4)', () => {
  const r = run('r', { status: 'failed', issueIds: ['gone-one'], title: 'seedlings overlap', summary: 'No changes produced; nothing to stage' });
  const issues = { status: 'ready', revision: REV, items: [item('other', 'rows drift')] };
  const m = buildMain(input({ runs: [r], issues }));
  const vm = m.improvements.find(v => v.kind === 'run');
  assert.equal(vm.id, 'run:r'); assert.equal(vm.context, 'its note is gone from issues.md');
  const t = ticketOf(input({ runs: [r], issues }), 'issue:gone-one');
  assert.equal(t.gone, false); assert.equal(t.improvement.id, 'issue:gone-one'); assert.equal(t.improvement.state, 'failed');
  assert.equal(t.improvement.context, 'its note is gone from issues.md'); assert.equal(t.improvement.title, 'seedlings overlap');
  assert.equal(t.statusLine, 'No changes produced; nothing to stage — main is unchanged');
  assert.deepEqual(keys(t), ['ask', 'discard', 'retry'], 'its note is gone, so there are no words to edit or box to tick');
  // nothing names it any more: gone, only × stays
  const gone = ticketOf(input({ issues }), 'issue:nobody');
  assert.equal(gone.gone, true); assert.equal(gone.statusLine, WORDS.gone); assert.deepEqual(gone.actions, []); assert.deepEqual(gone.attempts, []);
  assert.equal(ticketOf(input(), 'run:nobody').gone, true);
  assert.equal(ticketOf(input(), 'nonsense').gone, true);
  // not read yet: it may well exist, so the page waits in words instead of saying gone
  const waiting = ticketOf(input({ issues: null, list: 'loading' }), 'issue:later');
  assert.equal(waiting.gone, false); assert.equal(waiting.statusLine, WORDS.reading); assert.deepEqual(waiting.actions, []);
  assert.equal(ticketOf(input({ issues: null, list: 'unavailable' }), 'issue:later').statusLine, WORDS.noList);
});

/* ------------------------------------------------------------------------------------------ §4.5 the ticket */

test('a local staged try: play it, approve & merge asking twice, discard armed, verify it while unverified', () => {
  const r = run('s', { status: 'staged', commitSha: 'a1b2c3d4e5f6a7b8', verification: { status: 'passed', command: 'npm test' }, costUsd: 0.38, diffstat: ' 3 files changed, 67 insertions(+), 9 deletions(-)' });
  const t = ticketOf(withRead(r), 'run:s');
  assert.equal(t.statusLine, 'checks passed on a1b2c3d — play it, then merge it or discard it');
  assert.deepEqual(keys(t), ['play-run', 'merge', 'discard']); assert.deepEqual(inks(t), ['play-run']);
  assert.deepEqual(action(t, 'play-run').payload, { runId: 's', action: 'start' });
  assert.equal(action(t, 'merge').blocked, '');
  assert.deepEqual(action(t, 'merge').confirm, { words: 'merge “title s” into main? nibbi runs the checks again on the merged code first.', yes: 'confirm merge', no: 'cancel', armed: false });
  assert.deepEqual(action(t, 'discard').confirm, { words: 'discard “title s”? it leaves review — its branch and worktree are kept.', yes: 'confirm discard', no: 'keep it', armed: true });
  assert.deepEqual(t.attempts[0].files, { count: 3, add: 67, del: 9, list: [] });
  assert.equal(t.facts.find(f => f.label === 'changes').value, '3 files · +67 −9');
  assert.equal(t.facts.find(f => f.label === 'time').value, '10m');
  assert.equal(t.attempts[0].initialTab, 'changes'); assert.deepEqual(t.attempts[0].tabs, ['log', 'changes']);
  // playing: open it takes the ink, stop playing beside it
  const playing = ticketOf(input({ runs: [r], sectionRuns: [read(r, ['run.discard', 'preview.stop', 'run.merge'], { preview: { running: true, url: 'http://127.0.0.1:5173/' } })] }), 'run:s');
  assert.deepEqual(keys(playing), ['open-run', 'stop-playing', 'merge', 'discard']); assert.deepEqual(inks(playing), ['open-run']);
  assert.deepEqual(playing.attempts[0].preview, { running: true, url: 'http://127.0.0.1:5173/' });
  // nothing to play: merge is the ink key
  const still = ticketOf(withRead(r, ['run.discard', 'run.merge']), 'run:s');
  assert.deepEqual(keys(still), ['merge', 'discard']); assert.deepEqual(inks(still), ['merge']);
  assert.equal(still.statusLine, 'checks passed on a1b2c3d — merge it or discard it', 'and the words do not offer a play there is no key for');
  // unverified: the words say so, merge says why, verify it appears
  const raw = run('u', { status: 'staged', commitSha: 'a1b2c3d4' });
  const u = ticketOf(withRead(raw, ['run.verify', 'run.discard']), 'run:u');
  assert.equal(u.statusLine, 'not verified — verify it before it can merge');
  assert.deepEqual(keys(u), ['merge', 'discard', 'verify']); assert.equal(action(u, 'merge').blocked, WORDS.unverified);
});

test('failed says its reason and that main is unchanged; try again is the ink key, on the latest try', () => {
  const r1 = run('f1', { status: 'superseded', startedAt: ago(90), endedAt: ago(80) });
  const r2 = run('f2', { status: 'failed', replacesBuildId: 'f1', startedAt: ago(30), endedAt: ago(6), summary: 'Command failed: npm test\nFAIL beds.test.js', verification: { status: 'failed', command: 'npm test', detail: 'FAIL beds.test.js\n  expected 3' } });
  const t = ticketOf(input({ runs: [r1, r2], sectionRuns: [read(r2, ['run.retry', 'run.verify', 'run.discard'])] }), 'run:f1');
  assert.equal(t.statusLine, 'Command failed: npm test — main is unchanged');
  assert.equal(t.improvement.reason, 'Command failed: npm test');
  assert.deepEqual(keys(t), ['ask', 'verify', 'discard', 'retry']); assert.deepEqual(inks(t), ['retry']);
  assert.deepEqual(action(t, 'retry').payload, { runId: 'f2' }); assert.deepEqual(action(t, 'ask').payload, { improvementId: 'run:f1' });
  assert.deepEqual(action(t, 'discard').payload, { runId: 'f2' });
  assert.deepEqual(action(t, 'discard').confirm, { words: 'discard “title f1”? it leaves the failed list — its branch and worktree are kept.', yes: 'confirm discard', no: 'keep it', armed: true });
  const last = t.attempts[1];
  assert.equal(last.summary, '', 'its summary is the reason'); assert.equal(last.reason, 'Command failed: npm test');
  assert.deepEqual(last.steps.map(s => s.state), ['done', 'done', 'failed', 'waiting']);
  assert.deepEqual(last.checks, [{ name: 'npm test', ok: false, note: 'FAIL beds.test.js' }]);
  assert.equal(last.initialTab, 'log');
  assert.equal(t.facts.find(f => f.label === 'time').value, '34m', 'the sum of both tries');
  // work that failed before the check
  assert.deepEqual(ticketOf(input({ runs: [run('w', { status: 'failed', summary: 'Provider reported a failed run' })] }), 'run:w').attempts[0].steps.map(s => s.state), ['done', 'failed', 'waiting', 'waiting']);
});

test('a failed or interrupted try is not stuck: discard puts it away, and an issue keeps its words and its checkbox (§4.5)', () => {
  const issues = { status: 'ready', revision: REV, items: [item('i', 'rows drift', { description: 'After a storm.' })] };
  for (const status of ['failed', 'interrupted']) {
    const r = run('r', { status, issueIds: ['i'], summary: 'tests broke' });
    const t = ticketOf(withRead(r, ['run.retry', 'run.discard'], { issues }), 'issue:i');
    assert.equal(t.improvement.state, status);
    assert.deepEqual(keys(t), ['ask', 'edit', 'mark-done', 'discard', 'retry'], status); assert.deepEqual(inks(t), ['retry']);
    assert.deepEqual(action(t, 'edit').payload, { issueId: 'i', title: 'rows drift', description: 'After a storm.', revision: REV });
    assert.deepEqual(action(t, 'mark-done').payload, { issueId: 'i' });
    assert.deepEqual(action(t, 'discard').payload, { runId: 'r' });
    assert.equal(action(t, 'discard').confirm.words, 'discard try 1 of “rows drift”? it goes back to up next — its branch and worktree are kept.');
    assert.equal(action(t, 'discard').confirm.armed, true, 'it asks twice, on the red key');
    // put away, the issue is up next again with its own keys; a free-text chain settles
    const after = ticketOf(withRead({ ...r, status: 'discarded' }, [], { issues }), 'issue:i');
    assert.equal(after.improvement.state, 'up_next'); assert.deepEqual(keys(after), ['edit', 'mark-done', 'build-now']);
    const free = run('free', { status });
    assert.deepEqual(keys(ticketOf(withRead(free, ['run.retry', 'run.discard']), 'run:free')), ['ask', 'discard', 'retry']);
    const settled = buildMain(withRead({ ...free, status: 'discarded' }, []));
    assert.deepEqual([settled.improvements.length, settled.settled.map(v => [v.id, v.state])], [0, [['run:free', 'discarded']]], 'it leaves the failed fold for settled');
  }
  // a daemon that won't discard it: no discard key; the list unread: the issue's keys say so
  const r = run('r', { status: 'failed', issueIds: ['i'] });
  assert.deepEqual(keys(ticketOf(withRead(r, ['run.retry'], { issues }), 'issue:i')), ['ask', 'edit', 'mark-done', 'retry']);
  const unread = ticketOf(withRead(r, ['run.retry'], { issues: { ...issues, revision: '' } }), 'issue:i');
  assert.deepEqual(['edit', 'mark-done'].map(k => action(unread, k).blocked), [WORDS.noList, WORDS.noList]);
  // a done issue whose last try failed is done: reopen, nothing else
  assert.deepEqual(keys(ticketOf(withRead(r, ['run.retry', 'run.discard'], { issues: { ...issues, items: [item('i', 'rows drift', { done: true })] } }), 'issue:i')), ['reopen']);
});

test('stopped and discarded offer try again alone; done offers reopen; in offers its changes (§4.5)', () => {
  const stopped = ticketOf(input({ runs: [run('s', { status: 'cancelled', summary: 'Stopped by owner' })] }), 'run:s');
  assert.equal(stopped.statusLine, 'you stopped it — main is unchanged'); assert.deepEqual(keys(stopped), ['retry']); assert.equal(stopped.improvement.reason, 'Stopped by owner');
  const discarded = ticketOf(input({ runs: [run('d', { status: 'discarded', commitSha: 'e'.repeat(40), diffstat: ' 1 file changed, 1 insertion(+)' })] }), 'run:d');
  assert.equal(discarded.statusLine, 'you discarded it — its branch and worktree are kept'); assert.deepEqual(keys(discarded), ['retry']);
  assert.deepEqual(discarded.attempts[0].steps.map(s => s.state), ['done', 'done', 'done', 'done']);
  const landed = ticketOf(input({ runs: [run('m', { status: 'merged', endedAt: ago(125), commitSha: 'f'.repeat(40) })] }), 'run:m');
  assert.equal(landed.statusLine, 'in main since 2h · landed with try 1'); assert.deepEqual(keys(landed), ['see-changes']); assert.deepEqual(inks(landed), []);
  const interruptedNoWork = ticketOf(input({ runs: [run('i', { status: 'interrupted' })] }), 'run:i');
  assert.deepEqual(interruptedNoWork.attempts[0].steps.map(s => s.state), ['waiting', 'waiting', 'waiting', 'waiting']);
});

test('every state has at most one ink key, and the states the spec stars have exactly one', () => {
  const issues = { status: 'ready', revision: REV, items: [item('open', 'rows drift'), item('done', 'fences', { done: true })] };
  const fixtures = [
    ['issue:open', [], 1], ['issue:done', [], 0],
    ['run:q', [run('q', { status: 'queued', endedAt: undefined })], 0],
    ['run:b', [run('b', { status: 'running', endedAt: undefined })], 0],
    ['run:a', [run('a', { status: 'awaiting_input', endedAt: undefined })], 1],
    ['run:s', [run('s', { status: 'staged', verification: { status: 'passed' } })], 1],
    ['run:g', [run('g', { status: 'staged', github: { mode: 'github', pullRequest: true } })], 1],
    ['run:m', [run('m', { status: 'merged', commitSha: 'f'.repeat(40) })], 0],
    ['run:f', [run('f', { status: 'failed' })], 1], ['run:i', [run('i', { status: 'interrupted' })], 1],
    ['run:c', [run('c', { status: 'cancelled' })], 1], ['run:d', [run('d', { status: 'discarded' })], 1],
  ];
  for (const [id, runs, expected] of fixtures) {
    for (const sectionRuns of [null, runs.map(r => read(r, ['run.stop', 'run.steer', 'run.retry', 'run.discard', 'run.verify', 'preview.start', 'run.merge']))]) {
      const t = ticketOf(input({ runs, sectionRuns, issues }), id);
      assert.equal(t.gone, false, id);
      assert.equal(inks(t).length, expected, `${id} ${sectionRuns ? 'read' : 'unread'}: ${keys(t)}`);
      assert.equal(new Set(keys(t)).size, keys(t).length, 'keys are unique');
      for (const a of t.actions) { assert.equal(typeof a.label, 'string'); assert.equal(a.label, a.label.toLowerCase(), 'page keys are lowercase (D15)'); assert.equal(typeof a.blocked, 'string'); }
      assert.ok(t.statusLine, id);
      assert.deepEqual(t.facts.map(f => f.label), ['build', 'asked', 'tries', 'time', 'changes', 'checks']);
    }
  }
});

/* ------------------------------------------------------------------------------------------ §5.2 blocked words */

test('while nibbi answers, only the three keys that start a run wait, in words (D8)', () => {
  const issues = { status: 'ready', revision: REV, items: [item('i', 'rows drift')] };
  const m = buildMain(input({ busy: true, issues }));
  assert.equal(m.blocked.start, WORDS.busy); assert.equal(m.blocked.queue, ''); assert.equal(m.blocked.play, '');
  assert.equal(action(ticketOf(input({ busy: true, issues }), 'issue:i'), 'build-now').blocked, WORDS.busy);
  assert.equal(action(ticketOf(input({ busy: true, issues }), 'issue:i'), 'edit').blocked, '');
  assert.equal(action(ticketOf(input({ busy: true, runs: [run('f', { status: 'failed' })] }), 'run:f'), 'retry').blocked, WORDS.busy);
  const staged = run('s', { status: 'staged', verification: { status: 'passed' } });
  const t = ticketOf(withRead(staged, ALL_REVIEW, { busy: true }), 'run:s');
  for (const k of ['play-run', 'merge', 'discard']) assert.equal(action(t, k).blocked, '', k);
  assert.equal(action(ticketOf(withRead(run('b', { status: 'running', endedAt: undefined }), ['run.stop', 'run.steer'], { busy: true }), 'run:b'), 'stop').blocked, '');
});

test('in demo every daemon write and play says the demo can’t, in the words for what it is', () => {
  const issues = { status: 'ready', revision: REV, items: [item('i', 'rows drift'), item('d', 'done one', { done: true })] };
  const m = buildMain(input({ demo: true, busy: true, issues }));
  assert.deepEqual(m.blocked, { start: WORDS.demoStart, queue: WORDS.demoChange, play: WORDS.demoPlay });
  assert.equal(m.play.blocked, WORDS.demoPlay);
  const up = ticketOf(input({ demo: true, issues }), 'issue:i');
  assert.equal(action(up, 'build-now').blocked, WORDS.demoStart); assert.equal(action(up, 'edit').blocked, WORDS.demoChange); assert.equal(action(up, 'mark-done').blocked, WORDS.demoChange);
  assert.equal(action(ticketOf(input({ demo: true, issues }), 'issue:d'), 'reopen').blocked, WORDS.demoChange);
  const staged = run('s', { status: 'staged', verification: { status: 'passed' } });
  const t = ticketOf(withRead(staged, ALL_REVIEW, { demo: true }), 'run:s');
  assert.equal(action(t, 'play-run').blocked, WORDS.demoPlay); assert.equal(action(t, 'merge').blocked, WORDS.demoChange); assert.equal(action(t, 'discard').blocked, WORDS.demoChange);
  const playing = ticketOf(input({ demo: true, runs: [staged], sectionRuns: [read(staged, ['preview.stop'], { preview: { running: true, url: 'http://127.0.0.1:5173/' } })] }), 'run:s');
  assert.equal(action(playing, 'open-run').blocked, '', 'opening a running preview writes nothing');
  assert.equal(action(playing, 'stop-playing').blocked, WORDS.demoPlay);
  const failed = ticketOf(input({ demo: true, runs: [run('f', { status: 'failed' })] }), 'run:f');
  assert.equal(action(failed, 'retry').blocked, WORDS.demoStart); assert.equal(action(failed, 'ask').blocked, '');
});

test('without a readable list, up next, edit, mark it done, reopen and build it now say so (§5.2)', () => {
  const stale = { status: 'ready', revision: REV, items: [item('i', 'rows drift'), item('d', 'done one', { done: true })] };
  for (const over of [{ list: 'unavailable', issues: stale }, { list: 'loading', issues: null }]) assert.equal(buildMain(input(over)).blocked.queue, WORDS.noList);
  assert.equal(buildMain(input({ issues: { status: 'ready', revision: '', items: [] } })).blocked.queue, WORDS.noList, 'no revision, no write');
  const t = ticketOf(input({ list: 'unavailable', issues: stale }), 'issue:i');
  for (const k of ['edit', 'mark-done', 'build-now']) assert.equal(action(t, k).blocked, WORDS.noList, k);
  assert.equal(action(ticketOf(input({ list: 'unavailable', issues: stale }), 'issue:d'), 'reopen').blocked, WORDS.noList);
});

test('approve & merge says why it can’t: reading, no check, not verified, not offered (§5.2)', () => {
  const passed = run('s', { status: 'staged', verification: { status: 'passed', command: 'npm test' }, commitSha: 'abc1234' });
  assert.equal(action(ticketOf(input({ runs: [passed] }), 'run:s'), 'merge').blocked, WORDS.reading, 'the read has not landed');
  // a status change the read has not caught up with: its allowedActions are not known yet (§3.3)
  const moved = ticketOf(input({ runs: [passed], sectionRuns: [read({ ...passed, status: 'verifying' }, ['run.stop'])] }), 'run:s');
  assert.equal(action(moved, 'merge').blocked, WORDS.reading); assert.equal(action(moved, 'play-run').blocked, WORDS.reading);
  assert.equal(action(moved, 'discard').blocked, WORDS.reading);
  const noCheck = withRead(passed, ALL_REVIEW, { project: { name: 'garden', branch: 'main', check: 'echo ok', lastCommit: '', github: null } });
  assert.equal(action(ticketOf(noCheck, 'run:s'), 'merge').blocked, WORDS.noCheck);
  assert.equal(buildMain(noCheck).check.real, false);
  for (const command of ['', 'true', ':', 'echo done']) assert.equal(buildMain(input({ project: { name: 'garden', branch: 'main', check: command } })).check.real, false, command);
  assert.equal(ticketOf(withRead(run('n', { status: 'staged' }), ALL_REVIEW, { project: { name: 'garden', branch: 'main', check: '' } }), 'run:n').statusLine, WORDS.noCheck);
  assert.equal(action(ticketOf(withRead(run('u', { status: 'staged' })), 'run:u'), 'merge').blocked, WORDS.unverified);
  assert.equal(action(ticketOf(withRead(passed, ['run.discard', 'preview.start']), 'run:s'), 'merge').blocked, WORDS.cantMerge);
  assert.equal(action(ticketOf(withRead(passed), 'run:s'), 'merge').blocked, '');
});

test('play main: nothing to play, not read yet, playing, and the checkout it really plays (§5.2, §9.3)', () => {
  const none = buildMain(input({ play: { running: false, playable: false, kind: 'none' } }));
  assert.equal(none.play.blocked, 'garden has nothing to play yet'); assert.equal(none.blocked.play, none.play.blocked);
  assert.equal(buildMain(input({ play: null })).play.blocked, WORDS.reading);
  const playing = buildMain(input({ project: { name: 'garden', branch: 'codex/tighter-chat-spacing', lastCommit: 'a1b2c3d tidy (2 hours ago)', check: 'npm test' }, play: { running: true, playable: true, url: 'http://127.0.0.1:5173/', kind: 'server' } }));
  assert.deepEqual(playing.play, { playable: true, running: true, starting: false, url: 'http://127.0.0.1:5173/', blocked: '', note: 'plays your checkout · on codex/tighter-chat-spacing', lastCommit: 'a1b2c3d tidy (2 hours ago)' });
});

/* ------------------------------------------------------------------------------------------ BuildVM */

test('the badge says the first state with a count, in BADGE’s order, with its plural (§3)', () => {
  const s = (id, status, extra = {}) => run(id, { status, endedAt: ago(1), ...extra });
  const layers = [
    [s('a1', 'awaiting_input'), s('a2', 'awaiting_input')],
    [s('n1', 'staged', { github: { mode: 'github', needsAttention: true } })],
    [s('p1', 'staged', { github: { mode: 'github', readyPR: true } })],
    [s('t1', 'staged', { github: { mode: 'github', toPush: true } })],
    [s('o1', 'staged', { github: { mode: 'github', pullRequest: true } }), s('o2', 'staged', { github: { mode: 'github', pullRequest: true } })],
    [s('r1', 'staged')],
    [s('f1', 'failed')],
    [s('i1', 'interrupted')],
    [s('b1', 'running')],
  ];
  const expected = [['2 need you', 'attention'], ['1 needs a look', 'error'], ['1 ready to merge', 'attention'], ['1 to push', 'attention'],
    ['2 pull requests open', 'attention'], ['1 ready to review', 'attention'], ['1 failed', 'error'], ['1 interrupted', 'attention'], ['1 building', 'active']];
  assert.equal(layers.length, BADGE.length);
  for (let i = 0; i < layers.length; i++) {
    const m = buildMain(input({ runs: layers.slice(i).flat() }));
    assert.deepEqual(m.badge, { text: expected[i][0], tone: expected[i][1] }, `layer ${i}`);
    assert.deepEqual(m.attention, m.badge, 'attention is the badge: attention, error, or "N building"');
  }
  const quiet = buildMain(input({ runs: [s('q', 'queued'), s('m', 'merged')] }));
  assert.deepEqual(quiet.badge, { text: '', tone: 'quiet' }); assert.deepEqual(quiet.attention, { text: '', tone: 'quiet' });
});

test('the list keeps one order, bar and page alike: waiting → building → up next → in → failed, then within each (§7a)', () => {
  const issues = { status: 'ready', revision: REV, items: [
    item('late', 'late in file', { line: 9 }), item('early', 'early in file', { line: 2 }), item('marked', 'marked in progress', { boardStatus: 'in-progress', line: 12 })] };
  const runs = [
    run('q-old', { status: 'queued', startedAt: ago(5), endedAt: undefined }), run('q-new', { status: 'queued', startedAt: ago(1), endedAt: undefined }),
    run('b-old', { status: 'running', latestAttemptStartedAt: ago(20), endedAt: undefined }), run('b-new', { status: 'running', latestAttemptStartedAt: ago(2), endedAt: undefined }),
    run('ready', { status: 'staged', endedAt: ago(3) }), run('asks', { status: 'awaiting_input', endedAt: undefined }),
    run('m-old', { status: 'merged', endedAt: ago(300) }), run('m-new', { status: 'merged', endedAt: ago(30) }),
    run('f-old', { status: 'failed', endedAt: ago(200) }), run('i-new', { status: 'interrupted', endedAt: ago(40) }),
    run('gone', { status: 'discarded', endedAt: ago(1) }),
  ];
  const m = buildMain(input({ runs: [...runs].reverse(), issues }));
  assert.deepEqual(m.improvements.map(vm => vm.id), [
    'run:asks', 'run:ready',                                   // waiting on you: needs you before ready
    'run:b-new', 'run:b-old',                                  // building, newest first
    'issue:marked', 'issue:late', 'issue:early', 'run:q-old', 'run:q-new',   // up next: marked, then file order, then queued by time
    'run:m-new', 'run:m-old',                                  // in, newest first
    'run:i-new', 'run:f-old',                                  // failed and interrupted, newest first
  ]);
  const groups = GROUPS.map(g => g.id);
  const seen = m.improvements.map(vm => groups.indexOf(vm.group));
  assert.deepEqual(seen, [...seen].sort((a, b) => a - b));
  for (const g of groups) assert.deepEqual(m.improvements.filter(vm => vm.group === g).map(vm => vm.order), m.improvements.filter(vm => vm.group === g).map((_, i) => i), g);
  assert.deepEqual(m.settled.map(vm => vm.id), ['run:gone']);
  assert.deepEqual(m.counts, { waiting: 2, needsYou: 1, ready: 1, building: 2, upNext: 5, in: 2, inToday: 2, failed: 1, interrupted: 1 });
});

test('many failed stay listed newest first for the fold; in keeps the last day apart from older; the page caps hold', () => {
  const failed = Array.from({ length: 14 }, (_, i) => run('f' + i, { status: 'failed', endedAt: ago(i * 10 + 1) }));
  const m = buildMain(input({ runs: failed }));
  assert.equal(m.improvements.length, 14); assert.deepEqual(m.improvements.map(vm => vm.id), failed.map(r => 'run:' + r.id));
  assert.equal(m.counts.failed, 14); assert.deepEqual(m.badge, { text: '14 failed', tone: 'error' });
  const landed = [run('today1', { status: 'merged', endedAt: ago(120) }), run('today2', { status: 'merged', endedAt: ago(23 * 60) }), run('older', { status: 'merged', endedAt: ago(25 * 60) })];
  const l = buildMain(input({ runs: landed }));
  assert.equal(l.counts.in, 3); assert.equal(l.counts.inToday, 2);
  const lots = Array.from({ length: 25 }, (_, i) => run('m' + i, { status: 'merged', endedAt: ago(i + 1) }));
  const capped = buildMain(input({ runs: [...lots, ...Array.from({ length: 25 }, (_, i) => run('d' + i, { status: 'discarded', endedAt: ago(i + 1) }))] }));
  assert.equal(capped.improvements.length, PAGE_LIMITS.inKept); assert.equal(capped.counts.in, 25);
  assert.equal(capped.improvements[0].id, 'run:m0', 'the newest kept');
  assert.equal(capped.settled.length, PAGE_LIMITS.settledKept); assert.equal(capped.settled[0].id, 'run:d0');
});

test('first run: nothing yet, nothing claimed — the list loading, main live on the checked-out branch', () => {
  const m = buildMain(input({ issues: null, list: 'loading', play: null, project: { name: 'garden', branch: 'main', check: 'npm test', lastCommit: '' } }));
  assert.deepEqual(m.improvements, []); assert.deepEqual(m.settled, []);
  assert.equal(m.list, 'loading'); assert.deepEqual(m.badge, { text: '', tone: 'quiet' });
  assert.equal(m.id, 'main'); assert.equal(m.name, 'main'); assert.equal(m.word, 'live'); assert.equal(m.branch, 'main'); assert.equal(m.line, 'live · what ships');
  assert.deepEqual(m.counts, { waiting: 0, needsYou: 0, ready: 0, building: 0, upNext: 0, in: 0, inToday: 0, failed: 0, interrupted: 0 });
  assert.equal(m.github, null); assert.deepEqual(m.check, { command: 'npm test', real: true });
  const empty = buildMain(input());
  assert.deepEqual(empty.improvements, []); assert.equal(empty.blocked.queue, ''); assert.equal(empty.list, 'ready');
  // a bare input still makes a build
  assert.equal(buildMain({}).name, 'main'); assert.equal(buildMain(undefined).branch, 'main');
});

test('issues.md unreadable: its own up-next rows go, queued runs and running issue tries stay (§2.1.3)', () => {
  const stale = { status: 'ready', revision: REV, items: [item('i', 'rows drift'), item('j', 'fences')] };
  const runs = [run('q', { status: 'queued', endedAt: undefined }), run('b', { status: 'running', issueIds: ['j'], endedAt: undefined })];
  const m = buildMain(input({ list: 'unavailable', issues: stale, runs }));
  assert.deepEqual(m.improvements.map(vm => vm.id), ['issue:j', 'run:q']); assert.equal(m.list, 'unavailable');
  // unread at all: an issue's runs still show under its issue id, which stays the same once the list lands
  const unread = buildMain(input({ list: 'loading', issues: null, runs }));
  assert.deepEqual(unread.improvements.map(vm => vm.id), ['issue:j', 'run:q']);
  assert.equal(unread.improvements[0].title, 'title b');
  assert.deepEqual(buildMain(input({ issues: stale, runs })).improvements.map(vm => vm.id), ['issue:j', 'issue:i', 'run:q'], 'readable again: its up-next row is back');
});

test('main’s branch is where runs really land (D1): the newest run’s target, the project’s, the checkout; GitHub’s integration branch', () => {
  const project = extra => ({ name: 'garden', branch: 'feature/x', check: 'npm test', lastCommit: '', github: null, ...extra });
  const newest = buildMain(input({ project: project(), runs: [run('old', { targetBranch: 'main', startedAt: ago(100) }), run('new', { targetBranch: 'dev', startedAt: ago(10) })] }));
  assert.equal(newest.branch, 'dev'); assert.equal(newest.line, 'live · lands on dev');
  assert.equal(buildMain(input({ project: project({ targetBranch: 'trunk' }) })).branch, 'trunk');
  assert.equal(buildMain(input({ project: project() })).branch, 'feature/x');
  const gh = buildMain(input({ project: project({ github: { workflowMode: 'github', integrationBranch: 'v2', repository: 'o/g', releaseBranch: 'main' } }), runs: [run('r', { targetBranch: 'dev' })] }));
  assert.equal(gh.branch, 'v2'); assert.equal(gh.line, 'live · lands on v2');
  const connectedLocal = buildMain(input({ project: project({ github: { workflowMode: 'local', integrationBranch: 'v2', repository: 'o/g', releaseBranch: 'main' } }), runs: [run('r', { targetBranch: 'main' })] }));
  assert.equal(connectedLocal.branch, 'main'); assert.equal(connectedLocal.github.mode, 'local');
  assert.equal(ticketOf(input({ project: project(), runs: [run('r', { targetBranch: 'dev' })] }), 'run:r').branch, 'dev');
});

test('the model is pure: frozen input, no clock of its own, the same answer twice', () => {
  const issues = { status: 'ready', revision: REV, items: [item('i', 'rows drift', { githubIssueLinks: [{ repository: 'o/g', number: 1, url: 'https://github.com/o/g/issues/1' }] })] };
  const frozen = deepFreeze(input({ runs: [run('a', { status: 'staged', issueIds: ['i'], verification: { status: 'passed' } }), run('b', { status: 'running', endedAt: undefined })],
    sectionRuns: [read(run('a', { status: 'staged', issueIds: ['i'] }), ALL_REVIEW)], issues }));
  const real = Date.now;
  Date.now = () => { throw new Error('the model read the clock'); };
  try {
    const one = buildMain(frozen), two = buildMain(frozen);
    assert.deepEqual(one, two);
    assert.deepEqual(ticketOf(frozen, 'issue:i'), ticketOf(frozen, 'issue:i'));
    ticketOf(frozen, 'run:b'); ticketOf(frozen, 'issue:none');
  } finally { Date.now = real; }
});

/* ------------------------------------------------------------------------------------------ §3.3 mergeRuns */

test('mergeRuns: the live record wins what events carry; the read’s extras only while the statuses agree (§3.3)', () => {
  const live = run('r', { status: 'staged', summary: 'live summary', commitSha: 'live', github: { mode: 'local' }, endedAt: undefined });
  const agreeing = { ...run('r', { status: 'staged', summary: 'read summary', commitSha: 'read', endedAt: ago(9) }), allowedActions: ['run.merge'], preview: { running: false }, currentActivity: undefined, groupStatus: 'review' };
  const [merged] = mergeRuns([live], [agreeing]);
  assert.equal(merged.summary, 'live summary'); assert.equal(merged.commitSha, 'live'); assert.equal(merged.endedAt, undefined, 'live wins even with nothing');
  assert.deepEqual(merged.allowedActions, ['run.merge']); assert.deepEqual(merged.preview, { running: false }); assert.equal(merged.currentActivity, null);
  assert.equal(merged.groupStatus, 'review', 'other read-only fields ride along');
  // the live status moved on: the read's extras are not known yet
  const [moved] = mergeRuns([{ ...live, status: 'merged' }], [agreeing]);
  assert.equal(moved.status, 'merged'); assert.equal(moved.allowedActions, null); assert.equal(moved.preview, null); assert.equal(moved.currentActivity, null);
  // the legacy 'done' is staged
  assert.deepEqual(mergeRuns([{ ...live, status: 'done' }], [agreeing])[0].allowedActions, ['run.merge']);
  // only live: nothing known yet; only read (the snapshot is older): kept as read
  const [alone] = mergeRuns([live], null);
  assert.equal(alone.allowedActions, null); assert.equal(alone.preview, null);
  const both = mergeRuns([live], [agreeing, { ...run('older', { status: 'merged' }), allowedActions: ['run.retry'] }]);
  assert.deepEqual(both.map(r => r.id), ['r', 'older']); assert.deepEqual(both[1].allowedActions, ['run.retry']); assert.equal(both[1].preview, null);
  assert.deepEqual(mergeRuns(null, undefined), []);
  assert.deepEqual(mergeRuns([live, live, null, { no: 'id' }], []).map(r => r.id), ['r'], 'one per id; junk dropped');
});

test('buildMain reads its own merge: runs of other projects are left out', () => {
  const m = buildMain(input({ runs: [run('mine'), run('theirs', { game: 'battalion', project: 'battalion' })] }));
  assert.deepEqual(m.improvements.map(vm => vm.id), ['run:mine']);
});

/* ------------------------------------------------------------------------------------------ small rules */

test('previewText: markers, fences, markup and length (§4.6)', () => {
  assert.equal(previewText('»voice: sure thing\nThe **beds** are _aligned_ now.\n»acts: play | review'), 'The beds are aligned now.');
  assert.equal(previewText('Here:\n```js\nconst x = 1;\n```\nthen run it'), 'Here: … then run it');
  assert.equal(previewText('# Heading\n> quoted `code`\n\n  spaced   out  '), 'Heading quoted code spaced out');
  assert.equal(previewText('unclosed\n~~~\nlots\nof code'), 'unclosed …');
  const long = previewText('word '.repeat(60));
  assert.equal(long.length, 120); assert.ok(long.endsWith('…'));
  assert.equal(previewText('x'.repeat(120)), 'x'.repeat(120));
  assert.equal(previewText(null), ''); assert.equal(previewText(42), ''); assert.equal(previewText('»voice: only this'), '');
  assert.equal(previewText('a\r\nb'), 'a b');
});

test('parseDiffstat reads real git diff --stat output, renames, binaries and a bare total', () => {
  // git diff --stat 9cb24f0~3 9cb24f0 in this repository
  assert.deepEqual(parseDiffstat(' .github/workflows/verify.yml | 28 ++++++++++++++++++++++++----\n CHANGELOG.md                 |  8 ++++++++\n tools/webkit-verify.mjs      | 24 ++++++++++++++++++------\n 3 files changed, 50 insertions(+), 10 deletions(-)\n'), {
    count: 3, add: 50, del: 10, list: [{ path: '.github/workflows/verify.yml', changes: 28 }, { path: 'CHANGELOG.md', changes: 8 }, { path: 'tools/webkit-verify.mjs', changes: 24 }] });
  // 04ef6cb: a rename inside braces; 27b8336: a binary deleted
  assert.deepEqual(parseDiffstat(' public/styles.css             | 326 ++++++++++----------\n {design => public}/tokens.css |  66 ++++++---\n design/sidebar-lab/evidence/lab-desktop.png        | Bin 0 -> 314238 bytes\n old/name.txt => new/name.txt | 0\n 4 files changed, 492 insertions(+), 429 deletions(-)').list, [
    { path: 'public/styles.css', changes: 326 }, { path: 'public/tokens.css', changes: 66 }, { path: 'design/sidebar-lab/evidence/lab-desktop.png', changes: 0 }, { path: 'new/name.txt', changes: 0 }]);
  assert.deepEqual(parseDiffstat(' docs/CONTROL-PANEL.md                | 862 +++++\n public/lib/control-panel-contract.js | 423 +++\n 2 files changed, 1285 insertions(+)'), {
    count: 2, add: 1285, del: 0, list: [{ path: 'docs/CONTROL-PANEL.md', changes: 862 }, { path: 'public/lib/control-panel-contract.js', changes: 423 }] });
  assert.deepEqual(parseDiffstat(' 1 file changed, 3 deletions(-)'), { count: 1, add: 0, del: 3, list: [] });
  assert.deepEqual(parseDiffstat(' 2 files changed, 40 insertions(+)'), { count: 2, add: 40, del: 0, list: [] });   // tests/narration-wiring.test.mjs:145's fixture
  assert.deepEqual(parseDiffstat(' a.js | 2 +-\n'), { count: 1, add: 0, del: 0, list: [{ path: 'a.js', changes: 2 }] }, 'no total line: the files are the count');
  assert.deepEqual(parseDiffstat(''), { count: 0, add: 0, del: 0, list: [] }); assert.deepEqual(parseDiffstat(undefined), { count: 0, add: 0, del: 0, list: [] });
});

test('splitImprovementText: the first line is the title, the rest the description; reserved markers refused', () => {
  assert.deepEqual(splitImprovementText('Seedlings overlap'), { title: 'Seedlings overlap', description: '' });
  assert.deepEqual(splitImprovementText('\n\n  Seedlings overlap  \r\nTwo share a cell.\r\n\r\n- row 3\n\n'), { title: 'Seedlings overlap', description: 'Two share a cell.\n\n- row 3' });
  assert.deepEqual(splitImprovementText('Title\n\n\nBody after blanks'), { title: 'Title', description: 'Body after blanks' });
  assert.throws(() => splitImprovementText('Fix it <!-- nibbi-issue:abc -->'), /marker nibbi keeps for itself/);
  assert.throws(() => splitImprovementText('Fix it\n<!--   NIBBI-description:start -->'), /marker/);
  assert.doesNotThrow(() => splitImprovementText('Fix it\n<!-- a plain comment -->'));
  assert.throws(() => splitImprovementText('   \n  '), /say what should change first/);
  assert.throws(() => splitImprovementText(undefined), /say what should change first/);
  for (const words of ['say what should change first']) assert.equal(words, words.toLowerCase());
});

test('conversationsFor: home first, then the latest; the last thing said, cleaned; the open one says what the client holds (§4.6)', () => {
  const threads = [
    { id: 'home', project: 'garden', title: 'Home', lastAt: ago(30), count: 4, archived: false, lastText: '»voice: hi\nThe **beds** line up now.' },
    { id: 't-old', project: 'garden', title: 'rounds feel long', lastAt: ago(400), count: 2, archived: false, lastText: 'They are, by about two.' },
    { id: 't-new', project: 'garden', title: 'music between rounds', lastAt: ago(6), count: 9, archived: false },
    { id: 't-arch', project: 'garden', title: 'put away', lastAt: ago(1), count: 1, archived: true, lastText: 'x' },
    { id: 't-fresh', project: 'garden', title: 'New thread', lastAt: ago(60), count: 0, archived: false },
  ];
  const rows = conversationsFor(threads, { activeId: 't-new', liveText: 'A short loop would fill it.\n```\ncode\n```' });
  assert.deepEqual(rows.map(r => r.id), ['home', 't-new', 't-fresh', 't-old']);
  assert.deepEqual(rows.map(r => r.lastText), ['The beds line up now.', 'A short loop would fill it. …', '', 'They are, by about two.']);
  assert.deepEqual(rows.map(r => r.active), [false, true, false, false]);
  assert.deepEqual(rows[1], { id: 't-new', project: 'garden', title: 'music between rounds', lastAt: ago(6), lastText: 'A short loop would fill it. …', active: true, count: 9 });
  // home with nothing said, and home before the first read
  assert.equal(conversationsFor([{ id: 'home', project: null, title: 'Home', lastAt: null, count: 0 }], {})[0].lastText, WORDS.homeLine);
  assert.deepEqual(conversationsFor(null, { activeId: 'home', project: 'garden' }), [{ id: 'home', project: 'garden', title: 'Home', lastAt: null, lastText: WORDS.homeLine, active: true, count: 0 }]);
  // the open one with nothing settled yet falls back to the daemon's line
  assert.equal(conversationsFor(threads, { activeId: 'home', liveText: '' })[0].lastText, 'The beds line up now.');
});

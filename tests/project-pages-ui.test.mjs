// The control panel's pages (public/lib/project-pages.js): every state drawn from literal view models at
// 1180×820 and 390×844, every key pressed and its payload checked, and what the old lobby tests proved
// (the Log's rows, play, liveness under focus) carried onto the ticket page. The harness serves public/
// so the module's imports resolve, and hosts a div.cp-page-host inside a #project-workspace frame with
// tokens.css, styles.css, margins.css, project-workspace.css and project-pages.css, in the app's order:
// the bar's stylesheet is loaded too, because the two share class names (cp-title, cp-build, cp-add).
//
//   CI=1 node --test tests/project-pages-ui.test.mjs
//   CP_PAGES_SHOTS=<dir> writes the screenshots there (default output/playwright/project-pages)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
import { WORDS, STATE_WORDS, STATE_TONES, GROUPS } from '../public/lib/control-panel-contract.js';

const root = resolve('public');
const SHOTS = process.env.CP_PAGES_SHOTS || resolve('output/playwright/project-pages');
mkdirSync(SHOTS, { recursive: true });
const DESKTOP = { width: 1180, height: 820 }, PHONE = { width: 390, height: 844 };

/* ------------------------------------------------------------------------------------------ view models, as builds-model.js makes them */
const NOW = Date.parse('2026-09-28T12:00:00.000Z');
const m = 60_000, H = 3_600_000, d = 86_400_000;
const at = ms => new Date(NOW - ms).toISOString();
const groupOf = state => GROUPS.find(g => g.states.includes(state))?.id || 'settled';
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
function imp(id, title, state, extra = {}) {
  return { id, kind: id.startsWith('issue:') ? 'issue' : 'run', title, state, word: STATE_WORDS[state], tone: STATE_TONES[state], live: state === 'building',
    group: groupOf(state), context: '', when: null, reason: '', issueId: id.startsWith('issue:') ? id.slice(6) : null, runIds: [], latestRunId: null, order: 0, ...extra };
}
const STEP = { install: 'install', work: 'do the work', check: 'run the checks', stage: 'stage it for review' };
const steps = (...states) => Object.entries(STEP).map(([name, label], i) => ({ name, label, state: states[i] }));
const files = (count, add, del) => ({ count, add, del, list: [] });
function attempt(runId, n, state, extra = {}) {
  const status = { up_next: 'queued', building: 'running', needs_you: 'awaiting_input', ready: 'staged', pull_request: 'staged', in: 'merged', failed: 'failed', interrupted: 'interrupted', stopped: 'cancelled', discarded: 'discarded' }[state] || 'staged';
  return {
    runId, n, status, state, word: STATE_WORDS[state], tone: STATE_TONES[state], live: state === 'building', title: '', branch: `nibbi/fx-${runId}`, target: 'main', sha: '',
    startedAt: at(30 * m), endedAt: at(6 * m), costUsd: 0.38, summary: '', reason: '', activity: '', steps: steps('done', 'done', 'done', 'done'),
    checks: [{ name: 'npm test', ok: true, note: '8 checks passed' }], files: files(3, 67, 9), github: null, preview: null, allowedActions: [],
    tabs: ['log', 'changes'], initialTab: 'log', attemptId: `${runId}-attempt`, ...extra,
  };
}
const A = (action, label, key, payload, extra = {}) => ({ action, label, tone: 'seated', payload, confirm: null, blocked: '', key, opens: null, ...extra });
const confirmStop = (n, branch = 'main') => ({ words: fill(WORDS.confirm.stop, { n, branch }), yes: WORDS.keys.stopYes, no: WORDS.keys.stopNo, armed: true });
const confirmMerge = (title, branch = 'main') => ({ words: fill(WORDS.confirm.merge, { title, branch }), yes: WORDS.keys.mergeYes, no: WORDS.keys.cancel, armed: false });
const confirmDiscard = title => ({ words: fill(WORDS.confirm.discard, { title }), yes: WORDS.keys.discardYes, no: WORDS.keys.keep, armed: true });
const facts = (asked, tries, time, changes, checks) => [{ label: 'build', value: 'main', key: 'fact-build' }, { label: 'asked', value: asked }, { label: 'tries', value: tries }, { label: 'time', value: time }, { label: 'changes', value: changes }, { label: 'checks', value: checks }];
const asked = (text, extra = {}) => ({ text, description: '', context: '', at: null, source: 'run', ...extra });

function ticket(improvement, { statusLine, actions = [], attempts = [], factsList, askedVM, links = [], gone = false } = {}) {
  return { improvement, build: 'main', branch: 'main', statusLine, facts: factsList || facts('40m ago', String(attempts.length || 'none yet'), '24m', '3 files · +67 −9', 'passed'), asked: askedVM || asked(improvement.title, { at: at(40 * m) }), attempts, actions, links, gone };
}
const TICKETS = {
  'up-next': () => {
    const i = imp('issue:seedling-overlap', 'seedlings overlap near the edge', 'up_next', { context: 'Growing' });
    return ticket(i, {
      statusLine: 'it waits here until you start it — nothing builds it on its own',
      actions: [A('editImprovement', WORDS.keys.edit, 'edit', { issueId: 'seedling-overlap', title: i.title, description: 'Reproduce with a full garden.', revision: 'rev-1' }, { opens: 'form' }),
        A('completeImprovement', WORDS.keys.markDone, 'mark-done', { issueId: 'seedling-overlap' }), A('buildIssue', WORDS.keys.buildNow, 'build-now', { issueId: 'seedling-overlap' }, { tone: 'ink' })],
      factsList: facts('from issues.md', 'none yet', '—', '—', '—'),
      askedVM: asked(i.title, { source: 'issue', description: 'Reproduce with a full garden: the last row of seedlings draws over the fence.', context: 'you marked it in progress' }),
      links: [{ label: 'GitHub issue · owner/paper-garden #7', url: 'https://github.com/owner/paper-garden/issues/7' }, { label: 'not a link', url: 'javascript:alert(1)' }],
    });
  },
  queued: () => ticket(imp('run:r-queue', 'tidy the watering can sprite', 'up_next', { when: { verb: 'queued', at: at(1 * m) } }), {
    statusLine: 'queued — it starts when one of the 2 slots frees',
    actions: [A('stopRun', WORDS.keys.cancelQueued, 'cancel', { runId: 'r-queue' })],
    attempts: [attempt('r-queue', 1, 'up_next', { startedAt: at(1 * m), endedAt: null, costUsd: null, steps: steps('waiting', 'waiting', 'waiting', 'waiting'), checks: [{ name: 'npm test', ok: null, note: '' }], files: files(0, 0, 0) })],
    factsList: facts('just now', '1', '—', '—', 'not run'),
  }),
  building: () => ticket(imp('run:r-build', 'grow a quiet evening palette', 'building', { when: { verb: 'started', at: at(4 * m) } }), {
    statusLine: 'running the checks · 4m in · try 2',
    actions: [A('steerRun', WORDS.keys.guide, 'guide', { runId: 'r-build-2', text: '' }, { opens: 'form' }), A('stopRun', WORDS.keys.stop, 'stop', { runId: 'r-build-2' }, { confirm: confirmStop(2) })],
    attempts: [
      attempt('r-build', 1, 'failed', { startedAt: at(40 * m), endedAt: at(28 * m), reason: 'the palette test timed out waiting for dusk', steps: steps('done', 'done', 'failed', 'waiting'), checks: [{ name: 'npm test', ok: false, note: 'palette.test.js: timed out after 30s' }] }),
      attempt('r-build-2', 2, 'building', { startedAt: at(4 * m), endedAt: null, summary: 'Mixed a dusk palette into the sky shader and kept the day palette as the default.', activity: 'running the checks', steps: steps('done', 'done', 'running', 'waiting'), checks: [{ name: 'npm test', ok: null, note: '' }], costUsd: 0.21 }),
    ],
    factsList: facts('40m ago', '2', 'running 4m', '3 files · +67 −9', 'running'),
  }),
  'needs-you': () => ticket(imp('run:r-ask', 'remember where the last seed was planted', 'needs_you', { when: { verb: 'asked you', at: at(3 * m) } }), {
    statusLine: 'it stopped to ask you something — guide it, or stop it',
    actions: [A('steerRun', WORDS.keys.guide, 'guide', { runId: 'r-ask', text: '' }, { opens: 'form', tone: 'ink' }), A('stopRun', WORDS.keys.stop, 'stop', { runId: 'r-ask' }, { confirm: confirmStop(1) })],
    attempts: [attempt('r-ask', 1, 'needs_you', { startedAt: at(9 * m), endedAt: null, steps: steps('done', 'running', 'waiting', 'waiting'), checks: [{ name: 'npm test', ok: null, note: '' }] })],
  }),
  ready: () => {
    const title = 'give the seedlings room to grow';
    return ticket(imp('run:r-ready', title, 'ready', { when: { verb: 'staged', at: at(6 * m) } }), {
      statusLine: 'checks passed on a1b2c3d — play it, then merge it or discard it',
      actions: [A('previewRun', WORDS.keys.playRun, 'play-run', { runId: 'r-ready', action: 'start' }, { tone: 'ink' }), A('mergeRun', WORDS.keys.merge, 'merge', { runId: 'r-ready' }, { confirm: confirmMerge(title) }), A('discardRun', WORDS.keys.discard, 'discard', { runId: 'r-ready' }, { confirm: confirmDiscard(title) })],
      attempts: [attempt('r-ready', 1, 'ready', { sha: 'a1b2c3d', summary: 'Left a **one-tile gap** between rows so seedlings never draw over each other.\n\nKept keyboard controls working.', initialTab: 'changes', allowedActions: ['preview.start', 'run.merge', 'run.discard'] })],
    });
  },
  'ready-playing': () => {
    const title = 'give the seedlings room to grow';
    return ticket(imp('run:r-ready', title, 'ready', { when: { verb: 'staged', at: at(6 * m) } }), {
      statusLine: 'checks passed on a1b2c3d — play it, then merge it or discard it',
      actions: [A('previewRun', WORDS.keys.open, 'open-run', { runId: 'r-ready', action: 'open' }, { tone: 'ink' }), A('previewRun', WORDS.keys.stopPlaying, 'stop-playing', { runId: 'r-ready', action: 'stop' }), A('mergeRun', WORDS.keys.merge, 'merge', { runId: 'r-ready' }, { confirm: confirmMerge(title) }), A('discardRun', WORDS.keys.discard, 'discard', { runId: 'r-ready' }, { confirm: confirmDiscard(title) })],
      attempts: [attempt('r-ready', 1, 'ready', { sha: 'a1b2c3d', summary: 'Left a one-tile gap between rows.', initialTab: 'changes', preview: { running: true, url: 'http://127.0.0.1:4321' }, allowedActions: ['preview.stop', 'run.merge', 'run.discard'] })],
    });
  },
  unverified: () => {
    const title = 'keep keyboard focus after watering';
    return ticket(imp('run:r-unver', title, 'ready', { when: { verb: 'staged', at: at(12 * m) } }), {
      statusLine: 'not verified — verify it before it can merge',
      actions: [A('previewRun', WORDS.keys.playRun, 'play-run', { runId: 'r-unver', action: 'start' }, { tone: 'ink' }), A('mergeRun', WORDS.keys.merge, 'merge', { runId: 'r-unver' }, { confirm: confirmMerge(title), blocked: WORDS.unverified }), A('discardRun', WORDS.keys.discard, 'discard', { runId: 'r-unver' }, { confirm: confirmDiscard(title) }), A('verifyRun', WORDS.keys.verify, 'verify', { runId: 'r-unver' })],
      attempts: [attempt('r-unver', 1, 'ready', { checks: [{ name: 'npm test', ok: null, note: '' }], initialTab: 'changes', allowedActions: ['preview.start', 'run.discard', 'run.verify'] })],
      factsList: facts('20m ago', '1', '8m', '1 file · +12 −3', 'not run'),
    });
  },
  'pull-request': () => ticket(imp('run:r-pr', 'show the harvest count', 'pull_request', { when: { verb: 'staged', at: at(2 * H) } }), {
    statusLine: 'pull request #12 is open — it merges on GitHub',
    actions: [A('buildEvidence', WORDS.keys.github, 'github-steps', { id: 'r-pr', kind: 'github', attemptId: 'r-pr-attempt' }, { tone: 'ink', tab: 'github' }), A('discardRun', WORDS.keys.discard, 'discard', { runId: 'r-pr' }, { confirm: confirmDiscard('show the harvest count') })],
    attempts: [attempt('r-pr', 1, 'pull_request', { target: 'staging', sha: 'c93a0f7', tabs: ['log', 'changes', 'github'], initialTab: 'log', github: { mode: 'github', delivery: 'pull_request', prNumber: 12, prUrl: 'https://github.com/owner/paper-garden/pull/12', draft: false, toPush: false, pullRequest: true, readyPR: false, needsAttention: false, remoteChanged: false, checks: { status: 'pending', blockers: [] }, notice: '', baseBranch: 'staging' }, checks: [{ name: 'npm test', ok: true, note: '' }, { name: 'github checks', ok: null, note: '' }] })],
    factsList: facts('2h ago', '1', '11m', '2 files · +31 −4', 'passed · github checks pending'),
  }),
  in: () => ticket(imp('run:r-in', 'save the first garden', 'in', { when: { verb: 'landed', at: at(2 * H) } }), {
    statusLine: 'in main since 2h · landed with try 2',
    actions: [A('buildEvidence', WORDS.keys.changes, 'see-changes', { id: 'r-in-2', kind: 'changes', attemptId: 'r-in-2-attempt' }, { tab: 'changes' })],
    attempts: [
      attempt('r-in', 1, 'failed', { startedAt: at(4 * H), endedAt: at(3.5 * H), reason: 'the save test found an empty slot', steps: steps('done', 'done', 'failed', 'waiting'), checks: [{ name: 'npm test', ok: false, note: 'save.test.js: expected 3 plants, got 0' }] }),
      attempt('r-in-2', 2, 'in', { startedAt: at(3 * H), endedAt: at(2 * H), sha: 'e4f5a6b', summary: 'Saves the garden when you leave and reads it back when you return.', initialTab: 'changes' }),
    ],
    factsList: facts('4h ago', '2', '1h 30m', '3 files · +67 −9', 'passed'),
  }),
  failed: () => ticket(imp('run:r-fail', 'remember the garden layout', 'failed', { when: { verb: 'failed', at: at(1 * H) }, reason: 'the layout test timed out waiting for the second row' }), {
    statusLine: 'the layout test timed out waiting for the second row — main is unchanged',
    actions: [A('talkAbout', WORDS.keys.ask, 'ask', { improvementId: 'run:r-fail' }), A('retryRun', WORDS.keys.retry, 'retry', { runId: 'r-fail' }, { tone: 'ink' })],
    attempts: [attempt('r-fail', 1, 'failed', { startedAt: at(85 * m), endedAt: at(61 * m), summary: 'Added a layout store and a test for it. The layout test timed out: the second row never drew.', reason: 'the layout test timed out waiting for the second row', steps: steps('done', 'done', 'failed', 'waiting'), checks: [{ name: 'npm test', ok: false, note: 'garden-layout.test.js: timed out after 30s' }] })],
    factsList: facts('2h ago', '1', '24m', '3 files · +73 −9', 'failed'),
  }),
  interrupted: () => ticket(imp('run:r-int', 'grow moss between the stones', 'interrupted', { when: { verb: 'stopped', at: at(5 * H) } }), {
    statusLine: 'the backend stopped mid-run — its work is kept; try again when you’re ready',
    actions: [A('talkAbout', WORDS.keys.ask, 'ask', { improvementId: 'run:r-int' }), A('retryRun', WORDS.keys.retry, 'retry', { runId: 'r-int' }, { tone: 'ink' })],
    attempts: [attempt('r-int', 1, 'interrupted', { startedAt: at(5.2 * H), endedAt: at(5 * H), reason: 'the backend restarted', steps: steps('done', 'done', 'waiting', 'waiting'), checks: [{ name: 'npm test', ok: null, note: '' }] })],
  }),
  stopped: () => ticket(imp('run:r-stop', 'let the rain fall sideways', 'stopped', { when: { verb: 'stopped', at: at(1 * d) } }), {
    statusLine: 'you stopped it — main is unchanged', actions: [A('retryRun', WORDS.keys.retry, 'retry', { runId: 'r-stop' }, { tone: 'ink' })],
    attempts: [attempt('r-stop', 1, 'stopped', { steps: steps('done', 'done', 'waiting', 'waiting'), checks: [{ name: 'npm test', ok: null, note: '' }] })],
  }),
  discarded: () => ticket(imp('run:r-disc', 'a darker soil texture', 'discarded', { when: { verb: 'discarded', at: at(2 * d) } }), {
    statusLine: 'you discarded it — its branch and worktree are kept', actions: [A('retryRun', WORDS.keys.retry, 'retry', { runId: 'r-disc' }, { tone: 'ink' })],
    attempts: [attempt('r-disc', 1, 'discarded', { initialTab: 'changes' })],
  }),
  done: () => ticket(imp('issue:return', 'remember returning visitors', 'done'), {
    statusLine: 'marked done in issues.md', actions: [A('reopenImprovement', WORDS.keys.reopen, 'reopen', { issueId: 'return' })],
    factsList: facts('from issues.md', 'none yet', '—', '—', '—'), askedVM: asked('remember returning visitors', { source: 'issue' }),
  }),
  gone: () => ({ ...ticket(imp('run:r-gone', 'a thing that was', 'failed')), gone: true }),
};

const BUILD_IMPS = [
  imp('run:r-ready', 'give the seedlings room to grow', 'ready', { when: { verb: 'staged', at: at(6 * m) } }),
  imp('run:r-ask', 'remember where the last seed was planted', 'needs_you', { when: { verb: 'asked you', at: at(3 * m) } }),
  imp('run:r-build', 'grow a quiet evening palette', 'building', { when: { verb: 'started', at: at(4 * m) }, context: 'try 2' }),
  imp('issue:seedling-overlap', 'seedlings overlap near the edge', 'up_next', { context: 'you marked it in progress' }),
  imp('issue:watering', 'watering shortcuts on the keyboard', 'up_next', { context: 'Access' }),
  imp('run:r-queue', 'tidy the watering can sprite', 'up_next', { when: { verb: 'queued', at: at(1 * m) } }),
  imp('run:r-in', 'save the first garden', 'in', { when: { verb: 'landed', at: at(2 * H) } }),
  imp('run:r-in-b', 'a gentler first-run hint', 'in', { when: { verb: 'landed', at: at(26 * H) } }),
  ...Array.from({ length: 7 }, (_, i) => imp(`run:r-f${i}`, ['remember the garden layout', 'a second row of tulips', 'fence posts cast shadows', 'sort seeds by colour', 'a wheelbarrow you can push', 'birds on the fence', 'frost on the first morning'][i], i === 3 ? 'interrupted' : 'failed',
    { when: { verb: i === 3 ? 'stopped' : 'failed', at: at((i + 1) * H) }, reason: i === 3 ? 'the backend restarted' : ['the layout test timed out waiting for the second row', 'npm test: 2 failed', 'the shadow test found no shadow', 'it didn’t finish in 30m', 'the push test timed out', 'the bird sprite is missing', 'frost.test.js failed'][i] })),
];
const BUILD_SETTLED = [imp('run:r-stop', 'let the rain fall sideways', 'stopped', { when: { verb: 'stopped', at: at(1 * d) } }), imp('issue:return', 'remember returning visitors', 'done')];
function build(extra = {}) {
  const improvements = extra.improvements ?? BUILD_IMPS;
  const count = s => improvements.filter(i => i.state === s).length;
  return {
    id: 'main', name: 'main', branch: 'main', line: WORDS.mainLine, word: 'live', badge: { text: '1 needs you', tone: 'attention' }, attention: { text: '1 needs you', tone: 'attention' },
    counts: { waiting: improvements.filter(i => i.group === 'waiting').length, needsYou: count('needs_you'), ready: count('ready'), building: count('building'), upNext: count('up_next'), in: count('in'), inToday: 1, failed: count('failed'), interrupted: count('interrupted') },
    play: { playable: true, running: false, starting: false, url: null, blocked: '', note: fill(WORDS.checkout, { branch: 'codex/tighter-chat-spacing' }), lastCommit: 'a1b2c3d tighten the chat spacing (2 hours ago)' },
    check: { command: 'npm test', real: true }, github: null, improvements, settled: BUILD_SETTLED, list: 'ready', blocked: { start: '', queue: '', play: '' }, ...extra,
  };
}
const BUILDS = {
  build: () => build(),
  'build-playing': () => build({ play: { ...build().play, running: true, url: 'http://127.0.0.1:5173/' } }),
  'build-github': () => build({ line: fill(WORDS.mainLineOther, { branch: 'v2' }), branch: 'v2', github: { mode: 'github', repository: 'owner/paper-garden', integrationBranch: 'v2', releaseBranch: 'main' } }),
  'build-empty': () => build({ improvements: [], settled: [], check: { command: '', real: false }, play: { playable: false, running: false, starting: false, url: null, blocked: fill(WORDS.noPlay, { project: 'paper-garden' }), note: '', lastCommit: '' } }),
  'build-unavailable': () => build({ list: 'unavailable', improvements: BUILD_IMPS.filter(i => i.kind === 'run').slice(0, 4) }),
  'build-demo': () => build({ blocked: { start: WORDS.demoStart, queue: WORDS.demoChange, play: WORDS.demoPlay } }),
};
const project = { id: 'paper-garden', name: 'paper-garden', branch: 'codex/tighter-chat-spacing' };
function model(name, over = {}) {
  if (BUILDS[name]) return { page: { project: 'paper-garden', page: 'build', id: 'main' }, project, build: BUILDS[name](), ticket: null, busy: false, demo: name === 'build-demo', now: NOW, ...over };
  const t = TICKETS[name]();
  return { page: { project: 'paper-garden', page: 'ticket', id: t.improvement.id }, project, build: build(), ticket: t, busy: false, demo: false, now: NOW, ...over };
}

/* ------------------------------------------------------------------------------------------ the harness */
const LOG = [
  { ts: '2026-09-28T11:36:00.000Z', kind: 'run.updated', text: 'running' },
  { ts: '2026-09-28T11:36:01.000Z', kind: 'tool.started', name: 'edit_file', phase: 'started', source: 'governed', input: { path: 'garden.txt', oldText: 'old', newText: 'new' }, attemptId: 'attempt-1' },
  { ts: '2026-09-28T11:36:02.000Z', kind: 'tool.finished', name: 'edit_file', phase: 'finished', source: 'governed', ok: true, summary: 'Replaced 1 match in garden.txt', bytes: 1229, elapsedMs: 420, diff: 'diff --git a/garden.txt b/garden.txt\n-old\n+new\n', attemptId: 'attempt-1' },
  { ts: '2026-09-28T11:36:03.000Z', kind: 'tool.started', name: 'Read', phase: 'started', source: 'native' },
  { ts: '2026-09-28T11:36:04.000Z', kind: 'tool.finished', name: 'web_fetch', phase: 'finished', source: 'governed', ok: false, error: 'Host evil.example is not in the allowlist', elapsedMs: 12 },
  { ts: '2026-09-28T11:36:05.000Z', kind: 'process.output', text: 'npm test — 42 passing' },
];
const DIFF = { branch: 'nibbi/fx-r-ready', target: 'main', diffstat: ' src/garden.js | 12 ++++++++----\n 1 file changed, 8 insertions(+), 4 deletions(-)', diff: 'diff --git a/src/garden.js b/src/garden.js\n--- a/src/garden.js\n+++ b/src/garden.js\n@@ -10,4 +10,8 @@ export function plant(row) {\n-  row.push(seed);\n+  if (row.length && gap(row) < 1) row.push(space());\n+  row.push(seed);\n   return row;\n }\n' };
const GITHUB_READ = { binding: { repository: 'owner/paper-garden', branch: 'nibbi/fx-r-pr', baseBranch: 'staging' }, publication: { headSha: 'c93a0f7' }, pr: { number: 12, url: 'https://github.com/owner/paper-garden/pull/12', state: 'OPEN', isDraft: false, headSha: 'c93a0f7' }, allowedActions: [], checks: [] };

async function harness(browser, viewport, { touch = false, reduced = false } = {}) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block', timezoneId: 'UTC', hasTouch: touch, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await context.newPage(); page.setDefaultTimeout(5000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('https://pages.test/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
      <link rel="stylesheet" href="/tokens.css"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/margins.css"><link rel="stylesheet" href="/project-workspace.css"><link rel="stylesheet" href="/project-pages.css">
      <style>:root{--feed-top:136px;--workspace-left:256px}.harness-bar{position:fixed;inset:0 auto 0 0;width:256px;background:var(--paper-bar)}@media (max-width:899px){:root{--feed-top:89px;--workspace-left:0px}.harness-bar{display:none}}</style>
      </head><body class="project-view"><div class="harness-bar" aria-hidden="true"></div><section id="project-workspace" class="project-workspace"><div class="cp-page-host"></div></section></body></html>` });
    const types = { '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
    try { return route.fulfill({ contentType: types[extname(path)] || 'text/javascript', body: readFileSync(resolve(root, '.' + path)) }); } catch { return route.fulfill({ status: 404 }); }
  });
  await page.goto('https://pages.test/');
  await page.evaluate(async ({ LOG, DIFF, GITHUB_READ }) => {
    window.calls = []; window.logs = {}; window.hold = null; window.fail = {};
    const { installProjectPages } = await import('/lib/project-pages.js');
    const { parseDiff, escapeHtml } = await import('/lib/text.js');
    // the app's renderDiff (app.js), so the Changes tab and the Log's diff cards are the real card
    window.renderDiff = d => {
      const wrap = document.createElement('div'); wrap.className = 'diffv'; wrap.dataset.branch = d.branch || ''; wrap.dataset.target = d.target ?? '';
      const head = document.createElement('div'); head.className = 'dh'; head.textContent = (d.branch || '') + (d.target ? ' → ' + d.target : '');
      const files = parseDiff(d.diff), stat = document.createElement('pre'); stat.className = 'dstat';
      stat.textContent = (d.diffstat || '').trim() || files.length + ' file' + (files.length === 1 ? '' : 's') + ' changed';
      const body = document.createElement('div'); body.className = 'dfiles';
      for (const f of files) {
        const det = document.createElement('details'); det.className = 'dfile'; det.open = true;
        const sum = document.createElement('summary'); sum.innerHTML = '<span class="fn">' + escapeHtml(f.name || d.branch) + '</span><span class="cnt"><b class="pa">+' + f.add + '</b> <b class="pd">−' + f.del + '</b></span>';
        const pre = document.createElement('pre'); pre.className = 'dbody';
        for (const ln of f.lines) { const s = document.createElement('span'); s.className = 'ln' + (ln.startsWith('@@') ? ' dhunk' : ln.startsWith('+') ? ' dadd' : ln.startsWith('-') ? ' ddel' : ''); s.textContent = ln || ' '; pre.appendChild(s); }
        det.append(sum, pre); body.appendChild(det);
      }
      wrap.append(head, stat, body); return wrap;
    };
    const renderMarkdown = text => { const frag = document.createDocumentFragment(); for (const para of String(text).split(/\n\n+/)) { const p = document.createElement('p'); p.innerHTML = escapeHtml(para).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'); frag.append(p); } return frag; };
    const host = document.querySelector('.cp-page-host');
    window.pages = installProjectPages({ host, renderMarkdown, renderDiff: window.renderDiff, onAction: async (name, project, value) => {
      const clean = value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([k]) => k !== 'signal')) : value;
      calls.push({ name, project, value: clean });
      if (window.hold?.name === name) await new Promise(done => { window.hold.release = done; });
      if (window.fail[name]) { const error = new Error(window.fail[name].message); if (window.fail[name].code) error.code = window.fail[name].code; throw error; }
      if (name === 'buildEvidence') {
        if (value.kind === 'log') return { entries: structuredClone(window.logs[value.id] || LOG) };
        if (value.kind === 'changes') return structuredClone(DIFF);
        return { verification: { status: 'passed', command: 'npm test', detail: '8 checks passed.' } };
      }
      if (name === 'githubRead') return structuredClone(GITHUB_READ);
      return { ok: true };
    } });
  }, { LOG, DIFF, GITHUB_READ });
  const open = (name, over = {}, focus = false) => page.evaluate(([mdl, focus]) => pages.open(mdl, { focus }), [model(name, over), focus]);
  const update = (name, over = {}) => page.evaluate(mdl => pages.update(mdl), model(name, over));
  const calls = () => page.evaluate(() => window.calls);
  const clear = () => page.evaluate(() => { window.calls = []; });
  const settle = () => page.waitForFunction(() => document.querySelector('.cp-page')?.getAttribute('aria-busy') === 'false');
  return { page, context, errors, open, update, calls, clear, settle };
}
const launch = () => chromium.launch({ channel: process.env.CI ? undefined : 'chrome' });
// an arriving confirm or form is photographed once it has arrived (the loops — pulse — never finish)
const shot = async (page, name, viewport) => {
  await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))));
  await page.screenshot({ path: resolve(SHOTS, `pages-${name}-${viewport.width}x${viewport.height}.png`) });
};
const inkCount = page => page.locator('.cp-page .cp-act-ink:visible').count();
const shortKeys = page => page.locator('.cp-page button:visible, .cp-page a:visible').evaluateAll(els => els.filter(el => el.getBoundingClientRect().height < 43.9).map(el => `${el.className} "${el.textContent.trim().slice(0, 30)}" ${el.getBoundingClientRect().height}`));
const overflow = page => page.evaluate(() => { const body = document.querySelector('.cp-page-body'); return { page: document.documentElement.scrollWidth > innerWidth, body: body.scrollWidth > body.clientWidth + 1 }; });
const probe = (page, name) => page.evaluate(n => { const el = document.createElement('span'); el.style.color = `var(${n})`; document.body.append(el); const c = getComputedStyle(el).color; el.remove(); return c; }, name);

/* ------------------------------------------------------------------------------------------ tests */
test('every state draws at 1180×820 and 390×844: one ink key, 44px keys on touch, no sideways scroll', async () => {
  const browser = await launch();
  try {
    for (const [viewport, touch] of [[DESKTOP, false], [PHONE, true]]) {
      const h = await harness(browser, viewport, { touch });
      try {
        for (const name of [...Object.keys(TICKETS), ...Object.keys(BUILDS)]) {
          await h.open(name); await h.settle();
          const mdl = model(name);
          const rootAttrs = await h.page.locator('.cp-page').evaluate(el => ({ page: el.dataset.cpPage, id: el.dataset.cpId, state: el.dataset.state || null }));
          assert.equal(rootAttrs.page, mdl.page.page, name);
          assert.equal(rootAttrs.id, mdl.page.id, name);
          if (mdl.ticket && !mdl.ticket.gone) {
            assert.equal(rootAttrs.state, mdl.ticket.improvement.state, `${name}: the root says its state`);
            assert.equal(await h.page.locator('.cp-status .cp-state').innerText(), mdl.ticket.improvement.word, `${name}: the big word`);
            assert.equal(await h.page.locator('.cp-status').getAttribute('data-status'), mdl.ticket.improvement.state);
            assert.equal(await h.page.locator('.cp-page h1').innerText(), mdl.ticket.improvement.title);
          }
          assert.ok(await inkCount(h.page) <= 1, `${name}: at most one ink key at ${viewport.width}`);
          assert.deepEqual(await h.page.locator('.cp-page').evaluate(el => [getComputedStyle(el, '::before').content, getComputedStyle(el.querySelector('.cp-title')).whiteSpace]), ['none', 'normal'], `${name}: nothing of the bar's .cp-build / .cp-title reaches the page`);
          assert.deepEqual(await overflow(h.page), { page: false, body: false }, `${name}: nothing scrolls sideways at ${viewport.width}`);
          if (touch) assert.deepEqual(await shortKeys(h.page), [], `${name}: every key is 44 tall at 390 touch`);
          await shot(h.page, name, viewport);
          if (mdl.ticket?.attempts?.length) {   // and the work: the latest try's card and its evidence
            await h.page.locator('.cp-try').last().evaluate(el => el.scrollIntoView({ block: 'start' }));
            await shot(h.page, `${name}-work`, viewport);
          }
        }
        // the edit form, the guide field, an armed stop and the build page's + improvement, open
        await h.open('up-next'); await h.page.locator('[data-cp-key="edit"]').click();
        assert.ok(await inkCount(h.page) <= 1); await shot(h.page, 'up-next-editing', viewport);
        await h.open('needs-you'); await h.page.locator('[data-cp-key="guide"]').click();
        assert.equal(await inkCount(h.page), 1, 'the guide field takes the ink key'); assert.equal(await h.page.locator('.cp-steer .cp-act-ink').count(), 1);
        if (touch) assert.deepEqual(await shortKeys(h.page), []);
        await shot(h.page, 'needs-you-guiding', viewport);
        await h.open('building'); await h.page.locator('[data-cp-key="stop"]').click();
        assert.equal(await inkCount(h.page), 0, 'an armed question has no ink key, only its red yes'); assert.equal(await h.page.locator('.cp-confirm .armed').count(), 1);
        await shot(h.page, 'building-stop-armed', viewport);
        await h.open('ready'); await h.page.locator('[data-cp-key="merge"]').click();
        assert.equal(await inkCount(h.page), 1); assert.equal(await h.page.locator('.cp-confirm .cp-act-ink').count(), 1, 'merge’s yes is the ink key while it asks');
        await shot(h.page, 'ready-merge-asking', viewport);
        await h.open('build'); await h.page.locator('[data-cp-key="add"]').click(); await h.page.locator('[data-cp-key="add-field"]').fill('a scarecrow that waves');
        assert.equal(await inkCount(h.page), 1, 'play main keeps the ink key; start now is seated beside it');
        if (touch) assert.deepEqual(await shortKeys(h.page), []);
        await shot(h.page, 'build-adding', viewport);
        await h.open('build-playing');
        assert.equal(await h.page.locator('.cp-add').count(), 1, 'the open form and its words survive the update');
        assert.equal(await h.page.locator('[data-cp-key="add-field"]').inputValue(), 'a scarecrow that waves');
        assert.equal(await h.page.locator('[data-cp-key="add-start"]').getAttribute('class').then(c => c.includes('cp-act-ink')), true, 'with main playing, the form’s start now is the ink key');
        assert.equal(await inkCount(h.page), 1);
        await shot(h.page, 'build-playing-adding', viewport);
        await h.page.keyboard.press('Escape');
        assert.deepEqual(h.errors, []);
      } finally { await h.context.close(); }
    }
  } finally { await browser.close(); }
});

test('each ticket key sends its payload; asking twice sends only on yes; forms send their words', async () => {
  const browser = await launch();
  const h = await harness(browser, DESKTOP);
  const sent = async () => (await h.calls()).filter(c => c.name !== 'buildEvidence' && c.name !== 'githubRead' && c.name !== 'githubRefresh');
  try {
    // plain keys: one press, one call, the ActionVM's payload
    for (const [name, key, want] of [
      ['up-next', 'mark-done', { name: 'completeImprovement', value: { issueId: 'seedling-overlap' } }],
      ['up-next', 'build-now', { name: 'buildIssue', value: { issueId: 'seedling-overlap' } }],
      ['queued', 'cancel', { name: 'stopRun', value: { runId: 'r-queue' } }],
      ['ready', 'play-run', { name: 'previewRun', value: { runId: 'r-ready', action: 'start' } }],
      ['ready-playing', 'open-run', { name: 'previewRun', value: { runId: 'r-ready', action: 'open' } }],
      ['ready-playing', 'stop-playing', { name: 'previewRun', value: { runId: 'r-ready', action: 'stop' } }],
      ['unverified', 'verify', { name: 'verifyRun', value: { runId: 'r-unver' } }],
      ['failed', 'ask', { name: 'talkAbout', value: { improvementId: 'run:r-fail' } }],
      ['failed', 'retry', { name: 'retryRun', value: { runId: 'r-fail' } }],
      ['interrupted', 'retry', { name: 'retryRun', value: { runId: 'r-int' } }],
      ['stopped', 'retry', { name: 'retryRun', value: { runId: 'r-stop' } }],
      ['discarded', 'retry', { name: 'retryRun', value: { runId: 'r-disc' } }],
      ['done', 'reopen', { name: 'reopenImprovement', value: { issueId: 'return' } }],
    ]) {
      await h.open(name); await h.settle(); await h.clear();
      await h.page.locator(`[data-cp-key="${key}"]`).click();
      await h.page.waitForFunction(() => window.calls.some(c => c.name !== 'buildEvidence'));
      assert.deepEqual((await sent()).map(({ name, value }) => ({ name, value })), [want], `${name}: ${key}`);
      for (const c of await sent()) assert.equal(c.project, 'paper-garden');
    }
    // the crumb, the fact's crumb, × and the talk link
    await h.open('ready'); await h.settle(); await h.clear();
    await h.page.locator('[data-cp-key="crumb"]').click(); await h.page.locator('[data-cp-key="fact-build"]').click();
    await h.page.locator('[data-cp-key="close"]').click(); await h.page.locator('[data-cp-key="talk"]').click();
    await h.page.waitForFunction(() => window.calls.length >= 4);
    assert.deepEqual((await sent()).map(({ name, value }) => [name, value ?? null]), [['openBuild', 'main'], ['openBuild', 'main'], ['backToChat', null], ['talkAbout', { improvementId: 'run:r-ready' }]]);
    assert.equal(await h.page.locator('[data-cp-key="close"]').getAttribute('aria-label'), WORDS.keys.close);

    // ask twice: the first press opens the question on its "no", and sends nothing
    for (const [name, key, want] of [['building', 'stop', { name: 'stopRun', value: { runId: 'r-build-2' } }], ['ready', 'merge', { name: 'mergeRun', value: { runId: 'r-ready' } }], ['ready', 'discard', { name: 'discardRun', value: { runId: 'r-ready' } }]]) {
      await h.open(name); await h.settle(); await h.clear();
      const opener = h.page.locator(`[data-cp-key="${key}"]`);
      await opener.click();
      assert.equal(await h.page.locator('.cp-confirm').isVisible(), true, `${key} asks`);
      assert.equal(await opener.getAttribute('aria-expanded'), 'true');
      assert.equal(await h.page.evaluate(() => document.activeElement?.dataset.cpKey), 'confirm-no', 'focus is on its no');
      assert.deepEqual(await sent(), [], `${key}: the first press sends nothing`);
      await h.page.locator('[data-cp-key="confirm-no"]').click();
      assert.equal(await h.page.locator('.cp-confirm').isVisible(), false, 'no closes it');
      assert.equal(await h.page.evaluate(() => document.activeElement?.dataset.cpKey), key, 'and focus is back on the key that asked');
      await opener.click(); await h.page.keyboard.press('Escape');
      assert.equal(await h.page.locator('.cp-confirm').isVisible(), false, 'Escape closes it');
      assert.equal(await h.page.evaluate(() => document.activeElement?.dataset.cpKey), key);
      assert.deepEqual(await sent(), []);
      await opener.click();
      await h.update(name, { now: NOW + 30_000 });
      assert.equal(await h.page.locator('.cp-confirm').isVisible(), true, 'an open question survives an update');
      await h.page.locator('[data-cp-key="confirm-yes"]').click();
      await h.page.waitForFunction(() => window.calls.some(c => c.name !== 'buildEvidence'));
      assert.deepEqual((await sent()).map(({ name, value }) => ({ name, value })), [want], `${key}: yes sends it once`);
      assert.equal(await h.page.locator('.cp-confirm').isVisible(), false, 'answered, it closes');
      if (key === 'merge') assert.equal(await h.page.locator('.cp-notice').innerText(), 'merged into main.');
    }

    // edit the words: the title becomes a field; save sends both; a conflict keeps the words
    await h.open('up-next'); await h.settle(); await h.clear();
    await h.page.locator('[data-cp-key="edit"]').click();
    assert.equal(await h.page.evaluate(() => document.activeElement?.dataset.cpKey), 'edit-title');
    assert.equal(await h.page.locator('.cp-page h1').count(), 0, 'the title is the field now');
    assert.equal(await h.page.locator('[data-cp-key="edit-save"]').isDisabled(), true, 'nothing changed yet');
    assert.equal(await h.page.locator('.cp-actions').count(), 0, 'the keys wait while the words are edited');
    await h.page.evaluate(() => { window.fail.editImprovement = { message: 'The document changed.', code: 'REVISION_CONFLICT' }; });
    await h.page.locator('[data-cp-key="edit-title"]').fill('seedlings leave room at the fence');
    await h.page.locator('[data-cp-key="edit-desc"]').fill('Keep my unsaved notes.');
    // the list moves while the words are edited: the save still goes against the list they were read from
    const movedList = over => { const next = model('up-next', over); next.ticket.actions[0].payload.revision = 'rev-2'; return next; };
    await h.page.evaluate(mdl => pages.update(mdl), movedList({ now: NOW + 30_000 }));
    await h.page.locator('[data-cp-key="edit-save"]').click();
    await h.page.locator('.cp-edit .cp-page-note[data-kind="error"]').waitFor();
    assert.equal(await h.page.locator('.cp-edit .cp-page-note').innerText(), 'the list changed — your words are still here; save again');
    assert.equal(await h.page.locator('[data-cp-key="edit-title"]').inputValue(), 'seedlings leave room at the fence');
    await h.page.evaluate(mdl => pages.update(mdl), movedList({ now: NOW + 60_000 }));
    assert.equal(await h.page.locator('[data-cp-key="edit-desc"]').inputValue(), 'Keep my unsaved notes.', 'an update keeps the words being edited');
    assert.equal(await h.page.evaluate(() => pages.snapshot().hasDraft), true);
    await h.page.evaluate(() => { delete window.fail.editImprovement; });
    await h.page.locator('[data-cp-key="edit-save"]').click();
    await h.page.locator('.cp-page h1').waitFor();
    assert.deepEqual((await sent()).map(c => c.value), [
      { issueId: 'seedling-overlap', title: 'seedlings leave room at the fence', description: 'Keep my unsaved notes.', revision: 'rev-1' },
      { issueId: 'seedling-overlap', title: 'seedlings leave room at the fence', description: 'Keep my unsaved notes.', revision: 'rev-2' },
    ], 'the first save goes against the list the words were read from; refused, the second against the list as it is now');
    assert.equal(await h.page.evaluate(() => document.activeElement?.dataset.cpKey), 'edit', 'saved, focus is back on edit the words');

    // guide it: one field under the keys; Enter sends it; the notice says where it went, in ink
    await h.open('building'); await h.settle(); await h.clear();
    await h.page.locator('[data-cp-key="guide"]').click();
    assert.equal(await h.page.evaluate(() => document.activeElement?.dataset.cpKey), 'steer-field');
    await h.page.keyboard.type('keep the day palette as it is');
    await h.page.keyboard.press('Shift+Enter'); await h.page.keyboard.type('only change dusk');
    await h.page.keyboard.press('Enter');
    await h.page.waitForFunction(() => window.calls.some(c => c.name === 'steerRun'));
    assert.deepEqual((await sent()).map(({ name, value }) => ({ name, value })), [{ name: 'steerRun', value: { runId: 'r-build-2', text: 'keep the day palette as it is\nonly change dusk' } }]);
    await h.page.locator('.cp-notice:not([hidden])').waitFor();
    assert.equal(await h.page.locator('.cp-notice').innerText(), 'sent to try 2 — it reads it at its next step');
    assert.deepEqual(await h.page.locator('.cp-notice').evaluate(el => [el.dataset.kind, getComputedStyle(el).color]), ['', await probe(h.page, '--ink-2')], 'information is ink');

    // see its changes: the latest try's Changes tab, read, focused; the github steps: its GitHub tab
    await h.open('in'); await h.settle(); await h.clear();
    await h.page.locator('[data-cp-key="see-changes"]').click();
    await h.page.waitForFunction(() => document.activeElement?.dataset.cpKey === 'tab-r-in-2-changes');
    assert.deepEqual(await sent(), [], 'see its changes sends nothing but its read');
    await h.page.locator('[data-cp-run="r-in-2"] .project-evidence-panel .diffv').waitFor();
    await h.open('pull-request'); await h.settle(); await h.clear();
    await h.page.locator('[data-cp-key="github-steps"]').click();
    await h.page.locator('[data-cp-run="r-pr"] .github-panel').waitFor();
    assert.equal(await h.page.locator('[data-cp-key="tab-r-pr-github"]').getAttribute('aria-pressed'), 'true');
    assert.ok((await h.calls()).some(c => c.name === 'githubRead' && c.value.buildId === 'r-pr'), 'the GitHub panel reads through onAction');
    assert.match(await h.page.locator('[data-cp-run="r-pr"] .cp-try-head').innerText(), /nibbi\/fx-r-pr → staging/);
    assert.deepEqual(h.errors, []);
  } finally { await h.context.close(); await browser.close(); }
});

test('blocked keys dispatch nothing and say why; busy holds only the keys that start a run', async () => {
  const browser = await launch();
  const h = await harness(browser, DESKTOP);
  const sent = async () => (await h.calls()).filter(c => c.name !== 'buildEvidence');
  try {
    await h.open('unverified'); await h.settle(); await h.clear();
    const merge = h.page.locator('[data-cp-key="merge"]');
    assert.equal(await merge.isDisabled(), true);
    assert.equal(await merge.getAttribute('title'), WORDS.unverified);
    assert.equal(await h.page.locator('.cp-blocked').innerText(), WORDS.unverified, 'the words show once under the keys');
    await merge.click({ force: true }); await merge.dispatchEvent('click');
    assert.equal(await h.page.locator('.cp-confirm').isVisible(), false);
    assert.deepEqual(await sent(), [], 'a blocked key sends nothing, nor asks');

    await h.open('failed'); await h.settle(); await h.clear();
    await h.page.evaluate(() => pages.setBusy(true));
    assert.equal(await h.page.locator('[data-cp-key="retry"]').isDisabled(), true, 'try again waits for nibbi’s reply');
    assert.equal(await h.page.locator('[data-cp-key="retry"]').getAttribute('title'), WORDS.busy);
    assert.equal(await h.page.locator('[data-cp-key="ask"]').isDisabled(), false, 'asking about it does not wait');
    await h.page.locator('[data-cp-key="retry"]').dispatchEvent('click');
    assert.deepEqual(await sent(), []);
    await h.page.evaluate(() => pages.setBusy(false));
    assert.equal(await h.page.locator('[data-cp-key="retry"]').isDisabled(), false);
    await h.open('ready', { busy: true }); await h.settle();
    for (const key of ['play-run', 'merge', 'discard']) assert.equal(await h.page.locator(`[data-cp-key="${key}"]`).isDisabled(), false, `${key} works while nibbi answers`);
    await h.open('failed', { demo: true }); await h.settle();
    assert.equal(await h.page.locator('[data-cp-key="retry"]').getAttribute('title'), WORDS.demoStart, 'demo refuses in words');

    // the build page: busy holds start now, in words, and up next still goes
    await h.open('build', { busy: true }); await h.settle(); await h.clear();
    assert.equal(await h.page.locator('[data-cp-key="play"]').isDisabled(), false, 'play main works while nibbi answers');
    await h.page.locator('[data-cp-key="add"]').click();
    await h.page.keyboard.type('a scarecrow that waves');
    assert.equal(await h.page.locator('[data-cp-key="add-start"]').isDisabled(), true);
    assert.equal(await h.page.locator('[data-cp-key="add-start"]').getAttribute('title'), WORDS.busy);
    await h.page.keyboard.press('Enter');
    assert.equal(await h.page.locator('.cp-add .cp-page-note').innerText(), WORDS.busy, 'Enter says why it waits');
    assert.deepEqual(await sent(), []);
    await h.page.locator('[data-cp-key="add-queue"]').click();
    await h.page.waitForFunction(() => window.calls.some(c => c.name === 'queueImprovement'));
    assert.deepEqual((await sent()).map(({ name, value }) => ({ name, value })), [{ name: 'queueImprovement', value: { text: 'a scarecrow that waves' } }]);
    await h.open('build-demo'); await h.settle();
    assert.equal(await h.page.locator('[data-cp-key="play"]').getAttribute('title'), WORDS.demoPlay);
    assert.match(await h.page.locator('.cp-preview-stage').innerText(), new RegExp(WORDS.demoPlay));
    assert.deepEqual(h.errors, []);
  } finally { await h.context.close(); await browser.close(); }
});

test('Escape takes back only what the page opened, × goes back to chat, and a gone ticket keeps only ×', async () => {
  const browser = await launch();
  const h = await harness(browser, DESKTOP);
  // dispatchEvent returns false when the page took it; a document listener sees what it left alone
  const escape = key => h.page.evaluate(k => { window.seen = 0; const f = () => { window.seen++; }; document.addEventListener('keydown', f); const el = k ? document.querySelector(`[data-cp-key="${k}"]`) : document.querySelector('.cp-page-body'); const left = el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); document.removeEventListener('keydown', f); return { left, seen: window.seen }; }, key);
  try {
    await h.open('build'); await h.settle();
    assert.deepEqual(await escape(), { left: true, seen: 1 }, 'nothing open: the event goes on to the frame and the app');
    await h.page.locator('[data-cp-key="add"]').click();
    assert.deepEqual(await escape('add-field'), { left: false, seen: 0 }, 'the form takes it');
    assert.equal(await h.page.locator('.cp-add').count(), 0);
    assert.equal(await h.page.evaluate(() => document.activeElement?.dataset.cpKey), 'add', 'focus is back on + improvement');
    await h.page.locator('[data-cp-key="failed-more"]').click();
    assert.equal(await h.page.locator('.cp-imp-group[data-cp-group="failed"] .cp-imp').count(), 7);
    assert.deepEqual(await escape('failed-more'), { left: false, seen: 0 }, 'an open fold takes it');
    assert.equal(await h.page.locator('.cp-imp-group[data-cp-group="failed"] .cp-imp').count(), 5);
    await h.open('building'); await h.settle();
    await h.page.locator('[data-cp-key="guide"]').click();
    assert.deepEqual(await escape('steer-field'), { left: false, seen: 0 });
    await h.page.locator('[data-cp-key="stop"]').click();
    assert.deepEqual(await escape('confirm-no'), { left: false, seen: 0 });
    assert.deepEqual(await escape(), { left: true, seen: 1 });
    await h.open('up-next'); await h.settle(); await h.page.locator('[data-cp-key="edit"]').click();
    assert.deepEqual(await escape('edit-title'), { left: false, seen: 0 });
    assert.equal(await h.page.locator('.cp-page h1').count(), 1);

    await h.open('gone'); await h.settle(); await h.clear();
    assert.equal(await h.page.locator('.cp-page h1').innerText(), WORDS.gone);
    assert.deepEqual(await h.page.locator('.cp-page button').evaluateAll(els => els.map(el => el.dataset.cpKey)), ['close'], 'only × remains');
    await h.page.locator('[data-cp-key="close"]').click();
    await h.page.waitForFunction(() => window.calls.length === 1);
    assert.deepEqual((await h.calls()).map(c => c.name), ['backToChat']);
    await h.open('failed', {}, true);
    assert.equal(await h.page.evaluate(() => document.activeElement?.tagName), 'H1', 'opened with focus, the title takes it');
    assert.deepEqual(await h.page.evaluate(() => pages.snapshot()), { page: 'ticket', id: 'run:r-fail', project: 'paper-garden', hasDraft: false, confirming: null });
    await h.page.evaluate(() => pages.close());
    assert.equal(await h.page.evaluate(() => pages.snapshot()), null);
    assert.equal(await h.page.locator('.cp-page').count(), 0);
    assert.deepEqual(h.errors, []);
  } finally { await h.context.close(); await browser.close(); }
});

test('the Log renders the event trail as rows: tool labels, exact names, verdicts and a diff card', async () => {
  const browser = await launch();
  try {
    for (const [viewport, touch] of [[DESKTOP, false], [PHONE, true]]) {
      const h = await harness(browser, viewport, { touch });
      try {
        await h.open('failed'); await h.settle();
        const log = h.page.locator('[data-cp-run="r-fail"] .project-log'); await log.waitFor();
        assert.deepEqual((await h.calls()).filter(c => c.name === 'buildEvidence').map(c => c.value), [{ id: 'r-fail', kind: 'log', attemptId: 'r-fail-attempt' }], 'one read, with its attempt');
        const rows = await log.locator('.project-log-entry').evaluateAll(els => els.map(el => ({ kind: el.dataset.kind, phase: el.dataset.phase || '', ok: el.dataset.ok || '', badge: el.querySelector('.project-log-kind')?.textContent, label: el.querySelector('.project-log-label')?.textContent || '', name: el.querySelector('.project-log-name')?.textContent || '', meta: el.querySelector('.project-log-meta')?.textContent || '', text: el.querySelector('.project-log-text')?.textContent || '' })));
        assert.equal(rows.length, 6);
        assert.deepEqual(rows[0], { kind: 'run.updated', phase: '', ok: '', badge: 'run', label: '', name: '', meta: '', text: 'running' });
        assert.deepEqual(rows[1], { kind: 'tool.started', phase: 'started', ok: '', badge: 'file', label: 'editing', name: 'edit_file', meta: 'garden.txt', text: '' });
        assert.deepEqual([rows[2].phase, rows[2].ok, rows[2].meta], ['finished', 'true', 'Replaced 1 match in garden.txt · 0.4s · 1.2 KB']);
        assert.deepEqual([rows[3].badge, rows[3].label, rows[3].name, rows[3].meta], ['native', 'reading', 'Read', '']);
        assert.deepEqual([rows[4].badge, rows[4].label, rows[4].ok, rows[4].meta], ['web', 'reading a page', 'false', 'Host evil.example is not in the allowlist · 0.0s']);
        assert.deepEqual([rows[5].badge, rows[5].text], ['output', 'npm test — 42 passing']);
        assert.equal(await log.locator('.project-log-entry').first().locator('.project-log-time').innerText(), '11:36:00', 'a terminal’s clock');
        assert.equal(await h.page.locator('[data-cp-key="tab-r-fail-log"] .cp-tab-count').innerText(), '6');
        const diff = log.locator('.project-log-entry').nth(2).locator('.project-log-detail .diffv');
        assert.equal(await diff.count(), 1);
        assert.deepEqual(await diff.evaluate(el => [el.dataset.branch, el.dataset.target]), ['garden.txt', ''], 'the diff card is headed by the path its started row named, with no target');
        assert.equal(await log.locator('.project-log-entry').nth(2).locator('.project-log-detail > summary').innerText(), 'result · diff');
        const detail = log.locator('.project-log-entry').nth(1).locator('.project-log-detail');
        assert.equal(await detail.locator('> summary').innerText(), 'input');
        assert.equal(await detail.locator('.project-evidence-code').isVisible(), false, 'the input stays folded until asked for');
        await detail.locator('> summary').click();
        assert.match(await detail.locator('.project-evidence-code').innerText(), /"oldText": "old"/);
        assert.equal(await log.locator('.project-log-entry').nth(3).locator('.project-log-detail').count(), 0, 'name-only native rows have nothing to open');
        assert.deepEqual(await overflow(h.page), { page: false, body: false }, 'log rows never widen the page');
        await log.evaluate(el => el.scrollIntoView({ block: 'center' }));
        await shot(h.page, 'failed-log', viewport);
        // Changes: the app's diff card
        await h.page.locator('[data-cp-key="tab-r-fail-changes"]').click();
        await h.page.locator('[data-cp-run="r-fail"] .project-evidence-panel > .diffv').waitFor();
        assert.equal(await h.page.locator('[data-cp-run="r-fail"] .diffv .dh').innerText(), 'nibbi/fx-r-ready → main');
        await h.page.locator('[data-cp-run="r-fail"] .cp-evidence').evaluate(el => el.scrollIntoView({ block: 'start' }));
        await shot(h.page, 'failed-changes', viewport);
        // a text log keeps the plain block; a failed read says so and reads again on request
        await h.page.evaluate(() => { window.logs['r-stop'] = 'plain text log'; window.fail.buildEvidence = { message: 'the log is unreachable' }; });
        await h.open('stopped'); await h.settle();
        assert.equal(await h.page.locator('[data-cp-run="r-stop"] .project-form-error').innerText(), 'the log is unreachable');
        await h.page.evaluate(() => { delete window.fail.buildEvidence; });
        await h.page.locator('[data-cp-key="tab-r-stop-log-again"]').click();
        await h.page.locator('[data-cp-run="r-stop"] pre.cp-terminal').waitFor();
        assert.equal(await h.page.locator('[data-cp-run="r-stop"] pre.cp-terminal').innerText(), 'plain text log');
        assert.deepEqual(h.errors, []);
      } finally { await h.context.close(); }
    }
  } finally { await browser.close(); }
});

test('play it starts the preview, open it reopens it, and a preview that will not start is said; play main likewise', async () => {
  const browser = await launch();
  try {
    for (const [viewport, touch] of [[DESKTOP, false], [PHONE, true]]) {
      const h = await harness(browser, viewport, { touch });
      try {
        await h.open('ready'); await h.settle(); await h.clear();
        await h.page.evaluate(() => { window.hold = { name: 'previewRun' }; });
        const play = h.page.locator('[data-cp-key="play-run"]');
        await play.click();
        assert.equal(await play.getAttribute('aria-busy'), 'true', 'play it holds while the preview starts');
        await play.click({ force: true });
        assert.equal((await h.calls()).filter(c => c.name === 'previewRun').length, 1, 'a second press does not start another');
        assert.equal(await h.page.evaluate(() => document.activeElement?.dataset.cpKey), 'play-run', 'and keeps its focus');
        await h.page.evaluate(() => { window.hold.release(); window.hold = null; });
        await h.page.waitForFunction(() => !document.querySelector('[data-cp-key="play-run"]')?.hasAttribute('aria-busy'));
        await h.update('ready-playing');
        await h.page.locator('[data-cp-key="open-run"]').click();
        await h.page.waitForFunction(() => window.calls.filter(c => c.name === 'previewRun').length === 2);
        assert.deepEqual((await h.calls()).filter(c => c.name === 'previewRun').map(c => c.value.action), ['start', 'open'], 'reopening does not start another preview');
        await shot(h.page, 'ready-playing', viewport);
        await h.update('ready');
        await h.page.evaluate(() => { window.fail.previewRun = { message: 'the preview stopped before it was ready — its log says why' }; });
        await h.page.locator('[data-cp-key="play-run"]').click();
        await h.page.locator('.cp-notice[data-kind="error"]').waitFor();
        assert.equal(await h.page.locator('.cp-notice').innerText(), 'the preview stopped before it was ready — its log says why');
        assert.equal(await h.page.locator('.cp-notice').evaluate(el => getComputedStyle(el).color), await probe(h.page, '--fail-text'), 'a failure is the verdict colour');
        await h.page.evaluate(() => { delete window.fail.previewRun; });

        await h.open('build'); await h.settle(); await h.clear();
        assert.equal(await h.page.locator('[data-cp-key="play"]').getAttribute('class').then(c => c.includes('cp-act-ink')), true, 'play main is the build page’s one ink key');
        await h.page.locator('[data-cp-key="play"]').click();
        await h.update('build-playing');
        assert.equal(await h.page.locator('.cp-preview').getAttribute('data-playing'), 'true');
        assert.match(await h.page.locator('.cp-preview-bar').innerText(), /127\.0\.0\.1:5173/);
        await h.page.locator('[data-cp-key="play-open"]').click(); await h.page.locator('[data-cp-key="play-stop"]').click();
        await h.page.waitForFunction(() => window.calls.length === 3);
        assert.deepEqual((await h.calls()).map(c => [c.name, c.value]), [['playMain', { action: 'start' }], ['playMain', { action: 'open' }], ['playMain', { action: 'stop' }]]);
        await h.open('build-github'); await h.settle(); await h.clear();
        await h.page.locator('[data-cp-key="repository"]').click();
        await h.page.locator('.cp-imp[data-cp-key="imp-run:r-ready"]').click();
        await h.page.locator('[data-cp-key="hist-run:r-in"]').click();
        await h.page.waitForFunction(() => window.calls.length === 3);
        assert.deepEqual((await h.calls()).map(c => [c.name, c.value ?? null]), [['repository', null], ['openImprovement', 'run:r-ready'], ['openImprovement', 'run:r-in']]);
        assert.equal(await h.page.locator('.cp-copyline').innerText(), 'live · lands on v2');
        assert.deepEqual(h.errors, []);
      } finally { await h.context.close(); }
    }
  } finally { await browser.close(); }
});

test('an update keeps focus, the open log node and its tail; a live event joins it, on screen or not', async () => {
  const browser = await launch();
  const h = await harness(browser, DESKTOP);
  const entries = () => h.page.evaluate(() => window.heldLog.querySelectorAll('.project-log-entry').length);
  try {
    await h.open('failed'); await h.settle();
    await h.page.locator('[data-cp-run="r-fail"] .project-log').waitFor();
    await h.page.locator('[data-cp-key="tab-r-fail-log"]').focus();
    await h.page.evaluate(() => { window.heldLog = document.querySelector('[data-cp-run="r-fail"] .project-log'); window.heldTab = document.activeElement; });
    const next = model('failed', { now: NOW + 5 * m }); next.ticket.statusLine = 'the layout test timed out on the second row — main is unchanged'; next.ticket.attempts[0].summary = 'A concurrently rewritten summary.';
    await h.page.evaluate(mdl => pages.update(mdl), next);
    assert.match(await h.page.locator('.cp-status-line').innerText(), /on the second row/, 'the page updates under a focused tab');
    assert.match(await h.page.locator('.cp-try-summary').innerText(), /concurrently rewritten/);
    assert.equal(await h.page.evaluate(() => document.activeElement === window.heldTab), true, 'focus is on the same tab');
    assert.equal(await h.page.evaluate(() => window.heldLog.isConnected), true, 'and the open log is the same node');

    await h.page.evaluate(() => pages.noteRunEvent({ id: 40, type: 'tool.finished', at: Date.now(), runId: 'r-fail', payload: { name: 'edit_file', source: 'governed', ok: true, summary: 'Replaced 1 match' } }));
    assert.equal(await entries(), 7, 'a live event joins the log on screen');
    assert.match(await h.page.evaluate(() => window.heldLog.lastElementChild.innerText), /editing[\s\S]*ok/);
    assert.equal(await h.page.locator('[data-cp-key="tab-r-fail-log"] .cp-tab-count').innerText(), '7');
    await h.page.evaluate(() => pages.noteRunEvent({ id: 41, type: 'tool.started', at: Date.now(), runId: 'r-other', payload: { name: 'read_file' } }));
    assert.equal(await entries(), 7, 'another run’s event stays out of it');
    await h.update('failed', { now: NOW + 6 * m });
    assert.equal(await entries(), 7, 'a later update keeps the tail it was given');

    // focus inside the log (an open row's summary) comes back as the same node
    await h.page.locator('[data-cp-run="r-fail"] .project-log-detail > summary').first().focus();
    await h.page.evaluate(() => { window.focusedRow = document.activeElement; });
    await h.update('failed', { now: NOW + 7 * m });
    assert.equal(await h.page.evaluate(() => document.activeElement === window.focusedRow), true);

    // Try again: try 2 arrives; try 1, which was being read, stays open, and its log node survives and grows
    const retried = model('failed', { now: NOW + 8 * m });
    retried.ticket.improvement = { ...retried.ticket.improvement, state: 'building', word: 'building', tone: 'active', live: true, group: 'building' };
    retried.ticket.statusLine = 'installing · just now · try 2';
    retried.ticket.actions = [{ action: 'stopRun', label: WORDS.keys.stop, tone: 'seated', payload: { runId: 'r-fail-2' }, confirm: null, blocked: '', key: 'stop', opens: null }];
    retried.ticket.attempts.push({ ...retried.ticket.attempts[0], runId: 'r-fail-2', n: 2, state: 'building', status: 'installing', word: 'building', tone: 'active', live: true, startedAt: new Date(NOW + 8 * m).toISOString(), endedAt: null, summary: '', reason: '', attemptId: 'r-fail-2-attempt', steps: [{ name: 'install', label: 'install', state: 'running' }, { name: 'work', label: 'do the work', state: 'waiting' }, { name: 'check', label: 'run the checks', state: 'waiting' }, { name: 'stage', label: 'stage it for review', state: 'waiting' }] });
    await h.page.evaluate(mdl => pages.update(mdl), retried);
    assert.equal(await h.page.evaluate(() => window.heldLog.isConnected), true, 'try 1’s open log node survives the retry');
    assert.equal(await h.page.locator('[data-cp-key="try-r-fail"]').getAttribute('aria-expanded'), 'true', 'and try 1 stays open: it was being read');
    await h.page.evaluate(() => pages.noteRunEvent({ id: 42, type: 'run.updated', at: Date.now(), runId: 'r-fail', payload: { run: { status: 'superseded' } } }));
    assert.equal(await entries(), 8, 'and gains exactly one row');
    await h.page.locator('[data-cp-run="r-fail-2"] .project-log').waitFor();
    assert.equal(await h.page.locator('.cp-try').count(), 2);
    await shot(h.page, 'retried', DESKTOP);

    // off screen: the page closed, an event arrives, the page comes back with it
    await h.page.evaluate(() => pages.close());
    await h.page.evaluate(() => pages.noteRunEvent({ id: 43, type: 'process.output', at: Date.now(), runId: 'r-fail', payload: { text: 'while the page was closed' } }));
    await h.page.evaluate(mdl => pages.open(mdl, { focus: false }), retried);
    assert.equal(await entries(), 9);
    assert.match(await h.page.evaluate(() => window.heldLog.lastElementChild.innerText), /while the page was closed/);

    // the build page's field, focused with words in it, survives an update: same node, same words, same focus
    await h.open('build'); await h.settle();
    await h.page.locator('[data-cp-key="add"]').click();
    await h.page.keyboard.type('a scarecrow');
    await h.page.evaluate(() => { window.heldField = document.activeElement; });
    const moved = model('build', { now: NOW + 9 * m }); moved.build.improvements = moved.build.improvements.slice(1);
    await h.page.evaluate(mdl => pages.update(mdl), moved);
    assert.deepEqual(await h.page.evaluate(() => [document.activeElement === window.heldField, window.heldField.isConnected, window.heldField.value]), [true, true, 'a scarecrow']);
    assert.equal(await h.page.evaluate(() => pages.snapshot().hasDraft), true);
    assert.deepEqual(h.errors, []);
  } finally { await h.context.close(); await browser.close(); }
});

test('the build page form: start now on Enter, up next beside it, a failure keeps the words, and success gives focus back', async () => {
  const browser = await launch();
  const h = await harness(browser, DESKTOP);
  try {
    await h.open('build'); await h.settle(); await h.clear();
    const add = h.page.locator('[data-cp-key="add"]');
    await add.click();
    assert.equal(await add.getAttribute('aria-expanded'), 'true');
    assert.equal(await h.page.evaluate(() => document.activeElement?.dataset.cpKey), 'add-field');
    assert.equal(await h.page.locator('.cp-add-hint').innerText(), WORDS.form.hint);
    await h.page.keyboard.type('a scarecrow'); await h.page.keyboard.press('Shift+Enter'); await h.page.keyboard.type('that waves');
    assert.equal(await h.page.locator('[data-cp-key="add-field"]').inputValue(), 'a scarecrow\nthat waves', 'Shift+Enter is a new line');
    await h.page.evaluate(() => { window.fail.startImprovement = { message: 'the backend is away — try again in a moment' }; });
    await h.page.keyboard.press('Enter');
    await h.page.locator('.cp-add .cp-page-note[data-kind="error"]').waitFor();
    assert.equal(await h.page.locator('.cp-add .cp-page-note').innerText(), 'the backend is away — try again in a moment');
    assert.equal(await h.page.locator('[data-cp-key="add-field"]').inputValue(), 'a scarecrow\nthat waves', 'a failure keeps the words');
    await h.page.evaluate(() => { delete window.fail.startImprovement; window.hold = { name: 'startImprovement' }; });
    await h.page.locator('[data-cp-key="add-start"]').click();
    assert.equal(await h.page.locator('[data-cp-key="add-start"]').getAttribute('aria-busy'), 'true', 'the key holds while it is out');
    assert.equal(await h.page.locator('[data-cp-key="add-field"]').inputValue(), 'a scarecrow\nthat waves', 'the text stays while it is sent');
    await h.page.evaluate(() => { window.hold.release(); window.hold = null; });
    await h.page.locator('.cp-add').waitFor({ state: 'detached' });
    assert.equal(await h.page.evaluate(() => document.activeElement?.dataset.cpKey), 'add', 'sent, focus is back on + improvement');
    await add.click();
    assert.equal(await h.page.locator('[data-cp-key="add-field"]').inputValue(), '', 'and the field is clear');
    await h.page.keyboard.type('keep the watering can in reach');
    await h.page.locator('[data-cp-key="add-queue"]').click();
    await h.page.locator('.cp-add').waitFor({ state: 'detached' });
    assert.deepEqual((await h.calls()).map(c => [c.name, c.value]), [
      ['startImprovement', { text: 'a scarecrow\nthat waves' }], ['startImprovement', { text: 'a scarecrow\nthat waves' }], ['queueImprovement', { text: 'keep the watering can in reach' }],
    ]);
    // rows, folds and the timeline
    const groups = await h.page.locator('.cp-imp-group').evaluateAll(els => els.map(el => el.querySelector('.cp-imp-group-title').textContent));
    assert.deepEqual(groups, ['waiting on you · 2', 'building · 1', 'up next · 3', 'in · 2', 'failed · 7']);
    assert.equal(await h.page.locator('.cp-imp-group[data-cp-group="failed"] .cp-imp').count(), 5, 'failed shows five, then a fold');
    assert.equal(await h.page.locator('[data-cp-key="failed-more"]').innerText(), '2 more');
    assert.equal(await h.page.locator('.cp-imp[data-cp-key="imp-run:r-build"] .cp-imp-sub').innerText(), 'started 4m ago · try 2');
    assert.equal(await h.page.locator('.cp-imp[data-cp-key="imp-run:r-f0"] .cp-imp-sub').innerText(), 'the layout test timed out waiting for the second row', 'a failed row says why');
    await h.page.locator('[data-cp-key="failed-more"]').click();
    assert.equal(await h.page.locator('[data-cp-key="failed-more"]').innerText(), WORDS.showFewer);
    assert.deepEqual(await h.page.locator('.cp-timeline .cp-hist').evaluateAll(els => els.map(el => [el.querySelector('.cp-hist-word').textContent, el.querySelector('.cp-hist-link').textContent, el.querySelector('.cp-hist-time').textContent])), [
      ['landed', 'save the first garden', 'today 10:00'], ['landed', 'a gentler first-run hint', 'yesterday 10:00'], ['stopped', 'let the rain fall sideways', 'yesterday 12:00'], ['done', 'remember returning visitors', ''],
    ]);
    const tiles = await h.page.locator('.cp-tile').evaluateAll(els => els.map(el => el.innerText.replace(/\s+/g, ' ').trim()));
    assert.deepEqual(tiles, ['waiting on you 2 1 ready to review · 1 needs you', 'checks npm test every improvement is checked before it lands', 'landed this week 2 last 2h ago']);
    await h.open('build-empty'); await h.settle();
    assert.equal(await h.page.locator('.cp-imps-empty').innerText(), WORDS.emptyImprovements);
    assert.match(await h.page.locator('.cp-preview-stage').innerText(), /this one can’t be played[\s\S]*paper-garden has nothing to play yet/);
    assert.match(await h.page.locator('.cp-tiles').innerText(), new RegExp(WORDS.noCheck));
    await h.open('build-unavailable'); await h.settle(); await h.clear();
    assert.match(await h.page.locator('.cp-imps-note').innerText(), new RegExp(WORDS.noList));
    await h.page.locator('[data-cp-key="refresh-list"]').click();
    await h.page.waitForFunction(() => window.calls.length === 1);
    assert.deepEqual((await h.calls()).map(c => c.name), ['refresh']);
    assert.deepEqual(h.errors, []);
  } finally { await h.context.close(); await browser.close(); }
});

test('one verdict wears one colour: failed and in carry theirs, interrupted and needs you stay ink', async () => {
  const browser = await launch();
  try {
    for (const [viewport, touch] of [[DESKTOP, false], [PHONE, true]]) {
      const h = await harness(browser, viewport, { touch });
      try {
        const fail = await probe(h.page, '--fail-text'), pass = await probe(h.page, '--pass-text'), ink = await probe(h.page, '--ink');
        await h.open('failed'); await h.settle();
        assert.equal(await h.page.locator('.cp-status .cp-state').evaluate(el => getComputedStyle(el).color), fail);
        assert.equal(await h.page.locator('.cp-status-line').evaluate(el => getComputedStyle(el).color), await probe(h.page, '--fail-quiet'), 'the reason is failure prose');
        await h.open('interrupted'); await h.settle();
        assert.equal(await h.page.locator('.cp-status .cp-state').evaluate(el => getComputedStyle(el).color), ink, 'interrupted is not a verdict');
        await h.open('in'); await h.settle();
        assert.equal(await h.page.locator('.cp-status .cp-state').evaluate(el => getComputedStyle(el).color), pass);
        await h.open('build'); await h.settle();
        const words = await h.page.locator('.cp-imp .cp-imp-state').evaluateAll(els => Object.fromEntries(els.map(el => [el.textContent, getComputedStyle(el).color])));
        assert.equal(words.failed, fail); assert.equal(words.in, pass);
        for (const w of ['interrupted', 'needs you', 'ready to review', 'building', 'up next']) { assert.notEqual(words[w], fail, w); assert.notEqual(words[w], pass, w); }
        assert.deepEqual(h.errors, []);
      } finally { await h.context.close(); }
    }
  } finally { await browser.close(); }
});

test('short windows fit; live work pulses, and nothing moves under reduced motion', async () => {
  const browser = await launch();
  try {
    const short = await harness(browser, { width: 390, height: 430 }, { touch: true });
    try {
      for (const name of ['failed', 'ready', 'build']) {
        await short.open(name); await short.settle();
        assert.deepEqual(await overflow(short.page), { page: false, body: false }, `${name} at 390×430`);
        assert.deepEqual(await shortKeys(short.page), [], `${name}: 44px keys at 390×430`);
      }
      await shot(short.page, 'build-short', { width: 390, height: 430 });
      // a long title wraps whole; nothing clips it to one line
      const long = model('failed'); long.ticket.improvement = { ...long.ticket.improvement, title: 'remember the garden layout between visits, even when the second row of tulips is still growing' };
      await short.page.evaluate(mdl => pages.open(mdl, { focus: false }), long);
      const h1 = await short.page.locator('.cp-page h1').evaluate(el => ({ lines: Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)), clipped: el.scrollWidth > el.clientWidth }));
      assert.ok(h1.lines >= 3 && !h1.clipped, `a long title wraps (${JSON.stringify(h1)})`);
      assert.deepEqual(await overflow(short.page), { page: false, body: false });
      assert.deepEqual(short.errors, []);
    } finally { await short.context.close(); }
    const moving = await harness(browser, DESKTOP);
    try {
      await moving.open('building'); await moving.settle();
      const names = await moving.page.evaluate(() => document.getAnimations().map(a => a.animationName));
      assert.ok(names.includes('cp-page-pulse'), `the live word pulses (${names})`);
      assert.ok(names.includes('pulse'), 'and its dot');
    } finally { await moving.context.close(); }
    const still = await harness(browser, DESKTOP, { reduced: true });
    try {
      await still.open('building'); await still.settle();
      await still.page.locator('[data-cp-key="stop"]').click();
      assert.deepEqual(await still.page.evaluate(() => document.getAnimations().filter(a => a.animationName && a.effect?.target?.closest?.('.cp-page')).map(a => a.animationName)), [], 'no animation runs on the page');
    } finally { await still.context.close(); }
    const calm = await harness(browser, DESKTOP);
    try {
      await calm.page.evaluate(() => document.body.classList.add('calm'));
      await calm.open('building'); await calm.settle();
      assert.deepEqual(await calm.page.evaluate(() => document.getAnimations().filter(a => a.animationName && a.effect?.target?.closest?.('.cp-page')).map(a => a.animationName)), [], 'Calm motion stills it too');
    } finally { await calm.context.close(); }
  } finally { await browser.close(); }
});

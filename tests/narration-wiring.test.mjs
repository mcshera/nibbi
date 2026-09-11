import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { narrate, deliveryTransition, deliveryContext, streakIncrease, runStatusChange } from '../public/lib/narration.js';

const BANNED = /next milestone|keep going|next target|one more|what's next|remind/i;

// The event stream hands app.js a run record with a GitHub summary; these helpers turn it into authored copy without touching the DOM.
const pr = { number: 12, draft: true };
const run = { id: 'build-one', game: 'battalion', title: 'Card data as JSON', issue: 'Ignored when a title exists', targetBranch: 'staging', github: { mode: 'github', baseBranch: 'main', pr, checks: { status: 'blocked', blockers: ['lint: in_progress', 'build: failure'] } } };

test('deliveryContext reads only the fields each line needs from the run record', () => {
  assert.deepEqual(deliveryContext('draft-pr', run), { title: 'Card data as JSON', number: 12, project: 'battalion' });
  assert.deepEqual(deliveryContext('checks-failed', run), { title: 'Card data as JSON', number: 12, firstBlocker: 'build: failure' });
  assert.deepEqual(deliveryContext('remote-changed', run), { title: 'Card data as JSON' });
  assert.deepEqual(deliveryContext('merged', run), { title: 'Card data as JSON', base: 'main', project: 'battalion', task: undefined });
  assert.equal(deliveryContext('checks-failed', { ...run, github: { ...run.github, checks: { status: 'blocked', blockers: ['lint: queued'] } } }).firstBlocker, undefined, 'a pending job is not a blocker');
  assert.equal(narrate('checks-failed', deliveryContext('checks-failed', { ...run, github: { pr } })).text, 'Checks failed on **Card data as JSON** (PR #12): a required check did not pass. The branch is intact. Want me to look at the failing job?');
});

test('title and merge base fall back the way the app does', () => {
  const untitled = { id: 'build-two', game: 'battalion', issue: 'A'.repeat(80) };
  assert.equal(deliveryContext('merged', untitled).title, 'A'.repeat(60), 'issue text is clipped like fixerTitle');
  assert.equal(deliveryContext('merged', { id: 'build-three' }).title, 'build-three');
  assert.equal(deliveryContext('merged', { id: 'x', project: 'p' }).project, 'p', 'legacy records name the project');
  assert.equal(deliveryContext('merged', { id: 'x', targetBranch: 'staging' }).base, 'staging', 'local merges use the run target');
  assert.equal(deliveryContext('merged', { id: 'x' }).base, 'main');
  assert.equal(deliveryContext('merged', { id: 'x', targetBranch: 'staging', github: { baseBranch: 'release' } }).base, 'release', 'the PR base wins for GitHub builds');
  assert.equal(deliveryContext('draft-pr', { id: 'x', github: { pr: null } }).number, undefined);
  assert.deepEqual(deliveryContext('merged', undefined), { title: undefined, base: 'main', project: undefined, task: undefined }, 'a missing record never throws');
});

test('a dispatch-time task pin never becomes a completion claim', () => {
  const pinned = { ...run, task: 'Card/component data as JSON', taskId: 'T3' };
  assert.equal(deliveryContext('merged', pinned).task, undefined);
  assert.equal(narrate('merged', deliveryContext('merged', pinned)).text, '**Card data as JSON** merged into main on battalion.');
  assert.equal(narrate('merged', deliveryContext('merged', { ...pinned, taskText: 'Card/component data as JSON' })).text, "**Card data as JSON** merged into main on battalion. That completes 'Card/component data as JSON'.", 'only re-read completion text is spoken');
});

test('a GitHub build narrates each transition once, in the order the daemon emits it', () => {
  const summaries = [
    { delivery: 'to_push', pr: null, checks: { status: 'unknown', blockers: [] } },
    { delivery: 'pull_request', pr, checks: { status: 'blocked', blockers: ['build: in_progress'] } },
    { delivery: 'pull_request', pr, checks: { status: 'blocked', blockers: ['build: failure'] } },
    { delivery: 'pull_request', pr, checks: { status: 'blocked', blockers: ['build: failure'] }, remoteChanged: true },
    { delivery: 'merged', pr: { ...pr, draft: false }, checks: { status: 'passed', blockers: [] }, remoteChanged: false },
    { delivery: 'merged', pr: { ...pr, draft: false }, checks: { status: 'passed', blockers: [] }, remoteChanged: false },
  ];
  const seen = new Map(), lines = [];
  for (let i = 1; i < summaries.length; i++) {
    const kind = deliveryTransition(summaries[i - 1], summaries[i]);
    if (!kind) continue;
    const key = run.id + ':' + kind; if (seen.has(key)) continue; seen.set(key, kind);
    lines.push(narrate(kind, deliveryContext(kind, { ...run, github: { ...run.github, ...summaries[i] } })).text);
  }
  assert.deepEqual(lines, [
    'Draft PR #12 is up for **Card data as JSON** on battalion. Checks are running; nothing merges until you say so.',
    'Checks failed on **Card data as JSON** (PR #12): build: failure. The branch is intact. Want me to look at the failing job?',
    'Someone pushed to the PR branch for **Card data as JSON** outside Nibbi. Delivery is paused until those commits are adopted.',
    '**Card data as JSON** merged into main on battalion.',
  ]);
  for (const line of lines) assert.doesNotMatch(line, BANNED);
});

test('runStatusChange announces a run status only when the record did not already carry it', () => {
  const staged = { id: 'b', status: 'staged' }, merged = { id: 'b', status: 'merged' };
  assert.equal(runStatusChange(staged, merged), 'merged');
  assert.equal(runStatusChange(merged, merged), null, 'a binding refresh re-emits the merged record: not news');
  assert.equal(runStatusChange(staged, staged), null, 'the coordinator re-emits a staged record every minute: not news');
  assert.equal(runStatusChange({ status: 'running' }, staged), 'staged');
  assert.equal(runStatusChange({ status: 'done' }, staged), null, 'a legacy done record already means staged');
  assert.equal(runStatusChange(staged, { status: 'done' }), null);
  assert.equal(runStatusChange({ status: 'running' }, { status: 'done' }), 'staged');
  assert.equal(runStatusChange(undefined, merged), 'merged', 'a record the page never saw is a change');
  assert.equal(runStatusChange(null, { status: 'failed' }), 'failed');
  for (const status of ['queued', 'running', 'verifying', 'discarded', 'superseded', undefined]) assert.equal(runStatusChange(staged, { status }), null, `${status} is never announced`);
  assert.equal(runStatusChange(staged, undefined), null);
  assert.equal(runStatusChange(merged, { status: 'merged' }), null, 'a GitHub merge of a Build that already merged locally is not narrated twice');
  for (const status of ['staged', 'failed', 'merged', 'interrupted', 'cancelled']) assert.equal(runStatusChange({ status: 'running' }, { status }), status);
});

test('streakIncrease speaks only when a verified delivery extends a known streak', () => {
  const summary = (streak, extra = {}) => ({ today: { deliveries: 1 }, week: { deliveries: 3 }, streak, available: true, ...extra });
  assert.equal(streakIncrease(summary(2), summary(3)), 3);
  assert.equal(streakIncrease(summary(0), summary(1)), 1, 'the first day counts as an increase');
  assert.equal(streakIncrease(summary(3), summary(3)), null, 'a second merge on the same day is quiet');
  assert.equal(streakIncrease(summary(3), summary(0)), null, 'a broken streak is never announced');
  assert.equal(streakIncrease(undefined, summary(4)), null, 'no previous summary is not an increase');
  assert.equal(streakIncrease(null, summary(4)), null);
  assert.equal(streakIncrease({ available: false, streak: 0 }, summary(1)), null, 'an unavailable previous summary stays quiet');
  assert.equal(streakIncrease(summary(1), { available: false, streak: 5 }), null);
  assert.equal(streakIncrease(summary('two'), summary(3)), null, 'non-numeric counts are not invented');
  assert.equal(streakIncrease(summary(1), summary(2.9)), 2, 'whole days only');
  assert.equal(narrate('streak', { days: streakIncrease(summary(0), summary(1)) }).text, '1 day running with something real merged.');
  assert.equal(narrate('streak', { days: streakIncrease(summary(4), summary(5)) }).voice, '5 days running with something real merged.');
});

/* ---- live wiring: the real app (served by Vite, API proxied to a scripted backend) against a scripted event stream. */
const sha = 'a'.repeat(40);
const livePr = { number: 12, nodeId: 'PR_1', state: 'OPEN', draft: true, url: 'https://github.com/x/y/pull/12', headSha: sha, baseSha: 'b'.repeat(40), branch: 'nibbi/build-one', baseBranch: 'main', mergeable: true, reviewDecision: '', approvals: 0 };
const summaryOf = (extra = {}) => ({ mode: 'github', repository: 'x/y', branch: 'nibbi/build-one', baseBranch: 'main', headSha: sha, pushedSha: sha, pr: livePr, delivery: 'pull_request', toPush: false, pullRequest: true, needsAttention: false, readyPR: false, remoteChanged: false, remoteHeadSha: sha, checks: { status: 'blocked', blockers: ['build: in_progress'] }, freshness: { status: 'fresh', observedAt: Date.now() }, allowedActions: ['github.refresh'], ...extra });
const mergedSummary = () => summaryOf({ delivery: 'merged', pr: { ...livePr, state: 'MERGED', draft: false }, checks: { status: 'passed', blockers: [] }, allowedActions: [] });

async function scriptedBackend(state) {
  const streams = new Set(), sends = [];
  const frame = (res, event, data) => res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
  const server = createHttpServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    req.resume();
    if (url.pathname === '/api/snapshot') return json(200, state.snapshot());
    if (url.pathname === '/api/projects') return json(200, state.projects);
    if (url.pathname === '/api/milestones') return json(200, []);
    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' }); res.flushHeaders();
      streams.add(res); res.on('close', () => streams.delete(res));
      state.onSubscribe?.({ after: Number(url.searchParams.get('after') || 0), emit: event => frame(res, 'event', event), ready: cursor => frame(res, 'ready', { cursor }) });
      return;
    }
    if (url.pathname === '/api/send') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' }); res.flushHeaders();
      frame(res, 'start', { runId: 'turn-1' });
      const turn = { finish: text => { frame(res, 'done', { text, costUsd: 0, isError: false }); res.end(); } };
      sends.push(turn); state.onSend?.(turn); return;
    }
    json(404, { error: 'not scripted: ' + url.pathname });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return {
    port: server.address().port, sends,
    emit(event) { for (const res of streams) frame(res, 'event', event); },
    async close() { for (const res of streams) res.destroy(); server.closeAllConnections?.(); await new Promise(done => server.close(done)); },
  };
}

test('the app narrates each verified delivery event once, only from live events, and holds wins until a turn ends', async () => {
  const { chromium } = await import('playwright');
  const { createServer: createVite } = await import('vite');
  const day = new Date().toLocaleDateString('en-CA');
  const startedAt = new Date(Date.now() - 600000).toISOString(), endedAt = new Date(Date.now() - 120000).toISOString();
  const buildOne = (extra = {}) => ({ id: 'build-one', game: 'battalion', issue: 'Card data as JSON', title: 'Card data as JSON', status: 'staged', workflowMode: 'github', branch: 'nibbi/build-one', targetBranch: 'main', commitSha: sha, startedAt, endedAt, costUsd: 0.12, model: 'sonnet', diffstat: ' 2 files changed, 40 insertions(+)', github: summaryOf(), ...extra });
  const oldMerged = { id: 'build-old', game: 'battalion', issue: 'Old merged build', title: 'Old merged build', status: 'merged', workflowMode: 'github', startedAt, endedAt: new Date(Date.now() - 3600000).toISOString(), github: mergedSummary() };
  const counts = (deliveries, tasks = 0, milestones = 0) => ({ deliveries, tasks, issues: 0, milestones });
  const progress = { today: counts(0), week: counts(3, 2), streak: 2, lastDeliveryAt: endedAt, recent: [], available: true };
  const state = {
    projects: [{ name: 'battalion', kind: 'game', branch: 'main' }],
    snapshot: () => ({ cursor: 10, status: { busy: false, playtestGame: null }, fixers: [buildOne(), oldMerged], auto: { battalion: { on: false, mode: 'off', inflight: 0, pending: 0, staged: 1, spend: 0 } }, goals: {}, progress }),
  };
  const subscribed = new Promise(resolveSubscribed => { state.onSubscribe = resolveSubscribed; });
  const sent = new Promise(resolveSent => { state.onSend = resolveSent; });
  const api = await scriptedBackend(state);
  const proxy = { target: 'http://127.0.0.1:' + api.port, changeOrigin: false };
  const vite = await createVite({ configFile: resolve('vite.config.ts'), logLevel: 'silent', server: { host: '127.0.0.1', port: 4700 + Math.floor(Math.random() * 300), strictPort: false, proxy: { '/api/': proxy, '/nibbi/': proxy } } });
  await vite.listen();
  const origin = vite.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1180, height: 712 }, serviceWorkers: 'block' });
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const bubbles = () => page.evaluate(() => [...document.querySelectorAll('#feed .turn .said')].map(el => el.innerText.replace(/\s+/g, ' ').trim()));
  const count = async pattern => (await bubbles()).filter(text => pattern.test(text)).length;
  const appears = (pattern, options) => page.waitForFunction(source => [...document.querySelectorAll('#feed .turn .said')].some(el => new RegExp(source).test(el.innerText.replace(/\s+/g, ' '))), pattern.source, options);
  let id = 11;
  const event = (type, payload, extra = {}) => ({ id: id++, type, at: Date.now(), projectId: 'battalion', ...extra, payload });
  try {
    await page.goto(origin + '/?nosw=1');
    const stream = await subscribed;
    assert.equal(stream.after, 10, 'a first visit subscribes from the snapshot cursor');
    // Replay before ready: an old merge is summarized by the away line, never narrated as if it just happened.
    stream.emit(event('run.updated', { run: oldMerged }, { runId: 'build-old' })); stream.ready(id - 1);
    await page.waitForFunction(() => document.querySelector('#sidebar-progress')?.textContent === 'Nothing merged yet today · 3 this week · 2-day streak');
    await page.waitForTimeout(500);
    assert.equal(await count(/merged into/), 0, 'replayed events never narrate');
    assert.equal(await count(/While you were away/), 1, 'the replay buffer still feeds the away summary');

    api.emit(event('run.updated', { run: buildOne() }, { runId: 'build-one' }));   // a binding refresh: same status, same summary
    await page.waitForTimeout(500);
    assert.equal(await count(/is done and staged|Checks failed|merged into|Draft PR/), 0, 'an unchanged record is not news');

    api.emit(event('run.updated', { run: buildOne({ github: summaryOf({ checks: { status: 'blocked', blockers: ['build: failure'] } }) }) }, { runId: 'build-one' }));
    await appears(/Checks failed on Card data as JSON \(PR #12\): build: failure\. The branch is intact\./);
    api.emit(event('run.updated', { run: buildOne({ github: summaryOf({ checks: { status: 'blocked', blockers: ['build: failure'] } }) }) }, { runId: 'build-one' }));
    await page.waitForTimeout(400);
    assert.equal(await count(/Checks failed/), 1, 'the same failure refreshed again is quiet');

    api.emit(event('run.updated', { run: buildOne({ github: summaryOf({ delivery: 'remote_changed', remoteChanged: true, checks: { status: 'blocked', blockers: ['build: failure'] } }) }) }, { runId: 'build-one' }));
    await appears(/Someone pushed to the PR branch for Card data as JSON outside Nibbi/);

    // The completion record arrives first with the old run status and a merged summary, then again with status merged: one bubble.
    api.emit(event('run.updated', { run: buildOne({ github: mergedSummary() }) }, { runId: 'build-one' }));
    await appears(/Card data as JSON merged into main on battalion\./);
    api.emit(event('run.updated', { run: buildOne({ status: 'merged', github: mergedSummary() }) }, { runId: 'build-one' }));
    await page.waitForTimeout(400);
    assert.equal(await count(/merged into main on battalion/), 1, 'the binding event and the status event yield one merged bubble');
    assert.equal(await count(/is done and staged/), 0, 'the staged status carried by the binding event is not re-announced');

    api.emit(event('milestone.completed', { project: 'battalion', milestoneId: 'm2', name: 'M2: Simulation', total: 5, runId: 'build-one' }, { runId: 'build-one' }));
    await appears(/That closes M2: Simulation on battalion: 5 of 5\./);
    const grown = { ...progress, today: counts(1, 1, 1), week: counts(4, 3, 1), streak: 3, lastDeliveryAt: new Date().toISOString() };
    api.emit(event('progress.updated', { day, delta: counts(1, 1, 1), summary: grown }, { runId: 'build-one' }));
    await appears(/3 days running with something real merged\./);
    await page.waitForFunction(() => document.querySelector('#sidebar-progress')?.textContent === '1 merged today · 4 this week · 3-day streak');
    api.emit(event('progress.updated', { day, delta: counts(1), summary: { ...grown, today: counts(2, 1, 1), week: counts(5, 3, 1) } }, { runId: 'build-two' }));
    await page.waitForFunction(() => document.querySelector('#sidebar-progress')?.textContent === '2 merged today · 5 this week · 3-day streak');
    assert.equal(await count(/days running/), 1, 'a second merge on the same day does not repeat the streak');
    api.emit(event('run.updated', { run: buildOne({ status: 'merged', github: mergedSummary() }) }, { runId: 'build-one' }));
    await page.waitForTimeout(400);
    assert.equal(await count(/merged into main on battalion/), 1, 'a later refresh of the merged Build is quiet');
    assert.equal(await count(/That closes/), 1);

    // A win during a turn waits for the turn to end.
    await page.locator('#ask').fill('hello there');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.body.classList.contains('busy'));
    const turn = await sent;
    api.emit(event('milestone.completed', { project: 'battalion', milestoneId: 'm3', name: 'M3: Balance', total: 4, runId: 'build-two' }, { runId: 'build-two' }));
    await page.waitForTimeout(700);
    assert.equal(await count(/That closes M3/), 0, 'a milestone cannot celebrate while a turn is running');
    turn.finish('Done.');
    await page.waitForFunction(() => !document.body.classList.contains('busy'));
    await appears(/That closes M3: Balance on battalion: 4 of 4\./, { timeout: 8000 });
    assert.equal(await count(/That closes M3/), 1);

    for (const text of await bubbles()) assert.doesNotMatch(text, BANNED, text);
    assert.deepEqual(errors, []);
  } finally {
    await context.close(); await browser.close(); await vite.close(); await api.close();
  }
});

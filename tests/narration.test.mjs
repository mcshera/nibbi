import { test } from 'node:test';
import assert from 'node:assert/strict';
import { narrate, narrationKinds, deliveryTransition, failingBlocker } from '../public/lib/narration.js';

const BANNED = /next milestone|keep going|next target|one more|what's next/i;
const sentences = voice => voice.split(/(?<=[.!?])\s+/).filter(Boolean);
const ctx = { title: 'Card data as JSON', number: 12, project: 'battalion', base: 'main', firstBlocker: 'build: failure', task: 'Card/component data as JSON', milestone: 'M2: Simulation', total: 5, days: 3, text: 'Morning. Two builds merged yesterday.' };
const spoken = (kind, extra = {}) => narrate(kind, { ...ctx, ...extra }).voice;

test('each authored line is pinned exactly', () => {
  assert.equal(narrate('draft-pr', ctx).text, 'Draft PR #12 is up for **Card data as JSON** on battalion. Checks are running; nothing merges until you say so.');
  assert.equal(narrate('checks-failed', ctx).text, 'Checks failed on **Card data as JSON** (PR #12): build: failure. The branch is intact. Want me to look at the failing job?');
  assert.equal(narrate('remote-changed', ctx).text, 'Someone pushed to the PR branch for **Card data as JSON** outside Nibbi. Delivery is paused until those commits are adopted.');
  assert.equal(narrate('merged', { title: ctx.title, base: 'main', project: 'battalion' }).text, '**Card data as JSON** merged into main on battalion.');
  assert.equal(narrate('merged', ctx).text, "**Card data as JSON** merged into main on battalion. That completes 'Card/component data as JSON'.");
  assert.equal(narrate('milestone', ctx).text, 'That closes **M2: Simulation** on battalion: 5 of 5.');
  assert.equal(narrate('streak', ctx).text, '3 days running with something real merged.');
  assert.equal(narrate('streak', { days: 1 }).text, '1 day running with something real merged.');
  assert.equal(narrate('brief', ctx).text, ctx.text, 'brief passes its text through untouched');
  assert.equal(narrate('brief', ctx).voice, 'Morning.');
  assert.equal(narrate('brief', { text: '**v2.3** is out on main. Nothing else moved.' }).voice, 'v2.3 is out on main.', 'decimals do not end a spoken sentence');
  assert.equal(narrate('checks-failed', { title: 't', number: 3 }).text, 'Checks failed on **t** (PR #3): a required check did not pass. The branch is intact. Want me to look at the failing job?');
  assert.deepEqual([...narrationKinds].sort(), ['brief', 'checks-failed', 'draft-pr', 'merged', 'milestone', 'remote-changed', 'streak']);
  assert.throws(() => narrate('reminder', {}), /Unknown narration kind/);
});

test('interpolated values are markdown-escaped in text and kept plain in voice', () => {
  const title = 'Fix *bold* [link] <tag> `code`';
  const out = narrate('merged', { title, base: 'main', project: 'p_1', task: 'do_it [now]' });
  assert.equal(out.text, "**Fix \\*bold\\* \\[link\\] \\<tag\\> \\`code\\`** merged into main on p\\_1. That completes 'do\\_it \\[now\\]'.");
  assert.equal(out.voice, 'Fix *bold* [link] <tag> `code` merged into main on p_1, which completes do_it [now].');
  assert.equal(narrate('draft-pr', { title: 'a_b', number: 7, project: 'x*y' }).text, 'Draft PR #7 is up for **a\\_b** on x\\*y. Checks are running; nothing merges until you say so.');
  assert.equal(narrate('checks-failed', { title: 't', number: 3, firstBlocker: 'lint: failure [job]' }).text, 'Checks failed on **t** (PR #3): lint: failure \\[job\\]. The branch is intact. Want me to look at the failing job?');
  assert.equal(narrate('draft-pr', { title: 't', project: 'p' }).text, 'Draft PR #? is up for **t** on p. Checks are running; nothing merges until you say so.');
});

test('voice is one plain sentence of at most 120 characters, even for long or punctuated titles', () => {
  const long = 'A very long pull request title that keeps going. And going! With v2.3 numbers? '.repeat(3);
  for (const kind of narrationKinds) {
    for (const extra of [{}, { title: long, task: long, milestone: long, project: long, base: long, firstBlocker: long, text: long }]) {
      const { text, voice } = narrate(kind, { ...ctx, ...extra });
      assert.ok(voice.length <= 120, `${kind} voice ${voice.length} chars: ${voice}`);
      assert.equal(sentences(voice).length, 1, `${kind} voice is one sentence: ${voice}`);
      assert.match(voice, /[.!?…]$/, `${kind} voice ends cleanly: ${voice}`);
      assert.doesNotMatch(voice, /[*_`\\]/, `${kind} voice is plain: ${voice}`);
      if (kind !== 'brief') assert.ok(text.includes(kind === 'milestone' ? 'M2' : kind === 'streak' ? '3 days' : 'Card') || extra.title, `${kind} text keeps its subject`);
    }
  }
  assert.equal(spoken('draft-pr'), 'Draft PR 12 is up for Card data as JSON, and nothing merges until you say so.');
  assert.equal(spoken('checks-failed'), 'Checks failed on Card data as JSON, but the branch is intact; want me to look at the failing job?');
  assert.equal(spoken('remote-changed'), 'Someone pushed to Card data as JSON outside Nibbi, so delivery is paused until those commits are adopted.');
  assert.equal(spoken('merged', { task: undefined }), 'Card data as JSON merged into main on battalion.');
  assert.equal(spoken('milestone'), 'That closes M2: Simulation on battalion, 5 of 5.');
  assert.equal(spoken('streak'), '3 days running with something real merged.');
  assert.equal(narrate('merged', { title: 'Ship it.', base: 'main', project: 'p' }).voice, 'Ship it merged into main on p.');
});

test('no line proposes a next goal, a target, or a nudge', () => {
  const long = 'Next milestone: keep going for one more target'.repeat(2);
  for (const kind of narrationKinds) {
    for (const extra of [{}, { title: 'T', task: 'do it', milestone: 'M9', project: 'p', base: 'dev', firstBlocker: 'x: failure', days: 12, text: 'Brief text.' }]) {
      const { text, voice } = narrate(kind, { ...ctx, ...extra });
      if (kind === 'brief') continue;
      assert.doesNotMatch(text, BANNED, `${kind} text: ${text}`);
      assert.doesNotMatch(voice, BANNED, `${kind} voice: ${voice}`);
      assert.doesNotMatch(text + voice, /remind/i, `${kind} never promises a reminder`);
    }
  }
  // Authored copy adds nothing of its own around user-supplied values; a banned phrase can only arrive inside the interpolation.
  const injected = narrate('merged', { title: long, base: 'main', project: 'p' }).text;
  assert.equal(injected.replace(long.replace(/([*_`\[\]<>])/g, '\\$1'), 'T'), '**T** merged into main on p.');
});

test('deliveryTransition derives one narration kind from two successive summaries', () => {
  const pr = { number: 12, draft: true };
  assert.equal(deliveryTransition(undefined, { delivery: 'pull_request', pr }), null, 'no previous summary is not a transition');
  assert.equal(deliveryTransition(null, { delivery: 'merged' }), null);
  assert.equal(deliveryTransition({ delivery: 'to_push' }, { delivery: 'pull_request', pr }), 'draft-pr');
  assert.equal(deliveryTransition({ delivery: 'to_push', pr: null }, { delivery: 'pull_request', pr }), 'draft-pr');
  assert.equal(deliveryTransition({ delivery: 'pull_request', pr }, { delivery: 'pull_request', pr }), null, 'same draft PR twice');
  assert.equal(deliveryTransition({ delivery: 'to_push' }, { delivery: 'pull_request', pr: { number: 12, draft: false } }), null, 'ready PRs are not drafts');
  assert.equal(deliveryTransition({ delivery: 'pull_request', pr: { number: 11, draft: true } }, { delivery: 'pull_request', pr }), 'draft-pr', 'a new PR number appears');
  const pending = { delivery: 'pull_request', pr, checks: { status: 'pending', blockers: [] } };
  assert.equal(deliveryTransition(pending, { ...pending, checks: { status: 'blocked', blockers: ['build: failure'] } }), 'checks-failed');
  assert.equal(deliveryTransition(pending, { ...pending, checks: { status: 'blocked', blockers: ['build: in_progress'] } }), null, 'still-running jobs are not failures');
  assert.equal(deliveryTransition(pending, { ...pending, checks: { status: 'blocked', blockers: ['No app-required checks are configured. Select the expected workflow jobs before merging.'] } }), null, 'configuration gaps are not failures');
  assert.equal(deliveryTransition(pending, { ...pending, checks: { status: 'blocked', blockers: ['build: missing expected check or producer', 'lint: timed_out'] } }), 'checks-failed');
  const blocked = { ...pending, checks: { status: 'blocked', blockers: ['build: failure'] } };
  assert.equal(deliveryTransition(blocked, blocked), null, 'blocked twice narrates once');
  // The daemon reports status 'blocked' while jobs are still running; the realistic failure is blocked → blocked with the blocker text changing.
  const running = { ...pending, checks: { status: 'blocked', blockers: ['build: in_progress', 'lint: queued'] } };
  assert.equal(deliveryTransition(running, blocked), 'checks-failed', 'a running job that fails is narrated');
  assert.equal(deliveryTransition({ ...pending, checks: { status: 'blocked', blockers: ['build: missing expected check or producer'] } }, blocked), 'checks-failed');
  assert.equal(deliveryTransition(blocked, { ...pending, checks: { status: 'blocked', blockers: ['build: failure', 'lint: cancelled'] } }), null, 'a second failing job does not narrate again');
  assert.equal(deliveryTransition(blocked, running), null, 'a re-run going back to pending is quiet');
  assert.equal(deliveryTransition(running, { ...pending, checks: { status: 'blocked', blockers: ['build: stale'] } }), null, 'GitHub-marked stale checks are not failures');
  assert.equal(deliveryTransition(running, { ...pending, checks: { status: 'passed', blockers: [] } }), null, 'passing is quiet here; merged speaks for it');
  assert.equal(deliveryTransition({ ...pending, remoteChanged: false }, { ...pending, remoteChanged: true }), 'remote-changed');
  assert.equal(deliveryTransition({ ...pending, remoteChanged: true }, { ...pending, remoteChanged: true }), null);
  assert.equal(deliveryTransition({ ...pending, remoteChanged: true }, { ...pending, remoteChanged: false }), null, 'adopting remote commits is quiet');
  assert.equal(deliveryTransition(pending, { ...pending, delivery: 'merged' }), 'merged');
  assert.equal(deliveryTransition({ delivery: 'merged' }, { delivery: 'merged' }), null);
  assert.equal(deliveryTransition(pending, { ...pending, delivery: 'merged', remoteChanged: true, checks: { status: 'blocked', blockers: ['x: failure'] } }), 'merged', 'merged outranks every other change');
  assert.equal(deliveryTransition(pending, { ...pending, remoteChanged: true, checks: { status: 'blocked', blockers: ['x: failure'] } }), 'remote-changed', 'a remote change outranks a check failure');
  assert.equal(deliveryTransition(pending, { ...pending, delivery: 'verification_pending' }), null);
  assert.equal(deliveryTransition({}, { pr: { draft: true } }), null, 'a draft without a number is not announced');
  assert.equal(failingBlocker(['a: in_progress', 'b: failure', 'c: cancelled']), 'b: failure');
  assert.equal(failingBlocker(['a: queued']), null);
  assert.equal(failingBlocker(['a: stale', 'b: pending', 'c: neutral', 'No app-required checks are configured. Select the expected workflow jobs before merging.']), null);
  assert.equal(failingBlocker(['ci: error']), 'ci: error', 'commit-status API errors count');
  assert.equal(failingBlocker(undefined), null);
});

/* lib/narration.js — authored progress copy. Pure (no DOM, no state); unit-tested in tests/narration.test.mjs.
   Every line reports something that already happened. No next goal, no reminders, no nudges: the win is the whole message. */
import { md, stripMd } from './text.js';

const VOICE_MAX = 120;
const esc = value => md.esc(value == null ? '' : value);
const num = value => Number.isFinite(Number(value)) ? String(Math.trunc(Number(value))) : '?';
// Spoken values lose sentence punctuation so the voice stays one sentence; "v2.3" survives, a trailing "." does not.
const plain = value => String(value ?? '').replace(/\s+/g, ' ').replace(/[.!?]+(?=\s|$)/g, '').trim();
function clip(value, max) {
  const s = String(value);
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1), word = cut.replace(/\s+\S*$/, '');
  return (word.length > max / 2 ? word : cut).trimEnd() + '…';
}
const said = value => clip(plain(value), 40);
const voice = line => clip(line.replace(/\s+/g, ' ').trim(), VOICE_MAX);

const lines = {
  'draft-pr': ({ title, number, project }) => ({
    text: `Draft PR #${num(number)} is up for **${esc(title)}** on ${esc(project)}. Checks are running; nothing merges until you say so.`,
    voice: `Draft PR ${num(number)} is up for ${said(title)}, and nothing merges until you say so.`,
  }),
  'checks-failed': ({ title, number, firstBlocker }) => ({
    text: `Checks failed on **${esc(title)}** (PR #${num(number)}): ${esc(firstBlocker || 'a required check did not pass')}. The branch is intact. Want me to look at the failing job?`,
    voice: `Checks failed on ${said(title)}, but the branch is intact; want me to look at the failing job?`,
  }),
  'remote-changed': ({ title }) => ({
    text: `Someone pushed to the PR branch for **${esc(title)}** outside Nibbi. Delivery is paused until those commits are adopted.`,
    voice: `Someone pushed to ${said(title)} outside Nibbi, so delivery is paused until those commits are adopted.`,
  }),
  merged: ({ title, base, project, task }) => ({
    text: `**${esc(title)}** merged into ${esc(base)} on ${esc(project)}.` + (task ? ` That completes '${esc(task)}'.` : ''),
    voice: `${said(title)} merged into ${plain(base)} on ${plain(project)}` + (task ? `, which completes ${said(task)}.` : '.'),
  }),
  milestone: ({ milestone, project, total }) => ({
    text: `That closes **${esc(milestone)}** on ${esc(project)}: ${num(total)} of ${num(total)}.`,
    voice: `That closes ${said(milestone)} on ${plain(project)}, ${num(total)} of ${num(total)}.`,
  }),
  streak: ({ days }) => {
    const n = Number(days), line = `${num(days)} ${n === 1 ? 'day' : 'days'} running with something real merged.`;
    return { text: line, voice: line };
  },
  brief: ({ text }) => {
    const body = String(text ?? '');
    const first = stripMd(body).match(/^[\s\S]*?[.!?](?=\s|$)/)?.[0] || stripMd(body);
    return { text: body, voice: first };
  },
};

/** narrate(kind, ctx) → {text, voice}. text may carry markdown; voice is one plain sentence of at most 120 characters. */
export function narrate(kind, ctx = {}) {
  const make = Object.hasOwn(lines, kind) ? lines[kind] : null;
  if (!make) throw new Error(`Unknown narration kind: ${kind}`);
  const out = make(ctx || {});
  return { text: out.text, voice: voice(out.voice) };
}
export const narrationKinds = Object.freeze(Object.keys(lines));

// Check blockers that mean a job actually failed ("<job>: <conclusion>" from the daemon's evaluateGithubChecks).
// Pending/queued jobs, configuration gaps and GitHub-marked stale checks are not failures.
const FAILED = /:\s*(failure|failed|error|errored|cancelled|canceled|timed_out|action_required|startup_failure)\s*$/i;
export const failingBlocker = blockers => (Array.isArray(blockers) ? blockers : []).map(String).find(blocker => FAILED.test(blocker)) ?? null;

/** deliveryTransition(previous, next) → narration kind or null, from two successive GitHub build summaries
    ({delivery, checks:{status, blockers}, remoteChanged, pr:{number, draft}}). A missing previous summary is not a transition.
    checks.status is already 'blocked' while jobs are queued or running, so a failure is detected by a failing blocker
    appearing, not by the status flipping. */
export function deliveryTransition(previous, next) {
  if (!previous || typeof previous !== 'object' || !next || typeof next !== 'object') return null;
  if (next.delivery === 'merged') return previous.delivery === 'merged' ? null : 'merged';
  if (next.remoteChanged === true && previous.remoteChanged !== true) return 'remote-changed';
  if (next.checks?.status === 'blocked' && failingBlocker(next.checks.blockers) && !failingBlocker(previous.checks?.blockers)) return 'checks-failed';
  const pr = next.pr, before = previous.pr;
  if (pr && pr.draft === true && pr.number != null && (!before || before.number !== pr.number)) return 'draft-pr';
  return null;
}

/** deliveryContext(kind, run) → narrate() ctx from a run record carrying a GitHub build summary in run.github.
    The title falls back like the app's fixerTitle; the merge base is the PR's base branch, then the run's target.
    `task` comes only from run.taskText (re-read completion text); a dispatch-time pin never claims a completion. */
export function deliveryContext(kind, run = {}) {
  const github = run?.github && typeof run.github === 'object' ? run.github : {};
  const title = run?.title || String(run?.issue || '').slice(0, 60) || run?.id, project = run?.game || run?.project;
  const number = github.pr && github.pr.number != null ? github.pr.number : undefined;
  switch (kind) {
    case 'draft-pr': return { title, number, project };
    case 'checks-failed': return { title, number, firstBlocker: failingBlocker(github.checks?.blockers) ?? undefined };
    case 'remote-changed': return { title };
    case 'merged': return { title, base: github.baseBranch || run?.targetBranch || 'main', project, task: run?.taskText || undefined };
    default: return { title, project };
  }
}

/** streakIncrease(previous, next) → the streak length when a delivery just extended it, else null.
    An unknown or unavailable previous summary is never an increase, so a first snapshot stays quiet. */
export function streakIncrease(previous, next) {
  if (!previous || typeof previous !== 'object' || previous.available === false || !next || typeof next !== 'object' || next.available === false) return null;
  const before = Number(previous.streak), after = Number(next.streak);
  if (!Number.isFinite(before) || !Number.isFinite(after) || after <= before || after < 1) return null;
  return Math.trunc(after);
}

// Run statuses the chat announces. Legacy records say 'done' where the app says 'staged'.
const ANNOUNCED = new Set(['staged', 'failed', 'merged', 'interrupted', 'cancelled']);
const runStatus = run => run && typeof run === 'object' ? (run.status === 'done' ? 'staged' : run.status) : undefined;
/** runStatusChange(previous, next) → next's announced status when the previous record did not already carry it, else null.
    GitHub binding refreshes re-emit a run record with its current status every minute; only a change is news.
    A record the page has never seen is a change: a run cannot end before it was queued. */
export function runStatusChange(previous, next) {
  const status = runStatus(next);
  if (!status || !ANNOUNCED.has(status)) return null;
  return runStatus(previous) === status ? null : status;
}

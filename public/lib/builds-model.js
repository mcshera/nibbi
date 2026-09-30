/** The control panel's model (docs/CONTROL-PANEL.md §3–§5 for phase 1, docs/BUILDS-AS-COPIES.md §4.2 for
 *  phase 2; the shapes are in ./control-panel-contract.js).
 *
 *  Pure: no DOM, no fetch, no clock. `now` comes in with the input and every relative time is said
 *  against it. From one project's runs (S.fixers, merged with the builds section read), its issues (the
 *  issues section read), its play status and its copies (GET /api/project-copies), it makes the builds —
 *  main and every live copy — and any improvement's TicketVM:
 *
 *    buildsCard(input)           → BuildsCardVM  the bar's builds card: main, then the copies; the card's badge,
 *                                                the project's attention, + New build
 *    buildOf(input, name)        → BuildVM|null  one build's page ('main' or a copy's name; null: that copy is gone)
 *    buildMain(input)            → BuildVM       main alone (phase 1's call; it counts only main's improvements)
 *    ticketOf(input, id)         → TicketVM      the ticket page (gone: true when it no longer exists)
 *    improvementIdForRun(…)      → the ticket a run belongs to (notifications, chips)
 *    mergeRuns(live, read)       → runs, the live record winning (§3.3)
 *    conversationsFor(threads)   → the conversations card's rows (§4.6)
 *    nextCopyName · copyNameProblem · normalizeCopyName   + New build's name rules, said in words
 *    previewText · splitImprovementText · parseDiffstat   the small rules the rest shares
 *
 *  An improvement is an issues.md item (`issue:<id>`) or a free-text run's retry chain (`run:<root>`);
 *  its tries are its runs, oldest first. Its state is its latest try's (RUN_STATES, GITHUB_STAGED,
 *  COPY_RUN_STATES), with the issue's own rules on top (§4.3). It lives in the build its latest try
 *  targets (run.copyId); a try on a copy that shipped lives in main, one on a copy that was retired
 *  falls back to main, settled, and one whose copy the client has not read yet is held back. */
import {
  MAIN, ID_PREFIX, STATES, STATE_WORDS, STATE_TONES, LIVE_STATES, GROUPS, RUN_STATES, GITHUB_STAGED,
  BADGE, ATTENTION_TONES, BAR_LIMITS, PAGE_LIMITS, REFUSED_IN_DEMO, WORDS,
  COPY, COPY_STATUS, COPY_HEALTH, COPY_STATE_WORDS, COPY_STATE_TONES, COPY_LIVE, CARD_BADGE,
} from './control-panel-contract.js';

/* ------------------------------------------------------------------------------------------ small rules */

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const str = value => typeof value === 'string' ? value : '';
const cut = (text, max) => text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
const firstLine = (value, max = Infinity) => cut(str(value).split(/\r?\n/).map(line => line.trim()).find(Boolean) || '', max);
const fill = (template, values) => template.replace(/\{(\w+)\}/g, (whole, name) => name in values ? String(values[name]) : whole);
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
/** ms since the epoch, or NaN. */
const ms = value => { const t = typeof value === 'number' ? value : typeof value === 'string' && value ? Date.parse(value) : NaN; return Number.isFinite(t) ? t : NaN; };
const iso = value => { const t = ms(value); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
/** "just now" · "6m" · "2h" · "3d" · "2w" (margin-ui.js's rule, the clock passed in). */
function since(value, now) {
  const t = ms(value);
  if (!Number.isFinite(t) || !Number.isFinite(now)) return '';
  const seconds = Math.max(0, (now - t) / 1000);
  if (seconds < 90) return 'just now';
  for (const [unit, size, limit] of [['m', 60, 60], ['h', 3600, 24], ['d', 86400, 7]]) { const n = Math.floor(seconds / size); if (n < limit) return n + unit; }
  return Math.floor(seconds / 604800) + 'w';
}
const ago = (value, now) => { const s = since(value, now); return !s || s === 'just now' ? s : s + ' ago'; };
/** A span, spoken coarse: "38s" · "4m" · "1h 4m" · "2d 3h". */
function span(milliseconds) {
  if (!Number.isFinite(milliseconds)) return '';
  const s = Math.max(0, Math.round(milliseconds / 1000));
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return m ? `${h}h ${m}m` : `${h}h`; }
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600); return h ? `${d}d ${h}h` : `${d}d`;
}
/** A real check, as the daemon decides it (fixer.ts:94): not '', 'true', ':' or 'echo …'. */
const realCheck = command => !!str(command).trim() && !/^(true|:|echo\b.*)$/.test(str(command).trim());
const status = run => run.status === 'done' ? 'staged' : str(run.status);
const issueIdsOf = run => Array.isArray(run?.issueIds) ? [...new Set(run.issueIds.filter(id => typeof id === 'string' && id))] : [];
const itemsOf = issues => Array.isArray(issues) ? issues : Array.isArray(issues?.items) ? issues.items : null;
const safeUrl = value => { try { const url = new URL(str(value)); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; } };

const GROUP_OF = Object.fromEntries(GROUPS.flatMap(group => group.states.map(state => [state, group.id])));
const groupOf = state => GROUP_OF[state] ?? 'settled';   // SETTLED: stopped · discarded · done
/** States that mean a try is still in play: they outrank a done issue (see issueRecord). */
const IN_PLAY = new Set(['up_next', 'building', 'landing', 'waiting_to_land', 'needs_you', ...GROUPS[0].states]);
const GITHUB_STATES = new Set(['to_push', 'pull_request', 'pr_ready', 'needs_attention']);
const VERB = {
  up_next: 'queued', building: 'started', needs_you: 'asked you', ready: 'staged', to_push: 'staged', pull_request: 'staged',
  pr_ready: 'staged', needs_attention: 'staged', in: 'landed', failed: 'failed', interrupted: 'stopped', stopped: 'stopped', discarded: 'discarded',
  landing: 'checked', waiting_to_land: 'checked',
};
const STEP_LABELS = Object.freeze({ install: 'install', work: 'do the work', check: 'run the checks', stage: 'stage it for review' });
const NOTE_GONE = 'its note is gone from issues.md';
/** Run statuses that mean a try is on its copy right now: retire refuses while any is (project-copies.ts). */
const ON_COPY = new Set(['queued', 'preparing', 'installing', 'running', 'checking', 'verifying', 'merging', 'awaiting_input']);

/** A GitHub-mode run: bound to a pull request flow, or started in a project whose workflow is GitHub's. */
const githubRun = run => run.github?.mode === 'github' || run.workflowMode === 'github';

/** A run's status → the state of its try, alone (§4.1, §4.2; BUILDS-AS-COPIES §4.2 for a copy's).
    null: superseded (an earlier try) or unknown. */
function runState(run, ctx = null) {
  const base = Object.hasOwn(RUN_STATES, status(run)) ? RUN_STATES[status(run)] : null;
  if (str(run.copyId)) return copyRunState(run, base, ctx);
  if (base !== 'ready' || !githubRun(run)) return base;
  for (const [flag, state] of GITHUB_STAGED) if (run.github?.[flag] === true) return state;
  return 'ready';
}
/** A copy's try (COPY_RUN_STATES): staged is landing — it lands on its own once its checks pass — or waiting
    to land while its copy plays; shipped is in, in main; on a copy that is gone and never shipped, discarded. */
function copyRunState(run, base, ctx) {
  if (base === null) return null;
  if (isRecord(run.shipped)) return 'in';
  if (ctx?.copiesRead && !ctx.liveById.has(run.copyId)) return 'discarded';
  if (base === 'ready') return run.landing?.state === 'waiting' ? 'waiting_to_land' : 'landing';
  return base;
}
/** When a try landed: a GitHub merge's own time (the run keeps its staging endedAt), else endedAt. */
const landedAt = run => iso(run.remoteMerge?.mergedAt) || iso(run.remoteMerge?.at) || iso(run.endedAt) || iso(run.startedAt);
/** What line two's time is for a try in this state. */
function whenOf(state, run) {
  const at = state === 'in' ? landedAt(run)
    : state === 'up_next' ? iso(run.startedAt)
    : state === 'building' || state === 'needs_you' ? iso(run.latestAttemptStartedAt) || iso(run.startedAt)
    : iso(run.endedAt) || iso(run.startedAt);
  return at && VERB[state] ? { verb: VERB[state], at } : null;
}
/** Why a try failed or stopped, first line, ≤ 160: its summary (the error), else the check's detail. */
const reasonOf = run => firstLine(run.summary, 160) || firstLine(run.verification?.detail, 160);

/* ------------------------------------------------------------------------------------------ public rules */

/** §4.6: the last thing said, as one clean line — the daemon stores the same (threads.ts touchThread). */
export function previewText(text) {
  const lines = str(text).replace(/\r\n?/g, '\n').replace(/»(?:voice|acts):[^\n]*\n?/gi, '').split('\n'), out = [];
  let fence = null;
  for (const line of lines) {
    const mark = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) { if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length) fence = null; continue; }
    if (mark) { fence = mark[1]; out.push('…'); continue; }
    out.push(line);
  }
  const clean = out.join(' ').replace(/[#*_>`]/g, '').replace(/\s+/g, ' ').trim();
  return cut(clean, 120);
}

/** The + improvement field's words → an issue's title (the first line) and description (the rest).
    Throws, in words, what the daemon would refuse (project-workspace.ts:92): nothing to say, or a
    reserved `<!-- nibbi-` marker. */
export function splitImprovementText(text) {
  const lines = str(text).replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex(line => line.trim());
  if (start < 0) throw new Error('say what should change first');
  const title = lines[start].trim(), description = lines.slice(start + 1).join('\n').replace(/^\s*\n/, '').trimEnd();
  if (/<!--\s*nibbi-/i.test(title) || /<!--\s*nibbi-/i.test(description)) throw new Error('those words hold a marker nibbi keeps for itself (“<!-- nibbi-”) — take it out and try again');
  return { title, description: description.replace(/^\n+/, '') };
}

/** `git diff --stat` → the files it names and the totals of its last line. A rename names where it went. */
export function parseDiffstat(diffstat) {
  const list = []; let count = null, add = 0, del = 0;
  for (const raw of str(diffstat).split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const total = raw.trim().match(/^(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?$/);
    if (total) { count = Number(total[1]); add = Number(total[2] || 0); del = Number(total[3] || 0); continue; }
    const file = raw.match(/^\s*(.+?)\s+\|\s+(?:(\d+)(?:\s+[+-]*)?|Bin\b.*)\s*$/);
    if (!file) continue;
    let path = file[1].trim().replace(/\{([^{}]*) => ([^{}]*)\}/g, (_, from, to) => to).replace(/\/{2,}/g, '/').replace(/^\//, '');
    if (path.includes(' => ')) path = path.split(' => ').pop().trim();
    list.push({ path, changes: file[2] ? Number(file[2]) : 0 });
  }
  return { count: count ?? list.length, add, del, list };
}

/** §3.3: by id, the live record winning for what the events carry; the read's allowedActions, preview
    and currentActivity only while the two agree on the status (else null: not known yet). */
// landing and shipped too (phase 2): a landing that finished clears run.landing, and the read must not bring it back
const LIVE_WINS = ['status', 'endedAt', 'summary', 'verification', 'commitSha', 'diffstat', 'github', 'landing', 'shipped'];
const FROM_READ = ['allowedActions', 'preview', 'currentActivity'];
export function mergeRuns(liveRuns, sectionRuns) {
  const live = (Array.isArray(liveRuns) ? liveRuns : []).filter(run => isRecord(run) && typeof run.id === 'string');
  const read = (Array.isArray(sectionRuns) ? sectionRuns : []).filter(run => isRecord(run) && typeof run.id === 'string');
  const readById = new Map(); for (const run of read) if (!readById.has(run.id)) readById.set(run.id, run);
  const out = [], seen = new Set();
  for (const run of live) {
    if (seen.has(run.id)) continue; seen.add(run.id);
    const known = readById.get(run.id), merged = known ? { ...known } : {};
    for (const [key, value] of Object.entries(run)) if (value !== undefined) merged[key] = value;
    for (const key of LIVE_WINS) merged[key] = run[key];
    const agree = !!known && status(known) === status(run);
    for (const key of FROM_READ) merged[key] = agree && known[key] !== undefined ? known[key] : null;
    out.push(merged);
  }
  for (const run of read) if (!seen.has(run.id)) { seen.add(run.id); out.push({ ...run, ...Object.fromEntries(FROM_READ.map(key => [key, run[key] ?? null])) }); }
  return out;
}

/** The oldest run reached by following replacesBuildId through runs that still exist (fixer.ts:295, 300). */
function rootOf(run, byId) {
  let at = run; const seen = new Set([run.id]);
  while (typeof at.replacesBuildId === 'string' && byId.has(at.replacesBuildId) && !seen.has(at.replacesBuildId)) { seen.add(at.replacesBuildId); at = byId.get(at.replacesBuildId); }
  return at.id;
}

/** Which ticket a run is a try of: the first of its issues still in issues.md (the first at all when
    the list is unread), else its retry chain. null when the run is unknown. */
export function improvementIdForRun(runs, issues, runId) {
  const list = (Array.isArray(runs) ? runs : []).filter(run => isRecord(run) && typeof run.id === 'string');
  const run = list.find(r => r.id === runId); if (!run) return null;
  const items = itemsOf(issues), ids = issueIdsOf(run);
  if (ids.length) {
    if (!items) return ID_PREFIX.issue + ids[0];
    const known = new Set(items.filter(isRecord).map(item => item.id));
    const hit = ids.find(id => known.has(id)); if (hit) return ID_PREFIX.issue + hit;
  }
  return ID_PREFIX.run + rootOf(run, new Map(list.map(r => [r.id, r])));
}

/** §4.6: the conversations card, home first then the most recent, archived left out. The open one says
    the last settled turn the client holds (`liveText`) before the daemon's `lastText`. */
export function conversationsFor(threads, { activeId = null, liveText = null, project = null } = {}) {
  const list = (Array.isArray(threads) ? threads : []).filter(t => isRecord(t) && typeof t.id === 'string' && t.archived !== true);
  const seen = new Set(), rows = [];
  for (const t of list) if (!seen.has(t.id)) { seen.add(t.id); rows.push(t); }
  if (!seen.has('home')) rows.unshift({ id: 'home', project, title: 'Home', lastAt: null, count: 0 });   // home always exists: every message with no thread
  const rank = t => { const at = ms(t.lastAt); return Number.isFinite(at) ? at : 0; };
  const home = rows.find(t => t.id === 'home'), rest = rows.filter(t => t.id !== 'home').map((t, i) => ({ t, i })).sort((a, b) => rank(b.t) - rank(a.t) || a.i - b.i).map(x => x.t);
  return [home, ...rest].map(t => {
    const active = activeId != null && t.id === activeId;
    const said = (active && previewText(liveText)) || previewText(t.lastText);
    return { id: t.id, project: t.project ?? project ?? null, title: str(t.title) || (t.id === 'home' ? 'Home' : 'Thread'), lastAt: str(t.lastAt) || null,
      lastText: said || (t.id === 'home' ? WORDS.homeLine : ''), active, count: Number.isSafeInteger(t.count) && t.count >= 0 ? t.count : 0 };
  });
}

/* ------------------------------------------------------------------------------------------ + New build's names */

/** What the field's words become before they are checked or sent: trimmed, lowercase, spaces and
    underscores to dashes ("Dev 2" → "dev-2"). */
export function normalizeCopyName(text) {
  return str(text).trim().toLowerCase().replace(/[\s_]+/g, '-');
}
/** 'dev', then 'dev1', 'dev2' … — the first that no live copy has. */
export function nextCopyName(taken) {
  const used = new Set((Array.isArray(taken) ? taken : []).map(normalizeCopyName));
  if (!used.has(COPY.first)) return COPY.first;
  for (let n = 1; ; n++) if (!used.has(COPY.first + n)) return COPY.first + n;
}
const NAME = new RegExp(COPY.namePattern);
/** '' when a new copy may be called this, else the words why not (the daemon refuses the same, §2.3). The
    name is normalized first, so the words say the name as it would be made. `taken`: the live copies' names. */
export function copyNameProblem(name, taken) {
  const list = (Array.isArray(taken) ? taken : []).map(normalizeCopyName), value = normalizeCopyName(name);
  if (!value) return WORDS.copy.nameEmpty;
  if (value.length > COPY.nameMax) return WORDS.copy.nameLong;
  if (!NAME.test(value)) return WORDS.copy.nameShape;
  if (COPY.reserved.includes(value)) return fill(WORDS.copy.nameReserved, { name: value });
  if (list.includes(value)) return fill(WORDS.copy.nameTaken, { name: value });
  if (list.length >= COPY.limit) return WORDS.copy.tooMany;
  return '';
}

/* ------------------------------------------------------------------------------------------ the project */

const nat = value => Number.isSafeInteger(value) && value > 0 ? value : 0;
/** One read of the input, shared by every build and ticket. */
function contextOf(input = {}) {
  input = isRecord(input) ? input : {};
  const project = isRecord(input.project) ? input.project : {};
  const name = str(project.name);
  const runs = mergeRuns(input.runs, input.sectionRuns).filter(run => { const owner = run.game || run.project; return !owner || !name || owner === name; });
  const items = itemsOf(input.issues);
  const list = ['ready', 'loading', 'unavailable'].includes(input.list) ? input.list : input.issues ? 'ready' : 'loading';
  const connection = isRecord(project.github) ? project.github : null;
  const githubMode = connection?.workflowMode === 'github';
  // main's branch is where main's runs land: a copy's run lands on the copy (§9.3 — it would rename main nibbi/copy/dev)
  const newest = runs.filter(run => !str(run.copyId) && str(run.targetBranch)).sort((a, b) => (ms(b.startedAt) || 0) - (ms(a.startedAt) || 0))[0];
  const branch = (githubMode && str(connection.integrationBranch)) || str(newest?.targetBranch) || str(project.targetBranch) || str(project.branch) || MAIN;
  const now = Number.isFinite(input.now) ? input.now : NaN;
  const maxConcurrent = Number.isSafeInteger(input.maxConcurrent) && input.maxConcurrent > 0 ? input.maxConcurrent : 2;
  const check = { command: str(project.check), real: realCheck(project.check) };
  // the copies read: null until it lands (a copy's improvements are held back until then)
  const copiesRead = isRecord(input.copies) && Array.isArray(input.copies.copies) ? input.copies : null;
  const seenNames = new Set();
  const copies = copiesRead ? copiesRead.copies.filter(c => {
    if (!isRecord(c) || typeof c.id !== 'string' || !c.id || c.status === 'retired' || !str(c.name) || seenNames.has(c.name)) return false;
    seenNames.add(c.name); return true;
  }) : [];
  const liveById = new Map(copies.map(c => [c.id, c]));
  const copyNames = new Map(copies.map(c => [c.id, c.name]));
  for (const r of Array.isArray(copiesRead?.retired) ? copiesRead.retired : []) if (isRecord(r) && str(r.id) && !copyNames.has(r.id) && str(r.name)) copyNames.set(r.id, r.name);
  for (const s of Array.isArray(copiesRead?.ships) ? copiesRead.ships : []) if (isRecord(s) && str(s.copyId) && !copyNames.has(s.copyId) && str(s.name)) copyNames.set(s.copyId, s.name);
  // why no copy can be made or changed here: the daemon's read, else what the client can tell on its own
  const disabled = copiesRead ? (['github', 'no_check'].includes(copiesRead.disabled) ? copiesRead.disabled : '') : githubMode ? 'github' : !check.real ? 'no_check' : '';
  // automation (the owner's decision, 2026-09-29): stage and ship build what is up next — into main, or the copy chosen on the card —
  // unless a /goal is set, when it works the roadmap. auto: { mode, copyId, goal, onAt }, from /api/auto and the goals.
  const auto = isRecord(input.auto) ? input.auto : {};
  const autoTarget = str(auto.copyId) && liveById.has(auto.copyId) ? auto.copyId : null;
  return {
    auto: { on: ['stage', 'ship'].includes(auto.mode) && auto.goal !== true, target: autoTarget, into: autoTarget ? liveById.get(autoTarget).name : MAIN, onAt: iso(auto.onAt) },
    name, project, runs, items, list, branch, now, maxConcurrent, demo: input.demo === true,
    revision: str(input.issues?.revision), play: isRecord(input.play) ? input.play : null, check,
    github: connection ? { mode: githubMode ? 'github' : 'local', repository: str(connection.repository) || null,
      integrationBranch: str(connection.integrationBranch) || null, releaseBranch: str(connection.releaseBranch) || null } : null,
    copiesRead, copies, liveById, copyNames, disabled,
    limit: Number.isSafeInteger(copiesRead?.limit) && copiesRead.limit > 0 ? copiesRead.limit : COPY.limit,
  };
}
const copyName = (ctx, id) => ctx.copyNames.get(id) || 'the copy';
/** Where automation builds what is up next in this build (main: null, else a copy's id): the build's name it goes into, or ''
    when it doesn't pick this build's list up. Main's list is built into the chosen copy; a copy's own list only when it is chosen. */
const autoInto = (ctx, copyId) => !ctx.auto.on || (copyId && copyId !== ctx.auto.target) ? '' : ctx.auto.into;

const byStart = tries => tries.map((run, i) => ({ run, i })).sort((a, b) => (ms(a.run.startedAt) || 0) - (ms(b.run.startedAt) || 0) || a.i - b.i).map(x => x.run);
const lastWhere = (list, test) => { for (let i = list.length - 1; i >= 0; i--) if (test(list[i])) return list[i]; return null; };

/** Every improvement of the project, as records the VMs are made from. `goneIssue` makes the one ticket
    whose note left issues.md while runs still name it (§4.4). */
function collect(ctx, goneIssue = null) {
  const byId = new Map(ctx.runs.map(run => [run.id, run]));
  const known = ctx.items ? new Map() : null;
  if (known) ctx.items.forEach((item, index) => { if (isRecord(item) && typeof item.id === 'string' && item.id && !known.has(item.id)) known.set(item.id, { item, index }); });
  const issueTries = new Map(), chains = new Map(), push = (map, key, run) => { if (!map.has(key)) map.set(key, []); map.get(key).push(run); };
  for (const run of ctx.runs) {
    const ids = issueIdsOf(run), linked = known ? ids.filter(id => known.has(id)) : ids;
    if (linked.length) for (const id of linked) push(issueTries, id, run);
    else push(chains, rootOf(run, byId), run);
  }
  const records = [];
  if (known) for (const [id, { item, index }] of known) records.push(issueRecord(ctx, id, item, index, byStart(issueTries.get(id) || []), false));
  else for (const [id, tries] of issueTries) records.push(issueRecord(ctx, id, null, Infinity, byStart(tries), false));
  for (const [root, tries] of chains) records.push(runRecord(ctx, root, byId.get(root), byStart(tries)));
  if (goneIssue) {
    const tries = ctx.runs.filter(run => issueIdsOf(run).includes(goneIssue));
    if (tries.length) records.push(issueRecord(ctx, goneIssue, null, Infinity, byStart(tries), true));
  }
  return records;
}

/** §4.3: an issue's state is its latest try's, with the item's own rules on top. */
function issueRecord(ctx, id, item, index, tries, gone) {
  const states = tries.map(run => ({ run, state: runState(run, ctx) }));
  const latest = lastWhere(states, t => t.state !== null), merged = lastWhere(states, t => t.state === 'in');
  let state, basis = latest, fromIssue = false, context = '';
  if (item && item.done === true) {
    // A done item whose try is still in play shows that try: the owner can mark an item done while it
    // builds (issue.complete has no run guard), and a running agent must not vanish from the bar.
    if (latest && IN_PLAY.has(latest.state)) state = latest.state;
    else if (merged) { state = 'in'; basis = merged; }
    else { state = 'done'; basis = null; fromIssue = true; context = 'marked done in issues.md'; }
  } else if (item) {
    // Suggest mode's own (item.suggested) say so until something happens to them (the owner's decision, 2026-09-29).
    if (!latest) { state = 'up_next'; fromIssue = true; context = item.boardStatus === 'in-progress' ? 'you marked it in progress' : item.suggested === true ? WORDS.suggested : str(item.heading) || firstLine(item.description, 160); }
    else if (latest.state === 'stopped' || latest.state === 'discarded') { state = 'up_next'; basis = null; fromIssue = true; context = `its last try was ${latest.state}`; }
    else state = latest.state;
  } else {
    // The list is unread (items null) or the note is gone: the runs alone say where it is.
    state = latest ? latest.state : 'discarded';
    if (gone) context = NOTE_GONE;
  }
  const root = tries[0];
  const title = item ? str(item.text) || str(item.title) : str(root?.title) || firstLine(root?.issue);
  return finish(ctx, { id: ID_PREFIX.issue + id, kind: 'issue', issueId: id, item, index, tries, state, basis: basis?.run ?? null,
    latest: latest?.run ?? tries[tries.length - 1] ?? null, fromIssue, context, title, inProgress: item?.boardStatus === 'in-progress', gone });
}
/** §4.4: a free-text run's retry chain. */
function runRecord(ctx, root, rootRun, tries) {
  const states = tries.map(run => ({ run, state: runState(run, ctx) })), latest = lastWhere(states, t => t.state !== null);
  const first = rootRun || tries[0];
  const orphaned = !!ctx.items && tries.some(run => issueIdsOf(run).length);   // its issue left issues.md
  return finish(ctx, { id: ID_PREFIX.run + root, kind: 'run', issueId: null, item: null, index: Infinity, tries,
    state: latest ? latest.state : 'discarded', basis: latest?.run ?? null, latest: latest?.run ?? tries[tries.length - 1] ?? null,
    fromIssue: false, context: orphaned ? NOTE_GONE : '', title: str(first?.title) || firstLine(first?.issue), inProgress: false, gone: false });
}
function finish(ctx, rec) {
  const { state } = rec;
  const when = rec.fromIssue || !rec.basis ? null : whenOf(state, rec.basis);
  rec.vm = {
    id: rec.id, kind: rec.kind, title: rec.title, state, word: STATE_WORDS[state], tone: STATE_TONES[state], live: LIVE_STATES.includes(state),
    group: groupOf(state), context: rec.context, when,
    reason: ['failed', 'interrupted', 'stopped'].includes(state) && rec.basis ? reasonOf(rec.basis) : '',
    issueId: rec.issueId, runIds: rec.tries.map(run => run.id), latestRunId: rec.latest?.id ?? null, order: 0, build: MAIN,
  };
  rec.at = ms(when?.at);
  return rec;
}

/** Which build an improvement lives in (BUILDS-AS-COPIES §4.2): its latest try — the record's basis, else its
    latest — decides; with no try at all, the issue's own copy (issue.create with a copyId). Sets rec.build
    ('main' | a copy's name), rec.copyId (its live copy's id, else null), rec.held (its copy is not read yet:
    drawn nowhere, counted nowhere), rec.shippedFrom / rec.retiredFrom (the copy's name, for the words). */
function settle(ctx, rec) {
  const basis = rec.basis || rec.latest;
  const copyId = basis ? str(basis.copyId) : str(rec.item?.copyId);
  Object.assign(rec, { build: MAIN, copyId: null, held: false, shippedFrom: '', retiredFrom: '' });
  if (copyId && !ctx.copiesRead) rec.held = true;
  else if (copyId && basis && isRecord(basis.shipped)) {
    // it went to main when its copy shipped: in main, "shipped from dev", at the ship's time
    rec.shippedFrom = copyName(ctx, copyId);
    if (rec.state === 'in') {
      const at = iso(basis.shipped.at) || landedAt(basis);
      rec.vm.when = at ? { verb: 'shipped', at } : null;
      rec.vm.context = fill(WORDS.copy.shippedContext, { name: rec.shippedFrom });
    }
  } else if (copyId && ctx.liveById.has(copyId)) {
    rec.build = ctx.liveById.get(copyId).name; rec.copyId = copyId;
    if (rec.state === 'waiting_to_land') { rec.vm.when = null; rec.vm.context = fill(WORDS.copy.landsAfterPlay, { name: rec.build }); }
  } else if (copyId && basis) {
    // its copy was retired before it shipped: back in main, settled (an issue is up next again, phase 1's rule)
    rec.retiredFrom = copyName(ctx, copyId);
    if (['discarded', 'up_next'].includes(rec.state)) { rec.vm.context = fill(WORDS.copy.retiredBefore, { name: rec.retiredFrom }); if (rec.state === 'discarded') rec.vm.when = null; }
  }
  rec.vm.build = rec.build;
  rec.at = ms(rec.vm.when?.at);
  return rec;
}
/** Every improvement, placed in its build. */
const placed = (ctx, goneIssue = null) => collect(ctx, goneIssue).map(rec => settle(ctx, rec));

/* ------------------------------------------------------------------------------------------ order */

const desc = (a, b) => (Number.isFinite(b) ? b : -Infinity) - (Number.isFinite(a) ? a : -Infinity);
const asc = (a, b) => (Number.isFinite(a) ? a : Infinity) - (Number.isFinite(b) ? b : Infinity);
const safe = n => Number.isNaN(n) ? 0 : n;
const WAITING_ORDER = GROUPS[0].states;
/** Inside a group (§7a "must"): waiting by how much it wants you, then newest; building newest first;
    up next marked-in-progress first, then file order, then queued runs by time; in and failed newest first. */
function compare(group) {
  if (group === 'waiting') return (a, b) => WAITING_ORDER.indexOf(a.state) - WAITING_ORDER.indexOf(b.state) || safe(desc(a.at, b.at));
  if (group === 'up_next') {
    const rank = rec => rec.kind === 'issue' ? (rec.inProgress ? 0 : 1) : 2;
    return (a, b) => rank(a) - rank(b) || safe(asc(a.index, b.index)) || safe(asc(ms(a.latest?.startedAt), ms(b.latest?.startedAt)));
  }
  if (group === 'settled') return (a, b) => safe(desc(a.at, b.at)) || safe(asc(a.index, b.index));
  return (a, b) => safe(desc(a.at, b.at));
}
function ordered(records) {
  const groups = new Map();
  records.forEach((rec, i) => { rec.seq = i; const g = rec.vm.group; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(rec); });
  for (const [group, list] of groups) { const by = compare(group); list.sort((a, b) => by(a, b) || a.seq - b.seq); list.forEach((rec, i) => { rec.vm.order = i; }); }
  return groups;
}

/* ------------------------------------------------------------------------------------------ main */

function playOf(ctx) {
  const play = ctx.play, running = play?.running === true, playable = play?.playable === true || (running && !!str(play?.url));
  const blocked = ctx.demo ? WORDS.demoPlay : !play ? WORDS.reading : !playable && !running ? fill(WORDS.noPlay, { project: ctx.name || 'this project' }) : '';
  return { playable, running, starting: play?.starting === true, url: str(play?.url) || null, blocked,
    note: str(ctx.project.branch) ? fill(WORDS.checkout, { branch: ctx.project.branch }) : '', lastCommit: str(ctx.project.lastCommit) };
}
/** The first state with a count says it (BADGE). */
function badgeOf(byState) {
  for (const [state, one, many, tone] of BADGE) { const count = byState[state] || 0; if (count) return { text: fill(count === 1 ? one : many, { n: count }), tone }; }
  return { text: '', tone: 'quiet' };
}

/** One build's improvements (§3.1): ordered by GROUPS, counted, badged. `records` are the build's own. */
function contents(ctx, records) {
  // issues.md unread or unreadable: its own up-next rows are not known to be true; queued runs still are (§2.1.3).
  if (ctx.list !== 'ready') records = records.filter(rec => !(rec.kind === 'issue' && rec.fromIssue && rec.state === 'up_next'));
  const groups = ordered(records), of = id => groups.get(id) || [];
  const byState = Object.fromEntries(STATES.map(state => [state, records.filter(rec => rec.state === state).length]));
  const landed = of('in'), windowStart = ctx.now - BAR_LIMITS.inWindowMs;
  const counts = {
    waiting: of('waiting').length, needsYou: byState.needs_you, ready: byState.ready, building: of('building').length, upNext: byState.up_next,
    in: landed.length, inToday: landed.filter(rec => Number.isFinite(rec.at) && rec.at >= windowStart).length,
    failed: byState.failed, interrupted: byState.interrupted,
  };
  const improvements = GROUPS.flatMap(group => (group.id === 'in' ? of('in').slice(0, PAGE_LIMITS.inKept) : of(group.id)).map(rec => rec.vm));
  return { records, of, byState, counts, badge: badgeOf(byState), improvements, settled: of('settled').slice(0, PAGE_LIMITS.settledKept).map(rec => rec.vm) };
}
/** What a build wants from you: its badge when it is attention or error; else "N building" (BADGE's last row,
    tone active — the toggle shows it, the rollup does not); else nothing. */
const attentionOf = badge => ATTENTION_TONES.includes(badge.tone) || badge.tone === 'active' ? { ...badge } : { text: '', tone: 'quiet' };
const history = rows => rows.filter(row => row.at).sort((a, b) => safe(desc(ms(a.at), ms(b.at)))).slice(0, 30);
const LANDED_RUN = run => status(run) === 'merged';

/** Main (§3.1, §4; BUILDS-AS-COPIES §4.2): what ships. `full` adds the phase-2 keys to the two objects phase 1's
    suite pins whole — blocked (ship · catchUp · retire) and play (stops · kind); every other phase-2 field is
    always there, neutral. `copies`: the live copies' BuildVMs, for "copies of main" and what main's Play stops. */
function mainVM(ctx, records, copies, full) {
  const c = contents(ctx, records);
  const play = playOf(ctx);
  const playingCopy = copies.find(b => b.play.running);
  if (full) Object.assign(play, { stops: playingCopy ? playingCopy.name : '', kind: ['server', 'url', 'none'].includes(ctx.play?.kind) ? ctx.play.kind : play.playable ? 'server' : 'none' });
  const line = ctx.branch === MAIN ? WORDS.mainLine : fill(WORDS.mainLineOther, { branch: ctx.branch });
  const blocked = {
    start: ctx.demo ? WORDS.demoStart : '',   // not while nibbi answers either: nothing waits for the reply (§12.2)
    queue: ctx.demo ? WORDS.demoChange : ctx.list !== 'ready' || !ctx.revision ? WORDS.noList : '',
    play: play.blocked,
  };
  if (full) Object.assign(blocked, { ship: WORDS.copy.mainShips, catchUp: '', retire: '' });
  // what landed in main, and one row per ship into it from a copy ("dev shipped 2")
  const landed = c.of('in').filter(rec => rec.vm.when?.verb === 'landed').map(rec => ({ kind: 'landed', at: rec.vm.when.at, text: rec.vm.title, tone: 'pass', improvementId: rec.id, sha: str(rec.basis?.commitSha) }));
  const ships = (Array.isArray(ctx.copiesRead?.ships) ? ctx.copiesRead.ships : []).filter(isRecord).map(s => ({
    kind: 'shipped', at: iso(s.at), text: fill(WORDS.copy.shippedLine, { name: str(s.name) || copyName(ctx, str(s.copyId)), n: Array.isArray(s.runIds) ? s.runIds.length : 0 }),
    tone: 'pass', improvementId: null, sha: str(s.sha) }));
  return {
    vm: {
      id: MAIN, name: MAIN, kind: 'main', copyId: null, branch: ctx.branch, line, autoInto: autoInto(ctx, null),
      word: 'live', state: 'live', tone: 'quiet', live: false,
      note: line.startsWith('live · ') ? line.slice('live · '.length) : line, count: play.running ? WORDS.copy.playing : '', detail: '', copyLine: line,
      ahead: null, behind: null, head: '', status: 'live', health: 'ok', healthWords: '', verified: null, checks: [], madeAt: null, madeFrom: null,
      badge: c.badge, attention: attentionOf(c.badge), counts: c.counts, play, check: { ...ctx.check }, github: ctx.github,
      improvements: c.improvements, settled: c.settled, list: ctx.list, blocked, ship: null, catchUp: null, retire: null,
      history: history([...landed, ...ships]),
      copies: copies.map(b => ({ name: b.name, copyId: b.copyId, word: b.word, tone: b.tone, live: b.live, note: b.note })),
    },
    byState: c.byState,
  };
}

/** A copy's headline (COPY_STATES): the first that holds. */
function headlineOf({ status, health, counts, behind, playedAfterLanding }) {
  if (status === 'creating') return 'making';
  if (['broken', 'retiring', 'shipping', 'catching_up'].includes(status)) return status;
  if (health === 'missing') return 'missing';
  if (health === 'moved' || health === 'dirty') return 'changed';
  if (counts.building) return 'building';
  if (behind) return 'behind';
  if (counts.waiting) return 'waiting';
  if (counts.in) return playedAfterLanding ? 'ready_to_ship' : 'ready_to_play';
  if (counts.upNext) return 'up_next';
  return 'nothing';
}

/** A live copy (BUILDS-AS-COPIES §4.2): the read's git facts, its improvements, the words for what it can do. */
function copyVM(ctx, copy, records, allRecords, others) {
  const c = contents(ctx, records), { counts } = c;
  const name = copy.name, copyId = copy.id, headSha = str(copy.headSha), head = headSha.slice(0, 7);
  const phase = COPY_STATUS.includes(copy.status) ? copy.status : 'ready';
  const health = COPY_HEALTH.includes(copy.health) ? copy.health : 'ok';
  const ahead = nat(copy.ahead), behind = nat(copy.behind);
  const read = isRecord(copy.play) ? copy.play : {};
  const running = read.running === true;
  const kind = ['server', 'url', 'none'].includes(read.kind) ? read.kind : read.playable === true ? 'server' : 'none';
  const played = ms(copy.playedAt), landedAtMs = ms(copy.lastLandedAt);
  const playedAfterLanding = Number.isFinite(played) && (!Number.isFinite(landedAtMs) || played >= landedAtMs);
  const state = headlineOf({ status: phase, health, counts, behind, playedAfterLanding });
  const word = fill(COPY_STATE_WORDS[state], { n: state === 'building' ? counts.building : counts.upNext, badge: c.badge.text });

  // what it can't do now, and why — in the order the spec's table gives
  const github = ctx.disabled === 'github' ? fill(WORDS.copy.githubMode, { project: ctx.name || 'this project' }) : '';
  const notReady = phase !== 'ready' ? fill(WORDS.copy.notReady, { name, status: WORDS.copy.statusWords[phase] || phase.replace(/_/g, ' ') }) : '';
  const brokenWhy = firstLine(copy.error, 160).replace(/[.\s]+$/, '') || 'something went wrong';
  const healthWords = phase === 'broken' ? fill(WORDS.copy.broken, { name, error: brokenWhy }) : health !== 'ok' ? fill(WORDS.copy[health], { name }) : '';
  const unwell = phase === 'ready' && health !== 'ok' ? healthWords : '';
  const gate = github || notReady || unwell;
  const building = records.some(rec => rec.vm.group === 'building')
    || ctx.runs.some(run => run.copyId === copyId && ON_COPY.has(status(run)));
  const project = ctx.project;
  const blocked = {
    start: ctx.demo ? WORDS.demoStart : gate,
    queue: ctx.demo ? WORDS.demoChange : gate || (ctx.list !== 'ready' || !ctx.revision ? WORDS.noList : ''),
    play: ctx.demo ? WORDS.demoPlay : running ? '' : gate || (kind === 'url' ? fill(WORDS.copy.fixedAddress, { project: ctx.name || 'this project' })
      : read.playable !== true ? fill(WORDS.copy.nothingToPlay, { name }) : ''),
    ship: ctx.demo ? WORDS.demoChange : github || (!ctx.check.real ? WORDS.copy.noCheck : '') || notReady || unwell
      || (!counts.in ? fill(WORDS.copy.shipNothing, { name }) : '') || (behind ? fill(WORDS.copy.shipBehind, { name }) : '')
      || (str(project.branch) && str(copy.base) && project.branch !== copy.base ? fill(WORDS.copy.shipCheckoutOther, { branch: project.branch, base: copy.base }) : '')
      || (Number(project.dirty) > 0 ? WORDS.copy.shipCheckoutDirty : ''),
    catchUp: ctx.demo ? WORDS.demoChange : gate || (!behind ? fill(WORDS.copy.catchUpLevel, { name }) : ''),
    retire: ctx.demo ? WORDS.demoChange : ['creating', 'shipping', 'catching_up', 'retiring'].includes(phase) ? notReady
      : building ? fill(WORDS.copy.retireBuilding, { name })
      // its branch or folder moved outside nibbi: retire could drop commits nibbi didn't make, so it waits until it's put back
      : health === 'moved' ? fill(WORDS.copy.moved, { name }) : '',
  };

  const verifiedSha = str(copy.lastVerifiedSha);
  const verified = headSha && verifiedSha === headSha ? { sha: headSha, at: iso(copy.lastVerifiedAt), command: ctx.check.command } : null;
  const checks = [{ name: ctx.check.command || 'the project check', ok: verified ? true : null,
    note: verified ? `verified ${[ago(verified.at, ctx.now), 'on ' + head].filter(Boolean).join(' ')}` : `not run on ${name} yet` }];
  const stops = ctx.play?.running === true && ctx.play.kind !== 'url' ? MAIN : others.find(b => b.copyId !== copyId && b.play?.running)?.name || '';
  const play = { playable: read.playable === true, running, starting: read.starting === true, url: str(read.url) || null, blocked: blocked.play,
    note: fill(WORDS.copy.playNote, { name, sha: head }), lastCommit: '', stops, kind, playedAt: str(copy.playedAt) || null };

  const inList = c.of('in').map(rec => rec.vm);
  const ship = {
    ready: !blocked.ship, why: blocked.ship, ships: inList, stays: c.improvements.filter(vm => vm.state !== 'in'),
    lead: blocked.ship || (inList.length === 1 ? WORDS.copy.shipLeadOne : fill(WORDS.copy.shipLeadMany, { n: inList.length })),
    checks, checksLine: fill(WORDS.copy.shipChecks, { command: ctx.check.command || 'the project check' }),
    facts: [
      playedAfterLanding ? fill(WORDS.copy.shipPlayed, { name, ago: ago(copy.playedAt, ctx.now) || 'just now' }) : fill(WORDS.copy.shipNotPlayed, { name }),
      ...(!behind ? [fill(WORDS.copy.shipLevel, { name })] : []),
    ],
    yes: inList.length === 1 ? WORDS.copy.shipYesOne : fill(WORDS.copy.shipYesMany, { n: inList.length }), no: WORDS.copy.shipNo,
    payload: { copyId, expectedHead: headSha },
  };
  const catchUps = (Array.isArray(copy.catchUps) ? copy.catchUps : []).filter(isRecord);
  const catchWhy = rec => rec.reason === 'conflict' || (Array.isArray(rec.conflicts) && rec.conflicts.length)
    ? fill(WORDS.copy.catchUpConflict, { name, files: (rec.conflicts || []).slice(0, 3).join(', ') || 'the same files' })
    : rec.reason === 'checkfail' ? fill(WORDS.copy.catchUpCheckfail, { name })
    : fill(WORDS.copy.catchUpFailed, { why: firstLine(rec.detail, 160) || rec.reason || 'it was refused' });
  const lastCatch = catchUps[0];
  const catchUp = {
    needed: behind > 0, blocked: blocked.catchUp,
    confirm: running ? { words: fill(WORDS.copy.catchUpPlaying, { name }), yes: WORDS.copy.catchUpYes, no: WORDS.copy.catchUpNo, armed: false } : null,
    payload: { copyId, expectedHead: headSha, stopPlay: running },
    last: lastCatch ? { at: iso(lastCatch.at), ok: lastCatch.ok === true, words: lastCatch.ok === true ? WORDS.copy.caughtUp : catchWhy(lastCatch) } : null,
  };
  const unshipped = counts.in;
  const retire = {
    blocked: blocked.retire, note: fill(WORDS.copy.retireNote, { name }), unshipped, payload: { copyId, expectedHead: headSha },
    confirm: {
      words: fill(WORDS.copy.retireConfirm, { name, unshipped: unshipped === 1 ? WORDS.copy.retireUnshippedOne : unshipped > 1 ? fill(WORDS.copy.retireUnshippedMany, { n: unshipped }) : '' })
        + (running ? WORDS.copy.retirePlaying : ''),
      yes: fill(WORDS.copy.retireYes, { name }), no: fill(WORDS.copy.retireNo, { name }), armed: true,
    },
  };

  // its history: made · each try (started / landed / failed) · each ship · each catch-up
  const improvementOf = new Map(allRecords.flatMap(rec => rec.tries.map(run => [run.id, rec.id])));
  const tries = ctx.runs.filter(run => run.copyId === copyId && status(run) !== 'superseded').map(run => {
    const st = runState(run, ctx), title = str(run.title) || firstLine(run.issue) || 'an improvement', improvementId = improvementOf.get(run.id) ?? null;
    if (LANDED_RUN(run)) return { kind: 'landed', at: iso(run.endedAt) || iso(run.startedAt), text: title, tone: 'pass', improvementId, sha: str(run.commitSha) };
    if (st === 'failed' || st === 'interrupted') { const why = reasonOf(run); return { kind: 'failed', at: iso(run.endedAt) || iso(run.startedAt), text: why ? `${title} — ${why}` : title, tone: st === 'failed' ? 'error' : 'attention', improvementId, sha: '' }; }
    return { kind: 'started', at: iso(run.startedAt), text: title, tone: st && LIVE_STATES.includes(st) ? 'active' : 'quiet', improvementId, sha: '' };
  });
  const rows = [
    { kind: 'made', at: iso(copy.createdAt), text: fill(WORDS.copy.made, { sha: str(copy.baseSha).slice(0, 7) }), tone: 'quiet', improvementId: null, sha: str(copy.baseSha) },
    ...tries,
    ...(Array.isArray(copy.ships) ? copy.ships : []).filter(isRecord).map(s => ({ kind: 'shipped', at: iso(s.at), text: fill(WORDS.copy.shipped, { n: Array.isArray(s.runIds) ? s.runIds.length : 0 }), tone: 'pass', improvementId: null, sha: str(s.sha) })),
    ...catchUps.map(rec => rec.ok === true
      ? { kind: 'caught_up', at: iso(rec.at), text: WORDS.copy.caughtUp, tone: 'pass', improvementId: null, sha: str(rec.to) }
      : { kind: 'catch_up_failed', at: iso(rec.at), text: catchWhy(rec), tone: 'error', improvementId: null, sha: '' }),
  ];

  const detail = [
    state !== 'building' && counts.building ? `${counts.building} building` : '',
    state !== 'waiting' && counts.waiting ? c.badge.text : '',
    counts.in ? `${counts.in} in` : '', counts.failed ? `${counts.failed} failed` : '',
    state !== 'up_next' && counts.upNext ? `${counts.upNext} up next` : '',
    state !== 'behind' && behind ? 'behind main' : '',
  ].filter(Boolean);
  return {
    vm: {
      id: name, name, kind: 'copy', copyId, branch: str(copy.branch) || COPY.branchPrefix + name, line: WORDS.copy.line, autoInto: autoInto(ctx, copyId),
      word, state, tone: COPY_STATE_TONES[state], live: COPY_LIVE.includes(state),
      note: ahead ? fill(WORDS.copy.lineAhead, { ahead }) : WORDS.copy.line,
      count: [counts.in ? `${counts.in} in` : '', counts.failed ? `${counts.failed} failed` : '', running ? WORDS.copy.playing : ''].filter(Boolean).join(' · '),
      detail: [...new Set(detail)].join(' · '), copyLine: fill(WORDS.copy.copyLine, { ahead, behind }),
      ahead, behind, head, status: phase, health, healthWords, verified, checks,
      madeAt: iso(copy.createdAt), madeFrom: { branch: str(copy.base) || MAIN, sha: str(copy.baseSha) },
      badge: c.badge, attention: attentionOf(c.badge), counts, play, check: { ...ctx.check }, github: ctx.github,
      improvements: c.improvements, settled: c.settled, list: ctx.list, blocked, ship, catchUp, retire,
      history: history(rows), copies: [],
    },
    byState: c.byState,
  };
}

/** Every build of the project, from one read of the input: main first, then the live copies oldest first. */
function buildsOf(ctx, records, full) {
  const live = records.filter(rec => !rec.held);
  const partial = ctx.copies.map(copy => ({ copyId: copy.id, name: copy.name, play: { running: isRecord(copy.play) && copy.play.running === true } }));
  const copies = ctx.copies.map(copy => copyVM(ctx, copy, live.filter(rec => rec.copyId === copy.id), records, partial));
  const main = mainVM(ctx, live.filter(rec => rec.build === MAIN), copies.map(x => x.vm), full);
  return { main, copies };
}

/** The builds card's badge (CARD_BADGE): improvement rows count improvements across every build by state,
    copy rows count copies by headline ({name} for one). */
function cardBadgeOf(byState, copies) {
  for (const [kind, state, one, many, tone] of CARD_BADGE) {
    if (kind === 'improvement') { const n = byState[state] || 0; if (n) return { text: fill(n === 1 ? one : many, { n }), tone }; }
    else { const hit = copies.filter(b => b.state === state); if (hit.length) return { text: fill(hit.length === 1 ? one : many, { n: hit.length, name: hit[0].name }), tone }; }
  }
  return { text: '', tone: 'quiet' };
}

/** The bar's builds card (BUILDS-AS-COPIES §4.2): main, then every live copy; the card's badge across them;
    the project's attention; and what + New build says. */
export function buildsCard(input) {
  const ctx = contextOf(input);
  const { main, copies } = buildsOf(ctx, placed(ctx), true);
  const builds = [main.vm, ...copies.map(x => x.vm)];
  const byState = Object.fromEntries(STATES.map(state => [state, [main, ...copies].reduce((n, x) => n + (x.byState[state] || 0), 0)]));
  const badge = cardBadgeOf(byState, builds.slice(1));
  const buildingRow = CARD_BADGE.find(row => row[0] === 'improvement' && row[1] === 'building');
  const attention = ATTENTION_TONES.includes(badge.tone) ? { ...badge }
    : byState.building ? { text: fill(byState.building === 1 ? buildingRow[2] : buildingRow[3], { n: byState.building }), tone: 'active' } : { text: '', tone: 'quiet' };
  const taken = ctx.copies.map(copy => copy.name);
  const why = ctx.disabled === 'github' ? fill(WORDS.copy.githubMode, { project: ctx.name || 'this project' }) : ctx.disabled === 'no_check' ? WORDS.copy.noCheck : '';
  const blocked = ctx.demo ? WORDS.demoChange : why || (!ctx.copiesRead ? WORDS.reading : taken.length >= ctx.limit ? WORDS.copy.tooMany : '');
  return { builds, badge, attention, newCopy: { blocked, why, suggested: nextCopyName(taken), taken, limit: ctx.limit } };
}

/** One build's page: 'main' or a copy's name. null: no live copy has that name (retired, or not read yet). */
export function buildOf(input, name) {
  const wanted = str(name) || MAIN;
  return buildsCard(input).builds.find(b => b.id === wanted) ?? null;
}

/** Main alone (phase 1's call, kept): it holds only main's improvements. An input with no `copies` key (a
    phase-1 caller) gets phase 1's blocked and play objects; with one, it is buildsCard(input).builds[0]. */
export function buildMain(input) {
  const ctx = contextOf(input);
  return buildsOf(ctx, placed(ctx), isRecord(input) && Object.hasOwn(input, 'copies')).main.vm;
}

/* ------------------------------------------------------------------------------------------ the ticket */

function stepsOf(run) {
  const s = status(run), make = (install, work, check, stage) => [['install', install], ['work', work], ['check', check], ['stage', stage]].map(([name, st]) => ({ name, label: STEP_LABELS[name], state: st }));
  if (s === 'queued') return make('waiting', 'waiting', 'waiting', 'waiting');
  if (s === 'installing' || s === 'preparing') return make('running', 'waiting', 'waiting', 'waiting');
  if (s === 'running' || s === 'awaiting_input') return make('done', 'running', 'waiting', 'waiting');
  if (s === 'verifying' || s === 'checking') return make('done', 'done', 'running', 'waiting');
  if (s === 'merging') return make('done', 'done', 'done', 'running');
  if (s === 'staged' || s === 'merged') return make('done', 'done', 'done', 'done');
  if (s === 'failed') return run.verification?.status === 'failed' ? make('done', 'done', 'failed', 'waiting') : make('done', 'failed', 'waiting', 'waiting');
  // interrupted · cancelled · discarded · superseded: which step was running is unknown. What the record
  // proves stays done — a commit means the work and its check ran (fixer.ts:250-260), a diffstat after it
  // that it was staged — and the rest waits.
  const committed = !!str(run.commitSha), staged = committed && !!str(run.diffstat) && (s === 'discarded' || s === 'superseded');
  return committed ? make('done', 'done', 'done', staged ? 'done' : 'waiting') : make('waiting', 'waiting', 'waiting', 'waiting');
}
function githubChecksOk(checks) {
  const st = str(checks?.status);
  if (st === 'passed') return true;
  if (st === 'failed' || (Array.isArray(checks?.blockers) && checks.blockers.some(b => /failure|cancelled|timed_out|action_required/.test(str(b))))) return false;
  return null;
}
function checksOf(run) {
  const v = isRecord(run.verification) ? run.verification : {};
  const list = [{ name: str(v.command) || 'the project check', ok: v.status === 'passed' ? true : v.status === 'failed' ? false : null, note: firstLine(v.detail, 160) }];
  if (run.github?.mode === 'github') {
    const blockers = Array.isArray(run.github.checks?.blockers) ? run.github.checks.blockers.map(str).filter(Boolean) : [];
    list.push({ name: 'github checks', ok: githubChecksOk(run.github.checks), note: blockers[0] || '' });
  }
  return list;
}
function githubOf(run) {
  const g = run.github;
  if (!isRecord(g) || (g.mode !== 'github' && !g.delivery)) return null;
  const pr = isRecord(g.pr) ? g.pr : null, receipt = isRecord(run.remoteMerge) ? run.remoteMerge : null;
  const number = Number.isSafeInteger(pr?.number) ? pr.number : Number.isSafeInteger(receipt?.prNumber) ? receipt.prNumber : Number.isSafeInteger(receipt?.pr) ? receipt.pr : null;
  return {
    mode: g.mode === 'github' ? 'github' : 'local', delivery: str(g.delivery), prNumber: number,
    prUrl: safeUrl(pr?.url) || safeUrl(receipt?.prUrl) || safeUrl(receipt?.url), draft: pr?.draft === true,
    toPush: g.toPush === true, pullRequest: g.pullRequest === true, readyPR: g.readyPR === true, needsAttention: g.needsAttention === true, remoteChanged: g.remoteChanged === true,
    checks: { status: str(g.checks?.status) || 'unknown', blockers: Array.isArray(g.checks?.blockers) ? g.checks.blockers.map(str).filter(Boolean) : [] },
    notice: str(g.notice), baseBranch: str(g.baseBranch) || str(receipt?.baseBranch) || null,
  };
}
function activityOf(run) {
  const lines = str(run.currentActivity).replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return cut(lines[lines.length - 1] || '', 120);
}
function attemptOf(run, n, ctx = null) {
  const state = runState(run, ctx), s = status(run), live = state !== null && LIVE_STATES.includes(state);
  const shown = state ?? 'stopped';
  const word = state ? STATE_WORDS[state] : s === 'superseded' ? 'replaced' : (s.replace(/_/g, ' ') || 'unknown');
  const files = parseDiffstat(run.diffstat), github = githubOf(run);
  const tabs = ['log', ...(files.count || str(run.commitSha) ? ['changes'] : []), ...(github || githubRun(run) ? ['github'] : [])];
  const initialTab = (GITHUB_STATES.has(state) || (state === 'ready' && githubRun(run))) && tabs.includes('github') ? 'github'
    : ['ready', 'landing', 'waiting_to_land', 'in', 'discarded'].includes(state) && tabs.includes('changes') ? 'changes' : 'log';
  const preview = isRecord(run.preview) ? { running: run.preview.running === true, url: str(run.preview.url) || null } : null;
  return {
    runId: run.id, n, status: str(run.status), state: shown, word, tone: state ? STATE_TONES[state] : 'quiet', live,
    // a copy's try says the copy's name as its target (nibbi/copy/dev is the daemon's)
    title: str(run.title) || firstLine(run.issue), branch: str(run.branch),
    target: (str(run.copyId) && ctx ? ctx.copyNames.get(run.copyId) : '') || str(run.targetBranch) || str(run.github?.baseBranch),
    // a landing try pulses (it is landing) but its work has ended: only a try still at work has no end yet
    sha: str(run.commitSha).slice(0, 7), startedAt: iso(run.startedAt) || str(run.startedAt), endedAt: ['building', 'up_next', 'needs_you'].includes(state) ? null : iso(run.endedAt),
    costUsd: Number.isFinite(run.costUsd) ? run.costUsd : null,
    summary: ['failed', 'interrupted', 'stopped'].includes(state) ? '' : str(run.summary),
    reason: ['failed', 'interrupted', 'stopped'].includes(state) ? reasonOf(run) : '',
    activity: state === 'building' ? activityOf(run) : '', steps: stepsOf(run), checks: checksOf(run), files, github, preview,
    allowedActions: Array.isArray(run.allowedActions) ? run.allowedActions.filter(a => typeof a === 'string') : null,
    tabs, initialTab, attemptId: str(run.attemptId) || null,
  };
}

const START_ACTIONS = new Set(['startImprovement', 'buildIssue', 'retryRun']);
const LIST_ACTIONS = new Set(['queueImprovement', 'editImprovement', 'completeImprovement', 'reopenImprovement', 'buildIssue']);
/** §5.2: the words a key says when it can't go now, before anything about the run itself. */
function gate(ctx, action, payload) {
  const inDemo = REFUSED_IN_DEMO.includes(action) && !(action === 'previewRun' && payload?.action === 'open');
  if (ctx.demo && inDemo) return START_ACTIONS.has(action) ? WORDS.demoStart : ['previewRun', 'playMain', 'playCopy'].includes(action) ? WORDS.demoPlay : WORDS.demoChange;
  if (LIST_ACTIONS.has(action) && (ctx.list !== 'ready' || !ctx.revision)) return WORDS.noList;
  return '';
}
function key(ctx, action, label, cpKey, payload, { tone = 'seated', confirm = null, opens = null, blocked = '', tab } = {}) {
  const vm = { action, label, tone, payload, confirm, blocked: gate(ctx, action, payload) || blocked, key: cpKey, opens };
  if (tab) vm.tab = tab;
  return vm;
}

function statusLineOf(ctx, rec, attempts) {
  const { state } = rec.vm, basis = attempts.find(a => a.runId === rec.basis?.id) || null, run = rec.basis;
  // the build it lives in, by name: main, or the copy ("dev is unchanged")
  const where = rec.build;
  if (rec.copyId) {
    if (state === 'landing') return fill(WORDS.copy.landing, { name: where });
    // waiting on the copy: its preview plays (the words say so), or a ship or catch-up holds it a moment
    if (state === 'waiting_to_land') return run?.landing?.reason === 'busy' ? fill(WORDS.copy.landing, { name: where }) : fill(WORDS.copy.waitingToLand, { name: where });
    if (state === 'in') return fill(WORDS.copy.inCopy, { name: where, when: since(landedAt(run), ctx.now) || 'just now' });
  }
  if (rec.shippedFrom && state === 'in') return fill(WORDS.copy.shippedFrom, { name: rec.shippedFrom, when: since(run?.shipped?.at || landedAt(run), ctx.now) || 'just now' });
  if (rec.retiredFrom && state === 'discarded') return fill(WORDS.copy.retiredBefore, { name: rec.retiredFrom });
  if (state === 'up_next') {
    if (rec.fromIssue) {
      // automation picks it up, unless it already tried it since it was turned on (a try you stopped or discarded waits for you)
      const into = autoInto(ctx, rec.copyId), tried = !!ctx.auto.onAt && rec.tries.some(r => (iso(r.startedAt) || '') >= ctx.auto.onAt);
      return into && !tried ? fill(WORDS.upNextAuto, { name: into }) : 'it waits here until you start it — nothing builds it on its own';
    }
    return ctx.maxConcurrent === 1 ? 'queued — it starts when its one slot frees' : `queued — it starts when one of the ${ctx.maxConcurrent} slots frees`;
  }
  if (state === 'building') {
    const doing = basis?.activity || ({ installing: 'installing', preparing: 'installing', running: 'doing the work', verifying: 'running the checks', checking: 'running the checks', merging: 'merging' })[status(run)] || 'building';
    const took = span(ctx.now - ms(run.latestAttemptStartedAt || run.startedAt));
    return [doing, took && `${took} in`, basis && `try ${basis.n}`].filter(Boolean).join(' · ');
  }
  if (state === 'needs_you') return 'it stopped to ask you something — guide it, or stop it';
  const gh = basis?.github, pr = gh?.prNumber ? `pull request #${gh.prNumber}` : 'its pull request';
  if (state === 'needs_attention') return gh?.notice || `${pr} needs a look${gh?.checks.blockers[0] ? ' — ' + gh.checks.blockers[0] : ''}`;
  if (state === 'pr_ready') return `${pr} is ready to merge — it merges on GitHub`;
  if (state === 'pull_request') return `${pr} is open — it merges on GitHub`;
  if (state === 'to_push') return 'checks passed here — push it to open a pull request';
  if (state === 'ready') {
    if (githubRun(run)) return 'pushed — open a pull request from its github steps';
    // "play it" only where there is something to play: a try whose worktree has no play command has no play key
    const known = Array.isArray(basis?.allowedActions), playable = !known || basis.preview?.running === true || basis.allowedActions.some(a => a === 'preview.start' || a === 'preview.stop');
    if (run.verification?.status === 'passed') return `checks passed${basis?.sha ? ' on ' + basis.sha : ''} — ${playable ? 'play it, then merge it or discard it' : 'merge it or discard it'}`;
    return ctx.check.real ? 'not verified — verify it before it can merge' : WORDS.noCheck;
  }
  if (state === 'in') {
    if (gh?.delivery === 'merged') return `merged into ${gh.baseBranch || basis.target || ctx.branch} via ${pr}`;
    if (gh && gh.mode === 'local' && gh.delivery.startsWith('local_merge')) return 'merged here — not on GitHub yet';
    const when = since(landedAt(run), ctx.now);
    return [`in ${MAIN}${when ? ' since ' + when : ''}`, basis && `landed with try ${basis.n}`].filter(Boolean).join(' · ');
  }
  if (state === 'failed') return `${rec.vm.reason || 'it failed'} — ${where} is unchanged`;
  if (state === 'interrupted') return 'the backend stopped mid-run — its work is kept; try again when you’re ready';
  if (state === 'stopped') return `you stopped it — ${where} is unchanged`;
  if (state === 'discarded') return 'you discarded it — its branch and worktree are kept';
  if (state === 'done') return 'marked done in issues.md';
  return '';
}

/** §4.5 and §5.2: the ticket's keys, in order, at most one ink. */
function actionsOf(ctx, rec, attempts) {
  const { state } = rec.vm, keys = [], add = vm => { keys.push(vm); return vm; };
  const latest = attempts.find(a => a.runId === rec.basis?.id) || attempts[attempts.length - 1] || null;
  const runId = latest?.runId, allowed = latest?.allowedActions ?? null, known = Array.isArray(allowed);
  const may = name => known && allowed.includes(name);
  // a copy's try says the copy's name: "dev is unchanged"
  const target = (rec.copyId && rec.build) || latest?.target || ctx.branch, title = rec.vm.title, ask = () => add(key(ctx, 'talkAbout', WORDS.keys.ask, 'ask', { improvementId: rec.id }));
  const gated = (name, action, label, cpKey, payload, opts = {}) => {   // drawn only when the run allows it; null → drawn, waiting on the read
    if (known && !may(name)) return null;
    return add(key(ctx, action, label, cpKey, payload, { ...opts, blocked: known ? opts.blocked || '' : WORDS.reading }));
  };
  // a try on a copy that was retired can't be tried again there (the daemon refuses it)
  const retry = () => add(key(ctx, 'retryRun', WORDS.keys.retry, 'retry', { runId }, { tone: 'ink', blocked: rec.retiredFrom ? fill(WORDS.copy.retiredBefore, { name: rec.retiredFrom }) : '' }));
  const stop = () => add(key(ctx, 'stopRun', WORDS.keys.stop, 'stop', { runId }, { confirm: { words: fill(WORDS.confirm.stop, { n: latest?.n ?? 1, branch: target }), yes: WORDS.keys.stopYes, no: WORDS.keys.stopNo, armed: true } }));
  const discard = (words = WORDS.confirm.discard) => gated('run.discard', 'discardRun', WORDS.keys.discard, 'discard', { runId }, { confirm: { words: fill(words, { title, n: latest?.n ?? 1 }), yes: WORDS.keys.discardYes, no: WORDS.keys.keep, armed: true } });
  const unverified = latest && latest.checks[0]?.ok !== true;
  // the issue's own keys: its words and its checkbox in issues.md, whatever its last try did
  const openItem = rec.kind === 'issue' && !!rec.item && rec.item.done !== true;
  const itemKeys = () => {
    add(key(ctx, 'editImprovement', WORDS.keys.edit, 'edit', { issueId: rec.issueId, title: str(rec.item.text) || title, description: str(rec.item.description), revision: ctx.revision }, { opens: 'form' }));
    add(key(ctx, 'completeImprovement', WORDS.keys.markDone, 'mark-done', { issueId: rec.issueId }));
  };

  if (state === 'up_next' && rec.fromIssue && rec.item) {
    itemKeys();
    add(key(ctx, 'buildIssue', WORDS.keys.buildNow, 'build-now', rec.copyId ? { issueId: rec.issueId, copyId: rec.copyId } : { issueId: rec.issueId }, { tone: 'ink' }));
  } else if (state === 'up_next' && runId) {
    add(key(ctx, 'stopRun', WORDS.keys.cancelQueued, 'cancel', { runId }));
  } else if (state === 'building' || state === 'needs_you') {
    gated('run.steer', 'steerRun', WORDS.keys.guide, 'guide', { runId, text: '' }, { opens: 'form', tone: state === 'needs_you' ? 'ink' : 'seated' });
    stop();
  } else if (state === 'landing') {
    // a copy's try lands on its own once its checks pass: nothing to approve (D5) — play it while it does, or put it away
    const playing = latest?.preview?.running === true || may('preview.stop'), previewable = playing || may('preview.start');
    if (!known) add(key(ctx, 'previewRun', WORDS.keys.playRun, 'play-run', { runId, action: 'start' }, { tone: 'ink', blocked: WORDS.reading }));
    else if (playing) {
      add(key(ctx, 'previewRun', WORDS.keys.open, 'open-run', { runId, action: 'open' }, { tone: 'ink' }));
      add(key(ctx, 'previewRun', WORDS.keys.stopPlaying, 'stop-playing', { runId, action: 'stop' }));
    } else if (previewable) add(key(ctx, 'previewRun', WORDS.keys.playRun, 'play-run', { runId, action: 'start' }, { tone: 'ink' }));
    discard(openItem ? WORDS.confirm.discardTry : WORDS.confirm.discard);
  } else if (state === 'waiting_to_land') {
    // it lands when its copy stops playing: stopping it is the one thing to do
    if (rec.copyId) add(key(ctx, 'playCopy', fill(WORDS.copyKeys.stopPlayingCopy, { name: rec.build }), 'stop-playing-copy', { copyId: rec.copyId, action: 'stop' }, { tone: 'ink' }));
    discard(openItem ? WORDS.confirm.discardTry : WORDS.confirm.discard);
  } else if (state === 'ready' && !githubRun(rec.basis)) {
    const playing = latest?.preview?.running === true || may('preview.stop'), previewable = playing || may('preview.start');
    if (!known) add(key(ctx, 'previewRun', WORDS.keys.playRun, 'play-run', { runId, action: 'start' }, { tone: 'ink', blocked: WORDS.reading }));
    else if (playing) {
      add(key(ctx, 'previewRun', WORDS.keys.open, 'open-run', { runId, action: 'open' }, { tone: 'ink' }));
      add(key(ctx, 'previewRun', WORDS.keys.stopPlaying, 'stop-playing', { runId, action: 'stop' }));
    } else if (previewable) add(key(ctx, 'previewRun', WORDS.keys.playRun, 'play-run', { runId, action: 'start' }, { tone: 'ink' }));
    const mergeBlocked = !known ? WORDS.reading : !ctx.check.real ? WORDS.noCheck : unverified ? WORDS.unverified : !may('run.merge') ? WORDS.cantMerge : '';
    add(key(ctx, 'mergeRun', WORDS.keys.merge, 'merge', { runId }, { tone: known && !previewable ? 'ink' : 'seated', blocked: mergeBlocked,
      confirm: { words: fill(WORDS.confirm.merge, { title, branch: target }), yes: WORDS.keys.mergeYes, no: WORDS.keys.cancel, armed: false } }));
    discard();
    if (unverified) gated('run.verify', 'verifyRun', WORDS.keys.verify, 'verify', { runId });
  } else if (state === 'ready' || GITHUB_STATES.has(state)) {
    if (latest?.tabs.includes('github')) add(key(ctx, 'buildEvidence', WORDS.keys.github, 'github-steps', { id: runId, kind: 'github', attemptId: latest.attemptId ?? undefined }, { tone: 'ink', tab: 'github' }));
    discard();
  } else if (state === 'in') {
    if (latest?.tabs.includes('changes')) add(key(ctx, 'buildEvidence', WORDS.keys.changes, 'see-changes', { id: runId, kind: 'changes', attemptId: latest.attemptId ?? undefined }, { tab: 'changes' }));
  } else if (state === 'failed' || state === 'interrupted') {
    // try again is not the only way out: a failed try can be put away (the issue goes back to up next,
    // a free-text one to settled), and an issue can be reworded or closed without another try
    ask();
    if (unverified && may('run.verify')) add(key(ctx, 'verifyRun', WORDS.keys.verify, 'verify', { runId }));
    if (openItem) itemKeys();
    if (runId) discard(openItem ? WORDS.confirm.discardTry : WORDS.confirm.discardFailed);
    if (runId) retry();
  } else if (state === 'stopped' || state === 'discarded') {
    if (runId) retry();
  } else if (state === 'done' && rec.issueId && rec.item) {
    add(key(ctx, 'reopenImprovement', WORDS.keys.reopen, 'reopen', { issueId: rec.issueId }));
  }
  let ink = false;
  for (const vm of keys) if (vm.tone === 'ink') { if (ink) vm.tone = 'seated'; ink = true; }
  return keys;
}

function factsOf(ctx, rec, attempts) {
  const latest = attempts.find(a => a.runId === rec.basis?.id) || attempts[attempts.length - 1] || null;
  const live = latest && ['building', 'needs_you'].includes(latest.state) ? latest : null;   // a landing try has finished its work
  let time = 'not started';
  if (live) time = `running ${span(ctx.now - ms(rec.basis?.latestAttemptStartedAt || rec.basis?.startedAt)) || 'just now'}`;
  else {
    const spans = attempts.map(a => ms(a.endedAt) - ms(a.startedAt)).filter(d => Number.isFinite(d) && d >= 0);
    if (spans.length) time = span(spans.reduce((sum, d) => sum + d, 0));
  }
  const f = latest?.files;
  const changes = f && f.count ? `${plural(f.count, 'file')} · +${f.add} −${f.del}` : latest?.sha ? 'no files listed' : 'none yet';
  let checks = 'not run yet';
  if (latest) {
    const [own, gh] = latest.checks;
    checks = own.ok === true ? 'passed' : own.ok === false ? 'failed' : ctx.check.real ? 'not verified' : 'no check set';
    if (gh) checks += ` · github ${gh.ok === true ? 'passed' : gh.ok === false ? 'failed' : latest.github?.checks.status === 'not_configured' ? 'not set up' : latest.github?.checks.status === 'blocked' ? 'waiting' : 'not read yet'}`;
  }
  const root = rec.tries[0];
  return [
    { label: 'build', value: rec.build || MAIN, key: 'fact-build' },
    { label: 'asked', value: rec.kind === 'issue' ? 'from issues.md' : ago(root?.startedAt, ctx.now) || 'unknown' },
    { label: 'tries', value: attempts.length ? String(attempts.length) : 'none yet' },
    { label: 'time', value: time },
    { label: 'changes', value: changes },
    { label: 'checks', value: checks },
  ];
}
function linksOf(item) {
  const out = [];
  for (const link of Array.isArray(item?.githubIssueLinks) ? item.githubIssueLinks : []) {
    const url = safeUrl(link?.url) || safeUrl(link?.htmlUrl);
    if (!url || !Number.isSafeInteger(Number(link.number))) continue;
    out.push({ label: `GitHub issue · ${str(link.repository) || 'github'} #${Number(link.number)}`, url });
  }
  return out;
}

function ticketFrom(ctx, rec) {
  const attempts = rec.tries.map((run, i) => attemptOf(run, i + 1, ctx)), root = rec.tries[0];
  const copy = rec.copyId ? ctx.liveById.get(rec.copyId) : null;
  const words = rec.item ? { text: str(rec.item.text) || rec.title, description: str(rec.item.description) } : (() => {
    try { const split = splitImprovementText(root?.issue); return { text: split.title, description: split.description }; }
    catch { return { text: rec.title, description: '' }; }
  })();
  const context = str(rec.latest?.context) || str(root?.context);
  return {
    improvement: rec.vm, build: rec.build || MAIN, buildKind: copy ? 'copy' : 'main', copyId: copy ? copy.id : null,
    branch: copy ? str(copy.branch) || COPY.branchPrefix + copy.name : ctx.branch,
    statusLine: statusLineOf(ctx, rec, attempts), facts: factsOf(ctx, rec, attempts),
    asked: { ...words, context, at: rec.kind === 'run' ? iso(root?.startedAt) : null, source: rec.kind },
    attempts, actions: actionsOf(ctx, rec, attempts), links: linksOf(rec.item), gone: false,
  };
}
function goneTicket(ctx, id, words = WORDS.gone) {
  const kind = id.startsWith(ID_PREFIX.run) ? 'run' : 'issue', issueId = kind === 'issue' && id.startsWith(ID_PREFIX.issue) ? id.slice(ID_PREFIX.issue.length) : null;
  const improvement = { id, kind, title: '', state: 'done', word: STATE_WORDS.done, tone: STATE_TONES.done, live: false, group: 'settled', context: '',
    when: null, reason: '', issueId, runIds: [], latestRunId: null, order: 0, build: MAIN };
  return { improvement, build: MAIN, buildKind: 'main', copyId: null, branch: ctx.branch, statusLine: words, facts: [], asked: { text: '', description: '', context: '', at: null, source: kind },
    attempts: [], actions: [], links: [], gone: words === WORDS.gone };
}

/** The ticket page for one improvement (§2.2.1, §4.5), in the build it lives in. An issue whose note left
    issues.md while runs still name it renders from those runs; one the unread list can't find yet — or
    whose copy the client has not read yet — waits in words. */
export function ticketOf(input, id) {
  const ctx = contextOf(input), wanted = str(id);
  const records = placed(ctx), found = records.find(rec => rec.id === wanted);
  const reading = () => {
    const waiting = goneTicket(ctx, wanted, WORDS.reading);
    Object.assign(waiting.improvement, { state: 'up_next', word: STATE_WORDS.up_next, tone: STATE_TONES.up_next, group: 'up_next' });
    return waiting;
  };
  if (found?.held) return reading();
  if (found) { ordered(records.filter(rec => !rec.held && rec.build === found.build)); return ticketFrom(ctx, found); }
  if (wanted.startsWith(ID_PREFIX.issue)) {
    const issueId = wanted.slice(ID_PREFIX.issue.length);
    const gone = issueId && placed(ctx, issueId).find(rec => rec.id === wanted && rec.gone);
    if (gone?.held) return reading();
    if (gone) return ticketFrom(ctx, gone);
    if (issueId && ctx.list !== 'ready') {
      // Not read yet (or unreadable): it may well exist. The page says so rather than "gone".
      const waiting = goneTicket(ctx, wanted, ctx.list === 'loading' ? WORDS.reading : WORDS.noList);
      Object.assign(waiting.improvement, { state: 'up_next', word: STATE_WORDS.up_next, tone: STATE_TONES.up_next, group: 'up_next' });
      return waiting;
    }
  }
  return goneTicket(ctx, wanted);
}

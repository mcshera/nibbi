/** The control panel's two pages (docs/CONTROL-PANEL.md §2.2, §5 and §6.4 bind for phase 1, and
 *  docs/BUILDS-AS-COPIES.md §4.4 for phase 2; the lab's round five Console,
 *  design/sidebar-lab/options/tree-console.mjs, is the look):
 *
 *    the build page   main: live · what ships — the preview card with play main, three tiles, the
 *                     improvements grouped the one way the bar groups them, its copies, and what landed
 *                     in it. A copy (dev, dev1 …): its headline, "copy of main · N ahead · M behind",
 *                     Ship to main as the confirmed step on the page (what ships, the checks, then yes),
 *                     the preview (one plays at a time), tiles with catch up, its improvements, its
 *                     history and a quiet retire. A copy that is gone keeps only its ×.
 *    the ticket page  one improvement: a big status (its word, the one fact that explains it, its keys
 *                     and a strip of facts), then every try as a card on a run log (steps on a rail,
 *                     checks beside them, the log, the changes and GitHub as tabs), then what you asked.
 *
 *  It draws view models (control-panel-contract.js BuildVM / TicketVM, made by builds-model.js) and
 *  sends every choice as onAction(name, projectId, value). It computes no state of its own beyond what
 *  a page holds open: a confirm (on a copy: the ship panel, the catch-up question or the retire strip —
 *  one at a time), a form and its words, which tries are open, each try's tab, and the
 *  evidence it has read (the log, the diff). An update redraws in place and keeps all of that, the
 *  scroll and the focus; a loaded log or diff is the same node across updates, so a selection, an
 *  open entry and the live tail survive a record refresh.
 *
 *  The Log renderer and the evidence tabs are moved here from project-workspace.js (logList and the
 *  painting half of buildEvidence), not copied: the lobby they belonged to goes in phase 1. */
import { WORDS, GROUPS, PAGE_LIMITS, REFUSED_IN_DEMO, MAIN } from './control-panel-contract.js';
import { createGithubPanel } from './github-ui.js';
import { describeToolEvent, inputLine, eventToLogEntry } from './transcript.js';

/* ------------------------------------------------------------------------------------------ dom */
const SVG_NS = 'http://www.w3.org/2000/svg';
const GLYPHS = {
  trunk: ['M12 3v5.25', 'M12 15.75V21', 'M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z'],
  branch: ['M6 3v12.5', 'M20.5 6a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z', 'M8.5 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z', 'M18 8.5a9.5 9.5 0 0 1-9.5 9.5'],
  pull: ['M12 4v11', 'm7.5 10.5 4.5 4.5 4.5-4.5', 'M6 20h12'],
  play: ['M8 5.5v13l10.5-6.5L8 5.5Z'],
  stop: ['M7 7h10v10H7z'],
  retry: ['M4 12a8 8 0 1 0 2.4-5.7', 'M4 4v4.5h4.5'],
  out: ['M14 5h5v5', 'm19 5-8 8', 'M17 14v5H5V7h5'],
  chevron: ['m9 6 6 6-6 6'],
  plus: ['M12 5v14M5 12h14'],
  pencil: ['m4 20 .8-3.4L15.6 5.8a2 2 0 0 1 2.8 0l.8.8a2 2 0 0 1 0 2.8L8.4 19.2 5 20Z'],
  thread: ['M4 5h16v10H9l-5 4V5Z'],
};
function node(tag, cls, text) { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; }
function glyph(kind, cls = 'cp-icon') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', cls); svg.dataset.glyph = kind;
  for (const d of GLYPHS[kind] || []) { const p = document.createElementNS(SVG_NS, 'path'); p.setAttribute('d', d); svg.append(p); }
  return svg;
}
function button(cls, key) { const b = node('button', cls); b.type = 'button'; if (key) b.dataset.cpKey = key; return b; }
/** A state word: the words carry the state, and only pass / error take colour (machine verdicts). */
function word(text, tone = 'quiet', { live = false, cls = '' } = {}) { const el = node('span', `cp-page-word ${cls}`.trim(), text); el.dataset.tone = tone || 'quiet'; if (live) el.classList.add('cp-page-live'); return el; }
/** A circle is a living thing or its state (LANGUAGE §5.2); it sits beside a word, never replaces one. */
function dot(tone = 'quiet', live = false) { const d = node('span', `cp-dot${live ? ' cp-page-live' : ''}`); d.dataset.tone = tone || 'quiet'; d.setAttribute('aria-hidden', 'true'); return d; }
const mono = value => node('code', 'cp-mono', value);
/** Keep `parent`'s children exactly `nodes`, in order. What goes is removed first, so a node that stays
    is never detached to make room (its focus, its selection and its scroll survive); only a node whose
    order among the ones that stay changed is moved. */
function reconcile(parent, nodes) {
  const list = nodes.filter(Boolean), wanted = new Set(list);
  for (const child of [...parent.childNodes]) if (!wanted.has(child)) child.remove();
  list.forEach((n, i) => { const at = parent.childNodes[i]; if (at !== n) parent.insertBefore(n, at || null); });
}
/** Markdown on a page: nibbi's own markers in issues.md (`<!-- nibbi-issue:… -->`) are not the owner's words. */
const displayMarkdown = text => String(text || '').replace(/<!--\s*nibbi-(?:task|issue|milestone|current-milestone|status)\b[\s\S]*?-->/g, '').trim();
function markdownInto(el, text, renderMarkdown) { const clean = displayMarkdown(text); if (renderMarkdown) el.append(renderMarkdown(clean)); else el.textContent = clean; return el; }
const safeUrl = href => { try { const url = new URL(href); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };

/* ------------------------------------------------------------------------------------------ time, said against model.now */
const toMs = value => { const t = typeof value === 'number' ? value : Date.parse(value); return Number.isFinite(t) ? t : NaN; };
/** "just now" · "6m" · "2h" · "3d" · "2w" (the bar's scale, margin-ui.js). */
function since(value, now) {
  const t = toMs(value);
  if (!Number.isFinite(t) || !Number.isFinite(now)) return '';
  const s = Math.max(0, (now - t) / 1000);
  if (s < 90) return 'just now';
  for (const [unit, size, below] of [['m', 60, 60], ['h', 3600, 24], ['d', 86400, 7]]) { const n = Math.floor(s / size); if (n < below) return n + unit; }
  return Math.floor(s / 604800) + 'w';
}
function ago(value, now) { const s = since(value, now); return !s ? '' : s === 'just now' ? s : `${s} ago`; }
/** A span, spoken: "38s" · "4m 12s" · "1h 4m" · "2d 3h". */
function duration(from, to) {
  const a = toMs(from), b = toMs(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return '';
  const s = Math.max(0, Math.round((b - a) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) { const m = Math.floor(s / 60), r = s % 60; return r ? `${m}m ${String(r).padStart(2, '0')}s` : `${m}m`; }
  if (s < 86400) { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return m ? `${h}h ${m}m` : `${h}h`; }
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600); return h ? `${d}d ${h}h` : `${d}d`;
}
const pad = n => String(n).padStart(2, '0');
function clock(value) { const t = toMs(value); if (!Number.isFinite(t)) return ''; const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
/** "today 16:48" · "yesterday 09:10" · "12 sep". */
function dayClock(value, now) {
  const t = toMs(value);
  if (!Number.isFinite(t) || !Number.isFinite(now)) return '';
  const day = x => new Date(x).toDateString();
  if (day(t) === day(now)) return `today ${clock(t)}`;
  if (day(t) === day(now - 86_400_000)) return `yesterday ${clock(t)}`;
  const date = new Date(t);
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const whenText = (when, now) => when ? [when.verb, ago(when.at, now)].filter(Boolean).join(' ') : '';
/** The contract's words, with their {…} filled. */
const fill = (text, values = {}) => String(text ?? '').replace(/\{(\w+)\}/g, (_, k) => values[k] ?? '');
const sha7 = sha => String(sha || '').slice(0, 7);

/* ------------------------------------------------------------------------------------------ the Log, moved from project-workspace.js */
const LOG_INPUT_MAX = 2048;
const clipText = (value, max) => { const text = String(value ?? ''); return text.length > max ? text.slice(0, max - 1) + '…' : text; };
const boundedInput = input => { if (input == null) return ''; if (typeof input !== 'object') return clipText(input, LOG_INPUT_MAX); let json = ''; try { json = Object.keys(input).length > 1 ? JSON.stringify(input, null, 1) : ''; } catch { json = ''; } return clipText(json || inputLine(input), LOG_INPUT_MAX); };
const logKindLabel = { 'tool.attempted': 'attempt', 'process.output': 'output', 'text.delta': 'text', 'run.updated': 'run', 'run.started': 'run', 'run.finished': 'run', 'turn.steered': 'steer', 'run.steered': 'steer', 'verification.finished': 'checks', 'web.searched': 'web', 'web.fetched': 'web', 'mcp.called': 'mcp' };
const entryText = entry => { const text = entry.text ?? entry.message ?? entry.content; if (text != null && text !== '') return String(text); try { return JSON.stringify(entry); } catch { return ''; } };
// A terminal's clock: 24-hour, to the second, so every row's time is the same width.
const timeLabel = value => { const d = new Date(value || ''); return Number.isNaN(d.getTime()) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
/** One Log row. Tool calls carry their friendly label, exact name, bounded input, verdict and diff (the
    chat transcript's shape); other events keep their text. A finished row borrows its started row's
    path for the diff card's head, through `inputs` (a live tail passes the map its list started). */
function logRow(entry, inputs, renderDiff) {
  const li = node('li', 'project-log-entry'), head = node('div', 'project-log-head');
  if (typeof entry !== 'object') { li.dataset.kind = 'text'; head.append(node('span', 'project-log-kind', 'log'), node('span', 'project-log-text', String(entry))); li.append(head); return li; }
  const kind = String(entry.kind || entry.type || ''), tool = /^tool\.(started|finished)$/.test(kind) || entry.phase === 'started' || entry.phase === 'finished';
  li.dataset.kind = kind || 'entry';
  const time = node('time', 'project-log-time', timeLabel(entry.ts || entry.timestamp || entry.at)); if (entry.ts) time.dateTime = String(entry.ts);
  if (tool) {
    const ev = describeToolEvent({ ...entry, phase: entry.phase || (kind === 'tool.finished' ? 'finished' : 'started') });
    li.dataset.phase = ev.phase; if (ev.phase === 'finished') li.dataset.ok = String(ev.ok);
    const badge = node('span', 'project-log-kind', ev.kind); badge.title = kind || ('tool.' + ev.phase);
    head.append(badge, node('span', 'project-log-label', ev.label), node('code', 'project-log-name', ev.name || ''));
    if (ev.phase === 'started') { if (ev.input !== undefined) inputs.set(ev.name, ev.input); }
    else head.append(node('span', 'project-log-verdict', ev.ok ? 'ok' : 'failed'));
    head.append(time); li.append(head);
    const meta = [ev.detail ? clipText(ev.detail.replace(/\s+/g, ' '), 140) : '', ev.elapsedLabel, ev.bytesLabel].filter(Boolean).join(' · ');
    if (meta) li.append(node('div', 'project-log-meta', meta));
    const input = ev.phase === 'started' ? boundedInput(ev.input) : '', result = ev.phase === 'finished' ? ev.detail : '';
    const diff = ev.phase === 'finished' && ev.diff ? ev.diff : '';
    if (input || result || diff) {
      const detail = node('details', 'project-log-detail'); detail.append(node('summary', '', [input ? 'input' : '', result ? (ev.ok ? 'result' : 'error') : '', diff ? 'diff' : ''].filter(Boolean).join(' · ')));
      if (input) detail.append(node('pre', 'project-evidence-code', input));
      if (result) detail.append(node('p', 'project-log-result', result));
      if (diff) {
        const started = inputs.get(ev.name), path = started && typeof started === 'object' && typeof started.path === 'string' ? started.path : '';
        const rendered = renderDiff ? renderDiff({ diff, branch: path || ev.name, target: '' }) : null;
        detail.append(rendered && typeof rendered !== 'string' ? rendered : node('pre', 'project-evidence-code', diff));
      }
      li.append(detail);
    }
  } else {
    head.append(node('span', 'project-log-kind', logKindLabel[kind] || (kind ? kind.split('.').pop() : 'log')), node('span', 'project-log-text', entryText(entry)), time);
    li.append(head);
  }
  return li;
}
function logList(entries, inputs, renderDiff) {
  const list = node('ol', 'project-log cp-terminal');
  list.tabIndex = 0; list.setAttribute('aria-label', 'the log');
  for (const entry of entries) if (entry != null) list.append(logRow(entry, inputs, renderDiff));
  return list;
}
const logEntries = value => value && typeof value === 'object' ? [value.entries, value.data?.entries, value.log].find(Array.isArray) || null : null;
const logText = value => typeof value === 'string' ? value : value && typeof value === 'object' ? [value.entries, value.data?.entries, value.log].find(x => typeof x === 'string') ?? null : null;

/* ------------------------------------------------------------------------------------------ words the pages add */
const FAILED = 'that didn’t go through — try again';
const CONFLICT = 'the list changed — your words are still here; save again';
const TAB_LABELS = { log: 'log', changes: 'changes', github: 'github', summary: 'summary', checks: 'checks' };
const STEP_WORDS = { done: ['done', 'quiet'], running: ['now', 'active'], waiting: ['next', 'quiet'], failed: ['failed', 'error'] };
const STARTS = ['startImprovement', 'buildIssue', 'retryRun'], PLAYS = ['playMain', 'previewRun', 'playCopy'];
const demoWords = action => STARTS.includes(action) ? WORDS.demoStart : PLAYS.includes(action) ? WORDS.demoPlay : WORDS.demoChange;
const WAITING = new Set(GROUPS.find(g => g.id === 'waiting')?.states || []);
// a check not judged yet: still coming while the try runs or GitHub is still checking it; otherwise it never ran
const PENDING_ON_GITHUB = new Set(['to_push', 'pull_request', 'pr_ready', 'needs_attention']);
const unjudged = a => a.live || PENDING_ON_GITHUB.has(a.state) ? 'waiting' : 'not run';
const pageKey = page => `${page?.project ?? ''}\u0000${page?.page ?? ''}\u0000${page?.id ?? ''}`;
const isConflict = r => r?.code === 'REVISION_CONFLICT' || r?.status === 409;
/* phase 2: a copy's page holds at most one question open — the ship panel, the catch-up question (only
   while it plays) or the retire strip — each the key that opened it, and the action its yes sends */
const QUESTION_KEY = { ship: 'ship', 'catch-up': 'catch-up', retire: 'retire' };
const QUESTION_ACTION = { ship: 'shipCopy', 'catch-up': 'catchUpCopy', retire: 'retireCopy' };
const HIST_VERB = { started: 'started', landed: 'landed', failed: 'failed' };
const SEE_MAIN = 'see main';

/** installProjectPages({ host, onAction, renderMarkdown, renderDiff }) → { open, update, close, noteRunEvent, setBusy, snapshot, destroy }
 *  host            div.cp-page-host inside #project-workspace (the frame keeps its head, ×, and Escape)
 *  onAction        (name, projectId, value) → Promise; a rejection or { ok: false } is said on the page
 *  renderMarkdown  (text) → Node, for summaries and descriptions
 *  renderDiff      ({ diff, branch, target, diffstat }) → Node, the app's diff card */
export function installProjectPages({ host, onAction, renderMarkdown, renderDiff } = {}) {
  if (!host) throw new Error('installProjectPages needs its host element');
  let M = null, P = null, busy = false, destroyed = false, pointer = false, deferred = false, release = 0;
  const pages = new Map();      // pageKey → the state a page keeps while it is not on screen
  const evidence = new Map();   // project + run → its tabs, its panel and what was read (shared by every ticket the run is a try in)

  const pid = () => M?.project?.id ?? P?.project ?? '';
  const call = (name, value, project = pid()) => Promise.resolve().then(() => onAction?.(name, project, value));
  /** Why a key can't go now, in words: the model's first; the app's demo rule as a backstop. Nothing waits for nibbi's reply (§12.2). */
  function blockedWords(action, payload) {
    const opens = PLAYS.includes(action) && payload?.action === 'open';
    if (M?.demo && REFUSED_IN_DEMO.includes(action) && !opens) return demoWords(action);
    return '';
  }
  const actionBlocked = a => a.blocked || blockedWords(a.action, a.payload);

  /* ---------------------------------------------------------------------------------------- page state */
  function stateFor(page) {
    const key = pageKey(page);
    if (pages.has(key)) return pages.get(key);
    const root = node('div', 'cp-page');
    const head = node('header', 'project-workspace-head cp-page-head');
    const body = node('div', 'project-workspace-body cp-page-body'); body.tabIndex = 0; body.setAttribute('role', 'region');
    root.append(head, body);
    const s = {
      key, kind: page.page, id: page.id, project: page.project, root, head, body, cache: new Map(),
      notice: null, pending: new Set(), focusKey: null, scroll: 0,
      confirm: null,                                 // the ActionVM key whose confirm is open
      editing: false, editForm: null,                // the ticket's words, being edited
      steerKey: null, steerForm: null,               // guide it: the open field, and the key that opened it
      adding: false, addForm: null,                  // the build page's + improvement
      open: new Set(), latest: null,                 // tries drawn open beside the latest; the latest last drawn
      foldFailed: false,
      question: null,                                // a copy's page: 'ship' | 'catch-up' | 'retire' (one at a time)
      shipHead: null, shipMoved: false,              // the head the ship panel listed, and whether it changed under it
      revealShip: false, retireError: '',            // bring the panel into view once; retire's refusal, said where it was asked
    };
    root.addEventListener('keydown', event => onKeydown(s, event));
    root.addEventListener('pointerdown', () => { pointer = true; clearTimeout(release); }, true);
    // the press ends with its click: after the key's own handler (this is the bubble phase), draw what it asked for
    root.addEventListener('click', () => { if (pointer) { pointer = false; clearTimeout(release); } if (deferred) draw(); });
    body.addEventListener('scroll', () => { s.scroll = body.scrollTop; }, { passive: true });
    pages.set(key, s);
    return s;
  }
  // A redraw between pointerdown and click would replace the pressed key and drop the click: wait for the
  // pointer, then draw what arrived meanwhile. The click ends the press (above); pointerup is the backstop
  // for a press that never became a click (dragged off the key).
  const letGo = () => { if (!pointer) return; clearTimeout(release); release = setTimeout(() => { pointer = false; if (deferred) draw(); }, 0); };
  document.addEventListener('pointerup', letGo, true);
  document.addEventListener('pointercancel', letGo, true);

  /** A region is rebuilt only when what it shows changed (its signature); otherwise the node on screen stays. */
  function keep(key, sig, build) {
    const c = P.cache.get(key);
    if (c && c.sig === sig) return c.node;
    const n = build();
    P.cache.set(key, { sig, node: n });
    return n;
  }
  function persistent(key, build) { if (!P.cache.has(key)) P.cache.set(key, { sig: null, node: build() }); return P.cache.get(key).node; }

  /* ---------------------------------------------------------------------------------------- sending */
  /** Send an action for key `k`: the key holds aria-busy while it is out, and a refusal or a failure is
      said in the page's notice (or handed back, with `quiet`, for a form to say in its own note). */
  async function send(k, name, value, { quiet = false } = {}) {
    const page = P;
    if (k && page.pending.has(k)) return { ok: false, skipped: true };
    if (k) page.pending.add(k);
    if (!quiet) page.notice = null;
    draw();
    try {
      const result = await call(name, value, page.project);
      if (result && typeof result === 'object' && result.ok === false) {
        const error = new Error(result.error?.message || result.message || FAILED); error.code = result.error?.code; throw error;
      }
      return { ok: true, result };
    } catch (error) {
      const text = error?.message || FAILED;
      if (!quiet) page.notice = { text, kind: 'error' };
      return { ok: false, error: text, code: error?.code, status: error?.status };
    } finally {
      if (k) page.pending.delete(k);
      if (page === P) draw();
    }
  }
  /** Navigation and asking: nothing to hold, only a failure to say. */
  function go(name, value) {
    const page = P;
    call(name, value, page?.project).catch(error => { if (!page) return; page.notice = { text: error?.message || FAILED, kind: 'error' }; if (page === P) draw(); });
  }

  /* ---------------------------------------------------------------------------------------- shared parts */
  function key(k, label, { tone = 'seated', glyph: g, disabled = false, title = '', expanded, pending = false, cls = '', cap = '', onClick } = {}) {
    const b = button(`cp-act ${tone === 'armed' ? 'armed' : `cp-act-${tone}`} ${cls}`.trim(), k);
    if (g) b.append(glyph(g));
    b.append(node('span', 'cp-act-label', label));
    if (cap) { const c = node('span', 'cp-keycap', cap); c.setAttribute('aria-hidden', 'true'); b.append(c); b.setAttribute('aria-keyshortcuts', 'Enter'); }
    if (disabled) b.disabled = true;
    if (title) b.title = title;
    if (expanded != null) b.setAttribute('aria-expanded', String(expanded));
    if (pending) { b.setAttribute('aria-busy', 'true'); b.setAttribute('aria-disabled', 'true'); }
    if (onClick) b.addEventListener('click', event => { if (P?.pending.has(k) || b.disabled) { event.preventDefault(); return; } onClick(event); });
    return b;
  }
  /** The crumb to the build the ticket lives in: main's trunk, or a copy's branch and its name. */
  function crumb(k) {
    const t = M?.ticket, name = t?.build || MAIN;
    const copy = (t?.buildKind || (name === MAIN ? 'main' : 'copy')) === 'copy';
    const b = button('cp-crumb', k);
    const pill = node('span', 'cp-crumb-pill'); pill.append(glyph(copy ? 'branch' : 'trunk'), node('span', '', name));
    b.append(pill); b.title = `open ${name}’s build page`;
    b.addEventListener('click', () => go('openBuild', name));
    return b;
  }
  function closeKey() {
    return keep('close', '', () => {
      const b = button('project-close', 'close'); b.textContent = '×';
      b.setAttribute('aria-label', WORDS.keys.close); b.title = 'back to the conversation (esc)';
      b.addEventListener('click', () => go('backToChat'));
      return b;
    });
  }
  function section(k, title, cls, id) {
    return persistent(k, () => {
      const s = node('section', `cp-section ${cls}`.trim());
      const head = node('div', 'cp-section-head');
      const h2 = node('h2', 'cp-section-title', title); h2.id = `cp-${id}`;
      const meta = node('span', 'cp-section-meta');
      const tools = node('div', 'cp-section-tools');
      head.append(h2, meta, tools); s.append(head); s.setAttribute('aria-labelledby', h2.id);
      s._meta = meta; s._tools = tools; s._head = head;
      return s;
    });
  }
  const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };
  /** A key that was sent holds aria-busy and stops taking presses; it stays focusable (a native disabled
      key would drop focus to the body mid-press). */
  const busyKey = (el, on) => { if (on) { el.setAttribute('aria-busy', 'true'); el.setAttribute('aria-disabled', 'true'); } else { el.removeAttribute('aria-busy'); el.removeAttribute('aria-disabled'); } };
  /** The page's one notice: a failure in the verdict colour, anything else in ink; `link` adds one quiet
      way on ("see main" after a ship). */
  function noticeEl() {
    const n = P.notice;
    return keep('notice', JSON.stringify(n), () => {
      const el = node('div', 'project-notice cp-notice'); el.setAttribute('role', 'status');
      el.hidden = !n?.text; el.dataset.kind = n?.kind || '';
      if (n?.text) el.append(node('span', '', n.text));
      if (n?.text && n.link) {
        const l = button('cp-link cp-notice-link', n.link.key); l.textContent = n.link.label;
        l.addEventListener('click', () => go(n.link.action, n.link.value));
        el.append(l);
      }
      return el;
    });
  }

  /* ---------------------------------------------------------------------------------------- draw */
  function draw() {
    if (!M || !P || destroyed) return;
    if (pointer) { deferred = true; return; }
    deferred = false;
    const { root, body } = P;
    const active = document.activeElement;
    const inRoot = !!active && active !== root && root.contains(active);
    const activeKey = inRoot ? active.closest('[data-cp-key]')?.dataset.cpKey || null : null;
    let selection = null;
    try { if (inRoot && typeof active.selectionStart === 'number') selection = [active.selectionStart, active.selectionEnd]; } catch { /* not a text field */ }
    const scroll = body.scrollTop;
    root.dataset.cpPage = P.kind; root.dataset.cpId = P.id ?? '';
    if (P.kind === 'ticket') drawTicket(); else drawBuild();
    if (body.scrollTop !== scroll) body.scrollTop = scroll;
    const want = P.focusKey; P.focusKey = null;
    if (want && focusKey(want, true)) { /* moved where the page meant it to go */ }
    else if (inRoot && document.activeElement !== active) {
      if (active.isConnected && root.contains(active)) {
        active.focus({ preventScroll: true });
        if (selection) try { active.setSelectionRange(...selection); } catch { /* not a text field */ }
      } else if (!(activeKey && focusKey(activeKey))) fallbackFocus();
    }
    const reveal = P.reveal; P.reveal = null;
    if (reveal?.isConnected) reveal.scrollIntoView?.({ block: 'start', behavior: calm() ? 'auto' : 'smooth' });
    root.setAttribute('aria-busy', String(loadingOnScreen()));
  }
  function focusKey(k, reveal = false) {
    const el = P.root.querySelector(`[data-cp-key="${CSS.escape(k)}"]`);
    if (!el || el.disabled || !el.getClientRects().length) return false;
    el.focus({ preventScroll: !reveal });
    if (reveal) el.scrollIntoView?.({ block: 'nearest' });
    return true;
  }
  /** The focused control went with the state that drew it: the page's first live key, else its title. */
  function fallbackFocus() {
    const k = [...P.root.querySelectorAll('.cp-actions [data-cp-key], .cp-preview [data-cp-key]')].find(el => !el.disabled && el.getClientRects().length);
    (k || P.root.querySelector('h1'))?.focus({ preventScroll: true });
  }
  const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.body.classList.contains('calm');
  function loadingOnScreen() {
    for (const ev of evidence.values()) if (ev.el.isConnected && P.root.contains(ev.el) && ev.data.get(ev.kind)?.loading) return true;
    return false;
  }

  /* ---------------------------------------------------------------------------------------- ticket */
  const actionKey = a => a.key || a.action;
  const findAction = k => (M?.ticket?.actions || []).find(a => actionKey(a) === k) || null;
  /** "see its changes" and "the github steps" choose a try's tab on the page; they send nothing. */
  function localTab(a) {
    if (a.tab && TAB_LABELS[a.tab]) return a.tab;
    if (a.action === 'buildEvidence' && !a.opens) return a.payload?.kind || 'changes';
    if (a.label === WORDS.keys.changes) return 'changes';
    if (a.label === WORDS.keys.github) return 'github';
    return null;
  }
  const glyphFor = a => a.action === 'buildIssue' ? 'play' : a.action === 'retryRun' ? 'retry' : a.action === 'editImprovement' ? 'pencil'
    : a.action === 'talkAbout' ? 'thread' : a.action === 'stopRun' && a.confirm ? 'stop'
    : a.action === 'previewRun' || a.action === 'playCopy' ? (a.payload?.action === 'open' ? 'out' : a.payload?.action === 'stop' ? 'stop' : 'play') : undefined;

  function drawTicket() {
    const t = M.ticket;
    P.root.className = 'cp-page cp-ticket';
    if (!t || t.gone) { drawGone(); return; }
    const imp = t.improvement;
    P.root.dataset.state = imp.state;
    // what a page holds open goes when its key does (the state moved on under it)
    if (P.confirm && !findAction(P.confirm)?.confirm) P.confirm = null;
    if (P.steerKey && !findAction(P.steerKey)) { P.steerKey = null; }
    // the edit key goes while a try runs: a form with nothing typed closes, one with typed words stays (save waits, and says why)
    if (P.editing && !(M.ticket.actions || []).some(a => a.action === 'editImprovement') && !editDirty()) P.editing = false;

    reconcile(P.head, [ticketTitle(t), closeKey()]);
    reconcile(P.body, [noticeEl(), statusPanel(t), workSection(t), askedSection(t), talkFoot(t)]);
  }
  function drawGone() {
    P.root.dataset.state = 'gone';
    P.confirm = null; P.steerKey = null; P.editing = false;
    const title = keep('gone-title', '', () => {
      const d = node('div', 'cp-title');
      const h1 = node('h1', '', WORDS.gone); h1.tabIndex = -1; h1.dataset.cpKey = 'title';
      d.append(h1); return d;
    });
    reconcile(P.head, [title, closeKey()]);
    const where = M.ticket?.build || MAIN;
    reconcile(P.body, [keep('gone-body', where, () => node('p', 'cp-quiet cp-gone', `it isn’t in ${where}’s list anymore — there’s nothing left here to act on`))]);
  }
  function ticketTitle(t) {
    const title = t.improvement.title;
    const n = keep('title', JSON.stringify([title, P.editing, t.build, t.buildKind]), () => {
      const d = node('div', 'cp-title');
      const kicker = node('p', 'cp-kicker'); kicker.append(node('span', '', WORDS.ticketKicker), crumb('crumb'));
      d.append(kicker);
      if (!P.editing) { const h1 = node('h1', '', title); h1.tabIndex = -1; h1.dataset.cpKey = 'title'; d.append(h1); }
      return d;
    });
    if (P.editing) { const form = editForm(t); if (form.parentNode !== n) n.append(form); syncEditForm(t); }
    return n;
  }

  // ---- the big status
  function statusPanel(t) {
    const imp = t.improvement;
    const panel = persistent('status', () => node('section', 'cp-status'));
    panel.dataset.status = imp.state;
    panel.setAttribute('aria-label', `status: ${imp.word}`);
    const actions = P.editing ? [] : (t.actions || []);
    // one ink key per page: the first ink ActionVM, unless a question or a field is open — then that owns it
    const open = P.confirm || P.steerKey || P.editing;
    let inkLeft = !open;
    const shown = actions.map(a => {
      const blocked = actionBlocked(a), k = actionKey(a);
      const tone = a.tone === 'ink' && inkLeft ? (inkLeft = false, 'ink') : 'seated';
      return { a, k, blocked, tone, pending: P.pending.has(k), expanded: a.confirm ? P.confirm === k : a.opens === 'form' && a.action === 'steerRun' ? P.steerKey === k : undefined };
    });
    const sig = JSON.stringify([imp.state, imp.word, imp.tone, imp.live, t.statusLine, shown.map(s => [s.k, s.a.label, s.tone, s.blocked, s.pending, s.expanded, s.a.action])]);
    const top = keep('status-top', sig, () => {
      const top = node('div', 'cp-status-top');
      const said = node('div', 'cp-status-said');
      const big = node('p', 'cp-status-word'); big.append(dot(imp.tone, imp.live), word(imp.word, imp.tone, { live: imp.live, cls: 'cp-state' }));
      const line = node('p', 'cp-status-line');
      const text = t.statusLine || '';
      const cut = imp.state === 'building' ? text.indexOf(' · ') : -1;
      if (cut > 0) line.append(node('span', 'cp-status-step', text.slice(0, cut)), text.slice(cut)); else line.textContent = text;
      said.append(big); if (text) said.append(line);
      top.append(said);
      if (shown.length) {
        const row = node('div', 'cp-actions');
        for (const s of shown) {
          row.append(key(s.k, s.a.label, {
            tone: s.tone, glyph: glyphFor(s.a), disabled: !!s.blocked, title: s.blocked, pending: s.pending, expanded: s.expanded,
            cls: s.tone === 'ink' ? 'cp-act-main' : '', onClick: () => press(s.k),
          }));
        }
        top.append(row);
      }
      return top;
    });
    // said once: when the status line already is the reason (no check set), the note under the keys would repeat it
    const why = [...new Set(shown.map(s => s.blocked).filter(Boolean))].filter(w => w !== t.statusLine);
    const blocked = keep('status-why', JSON.stringify(why), () => {
      const box = node('div', 'cp-blocked'); box.hidden = !why.length;
      for (const w of why) box.append(node('p', '', w));
      return box;
    });
    reconcile(panel, [top, blocked, confirmStrip(), steerSlot(t), factsStrip(t)]);
    return panel;
  }
  function confirmStrip() {
    const a = P.confirm ? findAction(P.confirm) : null, c = a?.confirm;
    const strip = keep('confirm', JSON.stringify(c ? [P.confirm, c] : null), () => {
      const strip = node('div', 'cp-confirm'); strip.setAttribute('role', 'group'); strip.setAttribute('aria-label', 'confirm');
      if (!c) { strip.hidden = true; return strip; }
      const keys = node('div', 'cp-confirm-keys');
      keys.append(
        key('confirm-no', c.no || WORDS.keys.cancel, { onClick: () => { const k = P.confirm; P.confirm = null; P.focusKey = k; draw(); } }),
        key('confirm-yes', c.yes, { tone: c.armed ? 'armed' : 'ink', glyph: a.action === 'stopRun' ? 'stop' : undefined, cls: 'cp-act-main', onClick: () => confirmYes() }),
      );
      strip.append(node('p', 'cp-confirm-words', c.words), keys);
      return strip;
    });
    // the yes holds while it is out; patched in place so the strip does not arrive a second time
    const yes = strip.querySelector('[data-cp-key="confirm-yes"]'); if (yes) busyKey(yes, P.pending.has('confirm-yes'));
    return strip;
  }
  function factsStrip(t) {
    return keep('facts', JSON.stringify([t.facts || [], t.build, t.buildKind]), () => {
      const dl = node('dl', 'cp-facts');
      for (const f of t.facts || []) {
        const cell = node('div', 'cp-fact'); const dd = node('dd', 'cp-fact-value');
        if (f.label === 'build') dd.append(crumb(f.key || 'crumb-fact'));
        else if (f.label === 'checks') String(f.value ?? '').split(' · ').forEach((part, i) => {
          if (i) dd.append(' · ');
          dd.append(/\bfailed\b/.test(part) ? word(part, 'error') : /\bpassed\b/.test(part) ? word(part, 'pass') : document.createTextNode(part));
        });
        else dd.textContent = String(f.value ?? '');
        cell.append(node('dt', 'cp-fact-label', f.label), dd); dl.append(cell);
      }
      return dl;
    });
  }

  /** A ticket key was pressed: a tab, a field, a question, or an action that goes to the app. */
  function press(k) {
    const a = findAction(k); if (!a || actionBlocked(a)) return;
    const tab = localTab(a);
    if (tab) { showTab(a.payload?.id || a.payload?.runId || M.ticket.attempts?.at(-1)?.runId, tab); return; }
    if (a.opens === 'form' && a.action === 'editImprovement') { openEdit(); return; }
    if (a.opens === 'form') { P.steerKey = P.steerKey === k ? null : k; P.confirm = null; P.focusKey = P.steerKey ? 'steer-field' : k; draw(); return; }
    if (a.confirm) { P.confirm = P.confirm === k ? null : k; P.steerKey = null; P.focusKey = P.confirm ? 'confirm-no' : k; draw(); return; }
    void act(a, k);
  }
  function confirmYes() { const a = P.confirm && findAction(P.confirm); if (a) void act(a, 'confirm-yes'); }
  async function act(a, pendingKey, extra = {}) {
    const k = actionKey(a), page = P, t = M.ticket;
    const r = await send(pendingKey, a.action, { ...(a.payload || {}), ...extra });
    // the question closes once it is answered, and focus goes back to the key that asked it
    if (page !== P) return r;
    if (pendingKey === 'confirm-yes') { page.confirm = null; page.focusKey = k; }
    if (r.ok && a.action === 'mergeRun') page.notice = { text: `merged into ${t.branch || MAIN}.`, kind: '' };
    draw();
    return r;
  }

  // ---- edit the words (the title becomes its own field; the description under it)
  function editForm(t) {
    if (P.editForm) return P.editForm;
    const form = node('form', 'cp-edit'); form.setAttribute('aria-label', WORDS.keys.edit);
    const title = node('input', 'cp-edit-title'); title.name = 'title'; title.maxLength = 1000; title.required = true;
    title.setAttribute('aria-label', 'the words'); title.dataset.cpKey = 'edit-title';
    const desc = node('textarea', 'cp-edit-desc'); desc.name = 'description'; desc.rows = 3;
    desc.setAttribute('aria-label', 'more about it'); desc.placeholder = 'more about it, if it helps'; desc.dataset.cpKey = 'edit-desc';
    const note = node('p', 'cp-page-note'); note.setAttribute('role', 'status');
    const keys = node('div', 'cp-edit-keys');
    const cancel = key('edit-cancel', WORDS.keys.cancel, { onClick: () => closeEdit() });
    const save = key('edit-save', WORDS.keys.save, { tone: 'ink', cls: 'cp-act-main' }); save.type = 'submit';
    keys.append(node('span', 'cp-quiet', 'nibbi reads the new words before it starts'), cancel, save);
    form.append(title, desc, note, keys);
    form._fields = { title, desc, note, save, cancel, from: ['', ''] };
    fillEdit(form._fields, t);
    const sync = () => syncEditForm(M.ticket);
    title.addEventListener('input', sync); desc.addEventListener('input', sync);
    form.addEventListener('submit', event => { event.preventDefault(); void saveEdit(); });
    P.editForm = form;
    return form;
  }
  function editDirty() {
    const f = P.editForm?._fields; if (!f) return false;
    return f.title.value.trim() !== f.from[0].trim() || f.desc.value.trim() !== f.from[1].trim();
  }
  function syncEditForm() {
    const f = P.editForm?._fields; if (!f) return;
    const changed = f.title.value.trim() && editDirty();
    const pending = P.pending.has('edit-save');
    const open = (M.ticket?.actions || []).some(a => a.action === 'editImprovement');
    f.save.disabled = (!changed || !open) && !pending;
    busyKey(f.save, pending);
    if (!open && !pending) { f.note.textContent = WORDS.editWaits; f.note.dataset.kind = 'notice'; f.waiting = true; }
    else if (f.waiting) { f.note.textContent = ''; delete f.note.dataset.kind; f.waiting = false; }
  }
  /** The words as they are now: the edit key's payload carries the issue's own text, else the title. The
      form keeps that payload, and with it the list's revision the words were read at, so a save after
      the list changed under it is refused (and says so) rather than written over what changed. */
  function fillEdit(f, t) {
    const a = (t.actions || []).find(x => x.action === 'editImprovement');
    f.title.value = a?.payload?.title ?? t.improvement.title; f.desc.value = a?.payload?.description ?? t.asked?.description ?? '';
    f.from = [f.title.value, f.desc.value]; f.revision = a?.payload?.revision; f.stale = false; f.note.textContent = ''; delete f.note.dataset.kind;
  }
  function openEdit() {
    P.editing = true; P.confirm = null; P.steerKey = null;
    if (P.editForm) fillEdit(P.editForm._fields, M.ticket);
    P.focusKey = 'edit-title'; draw();
  }
  function closeEdit() {
    const a = (M.ticket?.actions || []).find(x => x.action === 'editImprovement');
    P.editing = false; P.focusKey = a ? actionKey(a) : 'title'; draw();
  }
  async function saveEdit() {
    const a = (M.ticket?.actions || []).find(x => x.action === 'editImprovement'), f = P.editForm?._fields;
    if (!a || !f || P.pending.has('edit-save')) return;
    const words = actionBlocked(a); if (words) { f.note.textContent = words; delete f.note.dataset.kind; return; }
    const title = f.title.value.trim(), description = f.desc.value.trim();
    if (!title) { f.title.focus(); return; }
    const page = P;
    // "save again" means it: once refused, the words have been seen against the list as it is now
    const value = { ...(a.payload || {}), title, description };
    if (!f.stale && f.revision !== undefined) value.revision = f.revision;
    const r = await send('edit-save', a.action, value, { quiet: true });
    if (page !== P) return;
    if (r.ok) { f.note.textContent = ''; f.stale = false; closeEdit(); return; }
    const conflict = isConflict(r) || /revision|changed|conflict/i.test(r.error);
    if (conflict) f.stale = true;
    f.note.textContent = conflict ? CONFLICT : r.error; f.note.dataset.kind = 'error';
    syncEditForm();
  }

  // ---- guide it (one field, under the keys)
  function steerSlot() {
    if (!P.steerKey) return null;
    const a = findAction(P.steerKey);
    if (!P.steerForm) {
      const form = node('form', 'cp-steer'); form.setAttribute('aria-label', WORDS.keys.guide);
      const field = node('textarea', 'cp-steer-field'); field.rows = 2; field.maxLength = 2000; field.dataset.cpKey = 'steer-field';
      field.setAttribute('aria-label', 'what should it do differently?'); field.placeholder = 'what should it do differently?';
      const note = node('p', 'cp-page-note'); note.setAttribute('role', 'status');
      const keys = node('div', 'cp-steer-keys');
      const sendKey = key('steer-send', WORDS.keys.send, { cap: '↵', cls: 'cp-act-main' }); sendKey.type = 'submit';
      keys.append(key('steer-cancel', WORDS.keys.cancel, { onClick: () => { const k = P.steerKey; P.steerKey = null; P.focusKey = k; draw(); } }), sendKey);
      form.append(field, note, keys);
      field.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); } });
      form.addEventListener('submit', event => { event.preventDefault(); void sendSteer(); });
      form._fields = { field, note, send: sendKey };
      P.steerForm = form;
    }
    const f = P.steerForm._fields, pending = P.pending.has('steer-send');
    f.send.className = 'cp-act cp-act-ink cp-act-main';
    busyKey(f.send, pending);
    const words = a ? actionBlocked(a) : '';
    f.send.disabled = !!words; f.send.title = words;
    return P.steerForm;
  }
  async function sendSteer() {
    const a = findAction(P.steerKey), f = P.steerForm?._fields; if (!a || !f || P.pending.has('steer-send')) return;
    const text = f.field.value.trim(); if (!text) { f.field.focus(); return; }
    const words = actionBlocked(a); if (words) { f.note.textContent = words; return; }
    const page = P, k = P.steerKey, runId = a.payload?.runId;
    const r = await send('steer-send', a.action, { ...(a.payload || {}), text }, { quiet: true });
    if (page !== P) return;
    if (r.ok) {
      f.field.value = ''; f.note.textContent = ''; P.steerKey = null; P.focusKey = k;
      const n = (M.ticket.attempts || []).find(x => x.runId === runId)?.n;
      P.notice = { text: n ? `sent to try ${n} — it reads it at its next step` : 'sent — it reads it at its next step', kind: '' };
      draw(); return;
    }
    f.note.textContent = r.error; f.note.dataset.kind = 'error';
  }

  // ---- the work: every try, oldest first; the latest open, earlier ones fold to one line
  function workSection(t) {
    const s = section('work', 'the work', 'cp-work', 'work');
    const list = persistent('runlog', () => { const ol = node('ol', 'cp-runlog'); s.append(ol); return ol; });
    if (list.parentNode !== s) s.append(list);
    const tries = t.attempts || [], last = tries.at(-1), live = [...tries].reverse().find(a => a.live);
    // a try you were reading stays open when a newer one arrives (Try again)
    if (P.latest && last && P.latest !== last.runId && tries.some(a => a.runId === P.latest)) P.open.add(P.latest);
    P.latest = last?.runId || null;
    setText(s._meta, workMeta(tries, live, last));
    const items = tries.length ? tries.map(a => tryItem(t, a, a === last)) : [keep('try-empty', '', () => {
      const li = node('li', 'cp-runlog-item cp-try-empty');
      li.append(node('p', 'cp-try-empty-title', 'no tries yet'), node('p', 'cp-quiet', `build it now starts try 1 on ${t.build || MAIN} — its log and changes appear here as it goes.`));
      return li;
    })];
    reconcile(list, items);
    return s;
  }
  /** "2 tries · try 2 running now" · "1 try · try 1 needs you" · "2 tries · last failed 1h ago". */
  function workMeta(tries, live, last) {
    if (!tries.length) return '';
    const n = plural(tries.length, 'try', 'tries');
    if (live) return `${n} · try ${live.n} ${live.state === 'landing' ? live.word : 'running now'}`;
    if (WAITING.has(last.state) || ['up_next', 'landing', 'waiting_to_land'].includes(last.state)) return `${n} · try ${last.n} ${last.word}`;
    const verb = last.state === 'in' ? 'landed' : last.state === 'interrupted' ? 'stopped' : last.word;
    return `${n} · last ${verb} ${ago(last.endedAt || last.startedAt, M.now)}`.trim();
  }
  function tryItem(t, a, latest) {
    const li = persistent(`try-li:${a.runId}`, () => {
      const li = node('li', 'cp-runlog-item');
      const art = node('article', 'cp-try'); art.dataset.cpRun = a.runId;
      const body = node('div', 'cp-try-body');
      li._art = art; li._body = body; li.append(art); return li;
    });
    const art = li._art, body = li._body;
    const open = latest || P.open.has(a.runId);
    art.dataset.status = a.state; art.setAttribute('aria-label', `try ${a.n}: ${a.word}`);
    art.classList.toggle('is-folded', !open);
    const meta = tryMeta(a);
    const head = keep(`try-head:${a.runId}`, JSON.stringify([a.n, a.word, a.tone, a.live, meta, latest, open]), () => {
      const h = latest ? node('div', 'cp-try-head') : button('cp-try-head cp-try-toggle', `try-${a.runId}`);
      if (!latest) { h.setAttribute('aria-expanded', String(open)); h.addEventListener('click', () => { if (P.open.has(a.runId)) P.open.delete(a.runId); else P.open.add(a.runId); draw(); }); }
      const name = node('span', 'cp-try-name');
      name.append(dot(a.tone, a.live), node('strong', '', `try ${a.n}`), word(a.word, a.tone, { live: a.live }));
      const m = node('span', 'cp-try-meta');
      meta.forEach((bit, i) => { if (i) m.append(' · '); const b = bit.mono ? mono(bit.text) : node('span', '', bit.text); b.classList.add('cp-try-bit'); m.append(b); });
      h.append(name, m);
      if (!latest) h.append(glyph('chevron', 'cp-icon cp-try-chevron'));
      return h;
    });
    const briefText = open ? '' : String(a.reason || a.summary || '').split('\n').find(line => line.trim()) || '';
    const brief = briefText ? keep(`try-brief:${a.runId}`, briefText, () => node('p', 'cp-try-brief', briefText.replace(/^[#>*\-\s]+/, ''))) : null;
    if (open) {
      const top = keep(`try-top:${a.runId}`, JSON.stringify([a.summary, a.reason, latest, a.live, a.steps, a.checks, a.state]), () => tryTop(a, latest));
      reconcile(body, [top, syncEvidence(a)]);
    }
    body.hidden = !open;
    reconcile(art, [head, brief, body]);
    return li;
  }
  function tryMeta(a) {
    const now = M.now, bits = [];
    if (a.state === 'up_next' && !a.endedAt) bits.push({ text: `queued ${ago(a.startedAt, now)}`.trim() });
    else {
      if (a.startedAt) bits.push({ text: `started ${ago(a.startedAt, now)}` });
      const span = a.endedAt ? duration(a.startedAt, a.endedAt) : duration(a.startedAt, now);
      if (span) bits.push({ text: a.endedAt ? `ran ${span}` : `${span} so far` });
    }
    if (Number.isFinite(a.costUsd) && a.costUsd > 0) bits.push({ text: `$${a.costUsd.toFixed(2)}` });
    if (a.sha) bits.push({ text: a.sha, mono: true });
    if (a.branch) bits.push({ text: a.target ? `${a.branch} → ${a.target}` : a.branch, mono: true });
    return bits;
  }
  function tryTop(a, latest) {
    const top = node('div', 'cp-try-top');
    if (a.summary) {
      top.append(markdownInto(node('div', 'project-document cp-try-summary'), a.summary, renderMarkdown));
    } else if (a.live) top.append(node('p', 'cp-try-summary cp-quiet', 'nibbi hasn’t said what it did yet — it’s still working'));
    if (!latest && a.reason) top.append(node('p', 'cp-try-reason', a.reason));
    const grid = node('div', 'cp-try-grid');
    const steps = node('div', 'cp-try-steps'), list = a.steps || [];
    steps.append(node('h3', 'cp-sub', `steps · ${list.filter(s => s.state === 'done').length} of ${list.length} done`));
    if (list.length) {
      const ol = node('ol', 'cp-steps');
      for (const s of list) {
        const [w, tone] = STEP_WORDS[s.state] || [s.state, 'quiet'];
        const li = node('li', 'cp-step'); li.dataset.status = s.state;
        li.append(node('span', 'cp-step-name', s.label || s.name), word(w, tone, { live: s.state === 'running' }));
        ol.append(li);
      }
      steps.append(ol);
    } else steps.append(node('p', 'cp-quiet', 'no steps reported'));
    const checks = node('div', 'cp-try-checks'), cl = a.checks || [];
    const head = node('h3', 'cp-sub'); head.append('checks · '); appendCounts(head, cl, unjudged(a));
    const ul = node('ul', 'cp-checks');
    for (const c of cl) {
      const li = node('li', 'cp-check'); li.dataset.ok = String(c.ok);
      const [w, tone] = c.ok === true ? ['passed', 'pass'] : c.ok === false ? ['failed', 'error'] : [unjudged(a), 'quiet'];
      li.append(node('span', 'cp-check-name', c.name), word(w, tone));
      if (c.note) li.append(node('span', 'cp-check-note', c.note));
      ul.append(li);
    }
    if (!cl.length) ul.append(node('li', 'cp-quiet', 'no checks yet'));
    checks.append(head, ul);
    grid.append(steps, checks);
    top.append(grid);
    return top;
  }
  function appendCounts(el, checks, unjudgedWord) {
    const ok = checks.filter(c => c.ok === true).length, bad = checks.filter(c => c.ok === false).length, wait = checks.length - ok - bad;
    const parts = [ok && word(`${ok} passed`, 'pass'), bad && word(`${bad} failed`, 'error'), wait && word(`${wait} ${unjudgedWord}`, 'quiet')].filter(Boolean);
    if (!parts.length) { el.append(word('none yet', 'quiet')); return; }
    parts.forEach((p, i) => { if (i) el.append(' · '); el.append(p); });
  }

  // ---- evidence: one per run, kept across updates and across tickets the run is a try in
  function evidenceOf(runId, project = pid()) {
    const k = `${project}\u0000${runId}`;
    if (!evidence.has(k)) {
      const el = node('div', 'cp-evidence');
      const tabs = node('div', 'project-evidence-tabs'); tabs.setAttribute('role', 'group');
      const panel = node('div', 'project-evidence-panel'); panel.setAttribute('aria-live', 'polite');
      el.append(tabs, panel);
      evidence.set(k, { key: k, project, runId, el, tabs, panel, kind: null, kinds: '', data: new Map(), painted: null, github: null, attempt: null });
    }
    return evidence.get(k);
  }
  const normalizeTabs = tabs => { const list = (Array.isArray(tabs) && tabs.length ? tabs : ['log', 'changes']).filter(k => TAB_LABELS[k]); return [...new Set(list)]; };
  function syncEvidence(a) {
    const ev = evidenceOf(a.runId);
    ev.attempt = a;
    const kinds = normalizeTabs(a.tabs);
    if (!ev.kind || !kinds.includes(ev.kind)) ev.kind = kinds.includes(a.initialTab) ? a.initialTab : kinds[0];
    ev.tabs.setAttribute('aria-label', `try ${a.n}: what it did`);
    if (ev.kinds !== kinds.join()) {
      ev.kinds = kinds.join();
      ev.tabs.replaceChildren(...kinds.map(kind => {
        const b = button('project-filter', `tab-${a.runId}-${kind}`); b.dataset.kind = kind;
        b.append(node('span', 'cp-tab-label', TAB_LABELS[kind]), node('span', 'cp-tab-count'));
        b.addEventListener('click', () => selectTab(ev, kind));
        return b;
      }));
    }
    // a diff read while the try was still moving is read again once it has settled somewhere new
    const changes = ev.data.get('changes');
    if (changes && !changes.loading && changes.status !== a.status && !ev.panel.contains(document.activeElement)) ev.data.delete('changes');
    syncTabs(ev);
    if (['log', 'changes', 'checks'].includes(ev.kind) && !ev.data.has(ev.kind)) void load(ev, ev.kind);
    paintIfChanged(ev);
    return ev.el;
  }
  function syncTabs(ev) {
    const a = ev.attempt;
    for (const b of ev.tabs.children) {
      const kind = b.dataset.kind;
      b.setAttribute('aria-pressed', String(kind === ev.kind));
      let count = '';
      if (kind === 'log') { const list = logEntries(ev.data.get('log')?.value); if (list) count = String(list.length); }
      if (kind === 'changes' && a?.files?.count) count = `+${a.files.add} −${a.files.del}`;
      setText(b.querySelector('.cp-tab-count'), count);
    }
  }
  function selectTab(ev, kind) {
    ev.kind = kind; syncTabs(ev);
    if (['log', 'changes', 'checks'].includes(kind) && !ev.data.has(kind)) void load(ev, kind);
    paintIfChanged(ev);
    if (P) P.root.setAttribute('aria-busy', String(loadingOnScreen()));
  }
  /** see its changes · the github steps: open that try, choose the tab, bring it into view and focus it. */
  function showTab(runId, kind) {
    const tries = M.ticket?.attempts || [];
    const a = tries.find(x => x.runId === runId) || tries.at(-1);
    if (!a) return;
    if (a !== tries.at(-1)) P.open.add(a.runId);
    const ev = evidenceOf(a.runId);
    ev.attempt = a;
    if (normalizeTabs(a.tabs).includes(kind)) ev.kind = kind;
    P.focusKey = `tab-${a.runId}-${ev.kind}`; P.reveal = ev.el;
    draw();
  }
  async function load(ev, kind, force = false) {
    const cur = ev.data.get(kind);
    if (!force && cur && (cur.loading || !cur.error)) return;
    const a = ev.attempt || {}, d = { loading: true, status: a.status };
    ev.data.set(kind, d);
    paintIfChanged(ev);
    try {
      d.value = await call('buildEvidence', { id: ev.runId, kind, ...(a.attemptId ? { attemptId: a.attemptId } : {}) }, ev.project);
      if (d.value === undefined) d.value = null;
    } catch (error) { d.error = error?.message || `couldn’t read its ${kind} — try again`; }
    finally {
      d.loading = false;
      if (ev.data.get(kind) === d) { syncTabs(ev); paintIfChanged(ev); }
      if (P) P.root.setAttribute('aria-busy', String(loadingOnScreen()));
    }
  }
  function paintIfChanged(ev) {
    const d = ev.data.get(ev.kind);
    const state = !d ? 'none' : d.loading ? 'loading' : d.error ? 'error' : 'ready';
    const extra = ev.kind === 'summary' ? ev.attempt?.summary : '';
    const p = ev.painted;
    if (p && p.kind === ev.kind && p.d === d && p.state === state && p.extra === extra) return;
    ev.painted = { kind: ev.kind, d, state, extra };
    paint(ev, d);
  }
  function paint(ev, d) {
    const panel = ev.panel, kind = ev.kind, a = ev.attempt || {};
    if (kind === 'github') { const gh = githubFor(ev); if (gh.element.parentNode !== panel) panel.replaceChildren(gh.element); gh.setBusy(busy); void gh.open(); return; }
    if (kind === 'summary') {
      panel.replaceChildren(a.summary ? markdownInto(node('div', 'project-document'), a.summary, renderMarkdown) : node('p', 'project-muted', 'it hasn’t said what it changed yet — the log has what happened'));
      return;
    }
    if (!d || d.loading) { panel.replaceChildren(node('p', 'project-muted cp-reading', `reading its ${TAB_LABELS[kind]}…`)); return; }
    if (d.error) {
      const again = button('cp-link', `tab-${ev.runId}-${kind}-again`); again.textContent = 'try again';
      again.addEventListener('click', () => void load(ev, kind, true));
      panel.replaceChildren(node('p', 'project-form-error', d.error), again);
      return;
    }
    const value = d.value;
    if (kind === 'log') {
      const text = logText(value), entries = logEntries(value);
      d.inputs = new Map(); d.list = null;
      if (text != null) { panel.replaceChildren(node('pre', 'project-evidence-code cp-terminal', text)); return; }
      if (!entries?.length) { panel.replaceChildren(node('pre', 'project-evidence-code cp-terminal', value?.text || 'nothing in the log yet')); return; }
      const list = d.list = logList(entries, d.inputs, renderDiff);
      panel.replaceChildren(list);
      // a terminal shows its end, the last thing it did; the panel may be attached just after this paint
      list.scrollTop = list.scrollHeight;
      queueMicrotask(() => { if (list.isConnected) list.scrollTop = list.scrollHeight; });
      return;
    }
    if (kind === 'changes') {
      const diff = typeof value === 'string' ? value : value?.diff || value?.data?.diff || value?.text || '';
      if (diff && renderDiff) {
        const rendered = renderDiff(typeof value === 'string' ? { diff: value } : { ...value, target: value?.target ?? a.target });
        panel.replaceChildren(typeof rendered === 'string' || !rendered ? node('pre', 'project-evidence-code', diff) : rendered);
      } else panel.replaceChildren(node('pre', 'project-evidence-code', diff || 'no changes to show yet'));
      return;
    }
    // checks: the project check's own words, whole
    const check = value?.verification || value?.data?.verification;
    const box = node('div', 'cp-check-detail');
    box.append(node('h3', 'cp-sub', check?.status ? `the project check · ${check.status}` : 'the project check'));
    if (check?.command) box.append(node('pre', 'project-evidence-code', check.command));
    const info = check?.detail || value?.detail || value?.text;
    box.append(info ? node('pre', 'project-evidence-code', info) : node('p', 'project-muted', 'nothing was reported for it'));
    panel.replaceChildren(box);
  }
  function githubFor(ev) {
    if (ev.github) return ev.github;
    const a = ev.attempt || {};
    ev.github = createGithubPanel({
      project: ev.project, buildId: ev.runId,
      run: { id: ev.runId, title: a.title, branch: a.branch, targetBranch: a.target, commitSha: a.sha, status: a.status, github: a.github },
      onAction: (name, project, value) => onAction?.(name, project, value),
      renderMarkdown, renderDiff,
      onChanged: () => onAction?.('refresh', ev.project),
    });
    return ev.github;
  }

  // ---- what you asked, and a quiet way into a conversation about it
  function askedSection(t) {
    const s = section('asked', 'what you asked', 'cp-asked', 'asked');
    const asked = t.asked || {};
    setText(s._meta, asked.at ? ago(asked.at, M.now) : asked.source === 'issue' ? 'from issues.md' : '');
    const content = keep('asked-body', JSON.stringify([asked.text, asked.description, asked.context, t.improvement.title, t.links]), () => {
      const box = node('div', 'cp-asked-body');
      if (asked.text && asked.text.trim() !== t.improvement.title.trim()) box.append(node('p', 'cp-asked-text', asked.text));
      if (displayMarkdown(asked.description)) box.append(markdownInto(node('div', 'project-document cp-asked-desc'), asked.description, renderMarkdown));
      if (!box.childElementCount) box.append(node('p', 'cp-quiet', 'just the words above'));
      if (asked.context) { const c = node('div', 'cp-asked-context'); c.append(node('h3', 'cp-sub', 'nibbi’s notes for it'), node('p', '', asked.context)); box.append(c); }
      const links = (t.links || []).map((l, i) => { const href = safeUrl(l.url); if (!href) return null; const a = node('a', 'cp-link', l.label); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.dataset.cpKey = `link-${i}`; return a; }).filter(Boolean);
      if (links.length) { const row = node('div', 'cp-asked-links'); row.append(...links); box.append(row); }
      return box;
    });
    reconcile(s, [s._head, content]);
    return s;
  }
  function talkFoot(t) {
    const already = (t.actions || []).some(a => a.action === 'talkAbout');
    return keep('talk', JSON.stringify([already, t.improvement.id]), () => {
      const foot = node('div', 'cp-talk'); foot.hidden = already;
      const k = button('cp-link cp-talk-key', 'talk');
      k.append(glyph('thread'), node('span', '', WORDS.keys.ask));
      k.addEventListener('click', () => go('talkAbout', { improvementId: M.ticket.improvement.id }));
      foot.append(k);
      return foot;
    });
  }

  /* ---------------------------------------------------------------------------------------- build page */
  const isCopy = b => b?.kind === 'copy';
  /** main: phase 1's page, and its copies (phase 2). A copy: drawCopy. null: the copy is gone. */
  function drawBuild() {
    const b = M.build;
    if (!b) { drawGoneBuild(); return; }
    if (isCopy(b)) { drawCopy(b); return; }
    P.root.className = 'cp-page cp-build';
    delete P.root.dataset.state;
    P.question = null;
    const title = keep('build-title', JSON.stringify([b.name, b.line]), () => {
      const d = node('div', 'cp-title');
      const kicker = node('p', 'cp-kicker'); kicker.append(glyph('trunk'), node('span', '', WORDS.mainKicker));
      const h1 = node('h1', '', b.name || MAIN); h1.tabIndex = -1; h1.dataset.cpKey = 'title';
      d.append(kicker, h1, node('p', 'cp-copyline', b.line || WORDS.mainLine));
      return d;
    });
    reconcile(P.head, [title, closeKey()]);
    if (P.foldFailed && !(b.improvements || []).some(i => i.group === 'failed')) P.foldFailed = false;
    const ink = inkKey(b);
    reconcile(P.body, [noticeEl(), previewCard(b, ink), tiles(b), improvementsSection(b, ink), copiesSection(b), historySection(b)]);
  }
  /** A copy retired (or gone) while its page was open: it says so and keeps only its ×. */
  function drawGoneBuild() {
    P.root.className = 'cp-page cp-build cp-copy-page';
    P.root.dataset.state = 'gone';
    P.question = null; P.shipMoved = false; P.adding = false; P.foldFailed = false;
    const title = keep('gone-build-title', P.id ?? '', () => {
      const d = node('div', 'cp-title');
      const kicker = node('p', 'cp-kicker'); kicker.append(glyph('branch'), node('span', '', [WORDS.copy.kicker, P.id].filter(Boolean).join(' · ')));
      const h1 = node('h1', '', WORDS.copy.gone); h1.tabIndex = -1; h1.dataset.cpKey = 'title';
      d.append(kicker, h1);
      return d;
    });
    reconcile(P.head, [title, closeKey()]);
    reconcile(P.body, [keep('gone-build-body', '', () => node('p', 'cp-quiet cp-gone', WORDS.copy.goneNote))]);
  }
  /** The page's one ink key (BUILDS-AS-COPIES §4.4), first that applies. A copy: the ship panel's yes when
      it can ship · Ship to main when it can and the panel is closed · an open question's yes (catch up while
      it plays; an armed one — retire — leaves the page with no ink, as the ticket's stop) · play · the
      + improvement form's start now. main (phase 1): play, else the form's start now. */
  function inkKey(b) {
    if (!isCopy(b)) return playInk(b) ? 'play' : P.adding ? 'add-start' : '';
    const ready = !shipWhy(b), q = P.question;
    if (q === 'ship' && ready) return 'ship-yes';
    if (q === 'catch-up') return b.catchUp?.confirm?.armed ? '' : 'catch-up-yes';
    if (q === 'retire') return '';
    if (q !== 'ship' && ready) return 'ship';
    if (playInk(b)) return 'play';
    return P.adding ? 'add-start' : '';
  }
  const playAction = b => isCopy(b) ? 'playCopy' : 'playMain';
  const playValue = (b, action) => isCopy(b) ? { copyId: b.copyId, action } : { action };
  const playBlocked = b => b.blocked?.play || b.play?.blocked || blockedWords(playAction(b), { action: 'start' });
  const playInk = b => { const p = b.play || {}; return !!p.playable && !p.running && !p.starting && !playBlocked(b); };
  function previewCard(b, ink) {
    const p = b.play || {}, blocked = playBlocked(b), lit = ink === 'play', copy = isCopy(b), name = b.name || MAIN, now = M.now;
    const pend = ['play', 'play-open', 'play-stop'].map(k => P.pending.has(k));
    const stopWords = blockedWords(playAction(b), { action: 'stop' });
    // one plays at a time: the hint says what Play would stop; a copy also says when it was last played
    const said = copy ? headSays(b) : new Set();   // a copy's head already says it (one reason stops ship and play): the key keeps it as its title
    const hint = p.starting ? 'starting it — a moment' : blocked ? (said.has(blocked) ? '' : blocked) : [copy ? (p.playedAt ? `last played ${ago(p.playedAt, now)}` : 'not played yet') : '',
      p.stops ? fill(WORDS.copy.oneAtATime, { other: p.stops }) : ''].filter(Boolean).join(' · ');
    const made = copy ? [b.madeAt ? fill(WORDS.copy.madeFrom, { ago: ago(b.madeAt, now) }) : '', sha7(b.madeFrom?.sha)] : null;
    return keep('preview', JSON.stringify([p, blocked, lit, pend, name, copy, hint, made, stopWords, [...said]]), () => {
      const card = node('section', 'cp-preview'); card.dataset.playing = String(!!p.running);
      card.setAttribute('aria-label', copy ? fill(WORDS.copy.play, { name }) : `play ${name}`);
      const bar = node('div', `cp-preview-bar${p.url ? '' : ' is-bare'}`);
      bar.append(dot(p.running ? 'active' : 'quiet', !!p.starting));
      if (p.url) { const u = mono(String(p.url).replace(/^https?:\/\//, '').replace(/\/$/, '')); u.title = p.url; bar.append(u); }
      bar.append(node('span', 'cp-preview-state', p.running ? 'playing' : p.starting ? 'starting' : 'not running'));
      const stage = node('div', 'cp-preview-stage');
      if (!p.playable) {
        stage.append(node('p', 'cp-preview-big', 'this one can’t be played'));
        const why = blocked || (copy ? fill(WORDS.copy.nothingToPlay, { name }) : WORDS.noPlay.replace('{project}', M.project?.name || pid()));
        if (!said.has(why)) stage.append(node('p', 'cp-preview-hint', why));
      }
      else if (p.running) {
        stage.append(node('p', 'cp-preview-big', `${name} is playing`));
        const keys = node('div', 'cp-preview-keys');
        keys.append(
          key('play-open', WORDS.keys.open, { glyph: 'out', pending: pend[1], onClick: () => void send('play-open', playAction(b), playValue(b, 'open')) }),
          key('play-stop', WORDS.keys.stopPlaying, { glyph: 'stop', pending: pend[2], disabled: !!stopWords, title: stopWords, onClick: () => void play(b, 'stop') }),
        );
        stage.append(keys);
      } else {
        stage.append(key('play', copy ? fill(WORDS.copy.play, { name }) : WORDS.keys.playMain, { tone: lit ? 'ink' : 'seated', glyph: 'play', cls: 'cp-preview-play', disabled: !!blocked, title: blocked, pending: pend[0] || !!p.starting, onClick: () => void play(b, 'start') }));
        if (hint) stage.append(node('p', 'cp-preview-hint', hint));
      }
      const foot = node('div', 'cp-preview-foot');
      if (p.note) foot.append(node('span', 'cp-preview-note', p.note));
      if (made && (made[0] || made[1])) {
        const from = node('span', 'cp-preview-commit'); from.title = made.filter(Boolean).join(' · ');
        if (made[0]) from.append(made[0]);
        if (made[1]) from.append(made[0] ? ' · ' : '', mono(made[1]));
        foot.append(from);
      } else if (!copy && p.lastCommit) {
        const [sha, ...rest] = String(p.lastCommit).split(' ');
        const last = node('span', 'cp-preview-commit'); last.title = p.lastCommit;
        last.append(mono(sha), rest.length ? ` ${rest.join(' ')}` : '');
        foot.append(last);
      }
      card.append(bar, stage);
      if (foot.childElementCount) card.append(foot);
      return card;
    });
  }
  function play(b, action) { return send(action === 'start' ? 'play' : 'play-stop', playAction(b), playValue(b, action)); }
  /** One status tile: its label, its value (a word, or a node), the line under it, and an extra (a key). */
  function tileEl(label, value, sub, extra, note) {
    const t = node('div', 'cp-tile'); const v = node('dd', 'cp-tile-value');
    v.append(typeof value === 'string' ? node('span', 'cp-tile-word', value) : value);
    t.append(node('dt', 'cp-tile-label', label), v);
    if (sub) t.append(node('dd', 'cp-tile-sub', sub));
    if (note) { const n = node('dd', 'cp-tile-note', note.text); n.dataset.tone = note.tone || 'quiet'; t.append(n); }
    if (extra) { const e = node('dd', 'cp-tile-extra'); e.append(extra); t.append(e); }
    return t;
  }
  function tiles(b) {
    const imps = b.improvements || [], now = M.now, c = b.counts || {};
    const waiting = imps.filter(i => i.group === 'waiting');
    const byWord = new Map(); for (const i of waiting) byWord.set(i.word, (byWord.get(i.word) || 0) + 1);
    const waitSub = [...byWord].map(([w, n]) => `${n} ${w}`).join(' · ') || 'nothing waits on you';
    const week = imps.filter(i => i.state === 'in' && Number.isFinite(toMs(i.when?.at)) && now - toMs(i.when.at) <= 7 * 86_400_000);
    const lastIn = Math.max(-Infinity, ...imps.filter(i => i.state === 'in').map(i => toMs(i.when?.at)).filter(Number.isFinite));
    const check = b.check || { command: '', real: false };
    const sig = JSON.stringify([c.waiting ?? waiting.length, waitSub, check, week.length, Number.isFinite(lastIn) ? ago(lastIn, now) : '', !!b.github]);
    return keep('tiles', sig, () => {
      const dl = node('dl', 'cp-tiles');
      dl.append(tileEl('waiting on you', String(c.waiting ?? waiting.length), waitSub));
      const cmd = check.real && check.command ? (() => { const m = mono(check.command); m.classList.add('cp-tile-command'); m.title = check.command; return m; })() : 'none set';
      dl.append(tileEl('checks', cmd, check.real ? 'every improvement is checked before it lands' : WORDS.noCheck));
      let repo = null;
      if (b.github) { repo = button('cp-link', 'repository'); repo.textContent = 'repository & github'; repo.addEventListener('click', () => go('repository')); }
      dl.append(tileEl('landed this week', String(week.length), Number.isFinite(lastIn) ? `last ${ago(lastIn, now)}` : 'nothing yet', repo));
      return dl;
    });
  }
  function improvementsSection(b, ink) {
    const s = section('improvements', 'improvements', 'cp-improvements', 'improvements');
    const imps = b.improvements || [], copy = isCopy(b);
    setText(s._meta, imps.length ? String(imps.length) : '');
    const addKey = keep('add-key', JSON.stringify([P.adding]), () => key('add', WORDS.keys.improvement, { glyph: 'plus', expanded: P.adding, onClick: () => toggleAdd() }));
    reconcile(s._tools, [addKey]);
    const form = P.adding ? addForm(b) : null;
    if (form) syncAddForm(b, ink);
    const now = M.now;
    const rows = imps.map(i => [i.id, i.state, i.word, i.tone, i.live, i.title, i.group, rowSub(i, now)]);
    const empty = copy ? WORDS.copy.emptyImprovements : WORDS.emptyImprovements;
    const list = keep('imps', JSON.stringify([rows, P.foldFailed, b.list, empty]), () => {
      const box = node('div', 'cp-imps-wrap');
      if (b.list === 'unavailable') {
        const why = node('div', 'cp-imps-note'); why.setAttribute('role', 'status');
        const again = button('cp-link', 'refresh-list'); again.textContent = 'read it again'; again.addEventListener('click', () => go('refresh'));
        why.append(node('span', '', WORDS.noList), again); box.append(why);
      }
      const list = node('div', 'cp-imps');
      for (const g of GROUPS) {
        const inGroup = imps.filter(i => i.group === g.id);
        if (!inGroup.length) continue;
        const group = node('div', 'cp-imp-group'); group.setAttribute('role', 'group'); group.setAttribute('aria-label', g.label);
        group.dataset.cpGroup = g.id;
        group.append(node('p', 'cp-imp-group-title', `${g.label} · ${inGroup.length}`));
        const cap = g.id === 'failed' && !P.foldFailed && inGroup.length > PAGE_LIMITS.failedShown ? PAGE_LIMITS.failedShown : inGroup.length;
        for (const i of inGroup.slice(0, cap)) group.append(impRow(i, now));
        if (g.id === 'failed' && inGroup.length > PAGE_LIMITS.failedShown) {
          const more = button('cp-imp-more', 'failed-more'); more.setAttribute('aria-expanded', String(P.foldFailed));
          more.append(glyph('chevron', 'cp-icon cp-imp-more-glyph'), node('span', '', P.foldFailed ? WORDS.showFewer : `${inGroup.length - PAGE_LIMITS.failedShown} more`));
          more.addEventListener('click', () => { P.foldFailed = !P.foldFailed; P.focusKey = 'failed-more'; draw(); });
          group.append(more);
        }
        list.append(group);
      }
      if (!list.childElementCount) list.append(node('p', 'cp-imps-empty', b.list === 'loading' ? 'reading the list of improvements…' : empty));
      box.append(list);
      return box;
    });
    // with automation picking this list up (b.autoInto), up next doesn't wait for you, and the hint says so
    const into = String(b.autoInto || '');
    const hint = copy ? fill(into ? WORDS.copy.formHintAuto : WORDS.copy.formHint, { name: b.name }) : into ? fill(WORDS.form.hintAuto, { into }) : WORDS.form.hint;
    reconcile(s, [s._head, form, form && keep('add-hint', hint, () => node('p', 'cp-add-hint', hint)), list]);
    return s;
  }
  function rowSub(i, now) {
    if (i.group === 'failed' && i.reason) return i.reason;
    return [whenText(i.when, now), i.context].filter(Boolean).join(' · ');
  }
  function impRow(i, now) {
    const row = button('cp-imp', `imp-${i.id}`); row.dataset.state = i.state; row.title = i.title;
    const words = node('span', 'cp-imp-words');
    words.append(node('span', 'cp-imp-text', i.title));
    const sub = rowSub(i, now); if (sub) words.append(node('span', 'cp-imp-sub', sub));
    row.append(dot(i.tone, i.live), words, word(i.word, i.tone, { live: i.live, cls: 'cp-imp-state' }), glyph('chevron', 'cp-icon cp-imp-chevron'));
    row.addEventListener('click', () => go('openImprovement', i.id));
    return row;
  }
  /** main's timeline: what landed in it (and, phase 2, each ship from a copy, where it falls in time),
      then the settled ones in quiet ink. */
  function historySection(b) {
    const s = section('history', `landed in ${b.name || MAIN}`, 'cp-history', 'history');
    const landed = (b.improvements || []).filter(i => i.state === 'in').slice(0, PAGE_LIMITS.inKept);
    const settled = (b.settled || []).slice(0, PAGE_LIMITS.settledKept);
    const shipped = (b.history || []).filter(h => h.kind === 'shipped').slice(0, PAGE_LIMITS.inKept);
    const t = x => Number.isFinite(x) ? x : -Infinity;
    const rows = shipped.length
      ? [...landed.map(i => ({ i, at: toMs(i.when?.at) })), ...shipped.map(h => ({ h, at: toMs(h.at) }))].sort((x, y) => (t(y.at) > t(x.at)) - (t(y.at) < t(x.at)))
      : landed.map(i => ({ i }));
    rows.push(...settled.map(i => ({ i })));
    const now = M.now;
    const items = rows.map(({ i, h }) => i ? [i.id, i.state, i.word, i.tone, i.title, i.when?.verb, dayClock(i.when?.at, now), ago(i.when?.at, now)] : [h.kind, h.at, h.text, h.tone, h.sha, dayClock(h.at, now), ago(h.at, now)]);
    setText(s._meta, landed.length ? String(landed.length) : '');
    const list = keep('timeline', JSON.stringify(items), () => {
      const ol = node('ol', 'cp-timeline');
      for (const { i, h } of rows) {
        if (h) { ol.append(historyRow(h, now)); continue; }
        const li = node('li', 'cp-hist'); li.dataset.state = i.state;
        const time = node('time', 'cp-hist-time', dayClock(i.when?.at, now)); if (i.when?.at) { time.dateTime = i.when.at; time.title = ago(i.when.at, now); }
        const what = node('div', 'cp-hist-what'), line = node('p', 'cp-hist-line');
        const verb = i.state === 'in' ? (i.when?.verb === 'shipped' ? 'shipped' : 'landed') : i.word;
        const link = button('cp-link cp-hist-link', `hist-${i.id}`); link.textContent = i.title; link.title = i.title;
        link.addEventListener('click', () => go('openImprovement', i.id));
        line.append(word(verb, i.state === 'in' ? 'pass' : 'quiet', { cls: 'cp-hist-word' }), link);
        what.append(line);
        li.append(time, dot(i.state === 'in' ? 'pass' : 'quiet'), what);
        ol.append(li);
      }
      if (!ol.childElementCount) ol.append(node('li', 'cp-quiet cp-hist-empty', 'nothing has landed yet'));
      return ol;
    });
    reconcile(s, [s._head, list]);
    return s;
  }
  /** One HistoryVM row: a try (its verb in its verdict's colour and the improvement as a link), or what
      happened to the build itself (made · shipped · caught up · couldn’t catch up) with its sha in mono. */
  function historyRow(h, now) {
    const li = node('li', 'cp-hist'); li.dataset.kind = h.kind;
    const live = h.kind === 'started' && h.tone === 'active';
    const time = node('time', 'cp-hist-time', dayClock(h.at, now)); if (h.at) { time.dateTime = h.at; time.title = ago(h.at, now); }
    const what = node('div', 'cp-hist-what'), line = node('p', 'cp-hist-line');
    if (h.improvementId) {
      line.append(word(HIST_VERB[h.kind] || h.kind, h.tone, { live, cls: 'cp-hist-word' }));
      const link = button('cp-link cp-hist-link', `hist-${h.kind}-${h.improvementId}-${h.at}`); link.textContent = h.text; link.title = h.text;
      link.addEventListener('click', () => go('openImprovement', h.improvementId));
      line.append(link);
    } else {
      const text = node('span', 'cp-hist-text'), sha = sha7(h.sha), cut = sha ? String(h.text).lastIndexOf(sha) : -1;
      if (cut >= 0) text.append(h.text.slice(0, cut), mono(sha), h.text.slice(cut + sha.length));
      else { text.append(h.text); if (sha) text.append(' ', mono(sha)); }
      line.append(text);
    }
    what.append(line);
    li.append(time, dot(h.tone || 'quiet', live), what);
    return li;
  }
  /** main: its copies, each a row that opens its page; with none, how one is made — or, where copies
      can't be made here (a GitHub-mode project, no real check), why. */
  function copiesSection(b) {
    if (!Array.isArray(b.copies)) return null;   // a phase-1 view model: no copies section
    const s = section('copies', WORDS.copy.copiesTitle, 'cp-copies', 'copies');
    const copies = b.copies, project = M.project?.name || pid();
    const why = b.github?.mode === 'github' ? fill(WORDS.copy.githubMode, { project }) : b.check && !b.check.real ? WORDS.copy.noCheck : '';
    setText(s._meta, copies.length ? String(copies.length) : '');
    const list = keep('copies-list', JSON.stringify([copies.map(c => [c.name, c.copyId, c.word, c.tone, c.live, c.note]), why]), () => {
      const box = node('div', 'cp-imps cp-copies-list');
      for (const c of copies) {
        const row = button('cp-imp cp-copy', `copy-${c.name}`); row.title = `open ${c.name}’s build page`;
        const words = node('span', 'cp-imp-words');
        words.append(node('span', 'cp-imp-text', c.name));
        if (c.note) words.append(node('span', 'cp-imp-sub', c.note));
        row.append(glyph('branch', 'cp-icon cp-copy-glyph'), words, word(c.word, c.tone, { live: c.live, cls: 'cp-imp-state' }), glyph('chevron', 'cp-icon cp-imp-chevron'));
        row.addEventListener('click', () => go('openBuild', c.name));
        box.append(row);
      }
      if (!copies.length) box.append(node('p', 'cp-imps-empty', why || WORDS.copy.copiesEmpty));
      return box;
    });
    const note = why && copies.length ? keep('copies-why', why, () => node('p', 'cp-copies-why', why)) : null;
    reconcile(s, [s._head, list, note]);
    return s;
  }

  /* ---------------------------------------------------------------------------------------- a copy's page */
  /** Why it can't ship now ('' when it can): the model's words, and demo as the backstop. */
  function shipWhy(b) {
    const s = b.ship, nothing = fill(WORDS.copy.shipNothing, { name: b.name });
    const why = !s ? b.blocked?.ship || nothing : s.ready ? '' : s.why || b.blocked?.ship || nothing;
    return why || blockedWords('shipCopy', {});
  }
  const catchUpWhy = b => b.catchUp?.blocked || b.blocked?.catchUp || blockedWords('catchUpCopy', {});
  const retireWhy = b => b.retire?.blocked || b.blocked?.retire || blockedWords('retireCopy', {});
  function drawCopy(b) {
    P.root.className = 'cp-page cp-build cp-copy-page';
    delete P.root.dataset.state;
    settleQuestion(b);
    if (P.foldFailed && !(b.improvements || []).some(i => i.group === 'failed')) P.foldFailed = false;
    const ink = inkKey(b);
    reconcile(P.head, [copyTitle(b), shipKey(b, ink), closeKey()]);
    reconcile(P.body, [noticeEl(), shipPanel(b, ink), previewCard(b, ink), copyTiles(b), catchUpStrip(b, ink), improvementsSection(b, ink), copyHistory(b), retireRow(b)]);
  }
  /** What a copy's page holds open goes when its reason does; while its yes is out, it stays as it was.
      The ship panel follows a head that moved under it: it lists the new head, says so, and focus goes
      back to its "not yet" (only when focus is on the page — a refresh never pulls it out of the bar). */
  function settleQuestion(b) {
    const q = P.question;
    if (!q || ['ship-yes', 'catch-up-yes', 'retire-yes'].some(k => P.pending.has(k))) return;
    const onPage = () => { const a = document.activeElement; return !a || a === document.body || P.root.contains(a); };
    if (q === 'ship' && !b.ship) P.question = null;
    else if (q === 'catch-up' && !(b.catchUp?.needed && b.catchUp.confirm && !catchUpWhy(b))) { P.question = null; if (onPage()) P.focusKey = 'catch-up'; }
    else if (q === 'retire' && (!b.retire || retireWhy(b))) { P.question = null; if (onPage()) P.focusKey = 'retire'; }
    else if (q === 'ship') {
      const head = b.ship.payload?.expectedHead ?? null;
      if (head !== P.shipHead) { P.shipHead = head; P.shipMoved = true; if (onPage()) P.focusKey = 'ship-no'; }
    }
  }
  function openQuestion(q) {
    const b = M.build;
    P.question = q; P.retireError = '';
    if (q === 'ship') { P.shipHead = b?.ship?.payload?.expectedHead ?? null; P.shipMoved = false; P.revealShip = true; }
    P.focusKey = `${q}-no`;
    draw();
  }
  function closeQuestion() {
    const q = P.question; if (!q) return;
    P.question = null; P.shipMoved = false; P.focusKey = QUESTION_KEY[q];
    draw();
  }
  /** What the headline already says in other words: nothing to ship yet, main moved on, or the copy is
      busy (being made, shipping, catching up, retiring, or it couldn't be made). */
  function headImplied(b) {
    const name = b.name;
    return b.state === 'nothing' ? fill(WORDS.copy.shipNothing, { name }) : b.state === 'behind' ? fill(WORDS.copy.shipBehind, { name })
      : ['making', 'shipping', 'catching_up', 'retiring', 'broken'].includes(b.state) ? fill(WORDS.copy.notReady, { name, status: WORDS.copy.statusWords[b.status] || '' }) : '';
  }
  /** The lines under the copy line: what is wrong with the copy on disk (healthWords: missing, moved, dirty,
      couldn't be made), then ship's why — each unless the headline already says it. */
  function headLines(b) {
    const implied = headImplied(b), why = shipWhy(b);
    return [...new Set([b.healthWords || '', why].filter(w => w && w !== implied))];
  }
  /** Every reason the head says, so a key further down keeps its reason as its title and doesn't say it again. */
  const headSays = b => new Set([headImplied(b), ...headLines(b)].filter(Boolean));
  function copyTitle(b) {
    const lines = headLines(b);
    return keep('copy-title', JSON.stringify([b.name, b.word, b.tone, b.live, b.detail, b.copyLine, lines]), () => {
      const d = node('div', 'cp-title');
      const kicker = node('p', 'cp-kicker'); kicker.append(glyph('branch'), node('span', '', WORDS.copy.kicker));
      const row = node('div', 'cp-title-row');
      const h1 = node('h1', '', b.name); h1.tabIndex = -1; h1.dataset.cpKey = 'title';
      row.append(h1, word(b.word, b.tone, { live: b.live, cls: 'cp-head-state' }));
      if (b.detail) row.append(node('span', 'cp-head-detail', b.detail));
      d.append(kicker, row, node('p', 'cp-copyline', b.copyLine || WORDS.copy.line));
      for (const line of lines) d.append(node('p', 'cp-head-why', line));
      return d;
    });
  }
  /** Ship to main, top right: ink when it can ship and nothing else claims the ink; disabled with its why
      when it can't — except while its panel is open (openShip), when it is the key that closes it. */
  function shipKey(b, ink) {
    const open = P.question === 'ship', why = shipWhy(b), lit = ink === 'ship';
    return keep('ship-key', JSON.stringify([open, why, lit, b.name]), () => key('ship', WORDS.copy.shipKey, {
      tone: lit ? 'ink' : 'seated', glyph: 'pull', disabled: !!why && !open, title: why || fill(WORDS.copy.shipTitle, { name: b.name }),
      expanded: open, cls: 'cp-head-ship', onClick: () => toggleShip(),
    }));
  }
  function toggleShip() {
    if (P.question === 'ship') { closeQuestion(); return; }
    if (!M.build?.ship || shipWhy(M.build)) return;
    openQuestion('ship');
  }
  /** The confirmed step: what goes into main, what stays, the checks on the head, whether it was played,
      then yes. Nothing is sent until its yes; while the yes is out the panel stays exactly as it was asked. */
  function shipPanel(b, ink) {
    if (P.question !== 'ship' || !b.ship) return null;
    const s = b.ship, name = b.name, now = M.now, why = shipWhy(b), pending = P.pending.has('ship-yes');
    const ships = s.ships || [], stays = s.stays || [];
    const sig = JSON.stringify([name, s.lead, why, ink === 'ship-yes', P.shipMoved, s.checks, s.checksLine, s.facts, s.yes, s.no,
      ships.map(i => [i.id, i.title, i.word, i.tone, whenText(i.when, now)]), stays.map(i => [i.id, i.title, i.word])]);
    const held = pending ? P.cache.get('ship-panel') : null;
    const panel = keep('ship-panel', held ? held.sig : sig, () => {
      const sec = node('section', 'cp-ship'); sec.setAttribute('aria-labelledby', 'cp-ship-title');
      const h2 = node('h2', 'cp-ship-title', fill(WORDS.copy.shipTitle, { name })); h2.id = 'cp-ship-title';
      sec.append(h2, node('p', 'cp-ship-lead', s.lead || why));
      if (ships.length) {
        const ol = node('ol', 'cp-ship-list');
        for (const i of ships) {
          const li = node('li', 'cp-ship-item');
          const open = button('cp-ship-open', `ship-${i.id}`); open.title = i.title;
          open.append(word(i.word || 'in', i.tone || 'pass', { cls: 'cp-ship-word' }), node('span', 'cp-ship-text', i.title), node('span', 'cp-ship-meta', whenText(i.when, now)));
          open.addEventListener('click', () => go('openImprovement', i.id));
          li.append(open); ol.append(li);
        }
        sec.append(ol);
      }
      if (stays.length) sec.append(node('p', 'cp-ship-stays', fill(WORDS.copy.shipStays, { name, list: stays.map(i => `“${i.title}” (${i.word})`).join(', ') })));
      const checks = node('div', 'cp-ship-checks'), cl = s.checks || [];
      checks.append(node('h3', 'cp-sub', `checks on ${name}`));
      if (cl.length) {
        const ul = node('ul', 'cp-checks');
        for (const c of cl) {
          const li = node('li', 'cp-check'); li.dataset.ok = String(c.ok);
          const [w, tone] = c.ok === true ? ['passed', 'pass'] : c.ok === false ? ['failed', 'error'] : ['not run yet', 'quiet'];
          li.append(node('span', 'cp-check-name', c.name), word(w, tone));
          if (c.note) li.append(node('span', 'cp-check-note', c.note));
          ul.append(li);
        }
        checks.append(ul);
      }
      if (s.checksLine) checks.append(node('p', 'cp-ship-check-line', s.checksLine));
      sec.append(checks);
      if (s.facts?.length) sec.append(node('p', 'cp-ship-facts', s.facts.join(' · ')));
      if (P.shipMoved) { const n = node('p', 'cp-page-note cp-ship-moved', fill(WORDS.copy.headMoved, { name })); n.setAttribute('role', 'status'); sec.append(n); }
      const keys = node('div', 'cp-ship-keys');
      keys.append(
        key('ship-no', s.no || WORDS.copy.shipNo, { onClick: () => closeQuestion() }),
        key('ship-yes', s.yes || WORDS.copy.shipKey, { tone: ink === 'ship-yes' ? 'ink' : 'seated', glyph: 'pull', cls: 'cp-act-main', disabled: !!why, title: why, onClick: () => void shipYes() }),
      );
      sec.append(keys);
      return sec;
    });
    const yes = panel.querySelector('[data-cp-key="ship-yes"]'); if (yes) busyKey(yes, pending);
    if (P.revealShip) { P.revealShip = false; P.reveal = panel; }
    return panel;
  }
  async function shipYes() {
    const b = M.build, s = b?.ship; if (!s || shipWhy(b)) return;
    const n = (s.ships || []).length, page = P;
    const r = await send('ship-yes', 'shipCopy', { ...(s.payload || {}) });
    if (page !== P) return;
    if (r.ok) {
      page.question = null; page.shipMoved = false;
      page.notice = { text: n > 1 ? fill(WORDS.copy.shipDoneMany, { n }) : WORDS.copy.shipDone, kind: '', link: { label: SEE_MAIN, key: 'see-main', action: 'openBuild', value: MAIN } };
      page.focusKey = 'see-main';
    } else page.focusKey = 'ship-no';
    draw();
  }
  /** improvements · checks on <name> · against main (with catch up when main moved on, and the last
      catch-up that didn't go through, in words). */
  function copyTiles(b) {
    const c = b.counts || {}, imps = b.improvements || [], name = b.name, cu = b.catchUp;
    const parts = [[c.in, 'in'], [c.building, 'building'], [c.upNext, 'up next'], [c.waiting, 'waiting on you'], [c.failed, 'failed'], [c.interrupted, 'interrupted']]
      .filter(([n]) => n > 0).map(([n, w]) => `${n} ${w}`);
    const check = b.checks?.[0] || null, real = b.check?.real !== false;
    const [value, tone] = !real ? ['none set', 'quiet'] : b.verified || check?.ok === true ? ['passed', 'pass'] : check?.ok === false ? ['failed', 'error'] : ['not run yet', 'quiet'];
    const checkSub = !real ? WORDS.noCheck : value === 'not run yet' ? `${b.check?.command || 'the check'} runs when an improvement lands or ${name} catches up`
      : check?.note || (b.verified ? `verified ${ago(b.verified.at, M.now)} on ${sha7(b.verified.sha)}` : '');
    const ahead = Number(b.ahead) || 0, behind = Number(b.behind) || 0;
    const needed = !!cu?.needed, blocked = needed ? catchUpWhy(b) : '';
    const pending = P.pending.has('catch-up') || P.pending.has('catch-up-yes'), asking = P.question === 'catch-up';
    const last = cu?.last && !cu.last.ok && cu.last.words ? cu.last.words : '';
    const sig = JSON.stringify([parts, imps.length, name, value, tone, checkSub, ahead, behind, needed, blocked, pending, asking, !!cu?.confirm, last]);
    return keep('copy-tiles', sig, () => {
      const dl = node('dl', 'cp-tiles');
      dl.append(tileEl('improvements', String(imps.length), parts.join(' · ') || 'none yet'));
      dl.append(tileEl(`checks on ${name}`, word(value, tone, { cls: 'cp-tile-word' }), checkSub));
      const catchKey = needed ? key('catch-up', WORDS.copy.catchUpKey, { disabled: !!blocked, title: blocked, pending, expanded: cu.confirm ? asking : undefined, onClick: () => pressCatchUp() }) : null;
      dl.append(tileEl('against main', `${ahead} ahead`, behind ? `${behind} behind — main moved on` : '0 behind — main hasn’t moved on', catchKey, last ? { text: last, tone: 'error' } : null));
      return dl;
    });
  }
  /** Catch up goes at once, unless the copy plays: then the page asks first (it stops playing it). */
  function pressCatchUp() {
    const b = M.build, cu = b?.catchUp; if (!cu?.needed || catchUpWhy(b)) return;
    if (cu.confirm) { if (P.question === 'catch-up') closeQuestion(); else openQuestion('catch-up'); return; }
    void catchUp('catch-up');
  }
  async function catchUp(k) {
    const b = M.build, cu = b?.catchUp; if (!cu || catchUpWhy(b)) return;
    const page = P, name = b.name;
    const r = await send(k, 'catchUpCopy', { ...(cu.payload || {}) });
    if (page !== P) return;
    if (k === 'catch-up-yes') { page.question = null; page.focusKey = 'catch-up'; }
    if (r.ok) page.notice = { text: fill(WORDS.copy.catchUpDone, { name }), kind: '' };
    draw();
  }
  function catchUpStrip(b, ink) {
    const pending = P.pending.has('catch-up-yes'), held = pending ? P.cache.get('catch-up-confirm') : null;
    const c = b.catchUp?.confirm;
    if (P.question !== 'catch-up' || (!c && !held)) return null;
    const strip = keep('catch-up-confirm', held ? held.sig : JSON.stringify([c, ink === 'catch-up-yes']), () => {
      const strip = node('div', 'cp-confirm cp-catch-confirm'); strip.setAttribute('role', 'group'); strip.setAttribute('aria-label', WORDS.copy.catchUpRow);
      const keys = node('div', 'cp-confirm-keys');
      keys.append(
        key('catch-up-no', c.no || WORDS.copy.catchUpNo, { onClick: () => closeQuestion() }),
        key('catch-up-yes', c.yes || WORDS.copy.catchUpYes, { tone: c.armed ? 'armed' : ink === 'catch-up-yes' ? 'ink' : 'seated', cls: 'cp-act-main', onClick: () => void catchUp('catch-up-yes') }),
      );
      strip.append(node('p', 'cp-confirm-words', c.words), keys);
      return strip;
    });
    const yes = strip.querySelector('[data-cp-key="catch-up-yes"]'); if (yes) busyKey(yes, pending);
    return strip;
  }
  /** The copy's history, newest first: made · started · landed · failed · shipped · caught up. */
  function copyHistory(b) {
    const s = section('history', 'history', 'cp-history', 'history');
    const now = M.now, items = (b.history || []).slice(0, 30);
    setText(s._meta, items.length ? String(items.length) : '');
    const list = keep('copy-timeline', JSON.stringify(items.map(h => [h.kind, h.at, h.text, h.tone, h.improvementId, h.sha, dayClock(h.at, now), ago(h.at, now)])), () => {
      const ol = node('ol', 'cp-timeline');
      for (const h of items) ol.append(historyRow(h, now));
      if (!ol.childElementCount) ol.append(node('li', 'cp-quiet cp-hist-empty', 'nothing has happened here yet'));
      return ol;
    });
    reconcile(s, [s._head, list]);
    return s;
  }
  /** Retire, quiet at the foot: the note and a link; pressed, an armed strip asks; blocked, the link is
      disabled and its words show. A refusal is said here, where it was asked. */
  function retireRow(b) {
    const r = b.retire; if (!r) return null;
    const name = b.name, open = P.question === 'retire', why = retireWhy(b), pending = P.pending.has('retire-yes'), said = why && headSays(b).has(why);
    const c = r.confirm || { words: fill(WORDS.copy.retireConfirm, { name, unshipped: '' }), yes: fill(WORDS.copy.retireYes, { name }), no: fill(WORDS.copy.retireNo, { name }), armed: true };
    const held = pending ? P.cache.get('retire') : null;
    const row = keep('retire', held ? held.sig : JSON.stringify([open, r.note, c, why, said, P.retireError, name]), () => {
      const wrap = node('div', 'cp-retire');
      if (open) {
        const strip = node('div', 'cp-confirm'); strip.setAttribute('role', 'group'); strip.setAttribute('aria-label', fill(WORDS.copy.retireKey, { name }));
        const keys = node('div', 'cp-confirm-keys');
        keys.append(
          key('retire-no', c.no, { onClick: () => closeQuestion() }),
          key('retire-yes', c.yes, { tone: c.armed === false ? 'seated' : 'armed', cls: 'cp-act-main', onClick: () => void retireYes() }),
        );
        strip.append(node('p', 'cp-confirm-words', c.words), keys);
        wrap.append(strip);
        return wrap;
      }
      wrap.append(node('p', 'cp-quiet cp-retire-note', r.note || fill(WORDS.copy.retireNote, { name })));
      const link = button('cp-link cp-retire-key', 'retire'); link.textContent = fill(WORDS.copy.retireKey, { name });
      if (why) { link.disabled = true; link.title = why; }
      link.addEventListener('click', () => { if (!link.disabled && M.build && !retireWhy(M.build)) openQuestion('retire'); });
      wrap.append(link);
      if (why && !said) wrap.append(node('p', 'cp-retire-why', why));
      if (P.retireError) { const e = node('p', 'cp-page-note cp-retire-error', P.retireError); e.dataset.kind = 'error'; e.setAttribute('role', 'status'); wrap.append(e); }
      return wrap;
    });
    const yes = row.querySelector('[data-cp-key="retire-yes"]'); if (yes) busyKey(yes, pending);
    return row;
  }
  async function retireYes() {
    const b = M.build, r = b?.retire; if (!r) return;
    const page = P;
    const res = await send('retire-yes', 'retireCopy', { ...(r.payload || {}) }, { quiet: true });
    if (page !== P) return;
    // answered, focus goes back to retire (the next model makes the page gone, and its title takes it)
    page.question = null; page.focusKey = 'retire';
    if (!res.ok) page.retireError = res.error;
    draw();
  }

  // ---- + improvement on the build page: start now or up next (on a copy, it lands there: { text, copyId })
  const startBlocked = b => b.blocked?.start || blockedWords('startImprovement', {});
  const queueBlocked = b => b.blocked?.queue || blockedWords('queueImprovement', {});
  function addForm() {
    if (P.addForm) return P.addForm;
    const form = node('form', 'cp-add'); form.setAttribute('aria-label', WORDS.form.label);
    const field = node('textarea', 'cp-add-field'); field.rows = 2; field.maxLength = 1000; field.dataset.cpKey = 'add-field';
    field.setAttribute('aria-label', WORDS.form.label); field.placeholder = WORDS.form.placeholder;
    const note = node('p', 'cp-page-note'); note.setAttribute('role', 'status');
    const keys = node('div', 'cp-add-keys');
    const start = key('add-start', WORDS.form.start, { cap: '↵', onClick: () => void submitAdd('start') });
    const queue = key('add-queue', WORDS.form.queue, { onClick: () => void submitAdd('queue') });
    const cancel = key('add-cancel', WORDS.keys.cancel, { onClick: () => toggleAdd(false) });
    keys.append(cancel, queue, start);
    form.append(field, note, keys);
    field.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void submitAdd('start'); } });
    field.addEventListener('input', () => { if (note.dataset.kind !== 'error') setNote(''); });
    form.addEventListener('submit', event => { event.preventDefault(); void submitAdd('start'); });
    const setNote = (text, kind = '') => { note.textContent = text; if (kind) note.dataset.kind = kind; else delete note.dataset.kind; };
    form._fields = { field, note, start, queue, cancel, setNote };
    P.addForm = form;
    return form;
  }
  function syncAddForm(b, ink) {
    const f = P.addForm?._fields; if (!f) return;
    const sw = startBlocked(b), qw = queueBlocked(b);
    const placeholder = isCopy(b) ? fill(WORDS.copy.formPlaceholder, { name: b.name }) : WORDS.form.placeholder;
    if (f.field.placeholder !== placeholder) f.field.placeholder = placeholder;
    f.start.className = `cp-act cp-act-${ink === 'add-start' ? 'ink' : 'seated'} cp-act-main`;
    for (const [el, words, k] of [[f.start, sw, 'add-start'], [f.queue, qw, 'add-queue']]) { el.disabled = !!words; el.title = words; busyKey(el, P.pending.has(k)); }
  }
  function toggleAdd(open = !P.adding) {
    P.adding = open;
    P.focusKey = open ? 'add-field' : 'add';
    draw();
  }
  async function submitAdd(which) {
    const b = M.build, f = P.addForm?._fields; if (!f || !b) return;
    const k = `add-${which}`; if (P.pending.has('add-start') || P.pending.has('add-queue')) return;
    const words = which === 'start' ? startBlocked(b) : queueBlocked(b);
    if (words) { f.setNote(words); return; }
    const text = f.field.value.trim();
    if (!text) { f.field.focus(); return; }
    f.setNote('');
    const page = P;
    const value = isCopy(b) && b.copyId ? { text, copyId: b.copyId } : { text };
    const r = await send(k, which === 'start' ? 'startImprovement' : 'queueImprovement', value, { quiet: true });
    if (page !== P) return;
    if (r.ok) { f.field.value = ''; f.setNote(''); toggleAdd(false); return; }
    f.setNote(r.error, 'error');
    if (M.build) syncAddForm(M.build, inkKey(M.build));
  }

  /* ---------------------------------------------------------------------------------------- Escape */
  /** Escape takes back what this page opened, newest first; with nothing open it leaves the event alone
      (the frame's Escape returns to the chat). */
  function onKeydown(s, event) {
    if (event.key !== 'Escape' || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || s !== P) return;
    if (P.confirm) { const k = P.confirm; P.confirm = null; P.focusKey = k; }
    else if (P.steerKey) { const k = P.steerKey; P.steerKey = null; P.focusKey = k; }
    else if (P.editing) { closeEdit(); event.preventDefault(); event.stopPropagation(); return; }
    else if (P.question) { const q = P.question; P.question = null; P.shipMoved = false; P.focusKey = QUESTION_KEY[q]; }   // a copy's ship panel, catch-up question or retire strip
    else if (P.adding) { P.adding = false; P.focusKey = 'add'; }
    else if (P.foldFailed && P.kind === 'build') { P.foldFailed = false; P.focusKey = 'failed-more'; }
    else return;
    event.preventDefault(); event.stopPropagation();
    draw();
  }

  /* ---------------------------------------------------------------------------------------- the API */
  function hasDraft(s) {
    if (!s) return false;
    const e = s.editing && s.editForm?._fields;
    if (e && (e.title.value.trim() !== e.from[0].trim() || e.desc.value.trim() !== e.from[1].trim())) return true;
    if (s.steerKey && s.steerForm?._fields.field.value.trim()) return true;
    if (s.addForm?._fields.field.value.trim()) return true;
    for (const ev of evidence.values()) if (ev.project === s.project && ev.github) { const snap = ev.github.snapshot(); if (snap.hasDraft || snap.reviewing) return true; }
    return false;
  }
  function open(model, { focus = true } = {}) {
    if (destroyed || !model?.page || !['build', 'ticket'].includes(model.page.page)) return;
    const next = stateFor(model.page);
    const switching = next !== P;
    if (P && switching) { P.scroll = P.body.scrollTop; P.confirm = null; P.question = null; P.shipMoved = false; }
    P = next; M = model; busy = !!model.busy;
    pointer = false; deferred = false; clearTimeout(release);
    // openShip (the bar's ship to main): a copy's page with its ship panel already open — on open only,
    // so an update carrying the same intent never opens it again once it was closed
    const shipIntent = model.page.intent === 'ship' && isCopy(model.build) && !!model.build.ship;
    if (shipIntent) { P.question = 'ship'; P.shipHead = model.build.ship.payload?.expectedHead ?? null; P.shipMoved = false; P.retireError = ''; }
    if (host.childNodes.length !== 1 || host.firstChild !== P.root) host.replaceChildren(P.root);
    draw();
    if (shipIntent) P.body.scrollTop = 0; else if (switching) P.body.scrollTop = P.scroll;
    if (focus && !(shipIntent && focusKey('ship-no'))) P.root.querySelector('h1')?.focus({ preventScroll: true });
  }
  return {
    /** Show a page ({ page: PageRef, project, build, ticket, busy, demo, now }). focus: the h1 takes focus. */
    open,
    /** A fresh model for the page on screen: redrawn in place, keeping focus, scroll, forms and evidence. */
    update(model) {
      if (destroyed || !P || !model?.page) return;
      if (pageKey(model.page) !== P.key) { open(model, { focus: false }); return; }
      M = model; busy = !!model.busy;
      draw();
    },
    close() {
      if (P) { P.scroll = P.body.scrollTop; P.confirm = null; P.question = null; P.shipMoved = false; }
      P = null; M = null; pointer = false; deferred = false; clearTimeout(release);
      host.replaceChildren();
    },
    /** A run event from /api/events: joins every loaded Log of that run, on screen or not, as one row. */
    noteRunEvent(event) {
      if (!event?.runId) return;
      let entry;
      for (const ev of evidence.values()) {
        if (ev.runId !== event.runId) continue;
        const d = ev.data.get('log'), value = d?.value;
        if (!d || d.loading || d.error || !value || typeof value !== 'object' || logText(value) != null) continue;
        entry ??= eventToLogEntry(event); if (!entry) return;
        const entries = logEntries(value) || (value.entries = []);
        entries.push(entry);
        if (d.list) {
          const list = d.list, atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 8;
          list.append(logRow(entry, d.inputs || new Map(), renderDiff));
          if (atEnd) list.scrollTop = list.scrollHeight;
        } else if (ev.kind === 'log') { ev.painted = null; paintIfChanged(ev); }   // the first row replaces "nothing in the log yet"
        else ev.painted = null;
        syncTabs(ev);
      }
    },
    setBusy(value) {
      busy = !!value;
      for (const ev of evidence.values()) ev.github?.setBusy(busy);
      draw();
    },
    snapshot() {
      if (!P) return null;
      return { page: P.kind, id: P.id, project: P.project, hasDraft: hasDraft(P), confirming: P.confirm ? findAction(P.confirm)?.action || P.confirm : P.question ? QUESTION_ACTION[P.question] : null };
    },
    destroy() {
      destroyed = true; clearTimeout(release);
      document.removeEventListener('pointerup', letGo, true); document.removeEventListener('pointercancel', letGo, true);
      for (const ev of evidence.values()) ev.github?.destroy();
      evidence.clear(); pages.clear(); P = null; M = null;
      host.replaceChildren();
    },
  };
}

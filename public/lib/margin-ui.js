import { emptyLine } from './empty.js';
import { ATTENTION_TONES, BAR_LIMITS, COPY, GROUPS, MAIN, WORDS } from './control-panel-contract.js';
/** The bar: three identical cards — the project, the conversations, the builds — and a quiet foot
    (docs/CONTROL-PANEL.md §2.1; the lab's round six Cards, design/sidebar-lab/options/bar-cards-shell.*).

      nibbi ……………………… [⚙] [⊟]       the head: the logo on the icon column's edge, Settings left of collapse
      ╭ battalion   1 failed  ⌄ ╮       card 1: the project; its list opens under it
      ╭ conversations         + ╮       card 2: every conversation, two lines, the open one lifted while chat is the room
      ╭ builds       1 failed + ╮       card 3: main, then its copies (docs/BUILDS-AS-COPIES.md §4.3); + makes a copy
      │ ⎈ main          live  ▶ │         a row opens its page (the build page, a ticket); ▶ plays your checkout
      │ │ ∘ an improvement …    │         what shows: BAR_LIMITS; many failed fold to one row; the open ticket always shows
      │ │ + improvement         │         one inline form: start now (run.dispatch) · up next (issue.create)
      │ ⑂ dev   ready to play ⌃ │         a copy: its row opens its page, its caret folds what is inside it
      │ │ ∘ an improvement …    │         the same rows, on the copy's own trunk; + improvement lands them in the copy
      │ │ [▶ play] [ship to main]│        play it (one plays at a time), or open its page on the ship confirm
        2 merged today · 5 this week     the foot: the scroll's last item, holding the bottom edge once the cards run past it

    Authority stays with the caller. update(model) takes a BarModel (control-panel-contract.js): {projects: BarProjectVM[],
    projectsLoaded, projectsError?, activeProject, view: PageRef | null, busy, progress, link, settings}. Chat is the
    default: view null. Every row is keyed and kept across updates, so focus, a draft and a pulse survive a refresh. */
const SVG_NS = 'http://www.w3.org/2000/svg';
const glyphs = {
  sidebar: ['M4 4h16v16H4z', 'M9 4v16'],
  plus: ['M12 5v14', 'M5 12h14'],
  search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z', 'm16.2 16.2 3.8 3.8'],
  caret: ['m6 9 6 6 6-6'],
  check: ['m5.5 12.5 4 4 9-9.5'],
  settings: ['M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z', 'M9.5 3h5l.5 2.4 1.8 1 2.3-.7 2.5 4.3-1.8 1.6v.8l1.8 1.6-2.5 4.3-2.3-.7-1.8 1-.5 2.4h-5L9 18.6l-1.8-1-2.3.7L2.4 14l1.8-1.6v-.8L2.4 10l2.5-4.3 2.3.7 1.8-1L9.5 3Z'],
  // a conversation: the thread bubble, its corners rounded to sit with the trunk's round node
  bubble: ['M6.5 5h11A2.5 2.5 0 0 1 20 7.5v5a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.75V15.5A2.5 2.5 0 0 1 4 13V7.5A2.5 2.5 0 0 1 6.5 5Z'],
  // main: the trunk, its node filled (css) — the live build
  trunk: ['M12 3v5.25', 'M12 15.75V21', 'M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z'],
  // an improvement on the trunk: presence and rhythm, never its state (the words say that)
  node: ['M14.75 12a2.75 2.75 0 1 1-5.5 0 2.75 2.75 0 0 1 5.5 0Z'],
  play: ['M8 5.5v13l10.5-6.5L8 5.5Z'],
  // a copy: the branch off main's trunk (the lab's Tree glyph); its stem carries on down past what is inside it
  branch: ['M6 3v12.5', 'M20.5 6a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z', 'M8.5 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z', 'M18 8.5a9.5 9.5 0 0 1-9.5 9.5'],
  // catch up: main's newest pulled down into the copy
  pull: ['M12 4v11', 'm7.5 10.5 4.5 4.5 4.5-4.5', 'M6 20h12'],
};
const text = (value, fallback = '—') => value == null || value === '' ? fallback : String(value);
const PROJECTS_UNREACHABLE = 'couldn’t reach the projects list';
/** Words the bar says that the contract does not hold (reported to the integrator, who may move them there). */
const SAY = Object.freeze({
  ask: 'ask nibbi instead',
  empty: 'say what should change first',
  failed: 'that didn’t go through — try again',
  playTitle: 'play main — it runs your checkout',
  stopTitle: 'main is playing — press to stop it',
  // phase 2: a copy's row, its caret, its keys (the page carries the rest)
  copyStop: '{name} is playing — press to stop it',
  shipOpen: 'ship {name} to main — its page asks first',
  fold: 'fold {name}',
  unfold: 'show what is in {name}',
  catchTitle: 'bring main’s newest into {name} — nibbi checks it first; if that fails, {name} stays as it is',
  catchAsk: 'bring main’s newest into {name} — it’s playing, so its page asks first',
  addCopy: 'something to try on {name} — start it now, or keep it up next',
  play: 'play',
});
/** + New build's name rule, as the model's copyNameProblem says it (builds-model.js; the bar imports only the
    contract, so the rule is said twice and tests/margin-ui.test.mjs holds the two to the same words). */
const COPY_NAME = new RegExp(COPY.namePattern);
const normalName = value => String(value ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
function nameProblem(name, taken = []) {
  const list = (Array.isArray(taken) ? taken : []).map(normalName), value = normalName(name);
  if (!value) return WORDS.copy.nameEmpty;
  if (value.length > COPY.nameMax) return WORDS.copy.nameLong;
  if (!COPY_NAME.test(value)) return WORDS.copy.nameShape;
  if (COPY.reserved.includes(value)) return fillIn(WORDS.copy.nameReserved, {name: value});
  if (list.includes(value)) return fillIn(WORDS.copy.nameTaken, {name: value});
  if (list.length >= COPY.limit) return WORDS.copy.tooMany;
  return '';
}
const relative = (at, now) => {
  if (!Number.isFinite(at)) return '';
  const seconds = Math.max(0, (now - at) / 1000);
  if (seconds < 90) return 'just now';
  for (const [unit, size] of [['m', 60], ['h', 3600], ['d', 86400]]) { const n = Math.floor(seconds / size); if (n < (unit === 'd' ? 7 : unit === 'h' ? 24 : 60)) return n + unit; }
  return Math.floor(seconds / 604800) + 'w';
};
const agoWords = (iso, now) => { const r = relative(Date.parse(iso), now); return r === 'just now' || !r ? r : `${r} ago`; };
const fillIn = (template, values) => String(template).replace(/\{(\w+)\}/g, (all, key) => values[key] ?? all);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const count = value => finite(value) ? Math.max(0, Math.floor(value)) : null;
const money = value => finite(value) ? `$${Math.max(0, value).toLocaleString(undefined, {maximumFractionDigits: 2})}` : '—';
/** Companion progress line. Reports what merged; never proposes what to do next. Lowercase, as every state line in the bar is
    (LANGUAGE §11; D13 closed 2026-09-29, docs/CONTROL-PANEL.md §12.3). */
export function progressLine(progress) {
  const today = progress && progress.available !== false ? count(progress.today?.deliveries) : null;
  if (today === null) return 'progress not available';
  const week = count(progress.week?.deliveries) ?? 0, streak = count(progress.streak) ?? 0;
  const parts = [today === 0 ? 'nothing merged yet today' : `${today} merged today`];
  if (week > 0) parts.push(`${week} this week`);
  if (streak > 0) parts.push(`${streak}-day streak`);
  return parts.join(' · ');
}
function node(tag, className, value) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (value != null) el.textContent = value;
  return el;
}
function button(label, className, click) {
  const el = node('button', className, label);
  el.type = 'button';
  if (click) el.addEventListener('click', click);
  return el;
}
function icon(kind) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of glyphs[kind] || []) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d); svg.append(path);
  }
  return svg;
}
/** The icon column: every row and header has this 16px slot at x 24–40. A row puts its glyph in it; a header
    leaves it empty, so its label stands on the words' edge (48) like every row's first word. */
function glyphSpan(kind, className = '') {
  const s = node('span', `cp-glyph ${className}`.trim());
  if (kind) s.append(icon(kind)); else s.classList.add('cp-lead');
  s.setAttribute('aria-hidden', 'true');
  return s;
}
/** A two-line row's lines: line one (the primary, and a word on the right), line two (the secondary, and a word). */
function lines(first, second) {
  const a = node('span', 'cp-line-1'); a.append(...first.filter(Boolean));
  const b = node('span', 'cp-line-2'); b.append(...second.filter(Boolean));
  const l = node('span', 'cp-lines'); l.append(a, b);
  return l;
}
const setText = (el, value) => { const v = value == null ? '' : String(value); if (el.textContent !== v) el.textContent = v; };
const setAttr = (el, name, value) => { if (value == null || value === false) el.removeAttribute(name); else if (el.getAttribute(name) !== String(value)) el.setAttribute(name, String(value)); };
/** Put `nodes` in `parent`, in order, moving as little as possible: stale nodes go first, so a row that
    leaves never drags the focused one (or the open form) along with it. */
function patch(parent, nodes) {
  const want = nodes.filter(Boolean), keep = new Set(want);
  for (const child of [...parent.children]) if (!keep.has(child)) child.remove();
  want.forEach((n, i) => { if (parent.children[i] !== n) parent.insertBefore(n, parent.children[i] || null); });
}
const groupOf = state => GROUPS.find(g => g.states.includes(state))?.id || 'settled';
const EMPTY_MAIN = Object.freeze({ id: MAIN, name: MAIN, line: WORDS.mainLine, word: 'live', badge: { text: '', tone: 'quiet' }, attention: { text: '', tone: 'quiet' },
  play: { playable: false, running: false, starting: false, url: null, blocked: '', note: '', lastCommit: '' }, improvements: [], settled: [], list: 'loading',
  blocked: { start: '', queue: '', play: '' } });

export function installMarginUI({ onAction, onVisibility } = {}) {
  const left = document.getElementById('project-rail');
  const right = document.getElementById('settings-rail');
  if (!left || !right) throw new Error('Margin UI requires #project-rail and #settings-rail');
  let model = {projects: [], settings: {}, busy: false}, opened = null, cardTrigger = null, destroyed = false, serial = 0;
  let menuOpen = false, query = '';
  const projects = new Map(), pending = new Set(), bindings = new Set(), cards = new Set();
  let visibleKey = '';
  function notifyVisibility() {
    // Only the project you are in: widening it to every project cost a read per row, and those reads landed
    // later as "records updated" and replaced a panel someone was part-way through.
    const ids = [String(model.activeProject ?? '')].filter(id => projects.has(id));
    const key = JSON.stringify(ids); if (key === visibleKey) return; visibleKey = key;
    queueMicrotask(() => { if (!destroyed) onVisibility?.(ids); });
  }
  const hadClass = document.body.classList.contains('margin-ui-active');
  document.body.classList.add('margin-ui-active');
  left.classList.add('margin-rail', 'margin-projects', 'cp-rail');
  right.classList.add('margin-rail', 'margin-settings', 'cp-settings-rail');
  left.setAttribute('aria-label', 'Projects'); right.setAttribute('aria-label', 'Settings');
  const narrow = matchMedia('(max-width: 899px)');
  const sidebar = node('aside', 'workspace-sidebar cp-bar'); sidebar.id = 'workspace-sidebar';
  sidebar.setAttribute('aria-label', 'Conversations, builds and settings');
  // iOS paints no :active without a touch listener on the element or an ancestor.
  const touch = () => {};
  sidebar.addEventListener('touchstart', touch, {passive: true});

  // ---- the head: nibbi ……… [⚙] [⊟]. Not a card: the bar's own name. ----------------------------
  const head = node('div', 'sidebar-head cp-head');
  const brand = node('span', 'sidebar-brand', 'nibbi');
  const headKeys = node('span', 'cp-head-keys');
  const toggle = button('', 'sidebar-toggle', () => setSidebar(!sidebarOpen, true));
  toggle.id = 'sidebar-toggle'; toggle.append(icon('sidebar'));
  toggle.setAttribute('aria-controls', sidebar.id);
  toggle.addEventListener('touchstart', touch, {passive: true});
  // With the bar closed (always, on a phone) what the project wants from you rides on the toggle, in
  // words. Described by, not labelled by: the label stays exactly what pressing it does.
  const toggleCount = node('span', 'sidebar-toggle-count'); toggleCount.id = 'sidebar-toggle-count';
  toggle.append(toggleCount); toggle.setAttribute('aria-describedby', toggleCount.id);
  const collapse = button('', 'sidebar-collapse cp-icon-key', () => setSidebar(false, true));
  collapse.append(icon('sidebar')); collapse.setAttribute('aria-label', 'Close sidebar'); collapse.title = 'put the bar away';
  headKeys.append(right, collapse);
  head.append(brand, headKeys);
  const backdrop = button('', 'sidebar-backdrop', () => setSidebar(false, true));
  backdrop.tabIndex = -1; backdrop.setAttribute('aria-label', 'Close sidebar');
  let sidebarOpen = false, desktopOpen = true;
  try { desktopOpen = JSON.parse(localStorage.getItem('nibbi.sidebarOpen') ?? 'true') !== false; } catch { /* private mode */ }
  const inerted = new Set();
  function restoreWorkspace() { for (const el of inerted) el.inert = false; inerted.clear(); }
  function setSidebar(value, focus = false) {
    const shouldFocus = focus || (!value && sidebar.contains(document.activeElement));
    if (!value) { close(); closeMenu(false); }
    sidebarOpen = value;
    if (!narrow.matches) {
      desktopOpen = value;
      try { localStorage.setItem('nibbi.sidebarOpen', JSON.stringify(value)); } catch { /* private mode */ }
    }
    document.body.classList.toggle('sidebar-open', value);
    sidebar.inert = !value;
    sidebar.setAttribute('aria-hidden', String(!value));
    toggle.hidden = value;
    toggle.setAttribute('aria-expanded', String(value));
    toggle.setAttribute('aria-label', value ? 'Close sidebar' : 'Open sidebar');
    backdrop.hidden = !value || !narrow.matches;
    sidebar.setAttribute('role', narrow.matches ? 'dialog' : 'complementary');
    if (narrow.matches && value) sidebar.setAttribute('aria-modal', 'true');
    else sidebar.removeAttribute('aria-modal');
    restoreWorkspace();
    if (narrow.matches && value) for (const el of document.body.children) {
      if (![sidebar, backdrop, toggle].includes(el) && !el.inert && !['SCRIPT','STYLE','LINK'].includes(el.tagName)) { el.inert = true; inerted.add(el); }
    }
    if (shouldFocus) (value ? collapse : toggle).focus({preventScroll: true});
    document.dispatchEvent(new CustomEvent('nibbi:sidebar'));
    notifyVisibility();
    scheduleShade();
  }
  const resizeSidebar = () => { close(); setSidebar(narrow.matches ? false : desktopOpen); };
  narrow.addEventListener('change', resizeSidebar);
  sidebar.append(head, left); document.body.append(backdrop, sidebar, toggle);
  const list = node('div', 'margin-project-list');
  const empty = emptyLine('Loading projects…');
  const globalError = node('p', 'margin-error margin-global-error');
  globalError.setAttribute('role', 'status'); globalError.hidden = true;
  const keyFor = (action, id, value) => JSON.stringify([action, id ?? null, typeof value === 'string' ? value : null]);
  function refreshDisabled() {
    for (const b of bindings) {
      b.el.disabled = !!b.unavailable() || pending.has(b.key);
      b.el.setAttribute('aria-busy', String(pending.has(b.key)));
    }
  }
  function bind(el, action, id, unavailable = () => false) {
    bindings.add({el, key: keyFor(action, id), unavailable});
    return el;
  }
  async function dispatch(action, id, value, error = opened?.error || globalError) {
    const key = keyFor(action, id, value);
    if (destroyed || pending.has(key)) return false;
    pending.add(key); error.textContent = ''; error.hidden = true; refreshDisabled();
    try {
      if (typeof onAction === 'function') await onAction(action, id, value);
      return true;
    } catch (cause) {
      if (!destroyed) { error.textContent = text(cause?.message || cause, 'Could not complete this action.'); error.dataset.kind = cause?.kind === 'notice' ? 'notice' : 'error'; error.hidden = false; }
      return false;
    } finally { pending.delete(key); if (!destroyed) refreshDisabled(); }
  }
  /** Dispatch and report, never throw: the form says what happened in its own note. */
  async function send(action, id, value) {
    try { await onAction?.(action, id, value); return {ok: true}; }
    catch (cause) { return {ok: false, error: text(cause?.message || cause, SAY.failed), kind: cause?.kind}; }
  }
  function close(restore = false) {
    if (!opened) return;
    const lastTrigger = cardTrigger;
    opened.el.hidden = true;
    if (opened.confirm) opened.confirm.hidden = true;
    cardTrigger?.setAttribute('aria-expanded', 'false');
    opened = null; cardTrigger = null;
    if (restore && lastTrigger?.isConnected) lastTrigger.focus({preventScroll: true});
  }
  function open(card, source) {
    if (opened === card) { close(); return; }
    close(); opened = card; cardTrigger = source;
    // The list stays open behind the card. Closing it would hide the gear the card was opened from,
    // and Escape has to be able to put focus back on it.
    card.el.hidden = false;
    source?.setAttribute('aria-expanded', 'true');
    // Modeless: focus the card, but do not trap keyboard users in it.
    card.el.focus({preventScroll: true});
  }
  function makeCard(title, side = 'left') {
    const el = node('section', `margin-card margin-card-${side}`);
    el.hidden = true; el.tabIndex = -1; el.setAttribute('role', 'dialog');
    const heading = node('h2', '', title); heading.id = `margin-heading-${++serial}`;
    el.setAttribute('aria-labelledby', heading.id);
    const head = node('div', 'margin-card-head');
    head.append(heading, button('×', 'margin-close', () => close(true)));
    head.lastChild.setAttribute('aria-label', 'Close');
    const body = node('div', 'margin-card-body');
    const error = node('p', 'margin-error'); error.hidden = true; error.setAttribute('role', 'status');
    // Keep the title and dismissal outside the scrolling content, including on short windows.
    const scroll = node('div', 'margin-card-scroll'); scroll.tabIndex = 0;
    scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-labelledby', heading.id);
    scroll.append(body, error);
    el.append(head, scroll); sidebar.append(el);
    const card = {el, heading, body, error}; cards.add(card); return card;
  }
  function disclose(el, card) {
    if (!card.el.id) card.el.id = `margin-popover-${++serial}`;
    el.setAttribute('aria-haspopup', 'dialog'); el.setAttribute('aria-controls', card.el.id); el.setAttribute('aria-expanded', 'false');
  }
  const newProject = () => { closeMenu(false); close(); void dispatch('newProject'); };
  const add = bind(button('', 'margin-project margin-new cp-row', newProject), 'newProject');
  add.append(glyphSpan('plus'), node('span', 'margin-project-name cp-primary', 'new project'));
  const progressStatus = node('p', 'margin-muted sidebar-progress', progressLine(undefined));
  progressStatus.id = 'sidebar-progress'; progressStatus.setAttribute('role', 'status');

  // ---- card 1: the project. Its one row is the header component: [icon slot] title · badge · caret. ----
  const switcher = node('div', 'margin-switcher cp-card cp-project');
  const trigger = button('', 'margin-project margin-switch-trigger cp-card-head', () => (menuOpen ? closeMenu(true) : openMenu(false)));
  trigger.setAttribute('aria-haspopup', 'true'); trigger.setAttribute('aria-expanded', 'false');
  const triggerName = node('span', 'margin-project-name cp-title');
  const triggerSummary = node('span', 'margin-project-summary cp-badge');
  const triggerCaret = node('span', 'project-caret cp-trail'); triggerCaret.append(icon('caret'));
  trigger.append(glyphSpan(null), triggerName, triggerSummary, triggerCaret);
  // The rollup is a control, not a caption: the sentence about the other projects is also the way
  // to reach the first one that wants something. A quiet line inside the project's card.
  const rollup = button('', 'margin-muted margin-rollup cp-roll', () => {
    openMenu(false);
    const wanted = list.querySelector('.project-group.needs-you:not([hidden]) .margin-project');
    (wanted || search).focus({ preventScroll: true });
  });
  rollup.hidden = true;
  const menu = node('div', 'margin-switch-menu'); menu.hidden = true;
  menu.setAttribute('aria-label', 'Projects');
  const searchWrap = node('div', 'margin-switch-search');
  const search = document.createElement('input');
  search.type = 'text'; search.placeholder = 'find a project'; search.autocomplete = 'off'; search.spellcheck = false;
  search.setAttribute('aria-label', 'Find a project');
  search.addEventListener('input', () => { query = search.value; renderMenu(); });
  searchWrap.append(icon('search'), search);
  menu.append(searchWrap, list, empty, add);
  switcher.append(trigger, rollup, menu);

  // ---- the body: THE ONE SCROLL. Cards 2 and 3, then the foot; each card's header sticks inside it. ----
  const body = node('div', 'margin-body cp-body');
  const none = node('div', 'cp-none'); none.hidden = true;
  let noneKey = '';
  function group(kind) {
    const el = node('section', 'cp-card cp-group'); el.dataset.cpGroup = kind;
    const headRow = node('div', 'cp-card-head cp-group-head');
    const label = node('h2', 'cp-label', kind); label.id = `cp-${kind}-${++serial}`;
    el.setAttribute('aria-labelledby', label.id);
    const badge = node('span', 'cp-badge'); badge.hidden = true;
    headRow.append(glyphSpan(null), label, badge);
    const rows = node('div', kind === 'conversations' ? 'project-threads cp-rows' : 'cp-builds');
    el.append(headRow, rows);
    return {el, head: headRow, label, badge, rows};
  }
  const convo = group('conversations'), builds = group('builds');
  const newThreadKey = button('', 'project-thread-new cp-icon-key cp-trail', () => { const id = shownProject(); if (id != null && !model.busy) void dispatch('newThread', id); });
  newThreadKey.append(icon('plus')); newThreadKey.setAttribute('aria-label', 'New thread');
  convo.head.append(newThreadKey);
  const link = node('p', 'margin-muted margin-link'); link.hidden = true; link.setAttribute('role', 'status');
  // The foot: the scroll's last item. Right under the last card, or holding the bottom edge once the cards
  // run past it, with the cards fading out under it.
  const foot = node('div', 'margin-foot cp-foot');
  foot.append(progressStatus, link, globalError);
  body.append(none, convo.el, builds.el, foot);
  left.append(switcher, body);
  function setBadge(g, words, tone = 'quiet', live = false) {
    setText(g.badge, words || ''); g.badge.hidden = !words; g.badge.dataset.tone = tone || 'quiet';
    g.badge.classList.toggle('cp-live', !!live);
  }

  // ---- card 3's fixed parts: main, its ▶, its body, the form and + improvement ----------------------
  const mainEl = node('div', 'cp-build'); mainEl.dataset.build = MAIN;
  const mainWrap = node('div', 'cp-rowwrap cp-mainrow');
  const mainRow = button('', 'cp-row cp-two cp-main', () => { const id = shownProject(); if (id != null) navigate(() => void dispatch('openBuild', id, MAIN)); });
  mainRow.dataset.barBuild = MAIN;
  const mainName = node('span', 'cp-primary'), mainWord = node('span', 'cp-word', 'live');
  const mainNote = node('span', 'cp-note'), mainPlaying = node('span', 'cp-word', 'playing');
  mainRow.append(glyphSpan('trunk'), lines([mainName, mainWord], [mainNote, mainPlaying]));
  const playKey = button('', 'cp-key cp-play cp-trail', () => {
    const id = shownProject(); if (id == null) return;
    void dispatch('playMain', id, {action: currentBuild().play?.running ? 'stop' : 'start'});
  });
  playKey.dataset.cpRole = 'play-main'; playKey.append(icon('play'));
  mainWrap.append(mainRow, playKey);
  const mainWhy = node('p', 'cp-why cp-main-why'); mainWhy.hidden = true;
  const mainBody = node('div', 'cp-build-body'); mainBody.id = `cp-build-body-${++serial}`;
  mainBody.setAttribute('role', 'group'); mainBody.setAttribute('aria-label', `inside ${MAIN}`);
  mainEl.append(mainWrap, mainWhy, mainBody);
  builds.rows.append(mainEl);
  const form = makeForm();
  const addKey = button('', 'cp-row cp-add', () => (form.isOpenFor(MAIN) ? form.close(true) : form.open(MAIN)));
  addKey.dataset.cpRole = 'new-improvement'; addKey.dataset.build = MAIN; addKey.setAttribute('aria-expanded', 'false'); addKey.setAttribute('aria-controls', form.el.id);
  addKey.append(glyphSpan('plus'), node('span', 'cp-primary', WORDS.keys.improvement));
  addKey.setAttribute('aria-label', `New improvement on ${MAIN}`);
  addKey.title = 'something main should do better — start it now, or keep it up next';
  const listLine = node('p', 'cp-why cp-empty cp-list-line');
  const emptyImprovements = node('p', 'cp-why cp-empty', WORDS.emptyImprovements);
  // + New build: a quiet key on the builds header's trailing column (as the conversations +), and its form under
  // the header. Drawn only when the model says what it may do (BarProjectVM.newCopy); never disabled — touch has
  // no title, so pressing it opens the form, which says why when no copy can be made now.
  const buildForm = makeBuildForm();
  const newBuildKey = button('', 'project-build-new cp-icon-key cp-trail', () => (buildForm.isOpen ? buildForm.close(true) : buildForm.open()));
  newBuildKey.dataset.cpRole = 'new-build'; newBuildKey.append(icon('plus'));
  newBuildKey.setAttribute('aria-label', WORDS.copy.newLabel); newBuildKey.setAttribute('aria-expanded', 'false'); newBuildKey.setAttribute('aria-controls', buildForm.el.id);
  builds.el.insertBefore(buildForm.el, builds.rows);

  const settings = makeCard('Settings', 'right');
  const metadata = node('dl', 'margin-metadata');
  const meta = {};
  for (const [key, label] of [['brain','Brain'],['session','Session'],['model','Model'],['provider','Provider'],['context','Context']]) {
    const row = node('div', 'margin-data-row'); const value = node('dd', '', '—');
    row.append(node('dt', '', label), value); metadata.append(row); meta[key] = value;
  }
  const prefs = {};
  for (const [action, label, id] of [['microphone','Hey Nibbi microphone','st-microphone'], ['voice','Spoken replies','st-voice'], ['sounds','Sound effects','st-sounds'], ['notifications','Notifications','st-notifications'], ['calm','Calm motion','st-motion'], ['glass','Glass window','st-glass'], ['demo','Demo brain','st-demo']]) {
    const el = bind(button('', 'margin-pref', () => void dispatch(action, undefined, undefined, settings.error)), action, undefined,
      () => action === 'calm' && !!model.settings.systemReduced || action === 'notifications' && model.settings.notificationsSupported === false);
    el.id = id; const value = node('span', 'margin-pref-value', 'Off');
    el.append(node('span', '', label), value); el.setAttribute('aria-pressed', 'false');
    settings.body.append(el); prefs[action] = {el, value};
  }
  const microphoneNote = node('p', 'margin-muted margin-pref-note', 'Turn on the microphone, then say “Hey Nibbi”. Spoken replies only controls Nibbi’s answers.');
  settings.body.append(microphoneNote);
  const notificationNote = node('p', 'margin-muted margin-pref-note'); settings.body.append(notificationNote);
  const actions = node('div', 'margin-actions');
  for (const [action, label, id] of [['advancedSettings','Advanced settings','st-platform'], ['model','Model & providers','st-model'], ['tidy','Tidy conversation','st-clear']]) {
    const el = bind(button(label, 'margin-pill', () => { close(); void dispatch(action); }), action); el.id = id; actions.append(el);
  }
  settings.body.append(actions);
  settings.body.append(metadata);
  // Settings is a key in the head, immediately left of collapse; its card opens from the top, beside it.
  const settingsKey = button('', 'cp-icon-key cp-settings-key', () => open(settings, settingsKey));
  settingsKey.id = 'status';
  settingsKey.setAttribute('aria-label', 'Settings'); settingsKey.title = 'settings — voice, sounds, glass, the model';
  settingsKey.append(icon('settings'));
  right.append(settingsKey); disclose(settingsKey, settings);

  /** A row in the project list: the project, what it wants from you in words, and its settings. */
  function createProject(id) {
    const entry = {id, data: {}, dirty: false, card: null};
    const group = node('div', 'project-group');
    const headingRow = node('div', 'project-heading-row');
    const row = button('', 'margin-project cp-row', () => select(entry));
    row.dataset.projectId = id;
    const mark = node('span', 'cp-glyph'); mark.setAttribute('aria-hidden', 'true');
    const name = node('span', 'margin-project-name cp-primary');
    const summary = node('span', 'margin-project-summary cp-word'); row.append(mark, name, summary);
    const options = button('', 'project-options cp-icon-key cp-trail', () => open(cardFor(entry), options)); options.append(icon('settings'));
    options.setAttribute('aria-haspopup', 'dialog'); options.setAttribute('aria-expanded', 'false');   // aria-controls waits for the card: it must not name an id that does not exist
    headingRow.append(row, options); group.append(headingRow);
    Object.assign(entry, {group, row, mark, name, summary, options, marked: false});
    list.append(group); projects.set(id, entry); return entry;
  }
  /* A project's card is built the first time it is opened. Every project used to mint a full hidden
     dialog at mount, with a dozen bound controls that were then walked on every refresh — a cost
     paid for sixty projects to look at one. */
  function cardFor(entry) {
    if (entry.card) return entry.card;
    const card = entry.card = makeCard('Project');
    buildProjectCard(entry, card, entry.id);
    disclose(entry.options, card);
    paintCard(entry); refreshDisabled();
    return card;
  }
  /** Everything inside the project card: where it works, how it automates, what it may spend, and the two doors. */
  function buildProjectCard(entry, card, id) {
    const branch = node('p', 'margin-muted'), goal = node('p', 'margin-goal');
    const stats = node('p', 'margin-project-stats');
    card.body.append(branch, goal, stats);
    const segmentLabel = node('p', 'margin-field-label', 'Automation');
    const segment = node('div', 'margin-segment'); segment.setAttribute('role', 'group'); segment.setAttribute('aria-label', 'Automation mode');
    const modeButtons = {};
    for (const mode of ['off','suggest','stage','ship']) {
      const el = bind(button(mode, 'margin-mode', () => {
        if (mode === 'ship') { card.confirm.hidden = false; confirmShip.focus(); }
        else { card.confirm.hidden = true; void dispatch('autoMode', id, mode, card.error); }
      }), 'autoMode', id, () => !!model.busy);
      el.dataset.mode = mode;
      segment.append(el); modeButtons[mode] = el;
    }
    // What automation works (the owner's decision, 2026-09-29): up next, into main or a copy — or, while a /goal is set, the roadmap.
    const autoLine = node('p', 'margin-muted margin-auto-line');
    // Where stage and ship build: main, or one of the project's copies. Drawn only when there is a copy to choose.
    const intoField = node('div', 'margin-into-field'); intoField.hidden = true;
    const into = node('div', 'margin-segment margin-into'); into.setAttribute('role', 'group'); into.setAttribute('aria-label', WORDS.auto.intoGroup);
    intoField.append(node('p', 'margin-field-label', WORDS.auto.into), into);
    const autoNote = node('p', 'margin-muted margin-auto-note'); autoNote.hidden = true;
    const confirm = node('div', 'margin-confirm'); confirm.hidden = true;
    confirm.append(node('p', '', 'Ship can automatically merge changes. Enable it for this project?'));
    const confirmShip = bind(button('Enable ship', 'margin-pill margin-primary', () => {
      void dispatch('autoMode', id, 'ship', card.error).then(ok => { if (ok) confirm.hidden = true; });
    }), 'autoMode', id, () => !!model.busy);
    confirm.append(confirmShip, button('Cancel', 'margin-pill', () => {confirm.hidden = true; modeButtons.ship.focus();})); card.confirm = confirm;
    card.body.append(segmentLabel, segment, autoLine, intoField, autoNote, confirm);
    const capForm = node('form', 'margin-cap'); const capLabel = node('label', '', 'Spend cap ($)');
    const cap = node('input'); cap.type = 'number'; cap.min = '0'; cap.step = '0.01'; cap.inputMode = 'decimal';
    cap.id = `margin-cap-${++serial}`; capLabel.htmlFor = cap.id;
    cap.addEventListener('input', () => {entry.dirty = true; cap.setCustomValidity('');});
    const saveCap = bind(button('Save', 'margin-pill'), 'spendCap', id, () => !!model.busy); saveCap.type = 'submit';
    capForm.append(capLabel, cap, saveCap);
    capForm.addEventListener('submit', event => {
      event.preventDefault(); const draft = cap.value, value = cap.valueAsNumber;
      if (!finite(value) || value < 0) {cap.setCustomValidity('Enter a cap of zero or more.'); cap.reportValidity(); return;}
      cap.setCustomValidity('');
      void dispatch('spendCap', id, value, card.error).then(ok => { if (ok && cap.value === draft) entry.dirty = false; });
    });
    const capHint = node('p', 'margin-muted', '0 means no cap.');
    capHint.id = `${cap.id}-hint`; cap.setAttribute('aria-describedby', capHint.id);
    card.body.append(capForm, capHint);
    const projectActions = node('div', 'margin-actions');
    for (const [action, label] of [['repository','Repository & GitHub'], ['providers','Providers']]) {
      const el = bind(button(label, 'margin-pill', () => void dispatch(action, id, undefined, card.error)), action, id,
        () => action !== 'repository' && !!model.busy);
      projectActions.append(el);
    }
    card.body.append(projectActions);
    Object.assign(entry, {branch, goal, stats, autoLine, intoField, into, intoButtons: new Map(), intoKey: '', autoNote, modeButtons, cap});
  }
  function select(entry) {
    closeMenu(false); close();
    void dispatch('selectProject', entry.id);
  }

  // ---- the project list -------------------------------------------------------------------------
  function openMenu(focusCurrent) {
    if (!sidebarOpen) return;
    close();
    menuOpen = true; menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    renderMenu();
    if (focusCurrent) (list.querySelector('.is-active') || list.querySelector('[data-project-id]'))?.focus({preventScroll: true});
  }
  function closeMenu(restore) {
    if (!menuOpen) return false;
    menuOpen = false; menu.hidden = true;
    query = ''; search.value = '';
    trigger.setAttribute('aria-expanded', 'false');
    if (restore) trigger.focus({preventScroll: true});
    return true;
  }
  function menuKeys(event) {
    const rows = [...list.querySelectorAll('[data-project-id]')].filter(el => !el.closest('[hidden]'));
    if (!rows.length) return;
    const here = rows.indexOf(document.activeElement);
    const go = el => { event.preventDefault(); el?.focus({preventScroll: true}); };
    if (event.key === 'ArrowDown') go(rows[here + 1] || rows[0]);
    else if (event.key === 'ArrowUp') go(here <= 0 ? rows[rows.length - 1] : rows[here - 1]);
    else if (event.key === 'Enter' && event.target === search) { event.preventDefault(); rows[0].click(); }
    else if (event.target !== search && event.key === 'Home') go(rows[0]);
    else if (event.target !== search && event.key === 'End') go(rows[rows.length - 1]);
  }

  // ---- what a project wants from you, in words. Never a dot. --------------------------------
  const attentionOf = data => {
    const words = data?.attention || data?.builds?.[0]?.attention || null;
    return words && words.text ? {text: String(words.text), tone: words.tone || 'quiet'} : {text: '', tone: 'quiet'};
  };
  const wantsYou = data => { const a = attentionOf(data); return !!a.text && ATTENTION_TONES.includes(a.tone); };
  function rollupLine() {
    const others = (model.projects || []).filter(p => String(p.id) !== String(model.activeProject) && wantsYou(p));
    if (!others.length) return '';
    return others.length === 1 ? `${text(others[0].name, 'another project')} needs you` : `${others.length} others need you`;
  }
  const activeEntry = () => projects.get(String(model.activeProject)) || [...projects.values()][0] || null;
  const shownProject = () => activeEntry()?.id ?? null;
  const nowMs = () => finite(model.now) ? model.now : Date.now();
  /** The page open in the main area, when it belongs to the project on screen; null is the chat. */
  const pageHere = () => { const v = model.view, id = shownProject(); return v && id != null && String(v.project) === String(id) && v.page ? v : null; };
  const currentBuild = () => { const data = activeEntry()?.data; return data ? mainOf(data) : EMPTY_MAIN; };

  function renderMenu() {
    const q = query.trim().toLowerCase();
    let shown = 0;
    for (const entry of projects.values()) {
      const match = !q || String(entry.data.name ?? entry.id).toLowerCase().includes(q);
      entry.group.hidden = !match;
      if (match) shown++;
    }
    empty.hidden = shown > 0 || !menuOpen;
    if (menuOpen && !shown) empty.textContent = 'no project matches';
  }
  function renderSwitcher() {
    const entry = activeEntry();
    const loading = model.projectsLoaded === false, unreachable = loading && !!model.projectsError;
    if (!entry) {
      // Nothing to name yet: "No project · no branch · quiet" described a project that does not exist.
      // And a list that never arrived is not still loading: it says so, and Retry is in the body below.
      trigger.dataset.currentProject = '';
      setText(triggerName, unreachable ? 'Projects' : loading ? 'Loading projects…' : 'No projects yet');
      setText(triggerSummary, loading ? '' : 'make one to start');   // unreachable: the body below says it once
      triggerSummary.dataset.tone = 'quiet';
      trigger.setAttribute('aria-label', unreachable ? 'Projects: ' + PROJECTS_UNREACHABLE : loading ? 'Loading projects' : 'No projects yet. Make one to start');
      trigger.title = '';
      rollup.hidden = true;
      return;
    }
    const data = entry.data;
    const name = text(data.name, 'No project');
    const words = attentionOf(data);
    // Not data-project-id: that belongs to the rows you can choose. The trigger names the one
    // you are already in, and the two must not be the same selector.
    trigger.dataset.currentProject = entry.id;
    setText(triggerName, name);
    setText(triggerSummary, words.text);
    triggerSummary.dataset.tone = words.tone;
    const others = rollupLine();
    trigger.setAttribute('aria-label', `${name}${words.text ? '. ' + words.text : ''}. Switch project${others ? `. ${others}` : ''}`);
    trigger.title = others ? `switch project — ${others}` : `${name}${words.text ? ' — ' + words.text : ''}`;
    setText(rollup, others); rollup.hidden = !others;
  }
  function renderNone() {
    const unreachable = model.projectsLoaded === false && !!model.projectsError, loading = model.projectsLoaded === false;
    const key = unreachable ? 'unreachable' : loading ? 'loading' : 'none';
    if (key === noneKey) return;
    noneKey = key;
    if (unreachable) {
      const retry = button('Retry', 'margin-pill margin-empty-retry', () => void dispatch('refreshProjects'));
      none.replaceChildren(emptyLine(PROJECTS_UNREACHABLE), retry);
    } else if (loading) none.replaceChildren(emptyLine('Loading projects…'));
    else {
      const start = button('new project', 'margin-pill margin-empty-new', () => { close(); void dispatch('newProject'); });
      none.replaceChildren(emptyLine('no projects yet — a project is a repository nibbi can build in'), start);
    }
  }

  // ---- keyed rows: a row is made once per key and painted in place, so its focus and its pulse survive ----
  const rows = new Map();
  const keyOf = new WeakMap();
  let used = new Set();
  function keyed(key, make) {
    used.add(key);
    let entry = rows.get(key);
    if (!entry) { entry = make(); entry.sig = null; rows.set(key, entry); keyOf.set(entry.el, key); if (entry.outer) keyOf.set(entry.outer, key); }
    return entry;
  }
  const changed = (entry, sig) => { const s = JSON.stringify(sig); if (entry.sig === s) return false; entry.sig = s; return true; };

  // ---- card 2: every conversation, home first ------------------------------------------------------
  function conversationsOf(data) {
    if (Array.isArray(data.conversations)) return data.conversations;
    return (Array.isArray(data.threads) ? data.threads : []).map(t => ({...t, lastText: t.lastText || ''}));
  }
  function renderConversations(data) {
    const inChat = !model.view;
    const list = conversationsOf(data).filter(c => c && c.id != null && !c.archived);
    pruneThreadCards();
    patch(convo.rows, list.map(c => {
      const row = conversationRow(data, c);
      const current = inChat && !!c.active;
      setAttr(row.el, 'aria-current', current ? 'true' : null);
      if (row.outer !== row.el) row.outer.classList.toggle('is-current', current);
      return row.outer;
    }));
    const busy = !!model.busy;
    setBadge(convo, busy ? WORDS.answering : '', busy ? 'active' : 'quiet', busy);
    newThreadKey.disabled = busy;
    newThreadKey.title = busy ? 'not while nibbi is answering' : 'start a new conversation';
  }
  function conversationRow(data, c) {
    const entry = keyed(`t:${data.id}:${c.id}`, () => {
      const el = button('', 'project-thread cp-row cp-two', () => void dispatch('thread', entry.project, entry.thread.id));
      el.dataset.threadId = c.id; el.dataset.threadProject = data.id;
      const primary = node('span', 'cp-primary'), note = node('span', 'cp-note'), when = node('span', 'project-thread-when cp-word');
      el.append(glyphSpan('bubble'), lines([primary], [note, when]));
      const made = {el, outer: el, gear: null, primary, note, when, thread: c, project: data.id};
      // home is every message with no thread: it has no name to change and cannot be put away, so no gear
      if (c.id !== 'home') {
        // The gear beside the row rather than inside it: a button inside a button is not a button.
        const outer = node('div', 'project-thread-row cp-rowwrap');
        const gear = button('', 'project-options cp-icon-key cp-trail', () => {
          const card = threadCardFor(made.project, made.thread); paintThreadCard(card, made.thread); disclose(gear, card); open(card, gear);
        });
        gear.append(icon('settings'));
        gear.setAttribute('aria-haspopup', 'dialog'); gear.setAttribute('aria-expanded', 'false'); gear.title = 'rename or archive';
        outer.append(el, gear);
        Object.assign(made, {outer, gear});
      }
      return made;
    });
    entry.thread = c; entry.project = data.id;
    const title = text(c.title, 'Thread');
    const said = c.lastText || (c.id === 'home' ? WORDS.homeLine : '');
    if (changed(entry, [title, said, c.lastAt || '', text(data.name)])) {
      setText(entry.primary, title);
      entry.el.title = title;   // the whole name is reachable, clipped or not; line two carries its own
      setText(entry.note, said); setAttr(entry.note, 'title', said || null);
      entry.el.dataset.lastAt = c.lastAt || ''; entry.el.dataset.projectName = text(data.name);
      paintWhen(entry.el);
      if (entry.gear) entry.gear.setAttribute('aria-label', `Thread settings for ${title}`);
    }
    if (entry.gear) {
      const known = threadCards.get(threadCardKey(data.id, c.id));
      if (known) {
        disclose(entry.gear, known); paintThreadCard(known, c);
        if (opened === known) { entry.gear.setAttribute('aria-expanded', 'true'); cardTrigger = entry.gear; }   // the list re-rendered under an open card
      }
    }
    return entry;
  }
  /* A thread's card: its name, and a way to put it away. Built the first time its gear is used, like
     a project's, and dropped when the thread leaves the model. There is no delete: an archived
     conversation stays in the log, where history search still finds it. */
  const threadCards = new Map();
  const threadCardKey = (project, id) => JSON.stringify([String(project), id]);
  function threadCardFor(project, thread) {
    const key = threadCardKey(project, thread.id);
    if (threadCards.has(key)) return threadCards.get(key);
    const card = makeCard(text(thread.title, 'Thread'));
    card.el.classList.add('margin-thread-card');
    const form = node('form', 'margin-cap margin-rename');
    const label = node('label', '', 'Name'), field = node('input');
    field.type = 'text'; field.maxLength = 60; field.autocomplete = 'off'; field.spellcheck = false;
    field.id = `margin-thread-${++serial}`; label.htmlFor = field.id;
    field.addEventListener('input', () => { card.dirty = true; });
    const save = button('Save', 'margin-pill'); save.type = 'submit';
    form.append(label, field, save);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const title = field.value.trim(); if (!title) { field.focus(); return; }
      void dispatch('renameThread', card.thread.id, {project, title}, card.error).then(ok => { if (ok) card.dirty = false; });
    });
    const archive = button('Archive', 'margin-pill', () => { confirm.hidden = false; confirmArchive.focus(); });
    const confirm = node('div', 'margin-confirm'); confirm.hidden = true;
    confirm.append(node('p', '', 'Archive this conversation? It stays in the log.'));
    const confirmArchive = button('Archive', 'margin-pill margin-primary', () => void dispatch('archiveThread', card.thread.id, {project}, card.error).then(ok => {
      if (!ok) return;
      close();
      convo.rows.querySelector('[data-thread-id="home"]')?.focus({preventScroll: true});   // its row is gone; Home is where the conversation went
    }));
    confirm.append(confirmArchive, button('Cancel', 'margin-pill', () => { confirm.hidden = true; archive.focus(); }));
    const actions = node('div', 'margin-actions'); actions.append(archive);
    card.body.append(form, actions, confirm);
    Object.assign(card, {confirm, field, thread, dirty: false});
    threadCards.set(key, card);
    return card;
  }
  function paintThreadCard(card, thread) {
    card.thread = thread;
    setText(card.heading, text(thread.title, 'Thread'));
    if (!card.dirty && document.activeElement !== card.field) card.field.value = text(thread.title, '');
    return card;
  }
  function pruneThreadCards() {
    const live = new Set((model.projects || []).flatMap(p => conversationsOf(p).filter(t => t && !t.archived).map(t => threadCardKey(p.id, t.id))));
    for (const [key, card] of threadCards) if (!live.has(key)) {
      if (opened === card) close();
      card.el.remove(); cards.delete(card); threadCards.delete(key);
    }
  }
  /** "4m" is only true for a minute. A row keeps when it last spoke (or when its improvement moved), and the
      clock rewrites the words in place, so an open bar does not go on saying "just now" about this morning. */
  function paintWhen(el) {
    const now = nowMs();
    if (el.dataset.whenAt !== undefined) {
      const ago = el.dataset.whenAt ? agoWords(el.dataset.whenAt, now) : '';
      const said = ago ? `${el.dataset.whenVerb} ${ago}` : el.dataset.context || '';
      const note = el.querySelector('.cp-when'); if (note) setText(note, said);
      return;
    }
    const when = el.dataset.lastAt ? relative(Date.parse(el.dataset.lastAt), now) : '';
    const label = el.querySelector('.project-thread-when');
    if (label) setText(label, when);
    el.setAttribute('aria-label', `${el.title} thread in ${el.dataset.projectName}${when ? ', last message ' + when : ''}`);
  }
  const clock = setInterval(() => { for (const el of body.querySelectorAll('.project-thread[data-last-at], .cp-improvement[data-when-at]')) paintWhen(el); }, 60000);

  // ---- card 3: builds. main, holding its improvements on its trunk, then its copies on their own ---------
  const folds = new Set();   // `${scope}:${group}` shown whole this session; `${project}:copy:${copyId}` a copy folded away
  const holding = new Set();   // `${copyId}:play` · `${copyId}:catch` — a copy's key while what it sent is out
  const EMPTY_WORDS = {text: '', tone: 'quiet'};
  const isCopyVM = b => !!b && b.id != null && String(b.id) !== MAIN && (b.kind === 'copy' || b.kind === undefined);
  const copyFoldKey = (pid, b) => `${pid}:copy:${b.copyId || b.id}`;
  const mainOf = data => (Array.isArray(data.builds) ? data.builds : []).find(b => b && (b.kind === 'main' || String(b.id) === MAIN)) || data.builds?.[0] || EMPTY_MAIN;
  const copiesOf = data => (Array.isArray(data.builds) ? data.builds : []).filter(b => isCopyVM(b) && b !== mainOf(data));
  /** The copy whose page, or one of whose tickets, the main area shows. */
  const viewIn = (view, b) => !!view && ((view.page === 'build' && String(view.id) === String(b.id))
    || (view.page === 'ticket' && [...(b.improvements || []), ...(b.settled || [])].some(i => i && i.id === view.id)));
  let unfoldedFor = '';
  function renderBuilds(data) {
    const b = mainOf(data), copies = copiesOf(data);
    const words = data.buildsBadge || b.badge || EMPTY_WORDS;
    setBadge(builds, words.text, words.tone);
    const view = pageHere();
    const here = view?.page === 'build' && String(view.id ?? MAIN) === MAIN;
    // main: the trunk, its name and "live"; line two says where its work lands, and "playing" while it plays
    const line = text(b.line, WORDS.mainLine), word = text(b.word, 'live');
    const note = line.startsWith(word + ' · ') ? line.slice(word.length + 3) : line;   // "live" is line one's word already
    const play = b.play || EMPTY_MAIN.play, playing = !!play.running;
    const blocked = (b.blocked && b.blocked.play) || play.blocked || '';
    setText(mainName, text(b.name, MAIN)); setText(mainWord, word); setText(mainNote, note);
    mainPlaying.hidden = !playing;
    mainRow.title = `${text(b.name, MAIN)} — ${word}: ${note}${playing ? ', playing' : ''}. open its page`;
    mainRow.setAttribute('aria-label', `${text(b.name, MAIN)}, ${word} — ${note}${playing ? ', playing' : ''}. Open its page`);
    setAttr(mainRow, 'aria-current', here ? 'page' : null);
    mainWrap.classList.toggle('is-current', here);
    playKey.disabled = !!blocked;
    // one plays at a time: main's ▶ says which copy it would stop
    playKey.title = blocked || (playing ? SAY.stopTitle : play.stops ? fillIn(WORDS.copy.oneAtATime, {other: play.stops}) : SAY.playTitle);
    playKey.setAttribute('aria-label', `${playing ? 'Stop' : 'Play'} ${text(b.name, MAIN)}`);
    setAttr(playKey, 'aria-pressed', playing ? 'true' : null);
    setAttr(playKey, 'aria-busy', play.starting ? 'true' : null);
    setText(mainWhy, blocked); mainWhy.hidden = !blocked;
    const pid = data.id;
    // a page or ticket of a copy that just opened unfolds it (its fold is remembered again after that)
    const viewKey = view ? `${view.project}:${view.page}:${view.id}` : '';
    if (viewKey !== unfoldedFor) { unfoldedFor = viewKey; for (const c of copies) if (viewIn(view, c)) folds.delete(copyFoldKey(pid, c)); }
    // the one improvement form belongs to one build: back to main when its copy folds away or goes
    const owner = form.build, ownerCopy = owner === MAIN ? null : copies.find(c => String(c.id) === owner);
    if (owner !== MAIN && (!ownerCopy || folds.has(copyFoldKey(pid, ownerCopy)))) form.retarget(MAIN);
    patch(mainBody, bodyRows(pid, b, view, {scope: String(pid), bodyId: mainBody.id, isMain: true}));
    patch(builds.rows, [mainEl, ...copies.map(c => copyNode(pid, c, view))]);
    form.paint(form.build === MAIN ? b : copies.find(c => String(c.id) === form.build) || b);
    // + New build, when the model says what it may do; the key leaves the header (not hidden) when it doesn't,
    // so the badge still ends on the right-hand edge
    const newCopy = data.newCopy && typeof data.newCopy === 'object' ? data.newCopy : null;
    if (newCopy) { if (newBuildKey.parentNode !== builds.head) builds.head.append(newBuildKey); }
    else { buildForm.close(false); newBuildKey.remove(); }
    newBuildKey.title = newCopy?.blocked || WORDS.copy.newTitle;
    buildForm.paint(newCopy);
  }
  /** What shows inside a build, from the VM's ordered rows and BAR_LIMITS. The row whose ticket is open always
      shows — inside a fold, or, for a settled one, at the end — so exactly one row is marked. */
  function bodyRows(pid, b, view, scope) {
    const now = nowMs();
    const current = view?.page === 'ticket' ? view.id : null;
    const all = Array.isArray(b.improvements) ? b.improvements.filter(i => i && i.id != null) : [];
    const by = {waiting: [], building: [], up_next: [], in: [], failed: []};
    for (const imp of all) (by[imp.group] || by[groupOf(imp.state)])?.push(imp);
    const out = [];
    const rowOf = imp => improvementRow(pid, imp, current);
    out.push(...by.waiting.map(rowOf), ...by.building.map(rowOf));
    // up next: three, then a fold row; open, all of them and "show fewer"
    foldable(pid, scope, 'up_next', by.up_next, BAR_LIMITS.upNextShown, current, out);
    // in: only what landed in the last day, and at most three — the build page keeps the rest
    const recent = by.in.filter(i => i.when?.at && now - Date.parse(i.when.at) <= BAR_LIMITS.inWindowMs).slice(0, BAR_LIMITS.inShown);
    out.push(...by.in.filter(i => recent.includes(i) || i.id === current).map(rowOf));
    // failed and interrupted: every one when there are few, else one fold row and none until it is opened
    foldable(pid, scope, 'failed', by.failed, by.failed.length > BAR_LIMITS.failedFoldAbove ? 0 : Infinity, current, out);
    if (current && !all.some(i => i.id === current)) {
      const settled = (Array.isArray(b.settled) ? b.settled : []).find(i => i && i.id === current);
      if (settled) out.push(rowOf(settled));
    }
    const listState = b.list || 'ready';
    const unreadable = listState === 'unavailable';
    const [listEl, emptyEl] = scope.isMain ? [listLine, emptyImprovements] : [scope.listLine, scope.empty];
    setText(listEl, unreadable ? WORDS.noList : '');
    out.push(unreadable ? listEl : null);
    out.push(!unreadable && listState === 'ready' && !out.some(n => n && n.matches?.('.cp-row')) ? emptyEl : null);
    const build = scope.isMain ? MAIN : String(b.id);
    out.push(form.build === build ? form.el : null, scope.isMain ? addKey : scope.add);
    return out;
  }
  function foldable(pid, scope, groupId, items, limit, current, out) {
    if (!items.length) return;
    const key = `${scope.scope}:${groupId}`, whole = folds.has(key);
    if (items.length <= limit) { out.push(...items.map(imp => improvementRow(pid, imp, current))); return; }
    if (whole) { out.push(...items.map(imp => improvementRow(pid, imp, current)), foldRow(scope, groupId, [], true)); return; }
    const shown = new Set(items.slice(0, limit).map(i => i.id));
    if (current && items.some(i => i.id === current)) shown.add(current);
    const hidden = items.filter(i => !shown.has(i.id));
    let placed = false;
    for (const imp of items) {
      if (!placed && !shown.has(imp.id)) { out.push(foldRow(scope, groupId, hidden, false)); placed = true; }
      if (shown.has(imp.id)) out.push(improvementRow(pid, imp, current));
    }
  }
  function foldRow(scope, groupId, hidden, whole) {
    const entry = keyed(`f:${scope.scope}:${groupId}`, () => {
      const el = button('', 'cp-row cp-fold', () => {
        const k = `${entry.scope}:${groupId}`;
        if (folds.has(k)) folds.delete(k); else folds.add(k);
        rerender();
        entry.el.focus({preventScroll: true});
      });
      el.dataset.cpFold = groupId;
      const primary = node('span', 'cp-primary'), word = node('span', 'cp-word');
      el.append(glyphSpan('caret'), primary, word);
      return {el, primary, word};
    });
    entry.scope = scope.scope;
    entry.el.setAttribute('aria-controls', scope.bodyId);
    let said, tone = 'quiet', extra = '';
    if (whole) said = WORDS.showFewer;
    else if (groupId === 'up_next') said = fillIn(WORDS.foldUpNext, {n: hidden.length});
    else {
      // "failed" is a verdict and "interrupted" is not (the backend stopped under it): each says its own count
      const failed = hidden.filter(i => i.state === 'failed').length, stopped = hidden.length - failed;
      said = failed ? fillIn(WORDS.foldFailed, {n: failed}) : `${stopped} interrupted`;
      tone = failed ? 'error' : 'quiet';
      extra = failed && stopped ? `${stopped} interrupted` : '';
    }
    if (changed(entry, [said, tone, extra, whole])) {
      setText(entry.primary, said); entry.primary.dataset.tone = tone;
      setText(entry.word, extra); entry.word.hidden = !extra;
      entry.el.setAttribute('aria-expanded', String(whole));
      entry.el.setAttribute('aria-label', whole ? 'Show fewer' : `${said}${extra ? ', ' + extra : ''}. Show them`);
      entry.el.title = whole ? 'fold them away again' : `show them — ${said}${extra ? ' · ' + extra : ''}`;
    }
    return entry.el;
  }
  function improvementRow(pid, imp, current) {
    const entry = keyed(`i:${pid}:${imp.id}`, () => {
      const el = button('', 'cp-row cp-two cp-improvement', () => { const id = entry.project; navigate(() => void dispatch('openImprovement', id, entry.id)); });
      const primary = node('span', 'cp-primary'), note = node('span', 'cp-note cp-when'), word = node('span', 'cp-word'), reason = node('span', 'cp-note cp-reason');
      const l = lines([primary], []);
      el.append(glyphSpan('node', 'cp-node'), l);
      return {el, primary, note, word, reason, line2: l.lastElementChild};
    });
    entry.project = pid; entry.id = imp.id;
    const title = text(imp.title, 'an improvement'), said = text(imp.word, imp.state);
    const reason = ['failed', 'interrupted'].includes(imp.state) ? String(imp.reason || '') : '';
    const when = imp.when && imp.when.at ? imp.when : null;
    if (changed(entry, [title, imp.state, said, imp.tone, !!imp.live, imp.context || '', when?.verb || '', when?.at || '', reason])) {
      const el = entry.el;
      el.dataset.barImprovement = imp.id; el.dataset.state = imp.state;
      setText(entry.primary, title);
      setText(entry.word, said); entry.word.dataset.tone = imp.tone || 'quiet';
      entry.word.classList.toggle('cp-live', !!imp.live);
      // a failed one: its word floats on the right-hand edge and the reason wraps under it, never cut short
      entry.line2.classList.toggle('cp-sub-why', !!reason);
      if (reason) { setText(entry.reason, reason); patch(entry.line2, [entry.word, entry.reason]); }
      else patch(entry.line2, [entry.note, entry.word]);
      el.dataset.whenAt = when?.at || ''; el.dataset.whenVerb = when?.verb || ''; el.dataset.context = imp.context || '';
      paintWhen(el);
      const whenSaid = entry.note.textContent;
      el.title = `${title} — ${said}${whenSaid && !reason ? `, ${whenSaid}` : ''}${reason ? ` · ${reason}` : ''}. open its ticket`;
      el.setAttribute('aria-label', `${title}, ${said}${reason ? `. ${reason}` : ''}. Open its ticket`);
    }
    setAttr(entry.el, 'aria-current', current === imp.id ? 'page' : null);
    return entry.el;
  }

  // ---- a copy: its row and caret, and when unfolded what is inside it, on its own trunk ----------------------
  /** Two stable faces in one cell, so a key that says play, then playing, never changes width. */
  function stack(faces) {
    const s = node('span', 'cp-stack');
    for (const face of faces) { const f = node('span', 'cp-stack-face', face); f.dataset.face = face; s.append(f); }
    return s;
  }
  const showFace = (s, face) => { for (const f of s.children) setAttr(f, 'data-on', f.dataset.face === face ? '' : null); };
  function copyNode(pid, b, view) {
    const entry = keyed(`c:${pid}:${b.copyId || b.id}`, () => {
      const el = node('div', 'cp-build cp-copy');
      const wrap = node('div', 'cp-rowwrap cp-copyrow');
      const row = button('', 'cp-row cp-two cp-copy-row', () => { const e = entry; navigate(() => void dispatch('openBuild', e.project, e.name)); });
      const label = node('span', 'cp-primary'), word = node('span', 'cp-word'), note = node('span', 'cp-note cp-facts'), count = node('span', 'cp-word cp-count');
      row.append(glyphSpan('branch'), lines([label, word], [note, count]));
      const caret = button('', 'cp-icon-key cp-trail cp-disclose', () => {
        const e = entry, k = copyFoldKey(e.project, e.vm);
        if (folds.has(k)) folds.delete(k); else folds.add(k);
        rerender();
        e.caret.focus({preventScroll: true});
      });
      caret.dataset.cpRole = 'build-disclosure'; caret.append(icon('caret'));
      wrap.append(row, caret);
      const inside = node('div', 'cp-build-body'); inside.id = `cp-build-body-${++serial}`; inside.setAttribute('role', 'group');
      caret.setAttribute('aria-controls', inside.id);
      // catch up: main moved on. Straight to the daemon, or — while the copy plays — its page, which asks first
      const catchRow = button('', 'cp-row cp-two cp-catch', () => {
        const e = entry, c = e.vm.catchUp || {};
        if (c.confirm) { navigate(() => void dispatch('openBuild', e.project, e.name)); return; }
        void hold(`${e.vm.copyId}:catch`, 'catchUpCopy', e.project, c.payload);
      });
      catchRow.dataset.cpRole = 'catch-up';
      const catchNote = node('span', 'cp-note');
      catchRow.append(glyphSpan('pull'), lines([node('span', 'cp-primary', WORDS.copy.catchUpRow)], [catchNote]));
      const add = button('', 'cp-row cp-add', () => { const e = entry; if (form.isOpenFor(e.name)) form.close(true); else form.open(e.name); });
      add.dataset.cpRole = 'new-improvement'; add.setAttribute('aria-expanded', 'false'); add.setAttribute('aria-controls', form.el.id);
      add.append(glyphSpan('plus'), node('span', 'cp-primary', WORDS.keys.improvement));
      const keys = node('div', 'cp-build-keys');
      const playFace = stack([SAY.play, WORDS.copy.playing]);
      const play = button('', 'cp-key cp-play cp-play-copy', () => {
        const e = entry, playing = !!e.vm.play?.running;
        void hold(`${e.vm.copyId}:play`, 'playCopy', e.project, {copyId: e.vm.copyId, action: playing ? 'stop' : 'start'});
      });
      play.dataset.cpRole = 'play-copy'; play.append(icon('play'), playFace);
      // the bar never ships: this opens the copy's page on its confirm
      const ship = button('', 'cp-key cp-ship', () => { const e = entry; navigate(() => void dispatch('openShip', e.project, e.name)); });
      ship.dataset.cpRole = 'ship-copy'; ship.append(node('span', '', WORDS.copy.shipKey));
      keys.append(play, ship);
      const why = node('div', 'cp-why cp-keys-why');
      const empty = node('p', 'cp-why cp-empty', WORDS.copy.emptyImprovements);
      const list = node('p', 'cp-why cp-empty cp-list-line');
      el.append(wrap);
      return {el, wrap, row, label, word, note, count, caret, inside, catchRow, catchNote, add, keys, play, playFace, ship, why, empty, list};
    });
    const nameText = text(b.name ?? b.id, 'a copy');
    Object.assign(entry, {project: pid, name: String(b.id), vm: b});
    const {el, row, caret, inside} = entry;
    el.dataset.build = String(b.id); setAttr(el, 'data-copy-id', b.copyId || null);
    // the row: branch glyph · name and its headline · line two: what it is (copy of main · N ahead) and its counts
    const count = text(b.count, '');
    if (changed(entry, [nameText, b.word, b.tone, !!b.live, b.note, count])) {
      row.dataset.barBuild = String(b.id);
      setText(entry.label, nameText);
      setText(entry.word, text(b.word, '')); entry.word.dataset.tone = b.tone || 'quiet'; entry.word.classList.toggle('cp-live', !!b.live);
      // line two's note is facts ("copy of main · 2 ahead"): one that doesn't fit drops whole, as the foot's do
      entry.note.replaceChildren(...text(b.note, WORDS.copy.line).split(' · ').map((fact, i) => { const seg = node('span', 'cp-seg'); if (i) seg.append(node('span', 'cp-sep', ' · ')); seg.append(fact); return seg; }));
      entry.note.title = text(b.note, WORDS.copy.line);
      setText(entry.count, count); entry.count.hidden = !count;
      const said = [text(b.note, WORDS.copy.line), count].filter(Boolean).join(' · ');
      row.title = `${nameText} — ${text(b.word, '')}: ${said}. open its page`;
      row.setAttribute('aria-label', `${nameText}, ${text(b.word, '')} — ${said}. Open its page`);
    }
    const here = view?.page === 'build' && String(view.id) === String(b.id);
    setAttr(row, 'aria-current', here ? 'page' : null);
    entry.wrap.classList.toggle('is-current', here);
    const open = !folds.has(copyFoldKey(pid, b));
    el.classList.toggle('is-open', open);
    caret.setAttribute('aria-expanded', String(open));
    caret.setAttribute('aria-label', `${open ? 'Hide' : 'Show'} what is in ${nameText}`);
    caret.title = fillIn(open ? SAY.fold : SAY.unfold, {name: nameText});
    if (!open) { patch(el, [entry.wrap]); return el; }
    setAttr(inside, 'data-bar-build-body', String(b.id)); inside.setAttribute('aria-label', `inside ${nameText}`);
    // catch up, when main moved on: its last failure's words on line two until the next try, or why it can't
    const catchUp = b.catchUp || {}, behind = Number(b.behind) > 0;
    if (behind) {
      const r = entry.catchRow, blocked = String(catchUp.blocked || '');
      const failed = catchUp.last && catchUp.last.ok === false ? String(catchUp.last.words || '') : '';
      const noteSaid = blocked || failed || fillIn(WORDS.copy.catchUpNote, {n: b.behind});
      r.dataset.build = String(b.id);
      setText(entry.catchNote, noteSaid); entry.catchNote.title = noteSaid;
      r.disabled = !!blocked;
      setAttr(r, 'aria-busy', holding.has(`${b.copyId}:catch`) ? 'true' : null);
      r.title = blocked || fillIn(catchUp.confirm ? SAY.catchAsk : SAY.catchTitle, {name: nameText});
      r.setAttribute('aria-label', `Catch ${nameText} up with main — ${noteSaid}`);
    }
    const add = entry.add;
    add.dataset.build = String(b.id);
    add.setAttribute('aria-label', `New improvement on ${nameText}`);
    add.title = fillIn(SAY.addCopy, {name: nameText});
    add.setAttribute('aria-expanded', String(form.isOpenFor(String(b.id))));
    // the keys: play it (one plays at a time), and ship to main (its page asks)
    const play = b.play || {}, playing = !!play.running, playBlocked = String((b.blocked && b.blocked.play) || play.blocked || '');
    const pk = entry.play;
    pk.dataset.build = String(b.id); showFace(entry.playFace, playing ? WORDS.copy.playing : SAY.play);
    pk.disabled = !!playBlocked;
    pk.title = playBlocked || (playing ? fillIn(SAY.copyStop, {name: nameText}) : play.stops ? fillIn(WORDS.copy.oneAtATime, {other: play.stops}) : fillIn(WORDS.copy.play, {name: nameText}));
    pk.setAttribute('aria-label', `${playing ? 'Stop' : 'Play'} ${nameText}`);
    setAttr(pk, 'aria-pressed', playing ? 'true' : null);
    setAttr(pk, 'aria-busy', play.starting || holding.has(`${b.copyId}:play`) ? 'true' : null);
    const ship = b.ship || {}, shipWhy = String(ship.why || (b.blocked && b.blocked.ship) || '');
    const sk = entry.ship;
    sk.dataset.build = String(b.id);
    sk.disabled = !!shipWhy;
    sk.title = shipWhy || fillIn(SAY.shipOpen, {name: nameText});
    sk.setAttribute('aria-label', `Ship ${nameText} to main`);
    // why they can't, once: what's wrong with the copy says it all; else play's and ship's words, unless the
    // headline already says it (making, shipping … "nothing to ship yet", "main moved on")
    const transient = ['making', 'retiring', 'shipping', 'catching_up'].includes(b.state);
    const saidByHeadline = (b.state === 'nothing' && ship.ready === false && /^nothing to ship yet/.test(shipWhy)) || (b.state === 'behind' && behind && shipWhy.startsWith('main moved on'));
    const whys = transient ? [] : b.healthWords ? [String(b.healthWords)] : [...new Set([playBlocked, saidByHeadline ? '' : shipWhy].filter(Boolean))];
    const whySig = JSON.stringify(whys);
    if (entry.whySig !== whySig) { entry.whySig = whySig; entry.why.replaceChildren(...whys.map(w => node('p', '', w))); }
    patch(inside, [behind ? entry.catchRow : null, ...bodyRows(pid, b, view, {scope: `${pid}:${b.copyId || b.id}`, bodyId: inside.id, isMain: false, add, empty: entry.empty, listLine: entry.list}),
      entry.keys, whys.length ? entry.why : null]);
    patch(el, [entry.wrap, inside]);
    return el;
  }
  /** Send a copy's action and hold its key (aria-busy) while it is out; the bar draws again when it lands. */
  async function hold(tag, action, id, value) {
    if (holding.has(tag)) return;
    holding.add(tag); rerender();
    try { await dispatch(action, id, value); }
    finally { holding.delete(tag); if (!destroyed) rerender(); }
  }

  // ---- the one inline form: + improvement → start now (run.dispatch) or up next (issue.create) ---------
  // It belongs to one build at a time (main, or a copy: then its words carry the copy's id); drafts are kept per
  // project and build.
  function makeForm() {
    const el = node('form', 'cp-form cp-improvement-form'); el.dataset.cpRole = 'improvement-form';
    el.hidden = true; el.noValidate = true; el.setAttribute('autocomplete', 'off'); el.id = `cp-form-${++serial}`;
    const top = node('div', 'cp-form-top');
    const field = node('textarea', 'cp-form-field'); field.id = `cp-field-${++serial}`;
    field.rows = 2; field.maxLength = 1000; field.placeholder = WORDS.form.placeholder; field.spellcheck = true;
    const label = node('label', 'cp-form-label', WORDS.form.label); label.htmlFor = field.id;
    const x = button('×', 'cp-icon-key cp-form-x', () => api.close(true));
    x.setAttribute('aria-label', 'Close the form'); x.title = WORDS.form.close;
    top.append(label, x);
    const note = node('p', 'cp-form-note'); note.setAttribute('role', 'status'); note.hidden = true;
    const keys = node('div', 'cp-form-keys');
    const start = node('button', 'cp-primary-key'); start.type = 'submit'; start.dataset.cpRole = 'start-now';
    const cap = node('kbd', 'cp-cap', '↵'); cap.setAttribute('aria-hidden', 'true');
    start.append(node('span', '', WORDS.form.start), cap); start.setAttribute('aria-keyshortcuts', 'Enter');
    const queue = button(WORDS.form.queue, 'cp-key cp-queue-key', () => void submit('queue')); queue.dataset.cpRole = 'up-next';
    keys.append(start, queue);
    const hint = node('p', 'cp-form-hint', WORDS.form.hint); hint.id = `cp-hint-${++serial}`;
    field.setAttribute('aria-describedby', hint.id);
    // the conversational route stays one quiet step away: the words go to nibbi instead of straight to work
    const ask = button(SAY.ask, 'cp-quiet-key', () => void submit('ask')); ask.dataset.cpRole = 'ask-nibbi';
    ask.title = 'talk it through with nibbi first — your words go to the conversation';
    el.append(top, field, note, keys, hint, ask);
    const drafts = new Map();
    let owner = null, build = MAIN, copyId = null, sending = null, blocked = {start: '', queue: ''};
    const draftKey = (project, name) => JSON.stringify([project, name]);
    const say = (message, kind = '') => { setText(note, message || ''); note.hidden = !message; if (kind) note.dataset.kind = kind; else delete note.dataset.kind; };
    /** The + improvement row of the build this form belongs to. */
    const trigger = () => build === MAIN ? addKey : builds.rows.querySelector(`[data-cp-role="new-improvement"][data-build="${CSS.escape(build)}"]`);
    field.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void submit('start'); }
    });
    field.addEventListener('input', () => { if (note.dataset.kind !== 'blocked') say(''); });
    el.addEventListener('submit', event => { event.preventDefault(); void submit('start'); });
    async function submit(kind) {
      if (sending || destroyed) return;
      const words = kind === 'start' ? blocked.start : kind === 'queue' ? blocked.queue : '';
      if (words) { say(words, 'blocked'); return; }
      const value = field.value.trim();
      if (!value) { say(SAY.empty); field.focus({preventScroll: true}); return; }
      const project = owner, name = build, key = {start, queue, ask}[kind];
      // a copy's improvement lands in that copy: its words carry the copy's id (the talk route carries only words)
      const payload = kind !== 'ask' && copyId ? {text: value, copyId} : {text: value};
      sending = kind; key.setAttribute('aria-busy', 'true');
      const result = await send({start: 'startImprovement', queue: 'queueImprovement', ask: 'askNibbi'}[kind], project, payload);
      sending = null; key.removeAttribute('aria-busy');
      if (destroyed) return;
      if (!result.ok) { say(result.error, result.kind === 'notice' ? 'notice' : 'error'); return; }
      drafts.delete(draftKey(project, name));
      if (owner === project && build === name) { field.value = ''; say(''); }
      api.close(false);
      // the words went to nibbi (the app moves focus to the composer); a build stays here, on its key
      const back = trigger();
      if (kind !== 'ask' && owner === project && back?.isConnected) back.focus({preventScroll: true});
    }
    const keep = () => { if (owner != null) { const k = draftKey(owner, build); if (field.value) drafts.set(k, field.value); else drafts.delete(k); } };
    const api = {
      el, field, note, start, queue, ask,
      get isOpen() { return !el.hidden; },
      get build() { return build; },
      isOpenFor(name) { return !el.hidden && build === name; },
      /** Open it for a build (its + improvement): the form moves there, with that build's draft. */
      open(name = MAIN) {
        if (shownProject() == null) return;
        buildForm.close(false);
        if (name !== build) { api.close(false); api.retarget(name); rerender(); }
        el.hidden = false; trigger()?.setAttribute('aria-expanded', 'true');
        say(blocked.start, blocked.start ? 'blocked' : '');
        field.focus({preventScroll: true});
        scheduleReveal(el);
      },
      close(restore = false) {
        if (el.hidden) return false;
        el.hidden = true; say('');
        const t = trigger(); t?.setAttribute('aria-expanded', 'false');
        if (restore && t?.isConnected) t.focus({preventScroll: true});
        return true;
      },
      /** The form now belongs to another build of the same project: its words stay with theirs. */
      retarget(name) {
        if (name === build) return;
        keep(); api.close(false);
        build = name; copyId = null; field.value = drafts.get(draftKey(owner, name)) || '';
      },
      /** The project on screen moved: this form belongs to main of the one you are in. Its words stay with theirs. */
      own(project) {
        if (project === owner) return;
        keep(); api.close(false);
        owner = project; build = MAIN; copyId = null; field.value = drafts.get(draftKey(project, MAIN)) || '';
      },
      paint(b) {
        const next = {start: b.blocked?.start || '', queue: b.blocked?.queue || ''};
        const was = blocked; blocked = next;
        copyId = build !== MAIN && b.copyId ? String(b.copyId) : null;
        const name = text(b.name ?? b.id, build);
        field.placeholder = build === MAIN ? WORDS.form.placeholder : fillIn(WORDS.copy.formPlaceholder, {name});
        // with automation picking this list up (b.autoInto), up next doesn't wait for you, and the hint says so
        const into = String(b.autoInto || '');
        setText(hint, build === MAIN ? (into ? fillIn(WORDS.form.hintAuto, {into}) : WORDS.form.hint) : fillIn(into ? WORDS.copy.formHintAuto : WORDS.copy.formHint, {name}));
        start.disabled = !!next.start; start.title = next.start || 'build it right away (↵)';
        queue.disabled = !!next.queue; queue.title = next.queue || (into ? `keep it up next — automation builds it into ${into}` : 'keep it up next until you start it');
        if (!el.hidden && (note.hidden || note.dataset.kind === 'blocked') && (was.start !== next.start || note.hidden)) say(next.start, next.start ? 'blocked' : '');
      },
    };
    return api;
  }

  // ---- + New build: a name, a copy of main. Enter or make it → newCopy {name} ---------------------------------
  function makeBuildForm() {
    const el = node('form', 'cp-form cp-build-form'); el.dataset.cpRole = 'build-form';
    el.hidden = true; el.noValidate = true; el.setAttribute('autocomplete', 'off'); el.id = `cp-build-form-${++serial}`;
    const top = node('div', 'cp-form-top');
    const field = node('input', 'cp-form-field cp-name'); field.id = `cp-name-${++serial}`;
    field.type = 'text'; field.maxLength = COPY.nameMax; field.spellcheck = false; field.autocomplete = 'off';
    field.setAttribute('autocapitalize', 'off'); field.setAttribute('autocorrect', 'off'); field.dataset.cpRole = 'build-name';
    const label = node('label', 'cp-form-label', WORDS.copy.formLabel); label.htmlFor = field.id;
    const x = button('×', 'cp-icon-key cp-form-x', () => api.close(true));
    x.setAttribute('aria-label', 'Close the form'); x.title = WORDS.form.close;
    top.append(label, x);
    const sub = node('p', 'cp-form-sub', WORDS.copy.formSub); sub.id = `cp-sub-${++serial}`;
    field.setAttribute('aria-describedby', sub.id);
    const note = node('p', 'cp-form-note'); note.setAttribute('role', 'status'); note.hidden = true;
    const keys = node('div', 'cp-form-keys');
    const make = node('button', 'cp-primary-key'); make.type = 'submit'; make.dataset.cpRole = 'make-build';
    const cap = node('kbd', 'cp-cap', '↵'); cap.setAttribute('aria-hidden', 'true');
    make.append(node('span', '', WORDS.copy.make), cap); make.setAttribute('aria-keyshortcuts', 'Enter');
    keys.append(make);
    el.append(top, field, sub, note, keys);
    let vm = null, sending = false, owner = null;
    const say = (message, kind = '') => { setText(note, message || ''); note.hidden = !message; if (kind) note.dataset.kind = kind; else delete note.dataset.kind; };
    const cant = () => String(vm?.blocked || '');
    field.addEventListener('input', () => { if (note.dataset.kind !== 'blocked') say(''); });
    el.addEventListener('submit', event => { event.preventDefault(); void submit(); });
    async function submit() {
      if (sending || destroyed) return;
      if (cant()) { say(cant(), 'blocked'); return; }
      const name = normalName(field.value), problem = nameProblem(name, vm?.taken || []);
      // the words say what's wrong before anything is sent; focus stays in the field
      if (problem) { say(problem); field.focus({preventScroll: true}); return; }
      const project = owner;
      sending = true; make.setAttribute('aria-busy', 'true');
      const result = await send('newCopy', project, {name});
      sending = false; make.removeAttribute('aria-busy');
      if (destroyed) return;
      // a refusal keeps the name and says the daemon's words
      if (!result.ok) { say(result.error, result.kind === 'notice' ? 'notice' : 'error'); return; }
      field.value = ''; say('');
      api.close(false);
      if (owner === project) { pendingFocus = {project, name, until: Date.now() + 15000}; focusPending(true); }
    }
    const api = {
      el, field, note, make,
      get isOpen() { return !el.hidden; },
      open() {
        if (shownProject() == null) return;
        form.close(false);
        el.hidden = false; newBuildKey.setAttribute('aria-expanded', 'true');
        api.paint(vm, true);
        // the suggested name, selected, so typing replaces it; in the can't state the note says why and × has focus
        if (cant()) { field.value = ''; x.focus({preventScroll: true}); }
        else { field.value = String(vm?.suggested || ''); field.focus({preventScroll: true}); field.select(); }
        scheduleReveal(el);
      },
      close(restore = false) {
        if (el.hidden) return false;
        el.hidden = true; say('');
        newBuildKey.setAttribute('aria-expanded', 'false');
        if (restore && newBuildKey.isConnected) newBuildKey.focus({preventScroll: true});
        return true;
      },
      own(project) { if (project === owner) return; api.close(false); owner = project; field.value = ''; },
      paint(next, opening = false) {
        const was = cant(); vm = next && typeof next === 'object' ? next : null;
        const now = cant();
        field.disabled = !!now; make.disabled = !!now; make.title = now || 'make the copy (↵)';
        if (el.hidden) return;
        if (now && (opening || now !== was || note.dataset.kind === 'blocked' || note.hidden)) say(now, 'blocked');
        else if (!now && note.dataset.kind === 'blocked') say('');
      },
    };
    return api;
  }
  /** After + New build: focus goes to the new copy's row once it is drawn, else it waits on + (and moves only
      while nothing else took it). */
  let pendingFocus = null;
  function focusPending(first = false) {
    const want = pendingFocus; if (!want) return;
    if (Date.now() > want.until || String(shownProject()) !== String(want.project)) { pendingFocus = null; return; }
    const row = builds.rows.querySelector(`.cp-copy-row[data-bar-build="${CSS.escape(want.name)}"]`);
    const free = first || document.activeElement === newBuildKey || !document.activeElement || document.activeElement === document.body;
    if (row && free) { pendingFocus = null; row.focus({preventScroll: true}); scheduleReveal(row.closest('.cp-rowwrap') || row); return; }
    if (row) { pendingFocus = null; return; }
    if (first && newBuildKey.isConnected) newBuildKey.focus({preventScroll: true});
  }

  // ---- moving, revealing, shading ---------------------------------------------------------------
  /** A row that moves the main area: in the drawer, the drawer goes first so the page (or the chat) shows. */
  function navigate(go) {
    if (narrow.matches && sidebarOpen) { close(); closeMenu(false); setSidebar(false); }
    go();
  }
  let shadeFrame = 0, revealTarget = null;
  function scheduleShade() {
    if (shadeFrame || destroyed) return;
    shadeFrame = requestAnimationFrame(() => { shadeFrame = 0; shade(); });
  }
  function scheduleReveal(el) { revealTarget = el; scheduleShade(); }
  const headOver = el => el.closest('.cp-group')?.querySelector('.cp-group-head')?.offsetHeight || 0;
  function reveal(el) {
    if (!el?.isConnected || !body.contains(el) || !sidebarOpen) return;
    const view = body.clientHeight; if (!view) return;
    const b = body.getBoundingClientRect(), r = el.getBoundingClientRect();
    // the foot holds the bottom edge with a 24px fade (and the 12 of ground) above it: a row is only in view above that
    const top = r.top - b.top + body.scrollTop, bottom = top + r.height, cover = headOver(el), under = foot.offsetHeight + 36;
    if (top - cover < body.scrollTop) body.scrollTop = Math.max(0, top - cover - 4);
    else if (bottom + under > body.scrollTop + view) body.scrollTop = Math.max(0, Math.min(top - cover - 4, bottom + under - view));
  }
  function shade() {
    if (destroyed || !sidebarOpen) return;
    if (revealTarget) { reveal(revealTarget); revealTarget = null; }
    body.classList.toggle('has-more', body.scrollTop + body.clientHeight < body.scrollHeight - 2);
    const top = body.getBoundingClientRect().top;
    // a header holding its place over rows scrolled under it draws a hairline under itself
    for (const g of [convo, builds]) {
      if (g.el.hidden) { g.head.classList.remove('is-stuck'); continue; }
      const r = g.head.getBoundingClientRect(), gr = g.el.getBoundingClientRect();
      g.head.classList.toggle('is-stuck', body.scrollTop > 0 && Math.abs(r.top - top) < 1.5 && gr.top < top - 1);
    }
  }
  body.addEventListener('scroll', shade, {passive: true});
  const sized = typeof ResizeObserver === 'function' ? new ResizeObserver(() => scheduleShade()) : null;
  sized?.observe(body);

  function renderBody() {
    const entry = activeEntry();
    form.own(entry?.id ?? null); buildForm.own(entry?.id ?? null);
    used = new Set();
    if (!entry) {
      convo.el.hidden = true; builds.el.hidden = true; none.hidden = false;
      renderNone();
    } else {
      none.hidden = true; noneKey = '';
      convo.el.hidden = false; builds.el.hidden = false;
      renderConversations(entry.data);
      renderBuilds(entry.data);
      // a page that just opened brings its row into view
      const view = pageHere(), viewKey = view ? `${view.project}:${view.page}:${view.id}` : '';
      if (viewKey !== seenView) { seenView = viewKey; if (view) scheduleReveal(builds.el.querySelector('[aria-current="page"]')?.closest('.cp-rowwrap') || builds.el.querySelector('[aria-current="page"]')); }
    }
    for (const [key, entry] of rows) if (!used.has(key)) { rows.delete(key); entry.outer?.remove(); entry.el.remove(); }
  }
  let seenView = '';
  /** Keep focus where it was across a render. A row that went away hands it on: a conversation to home,
      an improvement to main. */
  function holdFocus() {
    const el = document.activeElement;
    if (!el || !sidebar.contains(el)) return () => {};
    const key = keyOf.get(el) || keyOf.get(el.closest('.cp-rowwrap')) || '';
    const inBuild = builds.el.contains(el) ? el.closest('.cp-build')?.dataset.build ?? null : null;
    const sel = el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' ? [el.selectionStart, el.selectionEnd] : null;
    return () => {
      if (document.activeElement === el) return;
      if (el.isConnected) {
        if (!el.getClientRects().length) return;
        el.focus({preventScroll: true});
        if (sel) try { el.setSelectionRange(...sel); } catch { /* a number field */ }
        return;
      }
      if (document.activeElement && document.activeElement !== document.body) return;   // something else took it on purpose
      // an improvement, a fold or a copy's control that went away: to its build's row, while it is still there; else main
      const own = inBuild != null && inBuild !== MAIN ? builds.rows.querySelector(`.cp-copy-row[data-bar-build="${CSS.escape(inBuild)}"]`) : null;
      const next = key.startsWith('t:') ? convo.rows.querySelector('[data-thread-id="home"]') : inBuild != null || key.startsWith('i:') || key.startsWith('f:') ? own || mainRow : null;
      next?.focus({preventScroll: true});
    };
  }
  function rerender() { const held = holdFocus(); renderBody(); held(); scheduleShade(); }

  function renderProject(entry, data) {
    entry.data = data;
    const active = String(data.id) === String(model.activeProject) || !!data.active;
    const mode = text(data.mode, 'off');
    const words = attentionOf(data);
    const note = words.text || text(data.branch, '');
    setText(entry.name, text(data.name, 'Untitled project'));
    setText(entry.summary, note); entry.summary.dataset.tone = words.text ? words.tone : 'quiet';
    if (entry.marked !== active) { entry.mark.replaceChildren(...(active ? [icon('check')] : [])); entry.marked = active; }
    entry.row.classList.toggle('is-active', active); entry.row.classList.toggle('is-off', mode === 'off');
    entry.group.classList.toggle('needs-you', wantsYou(data) && !active);
    entry.row.setAttribute('aria-current', active ? 'true' : 'false');
    entry.row.setAttribute('aria-label', `${text(data.name, 'Untitled project')}${note ? ', ' + note : ''}${active ? ', current project' : ''}`);
    entry.row.title = `${text(data.name)}${note ? ' — ' + note : ''}`;
    entry.options.setAttribute('aria-label', `Project settings for ${text(data.name, 'Untitled project')}`);
    entry.options.title = 'project settings — automation, spend cap';
    if (entry.card) paintCard(entry);
  }
  /** The card's own contents, from entry.data. Only ever called for a card that exists. */
  function paintCard(entry) {
    const data = entry.data, mode = text(data.mode, 'off');
    setText(entry.card.heading, text(data.name, 'Untitled project'));
    setText(entry.branch, `Working branch · ${text(data.branch, 'not available')}`);
    setText(entry.goal, text(data.goal, 'No goal set'));
    paintAutomation(entry, data);
    const spendLabel = finite(data.spend) ? `${money(data.spend)} spent` : 'Spend not available';
    const capLabel = !finite(data.spendCap) ? 'Cap not available' : data.spendCap <= 0 ? 'No cap' : `Cap ${money(data.spendCap)}`;
    setText(entry.stats, `${spendLabel} · ${capLabel}`);
    for (const [key, el] of Object.entries(entry.modeButtons)) el.setAttribute('aria-pressed', String(key === mode));
    if (!entry.dirty && document.activeElement !== entry.cap) entry.cap.value = finite(data.spendCap) ? String(Math.max(0, data.spendCap)) : '';
  }
  /** The Automation part of the card: what it works, where it builds (a segment of main and the copies), and its last word. */
  function paintAutomation(entry, data) {
    const copies = (Array.isArray(data.builds) ? data.builds : []).filter(b => b && b.kind === 'copy' && b.copyId);
    const choices = [{name: MAIN, copyId: null}, ...copies.map(b => ({name: text(b.name ?? b.id, 'a copy'), copyId: String(b.copyId)}))];
    const chosen = choices.find(c => c.copyId !== null && c.copyId === data.autoTarget) || choices[0];
    setText(entry.autoLine, data.goalActive ? fillIn(WORDS.auto.goalLine, {project: text(data.id ?? data.name, 'this project')}) : fillIn(WORDS.auto.line, {name: chosen.name}));
    const key = JSON.stringify(choices.map(c => [c.name, c.copyId]));
    if (entry.intoKey !== key) {
      for (const b of bindings) if (entry.into.contains(b.el)) bindings.delete(b);
      entry.intoButtons.clear(); entry.intoKey = key;
      entry.into.replaceChildren(...choices.map(c => {
        const el = bind(button(c.name, 'margin-mode margin-into-key', () => { void dispatch('autoTarget', entry.id, c.copyId ?? MAIN, entry.card.error); }), 'autoTarget', entry.id, () => !!model.busy);
        el.title = fillIn(WORDS.auto.intoTitle, {name: c.name}); entry.intoButtons.set(c.copyId ?? MAIN, el); return el;
      }));
      refreshDisabled();
    }
    // while a /goal is set its lead builds on main from the roadmap, so there is no choice to show; it is kept for after
    entry.intoField.hidden = choices.length < 2 || !!data.goalActive;
    for (const [id, el] of entry.intoButtons) el.setAttribute('aria-pressed', String(id === (chosen.copyId ?? MAIN)));
    const note = typeof data.autoNote === 'string' ? data.autoNote.trim() : '';
    entry.autoNote.hidden = !note; setText(entry.autoNote, note); entry.autoNote.title = note;
  }
  function update(next = {}) {
    if (destroyed) return;
    const held = holdFocus();
    model = {...next, projects: Array.isArray(next.projects) ? next.projects : [], settings: next.settings || {}};
    if (!model.busy && globalError.dataset.kind === 'notice') { globalError.hidden = true; globalError.textContent = ''; delete globalError.dataset.kind; }   // "switch when it's done": it is done
    const seen = new Set();
    let position = 0;
    for (const data of model.projects) {
      if (data.id == null || seen.has(String(data.id))) continue;
      const id = String(data.id); seen.add(id); const entry = projects.get(id) || createProject(id);
      renderProject(entry, {...data, id});
      // Reorder only when needed: moving focused DOM on every tick loses focus.
      if (list.children[position] !== entry.group) list.insertBefore(entry.group, list.children[position] || null);
      position++;
    }
    for (const [id, entry] of projects) if (!seen.has(id)) {
      entry.group.remove(); projects.delete(id);
      if (!entry.card) continue;
      if (opened === entry.card) close(true);
      entry.card.el.remove(); cards.delete(entry.card);
      for (const b of bindings) if (entry.card.el.contains(b.el)) bindings.delete(b);
    }
    empty.hidden = seen.size > 0 || !menuOpen;
    empty.textContent = next.projectsLoaded === false ? (next.projectsError ? PROJECTS_UNREACHABLE : 'Loading projects…') : 'No projects yet. Make one to start.';
    // One project is in the bar at a time, so the switcher and the cards under it are drawn once.
    renderSwitcher(); renderBody(); renderMenu();
    const current = activeEntry()?.data, waiting = current ? attentionOf(current) : {text: '', tone: 'quiet'};
    setText(toggleCount, waiting.text);
    toggleCount.dataset.tone = waiting.tone;
    toggle.title = waiting.text ? `open the bar — ${waiting.text}` : 'open the bar';
    // The foot: one line whose facts drop whole when they do not fit, never cut. Its text is exactly progressLine().
    const line = progressLine(model.progress);
    if (progressStatus.textContent !== line) {
      progressStatus.replaceChildren(...line.split(' · ').map((fact, i) => {
        const seg = node('span', 'cp-seg');
        if (i) seg.append(node('span', 'cp-sep', ' · '));
        seg.append(fact);
        return seg;
      }));
      progressStatus.title = line;
    }
    const away = model.link === 'offline' ? 'Offline — nothing is reaching the gateway' : '';
    if (link.textContent !== away) link.textContent = away;
    link.hidden = !away;
    const s = model.settings;
    for (const [key, el] of Object.entries(meta)) setText(el, text(s[key], 'Not available'));
    for (const [action, pref] of Object.entries(prefs)) {
      const on = action === 'calm' ? !!(s.calm || s.systemReduced) : !!s[action];
      if (action === 'glass') pref.el.hidden = s.glassAvailable === false;   // browsers have no translucent window to show
      pref.el.setAttribute('aria-pressed', String(on)); setText(pref.value, action === 'calm' && s.systemReduced ? 'OS reduced motion' : action === 'notifications' && s.notificationBlocked ? 'Blocked' : action === 'microphone' && on ? ({ starting: 'Allow mic', armed: 'Ready', listening: 'Listening', paused: 'Paused', greeting: 'Responding', transcribing: 'Processing', sending: 'Answering' }[s.microphonePhase] || 'On') : on ? 'On' : 'Off');
    }
    notificationNote.textContent = s.notificationsSupported === false ? 'Notifications are not supported here.' : text(s.notificationStatus, '');
    notificationNote.hidden = !notificationNote.textContent;
    refreshDisabled();
    notifyVisibility();
    held();
    focusPending();
    scheduleShade();
  }
  const outside = event => {
    if (menuOpen && !switcher.contains(event.target)) closeMenu(false);
    if (!opened || opened.el.contains(event.target) || cardTrigger?.contains(event.target)) return;
    close();
  };
  /** Inside the builds card the arrows walk the rows of every build; ArrowLeft from inside a build goes to its
      row; on a copy's row ArrowLeft folds it and ArrowRight unfolds it (then steps inside). Never a printable
      key: type-to-talk owns those. */
  function treeKeys(event) {
    const t = event.target;
    if (!(t instanceof HTMLElement) || !builds.el.contains(t) || !t.matches('button.cp-row')) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const visible = el => el.getClientRects().length && !el.disabled;
    const rows = [...builds.el.querySelectorAll('button.cp-row')].filter(visible);
    const i = rows.indexOf(t), owner = t.closest('.cp-build');
    const copyRow = t.matches('.cp-copy-row'), caret = copyRow ? owner?.querySelector('[data-cp-role="build-disclosure"]') : null;
    const isOpen = caret?.getAttribute('aria-expanded') === 'true';
    const flip = () => { event.preventDefault(); caret.click(); t.focus({preventScroll: true}); };
    let next = null;
    if (event.key === 'ArrowRight') {
      if (!copyRow || !caret) return;
      if (!isOpen) { flip(); return; }
      next = [...owner.querySelectorAll('.cp-build-body button.cp-row')].find(visible) || null;
      if (!next) return;
    } else if (event.key === 'ArrowLeft') {
      if (copyRow) { if (caret && isOpen) flip(); return; }
      next = t.closest('.cp-build-body') ? owner?.querySelector('[data-bar-build]') || mainRow : null;
      if (!next) return;
    } else next = event.key === 'ArrowDown' ? rows[i + 1] : event.key === 'ArrowUp' ? rows[i - 1] : event.key === 'Home' ? rows[0] : rows.at(-1);
    event.preventDefault();
    if (next) { next.focus({preventScroll: true}); reveal(next.closest('.cp-rowwrap') || next); shade(); }
  }
  const keyboard = event => {
    if (event.key === 'Escape') {
      const stop = () => { event.preventDefault(); event.stopImmediatePropagation(); };
      const inside = sidebar.contains(event.target);
      // 1 a card · 2 the project list — from anywhere, as they are the bar's own popups
      if (opened) { stop(); close(true); return; }
      if (menuOpen) { stop(); closeMenu(true); return; }
      // 3 the bar's open form, only while you are in the bar
      if (inside && form.isOpen) { stop(); form.close(true); return; }
      if (inside && buildForm.isOpen) { stop(); buildForm.close(true); return; }
      if (!sidebarOpen || document.querySelector('dialog[open]')) return;
      // 5 as a drawer it is modal, so Escape puts it away from anywhere
      if (narrow.matches) { stop(); setSidebar(false, true); return; }
      // Docked, the bar is open all day: swallowing every Escape kept it from ever reaching the composer
      // or the palette. From inside it: 6 a page goes back to the chat, then 7 the bar folds away.
      if (!inside) return;
      stop();
      if (model.view) void dispatch('backToChat', shownProject());
      else setSidebar(false, true);
      return;
    }
    if (event.key === 'Tab' && menuOpen && menu.contains(event.target) === false && !narrow.matches) closeMenu(false);
    if (menuOpen && menu.contains(event.target)) menuKeys(event);
    else treeKeys(event);
    if (event.key === 'Tab' && sidebarOpen && narrow.matches) {
      const scope = opened?.el || sidebar;
      const items = [...scope.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]')].filter(el => el.getClientRects().length && !el.closest('[hidden]'));
      // While the sidebar is still sliding open nothing has laid out yet, so the list can be
      // momentarily empty. Tab must not escape a modal sidebar just because it is mid-transition.
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && (document.activeElement === first || !items.includes(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !items.includes(document.activeElement))) { event.preventDefault(); first?.focus(); }
    }
  };
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', keyboard, true);
  refreshDisabled();
  setSidebar(narrow.matches ? false : desktopOpen);
  return {
    update, close: () => { close(); closeMenu(false); if (narrow.matches) setSidebar(false); }, setSidebar,
    destroy() {
      close(); destroyed = true; clearInterval(clock); cancelAnimationFrame(shadeFrame); sized?.disconnect();
      document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', keyboard, true);
      body.removeEventListener('scroll', shade, {passive: true});
      sidebar.removeEventListener('touchstart', touch, {passive: true}); toggle.removeEventListener('touchstart', touch, {passive: true});
      narrow.removeEventListener('change', resizeSidebar); restoreWorkspace();
      for (const card of cards) card.el.remove();
      left.replaceChildren(); right.replaceChildren(); bindings.clear(); cards.clear(); projects.clear(); rows.clear();
      document.body.append(left, right); sidebar.remove(); toggle.remove(); backdrop.remove();
      document.body.classList.remove('sidebar-open');
      left.classList.remove('margin-rail', 'margin-projects', 'cp-rail'); right.classList.remove('margin-rail', 'margin-settings', 'cp-settings-rail');
      if (!hadClass) document.body.classList.remove('margin-ui-active');
    },
  };
}

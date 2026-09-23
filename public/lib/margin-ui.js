import { emptyLine } from './empty.js';
/** Live, modeless margin controls. Authority stays with the caller.
    update(model) reads {projects, projectsLoaded, projectsError?, activeProject, view, busy, settings, progress?}; progress is
    {today:{deliveries}, week:{deliveries}, streak, available} from verified merges, or undefined when not available. */
const SVG_NS = 'http://www.w3.org/2000/svg';
const glyphs = {
  sidebar: ['M4 4h16v16H4z', 'M9 4v16'],
  folder: ['M3 7V5h6l2 2h10v12H3V7Z'],
  plus: ['M12 5v14M5 12h14'],
  build: ['M4 7 12 3l8 4v10l-8 4-8-4V7Z', 'm4 7 8 4 8-4M12 11v10'],
  issue: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M12 7v6M12 16h.01'],
  plan: ['M5 3h14v18H5z', 'M9 8h6M9 12h6M9 16h4'],
  thread: ['M4 5h16v10H9l-5 4V5Z'],
  newThread: ['M12 6v8M8 10h8', 'M4 5h16v10H9l-5 4V5Z'],
  search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z', 'm16.2 16.2 3.8 3.8'],
  caret: ['m6 9 6 6 6-6'],
  settings: ['M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z', 'M9.5 3h5l.5 2.4 1.8 1 2.3-.7 2.5 4.3-1.8 1.6v.8l1.8 1.6-2.5 4.3-2.3-.7-1.8 1-.5 2.4h-5L9 18.6l-1.8-1-2.3.7L2.4 14l1.8-1.6v-.8L2.4 10l2.5-4.3 2.3.7 1.8-1L9.5 3Z'],
};
const text = (value, fallback = '—') => value == null || value === '' ? fallback : String(value);
const PROJECTS_UNREACHABLE = 'couldn’t reach the projects list';
const relative = at => {
  if (!Number.isFinite(at)) return '';
  const seconds = Math.max(0, (Date.now() - at) / 1000);
  if (seconds < 90) return 'just now';
  for (const [unit, size] of [['m', 60], ['h', 3600], ['d', 86400]]) { const n = Math.floor(seconds / size); if (n < (unit === 'd' ? 7 : unit === 'h' ? 24 : 60)) return n + unit; }
  return Math.floor(seconds / 604800) + 'w';
};
const finite = value => typeof value === 'number' && Number.isFinite(value);
const count = value => finite(value) ? Math.max(0, Math.floor(value)) : null;
const money = value => finite(value) ? `$${Math.max(0, value).toLocaleString(undefined, {maximumFractionDigits: 2})}` : '—';
function progress(project) {
  const total = count(project.total), raw = count(project.done);
  if (total === null || raw === null) return { label: 'Progress not available', fraction: null };
  const done = Math.min(raw, total);
  return { label: `${done} of ${total} complete`, fraction: total > 0 ? done / total : null };
}
/** Companion progress line. Reports what merged; never proposes what to do next. */
export function progressLine(progress) {
  const today = progress && progress.available !== false ? count(progress.today?.deliveries) : null;
  if (today === null) return 'Progress not available';
  const week = count(progress.week?.deliveries) ?? 0, streak = count(progress.streak) ?? 0;
  const parts = [today === 0 ? 'Nothing merged yet today' : `${today} merged today`];
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

export function installMarginUI({ onAction, onVisibility } = {}) {
  const left = document.getElementById('project-rail');
  const right = document.getElementById('settings-rail');
  if (!left || !right) throw new Error('Margin UI requires #project-rail and #settings-rail');
  let model = {projects: [], settings: {}, busy: false}, opened = null, cardTrigger = null, destroyed = false, serial = 0;
  let menuOpen = false, query = '';
  // The app calls update() on every snapshot and event. Replacing the strip and the body each time
  // throws away DOM nobody asked to lose and keeps the main thread busy while the workspace works,
  // so each renders only when what it renders from has actually changed.
  let tabsKey = '', bodyKey = '';
  const projects = new Map(), pending = new Set(), bindings = new Set(), cards = new Set();
  let visibleKey = '';
  function notifyVisibility() {
    // Only the project you are in. Widening this to every project while the list is open made the
    // rows more informative and cost a read for each one; those reads land later as "records
    // updated" and replace a panel someone is part-way through. The rows say what the app already
    // knows and fill in as it learns more, which is worth more than a list that interrupts.
    const ids = sidebarOpen ? [String(model.activeProject ?? '')].filter(id => projects.has(id)) : [];
    const key = JSON.stringify(ids); if (key === visibleKey) return; visibleKey = key;
    queueMicrotask(() => { if (!destroyed) onVisibility?.(ids); });
  }
  const hadClass = document.body.classList.contains('margin-ui-active');
  document.body.classList.add('margin-ui-active');
  left.classList.add('margin-rail', 'margin-projects');
  right.classList.add('margin-rail', 'margin-settings');
  left.setAttribute('aria-label', 'Projects'); right.setAttribute('aria-label', 'Quick controls');
  const narrow = matchMedia('(max-width: 899px)');
  const sidebar = node('aside', 'workspace-sidebar'); sidebar.id = 'workspace-sidebar';
  sidebar.setAttribute('aria-label', 'Projects and settings');
  const head = node('div', 'sidebar-head');
  const brand = node('span', 'sidebar-brand', 'nibbi');
  const toggle = button('', 'sidebar-toggle', () => setSidebar(!sidebarOpen, true));
  toggle.id = 'sidebar-toggle'; toggle.append(icon('sidebar'));
  toggle.setAttribute('aria-controls', sidebar.id);
  const collapse = button('', 'sidebar-collapse', () => setSidebar(false, true));
  collapse.append(icon('sidebar')); collapse.setAttribute('aria-label', 'Close sidebar');
  head.append(brand, collapse);
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
    toggle.setAttribute('aria-label', value ? 'Close sidebar' : 'Open sidebar'); toggle.title = 'Projects and settings';
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
  }
  const resizeSidebar = () => { close(); setSidebar(narrow.matches ? false : desktopOpen); };
  narrow.addEventListener('change', resizeSidebar);
  sidebar.append(head, left, right); document.body.append(backdrop, sidebar, toggle);
  right.setAttribute('aria-label', 'Settings');
  const list = node('div', 'margin-project-list');
  const empty = emptyLine('Loading projects…');
  const globalError = node('p', 'margin-error margin-global-error');
  globalError.setAttribute('role', 'status'); globalError.hidden = true;
  const keyFor = (action, id) => JSON.stringify([action, id ?? null]);
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
    const key = keyFor(action, id);
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
  const add = bind(button('', 'margin-project margin-new', newProject), 'newProject');
  add.append(icon('plus'), node('span', 'margin-project-name', 'New project'));
  const progressStatus = node('p', 'margin-muted sidebar-progress', progressLine(undefined));
  progressStatus.id = 'sidebar-progress'; progressStatus.setAttribute('role', 'status');

  // The switcher. One project is current; the rest are a list you visit. Its popup answers to the
  // bar's width, not the caret's, which is what makes it read as a dropdown rather than a menu button.
  const switcher = node('div', 'margin-switcher');
  const trigger = button('', 'margin-project margin-switch-trigger', () => (menuOpen ? closeMenu(true) : openMenu(false)));
  trigger.setAttribute('aria-haspopup', 'true'); trigger.setAttribute('aria-expanded', 'false');
  const triggerRing = node('span', 'project-folder'); triggerRing.append(icon('folder'));
  const triggerLabels = node('span', 'margin-project-labels');
  const triggerName = node('span', 'margin-project-name');
  const triggerSummary = node('span', 'margin-project-summary');
  triggerLabels.append(triggerName, triggerSummary);
  const triggerCaret = node('span', 'project-caret'); triggerCaret.append(icon('caret'));
  trigger.append(triggerRing, triggerLabels, triggerCaret);
  const menu = node('div', 'margin-switch-menu'); menu.hidden = true;
  menu.setAttribute('aria-label', 'Projects');
  const searchWrap = node('div', 'margin-switch-search');
  const search = document.createElement('input');
  search.type = 'text'; search.placeholder = 'Find a project'; search.autocomplete = 'off'; search.spellcheck = false;
  search.setAttribute('aria-label', 'Find a project');
  search.addEventListener('input', () => { query = search.value; renderMenu(); });
  searchWrap.append(icon('search'), search);
  menu.append(searchWrap, list, empty, add);
  switcher.append(trigger, menu);

  // The strip: four glyphs, and the one you are on opens up to say its name and what is waiting.
  const tabs = node('nav', 'margin-tabs'); tabs.setAttribute('aria-label', 'Project sections');
  const body = node('div', 'margin-body');
  // The rollup is a control, not a caption: the sentence about the other projects is also the way
  // to reach the first one that wants something.
  const rollup = button('', 'margin-muted margin-rollup', () => {
    openMenu(false);
    const wanted = list.querySelector('.project-group.needs-you:not([hidden]) .margin-project');
    (wanted || search).focus({ preventScroll: true });
  });
  rollup.hidden = true;
  const link = node('p', 'margin-muted margin-link'); link.hidden = true; link.setAttribute('role', 'status');
  // The conversations take the slack and the rest sits at the foot. Left in the flow they ended up
  // stranded mid-bar under a two-row thread list, with four hundred pixels of empty paper below.
  const foot = node('div', 'margin-foot');
  foot.append(progressStatus, rollup, link, globalError);
  left.append(switcher, tabs, body, foot);

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
  // The foot of the bar holds one control. Settings for a thing live on the thing; this is the rest.
  const settingsGlyph = button('', 'margin-glyph', () => open(settings, settingsGlyph));
  settingsGlyph.id = 'status';
  settingsGlyph.setAttribute('aria-label', 'Settings');
  const settingsCore = node('span', 'margin-glyph-core'); settingsCore.append(icon('settings'));
  settingsGlyph.append(settingsCore, node('span', 'label margin-glyph-label', 'Settings'));
  right.append(settingsGlyph); disclose(settingsGlyph, settings);

  /** A row in the dropdown: the project, what it wants from you in words, and its settings. */
  function createProject(id) {
    const entry = {id, data: {}, dirty: false, card: null};
    const group = node('div', 'project-group');
    const headingRow = node('div', 'project-heading-row');
    const row = button('', 'margin-project', () => select(entry));
    row.dataset.projectId = id;
    const ring = node('span', 'project-folder'); ring.append(icon('folder'));
    const labels = node('span', 'margin-project-labels'); const name = node('span', 'margin-project-name');
    const summary = node('span', 'margin-project-summary'); labels.append(name, summary); row.append(ring, labels);
    const options = button('', 'project-options', () => open(cardFor(entry), options)); options.append(icon('settings'));
    options.setAttribute('aria-haspopup', 'dialog'); options.setAttribute('aria-expanded', 'false');   // aria-controls waits for the card: it must not name an id that does not exist
    headingRow.append(row, options); group.append(headingRow);
    Object.assign(entry, {group, row, ring, name, summary, options});
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
  /** Everything inside the project card. Unchanged from the tree: this is not what the bar is about. */
  function buildProjectCard(entry, card, id) {
    const branch = node('p', 'margin-muted'), goal = node('p', 'margin-goal');
    const progressLabel = node('p', 'margin-muted');
    const meter = node('div', 'margin-progress'); meter.setAttribute('aria-hidden', 'true'); const fill = node('span'); meter.append(fill);
    const stats = node('p', 'margin-project-stats');
    card.body.append(branch, goal, progressLabel, meter, stats);
    const segmentLabel = node('p', 'margin-field-label', 'Automation');
    const segment = node('div', 'margin-segment'); segment.setAttribute('role', 'group'); segment.setAttribute('aria-label', 'Automation mode');
    const modeButtons = {};
    for (const mode of ['off','suggest','stage','ship']) {
      const el = bind(button(mode, 'margin-mode', () => {
        if (mode === 'ship') { card.confirm.hidden = false; confirmShip.focus(); }
        else { card.confirm.hidden = true; void dispatch('autoMode', id, mode, card.error); }
      }), 'autoMode', id, () => !!model.busy);
      segment.append(el); modeButtons[mode] = el;
    }
    const confirm = node('div', 'margin-confirm'); confirm.hidden = true;
    confirm.append(node('p', '', 'Ship can automatically merge changes. Enable it for this project?'));
    const confirmShip = bind(button('Enable ship', 'margin-pill margin-primary', () => {
      void dispatch('autoMode', id, 'ship', card.error).then(ok => { if (ok) confirm.hidden = true; });
    }), 'autoMode', id, () => !!model.busy);
    confirm.append(confirmShip, button('Cancel', 'margin-pill', () => {confirm.hidden = true; modeButtons.ship.focus();})); card.confirm = confirm;
    card.body.append(segmentLabel, segment, confirm);
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
    for (const [action, label] of [['repository','Repository & GitHub'], ['plan','Plan'], ['play','Play'], ['fix','Fix…'], ['review','Review'], ['providers','Providers']]) {
      const el = bind(button(label, 'margin-pill', () => void dispatch(action, id, undefined, card.error)), action, id,
        () => action !== 'repository' && !!model.busy || action === 'plan' && entry.data.planAvailable === false || action === 'play' && entry.data.playable !== true);
      projectActions.append(el);
    }
    card.body.append(projectActions);
    Object.assign(entry, {branch, goal, progressLabel, meter, fill, stats, modeButtons, cap});
  }
  function select(entry) {
    closeMenu(false); close();
    void dispatch('selectProject', entry.id);
  }

  // ---- the dropdown -------------------------------------------------------------------------
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
    const rows = [...list.querySelectorAll('[data-project-id]')].filter(el => !el.hidden);
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
  function attentionOf(data) {
    const builds = data.sections?.builds;
    if (builds && (builds.tone === 'error' || builds.tone === 'attention')) return builds.badge;
    if (count(data.inFlight)) return `${count(data.inFlight)} in flight`;
    const issues = data.sections?.issues?.badge;
    if (issues && /^\d+ open/.test(issues)) return issues;
    return '';
  }
  function rollupLine() {
    const others = (model.projects || []).filter(p => String(p.id) !== String(model.activeProject) && attentionOf(p));
    if (!others.length) return '';
    return others.length === 1 ? `${text(others[0].name, 'Another project')} needs you` : `${others.length} others need you`;
  }
  const activeEntry = () => projects.get(String(model.activeProject)) || [...projects.values()][0] || null;

  function renderMenu() {
    const q = query.trim().toLowerCase();
    let shown = 0;
    for (const entry of projects.values()) {
      const match = !q || String(entry.data.name ?? entry.id).toLowerCase().includes(q);
      entry.group.hidden = !match;
      if (match) shown++;
    }
    empty.hidden = shown > 0 || !menuOpen;
    if (menuOpen && !shown) empty.textContent = 'No project matches.';
  }
  function renderSwitcher() {
    const entry = activeEntry();
    const loading = model.projectsLoaded === false, unreachable = loading && !!model.projectsError;
    if (!entry) {
      // Nothing to name yet. "No project · no branch · quiet" described a project that does not exist.
      // And a list that never arrived is not still loading: it says so, and Retry is in the body below.
      trigger.dataset.currentProject = '';
      triggerName.textContent = unreachable ? 'Projects' : loading ? 'Loading projects…' : 'No projects yet';
      triggerSummary.textContent = loading ? '' : 'Create one to get started';   // unreachable: the body below says it once
      trigger.setAttribute('aria-label', unreachable ? 'Projects: ' + PROJECTS_UNREACHABLE : loading ? 'Loading projects' : 'No projects yet. Create one to get started');
      trigger.title = '';
      rollup.hidden = true;
      return;
    }
    const data = entry.data;
    const name = text(data.name, 'No project');
    const summary = `${text(data.branch, 'no branch')} · ${attentionOf(data) || 'quiet'}`;
    // Not data-project-id: that belongs to the rows you can choose. The trigger names the one
    // you are already in, and the two must not be the same selector.
    trigger.dataset.currentProject = entry?.id || '';
    triggerName.textContent = name;
    triggerSummary.textContent = summary;
    const others = rollupLine();
    trigger.setAttribute('aria-label', `${name}. ${summary}. Switch project${others ? `. ${others}` : ''}`);
    trigger.title = others ? `Switch project — ${others}` : `${name} — ${summary}`;
    rollup.textContent = others; rollup.hidden = !others;
  }
  const SECTIONS = [['builds','Builds','build'],['issues','Issues','issue'],['plans','Plans','plan']];
  function renderTabs() {
    const entry = activeEntry(); if (!entry) { tabs.replaceChildren(); tabsKey = ''; return; }
    const data = entry.data, view = model.view?.project === data.id ? model.view.section : null;
    // The workspace also opens "repository", which the strip has no tab for and the bar has no
    // summary of. Anything outside the three record sections falls back to the conversations.
    const summarised = view && SECTIONS.some(([section]) => section === view) ? view : null;
    const key = JSON.stringify([data.id, view, summarised, !!model.busy, (Array.isArray(data.threads) ? data.threads : []).length,
      SECTIONS.map(([section]) => [data.sections?.[section]?.badge, data.sections?.[section]?.tone, data.sections?.[section]?.accessible])]);
    if (key === tabsKey) return;
    tabsKey = key;
    const cells = [];
    const threads = Array.isArray(data.threads) ? data.threads : [];
    const chatSaid = model.busy ? 'nibbi is answering' : `${threads.length} conversation${threads.length === 1 ? '' : 's'}`;
    const chat = button('', 'project-section margin-tab', () => {
      const thread = threads.find(t => t.active) || threads[0];
      if (thread) void dispatch('thread', data.id, thread.id);
    });
    chat.dataset.marginTab = 'chat';
    cells.push(paintTab(chat, 'thread', 'Chat', chatSaid, !view, null));
    for (const [section, label, glyph] of SECTIONS) {
      const info = data.sections?.[section] || {};
      const tab = button('', 'project-section margin-tab', () => void dispatch('projectSection', data.id, section));
      tab.dataset.projectSection = section; tab.dataset.sectionProject = data.id; tab.dataset.marginTab = section;
      tab.title = text(info.accessible, label);
      cells.push(paintTab(tab, glyph, label, text(info.badge, 'Loading…'), view === section, info.tone || 'quiet'));
    }
    tabs.replaceChildren(...cells);
  }
  function paintTab(el, glyph, label, said, current, tone) {
    el.classList.toggle('is-current', current);
    el.append(icon(glyph));
    if (current) {
      const copy = node('span', 'project-section-copy');
      copy.append(node('span', 'project-section-name', label));
      const badge = node('span', 'project-section-badge', said);
      if (tone) badge.dataset.tone = tone;
      copy.append(badge); el.append(copy);
      el.setAttribute('aria-current', 'page');
    } else el.removeAttribute('aria-current');
    el.setAttribute('aria-label', `${label}. ${said}`);
    if (!el.title) el.title = `${label} — ${said}`;
    return el;
  }
  function renderBody() {
    const entry = activeEntry();
    if (!entry) {
      bodyKey = '';
      if (model.projectsLoaded === false && model.projectsError) {
        const retry = button('Retry', 'margin-pill margin-empty-retry', () => void dispatch('refreshProjects'));
        body.replaceChildren(emptyLine(PROJECTS_UNREACHABLE), retry);
        return;
      }
      if (model.projectsLoaded === false) { body.replaceChildren(emptyLine('Loading projects…')); return; }
      const start = button('New project', 'margin-pill margin-empty-new', () => { close(); void dispatch('newProject'); });
      body.replaceChildren(emptyLine('No projects yet. A project is a repository nibbi can build in.'), start);
      return;
    }
    const data = entry.data, view = model.view?.project === data.id ? model.view.section : null;
    // The workspace also opens "repository", which the strip has no tab for and the bar has no
    // summary of. Anything outside the three record sections falls back to the conversations.
    const summarised = view && SECTIONS.some(([section]) => section === view) ? view : null;
    const key = JSON.stringify([data.id, view, summarised, !!model.busy,
      (Array.isArray(data.threads) ? data.threads : []).map(t => [t.id, t.title, t.lastAt, !!t.active]),
      summarised ? [data.sections?.[summarised]?.badge, data.sections?.[summarised]?.detail, data.sections?.[summarised]?.tone,
        data.inFlight, data.staged, data.pending, data.done, data.total, data.goal, data.planAvailable] : null]);
    if (key === bodyKey) return;
    bodyKey = key;
    const refocus = heldRow();
    body.replaceChildren(...(summarised ? sectionBody(data, summarised) : chatBody(data, entry)));
    refocus?.();
  }
  /* The list is rebuilt whenever a thread in the project is written to, from this window or another
     device. A keyboard on a row, its gear or New thread stays on the same one instead of dropping to
     the page; a row that went away hands focus to Home. */
  function heldRow() {
    const el = document.activeElement;
    if (!el || el === body || !body.contains(el)) return null;
    const fresh = el.classList.contains('project-thread-new'), gear = el.classList.contains('project-options');
    const id = el.dataset.threadId ?? el.closest('.project-thread-row')?.querySelector('[data-thread-id]')?.dataset.threadId;
    if (!fresh && id === undefined) return null;
    return () => {
      const row = fresh ? null : [...body.querySelectorAll('[data-thread-id]')].find(n => n.dataset.threadId === id);
      const target = fresh ? body.querySelector('.project-thread-new') : gear ? row?.parentElement?.querySelector('.project-options') : row;
      (target || body.querySelector('[data-thread-id="home"]'))?.focus({preventScroll: true});
    };
  }
  function chatBody(data, entry) {
    const parts = [];
    const fresh = button('', 'project-section project-thread-new', () => void dispatch('newThread', data.id));
    fresh.disabled = !!model.busy;   // rebuilt each time it changes, so it is not bound: bindings are for lasting elements
    fresh.append(icon('newThread'), node('span', 'project-section-copy', 'New thread'));
    fresh.title = model.busy ? 'Not while nibbi is answering' : 'Start a new conversation';
    pruneThreadCards();
    const threads = node('div', 'project-threads');
    threads.append(...(Array.isArray(data.threads) ? data.threads : []).map(thread => {
      const el = button('', 'project-section project-thread', () => void dispatch('thread', data.id, thread.id));
      el.dataset.threadId = thread.id; el.dataset.threadProject = data.id;
      el.dataset.lastAt = thread.lastAt || ''; el.dataset.projectName = text(data.name);
      el.append(icon('thread'), node('span', 'project-section-copy', text(thread.title, 'Thread')),
        node('span', 'project-thread-when'));
      el.title = text(thread.title, 'Thread');   // the copy is one clipped line; the whole name has to be reachable
      paintWhen(el);
      if (thread.active) el.setAttribute('aria-current', 'true');
      if (thread.id === 'home') return el;   // home is every message with no thread: it has no name to change and cannot be put away
      // The same gear a project row has, beside the row rather than inside it: a button inside a button is not a button.
      const row = node('div', 'project-thread-row');
      const gear = button('', 'project-options', () => { const card = threadCardFor(data.id, thread); paintThreadCard(card, thread); disclose(gear, card); open(card, gear); });
      gear.append(icon('settings'));
      gear.setAttribute('aria-haspopup', 'dialog'); gear.setAttribute('aria-expanded', 'false');
      gear.setAttribute('aria-label', `Thread settings for ${text(thread.title, 'Thread')}`); gear.title = 'Rename or archive';
      const known = threadCards.get(threadCardKey(data.id, thread.id));
      if (known) {
        disclose(gear, known); paintThreadCard(known, thread);
        if (opened === known) { gear.setAttribute('aria-expanded', 'true'); cardTrigger = gear; }   // the list re-rendered under an open card
      }
      row.append(el, gear);
      return row;
    }));
    // New thread leads the conversations: it is the thing you reach for, not the thing you scroll past.
    parts.push(fresh, threads);
    return parts;
  }
  /* A thread's card: its name, and a way to put it away. Built the first time its gear is used, like
     a project's, and dropped when the thread leaves the model. There is no delete: an archived
     conversation stays in the log, where history search still finds it. */
  const threadCards = new Map();
  const threadCardKey = (project, id) => JSON.stringify([project, id]);
  function threadCardFor(project, thread) {
    const key = threadCardKey(project, thread.id);
    if (threadCards.has(key)) return threadCards.get(key);
    const card = makeCard(text(thread.title, 'Thread'));
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
      body.querySelector('[data-thread-id="home"]')?.focus({preventScroll: true});   // its row is gone; Home is where the conversation went
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
    card.heading.textContent = text(thread.title, 'Thread');
    if (!card.dirty && document.activeElement !== card.field) card.field.value = text(thread.title, '');
    return card;
  }
  function pruneThreadCards() {
    const live = new Set((model.projects || []).flatMap(p => (Array.isArray(p.threads) ? p.threads : []).map(t => threadCardKey(String(p.id), t.id))));
    for (const [key, card] of threadCards) if (!live.has(key)) {
      if (opened === card) close();
      card.el.remove(); cards.delete(card); threadCards.delete(key);
    }
  }
  /** "4m" is only true for a minute. The row keeps when it last spoke, and the clock rewrites the
      label in place, so an open bar does not go on saying "just now" about this morning. */
  function paintWhen(el) {
    const when = el.dataset.lastAt ? relative(Date.parse(el.dataset.lastAt)) : '';
    const label = el.querySelector('.project-thread-when');
    if (label && label.textContent !== when) label.textContent = when;
    el.setAttribute('aria-label', `${el.title} thread in ${el.dataset.projectName}${when ? ', last message ' + when : ''}`);
  }
  const clock = setInterval(() => { for (const el of body.querySelectorAll('.project-thread[data-last-at]')) paintWhen(el); }, 60000);
  /** A section tab shows what is waiting, in a sentence. The records themselves fill the workspace. */
  function sectionBody(data, section) {
    const info = data.sections?.[section] || {};
    const wrap = node('div', 'margin-section');
    const headline = node('p', 'margin-section-headline', text(info.badge, 'Loading…'));
    headline.dataset.tone = info.tone || 'quiet';
    wrap.append(headline);
    if (info.detail) wrap.append(node('p', 'margin-section-line', info.detail));
    wrap.append(node('p', 'margin-section-line', waitingLine(data, section)));
    wrap.append(node('p', 'margin-section-hint', 'The full list is open beside the bar.'));
    const [action, label] = {builds: ['review', 'Review'], issues: ['repository', 'Repository & GitHub'], plans: ['plan', 'Plan']}[section] || [];
    if (!action) return [wrap];
    const go = button(label, 'margin-pill', () => void dispatch(action, data.id, undefined, globalError));
    go.disabled = !!model.busy || action === 'plan' && data.planAvailable === false;
    wrap.append(go);
    return [wrap];
  }
  function waitingLine(data, section) {
    if (section === 'builds') {
      const bits = [];
      if (count(data.inFlight)) bits.push(`${count(data.inFlight)} in flight`);
      if (count(data.staged)) bits.push(`${count(data.staged)} staged`);
      if (count(data.pending)) bits.push(`${count(data.pending)} pending`);
      return bits.length ? bits.join(' · ') : 'Nothing is queued.';
    }
    if (section === 'issues') {
      const open = String(data.sections?.issues?.badge || '').match(/^(\d+) open/);
      return open ? `${open[1]} open.` : 'Nothing is open.';
    }
    const done = count(data.done), total = count(data.total);
    if (done !== null && total !== null && total > 0) {
      const left = Math.max(0, total - done);
      return left ? `${left} task${left === 1 ? '' : 's'} left.` : 'Every task is done.';
    }
    return text(data.goal, 'No plan written yet.');
  }
  function renderProject(entry, data) {
    entry.data = data;
    const active = String(data.id) === String(model.activeProject) || !!data.active;
    const mode = text(data.mode, 'off');
    const note = attentionOf(data) || text(data.branch, '');
    entry.name.textContent = text(data.name, 'Untitled project');
    entry.summary.textContent = note;
    entry.row.classList.toggle('is-active', active); entry.row.classList.toggle('is-off', mode === 'off');
    entry.group.classList.toggle('needs-you', !!attentionOf(data) && !active);
    entry.row.setAttribute('aria-current', active ? 'true' : 'false');
    entry.row.setAttribute('aria-label', `${text(data.name, 'Untitled project')}${note ? ', ' + note : ''}${active ? ', current project' : ''}`);
    entry.row.title = `${text(data.name)}${note ? ' — ' + note : ''}`;
    entry.options.setAttribute('aria-label', `Project settings for ${text(data.name, 'Untitled project')}`);
    entry.options.title = 'Project settings';
    if (entry.card) paintCard(entry);
  }
  /** The card's own contents, from entry.data. Only ever called for a card that exists. */
  function paintCard(entry) {
    const data = entry.data, p = progress(data), mode = text(data.mode, 'off');
    const inflight = count(data.inFlight), pendingCount = count(data.pending), staged = count(data.staged);
    entry.card.heading.textContent = text(data.name, 'Untitled project');
    entry.branch.textContent = `Working branch · ${text(data.branch, 'not available')}`;
    entry.goal.textContent = text(data.goal, 'No goal set');
    entry.progressLabel.textContent = p.label; entry.meter.hidden = p.fraction === null;
    entry.fill.style.width = `${(p.fraction ?? 0) * 100}%`;
    const spendLabel = finite(data.spend) ? `${money(data.spend)} spent` : 'Spend not available';
    const capLabel = !finite(data.spendCap) ? 'Cap not available' : data.spendCap <= 0 ? 'No cap' : `Cap ${money(data.spendCap)}`;
    entry.stats.textContent = `${inflight ?? '—'} in flight · ${pendingCount ?? '—'} pending · ${staged ?? '—'} staged · ${spendLabel} · ${capLabel}`;
    for (const [key, el] of Object.entries(entry.modeButtons)) el.setAttribute('aria-pressed', String(key === mode));
    if (!entry.dirty && document.activeElement !== entry.cap) entry.cap.value = finite(data.spendCap) ? String(Math.max(0, data.spendCap)) : '';
  }
  function update(next = {}) {
    if (destroyed) return;
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
    empty.textContent = next.projectsLoaded === false ? (next.projectsError ? PROJECTS_UNREACHABLE : 'Loading projects…') : 'No projects yet. Create one to get started.';
    // One project is in the bar at a time, so the switcher, the strip and the body are rendered once.
    const focusKey = document.activeElement?.dataset?.marginTab;
    renderSwitcher(); renderTabs(); renderBody(); renderMenu();
    if (focusKey) tabs.querySelector(`[data-margin-tab="${focusKey}"]`)?.focus({preventScroll: true});
    const line = progressLine(model.progress);
    if (progressStatus.textContent !== line) progressStatus.textContent = line;
    const away = model.link === 'offline' ? 'Offline — nothing is reaching the gateway' : '';
    if (link.textContent !== away) link.textContent = away;
    link.hidden = !away;
    const s = model.settings;
    for (const [key, el] of Object.entries(meta)) el.textContent = text(s[key], 'Not available');
    for (const [action, pref] of Object.entries(prefs)) {
      const on = action === 'calm' ? !!(s.calm || s.systemReduced) : !!s[action];
      if (action === 'glass') pref.el.hidden = s.glassAvailable === false;   // browsers have no translucent window to show
      pref.el.setAttribute('aria-pressed', String(on)); pref.value.textContent = action === 'calm' && s.systemReduced ? 'OS reduced motion' : action === 'microphone' && on ? ({ starting: 'Allow mic', armed: 'Ready', listening: 'Listening', paused: 'Paused', greeting: 'Responding', transcribing: 'Processing', sending: 'Answering' }[s.microphonePhase] || 'On') : on ? 'On' : 'Off';
    }
    notificationNote.textContent = s.notificationsSupported === false ? 'Notifications are not supported here.' : text(s.notificationStatus, '');
    notificationNote.hidden = !notificationNote.textContent;
    refreshDisabled();
    notifyVisibility();
  }
  const outside = event => {
    if (menuOpen && !switcher.contains(event.target)) closeMenu(false);
    if (!opened || opened.el.contains(event.target) || cardTrigger?.contains(event.target)) return;
    close();
  };
  const keyboard = event => {
    if (event.key === 'Escape' && opened) {event.preventDefault(); event.stopImmediatePropagation(); close(true); return;}
    if (event.key === 'Escape' && menuOpen) {event.preventDefault(); event.stopImmediatePropagation(); closeMenu(true); return;}
    if (event.key === 'Tab' && menuOpen && menu.contains(event.target) === false && !narrow.matches) closeMenu(false);
    if (menuOpen && menu.contains(event.target)) menuKeys(event);
    // Docked, the bar is open all day, and swallowing every Escape kept it from ever reaching the
    // composer or the palette. As a drawer it is modal, so Escape closes it from anywhere.
    if (event.key === 'Escape' && sidebarOpen && (narrow.matches || sidebar.contains(event.target)) && !document.querySelector('dialog[open]')) {
      event.preventDefault(); event.stopImmediatePropagation(); setSidebar(false, true); return;
    }
    if (event.key === 'Tab' && sidebarOpen && narrow.matches) {
      const scope = opened?.el || sidebar;
      const items = [...scope.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')].filter(el => el.getClientRects().length && !el.closest('[hidden]'));
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
      close(); destroyed = true; clearInterval(clock);
      document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', keyboard, true);
      narrow.removeEventListener('change', resizeSidebar); restoreWorkspace();
      for (const card of cards) card.el.remove();
      left.replaceChildren(); right.replaceChildren(); bindings.clear(); cards.clear(); projects.clear();
      document.body.append(left, right); sidebar.remove(); toggle.remove(); backdrop.remove();
      document.body.classList.remove('sidebar-open');
      left.classList.remove('margin-rail', 'margin-projects'); right.classList.remove('margin-rail', 'margin-settings');
      if (!hadClass) document.body.classList.remove('margin-ui-active');
    },
  };
}

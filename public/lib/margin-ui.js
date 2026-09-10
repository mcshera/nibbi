/** Live, modeless margin controls. Authority stays with the caller. */
const SVG_NS = 'http://www.w3.org/2000/svg';
const glyphs = {
  sidebar: ['M4 4h16v16H4z', 'M9 4v16'],
  folder: ['M3 7V5h6l2 2h10v12H3V7Z'],
  plus: ['M12 5v14M5 12h14'],
  chevron: ['m9 5 7 7-7 7'],
  build: ['M4 7 12 3l8 4v10l-8 4-8-4V7Z', 'm4 7 8 4 8-4M12 11v10'],
  issue: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M12 7v6M12 16h.01'],
  plan: ['M5 3h14v18H5z', 'M9 8h6M9 12h6M9 16h4'],
  microphone: ['M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z', 'M6 11v1a6 6 0 0 0 12 0v-1M12 18v3M9 21h6'],
  voice: ['M11 5 6 9H3v6h3l5 4V5Z', 'M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14'],
  model: ['m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z'],
  notifications: ['M5 17h14l-2-3V9a5 5 0 0 0-10 0v5l-2 3Z', 'M10 20h4M12 2v2'],
  settings: ['M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z', 'M9.5 3h5l.5 2.4 1.8 1 2.3-.7 2.5 4.3-1.8 1.6v.8l1.8 1.6-2.5 4.3-2.3-.7-1.8 1-.5 2.4h-5L9 18.6l-1.8-1-2.3.7L2.4 14l1.8-1.6v-.8L2.4 10l2.5-4.3 2.3.7 1.8-1L9.5 3Z'],
};
const text = (value, fallback = '—') => value == null || value === '' ? fallback : String(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const count = value => finite(value) ? Math.max(0, Math.floor(value)) : null;
const money = value => finite(value) ? `$${Math.max(0, value).toLocaleString(undefined, {maximumFractionDigits: 2})}` : '—';
function progress(project) {
  const total = count(project.total), raw = count(project.done);
  if (total === null || raw === null) return { label: 'Progress not available', fraction: null };
  const done = Math.min(raw, total);
  return { label: `${done} of ${total} complete`, fraction: total > 0 ? done / total : null };
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
  let model = {projects: [], settings: {}, busy: false}, opened = null, trigger = null, destroyed = false, serial = 0;
  const projects = new Map(), pending = new Set(), bindings = new Set(), cards = new Set();
  let visibleKey = '';
  function notifyVisibility() {
    const ids = sidebarOpen ? [...projects.values()].filter(entry => !entry.children.hidden).map(entry => entry.id) : [];
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
    if (!value) close();
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
    toggle.setAttribute('aria-label', 'Open sidebar'); toggle.title = 'Projects and settings';
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
  const empty = node('p', 'margin-empty', 'Loading projects…');
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
      if (!destroyed) { error.textContent = text(cause?.message || cause, 'Could not complete this action.'); error.hidden = false; }
      return false;
    } finally { pending.delete(key); if (!destroyed) refreshDisabled(); }
  }
  function close(restore = false) {
    if (!opened) return;
    const lastTrigger = trigger;
    opened.el.hidden = true;
    if (opened.confirm) opened.confirm.hidden = true;
    trigger?.setAttribute('aria-expanded', 'false');
    opened = null; trigger = null;
    if (restore && lastTrigger?.isConnected) lastTrigger.focus({preventScroll: true});
  }
  function open(card, source) {
    if (opened === card) { close(); return; }
    close(); opened = card; trigger = source;
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
  const newProject = () => { close(); void dispatch('newProject'); };
  const add = bind(button('', 'margin-project margin-new', newProject), 'newProject');
  add.append(icon('plus'), node('span', 'margin-project-name', 'New project'));
  const projectsTitle = node('h2', 'sidebar-section-title', 'Projects');
  left.append(add, projectsTitle, list, empty, globalError);

  const settings = makeCard('Settings', 'right');
  const metadata = node('dl', 'margin-metadata');
  const meta = {};
  for (const [key, label] of [['brain','Brain'],['session','Session'],['model','Model'],['provider','Provider'],['context','Context']]) {
    const row = node('div', 'margin-data-row'); const value = node('dd', '', '—');
    row.append(node('dt', '', label), value); metadata.append(row); meta[key] = value;
  }
  const prefs = {};
  for (const [action, label, id] of [['microphone','Hey Nibbi microphone','st-microphone'], ['voice','Spoken replies','st-voice'], ['sounds','Sound effects','st-sounds'], ['notifications','Notifications','st-notifications'], ['calm','Calm motion','st-motion'], ['demo','Demo brain','st-demo']]) {
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
  const rightButtons = {};
  for (const [action, label] of [['settings','Settings']]) {
    const el = button('', 'margin-glyph', () => action === 'settings' ? open(settings, el) : void dispatch(action));
    el.id = action === 'settings' ? 'status' : `margin-${action}`;
    el.setAttribute('aria-label', label);
    const core = node('span', 'margin-glyph-core'); core.append(icon(action));
    const caption = node('span', 'label margin-glyph-label', label);
    el.append(core, caption); right.append(el); rightButtons[action] = {el, caption};
    if (action === 'settings') disclose(el, settings);
    else bind(el, action, undefined, () => action === 'notifications' && model.settings.notificationsSupported === false);
  }

  function createProject(id) {
    const entry = {id, data: {}, dirty: false};
    const group = node('div', 'project-group');
    const headingRow = node('div', 'project-heading-row');
    const row = button('', 'margin-project', () => select(entry, row));
    row.dataset.projectId = id;
    const ring = node('span', 'project-folder'); ring.append(icon('folder'));
    const labels = node('span', 'margin-project-labels'); const name = node('span', 'margin-project-name');
    const summary = node('span', 'margin-project-summary'); labels.append(name, summary); row.append(ring, labels);
    const caret = node('span', 'project-caret'); caret.append(icon('chevron')); row.append(caret);
    const children = node('div', 'project-sections'); children.id = `project-sections-${++serial}`; children.hidden = true;
    row.setAttribute('aria-controls', children.id); row.setAttribute('aria-expanded', 'false');
    const sectionButtons = {};
    const sectionLabels = {};
    for (const [section, label, glyph] of [['builds','Builds','build'],['issues','Issues','issue'],['plans','Plans','plan']]) {
      const child = button('', 'project-section', () => void dispatch('projectSection', id, section));
      child.dataset.projectSection = section; child.dataset.sectionProject = id;
      const copy = node('span', 'project-section-copy'), top = node('span', 'project-section-top');
      const badge = node('span', 'project-section-badge'), detail = node('span', 'project-section-detail'); detail.hidden = true;
      top.append(node('span', 'project-section-name', label), badge); copy.append(top, detail);
      child.append(icon(glyph), copy); children.append(child); sectionButtons[section] = child; sectionLabels[section] = {badge, detail};
    }
    const card = makeCard('Project');
    const options = button('', 'project-options', () => open(card, options)); options.append(icon('settings')); disclose(options, card);
    headingRow.append(row, options); group.append(headingRow, children);
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
    Object.assign(entry, {group, row, ring, name, summary, card, options, children, sectionButtons, sectionLabels, branch, goal, progressLabel, meter, fill, stats, modeButtons, cap});
    list.append(group); projects.set(id, entry); return entry;
  }
  function select(entry, source) {
    close();
    entry.children.hidden = !entry.children.hidden;
    source.setAttribute('aria-expanded', String(!entry.children.hidden));
    if (!entry.children.hidden) void dispatch('selectProject', entry.id);
    renderProject(entry, entry.data); notifyVisibility();
  }
  function renderProject(entry, data) {
    entry.data = data;
    const active = data.id === model.activeProject || !!data.active;
    const p = progress(data), mode = text(data.mode, 'off');
    const inflight = count(data.inFlight), pendingCount = count(data.pending), staged = count(data.staged);
    const summary = [mode, p.fraction === null ? null : `${Math.round(p.fraction * 100)}% of plan`, inflight ? `${inflight} in flight` : null].filter(Boolean).join(' · ');
    entry.name.textContent = text(data.name, 'Untitled project');
    entry.summary.textContent = summary;
    entry.row.classList.toggle('is-active', active); entry.row.classList.toggle('is-off', mode === 'off');
    entry.row.setAttribute('aria-current', active ? 'true' : 'false');
    entry.row.setAttribute('aria-label', `${text(data.name, 'Untitled project')}. ${summary}`);
    entry.row.title = `${text(data.name)} — ${summary}`;
    entry.options.setAttribute('aria-label', `Project settings for ${text(data.name, 'Untitled project')}`);
    entry.options.title = 'Project settings';
    if (!entry.initialized) { entry.initialized = true; entry.children.hidden = !active; }
    if (!entry.children.hidden) entry.summary.textContent = text(data.branch, 'Project');
    entry.row.setAttribute('aria-expanded', String(!entry.children.hidden));
    for (const [section, el] of Object.entries(entry.sectionButtons)) {
      const info = data.sections?.[section];
      const {badge, detail} = entry.sectionLabels[section];
      badge.textContent = info?.badge || 'Loading…';
      badge.dataset.tone = info?.tone || 'quiet';
      detail.textContent = info?.detail || ''; detail.hidden = !detail.textContent;
      el.title = info?.accessible || 'Loading project information';
      el.setAttribute('aria-label', `${section[0].toUpperCase() + section.slice(1)} for ${text(data.name)}${info?.accessible ? '. ' + info.accessible : ''}`);
      const selected = model.view?.project === data.id && model.view?.section === section;
      if (selected) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
    }
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
      if (opened === entry.card) close(true);
      entry.group.remove(); entry.card.el.remove(); cards.delete(entry.card); projects.delete(id);
      for (const b of bindings) if (entry.card.el.contains(b.el)) bindings.delete(b);
    }
    empty.hidden = seen.size > 0;
    empty.textContent = next.projectsLoaded === false ? 'Loading projects…' : 'No projects yet. Create one to get started.';
    const s = model.settings;
    for (const [key, el] of Object.entries(meta)) el.textContent = text(s[key], 'Not available');
    for (const [action, pref] of Object.entries(prefs)) {
      const on = action === 'calm' ? !!(s.calm || s.systemReduced) : !!s[action];
      pref.el.setAttribute('aria-pressed', String(on)); pref.value.textContent = action === 'calm' && s.systemReduced ? 'OS reduced motion' : action === 'microphone' && on ? ({ starting: 'Allow mic', armed: 'Ready', listening: 'Listening', paused: 'Paused', greeting: 'Responding', transcribing: 'Processing', sending: 'Answering' }[s.microphonePhase] || 'On') : on ? 'On' : 'Off';
    }
    notificationNote.textContent = s.notificationsSupported === false ? 'Notifications are not supported here.' : text(s.notificationStatus, '');
    notificationNote.hidden = !notificationNote.textContent;
    for (const [action, item] of Object.entries(rightButtons)) {
      if (['microphone','voice','notifications'].includes(action)) {
        item.el.setAttribute('aria-pressed', String(!!s[action]));
        item.caption.textContent = `${action === 'microphone' ? 'Hey Nibbi' : action === 'voice' ? 'Spoken replies' : 'Notifications'} · ${s[action] ? 'on' : 'off'}`;
        if (action === 'microphone') item.el.title = s.microphone ? 'Hey Nibbi listening is on — turn microphone off' : 'Turn microphone on, then say “Hey Nibbi”';
      } else if (action === 'model') {
        item.caption.textContent = text(s.model, 'Model'); item.el.setAttribute('aria-label', `Model · ${text(s.model, 'not configured')}. Open Providers`);
      }
    }
    refreshDisabled();
    notifyVisibility();
  }
  const outside = event => {
    if (!opened || opened.el.contains(event.target) || trigger?.contains(event.target)) return;
    close();
  };
  const keyboard = event => {
    if (event.key === 'Escape' && opened) {event.preventDefault(); event.stopImmediatePropagation(); close(true); return;}
    if (event.key === 'Escape' && sidebarOpen && !document.querySelector('dialog[open]')) {
      event.preventDefault(); event.stopImmediatePropagation(); setSidebar(false, true); return;
    }
    if (event.key === 'Tab' && sidebarOpen && narrow.matches) {
      const scope = opened?.el || sidebar;
      const items = [...scope.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')].filter(el => el.getClientRects().length && !el.closest('[hidden]'));
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
    update, close: () => { close(); if (narrow.matches) setSidebar(false); }, setSidebar,
    destroy() {
      close(); destroyed = true;
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

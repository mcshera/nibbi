/** Shared, option-agnostic pieces: DOM helpers, the app's glyph set, relative time, and the mock app
    frame an option mounts into. Nothing here decides a layout — that is what the options are for. */
const SVG_NS = 'http://www.w3.org/2000/svg';

/** The app's own glyphs (public/lib/margin-ui.js:5-20), plus the few a chooser or a spine needs. */
export const glyphs = {
  sidebar: ['M4 4h16v16H4z', 'M9 4v16'],
  folder: ['M3 7V5h6l2 2h10v12H3V7Z'],
  plus: ['M12 5v14M5 12h14'],
  chevron: ['m9 5 7 7-7 7'],
  caret: ['m6 9 6 6 6-6'],
  build: ['M4 7 12 3l8 4v10l-8 4-8-4V7Z', 'm4 7 8 4 8-4M12 11v10'],
  issue: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M12 7v6M12 16h.01'],
  plan: ['M5 3h14v18H5z', 'M9 8h6M9 12h6M9 16h4'],
  thread: ['M4 5h16v10H9l-5 4V5Z'],
  newThread: ['M12 6v8M8 10h8', 'M4 5h16v10H9l-5 4V5Z'],
  settings: ['M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z', 'M9.5 3h5l.5 2.4 1.8 1 2.3-.7 2.5 4.3-1.8 1.6v.8l1.8 1.6-2.5 4.3-2.3-.7-1.8 1-.5 2.4h-5L9 18.6l-1.8-1-2.3.7L2.4 14l1.8-1.6v-.8L2.4 10l2.5-4.3 2.3.7 1.8-1L9.5 3Z'],
  pencil: ['m4 20 .8-3.4L15.6 5.8a2 2 0 0 1 2.8 0l.8.8a2 2 0 0 1 0 2.8L8.4 19.2 5 20Z'],
  archive: ['M3 6h18v4H3zM5 10v10h14V10M10 14h4'],
};
export function icon(kind) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  for (const d of glyphs[kind] || []) { const p = document.createElementNS(SVG_NS, 'path'); p.setAttribute('d', d); svg.append(p); }
  return svg;
}
export function node(tag, className, value) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (value != null) el.textContent = value;
  return el;
}
export function button(label, className, click) {
  const el = node('button', className, label);
  el.type = 'button';
  if (click) el.addEventListener('click', click);
  return el;
}
export const text = (value, fallback = '—') => value == null || value === '' ? fallback : String(value);
/** public/lib/margin-ui.js:22-28, with the clock passed in so every screenshot reads the same. */
export function relative(at, now) {
  const t = typeof at === 'string' ? Date.parse(at) : at;
  if (!Number.isFinite(t) || !Number.isFinite(now)) return '';
  const seconds = Math.max(0, (now - t) / 1000);
  if (seconds < 90) return 'just now';
  for (const [unit, size] of [['m', 60], ['h', 3600], ['d', 86400]]) {
    const n = Math.floor(seconds / size);
    if (n < (unit === 'd' ? 7 : unit === 'h' ? 24 : 60)) return n + unit;
  }
  return Math.floor(seconds / 604800) + 'w';
}
/** progressLine() from public/lib/margin-ui.js:39-47 — reports what merged, never what to do next. */
export function progressLine(progress) {
  const count = v => typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : null;
  const today = progress && progress.available !== false ? count(progress.today?.deliveries) : null;
  if (today === null) return 'Progress not available';
  const week = count(progress.week?.deliveries) ?? 0, streak = count(progress.streak) ?? 0;
  const parts = [today === 0 ? 'Nothing merged yet today' : `${today} merged today`];
  if (week > 0) parts.push(`${week} this week`);
  if (streak > 0) parts.push(`${streak}-day streak`);
  return parts.join(' · ');
}
const loaded = new Set(), pending = [];
/** An option loads its own stylesheet. The link is async, so anything that measures must wait for
    stylesReady() first — otherwise it measures unstyled DOM and reports nonsense. */
export function loadCss(href) {
  if (loaded.has(href)) return; loaded.add(href);
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = href;
  pending.push(new Promise(resolve => { link.addEventListener('load', resolve); link.addEventListener('error', resolve); }));
  document.head.append(link);
}
export async function stylesReady() {
  await Promise.all(pending);
  await Promise.all([...document.querySelectorAll('link[rel=stylesheet]')].map(link => link.sheet ? null :
    new Promise(resolve => { link.addEventListener('load', resolve); link.addEventListener('error', resolve); setTimeout(resolve, 3000); })));
  await document.fonts?.ready;
}
/** What a project's one-line summary says. `summaryLine` is improvement 3: branch and attention, not automation mode. */
export function projectSummary(project, flags = {}) {
  const mode = text(project.mode, 'off');
  const done = project.done, total = project.total;
  if (flags.summaryLine) {
    const attention = attentionOf(project);
    return [text(project.branch, 'no branch'), attention || 'quiet'].join(' · ');
  }
  const fraction = Number.isFinite(done) && Number.isFinite(total) && total > 0 ? Math.round(done / total * 100) : null;
  return [mode, fraction === null ? null : `${fraction}% of plan`, project.inFlight ? `${project.inFlight} in flight` : null].filter(Boolean).join(' · ');
}
/** The one thing a project most wants you to know, in words. Never a dot (improvement 9). */
export function attentionOf(project) {
  const builds = project.sections?.builds;
  if (builds && (builds.tone === 'error' || builds.tone === 'attention')) return builds.badge;
  if (project.inFlight) return `${project.inFlight} in flight`;
  const issues = project.sections?.issues?.badge;
  if (issues && /^\d+ open/.test(issues)) return issues;
  return '';
}
/** "2 others need you" — what a collapsed control says instead of growing a mark. */
export function rollup(model, exceptId) {
  const others = (model.projects || []).filter(p => p.id !== exceptId && attentionOf(p));
  if (!others.length) return '';
  if (others.length === 1) return `${others[0].name} needs you`;
  return `${others.length} others need you`;
}
/** placeholderText() from public/app.js:94-99 — the thread's name rides here, never as a badge. */
export function placeholderText(model, narrow) {
  const project = (model.projects || []).find(p => p.id === model.activeProject);
  const thread = project?.threads?.find(t => t.active);
  if (thread && thread.id !== 'home') return narrow ? thread.title + '…' : `Message “${thread.title}”…`;
  return narrow ? 'Ask nibbi to build…' : 'Ask nibbi to build something...';
}

const SECTION_LABELS = { builds: 'Builds', issues: 'Issues', plans: 'Plans' };
/** A still of the app around the bar: paper, the character, the composer, and the workspace when a
    section is open. Uses the app's real classes so the frame inherits the real look; lab.css re-scopes
    the handful of rules that are written against the page viewport. */
export function createFrame({ viewport, label = '', onAction } = {}) {
  const el = node('div', 'lab-frame');
  el.style.setProperty('--frame-w', viewport.width + 'px');
  el.style.setProperty('--frame-h', viewport.height + 'px');
  const content = node('div', 'lab-frame-content');
  const paper = node('div', 'lab-paper');
  const character = node('div', 'lab-character'); character.innerHTML = INK_BLOB; character.setAttribute('aria-hidden', 'true');
  const feed = node('div', 'lab-feed');
  const workspace = node('section', 'project-workspace lab-workspace'); workspace.hidden = true;
  const head = node('header', 'project-workspace-head');
  const title = node('h1', '', 'Project'); const back = button('Back to chat', 'project-text-button', () => onAction?.('lab:backToChat'));
  head.append(title, back);
  const tabs = node('nav', 'project-tabs'); tabs.setAttribute('aria-label', 'Project sections');
  const body = node('div', 'project-workspace-body'); const notice = node('div', 'lab-workspace-body-note');
  body.append(notice); workspace.append(head, tabs, body);
  const pill = node('form', 'pill lab-pill'); pill.setAttribute('aria-hidden', 'true');
  const dock = node('span', 'dock lab-dock'); dock.append(icon('plus'));
  const field = node('div', 'lab-field');
  const send = node('span', 'send lab-send');
  pill.append(dock, field, send);
  content.append(paper, character, feed, workspace, pill);
  const host = node('div', 'lab-host');
  const tag = node('div', 'lab-frame-label', label);
  el.append(content, host, tag);

  // The option plays <body>: it sets --workspace-left and toggles sidebar-open/glass/native-mac on the
  // host. Mirroring them onto the frame is what lets the composer and workspace move out of its way.
  const mirror = () => {
    el.style.setProperty('--workspace-left', host.style.getPropertyValue('--workspace-left') || '0px');
    for (const name of ['sidebar-open', 'glass', 'native-mac']) el.classList.toggle(name, host.classList.contains(name));
  };
  const observer = new MutationObserver(mirror);
  observer.observe(host, { attributes: true, attributeFilter: ['style', 'class'] });
  mirror();

  let current = { narrow: viewport.narrow };
  function setContext({ model, state, flags = {}, glass = false, nativeMac = false, viewport: vp } = {}) {
    if (vp) {
      current.narrow = vp.narrow;
      el.style.setProperty('--frame-w', vp.width + 'px'); el.style.setProperty('--frame-h', vp.height + 'px');
    }
    el.classList.toggle('is-narrow', !!current.narrow);
    el.dataset.narrow = current.narrow ? 'true' : 'false';
    el.classList.toggle('lab-glass', !!glass); el.classList.toggle('lab-native-mac', !!nativeMac);
    if (!model) return;
    const project = (model.projects || []).find(p => p.id === model.activeProject) || model.projects?.[0];
    const thread = project?.threads?.find(t => t.active);
    field.textContent = placeholderText(model, current.narrow);
    field.classList.toggle('is-busy', !!model.busy);
    pill.classList.toggle('lab-pill-busy', !!model.busy);
    // Two quiet turns, so a named conversation does not read as an empty room.
    feed.replaceChildren();
    if (thread && thread.id !== 'home' && !model.view) {
      const ask = node('p', 'lab-turn lab-turn-said', FAKE[thread.id]?.[0] || 'What is left on this?');
      const reply = node('p', 'lab-turn lab-turn-reply', FAKE[thread.id]?.[1] || 'Two things — I can start with either.');
      feed.append(ask, reply);
    }
    feed.hidden = !feed.childElementCount;
    character.hidden = !!model.view || !!feed.childElementCount;
    // The workspace, and improvement 1: a Chat tab in its strip instead of a "Back to chat" link.
    workspace.hidden = !model.view;
    back.hidden = !!flags.chatTab;
    if (model.view) {
      title.textContent = text(project?.name, 'Project');
      const entries = flags.chatTab ? [['chat', 'Chat'], ...Object.entries(SECTION_LABELS)] : Object.entries(SECTION_LABELS);
      tabs.replaceChildren(...entries.map(([section, name]) => {
        const b = button('', 'project-tab', () => onAction?.(section === 'chat' ? 'lab:backToChat' : 'projectSection', project?.id, section));
        b.dataset.workspaceSection = section;
        const count = section === 'chat' ? `${project?.threads?.length ?? 0}` : text(project?.sections?.[section]?.badge, '');
        b.append(node('span', 'project-tab-name', name), node('span', 'project-tab-count', count));
        if (section === model.view.section) b.setAttribute('aria-current', 'page');
        return b;
      }));
      notice.textContent = text(project?.sections?.[model.view.section]?.accessible, '');
    }
  }
  return {
    el, host, setContext,
    /** The MutationObserver that mirrors the host is async; call this to settle it before measuring. */
    sync: mirror,
    setLabel(value) { tag.textContent = value; },
    destroy() { observer.disconnect(); el.remove(); },
  };
}
const FAKE = {
  't-left-bar': ['chat sits at the bottom of the left bar — that feels wrong', 'Agreed. Three shapes to look at, and a baseline of what you have now.'],
  't-threads': ['can a project hold more than one conversation?', 'It can now — home is the one without a thread id, so nothing had to migrate.'],
  't-glass': ['make the window glass', 'Done, with the muted ink darkened so it still reads at .78 over a black desktop.'],
};
/** A still of the character: one wet blob, two mismatched pips, a little spatter. */
const INK_BLOB = `<svg viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<g fill="#151413">
<path d="M200 44c54 0 108 28 128 74 19 44 4 96-40 124-38 24-96 30-142 18-48-13-86-48-90-92-4-46 28-92 78-112 21-8 44-12 66-12Z" opacity=".94"/>
<path d="M118 92c-18 14-30 34-32 56 14-10 20-30 32-56Z" opacity=".5"/>
<circle cx="322" cy="214" r="7"/><circle cx="336" cy="228" r="3"/><circle cx="74" cy="118" r="6"/><circle cx="62" cy="106" r="2.5"/>
</g>
<g fill="#f5f2ec"><ellipse cx="172" cy="152" rx="30" ry="36"/><ellipse cx="240" cy="150" rx="26" ry="33"/></g>
<g fill="#151413"><ellipse cx="174" cy="158" rx="12" ry="14"/><ellipse cx="240" cy="156" rx="11" ry="13"/></g>
<g fill="#f5f2ec"><circle cx="179" cy="150" r="3.5"/><circle cx="245" cy="149" r="3"/></g>
</svg>`;

/** The project options card. Not what varies between designs, so every option shares it: the real
    controls from public/lib/margin-ui.js:271-317 — automation, spend cap, and the project actions. */
export function createCard({ title = 'Project', side = 'left' } = {}) {
  const el = node('section', `margin-card margin-card-${side} lab-card`);
  el.hidden = true; el.tabIndex = -1; el.setAttribute('role', 'dialog'); el.dataset.labRole = 'card';
  const heading = node('h2', '', title);
  heading.id = 'lab-card-heading-' + Math.random().toString(36).slice(2, 8);
  el.setAttribute('aria-labelledby', heading.id);
  const head = node('div', 'margin-card-head');
  const close = button('×', 'margin-close'); close.setAttribute('aria-label', 'Close');
  head.append(heading, close);
  const body = node('div', 'margin-card-body');
  const error = node('p', 'margin-error'); error.hidden = true; error.setAttribute('role', 'status');
  const scroll = node('div', 'margin-card-scroll'); scroll.tabIndex = 0;
  scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-labelledby', heading.id);
  scroll.append(body, error); el.append(head, scroll);
  let trigger = null;
  const card = {
    el, heading, body, error,
    get isOpen() { return !el.hidden; },
    open(source) {
      el.hidden = false; trigger = source || null;
      source?.setAttribute('aria-expanded', 'true');
      el.focus({ preventScroll: true });
    },
    close(restore = false) {
      if (el.hidden) return false;
      el.hidden = true; trigger?.setAttribute('aria-expanded', 'false');
      const last = trigger; trigger = null;
      if (restore && last?.isConnected) last.focus({ preventScroll: true });
      return true;
    },
    get trigger() { return trigger; },
  };
  close.addEventListener('click', () => card.close(true));
  return card;
}
const money = v => typeof v === 'number' && Number.isFinite(v) ? `$${Math.max(0, v).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—';
export function fillProjectCard(card, project, { onAction, busy = false } = {}) {
  card.heading.textContent = text(project.name, 'Untitled project');
  const done = project.done, total = project.total;
  const fraction = Number.isFinite(done) && Number.isFinite(total) && total > 0 ? Math.min(1, done / total) : null;
  const rows = [
    node('p', 'margin-muted', `Working branch · ${text(project.branch, 'not available')}`),
    node('p', 'margin-goal', text(project.goal, 'No goal set')),
    node('p', 'margin-muted', fraction === null ? 'Progress not available' : `${Math.min(done, total)} of ${total} complete`),
  ];
  const meter = node('div', 'margin-progress'); meter.setAttribute('aria-hidden', 'true');
  const fill = node('span'); fill.style.width = `${(fraction ?? 0) * 100}%`; meter.append(fill); meter.hidden = fraction === null;
  const stats = node('p', 'margin-project-stats',
    `${project.inFlight ?? 0} in flight · ${project.pending ?? 0} pending · ${project.staged ?? 0} staged · ${money(project.spend)} spent · ${project.spendCap ? 'Cap ' + money(project.spendCap) : 'No cap'}`);
  const segmentLabel = node('p', 'margin-field-label', 'Automation');
  const segment = node('div', 'margin-segment'); segment.setAttribute('role', 'group'); segment.setAttribute('aria-label', 'Automation mode');
  for (const mode of ['off', 'suggest', 'stage', 'ship']) {
    const b = button(mode, 'margin-mode', () => onAction?.('autoMode', project.id, mode));
    b.setAttribute('aria-pressed', String(mode === text(project.mode, 'off'))); b.disabled = busy;
    segment.append(b);
  }
  const capRow = node('div', 'margin-cap');
  const capLabel = node('label', '', 'Spend cap ($)');
  const cap = node('input'); cap.type = 'number'; cap.min = '0'; cap.step = '0.01';
  cap.id = 'lab-cap-' + Math.random().toString(36).slice(2, 8); capLabel.htmlFor = cap.id;
  cap.value = Number.isFinite(project.spendCap) ? String(Math.max(0, project.spendCap)) : '';
  const save = button('Save', 'margin-pill', () => onAction?.('spendCap', project.id, cap.valueAsNumber || 0));
  save.disabled = busy; capRow.append(capLabel, cap, save);
  const actions = node('div', 'margin-actions');
  for (const [action, label] of [['repository', 'Repository & GitHub'], ['plan', 'Plan'], ['play', 'Play'], ['fix', 'Fix…'], ['review', 'Review'], ['providers', 'Providers']]) {
    const b = button(label, 'margin-pill', () => onAction?.(action, project.id));
    b.disabled = action !== 'repository' && (busy || (action === 'plan' && project.planAvailable === false) || (action === 'play' && project.playable !== true));
    actions.append(b);
  }
  card.body.replaceChildren(...rows.slice(0, 3), meter, stats, segmentLabel, segment, capRow, node('p', 'margin-muted', '0 means no cap.'), actions);
  return card;
}
/** The settings sheet, shared for the same reason. Ids match the app so the pinned checks stay honest. */
export function fillSettingsCard(card, { settings = {}, onAction } = {}) {
  card.heading.textContent = 'Settings';
  const prefs = [['microphone', 'Hey Nibbi microphone', 'st-microphone'], ['voice', 'Spoken replies', 'st-voice'], ['sounds', 'Sound effects', 'st-sounds'],
    ['notifications', 'Notifications', 'st-notifications'], ['calm', 'Calm motion', 'st-motion'], ['glass', 'Glass window', 'st-glass'], ['demo', 'Demo brain', 'st-demo']];
  const items = prefs.map(([action, label, id]) => {
    const b = button('', 'margin-pref', () => onAction?.(action)); b.id = id;
    const on = action === 'calm' ? !!(settings.calm || settings.systemReduced) : !!settings[action];
    b.append(node('span', '', label), node('span', 'margin-pref-value', on ? 'On' : 'Off'));
    b.setAttribute('aria-pressed', String(on));
    return b;
  });
  const actions = node('div', 'margin-actions');
  for (const [action, label, id] of [['advancedSettings', 'Advanced settings', 'st-platform'], ['model', 'Model & providers', 'st-model'], ['tidy', 'Tidy conversation', 'st-clear']]) {
    const b = button(label, 'margin-pill', () => onAction?.(action)); b.id = id; actions.append(b);
  }
  const meta = node('dl', 'margin-metadata');
  for (const [key, label] of [['brain', 'Brain'], ['session', 'Session'], ['model', 'Model'], ['provider', 'Provider'], ['context', 'Context']]) {
    const row = node('div', 'margin-data-row'); row.append(node('dt', '', label), node('dd', '', text(settings[key]))); meta.append(row);
  }
  card.body.replaceChildren(...items, actions, meta);
  return card;
}

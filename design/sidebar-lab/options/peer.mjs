/** peer — today's disclosure tree with one row moved. Chat stops being the tail of a project and
    becomes its first child: a row that reads like Builds, Issues and Plans and is itself a dropdown.
    Everything else is _today's DOM, class for class, so margins.css keeps styling it and every pinned
    selector the app's suites reach for is still here. The plumbing is _today's too: host-scoped
    listeners, no matchMedia, no persistence — three of these run side by side on one page. */
import { node, button, icon, text, relative, loadCss, progressLine, projectSummary, rollup, createCard, fillProjectCard, fillSettingsCard } from '../chrome.mjs';

export const meta = {
  id: 'peer',
  name: 'Peer',
  tagline: 'chat is the first row under a project, and a dropdown of its own',
  pattern: 'disclosure tree with a promoted chat node (t3code legacy, Claude Code desktop, Zed)',
  references: [
    { name: 't3code legacy sidebar — the tree Nibbi already has', url: 'https://github.com/pingdotgg/t3code/blob/main/apps/web/src/components/LegacySidebar.tsx' },
    { name: 't3code Sidebar V2 — hover fades the time to reveal a row action', url: 'https://github.com/pingdotgg/t3code/blob/main/apps/web/src/components/sidebar/SidebarThreadHeader.tsx' },
    { name: 'public/lib/margin-ui.js:245-378 — the rows this reuses', url: '' },
  ],
  answers: 'Chat becomes a peer of Builds, Issues and Plans instead of the footnote under them: the first row a project opens to, carrying "4 · 24m" the way Builds carries "71 need attention", and opening into New thread plus the conversations. That is the dropdown the owner asked for, one level in from the project row, and it takes aria-current when its conversation fills the workspace, so chat and records mark themselves the same way. New project moves up to the "Projects" heading as a +, so the list starts with projects. The one thing it changes beyond the move: quiet text is darkened from the app\'s --ink-3 (#6f6b65, 4.33:1 on the bar\'s #ece8e0) to #5f5b55 (5.52:1), because the badges and times it promotes are 10 and 11px.',
  risks: [
    'The Chat row does two jobs. When its conversation is already in the workspace a click collapses the list; otherwise a click opens the conversation. One control, two outcomes, told apart only by aria-current — the sections never have to make that distinction.',
    'The tree is now two disclosures deep. An expanded project costs nine rows before the next project starts, so 12 projects scroll where today\'s bar showed eight.',
    'Chat opens with its project, which pushes Builds, Issues and Plans below four conversations. The records the workspace duplicates are cheaper to reach than the records it does not.',
    'It is still a tree. Another project\'s conversation is two clicks, and nothing here removes the duplication between the bar\'s sections and the workspace tab strip — chatTab only adds Chat to both.',
  ],
  flags: ['chatTab', 'pinnedNew', 'summaryLine', 'progressFoot', 'hoverGear', 'rollupText', 'threadActions'],
  pinned: ['workspace-sidebar', 'sidebar-toggle', 'sidebar-collapse', 'sidebar-backdrop', 'project-rail', 'settings-rail',
    'sidebar-progress', 'status', 'margin-new', 'project-id', 'project-options', 'project-section', 'section-current',
    'section-badge', 'project-thread', 'project-thread-new', 'project-thread-when', 'workspace-left'],
};

const SECTIONS = [['builds', 'Builds', 'build'], ['issues', 'Issues', 'issue'], ['plans', 'Plans', 'plan']];
const latestOf = (threads, now) => {
  let best = null;
  for (const t of threads) if (!best || Date.parse(t.lastAt) > Date.parse(best.lastAt)) best = t;
  return best ? relative(best.lastAt, now) : '';
};

export function mount(host, { model, state = 'home', viewport, reduced = false, flags = {}, onAction } = {}) {
  loadCss(new URL('./peer.css', import.meta.url).href);
  let M = model, V = viewport, F = { ...flags }, open = true, dead = false;
  const expanded = new Set([model?.activeProject].filter(Boolean));
  // Chat opens with its project; this remembers only the ones a hand closed, so the default is "chat".
  const chatClosed = new Set();

  const root = node('div', 'sidebar-lab-peer');
  const toggle = button('', 'sidebar-toggle', () => setSidebar(!open, true));
  toggle.dataset.labRole = 'toggle'; toggle.dataset.pin = 'sidebar-toggle';
  toggle.append(icon('sidebar'));
  const backdrop = button('', 'sidebar-backdrop', () => setSidebar(false, true));
  backdrop.dataset.labRole = 'backdrop'; backdrop.tabIndex = -1; backdrop.setAttribute('aria-label', 'Close sidebar'); backdrop.hidden = true;
  const sidebar = node('aside', 'workspace-sidebar'); sidebar.dataset.pin = 'workspace-sidebar';
  sidebar.setAttribute('aria-label', 'Projects and settings');
  const head = node('div', 'sidebar-head');
  const collapse = button('', 'sidebar-collapse', () => setSidebar(false, true));
  collapse.dataset.labRole = 'collapse'; collapse.append(icon('sidebar')); collapse.setAttribute('aria-label', 'Close sidebar');
  head.append(node('span', 'sidebar-brand', 'nibbi'), collapse);
  const left = node('nav', 'margin-rail margin-projects'); left.dataset.pin = 'project-rail'; left.setAttribute('aria-label', 'Projects');
  const right = node('nav', 'margin-rail margin-settings'); right.dataset.pin = 'settings-rail'; right.setAttribute('aria-label', 'Settings');
  // New project rides the heading row, so the list below it is only projects.
  const titleRow = node('div', 'sidebar-title-row');
  const title = node('h2', 'sidebar-section-title', 'Projects');
  const add = button('', 'margin-new sidebar-new-project', () => onAction?.('newProject'));
  add.dataset.labRole = 'new-project'; add.dataset.labKey = 'new-project';
  add.append(icon('plus'));
  add.setAttribute('aria-label', 'New project'); add.title = 'New project';
  titleRow.append(title, add);
  const progress = node('p', 'margin-muted sidebar-progress'); progress.dataset.pin = 'sidebar-progress';
  progress.setAttribute('role', 'status'); progress.style.margin = '-4px 12px 10px';
  const list = node('div', 'margin-project-list');
  const footProgress = node('p', 'margin-muted sidebar-progress-foot');
  const footRollup = node('p', 'margin-muted sidebar-rollup'); footRollup.dataset.labRole = 'rollup';
  left.append(titleRow, progress, list);
  const settingsButton = button('', 'margin-glyph', () => openCard(settingsCard, settingsButton));
  settingsButton.dataset.labRole = 'settings'; settingsButton.dataset.pin = 'status';
  settingsButton.setAttribute('aria-label', 'Settings'); settingsButton.setAttribute('aria-haspopup', 'dialog'); settingsButton.setAttribute('aria-expanded', 'false');
  const core = node('span', 'margin-glyph-core'); core.append(icon('settings'));
  settingsButton.append(core, node('span', 'label margin-glyph-label', 'Settings'));
  right.append(settingsButton);
  sidebar.append(head, left, right);
  const projectCard = createCard({ title: 'Project' });
  const settingsCard = createCard({ title: 'Settings', side: 'right' });
  root.append(toggle, backdrop, sidebar, projectCard.el, settingsCard.el);
  host.append(root);

  function openCard(card, source) {
    const other = card === projectCard ? settingsCard : projectCard;
    other.close();
    if (card.isOpen && card.trigger === source) { card.close(true); return; }
    card.close();
    if (card === settingsCard) fillSettingsCard(card, { settings: M.settings, onAction });
    card.open(source);
  }
  const closeCards = (restore = false) => [projectCard.close(restore), settingsCard.close(restore)].some(Boolean);

  function setSidebar(value, focusMove = false) {
    open = !!value;
    if (!open) closeCards();
    root.classList.toggle('sidebar-open', open);
    host.classList.toggle('sidebar-open', open);
    host.style.setProperty('--workspace-left', open && !V.narrow ? '256px' : '0px');
    sidebar.setAttribute('aria-hidden', String(!open)); sidebar.inert = !open;
    sidebar.setAttribute('role', 'complementary');
    toggle.hidden = open; toggle.setAttribute('aria-expanded', String(open));
    const others = F.rollupText ? rollup(M, M.activeProject) : '';
    toggle.setAttribute('aria-label', open ? 'Close sidebar' : 'Open sidebar' + (others ? ` — ${others}` : ''));
    toggle.title = others || 'Projects and settings';
    backdrop.hidden = !open || !V.narrow;
    if (focusMove) (open ? collapse : toggle).focus({ preventScroll: true });
  }
  function render() {
    if (dead) return;
    const key = document.activeElement?.dataset?.labKey;
    progress.textContent = progressLine(M.progress);
    progress.hidden = !!F.progressFoot;
    footProgress.textContent = progressLine(M.progress);
    if (F.progressFoot) right.prepend(footProgress); else footProgress.remove();
    const others = F.rollupText ? rollup(M, M.activeProject) : '';
    footRollup.textContent = others;
    if (others) right.prepend(footRollup); else footRollup.remove();
    root.classList.toggle('is-hover-gear', !!F.hoverGear && !V.narrow);
    root.classList.toggle('is-thread-actions', !!F.threadActions);
    list.replaceChildren(...(M.projects || []).map(projectGroup));
    if (key) list.querySelector(`[data-lab-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
    if (projectCard.isOpen) {
      const shown = (M.projects || []).find(p => p.id === projectCard.el.dataset.project);
      if (shown) fillProjectCard(projectCard, shown, { onAction, busy: M.busy }); else projectCard.close();
    }
    setSidebar(open);
  }
  function projectGroup(project) {
    const group = node('div', 'project-group');
    const isOpen = expanded.has(project.id);
    const headingRow = node('div', 'project-heading-row');
    const row = button('', 'margin-project', () => {
      if (isOpen) expanded.delete(project.id);
      else { expanded.add(project.id); chatClosed.delete(project.id); onAction?.('selectProject', project.id); }
      render();
    });
    row.dataset.projectId = project.id; row.dataset.labKey = 'p:' + project.id;
    row.classList.toggle('is-active', project.id === M.activeProject);
    row.setAttribute('aria-expanded', String(isOpen));
    row.setAttribute('aria-current', project.id === M.activeProject ? 'true' : 'false');
    const ring = node('span', 'project-folder'); ring.append(icon('folder'));
    const labels = node('span', 'margin-project-labels');
    const summary = isOpen && !F.summaryLine ? text(project.branch, 'Project') : projectSummary(project, F);
    labels.append(node('span', 'margin-project-name', text(project.name, 'Untitled project')), node('span', 'margin-project-summary', summary));
    const caret = node('span', 'project-caret'); caret.append(icon('chevron'));
    row.append(ring, labels, caret);
    row.setAttribute('aria-label', `${text(project.name)}. ${summary}`);
    row.title = `${text(project.name)} — ${summary}`;
    const options = button('', 'project-options', () => {
      projectCard.el.dataset.project = project.id;
      fillProjectCard(projectCard, project, { onAction, busy: M.busy });
      openCard(projectCard, options);
    });
    options.dataset.labRole = 'gear'; options.dataset.labKey = 'g:' + project.id;
    options.append(icon('settings'));
    options.setAttribute('aria-label', `Project settings for ${text(project.name, 'Untitled project')}`);
    options.title = 'Project settings'; options.setAttribute('aria-haspopup', 'dialog');
    options.setAttribute('aria-expanded', String(projectCard.isOpen && projectCard.el.dataset.project === project.id));
    headingRow.append(row, options); group.append(headingRow);
    if (!isOpen) return group;
    const children = node('div', 'project-sections');
    const sections = SECTIONS.map(([section, label, glyph]) => {
      const info = project.sections?.[section] || {};
      const child = button('', 'project-section', () => onAction?.('projectSection', project.id, section));
      child.dataset.projectSection = section; child.dataset.sectionProject = project.id; child.dataset.labKey = `s:${project.id}:${section}`;
      const copy = node('span', 'project-section-copy'), top = node('span', 'project-section-top');
      const badge = node('span', 'project-section-badge', text(info.badge, 'Loading…'));
      badge.dataset.tone = info.tone || 'quiet'; badge.dataset.badge = 'true';
      const detail = node('span', 'project-section-detail', text(info.detail, '')); detail.hidden = !info.detail;
      top.append(node('span', 'project-section-name', label), badge); copy.append(top, detail);
      child.append(icon(glyph), copy);
      if (M.view?.project === project.id && M.view?.section === section) child.setAttribute('aria-current', 'page');
      child.setAttribute('aria-label', `${label} for ${text(project.name)}${info.accessible ? '. ' + info.accessible : ''}`);
      return child;
    });
    // The move: chat leads, and it is a disclosure rather than a run of rows.
    children.append(chatGroup(project), ...sections);
    group.append(children);
    return group;
  }
  /** Chat: a section row by every visual measure, a dropdown by behaviour. */
  function chatGroup(project) {
    const wrap = node('div', 'project-chat-group');
    const threads = project.threads || [];
    const chatOpen = !chatClosed.has(project.id);
    // Current for the same reason a section is current: its records are what the workspace is showing.
    const current = !M.view && threads.some(t => t.active);
    const when = latestOf(threads, M.now);
    const row = button('', 'project-section project-chat', () => {
      // Already the workspace? Then the only thing left to do is fold the list away.
      if (current) { if (chatOpen) chatClosed.add(project.id); else chatClosed.delete(project.id); render(); return; }
      chatClosed.delete(project.id);
      const target = threads.find(t => t.active) || threads[0];
      if (target) onAction?.('thread', project.id, target.id);
      render();
    });
    row.dataset.labRole = 'chat'; row.dataset.chatProject = project.id; row.dataset.labKey = 'c:' + project.id;
    row.setAttribute('aria-expanded', String(chatOpen));
    if (current) row.setAttribute('aria-current', 'page');
    const copy = node('span', 'project-section-copy'), top = node('span', 'project-section-top');
    const count = node('span', 'project-section-badge project-chat-count', `${threads.length}${when ? ` · ${when}` : ''}`);
    count.dataset.tone = 'quiet';
    top.append(node('span', 'project-section-name', 'Chat'), count);
    copy.append(top);
    const caret = node('span', 'project-caret project-chat-caret'); caret.append(icon('caret'));
    row.append(icon('thread'), copy, caret);
    const label = `Chat in ${text(project.name)} — ${threads.length} conversation${threads.length === 1 ? '' : 's'}${when ? `, last message ${when}` : ''}`;
    row.setAttribute('aria-label', current ? `${label}. Open` : label);
    row.title = label;
    wrap.append(row);
    if (!chatOpen) return wrap;
    const body = node('div', 'project-chat-body');
    const threadList = node('div', 'project-threads');
    threadList.append(...threads.map(thread => threadRow(project, thread)));
    const fresh = button('', 'project-section project-thread-new', () => onAction?.('newThread', project.id));
    fresh.dataset.labRole = 'new-thread'; fresh.dataset.labKey = 'n:' + project.id;
    fresh.disabled = !!M.busy;
    fresh.append(icon('newThread'), node('span', 'project-section-copy', 'New thread'));
    fresh.setAttribute('aria-label', `New thread in ${text(project.name)}`);
    // pinnedNew, inside the disclosure: lead the conversations instead of trailing them.
    body.append(...(F.pinnedNew ? [fresh, threadList] : [threadList, fresh]));
    wrap.append(body);
    return wrap;
  }
  function threadRow(project, thread) {
    const wrap = node('div', 'project-thread-row');
    const el = button('', 'project-section project-thread', () => onAction?.('thread', project.id, thread.id));
    el.dataset.threadId = thread.id; el.dataset.threadProject = project.id; el.dataset.labKey = `t:${project.id}:${thread.id}`;
    const when = relative(thread.lastAt, M.now);
    const name = text(thread.title, 'Thread');
    el.append(icon('thread'), node('span', 'project-section-copy', name), node('span', 'project-thread-when', when));
    el.title = name;   // the rows truncate, so the full name is always one hover away
    el.setAttribute('aria-label', `${name} thread in ${text(project.name)}${when ? ', last message ' + when : ''}`);
    if (thread.active) el.setAttribute('aria-current', 'true');
    wrap.append(el);
    // threadActions: the time fades out, rename and archive fade in. Siblings, not nested buttons.
    if (F.threadActions) {
      const actions = node('span', 'project-thread-actions');
      for (const [glyph, action, verb] of [['pencil', 'lab:renameThread', 'Rename'], ['archive', 'lab:archiveThread', 'Archive']]) {
        const b = button('', 'project-thread-action', () => onAction?.(action, project.id, thread.id));
        b.dataset.labKey = `${verb}:${project.id}:${thread.id}`;
        b.append(icon(glyph));
        b.setAttribute('aria-label', `${verb} ${name}`); b.title = `${verb} conversation`;
        actions.append(b);
      }
      wrap.append(actions);
    }
    return wrap;
  }

  const onKey = event => {
    if (event.key !== 'Escape') return;
    if (closeCards(true)) { event.preventDefault(); event.stopPropagation(); return; }
    if (open) { event.preventDefault(); event.stopPropagation(); setSidebar(false, true); }
  };
  const onPointer = event => {
    if (!root.contains(event.target)) return;
    if (!event.target.closest('.lab-card, [data-lab-role="gear"], [data-lab-role="settings"]')) closeCards();
  };
  host.addEventListener('keydown', onKey, true);
  host.addEventListener('pointerdown', onPointer, true);

  const api = {
    cue(id) {
      closeCards();
      expanded.clear(); expanded.add(M.activeProject);
      chatClosed.clear();
      if (id === 'switch') { const other = (M.projects || []).find(p => p.id !== M.activeProject); if (other) expanded.add(other.id); }
      // Records fill the workspace: chat is not what you are reading, so it folds away.
      if (id === 'builds') chatClosed.add(M.activeProject);
      setSidebar(id !== 'collapsed');
      render();
      if (id === 'card') {
        const project = (M.projects || []).find(p => p.id === M.activeProject);
        const gear = list.querySelector(`[data-lab-key="g:${project?.id}"]`);
        if (project && gear) { projectCard.el.dataset.project = project.id; fillProjectCard(projectCard, project, { onAction, busy: M.busy }); openCard(projectCard, gear); }
      }
    },
    setModel(next) { M = next; render(); },
    setReduced(value) { reduced = !!value; root.classList.toggle('is-reduced', reduced); },
    setFlags(next) { F = { ...next }; render(); },
    setViewport(next) { V = next; root.classList.toggle('is-narrow', !!next.narrow); render(); },
    focus() { (open ? sidebar.querySelector('button') : toggle).focus({ preventScroll: true }); },
    destroy() {
      dead = true;
      host.removeEventListener('keydown', onKey, true); host.removeEventListener('pointerdown', onPointer, true);
      root.remove(); host.classList.remove('sidebar-open'); host.style.removeProperty('--workspace-left');
    },
  };
  api.setReduced(reduced); api.setViewport(viewport); api.cue(state);
  return api;
}

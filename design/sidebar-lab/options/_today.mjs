/** The bar as it is today, so every other design is judged against the real thing rather than a memory
    of it. The DOM follows installMarginUI() (public/lib/margin-ui.js:71-460) and uses the app's own class
    names, so the real margins.css styles it. What changes: listeners are scoped to the host instead of
    the document, matchMedia is replaced by the passed viewport, and nothing is persisted — three of
    these run side by side on one page, and a document-scoped singleton would fight the others. */
import { node, button, icon, text, relative, loadCss, progressLine, projectSummary, rollup, createCard, fillProjectCard, fillSettingsCard } from '../chrome.mjs';

export const meta = {
  id: '_today',
  name: 'Today',
  tagline: 'the bar as it ships: records first, conversations last',
  pattern: 'disclosure tree (t3code legacy, Claude Code desktop, Zed)',
  references: [
    { name: 'public/lib/margin-ui.js:245-378', url: '' },
    { name: 't3code legacy sidebar', url: 'https://github.com/pingdotgg/t3code/blob/main/apps/web/src/components/LegacySidebar.tsx' },
  ],
  answers: 'It is the complaint. A project expands to Builds, Issues and Plans, and the conversations trail underneath with New thread last.',
  risks: [
    'Conversations rank below three record types you open far less often.',
    'Another project\'s conversation is two clicks and a scroll away once one project is expanded.',
    'The workspace repeats Builds / Issues / Plans as tabs, so the same navigation is in two places and chat is in neither.',
  ],
  flags: ['pinnedNew', 'summaryLine', 'progressFoot', 'hoverGear', 'rollupText'],
  pinned: ['workspace-sidebar', 'sidebar-toggle', 'sidebar-collapse', 'sidebar-backdrop', 'project-rail', 'settings-rail',
    'sidebar-progress', 'status', 'margin-new', 'project-id', 'project-options', 'project-section', 'section-current',
    'section-badge', 'project-thread-new', 'workspace-left'],
};

const SECTIONS = [['builds', 'Builds', 'build'], ['issues', 'Issues', 'issue'], ['plans', 'Plans', 'plan']];

export function mount(host, { model, state = 'home', viewport, reduced = false, flags = {}, onAction } = {}) {
  loadCss(new URL('./_today.css', import.meta.url).href);
  let M = model, V = viewport, F = { ...flags }, open = true, dead = false;
  const expanded = new Set([model?.activeProject].filter(Boolean));

  const root = node('div', 'sidebar-lab-_today');
  const toggle = button('', 'sidebar-toggle', () => setSidebar(!open, true));
  toggle.id = ''; toggle.dataset.labRole = 'toggle'; toggle.dataset.pin = 'sidebar-toggle';
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
  const add = button('', 'margin-project margin-new', () => onAction?.('newProject'));
  add.dataset.labRole = 'new-project';
  add.append(icon('plus'), node('span', 'margin-project-name', 'New project'));
  const title = node('h2', 'sidebar-section-title', 'Projects');
  const progress = node('p', 'margin-muted sidebar-progress'); progress.dataset.pin = 'sidebar-progress';
  progress.setAttribute('role', 'status'); progress.style.margin = '-4px 12px 10px';
  const list = node('div', 'margin-project-list');
  const footProgress = node('p', 'margin-muted sidebar-progress-foot');
  const footRollup = node('p', 'margin-muted sidebar-rollup'); footRollup.dataset.labRole = 'rollup';
  left.append(add, title, progress, list);
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
    sidebar.setAttribute('role', V.narrow ? 'complementary' : 'complementary');
    toggle.hidden = open; toggle.setAttribute('aria-expanded', String(open));
    const others = F.rollupText ? rollup(M, M.activeProject) : '';
    toggle.setAttribute('aria-label', open ? 'Close sidebar' : 'Open sidebar' + (others ? ` — ${others}` : ''));
    toggle.title = others || 'Projects and settings';
    backdrop.hidden = !open || !V.narrow;
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
    list.replaceChildren(...(M.projects || []).map(projectGroup));
    if (key) list.querySelector(`[data-lab-key="${key}"]`)?.focus({ preventScroll: true });
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
      if (isOpen) expanded.delete(project.id); else { expanded.add(project.id); onAction?.('selectProject', project.id); }
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
    const threads = node('div', 'project-threads');
    threads.append(...(project.threads || []).map(thread => {
      const el = button('', 'project-section project-thread', () => onAction?.('thread', project.id, thread.id));
      el.dataset.threadId = thread.id; el.dataset.threadProject = project.id; el.dataset.labKey = `t:${project.id}:${thread.id}`;
      const when = relative(thread.lastAt, M.now);
      el.append(icon('thread'), node('span', 'project-section-copy', text(thread.title, 'Thread')), node('span', 'project-thread-when', when));
      el.setAttribute('aria-label', `${text(thread.title, 'Thread')} thread in ${text(project.name)}${when ? ', last message ' + when : ''}`);
      if (thread.active) el.setAttribute('aria-current', 'true');
      return el;
    }));
    const fresh = button('', 'project-section project-thread-new', () => onAction?.('newThread', project.id));
    fresh.dataset.labRole = 'new-thread'; fresh.dataset.labKey = 'n:' + project.id;
    fresh.disabled = !!M.busy;
    fresh.append(icon('newThread'), node('span', 'project-section-copy', 'New thread'));
    // Today: records, then conversations, then New thread. pinnedNew is improvement 2.
    children.append(...sections, ...(F.pinnedNew ? [fresh, threads] : [threads, fresh]));
    group.append(children);
    return group;
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
      if (id === 'switch') { const other = (M.projects || []).find(p => p.id !== M.activeProject); if (other) expanded.add(other.id); }
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

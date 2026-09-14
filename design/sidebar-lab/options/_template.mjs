/** The skeleton every design starts from. Plain on purpose: it shows the contract working, not a point
    of view. Copy this file and its stylesheet, rename both, and change the render — not the plumbing. */
import { node, button, icon, text, relative, loadCss, progressLine, projectSummary, attentionOf, rollup, createCard, fillProjectCard, fillSettingsCard } from '../chrome.mjs';

export const meta = {
  id: '_template',
  name: 'Template',
  tagline: 'the contract, rendered plainly',
  pattern: 'none — a skeleton',
  references: [],
  answers: 'It does not. It proves the shell, the checks and the sheet before a real design lands.',
  risks: ['Not a design. Never recommend it.'],
  flags: ['pinnedNew', 'summaryLine', 'progressFoot', 'hoverGear', 'rollupText'],
  pinned: ['workspace-sidebar', 'sidebar-toggle', 'sidebar-collapse', 'sidebar-backdrop', 'project-rail', 'settings-rail', 'sidebar-progress', 'status', 'margin-new', 'project-id', 'project-options', 'project-section', 'section-current', 'section-badge', 'project-thread-new', 'workspace-left'],
};

export function mount(host, { model, state = 'home', viewport, reduced = false, flags = {}, onAction } = {}) {
  loadCss(new URL('./_template.css', import.meta.url).href);
  let M = model, V = viewport, F = { ...flags }, open = true, expanded = new Set(), dead = false;

  const root = node('div', 'sidebar-lab-_template');
  const toggle = button('', 'lab-toggle', () => setSidebar(!open, true));
  toggle.dataset.labRole = 'toggle'; toggle.dataset.pin = 'sidebar-toggle';
  toggle.append(icon('sidebar')); toggle.setAttribute('aria-label', 'Open sidebar');
  const backdrop = button('', 'lab-backdrop', () => setSidebar(false, true));
  backdrop.dataset.labRole = 'backdrop'; backdrop.tabIndex = -1; backdrop.setAttribute('aria-label', 'Close sidebar'); backdrop.hidden = true;
  const bar = node('aside', 'lab-bar'); bar.dataset.pin = 'workspace-sidebar'; bar.setAttribute('aria-label', 'Projects and settings');
  const head = node('div', 'lab-bar-head');
  const collapse = button('', 'lab-collapse', () => setSidebar(false, true));
  collapse.dataset.labRole = 'collapse';
  collapse.append(icon('sidebar')); collapse.setAttribute('aria-label', 'Close sidebar');
  head.append(node('span', 'lab-brand', 'nibbi'), collapse);
  const rail = node('div', 'lab-rail'); rail.dataset.pin = 'project-rail';
  const foot = node('div', 'lab-foot'); foot.dataset.pin = 'settings-rail';
  const settingsButton = button('', 'lab-foot-button', () => openCard(settingsCard, settingsButton));
  settingsButton.dataset.labRole = 'settings'; settingsButton.dataset.pin = 'status';
  settingsButton.append(icon('settings'), node('span', '', 'Settings'));
  settingsButton.setAttribute('aria-expanded', 'false'); settingsButton.setAttribute('aria-haspopup', 'dialog');
  foot.append(settingsButton);
  const footProgress = node('p', 'lab-progress'); footProgress.setAttribute('role', 'status');
  const footRollup = node('p', 'lab-rollup'); footRollup.dataset.labRole = 'rollup';
  bar.append(head, rail, foot);
  const projectCard = createCard({ title: 'Project' });
  const settingsCard = createCard({ title: 'Settings', side: 'right' });
  root.append(toggle, backdrop, bar, projectCard.el, settingsCard.el);
  host.append(root);

  function openCard(card, source) {
    const other = card === projectCard ? settingsCard : projectCard;
    other.close();
    if (card.isOpen && card.trigger === source) { card.close(true); return; }
    card.close();
    if (card === settingsCard) fillSettingsCard(card, { settings: M.settings, onAction });
    card.open(source);
  }
  function closeTransient(restore = false) {
    return [projectCard.close(restore), settingsCard.close(restore)].some(Boolean);
  }
  function setSidebar(value, focusMove = false) {
    open = !!value;
    host.classList.toggle('sidebar-open', open);
    host.style.setProperty('--workspace-left', open && !V.narrow ? '256px' : '0px');
    bar.classList.toggle('is-open', open);
    bar.setAttribute('aria-hidden', String(!open));
    bar.inert = !open;
    toggle.hidden = open; toggle.setAttribute('aria-expanded', String(open));
    backdrop.hidden = !open || !V.narrow;
    bar.setAttribute('role', V.narrow ? 'dialog' : 'complementary');
    if (!open) closeTransient();
    if (focusMove) (open ? collapse : toggle).focus({ preventScroll: true });
    toggle.title = rollup(M, M.activeProject) || 'Projects and settings';
    toggle.setAttribute('aria-label', open ? 'Close sidebar' : `Open sidebar${F.rollupText && rollup(M, M.activeProject) ? ' — ' + rollup(M, M.activeProject) : ''}`);
  }

  function render() {
    if (dead) return;
    const active = document.activeElement, key = active?.dataset?.labKey;
    rail.replaceChildren();
    const add = button('', 'lab-row lab-new', () => onAction?.('newProject'));
    add.dataset.labRole = 'new-project'; add.append(icon('plus'), node('span', '', 'New project'));
    rail.append(add, node('h2', 'lab-heading', 'Projects'));
    const progress = node('p', 'lab-progress', progressLine(M.progress));
    progress.dataset.pin = 'sidebar-progress'; progress.setAttribute('role', 'status');
    if (F.progressFoot) { footProgress.textContent = progressLine(M.progress); if (!footProgress.isConnected) foot.prepend(footProgress); }
    else { footProgress.remove(); rail.append(progress); }
    for (const project of M.projects || []) rail.append(projectGroup(project));
    // Improvement 9: what the other projects want, in words. Never a mark on a control.
    const others = F.rollupText ? rollup(M, M.activeProject) : '';
    footRollup.textContent = others;
    if (others) foot.prepend(footRollup); else footRollup.remove();
    root.classList.toggle('is-hover-gear', !!F.hoverGear && !V.narrow);
    if (key) rail.querySelector(`[data-lab-key="${key}"]`)?.focus({ preventScroll: true });
    if (projectCard.isOpen) {
      const shown = (M.projects || []).find(p => p.id === projectCard.el.dataset.project);
      if (shown) fillProjectCard(projectCard, shown, { onAction, busy: M.busy }); else projectCard.close();
    }
    setSidebar(open);
  }
  function projectGroup(project) {
    const group = node('div', 'lab-group');
    const isOpen = expanded.has(project.id);
    const row = button('', 'lab-row lab-project', () => {
      if (isOpen) expanded.delete(project.id); else { expanded.add(project.id); onAction?.('selectProject', project.id); }
      render();
    });
    row.dataset.projectId = project.id; row.dataset.labKey = 'project:' + project.id;
    row.setAttribute('aria-expanded', String(isOpen));
    row.classList.toggle('is-active', project.id === M.activeProject);
    const labels = node('span', 'lab-labels');
    labels.append(node('span', 'lab-name', text(project.name)), node('span', 'lab-summary', projectSummary(project, F)));
    row.append(icon('folder'), labels, node('span', 'lab-caret'));
    row.lastChild.append(icon('chevron'));
    const gear = button('', 'lab-gear', () => {
      projectCard.el.dataset.project = project.id;
      fillProjectCard(projectCard, project, { onAction, busy: M.busy });
      openCard(projectCard, gear);
    });
    gear.dataset.labRole = 'gear'; gear.dataset.labKey = 'gear:' + project.id;
    gear.append(icon('settings')); gear.setAttribute('aria-label', `Project settings for ${text(project.name)}`);
    gear.setAttribute('aria-haspopup', 'dialog'); gear.setAttribute('aria-expanded', String(projectCard.isOpen && projectCard.el.dataset.project === project.id));
    const heading = node('div', 'lab-heading-row'); heading.append(row, gear);
    group.append(heading);
    if (!isOpen) return group;
    const children = node('div', 'lab-children');
    const threadRows = (project.threads || []).map(thread => {
      const b = button('', 'lab-row lab-thread', () => onAction?.('thread', project.id, thread.id));
      b.dataset.threadId = thread.id; b.dataset.threadProject = project.id; b.dataset.labKey = `thread:${project.id}:${thread.id}`;
      b.append(icon('thread'), node('span', 'lab-thread-name', text(thread.title, 'Thread')), node('span', 'lab-when', relative(thread.lastAt, M.now)));
      if (thread.active) b.setAttribute('aria-current', 'true');
      b.setAttribute('aria-label', `${text(thread.title, 'Thread')} thread in ${text(project.name)}`);
      return b;
    });
    const fresh = button('', 'lab-row lab-thread lab-new-thread', () => onAction?.('newThread', project.id));
    fresh.dataset.labRole = 'new-thread'; fresh.dataset.labKey = 'new-thread:' + project.id;
    fresh.disabled = !!M.busy; fresh.append(icon('newThread'), node('span', 'lab-thread-name', 'New thread'));
    const sections = ['builds', 'issues', 'plans'].map(section => {
      const info = project.sections?.[section] || {};
      const b = button('', 'lab-row lab-section', () => onAction?.('projectSection', project.id, section));
      b.dataset.projectSection = section; b.dataset.sectionProject = project.id; b.dataset.labKey = `section:${project.id}:${section}`;
      const copy = node('span', 'lab-section-copy');
      copy.append(node('span', '', section[0].toUpperCase() + section.slice(1)), node('span', 'lab-badge', text(info.badge, '')));
      copy.lastChild.dataset.tone = info.tone || 'quiet'; copy.lastChild.dataset.badge = 'true';
      b.append(icon(section === 'builds' ? 'build' : section === 'issues' ? 'issue' : 'plan'), copy);
      if (M.view?.project === project.id && M.view?.section === section) b.setAttribute('aria-current', 'page');
      b.setAttribute('aria-label', `${section} for ${text(project.name)}. ${text(info.accessible, '')}`);
      return b;
    });
    children.append(...(F.pinnedNew ? [fresh, ...threadRows] : [...threadRows, fresh]), ...sections);
    group.append(children);
    return group;
  }

  const onKey = event => {
    if (event.key !== 'Escape') return;
    if (closeTransient(true)) { event.preventDefault(); event.stopPropagation(); return; }
    if (open && (V.narrow || true)) { event.preventDefault(); event.stopPropagation(); setSidebar(false, true); }
  };
  const onPointer = event => { if (!root.contains(event.target)) return; if (!event.target.closest('.lab-card, [data-lab-role="gear"], [data-lab-role="settings"]')) closeTransient(); };
  host.addEventListener('keydown', onKey, true);
  host.addEventListener('pointerdown', onPointer, true);

  const api = {
    cue(id) {
      closeTransient();
      expanded = new Set([M.activeProject]);
      if (id === 'switch') { const other = (M.projects || []).find(p => p.id !== M.activeProject); if (other) expanded.add(other.id); }
      setSidebar(id !== 'collapsed');
      render();
      if (id === 'card') {
        const project = (M.projects || []).find(p => p.id === M.activeProject);
        const gear = rail.querySelector(`[data-lab-key="gear:${project?.id}"]`);
        if (project && gear) { projectCard.el.dataset.project = project.id; fillProjectCard(projectCard, project, { onAction, busy: M.busy }); openCard(projectCard, gear); }
      }
    },
    setModel(next) { M = next; render(); },
    setReduced(value) { reduced = !!value; root.classList.toggle('is-reduced', reduced); },
    setFlags(next) { F = { ...next }; render(); },
    setViewport(next) { V = next; root.classList.toggle('is-narrow', !!next.narrow); setSidebar(open); render(); },
    focus() { (open ? bar.querySelector('button') : toggle).focus({ preventScroll: true }); },
    destroy() {
      dead = true;
      host.removeEventListener('keydown', onKey, true); host.removeEventListener('pointerdown', onPointer, true);
      root.remove(); host.classList.remove('sidebar-open'); host.style.removeProperty('--workspace-left');
    },
  };
  api.setReduced(reduced); api.setViewport(viewport); api.cue(state);
  return api;
}

/** scope — the bar is about ONE project at a time.
 *
 *  The complaint was "chat is at the bottom of the left bar when it should almost be a different tab
 *  on the projects bar, like a dropdown". This is the literal answer, in the shape t3code's Sidebar V2
 *  uses: a scope control on top whose popup anchors to the WHOLE bar (not to the caret), and beneath it
 *  a tab strip whose first tab is Chat. Nothing else about another project is in the bar — the switcher
 *  is how you leave, and one sentence at the foot says what the projects you cannot see want from you.
 *
 *  Everything is host-scoped: keydown and pointerdown listen on the host, viewport arrives as a prop,
 *  nothing is persisted, nothing reads the clock. Three of these share one page.
 */
import {
  node, button, icon, text, relative, loadCss, progressLine, projectSummary, attentionOf, rollup,
  createCard, fillProjectCard, fillSettingsCard,
} from '../chrome.mjs';

export const meta = {
  id: 'scope',
  name: 'Scope',
  tagline: 'one project at a time — a switcher on top, Chat as the first tab',
  pattern: 'scoped header + full-width dropdown (t3code Sidebar V2)',
  references: [
    { name: 't3code SidebarThreadHeader', url: 'https://github.com/pingdotgg/t3code/blob/main/apps/web/src/components/sidebar/SidebarThreadHeader.tsx' },
    { name: 't3code keybindings', url: 'https://github.com/pingdotgg/t3code/blob/main/docs/user/keybindings.md' },
    { name: 'the complaint the rollup answers', url: 'https://github.com/pingdotgg/t3code/issues/7954' },
  ],
  answers: 'Chat is a tab on the projects bar, and the projects bar is a dropdown. The switcher names the one project you are in and opens a full-width list of the rest; the strip under it leads with Chat, so conversations rank above Builds, Issues and Plans instead of trailing them.',
  risks: [
    'Only one project is ever in the bar. Another project\'s conversation costs two clicks and you lose sight of the one you left — the price of not having a second tree.',
    'The tab strip is permanent furniture: about 96px of the bar, and with chatTab on the same four tabs appear twice on screen (bar and workspace).',
    'The strip is a 2x2 block, not a row. Four tabs across 256px cannot carry "71 need attention" without truncating it, so the badge won and the single row lost.',
    'A dropdown hides the other projects by design, so the bar leans hard on one sentence of rollup text to keep them answerable. With rollupText off, it says nothing about them at all.',
  ],
  flags: ['chatTab', 'pinnedNew', 'summaryLine', 'progressFoot', 'hoverGear', 'rollupText', 'threadActions'],
  pinned: ['workspace-sidebar', 'sidebar-toggle', 'sidebar-collapse', 'sidebar-backdrop', 'project-rail', 'settings-rail',
    'sidebar-progress', 'status', 'margin-new', 'project-id', 'project-options', 'project-section', 'section-current',
    'section-badge', 'project-thread-new', 'workspace-left'],
};

const SECTIONS = [['builds', 'Builds'], ['issues', 'Issues'], ['plans', 'Plans']];
const SVG_NS = 'http://www.w3.org/2000/svg';
/** The one glyph chrome.mjs does not ship. Two paths, same stroke language as the rest. */
function searchGlyph() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  for (const d of ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z', 'm16.2 16.2 3.8 3.8']) {
    const p = document.createElementNS(SVG_NS, 'path'); p.setAttribute('d', d); svg.append(p);
  }
  return svg;
}
const isVisible = el => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };

/** "What is actually waiting", assembled from the model — never invented. */
function waitingLine(project, section) {
  if (section === 'builds') {
    const bits = [];
    if (project.inFlight) bits.push(`${project.inFlight} in flight`);
    if (project.staged) bits.push(`${project.staged} staged`);
    if (project.pending) bits.push(`${project.pending} pending`);
    return bits.length ? bits.join(' · ') : 'Nothing is queued.';
  }
  if (section === 'issues') {
    const open = String(project.sections?.issues?.badge || '').match(/^(\d+) open/);
    return open ? `${open[1]} open, none assigned here.` : 'Nothing is open.';
  }
  const { done, total } = project;
  if (Number.isFinite(done) && Number.isFinite(total) && total > 0) {
    const left = Math.max(0, total - done);
    return left ? `${left} task${left === 1 ? '' : 's'} left.` : 'Every task is done.';
  }
  return text(project.goal, 'No plan written yet.');
}
/** One real next move per section, all of them names handleMarginAction already understands. */
const SECTION_ACTION = {
  builds: ['review', 'Review'],
  issues: ['repository', 'Repository & GitHub'],
  plans: ['plan', 'Plan'],
};

export function mount(host, { model, state = 'home', viewport, reduced = false, flags = {}, onAction } = {}) {
  loadCss(new URL('./scope.css', import.meta.url).href);
  let M = model || { projects: [] };
  let V = viewport || { width: 1180, height: 760, narrow: false };
  let F = { ...flags };
  let open = true, menuOpen = false, query = '', dead = false;

  const root = node('div', 'sidebar-lab-scope');

  // --- the way back in ---------------------------------------------------------------------------
  const toggleBtn = button('', 'scope-toggle scope-icon-btn', () => { setSidebar(true); render(); trigger.focus({ preventScroll: true }); });
  toggleBtn.dataset.labRole = 'toggle'; toggleBtn.dataset.pin = 'sidebar-toggle';
  toggleBtn.append(icon('sidebar'));
  const backdrop = button('', 'scope-backdrop', () => { setSidebar(false); render(); toggleBtn.focus({ preventScroll: true }); });
  backdrop.dataset.labRole = 'backdrop'; backdrop.tabIndex = -1; backdrop.hidden = true;
  backdrop.setAttribute('aria-label', 'Close sidebar');

  // --- the bar -----------------------------------------------------------------------------------
  const bar = node('aside', 'scope-bar');
  bar.dataset.pin = 'workspace-sidebar';
  bar.setAttribute('aria-label', 'Project, conversations and settings');

  const head = node('div', 'scope-head');
  const collapse = button('', 'scope-icon-btn', () => { setSidebar(false); render(); toggleBtn.focus({ preventScroll: true }); });
  collapse.dataset.labRole = 'collapse'; collapse.setAttribute('aria-label', 'Close sidebar');
  collapse.append(icon('sidebar'));
  head.append(node('span', 'scope-brand', 'nibbi'), collapse);

  // --- the switcher: one row the width of the bar, and a popup that matches it --------------------
  const switcher = node('div', 'scope-switcher');
  switcher.dataset.pin = 'project-rail';
  const trigger = button('', 'scope-trigger', () => { if (menuOpen) closeMenu(true); else openMenu(false); });
  trigger.dataset.labRole = 'chooser';
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', 'false');
  const triggerGlyph = node('span', 'scope-trigger-glyph'); triggerGlyph.append(icon('folder'));
  const triggerLabels = node('span', 'scope-trigger-labels');
  const triggerName = node('span', 'scope-trigger-name', '');
  const triggerSummary = node('span', 'scope-trigger-summary', '');
  triggerLabels.append(triggerName, triggerSummary);
  const triggerCaret = node('span', 'scope-trigger-caret'); triggerCaret.append(icon('caret'));
  trigger.append(triggerGlyph, triggerLabels, triggerCaret);

  const menu = node('div', 'scope-menu'); menu.hidden = true;
  menu.setAttribute('aria-label', 'Projects');
  const searchWrap = node('div', 'scope-search');
  const search = document.createElement('input');
  search.type = 'text'; search.placeholder = 'Find a project'; search.autocomplete = 'off'; search.spellcheck = false;
  search.setAttribute('aria-label', 'Find a project');
  search.addEventListener('input', () => { query = search.value; renderMenu(); });
  searchWrap.append(searchGlyph(), search);
  const menuList = node('div', 'scope-menu-list');
  const menuEmpty = node('p', 'scope-menu-empty', 'No project matches.'); menuEmpty.hidden = true;
  const menuFoot = node('div', 'scope-menu-foot');
  const newProject = button('', 'scope-new-project', () => { closeMenu(false); onAction?.('newProject'); });
  newProject.dataset.labRole = 'new-project'; newProject.dataset.pin = 'margin-new';
  newProject.append(icon('plus'), node('span', '', 'New project'));
  menuFoot.append(newProject);
  menu.append(searchWrap, menuList, menuEmpty, menuFoot);
  switcher.append(trigger, menu);

  // --- the tab strip. Chat leads it. -------------------------------------------------------------
  const tabs = node('nav', 'scope-tabs');
  tabs.setAttribute('aria-label', 'Project sections');

  const body = node('div', 'scope-body');
  const progress = node('p', 'scope-progress');
  progress.dataset.pin = 'sidebar-progress'; progress.setAttribute('role', 'status');

  const foot = node('div', 'scope-foot');
  const rollupBtn = button('', 'scope-rollup', () => { if (!menuOpen) openMenu(false); });
  rollupBtn.dataset.labRole = 'rollup';

  const rail = node('nav', 'scope-rail');
  rail.dataset.pin = 'settings-rail'; rail.setAttribute('aria-label', 'Settings');
  const settingsBtn = button('', 'scope-settings', () => toggleSettingsCard());
  settingsBtn.dataset.labRole = 'settings'; settingsBtn.dataset.pin = 'status';
  settingsBtn.setAttribute('aria-haspopup', 'dialog'); settingsBtn.setAttribute('aria-expanded', 'false');
  settingsBtn.append(icon('settings'), node('span', '', 'Settings'));
  rail.append(settingsBtn);

  foot.append(rollupBtn);
  bar.append(head, switcher, tabs, body, foot, rail);

  const projectCard = createCard({ title: 'Project' });
  const settingsCard = createCard({ title: 'Settings' });
  root.append(toggleBtn, backdrop, bar, projectCard.el, settingsCard.el);
  host.append(root);

  // --- cards -------------------------------------------------------------------------------------
  function focusBack(source) {
    if (source && source.isConnected && isVisible(source)) source.focus({ preventScroll: true });
    else if (open) trigger.focus({ preventScroll: true });
    else toggleBtn.focus({ preventScroll: true });
  }
  /** Closes whatever is on top. A card first, then the dropdown — never both at once. */
  function closeOverlays(restore = false) {
    if (projectCard.isOpen || settingsCard.isOpen) {
      const source = projectCard.isOpen ? projectCard.trigger : settingsCard.trigger;
      projectCard.close(false); settingsCard.close(false);
      if (restore) focusBack(source);
      return true;
    }
    if (menuOpen) { closeMenu(restore); return true; }
    return false;
  }
  function openProjectCard(project, source) {
    if (!project) return;
    settingsCard.close(false); projectCard.close(false);
    projectCard.el.dataset.project = project.id;
    fillProjectCard(projectCard, project, { onAction, busy: M.busy });
    projectCard.open(source || trigger);
    // The gear lives in the dropdown; the card replaces it, so the list gets out of the way.
    closeMenu(false);
  }
  function toggleSettingsCard() {
    if (settingsCard.isOpen) { settingsCard.close(false); settingsBtn.focus({ preventScroll: true }); return; }
    projectCard.close(false); closeMenu(false);
    fillSettingsCard(settingsCard, { settings: M.settings, onAction });
    settingsCard.open(settingsBtn);
  }

  // --- the dropdown ------------------------------------------------------------------------------
  function openMenu(focusCurrent) {
    if (!open) return;
    projectCard.close(false); settingsCard.close(false);
    menuOpen = true; menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    renderMenu();
    if (focusCurrent) (menuList.querySelector('.is-current') || menuList.querySelector('.scope-option-main'))?.focus({ preventScroll: true });
  }
  function closeMenu(restore) {
    if (!menuOpen) return false;
    menuOpen = false; menu.hidden = true;
    query = ''; search.value = '';
    menuList.replaceChildren(); menuEmpty.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restore) trigger.focus({ preventScroll: true });
    return true;
  }
  function menuKeys(event) {
    const rows = [...menuList.querySelectorAll('.scope-option-main')];
    if (!rows.length) return;
    const here = rows.indexOf(document.activeElement);
    const go = el => { event.preventDefault(); el.focus({ preventScroll: true }); };
    if (event.key === 'ArrowDown') go(rows[here + 1] || rows[0]);
    else if (event.key === 'ArrowUp') go(here <= 0 ? rows[rows.length - 1] : rows[here - 1]);
    else if (event.key === 'Enter' && event.target === search) { event.preventDefault(); rows[0].click(); }
    else if (event.target !== search && event.key === 'Home') go(rows[0]);
    else if (event.target !== search && event.key === 'End') go(rows[rows.length - 1]);
  }

  // --- state -------------------------------------------------------------------------------------
  function activeProject() {
    return (M.projects || []).find(p => p.id === M.activeProject) || (M.projects || [])[0] || null;
  }
  function setSidebar(value) {
    open = !!value;
    if (!open) { projectCard.close(false); settingsCard.close(false); closeMenu(false); }
    root.classList.toggle('is-open', open);
    host.classList.toggle('sidebar-open', open);
    host.style.setProperty('--workspace-left', open && !V.narrow ? '256px' : '0px');
    bar.setAttribute('aria-hidden', String(!open));
    bar.inert = !open;
    toggleBtn.hidden = open;
    toggleBtn.setAttribute('aria-expanded', String(open));
    const others = F.rollupText ? rollup(M, M.activeProject) : '';
    toggleBtn.setAttribute('aria-label', open ? 'Close sidebar' : `Open sidebar${others ? ` — ${others}` : ''}`);
    toggleBtn.title = others || 'Projects and settings';
    backdrop.hidden = !open || !V.narrow;
  }

  // --- render ------------------------------------------------------------------------------------
  function render() {
    if (dead) return;
    const key = root.contains(document.activeElement) ? document.activeElement.dataset?.labKey : null;
    const project = activeProject();
    root.classList.toggle('is-hover-gear', !!F.hoverGear && !V.narrow);
    root.classList.toggle('is-thread-actions', !!F.threadActions);
    renderSwitcher(project);
    renderMenu();
    renderTabs(project);
    renderBody(project);
    renderFoot();
    setSidebar(open);
    if (key) root.querySelector(`[data-lab-key="${key}"]`)?.focus({ preventScroll: true });
    if (projectCard.isOpen) {
      const shown = (M.projects || []).find(p => p.id === projectCard.el.dataset.project);
      if (shown) fillProjectCard(projectCard, shown, { onAction, busy: M.busy }); else projectCard.close(false);
    }
  }

  function renderSwitcher(project) {
    const name = text(project?.name, 'No project');
    const summary = project ? projectSummary(project, F) : '';
    trigger.dataset.projectId = project?.id || '';
    trigger.dataset.labKey = 'chooser';
    triggerName.textContent = name;
    triggerSummary.textContent = summary;
    const others = F.rollupText ? rollup(M, M.activeProject) : '';
    trigger.setAttribute('aria-label', `${name}. ${summary}. Switch project${others ? `. ${others}` : ''}`);
    trigger.title = others ? `Switch project — ${others}` : `${name} — ${summary}`;
  }

  function renderMenu() {
    if (!menuOpen) { menuList.replaceChildren(); menuEmpty.hidden = true; return; }
    const q = query.trim().toLowerCase();
    const shown = (M.projects || []).filter(p => !q || String(p.name || '').toLowerCase().includes(q));
    menuList.replaceChildren(...shown.map(projectRow));
    menuEmpty.hidden = shown.length > 0;
  }
  function projectRow(project) {
    const wrap = node('div', 'scope-option');
    const current = project.id === M.activeProject;
    const main = button('', 'scope-option-main', () => { closeMenu(false); onAction?.('selectProject', project.id); });
    main.dataset.projectId = project.id; main.dataset.labKey = `o:${project.id}`;
    main.classList.toggle('is-current', current);
    if (current) main.setAttribute('aria-current', 'true');
    const glyph = node('span', 'scope-option-glyph'); glyph.append(icon('folder'));
    // Attention in words (chrome.mjs), the branch when a project is quiet. Never a dot.
    const note = attentionOf(project) || text(project.branch, '');
    main.append(glyph, node('span', 'scope-option-name', text(project.name, 'Untitled project')), node('span', 'scope-option-note', note));
    main.setAttribute('aria-label', `${text(project.name, 'Untitled project')}${note ? `, ${note}` : ''}${current ? ', current project' : ''}`);
    main.title = `${text(project.name, 'Untitled project')}${note ? ` — ${note}` : ''}`;
    const gear = button('', 'scope-option-gear', () => openProjectCard(project, gear));
    gear.dataset.labRole = 'gear'; gear.dataset.pin = 'project-options'; gear.dataset.labKey = `g:${project.id}`;
    gear.append(icon('settings'));
    gear.setAttribute('aria-label', `Project settings for ${text(project.name, 'Untitled project')}`);
    gear.setAttribute('aria-haspopup', 'dialog');
    gear.setAttribute('aria-expanded', String(projectCard.isOpen && projectCard.el.dataset.project === project.id));
    gear.title = 'Project settings';
    wrap.append(main, gear);
    return wrap;
  }

  function renderTabs(project) {
    const view = project && M.view?.project === project.id ? M.view.section : null;
    const cells = [];
    const threads = project?.threads || [];
    const chat = button('', 'scope-tab', () => {
      const thread = threads.find(t => t.active) || threads[0];
      if (project && thread) onAction?.('thread', project.id, thread.id);
    });
    chat.dataset.labRole = 'chat'; chat.dataset.labKey = 'tab:chat';
    const chatSub = M.busy ? 'nibbi is answering' : `${threads.length} conversation${threads.length === 1 ? '' : 's'}`;
    chat.append(node('span', 'scope-tab-name', 'Chat'), node('span', 'scope-tab-sub', chatSub));
    if (!view) chat.setAttribute('aria-current', 'page');
    chat.setAttribute('aria-label', `Chat. ${chatSub}`);
    chat.title = chatSub;
    cells.push(chat);
    for (const [section, label] of SECTIONS) {
      const info = project?.sections?.[section] || {};
      const tab = button('', 'scope-tab', () => project && onAction?.('projectSection', project.id, section));
      tab.dataset.projectSection = section;
      tab.dataset.sectionProject = project?.id || '';
      tab.dataset.labKey = `tab:${section}`;
      const badge = node('span', 'scope-tab-sub', text(info.badge, 'Loading…'));
      badge.dataset.badge = 'true'; badge.dataset.tone = info.tone || 'quiet';
      tab.append(node('span', 'scope-tab-name', label), badge);
      if (view === section) tab.setAttribute('aria-current', 'page');
      tab.setAttribute('aria-label', `${label} for ${text(project?.name, 'this project')}${info.accessible ? `. ${info.accessible}` : ''}`);
      tab.title = text(info.accessible, label);
      cells.push(tab);
    }
    tabs.replaceChildren(...cells);
  }

  function renderBody(project) {
    const view = project && M.view?.project === project.id ? M.view.section : null;
    const parts = view && SECTION_ACTION[view] ? sectionBody(project, view) : chatBody(project);
    if (!F.progressFoot) { progress.textContent = progressLine(M.progress); parts.push(progress); }
    body.replaceChildren(...parts);
    body.scrollTop = 0;
  }

  function chatBody(project) {
    const parts = [];
    if (M.busy) {
      const note = node('p', 'scope-note', `nibbi is answering${project?.inFlight ? ` · ${project.inFlight} in flight` : ''}`);
      note.setAttribute('role', 'status');
      parts.push(note);
    }
    const fresh = button('', 'scope-new-thread', () => project && onAction?.('newThread', project.id));
    fresh.dataset.labRole = 'new-thread'; fresh.dataset.pin = 'project-thread-new'; fresh.dataset.labKey = 'new-thread';
    fresh.disabled = !!M.busy;
    fresh.classList.toggle('is-pinned', !!F.pinnedNew);
    fresh.append(icon('newThread'), node('span', '', 'New thread'));
    fresh.title = M.busy ? 'Not while nibbi is answering' : 'Start a new conversation';
    const list = node('div', 'scope-threads');
    list.append(...(project?.threads || []).map(thread => threadRow(project, thread)));
    // pinnedNew (improvement 2). With it off, New thread trails the list the way the app ships it.
    if (F.pinnedNew) parts.push(fresh, list); else parts.push(list, fresh);
    return parts;
  }
  function threadRow(project, thread) {
    const wrap = node('div', 'scope-thread');
    const when = relative(thread.lastAt, M.now);
    const title = text(thread.title, 'Thread');
    const main = button('', 'scope-thread-main', () => onAction?.('thread', project.id, thread.id));
    main.dataset.threadId = thread.id; main.dataset.threadProject = project.id;
    main.dataset.labKey = `t:${project.id}:${thread.id}`;
    main.append(icon('thread'), node('span', 'scope-thread-title', title), node('span', 'scope-thread-when', when));
    main.setAttribute('aria-label', `${title}${when ? `, last message ${when}` : ''}`);
    main.title = title;
    if (thread.active) main.setAttribute('aria-current', 'true');
    wrap.append(main);
    // threadActions (improvement 8): hover fades the time out and the two row actions take its place.
    if (F.threadActions) {
      const actions = node('div', 'scope-thread-actions');
      for (const [glyph, label, action] of [['pencil', 'Rename', 'lab:renameThread'], ['archive', 'Archive', 'lab:archiveThread']]) {
        const b = button('', 'scope-thread-action', () => onAction?.(action, project.id, thread.id));
        b.append(icon(glyph));
        b.setAttribute('aria-label', `${label} “${title}”`); b.title = label;
        b.dataset.labKey = `${action}:${project.id}:${thread.id}`;
        actions.append(b);
      }
      wrap.append(actions);
    }
    return wrap;
  }

  /** A summary of the section, not a record list — the workspace behind the bar holds the records. */
  function sectionBody(project, section) {
    const info = project.sections?.[section] || {};
    const wrap = node('div', 'scope-section');
    const headline = node('p', 'scope-section-headline', text(info.badge, 'Loading…'));
    headline.dataset.tone = info.tone || 'quiet';
    wrap.append(headline);
    if (info.detail) wrap.append(node('p', 'scope-section-line', info.detail));
    wrap.append(node('p', 'scope-section-line', waitingLine(project, section)));
    wrap.append(node('p', 'scope-section-hint', 'The full list is open in the workspace.'));
    const [action, label] = SECTION_ACTION[section];
    const go = button(label, 'scope-section-action', () => onAction?.(action, project.id));
    go.disabled = !!M.busy || (action === 'plan' && project.planAvailable === false);
    go.dataset.labKey = `act:${section}`;
    wrap.append(go);
    return [wrap];
  }

  function renderFoot() {
    const others = F.rollupText ? rollup(M, M.activeProject) : '';
    rollupBtn.textContent = others;
    rollupBtn.hidden = !others;
    if (others) rollupBtn.setAttribute('aria-label', `${others}. Switch project`);
    // progressFoot (improvement 4): the merged-today line leaves the list and sits beside Settings.
    if (F.progressFoot) { progress.textContent = progressLine(M.progress); foot.prepend(progress); }
    foot.hidden = !others && !F.progressFoot;
  }

  // --- host-scoped listeners ---------------------------------------------------------------------
  const onKey = event => {
    if (event.key === 'Escape') {
      if (closeOverlays(true)) { event.preventDefault(); event.stopPropagation(); return; }
      if (open) { event.preventDefault(); event.stopPropagation(); setSidebar(false); render(); toggleBtn.focus({ preventScroll: true }); }
      return;
    }
    if (menuOpen && menu.contains(event.target)) menuKeys(event);
  };
  const onPointer = event => {
    if (!root.contains(event.target)) return;
    const el = event.target.closest?.('[data-lab-role="card"], [data-lab-role="gear"], [data-lab-role="settings"]');
    if (!el) { projectCard.close(false); settingsCard.close(false); }
    if (menuOpen && !event.target.closest?.('.scope-switcher')) closeMenu(false);
  };
  host.addEventListener('keydown', onKey, true);
  host.addEventListener('pointerdown', onPointer, true);

  const api = {
    cue(id) {
      // Idempotent: whatever is open closes first, then the moment is applied.
      projectCard.close(false); settingsCard.close(false); closeMenu(false);
      setSidebar(id !== 'collapsed');
      render();
      if (id === 'switch') openMenu(true);
      else if (id === 'many') openMenu(false);
      else if (id === 'card') {
        const project = activeProject();
        if (project) {
          openMenu(false);
          openProjectCard(project, menuList.querySelector(`[data-lab-key="g:${project.id}"]`));
        }
      }
    },
    setModel(next) { if (next) M = next; render(); },
    setReduced(value) { reduced = !!value; root.classList.toggle('is-reduced', reduced); },
    setFlags(next) { F = { ...next }; render(); },
    setViewport(next) { if (next) V = next; root.classList.toggle('is-narrow', !!V.narrow); render(); },
    focus() { (open ? trigger : toggleBtn).focus({ preventScroll: true }); },
    destroy() {
      dead = true;
      host.removeEventListener('keydown', onKey, true);
      host.removeEventListener('pointerdown', onPointer, true);
      root.remove();
      host.classList.remove('sidebar-open');
      host.style.removeProperty('--workspace-left');
    },
  };
  api.setReduced(reduced);
  api.setViewport(V);
  api.cue(state);
  return api;
}

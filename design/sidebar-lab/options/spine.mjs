/** spine — the bar split in two.
 *
 *  The owner's complaint is that chat sits at the bottom of the left bar when it should almost be a
 *  different tab on the projects bar. This answers it structurally rather than by reordering: projects
 *  stop being a list and become a 56px spine of tiles, and everything to the right of the spine is one
 *  project's column — conversations first, records under a labelled group. Switching project swaps the
 *  column, which is what "a dropdown on the projects bar" wants to be.
 *
 *  Adapted from OpenCode's retired two-pane sidebar shell (rail + panel, hover-to-peek), with its one
 *  bad habit removed: OpenCode puts a 6px status dot on every tile. Nibbi says attention in words.
 */
import {
  node, button, icon, text, relative, loadCss,
  progressLine, projectSummary, attentionOf, rollup,
  createCard, fillProjectCard, fillSettingsCard,
} from '../chrome.mjs';

export const meta = {
  id: 'spine',
  name: 'Spine',
  tagline: 'projects shrink to a 56px spine; the rest of the bar is one project’s column, conversations first',
  pattern: 'rail + panel two-pane (OpenCode’s retired sidebar shell, adapted)',
  references: [
    { name: 'OpenCode — legacy two-pane sidebar shell', url: 'https://github.com/anomalyco/opencode/blob/dev/packages/app/src/pages/layout/sidebar-shell.tsx' },
    { name: 'OpenCode — rail tiles and hover peek', url: 'https://github.com/anomalyco/opencode/blob/dev/packages/app/src/pages/layout/sidebar-items.tsx' },
    { name: 'Cursor — truncated repo names with no tooltip', url: 'https://forum.cursor.com/t/repo-list-in-agent-view-sidebar/165972' },
    { name: 'OpenCode #37273 — "which project am I in" must stay answerable', url: 'https://github.com/anomalyco/opencode/issues/37273' },
  ],
  answers:
    'Chat is not a tab added to the projects bar — the projects bar becomes the tab strip. The spine is the '
    + 'strip, the column is the tab body, and the first thing in the body is the conversations. Builds, Issues '
    + 'and Plans move below a "Work" label, so records read as the project’s filing rather than its navigation.',
  risks: [
    'A single letter is a weak identifier: shipless / shipless-docs and nibbi / nibbi-site collide at 12 projects, and only the tooltip and accessible name separate them.',
    'The column is 200px. The section detail line ("3 running") no longer fits on screen and survives only in the row’s title and accessible name.',
    'Only the active project’s conversations are on screen. Another project’s thread is two moves (tile, then row) instead of one scroll — the price of giving conversations the top of the column.',
    'Hover-to-peek is a pointer affordance. Keyboard gets it on focus and touch does not get it at all; on a phone the spine and column simply sit side by side in the drawer.',
    'Two scroll regions (spine and column) instead of one. With 60 projects the spine is a long thin list with no grouping.',
  ],
  flags: ['pinnedNew', 'summaryLine', 'progressFoot', 'hoverGear', 'rollupText', 'chatTab', 'threadActions'],
  pinned: [
    'workspace-sidebar', 'sidebar-toggle', 'sidebar-backdrop', 'project-rail', 'settings-rail', 'status',
    'sidebar-progress', 'project-id', 'project-options', 'project-section', 'section-current', 'section-badge',
    'project-thread-new', 'margin-new', 'workspace-left',
  ],
};

const SECTIONS = [['builds', 'Builds', 'build'], ['issues', 'Issues', 'issue'], ['plans', 'Plans', 'plan']];
const PEEK_GRACE_MS = 110;
const attr = value => String(value).replace(/["\\]/g, '\\$&');

export function mount(host, { model, state = 'home', viewport, reduced = false, flags = {}, onAction } = {}) {
  loadCss(new URL('./spine.css', import.meta.url).href);

  let M = model || { projects: [] };
  let V = viewport || { width: 1180, height: 760, narrow: false };
  let F = { ...flags };
  let open = true, dead = false;
  let columnProject = M.activeProject || M.projects?.[0]?.id || null;
  let peekOn = null, peekTrigger = null, peekTimer = 0;

  /* ---------------------------------------------------------------- shell */
  const root = node('div', 'sidebar-lab-spine');

  const backdrop = button('', 'spine-backdrop', () => setSidebar(false, true));
  backdrop.dataset.labRole = 'backdrop';
  backdrop.dataset.pin = 'sidebar-backdrop';
  backdrop.tabIndex = -1;
  backdrop.setAttribute('aria-label', 'Close sidebar');
  backdrop.hidden = true;

  const bar = node('aside', 'spine-bar');
  bar.dataset.pin = 'workspace-sidebar';
  bar.setAttribute('aria-label', 'Projects and settings');

  // The spine: one tile per project, then New project and Settings pinned at its foot.
  const spine = node('nav', 'spine');
  spine.dataset.pin = 'project-rail';
  spine.setAttribute('aria-label', 'Projects');
  const spineScroll = node('div', 'spine-scroll');
  const spineFoot = node('div', 'spine-foot');
  spineFoot.dataset.pin = 'settings-rail';

  const addTile = button('', 'spine-tile is-quiet', () => onAction?.('newProject'));
  addTile.dataset.labRole = 'new-project';
  addTile.dataset.labKey = 'new-project';
  addTile.dataset.pin = 'margin-new';
  addTile.append(icon('plus'));
  addTile.setAttribute('aria-label', 'New project');
  addTile.title = 'New project';

  const settingsTile = button('', 'spine-tile is-quiet', () => openCard(settingsCard, settingsTile));
  settingsTile.dataset.labRole = 'settings';
  settingsTile.dataset.labKey = 'settings';
  settingsTile.dataset.pin = 'status';
  settingsTile.append(icon('settings'));
  settingsTile.setAttribute('aria-label', 'Settings');
  settingsTile.title = 'Settings';
  settingsTile.setAttribute('aria-haspopup', 'dialog');
  settingsTile.setAttribute('aria-expanded', 'false');

  spineFoot.append(addTile, settingsTile);
  spine.append(spineScroll, spineFoot);

  // The column: whichever project the spine points at.
  const column = node('section', 'column');
  column.setAttribute('aria-label', 'Project');
  bar.append(spine, column);

  // The peek: the column, flown out over the page while the bar is collapsed.
  const peek = node('aside', 'peek');
  peek.dataset.labRole = 'chooser';
  peek.setAttribute('aria-label', 'Project preview');
  peek.hidden = true;

  // One toggle, always in the same place, over the head of the spine. It never moves, so "where did the
  // bar go" is never a question — collapsed, the spine is still under it.
  const toggle = button('', 'spine-toggle', () => setSidebar(!open, true));
  toggle.dataset.labRole = 'toggle';
  toggle.dataset.pin = 'sidebar-toggle';
  toggle.append(icon('sidebar'));

  const projectCard = createCard({ title: 'Project' });
  const settingsCard = createCard({ title: 'Settings', side: 'right' });

  root.append(backdrop, bar, peek, toggle, projectCard.el, settingsCard.el);
  host.append(root);

  /* ----------------------------------------------------------------- cards */
  function openCard(card, source) {
    const other = card === projectCard ? settingsCard : projectCard;
    other.close();
    if (card.isOpen && card.trigger === source) { card.close(true); return; }
    card.close();
    if (card === settingsCard) fillSettingsCard(card, { settings: M.settings, onAction });
    card.open(source);
  }
  const closeCards = (restore = false) => [projectCard.close(restore), settingsCard.close(restore)].some(Boolean);

  /* ------------------------------------------------------------------ peek */
  function openPeek(id, tile) {
    if (dead || V.narrow || open) return;           // the peek only exists where the column is not
    clearTimeout(peekTimer); peekTimer = 0;
    const project = (M.projects || []).find(p => p.id === id);
    if (!project) return;
    peekOn = id;
    peekTrigger = tile || spineScroll.querySelector(`[data-project-id="${attr(id)}"]`);
    paintColumn(peek, project, true);
    peek.hidden = false;
    markPeek();
  }
  function closePeek(restore = false) {
    clearTimeout(peekTimer); peekTimer = 0;
    if (!peekOn) return false;
    peekOn = null;
    peek.hidden = true;
    peek.replaceChildren();
    markPeek();
    const last = peekTrigger; peekTrigger = null;
    if (restore && last?.isConnected) last.focus({ preventScroll: true });
    return true;
  }
  function markPeek() {
    for (const tile of spineScroll.querySelectorAll('[data-project-id]')) {
      tile.setAttribute('aria-expanded', String(!!peekOn && tile.dataset.projectId === peekOn));
    }
  }
  const schedulePeekClose = () => {
    clearTimeout(peekTimer);
    peekTimer = setTimeout(() => { peekTimer = 0; if (!dead) closePeek(); }, PEEK_GRACE_MS);
  };
  // No gap between the spine's right edge and the peek's left edge, so a diagonal cursor never crosses
  // dead ground — OpenCode needs a trajectory guard because its flyout is detached; this one is not.
  spine.addEventListener('mouseleave', event => { if (!peek.contains(event.relatedTarget)) schedulePeekClose(); });
  peek.addEventListener('mouseenter', () => { clearTimeout(peekTimer); peekTimer = 0; });
  peek.addEventListener('mouseleave', () => schedulePeekClose());
  peek.addEventListener('focusout', event => {
    if (!peek.contains(event.relatedTarget) && !spine.contains(event.relatedTarget)) closePeek();
  });

  /* ------------------------------------------------------------- the spine */
  function selectProject(project, tile) {
    columnProject = project.id;
    onAction?.('selectProject', project.id);
    if (!open && !V.narrow) openPeek(project.id, tile); else closePeek();
    render();
  }

  function projectTile(project) {
    const name = text(project.name, 'Untitled project');
    const summary = projectSummary(project, F);
    const tile = button('', 'spine-tile', () => selectProject(project, tile));
    tile.dataset.projectId = project.id;
    tile.dataset.labKey = 'p:' + project.id;
    tile.append(node('span', 'spine-letter', name.trim().charAt(0) || '?'));
    // Every tile carries the whole name. A truncated name with no tooltip is a live complaint in Cursor,
    // and a one-letter tile is the most truncated name there is.
    tile.setAttribute('aria-label', `${name}. ${summary}`);
    tile.title = `${name} — ${summary}`;
    tile.classList.toggle('is-active', project.id === M.activeProject);
    tile.classList.toggle('is-shown', project.id === columnProject && project.id !== M.activeProject);
    tile.setAttribute('aria-current', project.id === M.activeProject ? 'true' : 'false');
    tile.setAttribute('aria-expanded', String(peekOn === project.id));
    tile.addEventListener('mouseenter', () => openPeek(project.id, tile));
    tile.addEventListener('focus', () => openPeek(project.id, tile));
    return tile;
  }

  /* ------------------------------------------------------------ the column */
  function columnHead(project, isPeek) {
    const head = node('header', 'col-head');
    const titleEl = node('div', 'col-title');
    const name = node('span', 'col-name', text(project.name, 'Untitled project'));
    const branch = node('span', 'col-branch', text(project.branch, 'no branch'));
    titleEl.append(name, branch);
    titleEl.title = `${text(project.name, 'Untitled project')} · ${text(project.branch, 'no branch')}`;
    const gear = button('', 'col-gear', () => {
      projectCard.el.dataset.project = project.id;
      fillProjectCard(projectCard, project, { onAction, busy: M.busy });
      openCard(projectCard, gear);
    });
    gear.dataset.labRole = 'gear';
    gear.dataset.labKey = (isPeek ? 'kg:' : 'g:') + project.id;
    gear.dataset.pin = 'project-options';
    gear.append(icon('settings'));
    gear.setAttribute('aria-label', `Project settings for ${text(project.name, 'Untitled project')}`);
    gear.title = 'Project settings';
    gear.setAttribute('aria-haspopup', 'dialog');
    gear.setAttribute('aria-expanded', String(projectCard.isOpen && projectCard.el.dataset.project === project.id));
    head.append(titleEl, gear);
    return head;
  }

  function threadRow(project, thread, isPeek) {
    const label = text(thread.title, 'Thread');
    const when = relative(thread.lastAt, M.now);
    const row = node('div', 'thread-row');
    const openBtn = button('', 'thread-open', () => onAction?.('thread', project.id, thread.id));
    openBtn.dataset.threadId = thread.id;
    openBtn.dataset.threadProject = project.id;
    openBtn.dataset.labKey = `${isPeek ? 'kt' : 't'}:${project.id}:${thread.id}`;
    openBtn.append(node('span', 'thread-name', label), node('span', 'thread-when', when));
    openBtn.setAttribute('aria-label', `${label} in ${text(project.name)}${when ? `, last message ${when}` : ''}`);
    openBtn.title = label;
    if (thread.active) openBtn.setAttribute('aria-current', 'true');
    row.append(openBtn);
    if (F.threadActions) {
      const acts = node('div', 'thread-acts');
      const rename = button('', 'thread-act', () => onAction?.('lab:renameThread', project.id, thread.id));
      rename.append(icon('pencil'));
      rename.setAttribute('aria-label', `Rename ${label}`); rename.title = 'Rename';
      const archive = button('', 'thread-act', () => onAction?.('lab:archiveThread', project.id, thread.id));
      archive.append(icon('archive'));
      archive.setAttribute('aria-label', `Archive ${label}`); archive.title = 'Archive';
      acts.append(rename, archive);
      row.append(acts);
      row.classList.add('has-acts');
    }
    return row;
  }

  function sectionRow(project, [key, label, glyph], isPeek) {
    const info = project.sections?.[key] || {};
    const row = button('', 'sec-row', () => onAction?.('projectSection', project.id, key));
    row.dataset.projectSection = key;
    row.dataset.sectionProject = project.id;
    row.dataset.labKey = `${isPeek ? 'ks' : 's'}:${project.id}:${key}`;
    const badge = node('span', 'sec-badge', text(info.badge, 'Loading…'));
    badge.dataset.tone = info.tone || 'quiet';
    badge.dataset.badge = 'true';
    row.append(icon(glyph), node('span', 'sec-name', label), badge);
    if (M.view?.project === project.id && M.view?.section === key) {
      row.setAttribute('aria-current', 'page');
      row.dataset.pin = 'section-current';
    }
    // 200px eats the detail line. It survives where a screen reader and a hover can still reach it.
    row.setAttribute('aria-label', `${label} for ${text(project.name)}${info.accessible ? '. ' + info.accessible : ''}`);
    row.title = `${label} — ${[text(info.badge, ''), text(info.detail, '')].filter(Boolean).join(' · ')}`;
    return row;
  }

  function paintColumn(target, project, isPeek = false) {
    const kids = [columnHead(project, isPeek)];

    // Attention for the projects you are not looking at, in words. Never a dot (improvement 9).
    const others = F.rollupText ? rollup(M, M.activeProject) : '';
    if (others && !isPeek) {
      const line = node('p', 'col-rollup', others);
      line.dataset.labRole = 'rollup';
      line.setAttribute('role', 'status');
      kids.push(line);
    }

    const scroll = node('div', 'col-scroll');

    const fresh = button('', 'col-new', () => onAction?.('newThread', project.id));
    fresh.dataset.labRole = 'new-thread';
    fresh.dataset.labKey = (isPeek ? 'kn:' : 'n:') + project.id;
    fresh.dataset.pin = 'project-thread-new';
    fresh.disabled = !!M.busy;
    fresh.append(icon('newThread'), node('span', 'col-new-label', 'New thread'));
    fresh.setAttribute('aria-label', M.busy
      ? 'New thread, unavailable while Nibbi is answering'
      : `New thread in ${text(project.name, 'this project')}`);
    if (M.busy) fresh.title = 'Nibbi is answering';

    const threads = node('div', 'col-threads');
    threads.append(...(project.threads || []).map(t => threadRow(project, t, isPeek)));

    // Busy says what is in flight, in words, where New thread used to be pressable.
    let note = null;
    if (M.busy) {
      const flight = attentionOf(project) || (project.inFlight ? `${project.inFlight} in flight` : '');
      note = node('p', 'col-note', ['Answering', flight].filter(Boolean).join(' · '));
      note.setAttribute('role', 'status');
    }

    const group = node('div', 'col-group');
    const groupLabel = node('p', 'col-group-label', 'Work');
    group.append(groupLabel, ...SECTIONS.map(s => sectionRow(project, s, isPeek)));

    // Improvement 2: New thread leads the conversations instead of trailing them.
    if (F.pinnedNew) scroll.append(fresh, ...(note ? [note] : []), threads, group);
    else scroll.append(...(note ? [note] : []), threads, fresh, group);
    kids.push(scroll);

    // Improvement 4: the merged-today line sits at the foot, beside Settings.
    if (F.progressFoot && !isPeek) {
      const foot = node('p', 'col-foot', progressLine(M.progress));
      foot.dataset.pin = 'sidebar-progress';
      foot.setAttribute('role', 'status');
      kids.push(foot);
    }
    target.replaceChildren(...kids);
  }

  /* ----------------------------------------------------------------- state */
  function setSidebar(value, focusMove = false) {
    open = !!value;
    const narrow = !!V.narrow;
    if (!open && narrow) closeCards();
    root.classList.toggle('is-open', open);
    root.classList.toggle('is-collapsed', !open);
    root.classList.toggle('is-narrow', narrow);
    root.classList.toggle('is-floating', !open && narrow);
    column.hidden = !open;
    // Collapsed is not zero: the spine stays, so the workspace keeps 56px of margin.
    const width = narrow ? '0px' : (open ? '256px' : '56px');
    root.style.setProperty('--bar-w', narrow ? '0px' : (open ? '256px' : '56px'));
    host.classList.toggle('sidebar-open', open);
    host.style.setProperty('--workspace-left', width);
    bar.setAttribute('aria-hidden', String(narrow && !open));
    bar.inert = narrow && !open;
    toggle.setAttribute('aria-expanded', String(open));
    const others = F.rollupText ? rollup(M, M.activeProject) : '';
    const action = open ? 'Hide the project column' : 'Show the project column';
    toggle.setAttribute('aria-label', !open && others ? `${action} — ${others}` : action);
    toggle.title = !open && others ? others : action;
    backdrop.hidden = !(open && narrow);
    if (focusMove) toggle.focus({ preventScroll: true });
  }

  function render() {
    if (dead) return;
    const active = document.activeElement;
    const key = root.contains(active) ? active?.dataset?.labKey : null;

    root.classList.toggle('is-hover-gear', !!F.hoverGear && !V.narrow);
    const projects = M.projects || [];
    if (!projects.some(p => p.id === columnProject)) columnProject = M.activeProject || projects[0]?.id || null;

    spineScroll.replaceChildren(...projects.map(projectTile));
    const shown = projects.find(p => p.id === columnProject);
    if (shown) paintColumn(column, shown, false); else column.replaceChildren();

    if (peekOn) {
      const project = projects.find(p => p.id === peekOn);
      if (project) paintColumn(peek, project, true); else closePeek();
    }
    markPeek();

    if (projectCard.isOpen) {
      const project = projects.find(p => p.id === projectCard.el.dataset.project);
      if (project) fillProjectCard(projectCard, project, { onAction, busy: M.busy }); else projectCard.close();
    }
    setSidebar(open);
    if (key) root.querySelector(`[data-lab-key="${attr(key)}"]`)?.focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------- listeners */
  // Host-scoped, never document-scoped: three of these designs share one page.
  const onKey = event => {
    if (event.key !== 'Escape') return;
    if (closePeek(true)) { event.preventDefault(); event.stopPropagation(); return; }
    if (closeCards(true)) { event.preventDefault(); event.stopPropagation(); return; }
    if (open) { event.preventDefault(); event.stopPropagation(); setSidebar(false, true); }
  };
  const onPointer = event => {
    if (!root.contains(event.target)) return;
    if (!event.target.closest('.lab-card, [data-lab-role="gear"], [data-lab-role="settings"]')) closeCards();
  };
  host.addEventListener('keydown', onKey, true);
  host.addEventListener('pointerdown', onPointer, true);

  /* ------------------------------------------------------------------- api */
  const api = {
    cue(id) {
      closePeek();
      closeCards();
      const projects = M.projects || [];
      columnProject = M.activeProject || projects[0]?.id || null;
      const other = projects.find(p => p.id === 'nibbi' && p.id !== M.activeProject)
        || projects.find(p => p.id !== M.activeProject);

      if (id === 'collapsed') setSidebar(false);
      else if (id === 'switch') {
        // Collapsed to the spine, peeking at another project. A phone has no hover, so there the same
        // moment is the drawer with the other project's column already swapped in.
        if (V.narrow) { if (other) columnProject = other.id; setSidebar(true); }
        else setSidebar(false);
      } else setSidebar(true);

      render();

      if (id === 'switch' && !V.narrow && other) {
        openPeek(other.id, spineScroll.querySelector(`[data-project-id="${attr(other.id)}"]`));
      }
      if (id === 'card') {
        const project = projects.find(p => p.id === columnProject);
        const gear = column.querySelector('[data-lab-role="gear"]');
        if (project && gear) {
          projectCard.el.dataset.project = project.id;
          fillProjectCard(projectCard, project, { onAction, busy: M.busy });
          openCard(projectCard, gear);
        }
      }
    },
    setModel(next) { M = next || { projects: [] }; render(); },
    setReduced(value) { reduced = !!value; root.classList.toggle('is-reduced', reduced); },
    setFlags(next) { F = { ...next }; render(); },
    setViewport(next) { V = next || V; render(); },
    focus() {
      const first = open ? (column.querySelector('button') || spineScroll.querySelector('button') || toggle) : toggle;
      first.focus({ preventScroll: true });
    },
    destroy() {
      dead = true;
      clearTimeout(peekTimer); peekTimer = 0;
      host.removeEventListener('keydown', onKey, true);
      host.removeEventListener('pointerdown', onPointer, true);
      root.remove();
      host.classList.remove('sidebar-open');
      host.style.removeProperty('--workspace-left');
    },
  };

  api.setReduced(reduced);
  api.cue(state);
  return api;
}

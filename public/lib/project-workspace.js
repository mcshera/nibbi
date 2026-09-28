import { createGithubPanel } from './github-ui.js';

/* The main area's frame for project work. It is one fixed element under the character's header pose,
   so the composer, the character and the fixers behave the same whatever it shows:
     - the control panel's pages (project-pages.js): main's build page and an improvement's ticket,
       drawn into `pageHost`, which carries its own heading and ×;
     - Repository & GitHub: this frame's own head (h1#project-workspace-title and ×) over a body that
       holds the project's GitHub panel (github-ui.js), kept per project so a draft survives leaving it.
   The Builds lobby, the Issues board and Plans that used to live here left the UI in phase 1
   (docs/CONTROL-PANEL.md §2.3); their data paths are the daemon's and unchanged. The app owns commands. */
const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
const TITLE = 'Repository & GitHub';

export function installProjectWorkspace({ renderMarkdown, renderDiff, onAction, onClose } = {}) {
  const el = node('section', 'project-workspace'); el.id = 'project-workspace'; el.hidden = true;
  el.setAttribute('aria-labelledby', 'project-workspace-title');
  // The pages come first, so the frame's first .project-close is always the one on screen.
  const pageHost = node('div', 'cp-page-host'); pageHost.hidden = true;
  const head = node('header', 'project-workspace-head');
  const title = node('h1', '', TITLE); title.id = 'project-workspace-title'; title.tabIndex = -1;
  const back = node('button', 'project-close'); back.type = 'button';
  back.setAttribute('aria-label', 'Close and return to the conversation');
  back.title = 'Back to the conversation (Esc)';
  back.textContent = '×';
  back.addEventListener('click', () => onClose?.());
  head.append(title, back);
  const body = node('div', 'project-workspace-body'); body.tabIndex = 0;
  body.setAttribute('role', 'region'); body.setAttribute('aria-label', 'Project content');
  const notice = node('div', 'project-notice'); notice.setAttribute('role', 'status'); notice.hidden = true;
  const content = node('div', 'project-content'); body.append(notice, content);
  el.append(pageHost, head, body); document.body.append(el);

  const panels = new Map();   // project → its Repository & GitHub panel
  let current = null, busy = false, generation = 0;
  function panelFor(project) {
    if (!panels.has(project)) panels.set(project, createGithubPanel({ project, onAction, renderMarkdown, renderDiff, onChanged: () => {} }));
    return panels.get(project);
  }
  function say(text, kind = '') { notice.replaceChildren(); notice.hidden = !text; notice.dataset.kind = kind; if (text) notice.append(node('span', '', text)); }
  function showPage(on) {
    head.hidden = !!on; body.hidden = !!on; pageHost.hidden = !on;
    if (on) {
      generation++; current = null;
      el.dataset.section = 'page'; el.removeAttribute('aria-labelledby'); el.setAttribute('aria-busy', 'false'); el.hidden = false;
    } else el.setAttribute('aria-labelledby', 'project-workspace-title');
  }
  async function refresh() {
    if (!current || el.hidden) return;
    const request = ++generation, panel = panelFor(current.project);
    el.setAttribute('aria-busy', 'true');
    try {
      if (panel.snapshot().hasData) await panel.refresh(); else await panel.open();
      if (request === generation) say(panel.snapshot().hasData ? '' : 'Could not read the repository. Try again when Nibbi is connected.', panel.snapshot().hasData ? '' : 'error');
    } catch (error) { if (request === generation) say(error?.message || 'Could not read the repository. Try again.', 'error'); }
    finally { if (request === generation) el.setAttribute('aria-busy', 'false'); }
  }
  // Escape leaves the frame from anywhere inside it, unless something in it took the key first (a
  // page's open confirm or form: project-pages.js prevents it) or is asking for confirmation.
  el.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (!body.hidden && content.querySelector('.project-confirmation:not([hidden])')) return;   // one that is actually asking owns its own Cancel
    event.preventDefault(); event.stopPropagation(); onClose?.();
  });
  return {
    element: el,
    pageHost,
    showPage,
    /** Repository & GitHub for one project ({ project, section: 'repository' }). */
    open(selection) {
      if (selection?.section !== 'repository') throw new Error('Unknown project section.');
      showPage(false);
      el.dataset.section = 'repository'; current = { project: selection.project, section: 'repository' };
      body.setAttribute('aria-label', `${selection.project} ${TITLE}`);
      const panel = panelFor(selection.project); panel.setBusy(busy);
      say(''); content.replaceChildren(panel.element);
      el.hidden = false; body.scrollTop = 0; title.focus({ preventScroll: true }); void refresh();
    },
    close() { generation++; current = null; el.hidden = true; showPage(false); },
    refresh,
    setBusy(value) { busy = !!value; for (const panel of panels.values()) panel.setBusy(busy); },
    snapshot() {
      if (!current) return null;
      const panel = panels.get(current.project)?.snapshot();
      return { project: current.project, page: 'repository', id: null, section: 'repository', hasDraft: !!(panel?.hasDraft || panel?.reviewing) };
    },
    destroy() { generation++; for (const panel of panels.values()) panel.destroy(); panels.clear(); el.remove(); },
  };
}

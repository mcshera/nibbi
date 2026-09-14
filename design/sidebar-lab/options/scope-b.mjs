/** scope-b — the icon row. Four glyphs; the current one opens up and says its name and its sentence.
 *
 *  Icons buy back the width that made the row impossible, and spend it on the tab you are on: the
 *  current tab is the only one that needs words, and it gets all of them.
 */
import { node, button, icon } from '../chrome.mjs';
import { createScopeBar } from '../scope-shell.mjs';

const GLYPH = { builds: 'build', issues: 'issue', plans: 'plan' };

const bar = createScopeBar({
  id: 'scope-b',
  name: 'Scope · icon row',
  tagline: 'four glyphs; the current tab opens up and says the whole thing',
  answers: 'The row is one line because three of the four tabs are a glyph. The one you are on expands to carry its name and the full phrase — "71 need attention", not "71" — so nothing is abbreviated where it is being read.',
  risks: [
    'Three unlabelled glyphs. Builds, Issues and Plans are a box, a circle and a page, and nothing but a tooltip separates them until you land on one.',
    'The row changes width as you move between tabs, so the strip is never the same shape twice.',
    'A glyph cannot carry a number, so a project with work waiting in a tab you are not on says nothing at all in the strip.',
  ],
  strip(ctx) {
    const row = node('div', 'scope-row');
    const cells = [['chat', 'Chat', 'thread'], ...ctx.sections.map(([s, l]) => [s, l, GLYPH[s]])];
    for (const [key, label, glyph] of cells) {
      const isChat = key === 'chat';
      const current = isChat ? !ctx.view : ctx.view === key;
      const tab = button('', 'scope-tab', () => (isChat ? ctx.openChat() : ctx.openSection(key)));
      if (isChat) tab.dataset.labRole = 'chat';
      else { tab.dataset.projectSection = key; tab.dataset.sectionProject = ctx.project?.id || ''; }
      tab.dataset.labKey = `tab:${key}`;
      tab.classList.toggle('is-current', current);
      tab.append(icon(glyph));
      const count = isChat ? ctx.threadCount() : 0;
      const sentence = isChat
        ? (ctx.model.busy ? 'nibbi is answering' : `${count} conversation${count === 1 ? '' : 's'}`)
        : (ctx.phrase(key) || 'nothing waiting');
      if (current) {
        const copy = node('span', 'scope-tab-copy');
        copy.append(node('span', 'scope-tab-name', label));
        const said = node('span', 'scope-tab-said', sentence);
        if (!isChat) { said.dataset.badge = 'true'; said.dataset.tone = ctx.tone(key); }
        copy.append(said);
        tab.append(copy);
        tab.setAttribute('aria-current', 'page');
      }
      tab.setAttribute('aria-label', `${label}. ${sentence}`);
      tab.title = `${label} — ${sentence}`;
      row.append(tab);
    }
    return [row];
  },
});
export const meta = bar.meta;
export const mount = bar.mount;

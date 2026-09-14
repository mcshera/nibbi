/** scope — the owner's pick, with the strip as one row.
 *
 *  "I like 02 scope, can you make chat/builds/plan/issues one row."
 *
 *  Four tabs across 256px cannot carry "71 need attention", so the row carries the number alone and
 *  the sentence moves to the tab's title, its accessible name, and the body when that tab is current.
 *  Everything else is the shared Scope shell.
 */
import { node, button } from '../chrome.mjs';
import { createScopeBar } from '../scope-shell.mjs';

const bar = createScopeBar({
  id: 'scope',
  name: 'Scope',
  tagline: 'one row: Chat · Builds · Issues · Plans, the number only',
  answers: 'Chat is the first tab on the projects bar and the projects bar is a dropdown. The strip is one row because the badge became a number: 71, not "71 need attention". The sentence is still there, on hover, to a screen reader, and in the body.',
  risks: [
    'A bare "71" does not say what 71 is. The sentence survives only in the title, the accessible name and the body — three places a glance does not reach.',
    '"56/58" is five characters and the widest number the strip has to hold; a project with 100+ builds and a 4-digit plan would push the row to truncate.',
    'Only one project is ever in the bar, so another project’s conversation costs a trip through the dropdown.',
    'The bar goes quiet below the conversations: at rest there is a visible gap above Settings.',
  ],
  strip(ctx) {
    const row = node('div', 'scope-row');
    const chat = button('', 'scope-tab', () => ctx.openChat());
    chat.dataset.labRole = 'chat'; chat.dataset.labKey = 'tab:chat';
    const chatCount = ctx.threadCount();
    chat.append(node('span', 'scope-tab-name', 'Chat'));
    if (chatCount > 1) chat.append(node('span', 'scope-tab-count', String(chatCount)));
    if (!ctx.view) chat.setAttribute('aria-current', 'page');
    const chatSentence = ctx.model.busy ? 'nibbi is answering' : `${chatCount} conversation${chatCount === 1 ? '' : 's'}`;
    chat.setAttribute('aria-label', `Chat. ${chatSentence}`); chat.title = chatSentence;
    row.append(chat);
    for (const [section, label] of ctx.sections) {
      const tab = button('', 'scope-tab', () => ctx.openSection(section));
      tab.dataset.projectSection = section; tab.dataset.sectionProject = ctx.project?.id || '';
      tab.dataset.labKey = `tab:${section}`;
      tab.append(node('span', 'scope-tab-name', label));
      const count = ctx.count(section);
      if (count) {
        const badge = node('span', 'scope-tab-count', count);
        badge.dataset.badge = 'true'; badge.dataset.tone = ctx.tone(section);
        tab.append(badge);
      }
      if (ctx.view === section) tab.setAttribute('aria-current', 'page');
      tab.setAttribute('aria-label', `${label}. ${ctx.accessible(section) || 'nothing waiting'}`);
      tab.title = ctx.phrase(section) || label;
      row.append(tab);
    }
    return [row];
  },
});
export const meta = bar.meta;
export const mount = bar.mount;

/** scope-a — the quiet row. Names only; one line underneath says what the current tab is holding.
 *
 *  The variant that takes "no badges" furthest: nothing in the strip ever changes, so the row never
 *  pulls at you. The cost of a number is paid once, in a sentence, for the tab you are actually on.
 */
import { node, button } from '../chrome.mjs';
import { createScopeBar } from '../scope-shell.mjs';

const bar = createScopeBar({
  id: 'scope-a',
  name: 'Scope · quiet row',
  tagline: 'names only; a line beneath says what the current tab holds',
  answers: 'The row fits easily because it carries nothing but four words. What is waiting is written out in full, once, under the strip — which is the only place a sentence fits at this width.',
  risks: [
    'You cannot see that Builds needs you until you are on Builds. The whole point of a badge is the glance you no longer get.',
    'The line under the strip changes as you move between tabs, which is a second thing moving in a bar that is meant to be still.',
    'It reads as calm and risks reading as empty: at rest on a quiet project the strip says four words and the line says "nothing waiting".',
  ],
  strip(ctx) {
    const row = node('div', 'scope-row');
    const chat = button('', 'scope-tab', () => ctx.openChat());
    chat.dataset.labRole = 'chat'; chat.dataset.labKey = 'tab:chat';
    chat.append(node('span', 'scope-tab-name', 'Chat'));
    if (!ctx.view) chat.setAttribute('aria-current', 'page');
    const count = ctx.threadCount();
    const chatSentence = ctx.model.busy ? 'nibbi is answering' : `${count} conversation${count === 1 ? '' : 's'}`;
    chat.setAttribute('aria-label', `Chat. ${chatSentence}`); chat.title = chatSentence;
    row.append(chat);
    for (const [section, label] of ctx.sections) {
      const tab = button('', 'scope-tab', () => ctx.openSection(section));
      tab.dataset.projectSection = section; tab.dataset.sectionProject = ctx.project?.id || '';
      tab.dataset.labKey = `tab:${section}`;
      tab.append(node('span', 'scope-tab-name', label));
      if (ctx.view === section) tab.setAttribute('aria-current', 'page');
      tab.setAttribute('aria-label', `${label}. ${ctx.accessible(section) || 'nothing waiting'}`);
      tab.title = ctx.phrase(section) || label;
      row.append(tab);
    }
    // The sentence the row gave up, for the tab you are on.
    const said = ctx.view
      ? [ctx.phrase(ctx.view), ctx.project?.sections?.[ctx.view]?.detail].filter(Boolean).join(' · ')
      : chatSentence;
    const line = node('p', 'scope-said', said || 'Nothing waiting');
    line.dataset.badge = 'true'; line.dataset.tone = ctx.view ? ctx.tone(ctx.view) : 'quiet';
    line.setAttribute('role', 'status');
    return [row, line];
  },
});
export const meta = bar.meta;
export const mount = bar.mount;

/** scope-c — chat is the room, not a tab.
 *
 *  The other three answer "make the four one row". This one asks whether chat should be in the row at
 *  all. Conversations are what the bar is; Builds, Issues and Plans are three things you go and look
 *  at and come back from. So the row holds three, which fits with room to spare, and the body is the
 *  conversations until you choose otherwise. Choosing the tab you are already on brings you back.
 */
import { node, button } from '../chrome.mjs';
import { createScopeBar } from '../scope-shell.mjs';

const bar = createScopeBar({
  id: 'scope-c',
  name: 'Scope · chat is the room',
  tagline: 'three record tabs; chat is what the bar is when no tab is on',
  answers: 'It makes the row one line by asking why chat was ever in it. Chat is not somewhere you go — it is where you already are — so the strip is three tabs you turn on and off, each with room for its whole phrase, and the conversations sit underneath with nothing competing for the top.',
  risks: [
    'Chat has no tab, so nothing in the strip says the word. The bar relies on the conversations being visibly the body.',
    'Turning off a tab by clicking it again is a toggle, and a toggle that looks like a tab is a thing people click twice by accident.',
    'It is the furthest from the owner’s sentence: he asked for chat to be a tab, and this argues it should not be one.',
    'The lab has no app action for "leave this section", so it dispatches lab:backToChat — a name the app would have to grow.',
  ],
  flags: ['chatTab', 'pinnedNew', 'summaryLine', 'progressFoot', 'hoverGear', 'rollupText', 'threadActions'],
  strip(ctx) {
    const row = node('div', 'scope-row');
    for (const [section, label] of ctx.sections) {
      const current = ctx.view === section;
      const tab = button('', 'scope-tab', () => {
        if (current) ctx.onAction?.('lab:backToChat', ctx.project?.id, section);
        else ctx.openSection(section);
      });
      tab.dataset.projectSection = section; tab.dataset.sectionProject = ctx.project?.id || '';
      tab.dataset.labKey = `tab:${section}`;
      tab.append(node('span', 'scope-tab-name', label));
      const phrase = ctx.phrase(section);
      if (phrase) {
        const said = node('span', 'scope-tab-said', phrase);
        said.dataset.badge = 'true'; said.dataset.tone = ctx.tone(section);
        tab.append(said);
      }
      if (current) tab.setAttribute('aria-current', 'page');
      tab.setAttribute('aria-pressed', String(current));
      tab.setAttribute('aria-label', `${label}. ${ctx.accessible(section) || 'nothing waiting'}${current ? '. Showing; choose again to return to the conversations' : ''}`);
      tab.title = current ? `${phrase || label} — choose again to return to the conversations` : (phrase || label);
      row.append(tab);
    }
    return [row];
  },
});
export const meta = bar.meta;
export const mount = bar.mount;

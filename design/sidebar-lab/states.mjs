/** The axis every option is judged on. Keys 1-9 in the lab; the same ids drive verify.mjs and the sheet. */
import * as fixture from './fixture.mjs';

export const STATES = [
  { id: 'home', key: '1', label: 'Home', note: 'The home thread of the working project. Where the app opens.',
    build: () => fixture.withActiveThread(fixture.base(), 'battalion', 'home') },
  { id: 'thread', key: '2', label: 'A thread', note: 'A named conversation is open; the composer placeholder carries its name.',
    build: () => fixture.withActiveThread(fixture.base(), 'battalion', 't-left-bar') },
  { id: 'switch', key: '3', label: 'Switching', note: 'Reaching another project: the chooser, a second disclosure, or the spine peek.',
    build: () => fixture.withActiveThread(fixture.base(), 'battalion', 'home') },
  { id: 'builds', key: '4', label: 'Builds open', note: 'A record section fills the workspace; the bar says which one.',
    build: () => fixture.withView(fixture.withActiveThread(fixture.base(), 'battalion', 'home'), { project: 'battalion', section: 'builds' }) },
  { id: 'card', key: '5', label: 'Project card', note: 'The project options card — automation, spend cap, actions.',
    build: () => fixture.withActiveThread(fixture.base(), 'battalion', 'home') },
  { id: 'busy', key: '6', label: 'Busy', note: 'Nibbi is answering. New thread is unavailable, work is in flight.',
    build: () => fixture.withBusy(fixture.withActiveThread(fixture.base(), 'battalion', 'home')) },
  { id: 'many', key: '7', label: '12 projects', note: 'Long names, a scrolling list. Is New thread still reachable?',
    build: () => fixture.withActiveThread(fixture.many(), 'battalion', 'home') },
  { id: 'collapsed', key: '8', label: 'Collapsed', note: 'The bar is out of the way. What does it still tell you?',
    build: () => fixture.withActiveThread(fixture.base(), 'battalion', 'home') },
  { id: 'drawer', key: '9', label: 'Phone drawer', note: 'At 390px the bar is a slide-over with a backdrop.',
    viewport: { width: 390, height: 844, narrow: true },
    build: () => fixture.withActiveThread(fixture.base(), 'battalion', 'home') },
];
export const STATE_IDS = STATES.map(s => s.id);
export const stateById = id => STATES.find(s => s.id === id);
export const buildModel = id => (stateById(id) || STATES[0]).build();

/** Measured at the real page viewport (?scale=1): inside a transformed frame, 100vw and @media still mean the page. */
export const VIEWPORTS = [
  { id: '1440x900', width: 1440, height: 900, narrow: false, note: 'desktop' },
  { id: '1180x820', width: 1180, height: 820, narrow: false, note: 'Tauri default window' },
  { id: '900x680', width: 900, height: 680, narrow: false, note: 'smallest docked layout' },
  { id: '390x844', width: 390, height: 844, narrow: true, note: 'phone' },
  { id: '320x568', width: 320, height: 568, narrow: true, note: 'narrowest supported' },
];
export const DESKTOP = { width: 1180, height: 760, narrow: false };
export const PHONE = { width: 390, height: 844, narrow: true };

/** Improvements. All off = "as the app is today", so each one can be judged on its own. */
export const FLAGS = [
  { id: 'chatTab', label: 'Chat tab in the workspace', note: 'The workspace tab strip gains Chat instead of a "Back to chat" link.' },
  { id: 'pinnedNew', label: 'New thread pinned top', note: 'New thread leads the conversations instead of trailing them.' },
  { id: 'summaryLine', label: 'Branch + attention summary', note: 'A project reads "v2 · 71 need attention" instead of "off · 0% of plan".' },
  { id: 'progressFoot', label: 'Progress at the foot', note: 'The merged-today line leaves the project list and sits by Settings.' },
  { id: 'hoverGear', label: 'Gear on hover', note: 'Project settings appear on hover; always visible on touch.' },
  { id: 'keys', label: 'Keyboard', note: '⌘B toggle · ⌘N new thread · ⌘1-9 project · ⌥↑/↓ thread.' },
  { id: 'resize', label: 'Drag to resize', note: 'Drag the edge; double-click resets. Width is remembered.' },
  { id: 'threadActions', label: 'Row actions on hover', note: 'The time fades to reveal rename and archive.' },
  { id: 'rollupText', label: 'Attention as text', note: 'A collapsed control says "2 others need you" — never a dot.' },
];
export const FLAG_IDS = FLAGS.map(f => f.id);
export const defaultFlags = (on = false) => Object.fromEntries(FLAG_IDS.map(id => [id, on]));
/** Environment toggles, separate from the improvements: they change the room, not the design. */
export const ENVIRONMENT = [
  { id: 'glass', label: 'Glass window', note: 'The Tauri shell on translucent macOS glass.' },
  { id: 'nativeMac', label: 'Native Mac', note: 'Traffic lights: 48px of head room.' },
  { id: 'reduced', label: 'Reduced motion', note: 'Nothing animates.' },
];

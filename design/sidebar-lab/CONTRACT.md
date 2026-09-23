# Sidebar lab option contract (experimental, not production)

Every option is ONE standalone ES module at `design/sidebar-lab/options/<id>.mjs` with one stylesheet beside it at `options/<id>.css`. The only imports allowed are `../chrome.mjs` (shared DOM helpers, glyphs and the relative-time formatter) and, for `peer`, `./_today.mjs`. Never import another design. Nothing under `public/` is touched, read or written — the lab serves the app's real `tokens.css`, `styles.css`, `margins.css` and `project-workspace.css` read-only so every option renders on the real tokens.

```js
import { node, button, icon, relative, loadCss } from '../chrome.mjs';

export const meta = {
  id: 'scope',                       // === file name
  name: 'Scope',                     // short display name
  tagline: 'one sentence, what it is',
  pattern: 'the shape it belongs to, and whose',
  references: [{ name: 't3code Sidebar V2', url: 'https://…' }],
  answers: 'how this answers "chat should be a tab on the projects bar, like a dropdown"',
  risks: ['…', '…'],                 // at least two, honest
  flags: ['chatTab', 'pinnedNew'],   // which improvements this design honours (states.mjs FLAG_IDS)
  pinned: ['#workspace-sidebar'],    // which pinned app selectors survive in this design
};

// host: an empty <div> inside the frame, sized to the viewport, position: relative. The host plays the part of
// <body>: toggle the classes `sidebar-open`, `glass`, `native-mac` on it and set `--workspace-left` on host.style.
// model     — the app's margins.update() shape (fixture.mjs) plus `now` (ms) for relative times.
// state     — initial state id (states.mjs): home · thread · switch · builds · card · busy · many · collapsed · drawer.
// viewport  — { width, height, narrow }. narrow === (width <= 899). Never read matchMedia.
// reduced   — true → nothing animates.
// flags     — { chatTab, pinnedNew, summaryLine, progressFoot, hoverGear, keys, resize, threadActions, rollupText }.
// onAction  — (name, projectId, value) => Promise|void. See "Speak the app's protocol" below.
export function mount(host, { model, state = 'home', viewport, reduced = false, flags = {}, onAction }) {
  return {
    cue(stateId) {},      // idempotent: close chooser/card/peek/hover FIRST, then apply the state
    setModel(model) {},   // re-render without losing focus, scroll position or an open card
    setReduced(value) {},
    setFlags(flags) {},
    setViewport(viewport) {},
    focus() {},           // focus the first meaningful control (the toggle when collapsed)
    destroy() {},         // remove every node and listener; the host is left empty
  };
}
```

## Speak the app's protocol

`onAction` may only use the names `handleMarginAction` already understands (`public/app.js:1610-1655`), so a promoted option is a drop-in for `installMarginUI`:

`selectProject(id)` · `projectSection(id, 'builds'|'issues'|'plans')` · `repository(id)` · `newProject()` · `thread(id, threadId)` · `newThread(id)` · `fix|plan|play|review|providers(id)` · `autoMode(id, mode)` · `spendCap(id, number)` · `model` · `advancedSettings` · `microphone` · `voice` · `sounds` · `notifications` · `calm` · `glass` · `demo` · `tidy`

Anything the app cannot do yet is prefixed `lab:` (`lab:renameThread`, `lab:archiveThread`, `lab:resize`, `lab:toggleSidebar`). Those are reported in the brief as the cost of the design, never silently assumed.

## Hooks the checks read

| Hook | On |
|---|---|
| `[data-project-id]` | the control that selects/expands a project |
| `[data-thread-id][data-thread-project]` | every conversation row (`home` is a real id in every project — `daemon/src/threads.ts:7`, so always pair them) |
| `[data-lab-role]` | `toggle`, `collapse`, `chooser`, `chat`, `new-thread`, `new-project`, `gear`, `card`, `settings`, `resize`, `backdrop`, `rollup` |
| `[data-badge]` | the element carrying a section's badge text (`71 need attention`), which the app's suites read |
| `aria-current="true"` | the open conversation |
| `aria-current="page"` | the section that mirrors `model.view` |
| `aria-expanded` | every disclosure and popover trigger |
| `hidden` | a closed card or chooser |
| `data-pin="<id>"` | an element that would carry a pinned app id at promotion (`workspace-sidebar`, `sidebar-toggle`, `project-rail`, `settings-rail`, `sidebar-progress`, `status`). Three options share one page, so the ids themselves cannot be used here — the attribute is the promise, and `meta.pinned` lists it. |

## Rules every option follows (and the goal behind each)

- **Chat is not a footnote.** Conversations are reachable without hunting: from `home`, opening another thread of the working project is one click, and reaching another project's conversation is at most two.
- **Attention is text, never a dot or a badge.** The owner has rejected chips and dots twice. A collapsed control says "2 others need you"; it never grows a mark.
- **Ink on cream, Geist, the app's tokens.** `--ink`, `--ink-2`, `--ink-3`, `--line`, `--paper`, `--ease`. No new colour; no gradient that reads as glossy.
- **Nothing is document-scoped.** No `document`/`window` listeners, no `matchMedia`, no `100vw`/`100dvh`, no `Date.now()` (use `model.now`), no `localStorage` except the remembered width under `nibbi-sidebar-lab:<id>:width`. Three options share one page: a document listener would let them fight. This is also why `peer` copies `margin-ui.js` rather than importing it.
- **Escape has an order:** a card, chooser or peek closes first and focus returns to its trigger; only then does Escape close the bar. Outside-click closes a card. Both are host-scoped.
- **Targets:** every control is at least 44px tall when `viewport.narrow`, 32px otherwise.
- **Contrast:** text at 12px or smaller is at least 4.5:1 against its own background. `--ink-3` on the rail's `#ece8e0` is only ≈4.3:1 today — that is a finding, not a licence.
- **Reduced motion:** with `reduced` nothing is animating 60ms after a cue.
- **Scale:** mounting 60 projects takes under 250ms, and `setModel` never rebuilds a row that has focus.
- `meta.id` equals the file name, and `destroy()` leaves the host empty.

## Check your option without the lab page

```sh
cd /Users/Matty/Documents/Nibbi
node design/sidebar-lab/options.test.mjs <id>          # contract checks in a real browser, ~5s, no screenshots
node design/sidebar-lab/sheet.mjs <id>                 # writes evidence/sheet-<id>.png — nine states × two sizes
```

Look at the sheet before calling it done. The parent owns `index.html`, `lab.css`, `lab.mjs`, `chrome.mjs`, `fixture.mjs`, `states.mjs` and the tools; do not edit them, and do not edit another option.

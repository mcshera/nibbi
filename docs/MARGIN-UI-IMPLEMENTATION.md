# Margin UI implementation — user-selected 5c hybrid

Repo /Users/Matty/Documents/Nibbi. Active user goal: improve actual app UI using RIGHT of design/projects-settings/mock.html?v=5c1, LEFT of ?v=5c2, MODALS/cards of ?v=5c3. Reference PNGs beside mock were visually reviewed: 5c2 left is 44px progress rings, black active core, always-visible names+secondary live summary, new-project row. 5c1 right is 44px circular mic/sound/model/bell/settings glyphs, filled black when on, labels reveal on hover/focus. 5c3 has warm paper 18px-radius floating cards, thin border/soft shadow, compact rows, segmented controls and pill actions. Keep Nibbi, chat/composer, companions and Pocket interactions intact. No Tricks panel. No mock costs/progress/models or fabricated provider state.

## Ownership (parallel)
- Margin UI worker ONLY new public/lib/margin-ui.js, public/margins.css; optional tests/margin-ui.test.mjs. Do not edit app/index/styles/platform.
- Platform polish worker ONLY public/platform.css and narrowly public/lib/platform.ts (classes/accessibility/presentation; preserve existing async/race-safe logic and all controls).
- QA worker ONLY new tools/margin-ui-verify.mjs and optional new tools helpers + docs/MARGIN-UI-QA.md + output/margin-ui. No production edits or old test rewrites unless parent later explicitly authorizes.
- Parent public/app.js, public/index.html, integration, current regression selector adapters if needed, docs, build/install refresh.
Initial git status: only docs/POCKET-SPRING.md modified and docs/POCKET-INSTALLATION.md untracked from prior installed update. Preserve these and any concurrent changes. No backend/account/service edits or migrations.

## Margin module API — exact stable contract
export installMarginUI({onAction}) => { update(model), close(), destroy() }
Mount into existing #project-rail and #settings-rail empty nav elements supplied by parent index. Module constructs its UI immediately; does not call onAction during construction or update. onAction(action, projectId?, value?) may return Promise. Module never calls backend, changes application state, or accesses localStorage; parent owns authority. Use textContent for data.

model = {
 projects: [{id,name,active,branch,goal,mode,inFlight,pending,staged,spend,spendCap,done,total,planAvailable,playable}],
 activeProject: string, busy: boolean,
 settings: { voice:boolean, sounds:boolean, notifications:boolean, notificationsSupported:boolean, notificationStatus:string, model:string, provider:string, brain:string, session:string, context:string, demo:boolean, calm:boolean, systemReduced:boolean }
}
Unknown progress done/total=null; never make up percentages. Clamp data. Off projects dotted ring, active black core, always-visible desktop labels. Long/many project names, empty/loading states, overflow safe.

Actions:
selectProject(id) [parent changes active selection locally, no chat submission], newProject [composer /new], plan(id), play(id), fix(id) [composer /fix], review(id), autoMode(id,value off|suggest|stage|ship), spendCap(id,number), providers(id) [advanced settings Providers], voice, sounds, notifications, model [Providers], settings [open compact quick-settings card inside module; NOT callback], advancedSettings [advanced settings modal], calm, demo, tidy.
Project click selects and opens its 5c3-style details card; cards show branch/goal/progress, actual mode, in-flight/pending/staged/spend, mode segment, cap input, actions. Preserve explicit two-step confirmation for ship (potential automatic merge); never select it by default from mock. Parents honor current APIs/capabilities.
Right settings control MUST id=status and accessible name Settings. It opens quick-settings card with #st-platform (advanced settings), #st-motion (calm aria-pressed/OS disabled), #st-voice, #st-sounds, #st-demo, #st-clear for compatibility with existing regression hooks. These IDs are owned/rendered by module; parent removes old direct onclick/textContent writes in favor of update/onAction. Right glyph buttons can use distinct IDs, callback once only. status can contain .label for caption but parent will use update, not manipulate your DOM.
Compact quick-settings card shows real brain/session/model/context and general preference rows + advanced settings/tidy. Do NOT invent restart service control; not required for visual reference. Model glyph routes to real Providers, not a fake model picker.

## Behavior / layout
Use real buttons with accessible labels and aria-expanded/pressed/current as appropriate. Hover-only labels must also reveal on keyboard focus, with useful accessible names while hidden. Cards are modeless popovers (reference has no heavy backdrop): role=dialog, class=margin-card, hidden attribute when closed. Click outside/Escape closes, Escape prevents global tidy; restore trigger focus on Escape, not when clicking another control. Avoid click-open/close races. Only one card open at a time is fine. Parent will guard global shortcuts while .margin-card:not([hidden]) is open. Handle keyboard focus and no background trigger interception.
Do NOT rebuild a focused popup or overwrite an edited cap on background update; key DOM by project. Async callbacks get per-action disabled/error status without losing user context. Show action errors inline where possible.
Wide desktop: rails near top150,left/right28,44px icons,14px gap, restrained Geist ink typography. Keep chat/composer/character clear; set body class margin-ui-active and responsive CSS constraints as needed. At smaller widths, use compact active-project trigger left (short label), Settings right, and reachable project chooser/quick controls in cards. Do NOT lay five icons over the character. 320px/390px/520px/native1180px and1440px; scrolling/short-height safe. Mobile cards fit viewport and contain all actions. Follow OS reduced motion; preserve renderer unchanged.

## Platform modal polish
Use same 5c3 paper/card language, calmer backdrop and Geist, pill-like tab navigation, useful form grouping/readability. Advanced settings can remain larger (it has real provider, skill, vault, schedule, activity, phone forms); do not squeeze it into250px. Keep all names/labels/actions and project-scoping, stale read/save protections intact. Native dialog semantics/close/focus unchanged or improved safely. No account actions during development QA.

## Acceptance / operations
Build before actual UI QA. Use testBackend fixtures, mock providers only. Real UI project selection, progress/status correctness, card open/close/outside/Escape, preference state, advanced settings, empty/long lists, responsive layouts, no overlaps or unintended chat/backend actions. Existing native tests/typecheck/build/ordinary review regressions. Source-pinned screenshot evidence matches requested mix; independent visual review. Preserve Pocket interactions and calmly cancel canvas holds when focus leaves.
Parent will refresh installed app UI after acceptance (native shell already loads same local server); no backend restart. New goal must be completed only from new UI evidence, not prior Pocket acceptance.

IMPORTANT async work: bash completion alone does NOT wake an ended agent. Start job nonblocking, retain handle/output, and arm off-turn asyncio.create_task waiter that awaits native handle and sends explicit agent_message to parent with exit/result/path/cleanup. Then end turn. No sleep polling/long inline await. Send artifact-ready and final replies. Keep tasks bounded; no endless extra QA scope.

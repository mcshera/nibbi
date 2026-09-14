# Independent review — sidebar lab

I read `BRIEF.md`, `README.md`, `CONTRACT.md`, `references.md`, all of `evidence/browser-results.json`, and `verify.mjs`, `lab.mjs`, `fixture.mjs`, `states.mjs`, `contract.html`, `options.test.mjs`, all four `options/*.mjs` and their CSS; I opened `matrix.png`, `state-home.png`, `state-many.png`, `state-drawer.png`, and full-resolution crops of `shot-scope-builds-1180x820.png`, `shot-spine-switch-1180x820.png`, `shot-spine-home-1180x820.png`, and the phone and desktop cells of `matrix.png` for all four bars; and I checked the brief's claims about `public/margins.css`, `public/lib/margin-ui.js`, `public/app.js` and `tools/` against those files. **Nothing was edited, run or regenerated — this file is the only thing I wrote.** The verdict: the lab is well built and the prototypes are real, but the recommendation does not survive its own evidence — `peer` wins on the one row that measures how little the markup changed, six of the ten measured rows are constants produced by a fixture that cannot separate anyone, and two of the three proposals ship the dead-zone anti-pattern `references.md` names as a failure to avoid.

## Top 10 (highest impact first)

### 1. The recommendation is decided by a row that measures similarity to today's markup, and the do-nothing baseline ties for first place on it.

**Where.** `BRIEF.md:112` ("It is the only design that answers the complaint without spending anything… all twenty pinned selectors survive"); the row `BRIEF.md:102` `Pinned app selectors kept | 20 | 19 | **20** | 18`; `options/peer.mjs:3-4` ("Everything else is `_today`'s DOM, class for class"); `evidence/browser-results.json` → `measured._today.pinnedKept` (20 entries) and `measured.peer.pinnedKept` (the identical 20 entries).

**Why.** `peer` keeps 20/20 selectors because it *is* `_today`'s DOM with one row moved — the row is tautological, and `_today`, the option nobody is proposing, scores the same 20/20. Strip that row out and look at what is left of §6: `clicksToSecondThread` is 1 for all four; `newThreadWithoutScrolling` is 4/4 for all four; `conversationsAboveTheFold` is 4 for all four; `labOnlyActions` is `[]` for all four; horizontal overflow is none for all four; `minContrast` is 5.52 for all three proposals. **Exactly one measured row separates the three proposals on behaviour** — `clicksToOtherProjectThread`, where `spine` is `{clicks: 2, scrolled: false}` and `peer` is `{clicks: 2, scrolled: true}` — and it favours `spine`. The one other separating row, `tabsToNewThread`, favours `scope` (11 vs 12). The brief's own goal table (`BRIEF.md:24`) lists "It has to ship" as the *last* of six goals; the recommendation treats it as the first.

**Fix.** Move "Pinned app selectors kept" out of the measured scorecard into a separate **promotion cost** table that is read after the design is chosen, and restate §7 as: the measured evidence, where it discriminates at all, points at `spine`; `peer` is the cheapest promotion of a design the measurements do not prefer. If the pick stays `peer`, say plainly that it is a cost decision, not a design one.

### 2. The fixture is built so that nothing can fail: the working project sits at the top of every list, and it has exactly four conversations.

**Where.** `fixture.mjs:15` — `battalion` is index **1 of 4** in `PROJECTS`, and `many()` (`fixture.mjs:50`) appends the eight extras *after* it, so at twelve projects the active one is still second. `fixture.mjs:53` — `stress(60)` sets `activeProject: 'p-0'`, index **0 of 60**. `fixture.mjs:17` — `battalion` has four threads; every other project in `PROJECTS`, every `blank()` (`fixture.mjs:36`) and every `stress()` project has exactly one.

**Why.** `BRIEF.md:108` admits one consequence ("the **fold** row does not separate anyone here, because the fixture gives the working project four conversations"). It is worse than that. `newThreadWithoutScrolling` is `true` in all sixteen cells and `conversationsAboveTheFold` is `4` in all sixteen cells (`browser-results.json → measured.*`) for the same reason: in `_today` and `peer` the only threads in the DOM belong to the expanded project, and the expanded project is always the second row of the list. `matrix.png`, row **Peer 390×844**, column **12 PROJECTS**, shows the consequence directly — the drawer fits `shipless`, an expanded `battalion`, and the top of `nibbi`: **two and a half of twelve projects**. Point `activeProject` at `observatory` (index 9 of 12) and `_today` and `peer` fail `newThreadWithoutScrolling` outright, while `scope` and `spine` are unaffected by construction. `CONTRACT.md` sets a scale rule about mount time and says nothing about position in the list.

**Fix.** Add a `deep` fixture: `activeProject` at index 9 of 12 with 30 conversations, and re-run §6. Report `newThreadWithoutScrolling`, `conversationsAboveTheFold` and `clicksToOtherProjectThread` for both `many()` and `deep`. Until that exists, delete the four rows above from §6 rather than printing four identical columns.

### 3. `scope` and `spine` ship the dead-zone anti-pattern `references.md` names as a failure to avoid, and §5 never lists it as a cost of either.

**Where.** `references.md`, "Two anti-patterns worth naming" #1: *"Bottom-pinned shelves leave a dead zone… 'A large blank area separates the upper task list from the "Settled" section… this gap occupies roughly half the visible sidebar.'"* Then: `evidence/shot-scope-builds-1180x820.png`, left column — bar content ends at the progress line ~370 CSS px down, `Settings` is pinned at ~800, leaving **>400px of empty cream, more than half the bar**. `evidence/matrix.png`, row **Scope 390×844**, column **HOME** — content ends after "2 merged today · 5 this week · 3-day streak" and `Settings` sits at the foot, **~330 of 844px empty**. `evidence/shot-spine-switch-1180x820.png` — the column ends at `Plans` ~310 CSS px down, **~500px empty** above the pinned `+` and gear.

**Why.** `BRIEF.md:39` names this exact failure as one of "two failures worth naming because they are easy to repeat", then answers only the second one ("say it in words") and never returns to the first. Neither `scope`'s risks (`options/scope.mjs:29-32`) nor `spine`'s (`options/spine.mjs:34-38`) mention it. It is also the one defect a person sees in the first second of looking at the sheet.

**Fix.** Either let `Settings` and the foot controls sit directly under the content instead of pinning them (`scope.css`/`spine.css` foot rules), or put something in the gap that earns it — in `scope`, the rollup sentence about the projects you cannot see, which is currently the design's only answer to its own biggest risk. Then add a "dead space at rest, 1180×820 and 390×844" row to §6 and measure it.

### 4. `spine` at twelve projects on a phone is a column of ambiguous single letters, and the brief gives it the best phone score of the four.

**Where.** `evidence/matrix.png`, row **Spine 390×844**, column **12 PROJECTS** — the spine reads, top to bottom, `s b n t a o p w t b s n`. Against `fixture.mjs:10-31` that is `shipless / battalion / nibbi / test / a-very-long… / observatory / paper-garden / weekend-notes / the-quick-brown-fox… / battalion-2 / shipless-docs / nibbi-site`: **six of twelve tiles collide** (s/s, b/b, n/n, t/t). `spine.css:50` sizes them 44px on narrow; `spine.mjs:195` is `name.trim().charAt(0)`.

**Why.** `BRIEF.md:88` scores *Holds up on a phone*: `Spine 4` — the highest in the row. `options/spine.mjs:34` admits only two collisions ("shipless / shipless-docs and nibbi / nibbi-site"), and its mitigation is `tile.title` (`spine.mjs:199`) — a hover tooltip, on a device with no hover. `spine.mjs:37` concedes "touch does not get it at all" about the peek but not about identification. `references.md` cites Cursor's *"truncated repository names with no tooltip"* as a live complaint and `spine.mjs:26` cites it as a reference; a one-letter tile with a tooltip that touch cannot reach is the same bug.

**Fix.** Drop `Holds up on a phone` for `spine` to 2 and say why in §5. Then either give the narrow spine the project name instead of the initial (there is room: `spine.css:135` gives the drawer `min(300px, 100% − 40px)`), or disambiguate the initial — two letters, or the first letter plus the first letter after the last hyphen (`sd`, `ns`, `b2`).

### 5. Nine of the evidence images promise all four bars and show three, cut off 472px down.

**Where.** `README.md`: *"`evidence/state-<id>.png` — all four bars at one moment."* `evidence/state-home.png`, `state-many.png`, `state-drawer.png` (and by the same clip, all nine) are 1472×472 and contain **Today, Scope and Peer only** — `Peer`'s card is sliced at the right edge and **`Spine` is absent from every one of them**. `state-drawer.png` cuts each phone drawer two project rows in, so the one moment whose whole subject is the drawer shows none of it. Cause: `verify.mjs:383` clips to `#studies`'s box with `width: Math.min(r.width, innerWidth)` while `lab.css:51` lays `#studies` out as `repeat(auto-fit, minmax(420px, 1fr))`, which at the 1680px shot viewport (`verify.mjs:374`) gives three columns.

**Why.** These are the only images in the lab that put the options side by side at one moment — the comparison the owner will actually make. They are missing the option `BRIEF.md:114` names as the pick if the recommendation is overturned.

**Fix.** Shoot `state-*.png` at a viewport wide enough for four columns (≥1830px) or set `grid-template-columns: repeat(4, minmax(0, 1fr))` for the shot, and clip to the full element height instead of whatever the first grid row happens to be.

### 6. The task the brief proposes as its own tiebreaker cannot be performed on the fixture the lab ships.

**Where.** `BRIEF.md:114`: *"Put the sheet in front of five people with one task: 'open the conversation called "why does the lobby say 71" in the project called nibbi.'"* In `fixture.mjs:17`, the thread `t-lobby` / *"why does the lobby say 71"* belongs to **battalion**. `fixture.mjs:21` gives **nibbi** exactly two threads: `home` and `t-glass` / *"glass window on Liquid Glass"*.

**Why.** §7 is the escape hatch the whole recommendation rests on — "What would overturn it" — and it names a project/thread pair that does not exist anywhere in the lab. Anyone who runs it as written will be told the conversation is not there. The measured row that stands in for it (`verify.mjs:278`) targets `[data-thread-project="nibbi"][data-thread-id="home"]` — the *first* row of the second project, the cheapest target in the model, not a thread you have to hunt for.

**Fix.** Either rewrite the task to *"open 'glass window on Liquid Glass' in nibbi"*, or move `t-lobby` into `nibbi` and re-run. Then point `clicksToOtherProjectThread` at the **last** thread of a second project that has more than two, so the row measures hunting rather than landing.

### 7. "Tab presses to New thread" is not a count of tab presses; it is a DOM index.

**Where.** `verify.mjs:284-287`:
```js
const focusable = () => [...host.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"], a[href]')].filter(el => window.__lab.visible(el));
const order = focusable();
row.tabsToNewThread = target ? (order.indexOf(target) >= 0 ? order.indexOf(target) + 1 : null) : null;
```
`BRIEF.md:101` prints the result as `Tab presses to New thread | 14 | **11** | 12 | 12` and bolds `scope`'s 11.

**Why.** `querySelectorAll` returns DOM order, not tab order: it ignores positive `tabindex`, ignores that a roving-tabindex list is one stop rather than N, and ignores any element focusable for another reason. `__lab.visible` (`verify.mjs:41`) checks only size and `visibility`, so an element at `opacity: 0` counts — which is exactly the state of `scope`'s and `peer`'s hover actions (`peer.css:54`, `spine.css:90`) and of the hover gear (`peer.css:68`) when `hoverGear` is on. The measurement is also taken at one size and one state only (`verify.mjs:153`, `home` at 1180×820) while §6 is headed "Nine moments × five sizes" (`BRIEF.md:93`).

**Fix.** Measure it by actually pressing Tab — `page.keyboard.press('Tab')` in a loop from the bar's first control until `document.activeElement` is `[data-lab-role="new-thread"]`, capped. Until then, rename the row "New thread's position among the bar's focusable elements" and drop the bold.

### 8. `clicksTo` returns a click count before it has clicked anything, and its `scrolled` flag conflates two different costs.

**Where.** `verify.mjs:244-251`:
```js
for (let clicks = 1; clicks <= 4; clicks++) {
  let target = host.querySelector(targetSelector);
  if (window.__lab.reachable(target, host)) return { clicks, scrolled };
```
The loop starts at 1 and returns on the *first* iteration if the target is already on screen — before any click. It also never clicks the target itself; it clicks candidates until the target becomes reachable and then reports the loop counter. Separately, `scrolled` is set true both when the *target* had to be scrolled to (`:250`) and when an intermediate *candidate* had to be scrolled to (`:262`).

**Why.** `BRIEF.md:97-98` prints these as `Clicks to a second conversation here` and `Clicks to another project's conversation | 2 + a scroll | 3 | 2 + a scroll | 2`, and `BRIEF.md:108` builds an argument on the scroll ("a row clipped by the bar's own scrolling is not reachable by pointing at it"). The numbers happen to land right for these four designs, but the method would report "1 click" for a design where the thread is already open and needs no click at all, and "2 + a scroll" cannot tell the reader whether the scroll was to find the *project* or to find the *thread* — which is the whole difference between `peer` and `spine`.

**Fix.** Start the counter at 0 and increment on each real `el.click()`; click the target as the final step and assert the dispatched action. Split `scrolled` into `scrolledToNavigate` and `scrolledToTarget`, and print both in §6.

### 9. `spine`'s headline claim — that the spine keeps "which project am I in" answerable — is false on a phone and wrong in the one moment built to show switching.

**Where.** `spine.css:2-3`: *"Collapsed keeps the spine, so the workspace never gets the full width back and 'which project am I in' stays answerable."* But `spine.css:136-137` — `.is-floating .spine-bar { transform: translateX(-100%) }` and `.is-narrow .peek { display: none }` — and `evidence/matrix.png`, row **Spine 390×844**, column **COLLAPSED**, is empty paper: character, composer, one toggle, **no spine**. And in `evidence/shot-spine-switch-1180x820.png` the filled black tile is `b` (battalion, `spine.mjs:200` `is-active` follows `M.activeProject`) while the column beside it is headed **nibbi** — the `is-shown` treatment for the shown-but-not-active project (`spine.css:46`, a 1px `rgba(21,20,19,.35)` border plus 50% white) is invisible at 40px against `#ece8e0`.

**Why.** `spine.mjs:27` cites OpenCode #37273 — *"The active project is no longer clearly visible… difficult to identify which project a session belongs to at a glance"* — as the warning the design exists to answer. `BRIEF.md:84` scores *"Which project am I in" at a glance*: `Spine 4`. In the frame the lab shot to demonstrate switching, the spine and the column disagree, and nothing marks the project you are looking at.

**Fix.** Give `is-shown` a treatment that survives 40px on cream — a 2px ink left-edge or a ring at full ink alpha — and check it against the `switch` shot. Either keep a 44px spine visible in the narrow drawer's collapsed state or strike the "collapsed keeps the spine" sentence from `spine.css:2` and drop the §6 score to 3.

### 10. §10's next steps would have the owner delete a live assertion and a deliberate regression guard.

**Where.** `BRIEF.md:138`: *"drop three stale assertions while there: `#plan-first` (`tools/sidebar-verify.mjs:51`, `tools/voice-verify.mjs:61`) no longer exists, `.margin-compact` … is dead, and `#st-tricks` is gone."* Against the repo: `public/app.js:88` — `planBtn.id = 'plan-first'` — plus `public/index.html:49` (`#plan-first-note`), `public/styles.css:376` (`.pill.plan-first`). And `#st-tricks` appears in `tools/margin-ui-verify.mjs:42` and `tools/pocket-app-qa-helpers.mjs:40` as `assert.equal(await page.locator('#pocket-tricks,#st-tricks…').count(), 0)` — assertions that it is **absent**, written to keep it that way.

**Why.** Only `.margin-compact` checks out (`grep` finds it in `tools/margin-ui-verify.mjs:22` and `tools/margin-surface-verify.mjs:55` and nowhere under `public/`). The other two are wrong in opposite directions: one is a live control, the other is a guard whose whole job is to fail if the thing comes back. A brief that is trusted on its other repo claims — and it should be, I checked `margins.css:16` vs `:97`, `:108` vs `:114`, `:141` vs `:143`, and `margin-ui.js:71-460`, and all four are exactly as described — will get this one acted on.

**Fix.** Delete the `#plan-first` and `#st-tricks` sentences from `BRIEF.md:138`, keep `.margin-compact`, and re-check the claim against `grep -rn` before it ships.

## Also

- Each option's `meta` contradicts the evidence and nothing validates it: `options/scope.mjs:29` says another project's conversation "costs two clicks" where `browser-results.json` measured 3 and `BRIEF.md:56` says 3; `scope.mjs:39` claims `project-options` in `meta.pinned` while `measured.scope.pinnedMissing` is `[".project-options"]`; `spine.mjs:43` claims `sidebar-progress` while `measured.spine.pinnedMissing` is `[".sidebar-collapse", "#sidebar-progress"]`. `contract.html:58` only checks `Array.isArray(meta.pinned)`.
- `BRIEF.md:104` prints `Mounting 60 projects | 3 ms | 3 ms | 2 ms | 0 ms`; `browser-results.json → measured.*.mountMs60` is `1 / 1 / 1 / 0`. The scorecard is not derived from the evidence file it cites.
- The reduced-motion check never uses its loop variable: `verify.mjs:222` is `for (const id of sidebarLab.options) { sidebarLab.cue('switch'); sidebarLab.cue('collapsed'); }` — it fires the same two global cues four times and only ever measures the settled `collapsed` state. No card, chooser, peek, drawer or hover transition is tested under reduced motion.
- The sweep measures heights, visibility and contrast 60ms after a cue (`verify.mjs:76`) while `settle()` elsewhere waits 280ms "because the bar slides for 220ms" (`verify.mjs:236`). Target heights can be read mid-transition, and `__lab.visible` (`verify.mjs:41`) ignores `opacity`, so a faded-out control counts as visible.
- 33 of the baseline's 688 warnings are lab artefacts, not findings about the app: `margins.css:141` already sets `.project-options { width: 40px; height: 44px }` under `@media (max-width: 899px)`, which a transformed frame cannot answer — `peer.css:11` says so explicitly. `"Project settings for bat 40px<44"` is the lab failing to see a rule that ships.
- `spine.css:33` (`.lab-native-mac … .spine-scroll { padding-top: 48px }`) is dead — `:125` redeclares it at equal specificity as 82px. Same class of defect the brief flags in `margins.css:141`.
- All visual evidence is shot at 1180×**760** (`states.mjs:37` `DESKTOP`) while the Tauri default window is 1180×**820** (`states.mjs:32`). There is no picture of any bar at the size the app opens at.
- The Escape gate accepts a 9px shrink as "closed" (`verify.mjs:209`, `widthAfter < widthBefore - 8`) and, when focus is outside the host, dispatches a synthetic `KeyboardEvent` at `host.querySelector('button')` (`:197`) — the first button in the DOM, whichever that is.
- States the lab has no moment for, each of which the owner will hit in the first week: zero projects / first run, `projectsLoaded: false`, the daemon offline or erroring, a project whose only thread is `home` being the *active* one, and a long **thread title** — `fixture.mjs` has deliberately long *project* names but its longest thread title is 38 characters, and thread titles are the first thing `spine`'s 200px column (`spine.css:8`) and `peer`'s twice-indented rows (`peer.css:45`) will truncate.
- The `shot-*.png` set is lopsided: `peer` has 5 of the 14, `_today` has 2, and `scope` has no phone shot at all.
- `README.md` links `[REVIEW.md](REVIEW.md)` as "an independent review of the first version" and says "BRIEF §9 lists what changed in response" — §9 is "What this lab proves — and does not" and lists no such thing. Before this file, the link was dead.
- `verify.mjs:133` writes `perViewport[vp.id] = true` and never reads it.

## What is sound

- **The dispatch-protocol gate.** `verify.mjs:160-186` clicks every control and asserts the dispatched names against the real `handleMarginAction` vocabulary, plus the shape of `thread` and `projectSection` arguments. `measured.*.labOnlyActions` is `[]` for all four. This is the check that makes "a promoted option is a drop-in" a fact rather than a hope — keep it exactly as it is.
- **The host-scoping rules in `CONTRACT.md`** (no `document`/`window` listeners, no `matchMedia`, no `Date.now()`, viewport as a prop) and the fact that all four options honour them. It is why three bars can share one page without fighting, and why `peer` copies `_today` instead of importing it.
- **The 4.33:1 finding and its fix.** `margins.css:144` gives `.project-section-badge` `--ink-3` at 10px; `#5f5b55` at 5.52:1 (`peer.css:26`, `spine.css:9`, applied on the token so everything quiet inherits it at once) is the right shape of fix. Fix it in `margins.css` regardless of which bar wins.
- **`references.md`.** Every claim carries a URL, every entry separates "take" from "leave", and it is the strongest document here. The problem in item 3 above is that the brief stopped reading it, not that it is wrong.
- **The improvements as nine independent flags** (`states.mjs:41-51`), each provable to change something (`contract.html:208-215`). This is what lets "New thread pinned top" and "attention as text" be adopted without adopting a whole bar, and it is probably the lab's most reusable output.
- **Attention is text everywhere.** I looked for a dot or a chip in every frame of `matrix.png` and `matrix-improved.png` and found none; `spine.mjs:9-10` explicitly strips OpenCode's 6px status dot. The constraint held.
- **Every truncated string has a title.** `peer.mjs:234`, `spine.mjs:199/216/244/278`, `scope.mjs:341`. Cursor's complaint does not repeat here.
- **`scope`'s 2×2 tab block at 390px** (`matrix.png`, row Scope 390×844, column HOME) is the most legible thing in the lab: `Chat / 4 conversations` and `Builds / 71 need attention` read cleanly at phone width with no truncation, and it is the only frame in which a stranger could say what the bar is for in one second. Whatever wins, that block is the answer to the owner's actual sentence.

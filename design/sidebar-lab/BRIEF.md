# Where does chat belong in the left bar?

## 1. The ask, and what it is really about

> "Right now I find it silly that chat is at the bottom when it should almost be a different tab on the projects bar like a dropdown."

Taken literally that is a request to move some rows. Underneath it are two questions the bar has never answered.

**What rank does a conversation have?** Today a project expands into Builds, Issues, Plans, then its conversations, then New thread — records first, talking last. But talking is what you do in Nibbi; Builds is where you go when something needs deciding. The order is upside down relative to use.

**How do you reach another project's conversation?** Today: expand the second project, scroll past its three record rows, and click. The bar is a tree of everything, so the thing you want is always somewhere inside it.

The ask names a third thing worth separating out: *a dropdown*. A dropdown is a claim that **one project is current** and the others are a list you visit — the opposite of a tree, where every project is permanently half-present.

## 2. Goals, and what each demands of the bar

| Goal (from how Nibbi is used) | What it demands |
|---|---|
| Talking is the main action | Conversations rank at or above the record sections; New thread is reachable without hunting |
| A day is spent in one project, with glances at the others | One project is clearly current, and the others are one move away |
| Nothing nags | Attention is reported in words. No dots, no chips, no badge in the composer — the owner has rejected that mark twice |
| The window is 1180×820 and sometimes a phone | Twelve projects must still leave conversations above the fold at 390px |
| It is a desktop app | The keyboard reaches the bar: toggle, new thread, switch project, move between conversations |
| It has to ship | A promoted design keeps the twenty selectors the app's own suites pin, or the promotion becomes a rewrite of six tools and a CI suite |

## 3. What stays constant

Every option here keeps: the bar at 256px docked and `min(300px, 100% − 40px)` as a slide-over below 900px, with a backdrop; Escape closing a card or a chooser before the bar, and returning focus to what opened it; the project card and the settings sheet exactly as the app has them; the dispatch protocol (`handleMarginAction`), so a promoted option is a drop-in for `installMarginUI`; and the paper, the ink and Geist. The thread's name rides on the composer placeholder, never as a badge in the bar.

## 4. The design space

Four shapes are in use across the apps Nibbi is measured against (all cited in [references.md](references.md)):

- **Disclosure tree** — projects expand to reveal their contents. Nibbi today, T3 Code's legacy sidebar, and the grouping mode in Claude Code desktop, Zed and Cursor. Familiar; every project is permanently half-present; deep lists get slow and long.
- **Header row + flat list** — search, a project-scope dropdown and new-thread in one row, with the conversations beneath. T3 Code's Sidebar V2, the shipped default. One project is unmistakably current; the others cost a click.
- **Rail + column** — a narrow strip of projects beside that project's contents. OpenCode's layout until it was retired on 2026-09-14. Switching is one click and never scrolls; the column is narrow, so typography carries everything.
- **No bar at all** — session tabs in the titlebar plus a home page. OpenCode's replacement, and the source of its loudest complaint: *"the active project is no longer clearly visible… it is difficult to identify which project a session belongs to at a glance."* Nibbi's titlebar is already spent on the traffic lights and an overlay title, so this one is parked, not explored.

Two failures are worth naming because they are easy to repeat. T3 Code pins its finished-work shelves to the bottom with `margin-top: auto`, and users report *"a large blank area… this gap occupies roughly half the visible sidebar."* And a project switcher that collapses to an icon hides whether another project needs you — filed against T3 Code and still open. Every option here answers the second one with the same move: **say it in words**.

## 5. The options

Each is a working prototype on the app's real stylesheets. "Promotion cost" is what `installMarginUI` would have to become.

### 01 · Today — *the bar as it ships*

A project expands into Builds, Issues, Plans, then its conversations, then New thread. Included as the baseline so the other three are judged against the real thing rather than a memory of it, and so the scorecard has a column that says what you already live with.

**Why it is the complaint.** Three record types outrank every conversation. Reaching a second project's thread means expanding it and scrolling past its records. And the workspace repeats Builds / Issues / Plans as tabs, so the same navigation exists twice while chat is in neither.

### 02 · Scope — *one project at a time; a switcher on top, Chat as the first tab*

The literal answer, in the shape T3 Code's Sidebar V2 uses. A switcher names the current project and opens a dropdown **the full width of the bar** — the detail that makes it read as a dropdown rather than a menu button — with a find field, every project, a gear each, and New project last. Under it a strip of four tabs, **Chat first and default**. Chat's body is New thread plus the conversations; a record tab's body is that section's summary in a sentence, with the records themselves in the workspace.

**How it answers the ask.** Literally: chat is a tab on the projects bar, and the projects bar is a dropdown. Conversations rank above records rather than below them.
**Costs.** Only one project is ever in the bar, so another project's conversation is three clicks. The strip is permanent furniture, and with the Chat-tab improvement on, the same four tabs appear twice on screen. Four tabs cannot fit "71 need attention" across 256px in one row, so the strip is a 2×2 block.
**Promotion.** The largest rewrite: the project list becomes a popover, and the gear moves inside it, so `.project-options` exists only while the dropdown is open (19 of 20 pinned selectors survive).

### 03 · Peer — *keep the tree; Chat becomes the first row, with its own dropdown*

The smallest change that answers the complaint. The tree stays. Under an expanded project the **first** child row is Chat, itself a disclosure: collapsed it reads `4 · 24m`, expanded it holds New thread and the conversations. Builds, Issues and Plans follow. The Chat row takes `aria-current` when a conversation is open, exactly as a section row does when its records fill the workspace, so the bar and the workspace finally mirror each other. New project moves onto the Projects heading as a `+`.

**How it answers the ask.** Chat becomes a peer of the record sections and opens like a dropdown, without giving up the tree.
**Costs.** Two disclosures deep before a conversation: project, then Chat. Every project is still permanently half-present, so a second project's thread is still two clicks and a scroll. It inherits the tree's ceiling rather than raising it.
**Promotion.** The cheapest by a wide margin — **all 20 pinned selectors survive**, so the suites and the CI workflow keep passing on selectors alone.

### 04 · Spine — *projects become a 56px strip; the bar is one project's column*

OpenCode's retired two-pane, adapted. The spine holds one tile per project (the initial, ink on paper; the current one filled), with New project and Settings pinned at its foot. Beside it, a 200px column: the project's name and branch, a full-width New thread, the conversations, then a **Work** group holding Builds, Issues and Plans. Collapsed keeps the spine, and hovering a tile flies that project's column out over the page.

**How it answers the ask.** It does not add a tab to the projects bar — the projects bar *becomes* the tab strip, and the column is its body, with conversations at the top. Records read as the project's filing rather than its navigation.
**Costs.** A single letter is a weak name: `shipless` and `shipless-docs` collide, and only the tooltip separates them. The 200px column drops the section detail line to a tooltip. The peek is a pointer affordance — keyboard gets it on focus, touch does not get it at all.
**Promotion.** Two pinned selectors go: there is no separate collapse control (one toggle does both jobs) and the progress line only exists with the foot improvement on (18 of 20).

## 5b. Round two — Scope, and the strip in one row

> "I like 02 scope, can you make chat/builds/plan/issues one row. Make me 3 more variants of 02 scope."

Round one asked which shape the bar should be, and the answer was Scope. Round two changes exactly one thing: **the strip**. Everything else — the switcher, the full-width dropdown, the body, the foot, the cards — is now one shared shell (`scope-shell.mjs`), so the four variants differ only in the row and can be compared on it alone.

The row was two rows because four tabs across 256px cannot carry `71 need attention`. Each variant pays for the single row differently.

| | The row | What it gives up | What it buys |
|---|---|---|---|
| **Scope** | `Chat 4 · Builds 71 · Issues · Plans 56/58` | the sentence — only the number is in the row | you can see, without moving, that Builds has 71 |
| **Scope · quiet row** | `Chat · Builds · Issues · Plans`, then one line: `71 need attention · 3 running` | the glance — you learn what is waiting only for the tab you are on | the strip never changes, and the sentence is whole |
| **Scope · icon row** | a glyph each; the current tab opens up and says its name and phrase | three tabs are unlabelled glyphs | the tab being read carries the full phrase, and the row changes width, not wording |
| **Scope · chat is the room** | `Builds 71 need att… · Issues No issues · Plans 56/58 tasks` — three tabs, no Chat | the word "Chat" entirely | three tabs fit their phrases; the conversations are the body by default, not a tab you select |

The fourth argues with the ask on purpose. Chat is not somewhere you go, it is where you already are, so it is the body and the record tabs are a filter you turn on and off. Choosing the tab you are already on returns you to the conversations. That costs a `lab:backToChat` action the app does not have yet.

**Measured** — the variants differ only in the strip, so most rows are identical by construction, and that is the point: choose on the row, not on the numbers.

| | Scope | Quiet row | Icon row | Chat is the room |
|---|---|---|---|---|
| Clicks to a second conversation | 1 | 1 | 1 | 1 |
| Clicks to another project's last conversation | 3 | 3 | 3 | 3 |
| Tab presses to New thread | 10 | 10 | 10 | **9** |
| Conversations above the fold, buried project at 390 | 13 | 13 | 13 | 13 |
| Pinned app selectors kept | 19/20 | 19/20 | 18/20 | 19/20 |
| Actions the app does not have | none | none | none | `lab:backToChat` |

The icon row keeps one fewer selector because a glyph carries no badge until it is the current tab, so `.project-section-badge` is absent from three of its four tabs.

**One finding from round one, answered.** The independent review measured 326px of empty bar below Scope's content at 1180×820 — the dead-zone anti-pattern `references.md` names. It is not inherent to the shape: **turn on the attention rollup and the progress-at-the-foot improvements and the gap closes to 29px**, because those two lines are what the bar has to say when the conversation list is short. Whichever strip wins, ship it with those two on.

## 6. Side by side

Author's reading, 1 = weak, 5 = strong. These are one person's judgment of the sheets, not research.

| | Today | Scope | Peer | Spine |
|---|---|---|---|---|
| Chat ranks as a peer of the records | 1 | 5 | 4 | 5 |
| Reaching another conversation here | 3 | 4 | 4 | 4 |
| Reaching another project's conversation | 2 | 3 | 2 | 5 |
| "Which project am I in" at a glance | 3 | 5 | 3 | 4 |
| New thread is discoverable | 2 | 4 | 4 | 5 |
| Answers attention without a dot | 2 | 4 | 4 | 3 |
| Holds up at twelve projects | 3 | 4 | 3 | 4 |
| Holds up on a phone | 3 | 3 | 3 | 4 |
| Keeps the bar quiet | 4 | 3 | 4 | 4 |
| Cost to promote (5 = cheapest) | — | 2 | 5 | 3 |
| Fits the owner's taste | 3 | 4 | 4 | 3 |

**Measured**, from `evidence/browser-results.json`. Nine moments × five sizes; geometry in CSS pixels at the page's own viewport.

| | Today | Scope | Peer | Spine |
|---|---|---|---|---|
| Clicks to a second conversation here | 1 | 1 | 1 | 1 |
| Clicks to another project's conversation | 2 + a scroll | 3 | 2 + a scroll | **2** |
| New thread reachable without scrolling (1180 and 390, 4 and 12 projects) | 4/4 | 4/4 | 4/4 | 4/4 |
| Conversations above the fold at 390 with 12 projects | 4 | 4 | 4 | 4 |
| Tab presses to New thread | 14 | **11** | 12 | 12 |
| Pinned app selectors kept | 20/20 | 19/20 | **20/20** | 18/20 |
| Smallest quiet-text contrast | **4.33** | 5.52 | 5.52 | 5.52 |
| Mounting 60 projects | 3 ms | 3 ms | 2 ms | 0 ms |
| Actions outside the app's vocabulary | none | none | none | none |
| Horizontal overflow, any state or size | none | none | none | none |

Two rows deserve their caveats. **Clicks to another project's conversation** counts a scroll as part of the cost, because a row clipped by the bar's own scrolling is not reachable by pointing at it: Today and Peer need one. And the **fold** row does not separate anyone here, because the fixture gives the working project four conversations; a project with thirty would separate them sharply, and that is worth re-running before promotion.

## 7. Recommendation

**Peer.** It is the only design that answers the complaint without spending anything: chat becomes the first row under a project and opens like a dropdown, the Chat row and the workspace tab finally mean the same thing, and all twenty pinned selectors survive — the promotion is a diff, not a rewrite. Scope is the more interesting bar and the more literal reading of the ask, but it costs a click to every other project's conversation, and it puts the same four tabs on screen twice.

**What would overturn it.** Put the sheet in front of five people with one task: *"open the conversation called 'why does the lobby say 71' in the project called nibbi."* If Peer needs more clicks than Scope or Spine for three of the five, the tree is the thing to abandon, and Spine is the pick — it already reaches another project's conversation in two clicks with no scrolling, the best number here.

## 8. Considered and parked

- **A flat list of every conversation across projects**, the way T3 Code V2 does it, with the project named on each row. Nibbi's work is project-shaped — builds, issues and plans all belong to one — so a cross-project list would need a second control to get back to the records. Worth revisiting only if the number of projects stays small and the number of conversations grows.
- **Session tabs in the titlebar.** The Tauri window uses an overlay title bar with the traffic lights inset 48px; there is no room, and OpenCode's own users lost track of which project they were in.
- **Bottom-pinned shelves** for settled or archived conversations. The dead-zone complaint is a real one, and Nibbi has no "settle" gesture to hang it on.
- **A status dot per project.** Rejected twice already in this app, and it answers the wrong question: you want to know *what* needs you, not *that* something does.
- **Group-by-project as a switchable view.** One more preference to explain, in a bar that has none.

## 9. What this lab proves — and does not

**Proves:** four bars render on the app's real tokens and stylesheets across nine moments and five sizes with no horizontal overflow, no control under 44px on a phone, and no quiet text under 4.5:1; Escape keeps its order; every design speaks only the dispatch vocabulary the app already understands; sixty projects mount in single-digit milliseconds. The measured rows in §6 are real counts taken from the DOM at the page's own viewport.

**Does not prove:** anything about live data — a conversation hydrating, summaries arriving late, a build finishing while you watch. Nothing about the real translucent window, the real traffic lights, or WKWebView: **every check here runs in Chrome.** Nothing about touch. No screen-reader pass beyond names and roles. And nothing at all about whether one layout makes a person faster — §7 names the test that would.

**One finding is about the bar as it ships**, not about any proposal: every quiet label in it — the project summary, the relative times, the section badges, the progress line — is `--ink-3` (#6f6b65) on `#ece8e0`, which is **4.33:1**, under the 4.5:1 floor, at sizes between 10px and 12px. The `Today` baseline keeps the app's value deliberately so the number is reported rather than quietly fixed. Every proposal darkens it to #5f5b55 or better.

## 10. Next steps

1. Pick one, or say which parts of which to combine.
2. Run the task test in §7 before writing any production code.
3. Promote on a branch: rewrite `installMarginUI` (`public/lib/margin-ui.js:71-460`) to the chosen shape, keeping every pinned selector; add the Chat tab to the workspace strip (`public/lib/project-workspace.js:43`) if the chosen design assumes it.
4. Fix, in the same promotion, what this lab turned up in `public/margins.css`: the dead phone rule at `:141` (an unconditional rule at `:143` overrides it), the duplicated `.margin-card` block (`:16` versus `:97`), the native-Mac card inset at `:108` that always beats the phone block at `:114`, and the 4.33:1 quiet text.
5. Re-point the suites, and drop three stale assertions while there: `#plan-first` (`tools/sidebar-verify.mjs:51`, `tools/voice-verify.mjs:61`) no longer exists, `.margin-compact` (`tools/margin-ui-verify.mjs:22`, `tools/margin-surface-verify.mjs:55`) is dead, and `#st-tricks` is gone. `tests/margin-ui.test.mjs:53-58` pins the progress line above the project list, so the *progress at the foot* improvement changes that test by design.

## Appendix — decision guide

- **Cheapest thing that fixes the complaint** → Peer. One new row, one new disclosure, no selector lost.
- **Most literal reading of "a tab on the projects bar, like a dropdown"** → Scope.
- **If several projects are live at once** → Spine. Switching is one click, never a scroll, and the current project is never in doubt.
- **If the project count grows past twenty** → Scope or Spine; Peer's tree is the one that gets long.
- **If the bar has to stay familiar** → Peer, then Today with the improvements turned on.

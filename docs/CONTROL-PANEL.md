# Control panel — phase 1

The spec three builders work from in parallel, and the integrator after them. It binds. Where it and
the lab disagree, this wins; where it is silent, the lab's round six Cards bar and round five Console
pages win (`design/sidebar-lab/` on branch `design/control-panel-lab`, served read-only from the
`cp-lab` worktree).

```
branch      ui/control-panel  (from ui/r2-attention @ 9cb24f0, the top of draft PRs #20→#23; this is #24)
worktree    /Users/Matty/Documents/Nibbi/.claude/worktrees/control-panel
contract    public/lib/control-panel-contract.js   (typedefs + frozen constants; §3)
plan        ~/.claude/plans/control-panel-bar.md   ("Chosen design" and "Phase 1" bind)
```

The owner, 2026-09-24…28, verbatim: *"I want the left pannel to feel more like a control pannel … the
builds aren't clickable, you can't make a new build by hitting +. Can we remove plans, and make issues
improvements instead … make the buttons feel more premium."* · *"A build should be a literally clone of
the application like main and dev, dev1, ect like github branches."* · *"i like stack tree, but can you
pin both of them open, and make the default chat unless you click an improvement or a build. clicking on
an improvement should give you a ticket page, and clicking on a build should have the build details and
status."* · *"I like 2 console"* · *"i like cards"* · *"start phase 1, stack it on top"*.

**Phase 1 in one line.** The real app gets the Cards bar (project card · conversations card · builds
card, both groups pinned open, Settings left of collapse, chat by default) and the Console pages, over
real data, with exactly one build — `main` — holding its improvements. No persistent-build daemon work.

---

## 0. Rules every builder keeps

| rule | where it comes from |
|---|---|
| no new dependencies; no `npm install` (node_modules are APFS clones) | the owner |
| React is not involved; plain DOM modules as today | — |
| tokens only (`public/tokens.css`): no new colour, radius, shadow or duration | LANGUAGE §2, §5, §6 |
| three motions: `arrive` (a form, a confirm), `pulse` (live work), `leave`; `--ease`, `--t1` colour/background/small state, `--t2`, `--t3`; never `transition: all` | LANGUAGE §7.1–7.2 |
| press scale `.96` on the one primary of a surface only, no hover scale on new primaries; every other control presses by colour (`--veil-press` rows, `--bed-press` keys, shadow collapses) | LANGUAGE §7.3 (amended by the integrator, §8.6) |
| words carry state; a mark may sit beside a word, never replace it; colour only on machine verdicts (`--pass-*` on `in`/passed, `--fail-*` on `failed`/`needs_attention`) | ROUND3 decided 9, LANGUAGE §2.3 |
| one ink key per surface (the bar: the open form's submit; a page: `ActionVM.tone === 'ink'`) | ROUND3 decided 10, tree-console.mjs |
| 44px at `(pointer: coarse)` and at `≤899px` in the bar / `≤640px` on pages; 32px keys otherwise; two-line rows are 44 tall everywhere | LANGUAGE §12, bar-cards-shell.css:21-24 |
| `outline: var(--focus-ring)` on everything focusable (style-verify fails any other ring) | LANGUAGE §12, tools/style-verify.mjs:71-72 |
| every hover reveal also on `:focus-within` and under `(hover: none)`; a passive `touchstart` on the bar root so `:active` shows on iOS | ROUND3 decided 10 |
| copy lowercase and spoken (LANGUAGE §11, audit P14, docs/PERSONALITY.md); fixed strings live in `WORDS` in the contract | — |
| `tabular-nums` on every number that changes; a truncated string carries `title` | LANGUAGE §3.3, §11 |
| bar rows use `data-bar-build` / `data-bar-improvement`; **nothing** carries `data-build-id` | ROUND3 decided 2 |
| verdict hooks style-verify accepts: `[data-tone="error"]`, `[data-tone="pass"]` (added in §8.5), `[data-status=…]`, `.armed`, `[data-ok=…]`. Use no other selector with `--fail-*`/`--pass-*` | tools/style-verify.mjs:25-29 |
| `!important` budget: margins.css stays ≤ 3; project-pages.css is 0 | tools/style-verify.mjs:17 |
| keyframes are global names: reuse `arrive` / `pulse` from styles.css:22,46; an opacity-only word pulse (floor .75, bar-cards-shell.css:402) is `cp-bar-pulse` in margins.css and `cp-page-pulse` in project-pages.css | — |
| run commands from the worktree; `PATH="$HOME/.nibbi/bin:$PATH"` for daemon tests and browser tools; `CI=1` for browser tools; `node tools/test-backend.mjs` serves the **built** `dist/ui` (run `npm run build` after touching `public/`); never touch 127.0.0.1:4540 or :59871 | the orchestrator |
| commit: `git -c user.name=mcshera -c user.email=matthewshera@gmail.com commit`; a plain-English subject about the effect; the body says why and what was measured; trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. No push, PR, rebase or merge | the orchestrator |

---

## 1. The decisions, in brief

| # | decision | why |
|---|---|---|
| D1 | One build, `main`. Its **name** is always `main`; its **branch** is where runs really land (local: the newest run's `targetBranch`, else the project's `targetBranch`, else the checked-out branch; GitHub: `connection.integrationBranch` — `v2` for nibbi). The line under it says `live · what ships`, or `live · lands on v2` when they differ | the owner's model, stated honestly about today (fixer.ts:179) |
| D2 | An improvement is an issues.md item (`issue:<id>`) or a free-text run chain (`run:<first run id>`). Its tries are its runs: `issueIds` for an issue; the `replacesBuildId` chain for a run | Try again makes a new run (fixer.ts:292-302); a per-run ticket would split on every retry |
| D3 | 14 states, 5 groups, one order everywhere: waiting on you → building → up next → in → failed (settled ones only on the build page) | ROUND4 decided 6 + ROUND3 decided 3 (§4) |
| D4 | `awaiting_input` says **needs you**; staged says **ready to review**; GitHub-mode staged runs say to push / pull request open / ready to merge / needs a look | the orchestrator's word list; github-builds.ts:186-189 |
| D5 | Chat is the default. A build row → its build page; an improvement row → its ticket page; ×, Escape, or a conversation row → chat. `S.projectView = { project, page: 'build'\|'ticket'\|'repository', id }` | ROUND5 decided 5-6 |
| D6 | Pages render inside the existing frame `#project-workspace`, so the composer, the character and the fixers behave on a page exactly as they did on a section | project-composer.css:2-5, app.js:166-199 |
| D7 | `+ improvement` is one inline form with two submits: **start now** (ink, ↵) → `run.dispatch`; **up next** (seated) → `issue.create`. It never closes the view and never types into the composer | ROUND3 decided 4; code.md §2 |
| D8 | Anything that starts an agent run (start now, build it now, try again) waits for nibbi's reply, in words; nothing else does (up next, stop, merge, discard, play, opening pages all work while nibbi answers) | ROUND3 decided 4; app.js:2087 keeps daemon commands free |
| D9 | The builds card has **no** header `+` in phase 1 (`+ New build`, a copy, waits for phase 2); `+ improvement` lives inside main. Main has **no** caret: its body is always open | plan "Phase 1"; ROUND5 decided 1 with one build |
| D10 | The Scope tab strip, the section summaries and pills, Plans, the Issues kanban and the Builds lobby leave the UI. The data paths stay (daemon unchanged; `/plan`, `/goal`, `/review` chat commands unchanged). Repository & GitHub stays, from the project settings card | ROUND3 decided 1, 6; plan "Remove" |
| D11 | The lobby's review flow moves onto the ticket: play it, approve & merge (asks twice), discard (asks twice), verify, guide, stop, try again; its evidence (log, changes, checks, GitHub) moves into the ticket's try cards. The lobby's queue keys (j/k/a/x/p) and "Next build" go; `/review` in chat keeps them | the orchestrator; app.js:1401-1445 |
| D12 | A conversation's second line is the last thing said in it: one small daemon addition (`lastText`, §4.6) | the Cards design (bar-cards.mjs:37-38) |
| D13 | `#sidebar-progress` keeps `textContent === progressLine(progress)` exactly (sentence case as today): three suites pin it. Lowercasing it is a later one-line change | tests/narration-wiring.test.mjs:76,107,109; tests/margin-ui.test.mjs:16-33 |
| D14 | "remove it" on an up-next issue becomes **mark it done** (`issue.complete`): the daemon has no issue delete (project-workspace.ts:15). A queued run's is **cancel it** (`run.stop`) | never invent a command |
| D15 | Page keys are lowercase (`try again`, `approve & merge`), unlike the lab's capitalised ink keys | LANGUAGE §11, audit P14 |

---

## 2. Layout

### 2.1 The bar — Cards

Source: `options/bar-cards-shell.mjs` (DOM and behaviour) and `options/bar-cards-shell.css` (every
number). The CSS's header comment (bar-cards-shell.css:1-44) **is the geometry**: the grid (12 · 16 ·
24–40 icon column · 48 words' edge · 64 one step in · 207 right-hand edge · 207–239 trailing column; the
drawer 300 wide with 240/262), one row (two lines 13/18 over 11.5/16, 44 tall), one header (44), four
type roles, one key, the marks (rest nothing · hover `--veil-hover` · press `--veil-press` · current =
the row lifts: `--paper-raised` + hairline + `--e-seated` + `--e-highlight`), the spacing (2 row to row ·
4 card padding · 12 block to block · 16 one step), two line weights (`--veil-hairline` an edge,
`--veil-edge` the trunk). Port the numbers; rename the classes as below.

```
aside#workspace-sidebar.workspace-sidebar.cp-bar     role=complementary docked / dialog + aria-modal at ≤899px
│                                                    aria-label="Conversations, builds and settings"
├─ div.sidebar-head.cp-head                          nibbi ……………………… [⚙] [⊟]   (not a card)
│    span.sidebar-brand "nibbi"                      the logo on the icon column's edge (24)
│    span.cp-head-keys
│      nav#settings-rail.margin-rail.margin-settings.cp-settings-rail   aria-label="Settings" — MOVED here from the foot
│        button#status.cp-icon-key                   icon only; aria-label="Settings", title="settings — voice, sounds, glass, the model",
│                                                    aria-haspopup=dialog, aria-expanded; opens the Settings card
│      button.sidebar-collapse.cp-icon-key           aria-label="Close sidebar", title="put the bar away"
├─ nav#project-rail.margin-rail.margin-projects.cp-rail          aria-label="Projects"; a flex column: card 1, then the scroll
│  ├─ div.margin-switcher.cp-card.cp-project                     CARD 1 — the project
│  │    button.margin-project.margin-switch-trigger.cp-card-head [data-current-project] aria-haspopup aria-expanded
│  │       span.cp-glyph.cp-lead (empty icon slot) · span.margin-project-name.cp-title · span.margin-project-summary.cp-badge[data-tone]
│  │       (project.attention.text, '' when none) · span.project-caret.cp-trail (the caret, turns 180° without motion)
│  │    button.margin-rollup.cp-roll [hidden]                    "battalion needs you" / "2 others need you"; opens the list at the first that wants you
│  │    div.margin-switch-menu [hidden]                          the list as today: search, .margin-project-list >
│  │       .project-group > .project-heading-row > button.margin-project[data-project-id] + button.project-options (gear,
│  │       aria-label="Project settings for <name>"), .margin-empty, button.margin-project.margin-new ("new project")
│  └─ div.margin-body.cp-body                                    THE ONE SCROLL; each card's header is sticky inside it
│     ├─ section.cp-card.cp-group[data-cp-group="conversations"] aria-labelledby → its h2          CARD 2
│     │    div.cp-card-head.cp-group-head        [lead] h2.cp-label "conversations" · span.cp-badge ("answering", tone active,
│     │                                          pulses, while busy) · button.project-thread-new.cp-icon-key.cp-trail
│     │                                          (aria-label="New thread"; disabled + title "not while nibbi is answering" while busy)
│     │    div.project-threads.cp-rows           every conversation, home first, then most recent first
│     │      button.project-thread.cp-row.cp-two[data-thread-id="home"][data-thread-project]    home has no gear
│     │      div.project-thread-row.cp-rowwrap
│     │        button.project-thread.cp-row.cp-two[data-thread-id][data-thread-project][data-last-at]
│     │          span.cp-glyph (bubble) · span.cp-lines > span.cp-line-1 (span.cp-primary title)
│     │                                                   + span.cp-line-2 (span.cp-note lastText · span.project-thread-when.cp-word)
│     │        button.project-options.cp-trail   the thread's gear (rename / archive), on the trailing column; revealed on
│     │                                          hover, :focus-within, [aria-current] and (hover: none); 44×44 at coarse
│     └─ section.cp-card.cp-group[data-cp-group="builds"]                                            CARD 3
│          div.cp-card-head.cp-group-head        [lead] h2.cp-label "builds" · span.cp-badge[data-tone] (BuildVM.badge)
│                                                · no key in phase 1 (the trailing column stays empty)
│          div.cp-builds
│            div.cp-build[data-build="main"]
│              div.cp-rowwrap.cp-mainrow[.is-current]
│                button.cp-row.cp-two.cp-main[data-bar-build="main"]   trunk glyph (node filled) · "main" + "live" /
│                                                                       BuildVM.line's words + "playing" when play.running
│                button.cp-key.cp-play.cp-trail[data-cp-role="play-main"] ▶ alone; aria-pressed while playing;
│                                                                       aria-label "Play main"/"Stop main"; disabled + title = play.blocked
│              p.cp-why                          play.blocked words, when any
│              div.cp-build-body role=group aria-label="inside main"   one step in (16), on the trunk; always open
│                button.cp-row.cp-two.cp-improvement[data-bar-improvement][data-state]   (rows, §2.1.2)
│                button.cp-row.cp-fold[data-cp-fold="up_next"|"failed"][aria-expanded]   "3 more up next" / "14 failed"
│                p.cp-why.cp-empty                WORDS.emptyImprovements when there is nothing; WORDS.noList when the list failed
│                form.cp-form.cp-improvement-form[data-cp-role="improvement-form"] [hidden]   opens above the + row
│                button.cp-row.cp-add[data-cp-role="new-improvement"][aria-expanded]   + glyph in the inside icon column · "improvement"
│     └─ div.margin-foot.cp-foot                  the scroll's last item, sticky to its bottom; a 24px fade above it only while
│                                                 the cards run under it (bar-cards-shell.css:312-331)
│          p#sidebar-progress.margin-muted.sidebar-progress role=status   textContent === progressLine(progress) (D13); each
│                                                 fact a span, separators as real " · " text, a fact that does not fit drops whole
│          p.margin-muted.margin-link role=status [hidden]   the offline line, as today
│          p.margin-error.margin-global-error role=status [hidden]
├─ section.margin-card.margin-card-right          Settings, contents unchanged (#st-microphone … #st-demo, #st-platform, #st-model,
│                                                 #st-clear, the metadata); now TOP-anchored beside #status (bar-cards-shell.css:414-418),
│                                                 not bottom-anchored (margins.css:112, :123, :129 change)
└─ section.margin-card (the project settings card, built lazily per project, §2.1.4)
button#sidebar-toggle.sidebar-toggle > svg + span#sidebar-toggle-count.sidebar-toggle-count   outside the aside; says project.attention
button.sidebar-backdrop                                                                        ≤899px only
```

#### 2.1.1 Lab → production class map

| lab (bar-cards-shell) | production |
|---|---|
| `.s-bar` · `.s-head` · `.s-brand` · `.s-settings-rail` · `.s-settings` · `.s-collapse` | `#workspace-sidebar` · `.sidebar-head` · `.sidebar-brand` · `#settings-rail` · `#status` · `.sidebar-collapse` |
| `.s-switcher.c-card.c-project` · `.s-trigger.c-head` · `.c-title` · `.c-badge` · `.c-caret` · `.c-roll` · `.s-menu` | `.margin-switcher.cp-card.cp-project` · `.margin-switch-trigger.cp-card-head` · `.margin-project-name.cp-title` · `.margin-project-summary.cp-badge` · `.project-caret.cp-trail` · `.margin-rollup.cp-roll` · `.margin-switch-menu` |
| `.s-body` · `.t5-group.c-card` · `.t5-head.c-head` · `.c-label` | `.margin-body.cp-body` · `.cp-card.cp-group` · `.cp-card-head.cp-group-head` · `.cp-label` |
| `.s-plus` (conversations) · `.s-thread` | `.project-thread-new.cp-icon-key` · `.project-thread.cp-row.cp-two` (+ `.project-thread-row` for the gear) |
| `.c-glyph` · `.c-lead` · `.c-lines` · `.c-line-1` · `.c-line-2` · `.c-primary` · `.c-note` · `.c-word` | `.cp-glyph` · `.cp-lead` · `.cp-lines` · `.cp-line-1` · `.cp-line-2` · `.cp-primary` · `.cp-note` · `.cp-word[data-tone]` |
| `.t-mainrow` · `.t-main` · `.s-play-only` · `.t-body` · `.t-imp` · `.c-node` · `.t-fold` · `.s-add` | `.cp-rowwrap.cp-mainrow` · `.cp-row.cp-main` · `.cp-key.cp-play.cp-trail` · `.cp-build-body` · `.cp-row.cp-improvement` · `.cp-glyph.cp-node` · `.cp-row.cp-fold` · `.cp-row.cp-add` |
| `.s-form` · `.r3-form-label` · `.r3-form-field` · `.s-form-note` · `.s-primary` · `.s-cap` | `.cp-form` · `.cp-form-label` · `.cp-form-field` · `.cp-form-note` · `.cp-primary-key` · `.cp-cap` |
| `.s-foot.c-foot` · `.s-progress` · `.c-seg` · `.s-toggle` · `.s-backdrop` | `.margin-foot.cp-foot` · `#sidebar-progress.sidebar-progress` · `.cp-seg` · `#sidebar-toggle` · `.sidebar-backdrop` |
| `data-lab-role` / `data-lab-key` | `data-cp-role` / `data-cp-key` |

#### 2.1.2 Rows inside main

| row | line one | line two | notes |
|---|---|---|---|
| improvement | `title`, wraps to two lines, then clamps (`title` attribute has it all) | `when` as `${verb} ${ago(at)}` (or `context` when `when` is null) on the left · `word` on the right, `data-tone`, pulsing when `live` | glyph: the node (bar-cards-shell.mjs:195), filled when current |
| improvement, failed/interrupted | `title` | `word` floats right on the edge, `reason` wraps under it, 3 lines at most | bar-cards-shell.css:297-301 |
| fold | "14 failed" (`data-tone="error"` when any is failed) / "3 more up next" | — | a caret glyph; expands inline (`aria-expanded`); remembered per project for the session; "show fewer" folds back |
| + improvement | "improvement" in `--ink-2` | — | `aria-expanded` while its form is open |

What shows, from `BuildVM.improvements` (already ordered) with `BAR_LIMITS`: every waiting and building
row; up next up to 3, then a fold; `in` rows that landed in the last day, at most 3; failed + interrupted
all shown when ≤ 2, else one fold row and none until it is opened. **The row whose ticket is open always
shows** — inside a fold, or, for a settled state, at the end of main's body — so exactly one row is
marked.

The form (lab `inlineForm` dressed as bar-cards-shell.mjs:385-399): a top line with the label
`WORDS.form.label` and a × (close, `title="close (esc)"`); a two-row textarea (`maxLength` 1000,
placeholder `WORDS.form.placeholder`); a `role=status` note; the keys **start now** (`.cp-primary-key`,
ink, the `↵` cap, `aria-keyshortcuts="Enter"`) and **up next** (seated `.cp-key`); the hint
`WORDS.form.hint` under them. Enter submits start now; Shift+Enter is a newline. `BuildVM.blocked.start`
or `.queue` non-empty → that key is disabled with the words as its `title`, and pressing Enter shows them
in the note. On send: the key holds `aria-busy`, the text stays; success closes the form, clears it and
puts focus back on `+ improvement`; failure keeps the text and says the error in the note. Only one form
is open; Escape closes it (§6.4).

#### 2.1.3 States of the bar

| moment | the bar says |
|---|---|
| projects loading / unreachable / none | as today inside `.margin-body` (`emptyLine`, `.margin-empty-retry`, `.margin-empty-new` "new project"); cards 2–3 hidden |
| nibbi answering | conversations badge "answering" (pulses); its `+` disabled; start now disabled with `WORDS.busy`; everything else live |
| demo | start now / up next disabled with `WORDS.demoStart` / `WORDS.demoChange`; ▶ with `WORDS.demoPlay` |
| issues.md unreadable | no up-next issue rows; `WORDS.noList` as a `.cp-why` line in main's body; queued runs still listed |
| nothing to improve | `WORDS.emptyImprovements` and the `+ improvement` row |
| collapsed | `#sidebar-toggle` alone, `#sidebar-toggle-count` = `project.attention.text` with its tone |
| ≤899px | the same bar as a 300px drawer (`--sidebar-width-narrow`); a row that opens a page or a conversation puts the drawer away first (bar-cards-shell.mjs:350-353) |

Keys (bar-cards-shell.mjs:1005-1037): inside the builds card, ArrowUp/ArrowDown/Home/End move between
rows, ArrowLeft from an improvement goes to main's row. Never a printable key (type-to-talk owns them).
Focus survives `update()`: rows are keyed and reused while their signature is unchanged (the lab's
`keep`/`patch`, bar-cards-shell.mjs:332-347), and a focused row, gear, fold or field is never replaced.

#### 2.1.4 The project settings card (the gear)

Unchanged except: the plan progress label, meter and the "pending" stat go (margin-ui.js:323-327,
689-698); the pills **Plan · Play · Fix… · Review** go (margin-ui.js:361); **Repository & GitHub** and
**Providers** stay, labels unchanged. Under the Automation segment, one quiet line (ROUND3 decided 8):
`automation picks its next step from plans/<name>.md`. The stats line becomes `<spend> spent · <cap>`.

#### 2.1.5 Premium baseline (every bar control)

ROUND3 decided 10, as written, on existing tokens: a press state on every control; colour transitions
on `--t1 var(--ease)` for background, colour and box-shadow; secondary keys seated or quiet (the
trailing-column keys have nothing at rest, bar-cards-shell.css:233-244); labels 13px/400 in rows, no
weight change on selection; 16px glyphs (the head's two keys too); the one primary scales `.96`
pressed; stable-width labels (every face of a changing label in one grid cell).

### 2.2 The pages — Console

Source: `options/tree-console.mjs` `renderPage` + `options/tree-console.css` + `pages5.mjs/.css` +
`rules5.mjs`. Port the look (tree-console.css is the stylesheet to start from, renamed `tc-` → `cp-`,
scoped under `.cp-page`); feed it real data (§4). Pages render into a host element inside
`#project-workspace` (the fixed frame, project-workspace.css:3-6), under the character's header pose.

#### 2.2.1 The ticket page (an improvement)

```
div.cp-page.cp-ticket[data-cp-page="ticket"][data-cp-id="<ImprovementId>"][data-state]      aria-busy while evidence loads
├─ header.project-workspace-head.cp-page-head
│    div.cp-title
│      p.cp-kicker  WORDS.ticketKicker + button.cp-crumb[data-cp-key="crumb"] (trunk glyph · "main") → openBuild
│      h1[tabindex=-1]  title            (or, editing: form.cp-edit — title input + description textarea + "save the words" + "cancel")
│    button.project-close[data-cp-key="close"]  "×", aria-label WORDS.keys.close, title "back to the conversation (esc)" → backToChat
└─ div.project-workspace-body.cp-page-body[tabindex=0][role=region]
   ├─ div.project-notice.cp-notice[role=status][data-kind] [hidden]    "merged into main." · errors (data-kind="error")
   ├─ section.cp-status[data-status="<state>"]      THE BIG STATUS (tree-console.mjs:230-307)
   │    dot + the state word at --type-display (pulses when live) · statusLine (in --fail-quiet when failed)
   │    div.cp-actions: TicketVM.actions in order (at most one ink); a blocked key is disabled, `title` = its words, and
   │      its words show once under the keys as a quiet line
   │    div.cp-confirm[role=group] [hidden]         the ask-twice strip under the keys: ConfirmVM.words · no · yes (armed → `.armed`)
   │    form.cp-steer [hidden]                      guide it: one field + "send it"
   │    dl.cp-facts                                 FactVM[]: build (crumb) · asked · tries · time · changes · checks
   ├─ section.cp-section.cp-work   h2 "the work" + meta ("2 tries · last failed 1h ago")
   │    ol.cp-runlog > li > article.cp-try[data-cp-run="<runId>"][data-status="<attempt state>"]
   │       head: dot · "try N" · word · meta (started · ran · $ · sha mono · branch → target); an earlier try is a toggle
   │             (aria-expanded) and folds to its head + one line (reason or summary)
   │       body (open for the latest): summary (renderMarkdown) · div.cp-try-grid [ steps (StepVM, the rail) | checks (CheckVM) ] ·
   │             div.cp-evidence: div.project-evidence-tabs (log · changes · github when in AttemptVM.tabs; tab counts) +
   │             div.project-evidence-panel (the log as a terminal on --ink-terminal; the changes via renderDiff; the GitHub panel)
   │    no tries: li.cp-try-empty "no tries yet" + "build it now starts try 1 on main — its log and changes appear here as it goes."
   ├─ section.cp-section.cp-asked  h2 "what you asked"  asked.text (+ asked.description, markdown) · asked.context as
   │    "nibbi’s notes for it" when present · the GitHub issue links (a[target=_blank][rel="noopener noreferrer"], label
   │    "GitHub issue · owner/repo #7")
   └─ div.cp-talk  quiet foot: "ask nibbi about it" (talkAbout) when it is not already a key
```

"what nibbi understood" (the lab) becomes **what you asked**: real runs carry the request and the
lead's context, not a plan (§9.6).

#### 2.2.2 The build page (main)

```
div.cp-page.cp-build[data-cp-page="build"][data-cp-id="main"]
├─ header.project-workspace-head.cp-page-head
│    div.cp-title  p.cp-kicker (trunk glyph · WORDS.mainKicker) · h1[tabindex=-1] "main" · p.cp-copyline BuildVM.line
│    (no Ship in phase 1) · button.project-close (as the ticket)
└─ div.project-workspace-body.cp-page-body
   ├─ div.project-notice.cp-notice [hidden]
   ├─ section.cp-preview[data-playing]                 (tree-console.mjs:527-564)
   │    bar: dot · url (mono, when running) · "playing" / "not running"
   │    stage: "play main" (ink when nothing else on the page is) | "main is playing" + "since 12:20 · 40m so far" +
   │           "open it" + "stop playing" | "this one can’t be played" + play.blocked
   │    foot: play.note ("plays your checkout · on codex/tighter-chat-spacing") · play.lastCommit
   ├─ dl.cp-tiles (3)   waiting on you — counts.waiting, sub "1 ready to review · 1 needs you" |
   │                    checks — check.command (mono) or "none set", sub "every improvement is checked before it lands" /
   │                            WORDS.noCheck (in ink: no verdict has happened) |
   │                    landed this week — the count of `in` with `at` in 7 days, sub "last 2h ago"; + a quiet
   │                            "repository & github" link (action repository) when BuildVM.github is non-null
   ├─ section.cp-section.cp-improvements   h2 "improvements" + meta count; tools: "+ improvement" (seated, aria-expanded)
   │    form.cp-add [hidden]   textarea + "start now" (ink) + "up next" + "cancel", the WORDS.form.hint under it
   │    div.cp-imps > div.cp-imp-group[role=group] per GROUPS entry with rows: p.cp-imp-group-title "ready to review · 1"
   │       button.cp-imp[data-cp-key="imp-<id>"][data-state]   dot · title + sub (context / when) · word · chevron → openImprovement
   │       the failed group shows PAGE_LIMITS.failedShown rows, then "N more" (expands inline)
   │    empty: p.cp-imps-empty WORDS.emptyImprovements
   └─ section.cp-section.cp-history   h2 "landed in main"   ol.cp-timeline: every `in` (≤ 20, newest first): time ·
        dot · "landed" + the title (a link → openImprovement) + sha (mono) + files · then settled ones in quiet ink
```

No Ship, no retire, no "copies of main" in phase 1.

#### 2.2.3 Page rules

- **One ink key per page.** The ticket: the first `ActionVM` with `tone: 'ink'`. The build page: "play
  main" when not playing and not blocked, else the build page's form submit while open, else none.
- **Asks twice** (merge, discard, stop): the first press opens `.cp-confirm` under the keys with focus on
  its "no" key; only its yes sends. Escape or "no" closes it and focus returns to the first key. Nothing is
  sent on the first press (tools/control-panel-verify.mjs checks the network).
- **Stable under updates.** `update()` re-renders in place and keeps: the focused control (by
  `data-cp-key`), the scroll, an open form's text, an armed confirm, which tries are open, each try's
  selected tab, and — the lobby's hard-won property — an evidence panel that is showing a loaded log or
  diff is **the same node** across updates (project-workspace.js:83-87, 402-460), so a selection, an open
  log entry and the live tail survive a record refresh.
- **Live log.** `noteRunEvent(event)` appends `eventToLogEntry(event)` (transcript.js) to every open,
  loaded Log of `event.runId`, on screen or not, without rebuilding the list (project-workspace.js:756-777).
- **Gone.** `TicketVM.gone` → the head says `WORDS.gone`, the body one quiet line, only × remains.
- **Narrow (≤640px).** tree-console.css:363-412, keyed off `@media (max-width: 640px)` instead of
  `.tc-narrow`: keys full width, tiles become one card of rows, the facts two per line, the log wraps by
  the character. Every key 44px there and at `(pointer: coarse)`.
- **Reduced motion.** No animation under `prefers-reduced-motion` or `body.calm` (the global kill switch,
  styles.css, covers the rest).

### 2.3 What is removed

| what | where |
|---|---|
| the Scope tab strip (`nav.margin-tabs`, `.margin-tab[data-margin-tab]`, `.project-section[data-project-section][data-section-project]`, `.project-section-badge`) | margin-ui.js:244-245, 457-500; margins.css tab rules |
| the section bodies and their pills (`.margin-section`, Review / Repository & GitHub / Plan), `waitingLine`'s "· N pending" | margin-ui.js:639-670 |
| the "New thread" row (it becomes the conversations header `+`, keeping `.project-thread-new`) | margin-ui.js:546-549 |
| the foot's Settings glyph row (`.margin-glyph`, `.margin-glyph-label`) | margin-ui.js:286-292; margins.css:105-110 |
| the card's plan meter, "pending" stat, Plan / Play / Fix… / Review pills | margin-ui.js:323-327, 361-366, 689-698 |
| the Builds lobby (queue, stage, rail, filters, big Play slab, CTA, keys) | project-workspace.js:29-37, 402-601, 699-722 |
| the Issues kanban (columns, drag, search, filters, New issue, Add to plan) | project-workspace.js:6-7, 253-360 |
| Plans (milestones, tasks, reorder, Add milestone, Discuss plan) | project-workspace.js:258-273, 602-673 |
| `/api/milestones` polling for the bar | app.js:1896-1908, 1950-1956 |
| the composer-prefill project actions `newBuild`, `newIssue`, `newPlan`, `editPlan`, and the dead `buildChanges` / `buildLog` | app.js:2089, 2111-2120 |

The daemon keeps everything (plans/<p>.md, milestones, `task.*`, `issue.plan`, `/api/milestones`): the
scheduler, `/plan`, `/goal` and the lead's `read_roadmap` still read the roadmap (code.md §3C).

### 2.4 Where each pinned id goes

| id | phase 1 |
|---|---|
| `#workspace-sidebar` | the same aside; gains `.cp-bar` |
| `#sidebar-toggle` (+ `#sidebar-toggle-count`) | unchanged; the count says `project.attention` |
| `#project-rail` | the same nav, inside the aside: card 1, then `.margin-body` (cards 2–3 and the foot) |
| `#settings-rail` | **moves** from the foot into `.sidebar-head`, wrapping `#status` alone, immediately left of `.sidebar-collapse` |
| `#status` | the Settings key, icon only, in `#settings-rail`; still opens the Settings card; `aria-label="Settings"` |
| `#sidebar-progress` | the foot, last in the scroll |
| `#feed` `#pill` `#ask` `#send` `#toast` | unchanged; on a page `body.project-view` hides the feed, chips and pill and inerts the pill, as for sections |
| `#project-workspace` | the main-area frame: hosts the Console pages (a `div.cp-page-host`) and, separately, the Repository & GitHub panel (its own head, `h1#project-workspace-title`, body) |

Also kept, because tools drive them: `.margin-switch-trigger[data-current-project]`, `.margin-switch-menu`,
`.project-group`, `.margin-project[data-project-id]`, `.project-options` (and its "Project settings for
<name>" label), `.margin-card[role=dialog]`, `.margin-card-right`, `.margin-close`, `.margin-new`,
`#st-*`, `.margin-body`, `.margin-foot`, `.margin-empty`, `.margin-empty-new`, `.margin-empty-retry`,
`.margin-rollup`, `.project-thread-new`, `.project-thread`, `.project-thread-row`, `[data-thread-id]`,
`[data-thread-project]`, `.project-thread-when`, `.sidebar-collapse`, `.sidebar-backdrop`,
`.sidebar-toggle-count`, `.project-close`, `.project-workspace-body`, `.project-notice`.

---

## 3. View models

`public/lib/control-panel-contract.js` holds them as JSDoc typedefs and the fixed data as frozen
constants: `STATES`, `STATE_WORDS`, `STATE_TONES`, `LIVE_STATES`, `GROUPS`, `SETTLED`, `RUN_STATES`,
`GITHUB_STAGED`, `BADGE`, `ATTENTION_TONES`, `BAR_LIMITS`, `PAGE_LIMITS`, `ACTIONS`, `BAR_ACTIONS`,
`PAGE_ACTIONS`, `WAITS_FOR_REPLY`, `REFUSED_IN_DEMO`, `WORDS`, `ATTR`, `PINNED_IDS`, `ID_PREFIX`,
`MAIN`. Typedefs: `PageRef`, `ImprovementVM`, `PlayVM`, `BuildVM`, `ConversationVM`, `BarProjectVM`,
`BarModel`, `StepVM`, `CheckVM`, `FilesVM`, `GithubVM`, `AttemptVM`, `ConfirmVM`, `ActionVM`, `FactVM`,
`TicketVM`, `PagesModel`, `ActionPayloads`, `CpInput`.

### 3.1 The model's API (builds-model.js — every function pure; `now` is passed in)

```js
export function buildMain(input /* CpInput */) /* → BuildVM */
export function ticketOf(input /* CpInput */, id /* ImprovementId */) /* → TicketVM (gone: true when it no longer exists) */
export function improvementIdForRun(runs, issues /* items | null */, runId) /* → ImprovementId | null */
export function mergeRuns(liveRuns, sectionRuns /* | null */) /* → Run[] (§3.3) */
export function conversationsFor(threads, { activeId, liveText }) /* → ConversationVM[] */
export function previewText(text) /* → string: the §4.6 rule */
export function splitImprovementText(text) /* → { title, description } */
export function parseDiffstat(diffstat) /* → FilesVM */
```

### 3.2 Inputs (all already in the client, or one read away — §8.2)

| input | source today | file:line |
|---|---|---|
| live runs | `S.fixers` from `/api/snapshot`, upserted on `run.updated` | read-models.ts:20; app.js:2154, 1289-1293 |
| runs with `allowedActions`, `preview`, `currentActivity` | the builds section read | project-workspace.ts:32, 49-54; project-data.js:33-37 |
| issue items (`id, text, description, heading, done, boardStatus, issueIds, githubIssueLinks, linkedBuilds`) + `revision` | the issues section read | project-workspace.ts:55-70 |
| project `branch`, `lastCommit`, `check`, `targetBranch`, `github` connection | `/api/projects` | read-models.ts:21-28 |
| play status | `GET /api/play?project=` | api.ts:185; previews.ts:50-55 |
| maxConcurrent | `S.auto[project].maxConcurrent` (default 2) | fixer.ts:53, 192; read-models.ts:17-19 |
| busy, demo | `S.busy`, `S.demo` | app.js:58-66 |

### 3.3 Merging live and read runs

By id. The live record wins for `status`, `endedAt`, `summary`, `verification`, `commitSha`, `diffstat`,
`github`. `allowedActions`, `preview` and `currentActivity` come from the section read **only while its
status equals the live status**; otherwise they are `null` (not known yet), and every key that needs
them is disabled with `WORDS.reading` until the section refresh lands (≤ 400ms after the event,
app.js:2130-2140). A run only in the read (the snapshot is older) is kept as read.

---

## 4. The mapping from today's data

### 4.1 A run → the state of its try

`RUN_STATES` (contract), from `RunStatusSchema` (shared/src/index.ts:8) and the legacy `done`
(fixer.ts:67):

| run.status | set at | try state | word | group |
|---|---|---|---|---|
| queued | fixer.ts:177 (queueFix); a GitHub base retry, :269 | up_next | up next | up_next |
| installing | fixer.ts:193 | building | building (pulse) | building |
| running | fixer.ts:240 | building | building | building |
| verifying | fixer.ts:249 | building | building | building |
| awaiting_input | no daemon producer yet (tools/attention-verify.mjs:74 writes one) | needs_you | needs you | waiting |
| staged (and `done`) | fixer.ts:265 | ready — or GitHub, §4.2 | ready to review | waiting |
| merged | fixer.ts:352 (local), :309 (recovered) · the GitHub completion | in | in (pass) | in |
| failed | fixer.ts:271; runBuildAttempt :140 | failed | failed (error) | failed |
| interrupted | fixer.ts:305 (reconcile), :271 on shutdown | interrupted | interrupted (ink) | failed |
| cancelled | fixer.ts:280 (queued), :271 (aborted) | stopped | stopped | settled |
| discarded | fixer.ts:290 | discarded | discarded | settled |
| superseded | fixer.ts:295, 300 (a retry replaced it) | — (an earlier try) | — | — |

The steps a try shows (`StepVM`, no step data exists — §9.6): install · do the work · run the checks ·
stage it for review. queued → all waiting; installing → install running; running → install done, work
running; verifying → check running; staged/merged → all done; failed with `verification.status ===
'failed'` → check failed; failed otherwise → work failed (its `reason` says what); interrupted/cancelled
→ the step that was running when it stopped is unknown, so the last done step stays done and the rest
waiting. The checks (`CheckVM`): the project check `{ name: verification.command || 'the project check',
ok: passed→true / failed→false / else null, note: first line of verification.detail }`; GitHub mode adds
`{ name: 'github checks', ok: status==='passed'|'failed'|null, note: blockers[0] }`.

### 4.2 GitHub mode (run.github, github-builds.ts:155-190)

| condition | state | statusLine |
|---|---|---|
| staged, `needsAttention` or `remoteChanged` | needs_attention | `github.notice` or "pull request #12 needs a look — <blockers[0]>" |
| staged, `readyPR` | pr_ready | "pull request #12 is ready to merge — it merges on GitHub" |
| staged, `pullRequest` (open) | pull_request | "pull request #12 is open — it merges on GitHub" |
| staged, `toPush` | to_push | "checks passed here — push it to open a pull request" |
| staged, none | ready | "pushed — open a pull request from its github steps" |
| merged, `delivery === 'merged'` | in | "merged into <baseBranch> via pull request #12" |
| merged, `mode: 'local'`, `delivery: 'local_merge_unpublished'` (a GitHub project merged here, github-builds.ts:159) | in | "merged here — not on GitHub yet" (and the build page's checks tile says "1 merged here, not on GitHub yet") |

`run.merge` is never offered in GitHub mode (fixer.ts:156), so these tickets have no approve & merge:
their one ink key is **the github steps**, which selects the try's GitHub tab (createGithubPanel,
github-ui.js). `GithubVM` carries `delivery`, `prNumber`, `prUrl`, `draft`, the flags, `checks`,
`notice`, `baseBranch`.

### 4.3 An issue → its improvement

Items from `issueDocument` (project-issues.ts:6-14): `- [ ] text <!-- nibbi-issue:ID -->`, optional
`<!-- nibbi-status:in-progress -->` (project-workspace.ts:114-119). Tries = runs whose `issueIds`
include the id (project-workspace.ts:65), oldest first.

| issue | its latest try | state |
|---|---|---|
| open | none | up_next ("it waits here until you start it"; marked in-progress sorts first in up next, context "you marked it in progress") |
| open | queued · building · needs_you · ready (and GitHub states) · failed · interrupted | the try's state |
| open | stopped or discarded | up_next (context "its last try was stopped" / "…discarded") |
| open | merged (the completion write failed, fixer.ts:353) | in |
| done (`[x]`) | a merged try | in (merged runs complete their issues: fixer.ts:353 → project-issues.ts:24-37) |
| done | no merged try | done (settled: "marked done in issues.md") |

A run whose `issueIds` name several issues is a try in each of their tickets. A run whose issue is no
longer in issues.md, or has no `issueIds` (free text, plan-mode steps, task builds), belongs to a
run-kind improvement.

### 4.4 A run-kind improvement

Its id is `run:<root>`, the root being the oldest run reached by following `replacesBuildId`
(fixer.ts:295, 300) through runs that still exist. Its tries are the chain, oldest first; its title the
root's `title` (queueFix: `opts.title || issue.slice(0,50)`, fixer.ts:178); its state the latest try's
(`RUN_STATES`, stopped and discarded stay stopped/discarded). `improvementIdForRun(runs, issues, runId)`:
the first of the run's `issueIds` present in `issues` (or simply the first, when `issues` is null) →
`issue:<id>`, else `run:<root>`. A `ticketOf(input, 'issue:X')` whose X is gone but runs name it renders
from those runs, context "its note is gone from issues.md".

### 4.5 Per state: line two, the status line, the keys

`when.verb`: up_next (queued) "queued" · building "started" · needs_you "asked you" · ready "staged" ·
in "landed" · failed "failed" · interrupted "stopped" · stopped "stopped" · discarded "discarded";
issue up_next with no try: `when` null, `context` = its heading or the first line of its description.

| state | statusLine (TicketVM) | keys, in order (ink marked ★) |
|---|---|---|
| up_next, issue, no live try | "it waits here until you start it — nothing builds it on its own" | edit the words (form) · mark it done · ★ build it now |
| up_next, queued run | "queued — it starts when one of the {maxConcurrent} slots frees" | cancel it (`stopRun`, no confirm: nothing ran) |
| building | activity (or "installing" / "doing the work" / "running the checks") + " · 4m in · try 2" | guide it (form; only with `run.steer` allowed) · stop (confirm) |
| needs_you | "it stopped to ask you something — guide it, or stop it" | ★ guide it (form) · stop (confirm) |
| ready, local | checks passed: "checks passed on a1b2c3d — play it, then merge it or discard it" ("— merge it or discard it" when the try has nothing to play); else "not verified — verify it before it can merge" | ★ play it (when `preview.start`/`preview.stop` allowed; running: open it + stop playing) · approve & merge (confirm; ★ when not previewable; blocked words per §5.2) · discard (confirm, armed) · verify it (when `run.verify` allowed and not passed) |
| to_push · pull_request · pr_ready · needs_attention | §4.2 | ★ the github steps · discard (confirm, armed; when allowed) |
| in | "in main since 2h · landed with try 2" (§4.2 in GitHub mode) | see its changes (selects the changes tab) |
| failed | the reason (first line of the run's summary) + " — main is unchanged" | ask nibbi about it · ★ try again |
| interrupted | "the backend stopped mid-run — its work is kept; try again when you’re ready" | ask nibbi about it · ★ try again |
| stopped | "you stopped it — main is unchanged" | ★ try again |
| discarded | "you discarded it — its branch and worktree are kept" | ★ try again |
| done | "marked done in issues.md" | reopen it |

Facts: build (the crumb) · asked (the first try's start, or "from issues.md") · tries · time (the sum of
the tries' durations; live "running 4m") · changes (`FilesVM` of the latest: "3 files · +67 −9") ·
checks (the latest's verification word; GitHub checks status).

### 4.6 A conversation's second line

The client lacks it: `/api/threads` returns `{ id, project, title, lastAt, count, archived }`
(threads.ts:9, 23-35). The smallest daemon addition (integrator, §8.3):

- `Thread` gains `lastText?: string`; `ThreadSummary` gains `lastText: string | null`.
- `touchThread(id, at, firstUserText?, store = runtime(), lastText?)` stores `previewText(lastText)`
  on the record, and `save()` (threads.ts:74-78) puts `lastText` in the `thread.updated` payload.
  `logChat` (history.ts:13) passes `entry.text` as the fifth argument, both roles.
- `listThreads` fills home's `lastText` with one query — the newest `messages` row with `thread_id IS
  NULL` in the project's scope (as `homeSummary`, threads.ts:16-21) — and each thread's from its record.
- `previewText`: drop `»voice:` / `»acts:` lines, a fenced block becomes "…", drop `# * _ > \``, collapse
  whitespace, trim, at most 120 characters. The same rule in builds-model.js (`previewText`) for text the
  client already has.
- **It needs a test**: daemon/test/threads.test.ts — home's and a thread's `lastText` from the last
  message of either role, cleaned and bounded; the `thread.updated` payload carries it (update the exact
  `deepEqual` at threads.test.ts:102).

On the client: `mergeThread` (app.js:603-614) copies `lastText`; for the open conversation the model
prefers the last settled turn the client holds (`liveText`); home with nothing said shows
`WORDS.homeLine`; a new thread with nothing said shows nothing. Home of a project you are not in stays
as last read (no home event exists) — accepted.

---

## 5. Actions

### 5.1 Every name, its payload, what it calls

The bar and the pages call `onAction(name, projectId, value)`. The integrator writes
`handleControlPanelAction(name, project, value)` in app.js; margin-ui's names reach it through
`handleMarginAction`, the pages' directly. Existing calls are reused, never duplicated.

| action | sent by | value | calls | while nibbi answers | demo |
|---|---|---|---|---|---|
| openBuild | main row; a ticket's crumb | `'main'` | `openProjectPage(project, 'build', 'main')` | yes | yes |
| openImprovement | an improvement row (bar, build page, history) | ImprovementId | `openProjectPage(project, 'ticket', id)` | yes | yes |
| backToChat | a page's ×; the bar's Escape while a page is open | — | `closeProjectView(true)` (app.js:2062-2066) | yes | yes |
| thread | a conversation row | thread id | existing (app.js:2020-2023); `openThread` leaves any page (app.js:735) | refused for another thread: `busyNotice()` "nibbi is answering in “…” — switch when it’s done" | yes |
| newThread | conversations `+` | — | existing (app.js:2024-2027) | refused: `busyNotice()` | yes |
| startImprovement | the bar's form; the build page's form | `{ text }` | `handleProjectAction('buildCommand', project, { command: 'run.dispatch', args: { issue: text, title: first line ≤ 80 } })` → `api.command('run.dispatch', …)` (app.js:2105-2110; command-service.ts:32-36) | **refused: `WORDS.busy`** | refused: `WORDS.demoStart` |
| queueImprovement | the same forms | `{ text }` | `splitImprovementText(text)` → `handleProjectAction('projectCommand', project, { action: 'issue.create', title, description, expectedRevision: issues.revision })` (project-workspace.ts:157-160); on `REVISION_CONFLICT` re-read issues and retry once | yes | refused: `WORDS.demoChange` |
| playMain | main's ▶; the build page | `{ action: 'start'\|'stop'\|'open' }` | `playProject(project, action)`: the body of `playFlow` (app.js:1506-1534) without its chat turn — `POST /api/play` then poll `GET /api/play?project=` every 1200ms for ≤ 60s, `openUrl(url)`; then refresh `S.playable` / `S.cp` play for the project. `open` → `openUrl(play.url)` | yes | refused: `WORDS.demoPlay` |
| buildIssue | an up-next issue ticket: build it now | `{ issueId }` | `projectCommand` `issue.build` `{ id, expectedRevision }` (project-workspace.ts:185-196; duplicate-safe :190) | **refused: `WORDS.busy`** | refused |
| editImprovement | issue ticket: edit the words → save the words | `{ issueId, title, description }` | `projectCommand` `issue.edit` (project-workspace.ts:161, 107-128); a conflict keeps the words: "the list changed — your words are still here; save again" | yes | refused |
| completeImprovement | issue ticket: mark it done | `{ issueId }` | `projectCommand` `issue.complete`; conflict → re-read, retry once | yes | refused |
| reopenImprovement | done ticket: reopen it | `{ issueId }` | `projectCommand` `issue.reopen`; conflict → re-read, retry once | yes | refused |
| stopRun | building / needs you: stop (confirm); queued: cancel it | `{ runId }` | `buildCommand` `run.stop` (fixer.ts:276-282) | yes | refused |
| steerRun | guide it → send it | `{ runId, text }` | `buildCommand` `run.steer` `{ text }` (fixer.ts:283) | yes | refused |
| retryRun | failed / interrupted / stopped / discarded: try again | `{ runId }` (the latest try) | `buildCommand` `run.retry` (fixer.ts:292-302) | **refused: `WORDS.busy`** | refused |
| verifyRun | ready / failed: verify it | `{ runId }` | `buildCommand` `run.verify` (fixer.ts:362-381) | yes | refused |
| mergeRun | ready (local): approve & merge → confirm merge | `{ runId }` | `buildCommand` `run.merge` (fixer.ts:382, integrate :327-360); success notice "merged into main." | yes | refused |
| discardRun | ready / GitHub states: discard → confirm discard | `{ runId }` | `buildCommand` `run.discard` (fixer.ts:290) | yes | refused |
| previewRun | ready: play it · open it · stop playing | `{ runId, action }` | the lobby's `playtest` / `openPlaytest` / stop (project-workspace.js:478-515) moved into app.js: `preview.start` → poll `previewStatus` ≤ 20 × 500ms → `openUrl`; `preview.stop` → poll until stopped | yes | refused (start/stop) |
| buildEvidence | a try's tabs | `{ id, kind, attemptId? }` | existing `handleProjectAction('buildEvidence')` (app.js:2078-2083) → `/api/fixer-diff`, `/api/fixer-log` | yes | yes |
| githubRead · githubCommand · githubRefresh | the GitHub panel inside a try | as today | existing (app.js:2068-2077, 2092-2098) | as today | as today |
| talkAbout | failed ticket; any ticket's foot | `{ improvementId }` | `closeProjectView(false)`; composer empty → `ask.value = 'about “<title>”: '`, `focusComposer()`, `autosize()`; a draft there → keep it, focus it, toast "Your draft is still here…" (the rule at app.js:2119) | yes | yes |
| refresh | a GitHub panel's `onChanged`; a page's "try again" on a failed read | — | `refreshControlPanel(project)` (§8.2) | yes | yes |
| repository | the project settings card pill | — | `openProjectPage(project, 'repository')` (app.js:1984) | yes | yes |

Gone from the bar: `projectSection`, `fix`, `plan`, `play`, `review` (margin-ui.js:361, 479, 651).
`handleMarginAction`'s busy list (app.js:1978) becomes `newProject, autoMode, spendCap`.

### 5.2 Blocked words, computed by the model

| key | blocked when | words |
|---|---|---|
| start now, build it now, try again | `busy` | `WORDS.busy` |
| any `REFUSED_IN_DEMO` action | `demo` | `WORDS.demoStart` (starts) · `WORDS.demoPlay` (play) · `WORDS.demoChange` (the rest) |
| up next, edit, mark it done, reopen | the issues read is not `ready` | `WORDS.noList` |
| approve & merge | `allowedActions` null | `WORDS.reading` |
| | `check.real` false | `WORDS.noCheck` |
| | verification not passed | `WORDS.unverified` |
| | otherwise without `run.merge` | `WORDS.cantMerge` |
| play main / ▶ | `play.playable` false | `WORDS.noPlay` |
| guide it, verify it, play it, discard | the action is not in `allowedActions` | the key is not drawn (null → drawn disabled with `WORDS.reading`) |

The app still throws its own notices as a backstop (app.js:2089-2090); the UI never relies on the throw.

---

## 6. Routing

### 6.1 The state

`S.projectView = null | { project, page: 'build' | 'ticket' | 'repository', id }`. `null` is the chat.
`margins.update({ …, view: S.projectView })`; `projectPages.open/update({ page: S.projectView, … })`.

### 6.2 Opening and closing

`openProjectPage(project, page, id, { focus = true, evidence } = {})` replaces `openProjectSection`
(app.js:2048-2061) and keeps its body: select the project, `margins.close()` (which also puts the
drawer away at ≤899px), set `S.projectView`, `body.project-view`, `closeDock(false)`, `hideChips()`,
hide the palette, open the frame, `watchProjectSummaries()`, `syncMargins()`, `layout(S.mode !==
'talk')` (the hero snaps to its header pose from idle). Then `refreshControlPanel(project)` so the page's
`allowedActions` are fresh. `page: 'repository'` opens the repository panel as today;
`'build' | 'ticket'` show the page host and call `projectPages.open(model, { focus })`.
`closeProjectView(focus)` is unchanged plus `projectPages.close()`.

| from | goes to |
|---|---|
| main's row | the build page |
| an improvement row (bar or build page) | its ticket |
| a ticket's crumb | the build page |
| a conversation row | chat, that conversation (`openThread` closes the page first, app.js:735) |
| × on a page | chat, focus on `#ask` |
| Escape (§6.4) | chat |
| the project settings card: Repository & GitHub | the repository panel |
| a run notification (app.js:1251), the "open build" chip (app.js:900, relabelled **open it**), "Review GitHub delivery" (app.js:894) | the run's ticket (`improvementIdForRun`), the last with `evidence: 'github'` |
| choosing another project while a page is open | build page → the other project's build page; ticket → chat in the other project; repository → the other project's repository |
| the page's project disappears | chat (renderProject, app.js:1947) |
| the page's improvement disappears | the page stays and says `WORDS.gone` |

### 6.3 Focus

Opened from the docked bar: focus stays on the bar row (it is a control panel: click down the rows and
read). Opened from the drawer, a notification, a chip or a page: focus moves to the page's `h1`
(tabindex -1), as sections did (project-workspace.js:750). Closed: `#ask` (focusComposer).

### 6.4 Escape, in order

margin-ui listens on `document` in the capture phase (margin-ui.js:776), so it runs first whatever has
focus: it may take Escape for a card, the menu or the drawer from anywhere (as today), and for its own
form or the page only while focus is inside `#workspace-sidebar`.

1. an open card (Settings, project settings, a thread's) — margin-ui, as today (margin-ui.js:755);
2. the project list — margin-ui (margin-ui.js:756);
3. the bar's open form — margin-ui;
4. on a page: its own open thing — an armed confirm, the edit form, the guide form, the build page's
   form, an expanded fold — project-pages, with `preventDefault()` + `stopPropagation()`;
5. at ≤899px with the drawer open — close the drawer (margin-ui.js:761-763);
6. a page is open — back to chat: from inside the frame by project-workspace.js's handler
   (:694-698, it skips a `defaultPrevented` event), from the docked bar by margin-ui dispatching
   `backToChat`, from anywhere else by app.js's keydown (app.js:2347);
7. focus in the docked bar — collapse it (as today).

### 6.5 The composer and the character on a page

As sections today, unchanged code: `body.project-view` hides `.feed`, `.chips`, `.jump`, `#pill` and
`.agents` (project-workspace.css:2; project-composer.css:2-5); `pill.inert` (app.js:166-170); the
character takes the header pose, 32px under 520px tall (app.js:181-189); drafts and attachments stay in
the hidden composer. Keys inside `.project-workspace` and `.workspace-sidebar` are owned there
(`keyboardInputOwned`, app.js:1446-1451), so type-to-talk does not fire on a page; a printable key typed
elsewhere returns to chat as today.

---

## 7. File ownership — three builders, disjoint

Each builder edits only their files, imports only what is listed, writes their test, and commits once
(plus fixes) on `ui/control-panel`. None touches `public/app.js`, `public/index.html`,
`public/styles.css`, `public/lib/project-workspace.js`, `public/project-workspace.css`,
`public/lib/control-panel-contract.js`, `tools/`, `daemon/`, other tests, or docs.

### (a) MODEL

| | |
|---|---|
| files | `public/lib/builds-model.js`, `tests/builds-model.test.mjs` |
| imports | `./control-panel-contract.js` only. No DOM, no `Date.now()`, no fetch |
| exports | §3.1, exactly those names |
| must | implement §3.3, §4.1–4.6 and §5.2; order by `GROUPS` then `order` (up next: in-progress-marked first, then file order, then queued by time; building newest first; in newest first; failed newest first); cap per `PAGE_LIMITS`; badge and attention per `BADGE` / `ATTENTION_TONES`; words from `WORDS` / `STATE_WORDS` |
| test | node:test, pure fixtures: every run status; each GitHub flag; a retry chain (one ticket, two tries); a run naming two issues; a deleted issue; a done issue with and without a merged run; a queued run; awaiting_input; interrupted not a verdict; `mergeRuns` precedence and the null window; every blocked word; badge priority; `improvementIdForRun`; `previewText`, `parseDiffstat` (real `git diff --stat` output), `splitImprovementText` (newlines, reserved `<!-- nibbi-` markers refused as the daemon does, project-workspace.ts:92) |

### (b) PAGES

| | |
|---|---|
| files | `public/lib/project-pages.js`, `public/project-pages.css`, `tests/project-pages-ui.test.mjs` |
| imports | `./control-panel-contract.js`, `./github-ui.js` (`createGithubPanel`, `githubDeliveryLabel`), `./transcript.js` (`describeToolEvent`, `inputLine`, `eventToLogEntry`). **Not** builds-model.js: pages draw VMs |
| exports | `installProjectPages({ host, onAction, renderMarkdown, renderDiff }) → { open(model, { focus }), update(model), close(), noteRunEvent(event), setBusy(busy), snapshot() → { page, id, hasDraft, confirming } \| null, destroy() }` |
| must | §2.2 whole; the evidence tabs and the Log renderer are **moved** from project-workspace.js (`logList` :362-401, the painting half of `buildEvidence` :402-458 and its helpers :13-28) — the integrator deletes the originals, so this is a move, not debt; the GitHub tab is `createGithubPanel({ project, buildId, run, onAction, renderMarkdown, renderDiff, onChanged: () => onAction('refresh', project) })`; times said against `model.now` |
| test | Playwright, the route-served harness of tests/project-workspace-ui.test.mjs:28-60 (serves `public/`, so imports resolve), a `<section id="project-workspace" class="project-workspace">` host (`div.cp-page-host` inside it) with tokens.css + project-workspace.css + project-pages.css, literal VMs per state. Carry over what the old lobby tests proved: :185-223 (narrow and short windows), :225-255 (one verdict one colour; a notice without a kind is ink), :285-339 (the Log's rows, labels, verdicts, diff card), :341-392 (play starts, reopens, reports an unavailable preview), :394-436 (live under focus), :437-497 (a live update gives back focus it can, keeps an open log's tail). New: one ink key per page per state; ask-twice sends only on the second press; blocked keys dispatch nothing and say why; Escape returns only what the page opened (`defaultPrevented`), else leaves the event alone; × sends `backToChat`; the gone page; 390×844 touch: every key ≥ 44, no horizontal overflow |

### (c) BAR

| | |
|---|---|
| files | `public/lib/margin-ui.js`, `public/margins.css`, `tests/margin-ui.test.mjs` |
| imports | `./empty.js`, `./control-panel-contract.js`. The test's `marginModuleURL` (tests/margin-ui.test.mjs:8-14) inlines both |
| exports | unchanged: `installMarginUI({ onAction, onVisibility }) → { update(BarModel), close(), setSidebar(), destroy() }`, `progressLine` |
| must | §2.1 whole and §2.3's bar rows; keep every existing behaviour not about sections (cards, drafts, focus, the drawer and its focus trap, 60 projects with one card built lazily, reduced motion, the rollup, toggle words, permission words) |
| test | re-point tests/margin-ui.test.mjs: :69 (the foot after `.margin-body`), :94-95 and :294 (one `[data-bar-build]` for the current project, also with 60), :106-120 (rows dispatch `openBuild` / `openImprovement`; `view` marks exactly one row: `aria-current="page"` on the page's row, `"true"` on the open conversation only while `view` is null), :124-127 (a conversation row dispatches `thread` even when it is the open one — the old Chat tab's promise), :259-263 (the drawer's Tab wrap now starts at `#status`, the first focusable: Shift+Tab from it lands on the last), :334-349 (rewrite: the foot sits under the last card, or holds the bottom edge when the cards overflow), :380 (`[data-bar-build]` gone after destroy), :391-441 (toggle words from `project.attention`), :444-476 (replace: the builds badge says one fact once; a failed row's reason wraps under its word). New: the form (start now / up next, busy and demo words, Enter, Escape, focus back to `+ improvement`); folds (14 failed → one row; the open ticket's row still shows); press states (`:active` background differs from rest on every control kind; transitions on `--t1`, never `all`); 44px rows and keys at 390 coarse; no `data-build-id` anywhere; lowercase bar copy except names from data |

### The integrator

Everything else, after the three land (§8): `public/app.js`, `public/index.html` (no change expected),
`public/styles.css` (`@import './project-pages.css';` after project-workspace.css), `public/lib/project-workspace.js`,
`public/project-workspace.css`, `tools/`, `daemon/`, `design/LANGUAGE.md`, the other tests, and this spec
(and the contract, if a builder reports it wrong).

---

## 8. Integration checklist

### 8.1 app.js, by function

| where | change |
|---|---|
| imports (app.js:6-23) | add `installProjectPages` (./lib/project-pages.js); `buildMain, ticketOf, improvementIdForRun, mergeRuns, conversationsFor, previewText` (./lib/builds-model.js); `ACTIONS, BAR_ACTIONS, WAITS_FOR_REPLY, REFUSED_IN_DEMO, WORDS` (./lib/control-panel-contract.js); `loadProjectSection` (./lib/project-data.js); drop `describeProjectSection` |
| `S` (app.js:58-80) | `projectView` holds a `PageRef`; add `cp: new Map()` (project → `{ builds, issues, play, list, gen }`) |
| install (app.js:84-87) | `installProjectWorkspace({ renderMarkdown, renderDiff, onAction: handleProjectAction, onClose: () => closeProjectView() })` — no `onNavigate`, no `onData`; then `projectPages = installProjectPages({ host: projectWorkspace.pageHost, onAction: handleControlPanelAction, renderMarkdown: renderMd, renderDiff })` |
| new `refreshControlPanel(project)` | coalesced per project with a generation counter: `loadProjectSection` builds + issues, `GET /api/play?project=`; keep the last good data on failure and set `list: 'unavailable'`; then `syncMargins()` |
| new `cpInput(p)` / `syncPage()` | build `CpInput` from `S.fixers` (this project), `S.cp`, the project row, `S.auto`, `S.busy`, `S.demo`, `Date.now()`; `syncPage()` → `projectPages.update(…)` when a build or ticket page is open; a 60s interval calls it while one is |
| `syncMargins` (app.js:1912-1945) | per project: `conversations: conversationsFor(threads, { activeId, liveText })`, `builds: [buildMain(cpInput(p))]`, `attention`; drop `inFlight, pending, staged, done, total, planAvailable, playable, sections, threads`; `view: S.projectView`; call `syncPage()`; `projectPages.setBusy(S.busy)` beside `projectWorkspace.setBusy` |
| `milestonesFor`, `msCache`, `msPending` (app.js:1896-1908) and the loop in `renderProject` (1950-1956) | delete. `/plan` and `/goal` keep their own reads (app.js:1044, 1124, 1137) |
| `selectMarginProject` (app.js:1958-1971) | call `refreshControlPanel(p.name)` |
| `handleMarginAction` (app.js:1976-2046) | busy list → `newProject, autoMode, spendCap`; delete `projectSection`, `fix`, `plan`/`play`/`review`; `selectProject` while a page is open per §6.2; `BAR_ACTIONS` → `handleControlPanelAction` |
| `openProjectSection` → `openProjectPage` (app.js:2048-2061) | §6.2 |
| `closeProjectView` (app.js:2062-2066) | also `projectPages.close()` |
| new `handleControlPanelAction` | §5.1; refuse `WAITS_FOR_REPLY` while `S.busy` (throw `notice(WORDS.busy)`) and `REFUSED_IN_DEMO` in demo; after any write `refreshControlPanel(project)`; accept `result.section` from projectCommand into `S.cp` directly |
| `handleProjectAction` (app.js:2067-2121) | keep githubRead, githubRefresh, buildEvidence, previewStatus, openUrl, githubCommand, projectCommand, buildCommand; delete buildChanges/buildLog and the prompts branch (2111-2120) and their busy list (2089); drop `projectSummaries.accept/invalidate` if the summary store goes |
| new `playProject(project, action)` | the non-chat core of `playFlow` (app.js:1506-1534); `playFlow` calls it |
| new `runPreview(project, runId, action)` | the lobby's playtest / openPlaytest / stop (project-workspace.js:478-515) |
| `queueProjectActivity` (app.js:2126-2129) | while a ticket of that project is open, `refreshControlPanel(project)` (its `currentActivity`) |
| `scheduleProjectRefresh` (app.js:2130-2141) | `refreshControlPanel` for the active project and the page's project; `projectWorkspace.refresh()` only for `page: 'repository'` |
| `connectEvents` (app.js:1287-1288) | `projectPages.noteRunEvent(event)` in place of `projectWorkspace.noteRunEvent`; `thread.updated` → `mergeThread` copies `lastText` (app.js:603-614) |
| `notify` (app.js:1251), `fixerActs` (app.js:900), `inspectGithubBuild` (app.js:894) | §6.2; the chip label "open build" → "open it" |
| keydown (app.js:2347) | also skip when `e.defaultPrevented` |
| `snapshot()` (app.js:2532) | `projectView: projectPages.snapshot() ?? projectWorkspace.snapshot()` |
| the summary store (app.js:84, 158-163) | keep `watchProjectSummaries`' thread reads; drop the store's wiring if nothing reads it. project-summary.js and its test stay |

Keep `tests/local-fallback-ui.test.mjs` passing: `send`'s if / else-if chain and `setSaid(T, text, false)`
(app.js:1596-1633) are not touched.

### 8.2 project-workspace.js and its CSS

Strip to the frame + Repository & GitHub: keep `el`, head, `h1#project-workspace-title`, ×, body,
notice, `githubPanel`, `open({ section: 'repository' })`, `close`, `refresh` (repository only),
`setBusy`, `snapshot`, `destroy`, the Escape handler (:694-698, skipping `defaultPrevented`); add
`pageHost` (a `div.cp-page-host` inside `el`) and `showPage(on)` (hides head/body, shows the host, sets
`aria-busy="false"`). Delete the rest (§2.3), including "Back to builds" (:682). In
project-workspace.css keep what the frame and github-ui.js use (`project-action`, `project-document`,
`project-evidence-code`, `project-field`, `project-form-error`, `project-inline-form`, `project-loading`,
`project-muted`, `project-notice`, `project-record-status`, `project-related-link`, `project-toolbar`,
`project-toolbar-actions`, the `github-*` rules); delete lobby, kanban, plans and filter rules.

### 8.3 Daemon

§4.6: threads.ts (`Thread.lastText`, `ThreadSummary.lastText`, `touchThread`'s fifth argument, `save`'s
payload, `listThreads`/`homeSummary`), history.ts:13, daemon/test/threads.test.ts (new cases; :102's
payload). Nothing else in the daemon changes.

### 8.4 Tests and tools to re-point

| file:line | today | phase 1 |
|---|---|---|
| tests/margin-ui.test.mjs | sections, tabs, foot | the BAR builder's (§7c) |
| tests/project-workspace-ui.test.mjs:65-184, 257-283 | issues editing, milestones, GitHub filters and key hint | delete |
| tests/project-workspace-ui.test.mjs:185-255, 285-497 | lobby evidence, play, live focus | delete here; the PAGES test carries them (§7b). Keep a small frame test: repository opens, × and Escape call `onClose`, the page host hides the repository content, a notice without a kind is ink |
| tests/narration-wiring.test.mjs:76, 107, 109 | `#sidebar-progress` textContent | must pass unchanged (D13) |
| daemon/test/threads.test.ts:102 | payload `deepEqual` | + `lastText` |
| tools/verify.mjs:100-109 | builds tab → section → × / Escape | `[data-bar-build="main"]` → the build page → `.project-close`; again → Escape from `.project-workspace-body` |
| tools/surfaces-verify.mjs:26 | waits for `.margin-tab[data-margin-tab="builds"]` | waits for `[data-bar-build="main"]` |
| tools/surfaces-verify.mjs:46, 81 | builds tab click | main row (open the drawer first at 390) |
| tools/surfaces-verify.mjs:82-84 | `projectView?.section === 'builds'` / `'repository'`; "Repository & GitHub" from the lobby toolbar | `projectView?.page === 'build'` / `'repository'`; the pill in the project settings card (`openProjectCard`, tools/choose-project.mjs) |
| tools/continuity-verify.mjs:250-253 | builds tab, then the Chat tab while a reply streams | main row, then the open conversation's row; the reply is still there |
| tools/continuity-verify.mjs:316-322 | a paste into the Issues search field | a paste into the build page's improvement field (`#project-workspace textarea`) is not attached |
| tools/continuity-verify.mjs:81, 228, 345, 460, 565-567 | `.project-thread-new`, thread gears, `.margin-body` | pass unchanged (kept hooks) |
| tools/attention-verify.mjs:79 | chips `['steer','stop','open build','ask nibbi']` | `'open it'` |
| tools/attention-verify.mjs:81 | builds tab `aria-label` "Builds. 1 needs input" | `.cp-group[data-cp-group="builds"] .cp-badge` = "1 needs you" |
| tools/attention-verify.mjs:99-100 | notification → `[data-build-id=failing]` | → `#project-workspace .cp-page[data-cp-page="ticket"][data-cp-id="run:<failing>"]` |
| tools/attention-verify.mjs:105, 125 | toggle count "1 needs input" | "1 needs you" |
| tools/attention-verify.mjs:141-181 | the lobby live under focus and an open log | the ticket of `run:fixture-0`: its Log tab focused survives `run.discard fixture-7` (focus back on the tab); the build page's improvement field focused with text survives a refresh (same node, same value, same focus); the ticket of `run:fixture-9`: its open Log node survives `run.retry fixture-9` and gains exactly one row |
| tools/webkit-verify.mjs:52-56 | 4 `.margin-tab`, ≥ 32/44 tall | `[data-bar-build]` = 1, conversation rows ≥ 1, every bar row ≥ 44 tall, no sideways scroll |
| tools/webkit-verify.mjs:80-82 | builds tab → `[data-build-id="fixture-0"]` | main row → the build page → `.cp-imp[data-cp-key="imp-run:fixture-0"]` |
| tools/sidebar-verify.mjs:57 | strip `['builds','issues','plans']` | `[data-bar-build]` → `['main']` |
| tools/sidebar-verify.mjs:67 | `[data-section-project="observatory"]:visible` = 3 | after choosing observatory, its `[data-bar-build="main"]` is visible (1) |
| tools/margin-ui-verify.mjs:33, 36-38 | `#settings-rail` geometry; summaries' plan counts | new baseline; drop the plan-count fixture |
| tools/margin-ui-verify.mjs:51 | `#settings-rail button` = 1 "the foot of the bar holds Settings" | still 1; message "the head holds Settings beside collapse" |
| tools/margin-ui-verify.mjs:59 | `.margin-glyph-label` opacity on focus/hover | `#status` has `aria-label` + `title`, a 32px (44 coarse) box and the focus ring |
| tools/project-workflow-verify.mjs:22, 26, 30, 47 | `open(section)`, `tab()`, the three sections | `open(page)`: the build page, a ticket; the busy refusal check re-pointed to pages |
| tools/project-workflow-verify.mjs:63-107 | issues kanban CRUD, Add to plan, task build, merge | `+ improvement` → up next → its ticket → edit the words → mark it done → reopen it; build it now on `issue:seedling-overlap` → wait staged → its ticket's changes and checks → approve & merge → confirm merge → the issue is done (`fixture.section`) |
| tools/project-workflow-verify.mjs:88-91, 111-117 | plans, milestones, tasks | delete |
| tools/project-workflow-verify.mjs:124-134 | three sections at 390, `#project-workspace-title` | the build page and a ticket at 390; `#project-workspace .cp-page h1` |
| tools/github-workflow-verify.mjs:15 | `projectView?.section` | `?.page` |
| tools/github-workflow-verify.mjs:16, 28, 30 | builds section, `[data-build-id]` row, GitHub tab | the run's ticket; `article.cp-try[data-cp-run="<id>"]`; its `github` tab; scroll anchor `.cp-try .project-evidence-tabs` |
| tools/github-workflow-verify.mjs:51 | `[data-build-id]` text `nibbi/fx-… → staging` | the try's head shows `nibbi/fx-… → staging` |
| tools/github-workflow-verify.mjs:54 | `[data-project-section="builds"] .project-section-badge` = "1 pull request" | the builds card badge = "1 pull request open" |
| tools/github-workflow-verify.mjs:64 | issues section, `[data-record-id="seedling-overlap"]`, its GitHub issue link | the ticket of `issue:seedling-overlap` shows the link "GitHub issue · owner/paper-garden #7" |
| tools/github-workflow-verify.mjs:72 | `.project-workspace button:visible` ≥ 44 at phone | unchanged selector, now over pages too |
| tools/kanban-verify.mjs | the kanban | **retire**: delete it and its `verify:all` entry; its intent (a status survives a reload, the draft is kept) moves into control-panel-verify |
| tools/build-play-verify.mjs:19-37 | lobby Play build / Open build / Stop build preview | the ticket of `run:fixture-0`: **play it** → the popup → **open it** → **stop playing**; draft preserved; frame visible |
| tools/harness-verify.mjs:54-58, 113-115 | section helpers; `[data-build-id]` Log | page helpers; the try card's Log |
| tools/bar-shots.mjs:37-38 | builds tab | main row |
| tools/style-verify.mjs:17, 25-29 | budget; verdict hooks | add `'project-pages.css': 0`; add `/\[data-tone="pass"\]/` |
| tools/review-verify.mjs, voice-verify.mjs, pocket-app-extras.mjs, stream-verify.mjs | `#status`, `#st-*` | pass unchanged |
| package.json `verify` / `verify:all` | — | append `node tools/control-panel-verify.mjs` to `verify`; drop `kanban-verify` from `verify:all` |

### 8.5 tools/control-panel-verify.mjs (new, behaviour checks)

Runs `projectWorkflowFixture` (tools/project-workflow-fixture.mjs: real routes and Git, deterministic
providers, a real check — so a run really stages and really merges) at 1180×820 and 390×844 touch, on
paper-garden. `PASS`/`FAIL` lines like its neighbours; exit code 1 on any failure; screenshots to
`output/playwright/control-panel/`.

1. **chat is the default** — `#project-workspace` hidden; `[data-thread-id="home"][aria-current="true"]`; no `[aria-current="page"]` in `#workspace-sidebar`.
2. **a build row opens its build page** — click `[data-bar-build="main"]` → `.cp-page[data-cp-page="build"][data-cp-id="main"]`; the row `aria-current="page"`; home unmarked; `#pill` hidden; `projectView` = `{ project: 'paper-garden', page: 'build', id: 'main' }`.
3. **an improvement row opens its ticket** — `[data-bar-improvement="issue:seedling-overlap"]` → its ticket; the row current.
4. **+ improvement → start now builds in place** — from chat, with "Keep this draft" in `#ask`: `+ improvement`, type, **start now** → within 10s a `[data-bar-improvement^="run:"]` row with that title (building or ready); `projectView` still null; `#ask` still "Keep this draft"; the turn count unchanged; focus on `+ improvement`.
5. **up next lists it** — type, **up next** → an `issue:` row with `data-state="up_next"`; `fixture.section('paper-garden','issues')` has the open item; reload → it is still there.
6. **a staged ticket asks twice, then merges** — `fixture.fixer.waitForFixer(<run from 4>)` → its ticket → **approve & merge** → `.cp-confirm` visible, the run still `staged`, no `/api/commands` POST for `run.merge` yet → **confirm merge** → the run `merged`; its bar row `data-state="in"`; the page word "in".
7. **plans are unreachable** — no `[data-project-section]`, `.margin-tab`, `[data-margin-tab]` or "plan" pill anywhere; the project settings card has no Plan/Fix…/Review/Play pills.
8. **× and Escape return to chat** — on a page, `.project-close` → frame hidden, `body` not `.project-view`, focus `#ask`, home current; again, Escape from inside `.project-workspace-body` → the same.
9. **busy refuses starting, in words** — `fixture.holdChat()`, send a message, open `+ improvement`: **start now** disabled and pressing Enter shows `WORDS.busy`; **up next** still works; release.
10. **44px at 390 touch** — open the drawer: every visible button in `#workspace-sidebar` ≥ 44 tall (icon keys also ≥ 44 wide); a row that opens a page closes the drawer first; on a ticket every visible `.cp-page button` ≥ 44; no horizontal overflow.
11. **press states** — for a conversation row, main's row, an improvement row, `+ improvement`, ▶, the conversations `+`, `#status`, `.sidebar-collapse` and a page key: the `:active` background (pointer down, no up) differs from rest, and `transition-property` names `background-color` at 120ms; none is `all`.
12. **live and reduced** — a building row's word pulses (`cp-bar-pulse` running); with `reducedMotion: 'reduce'` no animation runs in the bar or the page.

### 8.6 LANGUAGE.md

§7.3: press feedback is colour and shadow on every control; `scale(.96)` pressed on the one primary of a
surface; no hover scale on new primaries (send keeps its own). §9: add the card, the two-line row, the
fold row, the ask-twice strip. §15: record the Cards bar and the Console pages.

---

## 9. What the plan got wrong, or left open

1. **"up next = open issues + queued runs" is not a queue.** Nothing drains issues.md: the scheduler
   drains the roadmap (scheduler.ts:75-90), and queued runs drain within ten seconds (`drainQueues`,
   fixer.ts:187-200), so the queued half is nearly always empty and an up-next item never becomes
   building on its own. The words say so ("it waits here until you start it"; the form's hint), and the
   one path from up next to building is **build it now** (`issue.build`).
2. **"A run started from free text is its own ticket" breaks on Try again.** `run.retry` makes a new
   run and marks the old superseded (fixer.ts:292-302); the ticket is the `replacesBuildId` chain (D2).
3. **"Play main" plays the owner's checkout, not main**, on whatever branch it is on, dirty or not
   (`playStart` runs in `cfg.repo`, previews.ts:43-47; data.md §3). The page says which branch; truly
   playing main is phase 2's detached main worktree.
4. **In GitHub mode, `in` is not main and review is not approve & merge.** Runs land in
   `integrationBranch` (`v2` for nibbi, fixer.ts:179) and `run.merge` is never offered (fixer.ts:156);
   "their ticket keeps Play, Approve & merge (confirmed), Discard" holds for local projects only. GitHub
   tickets carry the delivery states and the GitHub panel (§4.2).
5. **Failed is three things.** Interrupted runs are not verdicts (project-summary.js:34-36, commit
   6af766b) and cancelled runs are the owner's own Stop; both get their own words (§4.1).
6. **The Console's ticket anatomy is fixture fiction in places.** Real runs have no step list, no plan,
   no "what nibbi understood", no per-build head checks: steps derive from status; the checks are the
   project check and the PR's; "what nibbi understood" is "what you asked" (§2.2.1, §4.1).
7. **The bar needs two reads the plan did not list.** `S.fixers` carries no `allowedActions`,
   `preview` or `currentActivity` (read-models.ts:20), and no client store holds issue items outside the
   old Issues workspace: the integrator reads the builds and issues sections for the active project
   (§3.2, §8.1).
8. **"remove it" has no command**; the daemon cannot delete an issue (project-workspace.ts:15) — mark it
   done (D14).
9. **Starting work while nibbi answers**: the decided list (ROUND3 decided 4) refuses it, production's
   rule allows every daemon command (app.js:2087). The spec takes the decided list for the three
   run-starting keys only (D8) — the owner may want that reversed.
10. **Word changes ripple**: "needs input" (describeProjectSection, notifications, attention-verify) →
    "needs you"; the "open build" chip → "open it"; notification and chip targets move from the lobby to
    tickets (app.js:894, 900, 1251). Not in the plan.
11. **The lobby's keyboard review goes** (j/k/a/x/p, Next build, project-workspace.js:699-722); `/review`
    in chat keeps it. Not in the plan.
12. **Settings in the head is more than moving a node**: the card must top-anchor (margins.css:112,
    :123, :129) and two tests go vacuous (tests/margin-ui.test.mjs:259-263, 334-349) — data.md §6 said
    so; the plan's commit table did not.
13. **Open, for the owner**: whether "both of them" meant the two groups (read here, ROUND5 decided 1);
    whether up-next items should be drained by automation (scheduler option (b), code.md §3); lowercase
    for the progress line (D13).

---

## 10. As built — where the integration departed from §8 (part 2)

| where | the spec said | as built, and why |
|---|---|---|
| tools/attention-verify.mjs:99-100 | the notification opens `run:<failing>` | it opens `run:fixture-3`, the chain's root, with the failing retry as try 2: D2 makes a ticket the `replacesBuildId` chain, and the failing run is a retry of fixture-3 |
| app.js `refreshStatus` | — | a snapshot that lands after a newer `run.updated` no longer replaces that run's record (it dropped a retried run, and a notification then opened a gone ticket, 2 of 3 probe runs). `openRunTicket` also resolves over the builds read and the run itself |
| §5.1 editImprovement | `issue.edit` with the list's revision | with the revision the words were read at (the payload's `revision`); after a refusal the next save goes against the list as it is. A save after issues.md moved under the form went through before |
| tools/github-workflow-verify.mjs:72 | `.project-workspace button:visible` ≥ 44 | at ≤640px only: page keys are 36 and links 32 at a fine pointer (§0) |
| margins.css `.margin-card-right` ≤899px | the lab's 8px foot | 12px: arrive rises 10px, and the card arrived 2px past a 568px phone |
| tools/control-panel-verify.mjs | — | paper-garden plays at a URL in its fixture, so ▶ is a live key whose press can be measured (check 11) |
| tools/kanban-verify.mjs | retire | deleted; its intent is checks 4 and 5 |

# Changelog

## 0.9.0 — Unreleased

### The control panel, phase 2: builds are copies

**A build is a clone of the app.** `+ New build` on the builds card makes one — `dev`, then `dev1` — and
it is a real one: a branch, `nibbi/copy/dev`, made from main's head and checked out in its own folder
under the work dir, playable on its own. The bar lists it under main with what it is (`copy of main · 2
ahead`) and one word for where it stands: making the copy, 1 building, ready to play, ready to ship,
main moved on · catch up, nothing to ship yet. Its page has its own play, its checks, how it stands
against main, its improvements and its history.

**Improvements live inside a build.** `+ improvement` in a copy aims the run at it. Once its checks pass
on the copy's tree it lands there on its own, by a fast-forward inside the copy's folder — main is not
touched, and there is no review step inside a copy. A failed landing leaves the copy as it was and says
why.

**Ship to main is the reviewed step.** It asks on the copy's page, listing what goes into main and what
stays, and sends nothing until its second press. nibbi then runs the checks again on exactly what main
would become and fast-forwards main where it is checked out — or refuses, changing nothing, when your
project folder has uncommitted changes, is on another branch, or main moved on (catch up first, so main
becomes exactly the head you played). The copy stays, level with main, and only now are its
improvements done: their checkboxes in `issues.md`, their roadmap tasks, the progress count.

**Catch up, retire, one at a time.** When main moves on, a copy says so and catch up brings main's
newest in, checked the same way; a conflict names the files and changes nothing. Retire asks, armed,
names what hasn't shipped, and takes the copy's folder and branch off the machine — never forced, and
not while an improvement is building on it. One build plays at a time: playing a copy stops main's
preview, and playing main stops the copies'.

**Defaults the owner can change.** An improvement on a copy is done when the copy ships; copies are
made from main only; five at most; a copy needs a real project check; GitHub-connected projects keep
copies local for now, and the `+` says so; automation and the lead still build on main
(`docs/BUILDS-AS-COPIES.md` §1 lists all sixteen).

**Checked.** `daemon/test/project-copies.test.ts` proves the rules in temp repos — main moves only
through the verified merge, a copy's branch only by `--ff-only` inside its own folder, nothing moves a
branch from outside, and every refusal leaves main and the copy as they were (26 tests). Eight new
checks in `tools/control-panel-verify.mjs` drive the real app through it: make dev, land two
improvements, ship them, catch up, play one at a time, retire, a GitHub-mode project, and 390 touch.

### The control panel, phase 1

**The bar is a control panel.** It was a switcher, a strip of four glyphs and whatever section the
strip had open, in four container languages: a raised card, flat rows, rows with a trunk, and `+`
squares heavier than anything near them. It is three identical cards now — the project, its
conversations, its builds — with one header, one row and one key between them, and Settings sits in
the head, left of collapse, where the owner asked for it. Both groups are always open. The foot is a
quiet line, and it holds the bottom edge once the cards run past it.

**Chat is the room.** Nothing opens a page until you choose a row. A build's row opens its build
page, an improvement's row its ticket, and ×, Escape or a conversation's row goes back to the
conversation. Opened from the docked bar, focus stays on the row, so you can click down the list and
read; from a notification, a chip or the drawer, it moves to the page. A conversation's second line
is the last thing said in it, which the daemon now keeps on the thread (`lastText`) and sends with
`thread.updated`.

**A build is a clone of the app.** Phase 1 has one: **main**, the live build, and it says where its
work really lands — `live · lands on staging` when that is not main. Its page plays your checkout
(and says which branch it is on, because that is what play really runs), counts what waits on you,
names the project's check, and lists every improvement in one order, the bar's: waiting on you,
building, up next, in, failed. `dev`, `dev1` and a `+` to make one wait for phase 2.

**Improvements, not issues and plans.** Plans left the UI, and so did the Issues board. An
improvement is an open item in `issues.md` or a run started from your words, and its word says where
it is: up next, building, needs you, ready to review, in, failed — or interrupted, in ink, because
the backend stopping under a run is not a verdict on it. Up next is not a queue, and the page says
so: nothing builds an up-next item on its own, and **build it now** is the way from one to the other.
The roadmap is untouched and still drives automation, `/plan` and `/goal`; the project's settings
card says so in one line.

**+ improvement is one form.** In the bar and on main's page: **start now** (↵) dispatches a run,
**up next** keeps it in `issues.md`, and "ask nibbi instead" hands the words to the conversation.
It never leaves the room it was opened in and never types over your draft. A retried run is a new
try on the same ticket, not a new ticket.

**Review moved onto the ticket.** The Builds lobby is gone; its flow is the ticket's keys: play it,
approve & merge and discard — each asks twice, on the page, and sends nothing until the second press
— verify it, guide it, stop, try again. Every try is a card with its steps, its checks, its log (new
events join an open log in place, and a refresh never rebuilds one you are reading), its changes and,
in GitHub mode, its GitHub panel, which is also the ticket's one ink key there: a GitHub build merges
on GitHub, so it has no approve & merge. The lobby's j/k/a/x/p keys went with it; `/review` keeps
them in the chat.

**Buttons that feel pressed.** Every control in the bar and on the pages presses in colour and shadow
on `--t1`, and only the one primary of a surface scales — the open form's start now, a page's ink key,
send. Rows and keys are 44px in the drawer and at a coarse pointer, and a two-line row is 44 everywhere.

**What waits for nibbi.** Only what starts a run — start now, build it now, try again — waits while
nibbi is answering, and it says so in words instead of failing. Up next, edits, stop, merge, discard,
play and every page work during a reply.

**Words.** "needs input" is "needs you", in the bar, on the toggle and in the away summary. The chip
that opened a build in the lobby says "open it" and opens its ticket, and so does a run's
notification. Page keys are lowercase: `try again`, `approve & merge`.

**Two things found on the way.** A snapshot read that set out before an event and landed after it
put the run list back to what it was, dropping a retried run until the next read; a notification
clicked in that window opened a ticket for the wrong chain and called it gone (2 of 3 probe runs at
page load). Records the event stream has moved past a snapshot now stay as the events left them.
And an edit saved after `issues.md` changed under the open form went through against the newer
list, over whatever changed; it is refused now, keeps your words and the change, and the next save
goes on. The Settings card, top-anchored at last, arrived 2px past the bottom of a 568px phone; its
foot keeps 12px like its other edges.

**Checked.** `tools/control-panel-verify.mjs`, in `npm run verify`, drives the real app over real
routes and real Git — a run really stages and really merges — in twelve checks, from chat being the
default to every control's press and nothing moving under reduced motion. Every suite that clicked a
tab or read the lobby now drives the bar's rows and the pages. `tools/kanban-verify.mjs` is retired
with the board it tested; what it protected — a thing kept for later survives a reload, and your
draft is kept while you do it — is two of the new checks.

## 0.8.1 — Unreleased

### Composition and surfaces

**The reply card.** A reply was shrink-wrapped, so it opened at the width of its steps and jumped
to the full measure at the first word. It is a page-width card from its first frame now, and it does
not change width between the first step and the settle. The dots stand down while a step is running
— one working mark, not two — and a reply that ends in a fence or a table keeps its caret, on a line
of its own under the block.

**Colour means a verdict.** Failed was red in the phone list and grey in the desktop queue: the same
row, two rules of equal weight, and the later one won. It is red in both. A workspace notice with no
kind ("Confirm this build action below.") was painted in the failure red; it is ink.

**Motion.** Reduced motion cut every animation to a millisecond but left the loops looping, so the
thinking dot and the plan badge flickered instead of standing still. Every animation plays once now,
and Calm motion, which only ever reached the character, reaches the CSS as `body.calm`.

**A section is a room.** Opened from idle, the 164px character used to shrink through the section's
header for 600ms while the section arrived in 220; it snaps to its header pose now, the way first
paint does. The fixers no longer float over a section's records, and the floating "Chat with Nibbi"
button is gone — it duplicated the Chat tab and covered a card's status on a phone. The header × has
always been the way back, and it never scrolls away. At 390 the header puts its summary on a line of
its own and its controls in one row under it; the filters scroll sideways instead of wrapping; To
push and Pull requests appear only for a project that delivers through GitHub, or when one of them
has something in it; and a phone is not shown keyboard shortcuts.

**The bar says one thing once.** A section tab said "2 open" and then "2 open." under it, and "The
full list is open beside the bar." on every section — untrue in the phone drawer, where nothing is
beside it. The badge is the fact now, and a line under it adds only what the badge lacks: what is in
flight and staged for Builds, the goal for Plans, nothing for Issues. In Settings, "Blocked in system
or browser settings" sat under the microphone row with no subject; every status names notifications
now, and a denied permission reads Blocked rather than Off. Session reads `$1.00 · 7 turns` on one
line — the row's label already says whose numbers they are.

**One rule, one check.** Two resets at (0,1,1) outranked every control's own class in the bar and
the workspace, and twenty-seven `!important` flags were holding the line; the resets are under
`:where()` and the flags are gone. Six disabled opacities are one `--dim-disabled`, every focus ring is one
`--focus-ring` (or its inverse on ink, where an ink ring cannot be seen), and `tools/style-verify.mjs`,
first in `npm run verify`, fails a new flag, a new dimming,
a hand-drawn ring or verdict colour on something that is not a verdict. Measured across 260 visible
controls at 1180 and 390, two things changed: the section's × is the 21px it always declared, and a
disabled pill dims to .45 instead of .42.

**Copy copies what you read.** The code block's button stripped a trailing "copy" from the block's
text, but a capped block ends in "show all (18 lines)", so the label came along; it copies the code
itself now. A reply's copy took the raw text with its `»acts:` lines, and both said "copied" whether
or not the clipboard took it. The fold ("5 steps in 9s — show") opened the steps and vanished, taking
focus with it; it is a toggle now, above the steps it opens, that stays where it is. An event turn no longer offers "ask again"
with nothing to ask.

**One of everything.** A running step counts in whole seconds and a long one reads `1m 05s`, not
`1.1m` — the thinking step's format. A failed turn restored from history, or stored by the daemon
already put into words, wears the same notice or failure mark it wore live. Reduced motion and Calm
motion scroll the feed without smoothing.

**Also.** The toast is a live region and sits above the fixers instead of on them. An agent's card
stays open while you type in it. On a phone the jump button and a toast's action are 44px, the code
block's copy button has a 44px hit area around the smaller pill it paints, and all four take the focus ring.

### Conversation continuity and first run

**Where a reload lands.** The conversation was chosen before the app knew which project it was in,
so it was always the vault's: a thread you were in never came back, and a project's home whose saved
copy had expired rendered blank. Boot now waits for the project list, returns to the thread you were
in, and reads a home with no saved copy from the daemon, leaving out whatever you tidied away and
anything already on screen. Each project's home keeps its own saved copy instead of sharing one. A
reply nibbi began no longer sits under an empty grey "you" bubble, and a history read that lands
after you have moved on is dropped instead of drawn into the conversation you moved to. The daemon
now says when it names a thread from its first message, so the bar and the composer stop saying "New
thread" until a reload, and a row's "4m" keeps counting while the bar is open.

**One turn at a time, said once.** The Chat tab during a reply asks for the conversation that is
answering, and it was refused, so Builds could not be left while nibbi spoke. It is allowed now.
Leaving for another thread or project is still refused, with one sentence in the bar where you
clicked — "nibbi is answering in “Home” — switch when it’s done" — in ink, because waiting is not a
failure, and it goes when the reply does.

**Drafts.** One composer field served every thread, so half a message followed you into the next
one. Each thread keeps its own draft through a switch and a reload, and quoting adds to it instead of
replacing it. A file that cannot be attached says why, with the number, instead of vanishing — and a
drop of six no longer attaches all six, because the four-image check now counts files still loading;
the daemon refused the whole message. A file pasted into a workspace field is that field's.

**A thread you can name, put away, and scroll back through.** The daemon could rename and archive a
thread and nothing in the app could ask it to. A thread's row has the gear a project's has, and its
card renames it or archives it after a confirm — it stays in the log, and nothing deletes. The first
read of a conversation brings its last sixty messages and there was no way past them; the top of a
longer conversation is now a "load earlier" divider, and pressing it puts the older page above what
you were reading without moving it. Quick clicks between threads used to be dropped while the first
one loaded; the read now happens behind the switch, and one that lands late is thrown away.

**A first run that makes sense.** The chips offered a playtest of "shipless" to anyone, and "what's
new?" to someone with no past; with no projects they are now "new project" and "what can you do?",
and New project offers both ways in — a fresh repository, or `/register` for one you already have,
which the daemon has always supported and nothing could ask for. `/new`, `/register` and `/project
<name>` take the conversation to the home of the project they make active; they used to change the
project under it, and the next message from a thread came back "unknown thread". The bar no longer
says "Loading projects…" forever when the daemon is away: it says it couldn't reach the list,
retries every ten seconds, and has a Retry. A thread with nothing in it says so. The lapsed-sign-in
reply pointed at `claude setup-token`, which Settings never mentions; it points at Settings →
Providers, its chip opens it, the tab checks your sign-in as it opens and puts it first, and a Codex
sign-in finishing elsewhere says "signed in". The wake greeting stops using a name nothing in the
app knows.

### Attention, liveness, and the harness

**A stopped build is not a failed one.** A cancelled or interrupted build was announced with the
failure sentence's shape, the happy face and the success sound. Each announced status is one row now
— mood, sound, beat, notification — and a stop or an interruption is a notice that says the work is
kept: no verdict colour, no sound, no splash.

**Notifications arrive.** They were wired to a function nothing called. A build that is ready,
failed, merged or waiting on you notifies when the window is hidden or not focused, and in a browser
the click opens that build. In the desktop shell the click does nothing yet; that needs a handler in
the shell and a window-focus capability, which is a shell release.

**Waiting on you.** Nothing in the daemon reports `awaiting_input` yet, but a build that does now
leads the Builds badge ("1 needs input" — the lobby's "waiting on you" already counts every build that
wants a decision, so the badge says what it counts), joins the attention filter, counts on the dock
badge and in the tab title, offers steer, stop and open build, and is named in the while-you-were-away
line. A build that asks, is answered and asks again is announced both times. An interrupted build is
counted as "1 interrupted", in ink: it shares the failed group, but nothing judged it.

**The closed bar still speaks.** On a phone the bar is a closed drawer, so its toggle carries what the
project wants from you, in words ("1 review", "2 failed"). It is still labelled "Open sidebar"; the
words describe it. The project you are in is read with the bar closed, so the words are current. On a
narrow phone they wrap to a second line before they reach the character in its talk pose, rather than
painting the toggle over its face (measured at 320, 360 and 390).

**A streamed reply counts as new.** The jump button counted only what nibbi said on its own, so
scrolling up during a long reply always read "latest". Each block that finishes below you counts
now, so it can say "3 new" while you read.

**The Builds lobby stays live.** It held every read back behind "Show updates" whenever focus was
anywhere inside it, so one click on a tab stopped the lobby updating. It waits now only while you
type or decide — a field, a form, a confirmation, a GitHub review — or while focus is somewhere it
cannot be given back. Focus on a tab, a filter, an action, Refresh, a build's row or anything inside
an open log or diff comes back to the same control once the rows update; a link in a summary still
holds the read behind "Show updates", as before. An open Log follows its build: each event joins the
list on screen, the lobby's own reads leave an open log or diff as the node it was, and what arrives
while the build is off screen is there when it is back. A reply that is still streaming locks only
what writes into the composer (New build, Discuss plan, a New issue with nowhere to save it); stop,
retry, discard, merge, play and the forms are commands to the daemon and no longer wait for it. The
lobby's summary counts a build waiting on you as waiting, not building.

**The harness.** The demo has a reply with a fence and a table (`show me the code`), and the
streaming suite runs it at 1180×600, 390×844 and under glass: an open fence is code from its first
line, the caret sits on the sentence being written, the table fits a phone, and glass changes the
paper but not the ink. WebKit, the engine the app ships in, has a suite of its own —
`npm run verify:webkit`: the bar, a streamed reply and the Builds lobby at two sizes — which CI runs
after `npm run verify`. The sidebar lab renders on the real tokens again, and fails when it does not.

**The manual suites run again.** Four tools that described a bar or an install that no longer
exists are gone (`margin-polish-verify`, `margin-surface-verify`, `project-sections-verify`, and
`webkit-bar-check`, which `webkit-verify` replaces). `margin-ui-verify`, `sidebar-verify` and
`project-workflow-verify` point at this checkout and today's gestures; the shared project picker no
longer waits forever on a turn's endless pulse; and `npm run verify:all` runs every manual suite in
one go. The README and the sidebar doc say where Hey Nibbi lives: the composer's + panel.

**Found by running the three together.** An interrupted build is ink in the lobby too, as it already
was on the bar; failed keeps the verdict colour. A card's × and a project's gear are 44px on a phone
and under touch — they were 32 and 40. On a phone the composer stays out of reach behind the open
drawer: the drawer made the page inert and then asked for a layout, which handed the composer back.
And switching the system's reduced motion always reaches the character: reading the setting between
the switch and its change event swallowed the event, so Settings said "OS reduced motion" while the
character kept moving.

## 0.8.0 — 2026-09-22 — how it streams, and the left bar

**Streaming.** A reply used to be re-parsed and rebuilt from scratch sixteen times a second, which
threw away whatever the reader had hold of. Text now lands as it arrives but costs at most one
render per frame, and only the block still being written is rebuilt — so a selection survives the
reply, a code block stops restarting, and a fence renders as code the moment it opens rather than as
escaped prose. A caret says the reply is still open. Measured: no long tasks, a 17ms median frame.

**Thinking.** Both providers were dropping their reasoning on the floor, so a turn that thought for
twenty seconds showed three dots. It is a step now: it says what it is thinking, counts, and closes
into "thought for 8s" when the first word arrives. The words are never written down; the trail keeps
one line saying it happened.

**The hot path.** The transcript is no longer rewritten on every feed mutation, durable text rows are
coalesced instead of one per token, the database no longer fsyncs per token, and a subscriber can
ask `/api/events` not to send it types it has no use for.

**The left bar.** Escape belongs to whatever you are in again — it was captured at the document, so
it never reached the composer, and when it did it cleared the whole conversation without asking. A
project's settings card is built when it is opened rather than sixty at a time. The foot is anchored,
so the progress line sits above Settings instead of stranded mid-bar above four hundred pixels of
nothing. A bar with no projects says so instead of describing one that does not exist. Offline is a
sentence. Cards, menus, the backdrop and the project sections arrive and leave instead of cutting.

**Also.** A project section has a close control and leaves on Escape. The jump button counts what
arrived while you were reading. An unreachable gateway is a notice, not a failure verdict. Eight
declared-but-unused layout tokens are adopted and the bar's seven anonymous white alphas are a named
family; the reply bubble is now under the contrast contract, on paper and under glass.

## Unreleased — reliability

- Suggestion-only automation stays in suggest mode when recording notes or updating focus, capacity, model or spend limits.
- Review keeps each diff and merge/discard action attached to its original run when navigating quickly, and prevents duplicate pending actions.
- Settings fields and dialogs retain their keyboard input without triggering background review or chat shortcuts.
- Delayed Settings responses and saves no longer replace the currently selected tab.
- Added automation regressions and isolated browser coverage for delayed review and Settings requests; `npm run verify` runs both browser suites.

## 0.6.0 — 2026-09-03
- Chips from meaning: Oracle's `»acts:` line renders as chips; regex only as fallback (yes/no only for yes/no questions).
- Host event log + SSE (`/nibbi/events`): exact "while you were away", live fixer bubbles, macOS notifications + Dock badge.
- `/review` mode (j/k · a · x · p, group merge), live fixer tail, spend cap + model per project, preview screenshots.
- Projects as places: richer `/project`, `/issue` → vault, `/new <name> web|game` templates, `/plan edit`.
- Chat: relative times, day headers, capped code blocks, scrolling tables, quote-reply, history search-as-you-type.
- Voice: sentence-streamed TTS, barge-in, hold-to-talk (`⌥Space`), per-device default.
- Delight: coloured ink splash when a fixer lands; optional ink sounds.
- Code health: `public/lib/text.js` + unit tests (`node --test`), CI workflow, CI-friendly screenshot tools.

## 0.5 — chronological chat, small Nibbi in conversation, `/recent`, projects top-left with the auto ladder.
## 0.4 — phone app (parked on `phone`), artifacts, cost meter, playtest capture, `/deploy`.
## 0.3 — the build loop: palette, `/fix` → `/diff` → approve, `/plan`, `/new`, fleet events, `/play`.
## 0.2 — mini-Nibbi bubbles, pip eyes, ink animation, agents on the pill.
## 0.1 — the character, the pill, the protocol.

## 0.6.2 — 2026-09-04
- The whole system is Nibbi: daemon at `~/Nibbi`, vault `~/NibbiVault`, state `~/.nibbi`, services `com.nibbi.*` (old paths are symlinks). Telegram removed; daemon notes (briefs, reports, auto events) stream into the app.
- Watchdog backs off and stops when the brain says its tooling is down; one-tap gateway restart.

## 0.7.0 — 2026-09-04
- Public release layout: `install.sh` / `uninstall.sh` for a fresh Mac, the daemon vendored in `daemon/` (sync script), vault template, launchd templates, `docs/FRESH-INSTALL.md`, nibbi.ai site (Cloudflare Pages) with `curl | bash` bootstrap.
- Desktop shell finds the host via `~/.nibbi/host.json`; no machine-specific paths left in code.

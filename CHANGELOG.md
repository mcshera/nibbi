# Changelog

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

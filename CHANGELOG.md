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
push and Pull requests appear only for a project that delivers through GitHub; and a phone is not
shown keyboard shortcuts.

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
`--focus-ring`, and `tools/style-verify.mjs`, first in `npm run verify`, fails a new flag, a new dimming,
a hand-drawn ring or verdict colour on something that is not a verdict. Measured across 260 visible
controls at 1180 and 390, two things changed: the section's × is the 21px it always declared, and a
disabled pill dims to .45 instead of .42.

**Copy copies what you read.** The code block's button stripped a trailing "copy" from the block's
text, but a capped block ends in "show all (18 lines)", so the label came along; it copies the code
itself now. A reply's copy took the raw text with its `»acts:` lines, and both said "copied" whether
or not the clipboard took it. The fold ("5 steps in 9s — show") opened the steps and vanished, taking
focus with it; it is a toggle now that stays where it is. An event turn no longer offers "ask again"
with nothing to ask.

**One of everything.** A running step counts in whole seconds and a long one reads `1m 05s`, not
`1.1m` — the thinking step's format. A failed turn restored from history, or stored by the daemon
already put into words, wears the same notice or failure mark it wore live. Reduced motion and Calm
motion scroll the feed without smoothing.

**Also.** The toast is a live region and sits above the fixers instead of on them. An agent's card
stays open while you type in it. On a phone the jump button and a toast's action are 44px, the code
block's copy button has a 44px hit area around the smaller pill it paints, and all four take the focus ring.

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

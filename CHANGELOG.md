# Changelog

## 0.8.1 — Unreleased

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
leads the Builds badge ("1 waiting on you"), joins the attention filter, counts on the dock badge and
in the tab title, offers steer, stop and open build, and is named in the while-you-were-away line.

**The closed bar still speaks.** On a phone the bar is a closed drawer, so its toggle carries what the
project wants from you, in words ("1 review", "2 failed"). It is still labelled "Open sidebar"; the
words describe it. The project you are in is read with the bar closed, so the words are current.

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

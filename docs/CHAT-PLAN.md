# Nibbi — chat plan (toward a Claude Desktop feel)

*Matty, 2026-09-03: "I want it to scroll top to bottom, not flipped. Nibbi is taking up too much real estate after
messaging. It makes the chat history hard to read."*

## What Claude Desktop gets right (the reference behaviours)
1. **Chronological, bottom-anchored.** Oldest at the top, newest at the bottom, right above the composer. New content
   pushes up; the view stays pinned to the bottom while you're there.
2. **Stick-to-bottom with an escape hatch.** Scroll up to read → the view stops following; a small `↓` button returns you
   to the latest message (and re-pins).
3. **One calm column.** ~720 px, generous line-height, assistant text plain, user text in a soft block. No dimming, no
   "earlier" dividers — position tells you the order.
4. **The header stays out of the way.** Nothing large above the conversation.
5. **History is there when you want it** (a chat list), not forced on you when you open the app.
6. **Tool work is collapsible** — visible while it runs, folded when it's done.

## Changes

**P0 — order, space, scrolling — ✅ shipped**
- Turns render **top → bottom**; new turns append at the bottom and the feed scrolls to them.
- **Stick-to-bottom**: while you're at the bottom, streaming text, steps and fleet events keep the view pinned; if you
  scroll up more than ~80 px the pin releases and a `↓ latest` button appears above the composer.
- **Nibbi shrinks properly** once a conversation starts: ~1/3 of its idle size, tucked at the top centre, so the
  conversation gets the viewport (from ~150 px down to the composer). Idle keeps the full-size character.
- Remove the newest-first hierarchy: no dimmed older turns, no `earlier` hairline; arrival animation comes from below.
- Only the latest turn keeps its action chips (unchanged).
- Thin scrollbar on hover so long histories are navigable.

**P1 — history and reading — ✅ `pick up where we left off` / `/recent` with time separators, hover scrollbar, PageUp/PageDown/End; remaining: code-block cap, relative times**
- `pick up where we left off` chip on open when there's recent conversation (last 12 h); `/recent` renders the last
  exchanges chronologically with time separators. Opening stays pure (idle) — history is a tap away, not forced.
- Day/time separators when restoring history; relative times in the meta line.
- Long replies: code blocks capped with expand; tables scroll horizontally.
- Keyboard: `PageUp/PageDown` scroll the feed while typing; `End` jumps to latest.

**P2 — how it streams — ✅ 2026-09-22**
- Instant, not paced: text lands as it arrives, but at most one render per frame however many tokens
  landed in it. No typewriter, no reveal buffer — the owner's call, and the reference implementations
  that do pace (Vercel's `smoothStream`, the Claude Code TUI request) are the thing we did not do.
- Block-stable: the reply is split into finished blocks and one live tail. Finished blocks are
  rendered once and never touched, so a selection survives the reply, a code block stops restarting,
  and half-typed markdown stops flickering. A fence renders as a code block the moment it opens.
- A caret on the tail says the reply is still open, so a pause mid-reply does not read as a hang.
- Thinking is a step: it opens on the first reasoning token, shows the end of what is being thought,
  counts, and closes into "thought" with an elapsed time when the first real word arrives.
- Nothing writes storage while a reply grows; the transcript is written when the turn settles.
- Pinned by `tools/stream-verify.mjs`, and measured by `tools/stream-perf.mjs`: no long tasks, a
  median frame of 17ms across a full reply.

**P2 — conversations**
- Oracle has one continuous session, so "chats" are days: a `journal` entry per day with `/journal` as the list view.
- Search-as-you-type over history (`/history <q>` already exists) with jump-to-message.
- Export a day to the vault (`/export` exists on the gateway).

## Principles that stay
- Nibbi's idle screen is the reference image: big character, one pill, nothing else.
- In conversation the character is a presence, not a header: small, expressive, out of the way.
- The mini-Nibbi + bubble remains the speaker mark for every reply.

## Threads

A thread is a conversation inside one project. The home thread is not a record: it is every
message with no thread, so adding threads migrated nothing and an older daemon can still open
the database (`thread_id` is an additive column and `user_version` stays 1).

`threadId` is orthogonal to `channel`. Channel stays the transport — app, cli, telegram, goal —
and a thread is what the owner is talking about, so the CLI and Telegram keep writing to home
and a thread can later be continued from any transport.

`GET /api/threads?project=` lists home first, then live threads by recency, then archived ones.
`thread.create`, `thread.rename` and `thread.archive` are ordinary project commands. `/api/send`
carries `threadId`, and the SSE `start`, `ready` and `done` frames echo it back.
Every write to a thread emits `thread.updated` (`{ id, project, title, lastAt, archived }`) on `/api/events` — including the first message naming it — and a touch that changes nothing emits nothing.

Each thread gets its own provider session, its own continuity snapshot and its own `recent_chat`
scope; `search_chat` takes `allThreads` to widen to the project. `/clear` resets one thread's
sessions rather than every project's. The home thread deliberately keeps the original session
key, so upgrading resets nobody's live context.

In the surface, threads are rows under a project's Builds, Issues and Plans, with New thread
leading the list. Switching swaps the whole conversation, which is rebuilt from the daemon rather than from
localStorage; a turn that is still streaming keeps its own detached nodes and finishes in the
thread it belongs to. The thread's name rides on the composer placeholder, never as a badge in
the bar. One turn runs at a time per project, so switching while Nibbi is answering is refused, except returning to the thread that is answering (the Chat tab can leave Builds mid-reply); the refusal is one sentence in the bar, in ink, and goes when the reply does.
Each thread keeps its own draft (`draft:<project>:<thread>` in localStorage; attached images stay in memory for the life of the page), and quoting adds to a draft rather than replacing it.
A thread's row has the project rows' gear, which opens a card to rename it (`thread.rename`) or archive it (`thread.archive`, after a confirm; it stays in the log). Home has no gear, and nothing deletes. When the daemon holds more than the first sixty messages, the top of the conversation is a `load earlier` divider that reads the page before (`/api/history?before=`) without moving what you were reading. A history read that lands after its thread was left is dropped and read again on return.
A reload returns to the active project's remembered thread. A project's home keeps its own stored copy (`transcript:<project>:home`; the vault's home keeps `transcript`), and a home with no copy is read from the daemon, so it is never blank.

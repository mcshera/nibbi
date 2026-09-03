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

**P2 — conversations**
- Oracle has one continuous session, so "chats" are days: a `journal` entry per day with `/journal` as the list view.
- Search-as-you-type over history (`/history <q>` already exists) with jump-to-message.
- Export a day to the vault (`/export` exists on the gateway).

## Principles that stay
- Nibbi's idle screen is the reference image: big character, one pill, nothing else.
- In conversation the character is a presence, not a header: small, expressive, out of the way.
- The mini-Nibbi + bubble remains the speaker mark for every reply.

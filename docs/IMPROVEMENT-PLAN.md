# Nibbi — improvement plan (2026-09-03, after one day of use)

## Where we are
- **v0.5 on `main`**: character + pill; chronological chat pinned to the newest message; replies carried by a mini-Nibbi
  bubble; tool calls as folding step rows; fixers perched on the pill; projects top-left with the auto ladder; 29 slash
  commands (fix → diff → approve loop, plan, play, deploy, new, recent, journal…); voice in/out; desktop app; `phone` branch
  parked. Oracle answers as Nibbi (vault re-branded). One real fixer has run end-to-end from the app.
- **Shape of the code**: `app.js` 1,056 lines in one file, `nibbi.js` 588, `styles.css` 303, `server.mjs` 195. Two pollers
  (status/fixers every 6 s, projects every 60 s). Six regex heuristics decide chips and labels. Scenario suite: 10 states,
  0 console errors. 9 commits since v0.3.

## What a day of use taught us (Matty's feedback → the pattern behind it)
| feedback | pattern | rule going forward |
|---|---|---|
| "auto showing up like an agent" | I invented a metaphor the system didn't have | agents on the pill are **only** things that do work; settings live on the thing they configure |
| "not flipped like it currently is", "too much real estate" | I optimised for the first exchange, not the tenth | the tenth message is the design target; the character yields to the conversation |
| "why does *yes* appear when it doesn't make sense" | chips came from a regex, not from meaning | chips must come from **meaning** (the model) or from **state** (the gateway), never from string patterns |
| "delay the phone work" / "shipless is done" | I planned wide; Matty steers narrow | ship one project's loop deeply before widening; keep parked work on branches |

## Themes and items

### A. Chips from meaning, not regex (highest leverage — fixes the whole class of "yes" bugs)
- **`»acts:` protocol**: Oracle ends a reply with `»acts: dispatch 8.2 | show the diff | not now` (like its `»voice:` line).
  Nibbi strips the line and renders the chips; each chip sends its text. Added to SOUL/AGENTS via a proposal; Nibbi keeps
  `questionActs()` only as a fallback when no `»acts:` line is present.
- State-driven chips stay (staged fixers, running fixers, playable projects) — those come from the gateway, not text.
- *Accept:* no chip appears that a reader would call nonsensical across a day of transcripts.

### B. Never miss what happened
- **Host-side event log**: `server.mjs` polls the gateway itself (every 5 s, always on) and records fixer/auto transitions
  to `~/.oracle/nibbi-events.jsonl`; the surface subscribes via SSE (`/nibbi/events`) — no more 6 s client polling, and
  events that happened while the window was closed are replayed as the "while you were away" bubble (exactly, not inferred).
- **macOS notifications** from the desktop shell when a fixer lands and Nibbi is hidden (Tauri notification plugin);
  Dock badge = staged fixers awaiting review.
- Gateway busy/rate-limited → Nibbi says "Oracle is mid-cron, your message is queued" instead of a silent wait.
- *Accept:* close the app for an hour while a fixer runs; reopen; the exact event is there and the badge was right.

### C. The review loop, deeper
- **Review mode** (`/review`): walk staged fixers one at a time — diff, tests result, artifacts, cost — with `j/k` next/prev,
  `a` approve (confirm), `x` discard/unqueue, `p` preview. Batch: `/review all` for a group merge (`/api/group-merge`).
- **Live tail** in the fixer card (SSE from `/api/fixer-tail`) and **steer with context**: `/steer <id>` while a file/line is
  referenced attaches it.
- **Spend caps per project** (`/api/auto spendCap`) and **model per project** in the project menu.
- Preview → screenshot: `/preview <id>` also captures `.oracle-shots/<id>.png` and shows it in the bubble.
- *Accept:* five staged fixers reviewed and merged from the keyboard in under two minutes, no misclick possible.

### D. Projects as places
- **Project page** (`/project <name>` bubble → richer): README summary, last 5 commits, open issues from the vault
  (`games/<p>/issues.md`), staged work, plan bar, auto — one screen that answers "where is this project".
- **`/issue <text>`**: files to the vault issues.md for the active project (Oracle triages: bug / balance / idea), with a
  `fix it` chip → `/fix`. This is how playtest reports become work.
- **`/new` templates**: `web` (vite + minimal page + `dev`/`build`/`deploy` scripts) or `game` (Oracle's rules/design
  scaffold) — today `/new` makes an empty repo.
- **Plan editing**: `/plan edit` → Oracle rewrites `plans/<p>.md` from a chat instruction; `/plan` shows the diff.
- *Accept:* start a web project from Nibbi and reach a running dev server + first fixer within ten minutes.

### E. Conversation polish (from `docs/CHAT-PLAN.md`, still open)
- Relative timestamps ("2 min ago") and day headers; code blocks capped at ~14 lines with expand; tables scroll.
- Streaming: render markdown on a 60 ms debounce (today rAF) to stop word-by-word reflow of lists.
- Search-as-you-type over history with jump-to-message; `/recent` remembers how far back you scrolled.
- Per-message actions on hover: copy, quote-reply, ask again (copy/ask exist).

### F. Voice worth using
- **Sentence-streamed TTS** (Oracle's old surface had it): speak the reply as sentences arrive, not only the `»voice:` line.
- **Barge-in**: talking while Nibbi speaks stops the audio; hold-`⌥Space` to talk, release to send.
- Voice default per device (on for the desk, off in a browser tab) instead of one global flag.
- *Accept:* a five-turn voice-only conversation with no keyboard.

### G. Character and delight (small, continuous)
- Idle behaviours that read as attention: glance at the pill when you start typing (exists), glance at a fixer's colour when
  it lands, a tiny ink splash in the fixer's colour on merge.
- Sound: three quiet ink sounds (send, land, error), off by default.
- Reduced-motion audit on the new pieces (project menu, jump button).

### H. Code health (so the above stays cheap)
- Split `app.js` into ES modules (`chat.js`, `commands.js`, `agents.js`, `project.js`, `voice.js`, `client.js`) — no bundler,
  `<script type="module">`; keep zero-build.
- Unit tests for the pure functions (`questionActs`, `humanError`, `toolLabel`, `renderDiff` parsing) with `node --test`;
  the playwright scenario suite in CI against the demo brain (`npm test`).
- A `CHANGELOG.md`; version bump per deploy (`/deploy nibbi` already rebuilds the app).

### I. Asks of the gateway (Oracle repo; Telegram excluded by request)
- `/api/events` SSE for fixer/auto transitions (B needs it, or the host polls — the host poll is the fallback).
- `»acts:` line in the system prompt (vault proposal; no code change needed).
- A `deploy` action per project so `/deploy` can run where the project's own script can't.

## Status (2026-09-03, v0.6): A–H shipped in one sitting; I.1 replaced by the host's own poll + SSE, I.2 adopted as SOUL policy 5, I.3 covered by `/deploy` running project scripts.

## Sequence (three sittings)
1. **Sitting 1 — meaning & memory**: A (`»acts:` proposal + rendering, regex fallback), B (host event log + SSE + exact away
   bubble), E timestamps/code caps. *Result:* chips make sense; nothing is missed.
2. **Sitting 2 — the review loop**: C (`/review`, live tail, spend caps), D `/issue` + project page. *Result:* battalion's M8
   is finished from the keyboard.
3. **Sitting 3 — voice & health**: F (sentence TTS, barge-in), H (modules, tests, CI), G polish. *Result:* a voice-only
   session works; the code is ready for the phone branch to rebase.

Then, with a week of real use: re-plan. The phone branch rebases after Sitting 3.

## How we'll know it's better
- Zero nonsensical chips in a day of transcripts (A).
- Zero missed fixer events across app restarts (B).
- Time from "staged" to "merged" for a routine fix under one minute, from the keyboard (C).
- A new web project reaches a running dev server from Nibbi in under ten minutes (D).
- Scenario suite stays at 0 console errors; unit tests cover every heuristic (H).

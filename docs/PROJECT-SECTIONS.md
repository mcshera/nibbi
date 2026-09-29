# Project pages

A project's work used to open as three sections — Builds, Issues and Plans — from a strip of tabs in the bar. Since 0.9.0 (the control panel, phase 1; `docs/CONTROL-PANEL.md` is the spec) it opens as **pages**, from rows in the bar's builds card. Chat is the default room: a page opens only when a row is chosen, and ×, Escape or a conversation row goes back to the conversation.

There is one build, **main**, and it holds its **improvements**: the open items of the project's `issues.md` and the runs started from free text. Plans left the UI. The roadmap file (`plans/<project>.md`) is unchanged and still drives automation, `/plan` and `/goal`; the project settings card says so in one line.

| page | opened from | what it holds |
|---|---|---|
| **main's build page** | main's row in the bar; a ticket's `main` crumb | play main (the owner's checkout, on whatever branch it is on), three tiles (what waits on you, the project's check, what landed this week), every improvement grouped the way the bar groups them, and what landed in main |
| **an improvement's ticket** | an improvement's row, in the bar or on the build page; a run's notification or chip | the big status (its word, the one fact that explains it, its keys, its facts), every try as a card (steps, checks, the log, the changes, GitHub), and what you asked |
| **Repository & GitHub** | the project settings card | the GitHub panel, as before |

An improvement's state is said in words, in one order everywhere: waiting on you (needs you, ready to review, and the GitHub delivery states) → building → up next → in → failed (interrupted runs sit with failed but are not verdicts). Up next is not a queue: nothing builds an up-next item on its own, and **build it now** is the one way from up next to building.

**+ improvement** is one inline form, in the bar and on the build page: **start now** dispatches a run straight away (`run.dispatch`), **up next** writes an open item into `issues.md` (`issue.create`). It never leaves the room it was opened in and never types into the composer.

The Builds lobby's review flow moved onto the ticket: play it, approve & merge and discard (each asks twice, on the page, before anything is sent), verify it, guide it, stop, try again. The lobby's keyboard review (j/k/a/x/p) went with the lobby; `/review` in the chat keeps it. A ticket is the whole retry chain, so Try again adds a try to the same ticket. In GitHub mode there is no approve & merge: runs land in the integration branch and the ticket's one ink key is its GitHub steps.

Only what starts an agent run — start now, build it now, try again — waits while nibbi is answering, and says so in words. Up next, edits, stop, merge, discard, play and opening pages all work during a reply.

Writes carry the revision the words were read against, so a save after `issues.md` changed under an open form is refused (*the list changed — your words are still here; save again*), keeps the words and the concurrent change, and the next save goes against the list as it is. The daemon has no issue delete: an up-next item is **marked done**, and a done one can be **reopened**. A merged try completes the issues it names.

Pages keep what they hold across updates and while they are away: focus, scroll, an open form and its words, an armed question, which tries are open, each try's tab, and a loaded log or diff (the same node, so a selection and the live tail survive a refresh; new run events join an open log in place).

`GET /api/project-section`, `GET /api/project-summaries` and `POST /api/project-command` remain the canonical read/write interface, unchanged. The app reads the builds and issues sections and `/api/play` for the project you are in and the page on screen; nothing reads `/api/project-summaries` or `/api/milestones` for the bar any more.

Implementation: `public/lib/builds-model.js` (runs, issues and GitHub summaries → main and its improvements; pure), `public/lib/project-pages.js` + `public/project-pages.css` (the pages), `public/lib/margin-ui.js` + `public/margins.css` (the bar), `public/lib/project-workspace.js` (the frame, and Repository & GitHub), and `public/app.js` (reads, routing, actions). The fixed shapes and words they share are in `public/lib/control-panel-contract.js`. Backend services are unchanged: `daemon/src/project-workspace.ts`, `project-issues.ts`, `workspace-documents.ts`, the fixer and previews.

Validation: `tests/builds-model.test.mjs`, `tests/project-pages-ui.test.mjs` and `tests/margin-ui.test.mjs` (literal view models, every state and key), and `tools/control-panel-verify.mjs` in `npm run verify` — twelve behaviour checks over the real routes and Git of `tools/project-workflow-fixture.mjs`, where a run really stages and really merges. `tools/project-workflow-verify.mjs` walks + improvement → up next → its ticket → edit the words → mark it done → reopen it, then build it now → staged → approve & merge → the issue done, and every page at four sizes with a preserved draft and attachment.

## Harness additions

A try's **log** tab renders the run's events as rows — kind badge, tool name, elapsed time, expandable input and summary, and a diff card for `edit_file`/`write_file` — using the same `public/lib/transcript.js` helpers as chat steps, filtered to the try's attempt. **Guide it** appears among a ticket's keys only while `allowedActions` includes `run.steer`, that is, while the fixer's provider is live. Approved plan steps arrive as ordinary independent runs carrying the reviewed title, pinned task id and issue ids; each is reviewed and merged on its own ticket. Details in `docs/HARNESS.md`.

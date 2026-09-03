# Nibbi — plan: from a face to a build tool

*Goal: Nibbi is the place Matty builds games and web projects with Oracle — talk, watch the work, review it, ship it —
without ever opening a dashboard.*

## Where it is (v0.3)

- One character, one pill. Streamed replies carried by a small live Nibbi + speech bubble; tool calls as folding step rows.
- Voice both ways (Kokoro / whisper on the gateway). Images in. Demo brain when the gateway is away.
- Agents: fixers and auto-mode foremen perch on the pill in their own ink colours; hover for state + log tail.
- `/play <project>` launches a project's dev server through the gateway's sanctioned launcher (policy stays tight).
- Desktop shell (`Nibbi.app`), scenario screenshot suite, design-critic review trail.
- v0.3: slash palette, project context + `/new`, `/fix` → `/diff` → `approve & merge` loop, fleet events in the chat,
  `/plan` with milestone bars + auto controls, foreman/fixer card actions, `/artifacts` `/report` `/history` `/vault` `/model`.

## What a build tool needs (gap analysis against the Oracle gateway)

| need | gateway has | Nibbi status |
|---|---|---|
| know which project we're on | `/api/projects` | **P0** `/project`, status-menu picker, chips follow it |
| start something new (web or game) | `POST /api/project-create` | **P0** `/new <name>` |
| report → fix → review → merge loop | `POST /api/fix`, `/api/fixer-diff`, `/preview`, `/approve`, `/api/fixer-steer`, `/api/fixer-stop` | **P0** `/fix`, `/diff` (inline diff viewer), confirm-to-merge, agent-card actions |
| know when work lands while you're away | fixer status transitions | **P0** fleet events posted into the chat with review chips |
| see the plan and what's next | `/api/milestones`, `/api/auto` (pending/staged) | **P0** `/plan` with progress bars + "dispatch next" |
| steer autonomy | `POST /api/auto` (off/suggest/stage/ship, concurrency, pause) | **P0** foreman card ladder, `/auto` |
| discover all of this without reading docs | — | **P0** slash palette (type `/`) |
| proof of work (screenshots, exports) | `/api/artifacts`, `/api/file` | **P1** artifacts inline in the fixer event + `/artifacts` |
| read/edit the brain (plans, issues, journal) | `/api/vault`, `/api/vault-write` | **P1** `/vault <path>` viewer; edits via Oracle |
| find past decisions | `/api/history?q=` | **P1** `/history <q>` |
| overnight report | `/api/build-report` | **P1** `/report` |
| model & cost control | `/api/model`, `/api/status` cost | **P1** `/model`, spend in status menu |
| run tests / previews for fixers | `/preview <id>` | **P1** preview chip on every staged fixer |
| playtest capture | `/playtest`, `/endtest` | exists; **P2** live "log a bug" mode with the mic |
| deploy | shipless deploy runbook (droplet) | **P2** `/deploy <project>` once the gateway exposes it |
| multi-surface parity | Telegram bot | **P2** Nibbi's `/play`, `/plan` as gateway commands so phone gets them too |

## Roadmap

**P0 — the build loop inside Nibbi (this pass) — ✅ shipped in v0.3, verified against the live gateway**
1. Slash palette: `/` lists every command (Nibbi's and Oracle's) with a one-line description; ↑↓ + Enter.
2. Project context: `/project [name]` (persisted), status-menu row, chips and `/fix` follow it.
3. `/new <name>` → creates + registers a repo (`~/OracleProjects/<slug>`), then offers "plan it" (Oracle writes `plans/<slug>.md`).
4. `/fix <issue>` → `POST /api/fix {project, issue}`; the fixer appears on the pill; the reply carries `diff · preview · stop`.
5. `/diff <id>` → inline diff viewer (diffstat header, coloured hunks, truncation note) with `approve & merge` (two-click confirm) · `preview` · `steer` · `stop`.
6. Fleet events: when a fixer finishes / fails / merges (polled every 6 s), Nibbi posts one bubble with the right chips.
7. `/plan [project]` → milestones with progress bars + auto state (pending / staged / in flight / spend) + `dispatch next`.
8. Auto controls: foreman card gets `pause`/`resume` and the off·suggest·stage·ship ladder; `/auto <project> <mode>`.
9. Utilities: `/steer`, `/stop`, `/model`, `/history`, `/vault`, `/report`, `/artifacts`, `/help`.

**P1 — proof and memory**
- Artifacts (screenshots) inline when a fixer lands; `/artifacts [project]` gallery bubble.
- Vault viewer with "ask Oracle to change this" chip; journal peek in the morning.
- Cost meter + rate-limit state in the status menu; per-turn cost already in meta.
- Playtest mode: mic-first bug capture, one bubble per report, auto-triage chips (bug · balance · idea).

**P2 — reach**
- Gateway-side `/play` `/plan` so Telegram gets them; push fleet events to Telegram when Nibbi is hidden.
- Deploy command per project (shipless first), with the same confirm-to-ship pattern.
- Second window / split for the diff viewer on wide screens; keyboard-only review flow (j/k, a, p).
- Tests for the surface: playwright scenario suite becomes CI (`npm run verify`).

## Principles that stay
- Nothing on screen unless it's needed; the character carries state before any panel does.
- Oracle's Bash policy stays tight — Nibbi uses sanctioned gateway actions, never widens permissions.
- Every irreversible action (merge, ship, stop) is a two-click chip.

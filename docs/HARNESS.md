# Harness: transcript, plans, steering

What the lead and Builds do as they do it, plan review before anything is queued, and redirecting a running turn or Build.

## Live tool transcript

Each governed call in a turn is one step under the reply. Folded, a step reads as the friendly label (`reading a page`, `editing`). Expanded, it shows the exact tool name (`web_fetch`, `edit_file`, `ext_<server>_<tool>`), the bounded input, and on finish a one-line summary, elapsed time, result size and ok/failed. `edit_file` and `write_file` add a diff card: `edit_file` diffs the replaced block with three lines of context (hunk numbers are block-relative); `write_file` shows every line as added.

Tool errors, unknown tools and tools the lease did not allow still appear as failed steps with the error as summary.

Bounding and redaction happen in the daemon (`daemon/src/tool-transcript.ts`) before anything is streamed or stored:

| rule | limit |
|---|---|
| keys matching `token`, `secret`, `password`, `api[_-]?key`, `authorization`, `cookie` | value shown as `[redacted]` |
| any string | clipped to 400 chars |
| collections | 50 entries, depth 4 |
| whole input | ≤ 2 KB; largest fields become `[…]` |
| summary; diff | ≤ 300 chars; ≤ 4 KB with lines ≤ 500 chars |

Redaction is by key name only: a secret pasted into a `write_file` or `shell` argument is shown, clipped. The transcript is owner-visible, not scrubbed.

Provider-native tools (`Read`, `Skill`…) are name-only — a started step with no input, summary or finish, because the provider reports them without arguments or results. The provider's own notice for a governed call is dropped, so each governed call is one row.

Steps persist with the chat transcript (40 per turn, diffs to 2 KB) and restore folded after reload. Screen readers hear one line per turn ("6 steps in 14s · 1 failed").

A Build's **Log** tab renders the same rows with `public/lib/transcript.js` from `GET /api/fixer-log?id=<run>&attemptId=<attempt>` (last 250 events, one attempt when given).

## Plan before dispatch

Plan mode asks the lead to propose steps without dispatching. Both entry points need a registered project: `/plan propose <what you want>`, or the **Plan first** toggle beside send followed by a normal message.

The turn streams like chat, then a review card arrives: summary, rationale, and each step with its title, the task instruction a Build will receive, the pinned roadmap task (id, text, milestone) or none, linked issue ids, context, and dependencies. Dependencies are for review only; execution neither orders nor merges. Warnings list what was corrected: a `taskId` that is not in the roadmap, already done, ambiguous, or pinned by another step keeps its text without a pin; duplicate, self-referential or out-of-range dependencies are dropped. A reply with no ```json fence, bad JSON or an invalid shape (1–12 steps) is stored as a failed proposal with the error.

- **Approve** (confirm chip) runs `plan.execute {id, fingerprint}`. Each step becomes one independent Build (same path as "Build a fix") carrying the reviewed title, pinned task id, context and issue ids. Nothing merges; every Build gets its usual review.
- **Adjust** puts your prompt back in the composer in plan mode.
- **Cancel** runs `plan.cancel`; only a prepared plan can be cancelled.

A proposal expires 30 minutes after preparation. Its fingerprint, `sha256(steps + roadmapRevision)`, is recomputed at execution. Any roadmap edit after the review — a ticked or moved task — fails approval with `REVIEW_CHANGED:`; propose again, since pinned ids and milestones may no longer mean what you reviewed. Other refusals name the state: `PLAN_EXPIRED:`, `PLAN_CANCELLED:`, `PLAN_EXECUTED:`, `PLAN_FAILED:`, and `PLAN_INTERRUPTED:` after a backend restart mid-queue (check Builds first). Approving twice is idempotent. `GET /api/plans?project=<id>` lists the last 20 proposals; `?id=` inspects one.

## Mid-run steering

While a turn is running the composer stays open. Sending text delivers it to the running provider as guidance (`turn.steer`), adds a `steer` step to the live turn and clears the input; the send button reads **steer**. Sending with an empty composer still stops the turn.

Guidance reaches only a live primary provider that supports it (Claude, Codex; not LOCAL chat). Each turn's `ready` frame says whether it is steerable, and `GET /api/status` carries `activeTurn: {runId, provider, steerable}`. When unavailable, the composer shows a toast and the daemon refuses with one of:

| condition | error |
|---|---|
| no turn running | `Turn is not active` |
| fell back to LOCAL chat | `Turn has left the primary provider; LOCAL chat cannot take guidance` |
| provider lacks steering | `The <provider> provider cannot take guidance mid-turn` |
| provider not started yet | `Turn is still starting; guidance can follow once the provider is running` |

Guidance is 1–20,000 characters and is not scrubbed.

Builds: agent cards and the workspace offer **Guide** (`run.steer`) only while the fixer's provider is live; `/steer <build-id> <note>` does the same from the composer. Otherwise: `Run is not steerable`.

## Evidence trail

Tool and steer events sit under the run id (`GET /api/fixer-log?id=`); `plan.*` events carry only the project id and appear on the live event stream (`GET /api/events`), the proposal itself via `GET /api/plans`.

| event | payload |
|---|---|
| `tool.attempted` | `name`; every request, denied tools included |
| `tool.started` | `name, source, input`; `attemptId` on Builds |
| `tool.finished` | `name, source, ok, summary, error?, bytes, elapsedMs, diff?` |
| `turn.steered` | `text` (first 400 chars) |
| `plan.proposed` | `id, steps:[{n, title, taskId}]` |
| `plan.executed` | `id, runIds` |
| `plan.cancelled` / `plan.failed` | `id`; on failure `error` and any `runIds` already queued |

Each steer also writes a chat-history row as you, `[STEER] <guidance>`, tagged with the run id, so continuity and `search_chat` see the redirect beside the message it altered. `web.*` and `mcp.called` events are unchanged (`WEB-TOOLS.md`, `MCP.md`).

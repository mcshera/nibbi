# Progress

Nibbi keeps a small, durable record of real delivery and lets the character react to it. This page says what counts, what does not, and why nothing here pushes you toward a next goal.

## What counts

A delivery is a Build whose change actually reached its integration branch: a verified local fast-forward merge, or a GitHub pull request whose merge was confirmed by GitHub and whose merged commit passed the project's checks again. Both paths call the same recorder, and each Build is counted once no matter how many paths notice it (bucket `progress-deliveries`, keyed by run id).

After the merge writes finish, the recorder re-reads the roadmap and the issue notes. A task counts as completed only if the roadmap now shows it done; an issue counts only if its note is now checked. A milestone counts as completed the first time the last task under its `##` heading flips to done (bucket `progress-milestones`, one record per project and milestone, so it can never fire twice).

Days are local calendar days. Each day's rollup lives in `progress-days/<YYYY-MM-DD>` with the deliveries, tasks, issues and milestones recorded that day. The three writes for one delivery happen in a single transaction: either the day rollup, the milestone record and the exactly-once marker all land, or none do and the next completion path records the delivery instead.

## What does not count

Staged, unverified or failed Builds. Work another client merged that Nibbi never verified. Plan tasks ticked by hand in the roadmap file. Time spent, messages sent, or tool calls made. None of these move any number here.

## What you see

- `GET /api/progress` and the live snapshot carry `{today, week, streak, lastDeliveryAt, recent, available}`. `week` covers the seven calendar days ending today. `streak` is the number of consecutive local days, ending today or yesterday, with at least one delivery.
- The sidebar shows one quiet line: "2 merged today · 5 this week · 3-day streak", or "Nothing merged yet today", or "Progress not available" when the backend has not reported.
- Events: `progress.updated {day, delta, summary}` after every recorded delivery, `milestone.completed {project, milestoneId, name, total, runId}` once per milestone, `progress.record_failed {message}` if recording itself failed (the merge is never undone by a recording failure).
- The morning brief and the weekly review receive `PROGRESS FACTS` appended to their prompts, labelled as data rather than a target. The heartbeat and consolidation schedules do not.

## Narration

Delivery events produce authored lines in Nibbi's voice, each with a one-sentence spoken version: a draft PR going up, checks failing with the first failing check named, a PR branch changed outside Nibbi, a merge (with the completed task named when there is one), a milestone closing, and a streak growing. The character plays a matching beat (a small hop for a delivery, a taller one for a streak, a peek for a draft, a puff for failed checks, a wiggle for attention). Celebrations wait until the current turn ends; only the attention wiggle may interrupt work.

The merge line ends with the fact. There is no "next up", no suggested target, and the streak line appears only when the streak grew. A win is allowed to be a win.

# Builds, Issues, and Plans improvement plan

Status: all three passes are implemented on `v2` and installed in Nibbi. Integrated workflow, desktop/mobile, and native verification passed. The original plan below was based on the native app on September 9, 2026.

## Direction

Give each section a clear job: Issues capture what needs attention; Plans explain the intended outcome and sequence; Builds show execution, evidence, and the next review decision. Every section should make its next useful action apparent. Preserve Nibbi's paper surface, restrained lists, and Velvet Pool character.

## Informative navigation

Keep the familiar icon and section name, add a compact status badge, and use at most one muted supporting line. These are illustrative values, not current project data:

| Button | Main status | Supporting information |
| --- | --- | --- |
| Builds | `2 review` | `1 running · 1 failed` when relevant |
| Issues | `7 open` | Later: `2 linked builds`, once associations are stored |
| Plans | `3/8 tasks` | Name of the current milestone, when explicitly selected |

- Builds prioritizes reviewable work in its badge, then failed/interrupted work, then active work. When settled, show a quiet history count. Cover preparing, checking, queued, cancelled, discarded, and superseded states with consistent human labels. A workflow status never implies that checks passed.
- Issues counts all open items, including any being worked on. Completed items stay in the view's filter count. Prose-only issue notes say `Notes`; a confirmed empty list says `No issues`.
- Plans uses completed/total tasks with an accessible label saying exactly that. For prose-only plans, use `Written plan` rather than a fabricated count or draft status; if all tasks are complete, show `Complete`. Use `No plan` only after a successful empty read. Do not infer a current milestone or a next task from completion percentage alone; an ordered first unfinished task can be labeled `First unfinished`.
- The section tabs repeat the same primary values. Clicking the main button opens that section and restores its last filter and scroll position. Counts are part of the button, not tiny nested click targets.
- Keep labels visible on small screens, use at least 44px touch targets, and include the full project/status in accessible names. Show uncertainty as `Unavailable` or a stale-data indication; never flash zero while loading. Preserve counts while refreshing, along with their freshness state.
- When a project is collapsed, its parent row can retain the most useful activity summary. When expanded, avoid repeating the same metrics above the three section buttons.

## Builds: make review and recovery obvious

1. Group active work, work awaiting review, and settled history. Provide counted filters for Active, Review, Failed, and History. Keep an expanded or focused row stable as live updates arrive.
2. Each row shows the build's purpose, workflow status, verification result, and relevant time. Move provider and cost into secondary detail. Label verification as Passed, Failed, Not verified, or Unavailable according to actual evidence.
3. Keep the change summary, diff, checks, and log inside a build detail view. On narrow screens use the available workspace for that detail, with a clear return to the list. Preserve conversation drafts and the list position.
4. Offer an appropriate next action: Review changes for staged work, Inspect failure and Retry for failed work, and View result/history for merged work. Running work exposes its reported current activity without an invented percentage. Reuse existing stop, verify, retry, discard, preview, and merge commands where eligible; retain their existing confirmation and verification rules.

## Issues: make a problem inspectable and actionable

1. Add counts to Open and Completed filters, search, and optional grouping by the source headings. Let each issue open its own description and reproduction notes rather than requiring the full document disclosure.
2. Replace the current checkbox-looking status spans with honest status indicators. Introduce real complete/reopen controls only when their changes can be safely persisted.
3. Add a small inline issue form and issue editing. Keep title and description sufficient for the first version; retain full source notes. After saving, show the saved item and clear success or conflict feedback.
4. Add `Build a fix` and `Add to plan` actions with persisted references. Show a related build's actual state and prevent duplicate dispatch. A build finishing does not automatically resolve an issue. Resolution requires the defined completion action or an explicitly linked, successfully merged fix.

## Plans: show direction and the next decision

1. Lead with the plan's outcome and any explicitly selected milestone or goal. Show unfinished work before the completed history; on a fully complete plan, offer to plan the next milestone.
2. Make each milestone expand into its tasks. Show its own completed/total count, task descriptions, and existing build links. Keep narrative context available through `Read full plan`, avoiding a repeated milestone list followed by the same undifferentiated document.
3. Offer `Build this task` for eligible unfinished tasks, carrying its canonical task ID into the existing dispatch flow. Clearly distinguish planned, building, awaiting review, and completed work when those states are backed by actual runs. A staged build leaves its task unfinished until a successful merge.
4. Provide direct editing for milestone/task text and ordering after revision-aware writes exist. While changes still happen through the composer, label that action `Discuss plan changes`. Preserve completed tasks, prose, and task identities through edits.

## Delivery order and dependencies

| Pass | Work | Result |
| --- | --- | --- |
| 1. Trustworthy summaries | Share status/count rules; expose a canonical plan read model; add informative sidebar buttons and matching tab counts; refresh on relevant events and reconnection | The navigation accurately explains what is inside each section |
| 2. Better section views | Build grouping and inline evidence, issue search/details and clear status indicators, expandable plan milestones, retained filter/scroll state | Users can understand work and inspect evidence without losing their place |
| 3. Connected actions | Revision-aware edits, stable issue IDs, persisted issue/plan/build links, inline capture/editing, contextual dispatch and resolution | Capture → plan or build → review → completion becomes a traceable workflow |

Pass 1 can derive build summaries from existing runs. Issue counts currently require vault reads; fetch summaries only for expanded/visible projects with bounded concurrency and caching, or add a batched read endpoint. Reuse one summary state for sidebar and content. Coalesce event refreshes and reject late responses after project switches.

Plan parsing needs consolidation: the frontend and backend currently recognize different checkbox formats and handle code fences differently. Extend the existing canonical roadmap service to expose IDs and consistent counts to the browser. Retain the existing build-to-plan `taskId` relationship and merge-driven completion.

Issue-to-build references require new persisted identity; prompt text is not an issue ID. Document writes need an expected revision/hash and conflict handling before inline editing, because atomic file replacement alone does not prevent overwriting concurrent changes. Preserve legacy markdown and prose. Project downloads remain excluded until artifacts have project provenance.

For short windows, allow the composer to collapse to a visible draft/ask control while reading. Preserve its text and attachments, make reopening explicit, and return to the full composer for typing. Verify this with the existing voice controls and native layout.

## Acceptance

- Sidebar counts, tab counts, and visible records agree for the same project and revision; empty, unknown, partial, stale, and prose-only states remain distinct.
- New build events update relevant summaries without resetting focus, filters, or scroll. Large project lists do not trigger a full-vault fetch on every status update.
- Build evidence and all create/edit flows preserve chat drafts and attachments. Actions identify their destination, pending state, result, and failure recovery.
- Issue and plan edits preserve unrelated text and reject stale revisions. Links survive title changes and reordering; no associations are guessed from titles.
- The capture/build/review/completion path works on native desktop and narrow or short browser layouts with keyboard access and meaningful touch targets.

Implementation targets: `public/lib/project-workspace.js`, `public/lib/project-data.js`, `public/lib/margin-ui.js`, their CSS, and `public/app.js`; backend read/command additions belong alongside the existing roadmap, fixer, and vault services. Implementation and installation evidence is tracked in `output/project-workflow-install/COMPLETION-AUDIT.md`.

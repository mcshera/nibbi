# Project sections

Each project expands in the sidebar to Builds, Issues, and Plans. Buttons and section tabs share canonical status counts: review/active/failed builds, open issues with linked build counts, and completed/total plan tasks with an explicitly selected milestone. Loading, unavailable, stale, empty, and prose-only documents have distinct labels. Summary reads are cached, batched, and limited to visible or selected projects.

Builds groups Active, Review, Failed, and History with counted filters. Expand a build to read its summary, changes, checks, and log in the workspace. Workflow status and verification evidence remain separate. Available stop, retry, verify, guide, preview, discard, and merge actions follow backend eligibility; stop, discard, and merge require confirmation. Narrow screens provide a return to the build list.

Issues supports search, source-heading grouping, descriptions, inline creation/editing, and persisted completion/reopening. Build a fix and Add to plan retain stable issue IDs and prevent duplicate links or dispatch. Source notes remain available separately.

Plans shows the outcome, selected milestone, first unfinished task, expandable milestone tasks, and completed history. Create/edit milestones and tasks inline, move tasks between milestones, change ordering, or build a canonical task. Task and issue links survive title changes. A staged build leaves linked records unfinished; only a successful linked merge completes them automatically.

Writes require the expected document revision and preserve Markdown, identities, descriptions, and completed work. Conflicts retain the open form and draft. Invalid creations hidden by an unfinished code fence are rejected before writing. Live reads preserve focused controls and unsaved forms; deferred updates can be applied explicitly. Navigation retains filters and scroll. The composer keeps its draft and attachments and can collapse in short windows; voice controls stay available.

`GET /api/project-section`, `GET /api/project-summaries`, and `POST /api/project-command` provide the canonical read/write interface. Existing governed commands still execute builds and previews. Global exports remain excluded until they have project provenance.

Implementation lives in `public/lib/project-workspace.js`, `project-data.js`, `project-summary.js`, their CSS, and the sidebar/app integration. Backend services live alongside the roadmap/fixer code in `daemon/src/project-workspace.ts`, `project-issues.ts`, and `workspace-documents.ts`.

Validation includes 16 data/summary/UI tests, 32 isolated candidate backend regressions, and 11 integrated browser scenarios. The browser scenarios use the actual compiled HTTP routes, temporary SQLite/vault/Git projects, and deterministic provider fixtures; they cover issue → plan → build → verified review → confirmed merge, conflicts, inline creation/editing, and four desktop/mobile sizes with preserved draft/attachment and mock microphone controls. Existing desktop/mobile voice regressions pass all 44 checks. No live project was modified by those scenarios.

The accepted candidate is built from reproduced installed controls plus only the approved workflow delta. Unrelated unpublished changes are excluded; the Velvet Pool renderer and native binary are unchanged. Current installation and preservation evidence is in `output/project-workflow-install/`, with the requirement audit in `COMPLETION-AUDIT.md`. The original improvement specification is `docs/PROJECT-SECTIONS-IMPROVEMENT-PLAN.md`.

## Harness additions

A build's **Log** tab renders the run's events as rows — kind badge, tool name, elapsed time, expandable input and summary, and a diff card for `edit_file`/`write_file` — using the same `public/lib/transcript.js` helpers as chat steps, filtered to the selected attempt. **Guide build** appears among a build's actions only while `allowedActions` includes `run.steer`, that is, while the fixer's provider is live. Approved plan steps arrive in Builds as ordinary independent runs carrying the reviewed title, pinned task id and issue ids; each is reviewed and merged on its own. Details in `docs/HARNESS.md`.

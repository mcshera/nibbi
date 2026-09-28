/** The control panel's one shared shape, phase 1 (docs/CONTROL-PANEL.md is the spec; it binds).
 *
 *  Typedefs and frozen constants only: no logic, no imports, no DOM, no clock. Three modules meet here:
 *    public/lib/builds-model.js   makes the view models (pure)
 *    public/lib/margin-ui.js      draws the bar from them
 *    public/lib/project-pages.js  draws the build page and the ticket page from them
 *  and public/app.js feeds the first and wires the other two. Nobody edits this file during phase 1
 *  except the integrator; a builder who finds it wrong conforms to it and says so in their commit.
 *
 *  Phase 1 is one build, `main`, holding its improvements (the work that lands in it). An improvement
 *  is an issues.md item (kind 'issue') or a run started from free text (kind 'run'); its attempts are
 *  the runs linked to it. Words are lowercase and spoken (design/LANGUAGE.md §11); colour only on
 *  machine verdicts (tone 'pass' | 'error'). */

export const PHASE = 1;
/** The one build in phase 1. Its `branch` is where runs really land (see BuildVM.branch). */
export const MAIN = 'main';

/* ------------------------------------------------------------------------------------------ ids */

/** An improvement's id: `issue:<issues.md id>` or `run:<the first run of its retry chain>`. Stable
    across Try again (run.retry makes a new run whose replacesBuildId points back, fixer.ts:292-302). */
export const ID_PREFIX = Object.freeze({ issue: 'issue:', run: 'run:' });

/** The DOM hooks every builder and every tool uses. Rows never carry data-build-id (the lobby's, gone). */
export const ATTR = Object.freeze({
  barBuild: 'data-bar-build',             // the bar's build row: "main"
  barImprovement: 'data-bar-improvement', // the bar's improvement row: an ImprovementId
  group: 'data-cp-group',                 // a bar card: "conversations" | "builds"
  page: 'data-cp-page',                   // a page root: "build" | "ticket"
  pageId: 'data-cp-id',                   // a page root's id: "main" | an ImprovementId
  run: 'data-cp-run',                     // a try card on the ticket page: its run id
  key: 'data-cp-key',                     // a page control's stable key (focus survives a re-render)
  role: 'data-cp-role',                   // a bar control's role: "new-improvement" | "play-main" | "improvement-form" | …
  state: 'data-state',                    // an improvement's StateId, on its bar row and page row
  status: 'data-status',                  // a page status panel or try card: StateId (a verdict hook style-verify accepts)
  tone: 'data-tone',                      // a word's Tone
});

/** Ids the suites and the owner pin. They move with their elements (docs/CONTROL-PANEL.md §2.4); none is renamed. */
export const PINNED_IDS = Object.freeze([
  'workspace-sidebar', 'sidebar-toggle', 'sidebar-toggle-count', 'project-rail', 'settings-rail', 'status', 'sidebar-progress',
  'feed', 'pill', 'ask', 'send', 'toast', 'project-workspace',
]);

/* ------------------------------------------------------------------------------------------ states */

/** Every state an improvement can be in. */
export const STATES = Object.freeze([
  'needs_you', 'ready', 'to_push', 'pull_request', 'pr_ready', 'needs_attention',
  'building', 'up_next', 'in', 'failed', 'interrupted', 'stopped', 'discarded', 'done',
]);

/** The word a state says: on its bar row (right-hand word), its page row and its ticket's big status. */
export const STATE_WORDS = Object.freeze({
  needs_you: 'needs you', ready: 'ready to review', to_push: 'to push', pull_request: 'pull request open',
  pr_ready: 'ready to merge', needs_attention: 'needs a look', building: 'building', up_next: 'up next', in: 'in',
  failed: 'failed', interrupted: 'interrupted', stopped: 'stopped', discarded: 'discarded', done: 'done',
});

/** How a word is inked. Only 'pass' and 'error' take colour, and only because they are machine verdicts. */
export const STATE_TONES = Object.freeze({
  needs_you: 'attention', ready: 'attention', to_push: 'attention', pull_request: 'attention', pr_ready: 'attention',
  needs_attention: 'error', building: 'active', up_next: 'quiet', in: 'pass', failed: 'error',
  interrupted: 'attention',   // the backend stopped under it; nothing judged the work (project-summary.js:34-36)
  stopped: 'quiet', discarded: 'quiet', done: 'quiet',
});

/** States whose word pulses (the one motion for "work is happening", LANGUAGE §7.2). */
export const LIVE_STATES = Object.freeze(['building']);

/** The order improvements are listed in, bar and build page alike: what waits on you, what is moving,
    what is next, what landed, what failed. ROUND4.md decided 6 (building → up next → in → failed),
    with ROUND3.md decided 3's "waiting on you first" in front, since phase 1 has a review step. */
export const GROUPS = Object.freeze([
  Object.freeze({ id: 'waiting', label: 'waiting on you', states: Object.freeze(['needs_you', 'needs_attention', 'pr_ready', 'to_push', 'pull_request', 'ready']) }),
  Object.freeze({ id: 'building', label: 'building', states: Object.freeze(['building']) }),
  Object.freeze({ id: 'up_next', label: 'up next', states: Object.freeze(['up_next']) }),
  Object.freeze({ id: 'in', label: 'in', states: Object.freeze(['in']) }),
  Object.freeze({ id: 'failed', label: 'failed', states: Object.freeze(['failed', 'interrupted']) }),
]);
/** Settled: never listed in the bar (unless its ticket is the one open), only in the build page's history. */
export const SETTLED = Object.freeze(['stopped', 'discarded', 'done']);

/** A run's status → the state of the try (and of its improvement when it is the latest try). Local mode.
    RunStatusSchema (shared/src/index.ts:8) plus the legacy 'done' (= staged, fixer.ts:67) and the phase
    names project-summary.js:3 still accepts. null: superseded is an earlier try, never an improvement's state.
    An issue-kind improvement whose latest try is stopped or discarded is up_next again (the item is still open). */
export const RUN_STATES = Object.freeze({
  queued: 'up_next', preparing: 'building', installing: 'building', running: 'building', checking: 'building',
  verifying: 'building', merging: 'building', awaiting_input: 'needs_you', staged: 'ready', done: 'ready',
  merged: 'in', failed: 'failed', interrupted: 'interrupted', cancelled: 'stopped', discarded: 'discarded', superseded: null,
});

/** A staged run in a GitHub-mode project (run.github.mode === 'github'): the first flag that is true on
    run.github (github-builds.ts:186-189) decides; none true → 'ready'. */
export const GITHUB_STAGED = Object.freeze([
  Object.freeze(['needsAttention', 'needs_attention']), Object.freeze(['remoteChanged', 'needs_attention']),
  Object.freeze(['readyPR', 'pr_ready']), Object.freeze(['pullRequest', 'pull_request']), Object.freeze(['toPush', 'to_push']),
]);

/** The builds card's badge and the project's attention words: the first state with a count wins.
    [state, one, many, tone] — `{n}` is the count. 'failed' counts failed only; 'interrupted' its own. */
export const BADGE = Object.freeze([
  Object.freeze(['needs_you', '{n} needs you', '{n} need you', 'attention']),
  Object.freeze(['needs_attention', '{n} needs a look', '{n} need a look', 'error']),
  Object.freeze(['pr_ready', '{n} ready to merge', '{n} ready to merge', 'attention']),
  Object.freeze(['to_push', '{n} to push', '{n} to push', 'attention']),
  Object.freeze(['pull_request', '{n} pull request open', '{n} pull requests open', 'attention']),
  Object.freeze(['ready', '{n} ready to review', '{n} ready to review', 'attention']),
  Object.freeze(['failed', '{n} failed', '{n} failed', 'error']),
  Object.freeze(['interrupted', '{n} interrupted', '{n} interrupted', 'attention']),
  Object.freeze(['building', '{n} building', '{n} building', 'active']),
]);
/** Only these badge tones become the project's attention (the collapsed toggle, the switcher, the menu
    rows, "N others need you"). 'active' ("2 building") shows on the toggle too, never in the rollup. */
export const ATTENTION_TONES = Object.freeze(['attention', 'error']);

/** What the bar shows inside main (margin-ui.js applies these; the VM carries every row). */
export const BAR_LIMITS = Object.freeze({
  upNextShown: 3,          // past this: one fold row "N more up next"
  inWindowMs: 86_400_000,  // 'in' rows show only when they landed in the last day…
  inShown: 3,              // …and at most this many
  failedFoldAbove: 2,      // more failed + interrupted than this: one fold row "14 failed", no rows until opened
});
/** What the model keeps for the build page. */
export const PAGE_LIMITS = Object.freeze({ inKept: 20, settledKept: 20, failedShown: 5 });

/* ------------------------------------------------------------------------------------------ actions */

/** Every name the bar and the pages send, as onAction(name, projectId, value). Payloads: ActionPayloads below. */
export const ACTIONS = Object.freeze({
  openBuild: 'openBuild', openImprovement: 'openImprovement', backToChat: 'backToChat',
  startImprovement: 'startImprovement', queueImprovement: 'queueImprovement', playMain: 'playMain',
  buildIssue: 'buildIssue', editImprovement: 'editImprovement', completeImprovement: 'completeImprovement', reopenImprovement: 'reopenImprovement',
  stopRun: 'stopRun', steerRun: 'steerRun', retryRun: 'retryRun', verifyRun: 'verifyRun', mergeRun: 'mergeRun', discardRun: 'discardRun',
  previewRun: 'previewRun', talkAbout: 'talkAbout', refresh: 'refresh',
  buildEvidence: 'buildEvidence',   // existing name and payload ({id, kind, attemptId?}), app.js handleProjectAction
});
/** What margin-ui.js sends that is new. It keeps every existing name (selectProject, newProject, thread,
    newThread, renameThread, archiveThread, repository, autoMode, spendCap, providers, the settings prefs…)
    except projectSection, fix, plan, play and review, which go. */
export const BAR_ACTIONS = Object.freeze(['openBuild', 'openImprovement', 'backToChat', 'startImprovement', 'queueImprovement', 'playMain']);
/** What project-pages.js sends (plus githubRead / githubCommand / githubRefresh, passed through the GitHub panel). */
export const PAGE_ACTIONS = Object.freeze([
  'openBuild', 'openImprovement', 'backToChat', 'startImprovement', 'queueImprovement', 'playMain',
  'buildIssue', 'editImprovement', 'completeImprovement', 'reopenImprovement',
  'stopRun', 'steerRun', 'retryRun', 'verifyRun', 'mergeRun', 'discardRun', 'previewRun', 'talkAbout', 'refresh', 'buildEvidence',
]);
/** Anything that starts an agent run waits for nibbi's reply (ROUND3.md decided 4); nothing else does. */
export const WAITS_FOR_REPLY = Object.freeze(['startImprovement', 'buildIssue', 'retryRun']);
/** Refused in demo: every daemon write, and play. */
export const REFUSED_IN_DEMO = Object.freeze([
  'startImprovement', 'queueImprovement', 'playMain', 'buildIssue', 'editImprovement', 'completeImprovement', 'reopenImprovement',
  'stopRun', 'steerRun', 'retryRun', 'verifyRun', 'mergeRun', 'discardRun', 'previewRun',
]);

/* ------------------------------------------------------------------------------------------ words */

/** Fixed copy. `{…}` are filled by whoever renders; everything is lowercase (LANGUAGE §11, audit P14). */
export const WORDS = Object.freeze({
  busy: 'nibbi’s answering — this can start once the reply lands',
  demoStart: 'the demo brain can’t start builds — turn it off in settings',
  demoPlay: 'the demo brain can’t play builds — turn it off in settings',
  demoChange: 'the demo brain can’t change project work — turn it off in settings',
  noList: 'couldn’t read the list of improvements — try again in a moment',
  reading: 'a moment — reading where this one is',
  noPlay: '{project} has nothing to play yet',
  noCheck: 'this project has no check set — nothing can merge until it has one',
  unverified: 'it hasn’t passed its checks — verify it before it can merge',
  cantMerge: 'it can’t merge right now',
  gone: 'this improvement is gone',
  emptyImprovements: 'nothing to improve yet — or ask nibbi what it would change',
  homeLine: 'the first conversation',
  answering: 'answering',
  foldFailed: '{n} failed',
  foldUpNext: '{n} more up next',
  showFewer: 'show fewer',
  mainLine: 'live · what ships',
  mainLineOther: 'live · lands on {branch}',
  mainKicker: 'the live build',
  ticketKicker: 'improvement in',
  checkout: 'plays your checkout · on {branch}',
  form: Object.freeze({
    label: 'what should change?', placeholder: 'a sentence is plenty',
    hint: 'start now builds it right away · up next keeps it in the list until you start it',
    start: 'start now', queue: 'up next', close: 'close (esc)',
  }),
  keys: Object.freeze({
    improvement: 'improvement', playMain: 'play main', open: 'open it', stopPlaying: 'stop playing', playRun: 'play it',
    buildNow: 'build it now', edit: 'edit the words', save: 'save the words', markDone: 'mark it done', reopen: 'reopen it',
    cancelQueued: 'cancel it', guide: 'guide it', send: 'send it', stop: 'stop', stopYes: 'stop it', stopNo: 'keep building',
    merge: 'approve & merge', mergeYes: 'confirm merge', discard: 'discard', discardYes: 'confirm discard', keep: 'keep it',
    verify: 'verify it', github: 'the github steps', changes: 'see its changes', ask: 'ask nibbi about it', retry: 'try again',
    cancel: 'cancel', close: 'Close and return to the conversation',   // the ×'s accessible name, pinned by the suites
  }),
  confirm: Object.freeze({
    merge: 'merge “{title}” into {branch}? nibbi runs the checks again on the merged code first.',
    discard: 'discard “{title}”? it leaves review — its branch and worktree are kept.',
    stop: 'stop try {n}? what it has done so far stays in its worktree — {branch} is unchanged.',
  }),
});

/* ------------------------------------------------------------------------------------------ typedefs */

/** @typedef {'quiet'|'active'|'attention'|'pass'|'error'} Tone */
/** @typedef {'needs_you'|'ready'|'to_push'|'pull_request'|'pr_ready'|'needs_attention'|'building'|'up_next'|'in'|'failed'|'interrupted'|'stopped'|'discarded'|'done'} StateId */
/** @typedef {'waiting'|'building'|'up_next'|'in'|'failed'|'settled'} GroupId */
/** @typedef {string} ImprovementId  `issue:<id>` | `run:<root run id>` */
/** @typedef {'build'|'ticket'|'repository'} PageKind */

/** Where the main area is. null in S.projectView is the chat (the default).
 * @typedef {Object} PageRef
 * @property {string} project
 * @property {PageKind} page
 * @property {string|null} id   'main' for page 'build'; an ImprovementId for 'ticket'; null for 'repository'
 */

/** @typedef {{ text: string, tone: Tone }} Words */

/** One improvement: a bar row, a build-page row, and the head of its ticket.
 * @typedef {Object} ImprovementVM
 * @property {ImprovementId} id
 * @property {'issue'|'run'} kind
 * @property {string} title        the owner's words (issue text, or the run's title) — never cut in the VM
 * @property {StateId} state
 * @property {string} word         STATE_WORDS[state]
 * @property {Tone} tone           STATE_TONES[state]
 * @property {boolean} live        LIVE_STATES.includes(state)
 * @property {GroupId} group
 * @property {string} context      line two's left words, with no relative time in them ('' is allowed)
 * @property {{ verb: string, at: string }|null} when   line two's time: the renderer says `${verb} ${ago(at)}` ("started 4m ago", "landed 2h ago", "queued just now")
 * @property {string} reason       why it failed / stopped, first line, ≤ 160 chars ('' otherwise)
 * @property {string|null} issueId
 * @property {string[]} runIds     its tries, oldest first
 * @property {string|null} latestRunId
 * @property {number} order        sort key inside its group (lower first)
 */

/** Play, for main (the project's own dev server, previews.ts:43-55) or for one run's preview (previews.ts:11-35).
 * @typedef {Object} PlayVM
 * @property {boolean} playable
 * @property {boolean} running
 * @property {boolean} starting
 * @property {string|null} url
 * @property {string} blocked     '' or why Play can't run now (WORDS.noPlay / WORDS.demoPlay)
 * @property {string} note        main only: WORDS.checkout filled with the checked-out branch ('' for a run)
 * @property {string} lastCommit  main only: '%h %s (%cr)' from /api/projects ('' when unknown)
 */

/** The phase-1 build.
 * @typedef {Object} BuildVM
 * @property {'main'} id
 * @property {'main'} name
 * @property {string} branch       where runs land: local → the newest run's targetBranch, else the project's targetBranch, else its checked-out branch; github → connection.integrationBranch
 * @property {string} line         WORDS.mainLine, or WORDS.mainLineOther when branch !== 'main'
 * @property {'live'} word
 * @property {Words} badge         the builds card's badge (BADGE); text '' when nothing to say
 * @property {Words} attention     what the project wants from you (badge when its tone is in ATTENTION_TONES, else "{n} building", else '')
 * @property {{ waiting: number, needsYou: number, ready: number, building: number, upNext: number, in: number, inToday: number, failed: number, interrupted: number }} counts
 * @property {PlayVM} play
 * @property {{ command: string, real: boolean }} check     the project's check (projects.ts GameCfg.check); real = not '', 'true', ':' or 'echo …' (fixer.ts:94)
 * @property {{ mode: 'github'|'local', repository: string|null, integrationBranch: string|null, releaseBranch: string|null }|null} github
 * @property {ImprovementVM[]} improvements   every non-settled improvement, ordered by GROUPS then `order`; 'in' capped at PAGE_LIMITS.inKept
 * @property {ImprovementVM[]} settled        stopped / discarded / done, newest first, ≤ PAGE_LIMITS.settledKept
 * @property {'ready'|'loading'|'unavailable'} list   the issues read: 'loading' until it lands, 'unavailable' when it failed
 * @property {{ start: string, queue: string, play: string }} blocked   '' or the words for why + improvement's two keys and ▶ can't go now
 */

/** One conversation row.
 * @typedef {Object} ConversationVM
 * @property {string} id           'home' or a thread uuid
 * @property {string|null} project
 * @property {string} title
 * @property {string|null} lastAt
 * @property {string} lastText     line two: the last thing said in it, cleaned (§4.6 of the spec); home with nothing said → WORDS.homeLine
 * @property {boolean} active      the open conversation (marked aria-current="true" only while the chat is the room)
 * @property {number} count
 */

/** One project in the bar. Replaces the old per-project fields inFlight, pending, staged, done, total, planAvailable, sections, threads.
 * @typedef {Object} BarProjectVM
 * @property {string} id
 * @property {string} name
 * @property {boolean} active
 * @property {string} branch       checked-out branch (the project settings card)
 * @property {string} goal
 * @property {string} mode         automation: off | suggest | stage | ship | unknown
 * @property {number|null} spend
 * @property {number|null} spendCap
 * @property {Words} attention     = builds[0].attention
 * @property {ConversationVM[]} conversations   home first, then by lastAt, archived left out
 * @property {BuildVM[]} builds    phase 1: exactly [main]
 */

/** What margin-ui.js update() takes.
 * @typedef {Object} BarModel
 * @property {BarProjectVM[]} projects
 * @property {boolean} projectsLoaded
 * @property {boolean} projectsError
 * @property {string|null} activeProject
 * @property {PageRef|null} view    null = chat
 * @property {boolean} busy         nibbi is answering
 * @property {Object} progress      as today (progressLine)
 * @property {string} link
 * @property {Object} settings      as today (demo, calm, systemReduced, the prefs, metadata…)
 */

/** One step of a try, derived from its status: install → do the work → run the checks → stage it for review.
 * @typedef {{ name: 'install'|'work'|'check'|'stage', label: string, state: 'done'|'running'|'waiting'|'failed' }} StepVM */
/** @typedef {{ name: string, ok: true|false|null, note: string }} CheckVM */
/** Parsed from run.diffstat (git diff --stat).
 * @typedef {{ count: number, add: number, del: number, list: { path: string, changes: number }[] }} FilesVM */
/** @typedef {{ mode: 'github'|'local', delivery: string, prNumber: number|null, prUrl: string|null, draft: boolean, toPush: boolean, pullRequest: boolean, readyPR: boolean, needsAttention: boolean, remoteChanged: boolean, checks: { status: string, blockers: string[] }, notice: string, baseBranch: string|null }} GithubVM */

/** One try: one run, with what its card needs.
 * @typedef {Object} AttemptVM
 * @property {string} runId
 * @property {number} n            1-based, oldest first
 * @property {string} status       the raw RunStatus
 * @property {StateId} state       RUN_STATES / GITHUB_STAGED for this run alone
 * @property {string} word
 * @property {Tone} tone
 * @property {boolean} live
 * @property {string} title
 * @property {string} branch       'nibbi/fx-…'
 * @property {string} target       targetBranch (or github.baseBranch)
 * @property {string} sha          commitSha, 7 characters ('' when none)
 * @property {string} startedAt
 * @property {string|null} endedAt
 * @property {number|null} costUsd
 * @property {string} summary      the agent's report (markdown; '' when it failed — its summary is then the reason)
 * @property {string} reason       failed / interrupted / stopped: the words why, first line
 * @property {string} activity     what it is doing now (runView currentActivity), live tries only
 * @property {StepVM[]} steps
 * @property {CheckVM[]} checks    the project check (verification) and, in GitHub mode, the PR's checks
 * @property {FilesVM} files
 * @property {GithubVM|null} github
 * @property {{ running: boolean, url: string|null }|null} preview
 * @property {string[]|null} allowedActions   from the builds section read; null = not known yet (keys that need it show WORDS.reading)
 * @property {('log'|'changes'|'github')[]} tabs
 * @property {'log'|'changes'|'github'} initialTab   failed/building → log; ready/in → changes; github states → github
 * @property {string|null} attemptId   the run's latest attempt (buildEvidence reads its log with it)
 */

/** @typedef {{ words: string, yes: string, no: string, armed: boolean }} ConfirmVM   armed: the yes key is the destructive red one (stop, discard); merge's yes is ink */

/** One key on a ticket, in order. At most one per page has tone 'ink' (the page's one primary).
 * @typedef {Object} ActionVM
 * @property {string} action       an ACTIONS name
 * @property {string} label        WORDS.keys.*
 * @property {'ink'|'seated'} tone
 * @property {Object} payload      what onAction gets as value (ActionPayloads)
 * @property {ConfirmVM|null} confirm   asks twice, on the page, before sending
 * @property {string} blocked      '' or why it can't go now (the key stays, disabled, with these words as its title and a note)
 * @property {string} key          its data-cp-key
 * @property {'form'|null} opens   'form': the key opens an inline field first (guide it → steer text; edit the words → title + description)
 */

/** @typedef {{ label: string, value: string, key?: string }} FactVM */

/** The ticket page.
 * @typedef {Object} TicketVM
 * @property {ImprovementVM} improvement
 * @property {'main'} build
 * @property {string} branch       BuildVM.branch
 * @property {string} statusLine   the one fact that explains the state (spec §4.5); may carry a time, rendered at `now`
 * @property {FactVM[]} facts      build · asked · tries · time · changes · checks
 * @property {{ text: string, description: string, context: string, at: string|null, source: 'issue'|'run' }} asked
 * @property {AttemptVM[]} attempts   oldest first; the last is drawn open, earlier ones fold to one line
 * @property {ActionVM[]} actions
 * @property {{ label: string, url: string }[]} links   the issue's GitHub issue links ("GitHub issue · owner/repo #7")
 * @property {boolean} gone        the improvement no longer exists: the page says WORDS.gone and keeps only its ×
 */

/** What project-pages.js open() / update() take.
 * @typedef {Object} PagesModel
 * @property {PageRef} page
 * @property {{ id: string, name: string, branch: string }} project
 * @property {BuildVM} build
 * @property {TicketVM|null} ticket   non-null when page.page === 'ticket'
 * @property {boolean} busy
 * @property {boolean} demo
 * @property {number} now          ms; relative times are said against it
 */

/** Values onAction receives, by name (the first argument is always the project id).
 * @typedef {Object} ActionPayloads
 * @property {'main'} openBuild
 * @property {ImprovementId} openImprovement
 * @property {undefined} backToChat
 * @property {{ text: string }} startImprovement    → run.dispatch
 * @property {{ text: string }} queueImprovement    → issue.create
 * @property {{ action: 'start'|'stop'|'open' }} playMain
 * @property {{ issueId: string }} buildIssue
 * @property {{ issueId: string, title: string, description: string }} editImprovement
 * @property {{ issueId: string }} completeImprovement
 * @property {{ issueId: string }} reopenImprovement
 * @property {{ runId: string }} stopRun
 * @property {{ runId: string, text: string }} steerRun
 * @property {{ runId: string }} retryRun
 * @property {{ runId: string }} verifyRun
 * @property {{ runId: string }} mergeRun
 * @property {{ runId: string }} discardRun
 * @property {{ runId: string, action: 'start'|'stop'|'open' }} previewRun
 * @property {{ improvementId: ImprovementId }} talkAbout
 * @property {undefined} refresh
 * @property {{ id: string, kind: 'summary'|'changes'|'checks'|'log', attemptId?: string }} buildEvidence   resolves to the evidence value
 */

/** What builds-model.js takes for one project (spec §3.2).
 * @typedef {Object} CpInput
 * @property {{ name: string, branch: string, lastCommit: string, check: string, targetBranch?: string, github: Object|null }} project   a /api/projects row (read-models.ts:21-28)
 * @property {Object[]} runs            S.fixers for this project: live Fixer records (fixer.ts:28-41) with their github summary
 * @property {Object[]|null} sectionRuns   the builds section's runs (project-workspace.ts:32: + allowedActions, preview, currentActivity); null until read
 * @property {{ status: string, revision: string, items: Object[] }|null} issues   the issues section (project-workspace.ts:50-70); null until read or when it failed
 * @property {'ready'|'loading'|'unavailable'} list
 * @property {{ running: boolean, url?: string, playable: boolean, starting?: boolean, error?: string }|null} play   GET /api/play?project=
 * @property {number} maxConcurrent     S.auto[project].maxConcurrent ?? 2
 * @property {boolean} busy
 * @property {boolean} demo
 * @property {number} now
 */

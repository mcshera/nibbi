/** The control panel's one shared shape (docs/CONTROL-PANEL.md is phase 1's spec, docs/BUILDS-AS-COPIES.md
 *  phase 2's; both bind, and where they differ phase 2 wins).
 *
 *  Typedefs and frozen constants only: no logic, no imports, no DOM, no clock. Three modules meet here:
 *    public/lib/builds-model.js   makes the view models (pure)
 *    public/lib/margin-ui.js      draws the bar from them
 *    public/lib/project-pages.js  draws the build page and the ticket page from them
 *  and public/app.js feeds the first and wires the other two. Nobody edits this file during a phase
 *  except the integrator; a builder who finds it wrong conforms to it and says so in their commit.
 *
 *  Phase 1 was one build, `main`, holding its improvements (the work that lands in it). Phase 2 adds
 *  copies: dev, dev1 … — each a living copy of the app on its own branch (`nibbi/copy/<name>`) in its
 *  own worktree, made from main, that improvements land in, that can be played, caught up with main,
 *  shipped to main and retired. In code the noun is "copy" (commands copy.*); on screen it is a "build".
 *  An improvement is an issues.md item (kind 'issue') or a run started from free text (kind 'run'); its
 *  attempts are the runs linked to it, and it lives in the build its latest try targets. Words are
 *  lowercase and spoken (design/LANGUAGE.md §11); colour only on machine verdicts (tone 'pass' | 'error'). */

export const PHASE = 2;
/** The build that ships. Its `branch` is where main's runs really land (see BuildVM.branch). A copy can never be called this. */
export const MAIN = 'main';

/* ------------------------------------------------------------------------------------------ copies (phase 2) */

/** The rules a copy's name and branch follow. The daemon enforces them (project-copies.ts); the model says
    them in words first (copyNameProblem), so the UI never relies on the refusal. */
export const COPY = Object.freeze({
  branchPrefix: 'nibbi/copy/',              // a copy of main named dev lives on branch nibbi/copy/dev
  namePattern: '^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$',   // 1–32: lowercase letters, digits, dashes inside
  nameMax: 32,
  reserved: Object.freeze(['main', 'master', 'head']),
  limit: 5,                                 // live copies per project (each is a worktree plus its install)
  first: 'dev',                             // suggested names: dev, then dev1, dev2 … (the first free one)
  idPattern: '^copy-[0-9a-f-]{36}$',        // the daemon's record id: 'copy-' + randomUUID()
  preview: 'copy:{project}:{copyId}',       // a copy's preview id (previews.ts), beside main's 'project:{project}'
  route: '/api/project-copies',             // GET ?project= → CopiesRead
  event: 'copy.updated',                    // payload { copy: CopyRecord } on every record write
});

/** What the daemon's record says it is doing. 'broken': making it failed part way, or the backend stopped
    while it was being made; only retire works on it. 'retired' records are tombstones (history only). */
export const COPY_STATUS = Object.freeze(['creating', 'ready', 'shipping', 'catching_up', 'retiring', 'broken', 'retired']);
/** What the read found on disk. 'moved': the branch or its worktree's HEAD is not the head nibbi recorded
    (someone committed or checked out there); 'dirty': its worktree has edits nibbi did not make. */
export const COPY_HEALTH = Object.freeze(['ok', 'missing', 'moved', 'dirty']);

/** A copy's headline — the word on its bar row and its page header — the first that holds, in this order.
    ({n} is the count; 'waiting' says the BADGE word of its waiting improvements, e.g. "1 needs you".) */
export const COPY_STATES = Object.freeze([
  'making', 'broken', 'retiring', 'shipping', 'catching_up', 'missing', 'changed',
  'building', 'behind', 'waiting', 'ready_to_ship', 'ready_to_play', 'up_next', 'nothing',
]);
export const COPY_STATE_WORDS = Object.freeze({
  making: 'making the copy', broken: 'couldn’t make it', retiring: 'retiring', shipping: 'shipping', catching_up: 'catching up',
  missing: 'missing', changed: 'changed outside nibbi', building: '{n} building', behind: 'main moved on · catch up',
  waiting: '{badge}', ready_to_ship: 'ready to ship', ready_to_play: 'ready to play', up_next: '{n} up next', nothing: 'nothing to ship yet',
});
export const COPY_STATE_TONES = Object.freeze({
  making: 'active', broken: 'attention', retiring: 'active', shipping: 'active', catching_up: 'active',
  missing: 'attention', changed: 'attention', building: 'active', behind: 'attention',
  waiting: 'attention', ready_to_ship: 'attention', ready_to_play: 'attention', up_next: 'quiet', nothing: 'quiet',
});
/** Copy headlines whose word pulses. */
export const COPY_LIVE = Object.freeze(['making', 'retiring', 'shipping', 'catching_up', 'building']);

/** How a copy-targeted run (run.copyId set) reads, on top of RUN_STATES (docs/BUILDS-AS-COPIES.md §4.2):
      staged                       → 'landing' (it lands in its copy on its own once checks pass), or
                                     'waiting_to_land' when run.landing.state === 'waiting' (the copy is playing)
      merged, run.shipped unset    → 'in', living in its copy
      merged, run.shipped set      → 'in', living in main ("shipped from dev")
      any, its copy retired and not shipped → 'discarded' (settled; "dev was retired before it shipped")
    run.merge is never offered for one (it lands on its own), so a copy's improvements have no review step:
    the confirmed step is Ship to main. */
export const COPY_RUN_STATES = Object.freeze({ staged: 'landing', done: 'landing', waiting: 'waiting_to_land' });

/** The daemon command each copy action calls (command-service.ts; never the build.* GitHub router). */
export const COPY_COMMANDS = Object.freeze({
  newCopy: 'copy.create', shipCopy: 'copy.ship', catchUpCopy: 'copy.catchUp', retireCopy: 'copy.retire',
  playCopy: Object.freeze({ start: 'copy.play', stop: 'copy.stop' }),   // 'open' opens play.url; no command
});

/* ------------------------------------------------------------------------------------------ ids */

/** An improvement's id: `issue:<issues.md id>` or `run:<the first run of its retry chain>`. Stable
    across Try again (run.retry makes a new run whose replacesBuildId points back, fixer.ts:292-302). */
export const ID_PREFIX = Object.freeze({ issue: 'issue:', run: 'run:' });

/** The DOM hooks every builder and every tool uses. Rows never carry data-build-id (the lobby's, gone). */
export const ATTR = Object.freeze({
  barBuild: 'data-bar-build',             // the bar's build row: "main" | a copy's name ("dev")
  barBuildBody: 'data-bar-build-body',    // a copy's body in the bar (what is inside it): its name
  build: 'data-build',                    // a .cp-build wrapper, and a control that belongs to one build: its name
  copyId: 'data-copy-id',                 // a copy's .cp-build wrapper: its daemon id (tools find a copy by it)
  barImprovement: 'data-bar-improvement', // the bar's improvement row: an ImprovementId
  group: 'data-cp-group',                 // a bar card: "conversations" | "builds"
  page: 'data-cp-page',                   // a page root: "build" | "ticket"
  pageId: 'data-cp-id',                   // a page root's id: "main" | a copy's name | an ImprovementId
  run: 'data-cp-run',                     // a try card on the ticket page: its run id
  key: 'data-cp-key',                     // a page control's stable key (focus survives a re-render)
  role: 'data-cp-role',                   // a bar control's role: see BAR_ROLES
  state: 'data-state',                    // an improvement's StateId, on its bar row and page row
  status: 'data-status',                  // a page status panel or try card: StateId (a verdict hook style-verify accepts)
  tone: 'data-tone',                      // a word's Tone
});
/** Every data-cp-role the bar draws. Phase 1's four, and phase 2's. */
export const BAR_ROLES = Object.freeze([
  'new-improvement', 'play-main', 'improvement-form', 'start-now', 'up-next', 'ask-nibbi',
  'new-build', 'build-form', 'build-name', 'make-build', 'build-disclosure', 'catch-up', 'play-copy', 'ship-copy',
]);

/** Ids the suites and the owner pin. They move with their elements (docs/CONTROL-PANEL.md §2.4); none is renamed. */
export const PINNED_IDS = Object.freeze([
  'workspace-sidebar', 'sidebar-toggle', 'sidebar-toggle-count', 'project-rail', 'settings-rail', 'status', 'sidebar-progress',
  'feed', 'pill', 'ask', 'send', 'toast', 'project-workspace',
]);

/* ------------------------------------------------------------------------------------------ states */

/** Every state an improvement can be in. */
export const STATES = Object.freeze([
  'needs_you', 'ready', 'to_push', 'pull_request', 'pr_ready', 'needs_attention',
  'building', 'landing', 'waiting_to_land', 'up_next', 'in', 'failed', 'interrupted', 'stopped', 'discarded', 'done',
]);

/** The word a state says: on its bar row (right-hand word), its page row and its ticket's big status.
    'landing' and 'waiting_to_land' are phase 2's: a copy's improvement whose checks passed, landing in the
    copy now, or waiting for the copy to stop playing (COPY_RUN_STATES). */
export const STATE_WORDS = Object.freeze({
  needs_you: 'needs you', ready: 'ready to review', to_push: 'to push', pull_request: 'pull request open',
  pr_ready: 'ready to merge', needs_attention: 'needs a look', building: 'building', landing: 'landing', waiting_to_land: 'waiting to land',
  up_next: 'up next', in: 'in', failed: 'failed', interrupted: 'interrupted', stopped: 'stopped', discarded: 'discarded', done: 'done',
});

/** How a word is inked. Only 'pass' and 'error' take colour, and only because they are machine verdicts. */
export const STATE_TONES = Object.freeze({
  needs_you: 'attention', ready: 'attention', to_push: 'attention', pull_request: 'attention', pr_ready: 'attention',
  needs_attention: 'error', building: 'active', landing: 'active', waiting_to_land: 'quiet', up_next: 'quiet', in: 'pass', failed: 'error',
  interrupted: 'attention',   // the backend stopped under it; nothing judged the work (project-summary.js:34-36)
  stopped: 'quiet', discarded: 'quiet', done: 'quiet',
});

/** States whose word pulses (the one motion for "work is happening", LANGUAGE §7.2). */
export const LIVE_STATES = Object.freeze(['building', 'landing']);

/** The order improvements are listed in, bar and build page alike: what waits on you, what is moving,
    what is next, what landed, what failed. ROUND4.md decided 6 (building → up next → in → failed),
    with ROUND3.md decided 3's "waiting on you first" in front, since phase 1 has a review step. */
export const GROUPS = Object.freeze([
  Object.freeze({ id: 'waiting', label: 'waiting on you', states: Object.freeze(['needs_you', 'needs_attention', 'pr_ready', 'to_push', 'pull_request', 'ready']) }),
  Object.freeze({ id: 'building', label: 'building', states: Object.freeze(['building', 'landing', 'waiting_to_land']) }),
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

/** One build's badge (BuildVM.badge) — and, in phase 1, the builds card's and the project's attention:
    the first state with a count wins. [state, one, many, tone] — `{n}` is the count. 'failed' counts
    failed only; 'interrupted' its own. Phase 2's card badge across every build is CARD_BADGE. */
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
/** Phase 2: the builds card's badge (BuildsCardVM.badge), counted across main and every live copy; the
    first row with a count wins. Rows of kind 'improvement' count ImprovementVMs by state (as BADGE);
    rows of kind 'copy' count copies by their headline (COPY_STATES) — `{name}` is the copy when there is
    one, `{n}` the count when there are more. The project's attention is this badge when its tone is in
    ATTENTION_TONES, else its 'building' words, else ''. */
export const CARD_BADGE = Object.freeze([
  Object.freeze(['improvement', 'needs_you', '{n} needs you', '{n} need you', 'attention']),
  Object.freeze(['improvement', 'needs_attention', '{n} needs a look', '{n} need a look', 'error']),
  Object.freeze(['improvement', 'pr_ready', '{n} ready to merge', '{n} ready to merge', 'attention']),
  Object.freeze(['improvement', 'to_push', '{n} to push', '{n} to push', 'attention']),
  Object.freeze(['improvement', 'pull_request', '{n} pull request open', '{n} pull requests open', 'attention']),
  Object.freeze(['improvement', 'ready', '{n} ready to review', '{n} ready to review', 'attention']),
  Object.freeze(['copy', 'ready_to_ship', '{name} ready to ship', '{n} ready to ship', 'attention']),
  Object.freeze(['copy', 'ready_to_play', '{name} ready to play', '{n} ready to play', 'attention']),
  Object.freeze(['improvement', 'failed', '{n} failed', '{n} failed', 'error']),
  Object.freeze(['improvement', 'interrupted', '{n} interrupted', '{n} interrupted', 'attention']),
  Object.freeze(['copy', 'broken', '{name} couldn’t be made', '{n} couldn’t be made', 'attention']),
  Object.freeze(['improvement', 'building', '{n} building', '{n} building', 'active']),
  Object.freeze(['improvement', 'landing', '{n} landing', '{n} landing', 'active']),
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
  // phase 2: copies
  openShip: 'openShip', newCopy: 'newCopy', shipCopy: 'shipCopy', catchUpCopy: 'catchUpCopy', retireCopy: 'retireCopy', playCopy: 'playCopy',
});
/** What margin-ui.js sends that is new. It keeps every existing name (selectProject, newProject, thread,
    newThread, renameThread, archiveThread, repository, autoMode, spendCap, providers, the settings prefs…)
    except projectSection, fix, plan, play and review, which go. 'askNibbi' (the form's quiet route) is the
    app's own. Phase 2 adds the copy names: the bar never ships or retires (those ask on the page). */
export const BAR_ACTIONS = Object.freeze([
  'openBuild', 'openImprovement', 'backToChat', 'startImprovement', 'queueImprovement', 'playMain',
  'openShip', 'newCopy', 'catchUpCopy', 'playCopy',
]);
/** What project-pages.js sends (plus githubRead / githubCommand / githubRefresh, passed through the GitHub panel). */
export const PAGE_ACTIONS = Object.freeze([
  'openBuild', 'openImprovement', 'backToChat', 'startImprovement', 'queueImprovement', 'playMain',
  'buildIssue', 'editImprovement', 'completeImprovement', 'reopenImprovement',
  'stopRun', 'steerRun', 'retryRun', 'verifyRun', 'mergeRun', 'discardRun', 'previewRun', 'talkAbout', 'refresh', 'buildEvidence',
  'shipCopy', 'catchUpCopy', 'retireCopy', 'playCopy',
]);
/** Nothing waits for nibbi's reply. D8 had start now, build it now and try again wait (ROUND3.md decided 4); the owner
    reversed it on 2026-09-29 (docs/CONTROL-PANEL.md §12.2): a run is a background agent in its own worktree, not the chat's
    turn, and the daemon's own guards (one live try per improvement, capacity, the spend cap) bound it. Each key keeps its
    double-press guard and its pending state. */
export const WAITS_FOR_REPLY = Object.freeze([]);
/** Refused in demo: every daemon write, and play (a play 'open' is allowed: it only opens an address). */
export const REFUSED_IN_DEMO = Object.freeze([
  'startImprovement', 'queueImprovement', 'playMain', 'buildIssue', 'editImprovement', 'completeImprovement', 'reopenImprovement',
  'stopRun', 'steerRun', 'retryRun', 'verifyRun', 'mergeRun', 'discardRun', 'previewRun',
  'newCopy', 'shipCopy', 'catchUpCopy', 'retireCopy', 'playCopy',
]);

/* ------------------------------------------------------------------------------------------ words */

/** Fixed copy. `{…}` are filled by whoever renders; everything is lowercase (LANGUAGE §11, audit P14). */
export const WORDS = Object.freeze({
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
  editWaits: 'a try is running on it, so the words can’t change right now — what you typed stays here; save once it stops',
  emptyImprovements: 'nothing to improve yet — or ask nibbi what it would change',
  suggested: 'nibbi suggested',                             // an up-next improvement suggest mode put in the list: its line two until something happens to it
  upNextAuto: 'automation builds it into {name} when there’s room — or build it now',   // an up-next ticket's status line while automation picks it up
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
    hintAuto: 'start now builds it right away · up next keeps it in the list, and automation builds it into {into} when there’s room',
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
    discardFailed: 'discard “{title}”? it leaves the failed list — its branch and worktree are kept.',
    discardTry: 'discard try {n} of “{title}”? it goes back to up next — its branch and worktree are kept.',
    stop: 'stop try {n}? what it has done so far stays in its worktree — {branch} is unchanged.',   // {branch}: a copy's name for a copy's try
  }),
  /** Phase 2: copies. {name} is the copy ("dev"), {project} the project, {base} main's branch. */
  copy: Object.freeze({
    kicker: 'a copy',
    line: 'copy of main',
    lineAhead: 'copy of main · {ahead} ahead',
    copyLine: 'copy of main · {ahead} ahead · {behind} behind',
    playing: 'playing',
    // + New build (the builds card header) and its inline form
    newLabel: 'New build',                                   // the header key's accessible name (sentence case, as "New thread")
    newTitle: 'a new build — a copy of main to try things in',
    formLabel: 'name the new build',
    formSub: 'a copy of main, as it is now',
    make: 'make it',
    nameEmpty: 'give it a name first',
    nameShape: 'a name is lowercase letters, numbers and dashes — like dev or dev2',
    nameLong: 'keep the name to 32 characters or fewer',
    nameReserved: '“{name}” belongs to the build that ships — pick another',
    nameTaken: 'there’s already a build called {name}',
    tooMany: 'five copies is the most for now — retire one first',
    githubMode: 'copies are local for now — {project} ships through GitHub pull requests',
    noCheck: 'a copy needs a check to keep it honest — set the project’s check in its settings first',
    // inside a copy
    emptyImprovements: 'nothing in here yet — say what should change',
    formPlaceholder: 'it lands on {name}',
    formHint: 'start now builds it on {name} right away · up next keeps it in {name}’s list until you start it',
    formHintAuto: 'start now builds it on {name} right away · up next keeps it in {name}’s list, and automation builds it there when there’s room',
    notReady: '{name} is busy — {status}',
    statusWords: Object.freeze({ creating: 'it’s still being made', shipping: 'it’s shipping', catching_up: 'it’s catching up', retiring: 'it’s being retired', broken: 'it couldn’t be made' }),
    missing: '{name}’s copy is missing from this machine — retire it, then make it again',
    moved: '{name} changed outside nibbi — its head isn’t the one nibbi checked, so nothing lands or ships until it’s put back',
    dirty: '{name}’s folder has edits nibbi didn’t make — nothing lands or ships until they’re gone',
    broken: 'couldn’t make {name} — {error}. retire it and make it again',
    gone: 'this build is gone',
    goneNote: 'it was retired — its copy is off this machine',
    // play
    play: 'play {name}',
    oneAtATime: 'one plays at a time — this stops {other}',
    fixedAddress: '{project} plays at a fixed address — a copy can’t have its own yet',
    nothingToPlay: 'there’s nothing to play in {name} yet',
    playNote: 'plays {name}’s copy · at {sha}',
    madeFrom: 'made from main {ago}',
    // ship to main (the confirmed step, on the copy's page)
    shipKey: 'ship to main',
    shipTitle: 'ship {name} to main',
    shipLeadOne: '1 improvement goes into main, and main is live with it straight away.',
    shipLeadMany: '{n} improvements go into main, and main is live with them straight away.',
    shipStays: 'stays on {name}: {list}',
    shipChecks: 'nibbi runs {command} once more on what main becomes — main only changes if it passes',
    shipPlayed: 'you played {name} {ago}',
    shipNotPlayed: '{name} hasn’t been played since its last improvement landed',
    shipLevel: '{name} has everything main has',
    shipYesOne: 'ship 1 to main',
    shipYesMany: 'ship {n} to main',
    shipNo: 'not yet',
    shipDone: 'shipped to main — main is live with it',
    shipDoneMany: 'shipped {n} to main — main is live with them',
    shipNothing: 'nothing to ship yet — no improvement is in {name}',
    shipBehind: 'main moved on — catch {name} up first, then ship',
    shipCheckoutOther: 'your project folder is on {branch} — switch it to {base} to ship',
    shipCheckoutDirty: 'your project folder has changes that aren’t committed — commit or put them away to ship',
    headMoved: '{name} changed since you looked — look again',
    // catch up
    catchUpKey: 'catch up',
    catchUpRow: 'catch up with main',
    catchUpNote: 'main moved on — {n} behind',
    catchUpPlaying: 'catch {name} up with main? it stops playing {name} first — nibbi checks it before anything changes.',
    catchUpYes: 'catch it up',
    catchUpNo: 'not now',
    catchUpLevel: '{name} already has everything main has',
    catchUpDone: 'caught up — {name} has everything main has',
    catchUpConflict: 'main and {name} both changed {files} — {name} stays as it is; ask nibbi to bring them together',
    catchUpCheckfail: 'main’s newest doesn’t pass the checks together with {name} — {name} stays as it is',
    // retire (quiet, confirmed)
    retireNote: '{name} is a copy of the app on this machine — it uses disk while it’s here',
    retireKey: 'retire {name}',
    retireConfirm: 'retire {name}? its copy comes off this machine{unshipped}. main isn’t touched.',
    retireUnshippedOne: ', with the 1 improvement in it that hasn’t shipped',
    retireUnshippedMany: ', with the {n} improvements in it that haven’t shipped',
    retirePlaying: ' it stops playing first.',
    retireYes: 'retire {name}',
    retireNo: 'keep {name}',
    retireBuilding: 'an improvement is building on {name} — stop it or let it land first',
    retireDirty: '{name}’s folder has files nibbi didn’t make — nibbi won’t delete them: {files}',
    // an improvement inside a copy (the ticket's status line and the bar's line two)
    landing: 'checks passed — landing it in {name}',
    waitingToLand: 'checks passed — it lands in {name} when {name} stops playing',
    landsAfterPlay: 'lands when {name} stops playing',
    inCopy: 'in {name} since {when} · it goes to main when {name} ships',
    shippedFrom: 'in main since {when} · shipped from {name}',
    shippedContext: 'shipped from {name}',
    retiredBefore: '{name} was retired before it shipped',
    didntLand: 'it didn’t land — {name} is unchanged',
    // main's page
    mainShips: 'main is what ships',                        // main's BuildVM.blocked.ship
    copiesTitle: 'copies of main',
    copiesEmpty: 'no copies yet — + on the builds card makes one',
    shippedLine: '{name} shipped {n}',
    // a copy's history (HistoryVM.text)
    made: 'made from main at {sha}',
    caughtUp: 'caught up with main',
    catchUpFailed: 'couldn’t catch up — {why}',
    shipped: 'shipped {n} to main',
  }),
  /** Automation on the project card (the owner's decision, 2026-09-29): it picks up up next, into main or one of the copies. */
  auto: Object.freeze({
    line: 'automation picks up up next · builds into {name}',
    goalLine: 'automation works toward your goal, from plans/{project}.md',   // while a /goal is set, the roadmap is still what it works
    into: 'builds into',                                   // the field label (lowercase sentence case, LANGUAGE §11)
    intoGroup: 'automation builds into',                   // the segment's accessible name
    intoTitle: 'automation builds what’s up next into {name}',
    intoToast: 'automation builds into {name} on {project}',
  }),
  /** Phase 2 keys (lowercase on pages, LANGUAGE §11). */
  copyKeys: Object.freeze({
    stopPlayingCopy: 'stop playing {name}', playCopy: 'play {name}', openCopy: 'open it',
  }),
});

/* ------------------------------------------------------------------------------------------ typedefs */

/** @typedef {'quiet'|'active'|'attention'|'pass'|'error'} Tone */
/** @typedef {'needs_you'|'ready'|'to_push'|'pull_request'|'pr_ready'|'needs_attention'|'building'|'landing'|'waiting_to_land'|'up_next'|'in'|'failed'|'interrupted'|'stopped'|'discarded'|'done'} StateId */
/** @typedef {'waiting'|'building'|'up_next'|'in'|'failed'|'settled'} GroupId */
/** @typedef {string} ImprovementId  `issue:<id>` | `run:<root run id>` */
/** @typedef {'build'|'ticket'|'repository'} PageKind */
/** @typedef {'creating'|'ready'|'shipping'|'catching_up'|'retiring'|'broken'|'retired'} CopyStatus */
/** @typedef {'ok'|'missing'|'moved'|'dirty'} CopyHealth */
/** @typedef {'making'|'broken'|'retiring'|'shipping'|'catching_up'|'missing'|'changed'|'building'|'behind'|'waiting'|'ready_to_ship'|'ready_to_play'|'up_next'|'nothing'} CopyStateId */

/** Where the main area is. null in S.projectView is the chat (the default).
 * @typedef {Object} PageRef
 * @property {string} project
 * @property {PageKind} page
 * @property {string|null} id   page 'build': 'main' or a copy's name ("dev"); 'ticket': an ImprovementId; 'repository': null
 * @property {'ship'|null} [intent]   phase 2: 'ship' opens a copy's page with its ship confirm already open (openShip)
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
 * @property {string} build        phase 2: the build it lives in — 'main' or a copy's name (docs/BUILDS-AS-COPIES.md §4.2)
 */

/** Play, for main (the project's own dev server, previews.ts:43-55), for a copy (its own preview in its
    worktree, id COPY.preview) or for one run's preview (previews.ts:11-35).
 * @typedef {Object} PlayVM
 * @property {boolean} playable
 * @property {boolean} running
 * @property {boolean} starting
 * @property {string|null} url
 * @property {string} blocked     '' or why Play can't run now (WORDS.noPlay / WORDS.demoPlay / WORDS.copy.fixedAddress …)
 * @property {string} note        main: WORDS.checkout filled with the checked-out branch; a copy: WORDS.copy.playNote; '' for a run
 * @property {string} lastCommit  main only: '%h %s (%cr)' from /api/projects ('' when unknown)
 * @property {string} [stops]     phase 2: the build this one's Play would stop (one plays at a time) — 'main' or a copy's name; '' when nothing else plays
 * @property {'server'|'url'|'none'} [kind]   phase 2: 'url' when the project plays at a fixed address (it can't be stopped, and a copy can't have one)
 * @property {string|null} [playedAt]   phase 2, a copy: when it was last played (ready to play → ready to ship)
 */

/** A build: main (phase 1's fields, unchanged) or a copy (phase 2). Every field is present on both; the
    phase-2 ones are neutral on main (ahead/behind null, ship/catchUp/retire null, copies filled).
 * @typedef {Object} BuildVM
 * @property {string} id           'main' | the copy's name — the build page's PageRef.id and the bar row's data-bar-build
 * @property {string} name         = id
 * @property {'main'|'copy'} kind
 * @property {string|null} copyId  the daemon's record id (commands take it); null for main
 * @property {string} autoInto     '' or the build automation builds this build's up-next list into (stage/ship with no /goal):
 *                                 main → the chosen target's name; a copy → its own name when it is the target
 * @property {string} branch       main: where its runs land — local → the newest *main-targeted* run's targetBranch, else the project's targetBranch, else its checked-out branch; github → connection.integrationBranch. A copy: 'nibbi/copy/<name>'
 * @property {string} line         main: WORDS.mainLine, or WORDS.mainLineOther when branch !== 'main'. A copy: WORDS.copy.line
 * @property {string} word         main: 'live'. A copy: its headline (COPY_STATE_WORDS[state], filled)
 * @property {'live'|CopyStateId} state
 * @property {Tone} tone           main: 'quiet'. A copy: COPY_STATE_TONES[state]
 * @property {boolean} live        a copy's headline pulses (COPY_LIVE)
 * @property {string} note         the bar row's line two, left: main → line without its leading 'live · '; a copy → WORDS.copy.line / lineAhead
 * @property {string} count        the bar row's line two, right: a copy → "2 in · 1 failed" and/or WORDS.copy.playing; main → WORDS.copy.playing while it plays, else ''
 * @property {string} detail       the other facts after the headline, " · " joined ("2 in · 1 failed · behind main"); '' when none
 * @property {string} copyLine     the page header's line: main → line; a copy → WORDS.copy.copyLine filled
 * @property {number|null} ahead   a copy: commits on it that main lacks (git rev-list --count <base>..<branch>); main: null
 * @property {number|null} behind  a copy: commits on main it lacks; main: null
 * @property {string} head         a copy: its head, 7 characters; main: ''
 * @property {CopyStatus|'live'} status
 * @property {CopyHealth} health   main: 'ok'
 * @property {string} healthWords  '' or WORDS.copy.missing / moved / dirty / broken, filled
 * @property {{ sha: string, at: string|null, command: string }|null} verified   the checks on its head: a copy's lastVerifiedSha when it equals its head; main: null
 * @property {CheckVM[]} checks    a copy: [{ name: check command, ok: true when verified, else null, note }]; main: []
 * @property {string|null} madeAt
 * @property {{ branch: string, sha: string }|null} madeFrom
 * @property {Words} badge         this build's own badge (BADGE over its improvements); text '' when nothing to say
 * @property {Words} attention     main in phase 1: the project's attention. Phase 2 uses BuildsCardVM.attention
 * @property {{ waiting: number, needsYou: number, ready: number, building: number, upNext: number, in: number, inToday: number, failed: number, interrupted: number }} counts   building counts the whole 'building' group (building · landing · waiting to land)
 * @property {PlayVM} play
 * @property {{ command: string, real: boolean }} check     the project's check (projects.ts GameCfg.check); real = not '', 'true', ':' or 'echo …' (fixer.ts:94)
 * @property {{ mode: 'github'|'local', repository: string|null, integrationBranch: string|null, releaseBranch: string|null }|null} github
 * @property {ImprovementVM[]} improvements   every non-settled improvement living in this build, ordered by GROUPS then `order`; 'in' capped at PAGE_LIMITS.inKept
 * @property {ImprovementVM[]} settled        stopped / discarded / done, newest first, ≤ PAGE_LIMITS.settledKept
 * @property {'ready'|'loading'|'unavailable'} list   the issues read: 'loading' until it lands, 'unavailable' when it failed
 * @property {{ start: string, queue: string, play: string, ship: string, catchUp: string, retire: string }} blocked   '' or the words for why each can't go now (main: ship = WORDS.copy.mainShips; catchUp and retire '')
 * @property {ShipVM|null} ship
 * @property {CatchUpVM|null} catchUp
 * @property {RetireVM|null} retire
 * @property {HistoryVM[]} history  newest first, ≤ 30: a copy's made · started · landed · failed · shipped · caught up; main's landed · shipped-from-a-copy
 * @property {CopySummaryVM[]} copies   main only: its live copies, for its page's "copies of main"; [] on a copy
 */

/** The confirmed step on a copy's page.
 * @typedef {Object} ShipVM
 * @property {boolean} ready       every condition holds (docs/BUILDS-AS-COPIES.md §4.2 "ship")
 * @property {string} why          '' or the first reason it can't ship (the key's title and the panel's lead)
 * @property {ImprovementVM[]} ships   the copy's 'in' improvements — what goes into main
 * @property {ImprovementVM[]} stays   its other non-settled improvements — what stays on the copy
 * @property {string} lead         WORDS.copy.shipLeadOne / shipLeadMany, or `why`
 * @property {CheckVM[]} checks    the checks on its head, as BuildVM.checks
 * @property {string} checksLine   WORDS.copy.shipChecks filled with the check command
 * @property {string[]} facts      played / not played; level with main
 * @property {string} yes          WORDS.copy.shipYesOne / shipYesMany
 * @property {string} no           WORDS.copy.shipNo
 * @property {{ copyId: string, expectedHead: string }} payload   shipCopy's value: the head the owner looked at
 */
/** @typedef {{ needed: boolean, blocked: string, confirm: ConfirmVM|null, payload: { copyId: string, expectedHead: string, stopPlay: boolean }, last: { at: string, ok: boolean, words: string }|null }} CatchUpVM   confirm is non-null only when the copy is playing (it stops it first); last: the latest attempt, said in words */
/** @typedef {{ blocked: string, confirm: ConfirmVM, note: string, unshipped: number, payload: { copyId: string, expectedHead: string } }} RetireVM   confirm.armed is true (it removes things) */
/** @typedef {{ kind: 'made'|'started'|'landed'|'failed'|'shipped'|'caught_up'|'catch_up_failed', at: string, text: string, tone: Tone, improvementId: string|null, sha: string }} HistoryVM */
/** @typedef {{ name: string, copyId: string, word: string, tone: Tone, live: boolean, note: string }} CopySummaryVM */
/** What + New build says: the header key's state and the form's first value.
 * @typedef {{ blocked: string, why: string, suggested: string, taken: string[], limit: number }} NewCopyVM   blocked: '' or why no copy can be made now — the key's title, and the form opens in its can't state saying it (field and make it disabled); the key itself is never disabled. why: the project-wide reason only (GitHub mode, no check), which main's page says in "copies of main" */
/** What the model hands the bar for one project's builds card.
 * @typedef {{ builds: BuildVM[], badge: Words, attention: Words, newCopy: NewCopyVM }} BuildsCardVM   builds: main first, then the live copies oldest first */

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
 * @property {string|null} [autoTarget]  where stage and ship build: a live copy's id; null is main (AutoCfg.copyId)
 * @property {boolean} [goalActive] a /goal is set and not done: automation works the roadmap, not up next
 * @property {string} [autoNote]    automation's last word (AutoCfg.note), '' when none
 * @property {number|null} spend
 * @property {number|null} spendCap
 * @property {Words} attention     BuildsCardVM.attention (phase 1: builds[0].attention)
 * @property {ConversationVM[]} conversations   home first, then by lastAt, archived left out
 * @property {BuildVM[]} builds    main first, then the live copies (BuildsCardVM.builds)
 * @property {Words} [buildsBadge] phase 2: the builds card's badge (BuildsCardVM.badge); absent → builds[0].badge
 * @property {NewCopyVM} [newCopy] phase 2: the builds header's + New build; absent → the key is not drawn
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
 * @property {StateId} state       RUN_STATES / GITHUB_STAGED / COPY_RUN_STATES for this run alone
 * @property {string} word
 * @property {Tone} tone
 * @property {boolean} live
 * @property {string} title
 * @property {string} branch       'nibbi/fx-…'
 * @property {string} target       targetBranch (or github.baseBranch) — a copy's try says the copy's name here
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

/** @typedef {{ words: string, yes: string, no: string, armed: boolean }} ConfirmVM   armed: the yes key is the destructive red one (stop, discard, retire); merge's yes is ink */

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
 * @property {string} build        the build it lives in: 'main' or a copy's name (the crumb opens its page)
 * @property {'main'|'copy'} [buildKind]   phase 2: which glyph the crumb draws (trunk / branch)
 * @property {string|null} [copyId]        phase 2: the copy's id when it lives in one
 * @property {string} branch       that build's BuildVM.branch
 * @property {string} statusLine   the one fact that explains the state (spec §4.5, and BUILDS-AS-COPIES §4.2 for a copy's); may carry a time, rendered at `now`
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
 * @property {BuildVM|null} build     the page's build (page 'build': the one named page.id; 'ticket': the ticket's build). null: a copy page whose copy is gone (WORDS.copy.gone)
 * @property {BuildVM[]} [builds]     phase 2: every build of the project, main first (main's page lists its copies from them)
 * @property {TicketVM|null} ticket   non-null when page.page === 'ticket'
 * @property {boolean} busy         nibbi is answering (the GitHub panel's keys wait for it; no run key does — §12.2)
 * @property {boolean} demo
 * @property {number} now          ms; relative times are said against it
 */

/** Values onAction receives, by name (the first argument is always the project id).
 * @typedef {Object} ActionPayloads
 * @property {string} openBuild     'main' or a copy's name
 * @property {ImprovementId} openImprovement
 * @property {undefined} backToChat
 * @property {{ text: string, copyId?: string }} startImprovement    → run.dispatch (+ copyId: it lands in that copy)
 * @property {{ text: string, copyId?: string }} queueImprovement    → issue.create (+ copyId: it waits up next in that copy)
 * @property {{ action: 'start'|'stop'|'open' }} playMain
 * @property {{ issueId: string, copyId?: string }} buildIssue        → issue.build (copyId: the ticket's build when it is a copy)
 * @property {{ issueId: string, title: string, description: string, revision: string }} editImprovement   revision: the issues list's, as the words were read (a save against a list that moved since is refused)
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
 * @property {string} openShip      a copy's name: its page, with the ship confirm open (the bar never ships)
 * @property {{ name: string }} newCopy                                   → copy.create
 * @property {{ copyId: string, expectedHead: string }} shipCopy           → copy.ship   (the head the confirm listed)
 * @property {{ copyId: string, expectedHead: string, stopPlay: boolean }} catchUpCopy   → copy.catchUp
 * @property {{ copyId: string, expectedHead: string }} retireCopy         → copy.retire
 * @property {{ copyId: string, action: 'start'|'stop'|'open' }} playCopy → copy.play / copy.stop / open play.url
 */

/** What builds-model.js takes for one project (spec §3.2).
 * @typedef {Object} CpInput
 * @property {{ name: string, branch: string, lastCommit: string, check: string, targetBranch?: string, github: Object|null, dirty?: number }} project   a /api/projects row (read-models.ts:21-28; dirty = porcelain lines in the owner's checkout)
 * @property {Object[]} runs            S.fixers for this project: live Fixer records (fixer.ts:28-41) with their github summary (+ phase 2: copyId, landing, shipped)
 * @property {Object[]|null} sectionRuns   the builds section's runs (project-workspace.ts:32: + allowedActions, preview, currentActivity); null until read
 * @property {{ status: string, revision: string, items: Object[] }|null} issues   the issues section (project-workspace.ts:50-70; + phase 2: each item's copyId); null until read or when it failed
 * @property {'ready'|'loading'|'unavailable'} list
 * @property {{ running: boolean, url?: string, playable: boolean, starting?: boolean, error?: string, kind?: string }|null} play   GET /api/play?project=
 * @property {CopiesRead|null} [copies]  phase 2: GET /api/project-copies?project=; null until read (copy-targeted improvements are then held back, not drawn under main)
 * @property {number} maxConcurrent     S.auto[project].maxConcurrent ?? 2
 * @property {boolean} busy          nibbi is answering — nothing the model makes waits for it (§12.2)
 * @property {boolean} demo
 * @property {number} now
 */

/* ------------------------------------------------------------------------------------------ the daemon's copy shapes */

/** The daemon's record, bucket 'project-copies', id 'copy-<uuid>' (daemon/src/copy-records.ts). Written only by
    project-copies.ts and fixer.ts integrate(); every write emits COPY.event with { copy: CopyRecord }.
 * @typedef {Object} CopyRecord
 * @property {string} id              'copy-' + randomUUID()
 * @property {string} project
 * @property {string} name            COPY.namePattern; unique among the project's live copies
 * @property {string} branch          COPY.branchPrefix + name
 * @property {string} base            main's branch when it was made (cfg.targetBranch ?? the checked-out branch, fixer.ts:179's local rule)
 * @property {string} baseSha         main's head it was made from
 * @property {string} worktree        join(config.workDir, 'copies', project, name) — always under the work dir
 * @property {string} headSha         the head nibbi last put there (made, landed, caught up); the read compares the branch with it
 * @property {string|null} lastVerifiedSha   the head whose tree last passed the project check (a landing or a catch-up)
 * @property {string|null} lastVerifiedAt
 * @property {CopyStatus} status
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string|null} lastLandedAt      the last time its head changed (a landing or a catch-up)
 * @property {string|null} playedAt          the last time copy.play started it
 * @property {string|null} error             'broken': what went wrong making it
 * @property {ShipRecord[]} ships            newest first, ≤ 20
 * @property {CatchUpRecord[]} catchUps      newest first, ≤ 20
 * @property {CopyIntent|null} intent        a ship or catch-up between its intent and its bookkeeping (crash recovery)
 * @property {string|null} retiredAt
 * @property {string|null} retiredHead       the head it had when it was retired (recoverable with git branch <name> <sha> while the objects last)
 * @property {string[]} [installed]          what git ignores that nibbi's installs left in its folder (made, reinstalled); retire removes only that of what git ignores
 */
/** @typedef {{ id: string, at: string, sha: string, mainBefore: string, runIds: string[] }} ShipRecord   sha: main after the ship (= the copy's head) */
/** @typedef {{ at: string, ok: boolean, mainSha: string, from: string, to: string|null, reason: ''|'conflict'|'checkfail'|'changed', detail: string, conflicts: string[] }} CatchUpRecord */
/** @typedef {{ kind: 'ship'|'catchUp', candidate: string, targetSha: string, integration: string, at: string }} CopyIntent */
/** A live copy as the read reports it: the record plus what git says now.
 * @typedef {CopyRecord & { ahead: number, behind: number, health: CopyHealth, dirtyFiles: string[], play: { running: boolean, starting: boolean, url: string|null, playable: boolean, kind: 'server'|'url'|'none', error: string|null } }} CopyView */
/** @typedef {{ id: string, name: string, branch: string, retiredAt: string, retiredHead: string|null, ships: ShipRecord[] }} RetiredCopy */
/** GET /api/project-copies?project= (daemon/src/api.ts → project-copies.ts copiesView).
 * @typedef {Object} CopiesRead
 * @property {string} project
 * @property {'local'|'github'} mode
 * @property {''|'github'|'no_check'} disabled    why no copy can be made or changed here ('' = copies work)
 * @property {number} limit                       COPY.limit
 * @property {{ branch: string, sha: string }} main
 * @property {CopyView[]} copies                  live (status not 'retired'), oldest first
 * @property {RetiredCopy[]} retired              newest first, ≤ 20
 * @property {(ShipRecord & { copyId: string, name: string })[]} ships   every ship into main, live and retired copies, newest first, ≤ 20
 * @property {number} fetchedAt
 */

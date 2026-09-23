import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';

const root = resolve('public');
const fixtures = {
  issues: { project: 'paper-garden', section: 'issues', status: 'ready', revision: 'issues-1', markdown: '# Garden issues\nPreserve these source notes.', counts: { total: 3, open: 2, done: 1 }, items: [
    { id: 'issue-seedlings', text: 'Seedlings overlap near the edge', description: 'Reproduce with a full garden.', heading: 'Growing', done: false, linkedBuilds: [], linkedTaskIds: [] },
    { id: 'issue-keyboard', text: 'Keyboard focus disappears', description: 'After watering.', heading: 'Access', done: false, linkedBuilds: [], linkedTaskIds: [] },
    { id: 'issue-return', text: 'Remember returning visitors', heading: 'Growing', done: true, linkedBuilds: [], linkedTaskIds: [] },
  ] },
  builds: { project: 'paper-garden', section: 'builds', status: 'ready', revision: 'builds-1', counts: { total: 4, active: 1, review: 1, failed: 1, history: 1 }, runs: [
    { id: 'run-review', title: 'Give the seedlings room to grow', status: 'staged', summary: 'Kept keyboard controls working.', verification: { status: 'passed', command: 'npm test' }, allowedActions: ['run.verify', 'run.merge', 'run.discard'] },
    { id: 'run-active', title: 'Grow a quiet evening palette', status: 'running', summary: 'Preparing the palette.', allowedActions: ['run.stop', 'run.steer'] },
    { id: 'run-failed', title: 'Remember garden layout', status: 'failed', verification: { status: 'failed', detail: 'One check failed.' }, allowedActions: ['run.retry'] },
    { id: 'run-history', title: 'Save the first garden', status: 'merged', verification: { status: 'passed' }, allowedActions: [] },
  ] },
  plans: { project: 'paper-garden', section: 'plans', status: 'ready', revision: 'plans-1', outcome: 'Make returning to the garden feel familiar.', currentMilestone: { id: 'milestone-one', name: 'First shoots' }, markdown: '# A small garden\nPreserve narrative notes.', counts: { total: 3, done: 1, open: 2 }, items: [
    { id: 'task-one', text: 'Give seedlings room', description: 'Leave a little room to grow.', milestoneId: 'milestone-one', done: false, linkedBuilds: [] },
    { id: 'task-done', text: 'Remember the last visit', milestoneId: 'milestone-one', done: true, linkedBuilds: [] },
    { id: 'task-two', text: 'Add a quiet evening palette', milestoneId: 'milestone-two', done: false, linkedBuilds: [] },
  ], milestones: [{ id: 'milestone-one', name: 'First shoots', description: 'Start with a familiar place.', done: 1, total: 2 }, { id: 'milestone-two', name: 'A place to return to', done: 0, total: 1 }] },
};
for (const milestone of fixtures.plans.milestones) milestone.tasks = fixtures.plans.items.filter(task => task.milestoneId === milestone.id);

async function harness(browser, viewport, options = {}) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block', ...options });
  const page = await context.newPage(); page.setDefaultTimeout(5000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('https://workspace.test/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><link rel="stylesheet" href="/tokens.css"><link rel="stylesheet" href="/project-workspace.css"><style>:root{--ink:#151413;--ink-2:#484139;--ink-3:#6a645b;--paper:#f8f5ef;--line:#ddd7ce;--feed-top:30px;--feed-bottom:30px;--workspace-left:0px}body{background:var(--paper);font:14px Arial}*{box-sizing:border-box}[hidden]{display:none!important}</style></head><body><input id="conversation-draft" value="A draft worth keeping" hidden></body></html>' });
    try { return route.fulfill({ contentType: extname(path) === '.css' ? 'text/css' : 'text/javascript', body: readFileSync(resolve(root, '.' + path)) }); } catch { return route.fulfill({ status: 404 }); }
  });
  await page.goto('https://workspace.test/');
  await page.evaluate(async data => {
    window.sections = structuredClone(data); window.calls = []; window.failRead = false; window.conflict = false; window.readCount = 0; window.logEntries = [{ text: 'Seedlings now fit.' }];
    const { installProjectWorkspace } = await import('/lib/project-workspace.js');
    const load = async ({ project, section }) => { window.readCount++; if (window.failRead) throw new Error('Fixture is disconnected.'); return structuredClone({ ...window.sections[section], project }); };
    // the app's renderDiff is a DOM card; the stub keeps its contract ({diff, branch, target} → node) so the Log tab can be checked without the app
    const renderDiff = d => { const pre = document.createElement('pre'); pre.className = 'diffv'; pre.dataset.branch = d.branch || ''; pre.dataset.target = d.target ?? ''; pre.textContent = d.diff; return pre; };
    window.workspace = installProjectWorkspace({ load, renderDiff, onNavigate: (project, section) => workspace.open({ project, section }), onData: () => {}, onAction: async (name, project, value) => {
      calls.push({ name, project, value });
      if (name === 'buildEvidence') return value.kind === 'log' ? { entries: structuredClone(window.logEntries) } : value.kind === 'changes' ? { diff: '-old\n+new' } : { verification: { status: 'passed', command: 'npm test', detail: '8 checks passed.' } };
      if (name === 'buildCommand') return { ok: true, text: 'Build updated.' };
      if (name === 'projectCommand') {
        if (window.conflict) { const error = new Error('The document changed.'); error.code = 'REVISION_CONFLICT'; throw error; }
        const section = value.action.startsWith('issue.') ? 'issues' : 'plans'; const data = sections[section];
        if (value.action === 'issue.create') { data.items.push({ id: 'new-issue', text: value.title, description: value.description, done: false, linkedBuilds: [] }); data.counts.total++; data.counts.open++; }
        if (value.action === 'issue.edit') Object.assign(data.items.find(item => item.id === value.id), { text: value.title, description: value.description });
        if (value.action === 'issue.complete' || value.action === 'issue.reopen') { const item = data.items.find(item => item.id === value.id); item.done = value.action === 'issue.complete'; data.counts.done += item.done ? 1 : -1; data.counts.open += item.done ? -1 : 1; }
        if (value.action === 'milestone.create') { data.status = 'ready'; data.milestones.push({ id: 'new-milestone', name: value.title, description: value.description, done: 0, total: 0, tasks: [] }); }
        if (value.action === 'task.create') { const item = { id: 'new-task', text: value.title, description: value.description, milestoneId: value.milestoneId, done: false, linkedBuilds: [] }; data.items.push(item); data.milestones.find(m => m.id === value.milestoneId)?.tasks.push(item); data.counts.total++; data.counts.open++; }
        if (value.action === 'task.build') { const run = { id: 'task-build', title: 'Task build', status: 'staged' }; const item = data.items.find(item => item.id === value.id); item.linkedBuilds = [run]; for (const m of data.milestones) for (const task of m.tasks) if (task.id === value.id) task.linkedBuilds = [run]; }
        data.revision += '-next'; return { ok: true, section: structuredClone(data), itemId: ({ 'issue.create': 'new-issue', 'milestone.create': 'new-milestone', 'task.create': 'new-task' })[value.action] || value.id };
      }
    } });
  }, fixtures);
  const open = async section => { await page.evaluate(section => workspace.open({ project: 'paper-garden', section }), section); await page.waitForFunction(() => document.querySelector('#project-workspace').getAttribute('aria-busy') === 'false'); };
  return { page, context, errors, open };
}

test('project workspace preserves editing context and shows canonical linked work', async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const { page, context, errors, open } = await harness(browser, { width: 1180, height: 712 });
  try {
    await open('issues');
    assert.equal(await page.locator('.project-issue').count(), 3);
    await page.getByLabel('Search issues', { exact: true }).fill('seedlings');
    assert.equal(await page.locator('.project-issue').count(), 1);
    await page.locator('[data-record-id="issue-seedlings"] > summary').click();
    assert.match(await page.locator('.project-record-detail').innerText(), /Reproduce with a full garden/);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByLabel('Title', { exact: true }).fill('Give seedlings room');
    await page.getByLabel('Description', { exact: true }).fill('Keep my unsaved reproduction notes.');
    await page.evaluate(() => { window.originalInput = document.activeElement; sections.issues.revision = 'remote-revision'; sections.issues.items[0].text = 'A concurrent title'; return workspace.refresh(); });
    assert.equal(await page.evaluate(() => document.activeElement === window.originalInput), true);
    assert.equal(await page.getByLabel('Description', { exact: true }).inputValue(), 'Keep my unsaved reproduction notes.');
    await page.evaluate(() => { window.conflict = true; });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.project-form-error')?.textContent.includes('preserved'));
    assert.equal(await page.getByLabel('Title', { exact: true }).inputValue(), 'Give seedlings room');
    assert.equal(await page.evaluate(() => calls.find(call => call.value?.action === 'issue.edit').value.expectedRevision), 'issues-1');
    await open('builds'); await open('issues');
    assert.equal(await page.getByLabel('Title', { exact: true }).inputValue(), 'Give seedlings room');
    assert.equal(await page.getByLabel('Search issues', { exact: true }).inputValue(), 'seedlings');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByLabel('Search issues', { exact: true }).fill('');
    await page.evaluate(() => { window.conflict = false; });
    await page.getByRole('button', { name: 'New issue', exact: true }).click();
    await page.getByLabel('Title', { exact: true }).fill('Watering shortcuts');
    await page.getByLabel('Description', { exact: true }).fill('Keep shortcuts available.');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForSelector('[data-record-id="new-issue"]');
    assert.match(await page.locator('.project-notice').innerText(), /Issue saved/);
    await page.getByRole('button', { name: 'Complete issue', exact: true }).last().click();
    await page.waitForFunction(() => window.sections.issues.items.find(item => item.id === 'new-issue').done);
    await page.locator('[data-filter="done"]').click();
    assert.equal(await page.locator('.project-issue').count(), 2);
    await open('builds');
    await page.locator('[data-build-id="run-review"] > summary').click();
    await page.locator('[data-build-id="run-review"]').getByRole('button', { name: 'Changes', exact: true }).click();
    assert.match(await page.locator('[data-build-id="run-review"] .project-evidence-panel').innerText(), /-old\n\+new/);
    await page.locator('[data-build-id="run-review"]').getByRole('button', { name: 'Checks', exact: true }).click();
    assert.match(await page.locator('[data-build-id="run-review"] .project-evidence-panel').innerText(), /Verification: Passed/);
    await page.locator('[data-build-id="run-review"]').getByRole('button', { name: 'Approve & merge', exact: true }).click();
    assert.equal(await page.evaluate(() => calls.filter(call => call.name === 'buildCommand').length), 0, 'Opening confirmation cannot mutate a build');
    await page.getByRole('button', { name: 'Confirm merge', exact: true }).click();
    assert.equal(await page.evaluate(() => calls.filter(call => call.name === 'buildCommand' && call.value.command === 'run.merge').length), 1);
    assert.equal(await page.locator('[data-build-id="run-history"]').getByRole('button', { name: 'Approve & merge', exact: true }).count(), 0);
    await page.locator('[data-filter="attention"]').click();
    assert.equal(await page.locator('.project-build').count(), 1);
    await open('plans');
    assert.match(await page.locator('.project-plan-outcome').innerText(), /returning to the garden/);
    await page.locator('[data-record-id="task-one"] > summary').click();
    await page.getByRole('button', { name: 'Build this task', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-record-id="task-one"]')?.textContent.includes('Awaiting review'));
    assert.equal(await page.evaluate(() => sections.plans.items[0].done), false);
    assert.equal(await page.getByRole('button', { name: 'Build already linked', exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => calls.find(call => call.value?.action === 'task.build').value.id), 'task-one');
    await page.evaluate(() => { window.failRead = true; return workspace.refresh(); });
    assert.match(await page.locator('.project-notice').innerText(), /last available records/);
    assert.equal(await page.locator('#conversation-draft').inputValue(), 'A draft worth keeping');
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});

test('pending refresh cannot replace Edit during a real pointer focus transition', async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const { page, context, errors, open } = await harness(browser, { width: 1180, height: 712 });
  try {
    await open('issues');
    await page.getByLabel('Search issues', { exact: true }).fill('seedlings');
    await page.locator('[data-record-id="issue-seedlings"] > summary').click();
    await page.getByLabel('Search issues', { exact: true }).focus();
    await page.evaluate(async () => {
      sections.issues.revision = 'new-server-revision';
      sections.issues.items[0].text = 'A concurrently updated title';
      await workspace.refresh();
    });
    assert.equal(await page.getByRole('button', { name: 'Show updates', exact: true }).isVisible(), true);
    const edit = page.locator('[data-record-id="issue-seedlings"]').getByRole('button', { name: 'Edit', exact: true });
    const originalTarget = await edit.elementHandle(), bounds = await edit.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    assert.equal(await originalTarget.evaluate(el => el.isConnected), true, 'The pointer target must survive search blur');
    await page.mouse.up();
    await page.getByLabel('Title', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.getByLabel('Title', { exact: true }).inputValue(), 'Seedlings overlap near the edge');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    assert.equal(await page.evaluate(() => calls.find(call => call.value?.action === 'issue.edit').value.expectedRevision), 'issues-1', 'Edit must use the revision belonging to the record that was clicked');
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});

test('authoritative milestone save settles before the next Add task pointer action', async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const { page, context, errors, open } = await harness(browser, { width: 390, height: 430 });
  try {
    await page.evaluate(() => { sections.plans = { ...sections.plans, status: 'empty', revision: 'empty-plan', outcome: '', currentMilestone: null, markdown: '', counts: { total: 0, done: 0, open: 0 }, milestones: [], items: [] }; });
    await open('plans');
    await page.getByRole('button', { name: 'Create milestone', exact: true }).click();
    await page.getByLabel('Title', { exact: true }).fill('A useful weekend');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.locator('.project-inline-form').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.readCount), 1, 'The command already returns authoritative section data; no trailing read may repaint or refocus it');
    const add = page.locator('[data-record-id="new-milestone"]').getByRole('button', { name: 'Add task', exact: true });
    await add.scrollIntoViewIfNeeded();
    const originalTarget = await add.elementHandle(), bounds = await add.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.evaluate(() => workspace.refresh());
    assert.equal(await originalTarget.evaluate(el => el.isConnected), true);
    await page.mouse.up();
    await page.getByLabel('Title', { exact: true }).fill('Collect one idea');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.locator('.project-inline-form').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => sections.plans.items[0].milestoneId), 'new-milestone');
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});

test('section controls and inline evidence fit narrow and short reading windows', async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 390, height: 430 }]) {
      const { page, context, errors, open } = await harness(browser, viewport);
      try {
        // To push and Pull requests are GitHub's; a project that does not deliver there hides the group.
        // Needs attention stays: it is where a local project's failed builds are. The daemon gives every
        // local run a github record too, so the fixture carries one.
        await page.evaluate(() => { for (const run of sections.builds.runs) run.github = { mode: 'local' }; });
        await open('builds');
        assert.equal(await page.locator('.project-build-delivery').first().innerText(), 'Local build', 'the runs carry the daemon\'s local github record');
        assert.deepEqual(await page.locator('.project-filters [data-filter]').evaluateAll(els => els.map(el => el.dataset.filter)), ['all', 'active', 'review', 'attention', 'history']);
        assert.equal(await page.locator('.project-filters').evaluate(el => getComputedStyle(el).flexWrap), 'nowrap', 'the filters keep one row and scroll sideways');
        await page.locator('[data-build-id="run-review"] > summary').click();
        assert.equal(await page.locator('.project-build:visible').count(), 1);
        await page.getByRole('button', { name: 'Back to build list', exact: true }).click();
        assert.equal(await page.locator('.project-build:visible').count(), 4);
        await page.locator('[data-filter="active"]').click();
        assert.equal(await page.locator('.project-build:visible').count(), 1);
        for (const section of ['builds', 'issues', 'plans']) {
          await open(section);
          // The summary has its own line; the controls share one row under it.
          const header = await page.locator('.project-toolbar > .project-toolbar-actions > button').evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().top)));
          assert.ok(header.length >= 2 && header.every(top => top === header[0]), `${section} header controls share one row at ${viewport.width}, tops ${header}`);
          const summary = await page.locator('.project-toolbar > .project-summary').boundingBox(), row = await page.locator('.project-toolbar > .project-toolbar-actions').boundingBox();
          assert.ok(summary.y + summary.height <= row.y + 1, 'and the summary sits above them');
          if (section === 'builds') continue;
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          const shortControls = await page.locator('.project-workspace button:visible').evaluateAll(elements => elements.filter(el => el.getBoundingClientRect().height < 43.9).map(el => ({ text: el.textContent, height: el.getBoundingClientRect().height })));
          assert.deepEqual(shortControls, []);
          const out = resolve('output/playwright/project-workspace'); mkdirSync(out, { recursive: true });
          await page.screenshot({ path: resolve(out, `${section}-${viewport.width}x${viewport.height}.png`) });
        }
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
});

test('one verdict wears one colour at every width, and a notice without a kind is ink', async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    for (const viewport of [{ width: 1180, height: 712 }, { width: 390, height: 844 }]) {
      const { page, context, errors, open } = await harness(browser, viewport);
      try {
        await open('builds');
        // The desktop queue (the rail) and the phone list render the same row; they used to disagree.
        const seen = await page.evaluate(() => {
          const probe = name => { const el = document.createElement('span'); el.style.color = `var(${name})`; document.body.append(el); const colour = getComputedStyle(el).color; el.remove(); return colour; };
          const status = document.querySelector('.project-build-status[data-status="failed"]');
          // An interrupted build sits in the same group, but nothing judged it: same place, not the verdict colour.
          const interrupted = status?.cloneNode(true); if (interrupted) { interrupted.dataset.status = 'interrupted'; status.after(interrupted); }
          const result = { fail: probe('--fail-text'), ink: probe('--ink-2'), visible: !!status?.getClientRects().length, failed: status ? getComputedStyle(status).color : '', interrupted: interrupted ? getComputedStyle(interrupted).color : '', inRail: !!status?.closest('.project-build-rail') };
          interrupted?.remove(); return result;
        });
        assert.equal(seen.visible, true, `the failed build is on screen at ${viewport.width}`);
        assert.equal(seen.inRail, viewport.width >= 900, 'desktop shows it in the queue beside the staged build');
        assert.equal(seen.failed, seen.fail, `Failed is --fail-text at ${viewport.width}, was ${seen.failed}`);
        assert.notEqual(seen.interrupted, seen.fail, `Interrupted is not --fail-text at ${viewport.width}`);
        if (viewport.width < 900) await page.locator('[data-build-id="run-review"] > summary').click();
        await page.locator('[data-build-id="run-review"]').getByRole('button', { name: 'Approve & merge', exact: true }).click();
        const notice = page.locator('.project-notice');
        await notice.waitFor();
        assert.match(await notice.innerText(), /Confirm this build action below/);
        assert.deepEqual(await notice.evaluate(el => [el.dataset.kind, getComputedStyle(el).color]), ['', seen.ink], 'information is not painted as a failure');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
});

test('a GitHub project shows its delivery filters, and the key hint needs a keyboard', async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const { page, context, errors, open } = await harness(browser, { width: 1180, height: 712 });
    try {
      await page.evaluate(() => { sections.builds.runs[0].workflowMode = 'github'; sections.builds.runs[0].github = { mode: 'github', toPush: true }; });
      await open('builds');
      assert.deepEqual(await page.locator('.project-filters [data-filter]').evaluateAll(els => els.map(el => el.dataset.filter)), ['all', 'active', 'review', 'toPush', 'pullRequests', 'attention', 'history']);
      assert.equal(await page.locator('[data-filter="toPush"]').innerText(), 'To push 1');
      assert.equal(await page.locator('.project-lobby-keys').isVisible(), true, 'a pointer with a keyboard sees j/k · a · x · p');
      // A local merge on a GitHub-connected project with no binding: the daemon says mode 'local' and
      // toPush, and the bar's badge counts it. The group shows, or only All would reach that build.
      await page.evaluate(() => { for (const run of sections.builds.runs) { delete run.workflowMode; run.github = { mode: 'local' }; } sections.builds.runs.find(run => run.id === 'run-history').github = { mode: 'local', delivery: 'local_merge_unpublished', toPush: true, pullRequest: false }; });
      await open('builds');
      assert.deepEqual(await page.locator('.project-filters [data-filter]').evaluateAll(els => els.map(el => el.textContent)), ['All 4', 'Active 1', 'Review 1', 'To push 1', 'Pull requests 0', 'Needs attention 1', 'History 0'], 'a group with something in it is not hidden');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
    const touch = await harness(browser, { width: 1180, height: 712 }, { hasTouch: true });
    try {
      await touch.open('builds');
      assert.equal(await touch.page.evaluate(() => matchMedia('(hover: none), (pointer: coarse)').matches), true, 'the touch context is coarse');
      assert.equal(await touch.page.locator('.project-lobby-keys').count(), 1);
      assert.equal(await touch.page.locator('.project-lobby-keys').isVisible(), false, 'a touch screen has no keys to press');
      assert.deepEqual(touch.errors, []);
    } finally { await touch.context.close(); }
  } finally { await browser.close(); }
});

test('Builds Log tab renders the event trail as rows: tool labels, exact names, verdicts and a diff card', async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    for (const viewport of [{ width: 1180, height: 712 }, { width: 390, height: 844 }]) {
      const { page, context, errors, open } = await harness(browser, viewport);
      try {
        await page.evaluate(() => { window.logEntries = [
          { ts: '2026-09-10T10:00:00.000Z', kind: 'run.updated', text: 'running' },
          { ts: '2026-09-10T10:00:01.000Z', kind: 'tool.started', name: 'edit_file', phase: 'started', source: 'governed', input: { path: 'garden.txt', oldText: 'old', newText: 'new' }, attemptId: 'attempt-1' },
          { ts: '2026-09-10T10:00:02.000Z', kind: 'tool.finished', name: 'edit_file', phase: 'finished', source: 'governed', ok: true, summary: 'Replaced 1 match in garden.txt', bytes: 1229, elapsedMs: 420, diff: 'diff --git a/garden.txt b/garden.txt\n-old\n+new\n', attemptId: 'attempt-1' },
          { ts: '2026-09-10T10:00:03.000Z', kind: 'tool.started', name: 'Read', phase: 'started', source: 'native' },
          { ts: '2026-09-10T10:00:04.000Z', kind: 'tool.finished', name: 'web_fetch', phase: 'finished', source: 'governed', ok: false, error: 'Host evil.example is not in the allowlist', elapsedMs: 12 },
          { ts: '2026-09-10T10:00:05.000Z', kind: 'process.output', text: 'npm test — 42 passing' },
        ]; });
        await open('builds');
        await page.locator('[data-build-id="run-active"] > summary').click();
        await page.locator('[data-build-id="run-active"]').getByRole('button', { name: 'Log', exact: true }).click();
        const log = page.locator('[data-build-id="run-active"] .project-log'); await log.waitFor();
        assert.equal(await page.evaluate(() => calls.filter(call => call.name === 'buildEvidence' && call.value.kind === 'log').length), 1);
        const rows = await log.locator('.project-log-entry').evaluateAll(els => els.map(el => ({ kind: el.dataset.kind, phase: el.dataset.phase || '', ok: el.dataset.ok || '', badge: el.querySelector('.project-log-kind')?.textContent, label: el.querySelector('.project-log-label')?.textContent || '', name: el.querySelector('.project-log-name')?.textContent || '', meta: el.querySelector('.project-log-meta')?.textContent || '', text: el.querySelector('.project-log-text')?.textContent || '' })));
        assert.equal(rows.length, 6);
        assert.deepEqual(rows[0], { kind: 'run.updated', phase: '', ok: '', badge: 'run', label: '', name: '', meta: '', text: 'running' });
        assert.deepEqual(rows[1], { kind: 'tool.started', phase: 'started', ok: '', badge: 'file', label: 'editing', name: 'edit_file', meta: 'garden.txt', text: '' });
        assert.deepEqual([rows[2].phase, rows[2].ok, rows[2].meta], ['finished', 'true', 'Replaced 1 match in garden.txt · 0.4s · 1.2 KB']);
        assert.deepEqual([rows[3].badge, rows[3].label, rows[3].name, rows[3].meta], ['native', 'reading', 'Read', '']);
        assert.deepEqual([rows[4].badge, rows[4].label, rows[4].ok, rows[4].meta], ['web', 'reading a page', 'false', 'Host evil.example is not in the allowlist · 0.0s']);
        assert.deepEqual([rows[5].badge, rows[5].text], ['output', 'npm test — 42 passing']);
        // the finished edit carries a diff card headed by the path its started row named, with no target arrow
        const diff = log.locator('.project-log-entry').nth(2).locator('.project-log-detail .diffv');
        assert.equal(await diff.count(), 1);
        assert.deepEqual(await diff.evaluate(el => [el.dataset.branch, el.dataset.target, el.textContent]), ['garden.txt', '', 'diff --git a/garden.txt b/garden.txt\n-old\n+new\n']);
        assert.equal(await log.locator('.project-log-entry').nth(2).locator('.project-log-detail > summary').innerText(), 'result · diff');
        // the bounded input stays folded until asked for
        const detail = log.locator('.project-log-entry').nth(1).locator('.project-log-detail');
        assert.equal(await detail.locator('> summary').innerText(), 'input');
        assert.equal(await detail.locator('.project-evidence-code').isVisible(), false);
        await detail.locator('> summary').click();
        assert.match(await detail.locator('.project-evidence-code').innerText(), /"oldText": "old"/);
        assert.equal(await log.locator('.project-log-entry').nth(3).locator('.project-log-detail').count(), 0, 'name-only native rows have nothing to expand');
        assert.equal(await page.evaluate(() => { const body = document.querySelector('.project-workspace-body'); return body.scrollWidth <= body.clientWidth && document.documentElement.scrollWidth <= innerWidth; }), true, 'log rows must not widen the workspace');
        const out = resolve('output/playwright/project-workspace'); mkdirSync(out, { recursive: true });
        await page.screenshot({ path: resolve(out, `log-${viewport.width}x${viewport.height}.png`) });
        // string logs keep the plain block
        await page.evaluate(() => { window.logEntries = 'plain text log'; });
        await page.locator('[data-build-id="run-active"]').getByRole('button', { name: 'Summary', exact: true }).click();
        await page.locator('[data-build-id="run-active"]').getByRole('button', { name: 'Log', exact: true }).click();
        const plain = page.locator('[data-build-id="run-active"] .project-evidence-panel > .project-evidence-code'); await plain.waitFor();
        assert.equal(await plain.innerText(), 'plain text log');
        assert.equal(await page.locator('[data-build-id="run-active"] .project-log').count(), 0);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
});


test('large play control starts the selected version, reopens it, and reports unavailable previews', async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    for (const viewport of [{ width: 1180, height: 712 }, { width: 390, height: 844 }]) {
      const { page, context, errors, open } = await harness(browser, viewport);
      try {
        await page.evaluate(() => {
          sections.builds.runs[0].allowedActions.push('preview.start');
          window.workspace.destroy();
        });
        // Reuse the harness action contract while holding startup long enough to inspect it.
        await page.evaluate(async () => {
          const { installProjectWorkspace } = await import('/lib/project-workspace.js');
          window.workspace = installProjectWorkspace({ load: async () => structuredClone(sections.builds), onAction: async (name, project, value) => {
            calls.push({ name, project, value });
            if (name === 'buildCommand') {
              await new Promise(resolve => window.finishPreviewStart = resolve);
              sections.builds.runs[0].allowedActions = ['preview.stop'];
              return { ok: true };
            }
            if (name === 'previewStatus') return { running: true, url: 'http://127.0.0.1:4321' };
          } });
        });
        await open('builds');
        if (viewport.width < 900) await page.locator('[data-build-id="run-review"] > summary').click();
        const play = page.getByRole('button', { name: 'Play build', exact: true });
        assert((await play.boundingBox()).height >= 104);
        await play.click();
        assert.equal(await play.getAttribute('aria-busy'), 'true');
        assert.equal(await play.isDisabled(), true);
        assert.equal(await play.locator('.project-build-play-loading').isVisible(), true);
        assert.deepEqual(await page.evaluate(() => calls[0]), { name: 'buildCommand', project: 'paper-garden', value: { id: 'run-review', command: 'preview.start' } });
        await page.evaluate(() => finishPreviewStart());
        await page.getByRole('button', { name: 'Open build', exact: true }).waitFor();
        assert.equal(await page.evaluate(() => calls.filter(c => c.name === 'openUrl').length), 1);
        await page.getByRole('button', { name: 'Open build', exact: true }).click();
        assert.equal(await page.evaluate(() => calls.filter(c => c.name === 'buildCommand').length), 1, 'Reopening must not start another preview');
        assert.equal(await page.evaluate(() => calls.filter(c => c.name === 'openUrl').length), 2);
        const out = resolve('output/playwright/build-play'); mkdirSync(out, { recursive: true });
        await page.screenshot({ path: resolve(out, `running-${viewport.width}.png`) });
        await page.evaluate(() => { sections.builds.runs[0].allowedActions = []; document.activeElement.blur(); return workspace.refresh(); });
        assert.equal(await page.getByRole('button', { name: 'Play build', exact: true }).isDisabled(), true);
        assert.match(await play.innerText(), /No browser preview is configured/);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
});

// Liveness: a read lands while you look at the lobby. It waits only for typing or deciding; focus on a
// tab comes back to the same tab; an open Log takes new entries without being rebuilt; and a lead turn
// that is still answering holds back only what writes into the composer.
test('the lobby stays live under focus, keeps an open log, and locks only composer controls', async () => {
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' });
  const { page, context, errors, open } = await harness(browser, { width: 1180, height: 712 });
  try {
    await open('builds');
    const stage = page.locator('[data-build-id="run-review"]');
    await stage.getByRole('button', { name: 'Log', exact: true }).click();
    await stage.locator('.project-log-entry').first().waitFor();
    await stage.getByRole('button', { name: 'Log', exact: true }).focus();
    await page.evaluate(() => { window.heldLog = document.querySelector('[data-build-id="run-review"] .project-log'); sections.builds.runs[1].title = 'A concurrently renamed palette'; return workspace.refresh(); });
    assert.match(await page.locator('[data-build-id="run-active"]').innerText(), /A concurrently renamed palette/, 'the rows update under a focused tab');
    assert.equal(await page.getByRole('button', { name: 'Show updates', exact: true }).count(), 0, 'with no "Show updates" in the way');
    assert.deepEqual(await page.evaluate(() => ({ kind: document.activeElement.dataset.kind, build: document.activeElement.closest('[data-build-id]')?.dataset.buildId })), { kind: 'log', build: 'run-review' }, 'focus is back on the same tab');
    assert.equal(await page.evaluate(() => window.heldLog.isConnected), true, 'and the open log is the same node');

    await page.evaluate(() => workspace.noteRunEvent({ id: 40, type: 'tool.finished', at: Date.now(), runId: 'run-review', payload: { name: 'edit_file', source: 'governed', ok: true, summary: 'Replaced 1 match' } }));
    assert.equal(await page.evaluate(() => window.heldLog.querySelectorAll('.project-log-entry').length), 2, 'a live event joins the list on screen');
    assert.match(await page.evaluate(() => window.heldLog.lastElementChild.innerText), /editing[\s\S]*ok/);
    await page.evaluate(() => workspace.noteRunEvent({ id: 41, type: 'tool.started', at: Date.now(), runId: 'run-active', payload: { name: 'read_file' } }));
    assert.equal(await page.evaluate(() => window.heldLog.querySelectorAll('.project-log-entry').length), 2, 'another build\'s event stays out of this log');
    await page.evaluate(() => workspace.refresh());
    assert.equal(await page.evaluate(() => window.heldLog.isConnected && window.heldLog.querySelectorAll('.project-log-entry').length), 2, 'a later read keeps the tail it was given');

    await page.evaluate(() => workspace.setBusy(true));
    assert.equal(await page.getByRole('button', { name: 'New build', exact: true }).isDisabled(), true, 'New build writes into the composer, so it waits');
    for (const name of ['Discard', 'Approve & merge', 'Verify']) assert.equal(await stage.getByRole('button', { name, exact: true }).isDisabled(), false, `${name} is a daemon command and does not wait`);
    // Rendered while the turn is busy, too: another build's controls are built enabled.
    await page.locator('[data-build-id="run-active"] > summary').click();
    const active = page.locator('[data-build-id="run-active"]');
    for (const name of ['Stop build', 'Guide build']) assert.equal(await active.getByRole('button', { name, exact: true }).isDisabled(), false, `${name} is a daemon command and does not wait`);
    await page.evaluate(() => workspace.setBusy(false));
    await page.locator('[data-build-id="run-review"] > summary').click();

    await open('issues');
    await page.getByLabel('Search issues', { exact: true }).focus();
    await page.evaluate(() => { sections.issues.items[1].text = 'A concurrently updated issue'; return workspace.refresh(); });
    assert.equal(await page.getByRole('button', { name: 'Show updates', exact: true }).isVisible(), true, 'typing still holds the records back');
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});

// Focus the render can put back comes back, as the same node where the node itself is carried; focus it
// cannot put back holds the read, as it always did. An open Log that goes off screen keeps what arrived.
test('a live read gives back focus it can and waits for focus it cannot, and an off-screen log keeps its tail', async () => {
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' });
  const { page, context, errors, open } = await harness(browser, { width: 1180, height: 712 });
  const where = () => page.evaluate(() => { const a = document.activeElement; return { tag: a.tagName, text: (a.textContent || '').trim().slice(0, 30), build: a.closest('[data-build-id]')?.dataset.buildId || null }; });
  const updates = () => page.getByRole('button', { name: 'Show updates', exact: true }).count();
  try {
    await page.evaluate(() => { window.logEntries = [{ kind: 'tool.finished', name: 'edit_file', ok: true, summary: 'Replaced 1 match', phase: 'finished', ts: new Date().toISOString() }]; });
    await open('builds');
    const stage = page.locator('[data-build-id="run-review"]');
    await stage.getByRole('button', { name: 'Log', exact: true }).click();
    await stage.locator('.project-log-entry').first().waitFor();

    // Inside an open log: the panel is carried, so the very node gets focus back.
    const detail = stage.locator('.project-log-detail > summary').first();
    await detail.focus();
    await page.evaluate(() => { window.focusedDetail = document.activeElement; sections.builds.runs[1].title = 'Renamed under a focused log row'; return workspace.refresh(); });
    assert.match(await page.locator('[data-build-id="run-active"]').innerText(), /Renamed under a focused log row/, 'the rows update');
    assert.equal(await updates(), 0);
    assert.equal(await page.evaluate(() => document.activeElement === window.focusedDetail && window.focusedDetail.isConnected), true, 'focus is on the same log row');

    // The toolbar's Refresh, pressed from the keyboard, keeps focus.
    await page.getByRole('button', { name: 'Refresh', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#project-workspace').getAttribute('aria-busy') === 'false');
    await page.waitForTimeout(100);
    assert.equal(await updates(), 0, 'its read was applied, not held');
    assert.deepEqual(await where(), { tag: 'BUTTON', text: 'Refresh', build: null }, 'and Refresh has focus after it');

    // Focus that cannot be put back (a GitHub control in Checks) holds the read, and stays.
    await page.evaluate(() => { sections.builds.runs[0].github = { mode: 'github', checks: { status: 'in_progress' } }; return workspace.refresh(); });
    await stage.getByRole('button', { name: 'Checks', exact: true }).click();
    const inspect = stage.getByRole('button', { name: 'Inspect GitHub checks', exact: true });
    await inspect.focus();
    await page.evaluate(() => { window.focusedInspect = document.activeElement; sections.builds.runs[1].title = 'Held behind a notice'; return workspace.refresh(); });
    assert.equal(await updates(), 1, 'the read waits behind "Show updates"');
    assert.equal(await page.evaluate(() => document.activeElement === window.focusedInspect), true, 'and focus did not move');
    assert.doesNotMatch(await page.locator('[data-build-id="run-active"]').innerText(), /Held behind a notice/);
    await page.getByRole('button', { name: 'Show updates', exact: true }).click();
    await page.locator('[data-build-id="run-active"]').getByText('Held behind a notice').waitFor();

    // An open Log that goes off screen: its build is deselected, then the section is closed. Both times
    // what arrived meanwhile is on screen when the build is back, without clicking Log again.
    await stage.getByRole('button', { name: 'Log', exact: true }).click();
    await stage.locator('.project-log-entry').first().waitFor();
    const rows = () => stage.locator('.project-log-entry').count();
    const start = await rows();
    await page.locator('[data-build-id="run-active"] > summary').click();
    await page.evaluate(() => { workspace.noteRunEvent({ id: 50, type: 'process.output', at: Date.now(), runId: 'run-review', payload: { text: 'npm test: 8 passing' } }); workspace.noteRunEvent({ id: 51, type: 'process.output', at: Date.now(), runId: 'run-review', payload: { text: 'done' } }); });
    await page.locator('[data-build-id="run-review"] > summary').click();
    await stage.locator('.project-log-entry').nth(start + 1).waitFor();
    assert.equal(await rows(), start + 2, 'rows that arrived while another build was selected');
    assert.equal(await stage.locator('.project-evidence-tabs [data-kind="log"]').getAttribute('aria-pressed'), 'true');
    await open('issues');
    await page.evaluate(() => workspace.noteRunEvent({ id: 52, type: 'process.output', at: Date.now(), runId: 'run-review', payload: { text: 'while the section was closed' } }));
    await open('builds');
    await stage.locator('.project-log-entry').nth(start + 2).waitFor();
    assert.equal(await rows(), start + 3, 'and the row that arrived while the section was closed');
    assert.match(await stage.locator('.project-log-entry').last().innerText(), /while the section was closed/);
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});

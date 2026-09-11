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

async function harness(browser, viewport) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  const page = await context.newPage(); page.setDefaultTimeout(5000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('https://workspace.test/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><link rel="stylesheet" href="/project-workspace.css"><style>:root{--ink:#151413;--ink-2:#484139;--ink-3:#6a645b;--paper:#f8f5ef;--line:#ddd7ce;--feed-top:30px;--feed-bottom:30px;--workspace-left:0px}body{background:var(--paper);font:14px Arial}*{box-sizing:border-box}[hidden]{display:none!important}</style></head><body><input id="conversation-draft" value="A draft worth keeping" hidden></body></html>' });
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
    workspace.setSummaries('paper-garden', sections);
  }, fixtures);
  const open = async section => { await page.evaluate(section => workspace.open({ project: 'paper-garden', section }), section); await page.waitForFunction(() => document.querySelector('#project-workspace').getAttribute('aria-busy') === 'false'); };
  return { page, context, errors, open };
}

test('project workspace preserves editing context and shows canonical linked work', async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const { page, context, errors, open } = await harness(browser, { width: 1180, height: 712 });
  try {
    await open('issues');
    assert.equal(await page.locator('.project-issue').count(), 2);
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
    await page.locator('[data-build-id="run-review"]').getByRole('button', { name: 'Merge locally', exact: true }).click();
    assert.equal(await page.evaluate(() => calls.filter(call => call.name === 'buildCommand').length), 0, 'Opening confirmation cannot mutate a build');
    await page.getByRole('button', { name: 'Confirm merge', exact: true }).click();
    assert.equal(await page.evaluate(() => calls.filter(call => call.name === 'buildCommand' && call.value.command === 'run.merge').length), 1);
    assert.equal(await page.locator('[data-build-id="run-history"]').getByRole('button', { name: 'Merge locally', exact: true }).count(), 0);
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
        await open('builds');
        await page.locator('[data-build-id="run-review"] > summary').click();
        assert.equal(await page.locator('.project-build:visible').count(), 1);
        await page.getByRole('button', { name: 'Back to build list', exact: true }).click();
        assert.equal(await page.locator('.project-build:visible').count(), 4);
        await page.locator('[data-filter="active"]').click();
        assert.equal(await page.locator('.project-build:visible').count(), 1);
        for (const section of ['issues', 'plans']) {
          await open(section);
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

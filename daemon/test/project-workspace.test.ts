import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
const directory = mkdtempSync(join(tmpdir(), 'nibbi-workspace-'));
process.env.NODE_ENV = 'test';
process.env.NIBBI_STATE_DIR = join(directory, 'state'); process.env.NIBBI_VAULT_DIR = join(directory, 'vault');
process.env.NIBBI_WORK_DIR = join(directory, 'work'); process.env.NIBBI_PROJECTS_DIR = join(directory, 'projects');
mkdirSync(process.env.NIBBI_VAULT_DIR, { recursive: true });
const { runtime, closeRuntime } = await import('../src/store.js');
const { parseProjectDocument, planPath } = await import('../src/roadmap.js');
const { readDocument, editDocuments, WorkspaceConflict } = await import('../src/workspace-documents.js');
const { projectSection, projectSummaries, projectCommand } = await import('../src/project-workspace.js');
const { queueFix, requeueFix, integrate, allowedRunActions } = await import('../src/fixer.js');
after(() => { closeRuntime(); rmSync(directory, { recursive: true, force: true }); });
function fixture(name: string, plan = '', issues = ''): string {
  const repo = join(directory, name); mkdirSync(repo, { recursive: true });
  runtime().put('config', 'projects', { ...runtime().get<Record<string, unknown>>('config', 'projects'), [name]: { repo, install: 'true', check: 'true', targetBranch: 'main' } });
  for (const [path, content] of [[planPath(name), plan], [join(process.env.NIBBI_VAULT_DIR!, 'games', name, 'issues.md'), issues]]) if (content) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }
  return name;
}
const revision = (project: string, section: string): string => projectSection(project, section).revision;
const command = (project: string, action: string, args: Record<string, unknown> = {}) => projectCommand({ project, action, expectedRevision: revision(project, action.startsWith('issue.') ? 'issues' : 'plans'), idempotencyKey: randomUUID(), ...args });
function ok(result: Awaited<ReturnType<typeof projectCommand>>): asserts result is Extract<typeof result, { ok: true }> { assert.equal(result.ok, true, JSON.stringify(result)); }

test('canonical grammar ignores backtick/tilde fenced checkboxes and preserves legacy task hashes', () => {
  const source = '# Outcome\n\n## First\n- [ ] Legacy\n  Reproduction detail.\n\nParagraph stays.\n+ [X] Plus\n1. [ ] Ordered\n2) [x] Also ordered\n```md\n## Fake\n- [ ] Hidden\n```\n~~~~\n* [ ] Hidden too\n~~~\n~~~~\n* [ ] Last <!-- nibbi-task:pinned -->\n';
  const data = parseProjectDocument(source);
  assert.equal(data.items.length, 5); assert.deepEqual(data.counts, { total: 5, open: 3, done: 2 });
  assert.equal(data.items[0].id, createHash('sha256').update('Legacy\0' + 0).digest('hex').slice(0, 16));
  assert.equal(data.items[0].description, 'Reproduction detail.'); assert.equal(data.items.at(-1)?.id, 'pinned');
  assert.equal(data.milestones.length, 1); assert.equal(data.milestones[0].total, 5);
  assert.equal(parseProjectDocument('-[ ] Legacy').items[0].id, data.items[0].id);
});
test('repeated reads and summaries never pin IDs, create missing vault documents, or change stored state', () => {
  const project = fixture('readonly', 'Written outcome only.\n', '# Notes\n\nInvestigate reported behavior.\n');
  const planBefore = readFileSync(planPath(project), 'utf8'), stateBefore = runtime().db.prepare('SELECT bucket,id,value,revision FROM records ORDER BY bucket,id').all();
  assert.equal(projectSection(project, 'plans').hasNotes, true);
  const batch = projectSummaries([project, project, 'vault']);
  assert.equal(batch.projects[project].issues.counts, null); assert.equal(batch.projects[project].issues.hasNotes, true);
  assert.equal(batch.projects.vault.plans.status, 'empty'); assert.equal(existsSync(planPath('vault')), false);
  assert.equal(readFileSync(planPath(project), 'utf8'), planBefore);
  assert.deepEqual(runtime().db.prepare('SELECT bucket,id,value,revision FROM records ORDER BY bucket,id').all(), stateBefore);
  assert.throws(() => projectSection('../escape', 'issues')); assert.throws(() => projectSection('unknown', 'plans'), /Unknown project/);
});
test('issue edits preserve source prose and unrelated completed items', async () => {
  const project = fixture('issue-edit', '', '# Issues\n\nIntro notes stay.\n\n## Browser\n- [ ] Broken button\n  Click twice.\n\nUnrelated notes stay.\n\n- [x] Old issue\n');
  const initial = projectSection(project, 'issues'), first = initial.items[0], old = initial.items[1];
  const edit = await command(project, 'issue.edit', { id: first.id, title: 'Button loses focus', description: 'Open the page.\nClick twice.' }); ok(edit);
  assert.equal(edit.section.items[0].id, first.id); assert.equal(edit.section.items[0].description, 'Open the page.\nClick twice.');
  assert.equal(edit.section.items[1].id, old.id); assert.equal(edit.section.items[1].done, true);
  assert.match(edit.section.markdown, /Intro notes stay/); assert.match(edit.section.markdown, /Unrelated notes stay/);
  const complete = await command(project, 'issue.complete', { id: first.id }); ok(complete); assert.equal(complete.section.items[0].checked, true);
  const reopen = await command(project, 'issue.reopen', { id: first.id }); ok(reopen); assert.equal(reopen.section.items[0].checked, false);
  const create = await command(project, 'issue.create', { title: 'New problem', description: 'Steps\nExpected result' }); ok(create);
  assert.equal(create.section.items.at(-1).id, create.itemId); assert.equal(create.section.counts.total, 3);
});
test('concurrent stale commands reject lost updates; idempotent replay returns the saved result', async () => {
  const project = fixture('conflicts', '', '- [ ] Original\n'), initial = projectSection(project, 'issues');
  const shared = { project, action: 'issue.edit', id: initial.items[0].id, expectedRevision: initial.revision }, input = { ...shared, title: 'First editor', idempotencyKey: randomUUID() };
  const results = await Promise.all([projectCommand(input), projectCommand({ ...shared, title: 'Other editor', idempotencyKey: randomUUID() })]);
  ok(results[0]); assert.equal(results[1].ok, false); if (!results[1].ok) assert.equal(results[1].error.code, 'REVISION_CONFLICT');
  assert.equal(projectSection(project, 'issues').items[0].text, 'First editor'); assert.equal(JSON.stringify(await projectCommand(input)), JSON.stringify(results[0]));
  assert.equal((await projectCommand({ ...input, title: 'Reuse key' })).ok, false);
  assert.deepEqual(readdirSync(join(process.env.NIBBI_VAULT_DIR!, 'games', project)), ['issues.md']);
});
test('atomic writer rejects external revisions and a simultaneous process lock', () => {
  const project = fixture('writer', '- [ ] Before\n'), file = planPath(project), before = readDocument(file);
  writeFileSync(file, 'External editor text\n'); assert.throws(() => editDocuments([{ ...before, next: 'Lost update\n' }]), WorkspaceConflict);
  const current = readDocument(file); writeFileSync(file + '.nibbi-lock', 'another writer');
  try { assert.throws(() => editDocuments([{ ...current, next: 'Conflicting write\n' }]), WorkspaceConflict); } finally { rmSync(file + '.nibbi-lock'); }
  assert.equal(readFileSync(file, 'utf8'), 'External editor text\n');
});
test('task and milestone reordering preserve duplicate identities, prose, completed history and selected milestone', async () => {
  const project = fixture('plan-edit', '# Project\n\nDeliver the outcome.\n\n## Alpha\n\nMilestone context.\n\n- [ ] Duplicate\n  First description\n\nStandalone note.\n\n- [x] Duplicate\n  Completed description\n\n## Beta\n\nOther context.\n- [ ] Last\n');
  const initial = projectSection(project, 'plans'), [a, b] = initial.milestones, [first, done] = initial.items;
  const edit = await command(project, 'task.edit', { id: first.id, title: 'Renamed first' }); ok(edit);
  assert.deepEqual(edit.section.items.map((item: any) => item.id), initial.items.map((item: any) => item.id));
  const reordered = await command(project, 'task.reorder', { milestoneId: a.id, ids: [done.id, first.id] }); ok(reordered);
  assert.equal(reordered.section.items[0].id, done.id); assert.equal(reordered.section.items[0].done, true); assert.equal(reordered.section.items[0].description, 'Completed description');
  assert.match(reordered.section.markdown, /Standalone note/); assert.match(reordered.section.markdown, /Deliver the outcome/);
  const milestone = await command(project, 'milestone.edit', { id: a.id, title: 'Renamed milestone' }); ok(milestone); assert.equal(milestone.section.milestones[0].id, a.id);
  const select = await command(project, 'milestone.select', { id: a.id }); ok(select);
  const order = await command(project, 'milestone.reorder', { ids: [b.id, a.id] }); ok(order); assert.deepEqual(order.section.milestones.map((m: any) => m.id), [b.id, a.id]); assert.equal(order.section.currentMilestone.id, a.id);
  const move = await command(project, 'task.edit', { id: first.id, milestoneId: b.id }); ok(move); assert.equal(move.section.items.find((item: any) => item.id === first.id).milestoneId, b.id);
  const outside = await command(project, 'task.edit', { id: first.id, milestoneId: '' }); ok(outside); assert.equal(outside.section.items.find((item: any) => item.id === first.id).milestoneId, undefined);
  assert.equal((await command(project, 'task.reorder', { milestoneId: a.id, ids: [] })).ok, false);
});
test('missing plan creation is revision aware and new descriptions persist', async () => {
  const project = fixture('new-plan'), initial = projectSection(project, 'plans'); assert.equal(initial.status, 'empty');
  const create = await command(project, 'milestone.create', { title: 'First outcome', description: 'A useful milestone' }); ok(create);
  const task = await command(project, 'task.create', { milestoneId: create.itemId, title: 'First step', description: 'Acceptance details' }); ok(task);
  assert.equal(task.section.milestones[0].description, 'A useful milestone'); assert.equal(task.section.milestones[0].total, 1); assert.equal(task.section.items[0].description, 'Acceptance details');
  const stale = await projectCommand({ project, action: 'milestone.create', title: 'Stale writer', expectedRevision: initial.revision, idempotencyKey: randomUUID() }); assert.equal(stale.ok, false);
});
test('issue-to-plan links survive rename and reorder and cannot be duplicated', async () => {
  const project = fixture('links', '## Current\n\n- [ ] Existing\n', '- [ ] Reported problem\n  Steps to reproduce\n'), issue = projectSection(project, 'issues').items[0], plan = projectSection(project, 'plans');
  const linked = await command(project, 'issue.plan', { id: issue.id, planRevision: plan.revision, milestoneId: plan.milestones[0].id }); ok(linked);
  assert.deepEqual(linked.section.items[0].linkedTaskIds, [linked.itemId]); assert.equal(linked.plan?.items.at(-1).description, 'Steps to reproduce');
  ok(await command(project, 'issue.edit', { id: issue.id, title: 'Precise problem' })); ok(await command(project, 'task.edit', { id: linked.itemId, title: 'Precise solution' }));
  const current = projectSection(project, 'plans'); ok(await command(project, 'task.reorder', { milestoneId: current.milestones[0].id, ids: current.items.map((item: any) => item.id).reverse() }));
  assert.deepEqual(projectSection(project, 'issues').items[0].linkedTaskIds, [linked.itemId]);
  assert.equal((await command(project, 'issue.plan', { id: issue.id, planRevision: revision(project, 'plans') })).ok, false);
  const another = await command(project, 'issue.create', { title: 'New issue' }); ok(another);
  assert.equal((await command(project, 'issue.plan', { id: another.itemId, planRevision: plan.revision })).ok, false); assert.equal(projectSection(project, 'plans').items.length, 2);
});
test('contextual queued dispatch and retry preserve links without starting a worker; duplicate dispatch is rejected', async () => {
  const project = fixture('dispatch', '## Delivery\n', '- [ ] Fix issue\n  Reproduce reliably.\n'), issue = projectSection(project, 'issues').items[0];
  const linked = await command(project, 'issue.plan', { id: issue.id, planRevision: revision(project, 'plans') }); ok(linked);
  const dispatch = async (input: Record<string, unknown>) => { assert.equal(input.name, 'run.dispatch'); const args = input.args as Record<string, any>; return { ok: true, data: queueFix(String(input.projectId), args.issue, args) }; };
  const result = await projectCommand({ project, action: 'task.build', id: linked.itemId, expectedRevision: revision(project, 'plans'), idempotencyKey: randomUUID() }, { dispatch }); ok(result);
  const run = result.run as import('../src/fixer.js').Fixer;
  assert.equal(run.taskId, linked.itemId); assert.deepEqual(run.issueIds, [issue.id]); assert.match(run.issue, /Reproduce reliably/);
  assert.equal(projectSection(project, 'plans').items[0].checked, false); assert.equal(projectSection(project, 'issues').items[0].checked, false);
  const duplicate = await projectCommand({ project, action: 'issue.build', id: issue.id, expectedRevision: revision(project, 'issues'), idempotencyKey: randomUUID() }, { dispatch }); assert.equal(duplicate.ok, false);
  run.status = 'failed'; runtime().put('fixers', run.id, run); requeueFix(run.id);
  const retried = projectSection(project, 'builds').runs.find((item: any) => item.id !== run.id);
  assert.equal(retried.taskId, linked.itemId); assert.deepEqual(retried.issueIds, [issue.id]); assert.equal(projectSection(project, 'issues').items[0].linkedBuilds.length, 2);
});
test('staged or unverified run never completes task or issue; manual issue completion leaves the task unfinished', async () => {
  const project = fixture('completion', '- [ ] Task <!-- nibbi-task:task-id --> <!-- nibbi-issue-ref:issue-id -->\n', '- [ ] Issue <!-- nibbi-issue:issue-id -->\n');
  const run = queueFix(project, 'Task', { taskId: 'task-id' }); run.status = 'staged'; runtime().put('fixers', run.id, run);
  assert.equal(projectSection(project, 'plans').items[0].done, false); assert.equal(projectSection(project, 'issues').items[0].done, false);
  assert.equal((await integrate(run)).reason, 'unverified'); assert.equal(allowedRunActions(run).includes('run.merge'), false);
  assert.equal(projectSection(project, 'plans').items[0].done, false); assert.equal(projectSection(project, 'issues').items[0].done, false);
  ok(await command(project, 'issue.complete', { id: 'issue-id' })); assert.equal(projectSection(project, 'plans').items[0].done, false);
});
test('build summaries share full-view counts and distinguish workflow from evidence', () => {
  const project = fixture('build-counts');
  for (const [index, status] of ['queued', 'installing', 'running', 'verifying', 'staged', 'done', 'failed', 'interrupted', 'merged', 'cancelled', 'discarded', 'superseded'].entries()) runtime().put('fixers', 'count-' + index, { id: 'count-' + index, game: project, issue: 'purpose', status, startedAt: new Date().toISOString(), worktree: '/nonexistent-workspace-fixture', verification: { status: index === 4 ? 'failed' : 'unverified' } });
  const summary = projectSummaries([project]).projects[project], full = projectSection(project, 'builds');
  assert.deepEqual(summary.builds.counts, full.counts); assert.equal(full.counts.total, 12); assert.equal(full.counts.active, 4); assert.equal(full.counts.review, 2); assert.equal(full.counts.failed, 2); assert.equal(full.counts.history, 4);
  const staged = full.runs.find((run: any) => run.id === 'count-4'); assert.equal(staged.verification.status, 'failed'); assert.equal(staged.allowedActions.includes('run.merge'), false);
});

test('inline descriptions retain checklist, heading and code examples as notes, without inventing tasks or milestones', async () => {
  const project = fixture('description-notes');
  const description = 'Reproduction:\n- [ ] Example checkbox\n## Example heading\n```md\n+ [x] Example code\n```';
  const created = await command(project, 'issue.create', { title: 'Inspect the note', description }); ok(created);
  assert.equal(created.section.items.length, 1); assert.equal(created.section.items[0].description, description); assert.equal(created.section.milestones.length, 0);
  const milestone = await command(project, 'milestone.create', { title: 'Real milestone', description }); ok(milestone);
  assert.equal(milestone.section.items.length, 0); assert.equal(milestone.section.milestones.length, 1); assert.equal(milestone.section.milestones[0].description, description);
  const task = await command(project, 'task.create', { title: 'Real task', description, milestoneId: milestone.itemId }); ok(task);
  assert.equal(task.section.items.length, 1); assert.equal(task.section.items[0].description, description);
});
test('active activity comes from bounded stored events and awaiting-input work blocks duplicate builds', async () => {
  const project = fixture('activity', '', '- [ ] Problem <!-- nibbi-issue:active-issue -->\n');
  const run = queueFix(project, 'Problem', { issueIds: ['active-issue'] }); run.status = 'awaiting_input'; runtime().put('fixers', run.id, run);
  runtime().emit({ type: 'process.output', runId: run.id, projectId: project, payload: { text: 'Checking the fixture' } });
  const view = projectSection(project, 'builds'); assert.equal(view.counts.active, 1); assert.equal(view.runs[0].currentActivity, 'Checking the fixture');
  runtime().emit({ type: 'tool.started', runId: run.id, projectId: project, payload: { name: 'Read' } }); assert.equal(projectSection(project, 'builds').runs[0].currentActivity, 'Read');
  runtime().emit({ type: 'text.delta', runId: run.id, projectId: project, payload: { text: 'x'.repeat(2000) } }); assert.equal(projectSection(project, 'builds').runs[0].currentActivity.length, 400);
  assert.throws(() => queueFix(project, 'Try again', { issueIds: ['active-issue'] }), /already has/); assert.equal((await command(project, 'issue.build', { id: 'active-issue' })).ok, false);
});
test('HTTP reads agree; edits return revisions and explicit stale/method errors', async () => {
  const { createServer } = await import('node:http'), { api } = await import('../src/api.js'), { json, HttpError } = await import('../src/http.js');
  const project = fixture('http-fixture', '', '- [ ] Before\n');
  const server = createServer((req, res) => { api(req, res, new URL(req.url!, 'http://fixture')).catch(error => json(res, error instanceof HttpError ? error.status : 400, { error: error.message })); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + (server.address() as import('node:net').AddressInfo).port;
  try {
    const section = await (await fetch(base + '/api/project-section?project=' + project + '&section=issues')).json() as Record<string, any>;
    const summaries = await (await fetch(base + '/api/project-summaries?projects=' + project)).json() as Record<string, any>;
    assert.deepEqual(section.counts, summaries.projects[project].issues.counts); assert.equal(section.revision, summaries.projects[project].issues.revision);
    const body = { project, action: 'issue.edit', expectedRevision: section.revision, id: section.items[0].id, title: 'Saved over HTTP' };
    const post = () => fetch(base + '/api/project-command', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const save = await post(); assert.equal(save.status, 200);
    const saved = await save.json() as Record<string, any>; assert.equal(saved.section.items[0].text, body.title); assert.notEqual(saved.section.revision, section.revision);
    const stale = await post(); assert.equal(stale.status, 409); const conflict = await stale.json() as Record<string, any>; assert.equal(conflict.error.code, 'REVISION_CONFLICT'); assert.equal(conflict.revision, saved.section.revision);
    assert.equal((await fetch(base + '/api/project-command')).status, 405);
    assert.equal((await fetch(base + '/api/project-section?project=' + project + '&section=issues', { method: 'POST' })).status, 405);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('legacy indented fenced descriptions move intact, and selecting a milestone preserves fenced marker examples', async () => {
  const project = fixture('legacy-notes', '# Plan\n\n```md\n<!-- nibbi-current-milestone:example -->\n```\n\n## Delivery\n\n- [ ] First\n  ```md\n  - [ ] Example only\n  ```\n\n- [ ] Second\n');
  const initial = projectSection(project, 'plans'); assert.equal(initial.items.length, 2); assert.equal(initial.items[0].description, '```md\n- [ ] Example only\n```');
  const selected = await command(project, 'milestone.select', { id: initial.milestones[0].id }); ok(selected); assert.match(selected.section.markdown, /<!-- nibbi-current-milestone:example -->/);
  const reordered = await command(project, 'task.reorder', { milestoneId: initial.milestones[0].id, ids: initial.items.map((item: any) => item.id).reverse() }); ok(reordered);
  assert.equal(reordered.section.items[1].description, initial.items[0].description); assert.equal(reordered.section.items.length, 2);
});

test('pinning legal ATX closing hashes preserves milestone labels, identities and Markdown closing syntax', async () => {
  const { pinDocument } = await import('../src/roadmap.js');
  const source = '## Delivery ##\n\n- [ ] Existing\n';
  const before = parseProjectDocument(source), pinned = pinDocument(source), after = parseProjectDocument(pinned);
  assert.equal(before.milestones[0].name, 'Delivery'); assert.equal(after.milestones[0].name, 'Delivery');
  assert.equal(before.milestones[0].id, after.milestones[0].id); assert.match(pinned.split('\n')[0], /<!-- nibbi-milestone:[^>]+ --> ##$/);
  assert.equal(parseProjectDocument('## Delivery ## <!-- nibbi-milestone:already-pinned -->\n').milestones[0].name, 'Delivery');
  const project = fixture('atx-closing', source);
  const created = await command(project, 'task.create', { title: 'Another task', milestoneId: before.milestones[0].id }); ok(created);
  assert.equal(created.section.milestones[0].name, 'Delivery'); assert.equal(created.section.milestones[0].id, before.milestones[0].id);
});

test('hidden issue, task and milestone creation inside unfinished fences is rejected without source writes', async () => {
  const project = fixture('unfinished-fence', '## Existing\n\n```md\nUnfinished plan example\n', '# Issues\n\n~~~md\nUnfinished issue example\n');
  const planBefore = readFileSync(planPath(project), 'utf8');
  const issuePath = join(process.env.NIBBI_VAULT_DIR!, 'games', project, 'issues.md'), issuesBefore = readFileSync(issuePath, 'utf8');
  for (const action of ['issue.create', 'task.create', 'milestone.create']) {
    const result = await command(project, action, { title: 'Must remain visible after saving' });
    assert.equal(result.ok, false); if (!result.ok) assert.match(result.error.message, /Nothing was saved.*Close the open code fence/s);
    assert.equal(readFileSync(planPath(project), 'utf8'), planBefore); assert.equal(readFileSync(issuePath, 'utf8'), issuesBefore);
  }
  assert.equal(projectSection(project, 'plans').items.length, 0); assert.equal(projectSection(project, 'issues').items.length, 0);
});

test('Add to plan rejects a hidden destination before pinning either document', async () => {
  const project = fixture('unfinished-plan-link', '## Existing\n\n```md\nUnfinished example\n', '- [ ] Keep original issue\n');
  const plan = projectSection(project, 'plans'), issues = projectSection(project, 'issues');
  const result = await command(project, 'issue.plan', { id: issues.items[0].id, planRevision: plan.revision, milestoneId: plan.milestones[0].id });
  assert.equal(result.ok, false); if (!result.ok) assert.match(result.error.message, /Nothing was saved/);
  assert.equal(projectSection(project, 'plans').markdown, plan.markdown); assert.equal(projectSection(project, 'issues').markdown, issues.markdown);
  assert.equal(projectSection(project, 'issues').items[0].explicit, false); assert.deepEqual(projectSection(project, 'issues').items[0].linkedTaskIds, []);
});

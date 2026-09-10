import { githubBuildSummary } from './github-builds.js';
import { createHash, randomUUID } from 'node:crypto';
import { relative } from 'node:path';
import { z } from 'zod';
import { config } from './config.js';
import { runtime } from './store.js';
import { listFixers, allowedRunActions, type Fixer } from './fixer.js';
import { parseProjectDocument, pinDocument, planPath, type RoadmapTask } from './roadmap.js';
import { issueDocument } from './project-issues.js';
import { editDocuments, readDocument, WorkspaceConflict, type WorkspaceDocument } from './workspace-documents.js';
import type { GameCfg } from './projects.js';

const projectSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(150);
const actionSchema = z.enum(['issue.create', 'issue.edit', 'issue.complete', 'issue.reopen', 'issue.build', 'issue.plan', 'task.create', 'task.edit', 'task.reorder', 'task.build', 'milestone.create', 'milestone.edit', 'milestone.reorder', 'milestone.select']);
const inputSchema = z.object({ project: projectSchema, action: actionSchema, expectedRevision: z.string().length(64), id: z.string().min(1).max(150).optional(), title: z.string().trim().min(1).max(1000).optional(), description: z.string().max(40_000).optional(), milestoneId: z.string().max(150).nullable().optional(), ids: z.array(z.string().min(1).max(150)).max(5000).optional(), planRevision: z.string().length(64).optional(), idempotencyKey: z.string().min(1).max(250) }).strict();
export type ProjectCommandInput = z.infer<typeof inputSchema>;
const registry = (): Record<string, GameCfg> => runtime().get('config', 'projects') ?? runtime().get('legacy', 'games.json') ?? {};
function checkProject(project: string): void { projectSchema.parse(project); if (project !== 'vault' && !registry()[project]) throw new Error('Unknown project'); }
const sectionSchema = z.enum(['builds', 'issues', 'plans']);
const phase = (status: string): string => ['queued', 'preparing', 'installing', 'running', 'awaiting_input', 'checking', 'verifying', 'merging'].includes(status) ? 'active' : ['staged', 'done'].includes(status) ? 'review' : ['failed', 'interrupted'].includes(status) ? 'failed' : 'history';
function reportedActivity(run: Fixer): string | undefined {
  if (phase(run.status) !== 'active') return;
  const rows = runtime().db.prepare("SELECT type,payload FROM events WHERE run_id=? AND type IN ('process.output','tool.started','text.delta') ORDER BY id DESC LIMIT 12").all(run.id) as Array<{ type: string; payload: string }>;
  const first = rows[0]; if (!first) return;
  const payload = JSON.parse(first.payload) as Record<string, unknown>;
  const value = first.type === 'tool.started' ? String(payload.name ?? '') : first.type === 'text.delta'
    ? rows.slice(0, rows.findIndex(row => row.type !== 'text.delta') < 0 ? rows.length : rows.findIndex(row => row.type !== 'text.delta')).reverse().map(row => String(JSON.parse(row.payload).text ?? '')).join('')
    : String(payload.text ?? '');
  return value.replace(/\x1b\[[0-9;]*m/g, '').trim().slice(-400) || undefined;
}
const runView = (run: Fixer): Fixer & { github: Record<string, any>; allowedActions: string[]; groupStatus: string; currentActivity?: string } => ({ ...run, github: githubBuildSummary(run.id), allowedActions: allowedRunActions(run), groupStatus: phase(run.status), currentActivity: reportedActivity(run) });
function buildCounts(runs: ReturnType<typeof runView>[]): Record<string, any> {
  const counts = { total: runs.length, active: 0, review: 0, failed: 0, history: 0, toPush: 0, pullRequests: 0, attention: 0, readyPR: 0, byStatus: {} as Record<string, number> };
  for (const run of runs) {
    const group = phase(run.status), github = run.github;
    if (group === 'active') counts.active++;
    if (group === 'failed') counts.failed++;
    if (github.toPush) counts.toPush++;
    if (github.pullRequest) counts.pullRequests++;
    if (github.readyPR) counts.readyPR++;
    if (group === 'failed' || github.needsAttention) counts.attention++;
    if (group === 'review' && !github.pullRequest && !github.toPush && !github.needsAttention) counts.review++;
    if (group === 'history' && !github.pullRequest && !github.toPush && !github.needsAttention) counts.history++;
    counts.byStatus[run.status] = (counts.byStatus[run.status] ?? 0) + 1;
  }
  return counts;
}
function projectRuns(project: string, all = listFixers()): ReturnType<typeof runView>[] { return all.filter(run => (run.game || run.project) === project).sort((a, b) => Date.parse(b.endedAt || b.startedAt) - Date.parse(a.endedAt || a.startedAt)).map(runView); }
export function projectSection(project: string, section: string, runSnapshot?: ReturnType<typeof runView>[]): Record<string, any> {
  checkProject(project); sectionSchema.parse(section);
  const base = { project, kind: project === 'vault' ? 'brain' : 'game', section, warnings: [] as Array<{ source: string; message: string }>, fetchedAt: Date.now() };
  const runs = runSnapshot ?? projectRuns(project);
  if (section === 'builds') return { ...base, status: runs.length ? 'ready' : 'empty', runs, files: [], counts: buildCounts(runs), revision: createHash('sha256').update(JSON.stringify(runs)).digest('hex') };
  const doc = section === 'issues' ? issueDocument(project) : readDocument(planPath(project));
  const parsed = parseProjectDocument(doc.markdown, section === 'issues' ? 'issue' : 'task');
  let tasks: RoadmapTask[] = [];
  if (section === 'issues') {
    try { tasks = parseProjectDocument(readDocument(planPath(project)).markdown).items; }
    catch (error) { base.warnings.push({ source: 'plan links', message: (error as Error).message }); }
  }
  const view = (item: RoadmapTask): Record<string, any> => ({ ...item, line: item.line + 1, title: item.text,
    githubIssueLinks: section === 'issues' ? runtime().list<any>('github-issue-links').filter(link => link.project === project && link.issueId === item.id) : [],
    linkedTaskIds: section === 'issues' ? tasks.filter(task => task.issueIds.includes(item.id)).map(task => task.id) : [],
    linkedBuilds: runs.filter(run => section === 'issues' ? run.issueIds?.includes(item.id) : run.taskId === item.id) });
  const items = parsed.items.map(view);
  const milestones = parsed.milestones.map(milestone => ({ ...milestone, line: milestone.line + 1, tasks: items.filter(item => item.milestoneId === milestone.id) }));
  return { ...base, ...parsed, path: relative(config.vaultDir, doc.path), revision: doc.revision, items, linkedBuildCount: new Set(items.flatMap(item => item.linkedBuilds.map((run: Fixer) => run.id))).size, headings: parsed.headings.map(heading => ({ ...heading, line: heading.line + 1 })), milestones,
    status: base.warnings.length ? 'partial' : doc.markdown.trim() ? 'ready' : 'empty', hasNotes: !!doc.markdown.trim() && !items.length };
}
export function projectSummaries(projects: string[]): { projects: Record<string, any> } {
  if (projects.length > 50) throw new Error('Request at most 50 project summaries');
  const result: Record<string, any> = {}, allRuns = listFixers();
  for (const project of [...new Set(projects)]) {
    const summary: Record<string, any> = { project };
    const runs = projectRuns(project, allRuns);
    for (const section of ['builds', 'issues', 'plans']) {
      try {
        const data = projectSection(project, section, runs);
        if (section === 'builds') {
          const counts = data.counts;
          summary.builds = { status: data.status, counts, revision: data.revision, runs: data.runs.map((run: ReturnType<typeof runView>) => ({ id: run.id, status: run.status, verification: run.verification, github: run.github })), fetchedAt: data.fetchedAt };
        } else summary[section] = { status: data.status, counts: data.counts, hasNotes: data.hasNotes, linkedBuildCount: data.linkedBuildCount, revision: data.revision, currentMilestone: data.currentMilestone, warnings: data.warnings, fetchedAt: data.fetchedAt };
      } catch (error) { summary[section] = { status: 'unavailable', counts: null, warnings: [{ source: section, message: (error as Error).message }] }; }
    }
    result[project] = summary;
  }
  return { projects: result };
}
function requireRevision(doc: WorkspaceDocument, expected?: string): void { if (doc.revision !== expected) throw new WorkspaceConflict(doc.revision); }
function one<T extends { id: string }>(items: T[], id?: string): T { const found = items.filter(item => item.id === id); if (found.length !== 1) throw new Error('Item no longer exists or its ID is ambiguous; refresh the document'); return found[0]; }
function safeTitle(title?: string): string { if (!title || /[\r\n]|<!--\s*nibbi-/i.test(title)) throw new Error('Enter a single-line title without reserved identity markers'); return title; }
function safeDescription(value: string): string { if (/<!--\s*nibbi-/i.test(value)) throw new Error('Descriptions cannot contain reserved identity markers'); return value; }
const describe = (value: string): string[] => value ? ['  <!-- nibbi-description:start -->', ...safeDescription(value).split(/\r?\n/).map(line => '  ' + line), '  <!-- nibbi-description:end -->'] : [];
function itemBlock(id: string, title: string, description: string, kind: 'task' | 'issue', issueIds: string[] = []): string[] { return [`- [ ] ${safeTitle(title)} <!-- nibbi-${kind}:${id} -->${issueIds.map(id => ` <!-- nibbi-issue-ref:${id} -->`).join('')}`, ...describe(description)]; }
function requireCreatedItem(markdown: string, kind: 'task' | 'issue' | 'milestone', id: string): void {
  const parsed = parseProjectDocument(markdown, kind === 'issue' ? 'issue' : 'task');
  const records = kind === 'milestone' ? parsed.milestones : parsed.items;
  if (records.filter(item => item.id === id).length !== 1) throw new Error('Nothing was saved: the new ' + kind + ' is inside an unfinished Markdown block. Close the open code fence or description block in the source document, then try again.');
}
function insertTask(markdown: string, block: string[], milestoneId?: string | null): string {
  const parsed = parseProjectDocument(markdown), lines = markdown.split('\n');
  const at = milestoneId ? one(parsed.milestones, milestoneId).endLine : milestoneId === undefined ? lines.length : parsed.milestones[0]?.line ?? lines.length;
  lines.splice(at, 0, ...(at && lines[at - 1]?.trim() ? [''] : []), ...block, '');
  return lines.join('\n');
}
function editItem(markdown: string, kind: 'task' | 'issue', input: ProjectCommandInput): string {
  const parsed = parseProjectDocument(markdown, kind), item = one(parsed.items, input.id), lines = markdown.split('\n');
  if (input.title !== undefined) {
    const prefix = lines[item.line].match(/^(\s*(?:[-+*][ \t]*|\d+[.)][ \t]+)\[[ xX]\][ \t]*)/)?.[1];
    const markers = lines[item.line].match(/<!--\s*nibbi-[^>]+-->/g)?.join(' ') ?? '';
    lines[item.line] = prefix + safeTitle(input.title) + ' ' + markers;
  }
  if (input.action === 'issue.complete' || input.action === 'issue.reopen') lines[item.line] = lines[item.line].replace(/\[[ xX]\]/, input.action === 'issue.complete' ? '[x]' : '[ ]');
  if (input.description !== undefined) lines.splice(item.line + 1, item.endLine - item.line - 1, ...describe(input.description));
  let next = lines.join('\n');
  if (kind === 'task' && input.milestoneId !== undefined && (input.milestoneId || null) !== (item.milestoneId ?? null)) {
    const updated = parseProjectDocument(next), moving = one(updated.items, item.id), values = next.split('\n');
    const block = values.splice(moving.line, moving.endLine - moving.line);
    next = insertTask(values.join('\n'), block, input.milestoneId);
  }
  return next;
}
function reorder(markdown: string, ids: string[] | undefined, milestoneId?: string | null, milestones = false): string {
  const parsed = parseProjectDocument(markdown), lines = markdown.split('\n');
  const entries = milestones ? parsed.milestones : parsed.items.filter(item => (item.milestoneId ?? null) === (milestoneId ?? null));
  if (!ids || ids.length !== entries.length || new Set(ids).size !== entries.length || entries.some(item => !ids.includes(item.id))) throw new Error('Ordering must contain every item in this milestone exactly once');
  const blocks = new Map(entries.map(item => [item.id, lines.slice(item.line, item.endLine)]));
  for (let index = entries.length - 1; index >= 0; index--) lines.splice(entries[index].line, entries[index].endLine - entries[index].line, ...blocks.get(ids[index])!);
  return lines.join('\n');
}
export type ProjectCommandResult = { ok: true; section: Record<string, any>; itemId?: string; run?: unknown; plan?: Record<string, any> } | { ok: false; error: { code: string; message: string }; revision?: string };
export interface ProjectCommandDependencies { dispatch?: (input: Record<string, unknown>) => Promise<{ ok: boolean; data?: unknown; error?: { message: string } }> }
/** All mutations are revision guarded; dispatch still goes through the existing governed command service. */
export async function projectCommand(value: unknown, dependencies: ProjectCommandDependencies = {}): Promise<ProjectCommandResult> {
  const parsedInput = inputSchema.safeParse(value);
  if (!parsedInput.success) return { ok: false, error: { code: 'INVALID_REQUEST', message: parsedInput.error.message } };
  const input = parsedInput.data, store = runtime();
  try {
    checkProject(input.project);
    const claim = store.claimCommand('project:' + input.idempotencyKey, input);
    if (claim.state === 'complete') return claim.result as ProjectCommandResult;
    if (claim.state !== 'new') return { ok: false, error: { code: 'IN_PROGRESS', message: 'This action is already in progress. Refresh to inspect its result.' } };
  } catch (error) { return { ok: false, error: { code: 'CONFLICT', message: (error as Error).message } }; }
  let result: ProjectCommandResult;
  try {
    const section = input.action.startsWith('issue.') ? 'issues' : 'plans', kind = section === 'issues' ? 'issue' : 'task';
    const doc = section === 'issues' ? issueDocument(input.project) : readDocument(planPath(input.project));
    requireRevision(doc, input.expectedRevision);
    let next = pinDocument(doc.markdown, kind), itemId: string | undefined = input.id, run: unknown, changedPlan = false;
    const action = input.action;
    if (action === 'issue.create' || action === 'task.create') {
      itemId = randomUUID(); const block = itemBlock(itemId, safeTitle(input.title), input.description ?? '', kind);
      next = kind === 'task' ? insertTask(next, block, input.milestoneId) : next + (next && !next.endsWith('\n\n') ? '\n\n' : '') + block.join('\n') + '\n';
      requireCreatedItem(next, kind, itemId);
    } else if (['issue.edit', 'issue.complete', 'issue.reopen', 'task.edit'].includes(action)) next = editItem(next, kind, input);
    else if (action === 'milestone.create') {
      itemId = randomUUID();
      next += (next && !next.endsWith('\n\n') ? '\n\n' : '') + `## ${safeTitle(input.title)} <!-- nibbi-milestone:${itemId} -->\n\n` + (input.description ? ['<!-- nibbi-description:start -->', safeDescription(input.description), '<!-- nibbi-description:end -->', '', ''].join('\n') : '');
      requireCreatedItem(next, 'milestone', itemId);
    } else if (action === 'milestone.edit') {
      const milestone = one(parseProjectDocument(next).milestones, input.id), lines = next.split('\n');
      if (input.title !== undefined) lines[milestone.line] = `## ${safeTitle(input.title)} <!-- nibbi-milestone:${milestone.id} -->`;
      if (input.description !== undefined) lines.splice(milestone.line + 1, milestone.descriptionEnd - milestone.line - 1, '', '<!-- nibbi-description:start -->', ...safeDescription(input.description).split(/\r?\n/), '<!-- nibbi-description:end -->', '');
      next = lines.join('\n');
    } else if (action === 'milestone.select') {
      const parsed = parseProjectDocument(next), milestone = input.id ? one(parsed.milestones, input.id) : undefined;
      next = next.split('\n').filter((_, index) => !parsed.selectionLines.includes(index)).join('\n');
      if (milestone) next = `<!-- nibbi-current-milestone:${milestone.id} -->\n` + next;
    } else if (action === 'task.reorder' || action === 'milestone.reorder') next = reorder(next, input.ids, input.milestoneId, action === 'milestone.reorder');
    else if (action === 'issue.plan') {
      const issue = one(parseProjectDocument(next, 'issue').items, input.id), plan = readDocument(planPath(input.project));
      requireRevision(plan, input.planRevision);
      const pinned = pinDocument(plan.markdown), already = parseProjectDocument(pinned).items.find(item => item.issueIds.includes(issue.id));
      if (already) throw new Error('This issue is already linked to a plan task');
      itemId = randomUUID();
      const planNext = insertTask(pinned, itemBlock(itemId, issue.text, issue.description, 'task', [issue.id]), input.milestoneId);
      requireCreatedItem(planNext, 'task', itemId);
      editDocuments([{ ...doc, next }, { ...plan, next: planNext }]); changedPlan = true;
    } else if (action === 'issue.build' || action === 'task.build') {
      if (input.project === 'vault') throw new Error('Choose a registered code project to build this item');
      const item = one(parseProjectDocument(next, kind).items, input.id);
      if (item.done) throw new Error('Completed items cannot start a new build');
      const issueIds = kind === 'issue' ? [item.id] : item.issueIds;
      const duplicate = projectRuns(input.project).find(run => ['active', 'review'].includes(phase(run.status)) && (kind === 'task' && run.taskId === item.id || issueIds.some(id => run.issueIds?.includes(id))));
      if (duplicate) throw new Error('This item already has an active or reviewable build: ' + duplicate.id);
      editDocuments([{ ...doc, next }]);
      const dispatch = dependencies.dispatch ?? (await import('./command-service.js')).executeCommand;
      const dispatched = await dispatch({ name: 'run.dispatch', projectId: input.project, idempotencyKey: 'project-build:' + input.idempotencyKey, args: { issue: item.text + (item.description ? '\n\n' + item.description : ''), title: item.text, ...(kind === 'task' ? { taskId: item.id } : {}), issueIds } });
      if (!dispatched.ok) throw new Error(dispatched.error?.message ?? 'Build could not be dispatched');
      run = dispatched.data;
    }
    if (!changedPlan && !action.endsWith('.build')) editDocuments([{ ...doc, next }]);
    store.emit({ type: 'project.workspace_updated', projectId: input.project, payload: { section, action, itemId } });
    store.emit({ type: 'vault.updated', projectId: input.project, payload: { path: relative(config.vaultDir, doc.path) } });
    if (changedPlan) store.emit({ type: 'vault.updated', projectId: input.project, payload: { path: `plans/${input.project}.md` } });
    result = { ok: true, section: projectSection(input.project, section), itemId, ...(run ? { run } : {}), ...(changedPlan ? { plan: projectSection(input.project, 'plans') } : {}) };
  } catch (error) {
    result = { ok: false, error: { code: error instanceof WorkspaceConflict ? error.code : 'COMMAND_FAILED', message: (error as Error).message }, ...(error instanceof WorkspaceConflict ? { revision: error.revision } : {}) };
  }
  store.finishCommand('project:' + input.idempotencyKey, result); return result;
}

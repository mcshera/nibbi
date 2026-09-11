// Plan before dispatch: the lead proposes reviewable steps, the owner approves, the backend queues one independent Build per step.
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { runtime, type RuntimeStore } from './store.js';
import { parseProjectDocument, planPath, type RoadmapTask } from './roadmap.js';
import { readDocument } from './workspace-documents.js';
import { spawnFixer, type FixerOpts } from './fixer.js';

export type ProposalState = 'prepared' | 'executing' | 'executed' | 'failed' | 'cancelled' | 'expired';
export interface ProposalStep { n: number; title: string; issue: string; taskId?: string; taskText?: string; issueIds?: string[]; context?: string; dependsOn?: number[] }
export interface ReviewStep { n: number; title: string; task: { id: string; text: string; milestone: string | null } | null; issueIds: string[]; context: string; dependsOn: number[] }
export interface Proposal {
  id: string; project: string; prompt: string; leadRunId: string; state: ProposalState; summary: string; rationale: string; steps: ProposalStep[];
  review: { summary: string; steps: ReviewStep[]; warnings: string[]; roadmapRevision: string };
  fingerprint: string; createdAt: number; expiresAt: number; executedAt?: number; results?: Array<{ n: number; runId: string }>; error?: string;
}
export interface ProposalDraftStep { title: string; task: string; taskId?: string; context?: string; dependsOn?: number[] }
export interface ProposalDraft { summary: string; steps: ProposalDraftStep[] }
type RunTurn = typeof import('./session.js').runTurn;
type TurnResult = Awaited<ReturnType<RunTurn>>;
type Notify = (text: string) => Promise<void>;
/** Structural stand-in for spawnFixer so execution can be exercised without a provider. */
export type SpawnStep = (project: string, issue: string, notify: Notify, opts: FixerOpts) => { id: string } | Promise<{ id: string }>;
export interface ProposeOptions { runTurn: RunTurn; channel?: string; onDelta?: Parameters<RunTurn>[4]; onTool?: Parameters<RunTurn>[5]; images?: Parameters<RunTurn>[6]; leadRunIdRef?: { current?: string }; turnOptions?: Omit<NonNullable<Parameters<RunTurn>[8]>, 'project' | 'allowDispatch'> }

const BUCKET = 'plan-proposals', TTL = 30 * 60_000, MAX_STEPS = 12;
export const PLAN_INSTRUCTION = 'Planning mode: do not dispatch. Read the roadmap with read_roadmap. Reply with a short rationale, then exactly one ```json fence containing {"summary": string, "steps": [{"title": string, "task": string, "taskId"?: string, "context"?: string, "dependsOn"?: number[]}]}. Propose only independently testable steps (1-12); "task" is the complete instruction a coding agent receives; "taskId" must be a canonical id from read_roadmap for an unfinished task and may be used once; "dependsOn" lists 1-based step numbers for review only.';
const FENCE = /```json[^\S\n]*\r?\n([\s\S]*?)\r?\n[^\S\n]*```/gi;
const StepSchema = z.object({
  title: z.string().trim().min(1).max(120), task: z.string().trim().min(1).max(2000), taskId: z.string().trim().max(200).nullish(),
  context: z.string().max(4000).nullish(), dependsOn: z.array(z.number().int().min(1).max(MAX_STEPS)).max(MAX_STEPS).nullish(),
});
const DraftSchema = z.object({ summary: z.string().trim().max(500).default(''), steps: z.array(StepSchema).min(1).max(MAX_STEPS) });

export function parseProposal(text: string): { rationale: string; parsed?: ProposalDraft; error?: string } {
  const fences = [...text.matchAll(FENCE)], rationale = text.replace(FENCE, '').trim();
  if (fences.length !== 1) return { rationale, error: fences.length ? 'Reply must contain exactly one ```json plan fence' : 'Reply did not contain a ```json plan fence' };
  let value: unknown;
  try { value = JSON.parse(fences[0][1]); } catch (error) { return { rationale, error: 'Plan fence is not valid JSON: ' + (error as Error).message }; }
  const result = DraftSchema.safeParse(value);
  if (!result.success) return { rationale, error: 'Plan shape is invalid: ' + result.error.issues.map(issue => (issue.path.map(String).join('.') || 'plan') + ' ' + issue.message).join('; ') };
  const steps = result.data.steps.map(step => ({ title: step.title, task: step.task, ...(step.taskId ? { taskId: step.taskId } : {}), ...(step.context ? { context: step.context } : {}), ...(step.dependsOn?.length ? { dependsOn: step.dependsOn } : {}) }));
  return { rationale, parsed: { summary: result.data.summary, steps } };
}
export const fingerprintFor = (steps: ProposalStep[], roadmapRevision: string): string => createHash('sha256').update(JSON.stringify(steps) + '\n' + roadmapRevision).digest('hex');
const save = (store: RuntimeStore, proposal: Proposal, event?: { type: string; payload: Record<string, unknown> }): Proposal => store.put(BUCKET, proposal.id, proposal, event && { ...event, projectId: proposal.project });
const expire = (store: RuntimeStore, proposal: Proposal): Proposal => proposal.state === 'prepared' && Date.now() >= proposal.expiresAt ? save(store, { ...proposal, state: 'expired' }) : proposal;

/** Pins every valid taskId to the current roadmap; invalid pins keep the step text and surface as warnings. Parse failures (or a failed lead turn, via `turnError`) are stored as failed proposals. */
export function buildProposal(project: string, prompt: string, leadRunId: string, text: string, store: RuntimeStore = runtime(), turnError?: string): Proposal {
  const doc = readDocument(planPath(project)), items = parseProjectDocument(doc.markdown, 'task').items;
  const { rationale, parsed, error } = turnError ? { rationale: text.trim(), parsed: undefined, error: turnError } : parseProposal(text), drafts = parsed?.steps ?? [];
  const warnings: string[] = [], pinned = new Map<string, number>(), steps: ProposalStep[] = [], review: ReviewStep[] = [];
  for (const [index, draft] of drafts.entries()) {
    const n = index + 1; let task: RoadmapTask | undefined;
    if (draft.taskId) {
      const matches = items.filter(item => item.id === draft.taskId);
      const reason = matches.length === 0 ? 'is not in the roadmap' : matches.length > 1 ? 'matches more than one roadmap task' : matches[0].done ? 'is already done' : pinned.has(draft.taskId) ? `is already pinned by step ${pinned.get(draft.taskId)}` : undefined;
      if (reason) warnings.push(`Step ${n}: taskId "${draft.taskId}" ${reason}; the step keeps its text without a pinned task`);
      else { task = matches[0]; pinned.set(task.id, n); }
    }
    const requested = draft.dependsOn ?? [], dependsOn = [...new Set(requested.filter(value => value !== n && value <= drafts.length))];
    if (dependsOn.length !== requested.length) warnings.push(`Step ${n}: dropped dependencies that are duplicated, self-referential or outside steps 1-${drafts.length}`);
    steps.push({ n, title: draft.title, issue: draft.task, ...(task ? { taskId: task.id, taskText: task.text, issueIds: task.issueIds } : {}), ...(draft.context ? { context: draft.context } : {}), ...(dependsOn.length ? { dependsOn } : {}) });
    review.push({ n, title: draft.title, task: task ? { id: task.id, text: task.text, milestone: task.milestone ?? null } : null, issueIds: task?.issueIds ?? [], context: draft.context ?? '', dependsOn });
  }
  const createdAt = Date.now(), id = 'plan-' + randomUUID();
  const proposal: Proposal = { id, project, prompt, leadRunId, state: parsed ? 'prepared' : 'failed', summary: parsed?.summary ?? '', rationale, steps,
    review: { summary: parsed?.summary ?? '', steps: review, warnings, roadmapRevision: doc.revision }, fingerprint: fingerprintFor(steps, doc.revision), createdAt, expiresAt: createdAt + TTL, ...(error ? { error } : {}) };
  return save(store, proposal, parsed ? { type: 'plan.proposed', payload: { id, steps: review.map(step => ({ n: step.n, title: step.title, taskId: step.task?.id })) } } : { type: 'plan.failed', payload: { id, error } });
}
/** One lead turn with dispatch disabled; runTurn is injected so this module never imports the session at runtime. */
export async function proposePlan(project: string, prompt: string, options: ProposeOptions): Promise<{ result: TurnResult; proposal: Proposal }> {
  planPath(project); const ref = options.leadRunIdRef ?? {};
  const result = await options.runTurn(prompt + '\n\n' + PLAN_INSTRUCTION, undefined, options.channel ?? 'app', undefined, options.onDelta, options.onTool, options.images, true, { ...options.turnOptions, project, allowDispatch: false, onStart: id => { ref.current = id; options.turnOptions?.onStart?.(id); } });
  return { result, proposal: buildProposal(project, prompt, ref.current ?? result.runId ?? '', result.text, runtime(), result.isError ? result.text.trim() || 'The lead turn failed' : undefined) };
}
export function inspectProposal(id: string): Proposal {
  const store = runtime(), proposal = store.get<Proposal>(BUCKET, id); if (!proposal) throw new Error('Unknown plan');
  return expire(store, proposal);
}
export function listProposals(project?: string, limit = 20): Proposal[] {
  const store = runtime();
  return store.list<Proposal>(BUCKET).filter(proposal => !project || proposal.project === project).reverse().map(proposal => expire(store, proposal)).sort((a, b) => b.createdAt - a.createdAt).slice(0, Math.max(1, Math.min(limit, 100)));
}
export function cancelPlan(id: string): Proposal {
  const proposal = inspectProposal(id);
  if (proposal.state !== 'prepared') throw new Error(`PLAN_${proposal.state.toUpperCase()}: this plan is ${proposal.state}; only a prepared plan can be cancelled`);
  return save(runtime(), { ...proposal, state: 'cancelled' }, { type: 'plan.cancelled', payload: { id } });
}
/** Queues exactly the reviewed steps as independent Builds. dependsOn is review information only; nothing here integrates branches. */
export async function executePlan(id: string, fingerprint: string, notify: Notify, spawn: SpawnStep = spawnFixer): Promise<Proposal> {
  const store = runtime(), proposal = inspectProposal(id);
  if (proposal.fingerprint !== fingerprint) throw new Error('REVIEW_CHANGED: the reviewed plan no longer matches this approval; refresh the review');
  const key = 'plan-execute:' + id, claim = store.claimCommand(key, { id, fingerprint });
  if (claim.state === 'complete') { const stored = claim.result as { error?: string }; if (stored.error) throw new Error(stored.error); return inspectProposal(id); }
  const fail = (results: Array<{ n: number; runId: string }>, error: Error): never => {
    if (proposal.state === 'prepared' || proposal.state === 'executing') save(store, { ...proposal, state: 'failed', results, error: error.message }, { type: 'plan.failed', payload: { id, error: error.message, runIds: results.map(result => result.runId) } });
    store.finishCommand(key, { error: error.message, runIds: results.map(result => result.runId) }); throw error;
  };
  // A restart mid-execution leaves the command interrupted; settle the plan so the card stops waiting (queued Builds stay visible in Builds).
  if (claim.state === 'interrupted') fail([], new Error('PLAN_INTERRUPTED: the backend restarted while this plan was being queued; check Builds before proposing again'));
  if (claim.state !== 'new') throw new Error('Plan execution is already in progress; inspect the plan before retrying');
  if (proposal.state !== 'prepared') fail([], new Error(`PLAN_${proposal.state.toUpperCase()}: this plan is ${proposal.state}; propose a new plan`));
  if (fingerprintFor(proposal.steps, readDocument(planPath(proposal.project)).revision) !== fingerprint) fail([], new Error('REVIEW_CHANGED: the roadmap changed since this plan was reviewed; propose it again'));
  proposal.state = 'executing'; save(store, proposal);
  const results: Array<{ n: number; runId: string }> = [];
  try { for (const step of proposal.steps) results.push({ n: step.n, runId: (await spawn(proposal.project, step.issue, notify, { title: step.title, taskId: step.taskId, context: step.context, issueIds: step.issueIds })).id }); }
  catch (error) { fail(results, error as Error); }
  const runIds = results.map(result => result.runId);
  const executed = save(store, { ...proposal, state: 'executed', executedAt: Date.now(), results }, { type: 'plan.executed', payload: { id, runIds } });
  store.finishCommand(key, { id, runIds }); return executed;
}

/** Small read-only lead views. No lifecycle imports, roadmap pinning, or registry migration. */
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { runtime, type RuntimeStore } from './store.js';
import type { GovernedTool } from './tool-service.js';
import { parseRoadmap } from './roadmap.js';
import { config } from './config.js';

export const ACTIVITY_DEFAULT_LIMIT = 8;
export const ACTIVITY_MAX_LIMIT = 25;
export const ACTIVITY_MAX_BYTES = 49_152;
export const ROADMAP_MAX_BYTES = 61_440;
const ROADMAP_FILE_BYTES = 5_000_000;
const projectName = z.string().min(1).max(120).regex(/^[a-z0-9][a-z0-9-]*$/);
const statuses = ['queued', 'installing', 'running', 'verifying', 'awaiting_input', 'staged', 'merged', 'failed', 'cancelled', 'interrupted', 'discarded', 'superseded'] as const;
const page = { limit: z.number().int().min(1).max(ACTIVITY_MAX_LIMIT).default(ACTIVITY_DEFAULT_LIMIT), offset: z.number().int().min(0).max(1_000_000).default(0) };
export const activityInputSchema = z.object({
  project: projectName.optional(), runId: z.string().min(1).max(200).optional(),
  changedSince: z.iso.datetime({ offset: true }).optional(),
  afterEventId: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  status: z.enum(statuses).optional(), ...page,
}).strict().refine(value => value.changedSince === undefined || value.afterEventId === undefined, { message: 'Use changedSince OR afterEventId, not both' });
export const roadmapInputSchema = z.object({
  project: projectName.optional(), status: z.enum(['pending', 'all']).default('pending'),
  taskId: z.string().min(1).max(200).optional(), query: z.string().min(1).max(200).optional(), ...page,
}).strict();
export type ActivityInput = z.input<typeof activityInputSchema>;
export type RoadmapInput = z.input<typeof roadmapInputSchema>;
export interface ActivityOptions {
  now?: () => number;
  /** Tests can use a temporary vault. Production uses the configured vault. */
  vaultDir?: string;
}
export interface ActivityScope { mode: 'project' | 'registered-projects'; project: string | null; registeredProjectCount: number }

function selectScope(active: string | undefined, requested: string | undefined, store: RuntimeStore) {
  // games() may persist a migrated registry. Reads must not do that.
  const registry = store.get<Record<string, unknown>>('config', 'projects') ?? store.get<Record<string, unknown>>('legacy', 'games.json') ?? {};
  const registered = Object.keys(registry).filter(key => projectName.safeParse(key).success);
  if (active !== undefined) projectName.parse(active);
  if (active !== undefined && requested !== undefined && requested !== active) throw new Error('Read is scoped to the active project');
  const selected = active ?? requested;
  if (selected !== undefined && !registered.includes(selected)) throw new Error('Unknown registered project');
  const scope: ActivityScope = { mode: selected === undefined ? 'registered-projects' : 'project', project: selected ?? null, registeredProjectCount: registered.length };
  return { scope, projects: selected === undefined ? registered : [selected] };
}
function clip(value: unknown, limit: number) {
  const text = typeof value === 'string' ? value : '';
  return { text: text.slice(0, limit), truncated: text.length > limit };
}
type TimeState = 'valid' | 'future' | 'invalid' | 'missing';
function epoch(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && Number.isFinite(new Date(value).getTime()) ? value : null;
}
function iso(value: unknown): string | null { const at = epoch(value); return at === null ? null : new Date(at).toISOString(); }
const storedTime = z.iso.datetime({ offset: true });
function time(value: unknown, present: boolean, now: number, numeric = false) {
  if (!present) return { at: null, ms: null, state: 'missing' as TimeState };
  const at = numeric ? epoch(value) : typeof value === 'string' && storedTime.safeParse(value).success ? epoch(Date.parse(value)) : null;
  return { at: iso(at), ms: at, state: (!present ? 'missing' : at === null ? 'invalid' : at > now ? 'future' : 'valid') as TimeState };
}
function canonicalId(value: unknown): string | null { return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value) ? value : null; }
function status(value: unknown): string | null {
  return value === 'done' ? 'staged' : typeof value === 'string' && (statuses as readonly string[]).includes(value) ? value : null;
}
// SQL projections bound every stored scalar BEFORE it enters Node, including metadata and IDs.
const json = (alias: string): string => `(CASE WHEN json_valid(${alias}.value) THEN ${alias}.value ELSE '{}' END)`;
const field = (alias: string, key: string): string => `json_extract(${json(alias)},'$.${key}')`;
const present = (alias: string, key: string): string => `(json_type(${json(alias)},'$.${key}') IS NOT NULL AND json_type(${json(alias)},'$.${key}')<>'null')`;
function scalar(alias: string, key: string, bytes: number): string {
  return `(CASE WHEN json_type(${json(alias)},'$.${key}')='text' AND length(CAST(${field(alias, key)} AS BLOB))<=${bytes} THEN ${field(alias, key)} END)`;
}
function textPrefix(key: string, count: number, tail = false): string {
  return `(CASE WHEN json_type(${json('r')},'$.${key}')='text' THEN substr(${field('r', key)},${tail ? -count : 1}${tail ? '' : ',' + count}) END)`;
}
const eventMatch = (e: string, r: string): string => `${e}.run_id=${r}.id AND ${e}.project_id=${field(r, 'game')} AND ${e}.type='run.updated'`;
interface Metadata {
  recordKey: number; id: string | null; project: string; storedStatus: string | null; startedAt: string | null; endedAt: string | null;
  startedPresent: number; endedPresent: number; eventId: number | null; eventAt: number | null;
  ignoredEvents: number; sinceMatch: number;
}
export interface ActivityItem {
  id: string | null; idUnavailable: boolean; project: string; title: string; titleTruncated: boolean;
  status: string; storedStatus: string | null; startedAt: string | null; endedAt: string | null;
  updatedAt: string | null; lastStatusChangeAt: string | null; lastRecordedChangeAt: string | null;
  changeTimeSource: 'run.updated' | 'legacy-start/end' | 'unknown'; lastEventId: number | null;
  verificationStatus: 'passed' | 'failed' | 'unverified'; verificationAt: string | null;
  result: string; resultTruncated: boolean; resultEvidence: 'reported-text-not-independent-verification';
  error: string | null; taskId: string | null; taskIdUnavailable: boolean; roadmapLinked: boolean | null;
  unavailableFields: string[]; timeStatus: Record<'startedAt' | 'endedAt' | 'updatedAt' | 'lastStatusChangeAt' | 'verificationAt', TimeState>;
  ignoredEventCount: number;
}
export interface ActivityResult {
  scope: ActivityScope; observedAt: string; eventCursor: number;
  filters: { runId: string | null; status: string | null; changedSince: string | null; afterEventId: number | null };
  total: number; returned: number; limit: number; offset: number; hasMore: boolean; nextOffset: number | null;
  untrackedRunCount: number; unknownChangeTimeCount: number; unknownStatusCount: number; unavailableIdCount: number;
  ignoredEventCount: number; items: ActivityItem[]; payloadTruncated: boolean; maxBytes: number;
  semantics: string; emptyMeaning: string | null;
}
function fitActivity(result: ActivityResult): ActivityResult {
  while (Buffer.byteLength(JSON.stringify(result)) > ACTIVITY_MAX_BYTES) {
    const candidates = result.items.flatMap(item => (['title', 'result'] as const).map(key => ({ item, key, size: item[key].length })));
    const longest = candidates.sort((a, b) => b.size - a.size)[0];
    if (!longest?.size) throw new Error('Activity metadata exceeds response budget; no result was returned');
    const { item, key } = longest;
    const points = Array.from(item[key]);
    item[key] = (key === 'result' && item.status === 'failed' ? points.slice(-Math.floor(points.length / 2)) : points.slice(0, Math.floor(points.length / 2))).join('');
    // slice(-0) is the full array; make progress for the final character too.
    if (points.length === 1) item[key] = '';
    if (key === 'title') item.titleTruncated = true;
    else { item.resultTruncated = true; if (item.status === 'failed') item.error = item.result || null; }
    result.payloadTruncated = true;
  }
  return result;
}

/** Current truth in one SQLite read transaction, not a reconstruction as of a past cutoff.
 * afterEventId is exclusive; eventCursor is a delta watermark, NOT a page cursor.
 * Retain the FIRST page's watermark, finish its live pages, then resume deltas from that
 * first watermark (never the final page's newer cursor). Changes during paging can repeat.
 */
export function readActivity(project: string | undefined, args: ActivityInput = {}, store: RuntimeStore = runtime(), options: ActivityOptions = {}): ActivityResult {
  const input = activityInputSchema.parse(args);
  return store.db.transaction(() => {
    const { scope, projects } = selectScope(project, input.project, store);
    const eventCursor = store.cursor();
    if (!Number.isSafeInteger(eventCursor)) throw new Error('Event watermark exceeds the supported safe-integer range');
    const now = epoch((options.now ?? Date.now)());
    if (now === null) throw new Error('Invalid observation time');
    const observedAt = iso(now)!;
    const where = `r.bucket='fixers' AND ${field('r', 'game')} IN (SELECT value FROM json_each(@projects))
      AND (@runId IS NULL OR r.id=@runId)
      AND (@filterStatus IS NULL OR CASE ${field('r', 'status')} WHEN 'done' THEN 'staged' ELSE ${field('r', 'status')} END=@filterStatus)`;
    // Only fixed-width metadata reaches JS. Counts/sorting still inspect scoped metadata,
    // never whole run objects. Record rowid is internal; oversized canonical IDs stay unavailable.
    const metadata = store.db.prepare(`SELECT r.rowid AS recordKey,
      CASE WHEN length(CAST(r.id AS BLOB))<=200 THEN r.id END AS id,
      ${scalar('r', 'game', 120)} AS project, ${scalar('r', 'status', 32)} AS storedStatus,
      ${scalar('r', 'startedAt', 40)} AS startedAt, ${scalar('r', 'endedAt', 40)} AS endedAt,
      ${present('r', 'startedAt')} AS startedPresent, ${present('r', 'endedAt')} AS endedPresent,
      e.id AS eventId, CASE WHEN typeof(e.at) IN ('integer','real') THEN e.at END AS eventAt,
      (SELECT COUNT(*) FROM events x WHERE x.run_id=r.id AND x.type='run.updated' AND x.project_id IS NOT ${field('r', 'game')}) AS ignoredEvents,
      EXISTS(SELECT 1 FROM events s WHERE ${eventMatch('s', 'r')} AND typeof(s.at) IN ('integer','real')
        AND s.at BETWEEN -8640000000000000 AND 8640000000000000 AND s.at>@since) AS sinceMatch
      FROM records r LEFT JOIN events e ON e.id=(SELECT x.id FROM events x WHERE ${eventMatch('x', 'r')} ORDER BY x.id DESC LIMIT 1)
      WHERE ${where}`).all({ projects: JSON.stringify(projects), runId: input.runId ?? null,
        filterStatus: input.status ?? null, since: input.changedSince === undefined ? null : Date.parse(input.changedSince) }) as Metadata[];
    const changeAt = (row: Metadata): number | null => row.eventId !== null ? epoch(row.eventAt)
      : time(row.endedAt, !!row.endedPresent, now).ms ?? time(row.startedAt, !!row.startedPresent, now).ms;
    const untrackedRunCount = metadata.filter(row => row.eventId === null).length;
    const unknownChangeTimeCount = metadata.filter(row => changeAt(row) === null).length;
    const unknownStatusCount = metadata.filter(row => status(row.storedStatus) === null).length;
    const unavailableIdCount = metadata.filter(row => canonicalId(row.id) === null).length;
    const ignoredEventCount = metadata.reduce((sum, row) => sum + row.ignoredEvents, 0);
    const since = input.changedSince === undefined ? undefined : Date.parse(input.changedSince);
    const matches = metadata.filter(row => input.afterEventId !== undefined ? row.eventId !== null && row.eventId > input.afterEventId
      : since !== undefined ? !!row.sinceMatch || (row.eventId === null && (changeAt(row) ?? -Infinity) > since) : true);
    matches.sort((a, b) => (changeAt(b) ?? -Infinity) - (changeAt(a) ?? -Infinity) || (b.eventId ?? 0) - (a.eventId ?? 0)
      || (a.id ?? '').localeCompare(b.id ?? '') || a.recordKey - b.recordKey);
    const selected = matches.slice(input.offset, input.offset + input.limit);
    const details = store.db.prepare(`SELECT ${textPrefix('title', 181)} AS title,
      CASE WHEN ${field('r', 'status')}='failed' THEN ${textPrefix('summary', 601, true)} ELSE ${textPrefix('summary', 601)} END AS summary,
      CASE WHEN json_type(${json('r')},'$.title')='text' THEN length(CAST(${field('r', 'title')} AS BLOB)) ELSE 0 END AS titleBytes,
      CASE WHEN json_type(${json('r')},'$.summary')='text' THEN length(CAST(${field('r', 'summary')} AS BLOB)) ELSE 0 END AS summaryBytes,
      ${scalar('r', 'verification.status', 16)} AS verificationStatus, ${present('r', 'verification.status')} AS verificationPresent,
      ${scalar('r', 'verification.at', 40)} AS verificationAt, ${present('r', 'verification.at')} AS verificationAtPresent,
      ${scalar('r', 'taskId', 200)} AS taskId, ${present('r', 'taskId')} AS taskPresent
      FROM records r WHERE r.bucket='fixers' AND r.rowid=?`);
    // Strict project_id match; NULL-project legacy events are explicitly omitted, never guessed.
    // Unknown/malformed statuses break the chain rather than fabricate a transition across a gap.
    const transitions = store.db.prepare(`WITH history AS (
      SELECT e.id,CASE WHEN typeof(e.at) IN ('integer','real') THEN e.at END AS at,CASE json_extract(CASE WHEN json_valid(e.payload) THEN e.payload ELSE '{}' END,'$.run.status')
        WHEN 'done' THEN 'staged' ELSE json_extract(CASE WHEN json_valid(e.payload) THEN e.payload ELSE '{}' END,'$.run.status') END AS status
      FROM events e JOIN records r ON r.rowid=? WHERE ${eventMatch('e', 'r')}
    ), valid AS (SELECT id,at,CASE WHEN status IN (${statuses.map(() => '?').join(',')}) THEN status END AS status FROM history),
    changes AS (SELECT *,LAG(status) OVER (ORDER BY id) AS previous FROM valid)
    SELECT at,status FROM changes WHERE (previous IS NOT NULL AND previous<>status) OR (previous IS NULL AND status='queued') ORDER BY id DESC LIMIT 1`);
    const items: ActivityItem[] = selected.map(row => {
      const detail = details.get(row.recordKey) as { title: string | null; summary: string | null; titleBytes: number; summaryBytes: number;
        verificationStatus: string | null; verificationPresent: number; verificationAt: string | null; verificationAtPresent: number; taskId: string | null; taskPresent: number };
      const title = clip(detail.title, 180), result = clip(detail.summary, 600);
      if (row.storedStatus === 'failed' && result.truncated) result.text = detail.summary!.slice(-600);
      title.truncated ||= detail.titleBytes > Buffer.byteLength(title.text);
      result.truncated ||= detail.summaryBytes > Buffer.byteLength(result.text);
      const transition = transitions.get(row.recordKey, ...statuses) as { at: number; status: string } | undefined;
      const normalized = status(row.storedStatus);
      const id = canonicalId(row.id), taskId = canonicalId(detail.taskId);
      const started = time(row.startedAt, !!row.startedPresent, now), ended = time(row.endedAt, !!row.endedPresent, now);
      const updated = time(row.eventAt, row.eventId !== null, now, true);
      const transitioned = time(transition?.at, !!transition && transition.status === normalized, now, true);
      const verified = time(detail.verificationAt, !!detail.verificationAtPresent, now);
      const taskIdUnavailable = !!detail.taskPresent && taskId === null;
      const unavailableFields = [...(id === null ? ['id'] : []), ...(normalized === null ? ['status'] : []),
        ...(taskIdUnavailable ? ['taskId'] : []), ...Object.entries({ startedAt: started, endedAt: ended, updatedAt: updated,
          lastStatusChangeAt: transitioned, verificationAt: verified }).filter(([, value]) => value.state === 'invalid').map(([key]) => key),
        ...(detail.verificationPresent && !['passed', 'failed', 'unverified'].includes(detail.verificationStatus ?? '') ? ['verificationStatus'] : [])];
      return { id, idUnavailable: id === null, project: row.project, title: title.text, titleTruncated: title.truncated,
        status: normalized ?? 'unknown', storedStatus: normalized === null ? null : row.storedStatus,
        startedAt: started.at, endedAt: ended.at, updatedAt: updated.at,
        lastStatusChangeAt: transitioned.state === 'missing' ? null : transitioned.at,
        lastRecordedChangeAt: iso(changeAt(row)), changeTimeSource: changeAt(row) === null ? 'unknown' : row.eventId !== null ? 'run.updated' : 'legacy-start/end',
        lastEventId: row.eventId, verificationStatus: detail.verificationStatus === 'passed' || detail.verificationStatus === 'failed' ? detail.verificationStatus : 'unverified',
        verificationAt: verified.at, result: result.text, resultTruncated: result.truncated, resultEvidence: 'reported-text-not-independent-verification',
        error: normalized === 'failed' ? result.text || null : null, taskId, taskIdUnavailable, roadmapLinked: taskIdUnavailable ? null : taskId !== null,
        unavailableFields, timeStatus: { startedAt: started.state, endedAt: ended.state, updatedAt: updated.state,
          lastStatusChangeAt: transitioned.state, verificationAt: verified.state }, ignoredEventCount: row.ignoredEvents };
    });
    const hasMore = input.offset + items.length < matches.length;
    return fitActivity({ scope, observedAt, eventCursor,
      filters: { runId: input.runId ?? null, status: input.status ?? null, changedSince: input.changedSince ?? null, afterEventId: input.afterEventId ?? null },
      total: matches.length, returned: items.length, limit: input.limit, offset: input.offset, hasMore, nextOffset: hasMore ? input.offset + items.length : null,
      untrackedRunCount, unknownChangeTimeCount, unknownStatusCount, unavailableIdCount, ignoredEventCount, items,
      payloadTruncated: false, maxBytes: ACTIVITY_MAX_BYTES,
      semantics: 'Current records, not historical snapshots. Exclusive cutoffs. Only events matching run ID AND record project count; NULL/conflicting-project events are omitted and counted. Invalid fields are unavailable, not evidence of no work. Invalid/future times are explicit. run.updated times are saves, not necessarily status transitions. Legacy start/end fallback is not update time; event deltas omit untracked runs. Records with unidentifiable scope cannot be returned. Offset pages are live: retain the FIRST page eventCursor, finish pages, then resume deltas from that first watermark, NEVER the final page cursor. Changes during paging may repeat. Staged is not merged; status and verification are separate; reported text is not proof of delivery.',
      emptyMeaning: items.length ? null : 'No records on this page match these filters in this scope. This does not establish no activity, completion, or absence of older/untracked/invalid work.' });
  })();
}

/** No-argument compatibility alias: same bounded envelope as read_activity, never full records. */
export function listFixersSummary(project: string | undefined, store: RuntimeStore = runtime(), options: ActivityOptions = {}): ActivityResult {
  return readActivity(project, {}, store, options);
}

/** Read the exact plan identity. No symlink aliases, hard links, devices, or unbounded reads.
 * The configured vault root may itself be an owner-configured alias; its canonical root is trusted.
 * Node has no portable openat(), so compare ancestry/file identity around O_NOFOLLOW open as well.
 */
function readPlan(vaultDir: string, project: string): string | null {
  let root: string;
  try { root = realpathSync(vaultDir); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  const plans = join(root, 'plans'), path = join(plans, `${project}.md`);
  let directory: ReturnType<typeof lstatSync>, file: ReturnType<typeof lstatSync>;
  try { directory = lstatSync(plans); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  if (directory.isSymbolicLink() || !directory.isDirectory()) throw new Error('Roadmap directory alias or path outside exact project identity');
  try { file = lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  if (file.isSymbolicLink() || !file.isFile() || file.nlink !== 1) throw new Error('Roadmap alias/nonregular file is outside exact project identity');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(fd), directoryNow = lstatSync(plans), fileNow = lstatSync(path);
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== file.dev || opened.ino !== file.ino
      || directoryNow.isSymbolicLink() || directoryNow.dev !== directory.dev || directoryNow.ino !== directory.ino
      || fileNow.isSymbolicLink() || fileNow.dev !== opened.dev || fileNow.ino !== opened.ino || realpathSync(path) !== path) throw new Error('Roadmap identity changed during read');
    if (opened.size > ROADMAP_FILE_BYTES) throw new Error('Roadmap exceeds 5 MB; bounded read unavailable');
    const buffer = Buffer.alloc(ROADMAP_FILE_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const count = readSync(fd, buffer, size, buffer.length - size, size);
      if (!count) break;
      size += count;
    }
    if (size > ROADMAP_FILE_BYTES) throw new Error('Roadmap exceeds 5 MB; bounded read unavailable');
    const end = fstatSync(fd);
    if (end.size !== opened.size || end.mtimeMs !== opened.mtimeMs || end.ctimeMs !== opened.ctimeMs) throw new Error('Roadmap changed during read; retry');
    return buffer.subarray(0, size).toString('utf8');
  } finally { closeSync(fd); }
}

export function readRoadmap(project: string | undefined, args: RoadmapInput = {}, store: RuntimeStore = runtime(), options: ActivityOptions = {}) {
  const input = roadmapInputSchema.parse(args);
  const { scope } = selectScope(project, input.project, store);
  if (!scope.project) throw new Error('General scope must select a registered project for read_roadmap');
  const plan = readPlan(options.vaultDir ?? config.vaultDir, scope.project);
  const exists = plan !== null;
  const tasks = exists ? parseRoadmap(plan) : [];
  const matches = tasks.filter(task => (input.status === 'all' || !task.done)
    && (input.taskId === undefined || task.id === input.taskId)
    && (input.query === undefined || task.text.toLowerCase().includes(input.query.toLowerCase())));
  const items = matches.slice(input.offset, input.offset + input.limit).map(task => {
    const text = clip(task.text, 2000), milestone = clip(task.milestone, 180);
    // Extremely large explicit markers cannot be sent as canonical IDs. Never emit a partial ID as usable.
    const idAvailable = task.id.length <= 200;
    return { id: idAvailable ? task.id : null, idUnavailable: !idAvailable, text: text.text, textTruncated: text.truncated,
      done: task.done, milestone: milestone.text || null, milestoneTruncated: milestone.truncated,
      explicit: task.explicit, line: task.line, dispatchable: !task.done && idAvailable && tasks.filter(other => !other.done && other.id === task.id).length === 1 };
  });
  const hasMore = input.offset + items.length < matches.length;
  const observedAt = iso((options.now ?? Date.now)());
  if (!observedAt) throw new Error('Invalid observation time');
  const result = { scope, observedAt, exists, payloadTruncated: false, maxBytes: ROADMAP_MAX_BYTES,
    filters: { status: input.status, taskId: input.taskId ?? null, query: input.query ?? null },
    totalTasks: tasks.length, done: tasks.filter(task => task.done).length, total: matches.length,
    returned: items.length, limit: input.limit, offset: input.offset, hasMore, nextOffset: hasMore ? input.offset + items.length : null,
    items, semantics: 'Read-only canonical parser IDs and checkbox body text (marker removed). Human labels such as M12.4 are not canonical IDs: search query then use id as taskId. On rejection re-read and resolve; never drop taskId to retry. Hash IDs may change after text edits until explicitly pinned by dispatch. No markers were written. Truncated text is not an exact-text dispatch key; use an available unique canonical id. Exact non-symlink project file only. Pages are live, not snapshots.' };
  while (Buffer.byteLength(JSON.stringify(result)) > ROADMAP_MAX_BYTES) {
    const candidates = items.flatMap(item => (['text', 'milestone'] as const).map(key => ({ item, key, size: item[key]?.length ?? 0 })));
    const longest = candidates.sort((a, b) => b.size - a.size)[0];
    if (!longest?.size) throw new Error('Roadmap metadata exceeds response budget; no result was returned');
    const { item, key } = longest;
    const points = Array.from(item[key]!);
    item[key] = points.slice(0, Math.floor(points.length / 2)).join('');
    if (key === 'text') item.textTruncated = true; else item.milestoneTruncated = true;
    result.payloadTruncated = true;
  }
  return result;
}
export type RoadmapResult = ReturnType<typeof readRoadmap>;

export function activityTools(project: string | undefined, store?: RuntimeStore, options: ActivityOptions = {}): GovernedTool[] {
  const number = { type: 'integer', minimum: 1, maximum: ACTIVITY_MAX_LIMIT, default: ACTIVITY_DEFAULT_LIMIT };
  const common = { project: { type: 'string', description: 'Registered project. Cannot override active scope.' }, limit: number, offset: { type: 'integer', minimum: 0, maximum: 1_000_000 } };
  const schema = (properties: Record<string, unknown>) => ({ type: 'object', properties, additionalProperties: false });
  return [
    { name: 'read_activity', description: 'Read bounded current run truth before operational catch-ups. Exact full runId only (no prefixes). Use exclusive changedSince ISO time OR afterEventId watermark. Keep the FIRST page eventCursor for the next delta, never the final page cursor. Results state scope, observation time, omissions, paging, failure and verification separately. Read-only.',
      inputSchema: schema({ ...common, runId: { type: 'string', minLength: 1, maxLength: 200 }, changedSince: { type: 'string', format: 'date-time' }, afterEventId: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, status: { type: 'string', enum: statuses } }),
      call: async (args, signal) => { signal.throwIfAborted(); return readActivity(project, args, store ?? runtime(), options); } },
    { name: 'read_roadmap', description: 'Read canonical roadmap IDs and exact task text, never write markers. General scope requires project; active project is implicit. query can resolve a human label like M12.4. Use returned id as taskId; do not drop linkage after rejection.',
      inputSchema: schema({ ...common, status: { type: 'string', enum: ['pending', 'all'], default: 'pending' }, taskId: { type: 'string', minLength: 1, maxLength: 200 }, query: { type: 'string', minLength: 1, maxLength: 200 } }),
      call: async (args, signal) => { signal.throwIfAborted(); return readRoadmap(project, args, store ?? runtime(), options); } },
  ];
}

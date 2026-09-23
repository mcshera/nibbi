import { randomUUID } from 'node:crypto';
import { runtime, type RuntimeStore } from './store.js';

/** A thread is a conversation container inside one project. The home thread is not a record:
 *  it is every message that has no thread, so adding threads migrated nothing. Channel stays
 *  the transport (app, cli, telegram); a thread is what the owner is talking about. */
export const HOME = 'home';
export interface Thread { id: string; project: string | null; title: string; createdAt: string; lastAt: string; archived?: boolean }
export interface ThreadSummary { id: string; project: string | null; title: string; lastAt: string | null; count: number; archived: boolean }
const DEFAULT_TITLE = 'New thread';
export const isThreadId = (value: unknown): value is string =>
  typeof value === 'string' && (value === HOME || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value));
const scopeOf = (project: string | undefined): string | null => project === undefined || project === 'vault' ? null : project;
const sameProject = (thread: Thread, project: string | null): boolean => (thread.project ?? null) === project;

function homeSummary(project: string | null, store: RuntimeStore): ThreadSummary {
  const row = store.db.prepare(`SELECT MAX(at) AS lastAt, COUNT(*) AS count FROM messages WHERE thread_id IS NULL
    AND CASE WHEN @project IS NULL THEN (project_id IS NULL OR project_id='vault') ELSE project_id=@project END`)
    .get({ project }) as { lastAt: string | null; count: number };
  return { id: HOME, project, title: 'Home', lastAt: row?.lastAt ?? null, count: row?.count ?? 0, archived: false };
}

export function listThreads(project: string | undefined, store: RuntimeStore = runtime()): ThreadSummary[] {
  const scope = scopeOf(project);
  const counts = new Map<string, { lastAt: string | null; count: number }>();
  for (const row of store.db.prepare('SELECT thread_id AS id, MAX(at) AS lastAt, COUNT(*) AS count FROM messages WHERE thread_id IS NOT NULL GROUP BY thread_id')
    .all() as { id: string; lastAt: string | null; count: number }[]) counts.set(row.id, { lastAt: row.lastAt, count: row.count });
  const records = store.list<Thread>('threads').filter(thread => sameProject(thread, scope));
  const summaries = records.map(thread => ({ id: thread.id, project: thread.project, title: thread.title,
    lastAt: counts.get(thread.id)?.lastAt ?? thread.lastAt ?? thread.createdAt, count: counts.get(thread.id)?.count ?? 0, archived: thread.archived === true }));
  const rank = (t: ThreadSummary): number => Date.parse(t.lastAt ?? '') || 0;
  const live = summaries.filter(t => !t.archived).sort((a, b) => rank(b) - rank(a));
  const archived = summaries.filter(t => t.archived).sort((a, b) => rank(b) - rank(a));
  return [homeSummary(scope, store), ...live, ...archived];
}

/** Throws unless the thread exists, belongs to this project and can still take messages. */
export function requireThread(project: string | undefined, id: string | undefined, store: RuntimeStore = runtime()): string {
  const thread = id ?? HOME;
  if (thread === HOME) return HOME;
  if (!isThreadId(thread)) throw new Error('Unknown thread');
  const record = store.get<Thread>('threads', thread);
  if (!record || !sameProject(record, scopeOf(project))) throw new Error('Unknown thread');
  if (record.archived) throw new Error('That thread is archived');
  return thread;
}

export function createThread(project: string | undefined, title?: string, store: RuntimeStore = runtime()): Thread {
  const now = new Date().toISOString();
  const thread: Thread = { id: randomUUID(), project: scopeOf(project), title: safeTitle(title) || DEFAULT_TITLE, createdAt: now, lastAt: now };
  return save(thread, store);
}

export function renameThread(project: string | undefined, id: string, title: string, store: RuntimeStore = runtime()): Thread {
  const record = existing(project, id, store);
  return save({ ...record, title: safeTitle(title) || record.title }, store);
}

export function archiveThread(project: string | undefined, id: string, archived: boolean, store: RuntimeStore = runtime()): Thread {
  return save({ ...existing(project, id, store), archived }, store);
}

/** Called for every logged message so a thread's order and its first-line title stay true. */
export function touchThread(id: string | undefined, at: string, firstUserText?: string, store: RuntimeStore = runtime()): void {
  if (!id || id === HOME || !isThreadId(id)) return;
  const record = store.get<Thread>('threads', id); if (!record) return;
  const title = record.title === DEFAULT_TITLE && firstUserText ? safeTitle(firstUserText.split('\n')[0]) || record.title : record.title;
  if (record.lastAt === at && record.title === title) return;
  save({ ...record, lastAt: at, title }, store);
}

/** Every write says so on the event stream. Nothing else tells a window that the daemon named a
 *  thread from its first message, so without this the bar kept saying "New thread" until a reload. */
function save(thread: Thread, store: RuntimeStore): Thread {
  const { id, project, title, lastAt } = thread;
  return store.put('threads', id, thread, { type: 'thread.updated', ...(project ? { projectId: project } : {}),
    payload: { thread: { id, project, title, lastAt, archived: thread.archived === true } } });
}

function existing(project: string | undefined, id: string, store: RuntimeStore): Thread {
  const record = isThreadId(id) && id !== HOME ? store.get<Thread>('threads', id) : undefined;
  if (!record || !sameProject(record, scopeOf(project))) throw new Error('Unknown thread');
  return record;
}
function safeTitle(title?: string): string { return String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 60); }

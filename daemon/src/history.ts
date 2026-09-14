import { runtime } from './store.js';
import { HOME, touchThread } from './threads.js';
import type { FallbackInfo } from './local-fallback.js';
export interface ChatEntry { ts: string; channel: string; role: 'user' | 'oracle'; text: string; costUsd?: number; project?: string; threadId?: string; runId?: string; source?: 'test'; local?: boolean; localModel?: string; fallback?: FallbackInfo; isError?: boolean }
type Row = { id?: number; at: string; channel: string; role: ChatEntry['role']; text: string; metadata: string; project_id?: string; thread_id?: string | null };
const decode = (row: Row): ChatEntry => ({ ts: row.at, channel: row.channel, role: row.role, text: row.text, project: row.project_id, threadId: row.thread_id ?? HOME, ...JSON.parse(row.metadata) });
/** The home thread is every row with no thread, so 'home' means IS NULL rather than a value. */
export const threadClause = (alias: string, param: string): string =>
  `(CASE WHEN ${param} IS NULL THEN 1 WHEN ${param}='${HOME}' THEN ${alias}.thread_id IS NULL ELSE ${alias}.thread_id=${param} END)`;
export function logChat(entry: ChatEntry): number {
  const thread = entry.threadId && entry.threadId !== HOME ? entry.threadId : null;
  const id = Number(runtime().db.prepare('INSERT INTO messages(at,project_id,role,channel,text,metadata,thread_id) VALUES(?,?,?,?,?,?,?)').run(entry.ts, entry.project ?? null, entry.role, entry.channel, entry.text, JSON.stringify({ costUsd: entry.costUsd, runId: entry.runId, source: entry.source, local: entry.local, localModel: entry.localModel, fallback: entry.fallback, isError: entry.isError }), thread).lastInsertRowid);
  if (thread) touchThread(thread, entry.ts, entry.role === 'user' ? entry.text : undefined);
  return id;
}
export function readChat(n = 80, before?: string, project?: string, threadId?: string): ChatEntry[] {
  return (runtime().db.prepare(`SELECT * FROM messages WHERE (@before IS NULL OR at<@before) AND (@project IS NULL OR project_id=@project)
    AND ${threadClause('messages', '@thread')} ORDER BY id DESC LIMIT @limit`)
    .all({ before: before ?? null, project: project ?? null, thread: threadId ?? null, limit: Math.min(1000, Math.max(1, n)) }) as Row[]).reverse().map(decode);
}
export function searchChat(q: string, limit = 40): ChatEntry[] {
  return (runtime().db.prepare('SELECT * FROM messages WHERE instr(lower(text),lower(?))>0 ORDER BY id DESC LIMIT ?').all(q, Math.min(100, Math.max(1, limit))) as Row[]).map(decode);
}
export function readAround(ts: string, n = 50): ChatEntry[] {
  const id = (runtime().db.prepare('SELECT id FROM messages WHERE at=? LIMIT 1').get(ts) as { id: number } | undefined)?.id;
  if (!id) return readChat(n);
  return (runtime().db.prepare('SELECT * FROM messages WHERE id>=? ORDER BY id LIMIT ?').all(Math.max(0, id - Math.floor(n / 2)), Math.min(n, 200)) as Row[]).map(decode);
}

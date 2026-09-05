import { runtime } from './store.js';
export interface ChatEntry { ts: string; channel: string; role: 'user' | 'oracle'; text: string; costUsd?: number; project?: string }
type Row = { at: string; channel: string; role: ChatEntry['role']; text: string; metadata: string; project_id?: string };
const decode = (row: Row): ChatEntry => ({ ts: row.at, channel: row.channel, role: row.role, text: row.text, project: row.project_id, ...JSON.parse(row.metadata) });
export function logChat(entry: ChatEntry): void {
  runtime().db.prepare('INSERT INTO messages(at,project_id,role,channel,text,metadata) VALUES(?,?,?,?,?,?)').run(entry.ts, entry.project ?? null, entry.role, entry.channel, entry.text, JSON.stringify({ costUsd: entry.costUsd }));
}
export function readChat(n = 80, before?: string, project?: string): ChatEntry[] {
  return (runtime().db.prepare('SELECT * FROM messages WHERE (? IS NULL OR at<?) AND (? IS NULL OR project_id=?) ORDER BY id DESC LIMIT ?').all(before ?? null, before ?? null, project ?? null, project ?? null, Math.min(1000, Math.max(1, n))) as Row[]).reverse().map(decode);
}
export function searchChat(q: string, limit = 40): ChatEntry[] {
  return (runtime().db.prepare('SELECT * FROM messages WHERE instr(lower(text),lower(?))>0 ORDER BY id DESC LIMIT ?').all(q, Math.min(100, Math.max(1, limit))) as Row[]).map(decode);
}
export function readAround(ts: string, n = 50): ChatEntry[] {
  const id = (runtime().db.prepare('SELECT id FROM messages WHERE at=? LIMIT 1').get(ts) as { id: number } | undefined)?.id;
  if (!id) return readChat(n);
  return (runtime().db.prepare('SELECT * FROM messages WHERE id>=? ORDER BY id LIMIT ?').all(Math.max(0, id - Math.floor(n / 2)), Math.min(n, 200)) as Row[]).map(decode);
}

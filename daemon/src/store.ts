import Database from 'better-sqlite3';
import { EventEmitter } from 'node:events';
import { mkdirSync, existsSync, readFileSync, copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { RunEvent } from '@nibbi/contracts';
import { config } from './config.js';

export class RevisionConflict extends Error { constructor() { super('State changed; refresh and try again'); } }
export class RuntimeStore {
  readonly db: Database.Database;
  readonly events = new EventEmitter();
  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new Database(join(directory, 'runtime.sqlite'));
    if (Number(this.db.pragma('user_version', { simple: true })) > 1) { this.db.close(); throw new Error('This runtime database needs a newer Nibbi version'); }
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS records (bucket TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(bucket,id));
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT, project_id TEXT, type TEXT NOT NULL, at INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_run ON events(run_id,id);
      CREATE TABLE IF NOT EXISTS commands (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, state TEXT NOT NULL, result TEXT, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, project_id TEXT, role TEXT NOT NULL, channel TEXT NOT NULL, text TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}');
      CREATE INDEX IF NOT EXISTS messages_time ON messages(at,id);
      PRAGMA user_version = 1;
    `);
  }
  get<T>(bucket: string, id: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM records WHERE bucket=? AND id=?').get(bucket, id) as { value: string } | undefined;
    return row ? JSON.parse(row.value) as T : undefined;
  }
  revision(bucket: string, id: string): number {
    return (this.db.prepare('SELECT revision FROM records WHERE bucket=? AND id=?').get(bucket, id) as { revision: number } | undefined)?.revision ?? 0;
  }
  list<T>(bucket: string): T[] {
    return (this.db.prepare('SELECT value FROM records WHERE bucket=? ORDER BY rowid').all(bucket) as { value: string }[]).map(row => JSON.parse(row.value) as T);
  }
  put<T>(bucket: string, id: string, value: T, event?: Omit<RunEvent, 'id' | 'at'>, expectedRevision?: number): T {
    let committed: RunEvent | undefined;
    this.db.transaction(() => {
      if (expectedRevision !== undefined && this.revision(bucket, id) !== expectedRevision) throw new RevisionConflict();
      this.db.prepare('INSERT INTO records(bucket,id,value) VALUES(?,?,?) ON CONFLICT(bucket,id) DO UPDATE SET value=excluded.value, revision=records.revision+1').run(bucket, id, JSON.stringify(value));
      if (event) committed = this.insertEvent(event);
    })();
    if (committed) this.events.emit('event', committed);
    return value;
  }
  remove(bucket: string, id: string): void { this.db.prepare('DELETE FROM records WHERE bucket=? AND id=?').run(bucket, id); }
  private insertEvent(event: Omit<RunEvent, 'id' | 'at'> & { at?: number }): RunEvent {
    const at = event.at ?? Date.now();
    const result = this.db.prepare('INSERT INTO events(run_id,project_id,type,at,payload) VALUES(?,?,?,?,?)').run(event.runId ?? null, event.projectId ?? null, event.type, at, JSON.stringify(event.payload));
    return { ...event, at, id: Number(result.lastInsertRowid) };
  }
  emit(event: Omit<RunEvent, 'id' | 'at'> & { at?: number }): RunEvent {
    const result = this.insertEvent(event);
    this.events.emit('event', result);
    return result;
  }
  replay(after = 0, limit = 1000): RunEvent[] {
    return (this.db.prepare('SELECT * FROM events WHERE id>? ORDER BY id LIMIT ?').all(after, Math.max(1, Math.min(limit, 5000))) as Array<{ id: number; run_id: string | null; project_id: string | null; type: string; at: number; payload: string }>).map(row => ({ id: row.id, runId: row.run_id ?? undefined, projectId: row.project_id ?? undefined, type: row.type, at: row.at, payload: JSON.parse(row.payload) }));
  }
  cursor(): number { return (this.db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM events').get() as { id: number }).id; }
  claimCommand(id: string, input: unknown): { state: string; result?: unknown } {
    const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    return this.db.transaction(() => {
      const previous = this.db.prepare('SELECT * FROM commands WHERE id=?').get(id) as { fingerprint: string; state: string; result: string | null } | undefined;
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new Error('Idempotency key was used for another command');
        return { state: previous.state, result: previous.result ? JSON.parse(previous.result) : undefined };
      }
      this.db.prepare('INSERT INTO commands(id,fingerprint,state,at) VALUES(?,?,?,?)').run(id, fingerprint, 'running', Date.now());
      return { state: 'new' };
    })();
  }
  finishCommand(id: string, result: unknown): void {
    this.db.prepare('UPDATE commands SET state=?,result=? WHERE id=?').run('complete', JSON.stringify(result), id);
  }
  interruptCommands(): void { this.db.prepare("UPDATE commands SET state='interrupted' WHERE state='running'").run(); }
  close(): void { this.events.removeAllListeners(); this.db.close(); }

  /** Backup originals first. A failed import rolls back completely and can be retried. */
  migrateLegacy(): void {
    if (this.get('system', 'legacy-import')) return;
    const names = ['state.json', 'games.json', 'fixers.json', 'auto.json', 'previews.json', 'play.json', 'game.json', 'nibbi-goals.json', 'chat-history.jsonl', 'notes.jsonl', 'nibbi-events.jsonl'];
    const inputs = names.filter(name => existsSync(join(this.directory, name))).map(name => ({ name, raw: readFileSync(join(this.directory, name), 'utf8') }));
    let backup: string | null = null;
    if (inputs.length) {
      backup = join(this.directory, 'backups', 'pre-platform-' + Date.now());
      mkdirSync(backup, { recursive: true, mode: 0o700 });
      for (const input of inputs) copyFileSync(join(this.directory, input.name), join(backup, input.name));
      writeFileSync(join(backup, 'manifest.json'), JSON.stringify(inputs.map(input => ({ name: input.name, sha256: createHash('sha256').update(input.raw).digest('hex') })), null, 2));
    }
    const parsed = inputs.map(input => ({ ...input, value: input.name.endsWith('.jsonl') ? input.raw.split('\n').filter(line => line.trim()).map(line => JSON.parse(line)) : JSON.parse(input.raw) }));
    this.db.transaction(() => {
      for (const input of parsed) {
        if (input.name === 'fixers.json') {
          if (!Array.isArray(input.value)) throw new Error('Invalid legacy fixer registry');
          for (const value of input.value) {
            if (!value?.id || !value?.game) throw new Error('Invalid legacy fixer record');
            this.put('fixers', value.id, { ...value, verification: { status: 'unverified' } });
          }
        } else if (input.name === 'chat-history.jsonl') {
          for (const value of input.value) this.db.prepare('INSERT INTO messages(at,role,channel,text,metadata) VALUES(?,?,?,?,?)').run(value.ts, value.role, value.channel, value.text, JSON.stringify({ costUsd: value.costUsd }));
        } else if (input.name === 'nibbi-events.jsonl') {
          for (const value of input.value) this.insertEvent({ type: value.kind || 'note', runId: value.id, projectId: value.project, at: value.ts, payload: value });
        } else this.put('legacy', input.name, input.value);
      }
      this.put('system', 'legacy-import', { at: Date.now(), backup, files: inputs.map(input => input.name) });
    })();
  }
}

let instance: RuntimeStore | undefined;
export function runtime(): RuntimeStore {
  if (!instance) { const candidate = new RuntimeStore(config.stateDir); try { candidate.migrateLegacy(); instance = candidate; } catch (error) { candidate.close(); throw error; } }
  return instance;
}
export function closeRuntime(): void { instance?.close(); instance = undefined; }

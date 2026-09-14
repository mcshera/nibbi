import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { RuntimeStore } from '../src/store.js';
import { archiveThread, createThread, HOME, listThreads, renameThread, requireThread, touchThread } from '../src/threads.js';

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'nibbi-threads-'));
  const store = new RuntimeStore(directory);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const insert = store.db.prepare('INSERT INTO messages(at,project_id,role,channel,text,metadata,thread_id) VALUES(?,?,?,?,?,?,?)');
  const add = (at: string, project: string | null, thread: string | null) =>
    Number(insert.run(at, project, 'user', 'app', 'Hello', '{}', thread).lastInsertRowid);
  return { directory, store, add };
}

test('an existing database gains the thread column without losing its rows', t => {
  const directory = mkdtempSync(join(tmpdir(), 'nibbi-threads-old-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  // A database exactly as a daemon without threads left it.
  const old = new Database(join(directory, 'runtime.sqlite'));
  old.exec(`CREATE TABLE records (bucket TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(bucket,id));
    CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT, project_id TEXT, type TEXT NOT NULL, at INTEGER NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE commands (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, state TEXT NOT NULL, result TEXT, at INTEGER NOT NULL);
    CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, project_id TEXT, role TEXT NOT NULL, channel TEXT NOT NULL, text TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}');
    INSERT INTO messages(at,project_id,role,channel,text,metadata) VALUES('2026-09-01T10:00:00.000Z','battalion','user','app','An older message','{}');
    PRAGMA user_version = 1;`);
  old.close();

  const store = new RuntimeStore(directory);
  t.after(() => store.close());
  assert.equal(Number(store.db.pragma('user_version', { simple: true })), 1, 'the version stays 1 so an older daemon can still open it');
  const columns = (store.db.prepare('PRAGMA table_info(messages)').all() as { name: string }[]).map(c => c.name);
  assert.ok(columns.includes('thread_id'));
  const row = store.db.prepare('SELECT thread_id AS thread FROM messages').get() as { thread: string | null };
  assert.equal(row.thread, null, 'rows written before threads existed belong to home');
  const again = new RuntimeStore(directory);      // opening twice must not fail on the column
  again.close();
});

test('home is every message with no thread, and threads are listed most recent first', t => {
  const { store, add } = fixture(t);
  add('2026-09-01T10:00:00.000Z', 'battalion', null);
  add('2026-09-02T10:00:00.000Z', 'battalion', null);
  const first = createThread('battalion', 'Card balance', store);
  const second = createThread('battalion', 'Art pipeline', store);
  add('2026-09-03T10:00:00.000Z', 'battalion', first.id);
  add('2026-09-05T10:00:00.000Z', 'battalion', second.id);

  const threads = listThreads('battalion', store);
  assert.equal(threads[0].id, HOME);
  assert.equal(threads[0].count, 2);
  assert.equal(threads[0].lastAt, '2026-09-02T10:00:00.000Z');
  assert.deepEqual(threads.slice(1).map(thread => thread.title), ['Art pipeline', 'Card balance']);
});

test('a thread belongs to one project and cannot be reached from another', t => {
  const { store } = fixture(t);
  const thread = createThread('battalion', 'Card balance', store);
  assert.equal(requireThread('battalion', thread.id, store), thread.id);
  assert.throws(() => requireThread('shipless', thread.id, store), /Unknown thread/);
  assert.throws(() => requireThread('battalion', 'not-a-thread', store), /Unknown thread/);
  assert.equal(requireThread('battalion', undefined, store), HOME, 'no thread means home');
  assert.equal(requireThread(undefined, HOME, store), HOME);
  assert.equal(listThreads('shipless', store).length, 1, 'another project sees only its own home');
});

test('an archived thread is listed last and refuses new messages', t => {
  const { store } = fixture(t);
  const thread = createThread('battalion', 'Old ideas', store);
  const live = createThread('battalion', 'Current work', store);
  archiveThread('battalion', thread.id, true, store);
  assert.throws(() => requireThread('battalion', thread.id, store), /archived/);
  assert.deepEqual(listThreads('battalion', store).map(t => t.id), [HOME, live.id, thread.id]);
  archiveThread('battalion', thread.id, false, store);
  assert.equal(requireThread('battalion', thread.id, store), thread.id, 'unarchiving lets it take messages again');
});

test('an untitled thread takes its name from the first thing the owner says', t => {
  const { store } = fixture(t);
  const thread = createThread('battalion', undefined, store);
  assert.equal(store.get<{ title: string }>('threads', thread.id)!.title, 'New thread');
  touchThread(thread.id, '2026-09-04T10:00:00.000Z', 'Rebalance the salvage dice\nand check the odds', store);
  assert.equal(store.get<{ title: string }>('threads', thread.id)!.title, 'Rebalance the salvage dice');
  touchThread(thread.id, '2026-09-04T11:00:00.000Z', 'A later message', store);
  assert.equal(store.get<{ title: string }>('threads', thread.id)!.title, 'Rebalance the salvage dice', 'the title is set once, not rewritten');
  renameThread('battalion', thread.id, 'Salvage dice', store);
  assert.equal(store.get<{ title: string }>('threads', thread.id)!.title, 'Salvage dice');
});

// Read-only activation evidence; no provider calls, settings changes or microphone access.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
const require = createRequire(new URL('../daemon/package.json', import.meta.url));
const Database = require('better-sqlite3');
const destination = process.argv[2]; if (!destination) throw new Error('Output JSON path required');
const stateDir = process.env.NIBBI_STATE_DIR || join(process.env.HOME, '.nibbi');
const db = new Database(join(stateDir, 'runtime.sqlite'), { readonly: true, fileMustExist: true });
db.pragma('query_only = ON');
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
try {
  const records = db.prepare("SELECT bucket,id,value,revision FROM records WHERE bucket NOT IN ('ui-snapshots','ui-logs') ORDER BY bucket,id").all();
  const messages = db.prepare('SELECT * FROM messages ORDER BY id').all();
  const result = { at: new Date().toISOString(), records: records.map(row => ({ bucket: row.bucket, id: row.id, hash: hash(row) })), messageCount: messages.length, messageHash: hash(messages), protectedHashes: {} };
  for (const file of ['SOUL.md', 'AGENTS.md', 'MEMORY.md']) result.protectedHashes[file] = hash(readFileSync(join(process.env.HOME, 'NibbiVault', file), 'utf8'));
  const health = await (await fetch('http://127.0.0.1:4527/nibbi/health')).json();
  const fixers = await (await fetch('http://127.0.0.1:4527/api/fixers')).json();
  const auto = await (await fetch('http://127.0.0.1:4527/api/snapshot')).json();
  result.pid = health.status.pid; result.busy = health.status.busy;
  result.activeFixers = fixers.filter(item => ['running', 'queued'].includes(item.status)).map(item => item.id);
  result.stagedCount = fixers.filter(item => item.status === 'staged').length;
  result.automationOn = Object.values(auto.auto || {}).some(item => item.on);
  if (process.argv.includes('--backup')) { const backup = resolve(dirname(destination), 'runtime-before.sqlite'); await db.backup(backup); result.backup = backup; }
  writeFileSync(destination, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ destination, pid: result.pid, busy: result.busy, activeFixers: result.activeFixers.length, messages: result.messageCount, staged: result.stagedCount, automationOn: result.automationOn }));
} finally { db.close(); }

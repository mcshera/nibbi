import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export interface WorkspaceDocument { path: string; exists: boolean; markdown: string; revision: string }
export class WorkspaceConflict extends Error {
  readonly code = 'REVISION_CONFLICT';
  constructor(readonly revision: string, message = 'This document changed. Refresh and try your edit again.') { super(message); }
}
export function readDocument(path: string): WorkspaceDocument {
  const exists = existsSync(path);
  if (exists && (!statSync(path).isFile() || statSync(path).size > 1_000_000)) throw new Error('Project document must be a text file smaller than 1 MB');
  const markdown = exists ? readFileSync(path, 'utf8') : '';
  return { path, exists, markdown, revision: createHash('sha256').update(exists ? 'present\0' + markdown : 'missing').digest('hex') };
}
/** Cooperative cross-process lock plus revision checks. No await may occur inside this commit. */
export function editDocuments(documents: Array<WorkspaceDocument & { next: string }>): void {
  const locks: string[] = [], temporary: string[] = [];
  try {
    for (const doc of [...documents].sort((a, b) => a.path.localeCompare(b.path))) {
      mkdirSync(dirname(doc.path), { recursive: true });
      const lock = doc.path + '.nibbi-lock';
      try { const fd = openSync(lock, 'wx', 0o600); closeSync(fd); locks.push(lock); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new WorkspaceConflict(readDocument(doc.path).revision, 'Another document edit is in progress. Refresh and retry.'); throw error; }
    }
    for (const doc of documents) { const actual = readDocument(doc.path); if (actual.revision !== doc.revision) throw new WorkspaceConflict(actual.revision); }
    for (const doc of documents) {
      if (doc.next === doc.markdown && doc.exists) { temporary.push(''); continue; }
      if (Buffer.byteLength(doc.next) > 1_000_000) throw new Error('Project document exceeds 1 MB');
      const tmp = join(dirname(doc.path), '.nibbi-edit-' + randomUUID()); temporary.push(tmp);
      writeFileSync(tmp, doc.next, { flag: 'wx', mode: doc.exists ? statSync(doc.path).mode : 0o600 });
    }
    // Catch uncooperative editor writes that arrived while preparing replacement files.
    for (const doc of documents) { const actual = readDocument(doc.path); if (actual.revision !== doc.revision) throw new WorkspaceConflict(actual.revision); }
    for (let i = 0; i < documents.length; i++) if (temporary[i]) renameSync(temporary[i], documents[i].path);
  } finally {
    for (const tmp of temporary) if (tmp) rmSync(tmp, { force: true });
    for (const lock of locks) rmSync(lock, { force: true });
  }
}

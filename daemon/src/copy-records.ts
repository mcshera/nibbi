// A copy of main: a real branch (nibbi/copy/<name>) checked out in its own worktree under the work dir.
// The record and its rules. A leaf: it reads and writes the store and never touches git.
// docs/BUILDS-AS-COPIES.md §2.1–§2.3; the shapes are public/lib/control-panel-contract.js' CopyRecord and friends.
import { join } from 'node:path';
import { config } from './config.js';
import { runtime } from './store.js';

export const COPY_RULES = Object.freeze({
  branchPrefix: 'nibbi/copy/',
  namePattern: /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/,
  nameMax: 32,
  reserved: Object.freeze(['main', 'master', 'head']),
  limit: 5,
  idPattern: /^copy-[0-9a-f-]{36}$/,
  tombstones: 50,
  history: 20,
});
export type CopyStatus = 'creating' | 'ready' | 'shipping' | 'catching_up' | 'retiring' | 'broken' | 'retired';
export type CopyHealth = 'ok' | 'missing' | 'moved' | 'dirty';
export interface ShipRecord { id: string; at: string; sha: string; mainBefore: string; runIds: string[] }
export interface CatchUpRecord { at: string; ok: boolean; mainSha: string; from: string; to: string | null; reason: '' | 'conflict' | 'checkfail' | 'changed'; detail: string; conflicts: string[] }
export interface CopyIntent { kind: 'ship' | 'catchUp'; candidate: string; targetSha: string; integration: string; at: string }
export interface CopyRecord {
  id: string; project: string; name: string; branch: string; base: string; baseSha: string; worktree: string;
  headSha: string; lastVerifiedSha: string | null; lastVerifiedAt: string | null; status: CopyStatus;
  createdAt: string; updatedAt: string; lastLandedAt: string | null; playedAt: string | null; error: string | null;
  ships: ShipRecord[]; catchUps: CatchUpRecord[]; intent: CopyIntent | null; retiredAt: string | null; retiredHead: string | null;
  /** What git ignores that nibbi's own installs left in its folder (`status --ignored` paths; a folder ignored whole ends in '/'),
      written when it is made and after each reinstall. Retire removes that with the folder and nothing else git ignores. */
  installed?: string[];
}
export interface IssueCopy { copyId: string; at: string }

/** The daemon's own copy of the contract's WORDS.copy (it never imports public/); daemon/test/project-copies.test.ts
    checks every shared key against the contract. The last block is daemon-only. */
export const COPY_WORDS = Object.freeze({
  nameEmpty: 'give it a name first',
  nameShape: 'a name is lowercase letters, numbers and dashes — like dev or dev2',
  nameLong: 'keep the name to 32 characters or fewer',
  nameReserved: '“{name}” belongs to the build that ships — pick another',
  nameTaken: 'there’s already a build called {name}',
  tooMany: 'five copies is the most for now — retire one first',
  githubMode: 'copies are local for now — {project} ships through GitHub pull requests',
  noCheck: 'a copy needs a check to keep it honest — set the project’s check in its settings first',
  notReady: '{name} is busy — {status}',
  missing: '{name}’s copy is missing from this machine — retire it, then make it again',
  moved: '{name} changed outside nibbi — its head isn’t the one nibbi checked, so nothing lands or ships until it’s put back',
  dirty: '{name}’s folder has edits nibbi didn’t make — nothing lands or ships until they’re gone',
  fixedAddress: '{project} plays at a fixed address — a copy can’t have its own yet',
  nothingToPlay: 'there’s nothing to play in {name} yet',
  shipNothing: 'nothing to ship yet — no improvement is in {name}',
  shipBehind: 'main moved on — catch {name} up first, then ship',
  shipCheckoutOther: 'your project folder is on {branch} — switch it to {base} to ship',
  shipCheckoutDirty: 'your project folder has changes that aren’t committed — commit or put them away to ship',
  headMoved: '{name} changed since you looked — look again',
  catchUpLevel: '{name} already has everything main has',
  catchUpConflict: 'main and {name} both changed {files} — {name} stays as it is; ask nibbi to bring them together',
  catchUpCheckfail: 'main’s newest doesn’t pass the checks together with {name} — {name} stays as it is',
  retireBuilding: 'an improvement is building on {name} — stop it or let it land first',
  retireDirty: '{name}’s folder has files nibbi didn’t make — nibbi won’t delete them: {files}',
  // daemon-only
  retired: '{name} was retired — start it on main',
  copyGone: 'that build is gone — start it on main',
  stillPlaying: '{name} is playing — stop it first',
  changedOutside: '{name} changed outside nibbi',
  branchExists: 'a branch called {branch} is already in the repository',
  folderExists: 'there’s already a folder for {name} on this machine: {path}',
  stoppedWhileMaking: 'the backend stopped while it was being made',
  shipFailed: 'main is unchanged — {detail}',
  catchUpRefused: 'couldn’t catch {name} up — {detail}',
  notNibbis: '{name}’s folder isn’t the copy nibbi made — nibbi won’t delete it',
  retireMoved: '{name} has commits nibbi didn’t make — nibbi won’t delete them: {commits}',
  autoBroken: '{name} couldn’t be made — automation can’t build into it, so choose main or another copy',
});
export const COPY_STATUS_WORDS: Readonly<Record<string, string>> = Object.freeze({ creating: 'it’s still being made', shipping: 'it’s shipping', catching_up: 'it’s catching up', retiring: 'it’s being retired', broken: 'it couldn’t be made' });
export const fill = (template: string, values: Record<string, string | number | undefined>): string => template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] === undefined ? whole : String(values[key]));
/** A refusal the owner reads: its message is the words. */
export class CopyRefusal extends Error { constructor(readonly code: string, message: string) { super(message); } }
export const refuse = (code: keyof typeof COPY_WORDS, values: Record<string, string | number | undefined> = {}): CopyRefusal => new CopyRefusal(code, fill(COPY_WORDS[code], values));
export const notReadyWords = (copy: Pick<CopyRecord, 'name' | 'status'>): string => fill(COPY_WORDS.notReady, { name: copy.name, status: COPY_STATUS_WORDS[copy.status] ?? copy.status });

export const copyBranch = (name: string): string => COPY_RULES.branchPrefix + name;
/** Always under the work dir, so NIBBI_WORK_DIR isolates it and the work-dir guards cover it. */
export const copyPath = (project: string, name: string): string => join(config.workDir, 'copies', project, name);
export const copyPreviewId = (project: string, id: string): string => 'copy:' + project + ':' + id;
export const isCopyId = (value: unknown): value is string => typeof value === 'string' && COPY_RULES.idPattern.test(value);

export const allCopies = (): CopyRecord[] => runtime().list<CopyRecord>('project-copies');
export const copyById = (id: string): CopyRecord | undefined => isCopyId(id) ? runtime().get<CopyRecord>('project-copies', id) : undefined;
/** Live (not retired) copies of a project, oldest first. */
export const liveCopies = (project: string): CopyRecord[] => allCopies().filter(copy => copy.project === project && copy.status !== 'retired').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
export const retiredCopies = (project: string): CopyRecord[] => allCopies().filter(copy => copy.project === project && copy.status === 'retired').sort((a, b) => (b.retiredAt ?? '').localeCompare(a.retiredAt ?? ''));

/** From the record alone (queueFix is synchronous): the copy is this project's, not retired, and — unless asked not to — ready. */
export function requireLiveCopy(project: string, id: string, options: { ready?: boolean } = {}): CopyRecord {
  const copy = copyById(id);
  if (!copy || copy.project !== project) throw refuse('copyGone');
  if (copy.status === 'retired') throw refuse('retired', { name: copy.name });
  if (options.ready !== false && copy.status !== 'ready') throw new CopyRefusal('notReady', notReadyWords(copy));
  return copy;
}

/** The only writer of a copy record: every write emits copy.updated. */
export function saveCopy(record: CopyRecord): CopyRecord {
  record.updatedAt = new Date().toISOString();
  return runtime().put('project-copies', record.id, record, { type: 'copy.updated', projectId: record.project, payload: { copy: record } });
}
/** Re-read, change, save: a long operation never writes back a stale copy of fields someone else moved. */
export function patchCopy(id: string, change: (record: CopyRecord) => void): CopyRecord {
  const record = copyById(id); if (!record) throw refuse('copyGone');
  change(record); return saveCopy(record);
}
/** What nibbi's own installs left in a copy's folder that git ignores. Not written down (a copy made before it was, or one the
    backend stopped while its install ran): its node_modules. */
export const installedPaths = (copy: Pick<CopyRecord, 'installed'>): string[] => copy.installed ?? ['node_modules/'];
/** A path `status --ignored` lists is one of those, or inside one. */
export const madeByInstall = (copy: Pick<CopyRecord, 'installed'>, path: string): boolean =>
  installedPaths(copy).some(made => path === made || (made.endsWith('/') && path.startsWith(made)));
/** A reinstall after a copy's head changed: its failure is said on the copy (it never undoes the change), and what it left is nibbi's. */
export function noteRefresh(id: string, refreshed: { error: string; installed: string[] }): void {
  if (!refreshed.error && !refreshed.installed.length) return;
  patchCopy(id, record => {
    if (refreshed.error) record.error = refreshed.error;
    if (refreshed.installed.length) record.installed = [...new Set([...installedPaths(record), ...refreshed.installed])];
  });
}
/** A create that failed before its worktree existed leaves no record behind. */
export function removeCopyRecord(record: CopyRecord): void {
  runtime().remove('project-copies', record.id);
  runtime().emit({ type: 'copy.updated', projectId: record.project, payload: { copy: record, removed: true } });
}
/** Keep at most COPY_RULES.tombstones retired records per project; the oldest go first. */
export function pruneTombstones(project: string): void {
  for (const old of retiredCopies(project).slice(COPY_RULES.tombstones)) runtime().remove('project-copies', old.id);
}

/** An issue put "up next" on a copy (bucket issue-copies, id <project>:<issueId>). */
export function setIssueCopy(project: string, issueId: string, copyId: string): void {
  runtime().put<IssueCopy>('issue-copies', project + ':' + issueId, { copyId, at: new Date().toISOString() });
}
/** The stored copy of an issue, only while that copy is live. */
export function issueCopy(project: string, issueId: string): string | null {
  const stored = runtime().get<IssueCopy>('issue-copies', project + ':' + issueId); if (!stored) return null;
  const copy = copyById(stored.copyId);
  return copy && copy.project === project && copy.status !== 'retired' ? copy.id : null;
}

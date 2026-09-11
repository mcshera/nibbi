import { readFileSync, existsSync, appendFileSync, openSync, readSync, closeSync, fstatSync, constants } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';
import { games } from './projects.js';
import { loadState } from './state.js';
import { scopedPath } from './paths.js';
export const VAULT = config.vaultDir;
export const PROTECTED = ['SOUL.md', 'AGENTS.md'];
const read = (name: string): string => { const path = scopedPath(VAULT, name); return existsSync(path) ? readFileSync(path, 'utf8').slice(0, 40_000) : ''; };
/** LOCAL admits complete bounded files or refuses; it never inherits the legacy slice. */
const readLocalProfile = (name: string): string => {
  let fd: number;
  try { fd = openSync(scopedPath(VAULT, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !PROTECTED.includes(name)) return '';
    throw new Error('Local canonical profile could not be read safely: ' + name);
  }
  try {
    if (!fstatSync(fd).isFile()) throw new Error('Local canonical profile is not a regular file: ' + name);
    const bytes = Buffer.alloc(40_001); let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (!count) break; length += count;
    }
    if (length > 40_000) throw new Error('Local canonical profile exceeds the 40,000-byte file limit: ' + name + '. No generation was sent.');
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)); }
    catch { throw new Error('Local canonical profile is not valid UTF-8: ' + name); }
  } finally { closeSync(fd); }
};
/** Rebuilt every turn. Host/provider configuration is not imported from vault instructions. */
export function buildSystemPrompt(options: { strictLocal?: boolean } = {}): string {
  const date = new Date().toLocaleDateString('en-CA');
  const playtest = loadState().playtestGame;
  return [
    'You are Nibbi, a local agent companion. Your working directory is the owner’s Markdown memory vault.',
    'Be concise and show evidence. Preserve the owner’s intent. Persist durable facts in relevant vault pages; distinguish observed facts from hypotheses.',
    'Use registered project slugs for dispatch. Keep plans in plans/<project>.md with milestones and checkbox tasks. Preserve nibbi-task markers; only the backend marks a task complete after a successful merge.',
    'Project code changes belong to fixer worktrees. Dispatch only when the request authorizes a change. Provider/model choices come from project settings, not difficulty guesses.',
    'Skills are task guidance, not permissions. Do not activate learned drafts. Protected SOUL.md and AGENTS.md changes require a proposal and explicit owner review.',
    'Never write credentials or secrets into the vault, transcript, or skills.',
    'For voice requests, optionally start with »voice: and one short spoken sentence, followed by a newline and the written reply.',
    'REGISTERED PROJECTS:\n' + Object.entries(games()).map(([name, project]) => name + ' → ' + project.repo).join('\n'),
    ...['SOUL.md', 'AGENTS.md', 'MEMORY.md', 'index.md', 'journal/' + date + '.md'].map(name => 'VAULT ' + name + ':\n' + (options.strictLocal ? readLocalProfile(name) : read(name))),
    playtest ? 'PLAYTEST MODE: ' + playtest + '. Capture observations in its playtest log, triage issues, and keep acknowledgements brief.' : '',
    'Now: ' + new Date().toString(),
  ].join('\n\n');
}
export function appendLog(operation: string, summary: string): void { appendFileSync(join(VAULT, 'log.md'), '\n## ' + new Date().toISOString() + ' · ' + operation + '\n' + summary + '\n'); }

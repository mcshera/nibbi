import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';
import { games } from './projects.js';
import { loadState } from './state.js';
import { scopedPath } from './paths.js';
export const VAULT = config.vaultDir;
export const PROTECTED = ['SOUL.md', 'AGENTS.md'];
const read = (name: string): string => { const path = scopedPath(VAULT, name); return existsSync(path) ? readFileSync(path, 'utf8').slice(0, 40_000) : ''; };
/** Rebuilt every turn. Host/provider configuration is not imported from vault instructions. */
export function buildSystemPrompt(): string {
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
    ...['SOUL.md', 'AGENTS.md', 'MEMORY.md', 'index.md', 'journal/' + date + '.md'].map(name => 'VAULT ' + name + ':\n' + read(name)),
    playtest ? 'PLAYTEST MODE: ' + playtest + '. Capture observations in its playtest log, triage issues, and keep acknowledgements brief.' : '',
    'Now: ' + new Date().toString(),
  ].join('\n\n');
}
export function appendLog(operation: string, summary: string): void { appendFileSync(join(VAULT, 'log.md'), '\n## ' + new Date().toISOString() + ' · ' + operation + '\n' + summary + '\n'); }

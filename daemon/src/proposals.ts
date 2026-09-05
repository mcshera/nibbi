import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { VAULT, PROTECTED } from './vault.js';
import { scopedPath } from './paths.js';
import { runtime } from './store.js';
import { withRepoLock } from './processes.js';
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
export function listProposals(): string[] { const dir = join(VAULT, 'proposals'); return existsSync(dir) ? readdirSync(dir).filter(name => name.endsWith('.md')) : []; }
export function inspectProposal(name: string): { name: string; revision: string; baseHash: string; target: string; content: string; before: string } {
  if (!listProposals().includes(name)) throw new Error('Exact proposal filename is required');
  const raw = readFileSync(scopedPath(VAULT, 'proposals/' + name), 'utf8');
  const target = /^TARGET:\s*(.+)$/m.exec(raw)?.[1]?.trim(); const content = raw.split(/^## NEW CONTENT\s*$/m)[1]?.replace(/^\n/, '');
  if (!target || !PROTECTED.includes(target) || !content?.trim() || content.length > 100_000) throw new Error('Proposal must target a protected file and contain a nonempty NEW CONTENT section');
  const before = readFileSync(scopedPath(VAULT, target), 'utf8');
  return { name, target, content, before, revision: hash(raw), baseHash: hash(before) };
}
export async function adoptProposal(name: string, revision: string, baseHash: string): Promise<string> {
  return withRepoLock(VAULT, async () => {
    const proposal = inspectProposal(name);
    if (proposal.revision !== revision || proposal.baseHash !== baseHash) throw new Error('Proposal or target changed since review');
    const backup = join(runtime().directory, 'backups', 'proposal-' + Date.now()); mkdirSync(backup, { recursive: true });
    const target = scopedPath(VAULT, proposal.target); copyFileSync(target, join(backup, proposal.target));
    writeFileSync(target, proposal.content);
    runtime().put('proposals', name, { ...proposal, adoptedAt: Date.now(), backup }, { type: 'proposal.adopted', payload: { name, revision, target: proposal.target } });
    return 'Adopted reviewed proposal; previous content backed up. Checkpoint the vault to commit it.';
  });
}

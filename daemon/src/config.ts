import { homedir } from 'node:os';
import { resolve, join } from 'node:path';

/** Explicit overrides keep development, tests, and installed state separate. */
export const config = Object.freeze({
  stateDir: resolve(process.env.NIBBI_STATE_DIR || join(homedir(), '.nibbi')),
  vaultDir: resolve(process.env.NIBBI_VAULT_DIR || join(homedir(), 'NibbiVault')),
  workDir: resolve(process.env.NIBBI_WORK_DIR || join(homedir(), 'NibbiWork', 'fixers')),
  projectsDir: resolve(process.env.NIBBI_PROJECTS_DIR || join(homedir(), 'NibbiProjects')),
  port: Number(process.env.NIBBI_PORT || 4527),
  legacyPort: Number(process.env.NIBBI_GATEWAY_PORT || 4519),
  owner: process.env.NIBBI_OWNER || 'you',
});

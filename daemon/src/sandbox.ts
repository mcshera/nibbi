import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { getDefaultWritePaths } from '@anthropic-ai/sandbox-runtime';
import { config } from './config.js';
import { canonicalPath, within } from './paths.js';
import { execute, safeEnvironment, type ProcessResult } from './processes.js';

const require = createRequire(import.meta.url);
/** Each invocation gets a separate sandbox process/config; parallel runs never share mutable policy. */
export async function sandboxCommand(cwd: string, command: string, options: { signal?: AbortSignal; readableRoots?: string[]; domains?: string[]; timeoutMs?: number; onOutput?: (text: string) => void } = {}): Promise<ProcessResult> {
  if (process.platform !== 'darwin') throw new Error('This backend currently requires the verified macOS sandbox');
  const base = join(config.stateDir, 'sandbox'); mkdirSync(base, { recursive: true, mode: 0o700 });
  const directory = mkdtempSync(join(base, 'command-'));
  const scratch = join(directory, 'tmp'); mkdirSync(scratch);
  const npmUser = join(scratch, 'npm-user-config'), npmGlobal = join(scratch, 'npm-global-config'); writeFileSync(npmUser, ''); writeFileSync(npmGlobal, '');
  const root = canonicalPath(cwd);
  const readable = [root, scratch, dirname(dirname(process.execPath)), ...(options.readableRoots ?? [])].map(canonicalPath);
  const denied = [homedir(), '/Users', '/home', config.stateDir];
  // npm adds its own launcher's .bin folders to PATH. Remove inaccessible host
  // entries and resolve symlinks so child spawn does not fail on a denied prefix.
  const searchPath = [...new Set([dirname(process.execPath), ...(process.env.PATH ?? '/usr/bin:/bin').split(':')].filter(Boolean).flatMap(path => {
    try { const canonical = canonicalPath(path); return denied.some(base => within(base, canonical, true)) && !readable.some(base => within(base, canonical, true)) ? [] : [canonical]; } catch { return []; }
  }))].join(':');
  const settings = {
    ripgrep: { command: existsSync(join(config.stateDir, 'bin', 'rg')) ? join(config.stateDir, 'bin', 'rg') : 'rg' },
    filesystem: {
      denyRead: [...denied, '**/.env', '**/.env.*', '**/.ssh', '**/.aws', '**/.gnupg', '**/.npmrc', '**/.netrc'],
      allowRead: readable,
      allowWrite: [root, scratch],
      denyWrite: [...getDefaultWritePaths().filter(path => !path.startsWith('/dev/')), '**/.git', '**/.claude', '**/.codex', '**/.agents', '**/AGENTS.md', '**/CLAUDE.md'],
    },
    // Toolchains such as tsx use a local Unix socket beneath TMPDIR. Permit
    // only this command's private scratch sockets, never host service sockets.
    network: { allowedDomains: options.domains ?? [], deniedDomains: [], allowLocalBinding: true, allowUnixSockets: [scratch] },
  };
  const file = join(directory, 'settings.json'); writeFileSync(file, JSON.stringify(settings), { mode: 0o600 });
  const source = import.meta.url.endsWith('.ts');
  const worker = fileURLToPath(new URL(source ? './sandbox-worker.ts' : './sandbox-worker.js', import.meta.url));
  return execute(root, process.execPath, [...(source ? ['--import', require.resolve('tsx')] : []), worker, file, command, searchPath], {
    ...options, timeoutMs: options.timeoutMs ?? 10 * 60_000,
    env: { ...safeEnvironment(), TMPDIR: scratch, npm_config_cache: join(scratch, 'npm-cache'), npm_config_devdir: join(scratch, 'node-gyp'), npm_config_userconfig: npmUser, npm_config_globalconfig: npmGlobal, npm_config_update_notifier: 'false', npm_config_audit: 'false', npm_config_fund: 'false', PYTHONDONTWRITEBYTECODE: '1' },
  });
}

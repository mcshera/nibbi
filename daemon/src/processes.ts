import { spawn, type ChildProcess } from 'node:child_process';
import { canonicalPath } from './paths.js';

export interface ProcessResult { code: number; stdout: string; stderr: string }
export class ProcessFailure extends Error {
  constructor(readonly command: string, readonly result: ProcessResult) { super(`${command} exited ${result.code}: ${(result.stderr || result.stdout).slice(-2000)}`); }
}
const children = new Set<ChildProcess>();
export function terminate(child: ChildProcess): void {
  // The leader may have exited while a descendant still holds its output pipes.
  // Terminate the process group until close, not merely until the leader exits.
  if (!child.pid) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  const timer = setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }, 3000);
  timer.unref();
  child.once('close', () => clearTimeout(timer));
}
export function safeEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/TOKEN|SECRET|PASSWORD|API_KEY|OAUTH|^npm_|^NODE_TEST_/i.test(key)) delete env[key];
  delete env.NODE_OPTIONS;
  delete env.BASH_ENV;
  delete env.ENV;
  return env;
}
export async function execute(cwd: string, command: string, args: string[], options: { signal?: AbortSignal; timeoutMs?: number; onOutput?: (text: string) => void; env?: NodeJS.ProcessEnv } = {}): Promise<ProcessResult> {
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: options.env ?? safeEnvironment(), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.on('data', (chunk: Buffer) => { const text = chunk.toString(); stdout = (stdout + text).slice(-1_000_000); options.onOutput?.(text); });
    child.stderr.on('data', (chunk: Buffer) => { const text = chunk.toString(); stderr = (stderr + text).slice(-1_000_000); options.onOutput?.(text); });
    const abort = (): void => terminate(child);
    const timer = setTimeout(() => { timedOut = true; terminate(child); }, options.timeoutMs ?? 120_000);
    options.signal?.addEventListener('abort', abort, { once: true });
    const cleanup = (): void => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); children.delete(child); };
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', code => {
      // Reap any background descendants still in the group after their parent exits.
      if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* group already exited */ } }
      cleanup();
      if (options.signal?.aborted) { reject(options.signal.reason ?? new Error('Cancelled')); return; }
      if (timedOut) { reject(new Error(`${command} timed out; process terminated`)); return; }
      const result = { code: code ?? -1, stdout, stderr };
      if (result.code !== 0) reject(new ProcessFailure(command, result)); else resolve(result);
    });
  });
}
export async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execute(cwd, 'git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', '-c', 'user.name=Nibbi', '-c', 'user.email=nibbi@local', ...args])).stdout.trim();
}
const locks = new Map<string, Promise<unknown>>();
export async function withRepoLock<T>(repo: string, action: () => Promise<T>): Promise<T> {
  const key = canonicalPath(repo);
  const previous = locks.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(action);
  locks.set(key, current);
  try { return await current; } finally { if (locks.get(key) === current) locks.delete(key); }
}
export async function stopProcesses(): Promise<void> {
  await Promise.all([...children].map(child => new Promise<void>(resolve => { child.once('close', () => resolve()); terminate(child); })));
}

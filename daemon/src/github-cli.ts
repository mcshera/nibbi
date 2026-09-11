import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { execute, safeEnvironment, type ProcessResult } from './processes.js';

export class GithubError extends Error {
  constructor(readonly code: string, message: string, readonly retryAfter?: number) { super(redactGithubError(message)); }
}
export function redactGithubError(text: string): string { return text.replace(/(?:gh[pousr]_[a-zA-Z0-9_]+|github_pat_[a-zA-Z0-9_]+|Bearer\s+\S+)/g, '[redacted]').replace(/https:\/\/[^/@\s]+:[^/@\s]+@/g, 'https://[redacted]@').slice(-4000); }
export type GithubRunner = (command: 'gh' | 'git', args: string[], cwd: string, options: { host?: string; mutation?: boolean; signal?: AbortSignal }) => Promise<ProcessResult>;
let injected: GithubRunner | undefined;
export function replaceGithubRunnerForTest(runner: GithubRunner): () => void {
  if (process.env.NODE_ENV !== 'test') throw new Error('Test runner injection is unavailable');
  const previous = injected; injected = runner; clearGithubCache(); backoff.clear(); return () => { injected = previous; clearGithubCache(); backoff.clear(); };
}
let executable: string | undefined;
function ghExecutable(): string {
  if (!executable) {
    const paths = [join(homedir(), '.local/bin/gh'), '/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh', ...(process.env.PATH ?? '').split(':').filter(isAbsolute).map(dir => join(dir, 'gh'))];
    const candidate = [...new Set(paths)].find(path => { try { accessSync(path, constants.X_OK); return statSync(path).isFile(); } catch { return false; } });
    if (!candidate) throw new GithubError('CLI_UNAVAILABLE', 'GitHub CLI is unavailable. Install gh on this Mac before connecting.');
    executable = realpathSync(candidate);
  }
  return executable;
}
const waits = new Map<string, Promise<unknown>>();
export async function withGithubRepoLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = waits.get(key) ?? Promise.resolve(), current = previous.catch(() => undefined).then(fn); waits.set(key, current);
  try { return await current; } finally { if (waits.get(key) === current) waits.delete(key); }
}
const hosts = new Map<string, { active: number; waiting: Array<() => void> }>();
async function bounded<T>(host: string, fn: () => Promise<T>): Promise<T> {
  const state = hosts.get(host) ?? { active: 0, waiting: [] }; hosts.set(host, state);
  if (state.active >= 2) await new Promise<void>(resolve => state.waiting.push(resolve)); else state.active++;
  try { return await fn(); } finally { const next = state.waiting.shift(); if (next) next(); else state.active--; }
}
interface HttpOutput { status?: number; headers: Record<string, string>; body: string }
export function parseGithubHttpOutput(raw: string): HttpOutput {
  const normalized = raw.replace(/\r\n/g, '\n');
  if (!/^HTTP\/\S+ \d{3}\b/.test(normalized)) return { headers: {}, body: raw };
  const end = normalized.indexOf('\n\n'), block = end < 0 ? normalized : normalized.slice(0, end);
  const lines = block.split('\n'), status = Number(lines.shift()!.match(/^HTTP\/\S+ (\d{3})/)![1]);
  const headers: Record<string, string> = {};
  for (const line of lines) { const colon = line.indexOf(':'); if (colon > 0) headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim(); }
  return { status, headers, body: end < 0 ? '' : normalized.slice(end + 2) };
}
const backoff = new Map<string, { until: number; failures: number }>();
function rateLimit(host: string, output: string, detail: string): number | undefined {
  const response = parseGithubHttpOutput(output);
  if (response.status !== 429 && !(response.status === 403 && (/rate limit|abuse|secondary/i.test(detail + response.body) || response.headers['x-ratelimit-remaining'] === '0'))) return;
  const previous = backoff.get(host), failures = (previous?.failures ?? 0) + 1, now = Date.now();
  const retry = response.headers['retry-after'];
  const retryAt = retry ? (/^\d+$/.test(retry) ? now + Number(retry) * 1000 : Date.parse(retry)) : undefined;
  const resetAt = response.headers['x-ratelimit-remaining'] === '0' ? Number(response.headers['x-ratelimit-reset']) * 1000 : undefined;
  const until = Math.max(now + Math.min(300_000, 1000 * 2 ** Math.min(failures, 8)) + Math.floor(Math.random() * 1000), Number.isFinite(retryAt) ? retryAt! : 0, Number.isFinite(resetAt) ? resetAt! : 0);
  backoff.set(host, { until, failures }); return until;
}
const cache = new Map<string, { etag?: string; value: unknown }>();
const pendingReads = new Map<string, Promise<unknown>>();
const accounts = new Map<string, string>();
let cacheGeneration = 0;
export function clearGithubCache(host?: string): void {
  cacheGeneration++;
  for (const map of [cache, pendingReads]) for (const key of map.keys()) if (!host || key.startsWith(host + '\0')) map.delete(key);
}
export async function githubCommand(command: 'gh' | 'git', args: string[], cwd: string, options: { host?: string; mutation?: boolean; signal?: AbortSignal; acceptedCodes?: number[] } = {}): Promise<ProcessResult> {
  const invoke = async (): Promise<ProcessResult> => {
    const host = options.host ?? 'github.com', limit = backoff.get(host);
    if (command === 'gh' && limit && limit.until > Date.now()) throw new GithubError('RATE_LIMITED', 'GitHub requested a pause. Last confirmed data is retained; retry after ' + new Date(limit.until).toISOString(), limit.until);
    const env = safeEnvironment();
    delete env.GH_REPO; delete env.GH_DEBUG; delete env.GIT_TRACE; delete env.GIT_TRACE_CURL; delete env.GIT_CURL_VERBOSE;
    Object.assign(env, { GH_HOST: options.host ?? 'github.com', GH_PROMPT_DISABLED: '1', GH_PAGER: 'cat', PAGER: 'cat', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' });
    try {
      const result = injected ? await injected(command, args, cwd, options) : await execute(cwd, command === 'gh' ? ghExecutable() : 'git', command === 'git' ? ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', '-c', 'user.name=Nibbi', '-c', 'user.email=nibbi@local', ...args] : args, { env, signal: options.signal, timeoutMs: options.mutation ? 120_000 : 30_000 });
      if (result.stdout.length >= 1_000_000 || result.stderr.length >= 1_000_000) throw new GithubError('INCOMPLETE_RESPONSE', 'GitHub command output exceeded the bounded limit. Narrow the requested scope before acting.');
      if (result.code && !options.acceptedCodes?.includes(result.code)) throw Object.assign(new Error(result.stderr || result.stdout), { result });
      return result;
    } catch (error) {
      if (error instanceof GithubError) throw error;
      const failure = error as Error & { result?: ProcessResult };
      if (command === 'gh' && args[0] === 'api' && args.includes('GET') && failure.result && parseGithubHttpOutput(failure.result.stdout).status === 304) return failure.result;
      if (failure.result && options.acceptedCodes?.includes(failure.result.code)) return failure.result;
      const text = failure.result?.stderr || failure.result?.stdout || failure.message;
      const retryAfter = rateLimit(host, failure.result?.stdout ?? '', text);
      if (retryAfter) throw new GithubError('RATE_LIMITED', 'GitHub rate limit reached; last confirmed data is retained.', retryAfter);
      const code = /HTTP 404|\bNot Found\b/i.test(text) ? 'NOT_FOUND' : /HTTP 403|rate limit/i.test(text) ? 'FORBIDDEN' : /HTTP 401|authentication|not logged/i.test(text) ? 'AUTH_REQUIRED' : 'CLI_FAILED';
      throw new GithubError(code, text || 'GitHub command failed');
    }
  };
  return options.mutation ? invoke() : bounded(options.host ?? 'github.com', invoke);
}
export async function githubJson<T = Record<string, any>>(args: string[], cwd: string, host = 'github.com', mutation = false): Promise<T> {
  const result = await githubCommand('gh', args, cwd, { host, mutation });
  try { return JSON.parse(result.stdout) as T; } catch { throw new GithubError('INVALID_RESPONSE', 'GitHub returned an incomplete or invalid JSON response. Refresh before acting.'); }
}
export async function githubApi<T = Record<string, any>>(host: string, path: string, cwd: string): Promise<T> {
  if (!/^\/?(?:repos\/|user(?:$|\/))/.test(path) || /[\r\n]/.test(path)) throw new GithubError('INVALID_REQUEST', 'Unsupported GitHub read endpoint');
  // Every caller still performs a current conditional read. No TTL can authorize an old head or account.
  const isUser = /^\/?user$/.test(path), key = [host, accounts.get(host) ?? 'unverified', cwd, path].join('\0');
  const existing = pendingReads.get(key); if (existing) return structuredClone(await existing) as T;
  const generation = cacheGeneration;
  const request = (async (): Promise<T> => {
    const previous = isUser ? undefined : cache.get(key);
    const response = await githubCommand('gh', ['api', '--hostname', host, '--method', 'GET', '--include', path, '-H', 'Accept: application/vnd.github+json', ...(previous?.etag ? ['-H', 'If-None-Match: ' + previous.etag] : [])], cwd, { host });
    const parsed = parseGithubHttpOutput(response.stdout);
    if (parsed.status === 304) { if (!previous) throw new GithubError('INVALID_RESPONSE', 'GitHub returned a cache response without prior evidence'); return structuredClone(previous.value) as T; }
    if (parsed.status && (parsed.status < 200 || parsed.status >= 300)) throw new GithubError('INVALID_RESPONSE', 'GitHub returned HTTP ' + parsed.status);
    let value: T; try { value = JSON.parse(parsed.body) as T; } catch { throw new GithubError('INVALID_RESPONSE', 'GitHub returned incomplete JSON. Refresh before acting.'); }
    if (isUser) {
      const login = String((value as Record<string, unknown>).login ?? '').toLowerCase();
      if (accounts.get(host) !== login) { clearGithubCache(host); accounts.set(host, login); }
    } else if (generation === cacheGeneration) {
      cache.set(key, { etag: parsed.headers.etag, value });
      if (cache.size > 500) cache.delete(cache.keys().next().value!);
    }
    return structuredClone(value);
  })();
  pendingReads.set(key, request);
  try { return await request; } finally { if (pendingReads.get(key) === request) pendingReads.delete(key); }
}
export async function githubPages<T = any>(host: string, endpoint: string, cwd: string, key?: string): Promise<T[]> {
  const values: T[] = [];
  for (let page = 1; page <= 20; page++) {
    const data = await githubApi<any>(host, endpoint + (endpoint.includes('?') ? '&' : '?') + `per_page=100&page=${page}`, cwd);
    const batch = key ? data[key] : data; if (!Array.isArray(batch)) throw new GithubError('INVALID_RESPONSE', 'GitHub returned an invalid page');
    values.push(...batch); if (batch.length < 100) return values;
  }
  throw new GithubError('INCOMPLETE_RESPONSE', 'GitHub data exceeds the bounded page limit; narrow the requested scope before acting.');
}
export async function githubGit(cwd: string, args: string[], mutation = false): Promise<string> { return (await githubCommand('git', args, cwd, { mutation })).stdout.trim(); }

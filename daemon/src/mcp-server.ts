import type { IncomingMessage, ServerResponse } from 'node:http';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { runtime, type RuntimeStore } from './store.js';
import { body, json, HttpError } from './http.js';
import { fileTools, leaseTools, leaseFor, serveLease, type GovernedTool, type ToolLease } from './tool-service.js';
import { leadTools, activeTurns, steerTurn } from './session.js';
import { listFixers } from './fixer.js';
import { webTools } from './web-tools.js';
import { progressSummary } from './progress.js';
import { VAULT } from './vault.js';
import { games } from './projects.js';
import { boundedInput, summarizeResult } from './tool-transcript.js';

/** Nibbi as an MCP server for outside harnesses: named, revocable bearer tokens grant a fixed scope of governed tools over POST /mcp. Every call is audited under runId mcp-<name>. */
export const MCP_SCOPES = ['read', 'web', 'dispatch', 'steer'] as const;
export type McpScope = typeof MCP_SCOPES[number];
export interface McpTokenRecord { name: string; scopes: McpScope[]; projects: string[] | '*'; createdAt: number; expiresAt?: number; lastUsedAt?: number; useCount: number; revokedAt?: number; hashPrefix: string; hash: string }
export type McpTokenView = Omit<McpTokenRecord, 'hash'>;
const TOKENS = 'mcp-tokens', PREFIX = 'nib_', RATE_LIMIT = 60, RATE_WINDOW_MS = 60_000;
const READ_TOOLS = ['read_roadmap', 'read_activity', 'list_fixers', 'read_github_project', 'read_github_build', 'recent_chat', 'search_chat'];
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/, 'Use a lowercase slug of up to 32 characters');
export const McpTokenInputSchema = z.object({
  name: slug, scopes: z.array(z.enum(MCP_SCOPES)).min(1).max(MCP_SCOPES.length).transform(values => [...new Set(values)]),
  projects: z.union([z.literal('*'), z.array(z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(64)).min(1).max(50)]), expiresDays: z.number().int().min(1).max(3650).optional(),
}).strict();

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const view = ({ hash: _hash, ...rest }: McpTokenRecord): McpTokenView => rest;
const active = (record: McpTokenRecord, at: number): boolean => !record.revokedAt && (record.expiresAt === undefined || record.expiresAt > at);
const remoteEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.NIBBI_MCP_REMOTE === '1';
/** The loopback listener always serves /mcp; the HTTPS listener only when the owner opted in with NIBBI_MCP_REMOTE=1. */
export function mcpRouteEnabled(tls: boolean, env: NodeJS.ProcessEnv = process.env): boolean { return !tls || remoteEnabled(env); }

// Clock and limiter are module state so tests can pin time and force a 429 without waiting a minute.
let clock: () => number = Date.now;
const windows = new Map<string, number[]>();
const defaultLimiter = (key: string, at: number): boolean => { const hits = (windows.get(key) ?? []).filter(hit => at - hit < RATE_WINDOW_MS); hits.push(at); windows.set(key, hits); return hits.length <= RATE_LIMIT; };
let limiter: (key: string, at: number) => boolean = defaultLimiter;
/** Test seam: pin the clock or replace the per-token limiter (keyed by token hash). */
export function replaceMcpServerForTest(overrides: { now?: () => number; limiter?: (key: string, at: number) => boolean }): () => void {
  if (process.env.NODE_ENV !== 'test') throw new Error('MCP server injection is unavailable');
  const previous = { clock, limiter }; clock = overrides.now ?? Date.now; limiter = overrides.limiter ?? defaultLimiter;
  return () => { clock = previous.clock; limiter = previous.limiter; };
}

export function mcpTokens(store: RuntimeStore = runtime()): McpTokenRecord[] { return store.list<McpTokenRecord>(TOKENS).sort((a, b) => a.createdAt - b.createdAt); }
/** Owner view: never the hash, only its 8-character prefix for recognition. */
export function mcpTokensView(store: RuntimeStore = runtime()): { tokens: McpTokenView[]; route: string; remote: boolean } { return { tokens: mcpTokens(store).map(view), route: '/mcp', remote: remoteEnabled() }; }
export function mcpServerHealthSummary(store: RuntimeStore = runtime()): { route: string; tokens: number; remote: boolean } { const at = clock(); return { route: '/mcp', tokens: mcpTokens(store).filter(record => active(record, at)).length, remote: remoteEnabled() }; }

/** The plaintext is returned exactly once; only its SHA-256 is stored. */
export function createMcpToken(input: unknown, store: RuntimeStore = runtime()): { token: string; record: McpTokenView } {
  const value = McpTokenInputSchema.parse(input); const at = clock();
  if (value.projects !== '*') for (const project of value.projects) if (!games()[project]) throw new Error('Unknown project ' + project);
  if (mcpTokens(store).some(record => record.name === value.name && active(record, at))) throw new Error('A token named ' + value.name + ' already exists; revoke it first');
  const token = PREFIX + randomBytes(32).toString('base64url'), hash = digest(token);
  const record: McpTokenRecord = { name: value.name, scopes: value.scopes, projects: value.projects, createdAt: at, ...(value.expiresDays ? { expiresAt: at + value.expiresDays * 86_400_000 } : {}), useCount: 0, hashPrefix: hash.slice(0, 8), hash };
  store.put(TOKENS, hash, record, { type: 'mcp.token_created', runId: 'mcp-' + record.name, payload: { token: record.name, scopes: record.scopes, projects: record.projects, expiresAt: record.expiresAt ?? null } });
  return { token, record: view(record) };
}
/** Revocation is immediate: the record stays for the audit trail, the lease closes, in-flight calls abort. Expired records under the name are revoked too, so the table can always clear them. */
export async function revokeMcpToken(name: string, store: RuntimeStore = runtime()): Promise<McpTokenView> {
  const at = clock(); const revoked = mcpTokens(store).filter(record => record.name === name && !record.revokedAt).map((record): McpTokenRecord => ({ ...record, revokedAt: at }));
  if (!revoked.length) throw new Error('Unknown or already revoked token');
  for (const record of revoked) { store.put(TOKENS, record.hash, record, { type: 'mcp.token_revoked', runId: 'mcp-' + name, payload: { token: name } }); await closeLease(record.hash); }
  return view(revoked[revoked.length - 1]);
}
/** Constant-time over the whole token set: hash the presented value, compare every stored hash, keep the active match. */
function lookup(presented: string, store: RuntimeStore): McpTokenRecord | undefined {
  const hash = Buffer.from(digest(presented)), at = clock(); let found: McpTokenRecord | undefined;
  for (const record of mcpTokens(store)) { const candidate = Buffer.from(record.hash); if (candidate.length === hash.length && timingSafeEqual(candidate, hash) && active(record, at)) found = record; }
  return found;
}

interface RequestContext { userAgent: string; args?: Record<string, unknown> }
const requests = new AsyncLocalStorage<RequestContext>();
const leases = new Map<string, Promise<ToolLease>>();
let daemon = new AbortController();
export const mcpLeaseCount = (): number => leases.size;
const requested = (args: Record<string, unknown>): string | undefined => typeof args.project === 'string' ? args.project : undefined;
const inScope = (record: McpTokenRecord, project: string | undefined): boolean => record.projects === '*' || (project !== undefined && record.projects.includes(project));
const assertScope = (record: McpTokenRecord, project: string | undefined): void => { if (!inScope(record, project)) throw new Error((project === undefined ? 'The target' : 'Project ' + project) + ' is outside the scope of token ' + record.name); };
/** Action tools always resolve a project and check it; read tools are vault-wide but an explicit project argument still has to be in scope. */
const guarded = (record: McpTokenRecord, tool: GovernedTool, projectOf: (args: Record<string, unknown>) => string | undefined, required = true): GovernedTool =>
  ({ ...tool, call: (args, signal) => { const project = projectOf(args); if (required || project !== undefined) assertScope(record, project); return tool.call(args, signal); } });

async function toolsFor(record: McpTokenRecord, runId: string, store: RuntimeStore, signal: AbortSignal): Promise<GovernedTool[]> {
  const lead = leadTools(undefined, true), pick = (names: string[]): GovernedTool[] => lead.filter(tool => names.includes(tool.name));
  const tools: GovernedTool[] = [];
  if (record.scopes.includes('read')) {
    tools.push(...pick(READ_TOOLS).map(tool => guarded(record, tool, requested, false)));
    tools.push(...fileTools({ role: 'lead', cwd: VAULT, readableRoots: [VAULT], writableRoots: [] }, signal).filter(tool => ['read_file', 'list_files'].includes(tool.name)));
    tools.push({ name: 'read_progress', description: 'Read backend-derived delivery progress: verified merges today and this week, streak, recent deliveries. Data, not a target.', inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      call: async (args, signal) => { signal.throwIfAborted(); z.object({}).strict().parse(args); return progressSummary(new Date(clock()), store); } });
  }
  if (record.scopes.includes('web')) {
    // The lease outlives owner edits to the allowlist and Keychain, so the boundary is resolved again on every call; only the listed names are fixed until the backend restarts.
    const live = (): Promise<GovernedTool[]> => webTools(undefined, { store, emit: (type, payload) => { store.emit({ type, runId, payload }); } });
    tools.push(...(await live()).map(tool => ({ ...tool, call: async (args: Record<string, unknown>, signal: AbortSignal) => {
      const current = (await live()).find(candidate => candidate.name === tool.name); if (!current) throw new Error(tool.name + ' is unavailable: the owner has removed web access in Settings → Providers → Web access');
      return current.call(args, signal);
    } })));
  }
  if (record.scopes.includes('dispatch')) tools.push(...pick(['dispatch_fixer']).map(tool => guarded(record, tool, requested)));
  if (record.scopes.includes('steer')) {
    tools.push(...pick(['steer_fixer']).map(tool => guarded(record, tool, args => listFixers().find(run => run.id === args.id)?.game)));
    tools.push({ name: 'steer_turn', description: 'Send guidance to a live conversation turn (runId from read_activity). Reaches only a running primary provider that supports steering; the request is logged as [STEER].', inputSchema: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'], additionalProperties: false },
      call: async args => {
        const value = z.object({ id: z.string().min(1).max(200), text: z.string().min(1).max(20_000) }).strict().parse(args);
        const turn = activeTurns().find(turn => turn.runId === value.id); if (!turn) throw new Error('Turn is not active');
        assertScope(record, turn.project); await steerTurn(value.id, value.text); return 'Guidance delivered to ' + value.id;
      } });
  }
  return tools;
}
/** One lease per token for the daemon lifetime, built on first use; hooks write the same tool.started/tool.finished trail as a lead turn plus mcp.served. The caller passes a record re-read after the request body arrived, so a token revoked mid-request never gets a rebuilt lease. */
function grant(record: McpTokenRecord, store: RuntimeStore): Promise<ToolLease> {
  const existing = leases.get(record.hash); if (existing) return existing;
  const runId = 'mcp-' + record.name;
  const emit = (type: string, payload: Record<string, unknown>, projectId?: string): void => { store.emit({ type, runId, projectId, payload }); };
  const created = (async (): Promise<ToolLease> => leaseTools(await toolsFor(record, runId, store, daemon.signal), daemon.signal, {
    onAttempt: name => emit('tool.attempted', { name: name.slice(0, 200) }),
    onCall: info => { const context = requests.getStore(); if (context) context.args = info.args; emit('tool.started', { name: info.name, source: 'governed', input: boundedInput(info.args) }, requested(info.args)); },
    onResult: info => {
      const context = requests.getStore(), args = context?.args ?? {}, error = String(info.error ?? 'failed').slice(0, 300);
      emit('tool.finished', { name: info.name, source: 'governed', ok: info.ok, summary: info.ok ? summarizeResult(info.name, args, info.result) : error, ...(info.ok ? {} : { error }), bytes: info.bytes, elapsedMs: info.elapsedMs }, requested(args));
      emit('mcp.served', { token: record.name, tool: info.name, argBytes: Buffer.byteLength(JSON.stringify(args)), ok: info.ok, elapsedMs: info.elapsedMs, userAgent: context?.userAgent ?? '' }, requested(args));
    },
  }))();
  leases.set(record.hash, created); created.catch(() => { if (leases.get(record.hash) === created) leases.delete(record.hash); });
  return created;
}
async function closeLease(hash: string): Promise<void> { const pending = leases.get(hash); leases.delete(hash); windows.delete(hash); if (pending) await (await pending.catch(() => undefined))?.close(); }
export async function stopMcpServer(): Promise<void> {
  daemon.abort(new Error('Backend shutdown')); const pending = [...leases.values()]; leases.clear(); windows.clear();
  await Promise.allSettled(pending.map(async lease => (await lease).close())); daemon = new AbortController();
}

const bearer = (req: IncomingMessage): string | undefined => /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization ?? ''))?.[1];
const rpcError = (code: number, message: string): Record<string, unknown> => ({ jsonrpc: '2.0', error: { code, message }, id: null });
/** The stored record if the token is still active right now; a revoke or expiry during the request makes it undefined. */
const current = (hash: string, store: RuntimeStore): McpTokenRecord | undefined => { const record = store.get<McpTokenRecord>(TOKENS, hash); return record && active(record, clock()) ? record : undefined; };
/** POST /mcp. Browser origins are refused, unknown/revoked/expired tokens get a bare 401, the token's own limiter answers 429, and exactly one JSON-RPC message is served per request. */
export async function mcpRoute(req: IncomingMessage, res: ServerResponse, _url: URL, _tls: boolean): Promise<void> {
  if (req.headers.origin !== undefined) throw new HttpError(403, 'Browser origins cannot use /mcp');
  if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }).end(); return; }
  const store = runtime(), presented = bearer(req), record = presented?.startsWith(PREFIX) ? lookup(presented, store) : undefined;
  if (!record) { res.writeHead(401, { 'www-authenticate': 'Bearer realm="nibbi"' }).end(); return; }
  if (!limiter(record.hash, clock())) { res.writeHead(429, { 'retry-after': '60' }).end(); return; }
  const payload = await body(req); let message: unknown;
  try { message = JSON.parse(payload.toString('utf8')); } catch { json(res, 400, rpcError(-32700, 'Parse error: Invalid JSON')); return; }
  // One message per request: a JSON-RPC batch would carry many tool calls past the per-request limiter and blur the started/finished audit pairing.
  if (Array.isArray(message)) { json(res, 400, rpcError(-32600, 'Batch requests are not supported; send one JSON-RPC message per request')); return; }
  // Re-read after the body arrived: a revoke while it was in flight refuses this request instead of rebuilding the token's lease from the stale record.
  const fresh = current(record.hash, store); if (!fresh) { res.writeHead(401).end(); return; }
  const at = clock(); store.put(TOKENS, fresh.hash, { ...fresh, lastUsedAt: at, useCount: fresh.useCount + 1 });
  const granted = await grant(fresh, store), lease = current(fresh.hash, store) && leaseFor(granted.token);
  if (!lease) { res.writeHead(401).end(); return; } // Revoked or shut down while the lease was being built.
  await requests.run({ userAgent: String(req.headers['user-agent'] ?? '').slice(0, 120) }, () => serveLease(lease, req, res, payload));
}

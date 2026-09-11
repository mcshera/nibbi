import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { safeEnvironment, terminate } from '../processes.js';
import type { AgentInput, AgentHandle, AgentProvider, AgentResult, ExecutionEvidence } from './types.js';
import { ProviderTurnError } from './failure.js';

type ObjectValue = Record<string, unknown>;
interface RpcMessage { id?: number | string; method?: string; params?: ObjectValue; result?: unknown; error?: { message: string; code?: number; data?: unknown } }
export class CodexRpcError extends Error {
  readonly code?: number;
  readonly data?: unknown;
  constructor(error: NonNullable<RpcMessage['error']>) { super(error.message); this.name = 'CodexRpcError'; this.code = error.code; this.data = error.data; }
}
interface NativeTurnError { message: string; codexErrorInfo?: unknown; additionalDetails?: unknown }
interface NativeItem { type?: string; text?: string; name?: string; tool?: string }
// Validated against offline `codex app-server generate-ts`, v2/ThreadItem.ts.
// Unknown items fail closed. Reasoning and input/plan markers are not tool attempts.
const nonActionItems = new Set(['agentMessage', 'reasoning', 'userMessage', 'plan']);
/** A bounded JSONL transport. Closing rejects every outstanding request; no silent retries. */
export class CodexRpc extends EventEmitter {
  private child: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private requests = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private closed = false;
  readonly exited: Promise<void>;
  constructor(cwd: string, token?: string) {
    super();
    const flags = ['hooks', 'multi_agent', 'shell_tool', 'unified_exec', 'shell_snapshot', 'skill_mcp_dependency_install', 'apps', 'memories', 'js_repl', 'code_mode'];
    this.child = spawn(process.env.NIBBI_CODEX_BIN || 'codex', ['app-server', '--stdio', ...flags.flatMap(flag => ['-c', `features.${flag}=false`]), '-c', 'web_search="disabled"', '-c', 'notify=[]'], {
      cwd, detached: true, env: { ...safeEnvironment(), NIBBI_TOOL_TOKEN: token }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.exited = new Promise(resolve => { this.child.once('close', () => resolve()); this.child.once('error', () => resolve()); });
    let buffer = '';
    this.child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      if (buffer.length > 4_000_000) { this.fail(new Error('Codex protocol frame exceeded limit')); this.close(); return; }
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        try { this.receive(JSON.parse(line) as RpcMessage); } catch { this.fail(new Error('Malformed Codex protocol response')); this.close(); }
      }
    });
    this.child.stderr.resume(); // Drain without persisting provider environment/credential diagnostics.
    this.child.on('error', error => this.fail(new Error(`Cannot start Codex: ${error.message}`)));
    this.child.on('close', () => this.fail(new Error('Codex connection closed')));
  }
  private receive(message: RpcMessage): void {
    if (message.method) {
      if (message.id !== undefined) {
        this.emit('host.request', message.method);
        // Built-in host mutations and escalation are not authorized. Actions use scoped MCP instead.
        if (message.method.endsWith('/requestApproval')) this.send({ id: message.id, result: { decision: 'decline' } });
        else this.send({ id: message.id, error: { code: -32601, message: 'Use the governed Nibbi tools; interactive escalation is not enabled' } });
      } else this.emit('notification', message.method, message.params ?? {});
    } else if (typeof message.id === 'number') {
      const request = this.requests.get(message.id); if (!request) return;
      this.requests.delete(message.id); clearTimeout(request.timer);
      if (message.error) request.reject(new CodexRpcError(message.error)); else request.resolve(message.result);
    }
  }
  private send(message: unknown): void { if (!this.closed) this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...(message as ObjectValue) }) + '\n'); }
  private fail(error: Error): void {
    for (const request of this.requests.values()) { clearTimeout(request.timer); request.reject(error); }
    this.requests.clear(); this.emit('disconnected', error);
  }
  request<T = ObjectValue>(method: string, params: unknown = {}, timeoutMs = 30_000): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Codex connection closed'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.requests.delete(id); reject(new Error(`Codex ${method} timed out`)); }, timeoutMs);
      this.requests.set(id, { resolve: value => resolve(value as T), reject, timer }); this.send({ id, method, params });
    });
  }
  async initialize(): Promise<void> { await this.request('initialize', { clientInfo: { name: 'nibbi', title: 'Nibbi', version: '0.8.0' }, capabilities: { experimentalApi: false } }); this.send({ method: 'initialized', params: {} }); }
  close(): void { if (this.closed) return; this.closed = true; this.fail(new Error('Codex connection closed')); terminate(this.child); }
}

export function startCodex(input: AgentInput): AgentHandle {
  const rpc = new CodexRpc(input.cwd, input.tools.token);
  const evidence: ExecutionEvidence = { toolAttempted: false, ordinaryTextProduced: false };
  const attempt = (name: string): void => { evidence.toolAttempted = true; input.onEvent('tool.attempted', { name }); };
  rpc.on('host.request', attempt); // Count declined approvals and unsupported host actions before replying.
  const observeItem = (item: NativeItem | undefined, started = false): void => {
    if (!item?.type || !nonActionItems.has(item.type)) {
      const name = item?.tool ?? item?.name ?? item?.type ?? 'unknown'; attempt(name);
      if (started) input.onEvent('tool.started', { name });
    }
    if (item?.type === 'agentMessage' && item.text) evidence.ordinaryTextProduced = true;
  };
  let threadId = '', turnId = '', finished = false;
  const cancel = async (): Promise<void> => {
    if (threadId && turnId && !finished) await rpc.request('turn/interrupt', { threadId, turnId }, 5000).catch(() => undefined);
    rpc.close(); await rpc.exited;
  };
  const result = (async (): Promise<AgentResult> => {
    input.signal.addEventListener('abort', cancel, { once: true });
    try {
      input.signal.throwIfAborted(); await rpc.initialize();
      const account = await rpc.request<{ account?: unknown }>('account/read', { refreshToken: false });
      if (!account.account) throw new Error('Codex is not signed in. Connect Codex in Settings.');
      const current = await rpc.request<{ config: { mcp_servers?: Record<string, unknown>; plugins?: Record<string, unknown> } }>('config/read', { includeLayers: false, cwd: input.cwd });
      if (input.skills.length) await rpc.request('skills/extraRoots/set', { extraRoots: [input.nativeSkills.root + '/skills'] });
      const catalog = await rpc.request<{ data: { skills: { path: string }[] }[] }>('skills/list', { cwds: [input.cwd], forceReload: true });
      // A fresh name prevents inherited command/env fields from merging into our HTTP server.
      const serverName = 'nibbi_' + randomUUID().replaceAll('-', '');
      // RPC override paths do not interpret quoted TOML segments. Use nested
      // objects so names containing dots/quotes stay literal, and merge only the
      // enabled flag into inherited transports without changing the user's file.
      const servers: ObjectValue = Object.fromEntries(Object.keys(current.config.mcp_servers ?? {}).map(name => [name, { enabled: false }]));
      servers[serverName] = { url: input.tools.url, bearer_token_env_var: 'NIBBI_TOOL_TOKEN', required: true, enabled: true, enabled_tools: input.tools.names };
      const overrides: ObjectValue = {
        'skills.config': catalog.data.flatMap(entry => entry.skills.map(skill => ({ path: dirname(skill.path), enabled: input.nativeSkills.paths.includes(skill.path) }))),
        mcp_servers: servers,
        plugins: Object.fromEntries(Object.keys(current.config.plugins ?? {}).map(name => [name, { enabled: false }])),
        'shell_environment_policy.inherit': 'none', 'shell_environment_policy.set': {},
        'tools.view_image': false, 'web_search': 'disabled', 'notify': [],
      };
      const thread = await rpc.request<{ thread: { id: string } }>(input.sessionId ? 'thread/resume' : 'thread/start', {
        ...(input.sessionId ? { threadId: input.sessionId } : {}), cwd: input.cwd, model: input.model,
        approvalPolicy: 'never', sandbox: 'read-only', config: overrides, developerInstructions: input.instructions,
      });
      threadId = thread.thread.id;
      const out: AgentResult = { text: '', sessionId: threadId, isError: true, evidence };
      const terminal = new Promise<AgentResult>((resolve, reject) => {
        rpc.once('disconnected', reject);
        rpc.on('notification', (method: string, params: ObjectValue) => {
          if (finished || (params.threadId && params.threadId !== threadId) || (turnId && params.turnId && params.turnId !== turnId)) return;
          if (method === 'item/agentMessage/delta' && typeof params.delta === 'string' && params.delta) {
            evidence.ordinaryTextProduced = true; input.onEvent('text.delta', { text: params.delta });
          }
          const item = params.item as NativeItem | undefined;
          if (method === 'item/completed' || method === 'item/started') observeItem(item, method === 'item/started');
          if (method === 'item/completed' && item?.type === 'agentMessage') out.text += item.text ?? '';
          if (method === 'thread/tokenUsage/updated') { const usage = params.tokenUsage as { last?: { inputTokens?: number } }; out.ctxTokens = usage?.last?.inputTokens; }
          if (method === 'turn/completed') {
            const turn = params.turn as { id: string; status: string; error?: NativeTurnError; items?: NativeItem[] };
            if (turnId && turn.id !== turnId) return;
            turnId = turn.id; out.isError = turn.status !== 'completed';
            for (const completedItem of turn.items ?? []) observeItem(completedItem);
            // Exact native v2/CodexErrorInfo.ts discriminant. Not rateLimitExceeded,
            // sessionBudgetExceeded, HTTP 429, RPC numeric codes, or English messages.
            if (turn.status === 'failed' && turn.error?.codexErrorInfo === 'usageLimitExceeded') out.usageLimit = { kind: 'usage_limit', provider: 'codex' };
            if (turn.error) out.text += '\n' + turn.error.message;
            finished = true; resolve(out);
          }
        });
      });
      // Handle an early disconnect while turn/start is pending without an unhandled rejection.
      void terminal.catch(() => undefined);
      const turn = await rpc.request<{ turn: { id: string } }>('turn/start', { threadId,
        input: [{ type: 'text', text: input.prompt, text_elements: [] },
          ...input.skills.map((skill, index) => ({ type: 'skill', name: skill.name, path: input.nativeSkills.paths[index] })),
          ...(input.images ?? []).map(image => ({ type: 'image', url: `data:${image.media_type};base64,${image.data}` }))],
        sandboxPolicy: { type: 'readOnly', networkAccess: false },
      });
      turnId = turn.turn.id;
      const output = await terminal; input.signal.throwIfAborted(); return output;
    } finally { finished = true; input.signal.removeEventListener('abort', cancel); rpc.close(); await rpc.exited; }
  })().catch(error => { throw new ProviderTurnError(error instanceof Error ? error.message : String(error), { evidence, cause: error }); });
  return { result, cancel, steer: async text => {
    if (finished || !threadId || !turnId) throw new Error('Codex turn is not ready for steering');
    await rpc.request('turn/steer', { threadId, expectedTurnId: turnId, input: [{ type: 'text', text, text_elements: [] }] });
  } };
}
export const codex: AgentProvider = { id: 'codex', capabilities: { streaming: true, steering: true, cancellation: true, skills: true, tools: true, images: true }, start: startCodex };

import { query, type SDKUserMessage, type Query } from '@anthropic-ai/claude-agent-sdk';
import { prepareClaude, type ClaudeConnection } from './claude-auth.js';
import { policyFor, policyHook, type ToolScope } from '../policy.js';
import type { AgentProvider, AgentInput, AgentHandle, AgentResult, ExecutionEvidence, UsageLimit } from './types.js';
import { ProviderTurnError } from './failure.js';

export function startClaude(input: AgentInput, queryFactory: typeof query = query, connect: () => Promise<ClaudeConnection> = prepareClaude): AgentHandle {
  let active: Query | undefined, stopped = false;
  const evidence: ExecutionEvidence = { toolAttempted: false, ordinaryTextProduced: false };
  const attempt = (name: string): void => { evidence.toolAttempted = true; input.onEvent('tool.attempted', { name }); };
  let allowPrompt!: () => void;
  const authenticated = new Promise<void>(resolve => { allowPrompt = resolve; });
  const pending: SDKUserMessage[] = []; let wake: (() => void) | undefined;
  const user = (text: string, images = input.images): SDKUserMessage => ({ type: 'user', parent_tool_use_id: null, session_id: input.sessionId ?? '', message: { role: 'user', content: [
    ...(images ?? []).map(image => ({ type: 'image', source: { type: 'base64', media_type: image.media_type, data: image.data } })), { type: 'text', text },
  ] } }) as SDKUserMessage;
  async function* messages(): AsyncIterable<SDKUserMessage> {
    await authenticated;
    if (stopped) return;
    input.signal.throwIfAborted();
    yield user(input.prompt);
    while (!stopped) { while (pending.length) yield pending.shift()!; if (!stopped) await new Promise<void>(resolve => { wake = resolve; }); }
  }
  const cancel = async (): Promise<void> => {
    stopped = true; allowPrompt(); wake?.(); const handle = active; if (!handle) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([handle.interrupt().catch(() => undefined), new Promise<void>(resolve => { timer = setTimeout(resolve, 5000); })]); }
    finally { if (timer) clearTimeout(timer); handle.close(); }
  };
  const result = (async (): Promise<AgentResult> => {
    input.signal.throwIfAborted();
    const connection = await connect(); input.signal.throwIfAborted(); if (stopped) throw new Error('Claude turn cancelled');
    const scope: ToolScope = { role: input.role, cwd: input.cwd, readableRoots: [input.nativeSkills.root], writableRoots: [],
      tools: input.tools.names.map(name => `mcp__nibbi__${name}`), skillNames: input.skills.map(skill => `nibbi:${skill.name}`) };
    input.signal.addEventListener('abort', cancel, { once: true });
    const out: AgentResult = { text: '', isError: true, evidence };
    let terminal = false, quota: UsageLimit | undefined, otherAssistantError = false;
    const canUseTool = policyFor(scope), preTool = policyHook(scope);
    try {
      active = queryFactory({ prompt: messages(), options: {
        cwd: input.cwd, model: input.model, resume: input.sessionId, systemPrompt: input.instructions,
        pathToClaudeCodeExecutable: connection.executable,
        settings: connection.mode === 'signin' ? { forceLoginMethod: 'claudeai' } : undefined,
        settingSources: [], skills: scope.skillNames, plugins: input.skills.length ? [{ type: 'local', path: input.nativeSkills.root }] : [],
        tools: ['Skill', 'Read'],
        canUseTool: (...args) => { attempt(args[0]); return canUseTool(...args); },
        hooks: { PreToolUse: [{ hooks: [(...args) => { if (args[0].hook_event_name === 'PreToolUse') attempt(args[0].tool_name); return preTool(...args); }] }] },
        mcpServers: { nibbi: { type: 'http', url: input.tools.url, headers: { Authorization: `Bearer ${input.tools.token}` } } },
        env: connection.env,
        maxTurns: input.role === 'fixer' ? 80 : 30, includePartialMessages: true,
      } });
      if (connection.mode === 'signin') {
        // Check the actual agent process before releasing even the first prompt.
        // A stale or different CLI account must not silently become paid API use.
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const account = await Promise.race([active.accountInfo(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Claude account check timed out')), 10_000); })]);
          if (account.apiProvider !== 'firstParty' || (account.apiKeySource && account.apiKeySource !== 'none') || !account.subscriptionType || !/\b(pro|max|team|enterprise)\b/i.test(account.subscriptionType)) throw new Error('Claude Code is not using your Claude subscription. Sign in again; no prompt was sent.');
        } finally { if (timer) clearTimeout(timer); }
      }
      allowPrompt();
      for await (const message of active) {
        if (message.type === 'system' && message.subtype === 'init') out.sessionId = message.session_id;
        if ((message.type === 'system' && message.subtype === 'permission_denied') || message.type === 'tool_progress') attempt(message.tool_name);
        if (message.type === 'tool_use_summary' && message.preceding_tool_use_ids.length) attempt('tool');
        if (message.type === 'rate_limit_event') {
          const info = message.rate_limit_info;
          if (info.status === 'rejected') quota = { kind: 'usage_limit', provider: 'claude',
            ...(info.resetsAt && Number.isFinite(info.resetsAt) ? { resetAtMs: info.resetsAt < 1e12 ? info.resetsAt * 1000 : info.resetsAt } : {}) };
          else quota = undefined;
        }
        if (message.type === 'stream_event') {
          const event = message.event;
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta' && !message.parent_tool_use_id && event.delta.text) {
            // Partial events have no error tag. Once visible, never replace this text with local output.
            evidence.ordinaryTextProduced = true; input.onEvent('text.delta', { text: event.delta.text });
          }
          if (event.type === 'content_block_start' && (event.content_block.type === 'tool_use' || event.content_block.type === 'server_tool_use' || event.content_block.type === 'mcp_tool_use')) {
            attempt(event.content_block.name);
            if (!message.parent_tool_use_id) input.onEvent('tool.started', { name: event.content_block.name });
          }
        }
        if (message.type === 'assistant') {
          if (!message.parent_tool_use_id && message.error === 'rate_limit') quota = { kind: 'usage_limit', provider: 'claude', ...(quota?.resetAtMs ? { resetAtMs: quota.resetAtMs } : {}) };
          else if (!message.parent_tool_use_id && message.error) otherAssistantError = true;
          for (const block of message.message.content) {
            if (block.type === 'tool_use' || block.type === 'server_tool_use' || block.type === 'mcp_tool_use') attempt(block.name);
            if (block.type === 'text') {
              if (!message.error && block.text) evidence.ordinaryTextProduced = true;
              out.text += block.text; // Diagnostics remain terminal error text, never new deltas.
            }
          }
        }
        if (message.type === 'result') {
          terminal = true; out.isError = message.is_error; out.costUsd = connection.mode === 'api-key' ? message.total_cost_usd : undefined; out.sessionId = message.session_id;
          out.ctxTokens = (message.usage.input_tokens ?? 0) + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0);
          if (message.is_error && message.subtype === 'error_during_execution' && quota && !otherAssistantError) out.usageLimit = quota;
          if (message.is_error && 'errors' in message) out.text += '\n' + message.errors.join('\n');
          stopped = true; wake?.(); break;
        }
      }
      input.signal.throwIfAborted();
      if (!terminal) throw new Error('Claude ended without a terminal result; work has been preserved');
      return out;
    } finally { stopped = true; allowPrompt(); wake?.(); active?.close(); input.signal.removeEventListener('abort', cancel); }
  })().catch(error => { throw new ProviderTurnError(error instanceof Error ? error.message : String(error), { evidence, cause: error }); });
  return { result, cancel, steer: async text => { if (stopped) throw new Error('Run is no longer steerable'); pending.push(user('[STEER] ' + text, [])); wake?.(); } };
}
export const claude: AgentProvider = { id: 'claude', capabilities: { streaming: true, steering: true, cancellation: true, skills: true, tools: true, images: true }, start: startClaude };

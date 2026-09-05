import { query, type SDKUserMessage, type Query } from '@anthropic-ai/claude-agent-sdk';
import { prepareClaude, type ClaudeConnection } from './claude-auth.js';
import { policyFor, policyHook, type ToolScope } from '../policy.js';
import type { AgentProvider, AgentInput, AgentHandle, AgentResult } from './types.js';

export function startClaude(input: AgentInput, queryFactory: typeof query = query, connect: () => Promise<ClaudeConnection> = prepareClaude): AgentHandle {
  let active: Query | undefined, stopped = false;
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
    const out: AgentResult = { text: '', isError: true };
    let terminal = false;
    try {
      active = queryFactory({ prompt: messages(), options: {
        cwd: input.cwd, model: input.model, resume: input.sessionId, systemPrompt: input.instructions,
        pathToClaudeCodeExecutable: connection.executable,
        settings: connection.mode === 'signin' ? { forceLoginMethod: 'claudeai' } : undefined,
        settingSources: [], skills: scope.skillNames, plugins: input.skills.length ? [{ type: 'local', path: input.nativeSkills.root }] : [],
        tools: ['Skill', 'Read'], canUseTool: policyFor(scope), hooks: { PreToolUse: [{ hooks: [policyHook(scope)] }] },
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
        if (message.type === 'stream_event' && !message.parent_tool_use_id) {
          const event = message.event;
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') input.onEvent('text.delta', { text: event.delta.text });
          if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') input.onEvent('tool.started', { name: event.content_block.name });
        }
        if (message.type === 'assistant') for (const block of message.message.content) if (block.type === 'text') out.text += block.text;
        if (message.type === 'result') {
          terminal = true; out.isError = message.is_error; out.costUsd = connection.mode === 'api-key' ? message.total_cost_usd : undefined; out.sessionId = message.session_id;
          out.ctxTokens = (message.usage.input_tokens ?? 0) + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0);
          if (message.is_error && 'errors' in message) out.text += '\n' + message.errors.join('\n');
          stopped = true; wake?.(); break;
        }
      }
      input.signal.throwIfAborted();
      if (!terminal) throw new Error('Claude ended without a terminal result; work has been preserved');
      return out;
    } finally { stopped = true; allowPrompt(); wake?.(); active?.close(); input.signal.removeEventListener('abort', cancel); }
  })();
  return { result, cancel, steer: async text => { if (stopped) throw new Error('Run is no longer steerable'); pending.push(user('[STEER] ' + text, [])); wake?.(); } };
}
export const claude: AgentProvider = { id: 'claude', capabilities: { streaming: true, steering: true, cancellation: true, skills: true, tools: true, images: true }, start: startClaude };

import type { AgentHandle, AgentResult } from './types.js';

class LocalChatError extends Error {}
export const DEFAULT_LOCAL_MODEL = 'llama3.2:1b';

export interface LocalChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface LocalChatInput {
  messages: LocalChatMessage[]; signal: AbortSignal; onDelta?: (text: string) => void; model?: string;
}
export interface LocalChatDependencies {
  fetch?: typeof globalThis.fetch;
  /** Tests may use a literal loopback HTTP server, never a remote host. */
  endpoint?: string;
  /** Tests may shorten, but cannot extend, the deadline. */
  deadlineMs?: number;
}
export type LocalChatResult = AgentResult & { localModel: string };
export type LocalChatHandle = Omit<AgentHandle, 'result'> & { result: Promise<LocalChatResult> };
export const LOCAL_CHAT_LIMITS = Object.freeze({ requestBytes: 262144, frameBytes: 65536, outputBytes: 131072, streamBytes: 2097152, deadlineMs: 90000 });

/** Stateless, bounded Ollama chat. No provider sessions, credentials, tools, images or retries. */
export function startLocalChat(input: LocalChatInput, dependencies: LocalChatDependencies = {}): LocalChatHandle {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let finished = false;
  let rejectAbort!: (error: Error) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  // A pre-aborted input must not cause an unhandled rejection before the first wait.
  void aborted.catch(() => undefined);
  const stop = (message: string) => {
    if (finished || controller.signal.aborted) return;
    controller.abort();
    rejectAbort(new LocalChatError(message));
    void reader?.cancel().catch(() => undefined);
  };
  const cancel = async () => { stop('Local chat cancelled'); };
  const onAbort = () => { stop('Local chat cancelled'); };
  input.signal.addEventListener('abort', onAbort, { once: true });
  if (input.signal.aborted) onAbort();
  let expiresAt = Infinity;
  const check = () => {
    if (Date.now() >= expiresAt) { stop('Local chat timed out'); throw new LocalChatError('Local chat timed out'); }
    if (controller.signal.aborted) throw new LocalChatError('Local chat cancelled');
  };
  const wait = <T>(pending: Promise<T>) => Promise.race([pending, aborted]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = (async (): Promise<LocalChatResult> => {
    try {
      check();
      const endpoint = new URL(dependencies.endpoint ?? 'http://127.0.0.1:11434/api/chat');
      if (endpoint.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(endpoint.hostname) || endpoint.username || endpoint.password || endpoint.pathname !== '/api/chat' || endpoint.search || endpoint.hash) {
        throw new LocalChatError('Local chat requires a literal loopback HTTP /api/chat endpoint');
      }
      const deadline = dependencies.deadlineMs ?? LOCAL_CHAT_LIMITS.deadlineMs;
      if (!Number.isFinite(deadline) || deadline <= 0 || deadline > LOCAL_CHAT_LIMITS.deadlineMs) throw new LocalChatError('Invalid local chat deadline');
      expiresAt = Date.now() + deadline;
      timer = setTimeout(() => stop('Local chat timed out'), deadline);
      const model = input.model ?? DEFAULT_LOCAL_MODEL;
      if (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(model)) throw new LocalChatError('Invalid local model');
      if (!Array.isArray(input.messages) || input.messages.length > 1024) throw new LocalChatError('Invalid local chat messages');
      let contentBytes = 0;
      const messages = input.messages.map(message => {
        if (!message || !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string') throw new LocalChatError('Invalid local chat message');
        contentBytes += Buffer.byteLength(message.content);
        if (contentBytes > LOCAL_CHAT_LIMITS.requestBytes) throw new LocalChatError('Local chat request too large');
        return { role: message.role, content: message.content };
      });
      const body = JSON.stringify({ model, messages, stream: true, options: { num_predict: 768, num_ctx: 16384 } });
      if (Buffer.byteLength(body) > LOCAL_CHAT_LIMITS.requestBytes) throw new LocalChatError('Local chat request too large');
      const pendingResponse = (dependencies.fetch ?? globalThis.fetch)(endpoint.toString(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
        signal: controller.signal, redirect: 'error', credentials: 'omit',
      });
      // Even a test transport that ignores abort must dispose of a late response.
      void pendingResponse.then(response => { if (controller.signal.aborted) void response.body?.cancel().catch(() => undefined); }, () => undefined);
      const response = await wait(pendingResponse);
      check();
      if (!response.ok || !response.body) {
        void response.body?.cancel().catch(() => undefined);
        throw new LocalChatError('Local chat HTTP response failed');
      }
      reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let pending = Buffer.alloc(0);
      let streamBytes = 0;
      let outputBytes = 0;
      let text = '';
      let terminal = false;
      let localModel: string | undefined;
      let ctxTokens: number | undefined;
      const frame = (bytes: Uint8Array) => {
        check();
        if (bytes.byteLength > LOCAL_CHAT_LIMITS.frameBytes) throw new LocalChatError('Local chat frame too large');
        const line = decoder.decode(bytes).trim();
        if (!line) return;
        const value: unknown = JSON.parse(line);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LocalChatError('Invalid local chat frame');
        const data = value as Record<string, unknown>;
        if ('error' in data) throw new LocalChatError('Local model reported an error');
        if (typeof data.model !== 'string' || !data.model || data.model !== model) throw new LocalChatError('Local response model missing or mismatched');
        localModel = data.model;
        if (typeof data.done !== 'boolean') throw new LocalChatError('Invalid local chat terminal flag');
        const message = data.message;
        if (!message || typeof message !== 'object' || Array.isArray(message)) throw new LocalChatError('Invalid local chat response message');
        const msg = message as Record<string, unknown>;
        if ('tool_calls' in msg || 'tool_calls' in data) throw new LocalChatError('Local chat does not accept tool calls');
        if ('images' in msg || msg.role !== 'assistant' || typeof msg.content !== 'string') throw new LocalChatError('Invalid local chat response message');
        outputBytes += Buffer.byteLength(msg.content);
        if (outputBytes > LOCAL_CHAT_LIMITS.outputBytes) throw new LocalChatError('Local chat output too large');
        text += msg.content;
        if (msg.content) input.onDelta?.(msg.content);
        check();
        if (data.done) {
          terminal = true;
          if (data.prompt_eval_count !== undefined) {
            if (!Number.isSafeInteger(data.prompt_eval_count) || (data.prompt_eval_count as number) < 0) throw new LocalChatError('Invalid local input token count');
            ctxTokens = data.prompt_eval_count as number;
          }
        }
      };
      while (!terminal) {
        const chunk = await wait(reader.read());
        check();
        if (chunk.done) {
          if (pending.length) frame(pending);
          break;
        }
        streamBytes += chunk.value.byteLength;
        if (streamBytes > LOCAL_CHAT_LIMITS.streamBytes) throw new LocalChatError('Local chat stream too large');
        pending = Buffer.concat([pending, chunk.value]);
        let newline: number;
        while (!terminal && (newline = pending.indexOf(10)) !== -1) {
          frame(pending.subarray(0, newline));
          pending = pending.subarray(newline + 1);
        }
        if (!terminal && pending.length > LOCAL_CHAT_LIMITS.frameBytes) throw new LocalChatError('Local chat frame too large');
      }
      check();
      if (!terminal || !localModel) throw new LocalChatError('Local chat ended without a terminal result');
      return { text, isError: false, costUsd: 0, localModel, ...(ctxTokens === undefined ? {} : { ctxTokens }) };
    } catch (error) {
      // Never surface arbitrary transport/provider text, which can contain prompt data.
      const message = error instanceof LocalChatError
        ? error.message.slice(0, 160) : 'Local chat request failed';
      throw new LocalChatError(message);
    } finally {
      finished = true;
      if (timer) clearTimeout(timer);
      input.signal.removeEventListener('abort', onAbort);
      controller.abort();
      void reader?.cancel().catch(() => undefined);
    }
  })();
  return { result, cancel, steer: async () => { throw new LocalChatError('Local chat is chat-only; steering is not supported'); } };
}

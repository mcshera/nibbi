import { createHash } from 'node:crypto';

// These limits match startLocalChat. Never enlarge num_ctx to make a prompt fit.
export const LOCAL_CONTEXT_LIMITS = Object.freeze({ context: 16384, output: 768, metadataBytes: 16 * 1024 * 1024, deadlineMs: 5000, inputBytes: 262144, operations: 8_000_000 });
const TEMPLATE_SHA256 = '966de95ca8a62200913e3f8bfbf84c8494536f1b94b49166851e76644e966396';
const TOKENS_SHA256 = '0f3cab236f171e01df820c63ad1ec87c92d2b8ef32f918617db43a94c6374e87';
const MERGES_SHA256 = '7e044c6780c3b2034a38f6bce8e7b2b2e8378132358d26d056200f00c22258f6';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const fail = (reason: string): never => { throw new Error(`Local context budget: ${reason}. No request was sent for generation.`); };
export interface LocalBudgetDependencies { fetch?: typeof globalThis.fetch; deadlineMs?: number }

// Llama 3 (llama-bpe) pretokenizer. Case folding is restricted to contractions.
const PRETOKENIZER = /'[sStTmMdD]|'(?:[rR][eE]|[vV][eE]|[lL][lL])|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu;

/** A testable primitive, not an authorization bypass. Production pins all merge data.
 * Non-ASCII pieces and boundary pieces use UTF-8 bytes, not a token estimate.
 * ASCII interior pieces use the ranked, leftmost-tie byte-level BPE algorithm.
 */
export function countLlama3TextUpperBound(text: string, ranks: ReadonlyMap<string, number>, check: () => void = () => {}, spend: (n: number) => void = () => {}): number {
  // Limit Unicode to old, stable categories and ASCII whitespace. New Unicode
  // assignments and JS/llama.cpp whitespace differences must not affect splitting.
  // The five explicitly allowed symbols are old Unicode Sm (2192/2264/2265)
  // or So (2705/2713), never letters, numbers or whitespace. Thus they follow
  // the same punctuation/symbol branch in llama.cpp and JS; their full pieces
  // still use byte bounds. Do not generalize this to arbitrary new Unicode.
  if (/[^\u0000-\u007f\u00a1-\u00ff\u2010-\u2027\u2192\u2264\u2265\u2705\u2713]/u.test(text)) return Buffer.byteLength(text);
  const pieces = Array.from(text.matchAll(new RegExp(PRETOKENIZER.source, 'gu')), match => match[0]);
  if (pieces.join('') !== text) return fail('unsupported pretokenizer input');
  let total = 0;
  for (let i = 0; i < pieces.length; i++) {
    check();
    const piece = pieces[i];
    if (i === 0 || i === pieces.length - 1 || /[^\x00-\x7f]/.test(piece)) { total += Buffer.byteLength(piece); continue; }
    // Bounding each piece also bounds quadratic work and temporary strings.
    if (piece.length > 4096) return fail('tokenizer piece exceeds CPU safety limit');
    const parts = Array.from(Buffer.from(piece), byte => byte >= 33 && byte <= 126 ? String.fromCharCode(byte) : String.fromCharCode(byte === 127 ? 289 : 256 + byte));
    while (parts.length > 1) {
      check(); spend(parts.length - 1);
      let best = Infinity; let at = -1;
      for (let j = 0; j < parts.length - 1; j++) {
        const rank = ranks.get(`${parts[j]} ${parts[j + 1]}`);
        if (rank !== undefined && rank < best) { best = rank; at = j; }
      }
      if (at < 0) break;
      parts.splice(at, 2, parts[at] + parts[at + 1]);
    }
    total += parts.length;
  }
  return total;
}

/** Validate the installed stock model before even the byte-bound fast path.
 * The only network request is bounded POST /api/show on literal loopback.
 * Both named 1b/3b sizes must match the same verified tokenizer/template pins.
 * No tools, template override, inherited SYSTEM, or model alias is supported.
 */
export async function assertLocalContextFits(messages: { role: string; content: string }[], model: string, signal: AbortSignal, dependencies: LocalBudgetDependencies = {}): Promise<void> {
  if (signal.aborted) return fail('cancelled');
  if (!['llama3.2:1b', 'llama3.2:3b'].includes(model)) return fail('only verified llama3.2:1b and llama3.2:3b models are supported');
  if (!Array.isArray(messages) || messages.length < 2 || messages.length > 1024 || messages[0]?.role !== 'system' || messages.at(-1)?.role !== 'user') return fail('expected canonical system context and a final user request');
  let bytes = 0;
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (!message || typeof message.content !== 'string' || (i > 0 && !['user', 'assistant'].includes(message.role))) return fail('unsupported message sequence');
    if (message.content.includes('<|')) return fail('special-token syntax in message content is unsupported');
    bytes += Buffer.byteLength(message.content);
    if (bytes > LOCAL_CONTEXT_LIMITS.inputBytes) return fail('input exceeds bounded tokenizer size');
  }
  // Covers BOS, stock knowledge-date text, role headers, EOTs, assistant prefix,
  // and whitespace. Content edge pieces remain byte-counted to avoid a boundary
  // merge or pretokenizer interaction making separate content counts unsafe.
  const framing = 256 + messages.length * 64;
  const available = LOCAL_CONTEXT_LIMITS.context - LOCAL_CONTEXT_LIMITS.output;
  const deadline = dependencies.deadlineMs ?? LOCAL_CONTEXT_LIMITS.deadlineMs;
  if (!Number.isFinite(deadline) || deadline <= 0 || deadline > LOCAL_CONTEXT_LIMITS.deadlineMs) return fail('invalid metadata deadline');
  const controller = new AbortController();
  const expires = Date.now() + deadline;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let rejectAbort!: (error: Error) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  void aborted.catch(() => {});
  const stop = () => { controller.abort(); rejectAbort(new Error('Local context budget: metadata cancelled or timed out; no generation sent.')); void reader?.cancel().catch(() => {}); };
  signal.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(stop, deadline);
  const check = () => { if (signal.aborted || controller.signal.aborted || Date.now() >= expires) return fail('metadata/tokenizer cancelled or timed out'); };
  const wait = <T>(pending: Promise<T>) => Promise.race([pending, aborted]);
  try {
    check();
    const pendingResponse = (dependencies.fetch ?? globalThis.fetch)('http://127.0.0.1:11434/api/show', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, verbose: true }),
      signal: controller.signal, redirect: 'error', credentials: 'omit',
    });
    // A fake/nonconforming transport can resolve after our abort race rejects.
    // Dispose that late body too; do not retain a connection or unread stream.
    void pendingResponse.then(response => {
      if (controller.signal.aborted) void response.body?.cancel().catch(() => {});
    }, () => {});
    const response = await wait(pendingResponse);
    if (response.body) reader = response.body.getReader();
    if (!response.ok || !reader) return fail('model metadata unavailable');
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      check();
      const item = await wait(reader.read());
      if (item.done) break;
      size += item.value.byteLength;
      if (size > LOCAL_CONTEXT_LIMITS.metadataBytes) return fail('model metadata exceeds response limit');
      chunks.push(item.value);
    }
    check();
    const metadata = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    const info = metadata.model_info as Record<string, unknown> | undefined;
    if (!info || metadata.system || typeof metadata.template !== 'string' || digest(metadata.template) !== TEMPLATE_SHA256 ||
        info['general.architecture'] !== 'llama' || info['tokenizer.ggml.model'] !== 'gpt2' || info['tokenizer.ggml.pre'] !== 'llama-bpe' ||
        info['tokenizer.ggml.bos_token_id'] !== 128000 || info['tokenizer.ggml.eos_token_id'] !== 128009 ||
        typeof info['llama.context_length'] !== 'number' || info['llama.context_length'] < LOCAL_CONTEXT_LIMITS.context ||
        (info['tokenizer.ggml.add_bos_token'] !== undefined && info['tokenizer.ggml.add_bos_token'] !== true) ||
        (info['tokenizer.ggml.add_eos_token'] !== undefined && info['tokenizer.ggml.add_eos_token'] !== false)) return fail('unsupported model metadata, inherited system, or custom template');
    const tokenizerKeys = new Set(['tokenizer.ggml.model', 'tokenizer.ggml.pre', 'tokenizer.ggml.bos_token_id', 'tokenizer.ggml.eos_token_id', 'tokenizer.ggml.tokens', 'tokenizer.ggml.merges', 'tokenizer.ggml.token_type', 'tokenizer.ggml.add_bos_token', 'tokenizer.ggml.add_eos_token']);
    if (Object.keys(info).some(key => key.startsWith('tokenizer.') && !tokenizerKeys.has(key))) return fail('unsupported tokenizer options');
    // Refuse hidden model-level parameters and embedded messages.
    const parameters = metadata.parameters;
    // Authorized stock 1b /api/show omits the key entirely; 3b supplies stops.
    // A null/empty/custom value is not the independently verified 1b shape.
    const supportedParameters = model === 'llama3.2:1b'
      ? !Object.hasOwn(metadata, 'parameters')
      : typeof parameters === 'string' && !parameters.trim().split('\n').some(line => !/^stop\s+"<\|(?:start_header_id|end_header_id|eot_id)\|>"$/.test(line.trim()));
    if (!supportedParameters ||
        (metadata.messages !== undefined && (!Array.isArray(metadata.messages) || metadata.messages.length !== 0))) return fail('unsupported model parameters or embedded messages');
    const tokens = info['tokenizer.ggml.tokens']; const merges = info['tokenizer.ggml.merges']; const types = info['tokenizer.ggml.token_type'];
    if (!Array.isArray(tokens) || tokens.length !== 128256 || !Array.isArray(merges) || merges.length !== 280147 ||
        !Array.isArray(types) || types.length !== 128256 || types.some((type, i) => type !== (i < 128000 ? 1 : 3)) ||
        digest(JSON.stringify(tokens)) !== TOKENS_SHA256 || digest(JSON.stringify(merges)) !== MERGES_SHA256) return fail('unsupported tokenizer vocabulary or merges');
    check();
    if (bytes + framing <= available) return;
    const ranks = new Map<string, number>();
    for (let i = 0; i < merges.length; i++) { if ((i & 4095) === 0) check(); if (!ranks.has(merges[i])) ranks.set(merges[i], i); }
    let operations = 0;
    const spend = (n: number) => { operations += n; if (operations > LOCAL_CONTEXT_LIMITS.operations) return fail('tokenizer CPU safety limit exceeded'); };
    let count = framing;
    for (const message of messages) {
      count += countLlama3TextUpperBound(message.content, ranks, check, spend);
      if (count > available) return fail(`full input cannot fit safely in ${LOCAL_CONTEXT_LIMITS.context} tokens with ${LOCAL_CONTEXT_LIMITS.output} reserved for output`);
    }
    check();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Local context budget:')) throw error;
    return fail('could not safely validate local tokenizer metadata');
  } finally {
    clearTimeout(timer); signal.removeEventListener('abort', stop); controller.abort();
    void reader?.cancel().catch(() => {});
  }
}

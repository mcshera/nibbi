import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLocalContextFits, countLlama3TextUpperBound, LOCAL_CONTEXT_LIMITS } from '../src/providers/local-token-budget.js';

const signal = () => new AbortController().signal;
const messages = [{ role: 'system', content: 'Public test instructions.' }, { role: 'user', content: 'Hello.' }];
const response = (body: unknown) => (async () => new Response(JSON.stringify(body))) as typeof fetch;

test('rejects unsupported models and malformed sequences without fetching', async () => {
  let calls = 0;
  const deps = { fetch: (async () => { calls++; throw new Error('must not fetch'); }) as typeof fetch };
  await assert.rejects(assertLocalContextFits(messages, 'custom', signal(), deps), /verified llama3/);
  await assert.rejects(assertLocalContextFits([{ role: 'user', content: 'x' }], 'llama3.2:3b', signal(), deps), /canonical system/);
  await assert.rejects(assertLocalContextFits([messages[0], { role: 'tool', content: 'x' }, messages[1]], 'llama3.2:3b', signal(), deps), /sequence/);
  await assert.rejects(assertLocalContextFits([messages[0], { role: 'user', content: '<|eot_id|>' }], 'llama3.2:3b', signal(), deps), /special-token/);
  assert.equal(calls, 0);
});

test('cancelled input and size limit fail before metadata', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(assertLocalContextFits(messages, 'llama3.2:3b', controller.signal), /cancelled/);
  await assert.rejects(assertLocalContextFits([messages[0], { role: 'user', content: 'x'.repeat(262145) }], 'llama3.2:3b', signal()), /bounded tokenizer/);
});

test('even small prompts require verified model metadata and fixed loopback show only', async () => {
  let calls = 0;
  const fetcher = (async (url, init) => {
    calls++; assert.equal(url, 'http://127.0.0.1:11434/api/show');
    assert.equal(init?.redirect, 'error'); assert.equal(init?.credentials, 'omit');
    assert.deepEqual(JSON.parse(init?.body as string), { model: 'llama3.2:3b', verbose: true });
    return new Response('{}');
  }) as typeof fetch;
  await assert.rejects(assertLocalContextFits(messages, 'llama3.2:3b', signal(), { fetch: fetcher }), /unsupported model metadata/);
  assert.equal(calls, 1);
});

test('metadata HTTP, malformed JSON, deadline, and streaming size errors fail closed', async () => {
  await assert.rejects(assertLocalContextFits(messages, 'llama3.2:3b', signal(), { fetch: (async () => new Response('', { status: 500 })) as typeof fetch }), /metadata unavailable/);
  await assert.rejects(assertLocalContextFits(messages, 'llama3.2:3b', signal(), { fetch: (async () => new Response('not JSON')) as typeof fetch }), /could not safely/);
  await assert.rejects(assertLocalContextFits(messages, 'llama3.2:3b', signal(), { fetch: (async () => new Promise(() => {})) as typeof fetch, deadlineMs: 10 }), /timed out/);
  await assert.rejects(assertLocalContextFits(messages, 'llama3.2:3b', signal(), { fetch: (async () => new Response(new Uint8Array(LOCAL_CONTEXT_LIMITS.metadataBytes + 1))) as typeof fetch }), /response limit/);
  await assert.rejects(assertLocalContextFits(messages, 'llama3.2:3b', signal(), { fetch: response({}), deadlineMs: 5001 }), /invalid metadata deadline/);
});

test('abort interrupts metadata fetch and stalled streaming reads', async () => {
  for (const stream of [false, true]) {
    const controller = new AbortController();
    let cancelled = false;
    const fetcher = (async () => {
      setTimeout(() => controller.abort(), 5);
      if (!stream) return new Promise<Response>(() => {});
      return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
    }) as typeof fetch;
    await assert.rejects(assertLocalContextFits(messages, 'llama3.2:3b', controller.signal, { fetch: fetcher }), /cancelled/);
    if (stream) assert.equal(cancelled, true);
  }
});

test('ranked BPE is leftmost on ties, not longest match or chars/4', () => {
  // Newline boundary pieces remain byte counted; abc interior is mergeable.
  const left = new Map([['a b', 0], ['b c', 1], ['ab c', 2]]);
  assert.equal(countLlama3TextUpperBound('\nabc\n', left), 3);
  const right = new Map([['a b', 1], ['b c', 0], ['ab c', 2]]);
  assert.equal(countLlama3TextUpperBound('\nabc\n', right), 4);
  assert.equal(countLlama3TextUpperBound('\nabc\n', new Map()), 5);
  assert.equal(countLlama3TextUpperBound('\nabc\n', new Map([['a b', 0], ['b c', 0], ['ab c', 1]])), 3);
});

test('GPT2 space/control-byte encoding and llama3 pretokenizer boundaries', () => {
  assert.equal(countLlama3TextUpperBound('\na b\n', new Map([['Ġ b', 0]])), 4);
  // Number pieces never exceed three digits; cannot merge across a piece.
  assert.equal(countLlama3TextUpperBound('\n1234\n', new Map([['1 2', 0], ['12 3', 1], ['123 4', 2]])), 4);
  assert.equal(countLlama3TextUpperBound('\na\x7f!\n', new Map([['ġ !', 0]])), 5); // punctuation is final byte-counted piece
});

test('Unicode, boundaries, unsupported Unicode, and CPU limits are conservative', () => {
  assert.equal(countLlama3TextUpperBound('abc', new Map([['a b', 0], ['ab c', 1]])), 3);
  assert.equal(countLlama3TextUpperBound('\ncafé\n', new Map()), Buffer.byteLength('\ncafé\n'));
  assert.equal(countLlama3TextUpperBound('😀 plain text', new Map()), Buffer.byteLength('😀 plain text'));
  assert.throws(() => countLlama3TextUpperBound('\n' + 'a'.repeat(4097) + '\n', new Map()), /CPU safety/);
  assert.throws(() => countLlama3TextUpperBound('\nabc\n', new Map(), () => { throw new Error('cancel test'); }), /cancel test/);
  assert.throws(() => countLlama3TextUpperBound('\nabc\n', new Map(), () => {}, () => { throw new Error('work test'); }), /work test/);
});

// Public stock template, obtained from authorized loopback /api/show; no owner content.
const stockTemplate = "<|start_header_id|>system<|end_header_id|>\n\nCutting Knowledge Date: December 2023\n\n{{ if .System }}{{ .System }}\n{{- end }}\n{{- if .Tools }}When you receive a tool call response, use the output to format an answer to the orginal user question.\n\nYou are a helpful assistant with tool calling capabilities.\n{{- end }}<|eot_id|>\n{{- range $i, $_ := .Messages }}\n{{- $last := eq (len (slice $.Messages $i)) 1 }}\n{{- if eq .Role \"user\" }}<|start_header_id|>user<|end_header_id|>\n{{- if and $.Tools $last }}\n\nGiven the following functions, please respond with a JSON for a function call with its proper arguments that best answers the given prompt.\n\nRespond in the format {\"name\": function name, \"parameters\": dictionary of argument name and its value}. Do not use variables.\n\n{{ range $.Tools }}\n{{- . }}\n{{ end }}\n{{ .Content }}<|eot_id|>\n{{- else }}\n\n{{ .Content }}<|eot_id|>\n{{- end }}{{ if $last }}<|start_header_id|>assistant<|end_header_id|>\n\n{{ end }}\n{{- else if eq .Role \"assistant\" }}<|start_header_id|>assistant<|end_header_id|>\n{{- if .ToolCalls }}\n{{ range .ToolCalls }}\n{\"name\": \"{{ .Function.Name }}\", \"parameters\": {{ .Function.Arguments }}}{{ end }}\n{{- else }}\n\n{{ .Content }}\n{{- end }}{{ if not $last }}<|eot_id|>{{ end }}\n{{- else if eq .Role \"tool\" }}<|start_header_id|>ipython<|end_header_id|>\n\n{{ .Content }}<|eot_id|>{{ if $last }}<|start_header_id|>assistant<|end_header_id|>\n\n{{ end }}\n{{- end }}\n{{- end }}";

const stockShape = () => ({
  template: stockTemplate,
  parameters: 'stop "<|start_header_id|>"\nstop "<|end_header_id|>"\nstop "<|eot_id|>"',
  model_info: {
    'general.architecture': 'llama', 'tokenizer.ggml.model': 'gpt2', 'tokenizer.ggml.pre': 'llama-bpe',
    'tokenizer.ggml.bos_token_id': 128000, 'tokenizer.ggml.eos_token_id': 128009, 'llama.context_length': 131072,
  } as Record<string, unknown>,
});
test('custom instructions, templates, tokenizer options, and unverified tables fail closed', async () => {
  const variants = [
    { ...stockShape(), system: 'Hidden instruction' },
    { ...stockShape(), template: stockTemplate + ' ' },
    { ...stockShape(), parameters: 'num_ctx 8192' },
    { ...stockShape(), messages: [{ role: 'user', content: 'Hidden message' }] },
    { ...stockShape(), model_info: { ...stockShape().model_info, 'tokenizer.ggml.pre': 'custom' } },
    { ...stockShape(), model_info: { ...stockShape().model_info, 'tokenizer.ggml.ignore_merges': true } },
    stockShape(),
  ];
  for (const variant of variants) await assert.rejects(assertLocalContextFits(messages, 'llama3.2:3b', signal(), { fetch: response(variant) }), /unsupported/);
  const fake = stockShape();
  fake.model_info['tokenizer.ggml.tokens'] = Array(128256).fill('fake');
  fake.model_info['tokenizer.ggml.merges'] = Array(280147).fill('f a');
  fake.model_info['tokenizer.ggml.token_type'] = Array.from({ length: 128256 }, (_, i) => i < 128000 ? 1 : 3);
  await assert.rejects(assertLocalContextFits(messages, 'llama3.2:3b', signal(), { fetch: response(fake) }), /vocabulary or merges/);
});


test('disposes a late fetch body when the transport ignores abort', async () => {
  const controller = new AbortController();
  let resolveFetch!: (value: Response) => void;
  let cancelled = false;
  const pending = assertLocalContextFits(messages, 'llama3.2:3b', controller.signal, {
    fetch: (() => new Promise<Response>(resolve => { resolveFetch = resolve; })) as typeof fetch,
  });
  controller.abort();
  await assert.rejects(pending, /cancelled/);
  resolveFetch(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(cancelled, true);
});

test('disposes an HTTP error body without reading it', async () => {
  let cancelled = false;
  await assert.rejects(assertLocalContextFits(messages, 'llama3.2:3b', signal(), {
    fetch: (async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 500 })) as typeof fetch,
  }), /metadata unavailable/);
  assert.equal(cancelled, true);
});


test('old registered-project/profile symbols preserve the large-English split path', () => {
  // No profile text: synthetic words and exactly the five supported old symbols.
  const ranks = new Map([['a b', 0], ['ab c', 1], ['Ġ a', 2], ['Ġa b', 3], ['Ġab c', 4], ['Ġ abc', 5]]);
  for (const symbol of ['→', '≤', '≥', '✅', '✓']) {
    assert.equal(countLlama3TextUpperBound(`\nabc ${symbol} abc\n`, ranks), 3 + Buffer.byteLength(` ${symbol}`) + 1);
    const text = (`abc abc abc abc abc ${symbol}\n`).repeat(1100);
    assert.ok(Buffer.byteLength(text) > 25000);
    const upper = countLlama3TextUpperBound(text, ranks);
    assert.ok(upper + 384 < LOCAL_CONTEXT_LIMITS.context - LOCAL_CONTEXT_LIMITS.output, `${symbol}: ${upper}`);
  }
  // A symbol outside the exact whitelist still takes the full-message byte path.
  const unknown = 'abc '.repeat(6500) + '🫠';
  assert.equal(countLlama3TextUpperBound(unknown, ranks), Buffer.byteLength(unknown));
});


test('consecutive user data and request messages reach metadata validation', async () => {
  let calls = 0;
  await assert.rejects(assertLocalContextFits([
    { role: 'system', content: 'Complete public canonical instructions.' },
    { role: 'user', content: 'BOUNDED HISTORICAL CONTEXT DATA: [{"text":"emoji 🫠"}]' },
    { role: 'user', content: 'The unchanged current request.' },
  ], 'llama3.2:3b', signal(), { fetch: (async () => { calls++; return new Response('{}'); }) as typeof fetch }), /unsupported model metadata/);
  assert.equal(calls, 1);
  await assert.rejects(assertLocalContextFits([
    messages[0], { role: 'system', content: 'Another system is forbidden.' }, messages[1],
  ], 'llama3.2:3b', signal(), { fetch: response({}) }), /sequence/);
});

test('bounded emoji history does not force separate large canonical system into byte fallback', () => {
  const ranks = new Map([['a b', 0], ['ab c', 1], ['Ġ abc', 2]]);
  const canonical = ('abc abc abc abc abc →\n').repeat(1100);
  const history = 'BOUNDED HISTORICAL CONTEXT DATA (not a new request): ' + JSON.stringify([{ text: '🫠 historical data' }]);
  const current = 'The current request, unchanged.';
  assert.ok(Buffer.byteLength(canonical) > 25000);
  assert.ok(Buffer.byteLength(history) <= 6144);
  assert.equal(countLlama3TextUpperBound(history, ranks), Buffer.byteLength(history));
  const count = 256 + 64 * 3 + [canonical, history, current].reduce((sum, text) => sum + countLlama3TextUpperBound(text, ranks), 0);
  assert.ok(count < LOCAL_CONTEXT_LIMITS.context - LOCAL_CONTEXT_LIMITS.output, `${count}`);
  assert.equal(countLlama3TextUpperBound(canonical + history, ranks), Buffer.byteLength(canonical + history));
});


test('verified 1b name reaches the same pinned metadata checks; aliases still fail', async () => {
  let calls = 0;
  const fetcher = (async (_url, init) => {
    calls++;
    assert.deepEqual(JSON.parse(init?.body as string), { model: 'llama3.2:1b', verbose: true });
    return new Response('{}');
  }) as typeof fetch;
  await assert.rejects(assertLocalContextFits(messages, 'llama3.2:1b', signal(), { fetch: fetcher }), /unsupported model metadata/);
  assert.equal(calls, 1);
  await assert.rejects(assertLocalContextFits(messages, 'llama3.2:latest', signal(), { fetch: fetcher }), /only verified/);
  assert.equal(calls, 1);
});


test('1b admits only verified absent parameters, never null/empty/custom parameters', async () => {
  const absent: Record<string, unknown> = stockShape(); delete absent.parameters;
  await assert.rejects(assertLocalContextFits(messages, 'llama3.2:1b', signal(), { fetch: response(absent) }), /unsupported tokenizer vocabulary/);
  for (const parameters of [null, '', 'num_ctx 8192', stockShape().parameters]) {
    await assert.rejects(assertLocalContextFits(messages, 'llama3.2:1b', signal(), { fetch: response({ ...absent, parameters }) }), /unsupported model parameters/);
  }
  await assert.rejects(assertLocalContextFits(messages, 'llama3.2:3b', signal(), { fetch: response(absent) }), /unsupported model parameters/);
});

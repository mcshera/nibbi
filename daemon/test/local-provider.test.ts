import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startLocalChat, LOCAL_CHAT_LIMITS } from '../src/providers/local.js';
const model = 'llama3.2:1b';
const input = () => ({ messages: [{ role: 'user' as const, content: 'Hello' }], signal: new AbortController().signal });
const frame = (content = '', done = false, extra = {}) => JSON.stringify({ model, message: { role: 'assistant', content }, done, ...extra });
const fake = (text: string, size = 7): typeof fetch => async () => new Response(new ReadableStream({ start(controller) {
  const bytes = new TextEncoder().encode(text);
  for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size));
  controller.close();
} }));
test('UTF8 split across bytes, chunks, actual model, input count, stateless body', async () => {
  const deltas: string[] = []; let calls = 0;
  const transport: typeof fetch = async (url, init) => {
    calls++; assert.equal(url, 'http://127.0.0.1:11434/api/chat');
    assert.equal(init?.redirect, 'error'); assert.equal(init?.credentials, 'omit');
    assert.deepEqual(init?.headers, { 'Content-Type': 'application/json' });
    const body = JSON.parse(init?.body as string);
    assert.deepEqual(Object.keys(body).sort(), ['messages', 'model', 'options', 'stream']);
    assert.deepEqual(body.options, { num_predict: 768, num_ctx: 16384 });
    assert.deepEqual(body.messages, [{ role: 'user', content: 'Hello' }]);
    return fake(frame('💚') + '\n' + frame(' hi', true, { prompt_eval_count: 12, eval_count: 88 }), 1)(url, init);
  };
  const result = await startLocalChat({ ...input(), onDelta: t => deltas.push(t) }, { fetch: transport }).result;
  assert.deepEqual(result, { text: '💚 hi', isError: false, costUsd: 0, localModel: model, ctxTokens: 12 });
  assert.deepEqual(deltas, ['💚', ' hi']); assert.equal(calls, 1);
});
test('missing token count remains unknown, not fabricated', async () => {
  const result = await startLocalChat(input(), { fetch: fake(frame('', true)) }).result;
  assert.equal('ctxTokens' in result, false); assert.equal('sessionId' in result, false);
});
for (const [name, text] of Object.entries({
  nonterminal: frame('partial'), malformed: '{bad}', providerError: JSON.stringify({ error: 'SECRET' }),
  missingModel: frame('', true, { model: undefined }), wrongModel: frame('', true, { model: 'llama3.2:3b' }),
  toolCall: frame('', true, { message: { role: 'assistant', content: '', tool_calls: [] } }),
  rootToolCall: frame('', true, { tool_calls: [] }), invalidCount: frame('', true, { prompt_eval_count: -1 }),
  oversizedFrame: 'x'.repeat(LOCAL_CHAT_LIMITS.frameBytes + 1),
  oversizedOutput: Array.from({ length: 5 }, () => frame('x'.repeat(30000))).join('\n'),
})) test(name + ' rejects', async () => {
  await assert.rejects(startLocalChat(input(), { fetch: fake(text, 5000) }).result, e => e instanceof Error && e.message.length <= 160 && !e.message.includes('SECRET'));
});
test('no remote endpoint, redirect, retries, fallback, oversized request', async () => {
  let calls = 0;
  const transport: typeof fetch = async () => { calls++; return new Response(null, { status: 302, headers: { Location: 'https://example.com' } }); };
  for (const endpoint of ['https://example.com/api/chat', 'http://localhost/api/chat', 'http://127.0.0.1@evil.test/api/chat', 'http://127.0.0.1/api/pull']) {
    await assert.rejects(startLocalChat(input(), { endpoint, fetch: transport }).result);
  }
  await assert.rejects(startLocalChat({ ...input(), messages: [{ role: 'user', content: 'a'.repeat(LOCAL_CHAT_LIMITS.requestBytes) }] }, { fetch: transport }).result);
  assert.equal(calls, 0);
  await assert.rejects(startLocalChat(input(), { fetch: transport }).result); assert.equal(calls, 1);
});
test('pre-abort never fetches', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(startLocalChat({ ...input(), signal: controller.signal }, { fetch: async () => { assert.fail('fetch after abort'); } }).result, /cancelled/);
});
test('pending fetch abort settles immediately and cancels late response', async () => {
  let resolve!: (r: Response) => void; let signal: AbortSignal | undefined; let disposed = false;
  const handle = startLocalChat(input(), { fetch: async (_, init) => { signal = init?.signal as AbortSignal; return new Promise(r => { resolve = r; }); } });
  const rejection = assert.rejects(handle.result, /cancelled/);
  await handle.cancel(); await rejection; assert.equal(signal?.aborted, true);
  resolve(new Response(new ReadableStream({ cancel() { disposed = true; } })));
  await new Promise(r => setImmediate(r)); assert.equal(disposed, true);
});
test('pending body signal abort settles, cancels body, emits no stale delta', async () => {
  const controller = new AbortController(); let disposed = false; const deltas: string[] = [];
  const handle = startLocalChat({ ...input(), signal: controller.signal, onDelta: t => deltas.push(t) }, {
    fetch: async () => new Response(new ReadableStream({ cancel() { disposed = true; } })),
  });
  const rejection = assert.rejects(handle.result, /cancelled/);
  await new Promise(r => setImmediate(r)); controller.abort(); await rejection;
  assert.equal(disposed, true); assert.deepEqual(deltas, []);
});
test('cancellation inside delta prevents subsequent chunks', async () => {
  const controller = new AbortController(); const deltas: string[] = [];
  await assert.rejects(startLocalChat({ ...input(), signal: controller.signal, onDelta: t => { deltas.push(t); controller.abort(); } }, {
    fetch: fake(frame('first') + '\n' + frame('stale', true), 1000),
  }).result, /cancelled/);
  assert.deepEqual(deltas, ['first']);
});
test('deadline settles a fetch that ignores abort; steering unsupported', async () => {
  const handle = startLocalChat(input(), { fetch: async () => new Promise(() => {}), deadlineMs: 10 });
  await assert.rejects(handle.steer('go'), /chat-only/); await assert.rejects(handle.result, /timed out/);
});
test('deadline settles a body that ignores cancel; bounded transport error', async () => {
  await assert.rejects(startLocalChat(input(), { fetch: async () => new Response(new ReadableStream({ cancel: () => new Promise(() => {}) })), deadlineMs: 10 }).result, /timed out/);
  await assert.rejects(startLocalChat(input(), { fetch: async () => { throw new Error('Local chat SECRET' + 'x'.repeat(10000)); } }).result, /^Error: Local chat request failed$/);
});

test('extra input tool/image fields are never serialized; invalid UTF8 rejects', async () => {
  const message = { role: 'user' as const, content: 'Hello', images: ['secret-image'], tool_calls: [{ name: 'exec' }] };
  await startLocalChat({ ...input(), messages: [message] }, { fetch: async (_, init) => {
    assert.deepEqual(JSON.parse(init?.body as string).messages, [{ role: 'user', content: 'Hello' }]);
    return fake(frame('', true))('', {});
  } }).result;
  await assert.rejects(startLocalChat(input(), { fetch: async () => new Response(new Uint8Array([255, 10])) }).result);
});
test('blank-frame flood has a total stream byte bound', async () => {
  let reads = 0;
  await assert.rejects(startLocalChat(input(), { fetch: async () => new Response(new ReadableStream({ pull(controller) {
    reads++; controller.enqueue(new TextEncoder().encode('\n'.repeat(32768)));
  } })) }).result, /stream too large/);
  assert.ok(reads < 70);
});

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
const directory = mkdtempSync(join(tmpdir(), 'nibbi-events-')); process.env.NIBBI_STATE_DIR = directory;
const { runtime, closeRuntime } = await import('../src/store.js');
const { streamEvents } = await import('../src/events.js');
after(() => { closeRuntime(); rmSync(directory, { recursive: true, force: true }); });

test('large SSE replay respects backpressure, preserves order, and catches concurrent events', { timeout: 15000 }, async () => {
  const store = runtime(), total = 6000;
  store.db.transaction(() => { for (let i = 0; i < total; i++) store.emit({ type: 'fixture', payload: { text: 'x'.repeat(2048) } }); })();
  let disconnected!: () => void; const closed = new Promise<void>(resolve => { disconnected = resolve; });
  const server = createServer((req, res) => { res.once('close', disconnected); streamEvents(req, res, 0); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const abort = new AbortController(); let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch('http://127.0.0.1:' + address.port, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(12000)]) });
    assert.equal(response.status, 200);
    await new Promise(resolve => setTimeout(resolve, 50)); // Let the socket back up beyond the old 1 MB cutoff.
    store.emit({ type: 'during-replay', payload: {} });
    reader = response.body!.getReader(); const decoder = new TextDecoder(); let buffer = '', count = 0, ready = false;
    while (!ready) {
      const chunk: ReadableStreamReadResult<Uint8Array> = await reader.read(); assert.equal(chunk.done, false); buffer += decoder.decode(chunk.value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const id = frame.match(/^id: (\d+)$/m); if (id) { count++; assert.equal(Number(id[1]), count); }
        if (frame.includes('event: ready')) ready = true;
      }
    }
    assert.equal(count, total + 1);
    store.emit({ type: 'after-ready', payload: {} });
    while (!buffer.includes('id: ' + (total + 2) + '\n')) { const chunk: ReadableStreamReadResult<Uint8Array> = await reader.read(); assert.equal(chunk.done, false); buffer += decoder.decode(chunk.value, { stream: true }); }
  } finally { abort.abort(); await reader?.cancel().catch(() => undefined); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await closed; }
  assert.equal(store.events.listenerCount('event'), 0);
});

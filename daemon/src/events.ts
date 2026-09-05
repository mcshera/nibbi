import type { IncomingMessage, ServerResponse } from 'node:http';
import { runtime } from './store.js';
import { sse } from './http.js';
export function streamEvents(req: IncomingMessage, res: ServerResponse, after: number): void {
  const store = runtime(), send = sse(res);
  // Large archives must drain progressively, not overflow the socket before its
  // headers have even reached the browser. Reconnect headers supersede the URL.
  res.flushHeaders();
  let cursor = Number(req.headers['last-event-id'] ?? after); if (!Number.isSafeInteger(cursor) || cursor < 0) cursor = 0;
  if (cursor > store.cursor()) { send('reset', { cursor: store.cursor() }); cursor = 0; }
  let closed = false, pumping = false, ready = false;
  const drain = (): Promise<void> => new Promise(resolve => {
    const finish = (): void => { res.off('drain', finish); res.off('close', finish); resolve(); };
    res.once('drain', finish); res.once('close', finish);
  });
  const pump = async (): Promise<void> => {
    if (pumping || closed) return;
    pumping = true;
    try {
      while (!closed) {
        const page = store.replay(cursor, 250); if (!page.length) break;
        for (const event of page) {
          if (closed || res.destroyed) return;
          send('event', event, event.id); cursor = event.id;
          if (res.writableNeedDrain) await drain();
        }
        // SQLite holds events arriving during replay. Fetch until empty, with no
        // separate unbounded in-memory queue and no replay/subscription gap.
        await new Promise<void>(resolve => setImmediate(resolve));
      }
      if (!closed && !ready) { ready = true; send('ready', { cursor }); }
    } finally { pumping = false; }
  };
  const wake = (): void => { void pump().catch(() => res.destroy()); };
  const ping = setInterval(() => { if (!closed && !pumping && !res.writableNeedDrain) res.write(': ping\n\n'); }, 15_000);
  res.on('close', () => { closed = true; clearInterval(ping); store.events.off('event', wake); });
  store.events.on('event', wake); wake();
}

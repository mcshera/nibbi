import type { CommandResult, RunEvent } from '@nibbi/contracts';

export function resultError(value: unknown, fallback = 'Request failed'): string {
  if (!value || typeof value !== 'object') return fallback;
  const data = value as { error?: string | { message?: string }; text?: string };
  return typeof data.error === 'string' ? data.error : data.error?.message ?? data.text ?? fallback;
}
export async function readResponse<T = any>(response: Response): Promise<T> {
  const value = await response.json().catch(() => ({}));
  if (!response.ok || value.ok === false || value.isError === true) throw new Error(resultError(value, 'HTTP ' + response.status));
  return value as T;
}
export const requestId = (): string => crypto.randomUUID();
export function createClient(project: () => string | undefined) {
  return {
    get: <T = any>(path: string): Promise<T> => fetch(path).then(readResponse<T>),
    post: <T = any>(path: string, data: Record<string, unknown> = {}): Promise<T> => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': requestId() }, body: JSON.stringify(path === '/api/send' ? { project: project(), ...data } : data) }).then(readResponse<T>),
    command: async <T = unknown>(name: string, args: Record<string, unknown> = {}, projectId = project()): Promise<T> => {
      const result = await fetch('/api/commands', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, args, projectId, idempotencyKey: requestId() }) }).then(readResponse<CommandResult<T>>);
      if (!result.ok) throw new Error(result.error.message); return result.data;
    },
  };
}
export async function* parseSse(response: Response): AsyncGenerator<Record<string, any>> {
  if (!response.ok) { await readResponse(response); return; }
  if (!response.body) throw new Error('Missing event stream');
  const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '', terminal = false;
  try {
    for (;;) {
      const { value, done } = await reader.read(); buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
      if (buffer.length > 2_000_000) throw new Error('Event frame exceeds limit');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const lines = frame.split('\n'); const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n'); if (!data) continue;
        const ev = lines.find(line => line.startsWith('event:'))?.slice(6).trim() ?? 'message';
        const parsed = JSON.parse(data); if (ev === 'done') terminal = true; yield { ev, ...parsed };
      }
      if (done) break;
    }
    if (!terminal) throw new Error('Connection ended before the result. Check Activity; the request was not retried.');
  } finally { reader.releaseLock(); }
}
export function subscribeEvents(options: { after: number; onEvent: (event: RunEvent) => void; onReady?: () => void; onOffline?: () => void; onCursor: (id: number) => void }): () => void {
  const source = new EventSource('/api/events?after=' + options.after); let cursor = options.after;
  source.addEventListener('event', message => {
    const event = JSON.parse((message as MessageEvent).data) as RunEvent;
    if (!Number.isSafeInteger(event.id) || event.id <= cursor) return;
    options.onEvent(event); cursor = event.id; options.onCursor(cursor);
  });
  source.addEventListener('reset', () => { cursor = 0; options.onCursor(0); });
  source.addEventListener('ready', () => options.onReady?.()); source.onerror = () => options.onOffline?.();
  return () => source.close();
}

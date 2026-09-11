import type { IncomingMessage, ServerResponse } from 'node:http';
export class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
export function json(res: ServerResponse, status: number, value: unknown): void {
  if (res.destroyed || res.writableEnded) return;
  const body = JSON.stringify(value); res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) }); res.end(body);
}
export async function body(req: IncomingMessage, limit = 2_000_000): Promise<Buffer> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new HttpError(413, 'Request too large'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
export async function jsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  try { const value: unknown = JSON.parse((await body(req, 12_000_000)).toString() || '{}'); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>; }
  catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'Invalid JSON request'); }
}
export function sse(res: ServerResponse): (event: string, data: unknown, id?: number) => void {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  return (event, data, id) => { if (res.destroyed || res.writableEnded) return; if (res.writableLength > 1_000_000) { res.destroy(); return; } res.write((id === undefined ? '' : 'id: ' + id + '\n') + 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'); };
}
export function loopback(req: IncomingMessage): boolean { return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? ''); }

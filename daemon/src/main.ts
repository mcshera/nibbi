import { startGithubCoordinator, stopGithubCoordinator } from './github-builds.js';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFileSync, existsSync, mkdirSync, openSync, closeSync, writeSync, unlinkSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, extname } from 'node:path';
import { config } from './config.js';
import { runtime, closeRuntime } from './store.js';
import { json, HttpError, loopback } from './http.js';
import { api } from './api.js';
import { requestAllowed, pairingRoute, pairingPage, paired, tlsMaterial } from './lan.js';
import { scopedPath } from './paths.js';
import { startScheduler, stopScheduler } from './scheduler.js';
import { setDispatchNotify, shutdownSessions } from './session.js';
import { reconcileFixers, shutdownFixers } from './fixer.js';
import { stopPreviews } from './previews.js';
import { stopProcesses, execute } from './processes.js';
import { closeToolService } from './tool-service.js';
import { stopAuth } from './auth.js';
import { notifyOwner } from './notify.js';
import { randomBytes } from 'node:crypto';
import { skillCatalog, inspectSkill } from './skills.js';
const root = fileURLToPath(new URL('../../', import.meta.url));
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon', '.wasm': 'application/wasm' };
function acquireOwner(): () => void {
  mkdirSync(config.stateDir, { recursive: true, mode: 0o700 }); const lock = join(config.stateDir, 'backend.lock');
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, 'utf8')); let alive = true;
    if (!Number.isInteger(pid) || pid < 1) throw new Error('Invalid backend.lock; inspect it before removing');
    try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false; else throw error; }
    if (alive) throw new Error('A backend already owns this state directory (pid ' + pid + ')'); unlinkSync(lock);
  }
  const fd = openSync(lock, 'wx', 0o600); writeSync(fd, String(process.pid)); closeSync(fd);
  return () => { if (existsSync(lock) && readFileSync(lock, 'utf8') === String(process.pid)) unlinkSync(lock); };
}
export async function startBackend(options: { open?: boolean } = {}): Promise<{ close: () => Promise<void>; servers: Server[] }> {
  const release = acquireOwner(); const servers: Server[] = []; let closing = false;
  const publicDir = join(root, 'dist', 'ui');
  try {
    if (!existsSync(join(publicDir, 'index.html'))) throw new Error('UI build is missing. Run npm run build.');
    mkdirSync(config.vaultDir, { recursive: true }); runtime().interruptCommands(); await reconcileFixers();
    for (const name of ['nibbi-fixer-brief', 'nibbi-verify-change']) {
      const directory = join(root, 'skills', name); if (!existsSync(directory)) continue;
      const skill = inspectSkill(directory, 'bundled');
      if (!runtime().get('skill-revisions', skill.id + '@' + skill.revision)) skillCatalog().import(directory, 'bundled');
    }
    runtime().db.prepare("UPDATE records SET value=json_set(value,'$.status','interrupted') WHERE bucket='lead-runs' AND json_extract(value,'$.status')='running'").run();
    const handler = (tls: boolean) => (req: IncomingMessage, res: ServerResponse): void => { void (async () => {
      if (closing) throw new HttpError(503, 'Backend is shutting down'); requestAllowed(req, tls);
      res.setHeader('x-content-type-options', 'nosniff'); res.setHeader('referrer-policy', 'no-referrer');
      res.setHeader('x-frame-options', 'DENY'); res.setHeader('permissions-policy', 'camera=(), geolocation=()');
      const nonce = randomBytes(16).toString('base64');
      res.setHeader('content-security-policy', `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ipc: http://ipc.localhost; media-src 'self' blob:; frame-src http://127.0.0.1:* http://localhost:*; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`);
      const url = new URL(req.url ?? '/', (tls ? 'https://' : 'http://') + req.headers.host);
      if (await pairingRoute(req, res, url)) return;
      if (!loopback(req) && !paired(req)) {
        if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); res.end(pairingPage.replace('<script>', '<script nonce="' + nonce + '">')); return; }
        throw new HttpError(401, 'Pair this device on the Mac');
      }
      if (await api(req, res, url)) return;
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
      const rel = decodeURIComponent(url.pathname).replace(/^\//, '') || 'index.html';
      const file = scopedPath(publicDir, rel); if (!existsSync(file) || !statSync(file).isFile()) throw new HttpError(404, 'Not found');
      res.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream', 'cache-control': rel === 'sw.js' || rel.endsWith('.html') ? 'no-store' : rel.startsWith('assets/') ? 'public,max-age=31536000,immutable' : 'no-cache' });
      if (req.method === 'HEAD') res.end(); else res.end(readFileSync(file));
    })().catch(error => { if (!res.headersSent) json(res, error instanceof HttpError ? error.status : 400, { error: (error as Error).message }); else res.end(); }); };
    const listen = async (server: Server, port: number, host: string): Promise<void> => {
      server.requestTimeout = 30_000; server.headersTimeout = 10_000; servers.push(server);
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => resolve()); });
    };
    await listen(createServer(handler(false)), config.port, '127.0.0.1');
    if (process.env.NIBBI_LEGACY_API === '1' && config.legacyPort !== config.port) await listen(createServer(handler(false)), config.legacyPort, '127.0.0.1');
    if (process.env.NIBBI_REMOTE === '1') await listen(createHttpsServer(await tlsMaterial(), handler(true)), config.port + 1, '0.0.0.0');
    const notify = (text: string): Promise<void> => notifyOwner(null, text); setDispatchNotify(notify);
    if (process.env.NIBBI_SCHEDULER !== '0') startScheduler(notify);
    if (process.env.NIBBI_GITHUB_POLL !== '0') startGithubCoordinator();
    const close = async (): Promise<void> => {
      if (closing) return; closing = true;
      process.off('SIGTERM', onSignal); process.off('SIGINT', onSignal);
      const closedServers = servers.map(server => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
      await Promise.all([stopGithubCoordinator(), stopPreviews(), stopScheduler(), shutdownSessions(), shutdownFixers(), stopAuth()]);
      await stopProcesses(); await closeToolService(); await Promise.all(closedServers); closeRuntime(); release();
    };
    const onSignal = (): void => { void close().catch(error => { console.error('[nibbi] shutdown:', (error as Error).message); process.exitCode = 1; }); };
    process.once('SIGTERM', onSignal); process.once('SIGINT', onSignal);
    console.log('[nibbi] ready http://127.0.0.1:' + config.port + ' · one backend · SQLite');
    if (options.open) await execute(root, 'open', ['http://127.0.0.1:' + config.port], { timeoutMs: 5000 }).catch(() => undefined);
    return { close, servers };
  } catch (error) { for (const server of servers) { server.closeAllConnections(); server.close(); } closeRuntime(); release(); throw error; }
}

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomBytes, timingSafeEqual, X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hostname, networkInterfaces } from 'node:os';
import { config } from './config.js';
import { runtime } from './store.js';
import { execute } from './processes.js';
import { HttpError, json, jsonBody, loopback } from './http.js';
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
export const lanAddress = (): string => Object.values(networkInterfaces()).flat().find(address => address?.family === 'IPv4' && !address.internal)?.address ?? '127.0.0.1';
export function pairingCode(): { code: string; expiresAt: number; url: string } {
  const code = randomBytes(12).toString('hex'); const expiresAt = Date.now() + 5 * 60_000;
  runtime().put('pairing', 'pending', { hash: digest(code), expiresAt });
  return { code, expiresAt, url: `https://${lanAddress()}:${config.port + 1}/` };
}
export function paired(req: IncomingMessage): boolean {
  const cookie = String(req.headers.cookie ?? '').split(';').map(part => part.trim()).find(part => part.startsWith('nibbi_session='))?.slice(14);
  if (!cookie) return false;
  const session = runtime().get<{ expiresAt: number }>('paired-devices', digest(cookie)); return !!session && session.expiresAt > Date.now();
}
export function requestAllowed(req: IncomingMessage, tls: boolean): void {
  const host = String(req.headers.host ?? '');
  const allowed = new Set([`localhost:${config.port}`, `127.0.0.1:${config.port}`, `localhost:${config.legacyPort}`, `127.0.0.1:${config.legacyPort}`, `localhost:${config.port + 1}`, `127.0.0.1:${config.port + 1}`, `${lanAddress()}:${config.port + 1}`]);
  if (!allowed.has(host)) throw new HttpError(403, 'Unrecognized host');
  const origin = req.headers.origin;
  if (origin && origin !== (tls ? 'https://' : 'http://') + host) throw new HttpError(403, 'Cross-origin access is not allowed');
  if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Cross-site access is not allowed');
  if (!loopback(req) && !tls) throw new HttpError(403, 'LAN access requires HTTPS');
}
export async function pairingRoute(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (url.pathname === '/api/pairing/new' && req.method === 'POST') {
    if (!loopback(req)) throw new HttpError(403, 'Pair devices from this Mac'); json(res, 200, pairingCode()); return true;
  }
  if (url.pathname === '/api/pairing/revoke' && req.method === 'POST') {
    if (!loopback(req)) throw new HttpError(403, 'Revoke devices from this Mac'); runtime().db.prepare("DELETE FROM records WHERE bucket='paired-devices'").run(); runtime().remove('pairing', 'pending'); json(res, 200, { ok: true }); return true;
  }
  if (url.pathname === '/api/pairing/accept' && req.method === 'POST') {
    const value = await jsonBody(req); const code = String(value.code ?? '');
    const pending = runtime().get<{ hash: string; expiresAt: number }>('pairing', 'pending');
    if (!pending || Date.now() > pending.expiresAt || !timingSafeEqual(Buffer.from(digest(code)), Buffer.from(pending.hash))) throw new HttpError(403, 'Pairing code is invalid or expired');
    runtime().remove('pairing', 'pending');
    const token = randomBytes(32).toString('hex'); runtime().put('paired-devices', digest(token), { expiresAt: Date.now() + 30 * 86400_000, createdAt: Date.now() });
    res.setHeader('set-cookie', `nibbi_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`); json(res, 200, { ok: true }); return true;
  }
  return false;
}
export const pairingPage = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pair with Nibbi</title><body style="font:18px system-ui;max-width:32rem;margin:10vh auto;padding:2rem"><h1>Meet your Nibbi.</h1><p>On your Mac, open Settings → Phone. Trust the displayed local CA certificate on this device, then enter the one-use pairing code.</p><form><label>Pairing code <input name="code" autocomplete="off" required></label><button>Pair this device</button></form><p id="error"></p><script>document.querySelector('form').onsubmit=async e=>{e.preventDefault();const r=await fetch('/api/pairing/accept',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:new FormData(e.target).get('code')})});if(r.ok)location.reload();else document.querySelector('#error').textContent='Code invalid or expired. Generate a new code on the Mac.'}</script></body></html>`;
export async function tlsMaterial(): Promise<{ key: Buffer; cert: Buffer }> {
  const directory = join(config.stateDir, 'nibbi-tls'); mkdirSync(directory, { recursive: true, mode: 0o700 });
  const ca = join(directory, 'ca.crt'), caKey = join(directory, 'ca.key'), key = join(directory, 'server.key'), cert = join(directory, 'server.crt');
  const san = 'DNS:localhost,IP:127.0.0.1,IP:' + lanAddress();
  const openssl = async (args: string[]): Promise<void> => { await execute(directory, 'openssl', args); };
  if (!existsSync(ca)) await openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', caKey, '-out', ca, '-days', '3650', '-subj', '/CN=Nibbi Local CA/O=Nibbi', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
  const sanFile = join(directory, 'san.txt');
  const expiring = existsSync(cert) && Date.parse(new X509Certificate(readFileSync(cert)).validTo) < Date.now() + 7 * 86400_000;
  if (!existsSync(cert) || !existsSync(key) || !existsSync(sanFile) || readFileSync(sanFile, 'utf8') !== san || expiring) {
    await openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', join(directory, 'server.csr'), '-subj', '/CN=Nibbi/O=Nibbi']);
    writeFileSync(join(directory, 'ext.cnf'), `subjectAltName=${san}\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n`);
    await openssl(['x509', '-req', '-in', join(directory, 'server.csr'), '-CA', ca, '-CAkey', caKey, '-CAcreateserial', '-out', cert, '-days', '365', '-sha256', '-extfile', join(directory, 'ext.cnf')]); writeFileSync(sanFile, san);
  }
  chmodSync(caKey, 0o600); chmodSync(key, 0o600); return { key: readFileSync(key), cert: readFileSync(cert) };
}

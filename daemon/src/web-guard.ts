// Transport safety for outbound web access.
// Guarantees: only absolute http(s) URLs without credentials; no IP literals, local/single-label hosts, or hosts
// outside the allowlist; every hop (including redirects) is re-checked and DNS-resolved before connecting; any
// non-public answer refuses the whole hop; the socket connects to the pinned address (DNS rebinding cannot move it)
// while SNI/Host keep the hostname; https never downgrades to http; bounded redirects, bytes and wall-clock time;
// only text-like content types are decoded. Does not guarantee: anything about the content itself (no content policy,
// no HTML sanitising, no prompt-injection defence) and nothing about what a permitted host does with the request.
import { promises as dns } from 'node:dns';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
export type WebGuardCode = 'SCHEME' | 'USERINFO' | 'IP_LITERAL' | 'LOCAL_HOST' | 'NOT_ALLOWLISTED' | 'PRIVATE_ADDRESS' | 'DNS' | 'REDIRECT_LIMIT' | 'REDIRECT_DOWNGRADE' | 'CONTENT_TYPE' | 'TIMEOUT' | 'TOO_LARGE' | 'HTTP';
export class WebGuardError extends Error { constructor(readonly code: WebGuardCode, message: string) { super(message); this.name = 'WebGuardError'; } }
export interface Lookup { (host: string): Promise<Array<{ address: string; family: 4 | 6 }>> }
export const defaultLookup: Lookup = async host => (await dns.lookup(host, { all: true, verbatim: true })).map(answer => ({ address: answer.address, family: isIP(answer.address) === 6 ? 6 : 4 }));
export interface Pinned { url: URL; host: string; address: string; family: 4 | 6 }
export interface TransportRequest { url: URL; address: string; family: 4 | 6; headers: Record<string, string>; signal: AbortSignal; connectTimeoutMs: number; method: 'GET' | 'POST'; body?: string }
export interface TransportResponse { status: number; headers: Record<string, string>; body: AsyncIterable<Uint8Array> | NodeJS.ReadableStream }
export interface Transport { (request: TransportRequest): Promise<TransportResponse> }
export interface FetchOptions {
  allowlist: readonly string[]; lookup?: Lookup; maxBytes?: number; connectTimeoutMs?: number; totalTimeoutMs?: number; maxRedirects?: number;
  headers?: Record<string, string>; signal?: AbortSignal; allowedTypes?: readonly string[]; transport?: Transport;
  /** POST sends `body` once and refuses redirects (a replayed body could reach an unreviewed host). */
  method?: 'GET' | 'POST'; body?: string;
}
export interface FetchResult { url: string; finalUrl: string; status: number; contentType: string; body: string; bytes: number; truncated: boolean; hops: number; elapsedMs: number }
export const defaultAllowedTypes: readonly string[] = ['text/html', 'text/plain', 'text/markdown', 'application/json', 'application/xml', 'application/xhtml+xml', 'text/xml'];
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const normalizeDomain = (entry: string): string => entry.trim().toLowerCase().replace(/^(\*\.|\.)/, '').replace(/\.$/, '');
export function hostAllowed(host: string, allowlist: readonly string[]): boolean {
  const name = host.toLowerCase();
  return allowlist.map(normalizeDomain).some(domain => domain !== '' && (name === domain || name.endsWith('.' + domain)));
}
const ipv4Octets = (address: string): number[] | undefined => { const octets = address.split('.').map(Number); return octets.length === 4 && octets.every(octet => Number.isInteger(octet) && octet >= 0 && octet <= 255) ? octets : undefined; };
const privateV4 = ([a, b]: number[]): boolean => a === 0 || a === 10 || a === 127 || (a === 100 && (b & 0xc0) === 64) || (a === 169 && b === 254) || (a === 172 && (b & 0xf0) === 16) || (a === 192 && b === 168) || a >= 224;
function ipv6Groups(address: string): number[] | undefined {
  let text = address.toLowerCase().split('%')[0]; const tail = text.slice(text.lastIndexOf(':') + 1);
  if (tail.includes('.')) { const v4 = ipv4Octets(tail); if (!v4) return undefined; text = text.slice(0, text.lastIndexOf(':') + 1) + ((v4[0] << 8) | v4[1]).toString(16) + ':' + ((v4[2] << 8) | v4[3]).toString(16); }
  const [head = '', rest = ''] = text.split('::'); const left = head ? head.split(':') : [], right = rest ? rest.split(':') : [];
  const groups = [...left, ...(text.includes('::') ? Array<string>(8 - left.length - right.length).fill('0') : []), ...right].map(group => parseInt(group, 16));
  return groups.length === 8 && groups.every(group => group >= 0 && group <= 0xffff) ? groups : undefined;
}
// Anything unparseable counts as private (fail closed).
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) { const octets = ipv4Octets(address); return !octets || privateV4(octets); }
  if (family !== 6) return true;
  const g = ipv6Groups(address); if (!g) return true;
  if (g.slice(0, 5).every(group => group === 0) && g[5] === 0xffff) return privateV4([g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff]);
  if (g.slice(0, 7).every(group => group === 0)) return g[7] === 0 || g[7] === 1;
  return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xff00) === 0xff00;
}
const localHost = (host: string): boolean => { const bare = host.replace(/\.$/, ''); return bare === 'localhost' || !bare.includes('.') || ['.localhost', '.local', '.internal', '.home.arpa'].some(suffix => bare.endsWith(suffix)); };
const reason = (error: unknown): string => error instanceof Error ? error.message : String(error);
export async function checkUrl(input: string, allowlist: readonly string[], lookup: Lookup = defaultLookup): Promise<Pinned> {
  let url: URL; try { url = new URL(input); } catch { throw new WebGuardError('SCHEME', 'Not an absolute URL: ' + input); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new WebGuardError('SCHEME', `Refusing ${url.protocol} URL; only http and https are allowed`);
  if (url.username || url.password) throw new WebGuardError('USERINFO', 'Refusing URL with embedded credentials');
  const host = url.hostname.toLowerCase();
  if (host.startsWith('[') || isIP(host)) throw new WebGuardError('IP_LITERAL', 'Refusing IP literal host ' + host);
  if (localHost(host)) throw new WebGuardError('LOCAL_HOST', 'Refusing local or single-label host ' + host);
  if (!hostAllowed(host, allowlist)) throw new WebGuardError('NOT_ALLOWLISTED', host + ' is not on the web allowlist');
  let answers: Array<{ address: string; family: 4 | 6 }>;
  try { answers = await lookup(host); } catch (error) { throw new WebGuardError('DNS', `DNS lookup failed for ${host}: ${reason(error)}`); }
  if (answers.length === 0) throw new WebGuardError('DNS', 'No addresses for ' + host);
  const blocked = answers.find(answer => isPrivateAddress(answer.address));
  if (blocked) throw new WebGuardError('PRIVATE_ADDRESS', `${host} resolves to non-public address ${blocked.address}`);
  return { url, host, address: answers[0].address, family: answers[0].family };
}
const flatten = (headers: IncomingHttpHeaders): Record<string, string> => Object.fromEntries(Object.entries(headers).flatMap(([name, value]) => value === undefined ? [] : [[name, Array.isArray(value) ? value.join(', ') : value]]));
export const defaultTransport: Transport = ({ url, address, family, headers, signal, connectTimeoutMs, method, body }) => new Promise((resolve, reject) => {
  const secure = url.protocol === 'https:';
  const lookup: LookupFunction = (_host, options, callback) => { if (options.all) callback(null, [{ address, family }]); else callback(null, address, family); };
  const options: RequestOptions = { method, host: url.hostname, port: url.port || (secure ? 443 : 80), path: url.pathname + url.search, headers, lookup, signal, agent: false, ...(secure ? { servername: url.hostname } : {}) };
  const req = (secure ? httpsRequest : httpRequest)(options, res => resolve({ status: res.statusCode ?? 0, headers: flatten(res.headers), body: res }));
  req.on('socket', socket => {
    const timer = setTimeout(() => req.destroy(new WebGuardError('TIMEOUT', `Connect to ${url.hostname} timed out after ${connectTimeoutMs}ms`)), connectTimeoutMs);
    socket.once(secure ? 'secureConnect' : 'connect', () => clearTimeout(timer)); socket.once('close', () => clearTimeout(timer));
  });
  req.on('error', reject); req.end(body);
});
function race<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason as unknown);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason as unknown); signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
const discard = (body: TransportResponse['body']): void => { void body[Symbol.asyncIterator]().return?.()?.catch(() => {}); };
async function readBody(body: TransportResponse['body'], maxBytes: number, signal: AbortSignal): Promise<{ chunks: Uint8Array[]; bytes: number; truncated: boolean }> {
  const chunks: Uint8Array[] = []; let bytes = 0; const iterator: AsyncIterator<Uint8Array | string> = body[Symbol.asyncIterator]();
  for (;;) {
    const { done, value } = await race(iterator.next(), signal); if (done) return { chunks, bytes, truncated: false };
    const chunk = typeof value === 'string' ? Buffer.from(value) : value; const room = maxBytes - bytes;
    if (chunk.length > room) { chunks.push(chunk.subarray(0, room)); void iterator.return?.()?.catch(() => {}); return { chunks, bytes: maxBytes, truncated: true }; }
    chunks.push(chunk); bytes += chunk.length;
  }
}
function decode(chunks: Uint8Array[], contentType: string): string {
  const charset = /charset="?([\w-]+)"?/i.exec(contentType)?.[1]?.toLowerCase() ?? 'utf-8';
  const label = ['utf-8', 'utf8'].includes(charset) ? 'utf-8' : ['latin1', 'iso-8859-1', 'iso8859-1'].includes(charset) ? 'latin1' : 'utf-8';
  return new TextDecoder(label).decode(Buffer.concat(chunks));
}
export async function governedFetch(input: string, options: FetchOptions): Promise<FetchResult> {
  const { allowlist, lookup, maxBytes = 1_500_000, connectTimeoutMs = 8000, totalTimeoutMs = 15_000, maxRedirects = 3, allowedTypes = defaultAllowedTypes, transport = defaultTransport } = options;
  const started = Date.now(); const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new WebGuardError('TIMEOUT', `Fetch exceeded ${totalTimeoutMs}ms`)), totalTimeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const headers: Record<string, string> = { 'user-agent': 'Nibbi/0.8 (+local companion)', accept: allowedTypes.join(', '), 'accept-encoding': 'identity', ...Object.fromEntries(Object.entries(options.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value])) };
  try {
    let current = input, first = ''; let hops = 0;
    for (;;) {
      const pinned = await race(checkUrl(current, allowlist, lookup), signal); first ||= pinned.url.href;
      const response = await race(transport({ url: pinned.url, address: pinned.address, family: pinned.family, headers, signal, connectTimeoutMs, method: options.method ?? 'GET', ...(options.body !== undefined ? { body: options.body } : {}) }), signal);
      const responseHeaders = Object.fromEntries(Object.entries(response.headers).map(([name, value]) => [name.toLowerCase(), value]));
      if (REDIRECTS.has(response.status)) {
        discard(response.body); let next: URL;
        try { if (!responseHeaders.location) throw new Error(); next = new URL(responseHeaders.location, pinned.url); } catch { throw new WebGuardError('HTTP', `HTTP ${response.status} redirect without a usable location`); }
        if (options.method === 'POST') throw new WebGuardError('REDIRECT_LIMIT', `Refusing to replay a POST body across a redirect from ${pinned.url.href}`);
        if (pinned.url.protocol === 'https:' && next.protocol === 'http:') throw new WebGuardError('REDIRECT_DOWNGRADE', `Refusing redirect from ${pinned.url.href} to cleartext ${next.href}`);
        if (hops >= maxRedirects) throw new WebGuardError('REDIRECT_LIMIT', `More than ${maxRedirects} redirects from ${first}`);
        hops += 1; current = next.href; continue;
      }
      if (response.status < 200 || response.status >= 300) { discard(response.body); throw new WebGuardError('HTTP', `HTTP ${response.status} from ${pinned.url.href}`); }
      const contentType = (responseHeaders['content-type'] ?? '').trim();
      if (!allowedTypes.some(type => contentType.toLowerCase().startsWith(type.toLowerCase()))) { discard(response.body); throw new WebGuardError('CONTENT_TYPE', `Refusing content type ${contentType || '(missing)'} from ${pinned.url.href}`); }
      const { chunks, bytes, truncated } = await readBody(response.body, maxBytes, signal);
      return { url: first, finalUrl: pinned.url.href, status: response.status, contentType, body: decode(chunks, contentType), bytes, truncated, hops, elapsedMs: Date.now() - started };
    }
  } catch (error) { throw signal.aborted ? (signal.reason as unknown) : error; } finally { clearTimeout(timer); }
}

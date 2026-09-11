import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkUrl, governedFetch, hostAllowed, isPrivateAddress, WebGuardError, type Lookup, type Transport, type TransportRequest } from '../src/web-guard.js';
interface Route { status?: number; headers?: Record<string, string>; body?: string | Uint8Array | string[] }
const publicLookup: Lookup = async () => [{ address: '93.184.216.34', family: 4 }];
const allowlist = ['example.com'];
async function* chunks(parts: Array<string | Uint8Array>, yielded: { count: number }): AsyncGenerator<Uint8Array> { for (const part of parts) { yielded.count += 1; yield typeof part === 'string' ? Buffer.from(part) : part; } }
// In-memory router keyed by absolute URL; records every request it sees.
function router(routes: Record<string, Route>, seen: TransportRequest[] = [], yielded = { count: 0 }): Transport {
  return async request => {
    seen.push(request); const route = routes[request.url.href] ?? { status: 404, headers: { 'content-type': 'text/plain' }, body: 'not found' };
    const parts = Array.isArray(route.body) ? route.body : [route.body ?? ''];
    return { status: route.status ?? 200, headers: { 'content-type': 'text/html; charset=utf-8', ...route.headers }, body: chunks(parts, yielded) };
  };
}
const rejectsWith = (promise: Promise<unknown>, code: string): Promise<void> => assert.rejects(promise, (error: unknown) => { assert.ok(error instanceof WebGuardError, 'expected WebGuardError, got ' + String(error)); assert.equal(error.code, code, error.message); return true; });
const fetchWith = (url: string, routes: Record<string, Route>, extra: Partial<Parameters<typeof governedFetch>[1]> = {}) => governedFetch(url, { allowlist, lookup: publicLookup, transport: router(routes), ...extra });
test('checkUrl refuses non-http schemes, credentials and IP literals', async () => {
  for (const url of ['file:///etc/passwd', 'ftp://example.com/x', 'javascript:alert(1)', 'not a url']) await rejectsWith(checkUrl(url, allowlist, publicLookup), 'SCHEME');
  for (const url of ['https://user:secret@example.com/', 'https://user@example.com/']) await rejectsWith(checkUrl(url, allowlist, publicLookup), 'USERINFO');
  const literals = ['127.0.0.1', '10.1.1.1', '93.184.216.34', '0x7f000001', '2130706433', '[::1]', '[2606:4700::1111]'];
  for (const host of literals) await rejectsWith(checkUrl(`http://${host}/`, [...allowlist, host], publicLookup), 'IP_LITERAL');
});
test('checkUrl refuses local, reserved-suffix and single-label hosts before consulting the allowlist', async () => {
  const permissive = ['localhost', 'local', 'internal', 'intranet', 'home.arpa', 'foo.local', 'api.internal'];
  for (const host of ['localhost', 'a.localhost', 'foo.local', 'api.internal', 'intranet', 'printer.home.arpa', 'LOCALHOST']) await rejectsWith(checkUrl(`http://${host}/`, permissive, publicLookup), 'LOCAL_HOST');
});
test('allowlist matching: exact and subdomain only, entries normalized', async () => {
  for (const url of ['https://evil.com/', 'https://example.com.evil.com/', 'https://notexample.com/', 'https://example.org/']) await rejectsWith(checkUrl(url, allowlist, publicLookup), 'NOT_ALLOWLISTED');
  const pinned = await checkUrl('https://Docs.Example.com/guide?x=1', allowlist, publicLookup);
  assert.deepEqual({ host: pinned.host, address: pinned.address, family: pinned.family, href: pinned.url.href }, { host: 'docs.example.com', address: '93.184.216.34', family: 4, href: 'https://docs.example.com/guide?x=1' });
  assert.equal(hostAllowed('a.example.com', ['*.example.com']), true);
  assert.equal(hostAllowed('example.com', ['*.example.com']), true);
  assert.equal(hostAllowed('example.com', ['Example.COM.']), true);
  assert.equal(hostAllowed('WWW.EXAMPLE.COM', [' .example.com ']), true);
  assert.equal(hostAllowed('example.com', ['sub.example.com']), false);
  assert.equal(hostAllowed('evil.com', ['*', '', ' ', '*.']), false);
  assert.equal(hostAllowed('xexample.com', ['example.com']), false);
});
test('isPrivateAddress classifies IPv4, IPv6 and IPv4-mapped ranges', () => {
  const closed = ['0.0.0.0', '0.1.2.3', '10.0.0.5', '100.64.0.1', '100.127.255.255', '127.0.0.1', '127.255.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.2', '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255',
    '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fe80::1%en0', 'febf::1', 'ff02::1', '::ffff:192.168.1.2', '::ffff:10.0.0.1', '::ffff:c0a8:102', '::ffff:7f00:1', 'garbage', ''];
  const open = ['93.184.216.34', '8.8.8.8', '100.63.255.255', '100.128.0.0', '172.15.255.255', '172.32.0.0', '192.167.255.255', '223.255.255.255', '2606:4700::1111', '2001:db8::1', 'fec0::1', 'fbff::1', '::ffff:93.184.216.34', '::ffff:5db8:d822'];
  for (const address of closed) assert.equal(isPrivateAddress(address), true, address);
  for (const address of open) assert.equal(isPrivateAddress(address), false, address);
});
test('DNS answers: any private address refuses the host; failures and empty answers surface as DNS', async () => {
  const mixedV4: Lookup = async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }];
  const mixedV6: Lookup = async () => [{ address: '2606:4700::1111', family: 6 }, { address: '::ffff:192.168.1.2', family: 6 }];
  await rejectsWith(checkUrl('https://example.com/', allowlist, mixedV4), 'PRIVATE_ADDRESS');
  await rejectsWith(checkUrl('https://example.com/', allowlist, mixedV6), 'PRIVATE_ADDRESS');
  await rejectsWith(checkUrl('https://example.com/', allowlist, async () => { throw new Error('ENOTFOUND'); }), 'DNS');
  await rejectsWith(checkUrl('https://example.com/', allowlist, async () => []), 'DNS');
  await rejectsWith(governedFetch('https://example.com/', { allowlist, lookup: mixedV4, transport: router({}) }), 'PRIVATE_ADDRESS');
});
test('redirects are re-checked per hop: foreign hosts, downgrades and excess hops are refused', async () => {
  const routes: Record<string, Route> = {
    'https://example.com/foreign': { status: 302, headers: { location: 'https://evil.com/' } },
    'https://example.com/downgrade': { status: 301, headers: { location: 'http://example.com/' } },
    'https://example.com/private': { status: 307, headers: { location: 'http://127.0.0.1/' } },
    'https://example.com/r1': { status: 302, headers: { location: '/r2' } }, 'https://example.com/r2': { status: 303, headers: { location: '/r3' } },
    'https://example.com/r3': { status: 308, headers: { location: '/r4' } }, 'https://example.com/r4': { status: 301, headers: { location: '/end' } },
    'https://example.com/end': { body: 'landed' }, 'https://example.com/nowhere': { status: 302 },
  };
  await rejectsWith(fetchWith('https://example.com/foreign', routes), 'NOT_ALLOWLISTED');
  await rejectsWith(fetchWith('https://example.com/downgrade', routes), 'REDIRECT_DOWNGRADE');
  await rejectsWith(fetchWith('https://example.com/private', routes), 'REDIRECT_DOWNGRADE');
  await rejectsWith(fetchWith('https://example.com/r1', routes), 'REDIRECT_LIMIT');
  await rejectsWith(fetchWith('https://example.com/nowhere', routes), 'HTTP');
  const result = await fetchWith('https://example.com/r2', routes);
  assert.deepEqual({ url: result.url, finalUrl: result.finalUrl, hops: result.hops, body: result.body }, { url: 'https://example.com/r2', finalUrl: 'https://example.com/end', hops: 3, body: 'landed' });
  const seen: TransportRequest[] = [];
  await governedFetch('https://example.com/r4', { allowlist, lookup: publicLookup, transport: router(routes, seen), maxRedirects: 1 });
  assert.deepEqual(seen.map(request => request.url.href), ['https://example.com/r4', 'https://example.com/end']);
  await rejectsWith(governedFetch('https://example.com/r3', { allowlist, lookup: publicLookup, transport: router(routes), maxRedirects: 1 }), 'REDIRECT_LIMIT');
});
test('body is capped at maxBytes, reading stops early and the result is marked truncated', async () => {
  const seen: TransportRequest[] = []; const yielded = { count: 0 };
  const transport = router({ 'https://example.com/big': { headers: { 'content-type': 'text/plain' }, body: Array.from({ length: 10 }, (_, i) => String(i).repeat(100)) } }, seen, yielded);
  const result = await governedFetch('https://example.com/big', { allowlist, lookup: publicLookup, transport, maxBytes: 250 });
  assert.equal(result.truncated, true); assert.equal(result.bytes, 250); assert.equal(result.body.length, 250); assert.equal(result.body, '0'.repeat(100) + '1'.repeat(100) + '2'.repeat(50));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(yielded.count, 3);
  const exact = await governedFetch('https://example.com/big', { allowlist, lookup: publicLookup, transport, maxBytes: 1000 });
  assert.equal(exact.truncated, false); assert.equal(exact.bytes, 1000);
});
test('content-type outside the allowed set and HTTP error statuses are refused', async () => {
  const routes: Record<string, Route> = {
    'https://example.com/png': { headers: { 'content-type': 'image/png' }, body: 'PNG' }, 'https://example.com/untyped': { headers: { 'content-type': '' }, body: 'x' },
    'https://example.com/500': { status: 500, body: 'boom' }, 'https://example.com/404': { status: 404, body: 'gone' },
    'https://example.com/json': { headers: { 'content-type': 'Application/JSON' }, body: '{"ok":true}' },
  };
  await assert.rejects(fetchWith('https://example.com/png', routes), (error: unknown) => error instanceof WebGuardError && error.code === 'CONTENT_TYPE' && error.message.includes('image/png'));
  await rejectsWith(fetchWith('https://example.com/untyped', routes), 'CONTENT_TYPE');
  await assert.rejects(fetchWith('https://example.com/500', routes), (error: unknown) => error instanceof WebGuardError && error.code === 'HTTP' && error.message.includes('500'));
  await rejectsWith(fetchWith('https://example.com/404', routes), 'HTTP');
  const json = await fetchWith('https://example.com/json', routes); assert.equal(json.body, '{"ok":true}'); assert.equal(json.contentType, 'Application/JSON');
  const custom = await fetchWith('https://example.com/png', routes, { allowedTypes: ['image/png'] }); assert.equal(custom.status, 200);
});
test('total timeout covers a transport that never answers, and caller aborts propagate their reason', async () => {
  const stalled: Transport = () => new Promise(() => {});
  const started = Date.now();
  await rejectsWith(governedFetch('https://example.com/', { allowlist, lookup: publicLookup, transport: stalled, totalTimeoutMs: 40 }), 'TIMEOUT');
  assert.ok(Date.now() - started < 2000);
  await rejectsWith(governedFetch('https://example.com/', { allowlist, lookup: () => new Promise(() => {}), transport: stalled, totalTimeoutMs: 40 }), 'TIMEOUT');
  const controller = new AbortController(); controller.abort(new Error('caller stopped'));
  await assert.rejects(governedFetch('https://example.com/', { allowlist, lookup: publicLookup, transport: stalled, signal: controller.signal }), /caller stopped/);
});
test('happy path pins the resolved address, sends identifying headers and reports status/finalUrl/hops/elapsed', async () => {
  const seen: TransportRequest[] = [];
  const transport = router({ 'https://example.com/page?q=1': { body: ['<h1>hi</h1>', ' ok'] }, 'https://example.com/latin': { headers: { 'content-type': 'text/plain; charset=iso-8859-1' }, body: Uint8Array.from([0x63, 0x61, 0x66, 0xe9]) } }, seen);
  const result = await governedFetch('https://EXAMPLE.com/page?q=1', { allowlist, lookup: publicLookup, transport, headers: { 'X-Trace': 'abc' } });
  assert.deepEqual({ url: result.url, finalUrl: result.finalUrl, status: result.status, contentType: result.contentType, body: result.body, bytes: result.bytes, truncated: result.truncated, hops: result.hops },
    { url: 'https://example.com/page?q=1', finalUrl: 'https://example.com/page?q=1', status: 200, contentType: 'text/html; charset=utf-8', body: '<h1>hi</h1> ok', bytes: 14, truncated: false, hops: 0 });
  assert.ok(result.elapsedMs >= 0 && result.elapsedMs < 5000);
  assert.equal(seen.length, 1); assert.equal(seen[0].address, '93.184.216.34'); assert.equal(seen[0].family, 4); assert.equal(seen[0].url.hostname, 'example.com');
  assert.equal(seen[0].headers['user-agent'], 'Nibbi/0.8 (+local companion)'); assert.equal(seen[0].headers['accept-encoding'], 'identity'); assert.equal(seen[0].headers['x-trace'], 'abc');
  assert.match(seen[0].headers.accept, /text\/html/); assert.equal(seen[0].connectTimeoutMs, 8000); assert.equal(seen[0].signal.aborted, false);
  const latin = await governedFetch('https://example.com/latin', { allowlist, lookup: publicLookup, transport }); assert.equal(latin.body, 'café');
});

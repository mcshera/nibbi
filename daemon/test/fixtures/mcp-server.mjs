#!/usr/bin/env node
// Deterministic external MCP server fixture for mcp-clients tests. Serves over stdio or Streamable HTTP on 127.0.0.1 only.
// Usage: node mcp-server.mjs stdio | node mcp-server.mjs http <port>
// Env: FIXTURE_SECRET (read by secret_echo), FIXTURE_REQUIRED_HEADER (http mode demands x-fixture-key), FIXTURE_PID_FILE (pid written on start).
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const text = value => ({ content: [{ type: 'text', text: value }] });
const object = (properties = {}, required = []) => ({ type: 'object', properties, required });
const tools = [
  { name: 'echo', description: 'Returns the text', inputSchema: object({ text: { type: 'string' } }, ['text']) },
  { name: 'slow', description: 'Waits ms milliseconds then returns done', inputSchema: object({ ms: { type: 'number' } }, ['ms']) },
  { name: 'big', description: 'Returns x repeated bytes times', inputSchema: object({ bytes: { type: 'number' } }, ['bytes']) },
  { name: 'secret_echo', description: 'Returns FIXTURE_SECRET from the environment', inputSchema: object() },
  { name: 'fail', description: 'Reports a tool error', inputSchema: object() },
  { name: 'image', description: 'Returns an image part followed by a caption', inputSchema: object() },
];
const handlers = {
  echo: ({ text: value }) => text(String(value)),
  slow: async ({ ms }) => { await new Promise(resolve => setTimeout(resolve, Number(ms))); return text('done'); },
  big: ({ bytes }) => text('x'.repeat(Number(bytes))),
  secret_echo: () => text(process.env.FIXTURE_SECRET ?? 'unset'),
  fail: () => ({ isError: true, content: [{ type: 'text', text: 'fixture failure' }] }),
  image: () => ({ content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }, { type: 'text', text: 'caption' }] }),
};
function createFixtureServer() {
  const server = new Server({ name: 'fixture', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const handler = handlers[request.params.name];
    if (!handler) return { isError: true, content: [{ type: 'text', text: 'Unknown tool ' + request.params.name }] };
    return handler(request.params.arguments ?? {});
  });
  return server;
}

const [mode, portArg] = process.argv.slice(2);
if (process.env.FIXTURE_PID_FILE) writeFileSync(process.env.FIXTURE_PID_FILE, String(process.pid));
if (mode === 'stdio') {
  process.stdin.once('end', () => process.exit(0));
  await createFixtureServer().connect(new StdioServerTransport());
  process.stderr.write('fixture ready\n');
} else if (mode === 'http') {
  const required = process.env.FIXTURE_REQUIRED_HEADER;
  const http = createServer((req, res) => { void (async () => {
    if (required !== undefined && req.headers['x-fixture-key'] !== required) { res.writeHead(401).end('unauthorized: x-fixture-key header required'); return; }
    if (new URL(req.url ?? '/', 'http://127.0.0.1').pathname !== '/mcp') { res.writeHead(404).end(); return; }
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    // Fresh Server + transport per request, mirroring the daemon's own stateless tool service.
    const server = createFixtureServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, JSON.parse(Buffer.concat(chunks).toString('utf8')));
  })().catch(() => { if (!res.headersSent) res.writeHead(400); res.end(); }); });
  http.listen(Number(portArg), '127.0.0.1', () => process.stderr.write('fixture ready\n'));
} else {
  process.stderr.write('usage: mcp-server.mjs stdio | http <port>\n');
  process.exit(2);
}

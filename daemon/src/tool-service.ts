import { createServer, type Server as HttpServer, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync, writeFileSync, statSync, renameSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { decideTool, type ToolScope } from './policy.js';
import { canonicalPath, controlPath, within } from './paths.js';
import { sandboxCommand } from './sandbox.js';

export interface GovernedTool { name: string; description: string; inputSchema: Record<string, unknown>; call: (args: Record<string, unknown>, signal: AbortSignal) => Promise<unknown> }
export interface ToolLease { url: string; token: string; names: string[]; close: () => Promise<void> }
type Lease = { tools: GovernedTool[]; signal: AbortSignal; transports: Set<StreamableHTTPServerTransport>; pending: Set<Promise<unknown>>; responses: Set<ServerResponse>; abort: AbortController };
const leases = new Map<string, Lease>();
let server: HttpServer | undefined, port = 0;
let starting: Promise<void> | undefined;

async function start(): Promise<void> {
  if (starting) return starting;
  starting = new Promise((done, reject) => {
    server = createServer((req, res) => { void (async () => {
      const lease = leases.get(String(req.headers.authorization ?? '').replace(/^Bearer /, ''));
      if (!lease || lease.signal.aborted || req.headers.origin) { res.writeHead(403).end(); return; }
      if (req.method !== 'POST') { res.writeHead(405).end(); return; }
      lease.responses.add(res); res.on('close', () => lease.responses.delete(res));
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 2_000_000) { res.writeHead(413).end(); return; } chunks.push(chunk); }
      const mcp = new Server({ name: 'nibbi', version: '0.8.0' }, { capabilities: { tools: {} } });
      mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: lease.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema: inputSchema as { type: 'object' } })) }));
      mcp.setRequestHandler(CallToolRequestSchema, async request => {
        try {
          lease.signal.throwIfAborted();
          const tool = lease.tools.find(tool => tool.name === request.params.name);
          if (!tool) throw new Error('Tool is not authorized for this run');
          const pending = tool.call(request.params.arguments ?? {}, lease.signal); lease.pending.add(pending);
          let result: unknown; try { result = await pending; } finally { lease.pending.delete(pending); }
          return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }] };
        } catch (error) { return { isError: true, content: [{ type: 'text', text: (error as Error).message }] }; }
      });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      lease.transports.add(transport);
      res.on('close', () => { lease.transports.delete(transport); void transport.close(); void mcp.close(); });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, JSON.parse(Buffer.concat(chunks).toString('utf8')));
    })().catch(() => { if (!res.headersSent) res.writeHead(400); res.end(); }); });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const address = server!.address(); port = typeof address === 'object' && address ? address.port : 0; done(); });
  });
  return starting;
}
export async function leaseTools(tools: GovernedTool[], signal: AbortSignal): Promise<ToolLease> {
  await start(); signal.throwIfAborted();
  const token = randomBytes(32).toString('hex');
  const abort = new AbortController();
  const lease: Lease = { tools, signal: AbortSignal.any([signal, abort.signal]), transports: new Set(), pending: new Set(), responses: new Set(), abort }; leases.set(token, lease);
  const close = async (): Promise<void> => { leases.delete(token); abort.abort(new Error('Provider tool phase finished')); signal.removeEventListener('abort', close); for (const response of lease.responses) response.destroy(); await Promise.allSettled([...lease.pending, ...[...lease.transports].map(transport => transport.close())]); };
  signal.addEventListener('abort', close, { once: true });
  return { url: `http://127.0.0.1:${port}/mcp`, token, names: tools.map(tool => tool.name), close };
}
export async function closeToolService(): Promise<void> {
  for (const lease of leases.values()) { lease.abort.abort(new Error('Backend shutdown')); for (const response of lease.responses) response.destroy(); await Promise.allSettled([...lease.pending, ...[...lease.transports].map(transport => transport.close())]); }
  leases.clear();
  if (server) await new Promise<void>(resolve => { server!.close(() => resolve()); server!.closeAllConnections(); });
  server = undefined; starting = undefined;
}
const object = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({ type: 'object', properties, required, additionalProperties: false });
const string = { type: 'string' };
export function fileTools(scope: ToolScope, signal: AbortSignal): GovernedTool[] {
  const pathFor = (path: string, write = false): string => {
    const abs = canonicalPath(resolve(scope.cwd, path));
    const decision = decideTool(scope, write ? 'Write' : 'Read', { file_path: abs });
    if (!decision.allowed) throw new Error(decision.reason);
    if (write && scope.writableRoots.some(root => controlPath(root, abs))) throw new Error('Protected agent configuration');
    return abs;
  };
  return [
    { name: 'read_file', description: 'Read a scoped text file, with optional offset and length.', inputSchema: object({ path: string, offset: { type: 'integer' }, length: { type: 'integer' } }, ['path']), call: async args => {
      const input = z.object({ path: z.string(), offset: z.number().int().min(0).default(0), length: z.number().int().min(1).max(100_000).default(30_000) }).parse(args);
      const path = pathFor(input.path); if (statSync(path).size > 5_000_000) throw new Error('File exceeds 5 MB');
      return readFileSync(path, 'utf8').slice(input.offset, input.offset + input.length);
    } },
    { name: 'list_files', description: 'List files and folders within the run scope. Does not follow symlinks.', inputSchema: object({ path: string }, ['path']), call: async args => {
      const path = pathFor(z.object({ path: z.string() }).parse(args).path);
      return readdirSync(path, { withFileTypes: true }).slice(0, 1000).filter(entry => !entry.isSymbolicLink() && !['.git', 'node_modules'].includes(entry.name)).map(entry => entry.name + (entry.isDirectory() ? '/' : ''));
    } },
    { name: 'write_file', description: 'Write a scoped file. For an existing file, use edit_file to avoid overwriting unseen changes.', inputSchema: object({ path: string, text: string }, ['path', 'text']), call: async args => {
      const input = z.object({ path: z.string(), text: z.string().max(1_000_000) }).parse(args); const path = pathFor(input.path, true);
      mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, input.text, { flag: 'wx' }); return 'Created';
    } },
    { name: 'edit_file', description: 'Replace one exact, unique text match in a scoped existing file.', inputSchema: object({ path: string, oldText: string, newText: string }, ['path', 'oldText', 'newText']), call: async args => {
      const input = z.object({ path: z.string(), oldText: z.string().min(1), newText: z.string().max(1_000_000) }).parse(args); const path = pathFor(input.path, true);
      const before = readFileSync(path, 'utf8'); if (before.split(input.oldText).length !== 2) throw new Error('Expected exactly one matching text block; read the file again');
      signal.throwIfAborted(); const temporary = join(dirname(path), '.nibbi-edit-' + randomUUID()); writeFileSync(temporary, before.replace(input.oldText, () => input.newText), { flag: 'wx', mode: statSync(path).mode }); renameSync(temporary, path); return 'Updated';
    } },
    ...(scope.role === 'fixer' ? [{ name: 'shell', description: 'Run a command inside the worktree OS sandbox. Git writes, publishing and host access are denied.', inputSchema: object({ command: string }, ['command']), call: async (args: Record<string, unknown>, invocationSignal: AbortSignal) => {
      const input = z.object({ command: z.string().min(1).max(20_000) }).parse(args);
      const decision = decideTool(scope, 'Bash', { command: input.command }); if (!decision.allowed) throw new Error(decision.reason);
      return sandboxCommand(scope.cwd, input.command, { signal: AbortSignal.any([signal, invocationSignal]), readableRoots: scope.readableRoots });
    } }] : []),
  ];
}

#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { config } from './config.js';
const [, , command, ...args] = process.argv;
async function send(message: string): Promise<void> {
  const response = await fetch('http://127.0.0.1:' + config.port + '/api/send', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ message }), signal: AbortSignal.timeout(16 * 60_000) });
  const result = await response.json() as { text?: string; error?: string };
  if (!response.ok) throw new Error(result.error ?? result.text ?? 'Command failed');
  console.log(result.text);
}
try {
  switch (command) {
    case 'daemon': await (await import('./main.js')).startBackend(); break;
    case 'send': if (!args.length) throw new Error('Usage: nibbi send "message"'); await send(args.join(' ')); break;
    case 'status': { const response = await fetch('http://127.0.0.1:' + config.port + '/api/status', { signal: AbortSignal.timeout(5000) }); console.log(JSON.stringify(await response.json(), null, 2)); break; }
    case 'repl': { const terminal = createInterface({ input: process.stdin, output: process.stdout }); terminal.setPrompt('you> '); terminal.prompt(); for await (const line of terminal) { if (line === '/quit') break; try { await send(line); } catch (error) { console.error((error as Error).message); } terminal.prompt(); } terminal.close(); break; }
    default: console.log('Usage: nibbi <daemon|send|status|repl>');
  }
} catch (error) { console.error((error as Error).message); process.exitCode = 1; }

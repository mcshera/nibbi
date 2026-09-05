#!/usr/bin/env node
// One process owns the API, scheduler, skills, agents, events and responsive UI.
const args = process.argv.slice(2);
const port = args.indexOf('--port');
if (port >= 0) process.env.NIBBI_PORT = args[port + 1];
if (args.includes('--remote')) process.env.NIBBI_REMOTE = '1';
if (args.includes('--no-scheduler')) process.env.NIBBI_SCHEDULER = '0';
if (args.includes('--dev')) process.env.NIBBI_DEV = '1';
try {
  const { startBackend } = await import('./daemon/dist/main.js');
  await startBackend({ open: args.includes('--open') });
} catch (error) {
  console.error('[nibbi]', error.code === 'ERR_MODULE_NOT_FOUND' ? 'Run npm install && npm run build before starting.' : error.message);
  process.exitCode = 1;
}

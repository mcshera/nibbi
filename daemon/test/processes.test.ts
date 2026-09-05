import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execute } from '../src/processes.js';

test('timeouts reap resistant descendants even after their process-group leader exits', { timeout: 12000 }, async () => {
  // Self-expiry bounds cleanup even if the regression returns. No user process is involved.
  const descendant = "process.on('SIGTERM', () => {}); process.stdout.write('ready'); setTimeout(() => process.exit(0), 10000);";
  const leader = `const { spawn } = require('node:child_process'); const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: ['ignore', 'inherit', 'inherit'] }); child.unref();`;
  const started = Date.now(); let output = '';
  await assert.rejects(execute(process.cwd(), process.execPath, ['-e', leader], { timeoutMs: 1000, onOutput: text => { output += text; } }), /timed out/);
  assert.equal(output, 'ready');
  assert.ok(Date.now() - started < 8000, 'the descendant should be killed, not left until self-expiry');
});

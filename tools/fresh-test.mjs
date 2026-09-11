import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readlinkSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
const repo = new URL('../', import.meta.url).pathname, directory = mkdtempSync(join(tmpdir(), 'nibbi-fresh-'));
const probe = createServer(); await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); }); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const state = join(directory, 'state'), vault = join(directory, 'vault'); mkdirSync(state);
const env = { ...process.env, NIBBI_REPO: repo, NIBBI_STATE_DIR: state, NIBBI_VAULT_DIR: vault, NIBBI_WORK_DIR: join(directory, 'work'), NIBBI_PROJECTS_DIR: join(directory, 'projects'), NIBBI_OWNER: 'Fresh Tester', NIBBI_PORT: String(port), NIBBI_REMOTE: '0', NIBBI_LEGACY_API: '0', NIBBI_SCHEDULER: '0' };
env.NIBBI_RIPGREP = execFileSync('/usr/bin/which', ['rg'], { encoding: 'utf8' }).trim();
let child, exited;
const stop = async () => { if (!child) return; child.kill('SIGTERM'); let timer; try { await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Fixture backend did not shut down')), 10000); })]); } finally { clearTimeout(timer); if (child.exitCode === null) { child.kill('SIGKILL'); await exited; } child = undefined; } };
const boot = async () => {
  child = spawn(process.execPath, ['server.mjs'], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] }); exited = once(child, 'exit'); let log = ''; child.stdout.on('data', chunk => { log += chunk; }); child.stderr.on('data', chunk => { log += chunk; });
  const deadline = Date.now() + 10000;
  for (;;) { try { const response = await fetch('http://127.0.0.1:' + port + '/nibbi/health'); if (response.ok) return await response.json(); } catch { /* startup */ } if (child.exitCode !== null || Date.now() > deadline) throw new Error('Fixture startup failed: ' + log); await new Promise(resolve => setTimeout(resolve, 50)); }
};
try {
  execFileSync(process.execPath, ['tools/install-state.mjs', '--preflight'], { cwd: repo, env });
  execFileSync(process.execPath, ['tools/install-state.mjs'], { cwd: repo, env });
  assert.match(readFileSync(join(vault, 'SOUL.md'), 'utf8'), /Fresh Tester/);
  assert.equal(JSON.parse(readFileSync(join(state, 'host.json'), 'utf8')).vaultDir, vault);
  assert.equal(readlinkSync(join(state, 'bin', 'rg')), env.NIBBI_RIPGREP);
  const sandboxOutput = execFileSync(process.execPath, ['--input-type=module', '-e', 'import { sandboxCommand } from "./daemon/dist/sandbox.js"; const result = await sandboxCommand(process.env.NIBBI_PROJECTS_DIR, "node --version"); process.stdout.write(result.stdout);'], { cwd: repo, env: { ...env, PATH: dirname(process.execPath) + ':/usr/bin:/bin' }, encoding: 'utf8' });
  assert.equal(sandboxOutput.trim(), process.version);
  writeFileSync(join(state, 'fixers.json'), JSON.stringify([{ id: 'legacy-review', game: 'legacy', status: 'done', startedAt: new Date().toISOString(), worktree: join(directory, 'retained'), branch: 'legacy-branch', issue: 'Legacy evidence' }]));
  writeFileSync(join(state, 'auto.json'), JSON.stringify({ legacy: { on: true, autoMerge: true } }));
  writeFileSync(join(state, 'chat-history.jsonl'), JSON.stringify({ ts: new Date().toISOString(), role: 'user', channel: 'app', text: 'Preserve this memory' }) + '\n');
  const health = await boot(); assert.equal(health.app, 'nibbi'); assert.equal(health.protocolVersion, 1); assert.equal(health.status.vault, vault);
  const snapshot = await (await fetch('http://127.0.0.1:' + port + '/api/snapshot')).json(); assert.equal(snapshot.fixers[0].status, 'staged'); assert.equal(snapshot.fixers[0].verification.status, 'unverified');
  assert.ok(existsSync(join(state, 'fixers.json'))); assert.ok(readdirSync(join(state, 'backups')).some(name => name.startsWith('pre-platform-')));
  await stop();
  const source = readFileSync(join(vault, 'SOUL.md'), 'utf8'); execFileSync(process.execPath, ['tools/install-state.mjs'], { cwd: repo, env }); assert.equal(readFileSync(join(vault, 'SOUL.md'), 'utf8'), source);
  await boot(); const history = await (await fetch('http://127.0.0.1:' + port + '/api/history')).json(); assert.equal(history.filter(row => row.text === 'Preserve this memory').length, 1);
  console.log('Fresh-state rehearsal passed: isolated installer state, compiled sandbox with minimal PATH, vault, backup, legacy review, restart and no duplicate history. No account or launchd changes.');
} finally { await stop(); rmSync(directory, { recursive: true, force: true }); }

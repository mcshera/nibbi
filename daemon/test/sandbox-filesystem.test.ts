import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { createServer as createHTTPServer } from 'node:http';

// Reproduce the native application's /Users/... worktree and private cache
// layout. A /tmp-only fixture misses the overlapping home movement denial.
const directory = mkdtempSync(join(homedir(), '.nibbi-sandbox-filesystem-test-'));
const stateDirectory = mkdtempSync('/private/tmp/nibbi-sbx-state-');
const worktree = join(directory, 'work');
mkdirSync(worktree);
for (const [key, folder] of Object.entries({ NIBBI_STATE_DIR: 'state', NIBBI_VAULT_DIR: 'vault', NIBBI_WORK_DIR: 'work', NIBBI_PROJECTS_DIR: 'projects' })) {
  process.env[key] = key === 'NIBBI_STATE_DIR' ? stateDirectory : join(directory, folder); mkdirSync(process.env[key]!, { recursive: true });
}
const { sandboxCommand } = await import('../src/sandbox.js');
after(() => { rmSync(directory, { recursive: true, force: true }); rmSync(stateDirectory, { recursive: true, force: true }); });

test('native sandbox supports npm cache replacement and repeated clean installation in its own worktree', async () => {
  const packageRoot = join(directory, 'dependency', 'package');
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: 'nibbi-fixture-dependency', version: '1.0.0', main: 'index.js' }));
  writeFileSync(join(packageRoot, 'index.js'), 'module.exports = 42;\n');
  execFileSync('tar', ['-czf', join(worktree, 'fixture-package.tgz'), '-C', join(directory, 'dependency'), 'package']);
  writeFileSync(join(worktree, 'package.json'), JSON.stringify({ name: 'sandbox-install-fixture', version: '1.0.0', private: true, dependencies: { 'nibbi-fixture-dependency': 'file:fixture-package.tgz' } }));
  execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', join(directory, 'lock-cache')], { cwd: worktree, stdio: 'pipe' });
  writeFileSync(join(worktree, 'check.cjs'), `const fs = require('node:fs');
const assert = require('node:assert/strict');
assert.equal(require('nibbi-fixture-dependency'), 42);
assert.equal(process.env.npm_config_devdir, require('node:path').join(process.env.TMPDIR, 'node-gyp'));
fs.mkdirSync(process.env.npm_config_devdir);
fs.writeFileSync(require('node:path').join(process.env.npm_config_devdir, 'installVersion'), 'fixture');
fs.writeFileSync('temporary.txt', 'temporary');
fs.renameSync('temporary.txt', 'renamed.txt');
fs.unlinkSync('renamed.txt');
fs.mkdirSync('temporary-directory');
fs.rmdirSync('temporary-directory');
console.log('dependency installed; rename, unlink and rmdir passed');
`);
  const result = await sandboxCommand(worktree, 'npm ci --ignore-scripts && npm ci --ignore-scripts && npm cache clean --force && node check.cjs');
  assert.match(result.stdout, /dependency installed; rename, unlink and rmdir passed/);
  assert.equal(JSON.parse(readFileSync(join(worktree, 'node_modules/nibbi-fixture-dependency/package.json'), 'utf8')).version, '1.0.0');
});

test('scoped movement preserves credential, Git metadata, control-file and outside-worktree denials', async () => {
  const outside = join(directory, 'outside-owner.txt');
  writeFileSync(outside, 'isolated owner fixture');
  writeFileSync(join(worktree, '.env'), 'FIXTURE_ONLY=private');
  writeFileSync(join(worktree, 'AGENTS.md'), 'Protected fixture instructions');
  mkdirSync(join(worktree, '.git'));
  writeFileSync(join(worktree, '.git/config'), '[core]\nrepositoryformatversion = 0\n');
  mkdirSync(join(worktree, 'nested/.git'), { recursive: true });
  writeFileSync(join(worktree, 'nested/.git/config'), 'nested protected fixture');
  writeFileSync(join(worktree, 'confinement.cjs'), `const fs = require('node:fs');
const assert = require('node:assert/strict');
const blocked = (name, action) => assert.throws(action, /EPERM|EACCES/, name);
blocked('read credential', () => fs.readFileSync('.env'));
blocked('rename credential', () => fs.renameSync('.env', 'exposed-env'));
blocked('unlink credential', () => fs.unlinkSync('.env'));
blocked('hardlink credential', () => fs.linkSync('.env', 'linked-env'));
blocked('write Git metadata', () => fs.writeFileSync('.git/config', 'changed'));
blocked('unlink Git metadata', () => fs.unlinkSync('.git/config'));
blocked('rename Git directory', () => fs.renameSync('.git', 'moved-git'));
blocked('nested Git metadata', () => fs.unlinkSync('nested/.git/config'));
blocked('rename agent controls', () => fs.renameSync('AGENTS.md', 'moved-controls'));
blocked('read outside', () => fs.readFileSync(${JSON.stringify(outside)}));
blocked('write outside', () => fs.writeFileSync(${JSON.stringify(outside)}, 'changed'));
blocked('move denied outside file into worktree', () => fs.renameSync(${JSON.stringify(outside)}, 'stolen-owner'));
console.log('all confinement guards passed');
`);
  const result = await sandboxCommand(worktree, 'node confinement.cjs');
  assert.match(result.stdout, /all confinement guards passed/);
  assert.equal(readFileSync(outside, 'utf8'), 'isolated owner fixture');
  assert.equal(readFileSync(join(worktree, '.env'), 'utf8'), 'FIXTURE_ONLY=private');
  assert.equal(readFileSync(join(worktree, '.git/config'), 'utf8'), '[core]\nrepositoryformatversion = 0\n');
  assert.equal(readFileSync(join(worktree, 'AGENTS.md'), 'utf8'), 'Protected fixture instructions');
});

test('toolchain Unix IPC works only inside this command scratch directory', async () => {
  const hostDirectory = mkdtempSync('/private/tmp/nibbi-host-ipc-');
  const hostPath = join(hostDirectory, 'host.sock');
  let hostConnections = 0;
  const host = createServer(socket => { hostConnections++; socket.end(); });
  await new Promise<void>(resolve => host.listen(hostPath, resolve));
  writeFileSync(join(worktree, 'ipc.cjs'), `const net = require('node:net');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const socket = path.join(process.env.TMPDIR, 'toolchain.sock');
  assert.ok(Buffer.byteLength(socket) < 100, 'fixture socket fits macOS path limit');
  const server = net.createServer(client => client.end('private IPC works'));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socket, resolve); });
  const data = await new Promise((resolve, reject) => { let text = ''; const client = net.connect(socket); client.on('data', value => text += value); client.once('error', reject); client.once('end', () => resolve(text)); });
  assert.equal(data, 'private IPC works');
  await new Promise(resolve => server.close(resolve));
  await new Promise((resolve, reject) => {
    const forbidden = net.createServer();
    forbidden.once('error', error => { try { assert.match(error.code, /EPERM|EACCES/); resolve(); } catch (e) { reject(e); } });
    forbidden.listen(path.join(process.cwd(), 'outside-scratch.sock'), () => { forbidden.close(); reject(new Error('Unix bind outside scratch was allowed')); });
  });
  await new Promise((resolve, reject) => {
    const client = net.connect(${JSON.stringify(hostPath)});
    client.once('connect', () => { client.destroy(); reject(new Error('Host service socket was reachable')); });
    client.once('error', error => { try { assert.match(error.code, /EPERM|EACCES/); resolve(); } catch (e) { reject(e); } });
  });
  console.log('private IPC passed; outside bind and host service connection denied');
})().catch(error => { console.error(error); process.exitCode = 1; });
`);
  try {
    const result = await sandboxCommand(worktree, 'node ipc.cjs', { readableRoots: [hostDirectory] });
    assert.match(result.stdout, /private IPC passed; outside bind and host service connection denied/);
    assert.equal(hostConnections, 0);
  } finally {
    await new Promise<void>(resolve => host.close(() => resolve()));
    rmSync(hostDirectory, { recursive: true, force: true });
  }
});


test('proxy cleanup preserves successful and failing command exit status after network use', async () => {
  const server = createHTTPServer((_request, response) => { response.writeHead(200); response.end('fixture download'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  writeFileSync(join(worktree, 'proxy.cjs'), `const http = require('node:http');
const assert = require('node:assert/strict');
const proxy = new URL(process.env.HTTP_PROXY);
http.get({ hostname: proxy.hostname, port: proxy.port, path: 'http://127.0.0.1:${port}/fixture' }, response => {
  let body = ''; response.on('data', part => body += part); response.on('end', () => {
    assert.equal(response.statusCode, 200); assert.equal(body, 'fixture download');
    console.log('proxied fixture received'); process.exit(Number(process.argv[2]));
  });
}).on('error', error => { console.error(error); process.exit(1); });
`);
  try {
    const result = await sandboxCommand(worktree, 'node proxy.cjs 0', { domains: ['127.0.0.1'] });
    assert.match(result.stdout, /proxied fixture received/);
    await assert.rejects(sandboxCommand(worktree, 'node proxy.cjs 37', { domains: ['127.0.0.1'] }), /exited 37/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

export async function testBackend() {
  const directory = mkdtempSync(join(tmpdir(), 'nibbi-browser-'));
  const probe = createServer(); await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  process.env.NIBBI_PORT = String(port); process.env.NIBBI_LEGACY_API = '0'; process.env.NIBBI_REMOTE = '0'; process.env.NIBBI_SCHEDULER = '0';
  for (const [name, folder] of Object.entries({ NIBBI_STATE_DIR: 'state', NIBBI_VAULT_DIR: 'vault', NIBBI_WORK_DIR: 'work', NIBBI_PROJECTS_DIR: 'projects' })) { process.env[name] = join(directory, folder); mkdirSync(process.env[name]); }
  writeFileSync(join(directory, 'vault', 'MEMORY.md'), '# Fixture memory\n\nA private, temporary test vault.\n');
  mkdirSync(join(directory, 'vault', 'plans')); writeFileSync(join(directory, 'vault', 'plans', 'fixture.md'), '# Plan\n\n## M1: Fixture\n- [ ] Test the review flow\n');
  const { startBackend } = await import('../daemon/dist/main.js'); const backend = await startBackend();
  const { createProject } = await import('../daemon/dist/projects.js'); const project = await createProject('fixture');
  mkdirSync(join(directory, 'vault', 'games', 'fixture'), { recursive: true });
  writeFileSync(join(directory, 'vault', 'games', 'fixture', 'issues.md'), '# Fixture issues\n\n- [ ] Keep keyboard focus visible <!-- nibbi-issue:fixture-focus -->\n  Check the play button and issue controls.\n- [ ] Improve the welcome screen <!-- nibbi-issue:fixture-welcome --> <!-- nibbi-status:in-progress -->\n  Make the next step clear.\n- [x] Save the last visit <!-- nibbi-issue:fixture-visit -->\n');
  const { runtime } = await import('../daemon/dist/store.js');
  for (let i = 0; i < 15; i++) {
    const run = { id: 'fixture-' + i, game: 'fixture', project: 'fixture', title: 'Review fixture ' + i, issue: 'Verify review failure behavior', status: i === 0 ? 'staged' : 'failed', provider: 'claude', repo: project.repo, worktree: join(directory, 'work', 'fixture-' + i), branch: 'main', startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), verification: { status: 'unverified' }, summary: 'Test fixture; no provider was called.' };
    if (i === 0) {
      mkdirSync(run.worktree, { recursive: true });
      writeFileSync(join(run.worktree, 'package.json'), JSON.stringify({ scripts: { dev: 'node serve.mjs' } }));
      writeFileSync(join(run.worktree, 'serve.mjs'), `import { createServer } from 'node:http';
const server = createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html><head><title>Fixture build preview</title></head><body style="font:20px system-ui;padding:48px"><h1>Your build is running</h1><p>This preview belongs to the selected fixture build.</p><button onclick="this.textContent=Number(this.textContent)+1" style="font:inherit;padding:16px 32px">0</button></body></html>'); });
server.listen(0, '127.0.0.1', () => console.log('http://127.0.0.1:' + server.address().port));`);
    }
    runtime().put('fixers', run.id, run);
  }
  return { directory, base: 'http://127.0.0.1:' + port, close: async () => { await backend.close(); rmSync(directory, { recursive: true, force: true }); } };
}
if (process.argv[1] === new URL(import.meta.url).pathname) { const fixture = await testBackend(); console.log('Fixture URL:', fixture.base); }

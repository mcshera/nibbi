import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

const SERVE = `import { createServer } from 'node:http';
const server = createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html><head><title>Fixture build preview</title></head><body style="font:20px system-ui;padding:48px"><h1>Your build is running</h1><p>This preview belongs to the selected fixture build.</p><button onclick="this.textContent=Number(this.textContent)+1" style="font:inherit;padding:16px 32px">0</button></body></html>'); });
server.listen(0, '127.0.0.1', () => console.log('http://127.0.0.1:' + server.address().port));`;

/** An isolated backend for the browser suites. `copies: true` (docs/BUILDS-AS-COPIES.md §6.3) also gives the
    fixture project a real check and a deterministic fixer, and makes a copy "dev" through the daemon's own
    createCopy — real git in the temp repo, so a copy can take an improvement, ship, catch up and retire.
    Off by default: every other suite sees main alone. A suite that checks main alone first and a copy after
    calls enableCopies() when it gets there (one backend per process: the daemon's modules are singletons). */
export async function testBackend({ realProviders = false, copies = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'nibbi-browser-'));
  // A fixture never reaches the owner's provider accounts unless it asks to. The Providers tab checks
  // sign-in as it opens, and that check starts the claude CLI and a Codex RPC; here both point nowhere
  // and answer "not signed in" at once. tools/provider-smoke.mjs is the one check that wants the real ones.
  if (!realProviders) for (const name of ['NIBBI_CLAUDE_BIN', 'NIBBI_CODEX_BIN']) process.env[name] = join(directory, 'no-provider-here');
  const probe = createServer(); await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  process.env.NIBBI_PORT = String(port); process.env.NIBBI_LEGACY_API = '0'; process.env.NIBBI_REMOTE = '0'; process.env.NIBBI_SCHEDULER = '0';
  for (const [name, folder] of Object.entries({ NIBBI_STATE_DIR: 'state', NIBBI_VAULT_DIR: 'vault', NIBBI_WORK_DIR: 'work', NIBBI_PROJECTS_DIR: 'projects' })) { process.env[name] = join(directory, folder); mkdirSync(process.env[name]); }
  writeFileSync(join(directory, 'vault', 'MEMORY.md'), '# Fixture memory\n\nA private, temporary test vault.\n');
  mkdirSync(join(directory, 'vault', 'plans')); writeFileSync(join(directory, 'vault', 'plans', 'fixture.md'), '# Plan\n\n## M1: Fixture\n- [ ] Test the review flow\n');
  const { startBackend } = await import('../daemon/dist/main.js'); const backend = await startBackend();
  const { createProject, updateProject } = await import('../daemon/dist/projects.js'); const project = await createProject('fixture');
  mkdirSync(join(directory, 'vault', 'games', 'fixture'), { recursive: true });
  writeFileSync(join(directory, 'vault', 'games', 'fixture', 'issues.md'), '# Fixture issues\n\n- [ ] Keep keyboard focus visible <!-- nibbi-issue:fixture-focus -->\n  Check the play button and issue controls.\n- [ ] Improve the welcome screen <!-- nibbi-issue:fixture-welcome --> <!-- nibbi-status:in-progress -->\n  Make the next step clear.\n- [x] Save the last visit <!-- nibbi-issue:fixture-visit -->\n');
  const { runtime } = await import('../daemon/dist/store.js');
  for (let i = 0; i < 15; i++) {
    const run = { id: 'fixture-' + i, game: 'fixture', project: 'fixture', title: 'Review fixture ' + i, issue: 'Verify review failure behavior', status: i === 0 ? 'staged' : 'failed', provider: 'claude', repo: project.repo, worktree: join(directory, 'work', 'fixture-' + i), branch: 'main', startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), verification: { status: 'unverified' }, summary: 'Test fixture; no provider was called.' };
    if (i === 0) {
      mkdirSync(run.worktree, { recursive: true });
      writeFileSync(join(run.worktree, 'package.json'), JSON.stringify({ scripts: { dev: 'node serve.mjs' } }));
      writeFileSync(join(run.worktree, 'serve.mjs'), SERVE);
    }
    runtime().put('fixers', run.id, run);
  }
  // Conversation seeds go through the daemon's own writers, so a thread is renamed and announced
  // exactly as a real message would do it. Rows default to the fixture's home thread in the app.
  const history = await import('../daemon/dist/history.js'), threads = await import('../daemon/dist/threads.js');
  let clock = Date.now() - 3600000;
  const seedChat = rows => rows.map(row => history.logChat({ ts: row.ts ?? new Date(clock += 1000).toISOString(), channel: 'app', project: 'fixture', ...row, role: row.role === 'user' ? 'user' : 'oracle' }));
  const createThread = (title, projectId = 'fixture') => threads.createThread(projectId, title);
  const emit = event => runtime().emit(event);   // something the daemon says on /api/events, e.g. a brief while the window is away
  let copyKit = null;
  const restoreProviders = [];
  async function enableCopies() {
    if (copyKit) return copyKit;
    process.env.NODE_ENV = 'test';   // the deterministic fixer below is a test provider (providers/index.ts refuses one otherwise)
    const processes = await import('../daemon/dist/processes.js'), { replaceProviderForTest } = await import('../daemon/dist/providers/index.js');
    const fixer = await import('../daemon/dist/fixer.js'), made = await import('../daemon/dist/project-copies.js');
    const git = (...args) => processes.git(project.repo, ...args);
    // main and its copies both play as servers; the check is real, so a change can land and ship
    writeFileSync(join(project.repo, 'package.json'), JSON.stringify({ scripts: { dev: 'node serve.mjs' } }, null, 2) + '\n');
    writeFileSync(join(project.repo, 'serve.mjs'), SERVE + '\n');
    await git('add', 'package.json', 'serve.mjs'); await git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Play as a server');
    updateProject('fixture', { check: 'test -f README.md', install: 'true' });
    // the fixer writes a file named by its own count, holding the words it was given: deterministic, and no provider is called
    let serial = 0;
    for (const id of ['claude', 'codex']) restoreProviders.push(replaceProviderForTest(id, { id, capabilities: { streaming: true, steering: true, cancellation: true, skills: true, tools: true, images: true }, start: input => ({
      result: Promise.resolve().then(() => { if (input.role === 'fixer') writeFileSync(join(input.cwd, 'fixture-change-' + (++serial) + '.txt'), String(input.prompt)); return { text: 'Fixture change is ready.', isError: false }; }), cancel: async () => {}, steer: async () => {},
    }) }));
    const createCopy = async name => { const view = await made.createCopy('fixture', name); await made.waitForCopy(view.id); return view; };
    /** An improvement on a copy, started as the bar starts one, and waited for until it has landed (or failed). */
    const improve = async (copyId, text) => { const run = fixer.spawnFixer('fixture', text, async () => {}, { copyId, title: text.slice(0, 80) }); await fixer.waitForFixer(run.id); return runtime().get('fixers', run.id); };
    const dev = await createCopy('dev');
    copyKit = { dev, createCopy, improve, git, copiesView: () => made.copiesView('fixture') };
    return copyKit;
  }
  if (copies) await enableCopies();
  return { directory, base: 'http://127.0.0.1:' + port, seedChat, createThread, emit, enableCopies, ...(copyKit ? { copies: copyKit } : {}), close: async () => { await backend.close(); for (const restore of restoreProviders) restore(); rmSync(directory, { recursive: true, force: true }); } };
}
if (process.argv[1] === new URL(import.meta.url).pathname) { const fixture = await testBackend(); console.log('Fixture URL:', fixture.base); }

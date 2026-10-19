// A real crash for project-copies.test.ts, in a process of its own (the parent points NIBBI_* at its temp dirs).
//   start — three projects, each with a copy: one ships, one catches up, one lands a try in it. Each check hangs in its
//           merge-<uuid> worktree (it touches hung.flag there, then sleeps) while <repo>/hang.flag exists; the parent
//           SIGKILLs this process once all three hang. Prints one line: {"started":true,...}.
//   boot  — starts again as main.ts does (reconcileFixers, then reconcileCopies), waits for the interrupted landing
//           to land again, and prints one line: {"boot":true,...} — what is left on disk, in git and in the store.
import { writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

process.env.NODE_ENV = 'test';
const mode = process.argv[2];
const { git } = await import('../../src/processes.js');
const { createProject, updateProject, games } = await import('../../src/projects.js');
const fixer = await import('../../src/fixer.js');
const copies = await import('../../src/project-copies.js');
const records = await import('../../src/copy-records.js');
const { replaceProviderForTest } = await import('../../src/providers/index.js');
const { runtime, closeRuntime } = await import('../../src/store.js');
const { closeToolService } = await import('../../src/tool-service.js');
const { config } = await import('../../src/config.js');

// The agent writes the file its prompt's first word names.
replaceProviderForTest('claude', { id: 'claude', capabilities: { streaming: true, steering: true, cancellation: true, skills: true, tools: true, images: true }, start: input => ({
  result: (async () => { const [file, ...rest] = input.prompt.split('\n')[0].split(' '); writeFileSync(join(input.cwd, file), (rest.join(' ') || file) + '\n'); return { text: 'wrote ' + file, isError: false }; })(),
  cancel: async () => undefined, steer: async () => undefined,
}) });
const notify = async (): Promise<void> => undefined;
const PROJECTS = ['crash-ship', 'crash-catchup', 'crash-land'] as const;
const check = (repo: string): string => `if [ -f '${repo}/hang.flag' ]; then case "$(pwd)" in */merge-*) touch hung.flag; sleep 30;; esac; fi; test ! -f bad.txt`;
const copyOf = (project: string) => records.liveCopies(project)[0];

if (mode === 'start') {
  const repos: Record<string, string> = {};
  for (const name of PROJECTS) {
    const { repo } = await createProject(name); repos[name] = repo; updateProject(name, { check: check(repo) });
    writeFileSync(join(repo, '.gitignore'), '*.flag\n'); await git(repo, 'add', '.gitignore'); await git(repo, 'commit', '-m', 'flags are not the project’s');
    const view = await copies.createCopy(name, 'dev'); await copies.waitForCopy(view.id);
  }
  // crash-ship: dev holds one landed try; crash-catchup: main moved on.
  const landed = fixer.spawnFixer('crash-ship', 'a.txt to ship', notify, { copyId: copyOf('crash-ship').id }); await fixer.waitForFixer(landed.id);
  writeFileSync(join(repos['crash-catchup'], 'main.txt'), 'main\n'); await git(repos['crash-catchup'], 'add', 'main.txt'); await git(repos['crash-catchup'], 'commit', '-m', 'main moves on');
  const before = Object.fromEntries(await Promise.all(PROJECTS.map(async name => [name, { main: await git(repos[name], 'rev-parse', 'main'), head: copyOf(name).headSha, copyId: copyOf(name).id }])));
  for (const name of PROJECTS) writeFileSync(join(repos[name], 'hang.flag'), '');
  void copies.shipCopy('crash-ship', copyOf('crash-ship').id, copyOf('crash-ship').headSha).catch(() => undefined);
  void copies.catchUpCopy('crash-catchup', copyOf('crash-catchup').id, copyOf('crash-catchup').headSha).catch(() => undefined);
  const run = fixer.spawnFixer('crash-land', 'b.txt interrupted', notify, { copyId: copyOf('crash-land').id });
  console.log(JSON.stringify({ started: true, repos, before, landed: landed.id, run: run.id, workDir: config.workDir }));
  await new Promise(() => undefined);   // the parent kills this process
}

if (mode === 'boot') {
  const runId = process.argv[3];
  await fixer.reconcileFixers(); await copies.reconcileCopies();
  // The try interrupted mid-landing lands again on its own (reconcileCopies' landWaiting, not awaited by boot).
  const end = Date.now() + 30_000;
  while (runtime().get<{ status: string }>('fixers', runId)?.status !== 'merged' && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 50));
  await fixer.waitForFixer(runId);
  const report: Record<string, unknown> = { boot: true, run: runtime().get<{ status: string }>('fixers', runId)?.status };
  report.projects = Object.fromEntries(await Promise.all(PROJECTS.map(async name => {
    const repo = games()[name].repo, copy = copyOf(name);
    const listed = (await git(repo, 'worktree', 'list', '--porcelain')).split('\n').filter(line => line.startsWith('worktree ') && line.includes('/merge-'));
    return [name, { status: copy.status, intent: copy.intent, head: copy.headSha, branch: await git(repo, 'rev-parse', copy.branch), main: await git(repo, 'rev-parse', 'main'), mergeWorktrees: listed }];
  })));
  report.mergeDirs = existsSync(config.workDir) ? readdirSync(config.workDir).filter(name => name.startsWith('merge-')) : [];
  report.pending = runtime().list('pending-merges').length;
  console.log(JSON.stringify(report));
  await closeToolService(); closeRuntime(); process.exit(0);
}

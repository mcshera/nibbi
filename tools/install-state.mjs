import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, copyFileSync, renameSync, cpSync, symlinkSync, lstatSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
const repo = process.env.NIBBI_REPO || new URL('../', import.meta.url).pathname;
const state = process.env.NIBBI_STATE_DIR || join(homedir(), '.nibbi');
const vault = process.env.NIBBI_VAULT_DIR || join(homedir(), 'NibbiVault');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = join(state, 'backups', 'installer-' + stamp);
if (process.argv.includes('--preflight')) {
  const database = join(state, 'runtime.sqlite');
  if (existsSync(database)) {
    const { default: Database } = await import('better-sqlite3'); const db = new Database(database, { readonly: true, fileMustExist: true });
    try { const active = db.prepare("SELECT count(*) AS count FROM records WHERE bucket IN ('fixers','lead-runs') AND json_extract(value,'$.status') IN ('installing','running','verifying','awaiting_input')").get(); if (active.count) throw new Error('Nibbi has active runs. Stop them and wait for completion before installing.'); }
    finally { db.close(); }
    process.exit(0);
  }
  const legacy = join(state, 'fixers.json');
  if (existsSync(legacy)) { const runs = JSON.parse(readFileSync(legacy, 'utf8')); if (runs.some(run => ['installing', 'running'].includes(run.status))) throw new Error('Legacy runs are still marked active. Stop and inspect them in the old app before migrating; do not delete their worktrees.'); }
  process.exit(0);
}
if (process.argv.includes('--wait-stopped')) {
  const lock = join(state, 'backend.lock'), deadline = Date.now() + 10000;
  while (existsSync(lock)) {
    const pid = Number(readFileSync(lock, 'utf8')); if (!Number.isInteger(pid) || pid < 1) throw new Error('Invalid backend owner lock; inspect it before migration');
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') break; throw error; }
    if (Date.now() >= deadline) throw new Error('A manually started backend is still running. Stop that backend before installing.');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  process.exit(0);
}
mkdirSync(state, { recursive: true, mode: 0o700 });
const save = (file, text) => { if (existsSync(file)) { mkdirSync(backup, { recursive: true }); copyFileSync(file, join(backup, file.split('/').pop())); } mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text, { mode: 0o600 }); };
if (process.argv.includes('--launchd')) {
  const directory = join(homedir(), 'Library', 'LaunchAgents'); mkdirSync(directory, { recursive: true });
  const oldHost = join(directory, 'com.nibbi.host.plist'); if (existsSync(oldHost)) { mkdirSync(backup, { recursive: true }); renameSync(oldHost, join(backup, 'com.nibbi.host.plist')); }
  const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  for (const name of ['com.nibbi.gateway', 'com.nibbi.kokoro', 'com.nibbi.whisper']) {
    const template = readFileSync(join(repo, 'launchd', 'templates', name + '.plist'), 'utf8');
    const values = { __HOME__: homedir(), __REPO__: repo, __NODE__: process.env.NIBBI_NODE || process.execPath, __NODEDIR__: dirname(process.env.NIBBI_NODE || process.execPath), __STATE__: state, __VAULT__: vault, __WORK__: process.env.NIBBI_WORK_DIR || join(homedir(), 'NibbiWork', 'fixers'), __PROJECTS__: process.env.NIBBI_PROJECTS_DIR || join(homedir(), 'NibbiProjects'), __PORT__: process.env.NIBBI_PORT || '4527' };
    save(join(directory, name + '.plist'), template.replace(/__[A-Z]+__/g, token => escape(values[token] ?? token)));
  }
  process.exit(0);
}
for (const folder of [join(state, 'logs'), join(state, 'tmp'), join(state, 'bin'), process.env.NIBBI_WORK_DIR || join(homedir(), 'NibbiWork', 'fixers'), process.env.NIBBI_PROJECTS_DIR || join(homedir(), 'NibbiProjects')]) mkdirSync(folder, { recursive: true });
save(join(state, 'host.json'), JSON.stringify({ path: join(repo, 'server.mjs'), node: process.env.NIBBI_NODE || process.execPath, repo, port: Number(process.env.NIBBI_PORT || 4527), stateDir: state, vaultDir: vault, workDir: process.env.NIBBI_WORK_DIR || join(homedir(), 'NibbiWork', 'fixers'), projectsDir: process.env.NIBBI_PROJECTS_DIR || join(homedir(), 'NibbiProjects') }, null, 2));
if (!existsSync(vault)) {
  cpSync(join(repo, 'vault-template'), vault, { recursive: true });
  const fill = directory => { for (const entry of readdirSync(directory, { withFileTypes: true })) { const path = join(directory, entry.name); if (entry.isDirectory()) fill(path); else if (entry.name.endsWith('.md')) writeFileSync(path, readFileSync(path, 'utf8').replaceAll('{{OWNER}}', process.env.NIBBI_OWNER || 'you').replaceAll('{{REPO}}', repo).replaceAll('{{DATE}}', new Date().toISOString().slice(0, 10))); } }; fill(vault);
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Nibbi', '-c', 'user.email=nibbi@local', ...args], { cwd: vault, stdio: 'ignore' }); git('init', '-b', 'main'); git('add', '-A'); git('commit', '-m', 'Create Nibbi memory vault');
}
for (const name of ['transcribe', 'tts-kokoro', 'kokoro-server.py', 'whisper-server.py', 'nibbi-doctor']) { const source = join(repo, 'daemon', 'state-bin', name); if (existsSync(source)) copyFileSync(source, join(state, 'bin', name)); }
if (process.env.NIBBI_FFMPEG) { const link = join(state, 'bin', 'ffmpeg'); if (!existsSync(link)) symlinkSync(process.env.NIBBI_FFMPEG, link); }
// Keep the sandbox dependency discoverable when launchd has a minimal PATH.
if (process.env.NIBBI_RIPGREP) {
  const link = join(state, 'bin', 'rg');
  if (lstatSync(link, { throwIfNoEntry: false })) { mkdirSync(backup, { recursive: true }); renameSync(link, join(backup, 'rg')); }
  symlinkSync(process.env.NIBBI_RIPGREP, link);
}
console.log('Prepared state and vault. Runtime JSON migration runs once on backend startup; originals are backed up and retained.');

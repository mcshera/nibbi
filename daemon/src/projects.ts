import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { ProjectSettings } from '@nibbi/contracts';
import { ProjectSettingsSchema } from '@nibbi/contracts';
import { runtime } from './store.js';
import { config } from './config.js';
import { canonicalPath } from './paths.js';
import { git } from './processes.js';

export interface GameCfg { repo: string; install: string; check: string; targetBranch?: string; play?: string; settings?: ProjectSettings; installDomains?: string[]; webDomains?: string[] }
export const defaultSettings = (): ProjectSettings => ({ lead: { provider: 'claude' }, fixer: { provider: 'claude' } });
export function games(): Record<string, GameCfg> {
  const store = runtime();
  let all = store.get<Record<string, GameCfg>>('config', 'projects');
  if (!all) { all = store.get<Record<string, GameCfg>>('legacy', 'games.json') ?? {}; store.put('config', 'projects', all); }
  return all;
}
export function mergeTarget(repo: string): string {
  const branch = execFileSync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8', timeout: 5000 }).trim();
  if (!branch) throw new Error('Project must have a checked-out branch'); return branch;
}
export function projectSettings(project: string): ProjectSettings { return games()[project]?.settings ?? runtime().get<ProjectSettings>('config', 'default-settings') ?? defaultSettings(); }
export function updateProject(project: string, changes: Partial<GameCfg>): GameCfg {
  if (project === 'vault' && changes.settings) { const settings = ProjectSettingsSchema.parse(changes.settings); runtime().put('config', 'default-settings', settings); return { repo: config.vaultDir, install: 'true', check: 'true', settings }; }
  const all = games(); const previous = all[project]; if (!previous) throw new Error('Unknown project');
  if (changes.settings) ProjectSettingsSchema.parse(changes.settings);
  const next = { ...previous, ...changes }; all[project] = next;
  runtime().put('config', 'projects', all, { type: 'project.updated', projectId: project, payload: { project } }); return next;
}
function detectCommands(repo: string): { install: string; check: string } {
  if (!existsSync(join(repo, 'package.json'))) return { install: 'true', check: 'true' };
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
  const checks = ['typecheck', 'check', 'lint', 'validate', 'test'].filter(name => pkg.scripts?.[name]).map(name => `npm run ${name}`);
  return { install: existsSync(join(repo, 'package-lock.json')) ? 'npm ci' : 'npm install', check: checks.join(' && ') || 'true' };
}
export async function registerProject(name: string, repo: string): Promise<GameCfg> {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); if (!slug) throw new Error('Project needs a name');
  const all = games(); if (all[slug]) throw new Error(`Project '${slug}' is already registered`);
  const abs = canonicalPath(resolve(repo)); if (!existsSync(abs)) throw new Error('Project folder does not exist');
  // Registering an existing directory must not silently git-add private/untracked files.
  if (canonicalPath(await git(abs, 'rev-parse', '--show-toplevel')) !== abs) throw new Error('Register the Git repository root, not a nested folder');
  const cfg: GameCfg = { repo: abs, ...detectCommands(abs), targetBranch: mergeTarget(abs), settings: defaultSettings(), installDomains: ['registry.npmjs.org'] };
  all[slug] = cfg; runtime().put('config', 'projects', all, { type: 'project.created', projectId: slug, payload: { project: slug } }); return cfg;
}
export async function createProject(name: string): Promise<{ slug: string; repo: string }> {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); if (!slug) throw new Error('Project needs a name');
  const repo = join(config.projectsDir, slug); if (existsSync(repo)) throw new Error('Folder already exists');
  mkdirSync(repo, { recursive: true }); writeFileSync(join(repo, 'README.md'), `# ${name}\n\nCreated with Nibbi.\n`);
  await git(repo, 'init', '-b', 'main'); await git(repo, 'add', 'README.md'); await git(repo, 'commit', '-m', 'Start project'); await registerProject(slug, repo);
  return { slug, repo };
}

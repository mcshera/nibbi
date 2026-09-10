import { connectionFor } from './github-repositories.js';
import { githubBuildSummary } from './github-builds.js';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { runtime } from './store.js';
import { config } from './config.js';
import { loadState } from './state.js';
import { leadBusy } from './session.js';
import { autoConfig, autoSpend, inflightFor, stagedFor, pendingTasks, roadmapProgress, listFixers } from './fixer.js';
import { games, projectSettings } from './projects.js';
import { goals } from './scheduler.js';
import { git } from './processes.js';
import { planPath, parseProjectDocument } from './roadmap.js';
const started = Date.now();
export const status = (): Record<string, unknown> => ({ ...loadState(), app: 'nibbi', version: '0.8.0', protocolVersion: 1, pid: process.pid, busy: leadBusy(), uptimeSec: Math.round((Date.now() - started) / 1000), vault: config.vaultDir });
export function autoView(): Record<string, unknown> {
  return Object.fromEntries(Object.keys(games()).map(project => [project, { ...(autoConfig()[project] ?? { mode: 'off', on: false, autoMerge: false, maxConcurrent: 2 }), ...roadmapProgress(project), inflight: inflightFor(project).length, staged: stagedFor(project).length, pending: pendingTasks(project).length, spend: autoSpend(project) }]));
}
export function snapshot(): unknown { return { cursor: runtime().cursor(), status: status(), fixers: listFixers().map(run => ({ ...run, github: githubBuildSummary(run.id) })), auto: autoView(), goals: goals() }; }
export async function projectsView(): Promise<unknown[]> {
  const projects = await Promise.all(Object.entries(games()).map(async ([name, cfg]) => {
    try { const [branch, lastCommit, dirty] = await Promise.all([git(cfg.repo, 'symbolic-ref', '--short', 'HEAD'), git(cfg.repo, 'log', '-1', '--format=%h %s (%cr)'), git(cfg.repo, 'status', '--porcelain')]);
      return { ...cfg, name, kind: 'game', github: connectionFor(name) ?? null, branch, lastCommit, dirty: dirty.split('\n').filter(Boolean).length };
    } catch (error) { return { ...cfg, name, kind: 'game', error: (error as Error).message }; }
  }));
  return [...projects, { name: 'vault', repo: config.vaultDir, kind: 'brain', settings: projectSettings('vault') }];
}
export function milestones(project: string): { name: string; done: number; total: number }[] {
  const path = planPath(project); if (!existsSync(path)) return [];
  return parseProjectDocument(readFileSync(path, 'utf8')).milestones.map(({ name, done, total }) => ({ name, done, total })).filter(item => item.total);
}
export function runEvents(id: string, attemptId?: string): { ts: string; kind: string; text: string }[] {
  return (runtime().db.prepare("SELECT type,at,payload FROM events WHERE run_id=? AND (? IS NULL OR json_extract(payload,'$.attemptId')=?) ORDER BY id DESC LIMIT 250").all(id, attemptId ?? null, attemptId ?? null) as { type: string; at: number; payload: string }[]).reverse().map(row => {
    const payload = JSON.parse(row.payload) as Record<string, unknown>; return { ts: new Date(row.at).toISOString(), kind: row.type, text: String(payload.text ?? payload.name ?? (payload.run as { status?: string })?.status ?? '') };
  });
}
export function artifacts(project: string): unknown {
  const files: { name: string; size: number; mtime: number; kind: string }[] = [];
  for (const dir of [join(config.vaultDir, 'exports'), join(config.stateDir, 'artifacts')]) if (existsSync(dir)) for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith('.')) continue; const stat = statSync(join(dir, entry.name)); files.push({ name: entry.name, size: stat.size, mtime: stat.mtimeMs, kind: entry.name.split('.').pop() ?? 'file' });
  }
  return { changes: listFixers().filter(run => run.game === project && ['done', 'staged', 'merged'].includes(run.status)), files: files.sort((a, b) => b.mtime - a.mtime) };
}

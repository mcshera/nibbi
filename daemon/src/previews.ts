import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { games } from './projects.js';
import { runtime } from './store.js';
import { sandboxCommand } from './sandbox.js';
import type { Fixer } from './fixer.js';

interface Preview { id: string; cwd: string; running: boolean; starting: boolean; url?: string; error?: string }
const owned = new Map<string, AbortController>();
const pending = new Set<Promise<unknown>>();
function command(cwd: string): string | undefined {
  try { const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
    for (const name of ['dev', 'start']) if (/\b(vite|next|astro|parcel|webpack|nuxt|serve)\b/.test(pkg.scripts?.[name] ?? '')) return `npm run ${name}`;
  } catch { /* not a web app */ }
}
function start(id: string, cwd: string, cmd?: string): Preview {
  const prior = runtime().get<Preview>('previews', id); if (owned.has(id) && prior) return prior;
  if (!cmd) throw new Error('No configured browser preview command');
  const abort = new AbortController(); owned.set(id, abort);
  const state: Preview = { id, cwd, running: true, starting: true };
  runtime().put('previews', id, state);
  const done = sandboxCommand(cwd, cmd, { signal: abort.signal, timeoutMs: 60 * 60_000, onOutput: text => {
    const url = text.replace(/\x1b\[[0-9;]*m/g, '').match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d+[^\s]*/)?.[0];
    if (url) { state.url = url.replace('0.0.0.0', '127.0.0.1'); state.starting = false; runtime().put('previews', id, state); }
  } }).catch(error => { if (!abort.signal.aborted) state.error = (error as Error).message; }).finally(() => {
    owned.delete(id); state.running = false; state.starting = false; runtime().put('previews', id, state); pending.delete(done);
  });
  pending.add(done);
  return state;
}
function stop(id: string): void { owned.get(id)?.abort(new Error('Preview stopped')); }
export function previewStart(id: string): string {
  const run = runtime().get<Fixer>('fixers', id); if (!run || !existsSync(run.worktree)) throw new Error('Preview worktree not found');
  const preview = start(id, run.worktree, command(run.worktree)); return preview.url ?? 'Preview starting; query preview status shortly';
}
export function previewStop(id: string): string { stop(id); return 'Preview stopping'; }
/** Read-only affordances use the same command detection and ownership as preview execution. */
export function allowedPreviewActions(id: string, worktree: string): string[] {
  if (owned.has(id)) return ['preview.stop'];
  return existsSync(worktree) && command(worktree) ? ['preview.start'] : [];
}
export function previewStatus(id: string): Preview | { running: false } { const preview = runtime().get<Preview>('previews', id); return preview ? { ...preview, running: owned.has(id), starting: owned.has(id) && preview.starting, url: owned.has(id) ? preview.url : undefined } : { running: false }; }
export function playStart(project: string): { url?: string; starting?: boolean; error?: string } {
  const cfg = games()[project]; if (!cfg) return { error: 'Unknown project' };
  if (cfg.play && /^https?:\/\//.test(cfg.play)) return { url: cfg.play };
  try { const preview = start('project:' + project, cfg.repo, cfg.play ?? command(cfg.repo)); return { url: preview.url, starting: preview.starting }; }
  catch (error) { return { error: (error as Error).message }; }
}
export function playStop(project: string): string { stop('project:' + project); return 'Preview stopping'; }
export function playStatus(project: string): { running: boolean; url?: string; playable: boolean; kind: string; starting?: boolean; error?: string } {
  const cfg = games()[project]; if (!cfg) return { running: false, playable: false, kind: 'none' };
  if (cfg.play && /^https?:\/\//.test(cfg.play)) return { running: true, url: cfg.play, playable: true, kind: 'url' };
  const preview = runtime().get<Preview>('previews', 'project:' + project);
  return { running: owned.has('project:' + project), playable: !!(cfg.play ?? command(cfg.repo)), kind: 'server', starting: owned.has('project:' + project) && preview?.starting, url: owned.has('project:' + project) ? preview?.url : undefined, error: preview?.error };
}
export async function stopPreviews(): Promise<void> { for (const controller of owned.values()) controller.abort(new Error('Backend shutdown')); await Promise.allSettled([...pending]); }

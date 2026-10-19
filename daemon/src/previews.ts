import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { games } from './projects.js';
import { runtime } from './store.js';
import { sandboxCommand } from './sandbox.js';
import type { Fixer } from './fixer.js';

interface Preview { id: string; cwd: string; running: boolean; starting: boolean; url?: string; error?: string }
const owned = new Map<string, AbortController>();
const pending = new Set<Promise<unknown>>();
const done = new Map<string, Promise<void>>();
/** The dev-server command a folder's package.json offers, if any (a run's worktree, the owner's checkout, a copy's worktree). */
export function previewCommand(cwd: string): string | undefined {
  try { const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
    for (const name of ['dev', 'start']) if (/\b(vite|next|astro|parcel|webpack|nuxt|serve)\b/.test(pkg.scripts?.[name] ?? '')) return `npm run ${name}`;
  } catch { /* not a web app */ }
}
const command = previewCommand;
/** One preview per id. `onEnd` runs once the process has gone (stopped, crashed or exited). */
export function startPreview(id: string, cwd: string, cmd?: string, options: { onEnd?: () => void } = {}): Preview {
  const prior = runtime().get<Preview>('previews', id); if (owned.has(id) && prior) return prior;
  if (!cmd) throw new Error('No configured browser preview command');
  const abort = new AbortController(); owned.set(id, abort);
  const state: Preview = { id, cwd, running: true, starting: true };
  runtime().put('previews', id, state);
  const running = sandboxCommand(cwd, cmd, { signal: abort.signal, timeoutMs: 60 * 60_000, onOutput: text => {
    const url = text.replace(/\x1b\[[0-9;]*m/g, '').match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d+[^\s]*/)?.[0];
    if (url) { state.url = url.replace('0.0.0.0', '127.0.0.1'); state.starting = false; runtime().put('previews', id, state); }
  } }).catch(error => { if (!abort.signal.aborted) state.error = (error as Error).message; }).finally(() => {
    owned.delete(id); state.running = false; state.starting = false; runtime().put('previews', id, state); pending.delete(running);
    if (done.get(id) === ended) done.delete(id);
    try { options.onEnd?.(); } catch { /* a follow-up never changes how the preview ended */ }
  });
  const ended = running.then(() => undefined);
  pending.add(running); done.set(id, ended);
  return state;
}
const start = startPreview;
function stop(id: string): void { owned.get(id)?.abort(new Error('Preview stopped')); }
/** Stop a preview and wait (at most `ms`) until its process has gone. */
export async function stopAndWait(id: string, ms = 10_000): Promise<void> {
  const ended = done.get(id); if (!ended) return; stop(id);
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([ended, new Promise<void>(resolve => { timer = setTimeout(resolve, ms); timer.unref?.(); })]);
  if (timer) clearTimeout(timer);
}
/** The previews this backend is running now. */
export const ownedPreviews = (): string[] => [...owned.keys()];
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
/** Playing main stops the project's copies first: one plays at a time (docs/BUILDS-AS-COPIES.md D3). */
export async function playStart(project: string): Promise<{ url?: string; starting?: boolean; error?: string }> {
  const cfg = games()[project]; if (!cfg) return { error: 'Unknown project' };
  for (const id of ownedPreviews().filter(id => id.startsWith('copy:' + project + ':'))) await stopAndWait(id);
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

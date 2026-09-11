import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, basename, resolve, relative, isAbsolute, sep } from 'node:path';

/** Resolve ancestors so a new file below a symlink cannot escape. */
export function canonicalPath(input: string): string {
  let current = resolve(input);
  const tail: string[] = [];
  while (!existsSync(current)) {
    try { if (lstatSync(current).isSymbolicLink()) throw new Error('Dangling symlink'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const parent = dirname(current);
    if (parent === current) throw new Error('No existing path ancestor');
    tail.unshift(basename(current));
    current = parent;
  }
  return resolve(realpathSync(current), ...tail);
}

export function within(root: string, target: string, allowRoot = false): boolean {
  if (!root || !target) return false;
  try {
    const rel = relative(canonicalPath(root), canonicalPath(target));
    return rel === '' ? allowRoot : !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep);
  } catch { return false; }
}

export function scopedPath(root: string, input: string): string {
  const result = resolve(root, input);
  if (!within(root, result)) throw new Error('Path is outside the allowed directory');
  return result;
}

export function controlPath(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(root, target));
  return rel.split(sep).some(part => ['.git', '.claude', '.codex', '.agents'].includes(part));
}

import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { config } from './config.js';
import { scopedPath } from './paths.js';

export interface RoadmapTask { id: string; text: string; done: boolean; line: number; explicit: boolean; milestone?: string }
export function parseRoadmap(text: string): RoadmapTask[] {
  const occurrences = new Map<string, number>();
  let milestone: string | undefined;
  return text.split('\n').flatMap((line, index) => {
    const heading = line.match(/^##\s+(.+)/); if (heading) milestone = heading[1].trim();
    const match = line.match(/^\s*[-*]\s*\[([ xX])\]\s+(.*)$/);
    if (!match) return [];
    const marker = match[2].match(/\s*<!--\s*nibbi-task:([a-zA-Z0-9_-]+)\s*-->/);
    const body = match[2].replace(/\s*<!--\s*nibbi-task:[^>]+-->/, '').trim();
    const nth = occurrences.get(body) ?? 0; occurrences.set(body, nth + 1);
    const id = marker?.[1] ?? createHash('sha256').update(body + '\0' + nth).digest('hex').slice(0, 16);
    return [{ id, text: body, done: match[1] !== ' ', line: index, explicit: !!marker, milestone }];
  });
}
export function planPath(project: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(project)) throw new Error('Invalid project');
  return scopedPath(config.vaultDir, `plans/${project}.md`);
}
export function roadmap(project: string): RoadmapTask[] {
  const path = planPath(project);
  return existsSync(path) ? parseRoadmap(readFileSync(path, 'utf8')) : [];
}
/** Add stable markers only when work is explicitly dispatched. No fuzzy completion. */
export function pinTask(project: string, exactText: string): string | undefined {
  const path = planPath(project);
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  const matches = parseRoadmap(text).filter(task => !task.done && (task.id === exactText || task.text === exactText));
  if (matches.length !== 1) return;
  const task = matches[0];
  if (!task.explicit) {
    const lines = text.split('\n'); lines[task.line] += ` <!-- nibbi-task:${task.id} -->`;
    writeFileSync(path + '.nibbi-tmp', lines.join('\n')); renameSync(path + '.nibbi-tmp', path);
  }
  return task.id;
}
export function completeTask(project: string, id?: string): void {
  if (!id) return;
  const path = planPath(project);
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  const matches = parseRoadmap(text).filter(task => task.explicit && task.id === id && !task.done);
  if (matches.length !== 1) return;
  const lines = text.split('\n'); lines[matches[0].line] = lines[matches[0].line].replace('[ ]', '[x]');
  writeFileSync(path + '.nibbi-tmp', lines.join('\n')); renameSync(path + '.nibbi-tmp', path);
}

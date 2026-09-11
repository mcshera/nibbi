import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { config } from './config.js';
import { scopedPath } from './paths.js';
import { editDocuments, readDocument } from './workspace-documents.js';

export interface MarkdownHeading { line: number; level: number; text: string; id: string; explicit: boolean }
export interface RoadmapTask {
  id: string; text: string; done: boolean; checked: boolean; line: number; endLine: number; explicit: boolean;
  milestone?: string; milestoneId?: string; heading: string | null; description: string; issueIds: string[];
}
export interface PlanMilestone { id: string; name: string; description: string; line: number; endLine: number; descriptionEnd: number; explicit: boolean; done: number; total: number; tasks: RoadmapTask[] }
const cleanMarkers = (text: string): string => text.replace(/\s*<!--\s*nibbi-(?:task|issue|milestone|issue-ref|current-milestone):[^>]+-->/g, '').trim();
const identity = (text: string, nth: number, namespace = ''): string => createHash('sha256').update(namespace + text + '\0' + nth).digest('hex').slice(0, 16);
const checkbox = /^(\s*(?:[-+*][ \t]*|\d+[.)][ \t]+))\[([ xX])\](?:[ \t]+(.*))?$/;

/** Shared checkbox grammar for dispatch, completion, counts and workspaces. Read-only IDs preserve the original task hash. */
export function parseProjectDocument(markdown: string, kind: 'task' | 'issue' = 'task'): { markdown: string; items: RoadmapTask[]; headings: MarkdownHeading[]; milestones: PlanMilestone[]; outcome: string; currentMilestone: { id: string; name: string } | null; selectionLines: number[]; counts: { total: number; open: number; done: number } | null } {
  const lines = markdown.split('\n'), items: RoadmapTask[] = [], headings: MarkdownHeading[] = [];
  const occurrences = new Map<string, number>(), milestoneOccurrences = new Map<string, number>();
  let fence: { character: string; length: number } | undefined, heading: string | null = null, milestone: MarkdownHeading | undefined;
  let managedDescription = false, selected: string | undefined;
  const selectionLines: number[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].replace(/\r$/, ''), delimiter = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (managedDescription) { if (line.trim() === '<!-- nibbi-description:end -->') managedDescription = false; continue; }
    if (fence) { if (delimiter && delimiter[1][0] === fence.character && delimiter[1].length >= fence.length && !delimiter[2].trim()) fence = undefined; continue; }
    if (line.trim() === '<!-- nibbi-description:start -->') { managedDescription = true; continue; }
    if (delimiter) { fence = { character: delimiter[1][0], length: delimiter[1].length }; continue; }
    const selection = line.match(/^\s*<!--\s*nibbi-current-milestone:([a-zA-Z0-9_-]+)\s*-->\s*$/);
    if (selection) { selected = selection[1]; selectionLines.push(index); continue; }
    const title = line.match(/^ {0,3}(#{1,6})[ \t]+(.+?)\s*$/);
    if (title) {
      heading = cleanMarkers(title[2]).replace(/[ \t]+#+$/, '').trim();
      const nth = milestoneOccurrences.get(heading) ?? 0; milestoneOccurrences.set(heading, nth + 1);
      const marker = title[2].match(/<!--\s*nibbi-milestone:([a-zA-Z0-9_-]+)\s*-->/);
      const entry = { line: index, level: title[1].length, text: heading, id: marker?.[1] ?? identity(heading, nth, 'milestone\0'), explicit: !!marker };
      headings.push(entry); if (entry.level === 2) milestone = entry;
      continue;
    }
    const match = line.match(checkbox); if (!match) continue;
    const raw = match[3] ?? '', body = cleanMarkers(raw), marker = raw.match(new RegExp('<!--\\s*nibbi-' + kind + ':([a-zA-Z0-9_-]+)\\s*-->'));
    const nth = occurrences.get(body) ?? 0; occurrences.set(body, nth + 1);
    const id = marker?.[1] ?? identity(body, nth, kind === 'issue' ? 'issue\0' : '');
    let endLine = index + 1, managedEnd = -1, descriptionFence: { character: string; length: number } | undefined;
    if (lines[index + 1]?.trim() === '<!-- nibbi-description:start -->') managedEnd = lines.findIndex((value, position) => position > index + 1 && value.trim() === '<!-- nibbi-description:end -->');
    // Only indented continuations belong to the item. Unrelated prose stays in its original slot during edits/reordering.
    for (let next = index + 1; managedEnd < 0 && next < lines.length; next++) {
      const candidate = lines[next];
      const delimiter = candidate.match(/^ {1,3}(`{3,}|~{3,})(.*)$/);
      if (descriptionFence) {
        if (delimiter && delimiter[1][0] === descriptionFence.character && delimiter[1].length >= descriptionFence.length && !delimiter[2].trim()) descriptionFence = undefined;
        endLine = next + 1; continue;
      }
      if (delimiter) { descriptionFence = { character: delimiter[1][0], length: delimiter[1].length }; endLine = next + 1; continue; }
      if (checkbox.test(candidate) || /^ {0,3}#{1,6}[ \t]+/.test(candidate)) break;
      if (candidate.trim() && !/^[ \t]+/.test(candidate)) break;
      if (candidate.trim()) endLine = next + 1;
    }
    if (managedEnd >= 0) endLine = managedEnd + 1;
    const description = lines.slice(index + (managedEnd >= 0 ? 2 : 1), managedEnd >= 0 ? managedEnd : endLine).map(value => value.replace(/^(?: {2}|\t)/, '').replace(/\r$/, '')).join('\n').trim();
    items.push({ id, text: body, done: match[2] !== ' ', checked: match[2] !== ' ', line: index, endLine, explicit: !!marker,
      milestone: milestone?.text, milestoneId: milestone?.id, heading, description,
      issueIds: [...raw.matchAll(/<!--\s*nibbi-issue-ref:([a-zA-Z0-9_-]+)\s*-->/g)].map(value => value[1]) });
  }
  const milestoneHeads = headings.filter(value => value.level === 2);
  const milestones = milestoneHeads.map((head, index): PlanMilestone => {
    const endLine = milestoneHeads[index + 1]?.line ?? lines.length;
    const tasks = items.filter(task => task.milestoneId === head.id);
    const descriptionEnd = Math.min(endLine, ...items.filter(task => task.line > head.line).map(task => task.line), ...headings.filter(other => other.line > head.line).map(other => other.line));
    const description = lines.slice(head.line + 1, descriptionEnd).filter(line => !/^\s*<!-- nibbi-description:(?:start|end) -->\s*$/.test(line)).join('\n').trim();
    return { id: head.id, name: head.text, description, line: head.line, endLine, descriptionEnd, explicit: head.explicit, done: tasks.filter(task => task.done).length, total: tasks.length, tasks };
  });
  const first = Math.min(lines.length, ...items.map(task => task.line), ...milestoneHeads.map(head => head.line));
  const outcome = lines.slice(0, first).filter(line => !/^\s*#\s/.test(line) && !/^\s*<!--\s*nibbi-current-milestone:/.test(line)).join('\n').trim();
  const current = selected ? milestones.find(value => value.id === selected) : undefined;
  const done = items.filter(item => item.done).length;
  return { markdown, items, headings, milestones, outcome, currentMilestone: current ? { id: current.id, name: current.name } : null, selectionLines, counts: items.length ? { total: items.length, open: items.length - done, done } : null };
}
export function parseRoadmap(text: string): RoadmapTask[] { return parseProjectDocument(text).items; }
export function planPath(project: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(project)) throw new Error('Invalid project');
  return scopedPath(config.vaultDir, `plans/${project}.md`);
}
export function roadmap(project: string): RoadmapTask[] { const path = planPath(project); return existsSync(path) ? parseRoadmap(readFileSync(path, 'utf8')) : []; }
/** Pin every identity before a write, including duplicates, so renames and ordering cannot change neighboring IDs. */
export function pinDocument(markdown: string, kind: 'task' | 'issue' = 'task'): string {
  const parsed = parseProjectDocument(markdown, kind), lines = markdown.split('\n');
  const ids = parsed.items.map(item => item.id);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate explicit item IDs; repair the document before editing');
  for (const item of parsed.items) if (!item.explicit) lines[item.line] = lines[item.line].replace(/\r?$/, ` <!-- nibbi-${kind}:${item.id} -->`);
  if (kind === 'task') {
    const ids = parsed.milestones.map(item => item.id);
    if (new Set(ids).size !== ids.length) throw new Error('Duplicate milestone IDs; repair the document before editing');
    for (const milestone of parsed.milestones) if (!milestone.explicit) {
      const marker = ` <!-- nibbi-milestone:${milestone.id} -->`, source = lines[milestone.line];
      // Keep optional ATX closing hashes at the end of the heading so Markdown rendering is unchanged.
      lines[milestone.line] = /[ \t]+#+[ \t]*\r?$/.test(source)
        ? source.replace(/([ \t]+#+[ \t]*)(\r?)$/, marker + '$1$2')
        : source.replace(/(\r?)$/, marker + '$1');
    }
  }
  return lines.join('\n');
}
/** Only explicit dispatch pins a legacy task; reads never write IDs. */
export function pinTask(project: string, exactText: string): string | undefined {
  const doc = readDocument(planPath(project)); if (!doc.exists) return;
  const matches = parseRoadmap(doc.markdown).filter(task => !task.done && (task.id === exactText || task.text === exactText));
  if (matches.length !== 1) return;
  const task = matches[0];
  if (!task.explicit) editDocuments([{ ...doc, next: pinDocument(doc.markdown) }]);
  return task.id;
}
export function completeTask(project: string, id?: string): void {
  if (!id) return;
  const doc = readDocument(planPath(project)); if (!doc.exists) return;
  const matches = parseRoadmap(doc.markdown).filter(task => task.explicit && task.id === id && !task.done);
  if (matches.length !== 1) return;
  const lines = doc.markdown.split('\n'); lines[matches[0].line] = lines[matches[0].line].replace('[ ]', '[x]');
  editDocuments([{ ...doc, next: lines.join('\n') }]);
}

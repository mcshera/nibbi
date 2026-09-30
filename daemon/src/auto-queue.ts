// What stage and ship build (the owner's decision, 2026-09-29): the improvements up next, in issues.md order — the list the
// bar shows for the build automation builds into — not the roadmap, which the bar no longer shows. docs/CONTROL-PANEL.md §12.
import { projectSection } from './project-workspace.js';
import { copyById } from './copy-records.js';
import type { Fixer } from './fixer.js';

/** A latest try that leaves its improvement up next again: stopped or discarded (the contract's issueRecord). */
const AGAIN = new Set(['cancelled', 'discarded']);
const liveCopy = (project: string, id?: string | null): string | null => {
  if (!id) return null;
  const copy = copyById(id); return copy && copy.project === project && copy.status !== 'retired' ? copy.id : null;
};

export interface OpenIssue {
  id: string; title: string; suggested: boolean;
  /** The build it is in, as the bar places it: its latest try's copy, else the copy it was put up next on — while live; null is main. */
  copyId: string | null;
  /** Up next, as the bar says it: no try yet, its latest try stopped or discarded, or tried on a copy retired before it shipped. */
  upNext: boolean;
  tries: Fixer[];
}
/** Every open issue of a project, in issues.md order. */
export function openIssues(project: string): OpenIssue[] {
  const section = projectSection(project, 'issues');
  return (section.items as Array<Record<string, any>>).filter(item => !item.done).map(item => {
    const tries = (item.linkedBuilds as Fixer[]).filter(run => run.status !== 'superseded').sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
    const latest = tries.at(-1);
    const copyId = latest ? liveCopy(project, latest.copyId) : liveCopy(project, item.copyId);
    const retiredUnder = !!latest?.copyId && !copyId && !latest.shipped;
    return { id: String(item.id), title: String(item.text), suggested: item.suggested === true, copyId, upNext: !latest || AGAIN.has(latest.status) || retiredUnder, tries };
  });
}
/** What stage and ship build next into `target` (a live copy's id; null is main), top first: what is up next there or in main's
    list, and not tried since automation was turned on (`since`), so a try you stopped or discarded isn't started again by itself.
    An improvement put up next on another copy is that copy's. */
export function automationQueue(project: string, target: string | null, since?: string): OpenIssue[] {
  return openIssues(project).filter(item => item.upNext && (item.copyId === null || item.copyId === target)
    && !(since && item.tries.some(run => String(run.startedAt) >= since)));
}
/** A suggestion list from the lead's reply: its "- " (or "1.") lines, cleaned to one short line each, none already listed. */
export function suggestionsFrom(text: string, listed: string[], most = 3): string[] {
  const seen = new Set(listed.map(title => title.trim().toLowerCase())), out: string[] = [];
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*(?:[-*•]|\d{1,2}[.)])\s+(.*\S)\s*$/); if (!match) continue;
    const title = match[1].replace(/\*\*|__|`/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').trim().slice(0, 200).trim();
    if (!title || /<!--/.test(title) || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase()); out.push(title);
    if (out.length >= most) break;
  }
  return out;
}

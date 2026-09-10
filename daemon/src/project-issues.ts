import { config } from './config.js';
import { scopedPath } from './paths.js';
import { parseProjectDocument, pinDocument } from './roadmap.js';
import { editDocuments, readDocument, type WorkspaceDocument } from './workspace-documents.js';

export function issueDocuments(project: string): WorkspaceDocument[] {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(project)) throw new Error('Invalid project');
  return ['games', 'projects'].map(root => readDocument(scopedPath(config.vaultDir, `${root}/${project}/issues.md`)));
}
/** Keep the original games/ then projects/ lookup priority without creating either source. */
export function issueDocument(project: string): WorkspaceDocument {
  const docs = issueDocuments(project);
  return docs.find(doc => doc.markdown.trim()) ?? docs.find(doc => doc.exists) ?? docs[0];
}
export function pinIssueIds(project: string, ids: string[]): string[] {
  if (!ids.length) return [];
  const doc = issueDocument(project), parsed = parseProjectDocument(doc.markdown, 'issue');
  for (const id of ids) if (parsed.items.filter(item => item.id === id).length !== 1) throw new Error('Issue ID must identify exactly one project issue');
  const next = pinDocument(doc.markdown, 'issue');
  if (next !== doc.markdown) editDocuments([{ ...doc, next }]);
  return [...new Set(ids)];
}
/** Called only after the run's verified merge has succeeded. Workflow completion alone never resolves an issue. */
export function completeLinkedIssues(project: string, ids: string[] = []): void {
  if (!ids.length) return;
  const writes = issueDocuments(project).flatMap(doc => {
    const parsed = parseProjectDocument(doc.markdown, 'issue'), lines = doc.markdown.split('\n');
    let changed = false;
    for (const id of ids) {
      const matches = parsed.items.filter(item => item.explicit && item.id === id && !item.done);
      if (matches.length !== 1) continue;
      lines[matches[0].line] = lines[matches[0].line].replace('[ ]', '[x]'); changed = true;
    }
    return changed ? [{ ...doc, next: lines.join('\n') }] : [];
  });
  if (writes.length) editDocuments(writes);
}

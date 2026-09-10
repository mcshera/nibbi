/** The backend owns document parsing, identities, progress and revision checks. */
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sections = ['builds', 'issues', 'plans'];
export class ProjectDataError extends Error {
  constructor(source, message, details = {}) { super(message, {cause: details.cause}); this.name = 'ProjectDataError'; this.source = source; Object.assign(this, details); }
}
const validateProject = project => { if (typeof project !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(project)) throw new TypeError('Invalid project ID'); };
const abort = signal => { if (signal?.aborted) throw new DOMException('Project read cancelled', 'AbortError'); };
async function request(url, source, {fetcher = fetch, signal, ...options} = {}) {
  abort(signal);
  try {
    const response = await fetcher(url, {method: 'GET', cache: 'no-store', ...options, signal}); abort(signal);
    const value = await response.json(); abort(signal);
    if (!response.ok || value?.ok === false) throw new ProjectDataError(source, typeof value?.error === 'string' ? value.error : value?.error?.message || `Could not load ${source}.`, {status: response.status, code: value?.error?.code, revision: value?.revision});
    if (!record(value)) throw new TypeError('Invalid response');
    return value;
  } catch (error) {
    abort(signal);
    if (error?.name === 'AbortError' || error instanceof ProjectDataError) throw error;
    throw new ProjectDataError(source, `Could not load ${source}.`, {cause: error});
  }
}
export function validateProjectSection(data, project, section) {
  if (!record(data) || data.project !== project || data.section !== section || !['ready','empty','partial'].includes(data.status)) throw new ProjectDataError(section, 'Project data did not match this view.');
  if (section === 'builds') {
    if (!Array.isArray(data.runs) || data.runs.some(run => !record(run) || (run.game || run.project) !== project)) throw new ProjectDataError(section, 'Build data did not match this project.');
    // Export files currently have no project provenance.
    return {...data, files: []};
  }
  if (typeof data.markdown !== 'string' || typeof data.revision !== 'string' || !Array.isArray(data.items)) throw new ProjectDataError(section, 'Project document is unavailable.');
  return data;
}
export async function loadProjectSection({project, section, signal, fetcher} = {}) {
  validateProject(project); if (!sections.includes(section)) throw new TypeError('Unknown project section');
  const value = await request('/api/project-section?project=' + encodeURIComponent(project) + '&section=' + section, section, {signal, fetcher});
  return validateProjectSection(value, project, section);
}
export async function loadProjectSummaries({projects, signal, fetcher} = {}) {
  for (const project of projects) validateProject(project);
  if (!projects.length) return {};
  const value = await request('/api/project-summaries?projects=' + encodeURIComponent(projects.join(',')), 'project summaries', {signal, fetcher});
  if (!record(value.projects)) throw new ProjectDataError('summaries', 'Project summaries are unavailable.');
  return Object.fromEntries(projects.map(project => {
    const summary = value.projects[project];
    if (!record(summary) || summary.project !== project) throw new ProjectDataError('summaries', 'Project summary identity is unavailable.');
    return [project, summary];
  }));
}
export async function projectCommand(project, payload, {fetcher, signal, idempotencyKey = crypto.randomUUID()} = {}) {
  validateProject(project);
  return request('/api/project-command', 'project change', {fetcher, signal, method:'POST', headers:{'content-type':'application/json','idempotency-key':idempotencyKey}, body:JSON.stringify({...payload, project, idempotencyKey})});
}

/** GitHub reads are scoped to canonical project/build identities; commands return reviewed receipts. */
export async function loadGithubProject({project, signal, fetcher} = {}) {
  validateProject(project);
  const value = await request('/api/github/project?project=' + encodeURIComponent(project), 'repository', {signal, fetcher});
  if (value.project !== project) throw new ProjectDataError('repository', 'Repository data belongs to a different project.');
  return value;
}
export async function loadGithubBuild({project, buildId, signal, fetcher} = {}) {
  validateProject(project);
  if (typeof buildId !== 'string' || !buildId) throw new TypeError('Build identity is required.');
  const value = await request('/api/github/build?id=' + encodeURIComponent(buildId), 'build GitHub status', {signal, fetcher});
  if (value.buildId !== buildId || value.project && value.project !== project) throw new ProjectDataError('GitHub', 'GitHub data belongs to a different build.');
  return value;
}
export async function loadGithubChanges({project, buildId, signal, fetcher} = {}) {
  validateProject(project);
  const value = await request('/api/github/changes?project=' + encodeURIComponent(project) + (buildId ? '&buildId=' + encodeURIComponent(buildId) : ''), 'local changes', {signal, fetcher});
  if (value.project !== project || buildId && value.buildId !== buildId || !Array.isArray(value.files) || typeof value.sourceRevision !== 'string') throw new ProjectDataError('changes', 'The selected changes could not be identified safely.');
  return value;
}
export async function loadGithubPrDraft({project, buildId, signal, fetcher} = {}) {
  validateProject(project);
  const value = await request('/api/github/pr-draft?project=' + encodeURIComponent(project) + (buildId ? '&buildId=' + encodeURIComponent(buildId) : ''), 'pull request draft', {signal, fetcher});
  if (value.project !== project || buildId && value.buildId !== buildId || typeof value.title !== 'string' || typeof value.body !== 'string' || !Array.isArray(value.templates) || value.templates.some(template => !record(template) || typeof template.path !== 'string' || typeof template.body !== 'string')) throw new ProjectDataError('draft', 'The pull request draft did not match this project.');
  return value;
}
export async function githubCommand(project, name, args = {}, {fetcher, signal, idempotencyKey = crypto.randomUUID()} = {}) {
  validateProject(project);
  const value = await request('/api/commands', 'GitHub operation', {fetcher, signal, method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({name, args, projectId:project, idempotencyKey})});
  return value.data ?? value;
}

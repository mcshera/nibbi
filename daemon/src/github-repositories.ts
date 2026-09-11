import { createHash } from 'node:crypto';
import { z } from 'zod';
import { runtime } from './store.js';
import { canonicalPath } from './paths.js';
import { githubApi, githubPages, githubGit, GithubError, withGithubRepoLock } from './github-cli.js';
import type { GameCfg } from './projects.js';

export interface RequiredGithubCheck { name: string; appId?: number; creator?: string; workflowId?: number; workflowPath?: string; acceptedConclusions: string[] }
export interface GithubRules { status: 'available' | 'none' | 'unavailable'; requiredChecks: RequiredGithubCheck[]; approvals: number; mergeQueue?: boolean; detail?: string }
export interface GithubConnection {
  project: string; revision: number; host: string; account: string; repository: string; repositoryId: string; nodeId?: string; defaultBranch?: string; url: string; visibility: string;
  repo: string; gitCommonDir: string; fetchRemote: string; pushRemote: string; fetchUrl: string; pushUrl: string; remoteFingerprint: string;
  integrationBranch: string; localTargetBranch: string; releaseBranch: string; workflowMode: 'github' | 'local'; requiredChecks: RequiredGithubCheck[];
  permissions: { push: boolean; maintain: boolean; admin: boolean }; mergeMethods: string[]; rules: GithubRules; observedAt: number; error?: string;
}
export const shaPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
export function checkedSha(value: unknown): string { return z.string().regex(shaPattern, 'Expected a full immutable Git commit SHA').parse(value); }
export function checkedBranch(value: unknown): string {
  const branch = z.string().min(1).max(240).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/).parse(value);
  if (branch.includes('..') || branch.includes('//') || branch.endsWith('/') || branch.endsWith('.') || branch.split('/').some(part => part.startsWith('.') || part.endsWith('.lock'))) throw new GithubError('INVALID_REF', 'Invalid Git branch name');
  return branch;
}
export function projectConfig(project: string): GameCfg {
  z.string().regex(/^[a-z0-9][a-z0-9-]*$/).parse(project);
  const cfg = (runtime().get<Record<string, GameCfg>>('config', 'projects') ?? runtime().get<Record<string, GameCfg>>('legacy', 'games.json'))?.[project];
  if (!cfg) throw new GithubError('UNKNOWN_PROJECT', 'Select a registered code project'); return cfg;
}
export function connectionFor(project: string): GithubConnection | undefined { return runtime().get<GithubConnection>('github-connections', project); }
export function parseGithubRemote(value: string): { host: string; repository: string; normalized: string } {
  if (!value || /[\s\u0000-\u001f]/.test(value)) throw new GithubError('INVALID_REMOTE', 'GitHub remote URL is invalid');
  let host: string, path: string;
  const scp = value.match(/^git@([a-zA-Z0-9.-]+):([^?#]+)$/);
  if (scp) { host = scp[1].toLowerCase(); path = scp[2]; }
  else {
    let url: URL; try { url = new URL(value); } catch { throw new GithubError('INVALID_REMOTE', 'Use a GitHub HTTPS or SSH remote'); }
    if (!['https:', 'ssh:'].includes(url.protocol) || url.password || url.search || url.hash || url.port && url.port !== '22' || url.protocol === 'https:' && url.username || url.protocol === 'ssh:' && url.username !== 'git') throw new GithubError('INVALID_REMOTE', 'Remote credentials, custom ports and unsupported Git transports are not accepted');
    host = url.hostname.toLowerCase(); path = url.pathname.replace(/^\//, '');
  }
  const repository = path.replace(/\.git$/, '').replace(/\/$/, '');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || repository.split('/').some(part => part === '.' || part === '..')) throw new GithubError('INVALID_REMOTE', 'Remote must identify one owner/repository');
  return { host, repository, normalized: host + '/' + repository.toLowerCase() };
}
const repoPath = (repository: string): string => repository.split('/').map(encodeURIComponent).join('/');
export async function assertGithubAccount(connection: Pick<GithubConnection, 'host' | 'account' | 'repo'>): Promise<void> {
  const user = await githubApi(connection.host, 'user', connection.repo);
  if (String(user.login).toLowerCase() !== connection.account.toLowerCase()) throw new GithubError('ACCOUNT_CHANGED', 'The active GitHub account differs from this connection. Select the expected account on the Mac and refresh.');
}
async function remoteUrls(repo: string, fetchRemote: string, pushRemote: string): Promise<{ fetchUrl: string; pushUrl: string; fingerprint: string }> {
  const fetch = (await githubGit(repo, ['remote', 'get-url', '--all', fetchRemote])).split('\n').filter(Boolean);
  const push = (await githubGit(repo, ['remote', 'get-url', '--push', '--all', pushRemote])).split('\n').filter(Boolean);
  if (fetch.length !== 1 || push.length !== 1) throw new GithubError('AMBIGUOUS_REMOTE', 'Select remotes with exactly one fetch and one push URL');
  parseGithubRemote(fetch[0]); parseGithubRemote(push[0]);
  return { fetchUrl: fetch[0], pushUrl: push[0], fingerprint: createHash('sha256').update(JSON.stringify([fetch[0], push[0]])).digest('hex') };
}
export async function readGithubRules(host: string, repository: string, branch: string, repo: string): Promise<GithubRules> {
  let result: GithubRules = { status: 'none', requiredChecks: [], approvals: 0 };
  try { result = await readProtection(host, repository, branch, repo); } catch (error) { throw error; }
  try {
    const rules = await githubPages<any>(host, `repos/${repoPath(repository)}/rules/branches/${encodeURIComponent(branch)}`, repo);
    for (const rule of rules) {
      if (rule.type === 'required_status_checks') for (const check of rule.parameters?.required_status_checks ?? []) result.requiredChecks.push({ name: check.context, ...(check.integration_id ? { appId: check.integration_id } : {}), acceptedConclusions: ['success'] });
      if (rule.type === 'merge_queue') result.mergeQueue = true;
      if (rule.type === 'pull_request') result.approvals = Math.max(result.approvals, rule.parameters?.required_approving_review_count ?? 0);
      if (['required_status_checks','pull_request'].includes(rule.type)) result.status = 'available';
    }
  } catch (error) { if (!(error instanceof GithubError) || !['NOT_FOUND','FORBIDDEN'].includes(error.code)) throw error; if (error.code === 'FORBIDDEN' && result.status !== 'available') result = { ...result, status: 'unavailable', detail: error.message }; }
  return result;
}
async function readProtection(host: string, repository: string, branch: string, repo: string): Promise<GithubRules> {
  try {
    const result = await githubApi(host, `repos/${repoPath(repository)}/branches/${encodeURIComponent(branch)}/protection`, repo);
    const checks = result.required_status_checks?.checks ?? (result.required_status_checks?.contexts ?? []).map((context: string) => ({ context }));
    return { status: 'available', requiredChecks: checks.map((check: any) => ({ name: String(check.context), ...(Number.isInteger(check.app_id) && check.app_id > 0 ? { appId: check.app_id } : {}), acceptedConclusions: ['success'] })), approvals: result.required_pull_request_reviews?.required_approving_review_count ?? 0 };
  } catch (error) { if (error instanceof GithubError && ['NOT_FOUND', 'FORBIDDEN'].includes(error.code)) return { status: error.code === 'NOT_FOUND' ? 'none' : 'unavailable', requiredChecks: [], approvals: 0, detail: error.message }; throw error; }
}
const requiredSchema = z.array(z.union([z.string().min(1), z.object({ name: z.string().min(1), appId: z.number().int().positive().optional(), creator: z.string().optional(), workflowId: z.number().int().positive().optional(), workflowPath: z.string().max(300).optional(), acceptedConclusions: z.array(z.enum(['success', 'neutral', 'skipped'])).min(1).default(['success']) })])).max(50);
export async function inspectGithubConnection(project: string, args: Record<string, unknown>): Promise<GithubConnection> {
  const cfg = projectConfig(project);
  const input = z.object({ host: z.string().regex(/^[a-zA-Z0-9.-]+$/).default('github.com'), account: z.string().regex(/^[A-Za-z0-9-]+$/), repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/), fetchRemote: z.string().regex(/^[A-Za-z0-9._-]+$/).default('origin'), pushRemote: z.string().regex(/^[A-Za-z0-9._-]+$/).default('origin'), integrationBranch: z.string(), localTargetBranch: z.string().optional(), releaseBranch: z.string().default('main'), workflowMode: z.enum(['github', 'local']).default('github'), requiredChecks: requiredSchema.default([]), requiredWorkflowPath: z.string().max(300).optional() }).parse({ ...args, workflowMode: args.workflowMode ?? args.workflow });
  const partial = { ...input, repo: cfg.repo }; await assertGithubAccount(partial);
  const repository = await githubApi(input.host, `repos/${repoPath(input.repository)}`, cfg.repo);
  if (!repository.id || !repository.full_name) throw new GithubError('INVALID_RESPONSE', 'GitHub repository identity is unavailable');
  const urls = await remoteUrls(cfg.repo, input.fetchRemote, input.pushRemote);
  for (const url of [urls.fetchUrl, urls.pushUrl]) {
    const parsed = parseGithubRemote(url); if (parsed.host !== input.host.toLowerCase()) throw new GithubError('REPOSITORY_MISMATCH', 'The selected remote points to a different GitHub host');
    const actual = await githubApi(input.host, `repos/${repoPath(parsed.repository)}`, cfg.repo);
    if (String(actual.id) !== String(repository.id)) throw new GithubError('REPOSITORY_MISMATCH', 'Selected fetch/push remote does not match the reviewed repository identity');
  }
  const requiredChecks = input.requiredChecks.map(check => typeof check === 'string' ? { name: check, appId: 15368, acceptedConclusions: ['success'] } : !check.appId && !check.creator ? { ...check, appId: 15368 } : check) as RequiredGithubCheck[];
  if (requiredChecks.some(check => check.appId === 15368)) {
    const workflows = (await githubPages<any>(input.host, `repos/${repoPath(repository.full_name)}/actions/workflows`, cfg.repo, 'workflows')).filter(workflow => workflow.state === 'active');
    for (const check of requiredChecks.filter(check => check.appId === 15368)) {
      const path = check.workflowPath ?? input.requiredWorkflowPath;
      const selected = workflows.filter(workflow => (!check.workflowId || workflow.id === check.workflowId) && (!path || workflow.path === path));
      if (selected.length !== 1) throw new GithubError('WORKFLOW_REQUIRED', 'Select the exact active workflow file for ' + check.name + '. Set requiredWorkflowPath or this check’s workflowId/workflowPath; multiple or missing workflows cannot authorize merging.');
      check.workflowId = selected[0].id; check.workflowPath = selected[0].path;
    }
  }
  const integrationBranch = checkedBranch(input.integrationBranch), localTargetBranch = checkedBranch(input.localTargetBranch ?? integrationBranch), releaseBranch = checkedBranch(input.releaseBranch);
  return { project, revision: (connectionFor(project)?.revision ?? 0) + 1, host: input.host.toLowerCase(), account: input.account, repository: repository.full_name, repositoryId: String(repository.id), nodeId: repository.node_id, defaultBranch: repository.default_branch, url: repository.html_url, visibility: repository.private ? 'private' : 'public', repo: cfg.repo,
    gitCommonDir: canonicalPath(await githubGit(cfg.repo, ['rev-parse', '--path-format=absolute', '--git-common-dir'])), fetchRemote: input.fetchRemote, pushRemote: input.pushRemote, fetchUrl: urls.fetchUrl, pushUrl: urls.pushUrl, remoteFingerprint: urls.fingerprint,
    integrationBranch, localTargetBranch, releaseBranch, workflowMode: input.workflowMode, requiredChecks,
    permissions: { push: repository.permissions?.push === true, maintain: repository.permissions?.maintain === true, admin: repository.permissions?.admin === true }, mergeMethods: ['merge', 'squash', 'rebase'].filter(method => repository['allow_' + (method === 'merge' ? 'merge_commit' : method + '_merge')] !== false), rules: await readGithubRules(input.host, repository.full_name, integrationBranch, cfg.repo), observedAt: Date.now() };
}
export async function validateGithubConnection(connection: GithubConnection, write = false): Promise<void> {
  const cfg = projectConfig(connection.project);
  if (canonicalPath(cfg.repo) !== canonicalPath(connection.repo) || canonicalPath(await githubGit(cfg.repo, ['rev-parse', '--path-format=absolute', '--git-common-dir'])) !== connection.gitCommonDir) throw new GithubError('REPOSITORY_CHANGED', 'The registered local repository changed; review its connection again');
  await assertGithubAccount(connection);
  const actual = await githubApi(connection.host, `repos/${repoPath(connection.repository)}`, connection.repo);
  if (String(actual.id) !== connection.repositoryId) throw new GithubError('REPOSITORY_CHANGED', 'GitHub repository identity changed');
  const urls = await remoteUrls(connection.repo, connection.fetchRemote, connection.pushRemote);
  if (urls.fingerprint !== connection.remoteFingerprint) throw new GithubError('REMOTE_CHANGED', 'Git remote URLs changed after review. Reconnect explicitly before publishing.');
  if (write && actual.permissions?.push !== true) throw new GithubError('PERMISSION_DENIED', 'The expected GitHub account cannot push to this repository');
}
export function saveGithubConnection(connection: GithubConnection): GithubConnection {
  const prior = connectionFor(connection.project); if ((prior?.revision ?? 0) !== connection.revision - 1) throw new GithubError('CONNECTION_CHANGED', 'Connection settings changed after review');
  runtime().put('github-connections', connection.project, connection, { type: 'github.connection_updated', projectId: connection.project, payload: { project: connection.project, revision: connection.revision } });
  if (connection.workflowMode === 'github') {
    const auto = runtime().get<Record<string, any>>('config', 'auto') ?? {};
    if (auto[connection.project]?.mode === 'ship' || auto[connection.project]?.autoMerge === true) { auto[connection.project] = { ...auto[connection.project], on: false, autoMerge: false, mode: 'off', note: 'GitHub delivery enabled. Existing local automation paused; remote writes require their own reviewed operations.' }; runtime().put('config', 'auto', auto); }
  }
  return connection;
}
export async function remoteBranchSha(connection: GithubConnection, branch: string, push = false): Promise<string | null> {
  const ref = 'refs/heads/' + checkedBranch(branch), output = await githubGit(connection.repo, ['ls-remote', '--heads', push ? connection.pushUrl : connection.fetchUrl, ref]);
  if (!output) return null;
  const entries = output.split('\n').map(line => line.split(/\s+/)).filter(parts => parts[1] === ref);
  if (entries.length !== 1) throw new GithubError('AMBIGUOUS_REF', 'Remote branch identity is ambiguous'); return checkedSha(entries[0][0]);
}
export async function fetchGithubBranch(connection: GithubConnection, branch: string, namespace = 'base'): Promise<string> {
  await validateGithubConnection(connection);
  const sha = await remoteBranchSha(connection, branch); if (!sha) throw new GithubError('BASE_UNAVAILABLE', 'The remote ' + branch + ' branch does not exist. Initialize its inspected baseline first.');
  const ref = `refs/nibbi/github/${connection.repositoryId}/${namespace.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  await withGithubRepoLock('fetch:' + connection.gitCommonDir, async () => { await githubGit(connection.repo, ['fetch', '--no-tags', connection.fetchUrl, `+refs/heads/${checkedBranch(branch)}:${ref}`], true); });
  const fetched = checkedSha(await githubGit(connection.repo, ['rev-parse', ref]));
  if (fetched !== sha) throw new GithubError('BASE_CHANGED', 'The remote base changed while fetching. Refresh and retry.');
  runtime().put('github-bases', `${connection.project}:${connection.revision}:${branch}`, { sha, branch, observedAt: Date.now(), connectionRevision: connection.revision }); return sha;
}
export async function githubLocalView(project: string): Promise<Record<string, any>> {
  const cfg = projectConfig(project);
  const [branch, headSha, changes, branches] = await Promise.all([githubGit(cfg.repo, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => ''), githubGit(cfg.repo, ['rev-parse', 'HEAD']).catch(() => ''), githubGit(cfg.repo, ['status', '--porcelain=v1', '-z']), githubGit(cfg.repo, ['for-each-ref', '--format=%(refname:short)%09%(objectname)%09%(upstream:short)', 'refs/heads'])]);
  let ahead: number | null = null, behind: number | null = null, upstream: string | null = null;
  try { upstream = await githubGit(cfg.repo, ['rev-parse', '--abbrev-ref', '@{upstream}']); const counts = (await githubGit(cfg.repo, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])).split(/\s+/).map(Number); [ahead, behind] = counts; } catch { /* No tracking branch is not zero divergence. */ }
  return { branch: branch || null, headSha: headSha || null, dirty: !!changes, changedFiles: changes.split('\0').filter(Boolean).length, upstream, ahead, behind, branches: branches.split('\n').filter(Boolean).map(line => { const [name, sha, upstream] = line.split('\t'); return { name, headSha: sha, upstream: upstream || null }; }) };
}
export { repoPath as githubRepoPath };

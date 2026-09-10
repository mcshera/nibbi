import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, renameSync, rmSync, openSync, closeSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { json, jsonBody, body, sse, HttpError, loopback } from './http.js';
import { runtime } from './store.js';
import { config } from './config.js';
import { status, snapshot, autoView, projectsView, milestones, runEvents, artifacts } from './read-models.js';
import { listFixers, getFixerDiff, buildReport, playStatus } from './fixer.js';
import { games, updateProject } from './projects.js';
import { readChat, readAround, searchChat } from './history.js';
import { runTurn, setMasterModel } from './session.js';
import { handleCommand } from './commands.js';
import { goals, schedules } from './scheduler.js';
import { skillCatalog, packageFiles } from './skills.js';
import { streamEvents } from './events.js';
import { executeCommand } from './command-service.js';
import { notifyOwner } from './notify.js';
import { providerStatus, loginCodex } from './auth.js';
import { loginClaude } from './providers/claude-auth.js';
import { scopedPath, within } from './paths.js';
import { decideTool, sensitivePath } from './policy.js';
import { canonicalPath } from './paths.js';
import { previewStatus } from './previews.js';
import { execute, git } from './processes.js';
import { sandboxCommand } from './sandbox.js';
import { lanAddress } from './lan.js';
import { listProposals, inspectProposal } from './proposals.js';
import { githubProjectView, githubBuildView, githubBuildSummary, githubPrDraft } from './github-builds.js';
import { localChangesView } from './build-attempts.js';
import { projectSection, projectSummaries, projectCommand } from './project-workspace.js';

const notify = (text: string): Promise<void> => notifyOwner(null, text);
const aliases: Record<string, string> = { '/api/fix': 'run.dispatch', '/api/fix-queue': 'run.queue', '/api/fix-unqueue': 'run.stop', '/api/fix-requeue': 'run.retry', '/api/fixer-stop': 'run.stop', '/api/fixer-discard': 'run.discard', '/api/fixer-merge': 'run.merge', '/api/fixer-steer': 'run.steer', '/api/group-merge': 'group.merge', '/api/group-stop': 'group.stop', '/api/agents-stop-all': 'runs.stop', '/api/auto': 'auto.set', '/nibbi/goal': 'goal.set' };
const ownerOnly = (req: IncomingMessage): void => { if (!loopback(req)) throw new HttpError(403, 'Manage host settings on the Mac'); };
export async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const path = url.pathname, q = url.searchParams, method = req.method;
  if (!path.startsWith('/api/') && !path.startsWith('/nibbi/')) return false;
  if (path === '/api/project-command') {
    if (method !== 'POST') throw new HttpError(405, 'Use POST');
    const input = await jsonBody(req);
    const result = await projectCommand({ ...input, idempotencyKey: req.headers['idempotency-key'] ?? input.idempotencyKey ?? randomUUID() });
    json(res, result.ok ? 200 : ['REVISION_CONFLICT', 'CONFLICT', 'IN_PROGRESS'].includes(result.error.code) ? 409 : 400, result); return true;
  }
  if (path === '/api/commands' && method === 'POST') {
    const input = await jsonBody(req); if (input.name === 'github.connect' || input.name === 'github.prepare' && (input.args as Record<string, unknown> | undefined)?.operation === 'github.connect') ownerOnly(req); if (/^(skills\.(import|review)|project\.(commands|settings|register|create|scaffold)|schedule\.|proposal\.|vault\.)/.test(String(input.name))) ownerOnly(req);
    const result = await executeCommand(input, notify); json(res, result.ok ? 200 : result.error.code === 'in_progress' ? 409 : 400, result); return true;
  }
  if (method === 'POST' && aliases[path]) {
    const a = await jsonBody(req); const result = await executeCommand({ name: aliases[path], projectId: a.project, args: a, idempotencyKey: req.headers['idempotency-key'] ?? a.idempotencyKey ?? randomUUID() }, notify);
    if (!result.ok) json(res, 409, { error: result.error.message, result });
    else json(res, 200, result.data); return true;
  }
  if (path === '/api/project-create' && method === 'POST') {
    ownerOnly(req); const a = await jsonBody(req); const result = await executeCommand({ name: a.mode === 'existing' ? 'project.register' : 'project.create', args: a, idempotencyKey: req.headers['idempotency-key'] ?? randomUUID() }, notify);
    json(res, result.ok ? 200 : 400, result.ok ? { ...(result.data as object), ok: true } : { error: result.error.message }); return true;
  }
  if (path === '/api/send' && method === 'POST') {
    const input = z.object({ message: z.string().max(100_000).default(''), project: z.string().optional(), stream: z.boolean().default(false), historySource: z.literal('test').optional(), images: z.array(z.object({ media_type: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']), data: z.string().max(8_000_000) })).max(4).optional() }).parse(await jsonBody(req));
    if (input.historySource !== undefined) ownerOnly(req);
    if (!input.message.trim() && !input.images?.length) throw new HttpError(400, 'Empty message');
    const key = String(req.headers['idempotency-key'] ?? randomUUID()); const claim = runtime().claimCommand(key, input);
    if (claim.state !== 'new') {
      if (claim.state !== 'complete') throw new HttpError(409, 'Turn already running or interrupted; inspect activity before retrying');
      if (input.stream) { sse(res)('done', claim.result); res.end(); } else json(res, 200, claim.result); return true;
    }
    const send = input.stream ? sse(res) : undefined; const ping = send ? setInterval(() => { if (!res.destroyed) res.write(': ping\n\n'); }, 15_000) : undefined;
    try {
      const cmd = await handleCommand(input.message, notify, { project: input.project, idempotencyKey: key + ':slash' });
      const result = cmd.handled ? { text: cmd.reply ?? 'ok', isError: cmd.ok === false } : await runTurn(input.message || '(image)', undefined, 'app', undefined, text => send?.('delta', { t: text }), name => send?.('tool', { name }), input.images, true, { project: input.project, historySource: input.historySource, onStart: runId => send?.('start', { runId }) });
      runtime().finishCommand(key, result);
      if (send) { send('done', result); res.end(); } else json(res, result.isError ? 409 : 200, result);
    } catch (error) {
      const result = { text: (error as Error).message, error: (error as Error).message, isError: true }; runtime().finishCommand(key, result);
      if (send) { send('done', result); res.end(); } else json(res, 400, result);
    } finally { if (ping) clearInterval(ping); }
    return true;
  }
  if ((path === '/api/events' || path === '/nibbi/events') && method === 'GET') { streamEvents(req, res, Number(q.get('after') || 0)); return true; }
  if (path === '/api/model') { if (method === 'POST') { const a = await jsonBody(req); await setMasterModel(a.model === 'default' ? null : z.string().parse(a.model)); } json(res, 200, { current: status().modelOverride ?? 'default', options: ['default', 'sonnet', 'opus', 'haiku'] }); return true; }
  if ((path === '/api/vault-write' || path === '/nibbi/vault-write') && method === 'POST') {
    const a = z.object({ path: z.string(), content: z.string().max(1_000_000) }).parse(await jsonBody(req)); const target = scopedPath(config.vaultDir, a.path);
    const decision = decideTool({ role: 'lead', cwd: config.vaultDir, readableRoots: [config.vaultDir], writableRoots: [config.vaultDir] }, 'Write', { file_path: target });
    if (!decision.allowed) throw new HttpError(403, decision.reason!); mkdirSync(dirname(target), { recursive: true }); const temporary = join(dirname(target), '.nibbi-edit-' + randomUUID()); writeFileSync(temporary, a.content, { flag: 'wx', mode: existsSync(target) ? statSync(target).mode : 0o600 }); renameSync(temporary, target);
    runtime().emit({ type: 'vault.updated', payload: { path: a.path } }); json(res, 200, { ok: true }); return true;
  }
  if (path === '/api/play' && method === 'POST') {
    const a = await jsonBody(req); const result = await executeCommand({ name: a.action === 'stop' ? 'play.stop' : 'play.start', projectId: a.project, args: {}, idempotencyKey: req.headers['idempotency-key'] ?? randomUUID() });
    json(res, result.ok ? 200 : 400, result.ok ? result.data : { error: result.error.message }); return true;
  }
  if (path === '/api/providers/login' && method === 'POST') { ownerOnly(req); json(res, 200, await loginCodex()); return true; }
  if (path === '/api/providers/claude/login' && method === 'POST') { ownerOnly(req); json(res, 200, await loginClaude()); return true; }
  if (path === '/api/open' || path === '/api/reveal') {
    if (method !== 'POST') throw new HttpError(405, 'Use POST'); ownerOnly(req); const a = await jsonBody(req); const target = String(a.url ?? a.path ?? '');
    if (path === '/api/open' ? !/^https?:\/\//.test(target) : !Object.values(games()).some(project => project.repo === target) && target !== config.vaultDir) throw new HttpError(403, 'Invalid target');
    await execute(config.stateDir, 'open', [target], { timeoutMs: 5000 }); json(res, 200, { ok: true }); return true;
  }
  if (path === '/api/transcribe' && method === 'POST') {
    const audio = await body(req, 20_000_000); const directory = join(config.stateDir, 'tmp'); mkdirSync(directory, { recursive: true, mode: 0o700 }); const file = join(directory, randomUUID() + '.webm');
    const fd = openSync(file, 'wx', 0o600);
    try {
      try { writeFileSync(fd, audio); } finally { closeSync(fd); }
      const heard = (await execute(directory, join(config.stateDir, 'bin', 'transcribe'), [file, 'fast'], { timeoutMs: 120_000 })).stdout.trim(); json(res, 200, { heard }); return true;
    } finally { rmSync(file, { force: true }); }
  }
  if (path === '/nibbi/run' && method === 'POST') {
    ownerOnly(req); const a = z.object({ project: z.string(), script: z.enum(['test', 'build', 'deploy']) }).parse(await jsonBody(req)); const project = games()[a.project]; if (!project) throw new HttpError(404, 'Unknown project');
    const key = String(req.headers['idempotency-key'] ?? randomUUID()), claim = runtime().claimCommand(key, { action: 'project.script', ...a });
    if (claim.state === 'complete') { sse(res)('done', claim.result); res.end(); return true; }
    if (claim.state !== 'new') throw new HttpError(409, 'This script is running or was interrupted; inspect its outcome before retrying');
    const send = sse(res); send('start', { cmd: 'npm run ' + a.script });
    try { const onOutput = (text: string): void => send('line', { t: text });
      if (a.script === 'deploy') await execute(project.repo, 'npm', ['run', a.script], { onOutput, timeoutMs: 15 * 60_000 });
      else await sandboxCommand(project.repo, 'npm run ' + a.script, { onOutput }); runtime().finishCommand(key, { code: 0 }); send('done', { code: 0 });
    } catch (error) { send('line', { t: (error as Error).message }); runtime().finishCommand(key, { code: 1 }); send('done', { code: 1 }); } finally { res.end(); } return true;
  }
  if (path === '/nibbi/state') {
    if (method === 'POST') { const a = await jsonBody(req); runtime().put('ui-snapshots', String(a.client ?? 'browser'), { ...a, at: Date.now() }); json(res, 200, { ok: true }); }
    else { ownerOnly(req); json(res, 200, runtime().get('ui-snapshots', q.get('client') ?? 'browser') ?? {}); } return true;
  }
  if (path === '/nibbi/client-log') {
    if (method === 'POST') { const a = await jsonBody(req); runtime().put('ui-logs', randomUUID(), { level: String(a.level), msg: String(a.msg).slice(0, 500), at: Date.now() }); runtime().db.prepare("DELETE FROM records WHERE bucket='ui-logs' AND rowid NOT IN (SELECT rowid FROM records WHERE bucket='ui-logs' ORDER BY rowid DESC LIMIT 300)").run(); json(res, 200, { ok: true }); }
    else { ownerOnly(req); json(res, 200, runtime().list('ui-logs').slice(-50)); } return true;
  }
  if (method !== 'GET') throw new HttpError(405, 'Unsupported method');
  switch (path) {
    case '/api/github/pr-draft': json(res, 200, await githubPrDraft(q.get('project') ?? '', q.get('buildId') ?? undefined)); break;
    case '/api/github/project': json(res, 200, await githubProjectView(q.get('project') ?? '')); break;
    case '/api/github/build': json(res, 200, githubBuildView(q.get('id') ?? '')); break;
    case '/api/github/changes': json(res, 200, await localChangesView(q.get('project') ?? '', { buildId: q.get('buildId') ?? undefined })); break;
    case '/api/project-section': json(res, 200, projectSection(q.get('project') ?? '', q.get('section') ?? '')); break;
    case '/api/project-summaries': json(res, 200, projectSummaries((q.get('projects') ?? '').split(',').filter(Boolean))); break;
    case '/api/snapshot': json(res, 200, snapshot()); break;
    case '/api/status': json(res, 200, status()); break;
    case '/nibbi/health': json(res, 200, { app: 'nibbi', version: '0.8.0', protocolVersion: 1, brain: true, status: status(), tls: process.env.NIBBI_REMOTE === '1', remote: process.env.NIBBI_REMOTE === '1', setup: `https://${lanAddress()}:${config.port + 1}/`, gateway: 'local backend' }); break;
    case '/api/projects': json(res, 200, await projectsView()); break;
    case '/api/fixers': json(res, 200, listFixers().reverse().map(run => ({ ...run, github: githubBuildSummary(run.id) })));  break;
    case '/api/fixer-diff': json(res, 200, await getFixerDiff(q.get('id') ?? '')); break;
    case '/api/fixer-log': { const id = q.get('id') ?? ''; json(res, 200, { fixer: (() => { const run=listFixers().find(run=>run.id===id);return run ? {...run,github:githubBuildSummary(run.id)} : undefined; })(), entries: runEvents(id, q.get('attemptId') ?? undefined) }); break; }
    case '/api/fixer-tail': json(res, 200, { lines: runEvents(q.get('id') ?? '', q.get('attemptId') ?? undefined).slice(-5).map(event => event.text) }); break;
    case '/api/auto': { const all = autoView(); json(res, 200, q.has('project') ? all[q.get('project')!] : all); break; }
    case '/nibbi/goal': json(res, 200, goals()); break;
    case '/api/schedules': json(res, 200, schedules()); break;
    case '/api/proposals': json(res, 200, q.has('name') ? inspectProposal(q.get('name')!) : listProposals()); break;
    case '/api/skills': json(res, 200, { skills: skillCatalog().list(), settings: runtime().get('skill-settings', (q.get('project') ?? 'vault') + ':' + (q.get('role') ?? 'lead')) ?? [] }); break;
    case '/api/skills/content': { const skill = skillCatalog().resolve({ id: q.get('id') ?? '', revision: q.get('revision') ?? '' }, true); const file = scopedPath(skill.path, q.get('file') ?? 'SKILL.md'); if (statSync(file).size > 1_000_000) throw new HttpError(413, 'Inspect large or binary assets locally before approval'); json(res, 200, { skill, content: readFileSync(file, 'utf8'), files: packageFiles(skill.path) }); break; }
    case '/api/providers': ownerOnly(req); json(res, 200, await providerStatus()); break;
    case '/api/milestones': json(res, 200, milestones(q.get('project') ?? '')); break;
    case '/api/build-report': json(res, 200, { text: buildReport(Math.max(1, Math.min(720, Number(q.get('hours')) || 24))) }); break;
    case '/api/artifacts': json(res, 200, artifacts(q.get('project') ?? '')); break;
    case '/api/growth': json(res, 200, runtime().replay(0, 5000).filter(event => event.type.startsWith('skill.')).reverse().map(event => ({ hash: String(event.payload.revision ?? '').slice(0, 8), at: event.at, msg: event.type + ': ' + event.payload.id }))); break;
    case '/api/play': if (q.has('action') && q.get('action') !== 'status') throw new HttpError(405, 'Preview changes require POST'); json(res, 200, playStatus(q.get('project') ?? '')); break;
    case '/api/preview': json(res, 200, previewStatus(q.get('id') ?? '')); break;
    case '/api/history': { const n = Number(q.get('n')) || 80; json(res, 200, q.has('q') ? searchChat(q.get('q')!, n) : q.has('around') ? readAround(q.get('around')!, n) : readChat(n, q.get('before') ?? undefined, q.get('project') ?? undefined)); break; }
    case '/api/vault-tree': {
      const path = q.get('path') ? scopedPath(config.vaultDir, q.get('path')!) : config.vaultDir; json(res, 200, readdirSync(path, { withFileTypes: true }).filter(entry => !entry.name.startsWith('.') && !entry.isSymbolicLink()).map(entry => ({ name: entry.name, directory: entry.isDirectory() }))); break;
    }
    case '/api/vault': case '/nibbi/repo': {
      const root = path === '/api/vault' ? config.vaultDir : games()[q.get('project') ?? '']?.repo; if (!root) throw new HttpError(404, 'Unknown project');
      const rel = q.get('p') ?? q.get('path') ?? 'README.md'; const file = scopedPath(root, rel);
      if (sensitivePath(file) || sensitivePath(canonicalPath(file)) || rel.split('/').includes('.git')) throw new HttpError(403, 'Credential files and Git internals are not exposed');
      if (existsSync(file) && (!statSync(file).isFile() || statSync(file).size > 1_000_000)) throw new HttpError(413, 'Not a small text file');
      json(res, 200, { path: rel, content: existsSync(file) ? readFileSync(file, 'utf8') : '(missing)' }); break;
    }
    case '/nibbi/git': { const project = games()[q.get('project') ?? '']; if (!project) throw new HttpError(404, 'Unknown project'); const lines = await git(project.repo, 'log', '-n', String(Math.max(1, Math.min(30, Number(q.get('n')) || 8))), '--pretty=format:%h%x01%ct%x01%an%x01%s'); json(res, 200, lines.split('\n').filter(Boolean).map(line => { const [hash, at, author, msg] = line.split('\x01'); return { hash, at: Number(at) * 1000, author, msg }; })); break; }
    case '/api/say': { const text = (q.get('text') ?? '').slice(0, 1200); const response = await fetch('http://127.0.0.1:4521/synth?text=' + encodeURIComponent(text), { signal: AbortSignal.timeout(60_000) }); if (!response.ok) throw new HttpError(503, 'Local voice service unavailable'); res.writeHead(200, { 'content-type': response.headers.get('content-type') ?? 'audio/wav', 'cache-control': 'no-store' }); res.end(Buffer.from(await response.arrayBuffer())); break; }
    case '/api/file': { const file = resolve(q.get('p') ?? ''); if (!/\.(png|jpe?g|gif|webp)$/i.test(file) || ![config.vaultDir, ...Object.values(games()).map(project => project.repo)].some(root => within(root, file))) throw new HttpError(403, 'File is outside scope'); res.writeHead(200, { 'content-type': /\.jpe?g$/i.test(file) ? 'image/jpeg' : 'image/' + file.split('.').pop() }); res.end(readFileSync(file)); break; }
    case '/nibbi/ca.crt': { const file = join(config.stateDir, 'nibbi-tls', 'ca.crt'); if (!existsSync(file)) throw new HttpError(404, 'Start the backend with --remote to generate a local CA'); res.writeHead(200, { 'content-type': 'application/x-x509-ca-cert', 'content-disposition': 'attachment; filename="nibbi-local-ca.crt"' }); res.end(readFileSync(file)); break; }
    case '/nibbi/livereload': case '/api/livereload': { sse(res)('ready', {}); res.end(); break; }
    default: throw new HttpError(404, 'Endpoint not found');
  }
  return true;
}

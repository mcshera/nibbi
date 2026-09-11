import { CommandRequestSchema, ProjectSettingsSchema, SkillRefSchema, failure, success, type CommandResult } from '@nibbi/contracts';
import { z } from 'zod';
import { executeGithubCommand } from './github-builds.js';
import { runtime } from './store.js';
import { createProject, registerProject, updateProject } from './projects.js';
import { approveFixer, discardFixer, spawnFixer, queueFix, requeueFix, stopFixer, stopAllFixers, stopGroup, mergeGroup, steerFixer, setAuto, previewStart, previewStop, playStart, playStop } from './fixer.js';
import { cancelTurn, resetSession, steerTurn } from './session.js';
import { skillCatalog } from './skills.js';
import { configureSchedule, setGoal } from './scheduler.js';
import { adoptProposal } from './proposals.js';
import { git, withRepoLock } from './processes.js';
import { config } from './config.js';
import { verifyRetained } from './fixer.js';
import { scaffoldProject } from './scaffold.js';
import { setWebAccess, promptSearchKey, webStatus, normalizeDomains } from './web-tools.js';
import { upsertMcpServer, removeMcpServer, setMcpServerEnabled, setMcpServerProjects, checkMcpServer, promptMcpSecret } from './mcp-clients.js';
import { executePlan, cancelPlan } from './plan-proposals.js';
import { createMcpToken, revokeMcpToken } from './mcp-server.js';
const text = (value: unknown): string => z.string().min(1).max(100_000).parse(value);
const projectId = (value: unknown): string => z.string().regex(/^[a-z0-9][a-z0-9-]*$/).parse(value);
export async function executeCommand(input: unknown, notify: (message: string) => Promise<void> = async () => undefined): Promise<CommandResult> {
  const parsed = CommandRequestSchema.safeParse(input); if (!parsed.success) return failure('invalid_request', parsed.error.message);
  const command = parsed.data; const store = runtime();
  try {
    const claim = store.claimCommand(command.idempotencyKey, command);
    if (claim.state === 'complete') return claim.result as CommandResult;
    if (claim.state !== 'new') return failure('in_progress', 'This command is already running or was interrupted. Inspect current state before retrying.');
    let data: unknown, message: string | undefined; const a = command.args;
    try {
      switch (command.name) {
        case 'run.dispatch': case 'run.queue': {
          const opts = z.object({ provider: z.enum(['claude', 'codex']).optional(), model: z.string().optional(), title: z.string().optional(), context: z.string().optional(), task: z.string().optional(), taskId: z.string().optional(), group: z.string().optional(), issueIds: z.array(z.string().regex(/^[a-zA-Z0-9_-]+$/)).max(100).optional() }).parse(a);
          const project = projectId(command.projectId ?? a.project), issue = text(a.issue);
          data = command.name === 'run.dispatch' ? spawnFixer(project, issue, notify, opts) : queueFix(project, issue, opts); break;
        }
        case 'run.stop': message = stopFixer(text(a.id)); break;
        case 'run.discard': message = discardFixer(text(a.id)); break;
        case 'run.retry': message = requeueFix(text(a.id)); break;
        case 'run.merge': message = await approveFixer(text(a.id)); break;
        case 'run.verify': message = await verifyRetained(text(a.id)); break;
        case 'run.steer': message = await steerFixer(text(a.id), text(a.text)); break;
        case 'runs.stop': data = { stopped: stopAllFixers() }; break;
        case 'group.stop': data = { stopped: stopGroup(projectId(command.projectId ?? a.project), text(a.group)) }; break;
        case 'group.merge': message = await mergeGroup(projectId(command.projectId ?? a.project), text(a.group)); break;
        case 'turn.stop': await cancelTurn(text(a.id)); message = 'Turn stopping'; break;
        case 'turn.steer': await steerTurn(text(a.id), text(a.text)); message = 'Guidance delivered to the running turn'; break;
        case 'plan.execute': data = await executePlan(text(a.id), text(a.fingerprint), notify); break;
        case 'plan.cancel': data = cancelPlan(text(a.id)); break;
        case 'session.reset': resetSession(); message = 'Fresh working context; vault memory is preserved'; break;
        case 'project.create': data = await createProject(text(a.name)); break;
        case 'project.scaffold': data = await scaffoldProject(projectId(command.projectId), z.enum(['web', 'game']).parse(a.template)); break;
        case 'project.register': data = await registerProject(text(a.name), text(a.path)); break;
        case 'project.settings': data = updateProject(projectId(command.projectId), { settings: ProjectSettingsSchema.parse(a.settings) }); break;
        case 'project.commands': { const input = z.object({ check: z.string(), install: z.string(), play: z.string().optional(), installDomains: z.array(z.string()).max(30).optional(), webDomains: z.array(z.string()).max(50).optional() }).parse(a); data = updateProject(projectId(command.projectId), { ...input, ...(input.webDomains ? { webDomains: normalizeDomains(input.webDomains) } : {}) }); break; }
        case 'web.settings': data = setWebAccess(z.object({ domains: z.array(z.string()).max(100).optional(), searchCount: z.number().int().min(1).max(10).optional() }).parse(a)); break;
        case 'web.keyPrompt': data = await promptSearchKey(); break;
        case 'mcp.upsert': data = upsertMcpServer(a.server ?? a); break;
        case 'mcp.remove': removeMcpServer(text(a.name)); message = 'MCP server removed; its tools leave the next turn'; break;
        case 'mcp.enable': data = setMcpServerEnabled(text(a.name), z.boolean().parse(a.enabled)); break;
        case 'mcp.projects': data = setMcpServerProjects(text(a.name), z.union([z.literal('*'), z.array(z.string().min(1).max(64)).max(50)]).parse(a.projects)); break;
        case 'mcp.check': data = await checkMcpServer(text(a.name)); break;
        case 'mcp.secretPrompt': data = await promptMcpSecret(text(a.name), text(a.key)); break;
        case 'mcp.tokenCreate': data = createMcpToken(a); message = 'Token created. Copy it now; it is shown once.'; break;
        case 'mcp.tokenRevoke': data = await revokeMcpToken(text(a.name)); message = 'Token revoked; its connections are closed'; break;
        case 'web.check': data = await webStatus(command.projectId ?? (typeof a.project === 'string' ? a.project : undefined)); break;
        case 'auto.set': {
          const patch = z.object({ mode: z.enum(['off', 'suggest', 'stage', 'ship']).optional(), on: z.boolean().optional(), autoMerge: z.boolean().optional(), maxConcurrent: z.number().int().min(1).max(4).optional(), spendCap: z.number().nonnegative().optional(), focus: z.string().optional(), model: z.string().optional() }).parse(a);
          data = setAuto(projectId(command.projectId ?? a.project), patch); break;
        }
        case 'goal.set': data = setGoal(projectId(command.projectId ?? a.project), z.object({ text: z.string().optional(), focus: z.string().optional(), mode: z.enum(['stage', 'ship']).optional(), stop: z.boolean().optional() }).parse(a)); break;
        case 'schedule.set': data = configureSchedule(text(a.id), z.boolean().parse(a.enabled)); break;
        case 'proposal.adopt': message = await adoptProposal(text(a.name), text(a.revision), text(a.baseHash)); break;
        case 'vault.checkpoint': message = await withRepoLock(config.vaultDir, async () => { await git(config.vaultDir, 'add', '-A'); if (!(await git(config.vaultDir, 'status', '--porcelain'))) return 'Vault is already checkpointed'; await git(config.vaultDir, 'commit', '-m', 'Vault checkpoint requested by owner'); return 'Vault checkpoint committed'; }); break;
        case 'skills.import': data = skillCatalog().import(text(a.path), 'owner-import'); break;
        case 'skills.review': data = skillCatalog().review(text(a.id), text(a.revision)); break;
        case 'skills.enable': skillCatalog().enable(projectId(command.projectId), z.enum(['lead', 'fixer']).parse(a.role), z.array(SkillRefSchema).parse(a.refs)); message = 'Skill revisions saved for the next run'; break;
        case 'skills.draft': data = skillCatalog().draft(text(a.name), text(a.description), text(a.body), z.array(z.string()).parse(a.evidence)); break;
        case 'preview.start': message = previewStart(text(a.id)); break;
        case 'preview.stop': message = previewStop(text(a.id)); break;
        case 'play.start': data = playStart(projectId(command.projectId ?? a.project)); if ((data as { error?: string }).error) throw new Error((data as { error: string }).error); break;
        case 'play.stop': message = playStop(projectId(command.projectId ?? a.project)); break;
        default: data = await executeGithubCommand(command.name, projectId(command.projectId ?? a.project), a, notify); break;
      }
      const result = success(data ?? { text: message }, message);
      // The idempotency log is at rest; a freshly minted MCP token is shown once and never stored in plaintext, so a replay gets the record without the secret.
      store.finishCommand(command.idempotencyKey, command.name === 'mcp.tokenCreate' ? success({ ...(data as Record<string, unknown>), token: '[shown once]' }, message) : result); return result;
    } catch (error) { const result = failure('command_failed', (error as Error).message); store.finishCommand(command.idempotencyKey, result); return result; }
  } catch (error) { return failure('conflict', (error as Error).message); }
}

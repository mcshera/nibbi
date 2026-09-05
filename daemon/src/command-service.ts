import { CommandRequestSchema, ProjectSettingsSchema, SkillRefSchema, failure, success, type CommandResult } from '@nibbi/contracts';
import { z } from 'zod';
import { runtime } from './store.js';
import { createProject, registerProject, updateProject } from './projects.js';
import { approveFixer, discardFixer, spawnFixer, queueFix, requeueFix, stopFixer, stopAllFixers, stopGroup, mergeGroup, steerFixer, setAuto, previewStart, previewStop, playStart, playStop } from './fixer.js';
import { cancelTurn, resetSession } from './session.js';
import { skillCatalog } from './skills.js';
import { configureSchedule, setGoal } from './scheduler.js';
import { adoptProposal } from './proposals.js';
import { git, withRepoLock } from './processes.js';
import { config } from './config.js';
import { verifyRetained } from './fixer.js';
import { scaffoldProject } from './scaffold.js';
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
          const opts = z.object({ provider: z.enum(['claude', 'codex']).optional(), model: z.string().optional(), title: z.string().optional(), context: z.string().optional(), task: z.string().optional(), taskId: z.string().optional(), group: z.string().optional() }).parse(a);
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
        case 'session.reset': resetSession(); message = 'Fresh working context; vault memory is preserved'; break;
        case 'project.create': data = await createProject(text(a.name)); break;
        case 'project.scaffold': data = await scaffoldProject(projectId(command.projectId), z.enum(['web', 'game']).parse(a.template)); break;
        case 'project.register': data = await registerProject(text(a.name), text(a.path)); break;
        case 'project.settings': data = updateProject(projectId(command.projectId), { settings: ProjectSettingsSchema.parse(a.settings) }); break;
        case 'project.commands': data = updateProject(projectId(command.projectId), z.object({ check: z.string(), install: z.string(), play: z.string().optional(), installDomains: z.array(z.string()).max(30).optional() }).parse(a)); break;
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
        default: throw new Error('Unknown command: ' + command.name);
      }
      const result = success(data ?? { text: message }, message); store.finishCommand(command.idempotencyKey, result); return result;
    } catch (error) { const result = failure('command_failed', (error as Error).message); store.finishCommand(command.idempotencyKey, result); return result; }
  } catch (error) { return failure('conflict', (error as Error).message); }
}

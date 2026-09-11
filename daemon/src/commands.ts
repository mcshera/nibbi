import { randomUUID } from 'node:crypto';
import { executeCommand } from './command-service.js';
import { listFixers, games } from './fixer.js';
import { loadState, saveState } from './state.js';
export interface CmdResult { handled: boolean; reply?: string; ok?: boolean }
export async function handleCommand(raw: string, notify: (message: string) => Promise<void>, options: { project?: string; idempotencyKey?: string } = {}): Promise<CmdResult> {
  if (!raw.trim().startsWith('/')) return { handled: false };
  const [command, ...parts] = raw.trim().slice(1).split(/\s+/); const arg = parts.join(' ');
  const map: Record<string, { name: string; args: Record<string, unknown> }> = {
    fix: { name: 'run.dispatch', args: { issue: arg } }, approve: { name: 'run.merge', args: { id: arg } },
    discard: { name: 'run.discard', args: { id: arg } }, retry: { name: 'run.retry', args: { id: arg } },
    clear: { name: 'session.reset', args: {} }, stop: { name: 'run.stop', args: { id: arg } },
    preview: { name: parts[1] === 'stop' ? 'preview.stop' : 'preview.start', args: { id: parts[0] } },
  };
  if (map[command]) {
    const project = options.project ?? loadState().playtestGame;
    const result = await executeCommand({ ...map[command], projectId: project, idempotencyKey: options.idempotencyKey ?? randomUUID() }, notify);
    return { handled: true, ok: result.ok, reply: result.ok ? result.text ?? JSON.stringify(result.data) : result.error.message };
  }
  if (command === 'fixers') return { handled: true, ok: true, reply: listFixers().slice(-30).map(run => run.id + ' · ' + run.status + ' · ' + run.game + ' · ' + run.title).join('\n') || 'No runs yet' };
  if (command === 'playtest') { const project = arg || options.project; if (!project || !games()[project]) return { handled: true, ok: false, reply: 'Choose a registered project first' }; const state = loadState(); state.playtestGame = project; saveState(state); return { handled: true, ok: true, reply: 'Playtest mode on: ' + project }; }
  if (command === 'endtest') { const state = loadState(); state.playtestGame = undefined; saveState(state); return { handled: true, ok: true, reply: 'Playtest mode off' }; }
  if (command === 'help') return { handled: true, ok: true, reply: '/fix · /fixers · /approve · /discard · /retry · /preview · /clear · /playtest · /endtest. Provider and skill settings are in the app.' };
  // Unknown slash commands are explicit errors, never silently handed to an agent as mutations.
  return { handled: true, ok: false, reply: 'Unknown command: /' + command };
}

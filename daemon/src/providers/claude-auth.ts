import { accessSync, constants, mkdtempSync, mkdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { config } from '../config.js';
import { execute, safeEnvironment } from '../processes.js';

type Runner = typeof execute;
export type ClaudeAuthMode = 'signin' | 'api-key';
export interface ClaudeConnection { mode: ClaudeAuthMode; env: NodeJS.ProcessEnv; executable?: string }
export interface ClaudeStatus { connected: boolean; mode: ClaudeAuthMode; subscription?: string; error?: string }
export function claudeAuthMode(): ClaudeAuthMode {
  const mode = process.env.NIBBI_CLAUDE_AUTH ?? 'signin';
  if (mode !== 'signin' && mode !== 'api-key') throw new Error('NIBBI_CLAUDE_AUTH must be signin or api-key');
  return mode;
}
export function claudeEnvironment(): NodeJS.ProcessEnv {
  const env = safeEnvironment();
  // Use the account owned by the unmodified CLI, never an inherited API gateway,
  // key, profile, OAuth token, or custom credential directory. No secret extraction.
  for (const key of Object.keys(env)) if (/^ANTHROPIC_|^CLAUDE_CODE_(USE_|OAUTH|API_KEY)|^CLAUDE_CONFIG_DIR$|^CLAUDECODE$/.test(key)) delete env[key];
  env.CLAUDE_AGENT_SDK_CLIENT_APP = 'nibbi/0.8.0';
  return env;
}
export function claudeExecutable(): string {
  const override = process.env.NIBBI_CLAUDE_BIN;
  const candidates = override ? [override] : [join(homedir(), '.local', 'bin', 'claude'), ...((process.env.PATH ?? '').split(':').filter(isAbsolute).map(path => join(path, 'claude'))), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'];
  for (const path of candidates) { try { if (!isAbsolute(path) || !statSync(path).isFile()) continue; accessSync(path, constants.X_OK); return realpathSync(path); } catch { /* next installation */ } }
  throw new Error(override ? 'NIBBI_CLAUDE_BIN must point to an executable Claude Code installation' : 'Install Claude Code on this Mac, then choose Sign in with Claude in Settings → Providers');
}
const statusArgs = ['--setting-sources', '', '--settings', '{"forceLoginMethod":"claudeai"}', 'auth', 'status', '--json'];
export async function claudeStatus(run: Runner = execute): Promise<ClaudeStatus> {
  const mode = claudeAuthMode();
  try {
    if (mode === 'api-key') { await apiKey(run); return { connected: true, mode }; }
    const result = await run(tmpdir(), claudeExecutable(), statusArgs, { env: claudeEnvironment(), timeoutMs: 10_000 });
    const value = JSON.parse(result.stdout) as Record<string, unknown>;
    const connected = value.loggedIn === true && value.authMethod === 'claude.ai' && value.apiProvider === 'firstParty';
    return { connected, mode, subscription: connected && typeof value.subscriptionType === 'string' ? value.subscriptionType : undefined,
      error: connected ? undefined : 'Sign in to Claude Code with your Claude account. Nibbi will not fall back to API billing.' };
  } catch (error) { return { connected: false, mode, error: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'Install Claude Code on this Mac first' : 'Claude sign-in unavailable. Use Sign in with Claude, then Check connections.' }; }
}
async function apiKey(run: Runner): Promise<string> {
  if (process.env.NIBBI_CLAUDE_API_KEY) return process.env.NIBBI_CLAUDE_API_KEY;
  try { const key = (await run(tmpdir(), 'security', ['find-generic-password', '-s', 'com.nibbi.claude', '-a', 'api-key', '-w'], { timeoutMs: 10_000 })).stdout.trim(); if (key) return key; } catch { /* explicit API mode only */ }
  throw new Error('Explicit Claude API mode needs a key in Keychain (com.nibbi.claude / api-key); unset NIBBI_CLAUDE_AUTH to use sign-in');
}
export async function prepareClaude(run: Runner = execute): Promise<ClaudeConnection> {
  const mode = claudeAuthMode(), env = claudeEnvironment();
  if (mode === 'api-key') { env.ANTHROPIC_API_KEY = await apiKey(run); return { mode, env }; }
  const status = await claudeStatus(run); if (!status.connected) throw new Error(status.error);
  return { mode, env, executable: claudeExecutable() };
}
const quote = (text: string): string => "'" + text.replaceAll("'", "'\\''") + "'";
export async function loginClaude(run: Runner = execute): Promise<{ message: string }> {
  if (claudeAuthMode() !== 'signin') throw new Error('Unset NIBBI_CLAUDE_AUTH=api-key and restart Nibbi to use Claude sign-in');
  const executable = claudeExecutable();
  const base = join(config.stateDir, 'tmp'); mkdirSync(base, { recursive: true, mode: 0o700 });
  const file = join(mkdtempSync(join(base, 'claude-login-')), 'Sign in to Claude.command');
  // Let the official CLI own the entire browser/code/credential flow. The terminal
  // also handles its interactive fallback; no OAuth URL or token passes through Nibbi.
  const script = '#!/bin/bash\nset -e\ncd /private/tmp\nfor name in $(compgen -e); do\n  case "$name" in ANTHROPIC_*|CLAUDE_CODE_USE_*|CLAUDE_CODE_OAUTH*|CLAUDE_CODE_API_KEY*|CLAUDE_CONFIG_DIR|CLAUDECODE|NODE_OPTIONS|BASH_ENV|ENV) unset "$name";; esac\ndone\nexec ' + quote(executable) + ' --setting-sources \'\' --settings \'{"forceLoginMethod":"claudeai"}\' auth login --claudeai\n';
  writeFileSync(file, script, { mode: 0o700, flag: 'wx' });
  await run(tmpdir(), '/usr/bin/open', ['-a', 'Terminal', file], { env: claudeEnvironment(), timeoutMs: 5000 });
  return { message: 'Claude Code opened in Terminal. Complete its browser sign-in, then click Check connections. Nibbi never receives your password or login tokens.' };
}

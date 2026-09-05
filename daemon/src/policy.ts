import type { CanUseTool, HookCallback } from '@anthropic-ai/claude-agent-sdk';
import { resolve, basename } from 'node:path';
import { within, controlPath, canonicalPath } from './paths.js';

export interface ToolScope {
  role: 'lead' | 'fixer';
  cwd: string;
  readableRoots: string[];
  writableRoots: string[];
  tools?: string[];
  skillNames?: string[];
}
export interface PolicyDecision { allowed: boolean; reason?: string }
const READ = new Set(['Read', 'Grep', 'Glob', 'NotebookRead']);
const WRITE = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const deny = (reason: string): PolicyDecision => ({ allowed: false, reason });
export function sensitivePath(path: string): boolean {
  return path.split(/[\\/]/).some(part => part === '.env' || part.startsWith('.env.') || ['.ssh', '.aws', '.gnupg', '.npmrc', '.netrc'].includes(part));
}

export function decideTool(scope: ToolScope, tool: string, input: Record<string, unknown>): PolicyDecision {
  if (READ.has(tool)) {
    const target = String(input.file_path ?? input.path ?? input.notebook_path ?? scope.cwd);
    const abs = resolve(scope.cwd, target);
    if (sensitivePath(abs) || sensitivePath(canonicalPath(abs))) return deny('Credential files are not available to agents');
    return scope.readableRoots.some(root => within(root, abs, true))
      ? { allowed: true } : deny('Read is outside this run’s scope');
  }
  if (WRITE.has(tool)) {
    const target = String(input.file_path ?? input.notebook_path ?? '');
    if (!target) return deny('A file path is required');
    const abs = resolve(scope.cwd, target);
    try { if (scope.writableRoots.some(root => controlPath(root, abs) || controlPath(root, canonicalPath(abs)))) return deny('Agent configuration and Git metadata are backend-owned'); }
    catch { return deny('Invalid path'); }
    if (scope.role === 'lead') {
      let base: string;
      try { base = basename(canonicalPath(abs)); } catch { return deny('Invalid path'); }
      if (['SOUL.md', 'AGENTS.md'].includes(base)) return deny('Protected file: submit a proposal');
    }
    return scope.writableRoots.some(root => within(root, abs)) ? { allowed: true } : deny('Write is outside this run’s scope');
  }
  if (tool === 'Bash') {
    if (scope.role !== 'fixer' || !scope.writableRoots.length) return deny('Use file tools to read and governed Nibbi tools for actions');
    if (input.dangerouslyDisableSandbox) return deny('The sandbox is required');
    // This is defense in depth. The provider's OS sandbox confines shell writes.
    const cmd = String(input.command ?? '');
    if (/\b(sudo|launchctl|security|osascript)\b|\bgit\s+(?:(?:-[^\s]+)\s+)*(?:push|commit|merge|rebase|reset|clean|checkout|switch|worktree|config|add|tag|branch)\b|\bgh\b|[\r\n]/i.test(cmd))
      return deny('System changes, Git writes and publishing are backend-owned');
    return { allowed: true };
  }
  if (tool === 'Skill') return (scope.skillNames ?? []).includes(String(input.skill ?? ''))
    ? { allowed: true } : deny('Skill is not enabled for this run');
  if (['TodoWrite', 'WebSearch', 'WebFetch'].includes(tool)) return { allowed: true };
  if ((scope.tools ?? []).includes(tool)) return { allowed: true };
  return deny("Tool '" + tool + "' is not enabled for this run");
}

export function policyFor(scope: ToolScope): CanUseTool {
  return async (tool, input) => {
    const decision = decideTool(scope, tool, input);
    return decision.allowed ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: decision.reason! };
  };
}

/** Mandatory policy runs before permission rules can pre-approve a call. */
export function policyHook(scope: ToolScope): HookCallback {
  return async input => {
    if (input.hook_event_name !== 'PreToolUse') return {};
    const decision = decideTool(scope, input.tool_name, input.tool_input as Record<string, unknown>);
    return decision.allowed ? {} : { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: decision.reason } };
  };
}

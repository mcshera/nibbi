import { z } from 'zod';

export const ProviderSchema = z.enum(['claude', 'codex']);
export type ProviderId = z.infer<typeof ProviderSchema>;
export const RoleSchema = z.enum(['lead', 'fixer']);
export type AgentRole = z.infer<typeof RoleSchema>;
export const AutoModeSchema = z.enum(['off', 'suggest', 'stage', 'ship']);
export const RunStatusSchema = z.enum(['queued', 'installing', 'running', 'awaiting_input', 'verifying', 'staged', 'merged', 'failed', 'cancelled', 'interrupted', 'discarded', 'superseded']);
export type RunStatus = z.infer<typeof RunStatusSchema>;
export const SkillRefSchema = z.object({ id: z.string().min(1), revision: z.string().min(1) });
export type SkillRef = z.infer<typeof SkillRefSchema>;
export const RunRequestSchema = z.object({
  projectId: z.string().min(1), role: RoleSchema.default('fixer'), provider: ProviderSchema.default('claude'),
  model: z.string().min(1).optional(), task: z.string().min(1).max(100_000), taskId: z.string().optional(),
  skillRefs: z.array(SkillRefSchema).default([]), idempotencyKey: z.string().min(1).max(200),
});
export type RunRequest = z.infer<typeof RunRequestSchema>;
export interface RunEvent { id: number; runId?: string; projectId?: string; type: string; at: number; payload: Record<string, unknown> }
export interface Action { label: string; command: string; args?: Record<string, unknown>; confirm?: string }
export type CommandResult<T = unknown> = { ok: true; data: T; text?: string; actions?: Action[] } | { ok: false; error: { code: string; message: string; retryable?: boolean } };
export const CommandRequestSchema = z.object({
  idempotencyKey: z.string().min(1).max(200), projectId: z.string().optional(),
  name: z.string().min(1).max(80), args: z.record(z.string(), z.unknown()).default({}),
});
export type CommandRequest = z.infer<typeof CommandRequestSchema>;
export interface SkillDescriptor {
  id: string; name: string; description: string; source: string; path: string; revision: string;
  providers: ProviderId[]; roles: AgentRole[]; dependencies: string[]; enabled: boolean;
  status: 'available' | 'invalid' | 'unsupported' | 'draft'; errors: string[];
}
export interface ProviderCapabilities { streaming: boolean; steering: boolean; cancellation: boolean; skills: boolean; tools: boolean; images: boolean }
export interface ProviderSettings { provider: ProviderId; model?: string }
export interface ProjectSettings { lead: ProviderSettings; fixer: ProviderSettings }
export const ProjectSettingsSchema = z.object({
  lead: z.object({ provider: ProviderSchema, model: z.string().optional() }),
  fixer: z.object({ provider: ProviderSchema, model: z.string().optional() }),
});
export function success<T>(data: T, text?: string): CommandResult<T> { return { ok: true, data, ...(text ? { text } : {}) }; }
export function failure(code: string, message: string, retryable = false): CommandResult<never> { return { ok: false, error: { code, message, retryable } }; }

/** GitHub writes execute only persisted reviews; these names never accept raw shell arguments. */
export const GithubOperationNameSchema = z.enum(['github.connect', 'build.publish', 'build.prCreate', 'build.prAdopt', 'build.connect', 'build.prReady', 'build.prDraft', 'build.prMerge', 'build.verifyMerged', 'project.publishBranch', 'project.syncTarget', 'project.preparePromotion', 'project.mergePromotion', 'project.promotionReady', 'project.verifyPromotion', 'project.issueLink', 'build.cleanup', 'build.adoptChanges', 'build.update', 'build.checkpoint', 'build.updateBase', 'build.adoptRemote']);
export type GithubOperationName = z.infer<typeof GithubOperationNameSchema>;
export const GithubExecuteSchema = z.object({ operationId: z.string().regex(/^ghop-[a-f0-9-]+$/) }).strict();
export const GithubFreshnessSchema = z.object({ status: z.enum(['fresh','stale','error','not_connected']), observedAt: z.number().nullable(), error: z.string().optional() });
export interface GithubReview { operationId: string; operation: GithubOperationName; state: string; review: Record<string, unknown>; expiresAt: number }

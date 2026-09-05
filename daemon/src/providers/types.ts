import type { AgentRole, ProviderId, ProviderCapabilities, SkillDescriptor } from '@nibbi/contracts';
import type { ToolLease } from '../tool-service.js';
export interface AgentInput {
  runId: string; role: AgentRole; provider: ProviderId; model?: string; cwd: string; prompt: string; instructions: string;
  skills: SkillDescriptor[]; nativeSkills: { root: string; paths: string[] }; tools: ToolLease;
  sessionId?: string; images?: { media_type: string; data: string }[]; signal: AbortSignal;
  onEvent: (type: string, payload: Record<string, unknown>) => void;
}
export interface AgentResult { text: string; sessionId?: string; costUsd?: number; ctxTokens?: number; isError: boolean }
export interface AgentHandle { result: Promise<AgentResult>; steer: (text: string) => Promise<void>; cancel: () => Promise<void> }
export interface AgentProvider { id: ProviderId; capabilities: ProviderCapabilities; start: (input: AgentInput) => AgentHandle }

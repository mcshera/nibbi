import { randomUUID } from 'node:crypto';
import type { Fixer } from './fixer.js';
import { runtime } from './store.js';

export interface BuildAttempt {
  id: string; buildId: string; project: string; kind: 'initial' | 'update' | 'adopt' | 'checkpoint' | 'updateBase' | 'adoptRemote' | 'verify';
  instruction: string; inputHead?: string; baseSha?: string; worktree: string;
  status: string; startedAt: string; endedAt?: string; candidateSha?: string;
  verification?: Fixer['verification']; costUsd?: number; summary?: string; sessionId?: string;
}
export const attemptsFor = (buildId: string): BuildAttempt[] => runtime().list<BuildAttempt>('build-attempts').filter(a => a.buildId === buildId);
export function beginAttempt(f: Fixer, kind: BuildAttempt['kind'], instruction: string): BuildAttempt {
  const attempt: BuildAttempt = { id: 'attempt-' + randomUUID(), buildId: f.id, project: f.game, kind, instruction,
    inputHead: f.commitSha, baseSha: f.baseSha, worktree: f.worktree, status: 'queued', startedAt: new Date().toISOString() };
  runtime().put('build-attempts', attempt.id, attempt);
  f.attemptId = attempt.id; f.attemptKind = kind; f.attemptInstruction = instruction; f.inputHead = f.commitSha;
  f.latestAttemptStartedAt = attempt.startedAt;
  f.attemptCostUsd = undefined; f.attemptBaseSha = undefined; f.sessionId = undefined; f.endedAt = undefined;
  return attempt;
}
/** Finalized attempts are immutable. A Build projects current state without rewriting old evidence. */
export function recordAttempt(f: Fixer): void {
  if (!f.attemptId) return;
  const previous = runtime().get<BuildAttempt>('build-attempts', f.attemptId);
  if (!previous || previous.endedAt) return;
  const terminal = ['staged', 'failed', 'cancelled', 'interrupted', 'discarded', 'superseded'].includes(f.status);
  const next: BuildAttempt = { ...previous, status: f.status, baseSha: f.attemptBaseSha ?? f.baseSha,
    candidateSha: f.commitSha !== previous.inputHead || f.attemptKind === 'verify' ? f.commitSha : undefined,
    verification: f.verification, summary: f.summary, costUsd: f.attemptCostUsd, sessionId: f.sessionId,
    ...(terminal ? { endedAt: f.endedAt ?? new Date().toISOString() } : {}) };
  runtime().put('build-attempts', next.id, next);
}

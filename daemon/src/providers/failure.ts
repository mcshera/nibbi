import type { ExecutionEvidence, UsageLimit } from './types.js';

/** Only structured provider evidence may authorize an automatic fallback. */
export class ProviderTurnError extends Error {
  readonly usageLimit?: UsageLimit;
  readonly evidence?: ExecutionEvidence;
  constructor(message: string, details: { usageLimit?: UsageLimit; evidence?: ExecutionEvidence; cause?: unknown } = {}) {
    super(message, { cause: details.cause });
    this.name = 'ProviderTurnError';
    this.usageLimit = details.usageLimit;
    this.evidence = details.evidence ? { ...details.evidence } : undefined;
  }
}

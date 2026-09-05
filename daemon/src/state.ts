// Compatibility read model; runtime state is persisted in SQLite.
import { runtime } from './store.js';

export interface GatewayState {
  sessionId?: string;
  lastTurnAt?: string;
  turns: number;
  costUsdTotal: number;
  playtestGame?: string;
  modelOverride?: string | null;
  ctxTokens?: number; // last turn's full prompt size ≈ live context
  rateLimit?: { status: string; utilization?: number; resetsAt?: number; type?: string };
}

export function loadState(): GatewayState {
  return runtime().get<GatewayState>('config', 'state') ?? runtime().get<GatewayState>('legacy', 'state.json') ?? { turns: 0, costUsdTotal: 0 };
}

export function saveState(s: GatewayState): void {
  runtime().put('config', 'state', s);
}

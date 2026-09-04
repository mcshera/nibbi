// state.ts — gateway runtime state (~/.nibbi/state.json)
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/** Crash-safe write: temp file + atomic rename (never leaves a half/empty file). */
export function writeJsonAtomic(p: string, data: string): void { const tmp = p + ".tmp"; writeFileSync(tmp, data); renameSync(tmp, p); }

export const ORACLE_HOME = join(homedir(), ".nibbi");
const STATE = join(ORACLE_HOME, "state.json");

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
  if (!existsSync(STATE)) return { turns: 0, costUsdTotal: 0 };
  try { return JSON.parse(readFileSync(STATE, "utf8")) as GatewayState; }
  catch { return { turns: 0, costUsdTotal: 0 }; }
}

export function saveState(s: GatewayState): void {
  mkdirSync(ORACLE_HOME, { recursive: true });
  writeJsonAtomic(STATE, JSON.stringify(s, null, 2));
}

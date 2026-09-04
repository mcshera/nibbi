// notify.ts — local notifications. Every "push" the daemon used to send to Telegram lands in ~/.nibbi/notes.jsonl;
// the Nibbi app's host tails it and shows each one as a bubble (and a macOS notification when the window is hidden).
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ORACLE_HOME } from "./state.js";

const FILE = join(ORACLE_HOME, "notes.jsonl");
export async function notifyOwner(_bot: unknown, text: string, silent = false): Promise<void> {
  try { mkdirSync(ORACLE_HOME, { recursive: true }); appendFileSync(FILE, JSON.stringify({ ts: Date.now(), text: String(text).slice(0, 4000), silent }) + "\n"); }
  catch { /* disk */ }
}

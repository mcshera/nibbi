// history.ts — unified conversation log (all channels) at ~/.nibbi/chat-history.jsonl
import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ORACLE_HOME } from "./state.js";

export interface ChatEntry { ts: string; channel: string; role: "user" | "oracle"; text: string; costUsd?: number; }

const FILE = join(ORACLE_HOME, "chat-history.jsonl");

export function logChat(entry: ChatEntry): void {
  mkdirSync(ORACLE_HOME, { recursive: true });
  appendFileSync(FILE, JSON.stringify(entry) + "\n");
}

function parseAll(): ChatEntry[] {
  if (!existsSync(FILE)) return [];
  return readFileSync(FILE, "utf8").trim().split("\n")
    .map((l) => { try { return JSON.parse(l) as ChatEntry; } catch { return null; } })
    .filter((e): e is ChatEntry => e !== null);
}

export function readChat(n = 80, before?: string): ChatEntry[] {
  const all = parseAll();
  const upto = before ? all.filter((e) => e.ts < before) : all;
  return upto.slice(-n);
}

/** Case-insensitive substring search, newest first. */
export function searchChat(q: string, limit = 40): ChatEntry[] {
  const needle = q.toLowerCase();
  return parseAll().filter((e) => e.text.toLowerCase().includes(needle)).slice(-limit).reverse();
}

/** A window of entries centered on the message at `ts`. */
export function readAround(ts: string, n = 50): ChatEntry[] {
  const all = parseAll();
  const i = all.findIndex((e) => e.ts === ts);
  if (i < 0) return all.slice(-n);
  const half = Math.floor(n / 2);
  return all.slice(Math.max(0, i - half), i + half);
}

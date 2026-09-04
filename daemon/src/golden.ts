// golden.ts — regression checks for the harness (system prompt + vault), run in FRESH sessions.
// Guards against context collapse / prompt rot after self-improvement changes.
import { query, type SDKMessage, type SDKUserMessage, type CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ORACLE_HOME } from "./state.js";
import { buildSystemPrompt, VAULT } from "./vault.js";

export interface GoldenTask { q: string; mustContain: string[]; }
export interface GoldenResult { q: string; pass: boolean; answer: string; }

const FILE = join(ORACLE_HOME, "golden.json");

const DEFAULTS: GoldenTask[] = [
  { q: "One line: what game am I building and what folder is its repo in?", mustContain: ["shipless", "board game test"] },
  { q: "The game was renamed. Old name and current name, nothing else.", mustContain: ["derelict", "shipless"] },
  { q: "Which slash command spawns a code-fix agent, and which one merges its branch?", mustContain: ["/fix", "/approve"] },
  { q: "Relative vault path where playtest session logs for shipless live?", mustContain: ["games/shipless/playtests"] },
  { q: "Name the two protected vault files you may not edit directly.", mustContain: ["soul", "agents"] },
  { q: "What must never be written into the vault, per your rules?", mustContain: ["secret"] },
];

export function loadGolden(): GoldenTask[] {
  if (!existsSync(FILE)) writeFileSync(FILE, JSON.stringify(DEFAULTS, null, 2));
  return JSON.parse(readFileSync(FILE, "utf8")) as GoldenTask[];
}

const readOnly: CanUseTool = async (tool, input) =>
  ["Read", "Grep", "Glob"].includes(tool)
    ? { behavior: "allow", updatedInput: input }
    : { behavior: "deny", message: "golden runs are read-only" };

async function* asStream(text: string): AsyncIterable<SDKUserMessage> {
  yield { type: "user", message: { role: "user", content: [{ type: "text", text }] }, parent_tool_use_id: null } as SDKUserMessage;
}

async function askFresh(q: string, model: string): Promise<string> {
  let text = "";
  const it = query({
    prompt: asStream(q),
    options: { cwd: VAULT, systemPrompt: buildSystemPrompt(), canUseTool: readOnly, maxTurns: 6, model, title: "golden" },
  });
  for await (const msg of it as AsyncIterable<SDKMessage>) {
    if (msg.type === "assistant") {
      const blocks = (msg as unknown as { message: { content: Array<{ type: string; text?: string }> } }).message.content;
      for (const b of blocks) if (b.type === "text" && b.text) text += b.text;
    }
  }
  return text;
}

/** Run all golden tasks in fresh sessions (no master-session pollution). */
export async function runGolden(model = "haiku"): Promise<{ passed: number; total: number; results: GoldenResult[] }> {
  const tasks = loadGolden();
  const results: GoldenResult[] = [];
  for (const t of tasks) {
    let answer = "";
    try { answer = await askFresh(t.q, model); } catch (e) { answer = `ERROR: ${(e as Error).message}`; }
    const low = answer.toLowerCase();
    results.push({ q: t.q, pass: t.mustContain.every((m) => low.includes(m.toLowerCase())), answer: answer.slice(0, 200) });
  }
  return { passed: results.filter((r) => r.pass).length, total: results.length, results };
}

export function formatGolden(g: { passed: number; total: number; results: GoldenResult[] }): string {
  const lines = g.results.map((r) => `${r.pass ? "✅" : "❌"} ${r.q.slice(0, 60)}${r.pass ? "" : `\n   → ${r.answer.slice(0, 120)}`}`);
  return `golden: ${g.passed}/${g.total}\n` + lines.join("\n");
}

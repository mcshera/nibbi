// policy.ts — permission tiers, enforced in code from day one.
// T0 free: read/search/web. T0v: writes INSIDE the vault (except protected files).
// Bash: safe-prefix allowlist. Everything else: deny with a friendly reason (P2 adds approval taps).
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import { resolve } from "node:path";
import { VAULT, PROTECTED } from "./vault.js";

const READ_TOOLS = new Set([
  "Read", "Grep", "Glob", "WebSearch", "WebFetch", "TodoWrite", "Task", "NotebookRead", "ListMcpResources",
]);
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const BASH_SAFE_PREFIXES = [
  "git ", "ls", "cat ", "grep ", "rg ", "find ", "head ", "tail ", "wc ", "date",
  "mkdir -p", "echo ", "diff ", "tree", "pwd", "gh ",
];
const GH_DESTRUCTIVE = /gh\s+(repo\s+delete|auth\b|secret|api\s+.*(-X|--method)\s*(POST|PUT|PATCH|DELETE)|pr\s+merge|release\s+delete)/i;

const insideVault = (p: string): boolean => resolve(String(p)).startsWith(VAULT);
const isProtected = (p: string): boolean => PROTECTED.some((f) => resolve(String(p)) === resolve(VAULT, f));

/* game repos are oracle's workshop: probe scripts in /tmp, screenshots in <repo>/.oracle-shots/ */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
function gameRepos(): string[] {
  try {
    const g = JSON.parse(readFileSync(join(homedir(), ".nibbi", "games.json"), "utf8")) as Record<string, { repo?: string }>;
    return Object.values(g).map((x) => x.repo || "").filter(Boolean);
  } catch { return []; }
}
const inShotsDir = (p: string): boolean => {
  const abs = resolve(String(p));
  return gameRepos().some((r) => abs.startsWith(join(r, ".oracle-shots") + "/")) || abs.startsWith("/tmp/");
};
const NODE_PROBE = /^(node|npx)\s+[^;&|><`$()]*$/;

export const canUseTool: CanUseTool = async (tool, input) => {
  if (READ_TOOLS.has(tool)) return { behavior: "allow", updatedInput: input };

  if (WRITE_TOOLS.has(tool)) {
    const target = String(input["file_path"] ?? input["notebook_path"] ?? "");
    if (isProtected(target))
      return { behavior: "deny", message: `${target} is PROTECTED. Propose the change as a diff in chat; Matty approves.` };
    if (insideVault(target)) return { behavior: "allow", updatedInput: input };
    if (inShotsDir(target)) return { behavior: "allow", updatedInput: input };
    return { behavior: "deny", message: `P0 policy: writes only inside the vault (${VAULT}) or a game repo's .oracle-shots/. Game-repo source edits go through /fix.` };
  }

  if (tool === "Bash") {
    const cmd = String(input["command"] ?? "").trim();
    const safe = BASH_SAFE_PREFIXES.some((p) => cmd === p.trim() || cmd.startsWith(p));
    const noChaining = !/[;&|><`$()]/.test(cmd.replace(/"[^"]*"|'[^']*'/g, ""));
    if (GH_DESTRUCTIVE.test(cmd)) return { behavior: "deny", message: "gh act-gate: destructive gh commands need Matty." };
    if (safe && noChaining) return { behavior: "allow", updatedInput: input };
    if (NODE_PROBE.test(cmd)) return { behavior: "allow", updatedInput: input }; // node/npx probes & preview servers (no chaining)
    return { behavior: "deny", message: "P0 policy: bash limited to read-only/git prefixes without chaining. Ask Matty if you need more." };
  }

  if (tool.startsWith("mcp__github__")) {
    const op = tool.replace("mcp__github__", "");
    if (/^(delete_|merge_|push_|update_.*branch|create_or_update_file|fork_)/.test(op))
      return { behavior: "deny", message: `github act-gate: '${op}' is blocked — ask Matty or use the /fix flow.` };
    return { behavior: "allow", updatedInput: input };
  }
  if (tool.startsWith("mcp__")) return { behavior: "allow", updatedInput: input }; // future registry servers: reads

  return { behavior: "deny", message: `P0 policy: tool '${tool}' not yet enabled.` };
};

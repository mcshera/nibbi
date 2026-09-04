// proposals.ts — Oracle proposes protected-file changes; Matty adopts; golden gates; git reverts.
// Proposal file format (vault/proposals/NNN-slug.md):
//   TARGET: SOUL.md
//   RATIONALE: <one paragraph>
//   ## NEW CONTENT
//   <entire new file content>
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, basename } from "node:path";
import { VAULT, PROTECTED, appendLog } from "./vault.js";
import { runGolden, formatGolden } from "./golden.js";

const DIR = join(VAULT, "proposals");
const ADOPTED = join(DIR, "adopted");

export function listProposals(): string[] {
  if (!existsSync(DIR)) return [];
  return readdirSync(DIR).filter((f) => f.endsWith(".md"));
}

export async function adoptProposal(name: string): Promise<string> {
  const file = listProposals().find((f) => f === name || f.startsWith(name));
  if (!file) return `no proposal matching '${name}' — /proposals to list`;
  const raw = readFileSync(join(DIR, file), "utf8");
  const target = /^TARGET:\s*(.+)$/m.exec(raw)?.[1]?.trim();
  const content = raw.split(/^## NEW CONTENT\s*$/m)[1]?.replace(/^\n/, "");
  if (!target || !content) return `malformed proposal ${file}: needs 'TARGET:' line and '## NEW CONTENT' section`;
  if (!PROTECTED.includes(target)) return `target ${target} is not a protected file — Nibbi can edit it directly, no proposal needed`;

  const targetPath = join(VAULT, target);
  const before = readFileSync(targetPath, "utf8");
  writeFileSync(targetPath, content);

  const g = await runGolden();
  if (g.passed < g.total) {
    writeFileSync(targetPath, before); // instant revert
    return `⛔ adoption REVERTED — golden regression after applying ${file}:\n${formatGolden(g)}`;
  }
  mkdirSync(ADOPTED, { recursive: true });
  renameSync(join(DIR, file), join(ADOPTED, file));
  appendLog("adopt", `${file} -> ${target} (golden ${g.passed}/${g.total})`);
  try {
    execFileSync("git", ["-C", VAULT, "add", "-A"], { stdio: "pipe" });
    execFileSync("git", ["-C", VAULT, "-c", "user.name=Matty", "-c", "user.email=matty@local",
      "commit", "-q", "-m", `adopt ${basename(file)} -> ${target}`], { stdio: "pipe" });
  } catch { /* commit best-effort */ }
  return `✅ adopted ${file} → ${target} · golden ${g.passed}/${g.total}`;
}

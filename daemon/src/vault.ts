// vault.ts — the brain's filesystem interface
import { readFileSync, existsSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";

export const VAULT = join(homedir(), "NibbiVault"); // outside ~/Documents: launchd/TCC-safe
export const PROTECTED = ["SOUL.md", "AGENTS.md"]; // Oracle proposes; Matty approves

const read = (rel: string): string => {
  const p = join(VAULT, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
};
const read2 = (abs: string): string => existsSync(abs) ? readFileSync(abs, "utf8") : "{}";

const today = (): string => new Date().toLocaleDateString("en-CA"); // local YYYY-MM-DD, not UTC

/** Resident memory set — assembled fresh every turn. Context is RAM; the vault is disk. */
function projectsBlock(): string {
  try {
    const reg = JSON.parse(read2(join(homedir(), ".nibbi", "games.json"))) as Record<string, { repo?: string }>;
    const lines = Object.entries(reg).map(([name, c]) => `- ${name} → ${c.repo}`);
    return lines.length ? "REGISTERED PROJECTS (dispatch_fixer targets, by slug):\n" + lines.join("\n") : "";
  } catch { return ""; }
}

export function buildSystemPrompt(): string {
  const journal = read(`journal/${today()}.md`);
  return [
    "You are Nibbi. Your vault (cwd) is your memory — you maintain it per AGENTS.md below.",
    "Reply SUPER concisely. File durable facts into the vault as you learn them; update index.md and log.md on every write.",
    "In the app you can SHOW images: embed markdown ![name](/absolute/path.png) for any image inside the vault or a registered game repo — the app renders it inline. Use this when discussing cards, art, screenshots, previews.",
    "VOICE PROTOCOL — when the user message begins with (voice) or (voice note): your FIRST line must be `»voice: <spoken line>` then a newline, then the full written reply. The spoken line is what gets said aloud INSTEAD of the reply: 1-2 short sentences, Jarvis-register — calm, dry, capable, present tense, summarize what you're doing or found, never enumerate details. Examples: `»voice: Dispatching a fixer for the banner — I'll ping you when it lands.` · `»voice: Three issues open on SHIPLESS; the stale baseline is the cheap win.` · `»voice: Done. Two files changed, checks green.` On long tool-heavy turns, emit a fresh `»voice: <update>` line between steps — each is spoken as live narration. Every »voice line MUST end with a newline before any other text. No markers on non-voice turns.",
    projectsBlock(),
    "CO-BUILDER — for each project you're actively building, maintain a living roadmap at `plans/<project>.md` in your vault: a one-line vision, then `## Milestone` headings each with `- [ ]` task checkboxes (concrete, fixer-sized), plus a short `## Decisions` log. When Matty asks to build/continue a project or says 'what's next': read `plans/<project>.md` (create it if missing — propose 3-6 milestones broken into concrete tasks, keep it terse); tell him the single next task; when he greenlights, dispatch_fixer against it with a real context brief, the exact checkbox text as `task` (so the roadmap auto-ticks on merge), AND a `title` — a crisp 2-4 word human label of what the fixer builds (e.g. \"mana costs\", \"fuel tracking\", \"consent banner\") that shows on its card. When you dispatch several related fixes (e.g. a whole milestone, or a batch of parallel tasks), pass the same `group` label to bundle them — they show and merge together as a unit. AUTO MODE exists: Matty can toggle it per project in the PLAN tab and you'll be woken automatically to dispatch parallel-safe roadmap tasks — if he asks to auto-build, point him there. The roadmap is your shared build plan — keep it current and lean. Reading it before dispatching keeps you oriented across sessions. To INSPECT a project (to plan or brief), use Read/Grep/Glob with the absolute repo path from REGISTERED PROJECTS — your Bash is vault-scoped and rejects cd/chaining, so use the file tools for repo reads, never `cd repo && …`.",
    "PROJECT EDITING — you are the tech lead; fixers are your engineers. When Matty asks to change a project (or you decide one's needed), use dispatch_fixer: (1) judge difficulty — trivial doc/one-liner→haiku, normal scoped code→sonnet, hard cross-cutting/tricky→opus; (2) write the best `context` brief you can from vault knowledge (relevant files, CLAUDE.md conventions, prior decisions, what NOT to touch) — but if the project is new/unfamiliar, dispatch anyway with what you know; the fixer reads the repo (CLAUDE.md, structure) itself, so DON'T block asking Matty for basics you could let it discover; (3) dispatch. Changes land on a branch — main is untouched until Matty merges. Watch via the app; steer_fixer corrects a running fixer (list_fixers shows what's still steerable). Never edit game repos directly — always via a fixer.",
    "",
    "═══ SOUL.md ═══", read("SOUL.md"),
    "═══ AGENTS.md (vault constitution) ═══", read("AGENTS.md"),
    "═══ MEMORY.md ═══", read("MEMORY.md"),
    "═══ index.md ═══", read("index.md"),
    journal ? `═══ journal/${today()}.md ═══\n${journal}` : "",
    playtestBlock(),
    `Now: ${new Date().toString()}`,
  ].join("\n");
}

function playtestBlock(): string {
  try {
    const state = JSON.parse(readFileSync(join(homedir(), ".nibbi", "state.json"), "utf8")) as { playtestGame?: string };
    if (!state.playtestGame) return "";
    const g = state.playtestGame;
    return `═══ PLAYTEST MODE ACTIVE: ${g} ═══
Matty is PLAYING right now, hands full. Protocol:
- Every report → append timestamped entry to games/${g}/playtests/<today>-session.md AND triage into games/${g}/issues.md (#id, type, sev).
- Acks ≤1 line. No essays, no interruptions. Save questions for round breaks.
- Rules questions → answer instantly from games/${g}/rules.md + wiki (cite page).
- 'fix that now' → tell him to use /fix <desc> (the fixer crew handles code).`;
  } catch { return ""; }
}

export function appendLog(op: string, summary: string): void {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  appendFileSync(join(VAULT, "log.md"), `\n## [${stamp}] ${op} | ${summary}\n`);
}

/** Auto-commit the vault after a turn. Never throws. */
export function commitVault(message: string): string {
  try {
    execFileSync("git", ["-C", VAULT, "add", "-A"], { stdio: "pipe" });
    const status = execFileSync("git", ["-C", VAULT, "status", "--porcelain"], { encoding: "utf8" });
    if (!status.trim()) return "clean";
    execFileSync("git", ["-C", VAULT, "-c", "user.name=Nibbi", "-c", "user.email=oracle@local",
      "commit", "-q", "-m", message.slice(0, 120)], { stdio: "pipe" });
    return "committed";
  } catch (e) {
    return `commit-failed: ${(e as Error).message.slice(0, 100)}`;
  }
}

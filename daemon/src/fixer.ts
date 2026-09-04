// fixer.ts — parallel fix agents: one issue, one git worktree, one independent session.
// Fixers run OUTSIDE the master turn lock (separate Claude sessions) => true parallelism.
import { query, type SDKMessage, type SDKUserMessage, type CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { ORACLE_HOME } from "./state.js";

export interface GameCfg { repo: string; install: string; check: string; }
export interface Fixer {
  id: string; game: string; issue: string; branch: string; worktree: string;
  status: "queued" | "installing" | "running" | "done" | "failed" | "merged" | "superseded";
  startedAt: string; endedAt?: string; costUsd?: number; summary?: string; diffstat?: string; model?: string; task?: string; project?: string; title?: string; context?: string; difficulty?: string; redispatches?: number; group?: string;
}

const WORK = join(homedir(), "NibbiWork", "fixers");
const FIXER_MODEL = process.env.ORACLE_FIXER_MODEL || "sonnet"; // strong+cheap for gated code fixes; override via env
const REG = join(ORACLE_HOME, "fixers.json");

export function games(): Record<string, GameCfg> {
  return JSON.parse(readFileSync(join(ORACLE_HOME, "games.json"), "utf8")) as Record<string, GameCfg>;
}

const GAMES = join(ORACLE_HOME, "games.json");
const AUTO = join(ORACLE_HOME, "auto.json");

export interface AutoCfg { on: boolean; maxConcurrent: number; autoMerge: boolean; mode?: "off" | "suggest" | "stage" | "ship"; note?: string; at?: string; onAt?: string; spendCap?: number; model?: string; focus?: string; }
export function autoConfig(): Record<string, AutoCfg> {
  try { return JSON.parse(readFileSync(AUTO, "utf8")) as Record<string, AutoCfg>; } catch { return {}; }
}
export function noteAuto(project: string, note: string): void {
  const all = autoConfig();
  if (!all[project]) return;
  all[project] = { ...all[project], note: note.slice(0, 160), at: new Date().toISOString() };
  try { writeJsonAtomic(AUTO, JSON.stringify(all, null, 2)); } catch { /* noop */ }
}
export function setAuto(project: string, cfg: Partial<AutoCfg>): AutoCfg {
  const all = autoConfig();
  const cur = all[project] ?? { on: false, maxConcurrent: 2, autoMerge: false };
  const next: AutoCfg = { ...cur, ...cfg };
  next.maxConcurrent = Math.max(1, Math.min(4, next.maxConcurrent || 2)); // cap 1-4 for sane usage
  if (cfg.mode) { next.on = cfg.mode !== "off"; next.autoMerge = cfg.mode === "ship"; }
  else if (cfg.on !== undefined || cfg.autoMerge !== undefined) { next.mode = !next.on ? "off" : (next.autoMerge ? "ship" : "stage"); }
  const enabling = cfg.mode ? (cfg.mode !== "off" && !cur.on) : (cfg.on === true && !cur.on);
  if (enabling) next.onAt = new Date().toISOString(); // reset the spend window when (re)enabled
  all[project] = next;
  writeJsonAtomic(AUTO, JSON.stringify(all, null, 2));
  return next;
}

/** Fixers currently occupying capacity for a project (installing/running). */
export function inflightFor(project: string): Fixer[] {
  return listFixers().filter((f) => f.game === project && (f.status === "running" || f.status === "installing"));
}
/** Fixers done-but-unmerged for a project (staged, awaiting review/merge). */
export function stagedFor(project: string): Fixer[] {
  return listFixers().filter((f) => f.game === project && f.status === "done");
}
/** Unchecked roadmap tasks for a project (from the vault plan). */
export function pendingTasks(project: string): string[] {
  try {
    const plan = join(homedir(), "NibbiVault", "plans", `${project}.md`);
    if (!existsSync(plan)) return [];
    return readFileSync(plan, "utf8").split("\n")
      .map((l) => l.match(/^\s*[-*]\s*\[ \]\s+(.*)$/)?.[1] ?? "")
      .filter(Boolean);
  } catch { return []; }
}

/** Roadmap completion for a project: checked vs total tasks in plans/<project>.md. */
export function roadmapProgress(project: string): { done: number; total: number } {
  try {
    const plan = join(homedir(), "NibbiVault", "plans", `${project}.md`);
    if (!existsSync(plan)) return { done: 0, total: 0 };
    const txt = readFileSync(plan, "utf8");
    const done = (txt.match(/^\s*[-*]\s*\[x\]/gim) || []).length;
    const todo = (txt.match(/^\s*[-*]\s*\[ \]/gim) || []).length;
    return { done, total: done + todo };
  } catch { return { done: 0, total: 0 }; }
}

/** Fixer spend for a project since auto was last turned on (cfg.at) — powers the cost meter + cap. */
export function autoSpend(project: string): number {
  const cfg = autoConfig()[project];
  const since = cfg?.onAt ? new Date(cfg.onAt).getTime() : (cfg?.at ? new Date(cfg.at).getTime() : 0);
  return listFixers()
    .filter((f) => f.game === project && !!f.startedAt && new Date(f.startedAt).getTime() >= since)
    .reduce((s, f) => s + (f.costUsd || 0), 0);
}

/** Deterministic overnight/last-N-hours build summary (no LLM cost) for the morning report. */
export function buildReport(hours = 16): string {
  const since = Date.now() - hours * 3600_000;
  const recent = listFixers().filter((f) => f.endedAt && new Date(f.endedAt).getTime() >= since);
  if (!recent.length) return "";
  const byGame: Record<string, Fixer[]> = {};
  for (const f of recent) (byGame[f.game] = byGame[f.game] || []).push(f);
  const lines: string[] = [];
  for (const [g, list] of Object.entries(byGame)) {
    const merged = list.filter((f) => f.status === "merged");
    const staged = list.filter((f) => f.status === "done");
    const failed = list.filter((f) => f.status === "failed");
    const cost = list.reduce((s, f) => s + (f.costUsd || 0), 0);
    const rp = roadmapProgress(g);
    const parts = [`${merged.length} merged`];
    if (staged.length) parts.push(`${staged.length} staged`);
    if (failed.length) parts.push(`${failed.length} failed`);
    lines.push(`${g}: ${parts.join(" · ")} · $${cost.toFixed(2)} · roadmap ${rp.done}/${rp.total}`);
    if (merged.length) lines.push("  ✓ " + merged.map((f) => f.title ?? f.id).slice(0, 8).join(", "));
  }
  return lines.join("\n");
}

/** The branch a fixer merges INTO — the project repo's currently checked-out branch (may be main/master/accounts…). */
export function mergeTarget(repo: string): string {
  try { return sh(repo, "git", ["rev-parse", "--abbrev-ref", "HEAD"]).trim() || "main"; }
  catch { return "main"; }
}

/** Full diff of a staged (done) fixer's branch vs its merge target, for the review-before-merge modal. */
export function getFixerDiff(id: string): { branch: string; target: string; game: string; diffstat: string; diff: string; truncated: boolean } {
  const f = listFixers().find((x) => x.id === id);
  if (!f) throw new Error(`no fixer ${id}`);
  const cfg = games()[f.game];
  if (!cfg) throw new Error(`unknown project ${f.game}`);
  const target = mergeTarget(cfg.repo);
  const from = existsSync(f.worktree) ? f.worktree : cfg.repo;
  const range = `${target}...${f.branch}`;
  let diff = "", diffstat = "";
  try { diffstat = sh(from, "git", ["diff", "--stat", range]).trim(); } catch { diffstat = f.diffstat ?? ""; }
  try { diff = sh(from, "git", ["diff", range]); } catch (e) { diff = `(diff unavailable: ${(e as Error).message.slice(0, 80)})`; }
  const LIMIT = 60_000;
  const truncated = diff.length > LIMIT;
  return { branch: f.branch, target, game: f.game, diffstat, diff: truncated ? diff.slice(0, LIMIT) + "\n\n… (diff truncated — review in the worktree)" : diff, truncated };
}

/** Detect sensible install/check commands for a repo so a new project just works with the fixer gate. */
function detectCommands(repo: string): { install: string; check: string } {
  const pkgPath = join(repo, "package.json");
  if (!existsSync(pkgPath)) return { install: "true", check: "true" };
  let scripts: Record<string, string> = {};
  try { scripts = (JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> }).scripts ?? {}; } catch { /* noop */ }
  const install = existsSync(join(repo, "package-lock.json")) ? "npm ci" : "npm install";
  const checks: string[] = [];
  for (const s of ["typecheck", "check", "lint", "validate", "test"]) if (scripts[s]) checks.push(`npm run ${s}`);
  return { install, check: checks.length ? checks.join(" && ") : "true" };
}

/** Register an existing folder as an editable project (git-init if needed). */
export function registerProject(name: string, repo: string): GameCfg {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug) throw new Error("project name must contain letters or digits");
  const abs = resolve(repo);
  if (!existsSync(abs)) throw new Error(`path does not exist: ${abs}`);
  if (!existsSync(join(abs, ".git"))) {
    sh(abs, "git", ["init"]);
    sh(abs, "git", ["add", "-A"]);
    try { sh(abs, "git", ["-c", "user.name=Nibbi", "-c", "user.email=oracle@local", "commit", "-m", "initial commit (registered by Oracle)"]); } catch { /* empty repo ok */ }
  }
  const reg = games();
  if (reg[slug]) throw new Error(`project '${slug}' already registered`);
  const cfg: GameCfg = { repo: abs, ...detectCommands(abs) };
  reg[slug] = cfg;
  writeJsonAtomic(GAMES, JSON.stringify(reg, null, 2));
  return cfg;
}

/** Create a brand-new project from scratch under ~/NibbiProjects, git-init + register. */
export function createProject(name: string): { slug: string; repo: string } {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug) throw new Error("project name must contain letters or digits");
  const root = join(homedir(), "NibbiProjects");
  mkdirSync(root, { recursive: true });
  const repo = join(root, slug);
  if (existsSync(repo)) throw new Error(`folder already exists: ${repo}`);
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, "README.md"), `# ${name}\n\nStarted with Nibbi on ${new Date().toISOString().slice(0, 10)}.\n`);
  sh(repo, "git", ["init"]);
  sh(repo, "git", ["add", "-A"]);
  sh(repo, "git", ["-c", "user.name=Nibbi", "-c", "user.email=oracle@local", "commit", "-m", "initial commit (new project via Nibbi)"]);
  registerProject(slug, repo);
  return { slug, repo };
}
export function listFixers(): Fixer[] {
  return existsSync(REG) ? (JSON.parse(readFileSync(REG, "utf8")) as Fixer[]) : [];
}
function writeJsonAtomic(p: string, data: string): void { const tmp = p + ".tmp"; writeFileSync(tmp, data); renameSync(tmp, p); }
function saveFixers(all: Fixer[]): void { writeJsonAtomic(REG, JSON.stringify(all, null, 2)); }
function upsert(f: Fixer): void {
  const all = listFixers().filter((x) => x.id !== f.id);
  all.push(f); saveFixers(all);
}
function removeFixer(id: string): void {
  saveFixers(listFixers().filter((x) => x.id !== id));
}
const sh = (cwd: string, cmd: string, args: string[]): string =>
  execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16e6 });

/** Tool policy for fixers: full read; write/edit/bash confined to the worktree; no push, no sudo. */
function fixerPolicy(worktree: string): CanUseTool {
  const inside = (p: string): boolean => resolve(String(p)).startsWith(worktree);
  return async (tool, input) => {
    if (["Read", "Grep", "Glob", "TodoWrite", "WebSearch", "WebFetch", "Task"].includes(tool))
      return { behavior: "allow", updatedInput: input };
    if (["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(tool)) {
      const target = String(input["file_path"] ?? input["notebook_path"] ?? "");
      return inside(target)
        ? { behavior: "allow", updatedInput: input }
        : { behavior: "deny", message: `fixer scope: write only inside ${worktree}` };
    }
    if (tool === "Bash") {
      const cmd = String(input["command"] ?? "");
      if (/\b(sudo|git\s+push|launchctl|security\b|gh\s+(repo\s+delete|auth\b|secret))/.test(cmd))
        return { behavior: "deny", message: "fixer scope: forbidden command" };
      return { behavior: "allow", updatedInput: input };
    }
    return { behavior: "deny", message: `fixer scope: tool ${tool} not enabled` };
  };
}

async function* asStream(text: string): AsyncIterable<SDKUserMessage> {
  yield { type: "user", message: { role: "user", content: [{ type: "text", text }] }, parent_tool_use_id: null } as SDKUserMessage;
}

/** Spawn one fixer. Returns immediately; progress lands in the registry + notify callback. */
export interface FixerOpts { model?: string; context?: string; difficulty?: string; task?: string; title?: string; redispatches?: number; group?: string; }

interface FixerControl { push: (text: string) => void; close: () => void; stop: () => void; }
const liveFixers = new Map<string, FixerControl>();

export function isSteerable(id: string): boolean { return liveFixers.has(id); }

/** Hard-stop a running fixer now (interrupt mid-work). Keeps whatever it already committed on the branch. */
export function stopFixer(id: string): string {
  const c = liveFixers.get(id);
  if (!c) return `${id} isn't running`;
  c.stop();
  return `stopped ${id}`;
}

/** Stop every live fixer and turn OFF all auto modes (so nothing respawns). Returns count stopped. */
/** Merge every 'done' fix in a group through the queue (sequential rebase→check→ff). */
export function mergeGroup(project: string, group: string, notify: (m: string) => Promise<void> = async () => undefined): string {
  const done = listFixers().filter((f) => f.game === project && f.group === group && f.status === "done");
  if (!done.length) return `no ready fixes in group "${group}"`;
  let merged = 0; const regen: string[] = []; const stuck: string[] = [];
  for (const f of done) {
    closeFixer(f.id);
    const r = integrate(f); // rebases onto CURRENT main (incl. fixes merged earlier in this same loop)
    if (r.ok) { merged++; continue; }
    // conflict → regenerate the task on latest main (AI-native resolution), exactly like the auto merge-queue
    if (r.reason === "conflict" && (f.redispatches ?? 0) < 2) {
      const nf = redispatchFixer(f, notify);
      regen.push(`${f.title ?? f.id}→${nf.id}`);
    } else {
      stuck.push(`${f.title ?? f.id} (${r.reason})`);
    }
  }
  let msg = `merged ${merged}/${done.length} in "${group}"`;
  if (regen.length) msg += ` · 🔁 conflict → regenerating on latest main: ${regen.join(", ")}`;
  if (stuck.length) msg += ` · ⚠️ needs attention: ${stuck.join(", ")}`;
  if (!regen.length && !stuck.length) msg += " ✅";
  return msg;
}

/** Stop every running fix in a group. */
export function stopGroup(project: string, group: string): number {
  const running = listFixers().filter((f) => f.game === project && f.group === group && liveFixers.has(f.id));
  for (const f of running) liveFixers.get(f.id)?.stop();
  return running.length;
}

export function stopAllFixers(): number {
  const ids = [...liveFixers.keys()];
  for (const id of ids) liveFixers.get(id)?.stop();
  const cfg = autoConfig();
  for (const p of Object.keys(cfg)) if (cfg[p].on) setAuto(p, { on: false });
  return ids.length;
}

/** Inject guidance into a running/awaiting-review fixer session (the main chat steering it). */
export function steerFixer(id: string, text: string): string {
  const c = liveFixers.get(id);
  if (!c) return `${id} isn't steerable right now (session closed)`;
  c.push(text);
  return `steered ${id}`;
}

/** Close a fixer's live session (called on merge or explicit finalize). */
export function closeFixer(id: string): void {
  const c = liveFixers.get(id);
  if (c) c.close();
}

/** A short human label for a fixer card when Nibbi didn't give one. */
function deriveTitle(issue: string): string {
  const words = issue.replace(/^\s*[-*]\s*\[[ x]\]\s*/, "").replace(/[`*_#]/g, "")
    .replace(/\b(add|implement|resolve|fix|build|create|make|update|the|a|an|to|for|on|of|in)\b/gi, " ")
    .replace(/[^a-zA-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean).slice(0, 4);
  const t = words.join(" ").trim();
  return (t ? t.charAt(0).toUpperCase() + t.slice(1) : issue.slice(0, 32)).slice(0, 42);
}
function newFix(game: string, issue: string, opts: FixerOpts, status: Fixer["status"]): Fixer {
  const id = `fx${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 9)}`;
  const slug = issue.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  return { id, game, issue, branch: `oracle/${id}-${slug}`, worktree: join(WORK, `${id}-${slug}`),
    status, startedAt: new Date().toISOString(), model: opts.model || FIXER_MODEL, task: opts.task, project: game,
    title: (opts.title || deriveTitle(opts.task || issue)), context: opts.context, difficulty: opts.difficulty,
    redispatches: opts.redispatches ?? 0, group: opts.group };
}
const optsOf = (f: Fixer): FixerOpts => ({ model: f.model, context: f.context, difficulty: f.difficulty, task: f.task, title: f.title, group: f.group, redispatches: f.redispatches });

/** Add a fix to the queue WITHOUT running it — drains automatically when capacity + window allow. */
export function queueFix(game: string, issue: string, opts: FixerOpts = {}): Fixer {
  if (!games()[game]) throw new Error(`unknown project '${game}'`);
  const f = newFix(game, issue, opts, "queued");
  upsert(f);
  return f;
}
/** Remove a queued fix (only if still queued). */
export function unqueueFix(id: string): string {
  const f = listFixers().find((x) => x.id === id);
  if (!f) return `no fix ${id}`;
  if (f.status !== "queued") return `${id} is ${f.status} — only queued fixes can be unqueued`;
  removeFixer(id);
  return `unqueued ${f.title ?? id}`;
}
/** Move a finished/failed fix back into the queue to re-run when possible. */
export function requeueFix(id: string): string {
  const f = listFixers().find((x) => x.id === id);
  if (!f) return `no fix ${id}`;
  queueFix(f.game, f.issue, optsOf(f));
  f.status = "superseded"; f.summary = "re-queued"; f.endedAt = new Date().toISOString(); upsert(f); // hide the old failed one; the queued copy takes over
  return `re-queued ${f.title ?? id}`;
}
/** True if a fixer run died because the Claude usage window was exhausted (not a code fault). */
function isUsageError(e: unknown): boolean {
  const s = String(e).toLowerCase();
  return s.includes("session limit") || s.includes("usage limit") || s.includes("rate limit") || s.includes("hit your");
}
/** A fixer run threw. Usage-limit deaths re-queue (retry after reset — no work lost); real faults fail. */
async function onFixerRunError(f: Fixer, e: unknown, notify: (m: string) => Promise<void>): Promise<void> {
  liveFixers.delete(f.id);
  if (isUsageError(e)) {
    const cfg = games()[f.game];
    try { if (cfg) sh(cfg.repo, "git", ["worktree", "remove", "--force", f.worktree]); } catch { /* noop */ }
    try { if (cfg) sh(cfg.repo, "git", ["branch", "-D", f.branch]); } catch { /* noop */ }
    requeueFix(f.id); // supersede this attempt + queue a fresh one; the drainer starts it once usage returns
    await notify(`\u23f3 ${f.id} hit the usage limit — re-queued to resume after reset (no work lost)`);
  } else {
    f.status = "failed"; f.summary = String(e).slice(0, 300); f.endedAt = new Date().toISOString(); upsert(f);
    await notify(`\ud83d\udd27 ${f.id} FAILED to start: ${f.summary}`);
  }
}
/** Start a queued fix now (used by the drainer). */
function activateFix(f: Fixer, notify: (m: string) => Promise<void>): void {
  const cfg = games()[f.game];
  if (!cfg) return;
  f.status = "installing"; f.startedAt = new Date().toISOString(); upsert(f);
  void runFixer(f, cfg, notify, optsOf(f)).catch((e) => onFixerRunError(f, e, notify));
}
/** Drain queued fixes into running ones, respecting capacity + rate limits. Returns count started. */
export function drainQueues(notify: (m: string) => Promise<void>, rateLimited: boolean): number {
  if (rateLimited) return 0;
  const queued = listFixers().filter((f) => f.status === "queued");
  if (!queued.length) return 0;
  const auto = autoConfig();
  let started = 0;
  const byProject: Record<string, Fixer[]> = {};
  for (const f of queued) (byProject[f.game] = byProject[f.game] || []).push(f);
  for (const [project, qs] of Object.entries(byProject)) {
    const cap = auto[project]?.maxConcurrent ?? 2;
    let room = cap - inflightFor(project).length;
    for (const f of qs) { if (room <= 0) break; activateFix(f, notify); room--; started++; }
  }
  return started;
}

export function spawnFixer(game: string, issue: string, notify: (msg: string) => Promise<void>, opts: FixerOpts = {}): Fixer {
  const cfg = games()[game];
  if (!cfg) throw new Error(`unknown game '${game}' — add it to ~/.nibbi/games.json`);
  const f = newFix(game, issue, opts, "installing");
  upsert(f);
  void runFixer(f, cfg, notify, opts).catch((e) => onFixerRunError(f, e, notify));
  return f;
}

async function runFixer(f: Fixer, cfg: GameCfg, notify: (m: string) => Promise<void>, opts: FixerOpts = {}): Promise<void> {
  mkdirSync(WORK, { recursive: true });
  const log = join(ORACLE_HOME, "logs", `fixer-${f.id}.log`);
  const logln = (s: string): void => appendFileSync(log, `[${new Date().toISOString()}] ${s}\n`);

  logln(`worktree add ${f.worktree} (${f.branch})`);
  sh(cfg.repo, "git", ["worktree", "add", "-b", f.branch, f.worktree]);
  logln(`install: ${cfg.install}`);
  sh(f.worktree, "bash", ["-lc", cfg.install]); // ISOLATED install — never share node_modules across worktrees
  f.status = "running"; upsert(f);
  await notify(`🔧 ${f.id} on it — branch ${f.branch}${opts.model ? " · " + opts.model : ""}`);

  const brief = opts.context?.trim()
    ? `\nCONTEXT FROM ORACLE (the lead who dispatched you — trust this):\n${opts.context.trim()}\n`
    : "";
  const prompt = `You are a fixer agent on the "${f.game}" repo (a git worktree — your own branch ${f.branch}).
ISSUE TO FIX:
${f.issue}
${brief}
Rules:
- Read CLAUDE.md first for repo conventions; respect them exactly.
- Smallest correct fix. No drive-by refactors.
- Verify: run \`${cfg.check}\` — it must pass. If UI is involved and a probe script exists, use it.
- When done: git add + commit on this branch with a clear message. Do NOT push or merge.
- Final reply: exactly 3 lines — WHAT changed, WHY safe, VERIFY result.
- You may receive follow-up guidance mid-task from Nibbi/Matty prefixed [STEER] — treat it as priority direction, adjust, and re-commit.`;

  // steerable streaming input: initial task, then any injected guidance, until finalized
  const queue: string[] = [];
  let wake: (() => void) | null = null;
  let closing = false;
  const userMsg = (t: string): SDKUserMessage =>
    ({ type: "user", message: { role: "user", content: [{ type: "text", text: t }] }, parent_tool_use_id: null } as unknown as SDKUserMessage);
  async function* input(): AsyncIterable<SDKUserMessage> {
    yield userMsg(prompt);
    for (;;) {
      while (queue.length) yield userMsg(queue.shift() as string);
      if (closing) return;
      await new Promise<void>((r) => { wake = r; });
    }
  }
  let finalizeTimer: ReturnType<typeof setTimeout> | null = null;
  const STEER_WINDOW = 4 * 60_000;
  const scheduleFinalize = (): void => {
    if (finalizeTimer) clearTimeout(finalizeTimer);
    finalizeTimer = setTimeout(() => { closing = true; wake?.(); wake = null; }, STEER_WINDOW);
  };
  liveFixers.set(f.id, {
    push: (t) => { logln(`STEER: ${t.slice(0, 200)}`); queue.push(`[STEER] ${t}`); scheduleFinalize(); wake?.(); wake = null; },
    close: () => { closing = true; if (finalizeTimer) clearTimeout(finalizeTimer); wake?.(); wake = null; },
    stop: () => { logln("STOPPED by Matty"); closing = true; if (finalizeTimer) clearTimeout(finalizeTimer); wake?.(); wake = null; void (q as unknown as { interrupt?: () => Promise<void> }).interrupt?.(); },
  });

  let text = "", cost = 0, rounds = 0;
  const q = query({
    prompt: input(),
    options: {
      cwd: f.worktree,
      systemPrompt: "You are a precise, senior game-engine fixer. Terse. Evidence over vibes.",
      canUseTool: fixerPolicy(f.worktree),
      maxTurns: 80,
      model: opts.model || FIXER_MODEL,
      title: `fixer-${f.id}`,
    },
  });
  // stall watchdog: no SDK messages for 7 min of ACTIVE work → interrupt (idle-for-steer is handled by the finalize timer)
  let lastMsg = Date.now();
  const watchdog = setInterval(() => {
    if (!closing && Date.now() - lastMsg > 7 * 60_000) {
      logln("WATCHDOG: no activity 7 min — interrupting");
      closing = true; if (finalizeTimer) clearTimeout(finalizeTimer); wake?.(); wake = null;
      void (q as unknown as { interrupt?: () => Promise<void> }).interrupt?.();
    }
  }, 30_000);

  const applyPass = (): void => {
    let diffstat = "";
    try { diffstat = sh(f.worktree, "git", ["diff", "--stat", `${mergeTarget(cfg.repo)}...HEAD`]).trim().split("\n").slice(-3).join("\n"); }
    catch { diffstat = "(no commit found)"; }
    f.status = diffstat === "(no commit found)" ? "failed" : "done";
    f.costUsd = cost; f.diffstat = diffstat;
    f.summary = text.trim().split("\n").slice(-3).join("\n").slice(0, 500);
    upsert(f);
  };

  for await (const msg of q as AsyncIterable<SDKMessage>) {
    lastMsg = Date.now();
    if (msg.type === "assistant") {
      const blocks = (msg as unknown as { message: { content: Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown> }> } }).message.content;
      for (const b of blocks) {
        if (b.type === "text" && b.text) { text += b.text; logln(`ASSISTANT: ${b.text.slice(0, 400)}`); }
        else if (b.type === "tool_use" && b.name) {
          const hint = String(b.input?.["command"] ?? b.input?.["file_path"] ?? b.input?.["pattern"] ?? "").slice(0, 90);
          logln(`TOOL: ${b.name}${hint ? " · " + hint : ""}`);
        }
      }
    } else if (msg.type === "result") {
      const r = msg as unknown as { total_cost_usd?: number; is_error: boolean };
      cost = r.total_cost_usd ?? cost;
      rounds += 1;
      applyPass(); // fixer finished a pass → mergeable now, but stays open for steering
      logln(`PASS ${rounds} complete — ${f.status} (steerable ${Math.round(STEER_WINDOW / 60000)}m)`);
      if (rounds === 1) await notify(`🔧 ${f.id} first pass ${f.status.toUpperCase()} (~$${cost.toFixed(2)}) — watch/steer in the app, or merge with /approve ${f.id}`);
      scheduleFinalize(); // idle window before we close the session
    }
  }
  // session closed (finalized) — clean up
  clearInterval(watchdog);
  if (finalizeTimer) clearTimeout(finalizeTimer);
  liveFixers.delete(f.id);
  // if this fix was already integrated/regenerated while its session was alive,
  // DON'T clobber that status (its branch is gone → applyPass would wrongly mark it "failed")
  const current = listFixers().find((x) => x.id === f.id);
  if (current && (current.status === "merged" || current.status === "superseded")) return;
  f.endedAt = new Date().toISOString();
  applyPass();
  upsert(f);
  try {
    const tn = join(homedir(), ".nibbi", "apps", "terminal-notifier.app", "Contents", "MacOS", "terminal-notifier");
    const msg = `${f.id} ${f.status} · ${f.game} · ~$${cost.toFixed(2)}`;
    if (existsSync(tn)) {
      execFileSync(tn, ["-title", "Nibbi · fixer", "-message", msg, "-sound", "Glass",
        "-activate", "com.nibbi.desktop", "-group", `oracle-fixer-${f.id}`], { timeout: 5000 });
    } else {
      execFileSync("osascript", ["-e",
        `display notification ${JSON.stringify(msg)} with title "Nibbi · fixer" sound name "Glass"`], { timeout: 5000 });
    }
  } catch { /* headless session */ }
  await notify(`🔧 ${f.id} finalized ${f.status.toUpperCase()} (~$${cost.toFixed(2)}) after ${rounds} pass(es)\n${f.summary}\n---\n${f.diffstat ?? ""}\nmerge with: /approve ${f.id}`);
}

export function reconcileFixers(): void {
  for (const f of listFixers()) {
    if (f.status === "running" || f.status === "installing") {
      f.status = "failed";
      f.summary = "(daemon restarted mid-run — re-dispatch with /fix)";
      f.endedAt = new Date().toISOString();
      upsert(f);
    }
  }
}

/** Merge an approved fixer branch into the game repo's current branch, then clean up the worktree. */
/** When a fixer merges, tick its roadmap task in the vault's plans/<project>.md. */
function markRoadmapDone(f: Fixer): void {
  try {
    const plan = join(homedir(), "NibbiVault", "plans", `${f.game}.md`);
    if (!existsSync(plan)) return;
    const norm = (x: string): string => x.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
    const target = norm(f.task || f.issue).slice(0, 60);
    if (!target) return;
    const lines = readFileSync(plan, "utf8").split("\n");
    let hit = false;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(\s*[-*]\s*)\[ \](\s+)(.*)$/);
      if (!m) continue;
      const body = norm(m[3]);
      if (body && (body.includes(target) || target.includes(body.slice(0, 40)))) {
        lines[i] = `${m[1]}[x]${m[2]}${m[3]}`;
        hit = true; break;
      }
    }
    if (hit) {
      writeFileSync(plan, lines.join("\n"));
      try { sh(join(homedir(), "NibbiVault"), "git", ["add", "plans"]); sh(join(homedir(), "NibbiVault"), "git", ["-c", "user.name=Nibbi", "-c", "user.email=oracle@local", "commit", "-m", `roadmap: ${f.game} task done (fixer ${f.id})`]); } catch { /* noop */ }
    }
  } catch { /* roadmap update is best-effort */ }
}

export type IntegrateResult = { ok: boolean; reason?: "conflict" | "checkfail" | "gone"; detail?: string };

/** Merge-queue integration: rebase the branch onto the latest mainline, run the
    verify gate, then fast-forward merge. Conflict-safe — never leaves the repo dirty. */
/** Regenerate a conflicting task on the CURRENT main (AI-native conflict resolution):
    discard the stale branch and re-dispatch the same task — it'll be written against reality. */
export function redispatchFixer(f: Fixer, notify: (m: string) => Promise<void>): Fixer {
  const cfg = games()[f.game];
  try { if (cfg) sh(cfg.repo, "git", ["worktree", "remove", "--force", f.worktree]); } catch { /* gone */ }
  try { if (cfg) sh(cfg.repo, "git", ["branch", "-D", f.branch]); } catch { /* gone */ }
  f.status = "superseded"; f.summary = "regenerated on latest main"; f.endedAt = new Date().toISOString(); upsert(f);
  return spawnFixer(f.game, f.issue, notify, {
    model: f.model, context: f.context, difficulty: f.difficulty, task: f.task, title: f.title, group: f.group,
    redispatches: (f.redispatches ?? 0) + 1,
  });
}

export function integrate(f: Fixer): IntegrateResult {
  const cfg = games()[f.game];
  if (!cfg) return { ok: false, reason: "gone", detail: "unknown project" };
  const target = mergeTarget(cfg.repo);
  const hasWt = existsSync(f.worktree);
  // 1) rebase the branch onto the latest mainline (integrate against reality)
  if (hasWt) {
    try {
      sh(f.worktree, "git", ["rebase", target]);
    } catch (e) {
      try { sh(f.worktree, "git", ["rebase", "--abort"]); } catch { /* nothing to abort */ }
      return { ok: false, reason: "conflict", detail: (e as Error).message.slice(0, 80) };
    }
    // 2) verify gate against the rebased result — keep main green
    if (cfg.check && cfg.check !== "true") {
      try { sh(f.worktree, "bash", ["-lc", cfg.check]); }
      catch (e) { return { ok: false, reason: "checkfail", detail: (e as Error).message.slice(0, 120) }; }
    }
  }
  // 3) fast-forward merge — the rebase already integrated, so this cannot conflict
  try {
    sh(cfg.repo, "git", ["merge", "--ff-only", f.branch]);
  } catch {
    // branch not a descendant (e.g. worktree gone / no rebase) — fall back to a safe no-ff merge
    try { sh(cfg.repo, "git", ["merge", "--no-ff", f.branch, "-m", `oracle fix ${f.id}: ${(f.title ?? f.issue).slice(0, 60)}`]); }
    catch (e) {
      try { sh(cfg.repo, "git", ["merge", "--abort"]); } catch { /* noop */ }
      return { ok: false, reason: "conflict", detail: (e as Error).message.slice(0, 80) };
    }
  }
  try { sh(cfg.repo, "git", ["worktree", "remove", "--force", f.worktree]); } catch { /* already gone */ }
  try { sh(cfg.repo, "git", ["branch", "-D", f.branch]); } catch { /* already gone */ }
  f.status = "merged"; f.endedAt = new Date().toISOString(); upsert(f);
  markRoadmapDone(f);
  return { ok: true };
}

export function approveFixer(id: string): string {
  const f = listFixers().find((x) => x.id === id);
  if (!f) return `no fixer ${id}`;
  closeFixer(id); // stop steering — we're merging
  if (f.status !== "done") return `${id} is ${f.status} — only 'done' fixers can merge`;
  const r = integrate(f);
  if (r.ok) return `merged ${f.title ?? f.branch} into mainline ✅ (rebased, checked, fast-forwarded; worktree cleaned)`;
  if (r.reason === "checkfail") return `⚠️ ${f.title ?? f.id} rebased onto main but its checks failed — not merged, repo safe. Steer it to fix, or re-dispatch. (${r.detail})`;
  return `⚠️ ${f.title ?? f.id} conflicts with the latest main — not merged, repo untouched. Re-dispatch this task so it's rebuilt on current main. (${r.detail ?? ""})`;
}

// ── previews: on-demand vite dev servers for fixer worktrees ──────────────
interface Preview { id: string; pid: number; port: number; startedAt: string; }
const PREV = join(ORACLE_HOME, "previews.json");
function listPreviews(): Preview[] {
  return existsSync(PREV) ? (JSON.parse(readFileSync(PREV, "utf8")) as Preview[]) : [];
}
function savePreviews(p: Preview[]): void { writeJsonAtomic(PREV, JSON.stringify(p, null, 2)); }

export function previewStart(id: string): string {
  const f = listFixers().find((x) => x.id === id);
  if (!f) return `no fixer ${id}`;
  if (!existsSync(f.worktree)) return `${id}: worktree gone (already merged/cleaned)`;
  const existing = listPreviews().find((p) => p.id === id);
  if (existing) return `already up: http://localhost:${existing.port}/ (stop with /preview ${id} stop)`;
  const port = 5180 + (listPreviews().length % 40);
  const child = spawn("npx", ["vite", "--port", String(port), "--strictPort"], {
    cwd: f.worktree, stdio: "ignore", detached: true,
  });
  child.unref();
  const p: Preview = { id, pid: child.pid ?? 0, port, startedAt: new Date().toISOString() };
  savePreviews([...listPreviews(), p]);
  setTimeout(() => { try { previewStop(id); } catch { /* gone */ } }, 30 * 60_000).unref?.();
  return `preview up: http://localhost:${port}/play.html (worktree ${f.branch}; auto-stops in 30m)`;
}

export function previewStop(id: string): string {
  const p = listPreviews().find((x) => x.id === id);
  if (!p) return `no preview for ${id}`;
  try { process.kill(-p.pid, "SIGTERM"); } catch { try { process.kill(p.pid, "SIGTERM"); } catch { /* dead */ } }
  savePreviews(listPreviews().filter((x) => x.id !== id));
  return `preview ${id} stopped`;
}


// ── play: run a project's browser interface (a dev server on the project repo) ────
interface PlayServer { project: string; pid: number; port: number; log: string; }
const PLAY_F = join(ORACLE_HOME, "play.json");
function listPlay(): PlayServer[] { try { return JSON.parse(readFileSync(PLAY_F, "utf8")) as PlayServer[]; } catch { return []; } }
function savePlay(p: PlayServer[]): void { try { writeJsonAtomic(PLAY_F, JSON.stringify(p, null, 2)); } catch { /* noop */ } }
function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }
/** does this command start a BROWSER dev server (vs a terminal/CLI program like `node cli.js`)? */
function isWebDev(cmd: string): boolean {
  return /\b(vite|next\s+dev|react-scripts\s+start|parcel|astro\s+dev|webpack-dev-server|webpack\s+serve|vue-cli-service\s+serve|ng\s+serve|http-server|remix\s+dev|nuxt(\s+dev)?|svelte-kit|vitepress|docusaurus\s+start)\b/i.test(cmd) || /\bserve\b/i.test(cmd) && !/\bserve:api\b/i.test(cmd);
}
/** parse the actual served URL a dev server prints to its log */
function parseUrl(log: string): string | undefined {
  const local = log.match(/Local:\s*(https?:\/\/[^\s]+)/i); // vite/astro/etc. canonical frontend URL — prefer it over an api-server line
  if (local) return local[1].replace("0.0.0.0", "localhost");
  const m = log.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?\/?[^\s)]*/i);
  return m ? m[0].replace("0.0.0.0", "localhost") : undefined;
}
/** reap the WHOLE dev-server tree for a repo (concurrently/tsx-watch/vite children detach + re-parent, surviving a group kill) — spares transient probes */
function killRepoDev(repo: string): void {
  let out = "";
  try { out = execFileSync("pgrep", ["-f", repo], { encoding: "utf8" }); } catch { return; }
  for (const line of out.split("\n")) {
    const pid = parseInt(line.trim(), 10);
    if (!pid || pid === process.pid) continue;
    let cmd = ""; try { cmd = execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" }); } catch { continue; }
    if (/playwright|screencapture|chrome-mac/i.test(cmd)) continue; // spare screenshot/probe processes
    try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
  }
}
/** how to start a project's web UI. kind: url|server|cli|none. cmd set only for kind=server. */
function playCmd(project: string): { cmd?: string; kind: string } {
  const cfg = games()[project]; if (!cfg) return { kind: "none" };
  const pl = (cfg as { play?: string }).play;
  if (pl && /^https?:/i.test(pl)) return { kind: "url" };
  if (pl && isWebDev(pl)) return { cmd: pl, kind: "server" };
  let scripts: Record<string, string> = {}; let deps: Record<string, string> = {};
  try { const pkg = JSON.parse(readFileSync(join(cfg.repo, "package.json"), "utf8")) as { scripts?: Record<string,string>; dependencies?: Record<string,string>; devDependencies?: Record<string,string> }; scripts = pkg.scripts ?? {}; deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }; } catch { /* no pkg */ }
  if (scripts.dev && isWebDev(scripts.dev)) return { cmd: "npm run dev", kind: "server" };
  if (scripts.start && isWebDev(scripts.start)) return { cmd: "npm start", kind: "server" };
  if (existsSync(join(cfg.repo, "index.html")) && (deps.vite || existsSync(join(cfg.repo, "vite.config.ts")) || existsSync(join(cfg.repo, "vite.config.js")))) return { cmd: "npx vite", kind: "server" };
  if ((pl && !isWebDev(pl)) || (scripts.play && !isWebDev(scripts.play))) return { kind: "cli" };
  return { kind: "none" };
}
/** Is the project a web app we can serve to play? Returns the live URL once its dev server prints one. */
export function playStatus(project: string): { running: boolean; url?: string; playable: boolean; kind: string; starting?: boolean } {
  const cfg = games()[project];
  if (!cfg) return { running: false, playable: false, kind: "none" };
  const pl = (cfg as { play?: string }).play;
  if (pl && /^https?:/i.test(pl)) return { running: true, url: pl, playable: true, kind: "url" };
  const run = listPlay().find((p) => p.project === project);
  if (run && alive(run.pid)) {
    let url: string | undefined; try { url = parseUrl(readFileSync(run.log, "utf8")); } catch { /* no log yet */ }
    return url ? { running: true, url, playable: true, kind: "server" } : { running: true, playable: true, kind: "server", starting: true };
  }
  const { kind } = playCmd(project);
  return { running: false, playable: kind === "server", kind };
}
export function playStart(project: string): { url?: string; starting?: boolean; error?: string } {
  const cfg = games()[project];
  if (!cfg) return { error: "unknown project" };
  const pl = (cfg as { play?: string }).play;
  if (pl && /^https?:/i.test(pl)) return { url: pl };
  const cur = listPlay().find((p) => p.project === project && alive(p.pid));
  if (cur) { let url: string | undefined; try { url = parseUrl(readFileSync(cur.log, "utf8")); } catch { /* noop */ } return url ? { url } : { starting: true }; }
  const { cmd, kind } = playCmd(project);
  if (!cmd) return { error: kind === "cli" ? "terminal game — no browser UI" : "no web dev server" };
  const port = 5190 + Math.floor(Math.random() * 40);
  const log = join(ORACLE_HOME, `play-${project}.log`);
  try { writeFileSync(log, ""); } catch { /* noop */ }
  killRepoDev(cfg.repo); // clear any orphaned dev tree from a prior run so servers never accumulate
  const needInstall = existsSync(join(cfg.repo, "package.json")) && !existsSync(join(cfg.repo, "node_modules")); // fixers install in their worktree; a freshly-merged web UI has no node_modules on main
  const base = cmd === "npx vite" ? `npx vite --port ${port} --strictPort` : cmd;
  const full = needInstall ? `npm install && ${base}` : base; // pin the port only when we invoke vite directly; scripts pick their own and we parse it
  try {
    const child = spawn("bash", ["-lc", `${full} > ${JSON.stringify(log)} 2>&1`], { cwd: cfg.repo, detached: true, stdio: "ignore" });
    child.unref();
    const servers = listPlay().filter((p) => p.project !== project); servers.push({ project, pid: child.pid ?? 0, port, log }); savePlay(servers);
    setTimeout(() => { try { playStop(project); } catch { /* gone */ } }, 60 * 60_000).unref?.();
    return { starting: true };
  } catch (e) { return { error: (e as Error).message.slice(0, 120) }; }
}
export function playStop(project: string): string {
  const servers = listPlay(); const p = servers.find((s) => s.project === project);
  if (p) { try { process.kill(-p.pid, "SIGKILL"); } catch { /* noop */ } try { process.kill(p.pid, "SIGKILL"); } catch { /* noop */ } }
  const cfg = games()[project];
  if (cfg?.repo) killRepoDev(cfg.repo); // reap detached concurrently/tsx-watch/vite children that escape the group kill
  savePlay(servers.filter((s) => s.project !== project)); return "stopped";
}

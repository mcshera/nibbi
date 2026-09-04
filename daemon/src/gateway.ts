#!/usr/bin/env node
// gateway.ts — Oracle's front door: send | repl | daemon | status
import { createInterface } from "node:readline";
import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { Cron } from "croner";
import { runTurn } from "./session.js";
import { loadState, ORACLE_HOME } from "./state.js";
import { notifyOwner } from "./notify.js";
import { reconcileFixers, autoConfig, setAuto, noteAuto, inflightFor, stagedFor, pendingTasks, integrate, redispatchFixer, closeFixer, drainQueues, autoSpend, buildReport } from "./fixer.js";
import { resetSession, setDispatchNotify, isRateLimited } from "./session.js";
import { startWebApp, setNotifyHook } from "./webapp.js";
import { handleCommand } from "./commands.js";

const WEEKLY_PROMPT = `Weekly self-review (refinement ritual, AGENTS.md §5-6). Review the week: journal/, refinements.jsonl, ~/.nibbi/fixers.json, issues movement, your own mistakes/corrections in recent conversation.
1) Write briefs/week-<today>.md: what shipped, what repeated, what you learned.
2) Append refinement entries to refinements.jsonl for every durable lesson (schema in AGENTS.md).
3) Apply small unprotected improvements now (MEMORY deltas, HEARTBEAT watch list, new skills/<name>/SKILL.md for procedures you repeated ≥2x).
4) If SOUL.md or AGENTS.md should change, write a proposal file (proposals/, format in AGENTS.md §6) — do NOT ask in chat.
Reply ≤6 lines: shipped / learned / refined / proposals filed.`;

const HEARTBEAT_PROMPT = `Heartbeat pulse. Read HEARTBEAT.md and follow it exactly. Also check ~/.nibbi/fixers.json for fixers stuck >30min in installing/running. If truly nothing needs Matty's attention reply exactly HEARTBEAT_OK. Otherwise reply ≤4 lines with what matters. Do not write to the vault on quiet pulses.`;

const [, , cmd, ...rest] = process.argv;

async function send(message: string): Promise<void> {
  const c = await handleCommand(message, async (m) => console.log(`\n${m}`));
  if (c.handled) { console.log(c.reply ?? "ok"); return; }
  const r = await runTurn(message, (t) => process.stdout.write(t), "cli");
  process.stdout.write("\n");
  console.error(`[oracle] $${r.costUsd.toFixed(4)} · session ${r.sessionId?.slice(0, 8)}${r.isError ? " · ERROR" : ""}`);
}

async function repl(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log("oracle repl — /quit to exit");
  const ask = (): void => rl.question("\nyou> ", (line) => {
    const msg = line.trim();
    if (msg === "/quit" || msg === "/exit") { rl.close(); return; }
    if (!msg) { ask(); return; }
    process.stdout.write("oracle> ");
    void send(msg).then(ask).catch((e) => { console.error(String(e)); ask(); });
  });
  ask();
}

const BRIEF_PROMPT = `Cron: morning brief. Read recent journal entries, games/*/issues.md, HEARTBEAT.md watching-list, and inbox/.
Compose Matty's morning brief: ≤10 lines — today's focus, open issues by game, anything you're watching, one suggestion. No preamble.`;

const CONSOLIDATE_PROMPT = `Cron: nightly consolidation per AGENTS.md §4. Process inbox/ and the last 2 journal days:
file durable facts into the right vault pages (delta edits), update index.md + log.md, empty processed inbox items.
Reply with ≤3 lines: what was filed, anything needing Matty's attention.`;

/** The always-on process: Telegram long-poll + crons + liveness tick. */
async function daemon(): Promise<void> {
  mkdirSync(join(ORACLE_HOME, "logs"), { recursive: true });
  const logFile = join(ORACLE_HOME, "logs", "daemon.log");
  const log = (m: string): void => appendFileSync(logFile, `[${new Date().toISOString()}] ${m}\n`);

  const bot = null; // Telegram removed 2026-09-04 — notifications go to ~/.nibbi/notes.jsonl (Nibbi shows them)
  setNotifyHook(async (m) => notifyOwner(bot, m));
  setDispatchNotify(async (m) => notifyOwner(bot, m));
  reconcileFixers(); // entries left 'running' by a dead daemon → failed (restartable)
  startWebApp();

  // keep the voice stack hot: STT + TTS micro-ops every 4 min so first-hit latency never decays
  const warmWav = join(ORACLE_HOME, "warm.wav");
  if (!existsSync(warmWav)) {
    try {
      execFileSync(join(homedir(), ".nibbi", "bin", "ffmpeg"),
        ["-y", "-f", "lavfi", "-i", "sine=frequency=300:duration=0.6", "-ac", "1", "-ar", "16000", warmWav], { timeout: 15_000 });
    } catch { /* warm pings will just skip stt */ }
  }
  const warmVoice = async (): Promise<void> => {
    try {
      if (existsSync(warmWav)) {
        await fetch("http://127.0.0.1:4522/stt?fast=1", { method: "POST", body: new Uint8Array(readFileSync(warmWav)) });
      }
      await fetch(`http://127.0.0.1:4521/synth?nocache=1&text=${encodeURIComponent("warm " + Math.floor(Date.now() / 240_000))}`);
    } catch { /* servers restarting — next pulse catches them */ }
  };
  setTimeout(() => void warmVoice(), 20_000);
  setInterval(() => void warmVoice(), 4 * 60_000);

  // ── AUTO MODE: follow each project's roadmap, keep a capped set of fixers flowing ──
  let autoBusy = false; // don't overlap dispatch turns
  const autoSig: Record<string, string> = {}; // last dispatch-decision signature per project
  const autoCycle = async (): Promise<void> => {
    if (autoBusy) return;
    const cfg = autoConfig();
    const projects = Object.entries(cfg).filter(([, c]) => c.on);
    if (!projects.length) return;
    // don't contend with an active user turn
    try { if (Date.now() - statSync(join(ORACLE_HOME, "turn.lock")).mtimeMs < 3 * 60_000) return; } catch { /* no lock = idle */ }
    // rate-limit backoff
    const rl = loadState().rateLimit;
    if (isRateLimited()) { log("[auto] rate-limited — pausing"); return; } // reset-aware: resumes the instant the window refreshes
    const capFactor = rl?.status === "allowed_warning" ? 1 : 99; // near limit → 1 at a time

    for (const [project, c] of projects) {
      // auto-merge passed staged fixers (opt-in) to unblock dependents
      // MERGE QUEUE: integrate staged fixers ONE AT A TIME (rebase → check → ff-merge)
      if (c.autoMerge) {
        for (const f of stagedFor(project)) {
          if (!f.diffstat || f.diffstat === "(no commit found)") continue;
          closeFixer(f.id);
          const r = integrate(f); // rebase onto latest main, run checks, fast-forward — conflict-safe
          if (r.ok) { log(`[auto] integrated ${f.id}`); await notifyOwner(bot, `🤖 integrated ${f.title ?? f.id} → ${project} (rebased + checked)`); continue; }
          if ((r.reason === "conflict" || r.reason === "checkfail") && (f.redispatches ?? 0) < 2) {
            const nf = redispatchFixer(f, async (m) => notifyOwner(bot, m));
            noteAuto(project, `regenerating ${f.title ?? f.id} on latest main (${r.reason})`);
            log(`[auto] ${f.id} ${r.reason} → regenerating as ${nf.id}`);
            await notifyOwner(bot, `🔁 ${f.title ?? f.id} ${r.reason==="checkfail"?"failed its tests":"conflicted"} — regenerating on current main (${nf.id})`);
          } else {
            setAuto(project, { autoMerge: false });
            noteAuto(project, `auto-integrate paused — ${f.title ?? f.id} ${r.reason} after retries`);
            await notifyOwner(bot, `⚠️ ${project}: ${f.title ?? f.id} ${r.reason} — auto-integrate PAUSED (repo safe). Needs your eyes.`);
            log(`[auto] ${project} ${r.reason} on ${f.id} → paused`);
          }
          break; // sequential — one integration attempt per cycle, then re-evaluate next cycle
        }
      }
      const inflight = inflightFor(project);
      const pending = pendingTasks(project);
      const staged = stagedFor(project);
      // completion: nothing left to do
      if (!pending.length && !inflight.length && !staged.length) {
        setAuto(project, { on: false });
        await notifyOwner(bot, `✅ auto mode complete for ${project} — roadmap has no open tasks.`);
        log(`[auto] ${project} complete — auto off`);
        continue;
      }
      if (c.spendCap && autoSpend(project) >= c.spendCap) {
        setAuto(project, { on: false });
        noteAuto(project, `spend cap $${c.spendCap} reached — auto paused`);
        await notifyOwner(bot, `💰 ${project}: spend cap $${c.spendCap.toFixed(2)} reached — auto paused. Raise it + re-enable to continue.`);
        continue;
      }
      const capacity = Math.min(c.maxConcurrent, capFactor) - inflight.length;
      if (capacity <= 0) { noteAuto(project, `at capacity — ${inflight.length} running`); continue; }
      if (!pending.length) { noteAuto(project, staged.length ? `waiting — ${staged.length} staged for your review/merge` : "idle"); continue; }
      // change-detection: only spend an orchestration turn when the state actually changed
      const sig = `${inflight.map((f) => f.id).sort().join(",")}|${staged.length}|${pending.length}|${capacity}`;
      if (autoSig[project] === sig) continue; // nothing new since last decision — don't burn a turn
      autoSig[project] = sig;

      autoBusy = true;
      try {
        const inflightList = inflight.map((f) => "• " + (f.task || f.issue).slice(0, 60)).join("\n") || "(none)";
        const prompt = c.mode === "suggest"
          ? `AUTO SUGGEST — project "${project}". ${c.focus?`Focus milestone "${c.focus}". `:""}Read plans/${project}.md. List the next up to ${capacity} unchecked tasks you WOULD dispatch — each: crisp title · difficulty · one-line why. DO NOT call dispatch_fixer or any tool; propose only, terse.`
          : `AUTO MODE — project "${project}". Keep the build moving; use the parallelism.\n`
          + `In-flight (do NOT re-dispatch these):\n${inflightList}\n`
          + (c.focus ? `FOCUS: only dispatch tasks under milestone "${c.focus}" — ignore other milestones for now.\n` : "")
          + (c.model && c.model !== "auto" ? `MODEL: pass model:"${c.model}" to every dispatch_fixer call (override the difficulty default).\n` : "")
          + `Read plans/${project}.md. Dispatch UP TO ${capacity} unchecked tasks via dispatch_fixer — right difficulty→model, real context brief, a crisp title, the exact checkbox text as \`task\`, and a shared \`group\` label for this batch (the milestone they belong to, e.g. "M2: game loop"). PREFER launching MULTIPLE tasks in parallel: tasks in DIFFERENT milestones (or clearly separate files/concerns) are usually independent — e.g. card-effect parsing is independent of the game loop; a test suite is independent of a feature. Only serialize when task B literally builds on unmerged task A. Don't be overly cautious — if ${capacity} independent tasks exist, dispatch ${capacity}. If truly everything depends on unmerged review, dispatch nothing and say why. Be terse.`;
        const r = await runTurn(prompt, undefined, "auto", "sonnet", undefined, undefined, undefined, true); // cheap orchestration
        noteAuto(project, r.text.replace(/»[a-z]+:[^\n]*/gi, "").trim().slice(0, 150));
        log(`[auto] ${project} dispatch turn: ${r.text.slice(0, 100)}`);
      } catch (e) {
        log(`[auto] ${project} dispatch failed: ${(e as Error).message.slice(0, 80)}`);
      } finally {
        autoBusy = false;
      }
    }
  };
  setInterval(() => void autoCycle(), 90_000); // gentle cadence — the sig-guard skips no-op turns

  // QUEUE DRAINER: start queued fixes when capacity + rate-limit allow (independent of auto mode)
  setInterval(() => {
    const rejected = isRateLimited();
    const n = drainQueues(async (m) => notifyOwner(bot, m), rejected);
    if (n) log(`[queue] started ${n} queued fix(es)`);
  }, 45_000);
  // keep the Mac awake while on AC power; dies with the daemon; battery sleep untouched
  const caf = spawn("caffeinate", ["-s", "-w", String(process.pid)], { stdio: "ignore", detached: false });
  caf.on("error", () => log("caffeinate unavailable"));
  log("daemon up: webapp started (+caffeinate on AC)");

  new Cron("*/30 8-23 * * *", async () => {
    log("cron: heartbeat");
    try {
      const r = await runTurn(HEARTBEAT_PROMPT, undefined, "heartbeat", "haiku");
      if (!r.text.includes("HEARTBEAT_OK")) await notifyOwner(bot, `💓 ${r.text}`);
    } catch (e) { log(`heartbeat failed: ${(e as Error).message}`); }
  });

  new Cron("30 7 * * *", async () => {
    log("cron: morning brief");
    try { await notifyOwner(bot, (await runTurn(BRIEF_PROMPT)).text); }
    catch (e) { log(`brief failed: ${(e as Error).message}`); }
  });
  new Cron("0 8 * * *", async () => {
    log("cron: build report");
    try {
      const rep = buildReport(16);
      if (!rep) return;
      await notifyOwner(bot, `🌙 Overnight build\n${rep}`);
      const dir = join(homedir(), "NibbiVault", "reports"); mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, new Date().toISOString().slice(0, 10) + ".md"), `# Build report — ${new Date().toLocaleDateString()}\n\n${rep}\n`);
    } catch (e) { log(`build report failed: ${(e as Error).message.slice(0, 80)}`); }
  });

  new Cron("0 3 * * *", async () => {
    log("cron: consolidation");
    try {
      await notifyOwner(bot, `🌙 ${(await runTurn(CONSOLIDATE_PROMPT, undefined, "cron", "sonnet")).text}`, true);
      resetSession(); // nightly renewal: durable memory is in the vault; keep the working context lean
    }
    catch (e) { log(`consolidation failed: ${(e as Error).message}`); }
  });
  new Cron("30 3 * * *", async () => {
    log("cron: vault backup");
    try {
      const out = execFileSync(join(ORACLE_HOME, "bin", "vault-backup"), { encoding: "utf8", timeout: 120_000 });
      log(out.trim());
    } catch (e) { await notifyOwner(bot, `⚠️ vault backup FAILED: ${(e as Error).message.slice(0, 200)}`); }
  });
  new Cron("0 18 * * 0", async () => {
    log("cron: weekly self-review");
    try { await notifyOwner(bot, `📋 weekly review
${(await runTurn(WEEKLY_PROMPT, undefined, "cron")).text}`); }
    catch (e) { log(`weekly review failed: ${(e as Error).message}`); }
  });

  setInterval(() => log(`alive · turns=${loadState().turns}`), 30 * 60 * 1000);
  process.on("SIGTERM", () => { log("SIGTERM"); process.exit(0); });
  await new Promise(() => undefined); // run forever
}

function status(): void {
  const s = loadState();
  console.log(JSON.stringify({ ...s, home: ORACLE_HOME }, null, 2));
}

switch (cmd) {
  case "send": {
    const msg = rest.join(" ").trim();
    if (!msg) { console.error('usage: oracle send "message"'); process.exit(1); }
    void send(msg);
    break;
  }
  case "repl": void repl(); break;
  case "daemon": void daemon(); break;
  case "status": status(); break;
  default:
    console.log("usage: oracle <send|repl|daemon|status>");
}

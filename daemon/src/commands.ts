// commands.ts — channel-agnostic slash commands, parsed BEFORE the LLM. Fast, deterministic, free.
import { loadState, saveState } from "./state.js";
import { spawnFixer, listFixers, approveFixer, games, previewStart, previewStop } from "./fixer.js";
import { runTurn } from "./session.js";
import { runGolden, formatGolden } from "./golden.js";
import { listProposals, adoptProposal } from "./proposals.js";

export interface CmdResult { handled: boolean; reply?: string; }

/** notify = push channel for async fixer updates (notes.jsonl → Nibbi). */
export async function handleCommand(raw: string, notify: (m: string) => Promise<void>): Promise<CmdResult> {
  const text = raw.trim();
  if (!text.startsWith("/")) return { handled: false };
  const [cmd, ...rest] = text.slice(1).split(/\s+/);
  const arg = rest.join(" ").trim();

  switch (cmd) {
    case "playtest": {
      const game = arg || "shipless";
      if (!games()[game]) return { handled: true, reply: `unknown game '${game}' (see ~/.nibbi/games.json)` };
      const s = loadState(); s.playtestGame = game; saveState(s);
      const r = await runTurn(
        `PLAYTEST MODE STARTED for ${game}. Open games/${game}/playtests/${new Date().toLocaleDateString("en-CA")}-session.md (create if missing, append a session header). Reply in ONE line that you're ready.`,
        undefined, "playtest");
      return { handled: true, reply: `🎲 playtest mode ON (${game})\n${r.text}` };
    }
    case "endtest": {
      const s = loadState(); const game = s.playtestGame;
      if (!game) return { handled: true, reply: "no playtest running" };
      s.playtestGame = undefined; saveState(s);
      const r = await runTurn(
        `PLAYTEST MODE ENDED for ${game}. Write the session summary into today's playtest file (observations, issues filed with #ids, balance notes -> games/${game}/balance.md deltas if warranted), update issues.md/index/log. Reply ≤5 lines: summary + issue ids.`,
        undefined, "playtest");
      return { handled: true, reply: `🎲 playtest mode OFF\n${r.text}` };
    }
    case "fix": {
      if (!arg) return { handled: true, reply: "usage: /fix <issue text or #n from issues.md>" };
      const s = loadState(); const game = s.playtestGame ?? "shipless";
      const f = spawnFixer(game, arg, notify);
      return { handled: true, reply: `🔧 fixer ${f.id} spawned on '${arg.slice(0, 80)}' (branch ${f.branch}). I'll report when it's done.` };
    }
    case "fixers": {
      const all = listFixers().slice(-8);
      if (!all.length) return { handled: true, reply: "no fixers yet" };
      return { handled: true, reply: all.map((f) =>
        `${f.id} [${f.status}] ${f.game} — ${f.issue.slice(0, 60)}${f.costUsd ? ` (~$${f.costUsd.toFixed(2)})` : ""}`).join("\n") };
    }
    case "approve": {
      if (!arg) return { handled: true, reply: "usage: /approve <fixer-id>" };
      try { return { handled: true, reply: approveFixer(arg) }; }
      catch (e) { return { handled: true, reply: `merge failed: ${(e as Error).message.slice(0, 300)}` }; }
    }
    case "golden": {
      const g = await runGolden();
      return { handled: true, reply: formatGolden(g) };
    }
    case "proposals": {
      const p = listProposals();
      return { handled: true, reply: p.length ? "pending proposals:\n" + p.join("\n") + "\nadopt with /adopt <name>" : "no pending proposals" };
    }
    case "adopt": {
      if (!arg) return { handled: true, reply: "usage: /adopt <proposal-file-prefix>" };
      return { handled: true, reply: await adoptProposal(arg) };
    }
    case "preview": {
      const [id, action] = arg.split(/\s+/);
      if (!id) return { handled: true, reply: "usage: /preview <fixer-id> [stop]" };
      return { handled: true, reply: action === "stop" ? previewStop(id) : previewStart(id) };
    }
    case "clear": {
      const { resetSession } = await import("./session.js");
      resetSession();
      return { handled: true, reply: "🧠 fresh context — session cleared; vault memory carries forward. TTFT will be snappy again." };
    }
    case "export": {
      const { readChat } = await import("./history.js");
      const { writeFileSync, mkdirSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { VAULT } = await import("./vault.js");
      const h = readChat(1000);
      let out = "# Nibbi transcript — exported " + new Date().toLocaleString() + "\n";
      let day = "";
      for (const e of h) {
        const d = new Date(e.ts).toDateString();
        if (d !== day) { day = d; out += `\n## ${d}\n\n`; }
        const t = new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        out += `**${e.role === "user" ? "matty" : "oracle"}** · ${e.channel} · ${t}\n\n${e.text}\n\n---\n\n`;
      }
      const dir = join(VAULT, "exports");
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `transcript-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-")}.md`);
      writeFileSync(file, out);
      return { handled: true, reply: `📜 exported ${h.length} messages → ${file}` };
    }
    case "help":
      return { handled: true, reply: "/playtest [game] · /endtest · /fix <issue> · /fixers · /approve <id> · /preview <id> [stop] · /golden · /proposals · /adopt <name> · /export · /clear · /help" };
    default:
      return { handled: false }; // unknown slash → let Nibbi see it
  }
}

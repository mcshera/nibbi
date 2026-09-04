// webapp.ts — localhost HTTP API + web UI for the Oracle desktop app (and any browser).
// Bound to 127.0.0.1 ONLY. The Tauri app proxies these endpoints via Rust.
import { createServer } from "node:http";
import { Cron } from "croner";
import { readFileSync, existsSync, appendFileSync, mkdirSync, readdirSync, statSync, renameSync, watch } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runTurn, setMasterModel, isRateLimited } from "./session.js";
import { loadState } from "./state.js";
import { readChat, searchChat, readAround } from "./history.js";
import { VAULT } from "./vault.js";
import { handleCommand } from "./commands.js";
import { listFixers, spawnFixer, getFixerDiff, createProject, registerProject, mergeTarget, games, steerFixer, isSteerable, autoConfig, setAuto, inflightFor, stagedFor, pendingTasks, roadmapProgress, autoSpend, buildReport, playStart, playStop, playStatus, stopFixer, stopAllFixers, mergeGroup, stopGroup, queueFix, unqueueFix, requeueFix } from "./fixer.js";
import { getGame } from "./game.js";
import { synthOgg } from "./tts.js";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

/** async notifications from fixers spawned via the web app — land in notes.jsonl (shown by Nibbi) */
let notifyHook: (m: string) => Promise<void> = async () => undefined;
export function setNotifyHook(fn: (m: string) => Promise<void>): void { notifyHook = fn; }

export const WEB_PORT = Number(process.env.NIBBI_GATEWAY_PORT || 4519);
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const DAEMON_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");   // <repo>/app or <repo>/daemon
const SELF_REPO = resolve(DAEMON_DIR, "..");
// live-reload: watch public assets and push an SSE event so the app refreshes itself (no HMR, no rebuild)
const LR_CLIENTS = new Set<import("node:http").ServerResponse>();
let lrTimer: ReturnType<typeof setTimeout> | null = null;
try {
  watch(PUBLIC, { recursive: true }, (_evt, file) => {
    if (file && !/\.(js|css|html|woff2?|png)$/i.test(String(file))) return;
    if (lrTimer) clearTimeout(lrTimer);
    lrTimer = setTimeout(() => {
      for (const c of [...LR_CLIENTS]) { try { c.write("data: reload\n\n"); } catch { LR_CLIENTS.delete(c); } }
    }, 120);
  });
} catch { /* recursive watch unsupported on this platform */ }
const ORACLE_HOME_LOGS = join(homedir(), ".nibbi", "logs");
mkdirSync(ORACLE_HOME_LOGS, { recursive: true });
const STARTED = Date.now();

/* living vault: watch the brain, surface writes to the UI */
let vaultTouched: { file: string; ts: number } | null = null;
try {
  const { watch } = await import("node:fs");
  watch(VAULT, { recursive: true }, (_ev, fname) => {
    const f = String(fname || "");
    if (!f || f.startsWith(".git") || f.includes("node_modules")) return;
    vaultTouched = { file: f, ts: Date.now() };
  });
} catch { /* watcher unavailable */ }

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const json = (res: import("node:http").ServerResponse, code: number, body: unknown): void => {
  const buf = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(buf), ...CORS });
  res.end(buf);
};

async function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export function startWebApp(): void {
  const server = createServer((req, res) => { void handle(req, res); });
  server.listen(WEB_PORT, "127.0.0.1", () => console.log(`[webapp] http://127.0.0.1:${WEB_PORT}`));
}

async function handle(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (req.method === "OPTIONS") { res.writeHead(204, CORS); res.end(); return; }
    if (req.method === "GET" && url.pathname === "/api/livereload") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", ...CORS });
      res.write(": live-reload connected\n\n");
      LR_CLIENTS.add(res);
      req.on("close", () => LR_CLIENTS.delete(res));
      return;
    }
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(readFileSync(join(PUBLIC, "index.html")));
      return;
    }
    if (req.method === "GET" && (url.pathname === "/favicon.ico" || url.pathname === "/favicon.png")) {
      res.writeHead(200, { "content-type": "image/png", "cache-control": "max-age=86400", ...CORS });
      res.end(readFileSync(join(PUBLIC, "favicon.png")));
      return;
    }
    if (req.method === "GET" && (url.pathname.startsWith("/fonts/") || url.pathname.startsWith("/vendor/"))) {
      const abs = resolve(PUBLIC, url.pathname.slice(1));
      if (!abs.startsWith(PUBLIC) || !existsSync(abs)) { json(res, 404, { error: "not found" }); return; }
      const type = abs.endsWith(".woff2") ? "font/woff2"
        : abs.endsWith(".wasm") ? "application/wasm"
        : abs.endsWith(".onnx") ? "application/octet-stream"
        : abs.endsWith(".mjs") ? "text/javascript; charset=utf-8"
        : "text/javascript; charset=utf-8";
      res.writeHead(200, { "content-type": type, "cache-control": "max-age=86400", ...CORS });
      res.end(readFileSync(abs));
      return;
    }
    if (req.method === "GET" && url.pathname === "/app.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
      res.end(readFileSync(join(PUBLIC, "app.js")));
      return;
    }
    if (req.method === "GET" && (url.pathname === "/design" || url.pathname.startsWith("/design/"))) {
      const DESIGN = resolve(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "design"));
      const rel = decodeURIComponent(url.pathname.replace(/^\/design\/?/, ""));
      const abs = resolve(DESIGN, rel);
      if (!abs.startsWith(DESIGN)) { json(res, 403, { error: "nope" }); return; }
      if (!rel || !existsSync(abs) || statSync(abs).isDirectory()) {
        const dir = existsSync(abs) && statSync(abs).isDirectory() ? abs : DESIGN;
        const items = readdirSync(dir, { withFileTypes: true })
          .map((d) => d.name + (d.isDirectory() ? "/" : ""))
          .filter((n) => !n.startsWith("."))
          .map((n) => `<li><a href="/design/${join(dir.replace(DESIGN, ""), n).replace(/^\//, "")}">${n}</a></li>`)
          .join("");
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(`<html><body style="background:#0a0e12;color:#c8d6e0;font:14px Menlo;padding:40px"><h2 style="color:#38e0c3;letter-spacing:.3em">ORACLE DESIGN LAB</h2><ul style="line-height:2">${items}</ul></body></html>`);
        return;
      }
      const type = abs.endsWith(".html") ? "text/html; charset=utf-8" : abs.endsWith(".png") ? "image/png" : "text/plain";
      res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
      res.end(readFileSync(abs));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/beacon") {
      const line = `[${new Date().toISOString()}] ${url.searchParams.get("stage") ?? "?"} | ${(url.searchParams.get("m") ?? "").slice(0, 200)} | UA=${req.headers["user-agent"] ?? "?"}\n`;
      appendFileSync(join(ORACLE_HOME_LOGS, "beacon.log"), line);
      json(res, 200, { ok: true });
      return;
    }
    if (url.pathname === "/api/model") {
      if (req.method === "POST") {
        const { model } = JSON.parse(await readBody(req)) as { model?: string };
        const m = (model === "default" || !model) ? null : model.replace(/[^a-z0-9.-]/gi, "");
        await setMasterModel(m);
        json(res, 200, { ok: true, current: m ?? "default" });
        return;
      }
      json(res, 200, { current: loadState().modelOverride ?? "default", options: ["default", "opus", "sonnet", "haiku"] });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/status") {
      const s = loadState();
      let busy = false;
      try { busy = Date.now() - statSync(join(homedir(), ".nibbi", "turn.lock")).mtimeMs < 15 * 60_000; } catch { /* idle */ }
      json(res, 200, { ...s, sessionShort: s.sessionId?.slice(0, 8) ?? null, paired: false, busy,
        vaultTouched, pid: process.pid, uptimeSec: Math.round((Date.now() - STARTED) / 1000), vault: VAULT });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/file") {
      const p = url.searchParams.get("p") || "";
      const abs = resolve(p.startsWith("/") ? p : join(VAULT, p));
      const ext = abs.toLowerCase().match(/\.(png|jpe?g|gif|webp)$/)?.[1];
      let roots: string[] = [VAULT];
      try {
        const g = JSON.parse(readFileSync(join(homedir(), ".nibbi", "games.json"), "utf8")) as Record<string, { repo?: string }>;
        roots = roots.concat(Object.values(g).map((x) => x.repo || "").filter(Boolean));
      } catch { /* vault only */ }
      if (!ext || !roots.some((r2) => abs.startsWith(r2 + "/")) || !existsSync(abs)) {
        json(res, 404, { error: "not found" }); return;
      }
      res.writeHead(200, { "content-type": ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`,
        "cache-control": "max-age=300", ...CORS });
      res.end(readFileSync(abs));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/open") {
      const target = url.searchParams.get("url") || "";
      if (!/^https?:\/\//i.test(target)) { json(res, 400, { error: "http(s) only" }); return; }
      try { execFileSync("open", [target], { timeout: 5000 }); json(res, 200, { ok: true }); }
      catch (e) { json(res, 500, { error: (e as Error).message.slice(0, 120) }); }
      return;
    }
    if (url.pathname === "/api/auto") {
      if (req.method === "POST") {
        const { project, on, maxConcurrent, autoMerge, spendCap, mode, model, focus } = JSON.parse(await readBody(req)) as { project?: string; on?: boolean; maxConcurrent?: number; autoMerge?: boolean; spendCap?: number; mode?: "off"|"suggest"|"stage"|"ship"; model?: string; focus?: string };
        if (!project || !games()[project]) { json(res, 400, { error: "unknown project" }); return; }
        const patch: Record<string, unknown> = {};
        if (on !== undefined) patch["on"] = on;
        if (maxConcurrent !== undefined) patch["maxConcurrent"] = maxConcurrent;
        if (autoMerge !== undefined) patch["autoMerge"] = autoMerge;
        if (spendCap !== undefined) patch["spendCap"] = spendCap;
        if (mode !== undefined) patch["mode"] = mode;
        if (model !== undefined) patch["model"] = model;
        if (focus !== undefined) patch["focus"] = focus || undefined;
        json(res, 200, setAuto(project, patch));
        return;
      }
      const project = url.searchParams.get("project");
      const all = autoConfig();
      if (project) {
        { const cc = all[project] ?? { on: false, maxConcurrent: 2, autoMerge: false }; const rp = roadmapProgress(project); json(res, 200, { ...cc, mode: cc.mode ?? (!cc.on ? "off" : (cc.autoMerge ? "ship" : "stage")), inflight: inflightFor(project).length, staged: stagedFor(project).length, pending: pendingTasks(project).length, done: rp.done, total: rp.total, spend: autoSpend(project) }); }
      } else {
        const out: Record<string, unknown> = {};
        for (const [p, c] of Object.entries(all)) {
          const rp = roadmapProgress(p);
          out[p] = { ...c, mode: c.mode ?? (!c.on ? "off" : (c.autoMerge ? "ship" : "stage")), inflight: inflightFor(p).length, staged: stagedFor(p).length, pending: pendingTasks(p).length, done: rp.done, total: rp.total, spend: autoSpend(p) };
        }
        json(res, 200, out);
      }
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/projects") {
      const projects: Array<Record<string, unknown>> = [];
      const add = (name: string, repo: string, extra: Record<string, unknown> = {}): void => {
        if (!existsSync(repo)) return;
        const g = (args: string[]): string => {
          try { return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", timeout: 5000 }).trim(); }
          catch { return ""; }
        };
        projects.push({
          name, repo,
          branch: g(["rev-parse", "--abbrev-ref", "HEAD"]),
          lastCommit: g(["log", "-1", "--format=%h %s (%cr)"]).slice(0, 90),
          dirty: g(["status", "--porcelain"]).split("\n").filter(Boolean).length,
          ...extra,
        });
      };
      try {
        const games = JSON.parse(readFileSync(join(homedir(), ".nibbi", "games.json"), "utf8")) as Record<string, { repo?: string; install?: string; check?: string }>;
        for (const [name, cfg] of Object.entries(games)) if (cfg.repo) add(name, cfg.repo, { kind: "game", check: cfg.check ?? "" });
      } catch { /* no games registry */ }
      add("nibbi-gateway", SELF_REPO, { kind: "self", check: "npx tsc --noEmit -p " + JSON.stringify(DAEMON_DIR) });
      add("vault", VAULT, { kind: "brain" });
      json(res, 200, projects);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/reveal") {
      const p = url.searchParams.get("p") || "";
      const roots = [SELF_REPO, VAULT];
      try {
        const games = JSON.parse(readFileSync(join(homedir(), ".nibbi", "games.json"), "utf8")) as Record<string, { repo?: string }>;
        for (const g of Object.values(games)) if (g.repo) roots.push(g.repo);
      } catch { /* vault+oracle only */ }
      const abs = resolve(p);
      if (!roots.includes(abs)) { json(res, 403, { error: "unknown project" }); return; }
      try { execFileSync("open", [abs], { timeout: 5000 }); json(res, 200, { ok: true }); }
      catch (e) { json(res, 500, { error: (e as Error).message.slice(0, 100) }); }
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/fixer-diff") {
      const id = (url.searchParams.get("id") || "").replace(/[^a-z0-9]/gi, "");
      try { json(res, 200, getFixerDiff(id)); }
      catch (e) { json(res, 404, { error: (e as Error).message.slice(0, 120) }); }
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/artifacts") {
      const project = url.searchParams.get("project") || "";
      const changes = listFixers()
        .filter((f) => f.game === project && (f.status === "merged" || f.status === "done"))
        .map((f) => ({ id: f.id, title: f.title ?? f.issue.slice(0, 44), diffstat: f.diffstat, costUsd: f.costUsd, endedAt: f.endedAt ?? f.startedAt, status: f.status, model: f.model, group: f.group }))
        .sort((a, b) => String(b.endedAt).localeCompare(String(a.endedAt)));
      const files: Array<{ name: string; size: number; mtime: number; kind: string }> = [];
      for (const d of [join(homedir(), "NibbiVault", "exports"), join(homedir(), ".nibbi", "artifacts")]) {
        try { for (const e of readdirSync(d, { withFileTypes: true })) if (e.isFile() && !e.name.startsWith(".")) { const st = statSync(join(d, e.name)); files.push({ name: e.name, size: st.size, mtime: st.mtimeMs, kind: (e.name.split(".").pop() || "file") }); } } catch { /* dir may not exist */ }
      }
      files.sort((a, b) => b.mtime - a.mtime);
      json(res, 200, { changes, files });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/growth") {
      const vault = join(homedir(), "NibbiVault");
      try {
        const out = execFileSync("git", ["-C", vault, "log", "-40", "--pretty=format:%h\u0001%ct\u0001%s", "--", "MEMORY.md", "SOUL.md", "AGENTS.md", ".claude"], { encoding: "utf8" });
        const items = out.trim().split("\n").filter(Boolean).map((l) => { const [hash, ct, msg] = l.split("\u0001"); return { hash, at: Number(ct) * 1000, msg }; });
        json(res, 200, items);
      } catch { json(res, 200, []); }
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/build-report") {
      json(res, 200, { text: buildReport(Number(url.searchParams.get("hours")) || 24) });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/play") {
      const project = url.searchParams.get("project") || "";
      const action = url.searchParams.get("action") || "status";
      if (action === "start") { json(res, 200, playStart(project)); return; }
      if (action === "stop") { json(res, 200, { text: playStop(project) }); return; }
      json(res, 200, playStatus(project));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/milestones") {
      const project = url.searchParams.get("project") || "";
      const plan = join(homedir(), "NibbiVault", "plans", project + ".md");
      const ms: Array<{ name: string; done: number; total: number }> = [];
      try {
        let cur: { name: string; done: number; total: number } | null = null;
        for (const l of readFileSync(plan, "utf8").split("\n")) {
          const h = l.match(/^##\s+(.+)/);
          if (h) { const name = h[1].trim(); if (/^decisions/i.test(name)) { cur = null; continue; } cur = { name, done: 0, total: 0 }; ms.push(cur); continue; }
          const t = l.match(/^\s*[-*]\s*\[([ xX])\]/);
          if (t && cur) { cur.total++; if (t[1].toLowerCase() === "x") cur.done++; }
        }
      } catch { /* no plan */ }
      json(res, 200, ms.filter((m) => m.total > 0));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/game") {
      try { json(res, 200, getGame(url.searchParams.get("since") || undefined)); }
      catch (e) { json(res, 500, { error: (e as Error).message.slice(0, 200) }); }
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/schedules") {
      const defs = [
        { name: "heartbeat", pattern: "*/30 8-23 * * *", when: "every 30 min · 8am–11pm", desc: "checks the watching-list; nudges you if something needs eyes" },
        { name: "morning brief", pattern: "30 7 * * *", when: "7:30 AM daily", desc: "composes your morning brief from journal, issues & inbox" },
        { name: "consolidation", pattern: "0 3 * * *", when: "3:00 AM daily", desc: "files inbox + journal into the vault brain; renews context" },
        { name: "vault backup", pattern: "30 3 * * *", when: "3:30 AM daily", desc: "git-commits + backs up the vault" },
        { name: "weekly self-review", pattern: "0 18 * * 0", when: "Sundays 6:00 PM", desc: "reviews the week & proposes improvements" },
      ];
      const out = defs.map((d) => { let next: string | null = null; try { next = new Cron(d.pattern).nextRun()?.toISOString() ?? null; } catch { /* bad pattern */ } return { ...d, next }; });
      json(res, 200, out);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/fix") {
      const { project, issue } = JSON.parse(await readBody(req)) as { project?: string; issue?: string };
      if (!issue?.trim()) { json(res, 400, { error: "issue text required" }); return; }
      const proj = (project || "shipless").trim();
      if (!games()[proj]) { json(res, 400, { error: `unknown project '${proj}'` }); return; }
      try {
        const f = spawnFixer(proj, issue.trim(), notifyHook);
        json(res, 200, { id: f.id, branch: f.branch, project: proj });
      } catch (e) { json(res, 500, { error: (e as Error).message.slice(0, 160) }); }
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/project-create") {
      const { mode, name, path: ppath } = JSON.parse(await readBody(req)) as { mode?: string; name?: string; path?: string };
      if (!name?.trim()) { json(res, 400, { error: "project name required" }); return; }
      try {
        if (mode === "existing") {
          if (!ppath?.trim()) { json(res, 400, { error: "path required for an existing folder" }); return; }
          const cfg = registerProject(name.trim(), ppath.trim());
          json(res, 200, { ok: true, repo: cfg.repo, mode: "existing" });
        } else {
          const r = createProject(name.trim());
          json(res, 200, { ok: true, repo: r.repo, slug: r.slug, mode: "new" });
        }
      } catch (e) { json(res, 400, { error: (e as Error).message.slice(0, 160) }); }
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/fixer-log") {
      const id = (url.searchParams.get("id") || "").replace(/[^a-z0-9]/gi, "");
      const f = listFixers().find((x) => x.id === id);
      const p = join(homedir(), ".nibbi", "logs", `fixer-${id}.log`);
      const entries: Array<{ ts: string; kind: string; text: string }> = [];
      if (id && existsSync(p)) {
        const raw = readFileSync(p, "utf8").trimEnd().split("\n").slice(-250);
        for (const line of raw) {
          const m = line.match(/^\[([^\]]+)\]\s*(.*)$/);
          const ts = m ? m[1] : "";
          const body = m ? m[2] : line;
          let kind = "system", text = body;
          if (body.startsWith("ASSISTANT: ")) { kind = "assistant"; text = body.slice(11); }
          else if (body.startsWith("TOOL: ")) { kind = "tool"; text = body.slice(6); }
          entries.push({ ts, kind, text });
        }
      }
      json(res, 200, { fixer: f ?? null, steerable: id ? isSteerable(id) : false, entries });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/fix-queue") {
      const { project, issue, title, group } = JSON.parse(await readBody(req)) as { project?: string; issue?: string; title?: string; group?: string };
      if (!project || !games()[project] || !issue?.trim()) { json(res, 400, { error: "project + issue required" }); return; }
      try { const f = queueFix(project, issue.trim(), { title, group }); json(res, 200, { id: f.id, status: "queued" }); }
      catch (e) { json(res, 400, { error: (e as Error).message.slice(0, 120) }); }
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/fix-unqueue") {
      const { id } = JSON.parse(await readBody(req)) as { id?: string };
      if (!id) { json(res, 400, { error: "id required" }); return; }
      json(res, 200, { text: unqueueFix(id) });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/fix-requeue") {
      const { id } = JSON.parse(await readBody(req)) as { id?: string };
      if (!id) { json(res, 400, { error: "id required" }); return; }
      json(res, 200, { text: requeueFix(id) });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/fixer-stop") {
      const { id } = JSON.parse(await readBody(req)) as { id?: string };
      if (!id) { json(res, 400, { error: "id required" }); return; }
      json(res, 200, { text: stopFixer(id) });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/group-merge") {
      const { project, group } = JSON.parse(await readBody(req)) as { project?: string; group?: string };
      if (!project || !group) { json(res, 400, { error: "project and group required" }); return; }
      json(res, 200, { text: mergeGroup(project, group, notifyHook) });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/group-stop") {
      const { project, group } = JSON.parse(await readBody(req)) as { project?: string; group?: string };
      if (!project || !group) { json(res, 400, { error: "project and group required" }); return; }
      json(res, 200, { stopped: stopGroup(project, group) });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/agents-stop-all") {
      const n = stopAllFixers();
      json(res, 200, { stopped: n });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/fixer-steer") {
      const { id, text } = JSON.parse(await readBody(req)) as { id?: string; text?: string };
      if (!id || !text?.trim()) { json(res, 400, { error: "id and text required" }); return; }
      json(res, 200, { text: steerFixer(id, text.trim()) });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/fixer-tail") {
      const id = (url.searchParams.get("id") || "").replace(/[^a-z0-9]/gi, "");
      const p = join(homedir(), ".nibbi", "logs", `fixer-${id}.log`);
      if (!id || !existsSync(p)) { json(res, 200, { lines: [] }); return; }
      const lines = readFileSync(p, "utf8").trimEnd().split("\n").slice(-5)
        .map((l) => l.replace(/^\[[^\]]+\]\s*/, "").slice(0, 180));
      json(res, 200, { lines });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/fixers") {
      json(res, 200, listFixers().slice(-12).reverse());
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/history") {
      const n = Math.min(500, Number(url.searchParams.get("n") ?? 80));
      const q = url.searchParams.get("q");
      const around = url.searchParams.get("around");
      if (q) { json(res, 200, searchChat(q, n)); return; }
      if (around) { json(res, 200, readAround(around, n)); return; }
      json(res, 200, readChat(n, url.searchParams.get("before") || undefined));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/vault") {
      const rel = url.searchParams.get("p") ?? "";
      const abs = resolve(VAULT, rel);
      if (!abs.startsWith(VAULT)) { json(res, 403, { error: "outside vault" }); return; }
      json(res, 200, { path: rel, content: existsSync(abs) ? readFileSync(abs, "utf8") : "(missing)" });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/vault-write") {
      const { path: rel, content } = JSON.parse(await readBody(req)) as { path?: string; content?: string };
      if (!rel || content === undefined) { json(res, 400, { error: "path + content required" }); return; }
      const abs = resolve(VAULT, rel);
      if (!abs.startsWith(VAULT)) { json(res, 403, { error: "outside vault" }); return; }
      const base = abs.split("/").pop() || "";
      if (base === "SOUL.md" || base === "AGENTS.md") { json(res, 403, { error: "protected — SOUL/AGENTS change via the proposal flow" }); return; }
      try { const tmp = abs + ".tmp"; writeFileSync(tmp, content); renameSync(tmp, abs); json(res, 200, { ok: true }); }
      catch (e) { json(res, 500, { error: (e as Error).message.slice(0, 120) }); }
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/say") {
      const text = (url.searchParams.get("text") ?? "").slice(0, 800);
      if (!text) { json(res, 400, { error: "no text" }); return; }
      try {
        res.writeHead(200, { "content-type": "audio/ogg", "cache-control": "no-store", ...CORS });
        res.end(readFileSync(synthOgg(text, isRateLimited())));
      } catch (e) { json(res, 500, { error: (e as Error).message.slice(0, 200) }); }
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/transcribe") {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const audio = Buffer.concat(chunks);
      if (audio.length < 200) { json(res, 400, { error: "empty audio" }); return; }
      const tmp = join(homedir(), ".nibbi", "tmp", `live-${Date.now()}.webm`);
      writeFileSync(tmp, audio);
      try {
        const heard = execFileSync(join(homedir(), ".nibbi", "bin", "transcribe"), [tmp, "fast"], { encoding: "utf8", timeout: 120_000 }).trim();
        json(res, 200, { heard });
      } catch (e) { json(res, 500, { error: (e as Error).message.slice(0, 200) }); }
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/voice") {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const audio = Buffer.concat(chunks);
      if (audio.length < 200) { json(res, 400, { error: "empty audio" }); return; }
      const tmp = join(homedir(), ".nibbi", "tmp", `ptt-${Date.now()}.webm`);
      writeFileSync(tmp, audio);
      const heard = execFileSync(join(homedir(), ".nibbi", "bin", "transcribe"), [tmp], { encoding: "utf8", timeout: 120_000 }).trim();
      if (!heard) { json(res, 400, { error: "heard nothing" }); return; }
      const c2 = await handleCommand(heard, notifyHook);
      const text = c2.handled ? (c2.reply ?? "ok") : (await runTurn("(voice) " + heard, undefined, "app")).text;
      let tts = "";
      try { tts = "/api/audio?f=" + encodeURIComponent(synthOgg(text, isRateLimited()).split("/").pop() ?? ""); } catch { /* speechless */ }
      json(res, 200, { heard, text, tts });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/audio") {
      const f = (url.searchParams.get("f") ?? "").replace(/[^a-zA-Z0-9._-]/g, "");
      const p = join(homedir(), ".nibbi", "tmp", f);
      if (!existsSync(p)) { json(res, 404, { error: "no audio" }); return; }
      res.writeHead(200, { "content-type": "audio/ogg", ...CORS });
      res.end(readFileSync(p));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/send") {
      const { message, stream, images } = JSON.parse(await readBody(req)) as
        { message?: string; stream?: boolean; images?: Array<{ media_type: string; data: string }> };
      if (!message?.trim() && !images?.length) { json(res, 400, { error: "empty message" }); return; }
      const imgs = (images ?? []).filter((i) => /^image\/(png|jpeg|webp|gif)$/.test(i.media_type) && i.data.length < 8_000_000).slice(0, 4);
      if (stream) {
        // SSE: delta events while the model speaks, then one done event with the canonical result
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", ...CORS });
        const send = (ev: string, data: unknown): void => { res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); };
        const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
        try {
          const c = await handleCommand((message ?? "").trim(), notifyHook);
          if (c.handled) {
            send("done", { text: c.reply ?? "ok", costUsd: 0, isError: false });
          } else {
            const r = await runTurn((message ?? "").trim() || "(image)", undefined, "app", undefined, (t) => send("delta", { t }), (name) => send("tool", { name }), imgs, true);
            send("done", { text: r.text, voice: r.voice, costUsd: r.costUsd, sessionId: r.sessionId, isError: r.isError, local: r.local });
          }
        } catch (e) {
          send("done", { text: "error: " + (e as Error).message.slice(0, 200), costUsd: 0, isError: true });
        } finally {
          clearInterval(ping);
          res.end();
        }
        return;
      }
      const c = await handleCommand((message ?? "").trim(), notifyHook);
      if (c.handled) { json(res, 200, { text: c.reply ?? "ok", costUsd: 0, isError: false }); return; }
      const r = await runTurn((message ?? "").trim() || "(image)", undefined, "app", undefined, undefined, undefined, imgs, true);
      json(res, 200, { text: r.text, costUsd: r.costUsd, sessionId: r.sessionId, isError: r.isError, local: r.local });
      return;
    }
    json(res, 404, { error: "not found" });
  } catch (e) {
    json(res, 500, { error: (e as Error).message.slice(0, 300) });
  }
}

// session.ts — the ONE master session: query() + resume + auto-commit + cross-process turn lock.
import { query, tool, createSdkMcpServer, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { spawnFixer, steerFixer, listFixers, isSteerable } from "./fixer.js";
import { openSync, writeSync, closeSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildSystemPrompt, commitVault, VAULT } from "./vault.js";
import { canUseTool } from "./policy.js";
import { loadState, saveState, ORACLE_HOME, type GatewayState } from "./state.js";
import { logChat, readChat, type ChatEntry } from "./history.js";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

/** MCP registry: ~/.nibbi/mcp.json, tokens resolved from Keychain — never on disk. */
function buildMcpServers(): Record<string, import("@anthropic-ai/claude-agent-sdk").McpServerConfig> | undefined {
  const cfgPath = join(ORACLE_HOME, "mcp.json");
  if (!existsSync(cfgPath)) return undefined;
  try {
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as Record<string, { type: string; url: string; authKeychain?: { service: string; account: string } }>;
    const out: Record<string, import("@anthropic-ai/claude-agent-sdk").McpServerConfig> = {};
    for (const [name, s] of Object.entries(cfg)) {
      const headers: Record<string, string> = {};
      if (s.authKeychain) {
        const tok = execFileSync("security", ["find-generic-password", "-s", s.authKeychain.service, "-a", s.authKeychain.account, "-w"], { encoding: "utf8" }).trim();
        headers["Authorization"] = `Bearer ${tok}`;
      }
      out[name] = { type: "http", url: s.url, headers };
    }
    return out;
  } catch (e) {
    console.error("[mcp] registry error:", (e as Error).message.slice(0, 120));
    return undefined;
  }
}
const MCP_SERVERS = buildMcpServers();

/* ── Nibbi as tech lead: native tools to dispatch & steer fixers ────────────
   The main chat sizes up the task, picks the model by difficulty, briefs the
   fixer with context, and can tap it on the shoulder mid-run. */
let dispatchNotify: (m: string) => Promise<void> = async () => undefined;
export function setDispatchNotify(fn: (m: string) => Promise<void>): void { dispatchNotify = fn; }

const DIFFICULTY_MODEL: Record<string, string> = { trivial: "haiku", normal: "sonnet", hard: "opus" };

const fixerTools = createSdkMcpServer({
  name: "nibbi-fixers",
  version: "1.0.0",
  tools: [
    tool(
      "dispatch_fixer",
      "Delegate a code change to a fixer agent on a git branch (main untouched). YOU are the lead: judge difficulty and give real context. Use for any change to a registered project.",
      {
        project: z.string().describe("registered project slug, e.g. 'shipless'"),
        issue: z.string().describe("the concrete change to make — specific and self-contained"),
        difficulty: z.enum(["trivial", "normal", "hard"]).describe("trivial=doc/one-liner (haiku), normal=scoped code (sonnet), hard=cross-cutting/tricky (opus)"),
        context: z.string().describe("everything the fixer needs that it can't easily discover: relevant files, conventions, prior decisions, constraints, what NOT to touch. Pull from your vault knowledge."),
        task: z.string().optional().describe("if this addresses a roadmap task, pass the EXACT checkbox text from plans/<project>.md — it auto-ticks when the change merges"),
        title: z.string().describe("crisp 2-4 word human label of what this fixer builds, e.g. 'mana costs', 'fuel tracking' — shows on its card"),
        group: z.string().optional().describe("optional group label to bundle related fixes (e.g. a milestone 'M2: game loop') — they show and merge together"),
      },
      async (args) => {
        const model = DIFFICULTY_MODEL[args.difficulty] ?? "sonnet";
        try {
          const f = spawnFixer(args.project, args.issue, dispatchNotify, { model, context: args.context, difficulty: args.difficulty, task: args.task, title: args.title, group: args.group });
          return { content: [{ type: "text", text: `Dispatched fixer ${f.id} on branch ${f.branch} (${args.difficulty} → ${model}). It's staged on a branch; watch/steer it in the app, review & merge when ready.` }] };
        } catch (e) {
          return { content: [{ type: "text", text: `dispatch failed: ${(e as Error).message.slice(0, 160)}` }], isError: true };
        }
      },
    ),
    tool(
      "steer_fixer",
      "Send priority guidance to a running fixer mid-task (e.g. 'use the existing helper', 'also update the tests', 'wrong file — it's in src/'). Only works while the fixer session is live.",
      { id: z.string().describe("fixer id"), guidance: z.string().describe("the direction to inject") },
      async (args) => ({ content: [{ type: "text", text: steerFixer(args.id, args.guidance) }] }),
    ),
    tool(
      "list_fixers",
      "See current fixers and whether each is still steerable (live session) — check before steering.",
      {},
      async () => {
        const fx = listFixers().slice(-8).map((f) => `${f.id} · ${f.game} · ${f.status}${isSteerable(f.id) ? " · steerable" : ""} — ${f.issue.slice(0, 50)}`);
        return { content: [{ type: "text", text: fx.length ? fx.join("\n") : "no fixers yet" }] };
      },
    ),
  ],
});

const ALL_MCP = { ...(MCP_SERVERS ?? {}), "nibbi-fixers": fixerTools };

export interface TurnResult { text: string; costUsd: number; sessionId?: string; isError: boolean; ctxTokens?: number; voice?: string; local?: boolean; }

/** Pull every »voice: line out of a reply — spoken narration for TTS, clean text for display/history.
    A voice line ends at a newline OR the next marker (models sometimes chain them inline). */
export function splitVoice(text: string): { text: string; voice?: string } {
  const parts = text.split(/»voice:\s*/);
  if (parts.length === 1) return { text };
  const lines: string[] = [];
  let clean = parts[0];
  for (let i = 1; i < parts.length; i++) {
    const nl = parts[i].indexOf("\n");
    if (nl < 0) { const l = parts[i].trim(); if (l) lines.push(l); }
    else {
      const l = parts[i].slice(0, nl).trim();
      if (l) lines.push(l);
      clean += parts[i].slice(nl + 1);
    }
  }
  return { text: clean.trim(), voice: lines.length ? lines.join(" ") : undefined };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** One turn at a time across ALL processes (CLI, daemon, crons). Stale after 15 min. */
async function acquireTurnLock(): Promise<() => void> {
  const lock = join(ORACLE_HOME, "turn.lock");
  for (let i = 0; i < 300; i++) {
    try {
      const fd = openSync(lock, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return () => { try { rmSync(lock); } catch { /* gone */ } };
    } catch {
      try { if (Date.now() - statSync(lock).mtimeMs > 15 * 60_000) rmSync(lock); } catch { /* raced */ }
      await sleep(2000);
    }
  }
  throw new Error("turn lock: timed out after 10 min");
}

export interface ImageAttachment { media_type: string; data: string; }

/** Streaming input wrapper (required for canUseTool). */
async function* asStream(text: string, images?: ImageAttachment[]): AsyncIterable<SDKUserMessage> {
  const content: Array<Record<string, unknown>> = [];
  for (const im of (images ?? []).slice(0, 4)) {
    content.push({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } });
  }
  content.push({ type: "text", text });
  yield { type: "user", message: { role: "user", content }, parent_tool_use_id: null } as unknown as SDKUserMessage;
}

export async function runTurn(prompt: string, onText?: (t: string) => void, channel = "cli", model?: string, onDelta?: (t: string) => void, onTool?: (name: string) => void, images?: ImageAttachment[], fast?: boolean): Promise<TurnResult> {
  const release = await acquireTurnLock();
  const visible = channel !== "heartbeat" && channel !== "auto"; // pulses + auto-orchestration stay out of the conversation view
  try {
    if (visible) logChat({ ts: new Date().toISOString(), channel, role: "user", text: (images?.length ? "🖼️ ".repeat(images.length) : "") + prompt });
    const r0 = await runTurnLocked(prompt, onText, model, onDelta, onTool, images, fast, channel === "auto");
    const sv = splitVoice(r0.text);
    const r: TurnResult = { ...r0, text: sv.text, voice: sv.voice };
    if (visible) logChat({ ts: new Date().toISOString(), channel, role: "oracle", text: r.text, costUsd: r.costUsd });
    return r;
  } finally {
    release();
  }
}

/* ── persistent master session ─────────────────────────────────────────────
   One long-lived claude subprocess; each turn streams in via a queue instead of
   paying ~5s spawn+resume per message (measured). Interactive turns run here with
   thinking disabled / low effort; deep turns (crons) use one-shot deep queries. */
interface Master { push: (text: string, images?: ImageAttachment[]) => void; alive: boolean; q: import("@anthropic-ai/claude-agent-sdk").Query; }
let master: Master | null = null;
let turnSink: ((msg: SDKMessage) => void) | null = null;
let lastRateLimit: GatewayState["rateLimit"] | undefined;

/** Fresh working context: close the master session and forget the session id.
    Durable memory lives in the vault (MEMORY.md/journal/index) — the next turn starts lean. */
export function resetSession(): void {
  try { (master?.q as unknown as { close?: () => void })?.close?.(); } catch { /* already gone */ }
  master = null;
  turnSink = null;
  const st = loadState();
  st.sessionId = undefined;
  st.ctxTokens = undefined;
  saveState(st);
}

/** Live model switch for the persistent session; persists as the interactive default. */
export async function setMasterModel(m: string | null): Promise<void> {
  const st = loadState();
  st.modelOverride = m;
  saveState(st);
  if (master?.alive) await master.q.setModel(m ?? undefined);
}

function ensureMaster(resume: string | undefined): Master {
  if (master?.alive) return master;
  const queue: SDKUserMessage[] = [];
  let wake: (() => void) | null = null;
  async function* input(): AsyncIterable<SDKUserMessage> {
    for (;;) {
      while (queue.length) yield queue.shift() as SDKUserMessage;
      await new Promise<void>((r) => { wake = r; });
    }
  }
  const q = query({
    prompt: input(),
    options: {
      cwd: VAULT,
      resume,
      systemPrompt: buildSystemPrompt(),
      canUseTool,
      title: "nibbi",
      maxTurns: 30,
      thinking: { type: "disabled" as const },
      effort: "low" as const,
      includePartialMessages: true,
      ...(loadState().modelOverride ? { model: loadState().modelOverride as string } : {}),
      mcpServers: ALL_MCP,
    },
  });
  // never hit the context wall: compact automatically when it fills, precompute the summary in the background
  void q.applyFlagSettings({ autoCompactEnabled: true, precomputeCompactionEnabled: true }).catch(() => undefined);
  const m: Master = {
    alive: true,
    q,
    push: (text, images) => {
      const content: Array<Record<string, unknown>> = [];
      for (const im of (images ?? []).slice(0, 4)) {
        content.push({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } });
      }
      content.push({ type: "text", text });
      queue.push({ type: "user", message: { role: "user", content }, parent_tool_use_id: null } as unknown as SDKUserMessage);
      wake?.(); wake = null;
    },
  };
  // single forever-consumer: dispatches to the active turn, drops inter-turn chatter
  void (async () => {
    try {
      for await (const msg of q as AsyncIterable<SDKMessage>) {
        if (process.env.ORACLE_TRACE) console.error(`[trace +${Date.now() % 100000}] ${msg.type} ${(msg as { subtype?: string }).subtype ?? ""}`);
        if (msg.type === "rate_limit_event") {
          const ri = (msg as unknown as { rate_limit_info: { status: string; utilization?: number; resetsAt?: number; rateLimitType?: string } }).rate_limit_info;
          lastRateLimit = { status: ri.status, utilization: ri.utilization, resetsAt: ri.resetsAt, type: ri.rateLimitType };
        }
        turnSink?.(msg);
      }
    } catch (e) {
      console.error(`[oracle] master session died: ${(e as Error).message.slice(0, 120)}`);
    } finally {
      m.alive = false;
      if (master === m) master = null;
    }
  })();
  master = m;
  return m;
}

const OLLAMA_MODEL = process.env.ORACLE_LOCAL_MODEL || "llama3.2:1b"; // 1.3GB — fits 8GB alongside kokoro+whisper
const OLLAMA_URL = "http://localhost:11434/api/chat";

/** True while the powerful (Claude) window is exhausted — used to route to the local model. */
export function isRateLimited(): boolean {
  const rl = loadState().rateLimit;
  if (!rl || rl.status !== "rejected") return false;
  if (rl.resetsAt) { const ms = rl.resetsAt < 1e12 ? rl.resetsAt * 1000 : rl.resetsAt; if (Date.now() >= ms) return false; }
  return true;
}
function resetLabel(): string {
  const rl = loadState().rateLimit;
  if (!rl?.resetsAt) return "soon";
  const ms = rl.resetsAt < 1e12 ? rl.resetsAt * 1000 : rl.resetsAt;
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Low-usage mode: answer conversationally via the local Ollama model (no tools/agentic work). */
async function localTurn(prompt: string, onDelta?: (t: string) => void): Promise<TurnResult> {
  const recent = readChat(6).map((e: ChatEntry) => ({ role: e.role === "user" ? "user" : "assistant", content: e.text.slice(0, 600) }));
  const sys = `You are Nibbi, Matty's personal agent, running in LOCAL LOW-USAGE MODE — the powerful Claude window is temporarily exhausted (resets ${resetLabel()}). You are a small local model, so: be concise and genuinely helpful for conversation, questions, and thinking-through, but you CANNOT run tools, dispatch fixes, edit files, read the repos, or do heavy agentic work right now. If asked for that, say it'll resume automatically when the window resets (${resetLabel()}) — queued fixes will drain then. Keep replies short.`;
  const messages = [{ role: "system", content: sys }, ...recent, { role: "user", content: prompt }];
  let text = "";
  try {
    const resp = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_MODEL, messages, stream: true, keep_alive: "4m", options: { temperature: 0.6, num_ctx: 2048 } }),
    });
    if (!resp.ok || !resp.body) throw new Error(`ollama ${resp.status}`);
    const reader = resp.body.getReader(); const dec = new TextDecoder(); let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        try { const j = JSON.parse(line) as { message?: { content?: string } }; const c = j.message?.content; if (c) { text += c; onDelta?.(c); } } catch { /* skip */ }
      }
    }
  } catch (e) {
    text = `⚠️ Low-usage mode: the local model isn't responding (${(e as Error).message.slice(0, 60)}). The Claude window resets ${resetLabel()}.`;
  }
  return { text: text.trim() || "(no reply)", costUsd: 0, isError: false, sessionId: loadState().sessionId, local: true };
}

async function runTurnLocked(prompt: string, onText?: (t: string) => void, model?: string, onDelta?: (t: string) => void, onTool?: (name: string) => void, images?: ImageAttachment[], fast?: boolean, lean?: boolean): Promise<TurnResult> {
  const state = loadState();

  /* low-usage mode: Claude window exhausted → answer locally via Ollama (interactive turns only) */
  if (fast && isRateLimited()) {
    return localTurn(prompt, onDelta);
  }

  /* fast path: persistent session (skipped for lean auto-orchestration turns) */
  if (fast && !model && !lean) {
    try {
      const m = ensureMaster(state.sessionId);
      const out: TurnResult = { text: "", costUsd: 0, sessionId: state.sessionId, isError: false };
      const done = new Promise<void>((resolveTurn, rejectTurn) => {
        const guard = setTimeout(() => { turnSink = null; rejectTurn(new Error("persistent turn timeout (10 min)")); }, 10 * 60_000);
        turnSink = (msg) => {
          if (msg.type === "system" && (msg as { subtype?: string }).subtype === "init") {
            out.sessionId = (msg as unknown as { session_id: string }).session_id;
          } else if (msg.type === "stream_event") {
            const se = msg as unknown as { parent_tool_use_id: string | null; event: { type: string; delta?: { type: string; text?: string }; content_block?: { type: string; name?: string } } };
            if (!se.parent_tool_use_id && se.event?.type === "content_block_delta" && se.event.delta?.type === "text_delta" && se.event.delta.text) onDelta?.(se.event.delta.text);
            else if (!se.parent_tool_use_id && se.event?.type === "content_block_start" && se.event.content_block?.type === "tool_use" && se.event.content_block.name) onTool?.(se.event.content_block.name);
          } else if (msg.type === "assistant") {
            const blocks = (msg as unknown as { message: { content: Array<{ type: string; text?: string }> } }).message.content;
            for (const b of blocks) if (b.type === "text" && b.text) { out.text += b.text; onText?.(b.text); }
          } else if (msg.type === "result") {
            const r = msg as unknown as { total_cost_usd?: number; is_error: boolean; session_id?: string;
              usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } };
            out.costUsd = r.total_cost_usd ?? 0;
            out.isError = r.is_error;
            out.sessionId = r.session_id ?? out.sessionId;
            if (r.usage) out.ctxTokens = (r.usage.input_tokens ?? 0) + (r.usage.cache_read_input_tokens ?? 0) + (r.usage.cache_creation_input_tokens ?? 0);
            clearTimeout(guard);
            turnSink = null;
            resolveTurn();
          }
        };
      });
      m.push(prompt, images);
      await done;
      const after = loadState();
      after.sessionId = out.sessionId ?? after.sessionId;
      after.lastTurnAt = new Date().toISOString();
      after.turns += 1;
      after.costUsdTotal += out.costUsd;
      if (out.ctxTokens) after.ctxTokens = out.ctxTokens;
      if (lastRateLimit) after.rateLimit = lastRateLimit;
      saveState(after);
      commitVault(`turn: ${prompt.slice(0, 80).replace(/\n/g, " ")}`);
      return out;
    } catch (err) {
      console.error(`[oracle] persistent session failed (${(err as Error).message.slice(0, 80)}) — falling back to one-shot`);
      master = null;
      turnSink = null;
    }
  }

  const attempt = async (resume: string | undefined): Promise<TurnResult> => {
    const out: TurnResult = { text: "", costUsd: 0, sessionId: resume, isError: false };
    const q = query({
      prompt: asStream(prompt, images),
      options: {
        cwd: VAULT,
        resume,
        systemPrompt: buildSystemPrompt(),
        canUseTool,
        title: "nibbi",
        maxTurns: 30,
        ...(fast ? { thinking: { type: "disabled" as const }, effort: "low" as const } : {}),
        ...(onDelta ? { includePartialMessages: true } : {}),
        ...(model ? { model } : {}),
        mcpServers: ALL_MCP,
      },
    });
    for await (const msg of q as AsyncIterable<SDKMessage>) {
      if (process.env.ORACLE_TRACE) console.error(`[trace +${Date.now() % 100000}] ${msg.type} ${(msg as { subtype?: string }).subtype ?? ""} ${msg.type === "stream_event" ? (msg as unknown as { event: { type: string } }).event?.type : ""}`);
      if (msg.type === "system" && (msg as { subtype?: string }).subtype === "init") {
        out.sessionId = (msg as unknown as { session_id: string }).session_id;
      } else if (msg.type === "stream_event" && (onDelta || onTool)) {
        const se = msg as unknown as { parent_tool_use_id: string | null; event: { type: string; delta?: { type: string; text?: string }; content_block?: { type: string; name?: string } } };
        if (!se.parent_tool_use_id && se.event?.type === "content_block_delta" && se.event.delta?.type === "text_delta" && se.event.delta.text) {
          onDelta?.(se.event.delta.text);
        } else if (!se.parent_tool_use_id && se.event?.type === "content_block_start" && se.event.content_block?.type === "tool_use" && se.event.content_block.name) {
          onTool?.(se.event.content_block.name);
        }
      } else if (msg.type === "assistant") {
        const blocks = (msg as unknown as { message: { content: Array<{ type: string; text?: string }> } }).message.content;
        for (const b of blocks) if (b.type === "text" && b.text) { out.text += b.text; onText?.(b.text); }
      } else if (msg.type === "result") {
        const r = msg as unknown as { total_cost_usd?: number; is_error: boolean; session_id?: string;
          usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } };
        out.costUsd = r.total_cost_usd ?? 0;
        out.isError = r.is_error;
        out.sessionId = r.session_id ?? out.sessionId;
        if (r.usage) out.ctxTokens = (r.usage.input_tokens ?? 0) + (r.usage.cache_read_input_tokens ?? 0) + (r.usage.cache_creation_input_tokens ?? 0);
      } else if (msg.type === "rate_limit_event") {
        const ri = (msg as unknown as { rate_limit_info: { status: string; utilization?: number; resetsAt?: number; rateLimitType?: string } }).rate_limit_info;
        lastRateLimit = { status: ri.status, utilization: ri.utilization, resetsAt: ri.resetsAt, type: ri.rateLimitType };
      }
    }
    return out;
  };

  let result: TurnResult;
  try {
    result = await attempt(lean ? undefined : state.sessionId);
  } catch (err) {
    if (state.sessionId) {
      console.error(`[oracle] resume failed (${(err as Error).message.slice(0, 80)}) — starting fresh session`);
      result = await attempt(undefined);
    } else throw err;
  }

  const after = loadState(); // reload: another process may have bumped counters while we held the lock
  if (!lean) after.sessionId = result.sessionId ?? after.sessionId; // lean auto turns stay isolated from the master session
  after.lastTurnAt = new Date().toISOString();
  after.turns += 1;
  after.costUsdTotal += result.costUsd;
  if (!lean && result.ctxTokens) after.ctxTokens = result.ctxTokens; // don't let lean auto turns clobber the master's displayed context
  if (lastRateLimit) after.rateLimit = lastRateLimit;
  saveState(after);
  commitVault(`turn: ${prompt.slice(0, 80).replace(/\n/g, " ")}`);
  return result;
}

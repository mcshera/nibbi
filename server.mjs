#!/usr/bin/env node
// server.mjs — Nibbi's tiny host. Zero dependencies.
//   • serves ./public (the surface)
//   • proxies /api/* to the Oracle gateway (default http://127.0.0.1:4519), streaming SSE through untouched
//   • /nibbi/health tells the surface whether the brain is reachable
//   • /nibbi/livereload pushes an SSE ping when a file in ./public changes (dev nicety, no build step)
// Usage: node server.mjs [--port 4527] [--gateway http://127.0.0.1:4519] [--open]
import { createServer, request as httpRequest } from "node:http";
import { readFileSync, existsSync, statSync, watch } from "node:fs";
import { join, extname, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1]?.startsWith("--") || arr[i + 1] === undefined ? true : arr[i + 1]] : []).filter(Boolean));
const PORT = Number(args.port || process.env.NIBBI_PORT || 4527);
const GATEWAY = new URL(args.gateway || process.env.ORACLE_GATEWAY || "http://127.0.0.1:4519");
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "public");

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".ogg": "audio/ogg", ".mp3": "audio/mpeg" };

const json = (res, code, body) => { const buf = JSON.stringify(body); res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(buf) }); res.end(buf); };

/* ---- live reload ---- */
const LR = new Set();
let lrTimer = null;
try {
  watch(PUBLIC, { recursive: true }, (_e, f) => {
    if (f && !/\.(js|css|html|png|svg|woff2?)$/i.test(String(f))) return;
    clearTimeout(lrTimer);
    lrTimer = setTimeout(() => { for (const c of LR) { try { c.write("data: reload\n\n"); } catch { LR.delete(c); } } }, 120);
  });
} catch { /* no recursive watch */ }

/* ---- gateway probe (cached 2s) ---- */
let probe = { at: 0, ok: false, status: null };
function probeGateway() {
  return new Promise((resolve) => {
    if (Date.now() - probe.at < 2000) return resolve(probe);
    const req = httpRequest({ host: GATEWAY.hostname, port: GATEWAY.port, path: "/api/status", method: "GET", timeout: 1500 }, (r) => {
      let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => { let s = null; try { s = JSON.parse(b); } catch { /* not json */ } probe = { at: Date.now(), ok: r.statusCode === 200, status: s }; resolve(probe); });
    });
    req.on("error", () => { probe = { at: Date.now(), ok: false, status: null }; resolve(probe); });
    req.on("timeout", () => { req.destroy(); });
    req.end();
  });
}

/* ---- proxy ---- */
function proxy(req, res) {
  const opts = { host: GATEWAY.hostname, port: GATEWAY.port, path: req.url, method: req.method, headers: { ...req.headers, host: GATEWAY.host } };
  const up = httpRequest(opts, (r) => {
    const h = { ...r.headers };
    delete h["access-control-allow-origin"]; // same-origin now; drop the gateway's wildcard
    res.writeHead(r.statusCode || 502, h);
    r.pipe(res);
  });
  up.on("error", (e) => { if (!res.headersSent) json(res, 502, { error: "gateway offline", detail: e.code || e.message, gateway: GATEWAY.origin }); else res.end(); });
  req.on("aborted", () => up.destroy());
  req.pipe(up);
}

/* ---- static ---- */
function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/") p = "/index.html";
  const abs = normalize(join(PUBLIC, p));
  if (!abs.startsWith(PUBLIC) || !existsSync(abs) || !statSync(abs).isFile()) { json(res, 404, { error: "not found" }); return; }
  res.writeHead(200, { "content-type": MIME[extname(abs).toLowerCase()] || "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(abs));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://x");
    if (url.pathname === "/nibbi/health") { const p = await probeGateway(); json(res, 200, { ok: true, port: PORT, gateway: GATEWAY.origin, brain: p.ok, status: p.ok ? p.status : null }); return; }
    if (url.pathname === "/nibbi/livereload") { res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" }); res.write(": nibbi live\n\n"); LR.add(res); req.on("close", () => LR.delete(res)); return; }
    if (url.pathname.startsWith("/api/")) { proxy(req, res); return; }
    if (req.method !== "GET" && req.method !== "HEAD") { json(res, 405, { error: "method" }); return; }
    serveStatic(req, res);
  } catch (e) { if (!res.headersSent) json(res, 500, { error: String(e.message || e).slice(0, 200) }); }
});
server.listen(PORT, "127.0.0.1", () => {
  console.log(`[nibbi] http://127.0.0.1:${PORT}  →  brain ${GATEWAY.origin}`);
  if (args.open) execFile("open", [`http://127.0.0.1:${PORT}`], () => {});
});

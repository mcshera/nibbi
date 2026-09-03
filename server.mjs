#!/usr/bin/env node
// server.mjs — Nibbi's tiny host. Zero dependencies.
//   • serves ./public (the surface)
//   • proxies /api/* to the Oracle gateway (default http://127.0.0.1:4519), streaming SSE through untouched
//   • /nibbi/health tells the surface whether the brain is reachable
//   • /nibbi/livereload pushes an SSE ping when a file in ./public changes (dev nicety, no build step)
//   • --remote: also listen on the LAN (HTTP :port and HTTPS :port+1 with a generated local CA) behind a token,
//     so the phone can install Nibbi as an app (HTTPS = secure context = microphone works). The gateway stays loopback-only.
// Usage: node server.mjs [--port 4527] [--gateway http://127.0.0.1:4519] [--remote] [--open]
import { createServer, request as httpRequest } from "node:http";
import { createServer as createTlsServer } from "node:https";
import { readFileSync, existsSync, statSync, watch, mkdirSync, writeFileSync } from "node:fs";
import { join, extname, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, execFileSync } from "node:child_process";
import { networkInterfaces, homedir, hostname } from "node:os";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1]?.startsWith("--") || arr[i + 1] === undefined ? true : arr[i + 1]] : []).filter(Boolean));
const PORT = Number(args.port || process.env.NIBBI_PORT || 4527);
const TLS_PORT = PORT + 1;
const GATEWAY = new URL(args.gateway || process.env.ORACLE_GATEWAY || "http://127.0.0.1:4519");
const REMOTE = Boolean(args.remote || process.env.NIBBI_REMOTE);
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "public");
const HOME = join(homedir(), ".oracle");                      // token + TLS material live here, never in the repo or the vault

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".ico": "image/x-icon", ".ogg": "audio/ogg", ".mp3": "audio/mpeg" };

const json = (res, code, body, extra) => { const buf = JSON.stringify(body); res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(buf), ...(extra || {}) }); res.end(buf); };
const html = (res, code, body, extra) => { res.writeHead(code, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...(extra || {}) }); res.end(body); };

/* ---- LAN identity ---- */
function lanIp() { for (const [, addrs] of Object.entries(networkInterfaces())) for (const a of addrs || []) if (a.family === "IPv4" && !a.internal) return a.address; return null; }
const localName = () => { try { return execFileSync("scutil", ["--get", "LocalHostName"], { encoding: "utf8" }).trim().toLowerCase() + ".local"; } catch { return hostname().toLowerCase(); } };

/* ---- token (created on first --remote run) ---- */
const TOKEN_FILE = join(HOME, "nibbi-token");
function token() {
  try { const t = readFileSync(TOKEN_FILE, "utf8").trim(); if (t.length >= 24) return t; } catch { /* make one */ }
  mkdirSync(HOME, { recursive: true }); const t = randomBytes(24).toString("hex"); writeFileSync(TOKEN_FILE, t + "\n", { mode: 0o600 }); return t;
}

/* ---- local CA + server cert (openssl), so the phone can trust https://<lan-ip>:<port+1> ---- */
const TLS_DIR = join(HOME, "nibbi-tls");
function ensureTls() {
  const ca = join(TLS_DIR, "ca.crt"), key = join(TLS_DIR, "server.key"), crt = join(TLS_DIR, "server.crt"), ip = lanIp(), name = localName();
  const sanFile = join(TLS_DIR, "san.txt");
  const wantSan = `DNS:${name},DNS:localhost,IP:127.0.0.1${ip ? ",IP:" + ip : ""}`;
  if (existsSync(ca) && existsSync(key) && existsSync(crt) && existsSync(sanFile) && readFileSync(sanFile, "utf8").trim() === wantSan) return { ca, key, crt };
  mkdirSync(TLS_DIR, { recursive: true });
  const o = (a) => execFileSync("openssl", a, { stdio: ["ignore", "pipe", "pipe"] });
  if (!existsSync(ca)) {
    o(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(TLS_DIR, "ca.key"), "-out", ca, "-days", "3650", "-subj", "/CN=Nibbi Local CA/O=Nibbi", "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign"]);
  }
  o(["req", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", join(TLS_DIR, "server.csr"), "-subj", `/CN=${name}/O=Nibbi`]);
  writeFileSync(join(TLS_DIR, "ext.cnf"), `subjectAltName=${wantSan}\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n`);
  o(["x509", "-req", "-in", join(TLS_DIR, "server.csr"), "-CA", ca, "-CAkey", join(TLS_DIR, "ca.key"), "-CAcreateserial", "-out", crt, "-days", "825", "-sha256", "-extfile", join(TLS_DIR, "ext.cnf")]);
  writeFileSync(sanFile, wantSan + "\n");
  return { ca, key, crt };
}

/* ---- live reload ---- */
const LR = new Set();
let lrTimer = null;
try {
  watch(PUBLIC, { recursive: true }, (_e, f) => {
    if (f && !/\.(js|css|html|png|svg|woff2?|webmanifest)$/i.test(String(f))) return;
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
  delete opts.headers.cookie;
  const up = httpRequest(opts, (r) => {
    const h = { ...r.headers };
    delete h["access-control-allow-origin"];
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
  const ext = extname(abs).toLowerCase();
  res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream", "cache-control": ext === ".woff2" || p.startsWith("/vendor/") ? "max-age=604800" : "no-store", ...(p === "/sw.js" ? { "service-worker-allowed": "/" } : {}) });
  res.end(readFileSync(abs));
}

/* ---- auth: anything not from loopback needs the token (query once → cookie) ---- */
const isLoopback = (req) => { const a = req.socket.remoteAddress || ""; return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1"; };
const cookies = (req) => Object.fromEntries((req.headers.cookie || "").split(";").map((c) => c.trim().split("=")).filter((kv) => kv[0]));
function authed(req, url) {
  if (isLoopback(req)) return true;
  const t = token();
  if (url.searchParams.get("token") === t) return "fresh";
  return cookies(req).nibbi === t;
}

const setupPage = (req) => {
  const ip = lanIp(), name = localName(), t = token();
  const https = `https://${ip}:${TLS_PORT}/`;
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nibbi on your phone</title><link rel="icon" href="/favicon.svg">
<style>body{margin:0;padding:28px 22px;background:#f5f2ec;color:#151413;font:17px/1.5 -apple-system,system-ui,sans-serif}h1{font-size:22px;margin:0 0 6px}p{margin:8px 0}.s{margin:18px 0;padding:14px 16px;border:1px solid rgba(21,20,19,.12);border-radius:16px;background:rgba(255,255,255,.55)}a.b{display:inline-block;margin-top:8px;padding:10px 16px;border-radius:999px;background:#151413;color:#f5f2ec;text-decoration:none;font-weight:600}code{font:14px ui-monospace,Menlo,monospace;background:rgba(21,20,19,.06);padding:2px 6px;border-radius:6px}small{color:#6f6b65}</style>
<h1>Nibbi on your phone</h1><p>Three steps, once. After that it's an app on your home screen.</p>
<div class="s"><b>1 · Trust this Mac</b><p>Download the local certificate, then open <b>Settings → Profile Downloaded → Install</b>. Then <b>Settings → General → About → Certificate Trust Settings</b> and switch on <i>Nibbi Local CA</i>.</p><a class="b" href="/nibbi/ca.crt">Download certificate</a><br><small>This only lets your phone trust <code>${name}</code>. Nothing leaves your Wi-Fi.</small></div>
<div class="s"><b>2 · Open Nibbi securely</b><p>Open <a href="${https}?token=${t}">${https}</a> in Safari (this link carries your pairing token).</p><a class="b" href="${https}?token=${t}">Open Nibbi (https)</a></div>
<div class="s"><b>3 · Add to Home Screen</b><p>In Safari tap <b>Share → Add to Home Screen</b>. Nibbi opens full-screen with the mic and voice working.</p></div>
<p><small>If step 1 is too fussy: <a href="/?token=${t}">open the plain http version</a> — everything works except the microphone.</small></p>`;
};

async function handle(req, res) {
  try {
    const url = new URL(req.url || "/", "http://x");
    const a = authed(req, url);
    if (!a) { if (url.pathname === "/nibbi/ca.crt") { serveCa(res); return; } json(res, 401, { error: "nibbi: pairing token required — open /phone on the desk app" }); return; }
    if (a === "fresh") { // first visit with ?token → cookie, then a clean URL
      const clean = url.pathname + (url.search.replace(/([?&])token=[^&]*&?/, "$1").replace(/[?&]$/, ""));
      res.writeHead(302, { location: clean || "/", "set-cookie": `nibbi=${token()}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly${req.socket.encrypted ? "; Secure" : ""}` }); res.end(); return;
    }
    if (url.pathname === "/nibbi/health") { const p = await probeGateway(); json(res, 200, { ok: true, port: PORT, gateway: GATEWAY.origin, brain: p.ok, status: p.ok ? p.status : null, remote: REMOTE }); return; }
    if (url.pathname === "/nibbi/livereload") { res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" }); res.write(": nibbi live\n\n"); LR.add(res); req.on("close", () => LR.delete(res)); return; }
    if (url.pathname === "/nibbi/remote") { // pairing info — loopback only (the desk app renders the QR)
      if (!isLoopback(req)) { json(res, 403, { error: "loopback only" }); return; }
      const ip = lanIp(), name = localName();
      json(res, 200, { remote: REMOTE, ip, name, token: REMOTE ? token() : null, http: ip ? `http://${ip}:${PORT}/` : null, https: ip && tlsOk ? `https://${ip}:${TLS_PORT}/` : null, setup: ip ? `http://${ip}:${PORT}/nibbi/setup?token=${REMOTE ? token() : ""}` : null, tls: tlsOk }); return;
    }
    if (url.pathname === "/nibbi/setup") { html(res, 200, setupPage(req)); return; }
    if (url.pathname === "/nibbi/run" && req.method === "POST") { await runScript(req, res); return; }
    if (url.pathname === "/nibbi/ca.crt") { serveCa(res); return; }
    if (url.pathname.startsWith("/api/")) { proxy(req, res); return; }
    if (req.method !== "GET" && req.method !== "HEAD") { json(res, 405, { error: "method" }); return; }
    serveStatic(req, res);
  } catch (e) { if (!res.headersSent) json(res, 500, { error: String(e.message || e).slice(0, 200) }); }
}
/* run a project's OWN npm script (deploy/build/test) with a live log — the project defines what "deploy" means */
const RUNNABLE = new Set(["deploy", "build", "test"]);
async function runScript(req, res) {
  let body = ""; for await (const c of req) body += c;
  let p = {}; try { p = JSON.parse(body || "{}"); } catch { /* empty */ }
  const project = String(p.project || ""), script = String(p.script || "deploy");
  if (!RUNNABLE.has(script)) { json(res, 400, { error: "only deploy/build/test" }); return; }
  let repo = null; try { repo = JSON.parse(readFileSync(join(HOME, "games.json"), "utf8"))[project]?.repo || null; } catch { /* none */ }
  if (!repo || !existsSync(repo)) { json(res, 404, { error: `unknown project '${project}'` }); return; }
  let scripts = {}; try { scripts = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).scripts || {}; } catch { /* no package.json */ }
  if (!scripts[script]) { json(res, 409, { error: `no "${script}" script in ${join(repo, "package.json")}`, scripts: Object.keys(scripts) }); return; }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
  const send = (ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  send("start", { cmd: scripts[script], cwd: repo });
  const child = spawn("npm", ["run", script], { cwd: repo, env: { ...process.env, CI: "true", FORCE_COLOR: "0" }, stdio: ["ignore", "pipe", "pipe"] });
  const onData = (buf) => { for (const line of String(buf).split(/\r?\n/)) if (line.trim()) send("line", { t: line.slice(0, 400) }); };
  child.stdout.on("data", onData); child.stderr.on("data", onData);
  const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } send("line", { t: "(timed out after 15 minutes)" }); }, 15 * 60_000);
  child.on("close", (code) => { clearTimeout(timer); send("done", { code }); res.end(); });
  req.on("close", () => { clearTimeout(timer); try { child.kill(); } catch { /* gone */ } });
}
function serveCa(res) { try { const buf = readFileSync(join(TLS_DIR, "ca.crt")); res.writeHead(200, { "content-type": "application/x-x509-ca-cert", "content-disposition": "attachment; filename=\"nibbi-local-ca.crt\"" }); res.end(buf); } catch { json(res, 404, { error: "no certificate yet — start the host with --remote" }); } }

let tlsOk = false;
const server = createServer((req, res) => { void handle(req, res); });
server.listen(PORT, REMOTE ? "0.0.0.0" : "127.0.0.1", () => {
  console.log(`[nibbi] http://127.0.0.1:${PORT}  →  brain ${GATEWAY.origin}${REMOTE ? `  · LAN http://${lanIp()}:${PORT} (token)` : ""}`);
  if (args.open) execFile("open", [`http://127.0.0.1:${PORT}`], () => {});
});
if (REMOTE) {
  try {
    const t = ensureTls();
    const tls = createTlsServer({ key: readFileSync(t.key), cert: readFileSync(t.crt) }, (req, res) => { void handle(req, res); });
    tls.listen(TLS_PORT, "0.0.0.0", () => { tlsOk = true; console.log(`[nibbi] https://${lanIp()}:${TLS_PORT}  (local CA: ${t.ca})`); });
  } catch (e) { console.warn("[nibbi] https unavailable:", e.message); }
}

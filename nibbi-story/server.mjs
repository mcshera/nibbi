#!/usr/bin/env node
import { createServer, request as httpRequest } from "node:http";
import { readFileSync, existsSync, statSync, watch } from "node:fs";
import { join, extname, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";

const args = Object.fromEntries(process.argv.slice(2).map((arg, index, all) => {
  if (!arg.startsWith("--")) return null;
  const next = all[index + 1];
  return [arg.slice(2), next && !next.startsWith("--") ? next : true];
}).filter(Boolean));

const PORT = Number(args.port || process.env.NIBBI_STORY_PORT || 4537);
const GATEWAY = new URL(args.gateway || process.env.ORACLE_GATEWAY || "http://127.0.0.1:4519");
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "public");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".json": "application/json"
};

const sendJson = (res, status, value) => {
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
};

let gatewayState = { checkedAt: 0, online: false, status: null };
function probeGateway() {
  return new Promise((resolve) => {
    if (Date.now() - gatewayState.checkedAt < 2000) return resolve(gatewayState);
    const upstream = httpRequest({ host: GATEWAY.hostname, port: GATEWAY.port, path: "/api/status", method: "GET", timeout: 1400 }, (response) => {
      let body = "";
      response.on("data", (chunk) => (body += chunk));
      response.on("end", () => {
        let status = null;
        try { status = JSON.parse(body); } catch { /* status is optional */ }
        gatewayState = { checkedAt: Date.now(), online: response.statusCode === 200, status };
        resolve(gatewayState);
      });
    });
    upstream.on("error", () => {
      gatewayState = { checkedAt: Date.now(), online: false, status: null };
      resolve(gatewayState);
    });
    upstream.on("timeout", () => upstream.destroy());
    upstream.end();
  });
}

function proxy(req, res) {
  const upstream = httpRequest({
    host: GATEWAY.hostname,
    port: GATEWAY.port,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: GATEWAY.host }
  }, (response) => {
    const headers = { ...response.headers };
    delete headers["access-control-allow-origin"];
    res.writeHead(response.statusCode || 502, headers);
    response.pipe(res);
  });
  upstream.on("error", (error) => {
    if (!res.headersSent) sendJson(res, 502, { error: "Codex gateway offline", detail: error.code || error.message });
    else res.end();
  });
  req.on("aborted", () => upstream.destroy());
  req.pipe(upstream);
}

function serveFile(req, res) {
  let pathname = decodeURIComponent(new URL(req.url, "http://nibbi.local").pathname);
  if (pathname === "/") pathname = "/index.html";
  const file = normalize(join(PUBLIC, pathname));
  if (!file.startsWith(PUBLIC) || !existsSync(file) || !statSync(file).isFile()) {
    sendJson(res, 404, { error: "not found" });
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(file).toLowerCase()] || "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(file));
}

const reloadClients = new Set();
let reloadTimer = null;
try {
  watch(PUBLIC, { recursive: true }, () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      for (const client of reloadClients) {
        try { client.write("data: reload\n\n"); } catch { reloadClients.delete(client); }
      }
    }, 120);
  });
} catch { /* recursive watching is a development convenience */ }

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://nibbi.local");
    if (url.pathname === "/nibbi/health") {
      const gateway = await probeGateway();
      sendJson(res, 200, { ok: true, brain: gateway.online, status: gateway.status, gateway: GATEWAY.origin });
      return;
    }
    if (url.pathname === "/nibbi/livereload") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write(": story awake\n\n");
      reloadClients.add(res);
      req.on("close", () => reloadClients.delete(res));
      return;
    }
    if (url.pathname.startsWith("/api/")) return proxy(req, res);
    if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "method not allowed" });
    serveFile(req, res);
  } catch (error) {
    if (!res.headersSent) sendJson(res, 500, { error: String(error.message || error).slice(0, 240) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[nibbi-story] http://127.0.0.1:${PORT}  →  Codex via ${GATEWAY.origin}`);
  if (args.open) execFile("open", [`http://127.0.0.1:${PORT}`], () => {});
});

// Local, read-only prototype server for the sidebar lab. No app backend, credentials, or API access.
// Serves the lab plus the app's real fonts and stylesheets, so every option renders on the real tokens.
import http from 'node:http';
import { readFile, stat, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.md': 'text/plain; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const allowedPrefixes = ['/design/sidebar-lab/', '/public/fonts/'];
// The real rail CSS and tokens, read-only: "peer" is a true minimal delta only if it renders on them.
const allowedFiles = ['/public/styles.css', '/public/margins.css', '/public/project-workspace.css'];
export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
      const url = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (url === '/') { res.writeHead(302, { location: '/design/sidebar-lab/' }); res.end(); return; }
      if (url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      if (!(allowedPrefixes.some(p => url.startsWith(p)) || allowedFiles.includes(url))) { res.writeHead(404); res.end('Not found'); return; }
      let file = path.resolve(root, '.' + url);
      const bases = allowedPrefixes.map(p => path.join(root, p.replace(/^\/|\/$/g, '')) + path.sep);
      const safe = p => bases.some(b => p.startsWith(b)) || allowedFiles.some(f => p === path.join(root, f));
      if (!safe(file + (url.endsWith('/') ? path.sep : ''))) { res.writeHead(403); res.end(); return; }
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
      file = await realpath(file);
      if (!safe(file)) { res.writeHead(403); res.end(); return; }
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': String(data.length) });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
}
export function listen(port = Number(process.env.NIBBI_SIDEBAR_LAB_PORT || 4540)) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port, url: `http://127.0.0.1:${server.address().port}/design/sidebar-lab/` }));
  });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  listen().then(({ url }) => console.log(`Nibbi sidebar lab: ${url}`)).catch(error => { console.error(error.message); process.exitCode = 1; });
}

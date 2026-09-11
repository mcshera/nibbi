// Local, read-only prototype server for the character lab. No app backend, credentials, or API access.
import http from 'node:http';
import { readFile, stat, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.md': 'text/plain; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webm': 'video/webm' };
const allowedPrefixes = ['/design/character-lab/', '/design/motion-lab/', '/public/fonts/'];
const allowedFiles = ['/public/nibbi.js'];
export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
      let url = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (url === '/') { res.writeHead(302, { location: '/design/character-lab/' }); res.end(); return; }
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
export function listen(port = Number(process.env.NIBBI_CHARACTER_PORT || 4538)) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port, url: `http://127.0.0.1:${server.address().port}/design/character-lab/` }));
  });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  listen().then(({ url }) => console.log(`Nibbi character lab: ${url}`)).catch(error => { console.error(error.message); process.exitCode = 1; });
}

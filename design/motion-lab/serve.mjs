// Local, read-only prototype server. No app backend, credentials, or API access.
import http from 'node:http';
import { readFile, stat, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
const port = Number(process.env.NIBBI_MOTION_PORT || 4536);
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css', '.js':'text/javascript', '.mjs':'text/javascript', '.md':'text/plain; charset=utf-8', '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.webm':'video/webm' };
const server = http.createServer(async (req,res) => {
  try {
    if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    let url = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (url === '/') { res.writeHead(302, {location:'/design/motion-lab/'}); res.end(); return; }
    // Only the lab plus the original renderer/fonts are exposed, not the repo or local daemon.
    if (!(url.startsWith('/design/motion-lab/') || url.startsWith('/public/fonts/') || url === '/public/nibbi.js')) { res.writeHead(404); res.end('Not found'); return; }
    let file = path.resolve(root, '.' + url);
    const allowed = [path.join(root, 'design/motion-lab') + path.sep, path.join(root,'public/fonts') + path.sep];
    const safe = p => allowed.some(base => p.startsWith(base)) || p === path.join(root, 'public/nibbi.js');
    if (!safe(file + (url.endsWith('/') ? path.sep : ''))) { res.writeHead(403); res.end(); return; }
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    file = await realpath(file);
    if (!safe(file)) { res.writeHead(403); res.end(); return; }
    const data = await readFile(file);
    const headers = {'Content-Type':types[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Accept-Ranges':'bytes'};
    // Media browsers need byte ranges and a length to seek a local WebM reliably.
    let start=0, end=data.length-1, status=200;
    if (req.headers.range) {
      const range=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!range || (!range[1] && !range[2])) { res.writeHead(416,{'Content-Range':`bytes */${data.length}`});res.end();return; }
      if (range[1]) { start=Number(range[1]);end=range[2]?Math.min(end,Number(range[2])):end; }
      else start=Math.max(0,data.length-Number(range[2]));
      if (start> end || start>=data.length) {res.writeHead(416,{'Content-Range':`bytes */${data.length}`});res.end();return;}
      status=206;headers['Content-Range']=`bytes ${start}-${end}/${data.length}`;
    }
    headers['Content-Length']=String(Math.max(0,end-start+1));
    res.writeHead(status,headers);res.end(req.method==='HEAD'?undefined:data.subarray(start,end+1));
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(port,'127.0.0.1',() => console.log(`Nibbi motion lab: http://127.0.0.1:${port}/design/motion-lab/`));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });

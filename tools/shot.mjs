// tools/shot.mjs — headless screenshot + DOM probe for the Nibbi surface.
// usage: node tools/shot.mjs <url> <out.png> [--w 1440 --h 1000 --wait 1500 --demo "message" --probe]
import { chromium } from '/Users/Matty/Documents/Board Game Test/node_modules/playwright-core/index.mjs';
const argv = process.argv.slice(2);
const url = argv[0], out = argv[1];
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const W = +opt('w', 1440), H = +opt('h', 1000), DPR = +opt('dpr', 2), GL = opt('gl', 'swiftshader'), wait = +opt('wait', 1500), say = opt('demo', null), probe = argv.includes('--probe'), steps = opt('steps', null);
let b;
try {
  b = await chromium.launch({ channel: 'chrome', args: GL === 'metal' ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--autoplay-policy=no-user-gesture-required'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const pg = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
  const errs = []; pg.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 300))); pg.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 300)); });
  await pg.goto(url, { waitUntil: 'load' });
  await pg.waitForTimeout(wait);
  if (say) { await pg.evaluate((s) => { void window.nibbiApp.send(s); }, say); }
  if (steps) { for (const st of steps.split(';')) { const [ms, code] = st.split('@'); await pg.waitForTimeout(+ms); if (code) await pg.evaluate(code); } }
  const shots = (opt('at', '') || '').split(',').filter(Boolean).map(Number);
  if (shots.length) { let t = 0; for (let i = 0; i < shots.length; i++) { await pg.waitForTimeout(shots[i] - t); t = shots[i]; await pg.screenshot({ path: out.replace(/\.png$/, '-' + i + '.png') }); } }
  else await pg.screenshot({ path: out });
  const info = await pg.evaluate(() => {
    const n = window.nibbi ? window.nibbi.state() : null; const S = window.nibbiApp ? window.nibbiApp.state() : null;
    const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
    return { nibbi: n, mode: document.body.dataset.mode, link: document.body.dataset.link, busy: S && S.busy, turns: S && S.turns.length, pill: r('#pill'), feed: r('#feed'), firstTurn: r('.turn'), said: (document.querySelector('.said') || {}).textContent, steps: [...document.querySelectorAll('.step')].map((e) => e.className.replace('step', '').trim() + ' ' + e.textContent.trim()), chips: [...document.querySelectorAll('.chip')].map((c) => c.textContent) };
  });
  console.log(JSON.stringify({ ok: true, errors: errs, ...(probe ? info : { mode: info.mode, link: info.link, fps: info.nibbi && info.nibbi.fps, gl: info.nibbi && info.nibbi.gl }) }, null, 0));
} catch (e) { console.log('ERR ' + e.message.slice(0, 400)); }
finally { if (b) await b.close(); }

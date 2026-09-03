/* app.js — Nibbi: the surface. One character, one pill, and UI that only shows up when it's needed. */
(() => {
'use strict';
const $ = (s, el) => (el || document).querySelector(s);
const NAME = 'nibbi';
const Q = new URLSearchParams(location.search);
const LS = { get: (k, d) => { try { const v = localStorage.getItem('nibbi.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('nibbi.' + k, JSON.stringify(v)); } catch { /* private mode */ } } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

/* ------------------------------------------------------------------ dom */
const body = document.body, feed = $('#feed'), pill = $('#pill'), ask = $('#ask'), sendBtn = $('#send'), micBtn = $('#mic'), chipsEl = $('#chips'), status = $('#status'), attachEl = $('#attach'), listenEl = $('#listen');
const fxCv = $('#fx');
const nibbi = createNibbi({ ink: $('#ink'), fx: fxCv });
body.style.backgroundImage = 'url(' + nibbi.paperDataURL() + ')';

/* ------------------------------------------------------------------ state */
const S = {
  mode: 'idle',            // idle | talk
  link: 'booting',         // live | busy | demo | offline | booting
  demo: Q.get('demo') === '1',
  busy: false,
  turns: [],
  status: null,            // last /api/status
  fixers: [],              // last /api/fixers
  voiceOn: LS.get('voice', true),
  lastActivity: performance.now(),
  restTimer: 0, sleepTimer: 0, chipTimer: 0,
  abort: null,
};
if (S.voiceOn) body.classList.add('voice-on');

/* ------------------------------------------------------------------ layout: where nibbi sits */
function idleRadius() { return Math.max(56, Math.min(150, Math.min(innerWidth, innerHeight) * 0.16)); }
function layout(snap) {
  const W = innerWidth, H = innerHeight, r0 = idleRadius();
  const pillTop = pill.getBoundingClientRect().top || (H - 124);
  let pose;
  if (S.mode === 'talk') {
    const r = Math.max(48, r0 * 0.66);
    const cy = Math.max(74, Math.min(H * 0.22, 56 + r * 1.1));
    pose = { x: W / 2, y: cy, r };
    document.documentElement.style.setProperty('--feed-top', Math.round(cy + r * 1.3 + 22) + 'px');
  } else {
    const focused = document.activeElement === ask && !S.busy;
    pose = { x: W / 2, y: H * (focused ? 0.47 : 0.49) - (H < 600 ? 20 : 0), r: r0 };
  }
  const hasAgents = body.classList.contains('has-agents');
  document.documentElement.style.setProperty('--agents-bottom', Math.round(H - pillTop - 3) + 'px');   // perched on the pill's top edge
  document.documentElement.style.setProperty('--feed-bottom', Math.round(H - pillTop + 18 + (hasAgents ? 52 : 0)) + 'px');
  if (snap) nibbi.snapTarget(pose); else nibbi.setTarget(pose);
}
addEventListener('resize', () => layout(false));
layout(true);

function setMode(m) {
  if (S.mode === m) return;
  S.mode = m; body.dataset.mode = m; layout(false);
}

/* ------------------------------------------------------------------ pointer → nibbi */
addEventListener('pointermove', (e) => { nibbi.pointer(e.clientX, e.clientY); fxCv.classList.toggle('grab', nibbi.hitTest(e.clientX, e.clientY)); activity(); }, { passive: true });
fxCv.addEventListener('click', (e) => { if (nibbi.hitTest(e.clientX, e.clientY)) { nibbi.hop(); if (!S.busy) nibbi.setMood('happy'), setTimeout(() => !S.busy && nibbi.setMood(S.mode === 'talk' ? 'idle' : 'idle'), 1300); } });
fxCv.addEventListener('dblclick', (e) => { if (nibbi.hitTest(e.clientX, e.clientY) && !S.busy) tidy(); });

/* ------------------------------------------------------------------ activity / rest / sleep */
function activity() {
  S.lastActivity = performance.now();
  if (body.classList.contains('rest')) body.classList.remove('rest');
  if (!S.busy && nibbi.mood() === 'sleep') nibbi.setMood('idle');
  scheduleIdleTimers();
}
function scheduleIdleTimers() {
  clearTimeout(S.restTimer); clearTimeout(S.sleepTimer);
  S.restTimer = setTimeout(() => { if (!S.busy && S.mode === 'talk' && document.activeElement !== ask) body.classList.add('rest'); }, 40000);
  S.sleepTimer = setTimeout(() => { if (!S.busy && !listening) nibbi.setMood('sleep'); }, 180000);
}
addEventListener('keydown', activity, { passive: true });
scheduleIdleTimers();

/* ------------------------------------------------------------------ markdown */
function renderMd(src) {
  let html = '';
  // raw HTML from the brain is shown, not run — but leave code spans/fences alone (marked escapes those itself); lone ~ (as in ~$4.75) is not strikethrough
  const safe = String(src || '').split(/(```[\s\S]*?```|`[^`\n]*`)/g).map((seg, i) => i % 2 ? seg : seg.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/(^|[^~\\])~(?!~)/g, '$1\\~')).join('');
  try { html = marked.parse(safe, { gfm: true, breaks: true }); } catch { html = escapeHtml(src); }
  const tpl = document.createElement('template'); tpl.innerHTML = html;
  for (const el of tpl.content.querySelectorAll('script,style,iframe,object,embed,link,meta')) el.remove();
  for (const el of tpl.content.querySelectorAll('*')) {
    for (const a of [...el.attributes]) { if (/^on/i.test(a.name) || (/^(href|src)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name); }
    if (el.tagName === 'A') { el.target = '_blank'; el.rel = 'noopener'; }
    if (el.tagName === 'IMG' && /^\//.test(el.getAttribute('src') || '')) el.src = '/api/file?p=' + encodeURIComponent(el.getAttribute('src'));
  }
  for (const pre of tpl.content.querySelectorAll('pre')) { const b = document.createElement('button'); b.type = 'button'; b.className = 'copycode'; b.textContent = 'copy'; b.onclick = () => { navigator.clipboard?.writeText(pre.textContent.replace(/copy$/, '')); toast('copied'); }; pre.appendChild(b); }
  return tpl.content;
}
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const firstSentences = (s, n, max) => { const parts = String(s).match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [s]; let out = ''; for (const p of parts) { if (out && (out + p).length > max) break; out += p; if (--n <= 0) break; } return out.trim().slice(0, max); };
const stripMd = (s) => String(s || '').replace(/```[\s\S]*?```/g, ' code ').replace(/`([^`]*)`/g, '$1').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^[#>*\-\s]+/gm, '').replace(/[*_~]+/g, '').replace(/\s+/g, ' ').trim();

/* ------------------------------------------------------------------ feed */
const TOOL_LABEL = { Read: 'reading', Write: 'writing', Edit: 'editing', MultiEdit: 'editing', NotebookEdit: 'editing', Grep: 'searching', Glob: 'searching files', LS: 'looking around', Bash: 'running a command', WebFetch: 'browsing', WebSearch: 'searching the web', Task: 'delegating', TodoWrite: 'planning', AskUserQuestion: 'asking' };
const toolLabel = (n) => n.startsWith('mcp__github') ? 'on github' : n.startsWith('mcp__') ? 'using ' + n.split('__')[1] : (TOOL_LABEL[n] || n.toLowerCase());

function newTurn(text, images) {
  const turn = document.createElement('article'); turn.className = 'turn';
  const you = document.createElement('div'); you.className = 'you';
  if (text === null) turn.classList.add('event');
  if (images && images.length) { const w = document.createElement('div'); w.className = 'imgs'; for (const im of images) { const i = document.createElement('img'); i.src = 'data:' + im.media_type + ';base64,' + im.data; w.appendChild(i); } you.appendChild(w); }
  you.appendChild(document.createTextNode(text || ''));
  const nib = document.createElement('div'); nib.className = 'nib';
  const ava = document.createElement('canvas'); ava.className = 'ava'; ava.setAttribute('aria-hidden', 'true'); nibbi.addMirror(ava);
  const nibBody = document.createElement('div'); nibBody.className = 'nibbody';
  const steps = document.createElement('div'); steps.className = 'steps'; steps.hidden = true;
  const fold = document.createElement('button'); fold.type = 'button'; fold.className = 'fold'; fold.innerHTML = '<span class="b"></span><span class="l"></span>'; fold.onclick = () => steps.classList.remove('folded'); steps.appendChild(fold);
  for (const P of S.turns) { const a = P.nib.querySelector('.acts'); if (a) a.remove(); }
  turn.setAttribute('aria-busy', 'true');
  const said = document.createElement('div'); said.className = 'said';
  const meta = document.createElement('div'); meta.className = 'meta';
  const bubble = document.createElement('div'); bubble.className = 'bubble live';
  bubble.append(steps, said);
  nibBody.append(bubble, meta);
  nib.append(ava, nibBody);
  if (text !== null) turn.append(you); turn.append(nib);
  feed.prepend(turn); feed.scrollTop = 0;
  const T = { el: turn, nib, body: nibBody, ava, bubble, steps, said, meta, fold, text, startedAt: performance.now(), stepsList: [], liveStep: null, acc: '', done: false };
  S.turns.push(T);
  return T;
}
function addStep(T, label, kind) {
  const last = T.liveStep;
  if (last && last.label === label && !last.fixed) { last.n++; last.el.querySelector('.n').textContent = '×' + last.n; return last; }
  if (last) markStep(last, 'done');
  const el = document.createElement('div'); el.className = 'step live' + (kind ? ' ' + kind : '');
  el.innerHTML = '<span class="b"></span><span class="l"></span><span class="n"></span><span class="t"></span>';
  el.querySelector('.l').textContent = label;
  T.steps.hidden = false; T.steps.insertBefore(el, T.fold);
  const st = { el, label, n: 1, at: performance.now(), fixed: kind === 'fixer' };
  T.stepsList.push(st); T.liveStep = st;
  return st;
}
function markStep(st, state) { st.el.classList.remove('live'); st.el.classList.add(state); const dt = (performance.now() - st.at) / 1000; if (dt > 1.5) st.el.querySelector('.t').textContent = dt < 60 ? dt.toFixed(0) + 's' : (dt / 60).toFixed(1) + 'm'; }
function finishSteps(T, ok) {
  if (T.liveStep) { markStep(T.liveStep, ok ? 'done' : 'fail'); T.liveStep = null; }
  if (!T.stepsList.length) return;
  const secs = Math.round((performance.now() - T.startedAt) / 1000);
  const n = T.stepsList.reduce((a, s) => a + s.n, 0);
  T.fold.querySelector('.l').innerHTML = escapeHtml((ok ? '' : 'stopped after ') + n + ' step' + (n === 1 ? '' : 's') + ' · ' + (secs < 60 ? secs + 's' : (secs / 60).toFixed(1) + 'm')) + ' — <u>show</u>';
  T.steps.classList.add('folded');
}
function setSaid(T, text, live) {
  T.acc = text;
  const clean = text.replace(/»voice:\s*(?:(?!»voice:)[^\n])*\n?/g, '');
  if (T.plain) { T.said.textContent = clean; T.said.classList.add('plain'); return; }
  if (live) { if (!T.raf) T.raf = requestAnimationFrame(() => { T.raf = 0; T.said.replaceChildren(renderMd(T.acc.replace(/»voice:\s*(?:(?!»voice:)[^\n])*\n?/g, ''))); }); }
  else { if (T.raf) { cancelAnimationFrame(T.raf); T.raf = 0; } T.said.replaceChildren(renderMd(clean)); }
}
function setMeta(T, r) {
  const bits = [];
  bits.push(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
  if (r && r.costUsd) bits.push('$' + r.costUsd.toFixed(3));
  if (r && r.local) bits.push('local model');
  if (r && r.raw) bits.push(String(r.raw).replace(/^\s*error:\s*/i, '').slice(0, 90));
  T.meta.textContent = bits.join(' · ');
  const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'copy'; copy.onclick = () => { navigator.clipboard?.writeText(T.acc); toast('copied'); };
  const again = document.createElement('button'); again.type = 'button'; again.textContent = 'ask again'; again.onclick = () => send(T.text);
  T.meta.append(document.createTextNode(' · '), copy, document.createTextNode(' · '), again);
}
function addActs(T, acts) {
  if (!acts.length) return;
  const w = document.createElement('div'); w.className = 'acts';
  for (const a of acts) {
    const c = document.createElement('button'); c.type = 'button'; c.className = 'chip in' + (a.warn ? ' warn' : ''); c.textContent = a.label;
    if (a.confirm) { let armed = 0; c.onclick = () => { if (!armed) { armed = setTimeout(() => { armed = 0; c.textContent = a.label; c.classList.remove('armed'); }, 4000); c.textContent = a.confirm; c.classList.add('armed'); return; } clearTimeout(armed); armed = 0; a.run(); }; }
    else c.onclick = () => a.run();
    w.appendChild(c);
  }
  T.body.appendChild(w);
}

let tidied = null;
function tidy() {
  if (S.busy || !S.turns.length) return;
  const saved = { turns: S.turns, nodes: [...feed.children] };
  for (const T of S.turns) T.el.classList.add('leave');
  setTimeout(() => { if (tidied === saved) feed.replaceChildren(); }, 240);
  S.turns = []; tidied = saved;
  setMode('idle'); body.classList.remove('rest'); nibbi.lookFree(); nibbi.setMood('idle'); nibbi.hop(); hideChips();
  toast('table tidied', 6000, { label: 'undo', run: () => { if (tidied !== saved) return; tidied = null; S.turns = saved.turns; for (const n of saved.nodes) { n.classList.remove('leave'); feed.appendChild(n); } setMode('talk'); } });
}

/* ------------------------------------------------------------------ toast */
let toastT = 0;
function toast(msg, ms, act) { const t = $('#toast'); t.textContent = msg; if (act) { const b = document.createElement('button'); b.type = 'button'; b.textContent = act.label; b.onclick = () => { act.run(); t.hidden = true; }; t.append(' ', b); } t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms || 1800); }

/* ------------------------------------------------------------------ brain client */
async function* sseTurn(message, images, signal) {
  const res = await fetch('/api/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, stream: true, images }), signal });
  if (!res.ok) { let err = 'HTTP ' + res.status; try { err = (await res.json()).error || err; } catch { /* plain */ } throw new Error(err); }
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      let ev = 'message', data = '';
      for (const line of chunk.split('\n')) { if (line.startsWith('event:')) ev = line.slice(6).trim(); else if (line.startsWith('data:')) data += line.slice(5).trim(); }
      if (!data) continue;
      let d = null; try { d = JSON.parse(data); } catch { continue; }
      yield { ev, ...d };
    }
  }
}

/* a scripted brain so the choreography can be seen without the gateway */
async function* demoTurn(message, _images, signal) {
  const m = message.toLowerCase();
  const wait = async (ms) => { await sleep(ms); if (signal.aborted) throw new DOMException('aborted', 'AbortError'); };
  const words = (s) => s.match(/\S+\s*/g) || [];
  async function* say(text) { for (const w of words(text)) { await wait(28 + Math.random() * 60); yield { ev: 'delta', t: w }; } }
  await wait(700);
  if (/\berror\b|\bbreak\b/.test(m)) { yield { ev: 'tool', name: 'Bash' }; await wait(900); yield { ev: 'done', text: 'error: Failed to authenticate: OAuth session expired and could not be refreshed', isError: true, costUsd: 0 }; return; }
  if (/fix|bug|build|make|add|change|ship/.test(m)) {
    yield { ev: 'tool', name: 'Read' }; await wait(650); yield { ev: 'tool', name: 'Read' }; await wait(500); yield { ev: 'tool', name: 'Grep' }; await wait(800);
    yield* say('Found it. '); yield { ev: 'tool', name: 'Edit' }; await wait(900); yield { ev: 'tool', name: 'Bash' }; await wait(1400);
    yield* say('Two files touched, tests still green.\n\n');
    yield* say('- `session.ts` — the turn lock now clears on abort\n- `webapp.ts` — the stream sends a `done` even when the model bails\n\n');
    yield* say('Want me to stage it as a fix so you can review the diff, or ship it straight to `main`?');
    yield { ev: 'done', text: 'Found it. Two files touched, tests still green.\n\n- `session.ts` — the turn lock now clears on abort\n- `webapp.ts` — the stream sends a `done` even when the model bails\n\nWant me to stage it as a fix so you can review the diff, or ship it straight to `main`?', costUsd: 0.021, isError: false, voice: 'Found it. Two files touched, tests still green. Stage it, or ship it?' };
    return;
  }
  if (/hello|hi\b|hey|who are you|what can you/.test(m)) {
    yield* say('Hi. I\'m ' + NAME + ' — Oracle\'s face on the table. Ask me to build, fix, plan or remember something and I\'ll show my work right here while I do it.');
    yield { ev: 'done', text: 'Hi. I\'m ' + NAME + ' — Oracle\'s face on the table. Ask me to build, fix, plan or remember something and I\'ll show my work right here while I do it.', costUsd: 0, isError: false }; return;
  }
  yield { ev: 'tool', name: 'Read' }; await wait(900); yield { ev: 'tool', name: 'Grep' }; await wait(700);
  const t = 'Here\'s what I know (demo brain — the real Oracle gateway isn\'t reachable right now).\n\nYou asked: *' + message.replace(/\*/g, '') + '*\n\nWhen the gateway is up I answer from the vault and the live repos, and every tool I touch shows up above this line as I work.';
  yield* say(t); yield { ev: 'done', text: t, costUsd: 0, isError: false };
}

async function* offlineTurn() { await sleep(600); yield { ev: 'done', text: 'gateway offline', isError: true, offline: true }; }

/* ------------------------------------------------------------------ client-side commands: the build loop lives here */
const api = {
  get: (p) => fetch(p).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; }),
  post: (p, body) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; }),
};
const md = { esc: (s) => String(s).replace(/([*_`\[\]<>])/g, '\\$1') };
const projectNames = () => (S.projects || []).map((p) => p.name);
const activeProject = () => (S.project && (!S.projects || projectNames().includes(S.project)) ? S.project : projectNames()[0]) || 'shipless';
const bar = (done, total) => { const n = 12, f = total ? Math.round(n * done / total) : 0; return '`' + '█'.repeat(f) + '░'.repeat(n - f) + '`'; };

/* a turn that nibbi answers itself (no model call): fn(T) → { text, acts?, ok?, plain?, html? } */
async function localTurn(userText, fn, opts) {
  if (S.busy) { toast(NAME + ' is still working — one thing at a time'); return; }
  S.busy = true; body.classList.add('busy'); activity(); hideChips(); if (!(opts && opts.keepInput)) { ask.value = ''; autosize(); } setMode('talk');
  const T = newTurn(userText === undefined ? null : userText); T.plain = false;
  nibbi.setMood('working'); const fr = feed.getBoundingClientRect(); nibbi.lookAt(innerWidth / 2 + 40, fr.top + 30);
  let out;
  try { out = await fn(T); } catch (e) { out = { ok: false, text: humanError(e.message || String(e)) }; }
  out = out || { text: '' }; const ok = out.ok !== false;
  finishSteps(T, ok);
  if (out.html) { T.said.replaceChildren(out.html); T.acc = out.text || ''; } else setSaid(T, out.text || '', false);
  setMeta(T, {}); T.done = true; T.el.removeAttribute('aria-busy'); T.bubble.classList.remove('live');
  if (!ok) T.nib.classList.add('error');
  if (out.acts && out.acts.length) addActs(T, out.acts);
  S.busy = false; body.classList.remove('busy'); nibbi.lookFree(); nibbi.setMood(ok ? 'happy' : 'error'); setTimeout(() => { if (!S.busy) nibbi.setMood('idle'); }, ok ? 1400 : 2600);
  $('#sr').textContent = stripMd(out.text || ''); scheduleIdleTimers(); refreshStatus();
  return T;
}

/* ---- fixer helpers ---- */
const fixerById = (id) => (S.fixers || []).find((f) => f.id === id);
const fixerTitle = (f) => f.title || (f.issue || '').slice(0, 60) || f.id;
function fixerActs(f, opts) {
  const a = []; const st = f.status;
  if (st === 'done') a.push({ label: 'diff', run: () => send('/diff ' + f.id) }, { label: 'preview', run: () => send('/preview ' + f.id) }, { label: 'approve & merge', confirm: 'merge into ' + (opts && opts.target || 'the branch') + ' — sure?', warn: true, run: () => send('/approve ' + f.id) });
  if (st === 'running' || st === 'installing') a.push({ label: 'steer', run: () => { ask.value = '/steer ' + f.id + ' '; ask.focus(); autosize(); } }, { label: 'stop', confirm: 'stop it — sure?', warn: true, run: () => send('/stop ' + f.id) });
  if (st === 'queued') a.push({ label: 'unqueue', confirm: 'drop it from the queue?', run: () => api.post('/api/fix-unqueue', { id: f.id }).then(() => toast('unqueued')).catch((e) => toast(e.message)) });
  if (st === 'failed') a.push({ label: 'log', run: () => send('/log ' + f.id) }, { label: 'requeue', run: () => api.post('/api/fix-requeue', { id: f.id }).then(() => toast('requeued')).catch((e) => toast(e.message)) });
  if (st === 'merged') a.push({ label: 'what changed', run: () => send('/diff ' + f.id) });
  a.push({ label: 'ask nibbi', run: () => send('how is the fixer "' + fixerTitle(f) + '" (' + f.id + ') doing, and what should I check?') });
  return a.slice(0, 4);
}
function renderPlan(proj, ms, done, total, auto, next) {
  const w = document.createElement('div'); w.className = 'planv';
  const h = document.createElement('div'); h.className = 'ph'; h.innerHTML = '<b>' + escapeHtml(proj) + '</b> <span>' + done + '/' + total + ' tasks</span>';
  const hb = document.createElement('div'); hb.className = 'pbar big'; hb.innerHTML = '<i style="width:' + (total ? Math.round(100 * done / total) : 0) + '%"></i>'; h.appendChild(hb);
  w.appendChild(h);
  for (const m of ms) {
    const row = document.createElement('div'); row.className = 'prow' + (m.done === m.total ? ' done' : '') + (m === next ? ' next' : '');
    row.innerHTML = '<span class="pn">' + escapeHtml(m.name) + '</span><span class="pc">' + m.done + '/' + m.total + (m.done === m.total ? ' ✓' : '') + '</span><div class="pbar"><i style="width:' + (m.total ? Math.round(100 * m.done / m.total) : 0) + '%"></i></div>';
    w.appendChild(row);
  }
  if (auto) { const a = document.createElement('div'); a.className = 'pauto'; a.textContent = 'auto: ' + (auto.on ? auto.mode + ' mode · ' + auto.inflight + ' in flight · ' + auto.pending + ' pending · ' + auto.staged + ' staged · $' + (auto.spend || 0).toFixed(2) + ' spent' : 'off'); w.appendChild(a); }
  return w;
}
function renderDiff(d) {
  const wrap = document.createElement('div'); wrap.className = 'diffv';
  const head = document.createElement('div'); head.className = 'dh';
  head.textContent = (d.game ? d.game + ' · ' : '') + d.branch + ' → ' + d.target;
  const stat = document.createElement('pre'); stat.className = 'dstat'; stat.textContent = (d.diffstat || '').trim() || '(no changes yet)';
  const pre = document.createElement('pre'); pre.className = 'dbody';
  const lines = String(d.diff || '').split('\n'); let file = null;
  for (const ln of lines) {
    const s = document.createElement('span');
    if (ln.startsWith('diff --git')) { file = ln.replace(/^diff --git a\/(\S+).*/, '$1'); s.className = 'df'; s.textContent = '\n' + file + '\n'; }
    else if (/^(index |--- |\+\+\+ )/.test(ln)) continue;
    else if (ln.startsWith('@@')) { s.className = 'dhunk'; s.textContent = ln.replace(/@@.*?@@/, (m) => m) + '\n'; }
    else if (ln.startsWith('+')) { s.className = 'dadd'; s.textContent = ln + '\n'; }
    else if (ln.startsWith('-')) { s.className = 'ddel'; s.textContent = ln + '\n'; }
    else { s.textContent = ln + '\n'; }
    pre.appendChild(s);
  }
  wrap.append(head, stat, pre);
  if (d.truncated) { const n = document.createElement('div'); n.className = 'dnote'; n.textContent = 'diff truncated at 60 KB — the rest is in the worktree'; wrap.appendChild(n); }
  return wrap;
}

/* ---- the commands ---- */
const COMMANDS = [
  { cmd: '/fix', args: '<issue>', desc: 'dispatch a fixer on the active project', local: true },
  { cmd: '/diff', args: '<fixer-id>', desc: 'review a fixer\'s changes inline', local: true },
  { cmd: '/approve', args: '<fixer-id>', desc: 'merge a finished fixer (Oracle runs the gate)', local: false },
  { cmd: '/preview', args: '<fixer-id> [stop]', desc: 'run the fixer\'s branch on a preview server', local: false },
  { cmd: '/steer', args: '<fixer-id> <note>', desc: 'send a running fixer a course correction', local: true },
  { cmd: '/stop', args: '<fixer-id>', desc: 'stop a running fixer', local: true },
  { cmd: '/fixers', args: '', desc: 'list recent fixers', local: false },
  { cmd: '/plan', args: '[project]', desc: 'milestones, progress and what auto is doing', local: true },
  { cmd: '/auto', args: '<project> <off|suggest|stage|ship|pause|resume>', desc: 'steer autonomy for a project', local: true },
  { cmd: '/play', args: '<project> [stop|status]', desc: 'launch the project\'s dev server and open it', local: true },
  { cmd: '/project', args: '[name]', desc: 'show or switch the active project', local: true },
  { cmd: '/new', args: '<name>', desc: 'start a new project (git repo in ~/OracleProjects)', local: true },
  { cmd: '/playtest', args: '[project]', desc: 'playtest mode: every report gets logged and triaged', local: false },
  { cmd: '/endtest', args: '', desc: 'end playtest mode with a session summary', local: false },
  { cmd: '/artifacts', args: '[project]', desc: 'what fixers produced: diffs, exports, screenshots', local: true },
  { cmd: '/log', args: '<fixer-id>', desc: 'a fixer\'s recent log', local: true },
  { cmd: '/report', args: '[hours]', desc: 'build report for the last N hours', local: true },
  { cmd: '/history', args: '<query>', desc: 'search past conversations', local: true },
  { cmd: '/vault', args: '<path>', desc: 'read a file from the brain (e.g. plans/battalion.md)', local: true },
  { cmd: '/model', args: '[default|opus|sonnet|haiku]', desc: 'switch Oracle\'s model', local: true },
  { cmd: '/golden', args: '', desc: 'run the regression exams for the brain', local: false },
  { cmd: '/proposals', args: '', desc: 'pending self-improvement proposals', local: false },
  { cmd: '/export', args: '', desc: 'export the transcript to the vault', local: false },
  { cmd: '/clear', args: '', desc: 'fresh working context (vault memory carries forward)', local: false },
  { cmd: '/help', args: '', desc: 'this list', local: true },
];

async function runLocalCommand(name, arg) {
  switch (name) {
    case 'help': return localTurn('/help', async () => ({ text: COMMANDS.map((c) => '`' + c.cmd + (c.args ? ' ' + c.args : '') + '` — ' + c.desc).join('\n'), acts: [{ label: 'what\'s new?', run: () => send('what\'s new since we last talked?') }] }));
    case 'project': return localTurn('/project' + (arg ? ' ' + arg : ''), async (T) => {
      if (!S.projects || !S.projects.length) await refreshProjects();
      if (arg) { const p = (S.projects || []).find((x) => x.name.toLowerCase() === arg.toLowerCase()); if (!p) return { ok: false, text: 'No project called **' + md.esc(arg) + '**. I know: ' + projectNames().join(', ') + '.' }; S.project = p.name; LS.set('project', p.name); refreshStatus(); }
      const p = (S.projects || []).find((x) => x.name === activeProject());
      if (!p) return { ok: false, text: 'No projects registered yet. `/new <name>` starts one.' };
      let ms = []; try { ms = await api.get('/api/milestones?project=' + encodeURIComponent(p.name)); } catch { /* none */ }
      const done = ms.reduce((a, m) => a + m.done, 0), total = ms.reduce((a, m) => a + m.total, 0);
      const auto = (S.auto || {})[p.name];
      const lines = ['Working in **' + p.name + '** — `' + p.repo + '`', '`' + (p.branch || '?') + '` · ' + (p.lastCommit || '').slice(0, 72) + (p.dirty ? ' · ' + p.dirty + ' dirty file' + (p.dirty > 1 ? 's' : '') : ''), total ? 'plan · ' + done + '/' + total + ' tasks (' + Math.round(100 * done / total) + '%)' : 'no plan file yet (`plans/' + p.name + '.md`)', auto ? 'auto ' + (auto.on ? auto.mode + ' mode · ' + auto.inflight + ' in flight · ' + auto.pending + ' pending · ' + auto.staged + ' staged' : 'off') : ''].filter(Boolean);
      const others = projectNames().filter((n) => n !== p.name);
      return { text: lines.join('\n'), acts: [{ label: 'plan', run: () => send('/plan ' + p.name) }, ...(S.playable || []).filter((x) => x.name === p.name).map(() => ({ label: 'play', run: () => send('/play ' + p.name) })), ...others.slice(0, 2).map((n) => ({ label: 'switch to ' + n, run: () => send('/project ' + n) }))] };
    });
    case 'new': return localTurn('/new ' + arg, async (T) => {
      if (!arg) return { ok: false, text: 'Give it a name: `/new <name>`.' };
      const st = addStep(T, 'creating the repo');
      const r = await api.post('/api/project-create', { mode: 'new', name: arg });
      markStep(st, 'done'); await refreshProjects(); S.project = r.slug; LS.set('project', r.slug);
      return { text: '**' + md.esc(arg) + '** exists now — `' + r.repo + '`, git initialised and registered. It\'s the active project.\n\nTell me what it is and I\'ll plan it.', acts: [{ label: 'plan it', run: () => { ask.value = 'Plan ' + arg + ': '; ask.focus(); autosize(); } }, { label: 'open folder', run: () => api.get('/api/reveal?p=' + encodeURIComponent(r.repo)).catch(() => toast('could not open')) }] };
    });
    case 'fix': return localTurn('/fix ' + arg, async (T) => {
      if (!arg) return { ok: false, text: 'Tell me what to fix: `/fix <issue>`.' };
      const proj = activeProject(); const st = addStep(T, 'dispatching a fixer on ' + proj);
      const r = await api.post('/api/fix', { project: proj, issue: arg });
      markStep(st, 'done'); refreshStatus();
      return { text: 'Fixer **' + r.id + '** is on it — `' + r.branch + '` in **' + proj + '**. It works in its own worktree; nothing lands until you approve.', acts: [{ label: 'watch it', run: () => send('/log ' + r.id) }, { label: 'steer', run: () => { ask.value = '/steer ' + r.id + ' '; ask.focus(); autosize(); } }] };
    });
    case 'diff': return localTurn('/diff ' + arg, async (T) => {
      if (!arg) return { ok: false, text: 'Which one? `/diff <fixer-id>`' };
      const st = addStep(T, 'reading the diff'); const d = await api.get('/api/fixer-diff?id=' + encodeURIComponent(arg)); markStep(st, 'done');
      const f = fixerById(arg) || { id: arg, status: 'done' };
      return { html: renderDiff(d), text: (d.diffstat || '').trim(), acts: fixerActs(f, { target: d.target }).filter((a) => a.label !== 'diff' && a.label !== 'what changed') };
    });
    case 'steer': { const m = arg.match(/^(\S+)\s+([\s\S]+)$/); return localTurn('/steer ' + arg, async () => { if (!m) return { ok: false, text: '`/steer <fixer-id> <note>`' }; const r = await api.post('/api/fixer-steer', { id: m[1], text: m[2] }); return { text: r.text || 'sent' }; }); }
    case 'stop': return localTurn('/stop ' + arg, async () => { if (!arg) return { ok: false, text: '`/stop <fixer-id>`' }; const r = await api.post('/api/fixer-stop', { id: arg }); refreshStatus(); return { text: r.text || 'stopped' }; });
    case 'log': return localTurn('/log ' + arg, async () => { if (!arg) return { ok: false, text: '`/log <fixer-id>`' }; const r = await api.get('/api/fixer-log?id=' + encodeURIComponent(arg)); const es = (r.entries || []).slice(-14); const f = fixerById(arg); return { text: (f ? '**' + md.esc(fixerTitle(f)) + '** · ' + f.status + '\n\n' : '') + (es.length ? es.map((e) => (e.kind === 'tool' ? '› ' : e.kind === 'assistant' ? '' : '· ') + e.text.slice(0, 220)).join('\n') : '_no log yet_'), acts: f ? fixerActs(f) : [] }; });
    case 'plan': return localTurn('/plan' + (arg ? ' ' + arg : ''), async (T) => {
      const proj = arg || activeProject(); const st = addStep(T, 'reading plans/' + proj + '.md');
      const ms = await api.get('/api/milestones?project=' + encodeURIComponent(proj)); markStep(st, 'done');
      const auto = (S.auto || {})[proj];
      if (!ms.length) return { text: 'No milestones for **' + proj + '** yet — the plan lives in `plans/' + proj + '.md` in the vault.', acts: [{ label: 'write a plan', run: () => send('write plans/' + proj + '.md with milestones and checkbox tasks for ' + proj) }] };
      const done = ms.reduce((a, m) => a + m.done, 0), total = ms.reduce((a, m) => a + m.total, 0);
      const next = ms.find((m) => m.done < m.total);
      const html = renderPlan(proj, ms, done, total, auto, next);
      const text = proj + ' — ' + done + '/' + total + ' tasks. ' + ms.map((m) => m.name + ' ' + m.done + '/' + m.total).join('; ');
      return { html, text, acts: [next ? { label: 'dispatch next', run: () => send('dispatch the next task in "' + next.name + '" for ' + proj + ' as a fixer') } : null, { label: 'what\'s staged?', run: () => send('/artifacts ' + proj) }, auto && auto.on ? { label: 'pause auto', confirm: 'pause auto on ' + proj + '?', run: () => send('/auto ' + proj + ' pause') } : { label: 'turn auto on', run: () => send('/auto ' + proj + ' stage') }].filter(Boolean) };
    });
    case 'auto': { const m = arg.match(/^(\S+)\s+(off|suggest|stage|ship|pause|resume|on)$/i); return localTurn('/auto ' + arg, async () => {
      if (!m) return { ok: false, text: '`/auto <project> <off|suggest|stage|ship|pause|resume>`' };
      const proj = m[1], mode = m[2].toLowerCase();
      const patch = mode === 'pause' ? { on: false } : mode === 'resume' || mode === 'on' ? { on: true } : mode === 'off' ? { on: false, mode: 'off' } : { on: true, mode, autoMerge: mode === 'ship' };
      const r = await api.post('/api/auto', { project: proj, ...patch }); refreshStatus();
      const cfg = r && r[proj] ? r[proj] : (r || {});
      return { text: 'Auto on **' + proj + '** is now ' + (cfg.on === false || mode === 'pause' || mode === 'off' ? '**off**' : '**' + (cfg.mode || mode) + '** mode' + (cfg.maxConcurrent ? ' · up to ' + cfg.maxConcurrent + ' fixers at once' : '')) + '.' + (mode === 'ship' ? '\n\n_ship = fixers merge themselves when the gate passes. Stage keeps you in the loop._' : ''), acts: [{ label: 'plan', run: () => send('/plan ' + proj) }] }; }); }
    case 'model': return localTurn('/model' + (arg ? ' ' + arg : ''), async () => { if (!arg) { const r = await api.get('/api/model'); return { text: 'Model: **' + r.current + '** (options: ' + r.options.join(', ') + ')', acts: r.options.filter((o) => o !== r.current).slice(0, 3).map((o) => ({ label: o, run: () => send('/model ' + o) })) }; } const r = await api.post('/api/model', { model: arg }); refreshStatus(); return { text: 'Switched to **' + r.current + '**.' }; });
    case 'history': return localTurn('/history ' + arg, async () => { if (!arg) return { ok: false, text: '`/history <query>`' }; const r = await api.get('/api/history?q=' + encodeURIComponent(arg) + '&n=8'); const items = Array.isArray(r) ? r : (r.items || []); if (!items.length) return { text: 'Nothing about "' + md.esc(arg) + '" in the log.' }; return { text: items.slice(0, 8).map((e) => '**' + (e.role === 'user' ? 'you' : NAME) + '** · ' + new Date(e.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + '\n' + String(e.text || '').replace(/\s+/g, ' ').slice(0, 220)).join('\n\n') }; });
    case 'vault': return localTurn('/vault ' + arg, async () => { if (!arg) return { ok: false, text: '`/vault <path>` — e.g. `/vault plans/battalion.md`' }; const r = await api.get('/api/vault?p=' + encodeURIComponent(arg)); return { text: '`' + md.esc(arg) + '`\n\n' + String(r.content || '').slice(0, 6000), acts: [{ label: 'ask nibbi to change it', run: () => { ask.value = 'In ' + arg + ', '; ask.focus(); autosize(); } }] }; });
    case 'report': return localTurn('/report' + (arg ? ' ' + arg : ''), async () => { const r = await api.get('/api/build-report?hours=' + (Number(arg) || 24)); return { text: r.text || '_nothing to report_' }; });
    case 'artifacts': return localTurn('/artifacts' + (arg ? ' ' + arg : ''), async () => {
      const proj = arg || activeProject(); const r = await api.get('/api/artifacts?project=' + encodeURIComponent(proj));
      const ch = (r.changes || []).slice(0, 10);
      if (!ch.length && !(r.files || []).length) return { text: 'Nothing produced for **' + proj + '** yet.' };
      const staged = ch.filter((c) => c.status === 'done');
      const lines = ['**' + proj + '** — ' + staged.length + ' staged for review, ' + ch.filter((c) => c.status === 'merged').length + ' merged recently', ...ch.map((c) => (c.status === 'done' ? '◦ ' : '✓ ') + '`' + c.id + '` ' + md.esc(c.title) + ' — ' + String(c.diffstat || '').trim().split('\n').pop() + (c.costUsd ? ' · $' + c.costUsd.toFixed(2) : ''))];
      if ((r.files || []).length) lines.push('', 'files: ' + r.files.slice(0, 6).map((f) => '`' + f.name + '`').join(' '));
      return { text: lines.join('\n'), acts: staged.slice(0, 3).map((c) => ({ label: 'diff ' + c.id, run: () => send('/diff ' + c.id) })) };
    });
    default: return null;
  }
}

/* ------------------------------------------------------------------ fleet events: when a fixer lands while you weren't looking, nibbi says so */
let fleetSeen = null;
function fleetEvents(list) {
  if (!list) return;
  const cur = new Map(list.map((f) => [f.id, f.status]));
  if (fleetSeen === null) { fleetSeen = cur; return; }
  for (const f of list) {
    const prev = fleetSeen.get(f.id);
    if (prev === f.status || (prev === undefined && !ACTIVE.has(f.status))) continue;
    if (!['done', 'failed', 'merged'].includes(f.status) || S.busy) continue;
    setMode('talk'); body.classList.remove('rest');
    const T = newTurn(null); T.plain = false; T.bubble.classList.remove('live');
    const title = md.esc(fixerTitle(f)); const stat = String(f.diffstat || '').trim().split('\n').pop() || '';
    const text = f.status === 'done' ? 'Fixer **' + title + '** is done and staged on **' + f.game + '**' + (stat ? ' — ' + stat : '') + '. Review it?' : f.status === 'merged' ? '**' + title + '** merged into **' + f.game + '**.' : 'Fixer **' + title + '** failed on **' + f.game + '**.' + (f.summary ? ' ' + md.esc(String(f.summary).slice(0, 160)) : '');
    setSaid(T, text, false); setMeta(T, {}); T.done = true; if (f.status === 'failed') T.nib.classList.add('error');
    addActs(T, fixerActs(f)); nibbi.setMood(f.status === 'failed' ? 'error' : 'happy'); setTimeout(() => { if (!S.busy) nibbi.setMood('idle'); }, 1600);
    $('#sr').textContent = stripMd(text); if (S.voiceOn && !S.demo && S.link !== 'offline') speak(stripMd(text));
  }
  fleetSeen = cur;
}

/* ------------------------------------------------------------------ slash palette */
const paletteEl = document.createElement('div'); paletteEl.id = 'palette'; paletteEl.className = 'palette'; paletteEl.hidden = true; document.body.appendChild(paletteEl);
let palIndex = 0, palItems = [];
function updatePalette() {
  const v = ask.value; const m = v.match(/^\/(\S*)$/);
  if (!m) { paletteEl.hidden = true; palItems = []; return; }
  const q = m[1].toLowerCase();
  palItems = COMMANDS.filter((c) => c.cmd.slice(1).startsWith(q) || c.desc.toLowerCase().includes(q)).slice(0, 7);
  if (!palItems.length) { paletteEl.hidden = true; return; }
  palIndex = Math.min(palIndex, palItems.length - 1);
  paletteEl.replaceChildren(...palItems.map((c, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'pi' + (i === palIndex ? ' sel' : ''); b.innerHTML = '<span class="c">' + escapeHtml(c.cmd) + '</span> <span class="a">' + escapeHtml(c.args) + '</span><span class="d">' + escapeHtml(c.desc) + '</span>'; b.onmousedown = (e) => { e.preventDefault(); pickPalette(i); }; return b; }));
  const r = pill.getBoundingClientRect(); paletteEl.style.bottom = (innerHeight - r.top + 10) + 'px'; paletteEl.style.width = r.width + 'px';
  paletteEl.hidden = false;
}
function pickPalette(i) { const c = palItems[i]; if (!c) return; ask.value = c.cmd + (c.args ? ' ' : ''); paletteEl.hidden = true; palItems = []; ask.focus(); autosize(); if (!c.args) pill.requestSubmit(); }
ask.addEventListener('input', () => { palIndex = 0; updatePalette(); });
ask.addEventListener('blur', () => setTimeout(() => { paletteEl.hidden = true; }, 120));
ask.addEventListener('keydown', (e) => {
  if (paletteEl.hidden || !palItems.length) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); palIndex = (palIndex + 1) % palItems.length; updatePalette(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); palIndex = (palIndex - 1 + palItems.length) % palItems.length; updatePalette(); }
  else if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); e.stopImmediatePropagation(); pickPalette(palIndex); }
  else if (e.key === 'Escape') { paletteEl.hidden = true; palItems = []; e.stopImmediatePropagation(); }
}, true);

/* ------------------------------------------------------------------ /play: launch a project's dev server through the gateway's sanctioned launcher */
const openUrl = (u) => { if (window.__TAURI__) fetch('/api/open?url=' + encodeURIComponent(u)).catch(() => window.open(u, '_blank')); else window.open(u, '_blank'); };
async function playFlow(project, action) {
  S.busy = true; body.classList.add('busy'); activity(); hideChips(); ask.value = ''; autosize(); setMode('talk');
  const T = newTurn('/play ' + project + (action !== 'start' ? ' ' + action : '')); T.plain = false;
  nibbi.setMood('working'); const fr = feed.getBoundingClientRect(); nibbi.lookAt(innerWidth / 2 + 40, fr.top + 30);
  const api = (a) => fetch('/api/play?project=' + encodeURIComponent(project) + '&action=' + a).then((r) => r.json());
  let ok = true, text = '', url = null;
  try {
    if (action === 'stop') { const st = addStep(T, 'stopping the ' + project + ' server'); await api('stop'); markStep(st, 'done'); text = 'Stopped the **' + project + '** server.'; }
    else {
      const st = addStep(T, (action === 'status' ? 'checking on' : 'starting') + ' the ' + project + ' dev server');
      let r = action === 'status' ? await api('status') : await api('start');
      if (r.error) throw new Error(r.error);
      const t0 = performance.now();
      while (!r.url && performance.now() - t0 < 60000) { await sleep(1200); r = await api('status'); if (!r.running && !r.starting && action === 'status') break; }
      markStep(st, r.url ? 'done' : 'fail');
      if (r.url) { url = r.url; text = '**' + project + '** is up at ' + url + ' — opening it. It runs for an hour, then I put it away.'; openUrl(url); }
      else if (action === 'status') { text = '**' + project + '** isn\'t running.' + (r.playable ? ' Want me to start it?' : ' It has no web dev server (' + (r.kind || 'terminal') + ').'); }
      else { ok = false; text = 'The server didn\'t come up in a minute. The log is at `~/.oracle/play-' + project + '.log`.'; }
    }
  } catch (e) { ok = false; text = /unknown project/i.test(e.message) ? 'I don\'t know a project called **' + project + '**. Registered projects: ' + ((S.projects || []).map((p) => p.name).join(', ') || 'none yet') + '.' : /no web dev server|terminal game/i.test(e.message) ? '**' + project + '** has no web dev server — it\'s a terminal game (`npm run play`).' : 'I couldn\'t launch it — ' + e.message; }
  finishSteps(T, ok); setSaid(T, text, false); setMeta(T, {}); T.done = true; T.el.removeAttribute('aria-busy'); T.bubble.classList.remove('live');
  if (!ok) T.nib.classList.add('error');
  const acts = [];
  if (url) { acts.push({ label: 'open it', run: () => openUrl(url) }, { label: 'stop the server', run: () => send('/play ' + project + ' stop') }); }
  else if (ok && action === 'status' && /Want me to start/.test(text)) acts.push({ label: 'start it', run: () => send('/play ' + project) });
  else if (!ok) acts.push({ label: 'try again', run: () => send('/play ' + project) });
  addActs(T, acts);
  S.busy = false; body.classList.remove('busy'); nibbi.lookFree(); nibbi.setMood(ok ? 'happy' : 'error'); setTimeout(() => { if (!S.busy) nibbi.setMood('idle'); }, ok ? 1500 : 2600);
  $('#sr').textContent = stripMd(text); scheduleIdleTimers();
}
function launchActsFor(text) {
  const names = (S.projects || []).map((p) => p.name);
  const acts = [];
  if (/npm run dev|dev server|launch|start the server|run it yourself|localhost/i.test(text)) {
    for (const n of names) if (new RegExp('\\b' + n + '\\b', 'i').test(text)) acts.push({ label: 'launch ' + n, run: () => send('/play ' + n) });
  }
  return acts.slice(0, 2);
}

/* ------------------------------------------------------------------ the turn choreography */
let pendingImages = [];
async function send(text, images) {
  text = (text || '').trim(); images = images || [];
  if (!text && !images.length) return;
  if (S.busy) { toast(NAME + ' is still working — one thing at a time'); return; }
  const isCommand = text.startsWith('/');
  const pm = text.match(/^\/play\s+([\w.-]+)(?:\s+(stop|status))?\s*$/i);
  if (pm) { await playFlow(pm[1].toLowerCase(), (pm[2] || 'start').toLowerCase()); return; }
  const cm = text.match(/^\/(\w+)\s*([\s\S]*)$/);
  if (cm && COMMANDS.some((c) => c.cmd === '/' + cm[1].toLowerCase() && c.local)) { await runLocalCommand(cm[1].toLowerCase(), cm[2].trim()); return; }
  S.busy = true; body.classList.add('busy'); sendBtn.setAttribute('aria-label', 'stop watching');
  activity(); hideChips();
  ask.value = ''; autosize(); clearAttach();
  setMode('talk');
  const T = newTurn(text, images); T.plain = isCommand;
  nibbi.setMood('thinking');
  const feedRect = feed.getBoundingClientRect(); nibbi.lookAt(innerWidth / 2 + 40, feedRect.top + 30);
  setLink('busy');

  const ctrl = new AbortController(); S.abort = ctrl;
  const brain = S.demo ? demoTurn : (S.link === 'offline' ? offlineTurn : sseTurn);
  let result = null, spoke = false, toolCount = 0, lastFixerPoll = 0;
  const fixerBefore = new Map((S.fixers || []).map((f) => [f.id, f.status]));
  try {
    for await (const e of brain(text, images, ctrl.signal)) {
      if (e.ev === 'tool' && e.name) {
        toolCount++;
        if (spoke && T.acc && !/\n\s*$/.test(T.acc)) { T.acc += '\n\n'; }
        addStep(T, toolLabel(e.name));
        if (nibbi.mood() !== 'working') nibbi.setMood('working');
        if (toolCount % 3 === 1) nibbi.spatter(1, 0.9);
        if (performance.now() - lastFixerPoll > 4000) { lastFixerPoll = performance.now(); pollFixers(T, fixerBefore); }
      } else if (e.ev === 'delta' && e.t) {
        if (!spoke) { spoke = true; nibbi.setMood('speaking'); if (T.liveStep) { markStep(T.liveStep, 'done'); T.liveStep = null; } }
        setSaid(T, T.acc + e.t, true);
        nibbi.pulse(Math.min(1, 0.35 + e.t.length * 0.03));
      } else if (e.ev === 'done') { result = e; }
    }
  } catch (err) {
    if (err.name === 'AbortError') result = { text: T.acc || '_stopped watching — ' + NAME + ' may still be working in the background._', isError: false, aborted: true };
    else result = { text: (err.message || String(err)), isError: true };
  }
  result = result || { text: T.acc || '(no reply)', isError: false };
  const squash = (s) => String(s || '').replace(/»voice:[^\n]*\n?/g, '').replace(/\s+/g, '');
  if (T.acc && result.text && squash(T.acc) === squash(result.text)) result.text = T.acc.replace(/»voice:[^\n]*\n?/g, '');
  const ok = !result.isError;
  if (!ok) { result.raw = result.text; result.text = humanError(result.text); }
  finishSteps(T, ok);
  setSaid(T, result.text || '', false);
  setMeta(T, result);
  T.el.removeAttribute('aria-busy'); T.bubble.classList.remove('live');
  $('#sr').textContent = ok ? stripMd(result.text).slice(0, 400) : 'nibbi hit a problem: ' + stripMd(result.text).slice(0, 200);
  T.done = true;
  if (!ok) T.nib.classList.add('error');
  S.busy = false; body.classList.remove('busy'); sendBtn.setAttribute('aria-label', 'send'); S.abort = null;
  nibbi.lookFree();
  if (!ok) { nibbi.setMood('error'); addActs(T, errorActs(result.text)); setTimeout(() => { if (!S.busy) nibbi.setMood('idle'); }, 2600); }
  else if (!result.aborted) { nibbi.setMood('happy'); setTimeout(() => { if (!S.busy) nibbi.setMood('idle'); }, 1500); }
  else nibbi.setMood('idle');
  if (ok && !result.aborted) speak(result.voice || firstSentences(stripMd(result.text), 2, 320));
  if (!isCommand) addActs(T, replyActs(result.text));
  setLink(S.demo ? 'demo' : 'live');
  refreshStatus();
  if (ok && !isCommand && !T.nib.querySelector('.acts')) addActs(T, chipSet('after').map((c) => ({ label: c.label, run: () => send(c.text) })));
  scheduleIdleTimers();
}

function humanError(raw) {
  const m = String(raw || '').replace(/^\s*error:\s*/i, '');
  if (/oauth|authenticate|token/i.test(m)) return 'I spilled the ink pot — the gateway\'s login has expired. Run `claude setup-token`, then I\'ll try again.';
  if (/gateway offline|failed to fetch|networkerror|ECONNREFUSED|isn\'t reachable/i.test(m)) return 'The gateway isn\'t answering, so there\'s no brain behind me right now. Start it — or switch me to the demo brain to see how this feels.';
  if (/HTTP 5\d\d/.test(m)) return 'The gateway choked on that one (' + m + '). Try again?';
  if (/rate.?limit|429/i.test(m)) return 'I\'m rate-limited for a bit. Give me a few minutes and ask again.';
  return 'I lost the thread — ' + m.charAt(0).toLowerCase() + m.slice(1);
}
function errorActs(text) {
  const acts = [{ label: 'try again', run: () => { const last = S.turns[S.turns.length - 1]; if (last) send(last.text); } }];
  if (/oauth|authenticate|token/i.test(text)) acts.push({ label: 'how to re-login', warn: true, run: () => { toast('in Terminal: claude setup-token → then restart the gateway', 5000); } });
  if (/gateway (offline|isn)|failed to fetch|networkerror|not reachable/i.test(text)) { acts.push({ label: 'start the gateway', warn: true, run: () => toast('launchctl kickstart -k gui/$(id -u)/com.oracle.gateway', 6000) }); acts.push({ label: 'use the demo brain', run: () => { S.demo = true; refreshStatus(); const last = S.turns[S.turns.length - 1]; if (last) send(last.text); } }); }
  return acts;
}
function replyActs(text) {
  const acts = launchActsFor(text);
  if (/stage|staged|review the diff|approve/i.test(text)) acts.push({ label: 'show what\'s staged', run: () => send('/fixers') });
  if (/\bship\b|merge/i.test(text) && /\?/.test(text)) acts.push({ label: 'ship it', run: () => send('yes, ship it') });
  if (/preview|localhost:\d+/i.test(text)) { const m = text.match(/https?:\/\/[^\s)]+/); if (m) acts.push({ label: 'open preview', run: () => window.open(m[0], '_blank') }); }
  if (/\?\s*$/.test(text.trim()) && !acts.length) acts.push({ label: 'yes', run: () => send('yes') }, { label: 'not now', run: () => send('not now') });
  return acts.slice(0, 3);
}

/* fixers moving while nibbi works → progress rows */
async function pollFixers(T, before) {
  try {
    const r = await fetch('/api/fixers'); if (!r.ok) return; const list = await r.json(); S.fixers = list; renderAgents(list);
    for (const f of list) {
      const prev = before.get(f.id);
      if (prev !== f.status) {
        before.set(f.id, f.status);
        if (prev === undefined && (f.status === 'done' || f.status === 'failed')) continue;
        const st = addStep(T, 'fixer · ' + (f.title || f.issue || f.id).slice(0, 60) + ' → ' + f.status, 'fixer');
        if (f.status === 'done' || f.status === 'staged' || f.status === 'merged') markStep(st, 'done');
        if (f.status === 'failed') markStep(st, 'fail');
        if (T.liveStep === st && (f.status !== 'running' && f.status !== 'queued')) T.liveStep = null;
      }
    }
  } catch { /* offline */ }
}

/* ------------------------------------------------------------------ agents: tinted little nibbis under the pill, one per fixer */
const agentsEl = $('#agents');
const AGENT_INK = [[0.23, 0.29, 0.61], [0.18, 0.50, 0.46], [0.69, 0.47, 0.16], [0.48, 0.25, 0.47], [0.71, 0.33, 0.24], [0.37, 0.48, 0.23]];
const hashId = (id) => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const agentMood = (st) => ({ queued: 'sleep', installing: 'thinking', running: 'working', done: 'happy', merged: 'happy', failed: 'error', superseded: 'sleep', duty: 'sleep' }[st] || 'working');
const agentEls = new Map();
const ACTIVE = new Set(['queued', 'installing', 'running']);
let tailCache = new Map();
function demoFixers() {
  const t0 = Date.now();
  return [
    { id: 'demo1', title: 'replay log for multiplayer runs', status: 'running', model: 'sonnet', costUsd: 0.41, startedAt: new Date(t0 - 200000).toISOString(), project: 'shipless' },
    { id: 'demo2', title: 'supply ruling per issue #9', status: (performance.now() > 25000 ? 'done' : 'running'), game: 'shipless', diffstat: ' rules.md | 14 ++--\n 1 file changed, 9 insertions(+), 5 deletions(-)', model: 'sonnet', costUsd: 0.12, startedAt: new Date(t0 - 60000).toISOString(), endedAt: performance.now() > 25000 ? new Date().toISOString() : undefined, project: 'shipless' },
    { id: 'demo3', title: 'hub font sizing', status: 'queued', model: 'haiku', startedAt: new Date(t0 - 10000).toISOString(), project: 'shipless' },
    { id: 'demo4', title: 'stale doc cleanup', status: 'done', model: 'haiku', costUsd: 0.22, startedAt: new Date(t0 - 400000).toISOString(), endedAt: new Date(t0 - 20000).toISOString(), project: 'shipless' },
  ];
}
const RECENT_MS = 10 * 60000;
function renderAgents(list, auto) {
  const now = Date.now();
  const src = S.demo ? demoFixers() : (list || []);
  const autoSrc = S.demo ? { shipless: { on: true, mode: 'stage', inflight: 2, pending: 17, staged: 3, done: 12, total: 29, spend: 4.2, note: 'working through the v2 roadmap' } } : (auto || S.auto || {});
  const show = [];
  for (const [p, a] of Object.entries(autoSrc)) if (a && a.on) show.push({ id: 'auto:' + p, kind: 'auto', project: p, title: 'auto · ' + p, status: a.inflight > 0 ? 'running' : 'duty', auto: a });
  for (const f of src) if (ACTIVE.has(f.status) || (f.endedAt && now - Date.parse(f.endedAt) < RECENT_MS)) show.push(f);
  show.splice(8);
  const seen = new Set();
  for (const f of show) {
    seen.add(f.id);
    let a = agentEls.get(f.id);
    if (!a) {
      const el = document.createElement('button'); el.type = 'button'; el.className = 'agent';
      const cv = document.createElement('canvas'); cv.className = 'ava'; cv.setAttribute('aria-hidden', 'true');
      const card = document.createElement('div'); card.className = 'card';
      el.append(cv, card);
      el.addEventListener('pointerenter', () => fillCard(a)); el.addEventListener('focus', () => fillCard(a));
      el.addEventListener('click', () => { el.classList.toggle('pinned'); fillCard(a); });
      agentsEl.appendChild(el);
      a = { el, canvas: cv, card, fixer: f }; agentEls.set(f.id, a);
    }
    a.fixer = f; a.el.dataset.status = f.status; a.el.dataset.kind = f.kind || 'fixer';
    a.el.style.opacity = f.endedAt ? String(Math.max(0.45, 1 - (now - Date.parse(f.endedAt)) / RECENT_MS * 0.55)) : '';
    a.el.setAttribute('aria-label', (f.title || f.issue || f.id) + ' — ' + f.status);
  }
  for (const [id, a] of agentEls) if (!seen.has(id)) { a.el.classList.add('out'); setTimeout(() => a.el.remove(), 320); agentEls.delete(id); }
  agentsEl.hidden = agentEls.size === 0;
  const had = body.classList.contains('has-agents'); body.classList.toggle('has-agents', agentEls.size > 0); if (had !== (agentEls.size > 0)) layout(false);
  nibbi.setAgents([...agentEls.values()].map((a) => { const key = a.fixer.kind === 'auto' ? a.fixer.project : a.fixer.id; return { id: a.fixer.id, canvas: a.canvas, color: AGENT_INK[hashId(key) % AGENT_INK.length], mood: agentMood(a.fixer.status), seed: (hashId(a.fixer.id) % 1000) / 1000 }; }));
}
async function fillCard(a) {
  const f = a.fixer; const title = f.title || (f.issue || '').slice(0, 60) || f.id;
  if (f.kind === 'auto') {
    const x = f.auto || {};
    a.card.replaceChildren();
    const h = document.createElement('div'); h.className = 't'; h.textContent = title + (x.inflight ? ' — dispatching' : ' — on duty');
    const m = document.createElement('div'); m.className = 'm'; m.textContent = [x.mode + ' mode', x.inflight + ' in flight', x.pending + ' pending', x.staged + ' staged', (x.done !== undefined ? x.done + '/' + x.total + ' done' : null), (x.spend ? '$' + x.spend.toFixed(2) + ' spent' : null)].filter(Boolean).join(' · ');
    const tail = document.createElement('div'); tail.className = 'tail'; tail.textContent = (x.note || '').trim();
    const acts = document.createElement('div'); acts.className = 'acts';
    const mk = (label, fn, cls) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip in' + (cls || ''); b.textContent = label; b.onclick = (e) => { e.stopPropagation(); a.el.classList.remove('pinned'); fn(); }; return b; };
    acts.append(mk('plan', () => send('/plan ' + f.project)), mk(x.on ? 'pause' : 'resume', () => send('/auto ' + f.project + ' ' + (x.on ? 'pause' : 'resume'))));
    for (const mode of ['suggest', 'stage', 'ship']) if (mode !== x.mode) acts.append(mk(mode, () => send('/auto ' + f.project + ' ' + mode), mode === 'ship' ? ' warn' : ''));
    acts.append(mk('ask nibbi', () => send('what is auto doing on ' + f.project + ' right now, and what\'s next?')));
    a.card.append(h, m, tail, acts); return;
  }
  const started = f.startedAt ? Math.max(0, Math.round((Date.now() - Date.parse(f.startedAt)) / 60000)) : null;
  const line2 = [f.status, f.model, f.costUsd ? '$' + f.costUsd.toFixed(2) : null, started !== null ? (f.endedAt ? 'ended' : started + ' min in') : null].filter(Boolean).join(' · ');
  a.card.replaceChildren();
  const h = document.createElement('div'); h.className = 't'; h.textContent = title;
  const m = document.createElement('div'); m.className = 'm'; m.textContent = line2;
  const tail = document.createElement('div'); tail.className = 'tail';
  const acts = document.createElement('div'); acts.className = 'acts';
  for (const act of fixerActs(f)) { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip in' + (act.warn ? ' warn' : ''); b.textContent = act.label; let armed = 0; b.onclick = (e) => { e.stopPropagation(); if (act.confirm && !armed) { armed = setTimeout(() => { armed = 0; b.textContent = act.label; }, 4000); b.textContent = act.confirm; return; } a.el.classList.remove('pinned'); act.run(); }; acts.appendChild(b); }
  a.card.append(h, m, tail, acts);
  if (S.demo) { tail.textContent = f.status === 'running' ? '› editing src/multiplayer/replay.ts\n› npm test — 42 passing' : f.status === 'queued' ? 'waiting for a free slot' : 'merged into staging'; return; }
  const c = tailCache.get(f.id);
  if (c && Date.now() - c.at < 5000) { tail.textContent = c.lines.join('\n'); return; }
  try { const r = await fetch('/api/fixer-tail?id=' + encodeURIComponent(f.id)); const j = await r.json(); tailCache.set(f.id, { at: Date.now(), lines: j.lines || [] }); tail.textContent = (j.lines || []).slice(-3).join('\n'); } catch { /* offline */ }
}
document.addEventListener('click', (e) => { if (!e.target.closest('.agent')) for (const a of agentEls.values()) a.el.classList.remove('pinned'); });

/* ------------------------------------------------------------------ status / link */
let linkFreshT = 0;
function setLink(l) {
  if (S.link !== l) { body.classList.add('link-fresh'); clearTimeout(linkFreshT); linkFreshT = setTimeout(() => body.classList.remove('link-fresh'), 2600); }
  S.link = l; body.dataset.link = l;
  $('.label', status).textContent = { live: 'oracle', busy: 'working', demo: 'demo brain', offline: 'gateway offline', booting: 'waking' }[l] || l;
}
async function refreshStatus() {
  try {
    const r = await fetch('/nibbi/health', { cache: 'no-store' }); const h = await r.json();
    if (h.brain && h.status) {
      S.status = h.status;
      if (!S.busy) setLink(S.demo ? 'demo' : (h.status.busy ? 'busy' : 'live'));
      $('#st-brain').textContent = 'brain · ' + (h.status.busy ? 'busy' : 'ready') + ' · ' + Math.round((h.status.ctxTokens || 0) / 1000) + 'k ctx · ' + (h.status.turns || 0) + ' turns';
      $('#st-session').textContent = 'session · ' + (h.status.sessionShort || '—') + (h.status.rateLimit && h.status.rateLimit.status !== 'allowed' ? ' · rate-limited' : '');
      $('#st-model').textContent = 'model · ' + (h.status.modelOverride || 'default');
    } else {
      if (!S.busy) { setLink(S.demo ? 'demo' : 'offline'); if (!S.demo && S.mode === 'idle' && nibbi.mood() === 'idle') nibbi.setMood('sleep'); }
      $('#st-brain').textContent = 'brain · unreachable at ' + (h.gateway || 'gateway');
      $('#st-session').textContent = 'launchctl kickstart -k gui/$(id -u)/com.oracle.gateway';
      $('#st-model').textContent = 'model · —';
    }
    if (!S.busy) { try { const fr = await fetch('/api/fixers'); if (fr.ok) S.fixers = await fr.json(); } catch { /* ignore */ } }
    try { const ar = await fetch('/api/auto'); if (ar.ok) S.auto = await ar.json(); } catch { /* ignore */ }
    renderAgents(S.fixers, S.auto); fleetEvents(S.demo ? demoFixers() : S.fixers);
  } catch {
    if (!S.busy) setLink('offline');
    $('#st-brain').textContent = 'host · not reachable (open via node server.mjs)';
  }
  $('#st-project').textContent = 'project: ' + activeProject() + (projectNames().length > 1 ? ' (click to switch)' : '');
  $('#st-voice').textContent = 'voice: ' + (S.voiceOn ? 'on' : 'off');
  $('#st-demo').textContent = S.demo ? 'demo brain: on (click for the real one)' : 'demo brain: off';
}
$('#st-project').onclick = () => { const names = projectNames(); if (!names.length) return; const i = names.indexOf(activeProject()); send('/project ' + names[(i + 1) % names.length]); };
$('#st-voice').onclick = () => { S.voiceOn = !S.voiceOn; LS.set('voice', S.voiceOn); body.classList.toggle('voice-on', S.voiceOn); refreshStatus(); toast(S.voiceOn ? NAME + ' will speak replies' : 'voice off'); if (S.voiceOn) speak('Okay. I\'ll talk.'); };
$('#st-demo').onclick = () => { S.demo = !S.demo; refreshStatus(); renderAgents(S.fixers); toast(S.demo ? 'demo brain — scripted replies' : 'talking to the real Oracle'); };
$('#st-clear').onclick = () => tidy();
refreshStatus(); setInterval(refreshStatus, 6000);
async function refreshProjects() { try { const r = await fetch('/api/projects'); if (!r.ok) return; const list = await r.json(); S.projects = list; const saved = LS.get('project', null); const g = (saved && list.find((p) => p.name === saved)) || list.find((p) => p.kind === 'game') || list[0]; if (g) S.project = g.name; const pl = []; for (const p of list.filter((x) => x.kind === 'game')) { try { const ps = await fetch('/api/play?project=' + encodeURIComponent(p.name)).then((x) => x.json()); if (ps.playable) pl.push({ name: p.name, running: ps.running, url: ps.url }); } catch { /* skip */ } } S.playable = pl; } catch { /* offline */ } }
refreshProjects(); setInterval(refreshProjects, 60000);
if (S.demo) renderAgents([], {});

/* ------------------------------------------------------------------ contextual chips */
let chipsShown = false;
function chipSet(when) {
  const out = [];
  const fx = S.fixers || [];
  const staged = fx.filter((f) => /staged|review|ready/i.test(f.status)).length;
  const running = fx.filter((f) => /running|queued/i.test(f.status)).length;
  const proj = S.project || 'shipless';
  if (staged) out.push({ label: staged + ' fix' + (staged > 1 ? 'es' : '') + ' waiting for review', text: 'what\'s staged for review?' });
  if (running) out.push({ label: running + ' fixer' + (running > 1 ? 's' : '') + ' working', text: 'how are the fixers doing?' });
  const h = new Date().getHours();
  if (S.link === 'offline' && !S.demo && when !== 'after') { out.unshift({ label: 'wake the gateway', text: '__wake' }, { label: 'use the demo brain', text: '__demo' }); }
  if (when === 'idle' || when === 'focus') {
    if (h < 11) out.push({ label: 'morning brief', text: 'give me my morning brief' });
    out.push({ label: 'what\'s new?', text: 'what\'s new since we last talked?' });
    for (const p of (S.playable || []).slice(0, 2)) out.push(p.running && p.url ? { label: p.name + ' is running — open', text: '/play ' + p.name + ' status' } : { label: 'play ' + p.name, text: '/play ' + p.name });
    out.push({ label: 'start a playtest', text: '/playtest ' + proj });
    out.push({ label: 'what were we doing?', text: 'remind me what we were working on and what\'s next' });
  } else if (when === 'after') {
    out.push({ label: 'go on', text: 'go on' });
    out.push({ label: 'show me', text: 'show me — give me a preview or the diff' });
  }
  return out.slice(0, 4);
}
function showChips(when) {
  if (S.busy) return;
  const set = chipSet(when);
  chipsEl.replaceChildren();
  set.forEach((c, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = c.label; b.onclick = () => chipRun(c.text); chipsEl.appendChild(b); setTimeout(() => b.classList.add('in'), 30 + i * 45); });
  chipsShown = true;
  clearTimeout(S.chipTimer); S.chipTimer = setTimeout(hideChips, when === 'after' ? 14000 : 30000);
}
function chipRun(text) { if (text === '__wake') { toast('launchctl kickstart -k gui/$(id -u)/com.oracle.gateway', 6000); return; } if (text === '__demo') { S.demo = true; refreshStatus(); toast('demo brain — scripted replies'); hideChips(); return; } send(text); }
function hideChips() { if (!chipsShown) return; chipsShown = false; for (const c of chipsEl.children) c.classList.remove('in'); setTimeout(() => { if (!chipsShown) chipsEl.replaceChildren(); }, 260); }

/* ------------------------------------------------------------------ pill */
function autosize() { ask.style.height = 'auto'; ask.style.height = Math.min(ask.scrollHeight, innerHeight * 0.38) + 'px'; layout(false); }
ask.addEventListener('input', () => { autosize(); if (ask.value.trim()) hideChips(); else if (document.activeElement === ask) showChips('focus'); activity(); });
ask.addEventListener('focus', () => { layout(false); const r = pill.getBoundingClientRect(); nibbi.lookAt(r.left + r.width * 0.35, r.top + r.height / 2); if (!ask.value.trim()) showChips('focus'); });
ask.addEventListener('blur', () => { layout(false); if (!S.busy) nibbi.lookFree(); });
ask.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); pill.requestSubmit(); }
  if (e.key === 'Escape') { if (ask.value) { ask.value = ''; autosize(); } else { ask.blur(); if (S.mode === 'talk' && !S.busy) tidy(); } }
});
pill.addEventListener('submit', (e) => { e.preventDefault(); if (S.busy) { if (S.abort) { S.abort.abort(); toast('stopped watching'); } return; } send(ask.value, pendingImages.slice()); });
addEventListener('keydown', (e) => {
  if (e.altKey && e.code === 'Space') { e.preventDefault(); toggleListen(); return; }
  if (e.key === 'Escape' && document.activeElement !== ask && S.mode === 'talk' && !S.busy) { tidy(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (document.activeElement !== ask && e.key.length === 1 && !e.repeat) { ask.focus(); }
});

/* images: paste or drop */
function addImage(file) {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || pendingImages.length >= 4) return;
  const rd = new FileReader(); rd.onload = () => { const data = String(rd.result).split(',')[1]; pendingImages.push({ media_type: file.type, data }); renderAttach(); }; rd.readAsDataURL(file);
}
function renderAttach() {
  attachEl.hidden = !pendingImages.length; attachEl.replaceChildren();
  pendingImages.forEach((im, i) => { const b = document.createElement('button'); b.type = 'button'; const img = document.createElement('img'); img.src = 'data:' + im.media_type + ';base64,' + im.data; b.appendChild(img); b.onclick = () => { pendingImages.splice(i, 1); renderAttach(); }; attachEl.appendChild(b); });
}
function clearAttach() { pendingImages = []; renderAttach(); }
document.addEventListener('paste', (e) => { for (const it of e.clipboardData?.items || []) if (it.kind === 'file') addImage(it.getAsFile()); });
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => { e.preventDefault(); for (const f of e.dataTransfer?.files || []) addImage(f); ask.focus(); });

/* ------------------------------------------------------------------ voice in (mic → /api/transcribe) */
let listening = false, rec = null, recChunks = [], audioCtx = null, meterRaf = 0, silenceAt = 0, heardSpeech = false;
micBtn.addEventListener('click', toggleListen);
async function toggleListen() { if (listening) stopListen(true); else startListen(); }
async function startListen() {
  if (S.busy) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    listening = true; pill.classList.add('listening'); listenEl.hidden = false; $('.heard', listenEl).textContent = 'listening…';
    nibbi.setMood('listening'); const r = pill.getBoundingClientRect(); nibbi.lookAt(r.left + r.width * 0.3, r.top);
    recChunks = []; rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm' });
    rec.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(recChunks, { type: 'audio/webm' });
      if (!listening && blob.size < 400) return;
      $('.heard', listenEl).textContent = 'hearing…';
      try {
        const res = await fetch('/api/transcribe', { method: 'POST', headers: { 'content-type': 'audio/webm' }, body: blob });
        const j = await res.json();
        endListenUI();
        if (j.heard) { ask.value = j.heard; autosize(); send(j.heard); } else toast('heard nothing');
      } catch { endListenUI(); toast(S.demo || S.link === 'offline' ? 'voice needs the real gateway (whisper lives there)' : 'could not transcribe'); }
    };
    rec.start(250);
    // level meter + silence auto-stop
    audioCtx = new (window.AudioContext || window.webkitAudioContext)(); const src = audioCtx.createMediaStreamSource(stream); const an = audioCtx.createAnalyser(); an.fftSize = 512; src.connect(an);
    const buf = new Uint8Array(an.frequencyBinCount); const bars = listenEl.querySelectorAll('.bars i'); silenceAt = performance.now(); heardSpeech = false;
    const tick = () => {
      if (!listening) return;
      an.getByteFrequencyData(buf); let sum = 0; for (let i = 2; i < 40; i++) sum += buf[i]; const lvl = Math.min(1, sum / (38 * 140));
      bars.forEach((b, i) => { b.style.transform = 'scaleY(' + (0.3 + lvl * (1.6 + Math.sin(performance.now() / 90 + i) * 0.8)).toFixed(2) + ')'; });
      nibbi.pulse(lvl * 0.5);
      if (lvl > 0.12) { heardSpeech = true; silenceAt = performance.now(); } else if (heardSpeech && performance.now() - silenceAt > 1400) { stopListen(true); return; }
      if (!heardSpeech && performance.now() - silenceAt > 8000) { stopListen(false); toast('heard nothing'); return; }
      meterRaf = requestAnimationFrame(tick);
    }; tick();
  } catch (e) { toast('microphone unavailable'); listening = false; }
}
function stopListen(keep) { if (!listening) return; listening = keep ? 'sending' : false; cancelAnimationFrame(meterRaf); try { rec && rec.state !== 'inactive' && rec.stop(); } catch { /* already */ } if (!keep) endListenUI(); }
function endListenUI() { listening = false; pill.classList.remove('listening'); listenEl.hidden = true; if (audioCtx) { audioCtx.close(); audioCtx = null; } if (!S.busy) { nibbi.setMood('idle'); nibbi.lookFree(); } }

/* ------------------------------------------------------------------ voice out (/api/say → kokoro) */
let speakingAudio = null;
async function speak(text) {
  if (!S.voiceOn || !text) return;
  if (S.demo || S.link === 'offline') { toast('voice needs the real gateway (kokoro lives there)'); return; }
  try {
    if (speakingAudio) { speakingAudio.pause(); speakingAudio = null; }
    const a = new Audio('/api/say?text=' + encodeURIComponent(text)); speakingAudio = a;
    const ctx = new (window.AudioContext || window.webkitAudioContext)(); const src = ctx.createMediaElementSource(a); const an = ctx.createAnalyser(); an.fftSize = 256; src.connect(an); an.connect(ctx.destination);
    const buf = new Uint8Array(an.frequencyBinCount);
    nibbi.setMood('speaking');
    const tick = () => { if (a.paused || a.ended) return; an.getByteTimeDomainData(buf); let s = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; s += v * v; } nibbi.pulse(Math.min(1, Math.sqrt(s / buf.length) * 6)); requestAnimationFrame(tick); };
    a.onplay = tick; a.onended = a.onerror = () => { ctx.close(); if (!S.busy && nibbi.mood() === 'speaking') nibbi.setMood('idle'); };
    await a.play();
  } catch { /* autoplay blocked or no kokoro */ }
}

/* ------------------------------------------------------------------ boot */
nibbi.setReducedMotion(reducedMotion.matches); reducedMotion.addEventListener('change', (e) => nibbi.setReducedMotion(e.matches));
if (location.protocol.startsWith('http')) { try { const es = new EventSource('/nibbi/livereload'); es.onmessage = () => location.reload(); } catch { /* no live reload */ } }
if (Q.get('say')) { setTimeout(() => send(Q.get('say')), 300); }
try { if (window.__TAURI__ && window.__TAURI__.event) { window.__TAURI__.event.listen('toggle-live', () => toggleListen()); } } catch { /* browser */ }
document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a[href]'); if (!a) return; if (window.__TAURI__ && /^https?:/i.test(a.href)) { e.preventDefault(); fetch('/api/open?url=' + encodeURIComponent(a.href)).catch(() => window.open(a.href, '_blank')); } });
window.nibbi = nibbi; window.nibbiApp = { send, tidy, state: () => S, layout };
})();

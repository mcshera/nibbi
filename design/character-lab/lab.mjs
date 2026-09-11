// Character lab shell: loads the five option modules, drives one clock, renders each at three sizes.
// Nothing here touches the app. Deterministic seek API on window.characterLab for the browser checks.
import { ACTIONS, ACTION_IDS, SIZES, isLoop } from './actions.mjs';
import * as ink from './ink.mjs';

const OPTION_IDS = ['inkdrop', 'sumi', 'cutout', 'sketch', 'glyph'];
const TINT = '#7a4b2a'; // the brown fixer from the app's companion palette
const STAGE = { w: 3.4, h: 3.6, footX: 1.7, footY: 3.1 }; // in R units (matches CONTRACT.md)
const HERO_R = 96, PILL_R = 26, TINY_R = 12;
const dpr = Math.min(2, window.devicePixelRatio || 1);
const $ = s => document.querySelector(s);

const state = {
  action: 'idle', start: 0, paused: false, pausedAt: 0, scrubbing: false, energy: 1, speed: 1, tinted: false, loop: true,
  reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, tour: null, now: 0, clock: 0,
};
const cards = [];
const paperCache = new Map();
function paperFor(w, h) { const k = `${w}x${h}`; if (paperCache.has(k)) return paperCache.get(k); const c = document.createElement('canvas'); c.width = w * dpr; c.height = h * dpr; const ctx = c.getContext('2d'); ctx.scale(dpr, dpr); ink.paper(ctx, w, h, { grain: .06, seed: w }); paperCache.set(k, c); return c; }

function setupCanvas(canvas, R) {
  const w = Math.round(STAGE.w * R), h = Math.round(STAGE.h * R);
  canvas.width = w * dpr; canvas.height = h * dpr; canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  if (R === HERO_R) { canvas.style.width = '100%'; canvas.style.aspectRatio = `${w} / ${h}`; }
  return { canvas, ctx: canvas.getContext('2d'), R, w, h, footX: STAGE.footX * R, footY: STAGE.footY * R };
}
function draw(surface, mod, s, { tint = null, size, reduced, time }) {
  const { ctx, w, h, R, footX, footY } = surface;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.drawImage(paperFor(w, h), 0, 0, w, h);
  mod.render(ctx, s, { R, footX, footY, time, reduced, tint, size });
}

async function load() {
  const studies = $('#studies'), tpl = $('#study-template');
  const mods = await Promise.all(OPTION_IDS.map(id => import(`./options/${id}.mjs`).then(m => ({ id, m })).catch(error => ({ id, error }))));
  mods.forEach(({ id, m, error }, i) => {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.option = id;
    node.querySelector('.study-number').textContent = `0${i + 1}`;
    if (error) { node.querySelector('.study-name').textContent = id; node.querySelector('.study-tagline').textContent = `failed to load: ${error.message}`; studies.appendChild(node); return; }
    node.querySelector('.study-name').textContent = m.meta.name;
    node.querySelector('.study-tagline').textContent = m.meta.tagline;
    node.querySelector('.material').textContent = m.meta.material;
    node.querySelector('.grammar').textContent = m.meta.grammar;
    node.querySelector('.feeling').textContent = m.meta.feeling;
    const ul = node.querySelector('.risks ul'); for (const r of m.meta.risks || []) { const li = document.createElement('li'); li.textContent = r; ul.appendChild(li); }
    const short = node.querySelector('.shortlist input'); short.checked = localStorage.getItem(`nibbi-character-lab:${id}`) === '1';
    short.addEventListener('change', () => localStorage.setItem(`nibbi-character-lab:${id}`, short.checked ? '1' : '0'));
    studies.appendChild(node);
    cards.push({ id, mod: m, node, hero: setupCanvas(node.querySelector('canvas.hero'), HERO_R), pill: setupCanvas(node.querySelector('canvas.pill'), PILL_R), tiny: setupCanvas(node.querySelector('canvas.tiny'), TINY_R), companion: setupCanvas(node.querySelector('canvas.companion'), PILL_R), phase: node.querySelector('.phase'), time: node.querySelector('.time'), start: 0, action: 'idle' });
  });
  const actions = $('#actions');
  ACTIONS.forEach((a, i) => { const b = document.createElement('button'); b.dataset.action = a.id; b.setAttribute('aria-pressed', String(a.id === 'idle')); b.title = a.note; b.innerHTML = `<kbd>${i + 1}</kbd>${a.label}`; b.addEventListener('click', () => cue(a.id)); actions.appendChild(b); });
  const sel = $('#moment-select'); ACTIONS.forEach((a, i) => { const o = document.createElement('option'); o.value = a.id; o.textContent = `${i + 1} · ${a.label}`; sel.appendChild(o); }); sel.addEventListener('change', () => cue(sel.value));
  buildChatStrip();
}

const COPY = [
  'merged 8.2 — the diff viewer now blocks consecutive adds and deletes',
  'listening. say the bug the way you would tell a friend',
  'thinking about the plan — three milestones left, two look parallel',
  'fixer 2 is on the tests; I will post when it lands',
  'that one failed at 80 turns. the worktree is kept, nothing merged',
];
function buildChatStrip() {
  const rows = $('#chat-rows');
  cards.forEach((c, i) => {
    const row = document.createElement('div'); row.className = 'row';
    const canvas = document.createElement('canvas'); const surf = setupCanvas(canvas, TINY_R); canvas.style.width = surf.w + 'px'; canvas.style.height = surf.h + 'px';
    const body = document.createElement('div'); body.style.minWidth = '0';
    body.innerHTML = `<div class="who">NIBBI <span class="badge">${c.mod.meta.name.toUpperCase()}</span></div><div class="txt">${COPY[i % COPY.length]}</div>`;
    row.appendChild(canvas); row.appendChild(body); rows.appendChild(row);
    c.strip = surf; c.stripTint = null;
  });
  // a tinted fixer row for each option too, so companions are judged at 24 px in context
  cards.forEach((c, i) => {
    const row = document.createElement('div'); row.className = 'row';
    const canvas = document.createElement('canvas'); const surf = setupCanvas(canvas, TINY_R); canvas.style.width = surf.w + 'px'; canvas.style.height = surf.h + 'px';
    const body = document.createElement('div'); body.style.minWidth = '0';
    body.innerHTML = `<div class="who" style="color:${TINT}">FIXER 2 <span class="badge">${c.mod.meta.name.toUpperCase()} · TINTED</span></div><div class="txt">staged a-fix-diff-viewer · 3 files · verify passed</div>`;
    row.appendChild(canvas); row.appendChild(body); rows.appendChild(row);
    c.stripFixer = surf;
  });
}
function cue(action, { fromTour = false } = {}) {
  if (!fromTour && state.tour) stopTour();
  state.action = action; state.start = state.clock; state.scrubbing = false;
  for (const c of cards) { c.action = action; c.start = state.clock; }
  for (const b of document.querySelectorAll('#actions button')) b.setAttribute('aria-pressed', String(b.dataset.action === action));
  $('#moment-select').value = action;
  $('#bench-note').textContent = ACTIONS.find(a => a.id === action)?.note || '';
  if (state.paused) render();
}
function elapsedFor(card) { return Math.max(0, state.clock - card.start); }
function stateFor(card, t, { reduced = state.reduced, energy = state.energy } = {}) {
  const mod = card.mod; let action = card.action; const d = mod.durationFor(action);
  if (!isLoop(action)) {
    if (t >= d) { // one-shot finished → this card rests
      if (!state.scrubbing) { card.action = 'idle'; card.start = state.clock - (t - d); action = 'idle'; t = t - d; }
      else t = d;
    }
  } else if (!state.loop && t >= d) { t = d; }
  const dd = mod.durationFor(action);
  return { action, t, u: dd ? Math.min(1, t / dd) : 0, s: mod.sample(action, isLoop(action) ? t % dd : t, { energy, reduced }) };
}
function render() {
  const time = state.reduced ? 0 : state.clock;
  let allRested = true;
  for (const c of cards) {
    const { action, t, u, s } = stateFor(c, elapsedFor(c));
    if (action !== 'idle') allRested = false;
    draw(c.hero, c.mod, s, { size: 'hero', reduced: state.reduced, time });
    draw(c.pill, c.mod, s, { size: 'pill', reduced: state.reduced, time });
    draw(c.tiny, c.mod, s, { size: 'tiny', reduced: state.reduced, time });
    c.node.querySelector('.size.tinted').style.display = state.tinted ? '' : 'none';
    if (state.tinted) draw(c.companion, c.mod, s, { size: 'pill', reduced: state.reduced, time, tint: TINT });
    c.phase.textContent = state.reduced ? `${action} · still` : (s.phase && s.phase !== action && s.phase !== 'rest' ? `${action} · ${s.phase}` : action);
    if (c.strip) draw(c.strip, c.mod, s, { size: 'tiny', reduced: state.reduced, time });
    if (c.stripFixer) draw(c.stripFixer, c.mod, s, { size: 'tiny', reduced: state.reduced, time, tint: TINT });
    c.time.textContent = `${Math.round(u * 100)}%`;
  }
  if (allRested && state.action !== 'idle' && !state.scrubbing) { // all one-shots finished
    state.action = 'idle'; for (const b of document.querySelectorAll('#actions button')) b.setAttribute('aria-pressed', String(b.dataset.action === 'idle'));
  }
  const first = cards[0]; if (first) { const d = first.mod.durationFor(state.action === 'idle' ? 'idle' : first.action); const u = Math.min(1, elapsedFor(first) / d); if (!state.scrubbing) { $('#scrub').value = String(Math.round((isLoop(first.action) ? (elapsedFor(first) % d) / d : u) * 1000)); $('#scrub-value').textContent = `${Math.round(Number($('#scrub').value) / 10)}%`; } }
}
let last = performance.now();
function frame(now) {
  const dt = Math.min(.1, (now - last) / 1000); last = now;
  if (!state.paused && !state.scrubbing) state.clock += dt * state.speed;
  render(); requestAnimationFrame(frame);
}

// ---- tour --------------------------------------------------------------
const TOUR = [['hello', 2.2], ['listen', 3.5], ['think', 4], ['work', 5], ['success', 2.6], ['error', 2.4], ['sleep', 4], ['idle', 0]];
function playTour() {
  stopTour(); let i = 0; state.tour = { timer: null };
  const step = () => { if (!state.tour) return; const [a, hold] = TOUR[i++]; cue(a, { fromTour: true }); if (i < TOUR.length) state.tour.timer = setTimeout(step, hold * 1000 / state.speed); else state.tour = null; $('#tour').textContent = state.tour ? 'Touring…' : 'Play the tour ↗'; };
  step();
}
function stopTour() { if (state.tour?.timer) clearTimeout(state.tour.timer); state.tour = null; $('#tour').textContent = 'Play the tour ↗'; }

// ---- wiring ---------------------------------------------------------------
await load();
if (matchMedia('(max-width: 640px)').matches) $('#more').removeAttribute('open');
$('#tour').addEventListener('click', playTour);
$('#pause').addEventListener('click', () => { state.paused = !state.paused; $('#pause').textContent = state.paused ? 'Resume' : 'Pause'; $('#pause').setAttribute('aria-pressed', String(state.paused)); if (!state.paused) state.scrubbing = false; });
$('#energy').addEventListener('input', e => { state.energy = Number(e.target.value); $('#energy-value').textContent = `${state.energy.toFixed(2)}×`; });
$('#speed').addEventListener('change', e => { state.speed = Number(e.target.value); });
const reducedBox = $('#reduced'); reducedBox.checked = state.reduced; document.body.classList.toggle('reduced', state.reduced);
reducedBox.addEventListener('change', () => { state.reduced = reducedBox.checked; document.body.classList.toggle('reduced', state.reduced); });
$('#tinted').checked = state.tinted; $('#tinted').addEventListener('change', e => { state.tinted = e.target.checked; });
$('#loop').addEventListener('change', e => { state.loop = e.target.checked; });
const scrub = $('#scrub');
scrub.addEventListener('input', () => { state.scrubbing = true; stopTour(); const f = Number(scrub.value) / 1000; for (const c of cards) { if (c.action === 'idle' && state.action !== 'idle') c.action = state.action; c.start = state.clock - c.mod.durationFor(c.action) * f; } $('#scrub-value').textContent = `${Math.round(f * 100)}%`; });
scrub.addEventListener('change', () => { if (!state.paused) { /* resume from the scrubbed point */ state.scrubbing = false; } });
document.addEventListener('keydown', e => {
  if (e.target.matches('input,select,textarea')) return;
  const n = Number(e.key); if (n >= 1 && n <= ACTIONS.length) { cue(ACTIONS[n - 1].id); e.preventDefault(); return; }
  if (e.key === ' ') { $('#pause').click(); e.preventDefault(); }
  if (e.key === 't') playTour();
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && state.paused) { scrub.value = String(Math.max(0, Math.min(1000, Number(scrub.value) + (e.key === 'ArrowRight' ? 10 : -10)))); scrub.dispatchEvent(new Event('input')); }
});
document.addEventListener('visibilitychange', () => { last = performance.now(); });
requestAnimationFrame(frame);

// ---- deterministic API for checks -------------------------------------------
window.characterLab = {
  get ready() { return cards.length === OPTION_IDS.length; },
  options: OPTION_IDS, actions: ACTIONS.map(a => ({ id: a.id, label: a.label })), sizes: SIZES,
  seek(action, fraction, { energy = 1, reduced = false, time = 0 } = {}) {
    state.paused = true; state.scrubbing = true; stopTour();
    const out = [];
    for (const c of cards) {
      c.action = action; const d = c.mod.durationFor(action); const t = d * Math.max(0, Math.min(1, fraction)); c.start = state.clock - t;
      const s = c.mod.sample(action, t, { energy, reduced });
      const g = {}; for (const key of ['hero', 'pill', 'tiny']) { const sf = c[key]; draw(sf, c.mod, s, { size: key, reduced, time }); g[key] = c.mod.geometry(s, { R: sf.R, footX: sf.footX, footY: sf.footY }); }
      draw(c.companion, c.mod, s, { size: 'pill', reduced, time, tint: TINT });
      out.push({ id: c.id, duration: d, state: s, geometry: g });
    }
    return { action, fraction, options: out };
  },
  stillAt(id, action) { const c = cards.find(c => c.id === id); return c?.mod.stillAt?.[action] ?? .45; },
  seekStill(id, action, { energy = 1, reduced = false, time = 0 } = {}) {
    state.paused = true; state.scrubbing = true; stopTour();
    const c = cards.find(c => c.id === id); const d = c.mod.durationFor(action); const t = d * this.stillAt(id, action); c.action = action; c.start = state.clock - t;
    const s = c.mod.sample(action, t, { energy, reduced });
    for (const key of ['hero', 'pill', 'tiny']) draw(c[key], c.mod, s, { size: key, reduced, time });
    return s;
  },
  resume() { state.paused = false; state.scrubbing = false; $('#pause').textContent = 'Pause'; },
  cue, setReduced(v) { reducedBox.checked = !!v; reducedBox.dispatchEvent(new Event('change')); },
  stageForR(R) { return { w: STAGE.w * R, h: STAGE.h * R, footX: STAGE.footX * R, footY: STAGE.footY * R }; },
};

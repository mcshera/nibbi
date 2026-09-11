// Round-2 shell: mounts live technique modules (simulation/filter/painter/shader) and drives them with one clock.
import { ACTIONS, ACTION_IDS } from '../actions.mjs';
const TECH_IDS = ['particles', 'softbody', 'svgink', 'brush', 'bead'];
const TINT = '#7a4b2a';
const HERO_R = 84, PILL_R = 26, TINY_R = 12;
const $ = s => document.querySelector(s);
const state = { paused: false, speed: 1, energy: 1, tinted: false, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, tour: null, action: 'idle' };
const cards = [];
const COPY = ['merged 8.2 — the diff viewer now blocks consecutive adds and deletes', 'listening. say the bug the way you would tell a friend', 'thinking about the plan — three milestones left, two look parallel', 'fixer 2 is on the tests; I will post when it lands', 'that one failed at 80 turns. the worktree is kept, nothing merged'];

async function load() {
  const studies = $('#studies'), tpl = $('#study-template'), rows = $('#chat-rows');
  const mods = await Promise.all(TECH_IDS.map(id => import(`./techniques/${id}.mjs`).then(m => ({ id, m })).catch(error => ({ id, error }))));
  mods.forEach(({ id, m, error }, i) => {
    const node = tpl.content.firstElementChild.cloneNode(true); node.dataset.option = id;
    node.querySelector('.study-number').textContent = `0${i + 1}`;
    if (error) { node.querySelector('.study-name').textContent = id; node.querySelector('.study-tagline').textContent = `failed to load: ${error.message}`; studies.appendChild(node); return; }
    node.querySelector('.study-name').textContent = m.meta.name; node.querySelector('.study-tagline').textContent = m.meta.tagline;
    node.querySelector('.technique-text').textContent = m.meta.technique;
    node.querySelector('.look').textContent = m.meta.look; node.querySelector('.motion').textContent = m.meta.motion; node.querySelector('.eyes').textContent = m.meta.eyes;
    const ul = node.querySelector('.risks ul'); for (const r of m.meta.risks || []) { const li = document.createElement('li'); li.textContent = r; ul.appendChild(li); }
    const short = node.querySelector('.shortlist input'); short.checked = localStorage.getItem(`nibbi-character-lab-r2:${id}`) === '1'; short.addEventListener('change', () => localStorage.setItem(`nibbi-character-lab-r2:${id}`, short.checked ? '1' : '0'));
    studies.appendChild(node);
    const card = { id, mod: m, node, phase: node.querySelector('.phase'), inst: {} };
    const mountSafe = (host, opts) => { try { return m.mount(host, opts); } catch (e) { console.error(id, e); return null; } };
    card.inst.hero = mountSafe(node.querySelector('.host.hero'), { R: HERO_R, seed: 1, size: 'hero', reduced: state.reduced, energy: state.energy });
    card.inst.pill = mountSafe(node.querySelector('.host.pill'), { R: PILL_R, seed: 1, size: 'pill', reduced: state.reduced });
    card.inst.tiny = mountSafe(node.querySelector('.host.tiny'), { R: TINY_R, seed: 1, size: 'tiny', reduced: state.reduced });
    card.inst.companion = mountSafe(node.querySelector('.host.companion'), { R: PILL_R, seed: 2, size: 'pill', tint: TINT, reduced: state.reduced });
    // chat strip rows: plain + tinted
    for (const [who, copy, tint] of [[`NIBBI <span class="badge">${m.meta.name.toUpperCase()}</span>`, COPY[i % COPY.length], null], [`<span style="color:${TINT}">FIXER 2</span> <span class="badge">${m.meta.name.toUpperCase()} · TINTED</span>`, 'staged a-fix-diff-viewer · 3 files · verify passed', TINT]]) {
      const row = document.createElement('div'); row.className = 'row'; const host = document.createElement('div'); host.className = 'strip-host'; const body = document.createElement('div'); body.style.minWidth = '0';
      body.innerHTML = `<div class="who">${who}</div><div class="txt">${copy}</div>`; row.appendChild(host); row.appendChild(body); rows.appendChild(row);
      const inst = mountSafe(host, { R: TINY_R, seed: 3, size: 'tiny', tint, reduced: state.reduced }); card.inst[tint ? 'stripFixer' : 'strip'] = inst;
    }
    cards.push(card);
  });
  const actions = $('#actions');
  ACTIONS.forEach((a, i) => { const b = document.createElement('button'); b.dataset.action = a.id; b.setAttribute('aria-pressed', String(a.id === 'idle')); b.title = a.note; b.innerHTML = `<kbd>${i + 1}</kbd>${a.label}`; b.addEventListener('click', () => cue(a.id)); actions.appendChild(b); });
  const sel = $('#moment-select'); ACTIONS.forEach((a, i) => { const o = document.createElement('option'); o.value = a.id; o.textContent = `${i + 1} · ${a.label}`; sel.appendChild(o); }); sel.addEventListener('change', () => cue(sel.value));
}
function each(fn) { for (const c of cards) for (const k of Object.keys(c.inst)) if (c.inst[k]) { try { fn(c.inst[k], c, k); } catch (e) { console.error(c.id, k, e); c.inst[k] = null; } } }
function cue(action, { fromTour = false } = {}) {
  if (!fromTour && state.tour) stopTour();
  state.action = action; each(inst => inst.cue(action));
  for (const b of document.querySelectorAll('#actions button')) b.setAttribute('aria-pressed', String(b.dataset.action === action));
  $('#moment-select').value = action; $('#bench-note').textContent = ACTIONS.find(a => a.id === action)?.note || '';
  for (const c of cards) c.phase.textContent = action;
}
let last = performance.now(), acc = 0, frames = 0;
function frame(now) {
  const dt = Math.min(.1, (now - last) / 1000); last = now;
  if (!state.paused) { const t0 = performance.now(); each(inst => inst.step(dt * state.speed)); acc += performance.now() - t0; frames++; if (frames >= 30) { $('#fps').textContent = `${(acc / frames).toFixed(1)} ms/frame all instances`; acc = 0; frames = 0; } }
  requestAnimationFrame(frame);
}
const TOUR = [['hello', 2.2], ['listen', 3.5], ['think', 4], ['work', 5], ['success', 2.6], ['error', 2.4], ['sleep', 4], ['idle', 0]];
function playTour() { stopTour(); let i = 0; state.tour = { timer: null }; const step = () => { if (!state.tour) return; const [a, hold] = TOUR[i++]; cue(a, { fromTour: true }); if (i < TOUR.length) state.tour.timer = setTimeout(step, hold * 1000 / state.speed); else state.tour = null; $('#tour').textContent = state.tour ? 'Touring…' : 'Play the tour ↗'; }; step(); }
function stopTour() { if (state.tour?.timer) clearTimeout(state.tour.timer); state.tour = null; $('#tour').textContent = 'Play the tour ↗'; }

await load();
if (matchMedia('(max-width: 640px)').matches) $('#more').removeAttribute('open');
$('#tour').addEventListener('click', playTour);
$('#pause').addEventListener('click', () => { state.paused = !state.paused; $('#pause').textContent = state.paused ? 'Resume' : 'Pause'; $('#pause').setAttribute('aria-pressed', String(state.paused)); });
$('#energy').addEventListener('input', e => { state.energy = Number(e.target.value); $('#energy-value').textContent = `${state.energy.toFixed(2)}×`; each(inst => inst.setEnergy(state.energy)); });
$('#speed').addEventListener('change', e => { state.speed = Number(e.target.value); });
const reducedBox = $('#reduced'); reducedBox.checked = state.reduced; reducedBox.addEventListener('change', () => { state.reduced = reducedBox.checked; each(inst => inst.setReduced(state.reduced)); });
$('#tinted').checked = state.tinted; for (const c of cards) c.node.querySelector('.size.tinted').style.display = state.tinted ? '' : 'none';
$('#tinted').addEventListener('change', e => { state.tinted = e.target.checked; for (const c of cards) c.node.querySelector('.size.tinted').style.display = state.tinted ? '' : 'none'; });
document.addEventListener('keydown', e => { if (e.target.matches('input,select,textarea')) return; const n = Number(e.key); if (n >= 1 && n <= ACTIONS.length) { cue(ACTIONS[n - 1].id); e.preventDefault(); return; } if (e.key === ' ') { $('#pause').click(); e.preventDefault(); } if (e.key === 't') playTour(); });
document.addEventListener('visibilitychange', () => { last = performance.now(); });
requestAnimationFrame(frame);

window.techLab = {
  get ready() { return cards.length === TECH_IDS.length; }, techniques: TECH_IDS, actions: ACTIONS.map(a => ({ id: a.id, label: a.label })),
  cue, pause(v) { state.paused = v; }, step(dt) { each(inst => inst.step(dt)); }, setReduced(v) { reducedBox.checked = !!v; reducedBox.dispatchEvent(new Event('change')); },
  loaded: () => cards.map(c => ({ id: c.id, hero: !!c.inst.hero, pill: !!c.inst.pill, tiny: !!c.inst.tiny })),
};

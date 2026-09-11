import { STYLES, ACTIONS, sampleMotion, durationFor, neutralPose } from './motion.mjs';
import { InkRenderer } from './renderer.mjs';

const $ = s => document.querySelector(s);
const ids = ['elastic', 'liquid', 'mischief'];
const names = { elastic: 'Pocket spring', liquid: 'Living ink', mischief: 'Little oddball' };
const media = matchMedia('(prefers-reduced-motion: reduce)');
const params = new URLSearchParams(location.search);
const state = { action: 'idle', elapsed: 0, clock: 0, speed: 1, intensity: 1, targetIntensity: 1, reduced: media.matches,
  paused: false, loop: false, texture: 'flow', inspection: null, queue: [], transition: null, transitionAge: 0, frames: 0 };
let shortlist = new Set(['elastic']);
try { const saved = JSON.parse(localStorage.getItem('nibbi-motion-shortlist')); if (Array.isArray(saved)) shortlist = new Set(saved.filter(id => ids.includes(id))); } catch {}
const cards = [...document.querySelectorAll('.study')].map(el => ({ el, id: el.dataset.style,
  renderer: new InkRenderer(el.querySelector('canvas'), { force2D: params.has('2d') }),
  phaseEl: el.querySelector('.phase'), progressEl: el.querySelector('.timeline i'), visible: true, last: neutralPose() }));
let raf = 0, lastNow = 0, destroyed = false;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const maxDuration = () => Math.max(...ids.map(id => durationFor(id, state.action)));
const message = text => { if ($('#status').textContent !== text) $('#status').textContent = text; };
const isActive = () => state.action !== 'idle' && state.elapsed < maxDuration() && state.inspection === null;

function reflect() {
  for (const b of document.querySelectorAll('[data-action]')) b.setAttribute('aria-pressed', String(b.dataset.action === state.action));
  $('#pause').textContent = state.paused ? 'Resume' : 'Pause';
  $('#pause').setAttribute('aria-pressed', String(state.paused));
  $('#intensity').value = state.targetIntensity;
  $('#intensity-value').value = `${state.targetIntensity.toFixed(2)}×`;
  $('#speed').value = state.speed;
  $('#texture').value = state.texture;
  $('#reduced').checked = state.reduced;
  $('#loop').checked = state.loop;
  $('#reel').innerHTML = state.queue.length ? 'Playing the comparison <span aria-hidden="true">↗</span>' : 'Play the comparison <span aria-hidden="true">↗</span>';
}
function reflectShortlist() {
  for (const c of cards) { const selected = shortlist.has(c.id), button = c.el.querySelector('.choose'); button.setAttribute('aria-pressed', String(selected)); button.innerHTML = selected ? 'Shortlisted <span aria-hidden="true">✓</span>' : 'Shortlist this direction <span aria-hidden="true">＋</span>'; }
  $('#selection').textContent = `Your shortlist: ${ids.filter(id => shortlist.has(id)).map(id => names[id]).join(' + ') || 'none yet'}. Saved only in this browser.`;
}
function blend(a, b, t) {
  const u = t * t * t * (t * (t * 6 - 15) + 10), p = { ...b };
  for (const key of Object.keys(b)) if (typeof b[key] === 'number') p[key] = a[key] + (b[key] - a[key]) * u;
  // Preserve the scale-area constraint while blending between inspected poses.
  p.sx = 1 / p.sy;
  return p;
}
function start(action, { queue = [], blendFromCurrent = true } = {}) {
  if (!ACTIONS.some(a => a.id === action)) throw new Error(`Unknown action: ${action}`);
  state.transition = blendFromCurrent && !state.reduced ? Object.fromEntries(cards.map(c => [c.id, { ...c.last }])) : null;
  state.transitionAge = 0; state.elapsed = 0; state.inspection = null; state.action = action;
  state.paused = false; state.queue = queue;
  message(state.reduced ? 'Reduced motion: no jumps, morphs, moving ink, or looping animation. The status text still acknowledges the cue.' : `${ACTIONS.find(a => a.id === action).label}: same cue, three interpretations. Scrub to pause and inspect.`);
  reflect(); render(true); schedule();
}
function play(action) {
  if (action !== 'idle' && isActive() && !state.paused && !state.reduced) {
    state.queue = [action]; reflect(); message(`${ACTIONS.find(a => a.id === action)?.label || action} queued. Nibbi finishes this gesture first, so the body does not snap.`);
  } else start(action);
}
function render(force = false) {
  const duration = maxDuration();
  let progress = state.inspection !== null ? state.inspection : state.action === 'idle' ? 0 : clamp(state.elapsed / duration, 0, 1);
  for (const c of cards) {
    const ownDuration = durationFor(c.id, state.action);
    const t = state.inspection !== null ? ownDuration * state.inspection : state.elapsed;
    let action = state.action, sampleTime = t;
    if (state.inspection === null && state.action !== 'idle' && state.elapsed >= duration) { action = 'idle'; sampleTime = state.elapsed - duration; }
    let pose = sampleMotion(c.id, action, sampleTime, { intensity: state.intensity, reduced: state.reduced });
    if (state.transition && state.transitionAge < .18 && !state.reduced) pose = blend(state.transition[c.id], pose, state.transitionAge / .18);
    c.last = pose;
    if (c.visible || force) c.renderer.render(pose, { time: state.clock, texture: state.texture, reduced: state.reduced });
    const phase = state.reduced ? 'Still · calm' : pose.phase.replace(/[-_]/g, ' ');
    if (c.phaseEl.textContent !== phase) c.phaseEl.textContent = phase;
    c.progressEl.style.width = `${state.action === 'idle' ? 0 : (state.inspection !== null ? progress : clamp(t / ownDuration, 0, 1)) * 100}%`;
    const backend = c.renderer.info().backend === 'webgl' ? 'WEBGL INK' : '2D FALLBACK';
    if (c.el.querySelector('.backend').textContent !== backend) c.el.querySelector('.backend').textContent = backend;
  }
  $('#scrub').value = Math.round(progress * 1000);
  $('#scrub-mobile').value = Math.round(progress * 1000);
  $('#scrub-value').textContent = `${Math.round(progress * 100)}%`;
  state.frames++;
}
function tick(now) {
  raf = 0;
  if (destroyed || document.hidden || state.paused || state.reduced) { lastNow = 0; return; }
  const dt = lastNow ? Math.max(0, (now - lastNow) / 1000) : 0; lastNow = now;
  state.elapsed += dt * state.speed; state.clock += dt * state.speed; state.transitionAge += dt;
  state.intensity += (state.targetIntensity - state.intensity) * (1 - Math.exp(-dt * 12));
  if (state.transitionAge >= .18) state.transition = null;
  if (state.action !== 'idle' && state.elapsed >= maxDuration()) {
    if (state.queue.length) { const [next, ...rest] = state.queue; start(next, { queue: rest, blendFromCurrent: false }); }
    else if (state.loop) start(state.action, { blendFromCurrent: false });
  }
  render(); schedule();
}
function schedule() { if (!raf && !destroyed && !state.paused && !state.reduced && !document.hidden) raf = requestAnimationFrame(tick); }
function halt() { if (raf) cancelAnimationFrame(raf); raf = 0; lastNow = 0; }
function pause(value = !state.paused) {
  state.paused = value; halt();
  if (!value && state.inspection !== null) {
    // Cards have different durations; restart together with a short pose blend instead of desynchronizing.
    start(state.action); message('Replaying together from the start after inspection.'); return;
  }
  reflect(); render(true); schedule();
}
function reduced(value) {
  state.reduced = !!value; state.queue = []; state.transition = null; halt();
  message(value ? 'Reduced motion: no jumps, morphs, moving ink, or looping animation. The status text still acknowledges the cue.' : 'Full motion restored. Try Jump or Shapeshift.');
  reflect(); render(true); schedule();
}
function seek(action, fraction, options = {}) {
  if (!ACTIONS.some(a => a.id === action)) throw new Error(`Unknown action: ${action}`);
  state.action = action; state.inspection = clamp(Number(fraction) || 0, 0, 1); state.paused = true; state.queue = []; state.transition = null;
  if (options.intensity !== undefined) state.intensity = state.targetIntensity = clamp(Number(options.intensity) || 0, 0, 1.5);
  if (options.reduced !== undefined) state.reduced = !!options.reduced;
  if (options.texture) state.texture = options.texture === 'boil' ? 'boil' : 'flow';
  state.clock = options.time ?? state.inspection * maxDuration();
  halt(); reflect(); render(true); return snapshot();
}
// Deterministic absolute-time sampling for evidence export. This is a lab API, not app state wiring.
function atTime(action, seconds, options = {}) {
  if (!ACTIONS.some(a => a.id === action)) throw new Error(`Unknown action: ${action}`);
  state.action = action; state.elapsed = Math.max(0, Number(seconds) || 0); state.inspection = null;
  state.paused = true; state.queue = []; state.transition = null;
  if (options.intensity !== undefined) state.intensity = state.targetIntensity = clamp(Number(options.intensity) || 0, 0, 1.5);
  if (options.reduced !== undefined) state.reduced = !!options.reduced;
  if (options.texture) state.texture = options.texture === 'boil' ? 'boil' : 'flow';
  state.clock = options.time ?? state.elapsed; halt(); reflect(); render(true); return snapshot();
}
function snapshot() { return { ...state, transition: undefined, styles: cards.map(c => ({ id: c.id, pose: { ...c.last }, renderer: c.renderer.info() })) }; }
function onVisibility() { halt(); if (!document.hidden) { render(true); schedule(); } }
function onMedia(event) { reduced(event.matches); }

$('#actions').addEventListener('click', event => { const button = event.target.closest('[data-action]'); if (button) play(button.dataset.action); });
$('#reel').addEventListener('click', () => { $('.bench').scrollIntoView({ block: 'start', behavior: 'instant' }); state.loop = false; start('hop', { queue: state.reduced ? [] : ['morph', 'hello', 'success'] }); });
$('#pause').addEventListener('click', () => pause());
$('#loop').addEventListener('change', event => { state.loop = event.target.checked; if (state.loop && !state.paused && state.action !== 'idle' && !isActive()) start(state.action); });
$('#speed').addEventListener('change', event => { state.speed = Number(event.target.value); });
$('#texture').addEventListener('change', event => { state.texture = event.target.value; render(true); });
$('#reduced').addEventListener('change', event => reduced(event.target.checked));
$('#intensity').addEventListener('input', event => { state.targetIntensity = Number(event.target.value); $('#intensity-value').value = `${state.targetIntensity.toFixed(2)}×`; if (state.paused || state.reduced) { state.intensity = state.targetIntensity; render(true); } });
for (const slider of [$('#scrub'), $('#scrub-mobile')]) slider.addEventListener('input', event => { seek(state.action === 'idle' ? 'hop' : state.action, Number(event.target.value) / 1000); message('Inspection paused. Each card shows the same percentage of its own gesture. Resume replays from the start.'); });
for (const c of cards) c.el.querySelector('.choose').addEventListener('click', () => {
  if (shortlist.has(c.id)) shortlist.delete(c.id); else shortlist.add(c.id);
  try { localStorage.setItem('nibbi-motion-shortlist', JSON.stringify([...shortlist])); } catch {}
  reflectShortlist();
});
const resizeObserver = new ResizeObserver(() => { for (const c of cards) c.renderer.resize(); render(true); });
for (const c of cards) resizeObserver.observe(c.el.querySelector('.stage'));
const intersectionObserver = new IntersectionObserver(entries => { for (const entry of entries) { const c = cards.find(c => c.el === entry.target); if (c) { c.visible = entry.isIntersecting; if (c.visible) c.renderer.render(c.last, { time: state.clock, texture: state.texture, reduced: state.reduced }); } } });
for (const c of cards) intersectionObserver.observe(c.el);
media.addEventListener('change', onMedia); document.addEventListener('visibilitychange', onVisibility);
function destroy() { destroyed = true; halt(); resizeObserver.disconnect(); intersectionObserver.disconnect(); media.removeEventListener('change', onMedia); document.removeEventListener('visibilitychange', onVisibility); for (const c of cards) c.renderer.destroy(); }
// BFCache keeps the page alive: suspend there, destroy only on a real unload.
window.addEventListener('pagehide', event => { if (event.persisted) halt(); else destroy(); });
window.addEventListener('pageshow', event => { if (event.persisted && !destroyed) { render(true); schedule(); } });
window.motionLab = { ready: true, play, start, pause, reduced, seek, atTime, snapshot, destroy, styles: STYLES, actions: ACTIONS, durationFor, sampleMotion };
reflectShortlist(); reflect(); render(true); schedule();
if (state.reduced) message('Your system requests reduced motion. Nibbi stays still; the status text still acknowledges cues.');

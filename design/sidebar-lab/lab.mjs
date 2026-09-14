/** The lab shell: loads every option, gives each one a frame, and drives them all from one state axis.
    It never reaches inside an option — it calls the contract. window.sidebarLab is the deterministic
    surface the checks and the sheet drive. */
import { STATES, stateById, buildModel, FLAGS, FLAG_IDS, ENVIRONMENT, defaultFlags, DESKTOP, PHONE } from './states.mjs';
import { createFrame, stylesReady } from './chrome.mjs';

export const OPTION_IDS = ['_today', 'scope', 'peer', 'spine'];

const params = new URLSearchParams(location.search);
const bare = params.get('scale') === '1';
const only = params.get('only');
const frameParam = (params.get('frame') || '').match(/^(\d+)x(\d+)$/);
const DEFAULT_FRAME = frameParam
  ? { width: +frameParam[1], height: +frameParam[2], narrow: +frameParam[1] <= 899 }
  : { ...DESKTOP };
const ids = (only ? only.split(',') : OPTION_IDS).filter(Boolean);

let state = params.get('state') || 'home';
let flags = defaultFlags(false);
if (params.has('flags')) for (const id of params.get('flags').split(',').filter(Boolean)) if (id in flags) flags[id] = true;
if (params.get('flags') === 'all') flags = defaultFlags(true);
let env = { glass: params.get('glass') === '1', nativeMac: params.get('nativeMac') === '1', reduced: params.get('reduced') === '1' };

document.documentElement.classList.toggle('bare', bare);
document.documentElement.classList.toggle('reduced', env.reduced);

const studiesEl = document.getElementById('studies');
const phonesEl = document.getElementById('phones');
const noteEl = document.getElementById('bench-note');
const template = document.getElementById('study-template');
const studies = new Map();   // id -> { meta, card, desktop: {frame, inst}, phone: {...}, actionEl }
// In bare mode every frame is full size, so stacking them would push all but the first out of the
// viewport — and elementFromPoint, which the checks use to ask "could you actually click this?",
// only answers inside the viewport. So bare mode shows one at a time.
let shown = null;
function show(id) {
  if (!bare) return;
  shown = id;
  for (const [key, study] of studies) study.card?.classList.toggle('is-shown', key === id);
}
const actions = [];

function record(id, name, projectId, value) {
  actions.push({ option: id, name, projectId, value, state, at: Date.now() });
  const study = studies.get(id);
  if (study?.actionEl) study.actionEl.textContent = `${name}${projectId ? ' · ' + projectId : ''}${value != null ? ' · ' + value : ''}`;
  // Navigation really navigates, so the composer placeholder and the workspace follow a click the way
  // they would in the app. The model is per option — one design's clicking must not move the others.
  if (!study) return;
  const model = study.model;
  let moved = false;
  if (name === 'selectProject' && model.projects.some(p => p.id === projectId)) {
    model.activeProject = projectId;
    for (const p of model.projects) p.active = p.id === projectId;
    moved = true;
  } else if (name === 'thread') {
    model.activeProject = projectId;
    for (const p of model.projects) { p.active = p.id === projectId; for (const t of p.threads || []) t.active = p.id === projectId && t.id === value; }
    model.view = null; moved = true;
  } else if (name === 'projectSection' || name === 'repository') {
    model.activeProject = projectId; model.view = { project: projectId, section: value || 'repository' }; moved = true;
  } else if (name === 'lab:backToChat') { model.view = null; moved = true; }
  // Re-render without cueing: the option owns what it has opened, and a cue would close it.
  if (moved) syncOne(id, { cue: false });
}
function viewportFor(kind) {
  if (kind === 'phone') return { ...PHONE };
  const s = stateById(state);
  return s?.viewport ? { ...s.viewport } : { ...DEFAULT_FRAME };
}
function scaleFrame(slot) {
  const wrap = slot.frame.el.parentElement?.parentElement;
  if (!wrap) return;
  const vp = slot.viewport;
  const available = wrap.clientWidth || vp.width;
  const s = bare ? 1 : Math.min(1, available / vp.width);
  const scale = slot.frame.el.parentElement;
  scale.style.transform = `scale(${s})`;
  // The scaled frame still lays out at its natural size, so give the wrapper the painted size instead.
  scale.style.width = Math.round(vp.width * s) + 'px';
  scale.style.height = Math.round(vp.height * s) + 'px';
  wrap.style.height = Math.round(vp.height * s) + 'px';
}
function mountSafe(module, host, options) {
  try { return module.mount(host, options); }
  catch (error) { console.error(`[${options.id}] mount failed`, error); return null; }
}
function syncOne(id, { cue = true, rebuild = false } = {}) {
  const study = studies.get(id); if (!study) return;
  if (rebuild || !study.model) study.model = buildModel(state);
  const model = study.model;
  for (const kind of ['desktop', 'phone']) {
    const slot = study[kind]; if (!slot) continue;
    slot.viewport = viewportFor(kind);
    slot.frame.setContext({ model, state, flags, glass: env.glass, nativeMac: env.nativeMac, viewport: slot.viewport });
    if (slot.inst) {
      slot.inst.setViewport(slot.viewport);
      slot.inst.setFlags(flags);
      slot.inst.setReduced(env.reduced);
      slot.inst.setModel(model);
      if (cue) slot.inst.cue(state);
      slot.frame.sync();
    }
    scaleFrame(slot);
  }
}
function syncAll(options) {
  for (const id of studies.keys()) syncOne(id, { rebuild: true, ...options });
  const s = stateById(state);
  noteEl.textContent = s ? `${s.label.toUpperCase()} — ${s.note}` : '';
  for (const b of document.querySelectorAll('.state-button')) b.setAttribute('aria-pressed', String(b.dataset.state === state));
}

function buildBench() {
  const statesEl = document.getElementById('states');
  statesEl.replaceChildren(...STATES.map(s => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'state-button'; b.dataset.state = s.id;
    b.setAttribute('aria-pressed', String(s.id === state));
    b.append(Object.assign(document.createElement('span'), { textContent: s.label }),
      Object.assign(document.createElement('kbd'), { textContent: s.key }));
    b.addEventListener('click', () => { state = s.id; syncAll(); });
    return b;
  }));
  const flagsEl = document.getElementById('flags');
  flagsEl.replaceChildren(...FLAGS.map(f => toggle(f.label, f.note, flags[f.id], on => { flags = { ...flags, [f.id]: on }; syncAll({ cue: false }); })));
  const envEl = document.getElementById('environment');
  envEl.replaceChildren(...ENVIRONMENT.map(e => toggle(e.label, e.note, env[e.id], on => {
    env = { ...env, [e.id]: on };
    document.documentElement.classList.toggle('reduced', env.reduced);
    syncAll({ cue: false });
  })));
}
function toggle(label, note, value, onChange) {
  const wrap = document.createElement('label'); wrap.className = 'check-control'; wrap.title = note;
  const input = document.createElement('input'); input.type = 'checkbox'; input.checked = !!value;
  input.addEventListener('change', () => onChange(input.checked));
  const strong = document.createElement('strong'); strong.textContent = label;
  wrap.append(input, strong);
  return wrap;
}

async function build() {
  if (!bare) buildBench();
  const modules = await Promise.all(ids.map(async id => {
    try { return { id, module: await import(`./options/${id}.mjs`) }; }
    catch (error) { console.error(`[${id}] failed to load`, error); return { id, error }; }
  }));
  let index = 0;
  for (const entry of modules) {
    index++;
    const card = template.content.firstElementChild.cloneNode(true);
    const meta = entry.module?.meta || { id: entry.id, name: entry.id, tagline: 'failed to load' };
    card.dataset.option = entry.id;
    card.querySelector('.study-number').textContent = String(index).padStart(2, '0');
    card.querySelector('h2').textContent = meta.name || entry.id;
    card.querySelector('.tagline').textContent = meta.tagline || '';
    card.querySelector('.study-meta').textContent = meta.pattern || '';
    const actionEl = card.querySelector('.study-action');
    studiesEl.append(card);
    if (entry.error) {
      card.querySelector('.frame-wrap').replaceChildren(
        Object.assign(document.createElement('p'), { className: 'study-fail', textContent: `${entry.id} failed to load: ${entry.error.message}` }));
      continue;
    }
    const study = { meta, actionEl, card, model: buildModel(state) };
    studies.set(entry.id, study);
    const onAction = (name, projectId, value) => record(entry.id, name, projectId, value);
    // desktop
    const desktopViewport = viewportFor('desktop');
    const frame = createFrame({ viewport: desktopViewport, label: `${desktopViewport.width}×${desktopViewport.height}`, onAction });
    card.querySelector('.frame-scale').append(frame.el);
    study.desktop = { frame, viewport: desktopViewport, inst: null };
    study.desktop.inst = mountSafe(entry.module, frame.host, { id: entry.id, model: buildModel(state), state, viewport: desktopViewport, reduced: env.reduced, flags, onAction });
    // phone
    if (!bare) {
      const phoneCard = document.createElement('div'); phoneCard.className = 'phone'; phoneCard.dataset.option = entry.id;
      const label = document.createElement('div'); label.className = 'phone-label'; label.textContent = `${String(index).padStart(2, '0')} · ${meta.name || entry.id}`;
      const wrap = document.createElement('div'); wrap.className = 'frame-wrap'; wrap.style.width = '300px';
      const scale = document.createElement('div'); scale.className = 'frame-scale'; wrap.append(scale);
      phoneCard.append(label, wrap); phonesEl.append(phoneCard);
      const pf = createFrame({ viewport: { ...PHONE }, label: '390×844', onAction });
      scale.append(pf.el);
      study.phone = { frame: pf, viewport: { ...PHONE }, inst: null };
      study.phone.inst = mountSafe(entry.module, pf.host, { id: entry.id, model: buildModel(state), state, viewport: { ...PHONE }, reduced: env.reduced, flags, onAction });
    }
  }
  show(ids[0]);
  syncAll();
  const rescale = () => { for (const study of studies.values()) for (const kind of ['desktop', 'phone']) if (study[kind]) scaleFrame(study[kind]); };
  requestAnimationFrame(rescale);
  document.fonts?.ready.then(() => requestAnimationFrame(rescale));
  addEventListener('resize', () => { for (const study of studies.values()) for (const kind of ['desktop', 'phone']) if (study[kind]) scaleFrame(study[kind]); });
  addEventListener('keydown', event => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target.closest?.('.lab-frame, input, select, textarea')) return;
    const match = STATES.find(s => s.key === event.key);
    if (match) { event.preventDefault(); state = match.id; syncAll(); }
  });
  await stylesReady();
  rescale();
  window.sidebarLab.ready = true;
  document.documentElement.dataset.labReady = 'true';
}

window.sidebarLab = {
  ready: false,
  options: ids,
  states: STATES.map(s => ({ id: s.id, key: s.key, label: s.label })),
  flagIds: FLAG_IDS,
  get state() { return state; },
  get flags() { return { ...flags }; },
  get env() { return { ...env }; },
  cue(id) { state = id; syncAll(); },
  /** Bare mode only: bring one option into the viewport so it can be measured and hit-tested. */
  show(id) { show(id); return shown; },
  get shown() { return shown; },
  setFlags(next) { flags = { ...defaultFlags(false), ...next }; syncAll({ cue: false }); },
  setEnvironment(next) { env = { ...env, ...next }; document.documentElement.classList.toggle('reduced', env.reduced); syncAll({ cue: false }); },
  resync(options) { syncAll(options); },
  meta(id) { return studies.get(id)?.meta || null; },
  instance(id, kind = 'desktop') { return studies.get(id)?.[kind]?.inst || null; },
  hostEl(id, kind = 'desktop') { return studies.get(id)?.[kind]?.frame.host || null; },
  frameEl(id, kind = 'desktop') { return studies.get(id)?.[kind]?.frame.el || null; },
  viewportOf(id, kind = 'desktop') { return studies.get(id)?.[kind]?.viewport || null; },
  actions,
  clearActions() { actions.length = 0; },
};
build();

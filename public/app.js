import './platform.css';
import './margins.css';
import './voice.css';
import './project-workspace.css';
import './project-composer.css';
import { createWakeVoice } from './lib/wake-voice.js';
import { createMicCapture } from './lib/mic-capture.js';
import { createVoicePlayer } from './lib/voice-player.js';
import { installMarginUI } from './lib/margin-ui.js';
import { installProjectWorkspace } from './lib/project-workspace.js';
import { projectCommand, loadGithubProject, loadGithubBuild, loadGithubChanges, loadGithubPrDraft, githubCommand } from './lib/project-data.js';
import { createProjectSummaryStore, describeProjectSection } from './lib/project-summary.js';
import { marginMetadata } from './lib/margin-metadata.js';
import { localReplyMetadata, localReplyLabel, updateLocalReply, settleLocalReply, rateLimitNotice } from './lib/local-fallback.js';
import { installPocketInteractions } from './lib/pocket-interactions.js';
import { createClient, parseSse, subscribeEvents, requestId } from './lib/client.ts';
import { platformPanel } from './lib/platform.ts';
import { escapeHtml, md, parseActs, firstSentences, stripMd, TOOL_LABEL, toolLabel, humanError, questionActs, relTime, parseDiff } from './lib/text.js';
import { describeToolEvent, stepSummaryLine, elapsedLabel, inputLine } from './lib/transcript.js';
import { narrate, deliveryTransition, deliveryContext, streakIncrease, runStatusChange } from './lib/narration.js';
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
const body = document.body, feed = $('#feed'), pill = $('#pill'), ask = $('#ask'), sendBtn = $('#send'), micBtn = $('#mic'), chipsEl = $('#chips'), attachEl = $('#attach'), listenEl = $('#listen');
const dockBtn = $('#dock'), dockMenu = $('#dock-menu'), modesEl = $('#modes'), attachImageBtn = $('#attach-image'), attachFile = $('#attach-file');
// The Mac shell overlays its window buttons; ordinary browser layouts need no inset.
body.classList.toggle('native-mac', (!!window.__TAURI__ || Q.get('app') === '1') && /Mac/.test(navigator.platform));
const fxCv = $('#fx');
const character = ['wash', 'pool', 'dry', 'pool-velvet', 'pool-bloom', 'pool-tide', 'pool-speckle', 'pool-brush'].includes(Q.get('character')) ? Q.get('character') : Q.get('motion') === 'legacy' ? undefined : 'pool-velvet';
// Ink bubble variants use the Pocket renderer; ordinary URLs retain the legacy escape hatch.
const nibbi = createNibbi({ ink: $('#ink'), fx: fxCv, character, motion: !character && Q.get('motion') === 'legacy' ? 'legacy' : 'pocket' });
const gaze = Q.get('gaze');
if (['left', 'straight', 'right'].includes(gaze)) nibbi.lookDirection?.(gaze === 'left' ? -1 : gaze === 'right' ? 1 : 0, 0);
body.style.backgroundImage = 'url(' + nibbi.paperDataURL() + ')';

/* ------------------------------------------------------------------ state */
const S = {
  mode: 'idle',            // idle | talk
  link: 'booting',         // live | busy | demo | offline | booting
  demo: Q.get('demo') === '1',
  busy: false,
  turns: [],
  projectView: null,
  projectComposerExpanded: null,
  sessionCost: 0, sessionTurns: 0,
  status: null,            // last /api/status
  fixers: [],              // last /api/fixers
  voiceOn: LS.get('voice', !!window.__TAURI__),
  micEnabled: false, micPhase: 'off', micCapturing: false, voiceFinishing: false,
  planFirst: false,        // composer toggle: the next message becomes a reviewable plan
  activeRunId: null, steerable: false, liveTurn: null,
  lastActivity: performance.now(),
  restTimer: 0, sleepTimer: 0, chipTimer: 0,
  abort: null,
};
if (S.voiceOn) body.classList.add('voice-on');
let visibleProjectIds = [];
const projectSummaries = createProjectSummaryStore({ onChange: (project, summaries) => { projectWorkspace.setSummaries?.(project, summaries); syncMargins(); } });
const margins = installMarginUI({ onAction: handleMarginAction, onVisibility: ids => { visibleProjectIds = ids; watchProjectSummaries(); } });
const projectWorkspace = installProjectWorkspace({ renderMarkdown: renderMd, renderDiff, onNavigate: openProjectSection, onAction: handleProjectAction, onClose: closeProjectView, onData: (selection, data) => projectSummaries.accept(selection.project, selection.section, data) });
const composeToggle = document.createElement('button'); composeToggle.type = 'button'; composeToggle.id = 'project-compose-toggle'; composeToggle.className = 'project-compose-toggle'; composeToggle.hidden = true; composeToggle.setAttribute('aria-controls', 'ask attach'); ask.before(composeToggle);
composeToggle.onclick = () => { S.projectComposerExpanded = body.classList.contains('project-compose-compact'); layout(false); if (S.projectComposerExpanded) ask.focus(); };
/* "Plan first": the next message becomes a reviewable plan (numbered steps → approve → builds) instead of a chat turn */
const planBtn = document.createElement('button'); planBtn.type = 'button'; planBtn.id = 'plan-first'; planBtn.className = 'ico plan'; planBtn.setAttribute('aria-pressed', 'false'); planBtn.setAttribute('aria-label', 'Plan first');
planBtn.innerHTML = '<svg class="mi" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><circle cx="4" cy="4.5" r="1.4" fill="currentColor"/><circle cx="4" cy="9" r="1.4" fill="currentColor"/><circle cx="4" cy="13.5" r="1.4" fill="currentColor"/><path d="M8 4.5h6M8 9h6M8 13.5h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg><span class="mi-label">Plan first</span><span class="mic-switch" aria-hidden="true"><span class="mic-thumb"></span></span>';
micBtn.before(planBtn);   // the menu lists plan first, then Hey Nibbi, then attach
/* the hints are short enough to stay one line beside a chip on desktop; under 360px the field is ~170px wide, so shorter variants keep the bar from growing at rest */
const narrowField = matchMedia('(max-width: 360px)');
function placeholderText() {
  const n = narrowField.matches;
  return S.playtest ? 'Playtesting ' + S.playtest + ' — tell nibbi what happened…' : S.planFirst ? (n ? 'Goal first — nibbi proposes steps…' : 'Describe the goal — nibbi proposes steps first…') : (n ? 'Ask nibbi to build…' : 'Ask nibbi to build something...');
}
narrowField.addEventListener('change', () => { ask.placeholder = placeholderText(); autosize(); });
function setPlanFirst(on) {
  S.planFirst = !!on; planBtn.setAttribute('aria-pressed', String(S.planFirst)); pill.classList.toggle('plan-first', S.planFirst);
  planBtn.title = S.planFirst ? 'Plan first is on — the next message becomes a reviewable plan (click to turn off)' : 'Plan first — propose numbered steps to review before any build starts';
  ask.placeholder = placeholderText();
  syncModes();
}
planBtn.onclick = () => { setPlanFirst(!S.planFirst); ask.focus(); toast(S.planFirst ? 'plan first — the next message becomes a reviewable plan' : 'plan first off', 2200); };
/* the ink dock: one "+" opens a small panel above it holding the mode toggles and attach; modes that are on show as removable chips at the field's leading edge */
const MIC_WORD = { starting: 'starting', armed: 'ready', greeting: 'greeting', listening: 'listening', transcribing: 'transcribing', sending: 'answering', paused: 'paused' };
function modeChip(kind, label, word, off, onOff) {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'mode'; b.dataset.mode = kind; b.setAttribute('aria-label', off); b.title = off;
  b.innerHTML = '<span class="mode-b"><span class="l"></span><span class="w"></span><span class="x" aria-hidden="true">×</span></span>';
  b.querySelector('.l').textContent = label; const w = b.querySelector('.w'); w.textContent = word || ''; w.hidden = !word;
  b.onclick = onOff; return b;
}
function syncModes() {
  const chips = [];
  if (S.planFirst) chips.push(modeChip('plan', 'plan first', '', 'Plan first is on — turn off', () => planBtn.click()));
  if (S.micEnabled) { const word = MIC_WORD[S.micPhase] || ''; chips.push(modeChip('mic', 'Hey Nibbi', word, 'Hey Nibbi is on' + (word ? ' · ' + word : '') + ' — turn off', () => micBtn.click())); }
  const key = chips.map(c => c.getAttribute('aria-label')).join('|');
  if (modesEl.dataset.key === key) return;
  const focused = document.activeElement?.closest?.('#modes .mode')?.dataset.mode;
  modesEl.dataset.key = key; modesEl.replaceChildren(...chips);
  if (focused) { const again = modesEl.querySelector('.mode[data-mode="' + focused + '"]'); (again || dockBtn).focus(); }
  autosize();   // the field's width changed with the chips: re-fit its height (a long placeholder may wrap) and re-place the feed above the pill
}
const dockItems = () => [...dockMenu.querySelectorAll('button:not([disabled])')].filter(b => !b.hidden);
/* a native non-modal <dialog>: the app's other panels are recognised by `dialog[open]` (the sidebar yields Escape to it, global shortcuts stand down) */
function openDock() {
  if (dockMenu.open) return;
  dockMenu.show(); dockBtn.setAttribute('aria-expanded', 'true'); pill.classList.add('dock-open');
  dockItems()[0]?.focus();
}
function closeDock(refocus) {
  if (!dockMenu.open) return;
  dockMenu.close(); dockBtn.setAttribute('aria-expanded', 'false'); pill.classList.remove('dock-open');
  if (refocus) dockBtn.focus();
}
dockBtn.addEventListener('click', () => { if (dockMenu.open) closeDock(true); else openDock(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && dockMenu.open && !e.defaultPrevented) { e.preventDefault(); e.stopImmediatePropagation(); closeDock(true); } }, true);   // Esc closes the panel wherever focus sits (the "+", or body after a WebKit mousedown blur); the sidebar's own Esc listener must not also see it once the panel is gone
dockMenu.addEventListener('cancel', (e) => { e.preventDefault(); closeDock(true); });
/* WebKit: buttons are not mouse-focusable and a mousedown on one blurs the active element, so a press on a row (or on the "+") would fire focusout → close before the click lands.
   keep focus where it is during the press (mousedown preventDefault) and, belt and braces, let focusout stand down while a press inside the dock is in flight; the click decides */
let dockPress = 0;
function dockPressed(e) { clearTimeout(dockPress); dockPress = setTimeout(() => { dockPress = 0; }, 700); if (e.type === 'mousedown') e.preventDefault(); }
for (const el of [dockBtn, dockMenu]) { el.addEventListener('pointerdown', dockPressed); el.addEventListener('mousedown', dockPressed); }
document.addEventListener('click', () => { clearTimeout(dockPress); dockPress = 0; });   // bubble phase: after the row or the "+" handled the click
dockMenu.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeDock(true); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
    const items = dockItems(), i = items.indexOf(document.activeElement); if (!items.length) return; e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  }
});
/* choosing an item closes the panel: a toggle reports itself as a chip, attach hands over to the file chooser */
dockMenu.addEventListener('click', (e) => { const item = e.target instanceof Element && e.target.closest('button'); if (!item) return; closeDock(false); if (item !== attachImageBtn) (ask.getClientRects().length ? ask : dockBtn).focus(); });
dockMenu.addEventListener('focusout', (e) => { if (dockPress) return; const to = e.relatedTarget; if (to instanceof Node && (dockMenu.contains(to) || to === dockBtn)) return; closeDock(false); });
document.addEventListener('pointerdown', (e) => { if (!dockMenu.open || !(e.target instanceof Node)) return; if (dockMenu.contains(e.target) || dockBtn.contains(e.target)) return; closeDock(false); }, true);
attachImageBtn.addEventListener('click', () => { attachFile.value = ''; attachFile.click(); });
attachFile.addEventListener('change', () => { for (const f of attachFile.files || []) addImage(f); attachFile.value = ''; ask.focus(); });
setPlanFirst(false);
function watchProjectSummaries() { projectSummaries.watch([...new Set([...visibleProjectIds, ...(S.projectView ? [S.projectView.project] : [])])]); }
function syncProjectComposer() {
  const available = !!S.projectView && innerHeight < 600;
  const expanded = S.projectComposerExpanded ?? innerHeight >= 600;
  const compact = available && !expanded;
  composeToggle.hidden = !available; body.classList.toggle('project-compose-compact', compact);
  composeToggle.setAttribute('aria-expanded', String(!compact));
  const draft = ask.value.trim();
  composeToggle.textContent = compact ? draft ? 'Draft: ' + draft.replace(/\s+/g, ' ') : pendingImages.length ? `${pendingImages.length} attachment${pendingImages.length === 1 ? '' : 's'} · Write a message` : 'Ask Nibbi…' : 'Hide draft';
  composeToggle.title = compact ? 'Open composer; your draft and attachments are preserved' : 'Collapse composer while reading';
}

/* ------------------------------------------------------------------ layout: where nibbi sits */
function workspaceLeft() { return parseFloat(getComputedStyle(body).getPropertyValue('--workspace-left')) || 0; }
function idleRadius() { return Math.max(56, Math.min(150, Math.min(innerWidth - workspaceLeft(), innerHeight) * 0.16)); }
function layout(snap) {
  // Initialization runs before the attachment state is declared.
  if (typeof composeToggle !== 'undefined') syncProjectComposer();
  const W = innerWidth, H = innerHeight, r0 = idleRadius();
  const center = (W + workspaceLeft()) / 2;
  const pillTop = pill.getBoundingClientRect().top || (H - 124);
  let pose;
  if (S.mode === 'talk' || S.projectView) {
    const compactProject = S.projectView && H < 520;
    const r = compactProject ? 24 : Math.max(34, Math.min(52, r0 * 0.34, H * 0.06));
    const cy = (compactProject ? 18 : 30) + r * 1.15;
    pose = { x: center, y: cy, r };
    document.documentElement.style.setProperty('--feed-top', Math.round(cy + r * 1.1 + 10) + 'px');
  } else {
    const focused = document.activeElement === ask && !S.busy;
    pose = { x: center, y: H * (focused ? 0.47 : 0.49) - (H < 600 ? 20 : 0), r: r0 };
  }
  const hasAgents = body.classList.contains('has-agents');
  document.documentElement.style.setProperty('--agents-bottom', Math.round(H - pillTop - 3) + 'px');   // perched on the pill's top edge
  document.documentElement.style.setProperty('--feed-bottom', Math.round(H - pillTop + 18 + (hasAgents ? 52 : 0)) + 'px');
  if (snap) nibbi.snapTarget(pose); else nibbi.setTarget(pose);
}
addEventListener('resize', () => layout(false));
document.addEventListener('nibbi:sidebar', () => layout(false));
layout(true);
const interactions = installPocketInteractions({ nibbi, canvas: fxCv,
  getContext: () => ({ busy: S.busy, mode: S.mode, mood: nibbi.mood() }), onInteract: () => activity() });
let calmMotion = LS.get('pocketCalm', false) === true;
function syncMotionPreference() {
  const system = reducedMotion.matches, calm = system || calmMotion;
  nibbi.setReducedMotion(calm); interactions.setReducedMotion(calm);
  syncMargins();
}
reducedMotion.addEventListener('change', syncMotionPreference);

function setMode(m) {
  if (S.mode === m) return;
  S.mode = m; body.dataset.mode = m; layout(false);
  if (m !== 'talk') jumpBtn.hidden = true;
}

/* ------------------------------------------------------------------ pointer → nibbi */
addEventListener('pointermove', (e) => { nibbi.pointer(e.clientX, e.clientY); fxCv.classList.toggle('grab', nibbi.hitTest(e.clientX, e.clientY)); activity(); }, { passive: true });
/* ------------------------------------------------------------------ activity / rest / sleep */
function activity() {
  S.lastActivity = performance.now();
  if (body.classList.contains('rest')) body.classList.remove('rest');
  if (!S.busy && nibbi.mood() === 'sleep') { nibbi.setMood('idle'); interactions.event('wake'); }
  scheduleIdleTimers();
}
function scheduleIdleTimers() {
  clearTimeout(S.restTimer); clearTimeout(S.sleepTimer);
  S.restTimer = setTimeout(() => { if (!S.busy && S.mode === 'talk' && document.activeElement !== ask) body.classList.add('rest'); }, 40000);
  S.sleepTimer = setTimeout(() => { if (!S.busy && !listening) nibbi.setMood('sleep'); }, 180000);
}
addEventListener('keydown', activity, { passive: true });
scheduleIdleTimers();
setInterval(() => { for (const T of S.turns) if (T.timeEl) T.timeEl.textContent = relTime(T.at); }, 60000);

/* ------------------------------------------------------------------ scrolling: chronological, pinned to the bottom until you scroll up */
const jumpBtn = document.createElement('button'); jumpBtn.id = 'jump'; jumpBtn.type = 'button'; jumpBtn.className = 'jump'; jumpBtn.hidden = true; jumpBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 18 18" fill="none"><path d="M9 3.5v11M9 14.5l-5-5M9 14.5l5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> latest'; document.body.appendChild(jumpBtn);
S.stick = true;
let scrollRaf = 0;
function scrollFeed(force) { if (!force && !S.stick) return; if (scrollRaf) return; scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; feed.scrollTop = feed.scrollHeight; }); }
feed.addEventListener('scroll', () => { const gap = feed.scrollHeight - feed.scrollTop - feed.clientHeight; const atBottom = gap < 80; if (atBottom !== S.stick) { S.stick = atBottom; jumpBtn.hidden = atBottom || S.mode !== 'talk'; } }, { passive: true });
jumpBtn.onclick = () => { S.stick = true; jumpBtn.hidden = true; feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' }); };
new MutationObserver(() => scrollFeed(false)).observe(feed, { childList: true, subtree: true, characterData: true });
new ResizeObserver(() => scrollFeed(false)).observe(feed);

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
  for (const pre of tpl.content.querySelectorAll('pre')) { const b = document.createElement('button'); b.type = 'button'; b.className = 'copycode'; b.textContent = 'copy'; b.onclick = () => { navigator.clipboard?.writeText(pre.textContent.replace(/copy$/, '').replace(/show all \(\d+ lines\)$/, '')); toast('copied'); }; pre.appendChild(b); const n = (pre.textContent.match(/\n/g) || []).length; if (n > 16) { pre.classList.add('capped'); const x = document.createElement('button'); x.type = 'button'; x.className = 'expand'; x.textContent = 'show all (' + n + ' lines)'; x.onclick = () => { pre.classList.remove('capped'); x.remove(); }; pre.appendChild(x); } }
  for (const tb of tpl.content.querySelectorAll('table')) { const w = document.createElement('div'); w.className = 'tblwrap'; tb.replaceWith(w); w.appendChild(tb); }
  return tpl.content;
}

/* ------------------------------------------------------------------ feed */

function newTurn(text, images, at) {
  const last = S.turns[S.turns.length - 1]; const now = new Date(at || Date.now());
  if (!last || new Date(last.at || Date.now()).toDateString() !== now.toDateString()) { if (feed.children.length) { const sep = document.createElement('div'); sep.className = 'when'; sep.textContent = now.toDateString() === new Date().toDateString() ? 'today' : now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }); feed.appendChild(sep); } }
  const turn = document.createElement('article'); turn.className = 'turn';
  const you = document.createElement('div'); you.className = 'you';
  if (text === null) turn.classList.add('event');
  if (images && images.length) { const w = document.createElement('div'); w.className = 'imgs'; for (const im of images) { const i = document.createElement('img'); i.src = 'data:' + im.media_type + ';base64,' + im.data; w.appendChild(i); } you.appendChild(w); }
  you.appendChild(document.createTextNode(text || ''));
  const nib = document.createElement('div'); nib.className = 'nib';
  const ava = null;   // no small nibbi beside the bubble: the bubble's corner dot is the signature
  const nibBody = document.createElement('div'); nibBody.className = 'nibbody';
  const steps = document.createElement('div'); steps.className = 'steps'; steps.hidden = true;
  const fold = document.createElement('button'); fold.type = 'button'; fold.className = 'fold'; fold.innerHTML = '<span class="b"></span><span class="l"></span>'; fold.onclick = () => steps.classList.remove('folded'); steps.appendChild(fold);
  for (const P of S.turns) { const a = P.nib.querySelector('.acts:not(.sticky)'); if (a) a.remove(); }
  turn.setAttribute('aria-busy', 'true');
  const said = document.createElement('div'); said.className = 'said';
  const meta = document.createElement('div'); meta.className = 'meta';
  const bubble = document.createElement('div'); bubble.className = 'bubble live';
  const provenance = document.createElement('div'); provenance.className = 'meta local-provenance'; provenance.style.opacity = '1'; provenance.hidden = true; provenance.setAttribute('aria-live', 'polite');
  bubble.append(provenance, steps, said);
  nibBody.append(bubble, meta);
  nib.append(nibBody);
  if (text !== null) turn.append(you); turn.append(nib);
  feed.appendChild(turn); S.stick = true; scrollFeed(true);
  const T = { el: turn, nib, body: nibBody, ava, bubble, steps, said, meta, provenance, fold, text, at: at || Date.now(), startedAt: performance.now(), stepsList: [], liveStep: null, acc: '', done: false, stepLine: '', runId: null };
  S.turns.push(T);
  return T;
}
/* ---- steps: the live tool transcript. A plain step is one row; a tool step is a <details> whose summary keeps the friendly label
   and whose body shows the exact name, kind, bounded input and — once the finished frame lands — the verdict, elapsed, bytes and diff. */
const STEP_INPUT_MAX = 2048;
const clipText = (s, max) => { const t = String(s ?? ''); return t.length > max ? t.slice(0, max - 1) + '…' : t; };
function boundedInput(input) {
  if (input == null) return '';
  if (typeof input !== 'object') return clipText(input, STEP_INPUT_MAX);
  let json = ''; try { json = Object.keys(input).length > 1 ? JSON.stringify(input, null, 1) : ''; } catch { json = ''; }
  return clipText(json || inputLine(input), STEP_INPUT_MAX);
}
function stepEl(label, kind, ev) {
  const row = '<span class="b"></span><span class="l"></span><span class="n"></span><span class="t"></span>';
  if (!ev) { const el = document.createElement('div'); el.className = 'step live' + (kind ? ' ' + kind : ''); el.innerHTML = row; el.querySelector('.l').textContent = label; return el; }
  const el = document.createElement('details'); el.className = 'step live' + (kind ? ' ' + kind : ''); el.dataset.kind = ev.kind || 'native';
  const sum = document.createElement('summary'); sum.innerHTML = row; sum.querySelector('.l').textContent = label; sum.title = ev.name && ev.name !== label ? ev.name : '';
  const bodyEl = document.createElement('div'); bodyEl.className = 'sbody';
  const head = document.createElement('div'); head.className = 'shead'; head.innerHTML = '<code class="sname"></code><span class="skind"></span>';
  head.querySelector('.sname').textContent = ev.name || label; head.querySelector('.skind').textContent = ev.kind || 'native';
  bodyEl.appendChild(head);
  const inputText = boundedInput(ev.input);
  if (inputText) { const pre = document.createElement('pre'); pre.className = 'sin'; pre.textContent = inputText; bodyEl.appendChild(pre); }
  const res = document.createElement('div'); res.className = 'sres'; res.hidden = true; bodyEl.appendChild(res);
  el.append(sum, bodyEl);
  return el;
}
function stepRecord(el, label, kind, ev) {
  return { el, label, n: 1, at: performance.now(), fixed: kind === 'fixer', governed: !!ev && ev.source !== 'native', name: ev ? ev.name || '' : '', kind: ev ? ev.kind || '' : (kind || ''), source: ev ? ev.source || '' : '', input: ev ? ev.input : undefined, ok: null, elapsedMs: null, detail: '', diff: '', bytesLabel: '', finished: false };
}
/* ev (optional) is a describeToolEvent result: governed steps never coalesce; identical native/plain labels still fold into ×N */
function addStep(T, label, kind, ev) {
  const last = T.liveStep, native = !ev || ev.source === 'native';
  if (last && last.label === label && !last.fixed && !last.governed && !last.finished && native) { last.n++; last.el.querySelector('.n').textContent = '×' + last.n; return last; }
  if (last) markStep(last, 'done');
  const el = stepEl(label, kind, ev);
  T.steps.hidden = false; T.steps.insertBefore(el, T.fold);
  const st = stepRecord(el, label, kind, ev);
  T.stepsList.push(st); T.liveStep = st;
  return st;
}
/* a step that must not disturb the live one (guidance sent mid-turn) */
function insertStep(T, ev) {
  const el = stepEl(ev.label, ev.kind === 'steer' ? 'steer' : null, ev);
  T.steps.hidden = false; T.steps.insertBefore(el, T.fold);
  const st = stepRecord(el, ev.label, null, ev); T.stepsList.push(st); return st;
}
function markStep(st, state) { st.el.classList.remove('live', 'done', 'fail'); st.el.classList.add(state); if (state === 'fail') st.ok = false; else if (state === 'done' && st.ok === null) st.ok = true; const dt = (performance.now() - st.at) / 1000; if (dt > 1.5) st.el.querySelector('.t').textContent = dt < 60 ? dt.toFixed(0) + 's' : (dt / 60).toFixed(1) + 'm'; }
function fillStepResult(st) {
  const res = st.el.querySelector('.sres'); if (!res) return;
  res.replaceChildren(); res.hidden = false; res.classList.toggle('fail', st.ok === false);
  const line = document.createElement('div'); line.className = 'sverdict';
  line.textContent = [st.detail || (st.ok === false ? 'failed' : 'done'), st.elapsedMs != null ? elapsedLabel(st.elapsedMs) : '', st.bytesLabel].filter(Boolean).join(' · ');
  res.appendChild(line);
  if (st.diff) res.appendChild(renderDiff({ diff: st.diff, branch: (st.input && typeof st.input === 'object' && typeof st.input.path === 'string' && st.input.path) || st.path || st.name, target: '' }));
}
/* the finished frame lands on the last live step with the same name (fallback: the live step) */
function finishToolStep(T, ev) {
  const st = [...T.stepsList].reverse().find((s) => !s.finished && s.name && s.name === ev.name) || (T.liveStep && !T.liveStep.finished ? T.liveStep : null);
  if (!st) return null;
  st.finished = true; st.ok = !!ev.ok; st.elapsedMs = ev.elapsedMs; st.detail = ev.detail || ''; st.diff = ev.diff || ''; st.bytesLabel = ev.bytesLabel || '';
  markStep(st, st.ok ? 'done' : 'fail');
  if (ev.elapsedLabel) st.el.querySelector('.t').textContent = ev.elapsedLabel;
  fillStepResult(st);
  if (T.liveStep === st) T.liveStep = null;
  return st;
}
function finishSteps(T, ok) {
  if (T.liveStep) { markStep(T.liveStep, ok ? 'done' : 'fail'); T.liveStep = null; }
  if (!T.stepsList.length) return;
  const rows = T.stepsList.flatMap((s) => Array.from({ length: s.n || 1 }, () => s));
  const line = (ok ? '' : 'stopped after ') + stepSummaryLine(rows, performance.now() - T.startedAt);
  T.stepLine = line;
  T.fold.querySelector('.l').innerHTML = escapeHtml(line) + ' — <u>show</u>';
  T.steps.classList.add('folded');   // the screen reader hears T.stepLine once, composed into the reply's announcement by the caller; individual tool frames are never announced
}
function setSaid(T, text, live) {
  T.acc = text;
  const clean = parseActs(text.replace(/»voice:\s*(?:(?!»voice:)[^\n])*\n?/g, '')).clean;
  if (T.plain) { T.said.classList.add('plain'); T.said.replaceChildren(); const parts = clean.split(/(https?:\/\/[^\s)]+)/g); for (const part of parts) { if (/^https?:\/\//.test(part)) { const a = document.createElement('a'); a.href = part; a.textContent = part; a.target = '_blank'; a.rel = 'noopener'; T.said.appendChild(a); } else T.said.appendChild(document.createTextNode(part)); } return; }
  if (live) { if (!T.raf) T.raf = setTimeout(() => { T.raf = 0; T.said.replaceChildren(renderMd(parseActs(T.acc.replace(/»voice:\s*(?:(?!»voice:)[^\n])*\n?/g, '')).clean)); }, 60); }
  else { if (T.raf) { clearTimeout(T.raf); T.raf = 0; } T.said.replaceChildren(renderMd(clean)); }
}
function setMeta(T, r) {
  updateLocalReply(T, r);
  const bits = [];
  T.at = T.at || Date.now(); const tm = document.createElement('time'); tm.dateTime = new Date(T.at).toISOString(); tm.title = new Date(T.at).toLocaleString(); tm.textContent = relTime(T.at); T.timeEl = tm;
  bits.push('');
  if (r && r.costUsd !== undefined) { bits.push('$' + r.costUsd.toFixed(3)); T.cost = r.costUsd; } else if (r && r.runId) bits.push('cost unavailable');
  // Local provenance lives above the reply, including while tokens stream.
  if (r && r.raw) bits.push(String(r.raw).replace(/^\s*error:\s*/i, '').slice(0, 90));
  T.meta.textContent = bits.filter(Boolean).join(' · '); T.meta.prepend(tm, document.createTextNode(bits.filter(Boolean).length ? ' · ' : ''));
  const quote = document.createElement('button'); quote.type = 'button'; quote.textContent = 'quote'; quote.onclick = () => { const s = (window.getSelection() || '').toString().trim() || firstSentences(stripMd(T.acc), 1, 200); ask.value = '> ' + s + '\n\n'; ask.focus(); autosize(); };
  const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'copy'; copy.onclick = () => { navigator.clipboard?.writeText(T.acc); toast('copied'); };
  const again = document.createElement('button'); again.type = 'button'; again.textContent = 'ask again'; again.onclick = () => send(T.text);
  T.meta.append(document.createTextNode(' · '), quote, document.createTextNode(' · '), copy, document.createTextNode(' · '), again);
}
function addActs(T, acts, opts) {
  if (!acts.length) return;
  const w = document.createElement('div'); w.className = 'acts' + (opts && opts.sticky ? ' sticky' : '');
  for (const a of acts) {
    const c = document.createElement('button'); c.type = 'button'; c.className = 'chip in' + (a.warn ? ' warn' : ''); c.textContent = a.label;
    if (a.reviewMutation) { c.dataset.reviewMutation = ''; c.disabled = !!S.review?.pending; }
    if (a.confirm) { let armed = 0; c.onclick = () => { if (!armed) { armed = setTimeout(() => { armed = 0; c.textContent = a.label; c.classList.remove('armed'); }, 4000); c.textContent = a.confirm; c.classList.add('armed'); return; } clearTimeout(armed); armed = 0; a.run(); }; }
    else c.onclick = () => a.run();
    w.appendChild(c);
  }
  (opts && opts.into || T.body).appendChild(w);
}

let tidied = null;
function tidy() {
  if (S.busy || !S.turns.length) return;
  if (S.review) endReview();
  const saved = { turns: S.turns, nodes: [...feed.children] };
  for (const T of S.turns) T.el.classList.add('leave');
  setTimeout(() => { if (tidied === saved) feed.replaceChildren(); }, 240);
  S.turns = []; tidied = saved; LS.set('transcript', null);
  setMode('idle'); body.classList.remove('rest'); nibbi.lookFree(); nibbi.setMood('idle'); interactions.event('tidy'); hideChips();
  toast('table tidied', 6000, { label: 'undo', run: () => { if (tidied !== saved) return; tidied = null; S.turns = saved.turns; for (const n of saved.nodes) { n.classList.remove('leave'); feed.appendChild(n); } setMode('talk'); persistTranscript(); } });
}

/* ------------------------------------------------------------------ toast */
let toastT = 0;
function toast(msg, ms, act) { try { if (typeof clientLog === 'function') clientLog('toast', msg); } catch { /* early */ } const t = $('#toast'); t.textContent = msg; if (act) { const b = document.createElement('button'); b.type = 'button'; b.textContent = act.label; b.onclick = () => { act.run(); t.hidden = true; }; t.append(' ', b); } t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms || 1800); }

/* ------------------------------------------------------------------ brain client */
async function* sseTurn(message, images, signal, mode) {
  const response = await fetch('/api/send', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': requestId() }, body: JSON.stringify({ message, project: activeProject(), stream: true, images, ...(mode === 'plan' ? { mode: 'plan' } : {}) }), signal });
  if (response.ok && response.headers.get('content-type')?.includes('application/json')) { yield { ...(await response.json()), ev: 'done' }; return; }
  yield* parseSse(response);
}

/* a scripted brain so the choreography can be seen without the gateway */
async function* demoTurn(message, _images, signal, mode) {
  const m = message.toLowerCase();
  const wait = async (ms) => { await sleep(ms); if (signal.aborted) throw new DOMException('aborted', 'AbortError'); };
  const words = (s) => s.match(/\S+\s*/g) || [];
  async function* say(text) { for (const w of words(text)) { await wait(28 + Math.random() * 60); yield { ev: 'delta', t: w }; } }
  /* governed calls arrive as a started/finished pair; native provider tools stay name-only */
  const governed = (name, input) => ({ ev: 'tool', name, phase: 'started', source: 'governed', input, at: Date.now() });
  const finished = (name, extra) => ({ ev: 'tool', name, phase: 'finished', source: 'governed', ok: true, at: Date.now(), ...extra });
  await wait(700);
  if (mode === 'plan') {
    yield governed('read_roadmap', { project: 'shipless' }); await wait(700); yield finished('read_roadmap', { summary: '3 milestones · 5 open tasks', bytes: 2210, elapsedMs: 690 });
    const rationale = 'M2 is the bottleneck: nothing downstream can be balanced until cards exist as data and a simulator can play them. Two independent steps, each testable on its own.';
    yield* say(rationale);
    const now = Date.now();
    yield { ev: 'done', text: rationale, costUsd: 0.006, isError: false, proposal: { id: 'plan-demo', project: 'shipless', state: 'prepared', summary: 'Card data as JSON, then a random-policy simulator over it', rationale, review: { summary: 'Card data as JSON, then a random-policy simulator over it', steps: [
      { n: 1, title: 'Card and component data as JSON', task: { id: 't-card-json', text: 'Card/component data as JSON', milestone: 'M2: Simulation' }, issueIds: [], context: 'Start from design.md; one file per card set under data/.', dependsOn: [] },
      { n: 2, title: 'Random-policy simulator plays a full game', task: null, issueIds: ['issue-9'], context: 'src/sim.js reads the JSON and plays 1000 games with random policies; report win rates.', dependsOn: [1] },
    ], warnings: ['Step 2: taskId "t-sim" is not in the roadmap; the step keeps its text without a pinned task'], roadmapRevision: 'demo' }, fingerprint: 'demo-fingerprint', createdAt: now, expiresAt: now + 30 * 60000 } };
    return;
  }
  if (/\berror\b|\bbreak\b/.test(m)) { yield { ev: 'tool', name: 'Bash' }; await wait(900); yield { ev: 'done', text: 'error: Failed to authenticate: OAuth session expired and could not be refreshed', isError: true, costUsd: 0 }; return; }
  if (/fix|bug|build|make|add|change|ship/.test(m)) {
    yield governed('read_file', { path: 'src/session.ts' }); await wait(650); yield finished('read_file', { summary: 'Read 4.1 KB from src/session.ts', bytes: 4198, elapsedMs: 640 });
    yield governed('read_file', { path: 'src/webapp.ts' }); await wait(500); yield finished('read_file', { summary: 'Read 2.8 KB from src/webapp.ts', bytes: 2867, elapsedMs: 480 });
    yield { ev: 'tool', name: 'Grep' }; await wait(800);
    yield* say('Found it. ');
    yield governed('edit_file', { path: 'src/session.ts', oldText: 'const lock = new TurnLock();', newText: 'const lock = new TurnLock({ clearOnAbort: true });' }); await wait(900);
    yield finished('edit_file', { summary: 'Replaced 1 match in src/session.ts', bytes: 4231, elapsedMs: 880, diff: 'diff --git a/src/session.ts b/src/session.ts\n--- a/src/session.ts\n+++ b/src/session.ts\n@@ -41,7 +41,7 @@ export async function runTurn(input) {\n   const control = active.get(id);\n-  const lock = new TurnLock();\n+  const lock = new TurnLock({ clearOnAbort: true });\n   control.abort.signal.addEventListener(\'abort\', () => lock.release());\n' });
    yield governed('shell', { command: 'npm test' }); await wait(1400); yield finished('shell', { summary: 'exit 0 · 42 passing', bytes: 1802, elapsedMs: 1380 });
    yield* say('Two files touched, tests still green.\n\n');
    yield* say('- `session.ts` — the turn lock now clears on abort\n- `webapp.ts` — the stream sends a `done` even when the model bails\n\n');
    yield* say('Want me to stage it as a fix so you can review the diff, or ship it straight to `main`?');
    yield { ev: 'done', text: 'Found it. Two files touched, tests still green.\n\n- `session.ts` — the turn lock now clears on abort\n- `webapp.ts` — the stream sends a `done` even when the model bails\n\nWant me to stage it as a fix so you can review the diff, or ship it straight to `main`?', costUsd: 0.021, isError: false, voice: 'Found it. Two files touched, tests still green. Stage it, or ship it?' };
    return;
  }
  if (/hello|hi\b|hey|who are you|what can you/.test(m)) {
    yield* say('Hi. I\'m ' + NAME + '. Ask me to build, fix, plan or remember something and I\'ll show my work right here while I do it.');
    yield { ev: 'done', text: 'Hi. I\'m ' + NAME + '. Ask me to build, fix, plan or remember something and I\'ll show my work right here while I do it.', costUsd: 0, isError: false }; return;
  }
  yield { ev: 'tool', name: 'Read' }; await wait(900); yield { ev: 'tool', name: 'Grep' }; await wait(700);
  const t = 'Here\'s what I know (demo brain — the real one isn\'t reachable right now).\n\nYou asked: *' + message.replace(/\*/g, '') + '*\n\nWhen the gateway is up I answer from the vault and the live repos, and every tool I touch shows up above this line as I work.';
  yield* say(t); yield { ev: 'done', text: t, costUsd: 0, isError: false };
}

async function* offlineTurn() { await sleep(600); yield { ev: 'done', text: 'gateway offline', isError: true, offline: true }; }

/* ------------------------------------------------------------------ client-side commands: the build loop lives here */
const api = createClient(() => activeProject());
const openPlatform = platformPanel(() => activeProject(), () => { refreshProjects(); refreshStatus(); });
const projectNames = () => (S.projects || []).map((p) => p.name);
const activeProject = () => (S.project && (!S.projects || projectNames().includes(S.project)) ? S.project : projectNames()[0]) || 'vault';
const bar = (done, total) => { const n = 12, f = total ? Math.round(n * done / total) : 0; return '`' + '█'.repeat(f) + '░'.repeat(n - f) + '`'; };

/* a turn that nibbi answers itself (no model call): fn(T) → { text, acts?, ok?, plain?, html? } */
async function localTurn(userText, fn, opts) {
  if (S.busy) { toast(NAME + ' is still working — one thing at a time'); return; }
  S.busy = true; body.classList.add('busy'); activity(); hideChips(); if (!(opts && opts.keepInput)) { ask.value = ''; autosize(); } setMode('talk'); syncMargins();
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
  S.busy = false; body.classList.remove('busy'); nibbi.lookFree(); nibbi.setMood(ok ? 'happy' : 'error'); if (ok) interactions.event('success'); setTimeout(() => { if (!S.busy) nibbi.setMood('idle'); }, ok ? 1400 : 2600); syncMargins();
  $('#sr').textContent = (T.stepLine ? T.stepLine + '. ' : '') + stripMd(out.text || ''); scheduleIdleTimers(); refreshStatus();
  return T;
}

async function issuesFile(proj) {
  for (const path of ['games/' + proj + '/issues.md', 'projects/' + proj + '/issues.md']) { try { const r = await api.get('/api/vault?p=' + encodeURIComponent(path)); if (r.content && r.content !== '(missing)') return { path, content: r.content }; } catch { /* next */ } }
  return null;
}

/* ---- fixer helpers ---- */
const fixerById = (id) => (S.fixers || []).find((f) => f.id === id);
const fixerTitle = (f) => f.title || (f.issue || '').slice(0, 60) || f.id;
const githubBuild = f => f?.workflowMode === 'github' || f?.github?.mode === 'github';
const inspectGithubBuild = f => openProjectSection(f.game || f.project, 'builds', { buildId: f.id, evidence: 'github' });
function fixerActs(f, opts) {
  const a = []; const st = f.status;
  if (st === 'staged' && githubBuild(f)) a.push({ label: 'Review GitHub delivery', run: () => inspectGithubBuild(f) }, { label: 'diff', run: () => send('/diff ' + f.id) }, { label: 'preview', run: () => send('/preview ' + f.id) });
  if (st === 'staged' && !githubBuild(f)) a.push({ label: 'diff', run: () => send('/diff ' + f.id) }, { label: 'preview', run: () => send('/preview ' + f.id) }, { label: 'approve & merge', confirm: 'merge into ' + (opts && opts.target || 'the branch') + ' — sure?', warn: true, run: () => send('/approve ' + f.id) });
  if (st === 'running' || st === 'installing') a.push({ label: 'steer', run: () => { ask.value = '/steer ' + f.id + ' '; ask.focus(); autosize(); } }, { label: 'stop', confirm: 'stop it — sure?', warn: true, run: () => send('/stop ' + f.id) });
  if (st === 'queued') a.push({ label: 'unqueue', confirm: 'drop it from the queue?', run: () => api.post('/api/fix-unqueue', { id: f.id }).then(() => toast('unqueued')).catch((e) => toast(e.message)) });
  if (st === 'failed') a.push({ label: 'log', run: () => send('/log ' + f.id) }, { label: 'Start replacement build', run: () => api.post('/api/fix-requeue', { id: f.id }).then(() => toast('requeued')).catch((e) => toast(e.message)) });
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
  head.textContent = (d.game ? d.game + ' · ' : '') + (d.branch || '') + (d.target ? ' → ' + d.target : '');   // no target (tool diff card) → no arrow
  const files = parseDiff(d.diff);
  const counted = files.filter((f) => f.lines.length);
  const stat = document.createElement('pre'); stat.className = 'dstat';
  stat.textContent = (d.diffstat || '').trim() || (counted.length ? counted.length + ' file' + (counted.length === 1 ? '' : 's') + ' changed, +' + counted.reduce((a, f) => a + f.add, 0) + ' −' + counted.reduce((a, f) => a + f.del, 0) : '(no changes yet)');
  const many = files.length > 3;
  const body = document.createElement('div'); body.className = 'dfiles';
  for (const f of files) {
    const det = document.createElement('details'); det.className = 'dfile'; det.open = !many;
    const sum = document.createElement('summary'); sum.innerHTML = '<span class="fn">' + escapeHtml(f.name || d.branch) + '</span><span class="cnt"><b class="pa">+' + f.add + '</b> <b class="pd">−' + f.del + '</b></span>';
    const pre = document.createElement('pre'); pre.className = 'dbody';
    for (const ln of f.lines) {
      const s = document.createElement('span'); s.className = 'ln' + (ln.startsWith('@@') ? ' dhunk' : ln.startsWith('+') ? ' dadd' : ln.startsWith('-') ? ' ddel' : '');
      s.textContent = ln || ' ';
      pre.appendChild(s);
    }
    det.append(sum, pre); body.appendChild(det);
  }
  wrap.append(head, stat, body);
  if (d.truncated) { const n = document.createElement('div'); n.className = 'dnote'; n.textContent = 'diff truncated at 60 KB — the rest is in the worktree'; wrap.appendChild(n); }
  return wrap;
}

/* ---- the commands ---- */
const COMMANDS = [
  { cmd: '/fix', args: '<issue>', desc: 'dispatch a fixer on the active project', local: true },
  { cmd: '/diff', args: '<fixer-id>', desc: 'review a fixer\'s changes inline', local: true },
  { cmd: '/approve', args: '<fixer-id>', desc: 'merge a finished fixer (the brain runs the gate)', local: false },
  { cmd: '/preview', args: '<fixer-id> [stop]', desc: 'run the fixer\'s branch on a preview server', local: true },
  { cmd: '/steer', args: '<fixer-id> <note>', desc: 'send a running fixer a course correction', local: true },
  { cmd: '/stop', args: '<fixer-id>', desc: 'stop a running fixer', local: true },
  { cmd: '/fixers', args: '', desc: 'list recent fixers', local: false },
  { cmd: '/review', args: '[project|all]', desc: 'walk staged fixers: j/k next/prev · a approve · x discard · p preview', local: true },
  { cmd: '/plan', args: '[project] | edit <instruction>', desc: 'milestones, progress and what auto is doing; `edit` asks nibbi to rewrite the plan', local: true },
  { cmd: '/plan propose', args: '<text>', desc: 'plan first: nibbi proposes numbered steps you review and approve before any build starts', local: true },
  { cmd: '/auto', args: '<project> <off|suggest|stage|ship|pause|resume>', desc: 'steer autonomy for a project', local: true },
  { cmd: '/goal', args: '<text> | stop', desc: 'run the active project toward a goal for as long as it takes (stage mode, verified changes and explicit merge approval)', local: true },
  { cmd: '/play', args: '<project> [stop|status]', desc: 'launch the project\'s dev server and open it', local: true },
  { cmd: '/project', args: '[name]', desc: 'show or switch the active project', local: true },
  { cmd: '/new', args: '<name> [web|game]', desc: 'start a new project (git repo in ~/NibbiProjects; web = vite scaffold, game = rules/design + plan)', local: true },
  { cmd: '/issue', args: '<text>', desc: 'file an issue to the vault for the active project (nibbi triages it)', local: true },
  { cmd: '/playtest', args: '[project]', desc: 'playtest mode: every report gets logged and triaged', local: false },
  { cmd: '/endtest', args: '', desc: 'end playtest mode with a session summary', local: false },
  { cmd: '/artifacts', args: '[project]', desc: 'what fixers produced: diffs, exports, screenshots', local: true },
  { cmd: '/log', args: '<fixer-id>', desc: 'a fixer\'s recent log', local: true },
  { cmd: '/report', args: '[hours]', desc: 'build report for the last N hours', local: true },
  { cmd: '/history', args: '<query>', desc: 'search past conversations', local: true },
  { cmd: '/recent', args: '[n]', desc: 'bring back the last exchanges, oldest first', local: true },
  { cmd: '/vault', args: '<path>', desc: 'read a file from the brain (e.g. plans/battalion.md)', local: true },
  { cmd: '/journal', args: '[YYYY-MM-DD]', desc: 'today\'s journal page (or a given day)', local: true },
  { cmd: '/model', args: '[default|opus|sonnet|haiku]', desc: 'switch the brain\'s model', local: true },
  { cmd: '/proposals', args: '', desc: 'review protected-file changes', local: true },
  { cmd: '/clear', args: '', desc: 'fresh working context (vault memory carries forward)', local: false },
  { cmd: '/deploy', args: '<project>', desc: 'run the project\'s own deploy script (two clicks, live log)', local: true },
  { cmd: '/phone', args: '', desc: 'pair a phone over local HTTPS', local: true },
  { cmd: '/settings', args: '', desc: 'providers, skills, vault, schedules and activity', local: true },
  { cmd: '/skills', args: '', desc: 'inspect and enable pinned skill revisions', local: true },
  { cmd: '/activity', args: '', desc: 'all retained runs and recovery actions', local: true },
  { cmd: '/help', args: '', desc: 'this list', local: true },
];

async function runLocalCommand(name, arg, opts) {
  switch (name) {
    case 'preview': return localTurn('/preview ' + arg, async () => {
      const [id, action] = arg.split(/\s+/); if (!id) return { ok: false, text: 'Use /preview <fixer-id> [stop].' };
      if (action === 'stop') { await api.command('preview.stop', { id }); return { text: 'Preview stopping.' }; }
      await api.command('preview.start', { id }); let status;
      for (let i = 0; i < 20; i++) { status = await api.get('/api/preview?id=' + encodeURIComponent(id)); if (status.url || !status.running) break; await sleep(500); }
      if (status.error) throw new Error(status.error);
      return { text: status.url ? 'Preview ready: ' + status.url : 'Preview is still starting. Run /preview ' + id + ' again to check.', acts: status.url ? [{ label: 'open preview', run: () => openUrl(status.url) }] : [] };
    });
    case 'deploy': { const go = /(^|\s)--go$/.test(arg || ''); const proj = (arg || '').replace(/(^|\s)--go$/, '').trim() || activeProject();
      return localTurn('/deploy ' + proj, async (T) => {
        if (!go) return { text: 'Deploy **' + proj + '**? I run the project\'s own `npm run deploy` here on this Mac and show the log as it goes.', acts: [{ label: 'deploy', confirm: 'deploy ' + proj + ' — sure?', warn: true, run: () => send('/deploy ' + proj + ' --go') }] };
        const st = addStep(T, 'running npm run deploy in ' + proj);
        const logEl = document.createElement('pre'); logEl.className = 'runlog'; T.said.appendChild(logEl);
        const res = await fetch('/nibbi/run', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': requestId() }, body: JSON.stringify({ project: proj, script: 'deploy' }) });
        if (!res.ok) { const j = await res.json().catch(() => ({})); markStep(st, 'fail'); if (res.status === 409) return { ok: false, text: '**' + proj + '** has no `deploy` script yet. Add one to its `package.json` — e.g. `"deploy": "sh scripts/deploy.sh"` — and `/deploy ' + proj + '` will run it with a live log.' + (j.scripts && j.scripts.length ? ' Scripts it has: ' + j.scripts.map((s) => '`' + s + '`').join(', ') + '.' : ''), acts: [{ label: 'ask nibbi to write one', run: () => send('write a deploy script for ' + proj + ' and add it as npm run deploy — ask me where it deploys to first') }] }; return { ok: false, text: humanError(j.error || ('HTTP ' + res.status)) }; }
        const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '', code = null, lines = [];
        for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2); let ev = '', data = ''; for (const l of chunk.split('\n')) { if (l.startsWith('event:')) ev = l.slice(6).trim(); else if (l.startsWith('data:')) data += l.slice(5).trim(); } if (!data) continue; const d = JSON.parse(data); if (ev === 'line') { lines.push(d.t); logEl.textContent = lines.slice(-14).join('\n'); nibbi.pulse(0.3); } else if (ev === 'done') code = d.code; } }
        markStep(st, code === 0 ? 'done' : 'fail');
        const ok = code === 0; const tail = lines.slice(-6).join('\n');
        return { ok, text: (ok ? '**' + proj + '** deployed ✓' : 'Deploy of **' + proj + '** exited with code ' + code + '.') + (tail ? '\n\n```\n' + tail + '\n```' : ''), acts: ok ? [] : [{ label: 'try again', run: () => send('/deploy ' + proj + ' --go') }] };
      }); }
    case 'phone': openPlatform('Phone'); return true;
    case 'settings': openPlatform('Providers'); return true;
    case 'skills': openPlatform('Skills'); return true;
    case 'schedules': openPlatform('Schedules'); return true;
    case 'activity': openPlatform('Activity'); return true;
    case 'proposals': openPlatform('Proposals'); return true;
    case 'help': return localTurn('/help', async () => ({ text: COMMANDS.filter((c) => !c.hidden).map((c) => '`' + c.cmd + (c.args ? ' ' + c.args : '') + '` — ' + c.desc).join('\n'), acts: [{ label: 'what\'s new?', run: () => send('what\'s new since we last talked?') }] }));
    case 'project': return localTurn('/project' + (arg ? ' ' + arg : ''), async (T) => {
      if (!S.projects || !S.projects.length) await refreshProjects();
      if (arg) { const p = (S.projects || []).find((x) => x.name.toLowerCase() === arg.toLowerCase()); if (!p) return { ok: false, text: 'No project called **' + md.esc(arg) + '**. I know: ' + projectNames().join(', ') + '.' }; S.project = p.name; LS.set('project', p.name); refreshStatus(); }
      const p = (S.projects || []).find((x) => x.name === activeProject());
      if (!p) return { ok: false, text: 'No projects registered yet. `/new <name>` starts one.' };
      let ms = [], commits = [], readme = '', issues = null;
      try { ms = await api.get('/api/milestones?project=' + encodeURIComponent(p.name)); } catch { /* none */ }
      try { commits = await api.get('/nibbi/git?project=' + encodeURIComponent(p.name) + '&n=5'); } catch { /* none */ }
      try { const rd = await api.get('/nibbi/repo?project=' + encodeURIComponent(p.name) + '&path=README.md'); readme = String(rd.content || '').replace(/^#.*\n/, '').trim().split(/\n\s*\n/)[0].slice(0, 280); } catch { /* none */ }
      try { const f = await issuesFile(p.name); issues = f ? (f.content.match(/^\s*[-*]\s*\[ \]/gm) || []).length : null; } catch { /* none */ }
      const done = ms.reduce((a, m) => a + m.done, 0), total = ms.reduce((a, m) => a + m.total, 0);
      const auto = (S.auto || {})[p.name];
      const staged = (S.fixers || []).filter((f) => f.status === 'staged' && (f.game || f.project) === p.name).length;
      const lines = ['Working in **' + p.name + '** — `' + p.repo + '`', readme ? '_' + md.esc(readme) + '_' : '', '`' + (p.branch || '?') + '`' + (p.dirty ? ' · ' + p.dirty + ' dirty file' + (p.dirty > 1 ? 's' : '') : ''), total ? 'plan · ' + done + '/' + total + ' tasks (' + Math.round(100 * done / total) + '%)' : 'no plan file yet (`plans/' + p.name + '.md`)', auto ? 'auto ' + (auto.on ? auto.mode + ' mode · ' + auto.inflight + ' in flight · ' + auto.pending + ' pending · ' + auto.staged + ' staged' : 'off') : '', (issues !== null ? issues + ' open issue' + (issues === 1 ? '' : 's') : 'no issues file yet') + (staged ? ' · ' + staged + ' fix' + (staged > 1 ? 'es' : '') + ' staged for review' : ''), commits.length ? '\n**recent commits**\n' + commits.map((c) => '`' + c.hash + '` ' + md.esc(c.msg).slice(0, 70) + ' — ' + relTime(c.at)).join('\n') : ''].filter(Boolean);
      const others = projectNames().filter((n) => n !== p.name);
      return { text: lines.join('\n'), acts: [{ label: 'plan', run: () => send('/plan ' + p.name) }, ...(staged ? [{ label: 'review', run: () => send('/review ' + p.name) }] : []), ...(S.playable || []).filter((x) => x.name === p.name).map(() => ({ label: 'play', run: () => send('/play ' + p.name) })), { label: 'issues', run: () => send('/issue') }, ...others.slice(0, 1).map((n) => ({ label: 'switch to ' + n, run: () => send('/project ' + n) }))] };
    });
    case 'new': { const tm = arg.match(/^(.*?)\s+(web|game)$/i); const name = (tm ? tm[1] : arg).trim(); const template = tm ? tm[2].toLowerCase() : null;
      return localTurn('/new ' + arg, async (T) => {
      if (!name) return { ok: false, text: 'Give it a name: `/new <name> [web|game]`.' };
      const st = addStep(T, 'creating the repo');
      const existing = template && (S.projects || []).find(p => p.name === name.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
      const r = existing ? { slug: existing.name, repo: existing.repo } : await api.post('/api/project-create', { mode: 'new', name });
      markStep(st, 'done'); await refreshProjects(); S.project = r.slug; LS.set('project', r.slug);
      if (!template) return { text: '**' + md.esc(name) + '** exists now — `' + r.repo + '`, git initialised and registered. It\'s the active project.\n\nWant a starting point?', acts: [{ label: 'web app (vite)', run: () => send('/new ' + name + ' web') }, { label: 'game (rules + plan)', run: () => send('/new ' + name + ' game') }, { label: 'plan it', run: () => { ask.value = 'Plan ' + name + ': '; ask.focus(); autosize(); } }] };
      const st2 = addStep(T, 'laying down the ' + template + ' template' + (template === 'web' ? ' + npm install' : ''));
      const result = await api.command('project.scaffold', { template }, r.slug);
      const files = result.files, code = 0; markStep(st2, 'done');
      if (template === 'game') { const st3 = addStep(T, 'writing plans/' + r.slug + '.md'); try { await api.post('/nibbi/vault-write', { log: 'plan | ' + r.slug + ': roadmap skeleton created from Nibbi (/new game)', path: 'plans/' + r.slug + '.md', content: '# ' + name + ' — Roadmap\n\n**Vision:** (one sentence — Nibbi will refine this with you)\n\n## M1: Rules on paper\n- [ ] Write design.md pillars and core loop\n- [ ] Write rules.md: setup, turn, winning\n- [ ] First hand-played session logged in playtests/\n\n## M2: Simulation\n- [ ] Card/component data as JSON\n- [ ] src/sim.js plays a full game with random policies\n- [ ] Balance report from 1000 sims\n\n## M3: Playable digital slice\n- [ ] Web hot-seat client\n- [ ] Playtest mode reports flow into issues.md\n' }); markStep(st3, 'done'); } catch { markStep(st3, 'fail'); } await refreshProjects(); }
      await refreshProjects();
      const ok = code === 0;
      return { ok, text: ok ? '**' + md.esc(name) + '** is a ' + (template === 'web' ? 'web app' : 'game') + ' now — `' + r.repo + '`' + (files.length ? ' (' + files.map((f) => '`' + f + '`').join(', ') + ')' : '') + '.' + (template === 'web' ? ' `npm run dev` is wired, so `/play ' + r.slug + '` works.' : ' The plan is in the vault; tell me the pitch and I\'ll fill it in.') : 'The template landed but `npm install` exited with ' + code + ' — check the log above.', acts: template === 'web' ? [{ label: 'play it', run: () => send('/play ' + r.slug) }, { label: 'first fix', run: () => { ask.value = '/fix '; ask.focus(); autosize(); } }] : [{ label: 'plan', run: () => send('/plan ' + r.slug) }, { label: 'write the pitch', run: () => { ask.value = 'The pitch for ' + name + ': '; ask.focus(); autosize(); } }] };
    }); }
    case 'issue': return localTurn('/issue' + (arg ? ' ' + arg : ''), async (T) => {
      const proj = activeProject(); const f = await issuesFile(proj);
      if (!arg) { const open = f ? (f.content.match(/^\s*[-*]\s*\[ \][^\n]*/gm) || []).slice(0, 12) : []; return { text: open.length ? '**' + proj + '** — ' + open.length + ' open issue' + (open.length > 1 ? 's' : '') + ' (`' + f.path + '`)\n\n' + open.map((l) => l.trim()).join('\n') : 'No open issues for **' + proj + '**' + (f ? ' in `' + f.path + '`' : '') + '. File one with `/issue <text>`.', acts: [{ label: 'triage them', run: () => send('triage the open issues in ' + (f ? f.path : 'the issues file') + ' for ' + proj + ': bug / balance / idea, severity, and which one to fix first') }] }; }
      const path = f ? f.path : ((S.projects || []).find((x) => x.name === proj && x.kind === 'game') ? 'games/' : 'projects/') + proj + '/issues.md';
      const stamp = new Date().toISOString().slice(0, 10); const line = '- [ ] ' + stamp + ' · ' + arg.replace(/\n+/g, ' ');
      const cur = f ? f.content.replace(/\s+$/, '') : '# ' + proj + ' — issues\n\n> Filed from the app; nibbi triages (bug · balance · idea) and links fixes.\n';
      const st = addStep(T, 'filing to ' + path); await api.post('/nibbi/vault-write', { path, content: cur + '\n' + line + '\n', log: 'issue | ' + proj + ': ' + arg.slice(0, 120) + ' (filed from Nibbi → ' + path + ')' }); markStep(st, 'done');
      return { text: 'Filed to `' + path + '`:\n\n' + line, acts: [{ label: 'fix it now', run: () => send('/fix ' + arg) }, { label: 'ask nibbi to triage', run: () => send('triage the newest issue in ' + path + ' (bug / balance / idea, severity) and tell me whether to dispatch a fixer') }] };
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
      const f0 = fixerById(arg);
      if (f0 && f0.status === 'merged') { const st0 = addStep(T, 'finding the merge commit'); let commits = []; try { commits = await api.get('/nibbi/git?project=' + encodeURIComponent(f0.game || f0.project) + '&n=30'); } catch { /* none */ } markStep(st0, 'done'); const title = fixerTitle(f0); const hit = commits.find((c) => c.msg.includes(f0.id) || c.msg.toLowerCase().includes(title.toLowerCase().slice(0, 24))); return { text: '**' + md.esc(title) + '** is already **merged** into **' + (f0.game || f0.project) + '**' + (hit ? ' — `' + hit.hash + '` ' + md.esc(hit.msg).slice(0, 120) + ' (' + relTime(hit.at) + ')' : '') + (f0.diffstat ? '\n\n```\n' + String(f0.diffstat).trim() + '\n```' : '') + '\n\nThe change lives in project history. Its evidence branch and worktree are retained.', acts: [{ label: 'play ' + (f0.game || f0.project), run: () => send('/play ' + (f0.game || f0.project)) }, { label: 'plan', run: () => send('/plan ' + (f0.game || f0.project)) }] }; }
      const st = addStep(T, 'reading the diff'); const d = await api.get('/api/fixer-diff?id=' + encodeURIComponent(arg)); markStep(st, 'done');
      const f = f0 || { id: arg, status: 'staged' };
      return { html: renderDiff(d), text: (d.diffstat || '').trim(), acts: fixerActs(f, { target: d.target }).filter((a) => a.label !== 'diff' && a.label !== 'what changed') };
    }, opts);
    case 'review': {
      if (S.busy) { toast(NAME + ' is still working — one thing at a time'); return; }
      try { S.fixers = await api.get('/api/fixers'); } catch { /* keep */ }
      const all = arg === 'all'; const proj = all ? null : (arg || activeProject());
      const ids = (S.fixers || []).filter((f) => f.status === 'staged' && (all || (f.game || f.project) === proj)).sort((a, b) => String(a.endedAt).localeCompare(String(b.endedAt))).map((f) => f.id);
      if (!ids.length) return localTurn('/review' + (arg ? ' ' + arg : ''), async () => ({ text: 'Nothing staged' + (all ? '' : ' on **' + proj + '**') + ' — when a fixer finishes it lands here for review.', acts: [{ label: 'review all projects', run: () => send('/review all') }] }));
      S.review = { ids, i: 0, T: null }; hideChips(); setMode('talk');
      await showReview();
      return;
    }
    case 'steer': { const m = arg.match(/^(\S+)\s+([\s\S]+)$/); return localTurn('/steer ' + arg, async () => { if (!m) return { ok: false, text: '`/steer <fixer-id> <note>`' }; const r = await api.post('/api/fixer-steer', { id: m[1], text: m[2] }); return { text: r.text || 'sent' }; }); }
    case 'stop': return localTurn('/stop ' + arg, async () => { if (!arg) return { ok: false, text: '`/stop <fixer-id>`' }; const r = await api.post('/api/fixer-stop', { id: arg }); refreshStatus(); return { text: r.text || 'stopped' }; });
    case 'log': return localTurn('/log ' + arg, async () => { if (!arg) return { ok: false, text: '`/log <fixer-id>`' }; const r = await api.get('/api/fixer-log?id=' + encodeURIComponent(arg)); const es = (r.entries || []).slice(-14); const f = fixerById(arg); const shots = f ? await fixerShots(f) : []; setTimeout(() => { const t = S.turns[S.turns.length - 1]; const row = shotsRow(shots); if (t && row) t.said.appendChild(row); }, 0); return { text: (f ? '**' + md.esc(fixerTitle(f)) + '** · ' + f.status + '\n\n' : '') + (es.length ? es.map((e) => (e.kind === 'tool' ? '› ' : e.kind === 'assistant' ? '' : '· ') + e.text.slice(0, 220)).join('\n') : '_no log yet_'), acts: f ? fixerActs(f) : [] }; }, opts);
    case 'plan': { const em = arg.match(/^edit\s+([\s\S]+)$/i); if (em) { send('Rewrite plans/' + activeProject() + '.md in the vault: ' + em[1] + '. Keep the milestone/checkbox format, keep completed items checked, and reply with a 3-line summary of what changed.'); return; }
      const pm = arg.match(/^propose(?:\s+([\s\S]+))?$/i); if (pm) { if (!pm[1] || !pm[1].trim()) return localTurn('/plan propose', async () => ({ ok: false, text: 'Tell me what to plan: `/plan propose <text>` — I answer with numbered steps you approve before any build starts.' })); await send(pm[1].trim(), [], { mode: 'plan' }); return; } }
      return localTurn('/plan' + (arg ? ' ' + arg : ''), async (T) => {
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
    case 'goal': return localTurn('/goal' + (arg ? ' ' + arg : ''), async () => {
      const proj = activeProject();
      if (!arg) { const all = await api.get('/nibbi/goal'), goal = all[proj]; return { text: goal ? 'Goal: ' + goal.text + ' · ' + (goal.done ? 'complete' : autoOf(proj).mode) + (goal.focus ? ' · ' + goal.focus : '') : 'No goal set. Use /goal finish <milestone ID>, or /goal roadmap for the existing whole plan.', acts: [{ label: 'plan', run: () => send('/plan ' + proj) }] }; }
      if (/^stop$/i.test(arg)) { await api.command('goal.set', { stop: true }, proj); refreshStatus(); return { text: 'Goal cleared and automatic dispatch turned off. Already-running fixers are preserved; use /stop to cancel them.' }; }
      const milestones = await api.get('/api/milestones?project=' + encodeURIComponent(proj));
      const id = arg.match(/\bM\d+\b/i)?.[0], matches = milestones.filter(m => id ? m.name.toLowerCase().match(/^m\d+\b/)?.[0] === id.toLowerCase() : m.name.toLowerCase() === arg.replace(/^finish\s+/i, '').toLowerCase());
      if (!milestones.length || (!/^roadmap$/i.test(arg) && matches.length !== 1)) return { text: 'Choose one existing milestone from /plan, or use /goal roadmap for the whole plan. For a new goal, ask me to write a milestone first.', acts: [{ label: 'plan', run: () => send('/plan ' + proj) }, { label: 'plan this goal', run: () => send('Plan a milestone for this goal in plans/' + proj + '.md: ' + arg + '. Do not dispatch yet.') }] };
      const focus = matches[0]?.name;
      await api.command('goal.set', { text: arg, focus, mode: 'stage' }, proj); refreshStatus();
      return { text: 'Goal set on ' + proj + (focus ? ': ' + focus : ': the whole roadmap') + '. Auto is in stage mode: fixers work and verify; you approve each merge. Failures pause dispatch for review. /goal stop turns auto off.', acts: [{ label: 'plan', run: () => send('/plan ' + proj) }] };
    });
    case 'auto': { const m = arg.match(/^(\S+)\s+(off|suggest|stage|ship|pause|resume|on)$/i); return localTurn('/auto ' + arg, async () => {
      if (!m) return { ok: false, text: '`/auto <project> <off|suggest|stage|ship|pause|resume>`' };
      const proj = m[1], mode = m[2].toLowerCase();
      const patch = mode === 'pause' ? { on: false } : mode === 'resume' || mode === 'on' ? { on: true } : mode === 'off' ? { on: false, mode: 'off' } : { on: true, mode, autoMerge: mode === 'ship' };
      const r = await api.post('/api/auto', { project: proj, ...patch }); refreshStatus();
      const cfg = r && r[proj] ? r[proj] : (r || {});
      return { text: 'Auto on **' + proj + '** is now ' + (cfg.on === false || mode === 'pause' || mode === 'off' ? '**off**' : '**' + (cfg.mode || mode) + '** mode' + (cfg.maxConcurrent ? ' · up to ' + cfg.maxConcurrent + ' fixers at once' : '')) + '.' + (mode === 'ship' ? '\n\n_ship = fixers merge themselves when the gate passes. Stage keeps you in the loop._' : ''), acts: [{ label: 'plan', run: () => send('/plan ' + proj) }] }; }); }
    case 'model': openPlatform('Providers'); return true;
    case 'recent': {
      if (S.busy) { toast(NAME + ' is still working — one thing at a time'); return; }
      let items = []; try { items = await api.get('/api/history?n=' + Math.min(200, (Number(arg) || 12) * 4)); } catch (e) { toast('history unavailable: ' + e.message); return; }
      const msgs = (Array.isArray(items) ? items : (items.items || [])).filter((m) => m.channel === 'app' && m.text && !/^\(voice\)\s*$/.test(m.text)).slice(-((Number(arg) || 12) * 2));
      if (!msgs.length) { toast('nothing recent'); return; }
      hideChips(); setMode('talk'); body.classList.remove('rest');
      let lastTs = 0, T = null;
      for (const m of msgs) {
        const ts = Date.parse(m.ts);
        if (ts - lastTs > 3600000) { const sep = document.createElement('div'); sep.className = 'when'; const d = new Date(ts); const sameDay = d.toDateString() === new Date().toDateString(); sep.textContent = (sameDay ? 'today' : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })) + ' · ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); feed.appendChild(sep); }
        lastTs = ts;
        if (m.role === 'user') { T = newTurn(m.text.replace(/^(🖼️\s*)+/, '')); T.plain = m.text.trim().startsWith('/'); T.bubble.classList.remove('live'); T.restored = true; T.said.textContent = ''; T.el.removeAttribute('aria-busy'); }
        else { if (!T || T.said.textContent || T.acc) { T = newTurn(null); T.bubble.classList.remove('live'); T.restored = true; } updateLocalReply(T, m); setSaid(T, m.text, false); T.done = true; T.meta.textContent = new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + (m.costUsd ? ' · $' + m.costUsd.toFixed(3) : ''); T.acc = m.text; }
      }
      for (const t of S.turns) if (t.restored && !t.done) { t.said.textContent = ''; t.done = true; }
      S.stick = true; scrollFeed(true); nibbi.lookFree(); scheduleIdleTimers();
      return;
    }
    case 'history': return localTurn('/history ' + arg, async () => { if (!arg) return { ok: false, text: '`/history <query>`' }; const r = await api.get('/api/history?q=' + encodeURIComponent(arg) + '&n=8'); const items = Array.isArray(r) ? r : (r.items || []); if (!items.length) return { text: 'Nothing about "' + md.esc(arg) + '" in the log.' }; return { text: items.slice(0, 8).map((e) => '**' + (e.role === 'user' ? 'you' : NAME) + '**' + (e.role !== 'user' && localReplyLabel(e) ? ' · ' + md.esc(localReplyLabel(e)) : '') + ' · ' + new Date(e.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + '\n' + String(e.text || '').replace(/\s+/g, ' ').slice(0, 220)).join('\n\n') }; });
    case 'vault': return localTurn('/vault ' + arg, async () => { if (!arg) return { ok: false, text: '`/vault <path>` — e.g. `/vault plans/battalion.md`' }; const r = await api.get('/api/vault?p=' + encodeURIComponent(arg)); return { text: '`' + md.esc(arg) + '`\n\n' + String(r.content || '').slice(0, 6000), acts: [{ label: 'ask nibbi to change it', run: () => { ask.value = 'In ' + arg + ', '; ask.focus(); autosize(); } }] }; });
    case 'journal': return localTurn('/journal' + (arg ? ' ' + arg : ''), async () => { const day = arg || new Date().toLocaleDateString('en-CA'); const r = await api.get('/api/vault?p=' + encodeURIComponent('journal/' + day + '.md')); const c = String(r.content || ''); if (!c || c === '(missing)') return { text: 'No journal page for **' + day + '** yet.', acts: [{ label: 'what happened today?', run: () => send('what happened today? give me the short version, then write the journal page') }] }; return { text: '`journal/' + day + '.md`\n\n' + c.slice(0, 6000), acts: [{ label: 'yesterday', run: () => { const d = new Date(day); d.setDate(d.getDate() - 1); send('/journal ' + d.toLocaleDateString('en-CA')); } }] }; });
    case 'report': return localTurn('/report' + (arg ? ' ' + arg : ''), async () => { const r = await api.get('/api/build-report?hours=' + (Number(arg) || 24)); return { text: r.text || '_nothing to report_' }; });
    case 'artifacts': return localTurn('/artifacts' + (arg ? ' ' + arg : ''), async () => {
      const proj = arg || activeProject(); const r = await api.get('/api/artifacts?project=' + encodeURIComponent(proj));
      const ch = (r.changes || []).slice(0, 10);
      if (!ch.length && !(r.files || []).length) return { text: 'Nothing produced for **' + proj + '** yet.' };
      const staged = ch.filter((c) => c.status === 'staged');
      const lines = ['**' + proj + '** — ' + staged.length + ' staged for review, ' + ch.filter((c) => c.status === 'merged').length + ' merged recently', ...ch.map((c) => (c.status === 'staged' ? '◦ ' : '✓ ') + '`' + c.id + '` ' + md.esc(c.title) + ' — ' + String(c.diffstat || '').trim().split('\n').pop() + (c.costUsd ? ' · $' + c.costUsd.toFixed(2) : ''))];
      if ((r.files || []).length) lines.push('', 'files: ' + r.files.slice(0, 6).map((f) => '`' + f.name + '`').join(' '));
      return { text: lines.join('\n'), acts: staged.slice(0, 3).map((c) => ({ label: 'diff ' + c.id, run: () => send('/diff ' + c.id) })) };
    });
    default: return null;
  }
}

/* ---- proof of work: image paths a fixer wrote (repo/.oracle-shots or vault) → thumbnails via /api/file ---- */
async function fixerShots(f) {
  try {
    const r = await api.get('/api/fixer-log?id=' + encodeURIComponent(f.id));
    const paths = new Set();
    for (const e of r.entries || []) for (const m of String(e.text || '').matchAll(/(\/[\w .@-]+(?:\/[\w .@-]+)*\.(?:png|jpe?g|webp))/gi)) { const p = m[1]; if (!/\/tmp\/|node_modules/.test(p)) paths.add(p); }
    return [...paths].slice(-4);
  } catch { return []; }
}
function shotsRow(paths) {
  if (!paths.length) return null;
  const w = document.createElement('div'); w.className = 'shots';
  for (const p of paths) { const a = document.createElement('a'); a.href = '/api/file?p=' + encodeURIComponent(p); a.target = '_blank'; a.rel = 'noopener'; const im = document.createElement('img'); im.src = a.href; im.alt = p.split('/').pop(); im.loading = 'lazy'; im.onload = () => scrollFeed(false); im.onerror = () => a.remove(); a.appendChild(im); w.appendChild(a); }
  return w;
}

/* ------------------------------------------------------------------ sounds: three quiet ink plops, synthesised, off by default */
let audioCtxS = null;
function sound(kind) {
  if (!LS.get('sounds', false) || reducedMotion.matches) return;
  try {
    audioCtxS = audioCtxS || new (window.AudioContext || window.webkitAudioContext)();
    const c = audioCtxS, t0 = c.currentTime, o = c.createOscillator(), g = c.createGain();
    const f = { send: [520, 380], land: [300, 440], error: [220, 140] }[kind] || [400, 300];
    o.type = 'sine'; o.frequency.setValueAtTime(f[0], t0); o.frequency.exponentialRampToValueAtTime(f[1], t0 + 0.12);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.08, t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
    o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + 0.18);
  } catch { /* no audio */ }
}

/* ------------------------------------------------------------------ native hooks (desktop shell): notifications + dock badge, feature-detected */
let notificationPermission = 'unavailable', notificationCheck = 0;
function notificationApi() {
  const native = window.__TAURI__?.notification;
  if (typeof native?.isPermissionGranted === 'function' && typeof native?.requestPermission === 'function' && typeof native?.sendNotification === 'function') return { kind: 'native', api: native };
  return typeof window.Notification === 'function' ? { kind: 'browser', api: window.Notification } : null;
}
async function refreshNotificationPermission() {
  const check = ++notificationCheck, n = notificationApi();
  let permission = 'unavailable';
  try { if (n) permission = n.kind === 'native' ? (await n.api.isPermissionGranted() ? 'granted' : 'default') : n.api.permission; } catch { /* unsupported permission bridge */ }
  if (check === notificationCheck) { notificationPermission = permission; syncMargins(); }
}
async function toggleNotifications() {
  const n = notificationApi();
  if (!n) throw new Error('Notifications are not supported here.');
  if (LS.get('notifications', true) && notificationPermission === 'granted') { LS.set('notifications', false); syncMargins(); return; }
  ++notificationCheck;
  let permission = notificationPermission;
  if (permission !== 'granted') permission = await n.api.requestPermission();
  notificationPermission = permission;
  LS.set('notifications', permission === 'granted'); syncMargins();
  if (permission !== 'granted') throw new Error('Notifications are not allowed. You can allow them in system or browser settings.');
}
async function notify(title, body) {
  if (!LS.get('notifications', true)) return;
  try {
    await refreshNotificationPermission();
    const n = notificationApi();
    if (!n || notificationPermission !== 'granted' || !LS.get('notifications', true)) return;
    if (n.kind === 'native') n.api.sendNotification({ title, body });
    else new n.api(title, { body });
  } catch { /* no notifications here */ }
}
async function setBadge(n) { try { const W = window.__TAURI__ && window.__TAURI__.window; if (W && W.getCurrentWindow) { const w = W.getCurrentWindow(); if (w.setBadgeCount) await w.setBadgeCount(n > 0 ? n : undefined); } } catch { /* unsupported */ } }
function refreshBadge() { const n = (S.fixers || []).filter((f) => f.status === 'staged' && (!f.endedAt || Date.now() - Date.parse(f.endedAt) < 7 * 86400000)).length; if (n !== S.badge) { S.badge = n; setBadge(n); } }

/* ------------------------------------------------------------------ host event stream: exact history of what fixers did, even while the window was closed */
let evSource = null, evReady = false, evReplay = [];
function connectEvents() {
  if (S.demo || evSource || !Number.isSafeInteger(S.snapshotCursor)) return;
  // A first visit already has current state from the snapshot. Start there;
  // returning windows retain their cursor and receive changes since last seen.
  const savedCursor = LS.get('eventCursor', null);
  const after = Number.isSafeInteger(savedCursor) && savedCursor > 0 ? savedCursor : S.snapshotCursor;
  LS.set('eventCursor', after);
  const close = subscribeEvents({
    after, onCursor: (id) => LS.set('eventCursor', id),
    onReady: () => { evReady = true; if (evReplay.length) postAwayBubble(evReplay); evReplay = []; refreshStatus(); scheduleProjectRefresh(); },
    onOffline: () => { evReady = false; setLink('offline'); projectSummaries.markStale(); },
    onEvent: (event) => {
      if (/^(run\.updated|vault\.updated|roadmap\.|project\.|goal\.|github\.|build\.)/.test(event.type)) scheduleProjectRefresh(event.projectId || event.payload?.run?.game || event.payload?.project);
      if (event.type === 'run.updated') {
        const run = event.payload.run; if (!run) return; if (run.status === 'done') run.status = 'staged';
        // A record without a GitHub summary keeps the last known one, so the next summary still compares against real history.
        const previous = fixerById(run.id); if (run.github === undefined && previous?.github) run.github = previous.github;
        S.fixers = [...(S.fixers || []).filter((f) => f.id !== run.id), run];
        renderAgents(S.fixers, S.auto); renderProject(); refreshBadge();
        const ev = { ...run, id: run.id, kind: 'fixer', project: run.game, to: run.status, ts: event.at };
        // Binding refreshes re-emit the record with its current status every minute; only a status change is news. The replay buffer keeps every record for the away summary.
        if (!evReady) evReplay.push(ev); else if (runStatusChange(previous, run)) postFixerBubble(run);
        // GitHub delivery transitions (draft PR up, a check failed, remote commits, merged) come from two successive summaries, never from run intent.
        const transition = evReady ? deliveryTransition(previous?.github, run.github) : null;
        // The completion record follows with status merged: one merged bubble either way, and a Build that already merged locally is not narrated twice.
        if (transition === 'merged') { if (runStatusChange(previous, { status: 'merged' })) postFixerBubble({ ...run, status: 'merged' }); }
        else if (transition) postNarration(transition, deliveryContext(transition, run), run.id + ':' + transition);
      } else if (event.type === 'progress.updated') {
        const previous = S.progress, summary = event.payload?.summary;
        if (summary && typeof summary === 'object') { S.progress = summary; syncMargins(); }
        const days = evReady ? streakIncrease(previous, summary) : null;
        if (days) postNarration('streak', { days }, 'streak:' + (event.payload?.day || days));
      } else if (event.type === 'milestone.completed') {
        const p = event.payload || {}; if (!evReady || !p.name) return;
        postNarration('milestone', { milestone: p.name, project: p.project, total: p.total }, (p.project || '') + ':' + (p.milestoneId || p.name) + ':milestone');
      } else if (event.type === 'process.output' || event.type === 'tool.started') {
        const a = agentEls.get(event.runId); if (a) { const tail = a.card.querySelector('.tail'); if (tail) tail.textContent = String(event.payload.text || event.payload.name || '').slice(-400); }
        queueProjectActivity(event.projectId || S.fixers.find(run => run.id === event.runId)?.game);
      } else if (['brief', 'goal.updated', 'goal.completed', 'scheduler.error'].includes(event.type)) {
        const text = event.payload.text || event.payload.message || (event.payload.goal && event.payload.goal.text);
        if (!text) return;
        const ev = { id: 'event-' + event.id, text, ts: event.at, to: 'brief', silent: event.payload.silent };
        if (!evReady) evReplay.push(ev); else { setMode('talk'); const T = newTurn(null); T.plain = false; T.bubble.classList.remove('live'); setSaid(T, text, false); setMeta(T, {}); T.done = true; }
      } else if (event.type === 'auto.updated') {
        S.auto = { ...(S.auto || {}), [event.projectId]: event.payload.config }; renderProject();
      }
    }
  });
  evSource = { close };
}
async function onFixerEvent(ev) {
  if (!['staged', 'failed', 'merged'].includes(ev.to)) { refreshStatus(); return; }
  try { S.fixers = await api.get('/api/fixers'); } catch { /* keep */ }
  const f = fixerById(ev.id) || { id: ev.id, status: ev.to, game: ev.project, title: ev.title, costUsd: ev.costUsd, model: ev.model, diffstat: ev.diffstat };
  postFixerBubble(f);
  renderAgents(S.fixers, S.auto); renderProject(); refreshBadge();
  if (document.hidden) notify('nibbi · ' + (ev.to === 'staged' ? 'ready to review' : ev.to), (ev.title || ev.id) + ' — ' + ev.to + ' on ' + ev.project);
}
// Announced run statuses (id → status) and narration keys (key → kind), bounded so a long-lived window cannot grow it without limit.
const bubbledRunStatus = new Map(), BUBBLE_MEMORY = 500;
function rememberBubble(key, value) { bubbledRunStatus.delete(key); bubbledRunStatus.set(key, value); while (bubbledRunStatus.size > BUBBLE_MEMORY) bubbledRunStatus.delete(bubbledRunStatus.keys().next().value); }
function postFixerBubble(f) {
  if (S.busy) { setTimeout(() => postFixerBubble(f), 3000); return; }
  // Several backend records emit run.updated for one transition; announce each run status once.
  if (bubbledRunStatus.get(f.id) === f.status) return; rememberBubble(f.id, f.status);
  setMode('talk'); body.classList.remove('rest');
  const T = newTurn(null); T.plain = false; T.bubble.classList.remove('live');
  const title = md.esc(fixerTitle(f)); const stat = String(f.diffstat || '').trim().split('\n').pop() || '';
  const cost = (f.costUsd ? ' · $' + Number(f.costUsd).toFixed(2) : '') + (f.model ? ' · ' + f.model : '');
  const mode = githubBuild(f) ? 'github' : autoOf(f.game || f.project).mode;
  const merged = f.status === 'merged' ? narrate('merged', deliveryContext('merged', f)) : null;   // authored line: what merged, where; no next goal
  const text = f.status === 'staged' ? (mode === 'ship' ? 'Fixer **' + title + '** finished on **' + f.game + '**' + (stat ? ' — ' + stat : '') + cost + '. Ship mode: it merges itself once you\'ve been quiet a few minutes (isolated integration → checks → target). I\'ll say when it lands.' : 'Fixer **' + title + '** is done and staged on **' + f.game + '**' + (stat ? ' — ' + stat : '') + cost + '. Review it?') : merged ? merged.text : 'Fixer **' + title + '** failed on **' + f.game + '**.' + (f.summary ? ' ' + md.esc(String(f.summary).slice(0, 160)) : '') + (/maximum number of turns/i.test(String(f.summary || '')) ? ' Work is preserved; inspect it before an explicit retry.' : '');
  setSaid(T, text, false); setMeta(T, {}); T.done = true; if (f.status === 'failed') T.nib.classList.add('error');
  addActs(T, (f.status === 'staged' && mode === 'ship') ? fixerActs(f).filter((a) => !/approve/.test(a.label)) : fixerActs(f), { sticky: true }); T.fixerId = f.id; if (f.status !== 'failed') fixerShots(f).then((ps) => { const row = shotsRow(ps); if (row) T.said.appendChild(row); });
  const a = agentEls.get(f.id); if (a) { const r = a.canvas.getBoundingClientRect(); nibbi.lookAt(r.left + r.width / 2, r.top); setTimeout(() => nibbi.lookFree(), 1800); nibbi.splash(AGENT_INK[hashId(f.id) % AGENT_INK.length], f.status === 'merged' ? 8 : 4); }
  nibbi.setMood(f.status === 'failed' ? 'error' : 'happy'); if (f.status !== 'failed') interactions.event(merged ? 'delivered' : 'success'); setTimeout(() => { if (!S.busy) nibbi.setMood('idle'); }, 1600);
  sound(f.status === 'failed' ? 'error' : 'land');
  $('#sr').textContent = stripMd(text); if (S.voiceOn && !S.demo && S.link !== 'offline') speak(merged ? merged.voice : stripMd(text));
}
/* Authored progress narration. Each line reports one verified event once; wins wait for a quiet moment like postFixerBubble, while a failed check or an outside push may interrupt. */
const NARRATION_BEAT = { 'draft-pr': 'draft', 'checks-failed': 'checks', 'remote-changed': 'attention', milestone: 'milestone', streak: 'streak' };
function postNarration(kind, ctx, key) {
  if (bubbledRunStatus.has(key)) return;
  if (S.busy && kind !== 'checks-failed' && kind !== 'remote-changed') { setTimeout(() => postNarration(kind, ctx, key), 3000); return; }
  rememberBubble(key, kind);
  const { text, voice } = narrate(kind, ctx);
  setMode('talk'); body.classList.remove('rest');
  const T = newTurn(null); T.plain = false; T.bubble.classList.remove('live');
  setSaid(T, text, false); setMeta(T, {}); T.done = true; if (kind === 'checks-failed') T.nib.classList.add('error');
  const beat = NARRATION_BEAT[kind]; if (beat) interactions.event(beat);
  if (kind === 'milestone' || kind === 'streak') { nibbi.setMood('happy'); setTimeout(() => { if (!S.busy) nibbi.setMood('idle'); }, 1600); if (kind === 'milestone') sound('land'); }
  $('#sr').textContent = stripMd(text); if (S.voiceOn && !S.demo && S.link !== 'offline') speak(voice);
}
function postAwayBubble(evs) {
  const latest = new Map(); for (const e of evs) latest.set(e.id, e);   // one line per fixer: its latest state
  const briefs = evs.filter((e) => e.to === 'brief' && !e.silent);
  for (const b of briefs.slice(-3)) { setMode('talk'); const T = newTurn(null); T.plain = false; T.bubble.classList.remove('live'); setSaid(T, b.text, false); T.at = b.ts; setMeta(T, {}); T.done = true; }
  const done = [...latest.values()].filter((e) => ['staged', 'failed', 'merged'].includes(e.to));
  if (!done.length) return;
  setMode('talk'); body.classList.remove('rest');
  const T = newTurn(null); T.plain = false; T.bubble.classList.remove('live');
  const first = Math.min(...done.map((e) => e.ts)); const ago = Math.round((Date.now() - first) / 3600000);
  const grp = (st) => done.filter((e) => e.to === st);
  const parts = [];
  if (grp('merged').length) parts.push(grp('merged').length + ' merged (' + grp('merged').map((e) => md.esc(e.title || e.id)).join(', ') + ')');
  if (grp('staged').length) parts.push(grp('staged').length + ' staged for review (' + grp('staged').map((e) => md.esc(e.title || e.id)).join(', ') + ')');
  if (grp('failed').length) parts.push(grp('failed').length + ' failed (' + grp('failed').map((e) => md.esc(e.title || e.id)).join(', ') + ')');
  const text = 'While you were away' + (ago >= 1 ? ' (last ' + ago + 'h)' : '') + ': ' + parts.join(' · ') + '.';
  setSaid(T, text, false); setMeta(T, {}); T.done = true;
  const acts = grp('staged').slice(0, 2).map((e) => ({ label: 'diff ' + (e.title || e.id).slice(0, 18), run: () => send('/diff ' + e.id) }));
  if (grp('staged').length > 1) acts.push({ label: 'review all', run: () => send('/review') });
  acts.push({ label: 'full report', run: () => send('/report ' + Math.max(1, Math.min(72, ago + 1))) });
  addActs(T, acts); $('#sr').textContent = stripMd(text);
}

/* ------------------------------------------------------------------ review mode: one staged fixer at a time, from the keyboard */
async function showReview() {
  const R = S.review; if (!R) return;
  const render = R.render = (R.render || 0) + 1;
  const id = R.ids[R.i]; const f = fixerById(id) || { id, status: 'staged' };
  const current = () => S.review === R && R.render === render && R.ids[R.i] === id;
  if (!R.T) { R.T = newTurn('/review'); R.T.plain = false; R.T.bubble.classList.remove('live'); R.T.el.classList.add('review'); }
  const T = R.T; T.said.replaceChildren(); const old = T.body.querySelector('.acts'); if (old) old.remove();
  const head = document.createElement('div'); head.className = 'rhead'; head.innerHTML = '<b>' + (R.i + 1) + ' of ' + R.ids.length + '</b> · ' + escapeHtml(fixerTitle(f)) + ' <span class="m">' + escapeHtml([f.game, f.model, f.costUsd ? '$' + Number(f.costUsd).toFixed(2) : null, f.group].filter(Boolean).join(' · ')) + '</span><span class="keys">j/k next · a approve · x discard · p preview</span>';
  if(githubBuild(f))head.querySelector('.keys').textContent='j/k next · GitHub delivery';
  T.said.appendChild(head);
  if (f.summary) { const s = document.createElement('div'); s.className = 'rsum'; s.textContent = String(f.summary).slice(0, 400); T.said.appendChild(s); }
  try { const d = await api.get('/api/fixer-diff?id=' + encodeURIComponent(id)); if (!current()) return; T.said.appendChild(renderDiff(d)); } catch (e) { if (!current()) return; const p = document.createElement('p'); p.textContent = 'diff unavailable — ' + e.message; T.said.appendChild(p); }
  const acts = [];
  if (R.ids.length > 1) acts.push({ label: 'next (j)', run: () => reviewStep(1) });
  if (githubBuild(f)) acts.push({label:'Review GitHub delivery',run:()=>inspectGithubBuild(f)});
  else acts.push({ label: 'approve & merge (a)', confirm: 'merge — sure?', warn: true, reviewMutation: true, run: () => reviewAct('approve', R, id) }, { label: 'preview (p)', run: () => send('/preview ' + id) }, { label: 'discard (x)', confirm: 'discard this fixer — sure?', reviewMutation: true, run: () => reviewAct('discard', R, id) });
  if (!githubBuild(f) && !R.ids.some(id => githubBuild(fixerById(id))) && R.ids.length > 1 && f.group && R.ids.filter((x) => { const other = fixerById(x); return other?.group === f.group && other.game === f.game; }).length > 1) acts.push({ label: 'merge whole group', confirm: 'merge all of "' + f.group + '" — sure?', warn: true, reviewMutation: true, run: () => reviewAct('group', R, id) });
  acts.push({ label: 'done reviewing', run: endReview });
  addActs(T, acts); S.stick = true; scrollFeed(true);
}
function reviewStep(d) { const R = S.review; if (!R) return; R.i = (R.i + d + R.ids.length) % R.ids.length; showReview(); }
function reviewPending(R, pending) {
  R.pending = pending;
  for (const button of R.T.body.querySelectorAll('[data-review-mutation]')) button.disabled = pending;
}
async function reviewAct(kind, R, id) {
  if (S.review !== R || R.pending || !R.ids.includes(id)) return;
  const f = fixerById(id), removed = kind === 'group' ? R.ids.filter(x => { const other = fixerById(x); return other?.group === f.group && other.game === f.game; }) : [id];
  reviewPending(R, true);
  try {
    if (kind === 'group') { const r = await api.post('/api/group-merge', { project: f.game, group: f.group }); toast((r.text || 'merged').slice(0, 140), 4000); sound('land'); }
    else if (kind === 'approve') { const r = await api.command('run.merge', { id }); toast((r.text || 'merged').slice(0, 140), 4000); sound('land'); }
    else { const r = await api.command('run.discard', { id }); toast((r.text || 'discarded').slice(0, 120), 3000); }
  } catch (e) { toast(e.message); return; }
  finally { reviewPending(R, false); }
  refreshStatus();
  if (S.review !== R) return;
  const selected = R.ids[R.i], previousIndex = R.i;
  R.ids = R.ids.filter(x => !removed.includes(x));
  if (!R.ids.length) { endReview(true); return; }
  const selectedIndex = R.ids.indexOf(selected);
  R.i = selectedIndex >= 0 ? selectedIndex : Math.min(previousIndex, R.ids.length - 1);
  showReview();
}
function endReview(done) { const R = S.review; if (!R) return; S.review = null; if (R.T) { R.T.said.replaceChildren(renderMd(done ? 'Review done — nothing left staged.' : 'Left review mode.')); const a = R.T.body.querySelector('.acts'); if (a) a.remove(); R.T.el.classList.remove('review'); } refreshStatus(); }
function keyboardInputOwned(e, allowComposer = false) {
  const target = e.target instanceof Element ? e.target : document.activeElement;
  // Rail buttons own Space and letter keys too; keep Alt+Space available outside cards.
  const railInput = !!target?.closest('.workspace-sidebar, .sidebar-toggle, .project-workspace') && !(allowComposer && e.altKey && e.code === 'Space');
  return e.defaultPrevented || e.isComposing || railInput || !!document.querySelector('dialog[open], .margin-card:not([hidden])') || ((!allowComposer || target !== ask) && !!target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'));
}
addEventListener('keydown', (e) => {
  if (!S.review || keyboardInputOwned(e) || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  if (e.key === 'j' || e.key === 'ArrowRight') { e.preventDefault(); reviewStep(1); }
  else if (e.key === 'k' || e.key === 'ArrowLeft') { e.preventDefault(); reviewStep(-1); }
  else if (e.key === 'a') { e.preventDefault(); const c = [...S.review.T.body.querySelectorAll('.chip')].find((x) => /approve/.test(x.textContent)); c && c.click(); }
  else if (e.key === 'x') { e.preventDefault(); const c = [...S.review.T.body.querySelectorAll('.chip')].find((x) => /discard/.test(x.textContent)); c && c.click(); }
  else if (e.key === 'p') { e.preventDefault(); send('/preview ' + S.review.ids[S.review.i]); }
  else if (e.key === 'Escape') { e.preventDefault(); endReview(); }
}, true);

/* ------------------------------------------------------------------ fleet events: when a fixer lands while you weren't looking, nibbi says so */
let fleetSeen = null;
function awayBubble(list) {
  const last = LS.get('lastSeen', 0); const now = Date.now(); LS.set('lastSeen', now);
  if (!last || now - last < 20 * 60000) return;
  const since = list.filter((f) => f.endedAt && Date.parse(f.endedAt) > last && ['staged', 'failed', 'merged'].includes(f.status));
  if (!since.length) return;
  setMode('talk'); body.classList.remove('rest');
  const T = newTurn(null); T.plain = false; T.bubble.classList.remove('live');
  const away = Math.round((now - last) / 3600000);
  const grp = (st) => since.filter((f) => f.status === st);
  const parts = [];
  if (grp('merged').length) parts.push(grp('merged').length + ' merged (' + grp('merged').map((f) => md.esc(fixerTitle(f))).join(', ') + ')');
  if (grp('staged').length) parts.push(grp('staged').length + ' staged for your review (' + grp('staged').map((f) => md.esc(fixerTitle(f))).join(', ') + ')');
  if (grp('failed').length) parts.push(grp('failed').length + ' failed (' + grp('failed').map((f) => md.esc(fixerTitle(f))).join(', ') + ')');
  const text = 'While you were away' + (away >= 1 ? ' (' + away + 'h)' : '') + ': ' + parts.join(' · ') + '.';
  setSaid(T, text, false); setMeta(T, {}); T.done = true;
  const acts = grp('staged').slice(0, 2).map((f) => ({ label: 'diff ' + fixerTitle(f).slice(0, 18), run: () => send('/diff ' + f.id) }));
  acts.push({ label: 'full report', run: () => send('/report ' + Math.max(1, Math.min(72, away + 1))) });
  addActs(T, acts); $('#sr').textContent = stripMd(text);
}
function fleetEvents(list) {
  if (!list) return;
  const cur = new Map(list.map((f) => [f.id, f.status]));
  if (fleetSeen === null) { fleetSeen = cur; return; }
  for (const f of list) {
    const prev = fleetSeen.get(f.id);
    if (prev === f.status || (prev === undefined && !ACTIVE.has(f.status))) continue;
    if (!['staged', 'failed', 'merged'].includes(f.status) || S.busy) continue;
    setMode('talk'); body.classList.remove('rest');
    const T = newTurn(null); T.plain = false; T.bubble.classList.remove('live');
    const title = md.esc(fixerTitle(f)); const stat = String(f.diffstat || '').trim().split('\n').pop() || '';
    const cost = (f.costUsd ? ' · $' + f.costUsd.toFixed(2) : '') + (f.model ? ' · ' + f.model : '');
    const text = f.status === 'staged' ? 'Fixer **' + title + '** is done and staged on **' + f.game + '**' + (stat ? ' — ' + stat : '') + cost + '. Review it?' : f.status === 'merged' ? '**' + title + '** merged into **' + f.game + '**.' : 'Fixer **' + title + '** failed on **' + f.game + '**.' + (f.summary ? ' ' + md.esc(String(f.summary).slice(0, 160)) : '');
    setSaid(T, text, false); setMeta(T, {}); T.done = true; if (f.status === 'failed') T.nib.classList.add('error');
    addActs(T, fixerActs(f)); if (f.status !== 'failed') fixerShots(f).then((ps) => { const row = shotsRow(ps); if (row) T.said.appendChild(row); });
    nibbi.setMood(f.status === 'failed' ? 'error' : 'happy'); if (f.status !== 'failed') interactions.event(f.status === 'merged' ? 'milestone' : 'success'); setTimeout(() => { if (!S.busy) nibbi.setMood('idle'); }, 1600);
    $('#sr').textContent = stripMd(text); if (S.voiceOn && !S.demo && S.link !== 'offline') speak(stripMd(text));
  }
  fleetSeen = cur;
}

/* ------------------------------------------------------------------ slash palette */
const paletteEl = document.createElement('div'); paletteEl.id = 'palette'; paletteEl.className = 'palette'; paletteEl.hidden = true; document.body.appendChild(paletteEl);
let palIndex = 0, palItems = [];
let histTimer = 0;
function updatePalette() {
  const v = ask.value; const m = v.match(/^\/(\S*)$/);
  const hm = v.match(/^\/history\s+(.{2,})$/i);
  if (hm) { clearTimeout(histTimer); histTimer = setTimeout(async () => { try { const items = await api.get('/api/history?q=' + encodeURIComponent(hm[1]) + '&n=5'); const list = (Array.isArray(items) ? items : []).slice(0, 5); if (!list.length || !/^\/history\s/.test(ask.value)) { paletteEl.hidden = true; return; } palItems = []; paletteEl.replaceChildren(...list.map((e) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'pi hist'; b.innerHTML = '<span class="c">' + escapeHtml((e.role === 'user' ? 'you' : NAME) + (e.role !== 'user' && localReplyLabel(e) ? ' · ' + localReplyLabel(e) : '')) + '</span><span class="d">' + escapeHtml(relTime(Date.parse(e.ts))) + '</span><span class="t">' + escapeHtml(String(e.text || '').replace(/\s+/g, ' ').slice(0, 110)) + '</span>'; b.onmousedown = (ev) => { ev.preventDefault(); ask.value = ''; autosize(); paletteEl.hidden = true; localTurn('/history ' + hm[1], async () => ({ text: '**' + (e.role === 'user' ? 'you' : NAME) + '**' + (e.role !== 'user' && localReplyLabel(e) ? ' · ' + md.esc(localReplyLabel(e)) : '') + ' · ' + new Date(e.ts).toLocaleString() + '\n\n' + String(e.text || '').slice(0, 1500) })); }; return b; })); const r = pill.getBoundingClientRect(); paletteEl.style.bottom = (innerHeight - r.top + 10) + 'px'; paletteEl.style.width = r.width + 'px'; paletteEl.hidden = false; } catch { /* offline */ } }, 220); return; }
  if (!m) { paletteEl.hidden = true; palItems = []; return; }
  const q = m[1].toLowerCase();
  palItems = COMMANDS.filter((c) => !c.hidden && (c.cmd.slice(1).startsWith(q) || c.desc.toLowerCase().includes(q))).slice(0, 7);
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
const openUrl = (u) => { if (window.__TAURI__) api.post('/api/open', { url: u }).catch(() => window.open(u, '_blank')); else window.open(u, '_blank'); };
async function playFlow(project, action) {
  S.busy = true; body.classList.add('busy'); activity(); hideChips(); ask.value = ''; autosize(); setMode('talk'); syncMargins();
  const T = newTurn('/play ' + project + (action !== 'start' ? ' ' + action : '')); T.plain = false;
  nibbi.setMood('working'); const fr = feed.getBoundingClientRect(); nibbi.lookAt(innerWidth / 2 + 40, fr.top + 30);
  const api = (action) => action === 'status' ? createClient(() => project).get('/api/play?project=' + encodeURIComponent(project)) : createClient(() => project).post('/api/play', { project, action });
  let ok = true, text = '', url = null;
  try {
    if (action === 'stop') { const st = addStep(T, 'stopping the ' + project + ' server'); await api('stop'); markStep(st, 'done'); text = 'Stopped the **' + project + '** server.'; }
    else {
      const st = addStep(T, (action === 'status' ? 'checking on' : 'starting') + ' the ' + project + ' dev server');
      let r = action === 'status' ? await api('status') : await api('start');
      if (r.error) throw new Error(r.error);
      const t0 = performance.now();
      while (!r.url && performance.now() - t0 < 60000) { await sleep(1200); r = await api('status'); if (r.error) throw new Error(r.error); if (!r.running && !r.starting) break; }
      markStep(st, r.url ? 'done' : 'fail');
      if (r.url) { url = r.url; text = '**' + project + '** is up at ' + url + ' — opening it. It runs for an hour, then I put it away.'; openUrl(url); }
      else if (action === 'status') { text = '**' + project + '** isn\'t running.' + (r.playable ? ' Want me to start it?' : ' It has no web dev server (' + (r.kind || 'terminal') + ').'); }
      else { ok = false; text = r.error || 'The server did not become ready. Check the configured preview command in Settings.'; }
    }
  } catch (e) { ok = false; text = /unknown project/i.test(e.message) ? 'I don\'t know a project called **' + project + '**. Registered projects: ' + ((S.projects || []).map((p) => p.name).join(', ') || 'none yet') + '.' : /no web dev server|terminal game/i.test(e.message) ? '**' + project + '** has no web dev server — it\'s a terminal game (`npm run play`).' : 'I couldn\'t launch it — ' + e.message; }
  finishSteps(T, ok); setSaid(T, text, false); setMeta(T, {}); T.done = true; T.el.removeAttribute('aria-busy'); T.bubble.classList.remove('live');
  if (!ok) T.nib.classList.add('error');
  const acts = [];
  if (url) { acts.push({ label: 'open it', run: () => openUrl(url), sticky: true }, { label: 'stop the server', run: () => send('/play ' + project + ' stop') }); }
  else if (ok && action === 'status' && /Want me to start/.test(text)) acts.push({ label: 'start it', run: () => send('/play ' + project) });
  else if (!ok) acts.push({ label: 'try again', run: () => send('/play ' + project) });
  addActs(T, acts, { sticky: !!url });
  S.busy = false; body.classList.remove('busy'); nibbi.lookFree(); nibbi.setMood(ok ? 'happy' : 'error'); if (ok) interactions.event('success'); setTimeout(() => { if (!S.busy) nibbi.setMood('idle'); }, ok ? 1500 : 2600); syncMargins();
  $('#sr').textContent = (T.stepLine ? T.stepLine + '. ' : '') + stripMd(text); scheduleIdleTimers();
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
const registeredProject = () => { const p = activeProject(); return p && p !== 'vault' && (S.projects || []).some((x) => x.name === p && x.kind !== 'brain') ? p : null; };
/* the send button's meaning follows the turn: steer while a steerable turn runs, stop otherwise, finish-voice/send when idle */
function syncSendButton() {
  if (S.busy) {
    const steer = !!(S.activeRunId && S.steerable && ask.value.trim());   // the label names what pressing it does: guidance only with text, otherwise stop
    sendBtn.setAttribute('aria-label', steer ? 'steer' : 'stop watching');
    sendBtn.title = steer ? 'Send this as guidance to the running turn' : S.activeRunId && S.steerable ? 'Stop watching this turn — type to steer it instead' : 'Stop watching this turn';
    body.classList.toggle('steer-ready', steer);
    return;
  }
  body.classList.remove('steer-ready');
  sendBtn.setAttribute('aria-label', S.voiceFinishing ? 'Finish voice message' : 'send');
  sendBtn.title = S.voiceFinishing ? 'Finish this voice message now' : 'Send message';
}
async function send(text, images, opts) {
  text = (text || '').trim(); images = images || []; opts = opts || {};
  if (!text && !images.length) return;
  if (S.busy) { toast(NAME + ' is still working — one thing at a time'); return; }
  if (S.projectView) closeProjectView(false);
  if (listening && wakeVoice.snapshot().phase !== 'sending') wakeVoice.setSuspended(true);
  const isCommand = text.startsWith('/');
  if (S.demo && isCommand) { toast('Demo is read-only. Leave demo mode to run commands.'); return; }
  const pm = text.match(/^\/play\s+([\w.-]+)(?:\s+(stop|status))?\s*$/i);
  if (pm) { await playFlow(pm[1].toLowerCase(), (pm[2] || 'start').toLowerCase()); return; }
  const cm = text.match(/^\/(\w+)\s*([\s\S]*)$/);
  if (cm && COMMANDS.some((c) => c.cmd === '/' + cm[1].toLowerCase() && c.local)) { await runLocalCommand(cm[1].toLowerCase(), cm[2].trim()); return; }
  const mode = opts.mode === 'plan' || (S.planFirst && !isCommand) ? 'plan' : 'chat';   // plan mode: the brain proposes steps; nothing is dispatched until you approve
  if (mode === 'plan' && !S.demo && !registeredProject()) { toast('Pick a project first'); return; }
  if (mode === 'plan' && S.planFirst) setPlanFirst(false);
  S.busy = true; body.classList.add('busy'); S.activeRunId = null; S.steerable = false; syncSendButton(); syncMargins();
  activity(); hideChips();
  ask.value = ''; autosize(); clearAttach(); sound('send');
  setMode('talk');
  const T = newTurn(text, images); T.plain = isCommand; T.mode = mode; S.liveTurn = T;
  if (mode === 'plan') T.el.classList.add('plan');
  nibbi.setMood('thinking'); interactions.event('send');
  const feedRect = feed.getBoundingClientRect(); nibbi.lookAt(innerWidth / 2 + 40, feedRect.top + 30);
  setLink('busy');

  const ctrl = new AbortController(); S.abort = ctrl;
  const brain = S.demo ? demoTurn : (S.link === 'offline' ? offlineTurn : sseTurn);
  let waitStep = null; if (!S.demo && S.status && S.status.busy) waitStep = addStep(T, 'waiting — the brain is busy with another turn (cron or fixer); yours is queued');
  const limitNotice = !S.demo && rateLimitNotice(S.status?.rateLimit);
  if (limitNotice) waitStep = waitStep || addStep(T, limitNotice);
  let result = null, spoke = false, toolCount = 0, lastFixerPoll = 0;
  sentenceCursor = 0; sentencesSpoken = 0; S.spokeStream = false; stopSpeaking();
  const fixerBefore = new Map((S.fixers || []).map((f) => [f.id, f.status]));
  try {
    for await (const e of brain(text, images, ctrl.signal, mode)) {
      if (waitStep) { markStep(waitStep, 'done'); if (T.liveStep === waitStep) T.liveStep = null; waitStep = null; }
      if (e.ev === 'start') { S.activeRunId = e.runId; T.runId = e.runId; S.steerable = false; syncSendButton(); }
      else if (e.ev === 'ready') { if (e.runId) { S.activeRunId = e.runId; T.runId = e.runId; } S.steerable = !!e.steerable; syncSendButton(); }
      else if (e.ev === 'fallback') {
        S.steerable = false; syncSendButton();   // the local fallback cannot take guidance
        updateLocalReply(T, e.fallback || e);
        stopSpeaking(); sentenceCursor = 0; sentencesSpoken = 0; S.spokeStream = false;
      } else if (e.ev === 'tool' && e.name && !T.local) {
        const ev = describeToolEvent(e);
        if (ev.phase === 'finished') finishToolStep(T, ev);
        else {
          toolCount++;
          if (spoke && T.acc && !/\n\s*$/.test(T.acc)) { T.acc += '\n\n'; }
          addStep(T, ev.label, null, ev);
          if (nibbi.mood() !== 'working') nibbi.setMood('working');
          if (toolCount % 3 === 1) nibbi.spatter(1, 0.9);
          if (performance.now() - lastFixerPoll > 4000) { lastFixerPoll = performance.now(); pollFixers(T, fixerBefore); }
        }
      } else if (e.ev === 'delta' && e.t) {
        if (!spoke) { spoke = true; nibbi.setMood('speaking'); if (T.liveStep) { markStep(T.liveStep, 'done'); T.liveStep = null; } }
        setSaid(T, T.acc + e.t, true);
        nibbi.pulse(Math.min(1, 0.35 + e.t.length * 0.03)); if (!T.local) streamSpeech(T);
      } else if (e.ev === 'done') { updateLocalReply(T, e); result = e; }
    }
  } catch (err) {
    if (err.name === 'AbortError') result = { text: T.acc || '_stopped watching — ' + NAME + ' may still be working in the background._', isError: false, aborted: true };
    else result = { text: (err.message || String(err)), isError: true };
  }
  result = result || { text: 'No terminal result was received. Check Activity before retrying.', isError: true }; S.activeRunId = null; S.steerable = false; S.liveTurn = null;
  result = settleLocalReply(result, T);
  if (T.local && (result.isError || result.aborted)) { stopSpeaking(); S.spokeStream = false; }
  const squash = (s) => String(s || '').replace(/»(voice|acts):[^\n]*\n?/g, '').replace(/\s+/g, '');
  if (T.acc && result.text && squash(T.acc) === squash(result.text)) result.text = T.acc.replace(/»voice:[^\n]*\n?/g, '');
  const ok = !result.isError;
  if (!ok) { result.raw = result.text; if (!T.local) result.text = humanError(result.text); }
  finishSteps(T, ok);
  setSaid(T, result.text || '', false);
  setMeta(T, result);
  if (result.costUsd) S.sessionCost += result.costUsd; S.sessionTurns++;
  T.el.removeAttribute('aria-busy'); T.bubble.classList.remove('live');
  $('#sr').textContent = (T.stepLine ? T.stepLine + '. ' : '') + (ok ? stripMd(result.text).slice(0, 400) : 'nibbi hit a problem: ' + stripMd(result.text).slice(0, 200));
  T.done = true;
  if (!ok) T.nib.classList.add('error');
  if (result.proposal && typeof result.proposal === 'object') renderProposalCard(T, result.proposal, text);
  S.busy = false; body.classList.remove('busy'); S.abort = null; syncSendButton(); syncMargins();
  nibbi.lookFree();
  if (!ok) { nibbi.setMood('error'); addActs(T, T.local ? [{ label: 'try again', run: () => send(T.text) }] : errorActs(result.text)); setTimeout(() => { if (!S.busy) nibbi.setMood('idle'); }, 2600); }
  else if (!result.aborted) { nibbi.setMood('happy'); interactions.event('success'); setTimeout(() => { if (!S.busy) nibbi.setMood('idle'); }, 1500); }
  else nibbi.setMood('idle');
  if (ok && !result.aborted && !S.spokeStream) speak(result.voice || firstSentences(stripMd(parseActs(result.text).clean), 2, 320));
  if (isCommand && ok && !T.local) { const urls = [...String(result.text).matchAll(/https?:\/\/[^\s)]+/g)].map(m => m[0]); if (urls.length) addActs(T, urls.slice(0, 2).map(u => ({ label: 'open ' + u.replace(/^https?:\/\//, '').slice(0, 28), run: () => openUrl(u) })), { sticky: true }); }
  if (!isCommand && !T.local && ok && !result.proposal) { const pa = parseActs(result.text); if (pa.acts.length) addActs(T, pa.acts.map((a) => ({ label: a, run: () => send(a) }))); else addActs(T, replyActs(result.text)); }
  setLink(S.demo ? 'demo' : 'live');
  refreshStatus();
  if (ok && !isCommand && !T.local && !T.nib.querySelector('.acts')) addActs(T, chipSet('after').map((c) => ({ label: c.label, run: () => send(c.text) })));
  scheduleIdleTimers();
}

/* ---- plan before dispatch: the review card under a plan-mode reply. Approve → plan.execute queues exactly the reviewed steps. ---- */
const PLAN_STATE_LABEL = { prepared: 'awaiting approval', executing: 'queuing…', executed: 'approved', failed: 'failed', cancelled: 'cancelled', expired: 'expired', changed: 'review changed', interrupted: 'interrupted' };
const PLAN_FINAL = new Set(['executed', 'failed', 'cancelled', 'expired', 'changed', 'interrupted']);
const PLAN_ERROR_STATE = { REVIEW_CHANGED: 'changed', PLAN_EXPIRED: 'expired', PLAN_CANCELLED: 'cancelled', PLAN_EXECUTED: 'executed', PLAN_FAILED: 'failed', PLAN_INTERRUPTED: 'interrupted' };
function postPlanBubble(text) {
  setMode('talk'); const B = newTurn(null); B.plain = false; B.bubble.classList.remove('live');
  setSaid(B, text, false); setMeta(B, {}); B.done = true; B.el.removeAttribute('aria-busy');
  $('#sr').textContent = stripMd(text);
}
function renderProposalCard(T, p, prompt) {
  const review = p.review && typeof p.review === 'object' ? p.review : {};
  const steps = Array.isArray(review.steps) ? review.steps : [], warnings = Array.isArray(review.warnings) ? review.warnings.map((w) => String(w)) : [];
  const card = document.createElement('section'); card.className = 'planr'; card.setAttribute('aria-label', 'plan review');
  const head = document.createElement('div'); head.className = 'prh';
  const title = document.createElement('b'); title.textContent = p.state === 'failed' ? 'Plan could not be prepared' : 'Plan · ' + steps.length + ' step' + (steps.length === 1 ? '' : 's') + (p.project ? ' on ' + p.project : '');
  const state = document.createElement('span'); state.className = 'prs';
  const expiry = document.createElement('span'); expiry.className = 'prx';
  head.append(title, state, expiry); card.appendChild(head);
  const summary = String(review.summary || p.summary || '').trim();
  if (summary) { const s = document.createElement('p'); s.className = 'prsum'; s.textContent = summary; card.appendChild(s); }
  if (p.state === 'failed') {
    const err = document.createElement('p'); err.className = 'prerr'; err.textContent = String(p.error || 'The plan could not be parsed.'); card.appendChild(err);
    const rationale = String(p.rationale || '').trim(); if (rationale && rationale !== String(T.acc || '').trim()) { const r = document.createElement('p'); r.className = 'prsum'; r.textContent = clipText(rationale, 600); card.appendChild(r); }
  }
  if (steps.length) {
    const ol = document.createElement('ol'); ol.className = 'prsteps';
    for (const s of steps) {
      const li = document.createElement('li'); li.value = s.n || (steps.indexOf(s) + 1);
      const t = document.createElement('b'); t.className = 'pt'; t.textContent = String(s.title || 'Step ' + li.value); li.appendChild(t);
      const link = document.createElement('span'); link.className = 'pl' + (s.task ? '' : ' unlinked');
      link.textContent = s.task ? 'task: ' + String(s.task.text || s.task.id || '') + ' · ' + (s.task.milestone ? String(s.task.milestone) : 'no milestone') : 'unlinked';
      li.appendChild(link);
      const meta = [Array.isArray(s.issueIds) && s.issueIds.length ? 'issues: ' + s.issueIds.map(String).join(', ') : '', Array.isArray(s.dependsOn) && s.dependsOn.length ? 'after step ' + s.dependsOn.map(String).join(', ') : ''].filter(Boolean).join(' · ');
      if (meta) { const m = document.createElement('span'); m.className = 'pm'; m.textContent = meta; li.appendChild(m); }
      if (s.context) { const c = document.createElement('span'); c.className = 'pc'; c.textContent = clipText(String(s.context), 400); li.appendChild(c); }
      ol.appendChild(li);
    }
    card.appendChild(ol);
  }
  if (warnings.length) { const ul = document.createElement('ul'); ul.className = 'prwarn'; for (const w of warnings) { const li = document.createElement('li'); li.textContent = w; ul.appendChild(li); } card.appendChild(ul); }
  const err = document.createElement('p'); err.className = 'prerr'; err.hidden = true; err.setAttribute('role', 'status'); card.appendChild(err);
  T.bubble.appendChild(card);
  let timer = 0;
  const setState = (st, msg) => {
    card.dataset.state = st; state.textContent = PLAN_STATE_LABEL[st] || st;
    if (msg) { err.textContent = msg; err.hidden = false; } else if (st === 'executing' || st === 'executed') { err.textContent = ''; err.hidden = true; }
    if (PLAN_FINAL.has(st)) { clearInterval(timer); timer = 0; }
    for (const c of card.querySelectorAll('.chip')) if (!/^adjust/.test(c.textContent)) c.disabled = PLAN_FINAL.has(st) || st === 'executing';   // one approval in flight at a time; a final state keeps only Adjust
    tick();
  };
  const tick = () => {
    if (!card.isConnected) { clearInterval(timer); timer = 0; return; }
    if (card.dataset.state !== 'prepared') { expiry.textContent = card.dataset.state === 'expired' ? 'Review expired' : ''; return; }
    const left = (Number(p.expiresAt) || 0) - Date.now();
    if (left <= 0) { setState('expired', 'This review expired — adjust and propose it again.'); return; }
    expiry.textContent = 'Review expires in ' + (left < 60000 ? 'under a minute' : Math.ceil(left / 60000) + ' min');
  };
  const approve = async () => {
    if (S.demo) { toast('Demo is read-only. Leave demo mode to approve plans.'); return; }
    setState('executing');
    try {
      const r = await api.command('plan.execute', { id: p.id, fingerprint: p.fingerprint }, p.project);
      const n = r && Array.isArray(r.results) ? r.results.length : steps.length;
      setState('executed'); postPlanBubble('Approved: ' + n + ' build' + (n === 1 ? '' : 's') + ' queued' + (p.project ? ' on **' + md.esc(p.project) + '**' : '') + '. Each works in its own worktree; nothing lands until you approve the merge.');
      sound('land'); refreshStatus();
    } catch (e) {
      const m = e.message || String(e), code = m.match(/^(REVIEW_CHANGED|PLAN_[A-Z]+):\s*/);   // a named refusal is final for this review: the card says why and Approve stays off
      if (code) setState(PLAN_ERROR_STATE[code[1]] || 'failed', m.slice(code[0].length) || m);
      else { setState('prepared', m); toast(m, 3200); }
    }
  };
  const cancel = async () => {
    if (S.demo) { toast('Demo is read-only. Leave demo mode to cancel plans.'); return; }
    try { await api.command('plan.cancel', { id: p.id }, p.project); setState('cancelled', 'Plan cancelled — nothing was queued.'); }
    catch (e) { toast(e.message || String(e), 3200); }
  };
  const adjust = () => { ask.value = prompt || T.text || ''; setPlanFirst(true); ask.focus(); autosize(); toast('adjust the goal, then Enter — plan first stays on', 2600); };
  const acts = [];
  if (p.state === 'prepared' && steps.length) acts.push({ label: 'approve', confirm: 'queue ' + steps.length + ' build' + (steps.length === 1 ? '' : 's') + ' — sure?', warn: true, run: approve });
  acts.push({ label: 'adjust', run: adjust });
  if (p.state === 'prepared') acts.push({ label: 'cancel', run: cancel });
  addActs(T, acts, { sticky: true, into: card });
  setState(p.state === 'prepared' || PLAN_STATE_LABEL[p.state] ? p.state : 'prepared', p.state === 'failed' ? '' : undefined);
  if (card.dataset.state === 'prepared') timer = setInterval(tick, 30000);
  return card;
}

const restartAct = () => ({ label: 'restart the gateway', confirm: 'restart the brain — sure?', warn: true, run: () => api.post('/nibbi/gateway', { action: 'restart' }).then(() => { toast('gateway restarting — session resumes in a few seconds', 5000); setTimeout(refreshStatus, 6000); }).catch((e) => toast(e.message)) });
function errorActs(text) {
  const acts = [{ label: 'try again', run: () => { const last = S.turns[S.turns.length - 1]; if (last) send(last.text); } }];
  if (/oauth|authenticate|token/i.test(text)) acts.push({ label: 'how to re-login', warn: true, run: () => { toast('open Settings → Providers to configure the API key or Codex login', 5000); } });
  if (/gateway (offline|isn)|failed to fetch|networkerror|not reachable/i.test(text)) { acts.push(restartAct()); acts.push({ label: 'use the demo brain', run: () => { S.demo = true; refreshStatus(); const last = S.turns[S.turns.length - 1]; if (last) send(last.text); } }); }
  return acts;
}
function replyActs(text) {
  const acts = launchActsFor(text);
  if (/stage|staged|review the diff|approve/i.test(text)) acts.push({ label: 'show what\'s staged', run: () => send('/fixers') });
  if (/\bship\b|merge/i.test(text) && /\?/.test(text)) acts.push({ label: 'ship it', run: () => send('yes, ship it') });
  if (/preview|localhost:\d+/i.test(text)) { const m = text.match(/https?:\/\/[^\s)]+/); if (m) acts.push({ label: 'open preview', run: () => window.open(m[0], '_blank') }); }
  if (!acts.length) acts.push(...questionActs(text).map((a) => ({ label: a.label, run: () => send(a.text) })));
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
        if (prev === undefined && (f.status === 'staged' || f.status === 'failed')) continue;
        const st = addStep(T, 'fixer · ' + (f.title || f.issue || f.id).slice(0, 60) + ' → ' + f.status, 'fixer');
        if (f.status === 'staged' || f.status === 'staged' || f.status === 'merged') markStep(st, 'done');
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
const ACTIVE = new Set(['queued', 'installing', 'running', 'verifying', 'awaiting_input']);
let tailCache = new Map();
function demoFixers() {
  const t0 = Date.now();
  return [
    { id: 'demo1', title: 'replay log for multiplayer runs', status: 'running', model: 'sonnet', costUsd: 0.41, startedAt: new Date(t0 - 200000).toISOString(), project: 'shipless', allowedActions: ['run.steer', 'run.stop'] },
    { id: 'demo2', title: 'supply ruling per issue #9', status: (performance.now() > 25000 ? 'staged' : 'running'), game: 'shipless', diffstat: ' rules.md | 14 ++--\n 1 file changed, 9 insertions(+), 5 deletions(-)', model: 'sonnet', costUsd: 0.12, startedAt: new Date(t0 - 60000).toISOString(), endedAt: performance.now() > 25000 ? new Date().toISOString() : undefined, project: 'shipless' },
    { id: 'demo3', title: 'hub font sizing', status: 'queued', model: 'haiku', startedAt: new Date(t0 - 10000).toISOString(), project: 'shipless' },
    { id: 'demo4', title: 'stale doc cleanup', status: 'staged', model: 'haiku', costUsd: 0.22, startedAt: new Date(t0 - 400000).toISOString(), endedAt: new Date(t0 - 20000).toISOString(), project: 'shipless' },
  ];
}
const RECENT_MS = 10 * 60000;
function renderAgents(list, auto) {
  const now = Date.now();
  const src = S.demo ? demoFixers() : (list || []);
  const show = [];
  for (const f of src) if (ACTIVE.has(f.status) || (f.endedAt && now - Date.parse(f.endedAt) < RECENT_MS)) show.push(f);
  show.splice(8);
  const seen = new Set();
  for (const f of show) {
    seen.add(f.id);
    let a = agentEls.get(f.id);
    if (!a) {
      // a div with the button role, not <button>: the card holds real controls (chips, the Guide textarea) and interactive content inside <button> is invalid HTML — WebKit and Firefox make such descendants unfocusable or route their clicks to the button
      const el = document.createElement('div'); el.className = 'agent'; el.setAttribute('role', 'button'); el.tabIndex = 0;
      const cv = document.createElement('canvas'); cv.className = 'ava'; cv.setAttribute('aria-hidden', 'true');
      const card = document.createElement('div'); card.className = 'card';
      el.append(cv, card);
      el.addEventListener('pointerenter', () => { fillCard(a); startTail(a); }); el.addEventListener('focus', () => { fillCard(a); startTail(a); });
      el.addEventListener('pointerleave', () => { if (!el.classList.contains('pinned')) stopTail(a); });
      el.addEventListener('click', () => { el.classList.toggle('pinned'); fillCard(a); });
      el.addEventListener('keydown', (e) => { if (e.target !== el || e.repeat) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); } else if (e.key === 'Escape' && el.classList.contains('pinned')) { e.stopPropagation(); el.classList.remove('pinned'); } });
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
function startTail(a) { stopTail(a); if (S.demo || !a.fixer || !ACTIVE.has(a.fixer.status)) return; a.tailTimer = setInterval(async () => { if (!a.el.isConnected) { stopTail(a); return; } try { const j = await api.get('/api/fixer-tail?id=' + encodeURIComponent(a.fixer.id)); const t = a.card.querySelector('.tail'); if (t && j.lines) t.textContent = j.lines.slice(-3).join('\n'); } catch { /* offline */ } }, 2500); }
function stopTail(a) { if (a.tailTimer) { clearInterval(a.tailTimer); a.tailTimer = 0; } }
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
  const guide = (f.allowedActions || []).includes('run.steer');   // live and steerable → inline guidance form instead of the /steer prefill
  for (const act of fixerActs(f).filter((x) => !(guide && x.label === 'steer'))) { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip in' + (act.warn ? ' warn' : ''); b.textContent = act.label; let armed = 0; b.onclick = (e) => { e.stopPropagation(); if (act.confirm && !armed) { armed = setTimeout(() => { armed = 0; b.textContent = act.label; }, 4000); b.textContent = act.confirm; return; } a.el.classList.remove('pinned'); act.run(); }; acts.appendChild(b); }
  a.card.append(h, m, tail, acts);
  // the Guide form is never detached while it is in use: replaceChildren/re-append would blur the textarea mid-word when the pointer re-enters the card
  if (guide) { if (!a.guide) a.guide = guideForm(a, f); a.guide.fixer = f; if (a.guide.parentNode !== a.card) a.card.appendChild(a.guide); } else if (a.guide) { a.guide.remove(); a.guide = null; }
  if (S.demo) { tail.textContent = f.status === 'running' ? '› editing src/multiplayer/replay.ts\n› npm test — 42 passing' : f.status === 'queued' ? 'waiting for a free slot' : 'merged into staging'; return; }
  const c = tailCache.get(f.id);
  if (c && Date.now() - c.at < 5000) { tail.textContent = c.lines.join('\n'); return; }
  try { const r = await fetch('/api/fixer-tail?id=' + encodeURIComponent(f.id)); const j = await r.json(); tailCache.set(f.id, { at: Date.now(), lines: j.lines || [] }); tail.textContent = (j.lines || []).slice(-3).join('\n'); } catch { /* offline */ }
}
/* inline guidance on a live agent card → run.steer; the card stays pinned while you type and the result lands under the box */
function guideForm(a, f) {
  const form = document.createElement('form'); form.className = 'guide'; form.setAttribute('aria-label', 'Guide ' + fixerTitle(f));
  const ta = document.createElement('textarea'); ta.rows = 2; ta.placeholder = 'Guide this build…'; ta.spellcheck = false; ta.setAttribute('aria-label', 'Guidance for ' + fixerTitle(f));
  const go = document.createElement('button'); go.type = 'submit'; go.className = 'chip in'; go.textContent = 'Guide';
  const out = document.createElement('div'); out.className = 'gres'; out.hidden = true; out.setAttribute('role', 'status');
  const row = document.createElement('div'); row.className = 'grow'; row.append(ta, go); form.append(row, out);
  const own = (e) => e.stopPropagation();   // the form sits inside the agent card (a div with the button role): clicks and keys in it must not toggle the pin or rebuild the card
  form.addEventListener('click', own); form.addEventListener('pointerdown', own); form.addEventListener('pointerup', own);
  form.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey && e.target === ta && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } if (e.key === 'Escape') { e.preventDefault(); a.el.classList.remove('pinned'); a.el.focus(); } });
  form.addEventListener('keyup', own);
  ta.addEventListener('focus', () => a.el.classList.add('pinned'));
  form.onsubmit = async (e) => {
    e.preventDefault(); e.stopPropagation(); const text = ta.value.trim(); if (!text) { ta.focus(); return; }
    const run = form.fixer || f; go.disabled = true; out.hidden = false; out.classList.remove('fail'); out.textContent = 'sending…'; a.el.classList.add('pinned');
    try { if (S.demo) throw new Error('Demo is read-only — guidance is not delivered here.'); const r = await api.command('run.steer', { id: run.id, text }, run.game || run.project); out.textContent = (r && (r.text || r.message)) || 'Guidance delivered.'; ta.value = ''; }
    catch (err) { out.classList.add('fail'); out.textContent = err.message || String(err); }
    finally { go.disabled = false; }
  };
  return form;
}
document.addEventListener('click', (e) => { if (!e.target.closest('.agent')) for (const a of agentEls.values()) a.el.classList.remove('pinned'); });

/* ------------------------------------------------------------------ live margin model: the view never owns app or backend state */
const msCache = new Map(), msPending = new Map();
async function milestonesFor(name) {
  const cached = msCache.get(name);
  if (cached && Date.now() - cached.at < 60000) return cached.ms;
  if (msPending.has(name)) return msPending.get(name);
  const pending = (async () => {
    let ms = null;
    try { const result = await api.get('/api/milestones?project=' + encodeURIComponent(name)); if (Array.isArray(result)) ms = result; } catch { /* unavailable is not zero progress */ }
    msCache.set(name, { at: Date.now(), ms }); return ms;
  })();
  msPending.set(name, pending);
  try { return await pending; } finally { msPending.delete(name); }
}
const MODES = ['off', 'suggest', 'stage', 'ship'];
function autoOf(name) { const a = (S.auto || {})[name]; if (!a) return { on: false, mode: 'off', inflight: 0, pending: 0, staged: 0, spend: 0 }; return { ...a, mode: a.on ? (a.mode || 'stage') : 'off' }; }
const liveNumber = value => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : null;
function syncMargins() {
  const active = activeProject(), status = S.status;
  const selected = (S.projects || []).find(p => p.name === active);
  const projects = (S.projects || []).filter(p => p.kind !== 'brain').map(p => {
    const sectionData = projectSummaries.get(p.name);
    const a = (S.auto || {})[p.name], ms = msCache.get(p.name)?.ms;
    const valid = Array.isArray(ms) && ms.length > 0 && ms.every(m => liveNumber(m.done) !== null && liveNumber(m.total) !== null);
    const canonical = sectionData?.plans?.counts;
    const total = canonical ? liveNumber(canonical.total) : valid ? ms.reduce((n, m) => n + m.total, 0) : null;
    const done = canonical ? liveNumber(canonical.done) : valid && total > 0 ? ms.reduce((n, m) => n + Math.min(m.done, m.total), 0) : null;
    const goal = (S.goals || {})[p.name];
    return { id: p.name, name: p.name, active: p.name === active, branch: p.branch || '',
      goal: [goal?.focus, goal?.text].filter(Boolean).join(' · '), mode: a ? autoOf(p.name).mode : 'unknown',
      inFlight: liveNumber(a?.inflight), pending: liveNumber(a?.pending), staged: liveNumber(a?.staged),
      spend: liveNumber(a?.spend), spendCap: a ? (liveNumber(a.spendCap) ?? 0) : null,
      done, total: total > 0 ? total : null, planAvailable: sectionData?.plans ? !!(canonical?.total || sectionData.plans.hasNotes) : Array.isArray(ms) ? ms.length > 0 : undefined,
      playable: (S.playable || []).some(item => item.name === p.name),
      sections: Object.fromEntries(['builds','issues','plans'].map(section => [section, describeProjectSection(section, sectionData?.[section])])) };
  });
  const metadata = marginMetadata({ status, project: selected, busy: S.busy, link: S.link, demo: S.demo, sessionCost: S.sessionCost, sessionTurns: S.sessionTurns });
  projectWorkspace.setBusy(S.busy);
  margins.update({ projects, projectsLoaded: Array.isArray(S.projects), activeProject: active, view: S.projectView, busy: S.busy, progress: S.progress, settings: {
    microphone: S.micEnabled, microphonePhase: S.micPhase,
    voice: S.voiceOn, sounds: LS.get('sounds', false) === true,
    notifications: LS.get('notifications', true) === true && notificationPermission === 'granted',
    notificationsSupported: !!notificationApi(),
    notificationStatus: { granted: 'System permission granted', denied: 'Blocked in system or browser settings', default: 'Permission is needed to enable notifications', unavailable: 'Permission is not available here' }[notificationPermission] || 'Permission is not available here',
    ...metadata,
    demo: S.demo, calm: calmMotion, systemReduced: reducedMotion.matches,
  } });
}
function renderProject() {
  if (S.projectView && Array.isArray(S.projects) && !S.projects.some(p => p.name === S.projectView.project)) closeProjectView(false);
  syncMargins();
  watchProjectSummaries();
  for (const p of (S.projects || []).filter(p => p.kind !== 'brain')) {
    const cached = msCache.get(p.name);
    if ((!cached || Date.now() - cached.at >= 60000) && !msPending.has(p.name)) {
      // Resolve against current state, never against the project selected when a read began.
      void milestonesFor(p.name).then(syncMargins);
    }
  }
}
function selectMarginProject(id) {
  const p = (S.projects || []).find(p => p.name === id && p.kind !== 'brain');
  if (!p) throw new Error('This project is no longer available.');
  S.project = p.name; LS.set('project', p.name); renderProject(); activity();
  return p.name;
}
async function handleMarginAction(action, id, value) {
  activity();
  if (['newProject', 'fix', 'plan', 'play', 'review', 'autoMode', 'spendCap'].includes(action) && S.busy) throw new Error(NAME + ' is still working — one thing at a time.');
  switch (action) {
    case 'selectProject': if (S.projectView) openProjectSection(id, S.projectView.section); else selectMarginProject(id); return;
    case 'projectSection': openProjectSection(id, value); return;
    case 'repository': openProjectSection(id, 'repository'); margins.close(); return;
    case 'newProject': margins.close(); ask.value = '/new '; ask.focus(); autosize(); return;
    case 'fix': selectMarginProject(id); margins.close(); ask.value = '/fix '; ask.focus(); autosize(); return;
    case 'plan': case 'play': case 'review':
      selectMarginProject(id); margins.close(); await send('/' + action + ' ' + id); return;
    case 'autoMode':
      if (!MODES.includes(value)) throw new Error('Unknown automation mode.');
      selectMarginProject(id); margins.close(); await send('/auto ' + id + ' ' + value); return;
    case 'spendCap': {
      if (!(S.projects || []).some(p => p.name === id && p.kind !== 'brain')) throw new Error('This project is no longer available.');
      if (S.demo) throw new Error('Leave demo mode to change project settings.');
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('Enter a cap of zero or more.');
      await api.post('/api/auto', { project: id, spendCap: value });
      await refreshStatus(); toast(value ? 'cap $' + value + ' on ' + id : 'no spend cap on ' + id); return;
    }
    case 'providers': selectMarginProject(id); margins.close(); openPlatform('Providers'); return;
    case 'model': case 'advancedSettings': margins.close(); openPlatform('Providers'); return;
    case 'microphone':
      // All microphone controls share the wake toggle. Never await permission here: Off must remain clickable.
      margins.close(); void toggleListen(); return;
    case 'voice':
      S.voiceOn = !S.voiceOn; LS.set('voice', S.voiceOn); body.classList.toggle('voice-on', S.voiceOn);
      if (!S.voiceOn) stopSpeaking(); syncMargins(); toast(S.voiceOn ? 'spoken replies on' : 'spoken replies off — microphone unchanged'); return;
    case 'sounds': { const on = !LS.get('sounds', false); LS.set('sounds', on); syncMargins(); if (on) sound('send'); return; }
    case 'notifications': await toggleNotifications(); return;
    case 'calm': if (!reducedMotion.matches) { calmMotion = !calmMotion; LS.set('pocketCalm', calmMotion); syncMotionPreference(); } return;
    case 'demo': S.demo = !S.demo; syncMargins(); await refreshStatus(); renderAgents(S.fixers); toast(S.demo ? 'demo brain — scripted replies' : 'talking to the real brain'); return;
    case 'tidy': margins.close(); tidy(); return;
    default: throw new Error('This control is not available.');
  }
}

function openProjectSection(id, section, detail = {}) {
  if (!['builds','issues','plans','repository'].includes(section)) return;
  const project = (S.projects || []).find(p => p.name === id && p.kind !== 'brain');
  if (!project) { toast('This project is no longer available.'); return; }
  selectMarginProject(id); margins.close();
  if (!S.projectView) S.projectComposerExpanded = null;
  S.projectView = { project: id, section }; body.classList.add('project-view');
  hideChips(); paletteEl.hidden = true;
  projectWorkspace.open({ project: id, kind: project.kind, section, ...detail });
  projectWorkspace.setSummaries?.(id, projectSummaries.get(id)); watchProjectSummaries();
  syncMargins(); layout(false);
}
function closeProjectView(focus = true) {
  if (!S.projectView) return;
  S.projectView = null; S.projectComposerExpanded = null; projectWorkspace.close(); body.classList.remove('project-view'); watchProjectSummaries();
  syncMargins(); layout(false); if (focus) ask.focus();
}
async function handleProjectAction(action, project, value) {
  if (action === 'githubRead') {
    if (value.kind === 'build') return loadGithubBuild({project, buildId:value.buildId, signal:value.signal});
    if (value.kind === 'prDraft') return loadGithubPrDraft({project, buildId:value.buildId, signal:value.signal});
    if (value.kind === 'changes') return loadGithubChanges({project, buildId:value.buildId, signal:value.signal});
    return loadGithubProject({project, signal:value.signal});
  }
  if (action === 'githubRefresh') {
    const result = await githubCommand(project, 'github.refresh', value || {});
    projectSummaries.invalidate([project]); return result;
  }
  if (action === 'buildEvidence') {
    const id = encodeURIComponent(value.id);
    if (value.kind === 'changes') return api.get('/api/fixer-diff?id=' + id);
    const result = await api.get('/api/fixer-log?id=' + id + (value.attemptId ? '&attemptId=' + encodeURIComponent(value.attemptId) : ''));
    return value.kind === 'checks' ? {verification: result.fixer?.verification, entries: result.entries} : result;
  }
  if (S.busy) throw new Error('Nibbi is still working. You can keep browsing while it finishes.');
  if (S.demo && ['projectCommand','buildCommand','githubCommand'].includes(action)) throw new Error('Leave demo mode before changing project work.');
  selectMarginProject(project);
  if (action === 'githubCommand') {
    const allowed = ['build.prDraft','build.connect','project.promotionReady','project.verifyPromotion','project.issueLink','github.prepare','github.connect','build.publish','build.prCreate','build.prReady','build.prMerge','build.prAdopt','build.verifyMerged','build.cleanup','build.adoptChanges','build.update','build.checkpoint','build.updateBase','build.adoptRemote','project.syncTarget','project.preparePromotion','project.mergePromotion','project.publishBranch'];
    if (!allowed.includes(value.command)) throw new Error('This repository action is unavailable.');
    const result = await githubCommand(project, value.command, value.args || {});
    if (value.command !== 'github.prepare') { projectSummaries.invalidate([project]); void refreshStatus(); }
    return result;
  }
  if (action === 'projectCommand') {
    const result = await projectCommand(project, value);
    if (result.section?.section) projectSummaries.accept(project, result.section.section, result.section);
    if (result.plan?.section) projectSummaries.accept(project, result.plan.section, result.plan);
    projectSummaries.invalidate([project]); void refreshStatus(); return result;
  }
  if (action === 'buildCommand') {
    const allowed = ['run.stop','run.retry','run.verify','run.discard','run.merge','run.steer','preview.start','preview.stop','run.dispatch'];
    if (!allowed.includes(value.command)) throw new Error('This build action is unavailable.');
    const result = await api.command(value.command, {id:value.id, ...(value.args || {})}, project);
    projectSummaries.invalidate([project]); void refreshStatus(); return result;
  }
  if (action === 'buildChanges' || action === 'buildLog') {
    closeProjectView(false);
    await runLocalCommand(action === 'buildChanges' ? 'diff' : 'log', value, { keepInput: true });
    ask.focus(); return;
  }
  const prompts = { newBuild: '/fix ', newIssue: '/issue ', newPlan: 'Write a plan with milestones and checkbox tasks for ' + project + ' in plans/' + project + '.md: ', editPlan: '/plan edit ' };
  if (!(action in prompts)) throw new Error('This project action is unavailable.');
  closeProjectView(false);
  if (ask.value.trim() || pendingImages.length) { ask.focus(); toast('Your draft is still here. Send or clear it before starting something new.'); return; }
  ask.value = prompts[action]; ask.focus(); autosize();
}

let projectRefreshTimer = 0, allProjectRefresh = false;
let projectActivityTimer = 0;
const projectRefreshIds = new Set();
function queueProjectActivity(project) {
  if (projectActivityTimer || S.projectView?.project !== project || S.projectView?.section !== 'builds') return;
  projectActivityTimer = setTimeout(() => { projectActivityTimer = 0; if (S.projectView?.project === project && S.projectView?.section === 'builds') void projectWorkspace.refresh(); }, 3000);
}
function scheduleProjectRefresh(project) {
  if (project) projectRefreshIds.add(project); else allProjectRefresh = true;
  if (projectRefreshTimer) return;
  projectRefreshTimer = setTimeout(() => {
    projectRefreshTimer = 0;
    const ids = allProjectRefresh ? null : [...projectRefreshIds];
    projectRefreshIds.clear(); allProjectRefresh = false;
    projectSummaries.invalidate(ids);
    if (S.projectView && (!ids || ids.includes(S.projectView.project))) void projectWorkspace.refresh();
  }, 400);
}

/* ------------------------------------------------------------------ status / link */
let linkFreshT = 0, statusRead = 0;
function setLink(l) {
  if (S.link !== l) { body.classList.add('link-fresh'); clearTimeout(linkFreshT); linkFreshT = setTimeout(() => body.classList.remove('link-fresh'), 2600); }
  S.link = l; body.dataset.link = l; syncMargins();
}
async function refreshStatus() {
  const read = ++statusRead;
  try {
    const r = await fetch('/api/snapshot', { cache: 'no-store' });
    if (!r.ok) throw new Error('Snapshot unavailable');
    const snap = await r.json(); if (read !== statusRead) return;
    S.fixers = snap.fixers || []; S.auto = snap.auto || {}; S.goals = snap.goals || {}; S.snapshotCursor = snap.cursor;
    S.progress = snap.progress && typeof snap.progress === 'object' ? snap.progress : undefined;
    S.status = snap.status || null;
    if (S.status) {
      if (!S.busy) setLink(S.demo ? 'demo' : (S.status.busy ? 'busy' : 'live'));
      const pt = S.status.playtestGame || null; if (pt !== S.playtest) { S.playtest = pt; body.classList.toggle('playtest', !!pt); ask.placeholder = placeholderText(); if (pt && document.activeElement === ask) showChips('focus'); }
    } else if (!S.busy) {
      setLink(S.demo ? 'demo' : 'offline'); if (!S.demo && S.mode === 'idle' && nibbi.mood() === 'idle') nibbi.setMood('sleep');
    }
    renderAgents(S.fixers, S.auto); if (S.demo) fleetEvents(demoFixers()); renderProject(); refreshBadge(); reattachFixerActs();
  } catch {
    if (read !== statusRead) return;
    S.status = null; S.progress = undefined; if (!S.busy) setLink(S.demo ? 'demo' : 'offline');
  }
  syncMargins();
}
try { restoreTranscript(); } catch (e) { clientLog('error', 'restore: ' + e.message); }
refreshStatus().then(connectEvents); setInterval(() => { if (!evReady) refreshStatus().then(connectEvents); }, 30000);
function mostActiveProject(list) {
  const names = new Set(list.map((p) => p.name));
  const autoOn = Object.entries(S.auto || {}).filter(([n, a]) => a && a.on && names.has(n)).map(([n]) => n);
  if (autoOn.length === 1) return autoOn[0];
  let best = null, at = 0;
  for (const f of S.fixers || []) { const t = Date.parse(f.endedAt || f.startedAt || 0) || 0; const n = f.game || f.project; if (names.has(n) && t > at) { at = t; best = n; } }
  return best || autoOn[0] || null;
}
let projectsRead = 0;
async function refreshProjects() {
  const read = ++projectsRead;
  try {
    const r = await fetch('/api/projects'); if (!r.ok) return;
    const list = await r.json(); if (read !== projectsRead || !Array.isArray(list)) return;
    S.projects = list;
    const saved = LS.get('project', null), recent = mostActiveProject(list);
    // Read current selection after the await, so a refresh cannot undo a user's choice.
    const selected = list.find(p => p.name === S.project) || list.find(p => p.name === saved) || list.find(p => p.name === recent) || list.find(p => p.kind === 'game') || list[0];
    S.project = selected?.name || null; renderProject();
    const playable = await Promise.all(list.filter(p => p.kind === 'game').map(async p => {
      try { const r = await fetch('/api/play?project=' + encodeURIComponent(p.name)); if (!r.ok) return null; const ps = await r.json(); return ps.playable ? { name: p.name, running: ps.running, url: ps.url } : null; } catch { return null; }
    }));
    if (read !== projectsRead) return;
    S.playable = playable.filter(Boolean); renderProject();
  } catch { /* offline */ }
}
refreshProjects(); setInterval(() => { if (!document.hidden) refreshProjects(); }, 120000);
(async () => { try { const items = await api.get('/api/history?n=12'); const recent = (Array.isArray(items) ? items : []).filter((m) => m.channel === 'app'); S.recent = recent.length > 0 && Date.now() - Date.parse(recent[recent.length - 1].ts) < 12 * 3600000; } catch { S.recent = false; } })();
if (S.demo) { renderAgents([], {}); renderProject(); }

/* ------------------------------------------------------------------ contextual chips */
let chipsShown = false;
function chipSet(when) {
  const out = [];
  const fx = S.fixers || [];
  const staged = fx.filter((f) => f.status === 'staged' && (f.game || f.project) === activeProject() && (!f.endedAt || Date.now() - Date.parse(f.endedAt) < 7 * 86400000)).length;
  const running = fx.filter((f) => /running|queued/i.test(f.status) && (f.game || f.project) === activeProject()).length;
  const proj = S.project || 'shipless';
  if (staged) out.push(autoOf(activeProject()).mode === 'ship' ? { label: staged + ' fix' + (staged > 1 ? 'es' : '') + ' in the merge queue', text: '/artifacts ' + activeProject() } : { label: staged + ' fix' + (staged > 1 ? 'es' : '') + ' waiting for review', text: '/review ' + activeProject() });
  for (const f of fx.filter((x) => x.status === 'running').slice(0, 1)) out.push({ label: 'steer ' + fixerTitle(f).slice(0, 22), text: '__steer:' + f.id });
  if (running) out.push({ label: running + ' fixer' + (running > 1 ? 's' : '') + ' working', text: 'how are the fixers doing?' });
  const h = new Date().getHours();
  if (S.link === 'offline' && !S.demo && when !== 'after') { out.unshift({ label: 'wake the gateway', text: '__wake' }, { label: 'use the demo brain', text: '__demo' }); }
  if (S.playtest && when !== 'after') { return [{ label: 'bug', text: '__prefix:[bug] ' }, { label: 'balance', text: '__prefix:[balance] ' }, { label: 'idea', text: '__prefix:[idea] ' }, { label: 'rules question', text: '__prefix:[rules] ' }, { label: 'end playtest', text: '/endtest' }]; }
  if (when === 'idle' || when === 'focus') {
    if (S.recent && !S.turns.length) out.push({ label: 'pick up where we left off', text: '/recent' });
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
function chipRun(text) { if (text.startsWith('__steer:')) { ask.value = '/steer ' + text.slice(8) + ' '; ask.focus(); autosize(); toast('tell the fixer what to change, then Enter', 3000); return; } if (text.startsWith('__prefix:')) { ask.value = text.slice(9) + ask.value.replace(/^\[[a-z ]+\]\s*/i, ''); ask.focus(); autosize(); return; } if (text === '__wake') { toast('launchctl kickstart -k gui/$(id -u)/com.nibbi.gateway', 6000); return; } if (text === '__demo') { S.demo = true; refreshStatus(); toast('demo brain — scripted replies'); hideChips(); return; } send(text); }
function hideChips() { if (!chipsShown) return; chipsShown = false; for (const c of chipsEl.children) c.classList.remove('in'); setTimeout(() => { if (!chipsShown) chipsEl.replaceChildren(); }, 260); }

/* ------------------------------------------------------------------ pill */
function autosize() { ask.style.height = 'auto'; ask.style.height = Math.min(ask.scrollHeight, innerHeight * 0.38) + 'px'; pill.classList.toggle('tall', ask.offsetHeight > 56); layout(false); }   // .tall: the field holds more than one line, so "+" and send drop to the last line
ask.addEventListener('input', () => { autosize(); if (ask.value.trim()) { hideChips(); interactions.event('typing'); } else if (document.activeElement === ask) showChips('focus'); if (S.busy) syncSendButton(); activity(); });
ask.addEventListener('focus', () => { if (S.projectView) S.projectComposerExpanded = true; layout(false); interactions.event('focus'); const r = pill.getBoundingClientRect(); nibbi.lookAt(r.left + r.width * 0.35, r.top + r.height / 2); if (!ask.value.trim()) showChips('focus'); });
ask.addEventListener('blur', () => { layout(false); if (!S.busy) nibbi.lookFree(); });
ask.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); pill.requestSubmit(); }
  if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); feed.scrollBy({ top: (e.key === 'PageUp' ? -0.8 : 0.8) * feed.clientHeight, behavior: 'smooth' }); }
  if (e.key === 'End' && !ask.value) { e.preventDefault(); jumpBtn.onclick(); }
  if (e.key === 'Escape') { if (ask.value) { ask.value = ''; autosize(); } else { ask.blur(); if (S.mode === 'talk' && !S.busy) tidy(); } }
});
/* mid-run steering: typed text while a steerable turn runs becomes guidance for that turn; an empty send still stops it */
async function steerTurn(text) {
  const id = S.activeRunId, T = S.liveTurn && !S.liveTurn.done ? S.liveTurn : null;
  ask.value = ''; autosize(); syncSendButton();
  const st = T ? insertStep(T, { label: 'guiding', name: 'turn.steer', kind: 'steer', source: 'governed', input: text, phase: 'started' }) : null;
  try {
    if (S.demo) throw new Error('Demo is read-only — guidance is not delivered here.');
    await api.command('turn.steer', { id, text }, activeProject());
    if (st) { st.finished = true; st.ok = true; st.detail = 'guidance delivered'; markStep(st, 'done'); fillStepResult(st); }
  } catch (e) {
    const m = e.message || String(e);
    if (st) { st.finished = true; st.ok = false; st.detail = m; markStep(st, 'fail'); fillStepResult(st); }
    toast(m, 3200);
  }
}
pill.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!S.busy && !ask.value.trim() && !pendingImages.length && wakeVoice.snapshot().phase === 'listening' && micCapture.finishUtterance()) return;
  if (S.busy) {
    const guidance = ask.value.trim();   // typed text is guidance, never a stop: it reaches a steerable run or stays in the composer with the honest toast
    if (guidance) { if (S.activeRunId && S.steerable) void steerTurn(guidance); else toast('This turn can\'t take guidance right now — stop it or wait', 3200); return; }
    if (S.activeRunId) { api.command('turn.stop', { id: S.activeRunId }).then(() => { S.abort?.abort(); toast('turn stopped; work preserved'); }).catch((e) => toast(e.message)); } else if (S.abort) { S.abort.abort(); toast('connection closed; check Activity for queued work'); }
    return;
  }
  send(ask.value, pendingImages.slice());
});
addEventListener('keydown', (e) => {
  if (keyboardInputOwned(e, true)) return;
  if (e.altKey && e.code === 'Space') { e.preventDefault(); if (!e.repeat && !window.__TAURI__?.event) void toggleListen(); return; }
  if (e.key === 'Escape' && document.activeElement !== ask && S.mode === 'talk' && !S.busy) { tidy(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (document.activeElement !== ask && !e.repeat && S.turns.length && !S.busy) { const map = { d: /^(diff|what changed)$/, p: /^preview$/, a: /^approve/, s: /^stop/, o: /^open/ }; const rx = map[e.key.toLowerCase()]; if (rx) { const chip = [...S.turns[S.turns.length - 1].body.querySelectorAll('.acts .chip')].find((c) => rx.test(c.textContent)); if (chip) { e.preventDefault(); chip.click(); chip.focus(); return; } } }
  if (e.key === ' ' && e.target instanceof Element && e.target.closest('button, summary, [role="button"], a[href]')) return;   // Space activates the focused control (a step's summary, a chip); it is not a character for the composer
  if (document.activeElement !== ask && e.key.length === 1 && !e.repeat) { ask.focus(); }
});

/* images: paste or drop */
function addImage(file) {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || pendingImages.length >= 4) return;
  const rd = new FileReader(); rd.onload = () => { const data = String(rd.result).split(',')[1]; pendingImages.push({ media_type: file.type, data }); renderAttach(); interactions.event('attach'); }; rd.readAsDataURL(file);
}
function renderAttach() {
  attachEl.hidden = !pendingImages.length; attachEl.replaceChildren();
  pendingImages.forEach((im, i) => { const b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-label', 'Remove attached image ' + (i + 1)); const img = document.createElement('img'); img.src = 'data:' + im.media_type + ';base64,' + im.data; b.appendChild(img); b.onclick = () => { pendingImages.splice(i, 1); renderAttach(); }; attachEl.appendChild(b); });
  layout(false);   // the strip changes the pill's height (its own row at ≤640px): suggestion chips, feed and fixers re-place above it
}
function clearAttach() { pendingImages = []; renderAttach(); }
document.addEventListener('paste', (e) => { for (const it of e.clipboardData?.items || []) if (it.kind === 'file') addImage(it.getAsFile()); });
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => { e.preventDefault(); for (const f of e.dataTransfer?.files || []) addImage(f); ask.focus(); });

/* ------------------------------------------------------------------ opt-in mic toggle + local “Hey Nibbi” wake gate */
let listening = false, micStarting = false, micEpoch = 0, micProject = null, voiceCooldown = 0;
let sayPlaying = false, sayGeneration = 0; const sayQ = [];
const voicePlayer = createVoicePlayer({
  onStart: () => nibbi.setMood('speaking'),
  onEnd: () => { voiceCooldown = performance.now() + 500; if (!S.busy && nibbi.mood() === 'speaking') nibbi.setMood('idle'); },
  onLevel: level => nibbi.pulse(level),
});
const wakeVoice = createWakeVoice({
  transcribe: async (blob, signal) => {
    const controller = new AbortController(); let timedOut = false;
    const cancel = () => controller.abort(); signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) controller.abort();
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 25000);
    try {
      const response = await fetch('/api/transcribe', { method: 'POST', headers: { 'content-type': blob.type || 'application/octet-stream' }, body: blob, signal: controller.signal });
      if (!response.ok) throw new Error('Could not hear you. Check the local speech service.');
      const result = await response.json(); return result.heard || '';
    } catch (error) {
      if (timedOut) throw new Error('Speech recognition took too long. Try “Hey Nibbi” again.');
      throw error;
    } finally { clearTimeout(timeout); signal.removeEventListener('abort', cancel); }
  },
  greet: async (text, signal) => { activity(); await voicePlayer.play(text, signal); },
  send: async text => {
    if (!listening || S.busy || activeProject() !== micProject) return;
    // Voice must not erase a typed draft or silently attach images from another message.
    if (ask.value.trim() || pendingImages.length) { toast('Finish your draft, then say “Hey Nibbi” again.'); return; }
    await send(text);
  },
  onState: () => { renderVoice(); syncVoiceAvailability(); },
  onError: error => { if (error?.name !== 'AbortError') toast(error?.message || 'Voice is unavailable. Try again.'); },
});
const micCapture = createMicCapture({
  canCapture: () => {
    if (listening && activeProject() !== micProject) { stopListen(); toast('Mic off — project changed.'); return false; }
    syncVoiceAvailability();
    return listening && ['armed', 'listening'].includes(wakeVoice.snapshot().phase) && performance.now() >= voiceCooldown;
  },
  silenceMs: () => wakeVoice.snapshot().phase === 'listening' ? 900 : 750,
  onSpeechStart: () => { S.micCapturing = true; wakeVoice.holdFollowup(); renderVoice(); },
  onSpeechEnd: () => { S.micCapturing = false; renderVoice(); },
  onUtterance: blob => wakeVoice.submit(blob),
  onLevel: level => {
    for (const [i, bar] of [...listenEl.querySelectorAll('.bars i')].entries()) bar.style.transform = 'scaleY(' + (0.5 + level * (1.6 + Math.sin(performance.now() / 90 + i) * 0.6)).toFixed(2) + ')';
    if (wakeVoice.snapshot().phase === 'listening') nibbi.pulse(level * 0.5);
  },
  onError: error => { stopListen(); toast(error?.message || 'Microphone unavailable.'); },
});
function syncVoiceAvailability() {
  const phase = wakeVoice.snapshot().phase;
  if (!listening || micStarting || phase === 'sending') return;
  // The gate owns its greeting; external replies/typed turns must cancel a pending wake.
  const blocked = S.busy || sayPlaying || S.demo || S.link === 'offline' || !!ask.value.trim() || !!pendingImages.length || (phase !== 'greeting' && phase !== 'listening' && performance.now() < voiceCooldown);
  wakeVoice.setSuspended(blocked);
}
function renderVoice() {
  const state = wakeVoice.snapshot();
  const finishing = listening && micCapture.snapshot().finishing && ['armed', 'listening'].includes(state.phase);
  const phase = micStarting ? 'starting' : finishing ? 'transcribing' : state.phase;
  S.micEnabled = listening; S.micPhase = phase;
  micBtn.setAttribute('aria-pressed', String(listening));
  micBtn.title = (listening ? 'Hey Nibbi is on — turn microphone off' : 'Hey Nibbi is off — turn microphone on') + ' (⌥ Space)';
  body.dataset.mic = phase; pill.classList.toggle('mic-on', listening); pill.classList.toggle('listening', phase === 'listening');
  listenEl.hidden = !listening;
  const labels = { starting: 'Allow microphone access…', armed: 'Waiting for “Hey Nibbi”', transcribing: 'Processing speech · mic paused', greeting: "What's up, Matty?", listening: S.micCapturing ? 'Listening — pause to send' : 'Listening — go ahead', sending: 'Nibbi is answering…', paused: 'Mic on · waiting for this reply or draft', off: '' };
  $('.heard', listenEl).textContent = labels[phase] || '';
  syncModes();   // the chip at the field's leading edge carries the live phase word
  S.voiceFinishing = phase === 'listening' && S.micCapturing;
  syncSendButton();   // one owner for the send button's label: busy → steer/stop, idle → finish voice/send
  if (phase === 'listening') { nibbi.setMood('listening'); const r = pill.getBoundingClientRect(); nibbi.lookAt(r.left + r.width * 0.3, r.top); }
  else if (!S.busy && nibbi.mood() === 'listening') { nibbi.setMood('idle'); nibbi.lookFree(); }
  syncMargins(); layout(false);
}
micBtn.addEventListener('click', () => { void toggleListen(); });
async function toggleListen() {
  if (listening) { stopListen(); return; }
  if (S.demo || S.link === 'offline') { toast('Voice needs Nibbi’s local gateway and speech service.'); return; }
  if (!navigator.mediaDevices?.getUserMedia) { toast('Microphone unavailable. Open Nibbi on localhost or paired HTTPS.'); return; }
  listening = true; micStarting = true; micProject = activeProject(); const epoch = ++micEpoch;
  activity(); stopSpeaking(); renderVoice();
  // Explicit click/shortcut unlocks future audio. Do not reopen the mic automatically on reload.
  void voicePlayer.unlock().catch(() => {});
  try {
    const started = await micCapture.start();
    if (epoch !== micEpoch || !listening || !started) return;
    micStarting = false; wakeVoice.enable(); syncVoiceAvailability(); renderVoice();
  } catch (error) {
    if (epoch !== micEpoch) return;
    stopListen();
    toast(error?.name === 'NotAllowedError' ? 'Microphone blocked. Allow Nibbi in microphone settings, then turn it on.' : error?.message || 'Microphone unavailable.');
  }
}
function stopListen() {
  micEpoch++; listening = false; micStarting = false; wakeVoice.disable(); micCapture.stop(); stopSpeaking(); renderVoice();
}
renderVoice();
addEventListener('pagehide', stopListen);
document.addEventListener('visibilitychange', () => { if (document.hidden && listening) stopListen(); });

/* ------------------------------------------------------------------ cancellable local voice out + sentence queue */
function stopSpeaking() {
  sayGeneration++; sayQ.length = 0; sayPlaying = false; voicePlayer.stop();
  if (!S.busy && nibbi.mood() === 'speaking') nibbi.setMood('idle');
}
function enqueueSay(text) {
  const t = String(text || '').trim(); if (!t || !S.voiceOn || S.demo || S.link === 'offline') return;
  sayQ.push(t.slice(0, 600)); if (!sayPlaying) void playNext();
}
async function playNext() {
  if (sayPlaying) return;
  const epoch = sayGeneration; sayPlaying = true; syncVoiceAvailability();
  try {
    while (sayQ.length && epoch === sayGeneration) {
      try { await voicePlayer.play(sayQ.shift()); }
      catch (error) { if (epoch === sayGeneration && error?.name !== 'AbortError') { sayQ.length = 0; toast(error.message || 'Nibbi’s voice is unavailable.'); } }
    }
  } finally { if (epoch === sayGeneration) { sayPlaying = false; syncVoiceAvailability(); } }
}
/* streaming: speak sentences as they complete (unless the brain wrote a »voice: line — then only that) */
let sentenceCursor = 0, sentencesSpoken = 0;
function streamSpeech(T) {
  if (!S.voiceOn || S.demo || S.link === 'offline') return;
  if (/»voice:/.test(T.acc)) { S.spokeStream = false; return; }
  const clean = parseActs(T.acc).clean; const rest = clean.slice(sentenceCursor);
  const m = rest.match(/^[\s\S]*?[.!?](?=\s|$)/); if (!m) return;
  const sentence = stripMd(m[0]).trim();
  sentenceCursor += m[0].length;
  if (sentence.length > 2 && sentencesSpoken < 6) { sentencesSpoken++; S.spokeStream = true; enqueueSay(sentence); }
}
async function speak(text) {
  if (!S.voiceOn || !text) return;
  if (S.demo || S.link === 'offline') { toast('voice needs the real gateway (kokoro lives there)'); return; }
  enqueueSay(text);
}

/* ------------------------------------------------------------------ boot */
syncMotionPreference(); interactions.event('greet');
void refreshNotificationPermission();
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refreshNotificationPermission(); });
if ('serviceWorker' in navigator && window.isSecureContext && !Q.get('nosw')) { navigator.serviceWorker.register('/sw.js').catch(() => {}); }
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
if (standalone) body.classList.add('standalone');

if (Q.get('say')) { setTimeout(() => send(Q.get('say')), 300); }
try { if (window.__TAURI__ && window.__TAURI__.event) { window.__TAURI__.event.listen('toggle-live', () => toggleListen()); } } catch { /* browser */ }
document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a[href]'); if (!a) return; if (window.__TAURI__ && /^https?:/i.test(a.href)) { e.preventDefault(); api.post('/api/open', { url: a.href }).catch(() => window.open(a.href, '_blank')); } });
/* live state report: the running app tells the host what it is showing (loopback-readable at /nibbi/state) */
let stateTimer = 0;
function snapshot() {
  return { v: '0.8.0', client: window.__TAURI__ ? 'app' : 'browser', mic: { enabled: listening, phase: micStarting ? 'starting' : wakeVoice.snapshot().phase }, mode: S.mode, link: S.link, project: activeProject(), busy: S.busy, review: S.review ? { i: S.review.i, ids: S.review.ids } : null, mood: nibbi.mood(), demo: S.demo, url: location.href,
    turns: S.turns.slice(-30).map((T) => ({ at: T.at, you: T.text || null, said: (T.acc || T.said.textContent || '').slice(0, 600), steps: [...T.steps.querySelectorAll('.step')].map((s) => (s.querySelector(':scope > summary') || s).textContent.trim().slice(0, 80)), acts: [...T.body.querySelectorAll('.acts .chip')].map((c) => c.textContent), error: T.nib.classList.contains('error'), fixerId: T.fixerId || null })),
    renderer: (() => { try { const r = nibbi.state(); return { character: r.character ?? null, backend: r.backend ?? (r.gl ? 'webgl' : 'canvas2d'), fallbackReason: r.fallbackReason ?? null, engine: r.motion ? 'pocket' : 'legacy', dpr: r.dpr ?? devicePixelRatio }; } catch { return null; } })(), chips: [...chipsEl.querySelectorAll('.chip')].map((c) => c.textContent), agents: [...agentEls.values()].map((a) => (a.fixer.title || a.fixer.id) + ' · ' + a.fixer.status), input: ask.value.slice(0, 200), attachmentCount: pendingImages.length, projectView: projectWorkspace.snapshot(), composerCollapsed: body.classList.contains('project-compose-compact'), toast: $('#toast').hidden ? null : $('#toast').textContent };
}
/* a persisted step: ≤ 1 KB without its diff, diff ≤ 2 KB */
function stepRow(s) {
  const path = s.input && typeof s.input === 'object' && typeof s.input.path === 'string' ? s.input.path : typeof s.path === 'string' ? s.path : '';   // the diff card's head after a reload, when the input is only its bounded text
  const row = { label: clipText(s.label, 80), name: clipText(s.name, 80), kind: clipText(s.kind, 20), source: clipText(s.source, 12), n: s.n || 1, ok: s.ok === true ? true : s.ok === false ? false : null, elapsedMs: typeof s.elapsedMs === 'number' && Number.isFinite(s.elapsedMs) ? Math.round(s.elapsedMs) : null, detail: clipText(s.detail, 240), input: clipText(typeof s.input === 'string' ? s.input : boundedInput(s.input), 320), bytesLabel: clipText(s.bytesLabel, 16), fixed: !!s.fixed, governed: !!s.governed, ...(path && s.diff ? { path: clipText(path, 160) } : {}) };
  for (let guard = 0; guard < 8 && JSON.stringify(row).length > 1024; guard++) { if (row.input.length > 64) row.input = clipText(row.input, Math.max(64, row.input.length - 128)); else if (row.detail.length > 64) row.detail = clipText(row.detail, 64); else break; }
  if (s.diff) row.diff = clipText(s.diff, 2048);
  return row;
}
function restoreStep(T, row) {
  const ev = row.governed || row.name ? { label: row.label, name: row.name, kind: row.kind, source: row.source || (row.governed ? 'governed' : 'native'), input: row.input } : null;
  const cls = row.fixed ? 'fixer' : row.kind === 'steer' ? 'steer' : null;
  const el = stepEl(row.label || row.name || 'step', cls, ev);
  el.classList.remove('live'); el.classList.add(row.ok === false ? 'fail' : 'done');
  if (row.n > 1) el.querySelector('.n').textContent = '×' + row.n;
  if (row.elapsedMs != null) el.querySelector('.t').textContent = elapsedLabel(row.elapsedMs);
  T.steps.hidden = false; T.steps.insertBefore(el, T.fold);
  const st = { ...stepRecord(el, row.label, cls, ev), n: row.n || 1, ok: row.ok, elapsedMs: row.elapsedMs, detail: row.detail || '', diff: row.diff || '', bytesLabel: row.bytesLabel || '', finished: true, path: typeof row.path === 'string' ? row.path : '' };
  if (ev && (st.detail || st.diff || (st.governed && st.ok !== null))) fillStepResult(st);   // native rows stay name-only, as they were live
  T.stepsList.push(st); return st;
}
function persistTranscript() {
  try {
    const rows = S.turns.filter((T) => T.done && !T.restoredOnly).slice(-40).map((T) => ({ at: T.at, you: T.text === undefined ? null : T.text, acc: (T.acc || T.said.textContent || '').slice(0, 6000), plain: !!T.plain, error: T.nib.classList.contains('error'), fixerId: T.fixerId || null, cost: T.cost || 0, ...localReplyMetadata(T), steps: T.stepsList.length ? T.fold.querySelector('.l').textContent.replace(/ — show$/, '') : '', ...(T.stepsList.some((s) => s.el) ? { stepRows: T.stepsList.filter((s) => s.el).slice(-40).map(stepRow) } : {}) }));   // summary-only rows from older transcripts keep their one line
    LS.set('transcript', { at: Date.now(), rows });
  } catch { /* quota */ }
}
function restoreTranscript() {
  const t = LS.get('transcript', null); if (!t || !t.rows || !t.rows.length || Date.now() - t.at > 12 * 3600000) return;
  setMode('talk');
  for (const r of t.rows) {
    const T = newTurn(r.you, undefined, r.at); T.plain = r.plain; T.bubble.classList.remove('live'); T.fixerId = r.fixerId; T.cost = r.cost;
    if (Array.isArray(r.stepRows) && r.stepRows.length) {   // structured steps come back folded and expandable
      for (const row of r.stepRows.slice(0, 40)) if (row && typeof row === 'object') restoreStep(T, row);
      T.stepLine = r.steps || stepSummaryLine(T.stepsList.flatMap((s) => Array.from({ length: s.n || 1 }, () => s)));
      T.fold.querySelector('.l').innerHTML = escapeHtml(T.stepLine) + ' — <u>show</u>'; T.steps.classList.add('folded');
    } else if (r.steps) { T.steps.hidden = false; T.fold.querySelector('.l').innerHTML = escapeHtml(r.steps); T.steps.classList.add('folded'); T.stepsList.push({ n: 1 }); }   // older saved transcripts: the one-line summary only
    setSaid(T, r.acc, false); T.done = true; if (r.error) T.nib.classList.add('error');
    T.at = r.at; setMeta(T, { costUsd: r.cost, ...localReplyMetadata(r) }); T.el.removeAttribute('aria-busy');
  }
  S.stick = true; scrollFeed(true); body.classList.add('rest');
}
function reattachFixerActs() { for (const T of S.turns) { if (!T.fixerId || T.body.querySelector('.acts')) continue; const f = fixerById(T.fixerId); if (f && (f.status === 'staged' || ACTIVE.has(f.status))) addActs(T, fixerActs(f), { sticky: true }); } }
function reportState() { persistTranscript(); clearTimeout(stateTimer); stateTimer = setTimeout(() => { try { fetch('/nibbi/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(snapshot()), keepalive: true }).catch(() => {}); } catch { /* offline */ } }, 400); }
new MutationObserver(reportState).observe(feed, { childList: true, subtree: true, characterData: true });
new MutationObserver(reportState).observe(chipsEl, { childList: true });
setInterval(reportState, 15000);
const clientLog = (level, msg, extra) => { try { fetch('/nibbi/client-log', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level, msg: String(msg).slice(0, 400), ...(extra || {}), url: location.href }), keepalive: true }).catch(() => {}); } catch { /* */ } };
addEventListener('error', (e) => clientLog('error', e.message, { src: (e.filename || '').split('/').pop() + ':' + e.lineno }));
addEventListener('unhandledrejection', (e) => clientLog('error', (e.reason && (e.reason.message || e.reason)) || 'unhandled rejection'));
const _toast = toast; window.__toastLog = true;

addEventListener('pagehide', () => LS.set('lastSeen', Date.now()));
document.addEventListener('visibilitychange', () => { if (document.hidden) LS.set('lastSeen', Date.now()); });
window.nibbi = nibbi; window.nibbiApp = { send, tidy, state: () => S, layout, interactions, voice: { snapshot: () => ({ enabled: listening, phase: micStarting ? 'starting' : wakeVoice.snapshot().phase }) } };
})();

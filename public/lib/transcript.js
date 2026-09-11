/* lib/transcript.js — pure helpers for the live tool transcript (chat steps + Builds Log). No DOM, no state. Unit-tested in tests/transcript.test.mjs.
   Event shape (daemon SSE `tool` frame / runEvents row): {name, phase:'started'|'finished', source:'governed'|'native'|'mcp', input?, ok?, summary?, bytes?, elapsedMs?, diff?, error?}.
   Redaction and bounding happen in the daemon (tool-transcript.ts); this module renders what it is given untouched. */
import { toolLabel, governedToolName, GOVERNED_LABEL } from './text.js';

const KIND = { web_search: 'web', web_fetch: 'web', read_file: 'file', list_files: 'file', write_file: 'file', edit_file: 'file', dispatch_fixer: 'build', steer_fixer: 'build', list_fixers: 'build', read_activity: 'build', recent_chat: 'memory', search_chat: 'memory', read_roadmap: 'plan' };
const DETAIL_KEYS = ['path', 'url', 'query', 'command', 'pattern', 'issue', 'guidance', 'title', 'task', 'taskId', 'runId', 'id'];
const clip = (s, max) => { const t = String(s).trim(); return t.length > max ? t.slice(0, max - 1) + '…' : t; };
const oneLine = (s, max = 120) => clip(String(s).replace(/\s+/g, ' '), max);

const SOURCES = ['governed', 'native', 'mcp'];
const text = (v) => v == null ? '' : typeof v === 'object' ? text(v.message) : String(v);

export const toolKind = (name, source) => { const raw = typeof name === 'string' ? name : ''; const n = governedToolName(raw) || raw; return KIND[n] || (n.startsWith('web_') ? 'web' : n.startsWith('ext_') || source === 'mcp' ? 'mcp' : 'native'); };

/* one line of the call's input: path → url → query → … → first string value → compact JSON; ≤120 chars */
export function inputLine(input) {
  if (input == null) return '';
  if (typeof input !== 'object') return oneLine(input);
  for (const k of DETAIL_KEYS) if (typeof input[k] === 'string' && input[k].trim()) return oneLine(input[k]);
  const first = Object.values(input).find((v) => typeof v === 'string' && v.trim());
  if (first !== undefined) return oneLine(first);
  if (!Object.keys(input).length) return '';
  try { return oneLine(JSON.stringify(input)); } catch { return ''; }
}

export function elapsedLabel(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '';
  if (ms < 9_950) return (ms / 1000).toFixed(1) + 's';
  const secs = Math.round(ms / 1000);
  if (secs < 60) return secs + 's';
  return Math.floor(secs / 60) + 'm ' + String(secs % 60).padStart(2, '0') + 's';
}

export function formatBytes(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return '';
  if (Math.round(n) < 1024) return Math.round(n) + ' B';
  const units = ['KB', 'MB', 'GB', 'TB']; let v = n / 1024, i = 0;
  while (Math.round(v * 10) >= 10_240 && i < units.length - 1) { v /= 1024; i++; }   // round before comparing so 1023.96 KB reads 1.0 MB, not 1024.0 KB
  return v.toFixed(1) + ' ' + units[i];
}

export function describeToolEvent(ev) {
  const e = ev && typeof ev === 'object' ? ev : {}; const raw = typeof e.name === 'string' ? e.name : ''; const stripped = governedToolName(raw);
  const source = SOURCES.includes(e.source) ? e.source : stripped || GOVERNED_LABEL[raw] ? 'governed' : raw.startsWith('ext_') ? 'mcp' : 'native';
  const name = source === 'native' ? raw : (stripped || raw);
  const label = toolLabel(source !== 'native' && !raw.startsWith('mcp__') ? 'mcp__nibbi__' + raw : raw);   // stripped governed names get their friendly label; mcp__* names already resolve
  const phase = e.phase === 'finished' ? 'finished' : 'started';
  const ok = phase === 'finished' ? !!e.ok : null;
  const elapsedMs = phase === 'finished' && typeof e.elapsedMs === 'number' && Number.isFinite(e.elapsedMs) && e.elapsedMs >= 0 ? e.elapsedMs : null;
  const summary = text(e.summary), error = text(e.error);
  const detail = phase === 'started' ? inputLine(e.input) : clip(ok ? (summary || error) : (error || summary), 300);
  return { label, name, detail, ok, elapsedLabel: elapsedLabel(elapsedMs), phase, kind: toolKind(name, source), source, elapsedMs, input: e.input, bytesLabel: formatBytes(e.bytes), diff: typeof e.diff === 'string' ? e.diff : '' };
}

/* "6 steps in 14s · 1 failed" — steps are describeToolEvent results; totalMs overrides the summed elapsed (e.g. wall clock) */
export function stepSummaryLine(steps, totalMs) {
  const list = Array.isArray(steps) ? steps : []; if (!list.length) return '';
  const summed = list.reduce((a, s) => a + (typeof s?.elapsedMs === 'number' && Number.isFinite(s.elapsedMs) && s.elapsedMs > 0 ? s.elapsedMs : 0), 0);
  const ms = typeof totalMs === 'number' && Number.isFinite(totalMs) && totalMs >= 0 ? totalMs : summed;
  const failed = list.filter((s) => s?.ok === false).length;
  return list.length + (list.length === 1 ? ' step' : ' steps') + (ms > 0 ? ' in ' + elapsedLabel(ms) : '') + (failed ? ' · ' + failed + ' failed' : '');
}

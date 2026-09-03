/* lib/text.js — pure helpers for the Nibbi surface (no DOM, no state). Unit-tested in tests/text.test.mjs. */
export const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const md = { esc: (s) => String(s).replace(/([*_`\[\]<>])/g, '\\$1') };
export const parseActs = (text) => { const acts = []; const clean = String(text || '').replace(/^[ \t]*»acts:\s*([^\n]*)\n?/gmi, (_, line) => { for (const a of line.split('|').map((x) => x.trim()).filter(Boolean)) if (!acts.includes(a)) acts.push(a); return ''; }); return { clean: clean.replace(/\n{3,}/g, '\n\n').trim(), acts: acts.slice(0, 4) }; };
export const firstSentences = (s, n, max) => { const parts = String(s).match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [s]; let out = ''; for (const p of parts) { if (out && (out + p).length > max) break; out += p; if (--n <= 0) break; } return out.trim().slice(0, max); };
export const stripMd = (s) => String(s || '').replace(/```[\s\S]*?```/g, ' code ').replace(/`([^`]*)`/g, '$1').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^[#>*\-\s]+/gm, '').replace(/[*_~]+/g, '').replace(/\s+/g, ' ').trim();

export const TOOL_LABEL = { Read: 'reading', Write: 'writing', Edit: 'editing', MultiEdit: 'editing', NotebookEdit: 'editing', Grep: 'searching', Glob: 'searching files', LS: 'looking around', Bash: 'running a command', WebFetch: 'browsing', WebSearch: 'searching the web', Task: 'delegating', TodoWrite: 'planning', AskUserQuestion: 'asking' };
export const toolLabel = (n) => n.startsWith('mcp__github') ? 'on github' : n.startsWith('mcp__') ? 'using ' + n.split('__')[1] : (TOOL_LABEL[n] || n.toLowerCase());

export function humanError(raw) {
  const m = String(raw || '').replace(/^\s*error:\s*/i, '');
  if (/oauth|authenticate|token/i.test(m)) return 'I spilled the ink pot — the gateway\'s login has expired. Run `claude setup-token`, then I\'ll try again.';
  if (/gateway offline|failed to fetch|networkerror|ECONNREFUSED|isn\'t reachable/i.test(m)) return 'The gateway isn\'t answering, so there\'s no brain behind me right now. Start it — or switch me to the demo brain to see how this feels.';
  if (/HTTP 5\d\d/.test(m)) return 'The gateway choked on that one (' + m + '). Try again?';
  if (/rate.?limit|429/i.test(m)) return 'I\'m rate-limited for a bit. Give me a few minutes and ask again.';
  return 'I lost the thread — ' + m.charAt(0).toLowerCase() + m.slice(1);
}

/* yes/no chips only for yes/no questions — open questions (what/how/which…) get none */
export function questionActs(text) {
  const clean = stripMd(text).trim();
  if (!/\?\s*$/.test(clean)) return [];
  const bounds = [...clean.matchAll(/[.!?](?=\s)/g)];   // sentence boundary = punctuation followed by whitespace (so 8.2 / v2.md stay whole)
  const cut = bounds.length ? bounds[bounds.length - 1].index : -1;
  const q = (cut >= 0 ? clean.slice(cut + 1) : clean).trim().replace(/^[—–-]\s*/, '');
  if (!q) return [];
  if (/^(what|which|where|when|why|how|who|whom|whose)\b/i.test(q) || /\bwhat\b.*\?$/i.test(q) && !/^(want|should|shall|do you|would you|can i|could i|may i|ok)/i.test(q)) return [];
  const m = q.match(/^(?:want me to|should i|shall i|do you want me to|would you like me to|can i|could i|may i|okay? (?:to|if i)|mind if i|ready to|ready for me to)\s+(.+?)\??$/i);
  if (m) { const verb = m[1].replace(/\s*\b(or|and)\b.*$/i, '').replace(/[,;:]$/, '').trim(); if (/\bor\b/i.test(m[1])) return []; const lab = verb.length > 26 ? verb.slice(0, 24).replace(/\s+\S*$/, '') + '…' : verb; return [{ label: 'yes, ' + lab, text: 'yes, ' + verb }, { label: 'not now', text: 'not now' }]; }
  if (/^(is|are|do|does|did|will|would|should|shall|can|could|have|has|was|were)\b/i.test(q) && !/\bor\b/i.test(q)) return [{ label: 'yes', text: 'yes' }, { label: 'no', text: 'no' }];
  return [];
}

export function relTime(ts) { const d = (Date.now() - ts) / 1000; if (d < 60) return 'just now'; if (d < 3600) return Math.round(d / 60) + ' min ago'; if (d < 86400) return Math.round(d / 3600) + 'h ago'; if (d < 7 * 86400) return Math.round(d / 86400) + 'd ago'; return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' }); }

export function parseDiff(diff) {
  const files = []; let cur = null;
  for (const ln of String(diff || '').split('\n')) {
    if (ln.startsWith('diff --git')) { cur = { name: ln.replace(/^diff --git a\/(\S+).*/, '$1'), lines: [], add: 0, del: 0 }; files.push(cur); continue; }
    if (!cur) { cur = { name: '', lines: [], add: 0, del: 0 }; files.push(cur); }
    if (/^(index |--- |\+\+\+ )/.test(ln)) continue;
    if (ln.startsWith('+')) cur.add++; else if (ln.startsWith('-')) cur.del++;
    cur.lines.push(ln);
  }
  return files;
}

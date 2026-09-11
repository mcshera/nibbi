// Dependency-free HTML → readable text for tool results.
// One left-to-right pass: a small tokenizer (text / tag / comment / raw-text) feeds a line builder.
// No backtracking and no regex over the whole document, so runtime is linear in input size.

export interface HtmlTextOptions { maxChars?: number; baseUrl?: string }
export interface HtmlTextLink { text: string; href: string }
export interface HtmlTextResult { title: string; text: string; links: HtmlTextLink[]; truncated: boolean }

const DEFAULT_MAX_CHARS = 40_000, LINK_CAP = 200, LINK_TEXT_CAP = 200, TITLE_CAP = 300;

const RAW = new Set(['script', 'style']);                                            // raw text: dropped up to the matching close tag
const HIDDEN = new Set(['svg', 'template', 'noscript', 'iframe']);                  // nested markup: dropped with depth tracking
const HEAD_CHILDREN = new Set(['title', 'meta', 'link', 'style', 'script', 'noscript', 'base', 'template']);
const PARAGRAPH = new Set(['p', 'blockquote', 'table', 'figure', 'hr']);             // blank line around
const LINE = new Set(['div', 'section', 'article', 'main', 'header', 'footer', 'nav', 'aside', 'tr', 'dt', 'dd', 'figcaption', 'br']);
const NAMED = new Map<string, string>([
  ['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['apos', "'"], ['nbsp', ' '],
  ['copy', '©'], ['reg', '®'], ['trade', '™'], ['mdash', '—'], ['ndash', '–'], ['hellip', '…'], ['laquo', '«'], ['raquo', '»'],
  ['ldquo', '“'], ['rdquo', '”'], ['lsquo', '‘'], ['rsquo', '’'], ['bull', '•'], ['middot', '·'], ['times', '×'], ['deg', '°'],
  ['euro', '€'], ['pound', '£'], ['yen', '¥'], ['cent', '¢'],
]);

export function htmlToText(html: string, options: HtmlTextOptions = {}): HtmlTextResult {
  const out = new Extractor(options.baseUrl);
  if (/<[a-z!/?]/i.test(html)) tokenize(html, out); else out.plainText(html);
  return out.finish(Math.max(0, options.maxChars ?? DEFAULT_MAX_CHARS));
}

// ── tokenizer ─────────────────────────────────────────────────────────────────

function tokenize(html: string, out: Extractor): void {
  const n = html.length; let i = 0;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { out.text(html.slice(i)); break; }
    if (lt > i) out.text(html.slice(i, lt));
    i = lt + 1;
    const c = html.charCodeAt(i);
    if (c === 0x21 /* ! */) {                                                        // comment, doctype, CDATA
      if (html.startsWith('--', i + 1)) { const end = html.indexOf('-->', i + 3); i = end < 0 ? n : end + 3; } else i = skipPast(html, i);
      continue;
    }
    if (c === 0x3f /* ? */) { i = skipPast(html, i); continue; }                    // processing instruction
    if (c === 0x2f /* / */) {                                                        // close tag; "</>" and "</ x>" are dropped like browsers do
      const j = readName(html, i + 1);
      if (j > i + 1) out.close(html.slice(i + 1, j).toLowerCase());
      i = skipPast(html, j); continue;
    }
    if (!isAlpha(c)) { out.text('<'); continue; }                                    // literal "<" (e.g. "a < b")
    const j = readName(html, i), name = html.slice(i, j).toLowerCase();
    const tag = readAttributes(html, j); i = tag.end;
    if (name === 'title' || RAW.has(name)) {                                         // RCDATA / raw text: jump to the matching close tag
      const close = findClose(html, i, name);
      if (name === 'title') out.setTitle(html.slice(i, close < 0 ? n : close));
      i = close < 0 ? n : skipPast(html, close); continue;
    }
    out.open(name, tag.href, tag.selfClosing);
  }
}

/** Parses attributes after a tag name; only `href` is kept. Handles quoted, unquoted and bare attributes and "/>". */
function readAttributes(html: string, from: number): { end: number; selfClosing: boolean; href?: string } {
  const n = html.length; let j = from, href: string | undefined, selfClosing = false;
  while (j < n) {
    const c = html.charCodeAt(j);
    if (c === 0x3e /* > */) { j++; break; }
    if (c === 0x2f /* / */) { if (html.charCodeAt(j + 1) === 0x3e) { selfClosing = true; j += 2; break; } j++; continue; }
    if (isTagSpace(c)) { j++; continue; }
    let k = j + 1;
    while (k < n) { const d = html.charCodeAt(k); if (d === 0x3d || d === 0x3e || d === 0x2f || isTagSpace(d)) break; k++; }
    const name = html.slice(j, k).toLowerCase(); j = k;
    while (j < n && isTagSpace(html.charCodeAt(j))) j++;
    let value = '';
    if (html.charCodeAt(j) === 0x3d /* = */) {
      j++; while (j < n && isTagSpace(html.charCodeAt(j))) j++;
      const q = html.charCodeAt(j);
      if (q === 0x22 || q === 0x27) { const close = html.indexOf(q === 0x22 ? '"' : "'", j + 1); value = html.slice(j + 1, close < 0 ? n : close); j = close < 0 ? n : close + 1; }
      else { let e = j; while (e < n && html.charCodeAt(e) !== 0x3e && !isTagSpace(html.charCodeAt(e))) e++; value = html.slice(j, e); j = e; }
    }
    if (name === 'href' && href === undefined) href = decodeEntities(value);
  }
  return { end: j, selfClosing, href };
}

/** Index of `</name` (case-insensitive, followed by a non-name char) at or after `from`, or -1. */
function findClose(html: string, from: number, name: string): number {
  for (let p = html.indexOf('</', from); p >= 0; p = html.indexOf('</', p + 2)) {
    const end = p + 2 + name.length;
    if (html.slice(p + 2, end).toLowerCase() === name && (end >= html.length || !isNameChar(html.charCodeAt(end)))) return p;
  }
  return -1;
}

function readName(html: string, from: number): number { let j = from; while (j < html.length && isNameChar(html.charCodeAt(j))) j++; return j; }
function skipPast(html: string, from: number): number { const end = html.indexOf('>', from); return end < 0 ? html.length : end + 1; }
function isAlpha(c: number): boolean { return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a); }
function isDigit(c: number): boolean { return c >= 0x30 && c <= 0x39; }
function isNameChar(c: number): boolean { return isAlpha(c) || isDigit(c) || c === 0x2d || c === 0x3a || c === 0x5f; }
function isTagSpace(c: number): boolean { return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x0c; }
function isSpace(c: number): boolean { return isTagSpace(c) || c === 0x0b || c === 0xa0; }

// ── entities ──────────────────────────────────────────────────────────────────

function decodeEntities(s: string): string {
  let amp = s.indexOf('&'); if (amp < 0) return s;
  let out = '', i = 0;
  while (amp >= 0) {
    out += s.slice(i, amp);
    let semi = -1;                                                                   // bounded look-ahead: "&#x10FFFF;" is the longest form we accept
    for (let k = amp + 1; k < s.length && k <= amp + 10; k++) { const c = s.charCodeAt(k); if (c === 0x3b) { semi = k; break; } if (!isAlpha(c) && !isDigit(c) && c !== 0x23) break; }
    const decoded = semi > amp + 1 ? decodeEntity(s.slice(amp + 1, semi)) : undefined;
    if (decoded === undefined) { out += '&'; i = amp + 1; } else { out += decoded; i = semi + 1; }
    amp = s.indexOf('&', i);
  }
  return out + s.slice(i);
}

function decodeEntity(body: string): string | undefined {
  if (body.charCodeAt(0) !== 0x23 /* # */) return NAMED.get(body) ?? NAMED.get(body.toLowerCase());
  const hex = body[1] === 'x' || body[1] === 'X', digits = body.slice(hex ? 2 : 1);
  if (!digits || !(hex ? /^[0-9a-f]+$/i : /^[0-9]+$/).test(digits)) return undefined;
  const cp = parseInt(digits, hex ? 16 : 10);
  if (!(cp > 0 && cp <= 0x10ffff) || (cp >= 0xd800 && cp <= 0xdfff)) return undefined;
  return String.fromCodePoint(cp);
}

function resolveHref(raw: string | undefined, baseUrl: string | undefined): string | undefined {
  const href = raw?.trim(); if (!href) return undefined;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1]?.toLowerCase();
  if (scheme === 'javascript' || scheme === 'data' || scheme === 'vbscript') return undefined;
  if (!baseUrl) return href;
  try { return new URL(href, baseUrl).href; } catch { return href; }
}

// ── line builder ──────────────────────────────────────────────────────────────

class Extractor {
  private lines: string[] = [];
  private current = ''; private prefixLen = 0; private pendingSpace = false;
  private preDepth = 0; private preFresh = false; private listDepth = 0;
  private hidden = 0; private hiddenCounts = new Map<string, number>(); private inHead = false;
  private title = ''; private firstH1 = ''; private captureH1 = false;
  private link: { href: string; start: number; text: string } | null = null;         // start < 0: link began on an earlier line
  private links: HtmlTextLink[] = []; private seen = new Set<string>();
  private baseUrl: string | undefined; private baseSeen = false;

  constructor(baseUrl?: string) { this.baseUrl = baseUrl; }

  text(raw: string): void {
    if (this.hidden > 0 || this.inHead) return;
    const s = decodeEntities(raw);
    if (this.preDepth > 0) { this.appendPre(s); return; }
    const n = s.length; let i = 0;
    while (i < n) {
      if (isSpace(s.charCodeAt(i))) { if (this.current.length > this.prefixLen) this.pendingSpace = true; i++; continue; }
      let j = i + 1; while (j < n && !isSpace(s.charCodeAt(j))) j++;
      if (this.pendingSpace) { this.current += ' '; this.pendingSpace = false; }
      this.current += s.slice(i, j); i = j;
    }
  }

  plainText(text: string): void {
    for (const line of text.split('\n')) { if (line.trim() === '') this.endParagraph(); else { this.text(line); this.endLine(); } }
  }

  setTitle(raw: string): void {
    if (this.title || this.hidden > 0) return;
    const title = decodeEntities(raw).replace(/\s+/g, ' ').trim();
    if (title) this.title = title.slice(0, TITLE_CAP);
  }

  open(name: string, href: string | undefined, selfClosing: boolean): void {
    if (HIDDEN.has(name)) { if (!selfClosing) { this.hidden++; this.hiddenCounts.set(name, (this.hiddenCounts.get(name) ?? 0) + 1); } return; }
    if (this.hidden > 0) return;
    if (name === 'head') { this.inHead = true; return; }
    if (this.inHead && !HEAD_CHILDREN.has(name)) this.inHead = false;               // implicit </head>
    if (name === 'base') { if (href && !this.baseSeen) { this.baseSeen = true; this.baseUrl = resolveHref(href, this.baseUrl) ?? this.baseUrl; } return; }
    if (this.inHead) return;
    if (name === 'a') { this.closeLink(); const resolved = resolveHref(href, this.baseUrl); if (resolved) this.link = { href: resolved, start: this.current.length, text: '' }; return; }
    if (name === 'td' || name === 'th') { if (this.current.length > this.prefixLen) this.pendingSpace = true; return; }
    if (isHeading(name)) { this.endParagraph(); this.setPrefix('#'.repeat(Number(name[1])) + ' '); this.captureH1 = name === 'h1'; return; }
    if (name === 'li') { this.endLine(); this.setPrefix('  '.repeat(Math.max(0, this.listDepth - 1)) + '- '); return; }
    if (name === 'ul' || name === 'ol') { if (this.listDepth > 0) this.endLine(); else this.endParagraph(); this.listDepth++; return; }
    if (name === 'pre') { this.endParagraph(); this.preDepth++; this.preFresh = true; return; }
    if (PARAGRAPH.has(name)) { this.endParagraph(); return; }
    if (LINE.has(name)) this.endLine();
  }

  close(name: string): void {
    if (HIDDEN.has(name)) { const count = this.hiddenCounts.get(name) ?? 0; if (count > 0) { this.hiddenCounts.set(name, count - 1); this.hidden--; } return; }
    if (this.hidden > 0) return;
    if (name === 'head') { this.inHead = false; return; }
    if (this.inHead) return;
    if (name === 'a') { this.closeLink(); return; }
    if (name === 'pre') { if (this.preDepth > 0) this.preDepth--; this.endParagraph(); return; }
    if (name === 'ul' || name === 'ol') { if (this.listDepth > 0) this.listDepth--; if (this.listDepth > 0) this.endLine(); else this.endParagraph(); return; }
    if (name === 'li') { this.endLine(); return; }
    if (isHeading(name) || PARAGRAPH.has(name)) { this.endParagraph(); return; }
    if (LINE.has(name)) this.endLine();
  }

  finish(maxChars: number): HtmlTextResult {
    this.closeLink(); this.endLine();
    while (this.lines.length && this.lines[this.lines.length - 1] === '') this.lines.pop();
    let text = this.lines.join('\n').trim(), truncated = false;
    if (text.length > maxChars) {
      truncated = true;
      const cut = text.lastIndexOf('\n', maxChars);                                  // prefer a line boundary unless it would discard most of the budget
      text = (cut >= maxChars / 2 ? text.slice(0, cut) : text.slice(0, maxChars)).trimEnd();
    }
    return { title: this.title || this.firstH1.slice(0, TITLE_CAP), text, links: this.links, truncated };
  }

  private setPrefix(prefix: string): void { this.current = prefix; this.prefixLen = prefix.length; this.pendingSpace = false; }

  private appendPre(s: string): void {
    if (this.preFresh) { this.preFresh = false; if (s.startsWith('\r\n')) s = s.slice(2); else if (s.startsWith('\n')) s = s.slice(1); }
    let i = 0;
    for (;;) {
      const nl = s.indexOf('\n', i);
      if (nl < 0) { this.current += s.slice(i); return; }
      this.current += s.slice(i, s.charCodeAt(nl - 1) === 0x0d && nl > i ? nl - 1 : nl); this.endLine(); i = nl + 1;
    }
  }

  private endLine(): void {
    const { link } = this;
    if (link) { if (link.text.length < 2 * LINK_TEXT_CAP) link.text += this.current.slice(link.start < 0 ? this.prefixLen : link.start) + ' '; link.start = -1; }
    if (this.preDepth > 0 || this.current.length > this.prefixLen) {
      this.lines.push(this.current);
      if (this.captureH1 && !this.firstH1) this.firstH1 = this.current.slice(this.prefixLen).replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    }
    this.current = ''; this.prefixLen = 0; this.pendingSpace = false; this.captureH1 = false;
  }

  private endParagraph(): void { this.endLine(); const last = this.lines.length - 1; if (last >= 0 && this.lines[last] !== '') this.lines.push(''); }

  private closeLink(): void {
    const link = this.link; if (!link) return; this.link = null;
    const from = link.start < 0 ? this.prefixLen : link.start, inner = this.current.slice(from), trimmed = inner.trim();
    if (link.start >= 0 && trimmed) this.current = this.current.slice(0, from + inner.length - inner.trimStart().length) + '[' + trimmed + '](' + link.href + ')';
    const text = (link.text + inner).trim();                                         // a link spanning lines stays plain in the text but is still collected
    if (!text || this.seen.has(link.href) || this.links.length >= LINK_CAP) return;
    this.seen.add(link.href); this.links.push({ text: text.slice(0, LINK_TEXT_CAP), href: link.href });
  }
}

function isHeading(name: string): boolean { return name.length === 2 && name.charCodeAt(0) === 0x68 && name.charCodeAt(1) >= 0x31 && name.charCodeAt(1) <= 0x36; }

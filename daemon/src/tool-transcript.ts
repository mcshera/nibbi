/** Pure, bounded views of governed tool calls for the live transcript: redacted inputs, one-line summaries, small diffs. No I/O. */
const SECRET = /token|secret|password|api[_-]?key|authorization|cookie/i;
const STRING_MAX = 400, INPUT_MAX = 2048, SUMMARY_MAX = 300, DIFF_MAX = 4096, DEPTH_MAX = 4, ENTRIES_MAX = 50, LINE_MAX = 500, CONTEXT = 3;
const ELIDED = '[…]', REDACTED = '[redacted]', TRUNCATED = '… (truncated)';

const clip = (text: string, max: number): string => text.length > max ? text.slice(0, max - 1) + '…' : text;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null);
const serialize = (value: unknown): string => { if (typeof value === 'string') return value; try { return JSON.stringify(value) ?? 'null'; } catch { return String(value); } }; // Cycles and BigInt must not throw inside a hook.
const size = (value: unknown): number => Buffer.byteLength(serialize(value));

function bound(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return clip(value, STRING_MAX);
  if (value === undefined) return null;
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (depth >= DEPTH_MAX) return ELIDED;
  if (Array.isArray(value)) return [...value.slice(0, ENTRIES_MAX).map(item => bound(item, depth + 1)), ...(value.length > ENTRIES_MAX ? [ELIDED] : [])];
  if (!isRecord(value)) return ELIDED;
  const entries = Object.entries(value);
  return Object.fromEntries([...entries.slice(0, ENTRIES_MAX).map(([key, item]) => [key, SECRET.test(key) ? REDACTED : bound(item, depth + 1)]), ...(entries.length > ENTRIES_MAX ? [[ELIDED, ELIDED]] : [])]);
}
/** Tool arguments safe to show and store: secrets redacted, strings clipped, whole record ≤ 2 KB. */
export function boundedInput(args: unknown): Record<string, unknown> {
  const out = bound(isRecord(args) ? args : args === undefined || args === null ? {} : { value: args }, 0) as Record<string, unknown>;
  const keys = Object.keys(out);
  while (size(out) > INPUT_MAX) {
    const largest = keys.filter(key => out[key] !== ELIDED).sort((a, b) => size(out[b]) - size(out[a]))[0];
    if (largest !== undefined) { out[largest] = ELIDED; continue; }
    const last = keys.pop(); if (last === undefined) break;
    delete out[last]; out[ELIDED] = ELIDED;
  }
  return out;
}

const str = (value: unknown, max = 120): string => clip(String(value ?? ''), max);
const host = (url: unknown): string => { try { return new URL(String(url)).hostname; } catch { return str(url, 80); } };
const count = (result: unknown, field: string): number | undefined => {
  if (Array.isArray(result)) return result.length;
  if (!isRecord(result)) return undefined;
  const value = result[field]; if (typeof value === 'number') return value;
  return Array.isArray(result.items) ? result.items.length : undefined;
};
/** One line (≤ 300 chars) describing what a finished call produced, phrased per tool; unknown tools fall back to a JSON prefix. */
export function summarizeResult(name: string, args: Record<string, unknown>, result: unknown): string {
  const record = isRecord(result) ? result : {};
  const text = serialize(result);
  const line = ((): string => {
    switch (name) {
      case 'read_file': return 'read ' + text.length + ' chars of ' + str(args.path);
      case 'list_files': return (count(result, 'returned') ?? 0) + ' entries in ' + str(args.path);
      case 'write_file': return 'wrote ' + str(args.path);
      case 'edit_file': return 'updated ' + str(args.path);
      case 'dispatch_fixer': return 'queued build ' + str(record.id) + ': ' + str(record.title ?? record.issue ?? args.title ?? args.issue, 160);
      case 'steer_fixer': return 'steered ' + str(args.id);
      case 'web_search': return (count(record.results, 'resultCount') ?? count(result, 'resultCount') ?? 0) + ' results for ' + str(args.query ?? record.query);
      case 'web_fetch': return record.decision === 'denied' ? host(args.url) + ': denied (' + str(record.code) + ')' : (str(record.title) || host(record.finalUrl ?? args.url)) + ', ' + String(record.text ?? '').length + ' chars';
      case 'read_roadmap': case 'read_activity': case 'list_fixers': return (count(result, 'returned') ?? 0) + ' items';
      case 'shell': return 'exit ' + str(record.code) + ', ' + (String(record.stdout ?? '').length + String(record.stderr ?? '').length) + ' chars';
      default: return name.startsWith('ext_') ? str(record.server, 60) + ': ' + (typeof record.content === 'string' ? record.content.length : Number(record.contentBytes ?? 0)) + ' chars' : clip(text, SUMMARY_MAX * 4);
    }
  })();
  return clip(line.replace(/\s+/g, ' ').trim(), SUMMARY_MAX);
}

const split = (text: string): string[] => { const lines = text.split('\n'); if (lines[lines.length - 1] === '') lines.pop(); return lines; };
const header = (path: string, created = false): string[] => ['diff --git a/' + path + ' b/' + path, '--- ' + (created ? '/dev/null' : 'a/' + path), '+++ b/' + path];
const row = (line: string): string => clip(line, LINE_MAX + 1);
/** Line changes between two blocks via an LCS table; blocks too large for the table degrade to remove-all/add-all. */
function changes(before: string[], after: string[]): string[] {
  const n = before.length, m = after.length, out: string[] = [];
  if (n * m > 2_000_000) return [...before.map(line => '-' + line), ...after.map(line => '+' + line)];
  const width = m + 1, table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) table[i * width + j] = before[i] === after[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
  let i = 0, j = 0;
  while (i < n && j < m) { if (before[i] === after[j]) { out.push(' ' + before[i++]); j++; } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) out.push('-' + before[i++]); else out.push('+' + after[j++]); }
  while (i < n) out.push('-' + before[i++]); while (j < m) out.push('+' + after[j++]);
  return out;
}
function bounded(lines: string[]): string {
  const text = lines.join('\n'); if (Buffer.byteLength(text) <= DIFF_MAX) return text;
  const kept: string[] = []; let used = Buffer.byteLength(TRUNCATED);
  for (const line of lines) { const next = used + Buffer.byteLength(line) + 1; if (next > DIFF_MAX) break; kept.push(line); used = next; }
  return [...kept, TRUNCATED].join('\n');
}
/** Unified diff (≤ 4 KB) for the two governed write tools; hunk positions are relative to the edited block, not the file. */
export function diffFor(name: string, args: Record<string, unknown>): string | undefined {
  const path = typeof args.path === 'string' ? args.path : '';
  if (name === 'write_file') { if (typeof args.text !== 'string') return undefined; const lines = split(args.text); return bounded([...header(path, true), '@@ -0,0 +1,' + lines.length + ' @@', ...lines.map(line => row('+' + line))]); }
  if (name !== 'edit_file' || typeof args.oldText !== 'string' || typeof args.newText !== 'string') return undefined;
  const before = split(args.oldText), after = split(args.newText);
  let start = 0; while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endBefore = before.length, endAfter = after.length; while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) { endBefore--; endAfter--; }
  const lead = before.slice(Math.max(0, start - CONTEXT), start), tail = before.slice(endBefore, endBefore + CONTEXT);
  const body = [...lead.map(line => ' ' + line), ...changes(before.slice(start, endBefore), after.slice(start, endAfter)), ...tail.map(line => ' ' + line)];
  const from = start - lead.length + 1, oldCount = body.filter(line => line[0] !== '+').length, newCount = body.filter(line => line[0] !== '-').length;
  return bounded([...header(path), '@@ -' + from + ',' + oldCount + ' +' + from + ',' + newCount + ' @@', ...body.map(row)]);
}

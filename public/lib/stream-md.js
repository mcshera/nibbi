/* lib/stream-md.js — what of a half-written reply is safe to render and keep.
   Pure; no DOM. Unit-tested in tests/stream-md.test.mjs.

   Rendering a growing reply by re-parsing all of it every frame throws away the DOM a reader is
   looking at: the selection dies, code blocks restart, half-typed emphasis flickers. Almost all of
   a reply stops changing long before the reply ends, so the text is split into blocks that are
   finished and one live tail. Only the tail is re-rendered.

   The rule for "finished" is the blank line, with the two exceptions that make it wrong: a blank
   line inside a fenced code block, and the blank line between items of a loose list. */
import { parseActs } from './text.js';

const VOICE = /»voice:\s*(?:(?!»voice:)[^\n])*\n?/g;
const FENCE = /^[ \t]*(`{3,}|~{3,})(.*)$/;
const LIST = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]/;
const INDENTED = /^(?: {2,}|\t)\S/;
// A marker arriving one character at a time is not a marker yet: after "- one\n\n" the next line
// reads "2" for a frame before it reads "2. two". Deciding then would finish the list mid-list.
const UNDECIDED = /^[ \t]*(?:[-*+]|\d{1,9}[.)]?)[ \t]*$/;

/** Strip the protocol lines from a reply. While it is still arriving, `partial` also drops a
 *  trailing marker line that is only half typed — `»`, `»vo`, `»acts: sh` — which the finished
 *  patterns cannot recognise yet and which must never be painted even for one frame. */
export function cleanReply(text, { partial = false } = {}) {
  let source = String(text ?? '').replace(/\r\n/g, '\n');
  if (partial) {
    const start = source.lastIndexOf('\n') + 1;
    if (/^[ \t]*»/.test(source.slice(start))) source = source.slice(0, start);
  }
  return parseActs(source.replace(VOICE, '')).clean;
}

/** Split into finished blocks plus the live tail. The last element is always the tail, so the
 *  result is never empty and `slice(0, -1)` is what may be rendered once and left alone.
 *
 *  Guarantee the caller depends on: for any prefix of a text, the finished blocks are a prefix of
 *  that text's finished blocks. A block only becomes finished once the next one has begun. */
export function splitBlocks(text) {
  const lines = String(text ?? '').split('\n');
  const blocks = [];
  let current = [];
  let fence = null;
  const inList = () => { const first = current.find(line => line.trim()); return first ? LIST.test(first) : false; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      current.push(line);
      const close = line.match(FENCE);
      // A closing fence is the same character, at least as long, and carries no info string.
      if (close && close[1][0] === fence.char && close[1].length >= fence.length && !close[2].trim()) fence = null;
      continue;
    }
    const open = line.match(FENCE);
    if (open) { fence = { char: open[1][0], length: open[1].length }; current.push(line); continue; }
    if (line.trim() !== '') { current.push(line); continue; }
    let next = i;
    while (next < lines.length && lines[next].trim() === '') next++;
    // Nothing after the blank line yet: the block before it is not finished until something follows,
    // because what follows decides whether it was a paragraph or the first item of a loose list.
    if (next >= lines.length) { for (; i < lines.length; i++) current.push(lines[i]); break; }
    const continues = LIST.test(lines[next]) || INDENTED.test(lines[next]) || (next === lines.length - 1 && UNDECIDED.test(lines[next]));
    if (inList() && continues) { for (let k = i; k < next; k++) current.push(lines[k]); i = next - 1; continue; }
    blocks.push(current.join('\n'));
    current = [];
    i = next - 1;
  }
  blocks.push(current.join('\n'));
  return blocks;
}

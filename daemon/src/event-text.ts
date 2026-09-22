/** Durable text rows, coalesced.
 *
 * A provider emits one `text.delta` per token. Persisting each one costs an fsync and, because the
 * row is written before the delta is forwarded, paces delivery by the disk rather than by the model.
 * Rows are buffered here and written per sentence, per newline, per 2 KB or per 80 ms — the same row
 * shape, just fewer of them. Both readers already join consecutive rows (`project-workspace.ts`
 * activity tail, `read-models.ts` run events), so the recorded text is unchanged.
 *
 * The live stream is never buffered: callers forward the token first and push here second.
 */
export interface TextRows { push(text: string): void; flush(): void }
export function coalesceText(write: (text: string) => void, delayMs = 80): TextRows {
  let pending = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = (): void => {
    if (timer) { clearTimeout(timer); timer = undefined; }
    if (!pending) return;
    const text = pending; pending = ''; write(text);
  };
  return {
    push(text: string): void {
      if (!text) return;
      pending += text;
      // A sentence, a line or a bounded chunk is a row; anything shorter waits one tick for company.
      if (pending.length >= 2000 || pending.includes('\n') || /[.!?]["')\]]?\s$/.test(pending)) flush();
      else timer ??= setTimeout(flush, delayMs);
    },
    flush,
  };
}

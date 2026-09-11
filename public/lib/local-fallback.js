/** Per-reply provenance only. Never changes configured provider or grants capabilities. */
export function localReplyMetadata(value) {
  if (!value || typeof value !== 'object') return {};
  const fallback = value.fallback && typeof value.fallback === 'object' ? value.fallback :
    value.reason === 'usage_limit' && value.chatOnly === true ? value : undefined;
  if (value.local !== true && !fallback) return {};
  const rawModel = value.localModel ?? fallback?.localModel;
  const localModel = typeof rawModel === 'string' && rawModel.trim() ? rawModel : undefined;
  return { local: true, ...(localModel ? { localModel } : {}), ...(fallback ? { fallback: {
    primaryProvider: fallback.primaryProvider, localModel: fallback.localModel,
    reason: fallback.reason, chatOnly: fallback.chatOnly,
    ...(Number.isFinite(fallback.resetAtMs) ? { resetAtMs: fallback.resetAtMs } : {}),
  } } : {}) };
}
export function localReplyLabel(value) {
  const data = localReplyMetadata(value);
  return data.local ? 'LOCAL · ' + (data.localModel || 'model not reported') + ' · chat only' : '';
}
export function updateLocalReply(turn, value) {
  Object.assign(turn, localReplyMetadata(value));
  const label = localReplyLabel(turn);
  if (turn.provenance) { turn.provenance.textContent = label; turn.provenance.hidden = !label; }
  return label;
}
/** A failed/stopped local stream is not an accepted assistant reply. */
export function settleLocalReply(result, turn) {
  const metadata = { ...localReplyMetadata(turn), ...localReplyMetadata(result) };
  if (!metadata.local) return result;
  if (result.isError || result.aborted) {
    const notice = 'The incomplete response was discarded.';
    // Only the terminal event's fixed backend error is trusted, never streamed text
    // or arbitrary fetch/parse exceptions. Keep its useful cause, with a hard bound.
    const trusted = result.ev === 'done' && typeof result.text === 'string' &&
      result.text.startsWith('The primary provider is usage-limited. LOCAL chat only — ');
    const cause = trusted ? result.text.replace(/\s*The incomplete response was discarded\.$/, '').slice(0, 600) : '';
    return {
      ...result, ...metadata, isError: true, voice: undefined,
      text: result.aborted ? 'Local reply stopped. ' + notice :
        cause ? cause + ' ' + notice : 'Local reply failed. ' + notice + ' Try again when a provider is available.',
    };
  }
  return { ...result, ...metadata };
}
/** Explicit resetAtMs is milliseconds; legacy resetsAt may be epoch seconds. */
export function rateLimitNotice(limit, formatTime = ms => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) {
  if (!limit || limit.status === 'allowed') return '';
  if (limit.status === 'allowed_warning') return 'Primary provider usage is near its limit; requests are still allowed.';
  if (limit.status !== 'rejected') return '';
  const raw = limit.resetAtMs ?? limit.resetsAt;
  const reset = limit.resetAtMs == null && Number.isFinite(raw) && raw > 0 && raw < 1e12 ? raw * 1000 : raw;
  const time = Number.isFinite(reset) && reset > 0 && reset <= 8640000000000000 ? formatTime(reset) : '';
  return 'Primary provider usage limit reached' + (time ? '; resets at ' + time + '.' : '; reset time is not available.');
}

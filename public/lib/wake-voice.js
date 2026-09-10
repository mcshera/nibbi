/** Local wake gate. Transcripts are classified here, never stored in state. */
export const WAKE_GREETING = "What's up, Matty?";

export function parseWakePhrase(text) {
  if (typeof text !== 'string') return null;
  const match = /^[\s\p{P}]*hey[\s\p{P}]+nibb[iy](?![\p{L}\p{N}_])/iu.exec(text);
  if (!match) return null;
  return { command: text.slice(match[0].length).replace(/^[\s\p{P}]+/u, '').trim() };
}

export function createWakeVoice({
  transcribe, greet, send, onState = () => {}, onError = () => {},
  followupMs = 12000, setTimer = setTimeout, clearTimer = clearTimeout,
}) {
  let enabled = false;
  let suspended = false;
  let phase = 'off';
  let generation = 0;
  let operation = null;
  let timer = null;

  const snapshot = () => ({ enabled, phase });
  const report = (error) => {
    if (error?.name === 'AbortError') return;
    try { onError(error); } catch { /* Observers must not break the gate. */ }
  };
  const state = (next) => {
    phase = next;
    try { onState(snapshot()); } catch (error) { report(error); }
  };
  const clearFollowup = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const invalidate = () => {
    generation += 1;
    clearFollowup();
    const old = operation;
    operation = null;
    old?.controller.abort();
  };
  const rest = () => state(!enabled ? 'off' : suspended ? 'paused' : 'armed');
  const current = (op) => enabled && !suspended && generation === op.generation && operation === op;
  const listen = (op) => {
    if (!current(op)) return;
    state('listening');
    if (!current(op) || phase !== 'listening') return;
    const epoch = generation;
    timer = setTimer(() => {
      timer = null;
      if (enabled && !suspended && generation === epoch && phase === 'listening') rest();
    }, followupMs);
  };

  return {
    snapshot,
    enable() {
      if (enabled) return;
      invalidate();
      enabled = true;
      rest();
    },
    disable() {
      enabled = false;
      invalidate();
      rest();
    },
    setSuspended(value) {
      value = Boolean(value);
      if (suspended === value) return;
      suspended = value;
      invalidate();
      rest();
    },
    holdFollowup() {
      if (phase === 'listening') clearFollowup();
    },
    async submit(blob) {
      if (!enabled || suspended || operation || !['armed', 'listening'].includes(phase)) return;
      const following = phase === 'listening';
      clearFollowup();
      const op = { generation, controller: new AbortController() };
      operation = op;
      state('transcribing');
      try {
        if (!current(op)) return;
        let transcript = String(await transcribe(blob, op.controller.signal) ?? '').trim();
        if (!current(op)) return;
        const wake = parseWakePhrase(transcript);
        const command = wake ? wake.command : following ? transcript : '';
        transcript = ''; // Keep only a classified command across subsequent awaits.
        if (!following && !wake) { rest(); return; }
        if (!following) {
          state('greeting');
          if (!current(op)) return;
          try { await greet(WAKE_GREETING, op.controller.signal); }
          catch (error) {
            if (current(op)) { report(error); listen(op); }
            return;
          }
          if (!current(op)) return;
        }
        if (!command) { listen(op); return; }
        state('sending');
        if (!current(op)) return;
        await send(command);
        if (current(op)) rest();
      } catch (error) {
        if (current(op)) {
          const retryFollowup = following && phase === 'transcribing';
          report(error);
          if (current(op)) {
            if (retryFollowup) listen(op);
            else rest();
          }
        }
      } finally {
        if (operation === op) operation = null;
      }
    },
  };
}

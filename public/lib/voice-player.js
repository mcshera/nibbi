/** One cancellable local TTS player. Unlock on a user gesture for Safari/WKWebView. */
export function createVoicePlayer({ onStart = () => {}, onEnd = () => {}, onLevel = () => {},
  AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext, fetchAudio = globalThis.fetch,
  setTick = setInterval, clearTick = clearInterval, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let context = null, current = null;
  function unlock() {
    if (!AudioContextClass) return Promise.reject(new Error('Audio playback is not supported here.'));
    context ||= new AudioContextClass();
    return context.resume();
  }
  function stop() { current?.abort(); }
  async function play(text, signal) {
    stop();
    const controller = new AbortController(); current = controller;
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    let source, analyser, ticker, rejectEnded, timedOut = false;
    let timeout = setTimer(() => { timedOut = true; controller.abort(); }, 30000);
    const cancel = () => {
      try { source?.stop(); } catch { /* not started */ }
      rejectEnded?.(new DOMException('Voice playback cancelled', 'AbortError'));
    };
    controller.signal.addEventListener('abort', cancel, { once: true });
    // Native resume/decode promises do not accept AbortSignal. Settle our wait
    // immediately on cancellation; their eventual results have no playback authority.
    const cancellable = promise => new Promise((resolve, reject) => {
      const signal = controller.signal;
      const cancelled = () => reject(new DOMException('Voice playback cancelled', 'AbortError'));
      signal.addEventListener('abort', cancelled, { once: true });
      Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', cancelled));
      if (signal.aborted) cancelled();
    });
    try {
      controller.signal.throwIfAborted();
      await cancellable(unlock()); controller.signal.throwIfAborted();
      const response = await cancellable(fetchAudio('/api/say?text=' + encodeURIComponent(text), { signal: controller.signal, cache: 'no-store' }));
      if (!response.ok) throw new Error('Nibbi’s voice is unavailable. Check the local voice service.');
      controller.signal.throwIfAborted();
      const bytes = await cancellable(response.arrayBuffer());
      controller.signal.throwIfAborted();
      const buffer = await cancellable(context.decodeAudioData(bytes));
      controller.signal.throwIfAborted();
      clearTimer(timeout);
      // Long answers are valid; the watchdog must not cut them off at the loading timeout.
      timeout = setTimer(() => { timedOut = true; controller.abort(); }, (Math.max(1, buffer.duration || 30) + 5) * 1000);
      source = context.createBufferSource(); source.buffer = buffer;
      analyser = context.createAnalyser(); analyser.fftSize = 256;
      source.connect(analyser); analyser.connect(context.destination);
      const data = new Uint8Array(analyser.fftSize);
      await new Promise((resolve, reject) => {
        rejectEnded = reject;
        source.onended = resolve;
        controller.signal.throwIfAborted();
        source.start(); onStart();
        ticker = setTick(() => {
          analyser.getByteTimeDomainData(data);
          let sum = 0; for (const value of data) sum += ((value - 128) / 128) ** 2;
          onLevel(Math.min(1, Math.sqrt(sum / data.length) * 6));
        }, 50);
      });
      controller.signal.throwIfAborted();
    } catch (error) {
      if (timedOut) throw new Error('Nibbi’s voice took too long. Try again.');
      throw error;
    } finally {
      clearTimer(timeout); if (ticker !== undefined) clearTick(ticker);
      controller.signal.removeEventListener('abort', cancel); signal?.removeEventListener('abort', abort);
      if (source) { source.onended = null; try { source.stop(); } catch { /* ended */ } source.disconnect(); }
      analyser?.disconnect();
      if (current === controller) { current = null; onEnd(); }
    }
  }
  return { unlock, play, stop };
}

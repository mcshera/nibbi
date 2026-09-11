/** Local, opt-in voice capture. A short audio delay preserves the wake phrase's first syllable. */
export function createMicCapture({ onUtterance, onSpeechStart = () => {}, onSpeechEnd = () => {}, onLevel = () => {}, onError = () => {}, canCapture = () => true,
  silenceMs = () => 750, getUserMedia = constraints => navigator.mediaDevices.getUserMedia(constraints),
  AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext, Recorder = globalThis.MediaRecorder,
  setTick = setInterval, clearTick = clearInterval, setTimer = setTimeout, clearTimer = clearTimeout,
  now = () => performance.now(), maxUtteranceMs = 25000, recorderStopMs = 3000 } = {}) {
  let generation = 0, stream = null, context = null, source = null, delayed = null, destination = null, analyser = null, timer = null;
  let recording = null, finishing = null, noise = 0.006, active = false;
  const stopTracks = value => value?.getTracks().forEach(track => track.stop());
  function stop() {
    generation++; active = false;
    if (timer !== null) clearTick(timer); timer = null;
    discard(); stopTracks(stream); stopTracks(destination?.stream); stream = null;
    for (const node of [source, delayed, destination, analyser]) { try { node?.disconnect(); } catch { /* detached */ } }
    source = delayed = destination = analyser = null;
    const old = context; context = null;
    if (old) void old.close().catch(() => {});
    finishing = null; onLevel(0);
  }
  function fail(error) { stop(); onError(error); }
  function speechEnded(item) {
    if (!item.announced || item.ended) return;
    item.ended = true; onSpeechEnd();
  }
  function discard() {
    const pending = [recording, finishing]; recording = finishing = null;
    for (const item of pending) {
      if (!item) continue;
      item.keep = false; item.chunks.length = 0;
      clearTimer(item.stopTimer); clearTimer(item.tailTimer); speechEnded(item);
      try { if (item.rec.state !== 'inactive') item.rec.stop(); } catch { /* already stopped */ }
    }
  }
  function finish(keep, flushTail = false) {
    const item = recording; if (!item) return false;
    const mine = generation;
    recording = null; item.keep = keep; finishing = item; speechEnded(item);
    if (finishing !== item) return true;
    const stopRecorder = () => {
      if (mine !== generation || finishing !== item) return;
      // Off/suspension discards immediately, including during the delayed tail.
      if (!canCapture()) { discard(); return; }
      if (mine !== generation || finishing !== item) return;
      // Some native recorders fail to deliver onstop. Never leave the UI stuck listening.
      item.stopTimer = setTimer(() => {
        if (finishing === item) fail(new Error('Microphone did not finish recording. Turn the mic on to retry.'));
      }, recorderStopMs);
      try { item.rec.stop(); } catch (error) { fail(error); }
    };
    // Manual Send can arrive before the 200 ms delay has delivered the last syllable.
    if (keep && flushTail) item.tailTimer = setTimer(stopRecorder, 200);
    else stopRecorder();
    return true;
  }
  async function start() {
    stop(); const mine = generation;
    if (!AudioContextClass || !Recorder) throw new Error('Voice capture is not supported in this browser.');
    // Resume during the user's click, before the permission dialog yields control.
    const localContext = new AudioContextClass(); context = localContext;
    const resumed = localContext.resume(); void resumed.catch(() => {});
    let localStream;
    try {
      localStream = await getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (mine !== generation) { stopTracks(localStream); return false; }
      stream = localStream; await resumed;
      if (mine !== generation) return false;
      source = localContext.createMediaStreamSource(stream);
      analyser = localContext.createAnalyser(); analyser.fftSize = 1024; source.connect(analyser);
      delayed = localContext.createDelay(1); delayed.delayTime.value = 0.2;
      destination = localContext.createMediaStreamDestination(); source.connect(delayed); delayed.connect(destination);
      for (const track of stream.getTracks()) track.addEventListener('ended', () => { if (mine === generation) fail(new Error('Microphone disconnected. Turn the mic on to reconnect.')); }, { once: true });
      const data = new Uint8Array(analyser.fftSize);
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac'].find(type => Recorder.isTypeSupported(type));
      noise = 0.006; active = true;
      const tick = () => {
        if (mine !== generation || !active) return;
        try {
          if (localContext.state !== 'running') { fail(new Error('Microphone paused by the system. Turn the mic on again.')); return; }
          if (!canCapture()) { discard(); onLevel(0); return; }
          if (finishing) return;
          analyser.getByteTimeDomainData(data);
          let sum = 0; for (const value of data) sum += ((value - 128) / 128) ** 2;
          const rms = Math.sqrt(sum / data.length), at = now();
          onLevel(Math.min(1, rms * 8));
          const threshold = Math.max(0.018, Math.min(0.085, noise * 2.8));
          // A sound too quiet to start speech must not hold an existing utterance open.
          // Lowering this cutoff after onset made ordinary mic hiss count as endless speech.
          const speech = rms > threshold;
          if (!recording && !speech) { noise = noise * 0.97 + rms * 0.03; return; }
          if (!recording) {
            const rec = mime ? new Recorder(destination.stream, { mimeType: mime }) : new Recorder(destination.stream);
            const item = { rec, chunks: [], at, lastSpeech: at, voicedMs: 0, lastTick: at, keep: true };
            recording = item;
            rec.ondataavailable = event => { if (event.data.size && item.keep && mine === generation) item.chunks.push(event.data); };
            rec.onerror = () => { if (mine === generation && item.keep) fail(new Error('Microphone recording failed. Turn the mic on to retry.')); };
            rec.onstop = () => {
              clearTimer(item.stopTimer);
              if (mine !== generation) return;
              if (finishing === item) finishing = null;
              if (!item.keep || !canCapture()) return;
              const blob = new Blob(item.chunks, { type: rec.mimeType || mime || 'audio/webm' });
              item.chunks.length = 0;
              if (!blob.size) { fail(new Error('No audio was recorded. Turn the mic on to retry.')); return; }
              Promise.resolve(onUtterance(blob)).catch(error => { if (mine === generation) fail(error); });
            };
            rec.start(250);
          }
          const item = recording;
          if (speech) { item.lastSpeech = at; item.voicedMs += Math.min(100, at - item.lastTick); }
          item.lastTick = at;
          if (item.voicedMs >= 140 && !item.announced) { item.announced = true; onSpeechStart(); }
          if (at - item.lastSpeech >= silenceMs() || at - item.at >= maxUtteranceMs) finish(item.voicedMs >= 140);
        } catch (error) { fail(error); }
      };
      timer = setTick(tick, 50);
      return true;
    } catch (error) {
      stopTracks(localStream);
      if (mine !== generation) return false;
      stop(); throw error;
    }
  }
  return { start, stop, finishUtterance: () => recording ? finish(recording.voicedMs >= 140, true) : false,
    snapshot: () => ({ active, recording: !!recording, finishing: !!finishing }) };
}

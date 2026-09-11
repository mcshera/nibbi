// Real browser audio graph + MediaRecorder + local Whisper. No physical microphone or real send.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, sep, extname } from 'node:path';
import { chromium } from 'playwright';
import { testBackend } from './test-backend.mjs';
const out = new URL('../output/voice-toggle/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const result = { started: new Date().toISOString(), safety: 'Only synthetic audio. Real WebAudio and MediaRecorder. Local Whisper direct. Chat mocked.', recordings: [], sends: [], spoken: [], errors: [], loadedAssets: [] };
const fixture = await testBackend(); let browser;
function syntheticMicrophone() {
  const probe = window.audioProbe = { input: null, destination: null, events: [] };
  const nativeStart = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function(...args) {
    const kind = this.context === probe.input ? 'synthetic-input' : 'output';
    probe.events.push({ kind, event: 'start', at: performance.now() });
    this.addEventListener('ended', () => probe.events.push({ kind, event: 'ended', at: performance.now() }), { once: true });
    return nativeStart.apply(this, args);
  };
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
    probe.input = new AudioContext(); await probe.input.resume();
    probe.destination = probe.input.createMediaStreamDestination();
    return probe.destination.stream;
  } });
  probe.inject = async (url) => {
    const bytes = await (await fetch(url)).arrayBuffer();
    const buffer = await probe.input.decodeAudioData(bytes);
    const source = probe.input.createBufferSource(); source.buffer = buffer; source.connect(probe.destination);
    source.start(); return { duration: buffer.duration, at: performance.now() };
  };
}
try {
  browser = await chromium.launch({ channel: 'chrome', args: ['--mute-audio'] });
  const context = await browser.newContext(); await context.addInitScript(syntheticMicrophone);
  const root = resolve(process.env.NIBBI_VOICE_UI_DIR || out + 'ui-candidate');
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== fixture.base || url.pathname.startsWith('/api/') || url.pathname.startsWith('/nibbi/')) return route.continue();
    if (url.pathname.startsWith('/audio-probe-')) return route.fulfill({ path: out + url.pathname.slice(1), contentType: 'audio/wav' });
    const path = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
    if (!path.startsWith(root + sep) || !existsSync(path)) return route.fulfill({ status: 404, body: 'Not found' });
    const contentType = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.png': 'image/png' }[extname(path)];
    const body = readFileSync(path);
    if (extname(path) === '.js' || extname(path) === '.html') result.loadedAssets.push({ path, sha256: createHash('sha256').update(body).digest('hex'), at: Date.now() });
    return route.fulfill({ body, ...(contentType ? { contentType } : {}) });
  });
  const page = await context.newPage(); page.on('pageerror', e => result.errors.push(e.message));
  await page.route('**/api/send', route => {
    result.sends.push({ text: route.request().postDataJSON().message, at: Date.now() });
    return route.fulfill({ contentType: 'text/event-stream', body: 'data: {"ev":"done","text":"Fixture received.","isError":false}\n\n' });
  });
  await page.route('**/api/transcribe', async route => {
    const bytes = route.request().postDataBuffer();
    const item = { bytes: bytes.length, type: route.request().headers()['content-type'], at: Date.now() };
    result.recordings.push(item);
    writeFileSync(out + `audio-probe-recording-${result.recordings.length}.webm`, bytes);
    try {
      const response = await fetch('http://127.0.0.1:4522/stt?fast=1', { method: 'POST', headers: { 'content-type': item.type }, body: bytes, signal: AbortSignal.timeout(60000) });
      const raw = await response.text(); item.status = response.status; item.response = raw; item.sttMs = Date.now() - item.at;
      assert.ok(response.ok, raw);
      let parsed; try { parsed = JSON.parse(raw); } catch { parsed = { text: raw }; }
      const heard = parsed.heard ?? parsed.text ?? parsed.transcript ?? '';
      item.heard = heard; console.log('STT', JSON.stringify(item));
      await route.fulfill({ json: { heard } });
    } catch (error) { item.error = String(error); await route.fulfill({ status: 500, json: { error: String(error) } }).catch(() => {}); }
  });
  await page.route('**/api/say?**', route => {
    result.spoken.push({ text: new URL(route.request().url()).searchParams.get('text'), at: Date.now() });
    return route.fulfill({ contentType: 'audio/ogg', body: readFileSync(out + 'tts-synthetic.ogg') });
  });
  const phase = expected => page.waitForFunction(expected => window.nibbiApp?.voice?.snapshot().phase === expected, expected, { timeout: 70000 });
  await page.goto(fixture.base + '/?nosw=1');
  await page.waitForFunction(() => window.nibbiApp?.voice && document.body.dataset.link === 'live');
  // Hey Nibbi is a row inside the Ink dock's panel: open the "+" before pressing it (same route as voice-verify.mjs and project-workflow-verify.mjs)
  const openDock = async () => { if (await page.locator('#dock').getAttribute('aria-expanded') !== 'true') { await page.locator('#dock').click(); await page.waitForFunction(() => document.querySelector('#dock').getAttribute('aria-expanded') === 'true'); } };
  await openDock(); await page.locator('#mic').click(); await phase('armed');
  result.ambientStartedAt = Date.now();
  await page.evaluate(() => window.audioProbe.inject('/audio-probe-ambient.wav'));
  await page.waitForResponse(r => r.url().endsWith('/api/transcribe'), { timeout: 70000 });
  await phase('armed');
  assert.equal(result.sends.length, 0); assert.equal(result.spoken.length, 0);
  result.ambientIgnored = true;
  result.wakeStartedAt = Date.now();
  result.wakeInput = await page.evaluate(() => window.audioProbe.inject('/audio-probe-wake.wav'));
  await phase('listening'); result.listeningAt = Date.now();
  assert.deepEqual(result.spoken.map(s => s.text), ["What's up, Matty?"]);
  assert.equal(result.sends.length, 0);
  result.eventsAfterWake = await page.evaluate(() => window.audioProbe.events);
  assert.ok(result.eventsAfterWake.some(e => e.kind === 'output' && e.event === 'ended'));
  result.followupStartedAt = Date.now();
  result.followupInput = await page.evaluate(() => window.audioProbe.inject('/audio-probe-command.wav'));
  await page.waitForResponse(r => r.url().endsWith('/api/send'), { timeout: 70000 });
  await phase('armed'); result.rearmedAt = Date.now();
  assert.equal(result.sends.length, 1); assert.match(result.sends[0].text, /tell me a short story/i);
  assert.equal(result.recordings.length, 3); assert.deepEqual(result.errors, []);
  result.wakeToListeningMs = result.listeningAt - result.wakeStartedAt;
  result.followupToSendMs = result.sends[0].at - result.followupStartedAt;
  result.greetingSource = 'Cached actual local Kokoro OGG, synthesis latency excluded; original standalone probe ~5.35s.';
  result.events = await page.evaluate(() => window.audioProbe.events);
  await openDock(); await page.locator('#mic').click(); await phase('off');
  result.tracksEnded = await page.evaluate(() => window.audioProbe.destination.stream.getTracks().every(t => t.readyState === 'ended'));
  assert.ok(result.tracksEnded); result.passed = true;
  await page.screenshot({ path: out + 'audio-probe-complete.png' });
} catch (error) { result.passed = false; result.error = error.stack; console.error(error); process.exitCode = 1; }
finally {
  writeFileSync(out + 'audio-probe-results.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser?.close(); await fixture.close();
}

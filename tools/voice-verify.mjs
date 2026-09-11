// Isolated browser acceptance: never uses the owner's backend, history, mic, or provider.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, sep, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { testBackend } from './test-backend.mjs';
const out = resolve(process.env.NIBBI_VOICE_OUTPUT_DIR || new URL('../output/voice-toggle/', import.meta.url).pathname) + '/';
mkdirSync(out, { recursive: true });
const candidateRoot = resolve(process.env.NIBBI_VOICE_UI_DIR || new URL('../dist/ui/', import.meta.url).pathname);
function candidateHashes(root, prefix = '') { return Object.fromEntries(readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => entry.isDirectory() ? Object.entries(candidateHashes(resolve(root, entry.name), prefix + entry.name + '/')) : [[prefix + entry.name, createHash('sha256').update(readFileSync(resolve(root, entry.name))).digest('hex')]])); }
const hashes = candidateHashes(candidateRoot);
writeFileSync(out + 'browser-build-hashes.json', JSON.stringify({ candidateRoot, checkedAt: new Date().toISOString(), files: hashes }, null, 2));
const fixture = await testBackend();
const results = []; let browser;
const wav = Buffer.alloc(44 + 16000 * 2 * 0.25);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
function fakeMicrophone() {
  const fake = window.voiceFake = { level: 0, tracks: [], recorders: [], played: [], ended: [], mode: 'ok', requests: 0 };
  const NativeAudioContext = window.AudioContext;
  class CaptureContext extends NativeAudioContext {
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createAnalyser() { const node = super.createAnalyser(); node.getByteTimeDomainData = a => { for (let i = 0; i < a.length; i++) a[i] = 128 + (i % 2 ? 1 : -1) * fake.level; }; return node; }
    createBufferSource() { const node = super.createBufferSource(); const start = node.start.bind(node); node.start = (...args) => { fake.played.push('AudioBufferSource'); return start(...args); }; node.addEventListener('ended', () => fake.ended.push('AudioBufferSource')); return node; }
  }
  window.AudioContext = CaptureContext; window.webkitAudioContext = CaptureContext;
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
    fake.requests++;
    if (fake.mode === 'denied') throw new DOMException('Fixture denied', 'NotAllowedError');
    if (fake.mode === 'unavailable') throw new DOMException('Fixture no microphone', 'NotFoundError');
    if (fake.mode === 'pending') await new Promise(resolve => { fake.resolvePermission = resolve; });
    const track = { readyState: 'live', stop() { this.readyState = 'ended'; }, addEventListener() {}, removeEventListener() {} };
    fake.tracks.push(track);
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  } });
  class Recorder extends EventTarget {
    static isTypeSupported() { return true; }
    constructor(stream, options = {}) { super(); this.stream = stream; this.state = 'inactive'; this.mimeType = options.mimeType || 'audio/webm'; fake.recorders.push(this); }
    start() { this.state = 'recording'; }
    requestData() { const event = new Event('dataavailable'); Object.defineProperty(event, 'data', { value: new Blob([new Uint8Array(8192)], { type: this.mimeType }) }); this.dispatchEvent(event); this.ondataavailable?.(event); }
    stop() { if (this.state === 'inactive') return; this.state = 'inactive'; queueMicrotask(() => { this.requestData(); const event = new Event('stop'); this.dispatchEvent(event); this.onstop?.(event); }); }
  }
  window.MediaRecorder = Recorder;
  // Observe native media events. Playback itself is not stubbed.
  const nativePlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function(...args) {
    this.addEventListener('playing', () => fake.played.push(this.currentSrc || this.src), { once: true });
    this.addEventListener('ended', () => fake.ended.push(this.currentSrc || this.src), { once: true });
    return nativePlay.apply(this, args);
  };
}
const phase = (page, expected) => page.waitForFunction(expected => window.nibbiApp?.voice?.snapshot().phase === expected, expected, { timeout: 12000 });
async function geometry(page) {
  const g = await page.evaluate(() => { const r = document.querySelector('#mic').getBoundingClientRect(); return { overflow: document.documentElement.scrollWidth > innerWidth, visible: r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, clickable: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('#mic') !== null }; });
  assert.deepEqual(g, { overflow: false, visible: true, clickable: true });
}
try {
  browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' });
  for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport }); await context.addInitScript(fakeMicrophone);
    if (process.env.NIBBI_VOICE_UI_DIR) {
      const root = resolve(process.env.NIBBI_VOICE_UI_DIR);
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== fixture.base || url.pathname.startsWith('/api/') || url.pathname.startsWith('/nibbi/')) return route.continue();
        const path = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
        if (!path.startsWith(root + sep) || !existsSync(path)) return route.fulfill({ status: 404, body: 'Candidate file not found' });
        const contentType = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.png': 'image/png' }[extname(path)];
        return route.fulfill({ path, ...(contentType ? { contentType } : {}) });
      });
    }
    const page = await context.newPage(); const errors = []; const sent = []; const spoken = []; const transcripts = []; let sttCount = 0; let sttHold = null; let sayHold = null;
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/send', route => { sent.push(route.request().postDataJSON().message); return route.fulfill({ contentType: 'text/event-stream', body: 'data: {"ev":"done","text":"Fixture received.","isError":false}\n\n' }); });
    await page.route('**/api/transcribe', async route => { sttCount++; const text = transcripts.shift(); assert.notEqual(text, undefined, 'Unexpected transcription'); const hold = sttHold; sttHold = null; if (hold) await hold; await route.fulfill({ json: { heard: text } }).catch(() => {}); });
    await page.route('**/api/say?**', async route => { spoken.push(new URL(route.request().url()).searchParams.get('text')); const hold = sayHold; sayHold = null; if (hold) await hold; await route.fulfill({ contentType: 'audio/wav', body: wav }).catch(() => {}); });
    async function utter(text) {
      transcripts.push(text); const before = sttCount;
      await page.evaluate(() => { window.voiceFake.level = 28; });
      await page.waitForFunction(() => window.voiceFake.recorders.some(r => r.state === 'recording'));
      await page.waitForTimeout(550);
      // Residual room noise: nonzero samples must not keep an utterance alive.
      const quietAt = await page.evaluate(() => { window.voiceFake.level = 2; return performance.now(); });
      await page.waitForFunction(() => !window.voiceFake.recorders.some(r => r.state === 'recording'), null, { timeout: 1800 });
      const endpointMs = await page.evaluate(at => performance.now() - at, quietAt);
      assert.ok(endpointMs < 1800, 'Speech ends promptly over a nonzero noise floor');
      // Request observation is outside the page; let route callbacks run before checking count.
      await page.waitForTimeout(100); assert.equal(sttCount, before + 1);
    }
    await page.goto(fixture.base + '/?nosw=1');
    await page.waitForFunction(() => window.nibbiApp?.voice && document.body.dataset.link === 'live');
    const micStates = async enabled => {
      for (const selector of ['#mic', '#st-microphone']) assert.equal(await page.locator(selector).getAttribute('aria-pressed'), String(enabled), selector + ' shares wake state');
    };
    const settings = async () => {
      if (await page.locator('#sidebar-toggle').isVisible()) await page.locator('#sidebar-toggle').click();
      if (await page.locator('#status').getAttribute('aria-expanded') !== 'true') await page.locator('#status').click();
    };
    const closeSettings = async () => {
      if (await page.locator('#status').getAttribute('aria-expanded') === 'true') await page.keyboard.press('Escape');
      if (name === 'mobile' && await page.locator('#workspace-sidebar').getAttribute('aria-hidden') === 'false') await page.keyboard.press('Escape');
    };
    const railMic = async () => {
      if (name === 'desktop') await page.locator('#mic').click();
      else { await settings(); await page.locator('#st-microphone').click(); }
    };
    await micStates(false);
    // The speaker/reply preference must never be mistaken for microphone input.
    await settings(); await page.locator('#st-voice').click(); await page.locator('#st-voice').click(); await closeSettings();
    assert.equal(await page.evaluate(() => window.voiceFake.requests), 0, 'Spoken replies does not request the microphone');
    await micStates(false);
    // A permission dialog must not disable the user's on/off switch.
    await page.evaluate(() => { window.voiceFake.mode = 'pending'; });
    await railMic(); await phase(page, 'starting'); await micStates(true);
    await railMic(); await phase(page, 'off'); await micStates(false);
    await page.evaluate(() => { window.voiceFake.resolvePermission(); window.voiceFake.mode = 'ok'; });
    await page.waitForFunction(() => window.voiceFake.tracks.every(track => track.readyState === 'ended'));
    await railMic(); await phase(page, 'armed'); await micStates(true);
    assert.equal(await page.locator('#st-voice').getAttribute('aria-pressed'), 'false', 'Arming Hey Nibbi does not change reply preference');
    assert.match(await page.locator('#listen').innerText(), /Waiting for [“"']?Hey Nibbi/i);
    await geometry(page); await page.screenshot({ path: out + name + '-armed.png' });
    await utter('A television is talking in the background'); await phase(page, 'armed'); assert.deepEqual(sent, []); assert.deepEqual(spoken, []);
    await utter('Hey Nibbi'); await phase(page, 'listening');
    assert.deepEqual(spoken, ["What's up, Matty?"]); assert.deepEqual(sent, []);
    assert.ok(await page.evaluate(() => window.voiceFake.played.length >= 1), 'Native audio playback started');
    assert.ok(await page.evaluate(() => window.voiceFake.ended.length >= 1), 'Follow-up starts after native audio ended');
    await geometry(page); await page.screenshot({ path: out + name + '-followup.png' });
    await utter('Tell me a short story'); await phase(page, 'armed'); assert.deepEqual(sent, ['Tell me a short story']);
    await utter('Hey Nibbi, tell me another story'); await phase(page, 'armed'); assert.deepEqual(sent, ['Tell me a short story', 'tell me another story']);
    // Cancel a pending STT response, then release it: no late turn may escape.
    let releaseSTT; sttHold = new Promise(resolve => { releaseSTT = resolve; });
    await utter('Hey Nibbi, this must never send'); await phase(page, 'transcribing');
    assert.match(await page.locator('#listen').innerText(), /Processing speech.*mic paused/, 'Processing is not presented as continued listening');
    await page.locator('#mic').click(); await phase(page, 'off'); await micStates(false); releaseSTT(); await page.waitForTimeout(300);
    assert.equal(sent.length, 2); assert.equal(await page.evaluate(() => window.voiceFake.tracks.filter(t => t.readyState !== 'ended').length), 0);
    await page.locator('#mic').click(); await phase(page, 'armed');
    let releaseSay; sayHold = new Promise(resolve => { releaseSay = resolve; });
    await utter('Hey Nibbi, also must never send'); await phase(page, 'greeting');
    await page.locator('#mic').click(); await phase(page, 'off'); releaseSay(); await page.waitForTimeout(300); assert.equal(sent.length, 2);
    await page.locator('#mic').click(); await phase(page, 'armed');
    await page.locator('#ask').fill('Keep this typed draft'); await phase(page, 'paused');
    const beforeDraft = sttCount; await page.evaluate(() => { window.voiceFake.level = 28; }); await page.waitForTimeout(400);
    await page.evaluate(() => { window.voiceFake.level = 0; });
    assert.equal(sttCount, beforeDraft); assert.equal(await page.locator('#ask').inputValue(), 'Keep this typed draft'); assert.equal(sent.length, 2);
    await page.locator('#ask').fill(''); await phase(page, 'armed');
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide'))); await phase(page, 'off');
    assert.equal(await page.evaluate(() => window.voiceFake.tracks.filter(t => t.readyState !== 'ended').length), 0);
    await page.locator('#mic').click(); await phase(page, 'armed');
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); delete document.hidden; }); await phase(page, 'off');
    assert.equal(await page.evaluate(() => window.voiceFake.tracks.filter(t => t.readyState !== 'ended').length), 0);
    await page.keyboard.down('Alt'); await page.keyboard.down('Space'); await phase(page, 'armed'); await page.waitForTimeout(450); await page.keyboard.up('Space'); await page.keyboard.up('Alt'); await phase(page, 'armed');
    await page.keyboard.press('Alt+Space'); await phase(page, 'off');
    assert.equal(await page.evaluate(() => window.voiceFake.tracks.filter(t => t.readyState !== 'ended').length), 0);
    await page.locator('#mic').click(); await phase(page, 'armed'); await page.reload(); await phase(page, 'off');
    assert.equal(await page.locator('#mic').getAttribute('aria-pressed'), 'false');
    for (const mode of ['denied', 'unavailable']) {
      await page.evaluate(mode => { window.voiceFake.mode = mode; }, mode);
      await page.locator('#mic').click(); await phase(page, 'off');
      assert.equal(await page.locator('#mic').getAttribute('aria-pressed'), 'false'); await geometry(page);
    }
    // Manual finish remains available if a noisy room prevents a clean pause.
    await page.evaluate(() => { window.voiceFake.mode = 'ok'; window.voiceFake.level = 2; });
    await railMic(); await phase(page, 'armed');
    await utter('Hey Nibbi'); await phase(page, 'listening');
    transcripts.push('This voice message was finished with Send');
    await page.evaluate(() => { window.voiceFake.level = 28; });
    await page.getByRole('button', { name: 'Finish voice message', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Finish voice message', exact: true }).click();
    await page.evaluate(() => { window.voiceFake.level = 2; });
    await phase(page, 'armed');
    assert.deepEqual(sent, ['Tell me a short story', 'tell me another story', 'This voice message was finished with Send']);
    assert.match(await page.locator('#listen').innerText(), /Waiting for.*Hey Nibbi/);
    await page.locator('#mic').click(); await phase(page, 'off'); await micStates(false);
    assert.equal(await page.evaluate(() => window.voiceFake.tracks.filter(t => t.readyState !== 'ended').length), 0);
    assert.deepEqual(errors, []); results.push({ name, passed: true, sent, spoken, sttCount, checks: ['default off', 'sidebar settings/composer share mic toggle', 'speaker preference does not enable mic', 'pending permission can toggle off', 'nonzero noise floor ends speech promptly', 'Send can finish a voice message', 'processing label distinguishes mic pause', 'ambient filtered', 'native greeting playback', 'followup once', 'inline stripped', 'rearm', 'cancel STT', 'cancel greeting', 'tracks stopped', 'Alt+Space toggle', 'reload off', 'typed draft preserved', 'pagehide off', 'hidden event off', 'denied/unavailable', 'visible clickable no overflow'] });
    await context.close();
  }
  assert.deepEqual(candidateHashes(candidateRoot), hashes, 'Candidate did not change during acceptance');
  console.log(JSON.stringify(results, null, 2));
} catch (error) { results.push({ passed: false, error: error.stack }); throw error; }
finally { writeFileSync(out + 'results.json', JSON.stringify(results, null, 2)); await browser?.close(); await fixture.close(); }

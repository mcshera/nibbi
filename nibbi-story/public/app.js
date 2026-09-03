(function () {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const body = document.body;
  const prompt = $('#prompt');
  const composer = $('#composer');
  const result = $('#result');
  const answer = $('#answer');
  const requestLine = $('#requestLine');
  const sendButton = $('#sendButton');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const query = new URLSearchParams(location.search);

  const state = {
    busy: false,
    demo: query.get('demo') === '1',
    online: false,
    abort: null,
    lastRequest: ''
  };

  const look = query.get('look') || 'soft';
  body.dataset.look = look;
  const nibbi = createNibbi({ ink: $('#ink'), fx: $('#fx'), look });
  window.nibbi = nibbi;
  nibbi.setReducedMotion(reducedMotion.matches);
  reducedMotion.addEventListener('change', (event) => nibbi.setReducedMotion(event.matches));

  function placeNibbi(snap = false) {
    const anchor = $('#nibbiAnchor').getBoundingClientRect();
    const mobile = innerWidth < 560;
    const madeSomething = body.dataset.state === 'answer';
    const target = madeSomething
      ? { x: innerWidth / 2, y: innerHeight * (mobile ? .10 : .105), r: mobile ? 40 : 54 }
      : { x: anchor.left, y: anchor.top, r: mobile ? 82 : 116 };
    if (snap) nibbi.snapTarget(target);
    else nibbi.setTarget(target);
  }

  placeNibbi(true);
  addEventListener('resize', () => placeNibbi());
  addEventListener('pointermove', (event) => nibbi.pointer(event.clientX, event.clientY), { passive: true });

  function autosize() {
    prompt.style.height = 'auto';
    prompt.style.height = Math.min(108, Math.max(32, prompt.scrollHeight)) + 'px';
  }
  prompt.addEventListener('input', autosize);
  prompt.addEventListener('focus', () => {
    if (state.busy) return;
    nibbi.setMood('listening');
    const box = composer.getBoundingClientRect();
    nibbi.lookAt(box.left + box.width * .62, box.top);
  });
  prompt.addEventListener('blur', () => {
    if (state.busy) return;
    nibbi.setMood('idle');
    nibbi.lookFree();
  });
  prompt.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      composer.requestSubmit();
    }
  });

  async function checkConnection() {
    if (state.demo) return;
    try {
      const response = await fetch('/nibbi/health', { cache: 'no-store' });
      const health = await response.json();
      state.online = !!health.brain;
    } catch {
      state.online = false;
    }
  }
  checkConnection();

  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  function safeMarkdown(text) {
    const escaped = String(text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    try {
      const template = document.createElement('template');
      template.innerHTML = marked.parse(escaped, { gfm: true, breaks: true });
      for (const element of template.content.querySelectorAll('script,style,iframe,object,embed,link,meta')) element.remove();
      for (const element of template.content.querySelectorAll('*')) {
        for (const attribute of [...element.attributes]) {
          if (/^on/i.test(attribute.name) || (/^(href|src)$/i.test(attribute.name) && /^\s*javascript:/i.test(attribute.value))) {
            element.removeAttribute(attribute.name);
          }
        }
      }
      return template.content;
    } catch {
      return document.createTextNode(text);
    }
  }

  async function* streamFromAgent(message, signal) {
    const response = await fetch('/api/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, stream: true }),
      signal
    });
    if (!response.ok) throw new Error('The agent could not answer');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const packet = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        let event = 'message';
        let data = '';
        for (const line of packet.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (!data) continue;
        try { yield { event, ...JSON.parse(data) }; } catch { /* ignore malformed progress packets */ }
      }
    }
  }

  function demoReply(message) {
    const lower = message.toLowerCase();
    if (/broken|repair|fix|bug/.test(lower)) {
      return 'I made the problem smaller and gave it a first move.\n\n**The repair path**\n\n1. Recreate the smallest broken moment.\n2. Capture what should have happened.\n3. Trace the first place reality diverges.\n\nBring me that moment and I can turn it into the fix.';
    }
    if (/world|game|playable/.test(lower)) {
      return 'I made the first edge of the world.\n\n**A playable seed**\n\n- One small place with a secret\n- One action that changes it\n- One reason to return\n\nThat is enough to build the opening scene. Tell me what the player discovers there and I’ll make the next piece.';
    }
    return 'I gave the idea a shape without sanding off the strange part.\n\n**The first version**\n\n- Keep the impossible sentence.\n- Choose the detail that pulls you back.\n- Build only enough to make that detail feel true.\n\nThere is something here now. Ask me to make the first piece.';
  }

  async function runDemo(message, signal) {
    nibbi.setMood('thinking');
    await wait(650);
    if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
    nibbi.setMood('working');
    nibbi.spatter(1, .8);
    await wait(850);
    if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
    nibbi.drip();
    await wait(700);
    if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
    return demoReply(message);
  }

  async function runAgent(message, signal) {
    let collected = '';
    for await (const packet of streamFromAgent(message, signal)) {
      if (packet.event === 'tool') {
        nibbi.setMood('working');
        nibbi.spatter(1, .8);
      } else if (packet.event === 'delta' && packet.t) {
        collected += packet.t;
        nibbi.setMood('speaking');
        nibbi.pulse(.38);
      } else if (packet.event === 'done' && packet.text) {
        collected = packet.text;
      }
    }
    return collected || 'I finished, but the result came back empty. Ask me to try that path once more.';
  }

  function reveal(request, reply) {
    requestLine.textContent = request;
    answer.replaceChildren(safeMarkdown(reply));
    result.hidden = false;
    result.scrollTop = 0;
    body.dataset.state = 'answer';
    placeNibbi();
    prompt.placeholder = 'Ask for the next change…';
    sendButton.setAttribute('aria-label', 'Send');
    nibbi.lookFree();
    nibbi.setMood('happy');
    setTimeout(() => { if (!state.busy) nibbi.setMood('idle'); }, 1400);
  }

  async function send(message) {
    state.busy = true;
    state.lastRequest = message;
    state.abort = new AbortController();
    body.classList.add('busy');
    body.dataset.state = result.hidden ? 'working' : 'answer';
    sendButton.setAttribute('aria-label', 'Stop');
    prompt.value = '';
    autosize();
    nibbi.lookFree();
    nibbi.setMood('thinking');

    let reply;
    try {
      reply = state.online && !state.demo
        ? await runAgent(message, state.abort.signal)
        : await runDemo(message, state.abort.signal);
    } catch (error) {
      if (error.name === 'AbortError') reply = 'I stopped there. Nothing new was added.';
      else {
        state.online = false;
        reply = await runDemo(message, new AbortController().signal);
      }
    }

    state.busy = false;
    state.abort = null;
    body.classList.remove('busy');
    reveal(message, reply);
  }

  composer.addEventListener('submit', (event) => {
    event.preventDefault();
    if (state.busy) {
      state.abort?.abort();
      return;
    }
    const message = prompt.value.trim();
    if (!message) {
      prompt.focus();
      nibbi.shake();
      return;
    }
    send(message);
  });

  function reset() {
    if (state.busy) state.abort?.abort();
    state.busy = false;
    state.abort = null;
    body.classList.remove('busy');
    body.dataset.state = 'idle';
    result.hidden = true;
    prompt.value = '';
    prompt.placeholder = 'Ask Nibbi to make something…';
    autosize();
    placeNibbi();
    nibbi.setMood('happy');
    setTimeout(() => nibbi.setMood('idle'), 1000);
  }
  $('#resetButton').addEventListener('click', reset);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.activeElement === prompt) prompt.blur();
    if (event.key.length === 1 && !/\s/.test(event.key) && document.activeElement === body) prompt.focus();
  });

  if (location.protocol.startsWith('http')) {
    try {
      const reload = new EventSource('/nibbi/livereload');
      reload.onmessage = () => location.reload();
    } catch { /* live reload is optional */ }
  }

  window.nibbiStory = { state: () => state, send, reset };
})();

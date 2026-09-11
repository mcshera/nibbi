// Direct Pocket input. This module never changes app mood, layout, or conversation state.
export function installPocketInteractions({ nibbi, canvas, getContext = () => ({ busy: false, mode: 'idle', mood: 'idle' }), onInteract = () => {} }) {
  const doc = canvas.ownerDocument;
  const win = doc.defaultView;
  const now = () => win.performance.now();
  const timers = new Set();
  const listeners = [];
  const cooldowns = new Map();
  const history = [];
  let actionSequence = 0;
  const saved = new Map(['tabindex', 'role', 'aria-label', 'aria-keyshortcuts', 'aria-hidden'].map(key => [key, canvas.getAttribute(key)]));
  const oldTouchAction = canvas.style.touchAction, oldOutline = canvas.style.outline;
  const focusRing = doc.createElement('div');
  focusRing.setAttribute('aria-hidden', 'true');
  focusRing.hidden = true;
  Object.assign(focusRing.style, { position: 'fixed', pointerEvents: 'none', zIndex: '3', border: '2px solid currentColor', borderRadius: '45%', opacity: '.5', boxSizing: 'border-box' });
  doc.body.append(focusRing);
  let focusFrame = 0, pointerFocus = false;
  function hideFocus() { focusRing.hidden = true; if (focusFrame) win.cancelAnimationFrame(focusFrame); focusFrame = 0; }
  function drawFocus() {
    focusFrame = 0;
    if (destroyed || doc.hidden || pointerFocus || doc.activeElement !== canvas || !keyboardFocused()) { hideFocus(); return; }
    const s = nibbi.state?.() || {}, b = s.geometry?.bodyBounds || s.bounds;
    const r = s.r || 40;
    const box = b || { left: s.x - r, right: s.x + r, top: s.y - r, bottom: s.y + r };
    focusRing.hidden = false;
    Object.assign(focusRing.style, { left: `${box.left - 8}px`, top: `${box.top - 8}px`, width: `${box.right - box.left + 16}px`, height: `${box.bottom - box.top + 16}px` });
    focusFrame = win.requestAnimationFrame(drawFocus);
  }
  // Pointer focus never earns the ring, and a window losing then regaining OS focus re-fires focus on the same canvas.
  function keyboardFocused() { try { return canvas.matches(':focus-visible'); } catch { return true; } }
  function showFocus() { if (!focusFrame) drawFocus(); }
  let reduced = false, destroyed = false, press = null, combo = 0, lastTap = -Infinity;
  let lastEvent = null, lastAction = null, lastDirect = -Infinity, successIndex = 0, milestoneIndex = 0;
  let hoverInside = false, stroke = null, hoverIndex = 0;
  const context = () => getContext() || {};
  const blocked = () => destroyed || reduced || doc.hidden;
  function listen(target, type, fn, options) {
    target.addEventListener(type, fn, options);
    listeners.push(() => target.removeEventListener(type, fn, options));
  }
  function later(fn, delay) {
    const timer = win.setTimeout(() => { timers.delete(timer); if (!blocked()) fn(); }, delay);
    timers.add(timer);
  }
  function clearTimers() { for (const timer of timers) win.clearTimeout(timer); timers.clear(); }
  function resetCombo() { combo = 0; lastTap = -Infinity; }
  function detachPress() {
    const previous = press;
    press = null;
    clearTimers();
    if (previous?.pointerId != null) {
      try { if (canvas.hasPointerCapture(previous.pointerId)) canvas.releasePointerCapture(previous.pointerId); } catch { /* capture may already be lost */ }
    }
    return previous;
  }
  function settle() {
    // A rejected direct gesture must never cancel the app's higher-priority error reaction.
    if (nibbi.state?.().motion?.action !== 'oops') nibbi.stopAnimation?.();
  }
  function cancel() {
    const wasHolding = !!press;
    detachPress(); resetCombo(); stroke = null; hoverInside = false;
    if (wasHolding) settle();
  }
  function play(action, { key = action, cooldown = 100, priority = 80, energy = 1, direct = false } = {}) {
    if (blocked() || typeof nibbi.animate !== 'function') return false;
    if (direct && context().busy) { action = 'nod'; key = 'busy'; cooldown = 900; energy = .25; priority = 80; }
    const time = now();
    if (time - (cooldowns.get(key) ?? -Infinity) < cooldown) return false;
    // Always interrupt: the renderer must not queue a deferred gesture after cancellation.
    const accepted = !!nibbi.animate(action, { priority, energy, interrupt: true });
    if (accepted) {
      cooldowns.set(key, time); lastAction = action; actionSequence++;
      history.push({ action, at: time, sequence: actionSequence });
      if (history.length > 32) history.shift();
    }
    return accepted;
  }
  function hit(x, y) { return Number.isFinite(x) && Number.isFinite(y) && !!nibbi.hitTest?.(x, y); }
  function position(x, y) {
    const state = nibbi.state?.() || {};
    const r = Math.max(4, Number(state.r) || 40);
    // Deformed body bounds determine tap regions. Renderer hitTest remains the authority on membership.
    const box = state.geometry?.bodyBounds;
    if (box && box.right > box.left && box.bottom > box.top) {
      return { x: (x - (box.left + box.right) / 2) / ((box.right - box.left) / 2), y: (y - (box.top + box.bottom) / 2) / ((box.bottom - box.top) / 2), r };
    }
    return { x: (x - (state.x || 0)) / r, y: (y - (state.y || 0)) / r, r };
  }
  function tap(region = { x: 0, y: 0 }) {
    lastDirect = now();
    if (context().busy) { resetCombo(); return play('nod', { direct: true }); }
    let action;
    if (region.y < -.48) action = 'puff';
    else if (region.y > .48) action = 'squish';
    else if (region.x < -.48) action = 'peek';
    else if (region.x > .48) action = 'curious';
    if (action) { resetCombo(); return play(action, { direct: true }); }
    combo = now() - lastTap <= 550 ? Math.min(3, combo + 1) : 1;
    lastTap = now();
    return play(['hop', 'double-hop', 'triple-hop'][combo - 1], { direct: true });
  }
  function begin(data) {
    press = { ...data, wakeOnly: context().mood === 'sleep' || context().mode === 'sleep', started: now(), gesture: null, long: false, preview: false, moved: false, lastY: data.y, lastMove: now(), velocityY: 0 };
    lastDirect = now(); stroke = null;
    onInteract();
    if (press.wakeOnly) { resetCombo(); return; }
    if (context().busy) { press.busy = true; play('nod', { direct: true }); return; }
    later(() => {
      if (!press || press.moved) return;
      if (context().busy) { cancel(); play('nod', { direct: true }); return; }
      // Do not replace an explicit tap with the next press's small preview during a combo.
      if (now() - lastTap <= 550) return;
      press.preview = true;
      play('squish', { key: 'press-preview', priority: 80, energy: .65, direct: true });
    }, 160);
    later(() => {
      if (!press || press.moved) return;
      if (context().busy) { cancel(); play('nod', { direct: true }); return; }
      press.long = true; resetCombo();
      play('pancake', { key: 'hold-preview', priority: 80, direct: true });
    }, 650);
  }
  function move(e) {
    if (!press || press.pointerId !== e.pointerId) return;
    if (blocked()) { cancel(); return; }
    if (context().busy) { if (!press.busy) { cancel(); play('nod', { direct: true }); } return; }
    if (press.wakeOnly) return;
    const dx = (e.clientX - press.x) / press.r, dy = (e.clientY - press.y) / press.r;
    const time = now(), dt = Math.max(1, time - press.lastMove);
    press.velocityY = (e.clientY - press.lastY) / press.r / dt;
    press.lastY = e.clientY; press.lastMove = time;
    if (Math.hypot(dx, dy) < .22 && !press.moved) return;
    press.moved = true; clearTimers(); resetCombo();
    // Lock the drag axis once. High-frequency pointermove never restarts a clip.
    if (!press.gesture) {
      press.gesture = Math.abs(dy) > Math.abs(dx) ? (dy < 0 ? 'up' : 'down') : 'side';
      play({ up: 'stretch', down: 'pancake', side: 'wiggle' }[press.gesture], { key: 'drag-preview', priority: 80, direct: true });
    }
  }
  function finish(e) {
    if (!press || press.pointerId !== e.pointerId) return;
    const current = detachPress();
    lastDirect = now();
    if (blocked() || current.wakeOnly) { resetCombo(); return; }
    if (context().busy) { resetCombo(); play('nod', { direct: true }); return; }
    // Captured gestures may finish beyond the body, but never beyond the viewport.
    if (!current.keyboard && (e.clientX < 0 || e.clientY < 0 || e.clientX > win.innerWidth || e.clientY > win.innerHeight)) { resetCombo(); settle(); return; }
    if (current.gesture) {
      if (current.gesture === 'up') {
        const velocity = now() - current.lastMove < 120 ? current.velocityY : 0;
        play(velocity < -.002 ? 'boing' : 'drop', { direct: true });
      } else if (current.gesture === 'down') play('puff', { direct: true });
      return;
    }
    // A displaced body during a hold still owns that hold; a stray tap outside does not.
    if (current.long) play('boing', { direct: true });
    else if (current.keyboard || hit(e.clientX, e.clientY)) tap(current.region);
    else { resetCombo(); if (current.preview) settle(); }
  }
  function pointerDown(e) {
    if (blocked() || press || e.isPrimary === false || e.button !== 0 || !hit(e.clientX, e.clientY)) return;
    e.preventDefault();
    pointerFocus = true; hideFocus();
    canvas.focus({ preventScroll: true });
    const region = position(e.clientX, e.clientY);
    try { canvas.setPointerCapture(e.pointerId); } catch { return; }
    begin({ pointerId: e.pointerId, x: e.clientX, y: e.clientY, r: region.r, region });
  }
  function hover(e) {
    if (blocked() || press || e.pointerType !== 'mouse' || e.buttons) return;
    const inside = hit(e.clientX, e.clientY), time = now();
    if (!inside) { hoverInside = false; stroke = null; return; }
    if (context().busy) { hoverInside = true; stroke = null; return; }
    const p = position(e.clientX, e.clientY);
    if (!hoverInside && time - lastDirect > 900) {
      if (play(hoverIndex % 2 ? 'peek' : 'curious', { key: 'hover', cooldown: 6000, priority: 25, energy: .45 })) hoverIndex++;
    }
    hoverInside = true;
    if (!stroke || time - stroke.time > 1000) stroke = { x: e.clientX, dir: 0, turns: 0, time };
    const dx = e.clientX - stroke.x;
    if (Math.abs(dx) < p.r * .12) return;
    const dir = Math.sign(dx);
    if (stroke.dir && stroke.dir !== dir) stroke.turns++;
    stroke.x = e.clientX; stroke.dir = dir; stroke.time = time;
    if (stroke.turns >= 3) {
      stroke.turns = 0;
      if (time - lastDirect > 900 && play('giggle', { key: 'tickle', cooldown: 2000, priority: 35, energy: .7 })) onInteract();
    }
  }
  function activate() {
    if (blocked() || press) return;
    const waking = context().mood === 'sleep' || context().mode === 'sleep';
    onInteract();
    if (waking) resetCombo(); else tap();
  }
  function keyDown(e) {
    // Alt-Space is the app's voice shortcut. Modified keys remain app-owned.
    if (e.altKey || e.ctrlKey || e.metaKey || !['Enter', ' ', 'Escape'].includes(e.key)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    pointerFocus = false; showFocus();
    if (e.key === 'Escape') { cancel(); settle(); return; }
    if (blocked() || e.repeat || press) return;
    if (e.key === 'Enter') activate();
    else begin({ pointerId: null, keyboard: true, x: 0, y: 0, r: 40, region: { x: 0, y: 0 } });
  }
  function keyUp(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) { if (e.key === ' ' && press?.keyboard) cancel(); return; }
    if (!['Enter', ' ', 'Escape'].includes(e.key)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.key === ' ' && press?.keyboard) finish({ pointerId: null });
  }
  // Progress beats (delivered, streak, draft, brief, checks) are reactions to backend-verified events, never predictions.
  const semantic = {
    greet: ['hello', 10000, .7], focus: ['listen', 1800, .3], typing: ['think', 5000, .25],
    attach: ['curious', 1500, .65], send: ['nod', 900, .4], tidy: ['bow', 1800, .7], wake: ['wake', 2500, .7],
    delivered: ['double-hop', 2500, .75], streak: ['triple-hop', 4000, .8], draft: ['peek', 2000, .5],
    attention: ['wiggle', 2000, .5], brief: ['stretch', 3000, .4], checks: ['puff', 2000, .5],
  };
  const priorities = { send: 85, streak: 72, milestone: 70, delivered: 65, success: 60 };
  function event(name) {
    if (blocked() || !Object.hasOwn(semantic, name) && name !== 'success' && name !== 'milestone') return false;
    lastEvent = name;
    if (press && (context().busy || name === 'tidy')) cancel();
    // Completions cannot celebrate during work; the parent is the source of actual success. Attention may interrupt work.
    if (context().busy && ['success', 'milestone', 'tidy', 'greet', 'wake', 'delivered', 'streak', 'draft', 'brief', 'checks'].includes(name)) return false;
    let spec = semantic[name];
    if (name === 'success') spec = [['proud', 'ta-da', 'star'][successIndex % 3], 1600, .8];
    if (name === 'milestone') spec = [['star', 'ta-da'][milestoneIndex % 2], 2000, .85];
    const accepted = play(spec[0], { key: `event:${name}`, cooldown: spec[1], energy: spec[2], priority: priorities[name] ?? 40 });
    if (accepted && name === 'success') successIndex++;
    if (accepted && name === 'milestone') milestoneIndex++;
    return accepted;
  }
  canvas.removeAttribute('aria-hidden');
  canvas.tabIndex = 0;
  canvas.style.outline = 'none';
  canvas.setAttribute('role', 'button');
  canvas.setAttribute('aria-label', 'Nibbi. Enter to tap, hold Space to squeeze, Escape to cancel.');
  canvas.setAttribute('aria-keyshortcuts', 'Enter Space Escape');
  canvas.style.touchAction = 'none';
  listen(canvas, 'pointerdown', pointerDown);
  listen(canvas, 'pointermove', e => { move(e); hover(e); });
  listen(canvas, 'pointerup', finish);
  listen(canvas, 'pointercancel', e => { if (press?.pointerId === e.pointerId) cancel(); });
  listen(canvas, 'lostpointercapture', e => { if (press?.pointerId === e.pointerId) cancel(); });
  listen(canvas, 'pointerleave', () => { stroke = null; hoverInside = false; });
  listen(canvas, 'keydown', keyDown);
  listen(canvas, 'keyup', keyUp);
  listen(canvas, 'focus', showFocus);
  listen(canvas, 'blur', () => { hideFocus(); cancel(); });
  listen(win, 'blur', () => { hideFocus(); cancel(); });
  listen(doc, 'visibilitychange', () => { if (doc.hidden) { hideFocus(); cancel(); } else showFocus(); });
  // AT activates role=button with a zero-detail click. Pointer click/dblclick never duplicate gestures.
  listen(canvas, 'click', e => {
    if (e.detail !== 0) return;
    e.preventDefault(); e.stopImmediatePropagation();
    activate();
  });
  return {
    event,
    setReducedMotion(value) { if (destroyed) return; reduced = !!value; if (reduced) { cancel(); nibbi.stopAnimation?.(); } },
    state() { return { lastEvent, lastAction, actionSequence, history: history.map(item => ({ ...item })), holding: !!press, pointerId: press?.pointerId ?? null, gesture: press?.gesture ?? null, longHold: !!press?.long, combo: now() - lastTap <= 550 ? combo : 0, pendingTimers: timers.size, reduced, destroyed }; },
    destroy() {
      if (destroyed) return;
      cancel(); nibbi.stopAnimation?.(); destroyed = true;
      for (const remove of listeners) remove();
      for (const [key, value] of saved) { if (value === null) canvas.removeAttribute(key); else canvas.setAttribute(key, value); }
      canvas.style.touchAction = oldTouchAction; canvas.style.outline = oldOutline;
      hideFocus(); focusRing.remove();
    },
  };
}

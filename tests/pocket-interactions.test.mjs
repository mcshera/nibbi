import test from 'node:test';
import assert from 'node:assert/strict';
import { installPocketInteractions } from '../public/lib/pocket-interactions.js';
import '../public/pocket-motion.js';

// Deterministic event/timer fixture. Browser acceptance uses real DOM separately.
class Target extends EventTarget {
  attributes = new Map();
  children = [];
  append(child) { this.children.push(child); child.parent = this; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  style = { touchAction: 'pan-y' };
  captures = new Set();
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  removeAttribute(key) { this.attributes.delete(key); }
  set tabIndex(value) { this.setAttribute('tabindex', value); }
  focus() { this.ownerDocument.activeElement = this; }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); fire(this, 'lostpointercapture', { pointerId: id }); }
}
function fire(target, name, values = {}) {
  const event = new Event(name, { cancelable: true, bubbles: true });
  Object.assign(event, values);
  target.dispatchEvent(event);
  return event;
}
function fixture({ radius = 100, legacy = false, realDirector = false, wakeOnInteract = false } = {}) {
  const canvas = new Target(), doc = new Target(), win = new Target();
  let time = 0, nextTimer = 0, stopped = 0, interactions = 0;
  const timers = new Map(), calls = [];
  const context = { busy: false, mode: 'idle', mood: 'idle' };
  const director = realDirector ? globalThis.NibbiPocketMotion.createDirector({ seed: 7 }) : null;
  win.performance = { now: () => time };
  win.innerWidth = 1000; win.innerHeight = 1000;
  win.setTimeout = (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, at: time + delay }); return id; };
  win.clearTimeout = id => timers.delete(id);
  doc.defaultView = win; doc.hidden = false; canvas.ownerDocument = doc;
  doc.body = new Target(); doc.createElement = () => new Target();
  win.requestAnimationFrame = () => 1; win.cancelAnimationFrame = () => {};
  canvas.setAttribute('aria-hidden', 'true');
  const advance = target => { director?.update((target - time) / 1000, { energy: 1, reduced: false }); time = target; };
  const tick = ms => {
    const end = time + ms;
    for (;;) {
      const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]); advance(next[1].at); next[1].fn();
    }
    advance(end);
  };
  const nibbi = {
    hitTest: (x, y) => Math.hypot(x - 400, y - 400) < radius,
    state: () => ({ x: 400, y: 400, r: radius, motion: director?.state(), geometry: { bodyBounds: { left: 400 - radius, right: 400 + radius, top: 400 - radius, bottom: 400 + radius } } }),
    stopAnimation: () => { stopped++; director?.stop(); },
  };
  if (!legacy) nibbi.animate = (id, options) => {
    const accepted = director ? !!director.play(id, options) : true;
    if (accepted) calls.push({ id, options, at: time });
    return accepted;
  };
  const api = installPocketInteractions({ nibbi, canvas, getContext: () => context, onInteract: () => { interactions++; if (wakeOnInteract && context.mood === 'sleep') { context.mood = 'idle'; api.event('wake'); } } });
  const pointer = (name, x = 400, y = 400, extra = {}) => fire(canvas, name, { clientX: x, clientY: y, button: 0, buttons: name === 'pointerdown' ? 1 : 0, pointerId: 1, pointerType: 'touch', isPrimary: true, ...extra });
  const tap = (x = 400, y = 400) => { pointer('pointerdown', x, y); pointer('pointerup', x, y); };
  const key = (name, key, extra = {}) => fire(canvas, name, { key, repeat: false, ...extra });
  const ids = () => calls.map(c => c.id);
  return { canvas, doc, win, api, nibbi, director, context, calls, ids, tick, pointer, tap, key, timers, stopped: () => stopped, interactions: () => interactions };
}

test('empty space, secondary pointers, UI clicks and synthetic clicks never act', () => {
  const f = fixture();
  f.tap(5, 5);
  f.pointer('pointerdown', 400, 400, { isPrimary: false });
  f.pointer('pointerdown', 400, 400, { button: 2 });
  fire(f.canvas, 'click', { clientX: 400, clientY: 400 });
  fire(f.canvas, 'dblclick', { clientX: 400, clientY: 400 });
  fire(f.doc, 'pointerdown', { clientX: 400, clientY: 400 });
  f.tick(1000);
  assert.deepEqual(f.ids(), []); assert.equal(f.api.state().holding, false);
  assert.equal(f.interactions(), 0); f.api.destroy();
});

test('center taps upgrade immediately and expire without delayed animation', () => {
  const f = fixture({ realDirector: true });
  f.tap(); f.tick(100); f.tap(); f.tick(100); f.tap();
  assert.deepEqual(f.ids(), ['hop', 'double-hop', 'triple-hop']);
  assert.equal(f.api.state().combo, 3);
  f.tick(551); assert.equal(f.api.state().combo, 0); f.tap();
  assert.equal(f.ids().at(-1), 'hop'); assert.equal(f.timers.size, 0);
  f.tick(10000); assert.equal(f.calls.length, 4); f.api.destroy();
});

test('deformed bounds choose crown, sides and feet, with safe center dead zones', () => {
  for (const [x, y, expected] of [[400, 330, 'puff'], [400, 470, 'squish'], [330, 400, 'peek'], [470, 400, 'curious'], [445, 445, 'hop']]) {
    const f = fixture(); f.tap(x, y); assert.deepEqual(f.ids(), [expected]); f.api.destroy();
  }
  const f = fixture();
  f.nibbi.state = () => ({ x: 400, y: 400, r: 100, geometry: { bodyBounds: { left: 350, right: 450, top: 350, bottom: 450 } } });
  f.tap(435, 400); assert.deepEqual(f.ids(), ['curious']); f.api.destroy();
});

test('hold previews are bounded, capture one pointer, and release springs', () => {
  const f = fixture({ realDirector: true });
  f.pointer('pointerdown'); assert.deepEqual([...f.canvas.captures], [1]);
  f.pointer('pointerdown', 400, 400, { pointerId: 2 });
  f.pointer('pointerup', 400, 400, { pointerId: 2 });
  assert.equal(f.api.state().pointerId, 1);
  f.tick(159); assert.deepEqual(f.ids(), []);
  f.tick(1); assert.deepEqual(f.ids(), ['squish']);
  f.tick(490); assert.deepEqual(f.ids(), ['squish', 'pancake']);
  f.tick(2000); assert.equal(f.calls.length, 2);
  f.pointer('pointerup'); assert.equal(f.ids().at(-1), 'boing');
  assert.equal(f.api.state().holding, false); assert.equal(f.canvas.captures.size, 0);
  assert.equal(f.timers.size, 0); f.api.destroy();
});

test('tap outranks press preview, while intentional hold and drag interrupt earlier taps', () => {
  const f = fixture({ realDirector: true });
  f.tap(); f.tick(100); f.pointer('pointerdown'); f.tick(170);
  assert.deepEqual(f.ids(), ['hop']); f.pointer('pointerup');
  assert.equal(f.ids().at(-1), 'double-hop');
  f.tick(100); f.pointer('pointerdown'); f.tick(651);
  assert.equal(f.ids().at(-1), 'pancake'); f.pointer('pointerup');
  f.tick(150); f.pointer('pointerdown'); f.tick(20); f.pointer('pointermove', 400, 360);
  assert.equal(f.ids().at(-1), 'stretch'); f.api.destroy();
});

test('radius-scaled drags lock an axis and distinguish fast and slow upward releases', () => {
  for (const radius of [30, 100, 180]) {
    for (const [dx, dy, delay, expected] of [[0, -.5, 20, ['stretch', 'boing']], [0, -.5, 400, ['stretch', 'drop']], [0, .5, 20, ['pancake', 'puff']], [.5, 0, 20, ['wiggle']]]) {
      const f = fixture({ radius, realDirector: true });
      f.pointer('pointerdown'); f.tick(delay);
      f.pointer('pointermove', 400 + radius * dx, 400 + radius * dy);
      f.pointer('pointerup', 400 + radius * dx, 400 + radius * dy);
      assert.deepEqual(f.ids().filter(id => id !== 'squish'), expected);
      assert.equal(f.timers.size, 0); f.api.destroy();
    }
  }
  const f = fixture(); f.pointer('pointerdown'); f.tick(10);
  for (let i = 1; i <= 80; i++) f.pointer('pointermove', 400 + i, 400);
  assert.deepEqual(f.ids(), ['wiggle']); f.api.destroy();
});

test('flick velocity expires when the pull rests before release', () => {
  const f = fixture(); f.pointer('pointerdown'); f.tick(20);
  f.pointer('pointermove', 400, 350); f.tick(121); f.pointer('pointerup', 400, 350);
  assert.deepEqual(f.ids(), ['stretch', 'drop']); f.api.destroy();
});

test('hover needs three meaningful stroke reversals; hover and tickle have cooldowns', () => {
  const f = fixture();
  const mouse = x => f.pointer('pointermove', x, 400, { pointerType: 'mouse' });
  mouse(400); assert.deepEqual(f.ids(), ['curious']);
  for (const x of [401, 402, 401, 402, 401]) mouse(x);
  assert.equal(f.calls.length, 1);
  for (const x of [420, 380, 420]) mouse(x);
  assert.equal(f.calls.length, 1); mouse(380);
  assert.equal(f.ids().at(-1), 'giggle');
  for (const x of [420, 380, 420, 380, 420, 380]) mouse(x);
  assert.equal(f.ids().filter(id => id === 'giggle').length, 1);
  f.tick(2000); for (const x of [400, 420, 380, 420, 380]) mouse(x);
  assert.equal(f.ids().filter(id => id === 'giggle').length, 2);
  mouse(10); mouse(400); assert.equal(f.ids().filter(id => id === 'curious').length, 1);
  f.tick(4001); mouse(10); mouse(400); assert.equal(f.ids().at(-1), 'peek');
  f.tick(60000); assert.equal(f.timers.size, 0); f.api.destroy();
});

test('pointer cancel, capture loss, focus loss, hidden, reduced and destroy clear pending work', () => {
  for (const reason of ['pointercancel', 'lostpointercapture', 'blur', 'window-blur', 'hidden', 'reduced', 'destroy']) {
    const f = fixture(); f.tap(); f.tick(100); f.pointer('pointerdown'); f.tick(170);
    if (reason === 'window-blur') fire(f.win, 'blur');
    else if (reason === 'hidden') { f.doc.hidden = true; fire(f.doc, 'visibilitychange'); }
    else if (reason === 'reduced') f.api.setReducedMotion(true);
    else if (reason === 'destroy') f.api.destroy();
    else fire(f.canvas, reason, { pointerId: 1 });
    const count = f.calls.length;
    assert.equal(f.api.state().holding, false, reason);
    assert.equal(f.api.state().combo, 0, reason);
    assert.equal(f.canvas.captures.size, 0, reason);
    assert.equal(f.timers.size, 0, reason);
    f.tick(10000); f.pointer('pointerup'); assert.equal(f.calls.length, count, reason);
    f.api.destroy();
  }
});

test('outside tap release and outside viewport hold release do not trigger an action', () => {
  const f = fixture(); f.pointer('pointerdown'); f.pointer('pointerup', 800, 800);
  assert.deepEqual(f.ids(), []);
  f.pointer('pointerdown'); f.tick(700); f.pointer('pointerup', -10, 400);
  assert.deepEqual(f.ids(), ['squish', 'pancake']); assert.ok(f.stopped()); f.api.destroy();
});

test('busy direct input stays a small rate-limited nod and cannot celebrate', () => {
  const f = fixture(); f.context.busy = true;
  f.pointer('pointerdown'); f.tick(700); f.pointer('pointermove', 400, 350); f.pointer('pointerup', 400, 350);
  assert.deepEqual(f.ids(), ['nod']); assert.equal(f.calls[0].options.energy, .25);
  for (const name of ['success', 'milestone', 'tidy', 'greet', 'wake']) assert.equal(f.api.event(name), false);
  assert.equal(f.timers.size, 0); f.api.destroy();
  const g = fixture(); g.pointer('pointerdown'); g.tick(170); g.context.busy = true; g.api.event('send');
  g.tick(1000); assert.deepEqual(g.ids(), ['squish', 'nod']);
  assert.equal(g.api.state().holding, false); g.api.destroy();
});

test('keyboard supports Enter, hold Space and Escape without repeat or shortcut leakage', () => {
  const f = fixture();
  assert.equal(f.canvas.getAttribute('tabindex'), '0'); assert.equal(f.canvas.style.touchAction, 'none');
  let leaked = 0; f.canvas.addEventListener('keydown', () => leaked++);
  assert.equal(f.key('keydown', 'Enter').defaultPrevented, true); assert.deepEqual(f.ids(), ['hop']);
  f.key('keydown', 'Enter', { repeat: true }); assert.equal(f.calls.length, 1); assert.equal(leaked, 0);
  f.tick(1000); f.key('keydown', ' '); f.tick(650); f.key('keyup', ' ');
  assert.equal(f.ids().at(-1), 'boing');
  f.tick(1000); f.key('keydown', ' '); f.tick(170); f.key('keydown', 'Escape');
  const count = f.calls.length; f.tick(1000); f.key('keyup', ' '); assert.equal(f.calls.length, count);
  assert.equal(f.key('keydown', ' ', { altKey: true }).defaultPrevented, false);
  assert.equal(leaked, 1); assert.equal(f.api.state().holding, false); f.api.destroy();
});

test('semantic events map narrowly, rotate successes, and throttle typing', () => {
  const f = fixture();
  for (const [name, action] of [['greet', 'hello'], ['focus', 'listen'], ['typing', 'think'], ['attach', 'curious'], ['send', 'nod'], ['tidy', 'bow'], ['wake', 'wake']]) {
    assert.equal(f.api.event(name), true); assert.equal(f.ids().at(-1), action);
  }
  assert.equal(f.api.event('typing'), false); f.tick(4999); assert.equal(f.api.event('typing'), false);
  f.tick(1); assert.equal(f.api.event('typing'), true);
  for (const action of ['proud', 'ta-da', 'star', 'proud']) { assert.equal(f.api.event('success'), true); assert.equal(f.ids().at(-1), action); f.tick(1600); }
  for (const action of ['star', 'ta-da']) { assert.equal(f.api.event('milestone'), true); assert.equal(f.ids().at(-1), action); f.tick(2000); }
  for (const unknown of ['hop', 'oops', 'yawn', 'toString', '__proto__', 'not-an-event']) assert.equal(f.api.event(unknown), false);
  assert.ok(f.calls.every(call => call.options.interrupt));
  assert.equal(f.interactions(), 0); f.api.destroy();
});

test('reduced and hidden input never starts or defers motion; legacy animate is optional', () => {
  const f = fixture(); f.api.setReducedMotion(true); f.tap(); f.key('keydown', 'Enter');
  assert.equal(f.api.event('greet'), false); f.tick(1000); assert.deepEqual(f.ids(), []);
  f.api.setReducedMotion(false); f.doc.hidden = true; f.tap(); assert.equal(f.api.event('send'), false);
  f.doc.hidden = false; f.tap(); assert.deepEqual(f.ids(), ['hop']); f.api.destroy();
  const g = fixture({ legacy: true }); g.tap(); g.pointer('pointerdown'); g.tick(1000); g.pointer('pointerup');
  assert.equal(g.api.event('greet'), false); g.api.destroy();
});

test('destroy restores accessibility/styles, removes listeners and freezes bounded diagnostics', () => {
  const f = fixture();
  for (let i = 0; i < 45; i++) { f.tap(); f.tick(600); }
  const state = f.api.state(); assert.equal(state.history.length, 32); assert.equal(state.actionSequence, 45);
  state.history[0].action = 'mutated'; assert.notEqual(f.api.state().history[0].action, 'mutated');
  f.api.destroy(); f.api.destroy(); f.tap(); f.key('keydown', 'Enter'); f.api.event('send');
  assert.equal(f.calls.length, 45); assert.equal(f.canvas.getAttribute('tabindex'), null);
  assert.equal(f.canvas.getAttribute('role'), null); assert.equal(f.canvas.style.touchAction, 'pan-y');
  assert.equal(f.api.state().destroyed, true);
});


test('the first touch or character key wakes sleeping Nibbi without masking wake', () => {
  for (const input of ['tap', 'hold', 'Enter', ' ']) {
    const f = fixture({ realDirector: true, wakeOnInteract: true }); f.context.mood = 'sleep';
    if (input === 'tap') f.tap();
    else if (input === 'hold') { f.pointer('pointerdown'); f.tick(700); f.pointer('pointermove', 400, 350); f.pointer('pointerup', 400, 350); }
    else { f.key('keydown', input); f.tick(700); f.key('keyup', input); }
    assert.deepEqual(f.ids(), ['wake']); assert.equal(f.api.state().holding, false);
    assert.equal(f.timers.size, 0); f.tick(1000); f.tap(); assert.equal(f.ids().at(-1), 'hop'); f.api.destroy();
  }
});


test('busy transitions cancel hold timers, and Escape also settles a released tap', () => {
  const f = fixture({ realDirector: true }); f.pointer('pointerdown'); f.context.busy = true; f.tick(170);
  assert.deepEqual(f.ids(), ['nod']); assert.equal(f.api.state().holding, false); assert.equal(f.timers.size, 0);
  f.tick(1000); assert.equal(f.calls.length, 1); f.api.destroy();
  const g = fixture(); g.tap(); g.key('keydown', 'Escape'); assert.ok(g.stopped());
  g.key('keydown', ' '); g.key('keyup', ' ', { altKey: true }); assert.equal(g.api.state().holding, false); g.api.destroy();
});


test('character is exposed to AT and has a body-sized keyboard focus ring, restored on destroy', () => {
  const f = fixture(); assert.equal(f.canvas.getAttribute('aria-hidden'), null);
  f.canvas.focus(); fire(f.canvas, 'focus'); const ring = f.doc.body.children[0];
  assert.equal(ring.hidden, false); assert.equal(ring.style.width, '216px');
  assert.equal(ring.style.pointerEvents, 'none'); assert.equal(ring.getAttribute('aria-hidden'), 'true');
  fire(f.canvas, 'blur'); assert.equal(ring.hidden, true);
  f.api.destroy(); assert.equal(f.canvas.getAttribute('aria-hidden'), 'true'); assert.equal(f.doc.body.children.length, 0);
});

test('native error wins direct/busy/send priorities; semantic success wins native splash', () => {
  const f = fixture({ realDirector: true }); f.director.setMood('error');
  f.tap(); assert.deepEqual(f.ids(), []); f.context.busy = true; f.tick(100); f.tap();
  assert.equal(f.api.event('send'), false); assert.deepEqual(f.ids(), []);
  f.pointer('pointerdown'); f.pointer('pointercancel'); f.key('keydown', 'Escape');
  assert.equal(f.director.state().action, 'oops'); f.api.destroy();
  for (const name of ['success', 'milestone']) {
    const g = fixture({ realDirector: true }); g.director.play('ta-da', { priority: 45 });
    assert.equal(g.api.event(name), true); g.api.destroy();
  }
});

test('tidy cancels captured holds and their future previews before bowing', () => {
  const f = fixture({ realDirector: true }); f.pointer('pointerdown'); f.tick(170);
  assert.equal(f.api.event('tidy'), true); assert.equal(f.api.state().holding, false);
  assert.equal(f.api.state().pendingTimers, 0); assert.equal(f.canvas.captures.size, 0);
  f.tick(1000); assert.deepEqual(f.ids(), ['squish', 'bow']); f.api.destroy();
});


test('outside and missed-hit releases preserve a concurrent native error reaction', () => {
  for (const releaseX of [-10, 800]) {
    const f = fixture({ realDirector: true }); f.pointer('pointerdown'); f.tick(170);
    assert.deepEqual(f.ids(), ['squish']); f.director.setMood('error');
    f.pointer('pointerup', releaseX, 400);
    assert.equal(f.director.state().action, 'oops'); assert.equal(f.api.state().holding, false);
    assert.equal(f.api.state().pendingTimers, 0); f.api.destroy();
  }
});

test('AT zero-detail click activates once with keyboard-equivalent wake, busy and calm guards', () => {
  const f = fixture();
  fire(f.canvas, 'click', { detail: 0 }); assert.deepEqual(f.ids(), ['hop']); assert.equal(f.interactions(), 1);
  fire(f.canvas, 'click', { detail: 1 }); fire(f.canvas, 'dblclick', { detail: 2 });
  assert.deepEqual(f.ids(), ['hop']);
  f.tick(100); f.context.busy = true; fire(f.canvas, 'click', { detail: 0 });
  assert.equal(f.ids().at(-1), 'nod'); assert.equal(f.calls.at(-1).options.energy, .25);
  f.api.setReducedMotion(true); const count = f.calls.length;
  fire(f.canvas, 'click', { detail: 0 }); assert.equal(f.calls.length, count); f.api.destroy();
  const g = fixture({ realDirector: true, wakeOnInteract: true }); g.context.mood = 'sleep';
  fire(g.canvas, 'click', { detail: 0 }); assert.deepEqual(g.ids(), ['wake']); g.api.destroy();
});

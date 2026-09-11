/* TEMPLATE for a round-4 technique. Copy the shape; replace the body. This one is a plain Canvas2D blob with a spring, to show the API. */
import * as ink from '../../ink.mjs';
import { ACTION_IDS } from '../../actions.mjs';
const { clamp, mix, TAU, FOOT } = ink;

export const meta = {
  id: 'template', name: 'Template', technique: 'Canvas2D blob + one spring (API demo)', tagline: 'TODO', look: 'TODO', motion: 'TODO', eyes: 'TODO', risks: ['TODO'],
  stills: { idle: 2, hello: .55, listen: 1.2, think: 1.4, work: 1.6, success: .7, error: .9, sleep: 2, tap: .25 },
};

export function mount(host, { R = 96, seed = 1, tint = null, reduced = false, energy = 1, size = 'hero', paper = true } = {}) {
  const W = Math.round(3.4 * R), H = Math.round(3.6 * R), footX = 1.7 * R, footY = 3.1 * R;
  host.style.width = W + 'px'; host.style.height = H + 'px'; host.style.position = 'relative';
  const dpr = Math.min(2, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1));
  const canvas = document.createElement('canvas'); canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.cssText = `display:block;width:${W}px;height:${H}px;touch-action:none`;
  host.appendChild(canvas); const ctx = canvas.getContext('2d');
  // --- state -------------------------------------------------------------
  let action = 'idle', tAction = 0, time = 0, sy = 1, vy = 0, target = 1, pressed = false;
  const st = { reduced, energy, tint };
  const ctl = {
    cue(a) { if (!ACTION_IDS.includes(a)) return; action = a; tAction = 0; if (a === 'hello' || a === 'tap' || a === 'success') vy += (a === 'success' ? 2.6 : 1.4) * st.energy; },
    step(dt) {
      dt = clamp(dt, 0, .1); time += dt; tAction += dt;
      // spring toward target scale (physics instead of authored curves)
      target = action === 'sleep' ? .82 : action === 'error' ? .9 : action === 'think' ? 1.04 : 1;
      if (pressed) target = .8;
      if (st.reduced) { sy = target; vy = 0; } else { const k = 60, c = 7; vy += (-(sy - target) * k - vy * c) * dt; sy += vy * dt; }
      if (['hello', 'tap', 'success', 'error'].includes(action) && tAction > 1.2) { action = 'idle'; tAction = 0; }
      draw();
    },
    setReduced(v) { st.reduced = !!v; }, setEnergy(e) { st.energy = clamp(e, .5, 1.5); }, setTint(c) { st.tint = c; },
    poke(x, y, kind) { if (kind === 'down') { pressed = true; } if (kind === 'up') { pressed = false; vy += 1.2; } if (kind === 'tap') ctl.cue('tap'); },
    destroy() { host.removeEventListener('pointerdown', onDown); host.removeEventListener('pointerup', onUp); canvas.remove(); },
  };
  const onDown = e => ctl.poke(e.offsetX, e.offsetY, 'down'), onUp = e => ctl.poke(e.offsetX, e.offsetY, 'up');
  host.addEventListener('pointerdown', onDown); host.addEventListener('pointerup', onUp);
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (paper) ink.paper(ctx, W, H, { grain: 0 }); else ctx.clearRect(0, 0, W, H);
    const color = ink.inkColor(st.tint); const sx = 1 / sy;
    ctx.save(); ctx.translate(footX, footY); ctx.scale(sx, sy); ctx.translate(0, -FOOT * R);
    const pts = ink.blobPoints(R, { seed, rough: .06, time: st.reduced ? 0 : time });
    ink.fuzzyFill(ctx, pts, { color, R, soft: size === 'hero' ? .05 : 0, tufts: size === 'hero' ? 20 : 0, seed });
    ink.eyes(ctx, R, { blink: action === 'sleep' ? 1 : 0, eyeY: action === 'error' ? .6 : action === 'think' ? -.5 : 0, eyeX: action === 'think' ? -.5 : 0 }, { ink: color });
    ctx.restore();
  }
  draw();
  return ctl;
}

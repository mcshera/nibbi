/* Round-2 technique: 'svgink' — Wet ink filter. A smooth SVG body path pushed through feTurbulence + feDisplacementMap
 * (creeping wet edge), blur + alpha threshold (the "goo" edge: feathered but crisp) and a wide low-alpha bleed halo, over a
 * fractal-noise paper grain. The body morphs each step from critically-damped springs; the filter parameters are state. */
import * as ink from '../../ink.mjs';
import { ACTION_IDS } from '../../actions.mjs';
const { clamp, mix, TAU, FOOT } = ink;
const NS = 'http://www.w3.org/2000/svg';

export const meta = {
  id: 'svgink', name: 'Wet ink filter',
  technique: 'SVG path morph → feTurbulence + feDisplacementMap → blur + alpha-threshold (goo edge) + wide bleed halo, over fractalNoise paper grain',
  tagline: 'A drop of ink still wet on the page: its edge creeps, it bleeds into the paper, and it dries when it sleeps.',
  look: 'One dark ink body with an irregular, slightly lobed edge that softens into a faint halo where the paper has soaked. Two un-inked spots for eyes, their edges wet too; crisp dark pupils. Fine paper fibre in the cream.',
  motion: 'Every pose is a spring target, so movement has weight and settles. Wetness is state: touch or surprise makes the edge run and bleed; sleep dries it sharp. Work pulses the turbulence seed in steps so the edge creeps rather than flows.',
  eyes: 'Two white ellipses (paper showing through) filtered by the same displacement so their rim is wet; dark ellipse pupils with one glint on top, unfiltered; blink by collapsing ry; asleep = two short dark lines.',
  risks: ['SVG filter cost scales with the filter region; Safari renders feTurbulence/feDisplacementMap differently', 'Wrong threshold slope makes the edge read as a drop shadow', 'pill uses only blur+threshold, tiny uses no filter, so wetness reads only at hero'],
  stills: { idle: 2, hello: .5, listen: 1.3, think: 1.4, work: 1.2, success: .7, error: 1.1, sleep: 2, tap: .25 },
};

const el = (tag, attrs = {}, parent = null) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); if (parent) parent.appendChild(n); return n; };
const f2 = x => (Math.round(x * 100) / 100).toString();
/* Closed Catmull-Rom → cubic path string (same curve as ink.tracePath, but as an SVG 'd'). */
function pathD(p) {
  const n = p.length; let d = `M${f2(p[0].x)} ${f2(p[0].y)}`;
  for (let i = 0; i < n; i++) {
    const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n], e = p[(i + 2) % n];
    d += `C${f2(b.x + (c.x - a.x) / 6)} ${f2(b.y + (c.y - a.y) / 6)} ${f2(c.x - (e.x - b.x) / 6)} ${f2(c.y - (e.y - b.y) / 6)} ${f2(c.x)} ${f2(c.y)}`;
  }
  return d + 'Z';
}
/* Critically damped spring bundle: values chase targets with weight, or snap when reduced. */
function springs(init) {
  const v = { ...init }, vel = {}, tgt = { ...init }; for (const k in v) vel[k] = 0;
  return {
    v, tgt,
    set(k, x) { tgt[k] = x; }, kick(k, dv) { vel[k] += dv; },
    step(dt, reduced, stiff = {}) {
      for (const k in v) {
        if (reduced) { v[k] = tgt[k]; vel[k] = 0; continue; }
        const w = stiff[k] || 40, c = 2 * Math.sqrt(w) * 1.05;   // slightly over-damped: settles without wobble
        vel[k] += (-(v[k] - tgt[k]) * w - vel[k] * c) * dt; v[k] += vel[k] * dt;
      }
    },
  };
}

export function mount(host, { R = 96, seed = 1, tint = null, reduced = false, energy = 1, size = 'hero', paper = true } = {}) {
  const W = Math.round(3.4 * R), H = Math.round(3.6 * R), footX = 1.7 * R, footY = 3.1 * R;
  host.style.width = W + 'px'; host.style.height = H + 'px'; host.style.position = 'relative';
  const hero = size === 'hero', pill = size === 'pill', uid = 'svgink' + Math.round(ink.rand(seed, 999) * 1e6) + '_' + R;
  const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` }); svg.style.cssText = `display:block;width:${W}px;height:${H}px;touch-action:none;user-select:none`;
  host.appendChild(svg);
  const defs = el('defs', {}, svg);
  // --- filters (hero: full wet chain; pill: blur+threshold only; tiny: none) ------------------------------------------
  let turb, disp, blur, thr, pool, fringeBlur, fringeA, haloBlur, haloA, eTurb, eDisp, eBlur, ringBlur;
  if (hero) {
    const f = el('filter', { id: uid + 'wet', x: '-25%', y: '-25%', width: '150%', height: '150%', 'color-interpolation-filters': 'sRGB' }, defs);
    turb = el('feTurbulence', { type: 'turbulence', baseFrequency: .03, numOctaves: 2, seed: 1, result: 't' }, f);
    disp = el('feDisplacementMap', { in: 'SourceGraphic', in2: 't', scale: 8, xChannelSelector: 'R', yChannelSelector: 'G', result: 'd' }, f);
    blur = el('feGaussianBlur', { in: 'd', stdDeviation: 2, result: 'b' }, f);
    const ct = el('feComponentTransfer', { in: 'b', result: 'goo' }, f); thr = el('feFuncA', { type: 'linear', slope: 7, intercept: -2.8 }, ct);
    fringeBlur = el('feGaussianBlur', { in: 'd', stdDeviation: 3, result: 'fr' }, f);   // soft grey fringe where the ink feathers
    const fct = el('feComponentTransfer', { in: 'fr', result: 'fringe' }, f); fringeA = el('feFuncA', { type: 'linear', slope: .5, intercept: 0 }, fct);
    haloBlur = el('feGaussianBlur', { in: 'd', stdDeviation: 8, result: 'h' }, f);        // wide faint halo soaked into the paper
    const hct = el('feComponentTransfer', { in: 'h', result: 'halo' }, f); haloA = el('feFuncA', { type: 'linear', slope: .3, intercept: 0 }, hct);
    // wet pooling: a slow mottle that thins the ink a little inside the body (paper colour, low alpha, clipped to the goo)
    el('feTurbulence', { type: 'fractalNoise', baseFrequency: f2(.9 / R), numOctaves: 2, seed: 3 + Math.round(ink.rand(seed, 11) * 100), result: 'mt' }, f);
    el('feColorMatrix', { in: 'mt', type: 'matrix', values: '0 0 0 0 .95  0 0 0 0 .94  0 0 0 0 .92  .2 0 0 0 -.045', result: 'mc' }, f);
    pool = el('feComposite', { in: 'mc', in2: 'goo', operator: 'in', result: 'pool' }, f);
    const m = el('feMerge', {}, f); el('feMergeNode', { in: 'halo' }, m); el('feMergeNode', { in: 'fringe' }, m); el('feMergeNode', { in: 'goo' }, m); el('feMergeNode', { in: 'pool' }, m);
    const fe = el('filter', { id: uid + 'eye', x: '-30%', y: '-30%', width: '160%', height: '160%', 'color-interpolation-filters': 'sRGB' }, defs);
    eTurb = el('feTurbulence', { type: 'turbulence', baseFrequency: .06, numOctaves: 1, seed: 2, result: 't' }, fe);
    eDisp = el('feDisplacementMap', { in: 'SourceGraphic', in2: 't', scale: 3, xChannelSelector: 'R', yChannelSelector: 'G', result: 'd' }, fe);
    eBlur = el('feGaussianBlur', { in: 'd', stdDeviation: 1, result: 'b' }, fe);
    const ect = el('feComponentTransfer', { in: 'b' }, fe); el('feFuncA', { type: 'linear', slope: 7, intercept: -2.8 }, ect);
    const fr = el('filter', { id: uid + 'ring', x: '-30%', y: '-100%', width: '160%', height: '300%' }, defs);
    ringBlur = el('feGaussianBlur', { stdDeviation: R * .05 }, fr);
    if (paper) {
      const fg = el('filter', { id: uid + 'grain', x: 0, y: 0, width: '100%', height: '100%' }, defs);
      el('feTurbulence', { type: 'fractalNoise', baseFrequency: .9, numOctaves: 3, seed: Math.round(ink.rand(seed, 7) * 500) }, fg);
      el('feColorMatrix', { type: 'matrix', values: '0 0 0 0 .36  0 0 0 0 .33  0 0 0 0 .28  .26 0 0 0 -.075' }, fg);
    }
  } else if (pill) {
    const f = el('filter', { id: uid + 'wet', x: '-20%', y: '-20%', width: '140%', height: '140%', 'color-interpolation-filters': 'sRGB' }, defs);
    blur = el('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: R * .035, result: 'b' }, f);
    const ct = el('feComponentTransfer', { in: 'b' }, f); thr = el('feFuncA', { type: 'linear', slope: 6, intercept: -2.4 }, ct);
  }
  // --- scene -------------------------------------------------------------------------------------------------------
  if (paper) { el('rect', { width: W, height: H, fill: ink.PAPER }, svg); if (hero) el('rect', { width: W, height: H, filter: `url(#${uid}grain)`, style: 'mix-blend-mode:multiply' }, svg); }
  const ring = el('ellipse', { cx: footX, cy: footY, rx: R, ry: R * .16, fill: 'none', 'stroke-width': R * .09, opacity: 0, filter: hero ? `url(#${uid}ring)` : 'none' }, svg);
  const gBody = el('g', { filter: hero || pill ? `url(#${uid}wet)` : 'none' }, svg);
  const body = el('path', {}, gBody), drip = el('path', { d: '' }, gBody);
  const gEyes = el('g', { filter: hero ? `url(#${uid}eye)` : 'none', fill: '#fbfaf7' }, svg);
  const whites = [el('ellipse', {}, gEyes), el('ellipse', {}, gEyes)];
  const gPup = el('g', {}, svg);
  const pupils = [el('ellipse', {}, gPup), el('ellipse', {}, gPup)], glints = [el('circle', { fill: '#fbfaf7' }, gPup), el('circle', { fill: '#fbfaf7' }, gPup)];
  const lids = [el('line', { 'stroke-linecap': 'round' }, gPup), el('line', { 'stroke-linecap': 'round' }, gPup)];
  // --- state ---------------------------------------------------------------------------------------------------------
  const st = { reduced, energy: clamp(energy, .5, 1.5), tint };
  let action = 'idle', tAction = 0, time = 0, pressed = false, dragX = 0, dragY = 0, nextBlink = 2 + ink.rand(seed, 1) * 3, blinkI = 0, seedStep = 0;
  // pose springs: x/lift in R units, sy squash, lean, drop (crown hook), drip 0..1, wet 0..1, eyeX/eyeY gaze, blink 0..1, wide, happy
  const S = springs({ x: 0, lift: 0, sy: 1, lean: 0, drop: 0, drip: 0, wet: .35, eyeX: 0, eyeY: 0, blink: 0, wide: 1, happy: 0 });
  const STIFF = { sy: 90, lift: 70, x: 50, wet: 30, blink: 400, eyeX: 120, eyeY: 120, drip: 12, drop: 25, lean: 35, wide: 120, happy: 60 };
  const ONE_SHOT = { hello: 1.3, tap: .6, success: 1.5, error: 2.4 };

  function targets() {
    const e = st.energy, t = st.reduced ? meta.stills[action] : tAction;   // reduced: hold the designed still
    let x = 0, lift = 0, sy = 1, lean = 0, drop = 0, dr = 0, wet = .35, eyeX = 0, eyeY = 0, blink = 0, wide = 1, happy = 0;
    switch (action) {
      case 'listen': lean = -.3 * e; sy = 1.05; eyeX = -.45; eyeY = -.15; wet = .1; wide = 1.12; break;
      case 'think': drop = .75 * e; lean = .22 * e; eyeX = .55; eyeY = -.65; wet = .75; sy = 1.02; break;
      case 'work': { const ph = t * 1.6 * TAU; sy = .97 + .025 * e * Math.sin(ph); lift = .015 * e * Math.max(0, -Math.sin(ph)); lean = .1; eyeY = .7; eyeX = .2 * Math.sin(t * .9 * TAU); wet = .5; wide = .95; break; }
      case 'success': lift = t < .55 ? .3 * e : 0; sy = t < .55 ? 1.06 : 1; happy = t < 1.2 ? 1 : 0; wide = 1.05; eyeY = -.3; wet = .55; break;
      case 'error': sy = .92; lean = -.08; dr = t < 1.9 ? 1 : 0; eyeY = .8; eyeX = .1; wide = .85; wet = .55; break;
      case 'sleep': sy = .84; lean = .06; blink = 1; wet = .04; eyeY = .3; break;
      case 'hello': lift = t < .7 ? .16 * e : 0; sy = t < .7 ? 1.08 : 1; wide = t < .9 ? 1.15 : 1; eyeY = -.25; wet = .6; lean = t < .9 ? .2 * e : 0; break;
      case 'tap': sy = t < .3 ? .82 : 1; wet = 1; wide = t < .35 ? 1.18 : 1; eyeY = -.2; break;
      default: break;
    }
    if (pressed) { sy = .85; wet = 1; x = clamp(dragX / R, -.32, .32); lift = clamp(-dragY / R, 0, .28); eyeX = clamp(dragX / R * 1.5, -1, 1); eyeY = clamp(dragY / R * 1.5, -1, .8); wide = 1.1; }
    S.set('x', x); S.set('lift', lift); S.set('sy', sy); S.set('lean', lean); S.set('drop', drop); S.set('drip', dr); S.set('wet', wet);
    S.set('eyeX', eyeX); S.set('eyeY', eyeY); S.set('blink', Math.max(blink, blinkNow())); S.set('wide', wide); S.set('happy', happy);
  }
  function blinkNow() {   // deterministic occasional blink (not asleep, not reduced)
    if (st.reduced || action === 'sleep') return 0;
    if (time > nextBlink + .13) { blinkI++; nextBlink = time + 2.4 + ink.rand(seed, 100 + blinkI) * 3.2; }
    return time > nextBlink ? 1 : 0;
  }
  const ctl = {
    cue(a) {
      if (!ACTION_IDS.includes(a)) return; action = a; tAction = 0;
      if (st.reduced) return;
      const e = st.energy;
      if (a === 'hello') { S.kick('lift', 1.6 * e); S.kick('wet', 2); }
      if (a === 'success') { S.kick('lift', 3.2 * e); S.kick('sy', .8); }
      if (a === 'tap') { S.kick('sy', -1.6 * e); S.kick('wet', 3); }
      if (a === 'error') { S.kick('sy', -.9); S.kick('lean', -.6); }
      if (a === 'think') S.kick('drop', .8);
    },
    step(dt) {
      dt = clamp(dt, 0, .1); time += dt; tAction += dt;
      if (ONE_SHOT[action] && tAction > (st.reduced ? .9 : ONE_SHOT[action])) { action = 'idle'; tAction = 0; }
      targets();
      S.step(dt, st.reduced, STIFF);
      draw();
    },
    setReduced(v) { st.reduced = !!v; }, setEnergy(e) { st.energy = clamp(e, .5, 1.5); }, setTint(c) { st.tint = c; },
    poke(x, y, kind) {
      if (kind === 'down') { pressed = true; dragX = 0; dragY = 0; downX = x; downY = y; if (ONE_SHOT[action]) { action = 'idle'; tAction = 0; } S.kick('wet', 2); }
      else if (kind === 'move' && pressed) { dragX = clamp(x - downX, -R, R); dragY = clamp(y - downY, -R, R); }
      else if (kind === 'up') { if (pressed) { pressed = false; S.kick('sy', 1.4); S.kick('x', -dragX / R * 2); } }
      else if (kind === 'tap') ctl.cue('tap');
    },
    destroy() { host.removeEventListener('pointerdown', onDown); host.removeEventListener('pointermove', onMove); host.removeEventListener('pointerup', onUp); host.removeEventListener('pointercancel', onUp); svg.remove(); },
  };
  let downX = 0, downY = 0;
  const onDown = e => { ctl.poke(e.offsetX, e.offsetY, 'down'); try { host.setPointerCapture?.(e.pointerId); } catch (_) { } };
  const onMove = e => ctl.poke(e.offsetX, e.offsetY, 'move'), onUp = e => ctl.poke(e.offsetX, e.offsetY, 'up');
  host.addEventListener('pointerdown', onDown); host.addEventListener('pointermove', onMove); host.addEventListener('pointerup', onUp); host.addEventListener('pointercancel', onUp);

  // --- draw --------------------------------------------------------------------------------------------------------
  function draw() {
    const v = S.v, color = ink.inkColor(st.tint), e = st.energy, frozen = st.reduced;
    const breath = frozen || action === 'sleep' ? (action === 'sleep' && !frozen ? .012 * Math.sin(time * .5 * TAU) : 0) : .007 * Math.sin(time * .28 * TAU);
    const sy = clamp(v.sy + breath, .45, 1.7), sx = 1 / Math.sqrt(sy);   // clamp: a hard tap kick must never invert the body
    const tf = `translate(${f2(footX + v.x * R)} ${f2(footY - v.lift * R)}) scale(${f2(sx)} ${f2(sy)}) translate(0 ${f2(-FOOT * R)})`;
    // body outline (points in JS, morphed each step)
    const pts = ink.blobPoints(R, { n: hero ? 56 : 32, seed, rough: hero ? .035 : .05, time: frozen ? 0 : time, boil: .4, lean: v.lean, drop: v.drop, round: v.drop * .1 });
    body.setAttribute('d', pathD(pts)); gBody.setAttribute('transform', tf); gBody.setAttribute('fill', color);
    // drip (error): a tear hanging from the lower right, growing downward
    if (v.drip > .02) {
      const L = v.drip * .24 * R, x0 = .38 * R, y0 = .78 * R, w = .085 * R * (.6 + .4 * v.drip);
      const dp = [{ x: x0 - w, y: y0 }, { x: x0 - w * .8, y: y0 + L * .5 }, { x: x0 - w * .55, y: y0 + L }, { x: x0, y: y0 + L + w * .55 }, { x: x0 + w * .55, y: y0 + L }, { x: x0 + w * .8, y: y0 + L * .5 }, { x: x0 + w, y: y0 }];
      drip.setAttribute('d', pathD(dp)); drip.setAttribute('fill', color);
    } else drip.setAttribute('d', '');
    // wetness → filter parameters
    const wet = clamp(v.wet, 0, 1.2);
    if (hero) {
      const think = action === 'think' && !frozen;
      const bf = (1.4 + 1.6 * wet + (think ? .9 : 0)) / R;
      turb.setAttribute('baseFrequency', f2(bf)); disp.setAttribute('scale', f2(R * (.05 + .16 * wet * e)));
      blur.setAttribute('stdDeviation', f2(R * (.014 + .018 * wet))); haloBlur.setAttribute('stdDeviation', f2(R * (.07 + .09 * wet)));
      haloA.setAttribute('slope', f2(.14 + .34 * wet)); fringeBlur.setAttribute('stdDeviation', f2(R * (.02 + .03 * wet))); fringeA.setAttribute('slope', f2(.3 + .4 * wet)); thr.setAttribute('slope', f2(mix(9, 5.5, wet))); thr.setAttribute('intercept', f2(-mix(9, 5.5, wet) * .42));
      // seed: constant when frozen; steps during work (creep pulse) and think (restless); slow drift otherwise
      let sd = 1 + Math.round(ink.rand(seed, 3) * 200);
      if (!frozen) { if (action === 'work') sd += Math.floor(tAction / .45) % 12; else if (think) sd += Math.floor(tAction / .3) % 8; else if (wet > .7) sd += Math.floor(time / .2) % 6; }
      if (sd !== seedStep) { seedStep = sd; turb.setAttribute('seed', sd); eTurb.setAttribute('seed', sd + 5); }
      eDisp.setAttribute('scale', f2(R * (.015 + .045 * wet))); eBlur.setAttribute('stdDeviation', f2(R * (.008 + .008 * wet)));
    }
    // eyes: un-inked spots + pupils, one glint each; sleep/blink → line
    gEyes.setAttribute('transform', tf); gPup.setAttribute('transform', tf);
    const open = 1 - clamp(v.blink, 0, 1), ex = v.lean * R * .28 - v.drop * R * .05, ey = -v.drop * R * .1;
    for (let i = 0; i < 2; i++) {
      const wide = clamp(v.wide, .5, 1.6), happy = clamp(v.happy, 0, 1);
      const g = ink.EYES[i], cx = g.x * R + ex, cy = g.y * R + ey, rx = g.rx * R * wide, ry = g.ry * R * wide * Math.max(.05, open) * (1 - .3 * happy);
      const gx = clamp(v.eyeX, -1, 1) * rx * .42, gy = clamp(v.eyeY, -1, 1) * ry * .35 + ry * .12 - happy * ry * .35;
      const prx = g.prx * R * wide, pry = Math.max(.3, Math.min(g.pry * R * wide, ry * .92));
      const closed = open < .12;
      whites[i].setAttribute('cx', f2(cx)); whites[i].setAttribute('cy', f2(cy)); whites[i].setAttribute('rx', f2(rx)); whites[i].setAttribute('ry', f2(ry)); whites[i].setAttribute('opacity', closed ? 0 : 1);
      pupils[i].setAttribute('cx', f2(cx + gx)); pupils[i].setAttribute('cy', f2(cy + gy)); pupils[i].setAttribute('rx', f2(prx)); pupils[i].setAttribute('ry', f2(pry)); pupils[i].setAttribute('fill', color); pupils[i].setAttribute('opacity', closed ? 0 : 1);
      glints[i].setAttribute('cx', f2(cx + gx + prx * .38)); glints[i].setAttribute('cy', f2(cy + gy - pry * .38)); glints[i].setAttribute('r', f2(Math.max(.6, prx * .22))); glints[i].setAttribute('opacity', closed ? 0 : 1);
      lids[i].setAttribute('x1', f2(cx - rx * .7)); lids[i].setAttribute('x2', f2(cx + rx * .7)); lids[i].setAttribute('y1', f2(cy + ry * .2)); lids[i].setAttribute('y2', f2(cy + ry * .2));
      lids[i].setAttribute('stroke', '#fbfaf7'); lids[i].setAttribute('stroke-width', f2(Math.max(1, R * .03))); lids[i].setAttribute('opacity', closed ? .9 : 0);
    }
    // success bleed ring at the foot: expands and soaks away
    if (action === 'success' && !frozen) { const t = clamp(tAction / 1.3, 0, 1); ring.setAttribute('rx', f2(R * (.55 + .7 * t))); ring.setAttribute('ry', f2(R * (.12 + .1 * t))); ring.setAttribute('opacity', f2(.9 * (1 - t) * (1 - t))); ring.setAttribute('stroke', color); }
    else ring.setAttribute('opacity', action === 'success' ? .3 : 0), ring.setAttribute('stroke', color), ring.setAttribute('rx', f2(R * .9)), ring.setAttribute('ry', f2(R * .16));
  }
  draw();
  return ctl;
}

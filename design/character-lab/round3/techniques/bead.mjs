/* Round 3 · 01 — Ink bead (reference, ported to the shared raymarch base). A glossy drop of wet ink on the paper. */
import { makeMount } from '../../raymarch.mjs';
import { clamp, TAU, rand } from '../../ink.mjs';

export const meta = {
  id: 'bead', name: 'Ink bead',
  technique: 'raymarched SDF drop with glossy wet shading (the round-2 favourite, now on the shared base)',
  tagline: 'a bead of wet ink sitting on the paper, lit like a real object',
  look: 'Glossy near-black drop, soft window highlight, flat wet base, contact shadow, a small poured crown; two enamel eyes set into the surface.',
  motion: 'Springs toward simple targets — every move overshoots and settles like a heavy drop. Press squashes it, drag pulls it, release bounces.',
  eyes: 'White spheres embedded in the bead with dark glossy pupils that catch the same light.',
  risks: ['Glossy 3D can read as a toy rather than ink on paper', 'GPU cost; hero renders at reduced internal resolution', 'Eyes are small at 24 px'],
  stills: { idle: 2, hello: .45, listen: 1.4, think: 1.5, work: 1.1, success: .75, error: 1.1, sleep: 2, tap: .22 },
};

const SCENE = `
// uniforms are declared by the base from the spec: u_body, u_scale, u_peak, u_ring, u_drip, u_blink, u_wide, u_happy, u_gaze
vec2 map(vec3 p){
  vec3 q = p - vec3(u_body.x, 0., 0.); q.xy = rot(u_body.z) * q.xy;
  float rb = 0.85; vec3 sc = u_scale * rb; vec3 c = vec3(0., sc.y + u_body.y, 0.); vec3 l = q - c;
  float body = sdEll(l, sc); body = smax(body, -(p.y) - 0.02, 0.12);
  float peak = sdEll(l - vec3(-0.18*sc.x, 0.86*sc.y, 0.), vec3(0.2, 0.1 + 0.45*u_peak, 0.2)*rb); body = smin(body, peak, 0.22);
  if (u_drip > 0.001) { float drip = sdEll(l - vec3(0.42*sc.x, -sc.y + 0.02, 0.55 + 0.35*u_drip), vec3(0.13, 0.025, 0.1 + 0.42*u_drip)*rb); body = smin(body, drip, 0.12); }
  vec2 res = vec2(body, 0.);
  for (int i = 0; i < 2; i++) {
    float side = i == 0 ? -1. : 1.;
    vec3 e = c + vec3(side*0.34*sc.x, -0.08*sc.y, 0.80*sc.z); vec3 le = q - e;
    float open = max(0.06, 1. - u_blink); float er = 0.235*rb*u_wide;
    float eye = sdEll(le, vec3(er, er*open*(1. - 0.3*u_happy), er)); if (eye < res.x) res = vec2(eye, 1.);
    vec3 lp = le - vec3(u_gaze.x*er*0.45, u_gaze.y*er*0.35 - 0.02*rb, er*0.62);
    float pupil = length(lp) - er*0.55*open; if (pupil < res.x) res = vec2(pupil, 2.);
  }
  return res;
}
vec3 material(float id, vec3 p, vec3 n, vec3 rd, vec3 light, float diff, float spec, float window, float fres){
  vec3 hv = normalize(light - rd);
  if (id < 0.5) return u_ink * (0.55 + 0.45*diff) + vec3(0.22)*fres + vec3(0.9, 0.9, 0.86)*spec*0.9 + vec3(0.32)*window*0.8;
  if (id < 1.5) return vec3(0.97, 0.96, 0.93) * (0.72 + 0.28*diff) + vec3(0.6)*spec*0.5;
  return vec3(0.06, 0.06, 0.05) + vec3(1.)*pow(clamp(dot(n, hv), 0., 1.), 40.)*0.95 + vec3(0.2)*window;
}
float paperInk(vec3 p){
  float rr = length(vec2((p.x - u_body.x)/max(u_scale.x, 0.4), p.z/max(u_scale.z, 0.4)));
  return u_ring * (1. - smoothstep(0.0, 0.16, abs(rr - (0.95 + 0.35*(1. - u_ring))))) * 0.35;
}`;

const T = {
  idle:    { squash: 1, lift: 0, lean: 0, peak: .25, x: 0, gx: 0, gy: 0, blink: 0, wide: 1, happy: 0, drip: 0 },
  hello:   { squash: .86, lift: 0, lean: -.08, peak: .5, x: 0, gx: 0, gy: -.3, blink: 0, wide: 1.08, happy: 0, drip: 0 },
  listen:  { squash: .97, lift: 0, lean: -.16, peak: .35, x: -.06, gx: -.4, gy: .25, blink: 0, wide: 1.06, happy: 0, drip: 0 },
  think:   { squash: 1.03, lift: 0, lean: .1, peak: .9, x: .03, gx: -.6, gy: -.6, blink: 0, wide: 1, happy: 0, drip: 0 },
  work:    { squash: .93, lift: 0, lean: 0, peak: .3, x: 0, gx: .4, gy: .5, blink: 0, wide: 1, happy: 0, drip: 0 },
  success: { squash: 1, lift: 0, lean: 0, peak: .6, x: 0, gx: 0, gy: -.2, blink: 0, wide: 1.05, happy: .8, drip: 0 },
  error:   { squash: .84, lift: 0, lean: .12, peak: .05, x: .02, gx: .1, gy: .7, blink: 0, wide: 1, happy: 0, drip: 1 },
  sleep:   { squash: .62, lift: 0, lean: 0, peak: 0, x: 0, gx: 0, gy: .2, blink: 1, wide: 1, happy: 0, drip: 0 },
  tap:     { squash: .9, lift: 0, lean: 0, peak: .3, x: 0, gx: 0, gy: -.2, blink: 0, wide: 1.1, happy: 0, drip: 0 },
};
export const mount = makeMount({
  id: 'bead', scene: SCENE,
  uniformTypes: { u_body: '3f', u_scale: '3f', u_peak: 'f', u_ring: 'f', u_drip: 'f', u_blink: 'f', u_wide: 'f', u_happy: 'f', u_gaze: '2f' },
  springs: { squash: [110, 12], lift: [70, 10], lean: [60, 11], peak: [40, 9], x: [50, 10], gx: [90, 18], gy: [90, 18], blink: [400, 30], wide: [120, 20], happy: [60, 14], drip: [30, 10] },
  initial: { squash: 1, peak: .25, wide: 1 },
  oneShot: { hello: 1.3, success: 1.9, error: 2.2, tap: .8 },
  onCue(a, st, S) { if (a === 'tap') S.squash.v -= 3.5 * st.energy; st.aux.ring = st.aux.ring || 0; },
  onRelease(st, S) { S.squash.v += 2.2 * st.energy; S.lean.v += st.drag * 6; },
  targets(st, S, h) {
    const a = st.action, e = st.energy, t = st.tA, time = st.time, base = T[a] || T.idle; const g = { ...base };
    const breath = st.reduced ? 0 : Math.sin(time / 6 * TAU);
    st.aux.ring = Math.max(0, (st.aux.ring || 0) - 1.3 / 60); if (st.reduced) st.aux.ring = 0;
    if (a === 'idle') { g.squash += .012 * breath; g.peak += .04 * breath; g.gx += st.reduced ? 0 : .15 * Math.sin(time / 6 * TAU + .7); }
    if (a === 'hello') { if (t < .22) g.squash = .8; else if (t < .6) { g.lift = .55 * e; g.squash = 1.12; g.peak = .8; } if (t > .55 && t < .7) st.aux.ring = 1; }
    if (a === 'listen' && !st.reduced) g.lean += .02 * Math.sin(time * 2.2);
    if (a === 'think' && !st.reduced) { g.lean += .05 * Math.sin(time * 1.3); g.peak += .15 * Math.sin(time * 1.7 + 1); g.gx += .1 * Math.sin(time * .9); }
    if (a === 'work') { const beat = st.reduced ? .5 : (time * 1.6) % 1, s = Math.max(0, Math.sin(beat * Math.PI)); g.squash = .93 - .05 * s; g.lift = .06 * e * Math.max(0, Math.sin(beat * Math.PI - .4)); g.peak = .3 + .5 * s; g.gy = .5 - .6 * s; }
    if (a === 'success') { if (t < .2) g.squash = .74; else if (t < .75) { g.lift = 1.05 * e; g.squash = 1.2; g.peak = .9; } if (t > .72 && t < .9) st.aux.ring = 1; g.happy = t > .4 ? .85 : 0; }
    if (a === 'error' && t > 1.7) { g.squash = 1; g.lean = 0; g.drip = 0; g.gy = 0; }
    if (a === 'sleep' && !st.reduced) g.squash += .012 * breath;
    if (a === 'tap') { if (t < .12) g.squash = .78; else { g.squash = 1.06; g.lift = .12 * e; } }
    if (st.pressed) { g.squash = Math.min(g.squash, .8); g.x += st.drag; g.lean += st.drag * .9; g.gx += st.drag * 2; }
    if (!st.reduced && a !== 'sleep') { st.aux.blinkT = (st.aux.blinkT ?? 3.4) - 1 / 60; if (st.aux.blinkT < 0) st.aux.blinkT = 3.5 + h.rand(Math.floor(time * 10)) * 2.5; if (st.aux.blinkT < .18) g.blink = 1; }
    for (const k in S) S[k].t = g[k];
  },
  uniforms(S, st) {
    const sq = clamp(S.squash.x, .5, 1.6), sxz = 1 / Math.sqrt(sq);
    return { u_body: [S.x.x, Math.max(0, S.lift.x), S.lean.x], u_scale: [sxz, sq, sxz], u_peak: clamp(S.peak.x, 0, 1.2), u_ring: clamp(st.aux.ring || 0, 0, 1), u_drip: clamp(S.drip.x, 0, 1), u_blink: clamp(S.blink.x, 0, 1), u_wide: S.wide.x, u_happy: clamp(S.happy.x, 0, 1), u_gaze: [clamp(S.gx.x, -1, 1), clamp(S.gy.x, -1, 1)] };
  },
});

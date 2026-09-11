/* Round 3 · Inkwell — a squat glass inkwell holding glossy ink; two white bobber eyes float in the ink; a stopper hovers above and seals it in sleep. */
import { makeMount } from '../../raymarch.mjs';
import { clamp, TAU } from '../../ink.mjs';

export const meta = {
  id: 'inkwell', name: 'Inkwell',
  technique: 'raymarched glass well + ink heightfield (rippled disc) + bobber eyes, lit on the shared base',
  tagline: 'a small glass inkwell on the paper; the ink inside is the creature',
  look: 'Squat rounded glass body with a thick rim, faked translucency (fresnel, window highlight, the ink level showing as a dark band), a mirror-black ink surface in the wide mouth, a quiet dark stopper hovering above.',
  motion: 'The ink does the acting: ripples, sloshes, tilts, rises to the brim, runs dry. The well itself only hops, tilts and rocks. Eyes bob on the surface and sink to blink.',
  eyes: 'Two white glossy spheres floating half-submerged in the ink like bobbers; they slide on the surface to follow gaze and duck under to blink. Under the stopper (sleep) two faint glints stand in for them.',
  risks: ['A container is more object than creature', 'Eyes as bobbers might read as bubbles', 'The lid hides the face in sleep', 'Heightfield ripples + glass are two shells to march (cost, overshoot artefacts)'],
  stills: { idle: 2, hello: .5, listen: 1.3, think: 1.6, work: 1.0, success: .8, error: 1.3, sleep: 2.2, tap: .3 },
};

const SCENE = `
// uniforms declared by the base: u_body, u_level, u_rip, u_slosh, u_itilt, u_gaze, u_blink, u_happy, u_lid, u_seal, u_drop, u_leap, u_stain, u_ring, u_dull
float surf(vec2 xz){
  float r = length(xz);
  float h = u_level + u_itilt.x*xz.x + u_itilt.y*xz.y;
  h += u_rip.x * sin(u_rip.y*r - u_rip.z) * exp(-1.6*r);
  h += u_slosh.x * (sin(u_slosh.y)*xz.x*2.2 + 0.45*cos(u_slosh.y*1.7)*(1. - 4.*r*r));
  return h;
}
vec2 map(vec3 p){
  vec3 q = p - vec3(u_body.x, u_body.y, 0.); q.xy = rot(u_body.z) * q.xy;
  // glass shell: rounded body + short neck + rim, hollowed by the cavity and the bore
  vec3 c = q - vec3(0., 0.55, 0.);
  float outer = sdEll(c, vec3(0.82, 0.62, 0.82));
  float neck = sdCylinder(q - vec3(0., 1.0, 0.), 0.14, 0.5);
  float rim = sdTorus(q - vec3(0., 1.12, 0.), vec2(0.45, 0.075));
  float shell = smin(smin(outer, neck, 0.06), rim, 0.04);
  shell = smax(shell, -q.y - 0.02, 0.08);
  float cavity = min(sdEll(c, vec3(0.7, 0.5, 0.7)), sdCylinder(q - vec3(0., 1.1, 0.), 0.35, 0.42));
  float glass = max(shell, -cavity);
  vec2 res = vec2(glass, 3.);
  // ink: cavity clipped by the rippled heightfield
  float ink = max(cavity + 0.015, (q.y - surf(q.xz)) * 0.8);
  if (ink < res.x) res = vec2(ink, 0.);
  // eyes: two bobbers on the surface
  for (int i = 0; i < 2; i++) {
    float side = i == 0 ? -1. : 1.;
    vec2 exz = vec2(side*0.2 + u_gaze.x*0.09, 0.1 - u_gaze.y*0.08);
    float ey = surf(exz) + 0.07 - 0.42*u_blink;
    float er = 0.17;
    vec3 le = q - vec3(exz.x, ey, exz.y);
    float eye = sdEll(le, vec3(er, er*(1. - 0.25*u_happy), er));
    if (eye < res.x) res = vec2(eye, 1.);
    vec3 lp = le - vec3(u_gaze.x*er*0.4, er*0.3 + u_gaze.y*er*0.3, er*0.62);
    float pupil = length(lp) - er*0.5; if (pupil < res.x) res = vec2(pupil, 2.);
  }
  // stopper: disc + dome, resting beside the well; slides onto the neck to seal in sleep; two faint glints where the eyes would be
  float lt = clamp((1.8 - u_lid) / (1.8 - 1.24), 0., 1.);            // 0 = resting beside the well on the paper, 1 = sealed on top
  vec3 lq = q - mix(vec3(1.12, 0.06, 0.35), vec3(0., 1.24, 0.), lt);
  float lid = smin(sdCylinder(lq, 0.05, 0.36), sdEll(lq - vec3(0., 0.07, 0.), vec3(0.26, 0.17, 0.26)), 0.08);
  if (lid < res.x) res = vec2(lid, 4.);
  float gl = 0.055 * u_seal;
  float glint = min(length(lq - vec3(-0.16, 0.05, 0.33)) - gl, length(lq - vec3(0.16, 0.05, 0.33)) - gl);
  if (glint < res.x) res = vec2(glint, 1.);
  // falling drop (work) and leaping drop (success)
  if (u_drop.y > 0.01) { float d = length(q - vec3(0., u_drop.x, 0.)) - 0.11*u_drop.y; if (d < res.x) res = vec2(d, 0.); }
  if (u_leap.z > 0.01) { float d = length(p - vec3(u_leap.x, u_leap.y, 0.3)) - 0.11*u_leap.z; if (d < res.x) res = vec2(d, 0.); }
  return res;
}
vec3 material(float id, vec3 p, vec3 n, vec3 rd, vec3 light, float diff, float spec, float window, float fres){
  vec3 hv = normalize(light - rd);
  float gloss = 1. - 0.8*u_dull;
  if (id < 0.5) return u_ink * (0.55 + 0.45*diff) + vec3(0.2)*fres*gloss + vec3(0.9, 0.9, 0.86)*spec*0.9*gloss + vec3(0.32)*window*0.8*gloss;
  if (id < 1.5) return vec3(0.97, 0.96, 0.93) * (0.72 + 0.28*diff) + vec3(0.6)*spec*0.5;
  if (id < 2.5) return vec3(0.06, 0.06, 0.05) + vec3(1.)*pow(clamp(dot(n, hv), 0., 1.), 40.)*0.95 + vec3(0.2)*window;
  if (id < 3.5) {
    // glass: paper seen through, the ink level as a dark band, edges catch fresnel + a window
    float ly = p.y - u_body.y;
    float band = 1. - smoothstep(-0.12, 0.04, ly - surf(vec2(0.)));
    band *= smoothstep(0.02, 0.1, ly);
    vec3 through = mix(u_paper * vec3(0.9, 0.93, 0.92), u_ink*0.5 + u_paper*0.3, band*0.72);
    return through * (0.8 + 0.2*diff) + vec3(0.35)*fres + vec3(0.7)*spec*0.9 + vec3(0.5)*window;
  }
  return vec3(0.42, 0.36, 0.3) * (0.6 + 0.4*diff) + vec3(0.08)*fres;
}
float paperInk(vec3 p){
  vec2 xz = p.xz - vec2(u_body.x, 0.);
  float rr = length(xz);
  float ring = u_ring * (1. - smoothstep(0.0, 0.14, abs(rr - (0.92 + 0.4*(1. - u_ring))))) * 0.4;
  float base = u_stain.y * (1. - smoothstep(0.7, 0.78 + 0.45*u_stain.y, rr + 0.08*sin(atan(xz.y, xz.x)*5.))) * 0.5;
  float leap = u_stain.x * (1. - smoothstep(0.08, 0.16 + 0.1*u_stain.x, length(p.xz - vec2(1.15, 0.3)))) * 0.75;
  return max(ring, max(base, leap));
}`;

const LIDUP = 1.8, LIDDOWN = 1.24;
const T = {
  idle:    { lift: 0, lean: 0, x: 0, level: 1, rip: .012, gx: 0, gy: 0, blink: 0, happy: 0, lid: LIDUP, seal: 0, itx: 0, itz: 0, dull: 0 },
  hello:   { lift: 0, lean: -.05, x: 0, level: 1, rip: .012, gx: 0, gy: -.3, blink: 0, happy: 0, lid: LIDUP, seal: 0, itx: 0, itz: 0, dull: 0 },
  listen:  { lift: 0, lean: -.14, x: -.05, level: 1, rip: .01, gx: -.3, gy: -.2, blink: 0, happy: 0, lid: LIDUP + .1, seal: 0, itx: -.06, itz: -.1, dull: 0 },
  think:   { lift: 0, lean: .05, x: .02, level: 1, rip: .05, gx: -.7, gy: .7, blink: 0, happy: 0, lid: LIDUP, seal: 0, itx: 0, itz: 0, dull: 0 },
  work:    { lift: 0, lean: 0, x: 0, level: 1, rip: .03, gx: 0, gy: .6, blink: 0, happy: 0, lid: LIDUP + .3, seal: 0, itx: 0, itz: 0, dull: 0 },
  success: { lift: 0, lean: 0, x: 0, level: 1.22, rip: .02, gx: 0, gy: .2, blink: 0, happy: .9, lid: LIDUP + .2, seal: 0, itx: 0, itz: 0, dull: 0 },
  error:   { lift: 0, lean: .06, x: .02, level: .45, rip: .004, gx: .1, gy: -.6, blink: 0, happy: 0, lid: LIDUP - .2, seal: 0, itx: 0, itz: 0, dull: 1 },
  sleep:   { lift: 0, lean: 0, x: 0, level: .95, rip: 0, gx: 0, gy: -.2, blink: 1, happy: 0, lid: LIDDOWN, seal: 1, itx: 0, itz: 0, dull: .4 },
  tap:     { lift: 0, lean: 0, x: 0, level: 1, rip: .012, gx: 0, gy: -.2, blink: 0, happy: 0, lid: LIDUP, seal: 0, itx: 0, itz: 0, dull: 0 },
};
export const mount = makeMount({
  id: 'inkwell', scene: SCENE,
  uniformTypes: { u_body: '3f', u_level: 'f', u_rip: '3f', u_slosh: '2f', u_itilt: '2f', u_gaze: '2f', u_blink: 'f', u_happy: 'f', u_lid: 'f', u_seal: 'f', u_drop: '2f', u_leap: '3f', u_stain: '2f', u_ring: 'f', u_dull: 'f' },
  springs: { lift: [90, 11], lean: [50, 9], x: [50, 10], level: [30, 9], rip: [40, 10], gx: [90, 18], gy: [90, 18], blink: [400, 30], happy: [60, 14], lid: [25, 9], seal: [40, 12], itx: [50, 10], itz: [50, 10], dull: [20, 8] },
  initial: { level: 1, rip: .012, lid: LIDUP },
  oneShot: { hello: 1.4, success: 2.1, error: 2.4, tap: .9 },
  onCue(a, st, S) {
    st.aux.ring = st.aux.ring || 0; st.aux.slosh = st.aux.slosh || 0; st.aux.leapStain = st.aux.leapStain || 0;
    if (a === 'tap') { st.aux.slosh = 1; S.lift.v += 1.2 * st.energy; st.aux.ring = 1; }
    if (a === 'hello') { st.aux.slosh = .8; }
    if (a !== 'success') st.aux.leapStain = 0;
  },
  onRelease(st, S) { S.lean.v += st.drag * 7; st.aux.slosh = Math.min(1, Math.abs(st.drag) * 3 + .3); },
  targets(st, S, h) {
    const a = st.action, e = st.energy, t = st.tA, time = st.time, base = T[a] || T.idle; const g = { ...base };
    const breath = st.reduced ? 0 : Math.sin(time / 6 * TAU);
    st.aux.ring = Math.max(0, (st.aux.ring || 0) - 1.4 / 60);
    st.aux.slosh = Math.max(0, (st.aux.slosh || 0) - 1.1 / 60);
    st.aux.leapStain = Math.max(0, Math.min(1, (st.aux.leapStain || 0) + (st.aux.leapGrow ? 2.5 / 60 : 0)));
    st.aux.baseStain = Math.max(0, (st.aux.baseStain || 0) - (a === 'error' ? 0 : 1.5 / 60));
    st.aux.drop = [0, 0]; st.aux.leap = [0, 0, 0]; st.aux.leapGrow = false;
    if (st.reduced) { st.aux.ring = 0; st.aux.slosh = 0; st.aux.phase = 0; st.aux.ripF = 6; }
    else { st.aux.phase = time * (a === 'think' ? 5 : 2.2); st.aux.ripF = a === 'think' ? 11 : 7; }
    if (a === 'idle') { g.rip += .006 * breath; g.gx += st.reduced ? 0 : .12 * Math.sin(time / 6 * TAU + .7); g.lid += .03 * breath; }
    if (a === 'hello') { if (t > .12 && t < .42) g.lift = .22 * e; if (t > .3 && t < .5) st.aux.ring = Math.max(st.aux.ring, 1); g.rip = t < .8 ? .09 : .02; }
    if (a === 'listen' && !st.reduced) g.lean += .015 * Math.sin(time * 2.2);
    if (a === 'think') { const ph = st.reduced ? .5 : (time % 2) / 2; g.rip = .07 * Math.exp(-2.2 * ph); st.aux.phase = st.reduced ? 4 : ph * 2 * 7 + Math.floor(time / 2) * 14; if (!st.reduced) g.gx += .08 * Math.sin(time * .9); }
    if (a === 'work') { const beat = st.reduced ? .45 : (t * 1.4) % 1; const fall = Math.min(1, beat / .82); st.aux.drop = [1.98 - .8 * fall * fall, beat < .82 ? 1 : 0]; if (beat > .82) { st.aux.ring = Math.max(st.aux.ring, .9); g.rip = .1; } g.gy = .6 - .5 * fall; }
    if (a === 'success') { g.level = t < .4 ? 1.22 : 1.05; if (t > .35 && t < 1.15) { const u = (t - .35) / .8; st.aux.leap = [1.15 * u, 1.2 + 1.3 * u * (1 - u) * 2 - .05, 1]; } if (t > 1.1) { st.aux.leapGrow = true; if (t < 1.25) st.aux.ring = Math.max(st.aux.ring, .6); } g.gy = t > .5 ? .25 : -.2; }
    if (a === 'error') { st.aux.baseStain = Math.min(1, (st.aux.baseStain || 0) + 1 / 60 / 1.2); if (t > 2.0) { g.level = 1; g.dull = 0; g.gy = 0; g.lean = 0; } }
    if (a === 'sleep' && !st.reduced) { g.lid += .02 * breath; g.lean += .006 * breath; }
    if (a === 'tap' && t < .15) g.lift = .1 * e;
    if (st.pressed) { g.x += st.drag * .6; g.lean += st.drag * 1.2; g.itx += st.drag * .5; g.gx += st.drag * 2; g.lift = Math.max(g.lift, .02); }
    if (!st.reduced && a !== 'sleep') { st.aux.blinkT = (st.aux.blinkT ?? 3.4) - 1 / 60; if (st.aux.blinkT < 0) st.aux.blinkT = 3.5 + h.rand(Math.floor(time * 10)) * 2.5; if (st.aux.blinkT < .2) g.blink = 1; }
    for (const k in S) S[k].t = g[k];
  },
  uniforms(S, st) {
    const slosh = st.aux.slosh || 0;
    return {
      u_body: [S.x.x, Math.max(0, S.lift.x), S.lean.x], u_level: clamp(S.level.x, .3, 1.25),
      u_rip: [clamp(S.rip.x, 0, .15), st.aux.ripF || 7, st.aux.phase || 0],
      u_slosh: [slosh * slosh * .09, st.reduced ? 0 : st.time * 13], u_itilt: [S.itx.x, S.itz.x],
      u_gaze: [clamp(S.gx.x, -1, 1), clamp(S.gy.x, -1, 1)], u_blink: clamp(S.blink.x, 0, 1), u_happy: clamp(S.happy.x, 0, 1),
      u_lid: clamp(S.lid.x, LIDDOWN, 2.6), u_seal: clamp(S.seal.x, 0, 1),
      u_drop: st.aux.drop || [0, 0], u_leap: st.aux.leap || [0, 0, 0],
      u_stain: [clamp(st.aux.leapStain || 0, 0, 1), clamp(st.aux.baseStain || 0, 0, 1)], u_ring: clamp(st.aux.ring || 0, 0, 1), u_dull: clamp(S.dull.x, 0, 1),
    };
  },
  tilt: .6, steps: { hero: 72, small: 48 }, heroScale: .62,
});

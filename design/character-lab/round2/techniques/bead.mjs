/* Round 2 · technique 05 — Ink bead. A drop of wet ink sitting on the paper, raymarched in 3D (WebGL fragment shader).
 * Not a drawing of ink: a glossy black bead with real highlights, a contact shadow on the paper and two eyes set into the surface.
 * Motion: critically-damped springs pull squash / lift / lean / peak toward per-moment targets, so every move overshoots and settles like a heavy drop.
 * Touch: press squashes the bead, drag pulls it (it leans after the finger), release lets it spring back with a bounce.
 */
import * as ink from '../../ink.mjs';
import { ACTION_IDS } from '../../actions.mjs';
const { clamp, mix, TAU } = ink;

export const meta = {
  id: 'bead', name: 'Ink bead',
  technique: 'GLSL raymarched signed-distance bead (WebGL) with glossy wet shading, contact shadow and embedded eyes; JS springs drive the shape uniforms',
  tagline: 'a bead of wet ink sitting on the paper, lit like a real object',
  look: 'A glossy near-black drop with a soft window highlight, a flat wet base and a faint contact shadow; a small crown peak where it was poured; two eyes set into the surface like enamel.',
  motion: 'Nothing is keyframed. Squash, lift, lean and peak are springs toward simple targets, so a hello overshoots, a landing wobbles, sleep sinks into a puddle. Touch presses into the surface and the bead leans after your finger.',
  eyes: 'Two white spheres embedded in the bead with dark glossy pupils and a highlight from the same light — they read as eyes because they catch the light like the body does.',
  risks: ['Glossy 3D can feel like a toy or a CG blob, not ink on paper', 'Raymarching costs GPU: hero is rendered at reduced internal resolution', 'Perspective-free orthographic view may look flat at tiny sizes', 'Software WebGL (CI) is slow; real devices vary'],
  stills: { idle: 2, hello: .45, listen: 1.4, think: 1.5, work: 1.1, success: .75, error: 1.1, sleep: 2, tap: .22 },
};

const VS = 'attribute vec2 a; void main(){ gl_Position = vec4(a,0.,1.); }';
const FS = `
precision highp float;
uniform vec2 u_res; uniform float u_R; uniform vec2 u_foot; uniform float u_time; uniform float u_steps;
uniform vec3 u_body;   // x offset (R), lift (R), lean (rad)
uniform vec3 u_scale;  // sx, sy, sz
uniform float u_peak, u_ring, u_drip, u_blink, u_wide, u_happy, u_grain;
uniform vec2 u_gaze; uniform vec3 u_ink, u_paper;
const float TILT = 0.5;
float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float smin(float a, float b, float k){ float h = clamp(0.5+0.5*(b-a)/k,0.,1.); return mix(b,a,h)-k*h*(1.-h); }
float smax(float a, float b, float k){ return -smin(-a,-b,k); }
float sdEll(vec3 p, vec3 r){ float k0 = length(p/r); float k1 = length(p/(r*r)); return k0*(k0-1.)/max(k1,1e-4); }
mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
// returns distance and material: 0 body, 1 eye white, 2 pupil
vec2 map(vec3 p){
  vec3 q = p - vec3(u_body.x, 0., 0.);
  q.xy = rot(u_body.z) * q.xy;                     // lean about the contact point
  float rb = 0.85; vec3 sc = u_scale * rb;
  vec3 c = vec3(0., sc.y + u_body.y, 0.);          // centre: bottom touches the paper at lift 0
  vec3 l = q - c;
  float body = sdEll(l, sc);
  body = smax(body, -(p.y) - 0.02, 0.12);          // flat wet base on the paper
  vec3 pk = l - vec3(-0.18*sc.x, 0.86*sc.y, 0.);
  float peak = sdEll(pk, vec3(0.2, 0.1 + 0.45*u_peak, 0.2)*rb);
  body = smin(body, peak, 0.22);
  if (u_drip > 0.001) { vec3 dd = l - vec3(0.42*sc.x, -sc.y + 0.02, 0.55 + 0.35*u_drip); float drip = sdEll(dd, vec3(0.13, 0.025, 0.1 + 0.42*u_drip)*rb); body = smin(body, drip, 0.12); }
  vec2 res = vec2(body, 0.);
  // eyes: set into the front surface, low on the face
  for (int i = 0; i < 2; i++) {
    float side = i == 0 ? -1. : 1.;
    vec3 e = c + vec3(side*0.34*sc.x, -0.08*sc.y, 0.80*sc.z);
    vec3 le = q - e;
    float open = max(0.06, 1. - u_blink);
    float er = 0.235*rb*u_wide;
    vec3 er3 = vec3(er, er*open*(1. - 0.3*u_happy), er);
    float eye = sdEll(le, er3);
    if (eye < res.x) res = vec2(eye, 1.);
    vec3 lp = le - vec3(u_gaze.x*er*0.45, u_gaze.y*er*0.35 - 0.02*rb, er*0.62);
    float pupil = length(lp) - er*0.55*open;
    if (pupil < res.x) res = vec2(pupil, 2.);
  }
  return res;
}
vec3 normal(vec3 p){ vec2 e = vec2(0.002, -0.002); return normalize(e.xyy*map(p+e.xyy).x + e.yyx*map(p+e.yyx).x + e.yxy*map(p+e.yxy).x + e.xxx*map(p+e.xxx).x); }
float occlusion(vec3 p){ float o = 0., h = 0.06; for (int i = 0; i < 6; i++){ float d = map(p + vec3(0., h, 0.)).x; o += (h - d) / h; h *= 1.7; } return clamp(1. - 0.25*o, 0., 1.); }
float shadow(vec3 p, vec3 l){ float t = 0.05, s = 1.; for (int i = 0; i < 14; i++){ float d = map(p + l*t).x; s = min(s, 10.*d/t); t += clamp(d, 0.04, 0.3); if (s < 0.01 || t > 4.) break; } return clamp(s, 0., 1.); }
void main(){
  float sx = (gl_FragCoord.x - u_foot.x) / u_R, sy = (gl_FragCoord.y - (u_res.y - u_foot.y)) / u_R;
  float ct = cos(TILT), st = sin(TILT);
  vec3 f = vec3(0., -st, -ct), r = vec3(1., 0., 0.), u = vec3(0., ct, -st);
  vec3 ro = r*sx + u*sy - f*6.0, rd = f;
  vec3 light = normalize(vec3(-0.55, 1.0, 0.75));
  float tPlane = -ro.y / rd.y;
  float t = 0.; vec2 h = vec2(1e3, -1.); bool hit = false;
  for (int i = 0; i < 80; i++) { if (float(i) >= u_steps) break; vec3 p = ro + rd*t; h = map(p); if (h.x < 0.0025) { hit = true; break; } t += h.x*0.9; if (t > tPlane + 0.02) break; }
  vec3 col;
  if (hit) {
    vec3 p = ro + rd*t, n = normal(p);
    float diff = clamp(dot(n, light), 0., 1.);
    vec3 hv = normalize(light - rd);
    float spec = pow(clamp(dot(n, hv), 0., 1.), 60.);
    vec3 refl = reflect(rd, n);
    float window = smoothstep(0.35, 0.9, refl.y) * smoothstep(0.9, 0.2, abs(refl.x + 0.35)); // a soft window reflection
    float fres = pow(1. - clamp(dot(n, -rd), 0., 1.), 3.);
    if (h.y < 0.5) {            // wet ink
      col = u_ink * (0.55 + 0.45*diff) + vec3(0.22)*fres + vec3(0.9, 0.9, 0.86)*spec*0.9 + vec3(0.32)*window*0.8;
    } else if (h.y < 1.5) {     // eye white (enamel)
      col = vec3(0.97, 0.96, 0.93) * (0.72 + 0.28*diff) + vec3(0.6)*spec*0.5;
    } else {                    // pupil
      col = vec3(0.06, 0.06, 0.05) + vec3(1.)*pow(clamp(dot(n, hv), 0., 1.), 40.)*0.95 + vec3(0.2)*window;
    }
    col *= 0.85 + 0.15*occlusion(p);
  } else {
    vec3 p = ro + rd*tPlane;
    float g = hash(floor(gl_FragCoord.xy*0.9)) ; float grain = 1. - u_grain*(g - 0.5);
    col = u_paper * grain;
    float ao = occlusion(p + vec3(0., 0.002, 0.));
    float sh = mix(1., shadow(p + vec3(0., 0.01, 0.), light), 0.7);
    col *= 0.72 + 0.28*min(ao, sh);
    // landing / bleed ring around the contact point
    float rr = length(vec2((p.x - u_body.x)/max(u_scale.x, 0.4), p.z/max(u_scale.z, 0.4)));
    float ring = u_ring * (1. - smoothstep(0.0, 0.16, abs(rr - (0.95 + 0.35*(1. - u_ring))))) * 0.35;
    col = mix(col, u_ink, ring * (0.6 + 0.4*hash(floor(gl_FragCoord.xy*0.5))));
  }
  gl_FragColor = vec4(col, 1.);
}`;

let SHARED = null;
function sharedGL() {
  if (SHARED !== null) return SHARED || null;
  try {
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const gl = c.getContext('webgl', { antialias: false, preserveDrawingBuffer: true, alpha: false, premultipliedAlpha: false });
    if (!gl) { SHARED = false; return null; }
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('bead shader: ' + gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('bead link: ' + gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    const loc = {}; for (const n of ['u_res', 'u_R', 'u_foot', 'u_time', 'u_steps', 'u_body', 'u_scale', 'u_peak', 'u_ring', 'u_drip', 'u_blink', 'u_wide', 'u_happy', 'u_grain', 'u_gaze', 'u_ink', 'u_paper']) loc[n] = gl.getUniformLocation(prog, n);
    SHARED = { canvas: c, gl, prog, loc };
  } catch (e) { console.warn(e.message); SHARED = false; return null; }
  return SHARED;
}
const TARGETS = {
  idle:    { squash: 1, lift: 0, lean: 0, peak: .25, x: 0, gaze: [0, 0], blink: 0, wide: 1, happy: 0, drip: 0 },
  hello:   { squash: .86, lift: 0, lean: -.08, peak: .5, x: 0, gaze: [0, -.3], blink: 0, wide: 1.08, happy: 0, drip: 0 },
  listen:  { squash: .97, lift: 0, lean: -.16, peak: .35, x: -.06, gaze: [-.4, .25], blink: 0, wide: 1.06, happy: 0, drip: 0 },
  think:   { squash: 1.03, lift: 0, lean: .1, peak: .9, x: .03, gaze: [-.6, -.6], blink: 0, wide: 1, happy: 0, drip: 0 },
  work:    { squash: .93, lift: 0, lean: 0, peak: .3, x: 0, gaze: [.4, .5], blink: 0, wide: 1, happy: 0, drip: 0 },
  success: { squash: 1, lift: 0, lean: 0, peak: .6, x: 0, gaze: [0, -.2], blink: 0, wide: 1.05, happy: .8, drip: 0 },
  error:   { squash: .84, lift: 0, lean: .12, peak: .05, x: .02, gaze: [.1, .7], blink: 0, wide: 1, happy: 0, drip: 1 },
  sleep:   { squash: .62, lift: 0, lean: 0, peak: 0, x: 0, gaze: [0, .2], blink: 1, wide: 1, happy: 0, drip: 0 },
  tap:     { squash: .9, lift: 0, lean: 0, peak: .3, x: 0, gaze: [0, -.2], blink: 0, wide: 1.1, happy: 0, drip: 0 },
};
const ONE_SHOT = { hello: 1.3, success: 1.9, error: 2.2, tap: .8 };
const rgb = css => { const m = /^#([0-9a-f]{6})$/i.exec(css || ''); if (!m) return [0.086, 0.082, 0.078]; const n = parseInt(m[1], 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

export function mount(host, { R = 96, seed = 1, tint = null, reduced = false, energy = 1, size = 'hero', paper = true } = {}) {
  const W = Math.round(3.4 * R), H = Math.round(3.6 * R);
  host.style.width = W + 'px'; host.style.height = H + 'px'; host.style.position = 'relative';
  const scale = size === 'hero' ? .62 : 1;                           // internal resolution: raymarching is per pixel
  const iw = Math.round(W * scale), ih = Math.round(H * scale);
  const canvas = document.createElement('canvas'); canvas.width = iw; canvas.height = ih;
  canvas.style.cssText = `display:block;width:${W}px;height:${H}px;touch-action:none;image-rendering:auto`;
  host.appendChild(canvas);
  const ctx2d = canvas.getContext('2d');
  const shared = sharedGL();                                          // ONE WebGL context for every instance (browsers cap live contexts at ~16)
  const gl = shared?.gl, loc = shared?.loc || {};
  const fallback = gl ? null : ctx2d;

  // ---- dynamics -----------------------------------------------------------
  const st = { reduced, energy: clamp(energy, .5, 1.5), tint, action: 'idle', tA: 0, time: 0, pressed: false, drag: 0, dragY: 0, ring: 0, blinkT: 3.2 + ink.rand(seed, 1) * 2 };
  const spring = (x, v = 0) => ({ x, v, t: x });
  const S = { squash: spring(1), lift: spring(0), lean: spring(0), peak: spring(.25), x: spring(0), gx: spring(0), gy: spring(0), blink: spring(0), wide: spring(1), happy: spring(0), drip: spring(0) };
  const K = { squash: [110, 12], lift: [70, 10], lean: [60, 11], peak: [40, 9], x: [50, 10], gx: [90, 18], gy: [90, 18], blink: [400, 30], wide: [120,20], happy: [60, 14], drip: [30, 10] };
  function integrate(dt) {
    for (const k in S) { const s = S[k]; if (st.reduced) { s.x = s.t; s.v = 0; continue; } const [kk, c] = K[k]; s.v += (kk * (s.t - s.x) - c * s.v) * dt; s.x += s.v * dt; }
  }
  function targets() {
    const a = st.action, T = TARGETS[a] || TARGETS.idle, e = st.energy, t = st.tA, time = st.time;
    let squash = T.squash, lift = T.lift, lean = T.lean, peak = T.peak, x = T.x, gx = T.gaze[0], gy = T.gaze[1], blink = T.blink, wide = T.wide, happy = T.happy, drip = T.drip;
    const breath = st.reduced ? 0 : Math.sin(time / 6 * TAU);
    if (a === 'idle') { squash += .012 * breath; peak += .04 * breath; gx += .15 * Math.sin(time / 6 * TAU + .7) * (st.reduced ? 0 : 1); }
    if (a === 'hello') { if (t < .22) squash = .8; else if (t < .6) { lift = .55 * e; squash = 1.12; peak = .8; } else { lift = 0; } if (t > .55 && t < .7) st.ring = 1; }
    if (a === 'listen' && !st.reduced) { lean += .02 * Math.sin(time * 2.2); }
    if (a === 'think' && !st.reduced) { lean += .05 * Math.sin(time * 1.3); peak += .15 * Math.sin(time * 1.7 + 1); gx += .1 * Math.sin(time * .9); }
    if (a === 'work') { const beat = st.reduced ? .5 : (time * 1.6) % 1; squash = .93 - .05 * Math.max(0, Math.sin(beat * Math.PI)) ; lift = .06 * e * Math.max(0, Math.sin(beat * Math.PI - .4)); peak = .3 + .5 * Math.max(0, Math.sin(beat * Math.PI)); gy = .5 - .6 * Math.max(0, Math.sin(beat * Math.PI)); }
    if (a === 'success') { if (t < .2) squash = .74; else if (t < .75) { lift = 1.05 * e; squash = 1.2; peak = .9; } else { lift = 0; } if (t > .72 && t < .9) st.ring = 1; happy = t > .4 ? .85 : 0; }
    if (a === 'error') { if (t < .3) drip = 0; if (t > 1.7) { squash = 1; lean = 0; drip = 0; gy = 0; } }
    if (a === 'sleep' && !st.reduced) { squash += .012 * breath; }
    if (a === 'tap') { if (t < .12) squash = .78; else { squash = 1.06; lift = .12 * e; } }
    if (st.pressed) { squash = Math.min(squash, .8); x += st.drag; lean += st.drag * .9; gx += st.drag * 2; }
    // blink timer
    if (!st.reduced && a !== 'sleep') { st.blinkT -= 1 / 60; if (st.blinkT < 0) { st.blinkT = 3.5 + ink.rand(seed, Math.floor(time * 10)) * 2.5; } blink = st.blinkT < .18 ? 1 : blink; }
    Object.assign(S.squash, { t: squash }); S.lift.t = lift; S.lean.t = lean; S.peak.t = peak; S.x.t = x; S.gx.t = gx; S.gy.t = gy; S.blink.t = blink; S.wide.t = wide; S.happy.t = happy; S.drip.t = drip;
  }
  function draw() {
    const sq = clamp(S.squash.x, .5, 1.6), sxz = 1 / Math.sqrt(sq);
    if (!gl) { // no WebGL: honest flat fallback so the lab still shows something
      const ctx = fallback; ctx.setTransform(1, 0, 0, 1, 0, 0); ink.paper(ctx, W, H, { grain: 0 }); ctx.save(); ctx.translate(1.7 * R + S.x.x * R, 3.1 * R - S.lift.x * R); ctx.scale(sxz, sq); ctx.translate(0, -.66 * R);
      ink.fuzzyFill(ctx, ink.blobPoints(R, { seed, rough: .02, round: .6 }), { color: ink.inkColor(st.tint), R, soft: 0, tufts: 0 }); ink.eyes(ctx, R, { blink: S.blink.x, eyeX: S.gx.x, eyeY: S.gy.x }, { ink: ink.inkColor(st.tint) }); ctx.restore(); return;
    }
    const sc = shared.canvas; if (sc.width < iw || sc.height < ih) { sc.width = Math.max(sc.width, iw); sc.height = Math.max(sc.height, ih); }
    gl.viewport(0, 0, iw, ih);
    gl.uniform2f(loc.u_res, iw, ih); gl.uniform1f(loc.u_R, R * scale); gl.uniform2f(loc.u_foot, 1.7 * R * scale, 3.1 * R * scale);
    gl.uniform1f(loc.u_time, st.reduced ? 0 : st.time); gl.uniform1f(loc.u_steps, size === 'hero' ? 72 : 48);
    gl.uniform3f(loc.u_body, S.x.x, Math.max(0, S.lift.x), S.lean.x); gl.uniform3f(loc.u_scale, sxz, sq, sxz);
    gl.uniform1f(loc.u_peak, clamp(S.peak.x, 0, 1.2)); gl.uniform1f(loc.u_ring, clamp(st.ring, 0, 1)); gl.uniform1f(loc.u_drip, clamp(S.drip.x, 0, 1));
    gl.uniform1f(loc.u_blink, clamp(S.blink.x, 0, 1)); gl.uniform1f(loc.u_wide, S.wide.x); gl.uniform1f(loc.u_happy, clamp(S.happy.x, 0, 1)); gl.uniform1f(loc.u_grain, paper ? (size === 'hero' ? .05 : 0) : 0);
    gl.uniform2f(loc.u_gaze, clamp(S.gx.x, -1, 1), clamp(S.gy.x, -1, 1));
    const c = rgb(st.tint); gl.uniform3f(loc.u_ink, c[0], c[1], c[2]); gl.uniform3f(loc.u_paper, .953, .941, .918);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // blit the bottom-left iw×ih region of the shared canvas into this instance's 2D canvas
    ctx2d.setTransform(1, 0, 0, 1, 0, 0); ctx2d.drawImage(sc, 0, sc.height - ih, iw, ih, 0, 0, iw, ih);
  }
  const ctl = {
    cue(a) { if (!ACTION_IDS.includes(a)) return; st.action = a; st.tA = 0; if (a === 'tap') { S.squash.v -= 3.5 * st.energy; } },
    step(dt) {
      dt = clamp(dt, 0, .1); if (!st.reduced) { st.time += dt; } st.tA += dt;
      st.ring = st.reduced ? 0 : Math.max(0, st.ring - dt * 1.3);
      const oneShot = ONE_SHOT[st.action]; if (oneShot && st.tA > (st.reduced ? Math.min(oneShot, 1.2) : oneShot)) { st.action = 'idle'; st.tA = 0; }
      targets(); integrate(dt); draw();
    },
    setReduced(v) { st.reduced = !!v; }, setEnergy(e) { st.energy = clamp(e, .5, 1.5); }, setTint(c) { st.tint = c; },
    poke(x, y, kind) {
      const fx = 1.7 * R;
      if (kind === 'down') { st.pressed = true; st.drag = 0; st.px = x; }
      else if (kind === 'move' && st.pressed) { st.drag = clamp((x - st.px) / R * .5, -.3, .3); }
      else if (kind === 'up') { if (st.pressed) { S.squash.v += 2.2 * st.energy; S.lean.v += st.drag * 6; } st.pressed = false; st.drag = 0; }
      else if (kind === 'tap') ctl.cue('tap');
    },
    destroy() { host.removeEventListener('pointerdown', onDown); host.removeEventListener('pointermove', onMove); host.removeEventListener('pointerup', onUp); host.removeEventListener('pointercancel', onUp); canvas.remove(); },
  };
  const pos = e => { const r = host.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const onDown = e => { const [x, y] = pos(e); ctl.poke(x, y, 'down'); host.setPointerCapture?.(e.pointerId); e.preventDefault(); };
  const onMove = e => { if (!st.pressed) return; const [x, y] = pos(e); ctl.poke(x, y, 'move'); };
  const onUp = e => { const [x, y] = pos(e); ctl.poke(x, y, 'up'); };
  host.addEventListener('pointerdown', onDown); host.addEventListener('pointermove', onMove); host.addEventListener('pointerup', onUp); host.addEventListener('pointercancel', onUp);
  targets(); for (const k in S) { S[k].x = S[k].t; } draw();
  return ctl;
}

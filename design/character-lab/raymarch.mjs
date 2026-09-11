/* Shared raymarching base for round-3 techniques (lit 3D objects on the paper, WebGL fragment shader).
 * One WebGL context for all instances (browsers cap ~16); each instance owns a 2D canvas and blits the render into it.
 * A technique supplies: GLSL scene code (map + material + optional paperInk), custom uniforms, spring set, a targets() function
 * and a uniforms() mapper. The base supplies camera, lights, march loop, AO, soft shadow, paper, blit, springs, pointer handling.
 */
import * as ink from './ink.mjs';
import { ACTION_IDS } from './actions.mjs';
const { clamp } = ink;

const VS = 'attribute vec2 a; void main(){ gl_Position = vec4(a,0.,1.); }';
export const GLSL_HELPERS = `
float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float hash3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vnoise(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(mix(hash3(i), hash3(i+vec3(1,0,0)), f.x), mix(hash3(i+vec3(0,1,0)), hash3(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash3(i+vec3(0,0,1)), hash3(i+vec3(1,0,1)), f.x), mix(hash3(i+vec3(0,1,1)), hash3(i+vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p){ float v = 0., a = .5; for (int i = 0; i < 3; i++){ v += a*vnoise(p); p = p*2.03 + 17.1; a *= .5; } return v; }
float smin(float a, float b, float k){ float h = clamp(0.5+0.5*(b-a)/k,0.,1.); return mix(b,a,h)-k*h*(1.-h); }
float smax(float a, float b, float k){ return -smin(-a,-b,k); }
float sdSphere(vec3 p, float r){ return length(p) - r; }
float sdEll(vec3 p, vec3 r){ float k0 = length(p/r); float k1 = length(p/(r*r)); return k0*(k0-1.)/max(k1,1e-4); }
float sdBox(vec3 p, vec3 b){ vec3 q = abs(p) - b; return length(max(q,0.)) + min(max(q.x,max(q.y,q.z)),0.); }
float sdCapsule(vec3 p, vec3 a, vec3 b, float r){ vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa,ba)/dot(ba,ba), 0., 1.); return length(pa - ba*h) - r; }
float sdTorus(vec3 p, vec2 t){ vec2 q = vec2(length(p.xz)-t.x, p.y); return length(q)-t.y; }
float sdCylinder(vec3 p, float h, float r){ vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h); return min(max(d.x,d.y),0.) + length(max(d,0.)); }
mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
`;
// The technique's scene must define:  vec2 map(vec3 p)  → (distance, material id)
//   vec3 material(float id, vec3 p, vec3 n, vec3 rd, vec3 light, float diff, float spec, float window, float fres)
//   float paperInk(vec3 p)  → 0..1 extra ink on the paper at world point p (stains, rings, puddles); return 0. if none
//   optional: #define MAX_STEPS / tweak via u_steps
function buildFS(customUniforms, scene) {
  return `precision highp float;
uniform vec2 u_res; uniform float u_R; uniform vec2 u_foot; uniform float u_time; uniform float u_steps; uniform float u_grain; uniform float u_tilt;
uniform vec3 u_ink; uniform vec3 u_paper;
${customUniforms}
${GLSL_HELPERS}
${scene}
vec3 calcNormal(vec3 p){ vec2 e = vec2(0.002, -0.002); return normalize(e.xyy*map(p+e.xyy).x + e.yyx*map(p+e.yyx).x + e.yxy*map(p+e.yxy).x + e.xxx*map(p+e.xxx).x); }
float occlusion(vec3 p, vec3 n){ float o = 0., h = 0.06; for (int i = 0; i < 6; i++){ float d = map(p + n*h).x; o += (h - d) / h; h *= 1.7; } return clamp(1. - 0.25*o, 0., 1.); }
float softShadow(vec3 p, vec3 l){ float t = 0.05, s = 1.; for (int i = 0; i < 14; i++){ float d = map(p + l*t).x; s = min(s, 10.*d/t); t += clamp(d, 0.04, 0.3); if (s < 0.01 || t > 4.) break; } return clamp(s, 0., 1.); }
void main(){
  float sx = (gl_FragCoord.x - u_foot.x) / u_R, sy = (gl_FragCoord.y - (u_res.y - u_foot.y)) / u_R;
  float ct = cos(u_tilt), st = sin(u_tilt);
  vec3 f = vec3(0., -st, -ct), r = vec3(1., 0., 0.), u = vec3(0., ct, -st);
  vec3 ro = r*sx + u*sy - f*6.0, rd = f;
  vec3 light = normalize(vec3(-0.55, 1.0, 0.75));
  float tPlane = -ro.y / rd.y;
  float t = 0.; vec2 h = vec2(1e3, -1.); bool hit = false;
  for (int i = 0; i < 96; i++) { if (float(i) >= u_steps) break; vec3 p = ro + rd*t; h = map(p); if (h.x < 0.0025) { hit = true; break; } t += h.x*0.9; if (t > tPlane + 0.02 || t > 14.) break; }
  vec3 col;
  if (hit) {
    vec3 p = ro + rd*t, n = calcNormal(p);
    float diff = clamp(dot(n, light), 0., 1.);
    vec3 hv = normalize(light - rd);
    float spec = pow(clamp(dot(n, hv), 0., 1.), 60.);
    vec3 refl = reflect(rd, n);
    float window = smoothstep(0.35, 0.9, refl.y) * (1. - smoothstep(0.2, 0.9, abs(refl.x + 0.35)));
    float fres = pow(1. - clamp(dot(n, -rd), 0., 1.), 3.);
    col = material(h.y, p, n, rd, light, diff, spec, window, fres);
    col *= 0.85 + 0.15*occlusion(p, n);
  } else {
    vec3 p = ro + rd*tPlane;
    float g = hash(floor(gl_FragCoord.xy*0.9)); float grain = 1. - u_grain*(g - 0.5);
    col = u_paper * grain;
    float ao = occlusion(p + vec3(0., 0.002, 0.), vec3(0., 1., 0.));
    float sh = mix(1., softShadow(p + vec3(0., 0.01, 0.), light), 0.7);
    col *= 0.72 + 0.28*min(ao, sh);
    float stain = clamp(paperInk(p), 0., 1.);
    col = mix(col, u_ink, stain * (0.6 + 0.4*hash(floor(gl_FragCoord.xy*0.5))));
  }
  gl_FragColor = vec4(col, 1.);
}`;
}

let SHARED = null;
function sharedGL() {
  if (SHARED !== null) return SHARED || null;
  try {
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const gl = c.getContext('webgl', { antialias: false, preserveDrawingBuffer: true, alpha: false, premultipliedAlpha: false });
    if (!gl) { SHARED = false; return null; }
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    SHARED = { canvas: c, gl, programs: new Map() };
  } catch (e) { console.warn(e.message); SHARED = false; return null; }
  return SHARED;
}
function program(shared, id, fs, uniformNames) {
  if (shared.programs.has(id)) return shared.programs.get(id);
  const { gl } = shared;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`${id} shader: ` + gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`${id} link: ` + gl.getProgramInfoLog(prog));
  const a = gl.getAttribLocation(prog, 'a');
  const loc = {}; for (const n of ['u_res', 'u_R', 'u_foot', 'u_time', 'u_steps', 'u_grain', 'u_tilt', 'u_ink', 'u_paper', ...uniformNames]) loc[n] = gl.getUniformLocation(prog, n);
  const P = { prog, loc, a }; shared.programs.set(id, P); return P;
}
export const rgb = css => { const m = /^#([0-9a-f]{6})$/i.exec(css || ''); if (!m) return [0.086, 0.082, 0.078]; const n = parseInt(m[1], 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

/* makeMount(spec) → mount(host, opts)
 * spec: {
 *   id, scene (GLSL), uniformTypes: { name: 'f' | '2f' | '3f' } (declared by the base — do NOT redeclare in the scene), springs: { key: [k, c] }, initial: { key: value },
 *   targets(st, S, helpers)   // set S[key].t for every spring from st.action / st.tA / st.time / st.energy / st.pressed / st.drag; may set st.aux[...] for non-spring uniforms
 *   uniforms(S, st) → { u_name: number | [x,y] | [x,y,z] }
 *   oneShot: { action: seconds }, tilt = .5 (camera tilt, rad), steps = { hero: 72, small: 48 }, heroScale = .62 (internal resolution factor),
 *   onCue(action, st, S), onPoke(kind, x, y, st, S) (optional overrides; return true to skip default), fallback(ctx2d, st, S, R, W, H) optional 2D fallback when WebGL is missing
 * }
 * st: { action, tA, time, energy, reduced, tint, pressed, drag, dragY, px, py, aux: {} }
 */
export function makeMount(spec) {
  const uniformNames = Object.keys(spec.uniformTypes || {});
  const FS = buildFS(uniformNames.map(n => `uniform ${spec.uniformTypes[n] === 'f' ? 'float' : spec.uniformTypes[n] === '2f' ? 'vec2' : 'vec3'} ${n};`).join('\n'), spec.scene);
  return function mount(host, { R = 96, seed = 1, tint = null, reduced = false, energy = 1, size = 'hero', paper = true } = {}) {
    const W = Math.round(3.4 * R), H = Math.round(3.6 * R);
    host.style.width = W + 'px'; host.style.height = H + 'px'; host.style.position = 'relative';
    const scale = size === 'hero' ? (spec.heroScale ?? .62) : 1;
    const iw = Math.round(W * scale), ih = Math.round(H * scale);
    const canvas = document.createElement('canvas'); canvas.width = iw; canvas.height = ih;
    canvas.style.cssText = `display:block;width:${W}px;height:${H}px;touch-action:none`;
    host.appendChild(canvas); const ctx2d = canvas.getContext('2d');
    const shared = sharedGL(); let P = null;
    if (shared) { try { P = program(shared, spec.id, FS, uniformNames); } catch (e) { console.error(e.message); P = null; } }
    const st = { action: 'idle', tA: 0, time: 0, energy: clamp(energy, .5, 1.5), reduced, tint, pressed: false, drag: 0, dragY: 0, px: 0, py: 0, seed, aux: {}, R, W, H, size };
    const S = {}; for (const k in spec.springs) S[k] = { x: spec.initial?.[k] ?? 0, v: 0, t: spec.initial?.[k] ?? 0 };
    const helpers = { clamp, rand: (i) => ink.rand(seed, i), noise: (x, s = 0) => ink.noise1(x, seed + s) };
    function integrate(dt) { for (const k in S) { const s = S[k]; if (st.reduced) { s.x = s.t; s.v = 0; continue; } const [kk, c] = spec.springs[k]; s.v += (kk * (s.t - s.x) - c * s.v) * dt; s.x += s.v * dt; } }
    function draw() {
      if (!P) { // honest 2D fallback
        ctx2d.setTransform(1, 0, 0, 1, 0, 0); ink.paper(ctx2d, W, H, { grain: 0 });
        if (spec.fallback) spec.fallback(ctx2d, st, S, R, W, H); else { ctx2d.fillStyle = ink.inkColor(st.tint); ctx2d.beginPath(); ctx2d.ellipse(1.7 * R, 3.1 * R - .8 * R, .85 * R, .8 * R, 0, 0, Math.PI * 2); ctx2d.fill(); }
        return;
      }
      const { gl, canvas: sc } = shared;
      if (sc.width < iw || sc.height < ih) { sc.width = Math.max(sc.width, iw); sc.height = Math.max(sc.height, ih); }
      gl.useProgram(P.prog); gl.enableVertexAttribArray(P.a); gl.vertexAttribPointer(P.a, 2, gl.FLOAT, false, 0, 0);
      gl.viewport(0, 0, iw, ih);
      gl.uniform2f(P.loc.u_res, iw, ih); gl.uniform1f(P.loc.u_R, R * scale); gl.uniform2f(P.loc.u_foot, 1.7 * R * scale, 3.1 * R * scale);
      gl.uniform1f(P.loc.u_time, st.reduced ? 0 : st.time); gl.uniform1f(P.loc.u_steps, size === 'hero' ? (spec.steps?.hero ?? 72) : (spec.steps?.small ?? 48));
      gl.uniform1f(P.loc.u_grain, paper ? (size === 'hero' ? .05 : 0) : 0); gl.uniform1f(P.loc.u_tilt, spec.tilt ?? .5);
      const c = rgb(st.tint); gl.uniform3f(P.loc.u_ink, c[0], c[1], c[2]); gl.uniform3f(P.loc.u_paper, .953, .941, .918);
      const U = spec.uniforms(S, st) || {};
      for (const n of uniformNames) { const v = U[n]; if (v === undefined || P.loc[n] === null) continue; if (typeof v === 'number') gl.uniform1f(P.loc[n], v); else if (v.length === 2) gl.uniform2f(P.loc[n], v[0], v[1]); else gl.uniform3f(P.loc[n], v[0], v[1], v[2]); }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      ctx2d.setTransform(1, 0, 0, 1, 0, 0); ctx2d.drawImage(sc, 0, sc.height - ih, iw, ih, 0, 0, iw, ih);
    }
    const ctl = {
      cue(a) { if (!ACTION_IDS.includes(a)) return; st.action = a; st.tA = 0; spec.onCue?.(a, st, S); },
      step(dt) {
        dt = clamp(dt, 0, .1); if (!st.reduced) st.time += dt; st.tA += dt;
        const one = spec.oneShot?.[st.action]; if (one && st.tA > (st.reduced ? Math.min(one, 1.2) : one)) { st.action = 'idle'; st.tA = 0; }
        spec.targets(st, S, helpers); integrate(dt); draw();
      },
      setReduced(v) { st.reduced = !!v; }, setEnergy(e) { st.energy = clamp(e, .5, 1.5); }, setTint(c) { st.tint = c; },
      poke(x, y, kind) {
        if (spec.onPoke?.(kind, x, y, st, S)) return;
        if (kind === 'down') { st.pressed = true; st.drag = 0; st.dragY = 0; st.px = x; st.py = y; }
        else if (kind === 'move' && st.pressed) { st.drag = clamp((x - st.px) / R * .5, -.3, .3); st.dragY = clamp((y - st.py) / R * .5, -.3, .3); }
        else if (kind === 'up') { if (st.pressed) spec.onRelease?.(st, S); st.pressed = false; st.drag = 0; st.dragY = 0; }
        else if (kind === 'tap') ctl.cue('tap');
      },
      _debug() { return { st, S: Object.fromEntries(Object.entries(S).map(([k, s]) => [k, { x: s.x, t: s.t }])), uniforms: spec.uniforms(S, st) }; },
      destroy() { host.removeEventListener('pointerdown', onDown); host.removeEventListener('pointermove', onMove); host.removeEventListener('pointerup', onUp); host.removeEventListener('pointercancel', onUp); canvas.remove(); },
    };
    const pos = e => { const r = host.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const onDown = e => { const [x, y] = pos(e); ctl.poke(x, y, 'down'); try { host.setPointerCapture?.(e.pointerId); } catch (_) {} e.preventDefault(); };
    const onMove = e => { if (!st.pressed) return; const [x, y] = pos(e); ctl.poke(x, y, 'move'); };
    const onUp = e => { const [x, y] = pos(e); ctl.poke(x, y, 'up'); };
    host.addEventListener('pointerdown', onDown); host.addEventListener('pointermove', onMove); host.addEventListener('pointerup', onUp); host.addEventListener('pointercancel', onUp);
    spec.targets(st, S, helpers); for (const k in S) S[k].x = S[k].t; draw();
    return ctl;
  };
}

/* nibbi.js — the ink-blot character engine.
   WebGL SDF ink body (lumpy dome + tuft fringe + pool) on a full-window canvas, eyes/spatter/droplets on a 2D canvas.
   Public API (window.createNibbi):
     const n = createNibbi({ ink: canvasEl, fx: canvasEl });
     n.setTarget({ x, y, r })   // where the body center should be (css px) and its base radius; spring-eased
     n.setMood('idle'|'listening'|'thinking'|'working'|'speaking'|'happy'|'error'|'sleep')
     n.lookAt(x, y) | n.lookFree()     // gaze target in css px, or back to wander/pointer
     n.pointer(x, y)                   // pointer position (css px) for puff + gaze
     n.pulse(e)                        // speech energy impulse 0..1 (bob while talking)
     n.hop() n.blink() n.spatter(k) n.drip() n.shake()
     n.setReducedMotion(bool)  n.state() -> { x, y, r, mood, fps }
*/
(function () {
'use strict';

const R0 = 135;                     // design radius the reference art was authored at
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

/* ---------------------------------------------------------------- paper grain (shared tile) */
const GRAIN = 256;
const grainBytes = new Uint8Array(GRAIN * GRAIN);
(function makeGrain() {
  const raw = new Float32Array(GRAIN * GRAIN);
  let s = 1337;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < raw.length; i++) raw[i] = rnd();
  for (let y = 0; y < GRAIN; y++) for (let x = 0; x < GRAIN; x++) {
    const g = (xx, yy) => raw[((yy + GRAIN) % GRAIN) * GRAIN + ((xx + GRAIN) % GRAIN)];
    // horizontal-biased smoothing → faint paper fibers
    const v = (g(x - 2, y) + g(x - 1, y) * 2 + g(x, y) * 3 + g(x + 1, y) * 2 + g(x + 2, y) + g(x, y - 1) + g(x, y + 1)) / 11;
    grainBytes[y * GRAIN + x] = clamp(Math.round(v * 255), 0, 255);
  }
})();
function paperDataURL() {
  const c = document.createElement('canvas'); c.width = GRAIN; c.height = GRAIN;
  const g = c.getContext('2d'); const img = g.createImageData(GRAIN, GRAIN);
  for (let i = 0; i < GRAIN * GRAIN; i++) {
    const n = (grainBytes[i] - 128) / 128;
    const spec = grainBytes[(i * 7 + 31) % (GRAIN * GRAIN)] > 249 ? -6 : 0;
    img.data[i * 4] = 245 + n * 3.5 + spec; img.data[i * 4 + 1] = 242 + n * 3.5 + spec; img.data[i * 4 + 2] = 236 + n * 4.0 + spec; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL();
}

/* ---------------------------------------------------------------- shaders */
const VS = `attribute vec2 a_p; void main(){ gl_Position = vec4(a_p, 0.0, 1.0); }`;
const FS = `
precision highp float;
uniform float u_dpr;
uniform vec2  u_center;   // body center, css px, y-up
uniform float u_R;        // base radius
uniform float u_breath;
uniform vec4  u_h;        // radial harmonic amps
uniform vec4  u_hp;       // radial harmonic phases
uniform vec2  u_noff;     // boil noise offset
uniform vec3  u_puff;     // dir.xy, amount px
uniform float u_lift;     // px up
uniform float u_sq;       // squash (scaleY)
uniform float u_lean;     // px of crown lean (x)
uniform float u_poof;     // landing poof 0..1
uniform float u_pulse;    // pool pulse 0..1
uniform float u_fade;     // overall alpha
uniform sampler2D u_grain;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  float a = hash(i), b = hash(i + vec2(1.0,0.0)), c = hash(i + vec2(0.0,1.0)), d = hash(i + vec2(1.0,1.0));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 3; i++){ v += a * vnoise(p); p = p * 2.03 + vec2(17.13, 9.71); a *= 0.5; } return v; }
float smax(float a, float b, float k){ float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(a, b, h) + k * h * (1.0 - h); }
vec2 hash2(vec2 p){ float n = hash(p); return vec2(n, hash(p + n + 17.71)); }
float voro(vec2 p){ vec2 i = floor(p), f = fract(p); float md = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){ vec2 g = vec2(float(x), float(y)); vec2 r = g + hash2(i + g) - f; md = min(md, dot(r, r)); }
  return sqrt(md); }
float tuft(vec2 p){ float t = 1.0 - smoothstep(0.0, 1.05, voro(p)); return t * t; }

void main(){
  vec2 p = gl_FragCoord.xy / u_dpr - u_center;
  if (dot(p, p) > 7.3 * u_R * u_R) { gl_FragColor = vec4(0.0); return; }   // far field: nothing to draw
  float R = u_R * u_breath;

  vec2 q = p;
  q.y -= u_lift;
  float yb = -0.66 * u_R;
  q.y = yb + (q.y - yb) / u_sq;
  q.x = q.x * (u_sq * 0.55 + 0.45);
  q.x -= u_lean * clamp((q.y - yb) / (1.6 * u_R), 0.0, 1.2);   // crown leans, skirt stays planted

  float an = atan(q.y, q.x);
  float rr = 1.0 + u_h.x * cos(2.0*an + u_hp.x) + u_h.y * cos(3.0*an + u_hp.y) + u_h.z * cos(5.0*an + u_hp.z) + u_h.w * cos(7.0*an + u_hp.w);
  rr += 0.06 * clamp(-sin(an), 0.0, 1.0);
  rr -= 0.02 * clamp(sin(an), 0.0, 1.0);
  rr += 0.085 * exp((cos(an - 3.30) - 1.0) * 6.0);
  rr += 0.050 * exp((cos(an + 0.15) - 1.0) * 6.0);
  float pa = atan(u_puff.y, u_puff.x);
  rr += (u_puff.z / R) * exp((cos(an - pa) - 1.0) * 5.0);

  float ysc = mix(0.98, 1.10, smoothstep(-0.3 * R, 0.4 * R, q.y));
  float d0 = length(q * vec2(1.0, ysc)) - R * rr * 0.95;
  d0 = smax(d0, -(q.y - yb) - 0.05 * R, 0.15 * R);

  float edge = smoothstep(-0.30 * R, 0.03 * R, d0);
  float pf = 1.0 + 0.8 * u_poof;
  vec2 nq = q * (1.0 / R);
  float t1 = tuft(nq * 3.6 + u_noff);
  float t2 = tuft(nq * 8.0 + u_noff * 1.6 + 7.3);
  float t3 = tuft(nq * 14.0 + u_noff * 2.4 + 57.0);
  float j  = fbm(nq * 3.2 + u_noff) - 0.5;
  float fall = 1.0 - smoothstep(0.03 * R, 0.13 * R, d0);
  float d = d0 - (t1 * 0.16 + t2 * 0.13 + t3 * edge * 0.07) * R * pf * (0.35 + 0.65 * edge) * fall + j * 0.035 * R;
  d = smax(d, -(q.y - yb) - 0.13 * R, 0.10 * R);

  float aIn = 1.0 - smoothstep(-0.015 * R, 0.008 * R, d);
  float aBl = (1.0 - smoothstep(-0.01 * R, 0.14 * R * pf, d)) * 0.33;
  float A = aIn + aBl * (1.0 - aIn);
  float g1 = fbm(nq * 12.0 + u_noff * 2.3 + 3.3);
  float outer = smoothstep(-0.005 * R, 0.06 * R, d);
  A *= mix(1.0, smoothstep(0.28, 0.65, g1), outer * 0.9);
  float gr = texture2D(u_grain, gl_FragCoord.xy / (u_dpr * 256.0)).r;
  A *= mix(0.985 + 0.015 * gr, 0.86 + 0.18 * gr, edge);
  float tone = 0.035 + (0.065 * t2 + 0.03 * t1) * (0.1 + 0.9 * edge) + 0.02 * (1.0 - gr);
  vec3 inkB = vec3(tone * 0.98, tone * 0.97, tone);

  /* pool */
  vec2 pp = p - vec2(4.0, -0.76 * u_R);
  vec2 pn = pp * (1.0 / u_R);
  float dpe = length(pp * vec2(1.0, 5.0)) - 1.35 * u_R;
  float s1 = tuft(pn * 5.5 + u_noff * 0.7 + 21.0);
  float s2 = tuft(pn * 10.0 + u_noff + 41.0);
  float dp = dpe - (s1 * 0.09 + s2 * 0.05) * R + (fbm(pn * 3.0 + 11.1) - 0.5) * 0.05 * u_R;
  float apS = 1.0 - smoothstep(-0.02 * u_R, 0.02 * u_R, dp);
  apS *= 1.0 - smoothstep(-0.42 * u_R, -0.20 * u_R, p.y);
  float g2 = fbm(pn * 9.0 + u_noff * 1.3 + 21.0);
  float ap = apS * (0.36 + 0.16 * u_pulse) * (0.20 + 0.80 * smoothstep(0.30, 0.75, g2)) * (0.35 + 0.65 * smoothstep(0.12, 0.55, max(s1, s2))) * (0.85 + 0.25 * gr);
  float cs = 1.0 - smoothstep(0.0, 0.45 * u_R, length((p - vec2(0.0, -0.66 * u_R)) * vec2(0.55, 2.2)));
  ap = min(ap + cs * cs * 0.30 * apS, 0.30);
  vec2 lp = p - vec2(-1.05 * u_R, -0.24 * u_R);
  float dl = length(lp * vec2(1.0, 1.2)) - 0.26 * u_R;
  dl -= tuft(lp * (7.0 / u_R) + u_noff + 61.0) * 0.12 * u_R;
  float g3 = fbm(lp * (8.0 / u_R) + 13.7);
  float al = (1.0 - smoothstep(-0.04 * u_R, 0.05 * u_R, dl)) * (0.22 + 0.45 * smoothstep(0.30, 0.80, g3)) * 0.35;
  ap = min(ap + al, 0.30);
  vec3 inkP = vec3(0.58, 0.57, 0.56);

  float outA = (A + ap * (1.0 - A)) * u_fade;
  vec3 col = (inkB * A + inkP * ap * (1.0 - A)) * u_fade;
  gl_FragColor = vec4(col, outA);
}`;

/* ---------------------------------------------------------------- moods */
const MOODS = {
  idle:      { lidTop: 0.00, lidBot: 0.00, wide: 1.02, pupil: 0.88, boil: 9,  breathAmp: 0.017, breathHz: 1 / 4.6, gazeBias: [0, 0],       puffIdle: 0,  blinkGap: [3000, 4000] },
  listening: { lidTop: 0.00, lidBot: 0.00, wide: 1.09, pupil: 0.94, boil: 9,  breathAmp: 0.012, breathHz: 1 / 3.2, gazeBias: [0, -0.05],   puffIdle: 0,  blinkGap: [3800, 3000] },
  thinking:  { lidTop: 0.03, lidBot: 0.00, wide: 1.02, pupil: 0.84, boil: 13, breathAmp: 0.014, breathHz: 1 / 2.6, gazeBias: [-0.32, -0.30], puffIdle: 9, blinkGap: [2400, 2600] },
  working:   { lidTop: 0.0,  lidBot: 0.00, wide: 1.01, pupil: 0.88, boil: 15, breathAmp: 0.013, breathHz: 1 / 2.2, gazeBias: [0.08, 0.28],   puffIdle: 5,  blinkGap: [2200, 2400] },
  speaking:  { lidTop: 0.02, lidBot: 0.00, wide: 1.03, pupil: 0.90, boil: 11, breathAmp: 0.015, breathHz: 1 / 3.4, gazeBias: [0, 0.08],     puffIdle: 0,  blinkGap: [3000, 3000] },
  happy:     { lidTop: 0.00, lidBot: 0.16, wide: 1.02, pupil: 0.82, boil: 11, breathAmp: 0.02,  breathHz: 1 / 2.4, gazeBias: [0, -0.36],     puffIdle: 0,  blinkGap: [3000, 3000] },
  error:     { lidTop: 0.00, lidBot: 0.00, wide: 1.18, pupil: 0.58, boil: 7,  breathAmp: 0.008, breathHz: 1 / 1.9, gazeBias: [0.15, -0.1], puffIdle: 0, blinkGap: [1600, 1200] },
  sleep:     { lidTop: 0.58, lidBot: 0.00, wide: 0.98, pupil: 1.00, boil: 5,  breathAmp: 0.026, breathHz: 1 / 6.5, gazeBias: [0, 0.6],   puffIdle: 0,  blinkGap: [6000, 6000] },
};

/* Character studies. `soft` is the default; the others are selectable with ?look=. */
const LOOKS = {
  soft: {
    h: [0.045, 0.040, 0.022, 0.012], hp: [0.7, 2.1, 4.4, 1.3], gaze: [3.5, 3.1], glint: [0.27, 0.22, 0.10],
    eyes: [
      { x: -28.5, y: 7.0, rx: 20.0, ry: 23.5, prx: 8.5, pry: 10.4, pox: 0.3, poy: 1.0 },
      { x:  28.5, y: 6.0, rx: 20.8, ry: 24.2, prx: 8.8, pry: 10.7, pox: -0.3, poy: 0.7 },
    ],
  },
  mochi: {
    h: [0.034, 0.026, 0.016, 0.008], hp: [0.2, 1.8, 4.1, 0.9], gaze: [2.9, 2.6], glint: [0.31, 0.25, 0.12],
    eyes: [
      { x: -32.5, y: 8.0, rx: 22.5, ry: 22.8, prx: 7.4, pry: 8.2, pox: 0.3, poy: 1.0 },
      { x:  32.5, y: 8.0, rx: 22.8, ry: 23.0, prx: 7.5, pry: 8.3, pox: -0.3, poy: 1.0 },
    ],
  },
  pip: {
    h: [0.054, 0.048, 0.028, 0.016], hp: [1.1, 2.6, 4.7, 1.7], gaze: [2.2, 2.0], glint: [0.29, 0.23, 0.12],
    eyes: [
      { x: -35.0, y: 13.0, rx: 21.50, ry: 25.00, prx: 12.750, pry: 15.000, pox: 0.2, poy: 1.8 },
      { x:  35.0, y: 12.0, rx: 22.13, ry: 25.50, prx: 13.125, pry: 15.250, pox: -0.2, poy: 1.6 },
    ],
  },
  wisp: {
    h: [0.064, 0.031, 0.034, 0.020], hp: [1.5, 1.2, 5.0, 2.2], gaze: [3.9, 3.3], glint: [0.30, 0.24, 0.10],
    eyes: [
      { x: -30.0, y: 4.0, rx: 15.5, ry: 18.4, prx: 6.4, pry: 7.8, pox: 0.8, poy: 0.2 },
      { x:  28.5, y: 6.0, rx: 18.4, ry: 21.0, prx: 7.4, pry: 8.9, pox: -0.5, poy: 0.8 },
    ],
  },
};

function createNibbi(opts) {
  const inkCv = opts.ink, fxCv = opts.fx;
  const fx = fxCv.getContext('2d');
  const lookName = Object.prototype.hasOwnProperty.call(LOOKS, opts.look) ? opts.look : 'soft';
  const look = LOOKS[lookName];
  let DPR = Math.min(2, window.devicePixelRatio || 1);
  let W = 0, H = 0;

  /* spring-eased pose */
  const pose = { x: innerWidth / 2, y: innerHeight * 0.44, r: 120, vx: 0, vy: 0, vr: 0 };
  const target = { x: pose.x, y: pose.y, r: pose.r };
  let poseSnap = true;                     // first setTarget snaps

  let mood = 'idle', moodAt = 0, moodDef = MOODS.idle;
  const ex = { lidTop: 0, lidBot: 0, wide: 1, pupil: 1 };   // smoothed expression
  let reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const t0 = performance.now();
  const now = () => performance.now() - t0;

  /* pointer & gaze */
  let ptrX = -9999, ptrY = -9999, ptrAt = -1e9;
  let lookX = null, lookY = null;        // explicit gaze target (css px)
  let gazeX = -0.25, gazeY = 0.1, gazeTX = -0.25, gazeTY = 0.1, nextWander = 2500;
  let puffAmt = 0, puffDX = 1, puffDY = 0, puffAng = 0;
  let leanAmt = 0;

  /* blink / hop / speech / shake */
  let blinkAt = -1e4, nextBlink = 2600; const BLINK_D = 240;
  let hopAt = -1e4; const HOP_D = 700;
  let speechE = 0, speechPhase = 0;
  let shakeAt = -1e4, flatAt = -1e4;
  let fade = 1, fadeT = 1;

  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

  /* droplets + spatter pools */
  const drops = []; for (let i = 0; i < 8; i++) drops.push({ on: false });
  const spatStatic = [
    { x: 118, y: -95, r: 4.2 }, { x: 148, y: -39, r: 3.0 }, { x: 129, y: -13, r: 2.0 }, { x: 159, y: 93, r: 3.6 },
    { x: -184, y: 63, r: 2.2 }, { x: -172, y: 82, r: 3.1 }, { x: -151, y: 78, r: 2.0 }, { x: -137, y: 89, r: 2.6 }, { x: -159, y: 95, r: 1.6 },
  ];
  const spatDyn = []; for (let i = 0; i < 24; i++) spatDyn.push({ on: false });
  let nextSpat = 6000;
  let nextDrip = 0;

  function spawnDroplet(t, side, power) {
    for (const d of drops) {
      if (d.on && now() - d.t < 900) continue;
      const s = pose.r / R0;
      d.on = true; d.t = t; d.x = pose.x + side * (18 + rnd() * 26) * s; d.y = pose.y + 0.66 * pose.r - 30 * s;
      d.vx = side * (30 + rnd() * 45) * s * (power || 1); d.vy = (-95 - rnd() * 55) * s * (power || 1); d.r = (2.2 + rnd() * 1.8) * s;
      return;
    }
  }
  function spawnSpat(t, spread) {
    for (const sp of spatDyn) {
      if (sp.on && t - sp.born < sp.life) continue;
      const s = pose.r / R0, a = rnd() * Math.PI * 2, rad = (155 + rnd() * 80) * s * (spread || 1);
      sp.on = true; sp.born = t; sp.ox = Math.cos(a) * rad; sp.oy = Math.sin(a) * rad * 0.75 + 20 * s; sp.r = (1.4 + rnd() * 3.0) * s; sp.life = 4500 + rnd() * 2500;
      return;
    }
  }

  /* ------------------------------------------------ webgl */
  let gl = null, U = null, glOK = false;
  function initGL() {
    try {
      gl = inkCv.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false });
      if (!gl) return;
      const mk = (type, src) => { const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh; };
      const prog = gl.createProgram(); gl.attachShader(prog, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link');
      gl.useProgram(prog);
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'a_p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, GRAIN, GRAIN, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, grainBytes);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      U = {}; for (const n of ['u_dpr', 'u_center', 'u_R', 'u_breath', 'u_h', 'u_hp', 'u_noff', 'u_puff', 'u_lift', 'u_sq', 'u_lean', 'u_poof', 'u_pulse', 'u_fade', 'u_grain']) U[n] = gl.getUniformLocation(prog, n);
      gl.disable(gl.BLEND); gl.clearColor(0, 0, 0, 0);
      gl.uniform4f(U.u_h, ...look.h); gl.uniform4f(U.u_hp, ...look.hp); gl.uniform1i(U.u_grain, 0);
      glOK = true;
    } catch (e) { glOK = false; console.warn('[nibbi] webgl unavailable, using 2D fallback', e); }
  }
  initGL();

  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = innerWidth; H = innerHeight;
    inkCv.width = Math.round(W * DPR); inkCv.height = Math.round(H * DPR);
    fxCv.width = Math.round(W * DPR); fxCv.height = Math.round(H * DPR);
    fx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (glOK) { gl.viewport(0, 0, inkCv.width, inkCv.height); gl.uniform1f(U.u_dpr, DPR); }
  }
  resize();
  addEventListener('resize', resize);

  /* 2D fallback body (no webgl) */
  function drawFallbackBody(cx, cy, R, lift, sq) {
    const s = R / R0, yb = cy + 0.66 * R;
    fx.save(); fx.translate(cx, yb - lift); fx.scale(1, sq); fx.translate(-cx, -yb);
    fx.fillStyle = 'rgba(105,102,96,0.08)';
    for (let i = 0; i < 90; i++) { const a = (i / 90) * Math.PI * 2; fx.beginPath(); fx.ellipse(cx + Math.cos(a) * 1.15 * R, yb + 8 * s + Math.sin(a) * 0.14 * R, 9 * s, 5 * s, 0, 0, 7); fx.fill(); }
    fx.fillStyle = 'rgba(24,23,22,0.45)';
    for (let i = 0; i < 64; i++) { const a = (i / 64) * Math.PI * 2; fx.beginPath(); fx.arc(cx + Math.cos(a) * 0.98 * R, cy + Math.sin(a) * 0.9 * R, 9 * s, 0, 7); fx.fill(); }
    fx.fillStyle = '#171614'; fx.beginPath(); fx.ellipse(cx, cy, R * 0.9, R * 0.8, 0, 0, 7); fx.fill(); fx.fillRect(cx - R * 0.82, cy, R * 1.64, yb - cy - 4 * s);
    fx.restore();
  }

  /* ------------------------------------------------ hop curves */
  const hopLift = (ht) => (ht < 110 || ht >= 520) ? 0 : ht < 330 ? 30 * (1 - Math.pow(1 - (ht - 110) / 220, 2)) : 30 * (1 - Math.pow((ht - 330) / 190, 2));
  const hopSquash = (ht) => (ht < 0 || ht >= HOP_D + 160) ? 1 : ht < 110 ? 1 - 0.14 * (ht / 110) : ht < 330 ? 0.86 + 0.20 * ((ht - 110) / 220) : ht < 520 ? 1.06 - 0.06 * ((ht - 330) / 190) : ht < 620 ? 1 - 0.11 * Math.sin(((ht - 520) / 100) * Math.PI) : 1;
  const hopPoof = (ht) => (ht < 520 || ht > 1000) ? 0 : Math.exp(-(ht - 520) / 190);
  const hopPulse = (ht) => (ht < 520 || ht > 1400) ? 0 : Math.exp(-(ht - 520) / 320);

  /* ------------------------------------------------ frame */
  const BOIL_OFF = [[0, 0], [0.43, -0.31], [-0.29, 0.53]];
  let raf = 0, lastT = now(), frames = 0, fpsLast = now(), fps = 0;
  let boilClock = 0;                       // integrates variable boil rate
  let frozenNoff = [0, 0], frozenDrawn = false;
  const sm = (cur, tgt, dt, k) => cur + (tgt - cur) * Math.min(1, dt * k);

  function frame() {
    raf = 0;
    try { frameBody(); } catch (e) { console.warn('[nibbi] frame error', e); }
    if (!document.hidden) raf = requestAnimationFrame(frame);
  }
  function frameBody() {
    const t = now(); const dt = Math.min(50, t - lastT); lastT = t; const ts = t / 1000; const dts = dt / 1000;
    frames++; if (t - fpsLast >= 1000) { fps = frames; frames = 0; fpsLast = t; }

    /* pose spring (slightly under-damped so moves feel alive) */
    if (poseSnap) { pose.x = target.x; pose.y = target.y; pose.r = target.r; pose.vx = pose.vy = pose.vr = 0; poseSnap = false; }
    else if (reduced) { pose.x = sm(pose.x, target.x, dt, 0.02); pose.y = sm(pose.y, target.y, dt, 0.02); pose.r = sm(pose.r, target.r, dt, 0.02); }
    else {
      const k = 70, c = 2 * Math.sqrt(k) * 0.82, h = Math.min(dts, 0.033);
      pose.vx += ((target.x - pose.x) * k - pose.vx * c) * h; pose.x += pose.vx * h;
      pose.vy += ((target.y - pose.y) * k - pose.vy * c) * h; pose.y += pose.vy * h;
      pose.vr += ((target.r - pose.r) * k - pose.vr * c) * h; pose.r += pose.vr * h;
    }
    const cx = pose.x, cy = pose.y, R = pose.r, s = R / R0;
    const yb = cy + 0.66 * R;

    /* expression smoothing */
    ex.lidTop = sm(ex.lidTop, moodDef.lidTop, dt, 0.008); ex.lidBot = sm(ex.lidBot, moodDef.lidBot, dt, 0.008);
    ex.wide = sm(ex.wide, moodDef.wide, dt, 0.006); ex.pupil = sm(ex.pupil, moodDef.pupil, dt, 0.006);
    fade = sm(fade, fadeT, dt, 0.004);

    const breath = reduced ? 1 : 1 + moodDef.breathAmp * Math.sin(ts * Math.PI * 2 * moodDef.breathHz);

    /* boil: quantized noise offset at a mood-dependent rate */
    let noffX, noffY;
    if (reduced) { [noffX, noffY] = frozenNoff; }
    else {
      boilClock += dts * moodDef.boil;
      const bi = Math.floor(boilClock), fr = BOIL_OFF[bi % 3], tq = bi / 9;
      noffX = fr[0] + tq * 0.011; noffY = fr[1] - tq * 0.007; frozenNoff = [noffX, noffY]; frozenDrawn = false;
    }

    /* puff: toward pointer when near, or idle bubbling for thinking/working */
    const pdx = ptrX - cx, pdy = ptrY - cy, pd = Math.hypot(pdx, pdy);
    const nearPtr = t - ptrAt < 4000 && pd < 2.3 * R && pd > 1;
    let puffT = 0;
    if (!reduced && nearPtr) { puffT = (1 - pd / (2.3 * R)) * 13 * s; puffDX = pdx / pd; puffDY = -pdy / pd; }
    else if (!reduced && moodDef.puffIdle) { puffAng += dts * 1.7; puffDX = Math.cos(puffAng); puffDY = Math.sin(puffAng) * 0.6 + 0.4; puffT = moodDef.puffIdle * s * (0.6 + 0.4 * Math.sin(ts * 5.1)); }
    puffAmt = sm(puffAmt, puffT, dt, 0.008);

    /* lean: toward an explicit look target that is off to the side, plus speech sway */
    let leanT = 0;
    if (lookX !== null && Math.abs(lookX - cx) > R) leanT = clamp((lookX - cx) / (4 * R), -1, 1) * 10 * s;
    if (speechE > 0.02) leanT += Math.sin(ts * 6.3) * 4 * s * speechE;
    leanAmt = sm(leanAmt, leanT, dt, 0.006);

    /* gaze */
    const bias = moodDef.gazeBias;
    if (lookX !== null) { const gx = lookX - cx, gy = lookY - cy, gd = Math.hypot(gx, gy) || 1; gazeTX = clamp(gx / gd * Math.min(1, gd / (1.4 * R)), -1, 1); gazeTY = clamp(gy / gd * Math.min(1, gd / (1.4 * R)), -1, 1); }
    else if (t - ptrAt < 6000 && pd < 2.6 * R) { gazeTX = clamp(pdx / (1.5 * R), -1, 1); gazeTY = clamp(pdy / (1.5 * R), -1, 1); }
    else if (t >= nextWander) { gazeTX = (rnd() - 0.5) * 1.4; gazeTY = (rnd() - 0.5) * 1.0; nextWander = t + 2500 + rnd() * 2500; }
    gazeX = sm(gazeX, clamp(gazeTX + bias[0], -1, 1), dt, 0.004); gazeY = sm(gazeY, clamp(gazeTY + bias[1], -1, 1), dt, 0.004);

    /* blink schedule */
    if (t >= nextBlink) { blinkAt = t; nextBlink = t + moodDef.blinkGap[0] + rnd() * moodDef.blinkGap[1]; }
    /* ambient spatter */
    if (!reduced && t >= nextSpat) { spawnSpat(t); nextSpat = t + 10000 + rnd() * 8000; }
    /* working drips */
    if (!reduced && (mood === 'working') && t >= nextDrip) { spawnDroplet(t, rnd() < 0.5 ? -1 : 1, 0.8); nextDrip = t + 1800 + rnd() * 1600; }

    /* hop + speech + shake + flatten */
    const ht = t - hopAt;
    let lift = hopLift(ht) * s, squash = hopSquash(ht), poof = hopPoof(ht), pulse = hopPulse(ht);
    speechE *= Math.pow(0.55, dts * 6);   // ~ decays over ~0.4s
    if (speechE > 0.01 && !reduced) { speechPhase += dts * 21; lift += Math.abs(Math.sin(speechPhase)) * 3.2 * s * speechE; squash *= 1 + 0.035 * speechE * Math.sin(speechPhase * 2); }
    const sht = t - shakeAt; if (sht >= 0 && sht < 420 && !reduced) { const e = 1 - sht / 420; leanAmt += Math.sin(sht / 22) * 9 * s * e; }
    const flt = t - flatAt; if (flt >= 0 && flt < 700) { const u = flt / 700; squash *= 1 - 0.22 * Math.sin(Math.PI * Math.min(1, u * 1.15)) * (1 - u * 0.3); }
    const hopping = ht >= 0 && ht < 1400;

    /* droplets */
    for (const d of drops) { if (!d.on) continue; const a = t - d.t; if (a < 0) continue; if (a > 1100 || d.y > yb + 26 * s) { d.on = false; continue; } d.vy += 560 * s * dts; d.x += d.vx * dts; d.y += d.vy * dts; }

    /* ---- GL ---- */
    if (glOK) {
      const need = !reduced || hopping || puffAmt > 0.2 || !frozenDrawn || Math.abs(pose.vx) + Math.abs(pose.vy) + Math.abs(pose.vr) > 0.5;
      if (need) {
        gl.enable(gl.SCISSOR_TEST);
        const bx = Math.max(0, Math.floor((cx - 2.7 * R) * DPR)), bw = Math.ceil(5.4 * R * DPR);
        const byTop = cy - 2.5 * R - 40 * s, byBot = cy + 1.8 * R;
        const by = Math.max(0, Math.floor((H - byBot) * DPR)), bh = Math.ceil((byBot - byTop) * DPR);
        gl.scissor(bx, by, bw, bh);
        gl.uniform2f(U.u_center, cx, H - cy); gl.uniform1f(U.u_R, R);
        gl.uniform1f(U.u_breath, breath); gl.uniform2f(U.u_noff, noffX, noffY);
        gl.uniform3f(U.u_puff, puffDX, puffDY, puffAmt); gl.uniform1f(U.u_lift, lift); gl.uniform1f(U.u_sq, squash);
        gl.uniform1f(U.u_lean, leanAmt); gl.uniform1f(U.u_poof, poof); gl.uniform1f(U.u_pulse, pulse); gl.uniform1f(U.u_fade, fade);
        gl.disable(gl.SCISSOR_TEST); gl.clear(gl.COLOR_BUFFER_BIT); gl.enable(gl.SCISSOR_TEST);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (reduced) frozenDrawn = true;
      }
    }

    /* ---- fx ---- */
    fx.clearRect(0, 0, W, H);
    if (!glOK) drawFallbackBody(cx, cy, R, lift, squash);
    fx.globalAlpha = fade;
    fx.fillStyle = '#191817';
    for (const sp of spatStatic) { fx.beginPath(); fx.ellipse(cx + sp.x * s, cy + sp.y * s, sp.r * s, sp.r * s * 0.88, 0.5, 0, 7); fx.fill(); }
    for (const sp of spatDyn) {
      if (!sp.on) continue; const age = t - sp.born; if (age < 0) continue; if (age > sp.life) { sp.on = false; continue; }
      let sc = 1, al = 1; if (age < 130) sc = 0.2 + (age / 130); if (age > sp.life - 2400) al = (sp.life - age) / 2400;
      fx.globalAlpha = Math.max(0, al) * fade; fx.beginPath(); fx.ellipse(cx + sp.ox, cy + sp.oy, sp.r * sc, sp.r * sc * 0.85, 0.4, 0, 7); fx.fill();
    }
    fx.globalAlpha = fade;
    for (const d of drops) { if (!d.on || t < d.t) continue; fx.beginPath(); fx.ellipse(d.x, d.y - lift * 0.3, d.r, d.r * 1.25, 0, 0, 7); fx.fill(); }

    /* eyes — each look shares the same expressive rig but carries its own proportions */
    const bt = t - blinkAt; let lid = 1;
    if (bt >= 0 && bt < BLINK_D) { lid = bt < 120 ? 1 - bt / 120 : (bt - 120) / 120; lid = 0.05 + 0.95 * lid; }
    const eyeSY = lid * squash;
    for (const eye of look.eyes) {
      drawEye(cx + eye.x * s + leanAmt * 0.55, cy + eye.y * s, eye.rx * s, eye.ry * s, eye.prx * s, eye.pry * s, eye.pox * s, eye.poy * s, breath, lift, eyeSY, yb, cx, s);
    }
    fx.globalAlpha = 1;
  }

  function drawEye(exx, eyy, rx, ry, prx, pry, pox, poy, breath, lift, sy, ybase, cx, s) {
    const x = cx + (exx - cx) * breath, y = ybase - (ybase - eyy) * breath - lift;
    rx *= ex.wide * 1.35; ry *= ex.wide * 1.35;
    fx.save(); fx.translate(x, y); fx.scale(1, sy);
    fx.fillStyle = '#fbfaf5'; fx.beginPath(); fx.ellipse(0, 0, rx, ry, 0, 0, 7); fx.fill();
    // pupil
    let px = pox + gazeX * look.gaze[0] * s, py = poy + gazeY * look.gaze[1] * s;
    const pr2x = prx * ex.pupil * 1.25, pr2y = pry * ex.pupil * 1.25;
    const mx = rx - pr2x - 1.2 * s, my = ry - pr2y - 1.2 * s;
    px = clamp(px, -mx, mx); py = clamp(py, -my, my);
    fx.fillStyle = '#131211'; fx.beginPath(); fx.ellipse(px, py, pr2x, pr2y, 0, 0, 7); fx.fill();
    // two crisp catchlights keep the gaze readable even when Nibbi is tiny
    fx.fillStyle = 'rgba(251,250,245,0.96)';
    fx.beginPath(); fx.ellipse(px - pr2x * 0.34, py - pr2y * 0.42, pr2x * look.glint[0], pr2y * look.glint[1], 0, 0, 7); fx.fill();
    fx.fillStyle = 'rgba(251,250,245,0.58)';
    fx.beginPath(); fx.arc(px + pr2x * 0.32, py + pr2y * 0.29, Math.max(0.8, pr2x * look.glint[2]), 0, Math.PI * 2); fx.fill();
    // lids (body ink closing over the white)
    if (ex.lidTop > 0.005 || ex.lidBot > 0.005) {
      fx.beginPath(); fx.ellipse(0, 0, rx + 0.5, ry + 0.5, 0, 0, 7); fx.clip();
      fx.fillStyle = '#141312';
      if (ex.lidTop > 0.005) { fx.beginPath(); fx.ellipse(0, -ry * 2.3 + ex.lidTop * ry * 2.6, rx * 2.2, ry * 2.1, 0, 0, 7); fx.fill(); }
      if (ex.lidBot > 0.005) { fx.beginPath(); fx.ellipse(0, ry * 2.5 - ex.lidBot * ry * 2.3, rx * 1.9, ry * 1.9, 0, 0, 7); fx.fill(); }
    }
    fx.restore();
  }

  document.addEventListener('visibilitychange', () => { if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = 0; } else if (!raf) { lastT = now(); raf = requestAnimationFrame(frame); } });
  frame();

  /* ------------------------------------------------ api */
  const api = {
    setTarget({ x, y, r }) { if (x !== undefined) target.x = x; if (y !== undefined) target.y = y; if (r !== undefined) target.r = r; },
    snapTarget(t) { api.setTarget(t); poseSnap = true; },
    setMood(m) {
      if (!MOODS[m]) return; const prev = mood; mood = m; moodDef = MOODS[m]; moodAt = now();
      if (m === 'happy' && prev !== 'happy') api.hop();
      if (m === 'error' && prev !== 'error') { flatAt = now(); shakeAt = now() + 120; api.spatter(6, 1.25); }
      if (m === 'listening' && prev !== 'listening') api.blink();
      fadeT = 1;
    },
    mood: () => mood,
    lookAt(x, y) { lookX = x; lookY = y; },
    lookFree() { lookX = null; lookY = null; },
    pointer(x, y) { ptrX = x; ptrY = y; ptrAt = now(); },
    pulse(e) { speechE = clamp(Math.max(speechE, e), 0, 1); },
    hop() { const t = now(); if (t - hopAt < HOP_D) return; hopAt = t; spawnDroplet(t + 150, -1); spawnDroplet(t + 180, 1); },
    blink() { const t = now(); if (t - blinkAt > BLINK_D) blinkAt = t; },
    spatter(k, spread) { const t = now(); for (let i = 0; i < (k || 1); i++) spawnSpat(t + i * 40, spread); },
    drip() { spawnDroplet(now(), rnd() < 0.5 ? -1 : 1, 1); },
    shake() { shakeAt = now(); },
    setFade(v) { fadeT = clamp(v, 0, 1); },
    setReducedMotion(b) { reduced = !!b; frozenDrawn = false; },
    paperDataURL,
    state: () => ({ x: pose.x, y: pose.y, r: pose.r, mood, look: lookName, fps, gl: glOK, tx: target.x, ty: target.y, tr: target.r }),
    hitTest(x, y) { const dx = x - pose.x, dy = y - pose.y; return dx * dx + dy * dy < (1.35 * pose.r) * (1.35 * pose.r); },
  };
  return api;
}

window.createNibbi = createNibbi;
})();

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
uniform float u_fade;     // overall alpha
uniform float u_hAmp;     // harmonic amplitude multiplier (mood)
uniform vec2  u_flow;     // slow drift of the inner ink wash
uniform float u_wet;      // feather breathing 0..1
uniform vec3  u_tint;     // agent ink colour
uniform float u_tintAmt;  // 0 = black ink, 1 = tinted
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
  float rr = 1.0 + u_hAmp * (u_h.x * cos(2.0*an + u_hp.x) + u_h.y * cos(3.0*an + u_hp.y) + u_h.z * cos(5.0*an + u_hp.z) + u_h.w * cos(7.0*an + u_hp.w));
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
  float pf = 1.0 + 0.8 * u_poof + 0.22 * u_wet;
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
  float wash = fbm(nq * 2.2 + u_flow) - 0.5;                       // slow-moving density variation inside the ink
  float tone = 0.035 + (0.065 * t2 + 0.03 * t1) * (0.1 + 0.9 * edge) + 0.02 * (1.0 - gr) + 0.05 * wash * (1.0 - edge);
  vec3 inkB = mix(vec3(tone * 0.98, tone * 0.97, tone), u_tint * (0.62 + 3.4 * tone), u_tintAmt);

  /* no pool / shadow: the blot sits directly on the paper */
  float outA = A * u_fade;
  vec3 col = inkB * A * u_fade;
  gl_FragColor = vec4(col, outA);
}`;

/* ---------------------------------------------------------------- look (pip: low, shy, oversized pupils) */
const LOOK = {
  h: [0.054, 0.048, 0.028, 0.016], hp: [1.1, 2.6, 4.7, 1.7], hRate: [0.11, -0.08, 0.14, -0.19],
  gaze: [2.2, 2.0], glint: [0.29, 0.23, 0.12],
  eyes: [
    { x: -35.0, y: 13.0, rx: 29.0, ry: 33.75, prx: 15.9, pry: 18.75, pox: 0.3, poy: 2.4 },
    { x:  35.0, y: 12.0, rx: 29.9, ry: 34.4,  prx: 16.4, pry: 19.1,  pox: -0.3, poy: 2.2 },
  ],
};

/* ---------------------------------------------------------------- moods */
const MOODS = {
  idle:      { lidTop: 0.00, lidBot: 0.00, wide: 1.02, pupil: 0.88, boil: 9,  breathAmp: 0.017, breathHz: 1 / 4.6, gazeBias: [0, 0],         puffIdle: 0, lumpy: 1.0, drip: [24000, 30000], blinkGap: [3000, 4000] },
  listening: { lidTop: 0.00, lidBot: 0.00, wide: 1.09, pupil: 0.94, boil: 9,  breathAmp: 0.012, breathHz: 1 / 3.2, gazeBias: [0, -0.05],     puffIdle: 0, lumpy: 0.9, drip: [0, 0],         blinkGap: [3800, 3000] },
  thinking:  { lidTop: 0.12, lidBot: 0.00, wide: 1.02, pupil: 0.84, boil: 13, breathAmp: 0.014, breathHz: 1 / 2.6, gazeBias: [-0.32, -0.30], puffIdle: 9, lumpy: 1.5, drip: [5000, 4000],   blinkGap: [2400, 2600] },
  working:   { lidTop: 0.00, lidBot: 0.00, wide: 1.01, pupil: 0.88, boil: 15, breathAmp: 0.013, breathHz: 1 / 2.2, gazeBias: [0.08, 0.28],   puffIdle: 5, lumpy: 1.25, drip: [1500, 1400], blinkGap: [2200, 2400] },
  speaking:  { lidTop: 0.04, lidBot: 0.00, wide: 1.03, pupil: 0.90, boil: 11, breathAmp: 0.015, breathHz: 1 / 3.4, gazeBias: [0, 0.08],      puffIdle: 0, lumpy: 1.1, drip: [0, 0],         blinkGap: [3000, 3000] },
  happy:     { lidTop: 0.00, lidBot: 0.32, wide: 1.02, pupil: 0.82, boil: 11, breathAmp: 0.02,  breathHz: 1 / 2.4, gazeBias: [0, -0.36],     puffIdle: 0, lumpy: 1.3, drip: [0, 0],         blinkGap: [3000, 3000] },
  error:     { lidTop: 0.00, lidBot: 0.00, wide: 1.18, pupil: 0.58, boil: 7,  breathAmp: 0.008, breathHz: 1 / 1.9, gazeBias: [0.15, -0.1],   puffIdle: 0, lumpy: 0.6, drip: [900, 600],     blinkGap: [1600, 1200] },
  sleep:     { lidTop: 0.62, lidBot: 0.00, wide: 0.98, pupil: 1.00, boil: 5,  breathAmp: 0.026, breathHz: 1 / 6.5, gazeBias: [0, 0.6],       puffIdle: 0, lumpy: 0.8, drip: [40000, 30000], blinkGap: [6000, 6000] },
};

function createNibbi(opts) {
  const inkCv = opts.ink, fxCv = opts.fx;
  const fx = fxCv.getContext('2d'); const FX = fx;
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
  let nextBead = 9000, nextShiver = 30000;
  let moving = false, peakSpd = 0, landAt = -1e4;
  let hAmp = 1, flowX = 0, flowY = 0;
  const mirrors = new Set();          // small DOM canvases that show a live copy of the character
  const agents = new Map();           // id → { canvas, color:[r,g,b], mood, seed }: tinted companions rendered as separate passes
  const beads = []; for (let i = 0; i < 4; i++) beads.push({ on: false });
  function spawnBead(t) {
    for (const bd of beads) {
      if (bd.on) continue;
      bd.on = true; bd.t = t; bd.phase = 'form'; bd.x = pose.x + (rnd() - 0.5) * 0.9 * pose.r; bd.y = 0; bd.vy = 0;
      bd.form = 650 + rnd() * 550; bd.hang = 9 + rnd() * 9; bd.size = 3.0 + rnd() * 1.8; bd.dropTo = 12 + rnd() * 10;
      return;
    }
  }
  /* a drop that lands leaves a small stain that slowly dries away */
  function stain(x, y, r) {
    for (const sp of spatDyn) {
      if (sp.on && now() - sp.born < sp.life) continue;
      sp.on = true; sp.born = now(); sp.abs = true; sp.x = x + (rnd() - 0.5) * 3; sp.y = y; sp.r = Math.max(1.2, r); sp.life = 3800 + rnd() * 2600;
      return;
    }
  }

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
      sp.on = true; sp.born = t; sp.abs = false; sp.ox = Math.cos(a) * rad; sp.oy = Math.sin(a) * rad * 0.75 + 20 * s; sp.r = (1.4 + rnd() * 3.0) * s; sp.life = 4500 + rnd() * 2500;
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
      U = {}; for (const n of ['u_dpr', 'u_center', 'u_R', 'u_breath', 'u_h', 'u_hp', 'u_noff', 'u_puff', 'u_lift', 'u_sq', 'u_lean', 'u_poof', 'u_fade', 'u_hAmp', 'u_flow', 'u_wet', 'u_tint', 'u_tintAmt', 'u_grain']) U[n] = gl.getUniformLocation(prog, n);
      gl.disable(gl.BLEND); gl.clearColor(0, 0, 0, 0);
      gl.uniform4f(U.u_h, LOOK.h[0], LOOK.h[1], LOOK.h[2], LOOK.h[3]); gl.uniform4f(U.u_hp, LOOK.hp[0], LOOK.hp[1], LOOK.hp[2], LOOK.hp[3]); gl.uniform1i(U.u_grain, 0); gl.uniform1f(U.u_hAmp, 1); gl.uniform2f(U.u_flow, 0, 0); gl.uniform1f(U.u_wet, 0); gl.uniform3f(U.u_tint, 0, 0, 0); gl.uniform1f(U.u_tintAmt, 0);
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
    fx.fillStyle = 'rgba(24,23,22,0.45)';
    for (let i = 0; i < 64; i++) { const a = (i / 64) * Math.PI * 2; fx.beginPath(); fx.arc(cx + Math.cos(a) * 0.98 * R, cy + Math.sin(a) * 0.9 * R, 9 * s, 0, 7); fx.fill(); }
    fx.fillStyle = '#171614'; fx.beginPath(); fx.ellipse(cx, cy, R * 0.9, R * 0.8, 0, 0, 7); fx.fill(); fx.fillRect(cx - R * 0.82, cy, R * 1.64, yb - cy - 4 * s);
    fx.restore();
  }

  /* ------------------------------------------------ hop curves */
  const hopLift = (ht) => (ht < 110 || ht >= 520) ? 0 : ht < 330 ? 30 * (1 - Math.pow(1 - (ht - 110) / 220, 2)) : 30 * (1 - Math.pow((ht - 330) / 190, 2));
  const hopSquash = (ht) => (ht < 0 || ht >= HOP_D + 160) ? 1 : ht < 110 ? 1 - 0.14 * (ht / 110) : ht < 330 ? 0.86 + 0.20 * ((ht - 110) / 220) : ht < 520 ? 1.06 - 0.06 * ((ht - 330) / 190) : ht < 620 ? 1 - 0.11 * Math.sin(((ht - 520) / 100) * Math.PI) : 1;
  const hopPoof = (ht) => (ht < 520 || ht > 1000) ? 0 : Math.exp(-(ht - 520) / 190);

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

    /* motion → squash & stretch: a soft body elongates along fast travel and lands with a splat */
    const spd = Math.hypot(pose.vx, pose.vy);
    if (spd > 260) { moving = true; peakSpd = Math.max(peakSpd, spd); }
    else if (moving && spd < 60) { moving = false; if (peakSpd > 700) { landAt = t; if (!reduced) spawnSpat(t + 40, 0.8); } peakSpd = 0; }
    const velStretch = reduced ? 1 : 1 + clamp(Math.abs(pose.vy) / 5200, 0, 0.16) - clamp(Math.abs(pose.vx) / 9000, 0, 0.06);
    const lt = t - landAt;
    const landPoof = (lt >= 0 && lt < 520) ? Math.exp(-lt / 170) : 0;
    const landSquash = (lt >= 0 && lt < 420 && !reduced) ? 1 - 0.13 * Math.sin(Math.PI * lt / 420) : 1;

    /* expression smoothing */
    ex.lidTop = sm(ex.lidTop, moodDef.lidTop, dt, 0.008); ex.lidBot = sm(ex.lidBot, moodDef.lidBot, dt, 0.008);
    ex.wide = sm(ex.wide, moodDef.wide, dt, 0.006); ex.pupil = sm(ex.pupil, moodDef.pupil, dt, 0.006);
    fade = sm(fade, fadeT, dt, 0.004);
    hAmp = sm(hAmp, moodDef.lumpy, dt, 0.003);

    const breath = reduced ? 1 : 1 + moodDef.breathAmp * Math.sin(ts * Math.PI * 2 * moodDef.breathHz);

    /* boil: quantized noise offset at a mood-dependent rate; talking makes the ink boil harder */
    let noffX, noffY;
    if (reduced) { [noffX, noffY] = frozenNoff; }
    else {
      boilClock += dts * moodDef.boil * (1 + 1.6 * speechE);
      const bi = Math.floor(boilClock), fr = BOIL_OFF[bi % 3], tq = bi / 9;
      noffX = fr[0] + tq * 0.011; noffY = fr[1] - tq * 0.007; frozenNoff = [noffX, noffY]; frozenDrawn = false;
      flowX += dts * 0.02; flowY -= dts * 0.013;                          // inner wash drifts very slowly
    }
    const wet = reduced ? 0 : 0.5 + 0.5 * Math.sin(ts * 0.9 + 1.0);         // the feather breathes like wet ink

    /* puff: toward pointer when near, or idle bubbling for thinking/working */
    const pdx = ptrX - cx, pdy = ptrY - cy, pd = Math.hypot(pdx, pdy);
    const nearPtr = t - ptrAt < 4000 && pd < 2.3 * R && pd > 1;
    let puffT = 0;
    if (!reduced && nearPtr) { puffT = (1 - pd / (2.3 * R)) * 13 * s; puffDX = pdx / pd; puffDY = -pdy / pd; }
    else if (!reduced && moodDef.puffIdle) { puffAng += dts * 1.7; puffDX = Math.cos(puffAng); puffDY = Math.sin(puffAng) * 0.6 + 0.4; puffT = moodDef.puffIdle * s * (0.6 + 0.4 * Math.sin(ts * 5.1)); }
    puffAmt = sm(puffAmt, puffT, dt, 0.008);

    /* lean: crown trails fast sideways travel, tilts toward what it looks at, sways while talking */
    let leanT = 0;
    if (lookX !== null && Math.abs(lookX - cx) > R) leanT = clamp((lookX - cx) / (4 * R), -1, 1) * 10 * s;
    leanT += gazeX * 2.2 * s;
    if (!reduced) leanT += clamp(-pose.vx / 70, -12, 12) * s;
    if (speechE > 0.02) leanT += Math.sin(ts * 6.3) * 4 * s * speechE;
    leanAmt = sm(leanAmt, leanT, dt, 0.006);

    /* gaze: quick saccades toward the target, slow wander otherwise */
    const bias = moodDef.gazeBias;
    if (lookX !== null) { const gx = lookX - cx, gy = lookY - cy, gd = Math.hypot(gx, gy) || 1; gazeTX = clamp(gx / gd * Math.min(1, gd / (1.4 * R)), -1, 1); gazeTY = clamp(gy / gd * Math.min(1, gd / (1.4 * R)), -1, 1); }
    else if (t - ptrAt < 6000 && pd < 2.6 * R) { gazeTX = clamp(pdx / (1.5 * R), -1, 1); gazeTY = clamp(pdy / (1.5 * R), -1, 1); }
    else if (t >= nextWander) { gazeTX = (rnd() - 0.5) * 1.4; gazeTY = (rnd() - 0.5) * 1.0; nextWander = t + 2500 + rnd() * 2500; }
    gazeX = sm(gazeX, clamp(gazeTX + bias[0], -1, 1), dt, 0.011); gazeY = sm(gazeY, clamp(gazeTY + bias[1], -1, 1), dt, 0.011);
    const interest = nearPtr ? 1 + 0.08 * (1 - pd / (2.3 * R)) : 1;       // pupils widen a touch when you come close

    /* blink schedule (sometimes a double blink) */
    if (t >= nextBlink) { blinkAt = t; const dbl = rnd() < 0.14; nextBlink = t + (dbl ? 330 : moodDef.blinkGap[0] + rnd() * moodDef.blinkGap[1]); }
    /* ambient spatter, idle shivers */
    if (!reduced && t >= nextSpat) { spawnSpat(t); nextSpat = t + 10000 + rnd() * 8000; }
    if (!reduced && mood === 'idle' && t >= nextShiver) { shakeAt = t; spawnSpat(t + 60, 0.7); spawnSpat(t + 120, 0.9); nextShiver = t + 45000 + rnd() * 40000; }
    /* drips: a bead forms at the belly, hangs, drops into the pool and stains */
    if (!reduced && moodDef.drip[0] && t >= nextBead) { spawnBead(t); nextBead = t + moodDef.drip[0] + rnd() * moodDef.drip[1]; }

    /* hop + speech + shake + flatten */
    const ht = t - hopAt;
    let lift = hopLift(ht) * s, squash = hopSquash(ht) * velStretch * landSquash, poof = Math.max(hopPoof(ht), landPoof);
    speechE *= Math.pow(0.55, dts * 6);   // ~ decays over ~0.4s
    if (speechE > 0.01 && !reduced) { speechPhase += dts * 21; lift += Math.abs(Math.sin(speechPhase)) * 3.2 * s * speechE; squash *= 1 + 0.035 * speechE * Math.sin(speechPhase * 2); }
    const sht = t - shakeAt; if (sht >= 0 && sht < 420 && !reduced) { const e = 1 - sht / 420; leanAmt += Math.sin(sht / 22) * 9 * s * e; }
    const flt = t - flatAt; if (flt >= 0 && flt < 700) { const u = flt / 700; squash *= 1 - 0.22 * Math.sin(Math.PI * Math.min(1, u * 1.15)) * (1 - u * 0.3); }
    const hopping = (ht >= 0 && ht < 1400) || (lt >= 0 && lt < 1400);

    /* droplets (ejected on hops) */
    for (const d of drops) { if (!d.on) continue; const a = t - d.t; if (a < 0) continue; if (a > 1100 || d.y > yb + 26 * s) { if (d.on && d.y > yb) stain(d.x, d.y, d.r * 0.9); d.on = false; continue; } d.vy += 560 * s * dts; d.x += d.vx * dts; d.y += d.vy * dts; }
    /* beads */
    for (const bd of beads) {
      if (!bd.on) continue; const a = t - bd.t;
      if (bd.phase === 'form') { if (a > bd.form) { bd.phase = 'fall'; bd.vy = 40 * s; bd.y = yb + 1 * s + bd.hang * s; } }
      else { bd.vy += 700 * s * dts; bd.y += bd.vy * dts; if (bd.y > yb + bd.dropTo * s) { stain(bd.x, bd.y, bd.size * 0.8 * s); bd.on = false; } }
    }

    /* ---- GL: agents (tinted companions) — drawn in a scratch corner, copied into their canvases, then cleared ---- */
    if (glOK && agents.size) {
      const aR = 60, acx = aR * 1.6, acy = aR * 1.75;
      const asx = acx - 1.55 * aR, asw = 3.1 * aR, asy = acy - 1.5 * aR - 14, ash = 2.4 * aR + 14;
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(Math.floor(asx * DPR), Math.floor((H - (asy + ash)) * DPR), Math.ceil(asw * DPR), Math.ceil(ash * DPR));
      gl.uniform2f(U.u_center, acx, H - acy); gl.uniform1f(U.u_R, aR);
      gl.uniform3f(U.u_puff, 1, 0, 0); gl.uniform1f(U.u_lift, 0); gl.uniform1f(U.u_lean, 0); gl.uniform1f(U.u_poof, 0); gl.uniform1f(U.u_fade, 1); gl.uniform1f(U.u_hAmp, 1.1); gl.uniform1f(U.u_wet, wet); gl.uniform1f(U.u_tintAmt, 1);
      const hp = LOOK.hp, sA = aR / R0, ybA = acy + 0.66 * aR;
      for (const [id, ag] of agents) {
        const cv = ag.canvas;
        if (!cv.isConnected) { agents.delete(id); continue; }
        const r = cv.getBoundingClientRect(); if (r.width === 0 || r.bottom < 0 || r.top > H) continue;
        const md = MOODS[ag.mood] || MOODS.working, ph = ag.seed * 7.3;
        const br = reduced ? 1 : 1 + md.breathAmp * Math.sin(ts * Math.PI * 2 * md.breathHz + ph);
        const bc = reduced ? 0 : Math.floor((ts + ag.seed * 3.1) * md.boil), fr = BOIL_OFF[bc % 3];
        gl.uniform1f(U.u_breath, br);
        gl.uniform2f(U.u_noff, fr[0] + ag.seed * 2.7 + (bc / 9) * 0.011, fr[1] + ag.seed * 1.9 - (bc / 9) * 0.007);
        gl.uniform2f(U.u_flow, flowX + ag.seed, flowY - ag.seed);
        gl.uniform1f(U.u_sq, (md === MOODS.working && !reduced) ? 1 + 0.02 * Math.sin(ts * 5 + ph) : 1);
        gl.uniform4f(U.u_hp, hp[0] + ph, hp[1] - ph * 0.7, hp[2] + ph * 1.3, hp[3] - ph * 0.4);
        gl.uniform3f(U.u_tint, ag.color[0], ag.color[1], ag.color[2]);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        const mw = Math.round(r.width * DPR), mh = Math.round(r.height * DPR);
        if (cv.width !== mw || cv.height !== mh) { cv.width = mw; cv.height = mh; }
        const g = cv._g || (cv._g = cv.getContext('2d'));
        g.clearRect(0, 0, mw, mh); g.imageSmoothingQuality = 'high';
        const k = Math.min(mw / (asw * DPR), mh / (ash * DPR)), dw = asw * DPR * k, dh = ash * DPR * k, dx = (mw - dw) / 2, dy = mh - dh;
        g.drawImage(inkCv, asx * DPR, asy * DPR, asw * DPR, ash * DPR, dx, dy, dw, dh);
        // eyes, straight into the small canvas
        const bt = (t + ag.seed * 4000) % (3200 + ag.seed * 1500); const bl = bt < 110 ? bt / 110 : bt < 240 ? 1 - (bt - 110) / 130 : 0;
        const E = { lidTop: md.lidTop, lidBot: md.lidBot, wide: md.wide, pupil: md.pupil };
        const gxA = clamp(md.gazeBias[0] + 0.25 * Math.sin(ts * 0.7 + ph), -1, 1), gyA = clamp(md.gazeBias[1] + 0.2 * Math.cos(ts * 0.5 + ph), -1, 1);
        g.save(); g.translate(dx, dy); g.scale(k * DPR, k * DPR); g.translate(-asx, -asy);
        for (const eye of LOOK.eyes) drawEye(acx + eye.x * sA, acy + eye.y * sA, eye.rx * sA, eye.ry * sA, eye.prx * sA, eye.pry * sA, eye.pox * sA, eye.poy * sA, br, 0, 1 - 0.12 * bl, ybA, acx, sA, bl, 1, g, E, gxA, gyA);
        g.restore();
      }
      gl.clear(gl.COLOR_BUFFER_BIT);           // wipe the scratch corner (still scissored)
      gl.uniform1f(U.u_tintAmt, 0);
    }

    /* ---- GL ---- */
    if (glOK) {
      const need = !reduced || hopping || puffAmt > 0.2 || !frozenDrawn || Math.abs(pose.vx) + Math.abs(pose.vy) + Math.abs(pose.vr) > 0.5;
      if (need) {
        gl.enable(gl.SCISSOR_TEST);
        const bx = Math.max(0, Math.floor((cx - 2.7 * R) * DPR)), bw = Math.ceil(5.4 * R * DPR);
        const byTop = cy - 2.5 * R - 60 * s, byBot = cy + 1.8 * R;
        const by = Math.max(0, Math.floor((H - byBot) * DPR)), bh = Math.ceil((byBot - byTop) * DPR);
        gl.scissor(bx, by, bw, bh);
        gl.uniform2f(U.u_center, cx, H - cy); gl.uniform1f(U.u_R, R);
        gl.uniform1f(U.u_breath, breath); gl.uniform2f(U.u_noff, noffX, noffY);
        gl.uniform3f(U.u_puff, puffDX, puffDY, puffAmt); gl.uniform1f(U.u_lift, lift); gl.uniform1f(U.u_sq, squash);
        gl.uniform1f(U.u_lean, leanAmt); gl.uniform1f(U.u_poof, poof); gl.uniform1f(U.u_fade, fade);
        gl.uniform1f(U.u_hAmp, hAmp); gl.uniform2f(U.u_flow, flowX, flowY); gl.uniform1f(U.u_wet, wet);
        const hr = LOOK.hRate, hp = LOOK.hp, tp = reduced ? 0 : ts;
        gl.uniform4f(U.u_hp, hp[0] + hr[0] * tp, hp[1] + hr[1] * tp, hp[2] + hr[2] * tp, hp[3] + hr[3] * tp);   // the silhouette slowly shifts
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
      fx.globalAlpha = Math.max(0, al) * fade;
      const ox = sp.abs ? sp.x : cx + sp.ox, oy = sp.abs ? sp.y : cy + sp.oy;
      fx.beginPath(); fx.ellipse(ox, oy, sp.r * sc, sp.r * sc * 0.85, 0.4, 0, 7); fx.fill();
    }
    fx.globalAlpha = fade;
    for (const d of drops) { if (!d.on || t < d.t) continue; fx.beginPath(); fx.ellipse(d.x, d.y - lift * 0.3, d.r, d.r * 1.25, 0, 0, 7); fx.fill(); }
    /* beads: teardrop forming at the belly edge, then a falling drop */
    fx.fillStyle = '#151413';
    for (const bd of beads) {
      if (!bd.on) continue; const a = t - bd.t;
      if (bd.phase === 'form') {
        const u = Math.min(1, a / bd.form), g = u * u * (3 - 2 * u);
        const by0 = yb - lift + 1 * s, len = bd.hang * s * g, w = bd.size * s * (0.35 + 0.65 * g);
        fx.beginPath(); fx.moveTo(bd.x - w * 0.9, by0); fx.quadraticCurveTo(bd.x - w * 0.9, by0 + len * 0.55, bd.x, by0 + len + w); fx.quadraticCurveTo(bd.x + w * 0.9, by0 + len * 0.55, bd.x + w * 0.9, by0); fx.closePath(); fx.fill();
      } else {
        const st = 1 + Math.min(0.9, bd.vy / 900);
        fx.beginPath(); fx.ellipse(bd.x, bd.y, bd.size * s * 0.8, bd.size * s * 0.8 * st, 0, 0, 7); fx.fill();
      }
    }

    /* eyes — the pip rig: low, wide-set, big pupils, two catchlights; blink = ink lids closing */
    const bt = t - blinkAt; let blinkLid = 0;
    if (bt >= 0 && bt < BLINK_D) { blinkLid = bt < 110 ? bt / 110 : 1 - (bt - 110) / 130; blinkLid = clamp(blinkLid, 0, 1); }
    const eyeSY = (1 - 0.12 * blinkLid) * (0.9 + 0.1 * squash);
    for (const eye of LOOK.eyes) drawEye(cx + eye.x * s + leanAmt * 0.55, cy + eye.y * s, eye.rx * s, eye.ry * s, eye.prx * s, eye.pry * s, eye.pox * s, eye.poy * s, breath, lift, eyeSY, yb, cx, s, blinkLid, interest);
    fx.globalAlpha = 1;

    /* mirrors: copy the finished character (ink + eyes) into each small canvas that is on screen */
    if (mirrors.size) {
      const sx = cx - 1.55 * R, sw = 3.1 * R, sy = cy - 1.5 * R - 34 * s, sh = 2.4 * R + 34 * s;
      for (const m of mirrors) {
        if (!m.isConnected) { mirrors.delete(m); continue; }
        const r = m.getBoundingClientRect();
        if (r.bottom < 0 || r.top > H || r.width === 0) continue;
        const mw = Math.round(r.width * DPR), mh = Math.round(r.height * DPR);
        if (m.width !== mw || m.height !== mh) { m.width = mw; m.height = mh; }
        const g = m._g || (m._g = m.getContext('2d'));
        g.clearRect(0, 0, mw, mh); g.imageSmoothingQuality = 'high';
        const k = Math.min(mw / (sw * DPR), mh / (sh * DPR)), dw = sw * DPR * k, dh = sh * DPR * k, dx = (mw - dw) / 2, dy = mh - dh;
        g.drawImage(inkCv, sx * DPR, sy * DPR, sw * DPR, sh * DPR, dx, dy, dw, dh);
        g.drawImage(fxCv, sx * DPR, sy * DPR, sw * DPR, sh * DPR, dx, dy, dw, dh);
      }
    }
  }

  function drawEye(exx, eyy, rx, ry, prx, pry, pox, poy, breath, lift, sy, ybase, cx, s, blinkLid, interest, ctx, E, gx, gy) {
    const fx = ctx || FX; const e = E || ex; const gzX = gx === undefined ? gazeX : gx, gzY = gy === undefined ? gazeY : gy;
    const x = cx + (exx - cx) * breath, y = ybase - (ybase - eyy) * breath - lift;
    rx *= e.wide; ry *= e.wide;
    fx.save(); fx.translate(x, y); fx.scale(1, sy);
    fx.fillStyle = '#fbfaf5'; fx.beginPath(); fx.ellipse(0, 0, rx, ry, 0, 0, 7); fx.fill();
    // pupil
    let px = pox + gzX * LOOK.gaze[0] * s, py = poy + gzY * LOOK.gaze[1] * s;
    const pr2x = prx * e.pupil * interest, pr2y = pry * e.pupil * interest;
    const mx = rx - pr2x - 1.2 * s, my = ry - pr2y - 1.2 * s;
    px = clamp(px, -mx, mx); py = clamp(py, -my, my);
    fx.fillStyle = '#131211'; fx.beginPath(); fx.ellipse(px, py, pr2x, pr2y, 0, 0, 7); fx.fill();
    // two catchlights keep the gaze readable even when nibbi is small
    fx.fillStyle = 'rgba(251,250,245,0.96)';
    fx.beginPath(); fx.ellipse(px - pr2x * 0.34, py - pr2y * 0.42, pr2x * LOOK.glint[0], pr2y * LOOK.glint[1], 0, 0, 7); fx.fill();
    fx.fillStyle = 'rgba(251,250,245,0.58)';
    fx.beginPath(); fx.arc(px + pr2x * 0.32, py + pr2y * 0.29, Math.max(0.8, pr2x * LOOK.glint[2]), 0, Math.PI * 2); fx.fill();
    // lids (body ink closing over the white) — expression lids + the blink
    const top = clamp(e.lidTop + blinkLid * (1 - e.lidTop), 0, 1), bot = e.lidBot;
    if (top > 0.005 || bot > 0.005) {
      fx.beginPath(); fx.ellipse(0, 0, rx + 0.5, ry + 0.5, 0, 0, 7); fx.clip();
      fx.fillStyle = '#141312';
      // lid ellipses are big so their edges curve gently; `top`/`bot` are the covered fraction of the eye height
      if (top > 0.005) { fx.beginPath(); fx.ellipse(0, -ry - 2.1 * ry + top * 2 * ry, rx * 2.2, ry * 2.1, 0, 0, 7); fx.fill(); }
      if (bot > 0.005) { fx.beginPath(); fx.ellipse(0, ry + 1.9 * ry - bot * 2 * ry, rx * 1.9, ry * 1.9, 0, 0, 7); fx.fill(); }
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
      if (moodDef.drip[0]) nextBead = Math.min(nextBead, now() + 500 + rnd() * moodDef.drip[0]);
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
    drip() { spawnBead(now()); },
    shake() { shakeAt = now(); },
    setFade(v) { fadeT = clamp(v, 0, 1); },
    setReducedMotion(b) { reduced = !!b; frozenDrawn = false; },
    paperDataURL,
    state: () => ({ x: pose.x, y: pose.y, r: pose.r, mood, fps, gl: glOK, tx: target.x, ty: target.y, tr: target.r }),
    addMirror(canvas) { mirrors.add(canvas); },
    /* agents: [{ id, canvas, color: [r,g,b] 0..1, mood, seed 0..1 }] — replaces the set */
    setAgents(list) {
      const keep = new Set();
      for (const a of list) { keep.add(a.id); const cur = agents.get(a.id); if (cur) { cur.mood = a.mood; cur.color = a.color; cur.canvas = a.canvas; } else agents.set(a.id, { canvas: a.canvas, color: a.color, mood: a.mood, seed: a.seed === undefined ? rnd() : a.seed }); }
      for (const id of [...agents.keys()]) if (!keep.has(id)) agents.delete(id);
    },
    removeMirror(canvas) { mirrors.delete(canvas); },
    hitTest(x, y) { const dx = x - pose.x, dy = y - pose.y; return dx * dx + dy * dy < (1.35 * pose.r) * (1.35 * pose.r); },
  };
  return api;
}

window.createNibbi = createNibbi;
})();

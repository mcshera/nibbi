/* nibbi.js — the ink-blot character engine.
   WebGL SDF ink body (lumpy dome + tuft fringe + pool) on a full-window canvas, eyes/spatter/droplets on a 2D canvas.
   Public API (window.createNibbi):
     const n = createNibbi({ ink: canvasEl, fx: canvasEl });
     n.setTarget({ x, y, r })   // where the body center should be (css px) and its base radius; spring-eased
     n.setMood('idle'|'listening'|'thinking'|'working'|'speaking'|'happy'|'error'|'sleep')
     n.lookAt(x, y) | n.lookFree()     // gaze target in css px, or back to wander/pointer
     n.lookDirection(x, y)             // Pocket: fixed direction [-1,1]; +x right, +y down
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

// Smooth radial fit to the approved ink-bubble hero silhouette. The reference
// has a narrow dome and broad lower cheeks; an ellipse reverses that balance.
// Angles use screen coordinates (positive y down), shared by both renderers.
const B_PROFILE = Object.freeze({
  radius:.7900250,
  harmonics:Object.freeze([
    [.0067754,.0311077],[.1165685,-.0006183],[.0023390,.0484374],
    [.0120854,.0001272],[.0005678,.0050743],[-.0001541,-.0061422],
  ]),
});

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
// Pocket spring opt-in; the legacy controller leaves u_pocket at zero.
uniform float u_pocket;
uniform vec2 u_scale;
uniform vec2 u_rotation;
uniform vec2 u_shift;
uniform vec3 u_shape;
uniform float u_character; // 0 = original; 1 wash, 2 pooled ink, 3 dry brush

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
  if (u_pocket < 0.5 && dot(p, p) > 7.3 * u_R * u_R) { gl_FragColor = vec4(0.0); return; }
  float R = u_R * u_breath;
  float yb = -0.66 * u_R;
  vec2 q = p;
  if (u_pocket > 0.5) {
    // Inverse of pocketMap(): identical foot, crown bend, scale and rotation for ink and eyes.
    vec2 v = vec2(p.x,-p.y)/u_R-vec2(u_shift.x,0.66-u_shift.y);
    q = vec2(u_rotation.x*v.x+u_rotation.y*v.y,-u_rotation.y*v.x+u_rotation.x*v.y)/u_scale;
    q.y += 0.66;
    q.x -= (u_lean/u_R)*clamp((0.66-q.y)/1.6,0.0,1.2);
    if (dot(q,q)>8.0) { gl_FragColor=vec4(0.0); return; }
    q *= vec2(u_R,-u_R);
  } else {
    q.y -= u_lift;
    q.y = yb + (q.y - yb) / u_sq;
    q.x = q.x * (u_sq * 0.55 + 0.45);
    q.x -= u_lean * clamp((q.y - yb) / (1.6 * u_R), 0.0, 1.2);
  }

  if (u_character > 0.5) {
    // Flat pigment on paper: every texture coordinate travels with the body.
    // There is no lighting, depth normal, specular highlight or ground shadow.
    vec2 n = q / R;
    float bh = 1.0 + (0.06*u_shape.x + 0.12*u_shape.z)/0.82;
    float bw = 1.0 - (0.035*u_shape.x + 0.045*u_shape.z)/1.015;
    vec2 b = vec2(n.x/bw,0.66+(-n.y-0.66)/bh);
    float bl = length(b);
    vec2 turn = bl>0.0 ? b/bl : vec2(1.0,0.0);
    vec2 harmonic = turn;
    float rad = ${B_PROFILE.radius.toFixed(7)};
    ${B_PROFILE.harmonics.map(([c,s],i)=>`rad += (${c.toFixed(7)})*harmonic.x+(${s.toFixed(7)})*harmonic.y;${i===4?' rad += 0.020*u_shape.y*harmonic.x;':''}${i<5?' harmonic = vec2(harmonic.x*turn.x-harmonic.y*turn.y,harmonic.y*turn.x+harmonic.x*turn.y);':''}`).join('\n    ')}
    float d = (bl-rad)*min(bw,bh);
    if (d > 0.18) { gl_FragColor=vec4(0.0); return; }
    float coarse = fbm(n*5.8+vec2(8.2,3.7));
    float broad = fbm(n*2.7+vec2(19.1,7.8)+u_flow*0.08);
    float fine = fbm(n*52.0+vec2(3.1,6.7));
    float fiber = vnoise(vec2(n.x*105.0+n.y*21.0,n.y*260.0));
    d += (fbm(n*24.0)-0.43)*0.035+(fbm(n*75.0)-0.43)*0.014;
    float A;
    float tone;
    if (u_character < 1.5) {
      // A translucent wash with pooled pigment, tide lines, and capillary bleed.
      d += (vnoise(n*9.0)-0.5)*0.030;
      float body = 1.0-smoothstep(-0.028,0.020,d+(fine-0.43)*0.022);
      float bleed = 0.40*(1.0-smoothstep(-0.018,0.115,d))*clamp((coarse-0.18)*2.2,0.0,1.0)*smoothstep(0.18,0.62,fbm(n*40.0));
      A = (body+bleed*(1.0-body))*(0.84+0.14*smoothstep(0.22,0.64,broad)+0.03*fine);
      tone = 0.035+0.13*smoothstep(0.30,0.64,broad)+0.02*fine;
      float tide = 1.0-smoothstep(0.015,0.06,abs(d+0.042+0.025*(coarse-0.4)));
      tone *= 1.0-0.40*tide;
      A *= 0.92+0.08*fiber;
    } else if (u_character < 2.5) {
      // Dense velvety ink with a narrow, irregular wet rim.
      float body = 1.0-smoothstep(-0.014,0.015,d);
      float rim = 0.24*(1.0-smoothstep(-0.015,0.052,d))*(0.6+coarse);
      A = (body+rim*(1.0-body))*(0.985+0.015*fiber);
      tone = 0.026+0.041*fine+0.017*broad;
      tone *= 1.0-0.25*(1.0-smoothstep(0.0,0.036,abs(d+0.026)));
    } else if (u_character < 3.5) {
      // Dry pigment catches the paper: broken bristles and pale fiber scratches.
      float bristle = fbm(n*vec2(37.0,29.0)+vec2(coarse,broad)*4.0);
      float scuff = smoothstep(0.50,0.71,fbm(n*83.0+vec2(coarse,broad)*9.0));
      float edge = smoothstep(-0.22,0.02,d);
      A = (1.0-smoothstep(-0.022,0.018,d+(fine-0.43)*0.08+(coarse-0.43)*0.045))*(0.91+0.075*broad);
      A *= (1.0-edge*smoothstep(0.40,0.65,bristle)*0.88)*(1.0-(0.10+0.65*edge)*scuff);
      tone = 0.045+0.085*smoothstep(0.24,0.66,broad)+0.022*fine;
    } else if (u_character < 4.5) {
      // Velvet: soft charcoal pigment, powder mottling and a clean close edge.
      float body = 1.0-smoothstep(-0.010,0.010,d);
      float rim = 0.14*(1.0-smoothstep(-0.008,0.026,d));
      float powder = fbm(n*4.3+vec2(11.3,5.7));
      A = (body+rim*(1.0-body))*(0.948+0.034*coarse+0.012*fiber);
      tone = 0.055+0.145*smoothstep(0.23,0.65,powder)+0.016*fine;
    } else if (u_character < 5.5) {
      // Bloom: capillary fingers around a deep ink center, laid flat on paper.
      float edge = smoothstep(-0.24,0.06,d);
      float body = 1.0-smoothstep(-0.046,0.018,d);
      float capillary = fbm(n*32.0+vec2(coarse,broad)*5.0);
      float halo = 0.76*(1.0-smoothstep(-0.025,0.138,d))*smoothstep(0.16,0.61,capillary);
      A = body*(0.983-0.16*edge)+halo*(1.0-body);
      tone = 0.020+0.032*fine+0.060*edge*(0.3+coarse);
    } else if (u_character < 6.5) {
      // Tide: uneven rings of settled pigment; flat dried ink, not a lit sphere.
      float body = 1.0-smoothstep(-0.018,0.019,d);
      float rim = 0.20*(1.0-smoothstep(-0.015,0.055,d));
      float basin = d+0.19*(fbm(n*4.3+vec2(4.1,8.3))-0.43)+0.045*(coarse-0.43);
      float tide1 = (1.0-smoothstep(0.012,0.040,abs(basin+0.105)))*smoothstep(0.25,0.58,coarse);
      float tide2 = (1.0-smoothstep(0.014,0.047,abs(basin+0.265)))*smoothstep(0.28,0.58,fbm(n*7.1+vec2(3.7,14.2)));
      float tide3 = (1.0-smoothstep(0.016,0.050,abs(basin+0.445)))*smoothstep(0.26,0.62,broad);
      A = (body+rim*(1.0-body))*(0.95+0.035*fiber);
      tone = 0.095+0.105*smoothstep(0.24,0.65,broad)+0.026*coarse;
      tone *= 1.0-0.64*tide1-0.43*tide2-0.28*tide3;
    } else if (u_character < 7.5) {
      // Speckle: tiny bare-paper pores inside an otherwise dense black pool.
      vec2 cell = floor(n*48.0),spot = fract(n*48.0)-(0.2+0.6*hash2(cell+13.7));
      float radius = 0.10+0.11*hash(cell+31.9);
      float paper = (1.0-smoothstep(radius*0.32,radius,length(spot)))*step(0.64,hash(cell+6.2));
      float body = 1.0-smoothstep(-0.015,0.013,d);
      float rim = 0.16*(1.0-smoothstep(-0.012,0.038,d));
      A = (body+rim*(1.0-body))*(0.993-0.83*paper);
      tone = 0.022+0.042*fine+0.010*broad;
    } else {
      // Brush: one family of broken diagonal strokes through continuous ink.
      vec2 brush = vec2(n.x*0.96+n.y*0.28,-n.x*0.28+n.y*0.96);
      float warp = fbm(n*3.2+vec2(7.1,2.8));
      float bristles = vnoise(vec2(brush.x*5.0,brush.y*65.0+warp*3.0));
      float streak = smoothstep(0.40,0.76,bristles)*smoothstep(0.18,0.61,fbm(brush*vec2(12.0,8.0)));
      float edge = smoothstep(-0.18,0.025,d);
      float body = 1.0-smoothstep(-0.018,0.017,d+(bristles-0.45)*0.052);
      float rim = 0.16*(1.0-smoothstep(-0.008,0.049,d))*(0.4+fine);
      A = (body+rim*(1.0-body))*(0.976-0.20*streak-0.20*edge*streak);
      tone = 0.029+0.025*fine+0.105*streak;
    }
    // Preserve the little ink face at chat size without turning fibers into noise.
    float tiny = 1.0-smoothstep(15.0,36.0,u_R);
    A = mix(A,max(A,(1.0-smoothstep(-0.025,0.012,d))*0.96),tiny*0.85);
    tone *= 1.0-0.28*tiny;
    vec3 col = mix(vec3(tone,tone*0.975,tone*0.93),u_tint*(0.38+tone*2.6),u_tintAmt);
    gl_FragColor=vec4(col*A*u_fade,A*u_fade); return;
  }

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
  if (u_pocket > 0.5) {
    vec2 n = q/R;
    float roundD = length(n-vec2(0.0,0.20))-0.86;
    vec2 sp = n-vec2(0.0,0.22);
    float sa = atan(sp.y,sp.x);
    float starD = (length(sp)-(0.875+0.285*cos(5.0*(sa-1.570796327))))*0.72;
    float taper = mix(1.03,0.20,smoothstep(-0.48,1.36,n.y));
    float dropD = (length(vec2(n.x/taper,(n.y-0.35)/1.01))-1.0)*0.70;
    float total = u_shape.x+u_shape.y+u_shape.z;
    vec3 w = u_shape/max(1.0,total);
    d0 = d0*(1.0-min(1.0,total))+R*(roundD*w.x+starD*w.y+dropD*w.z);
    if (d0>0.40*R) { gl_FragColor=vec4(0.0); return; }
  }

  float edge = smoothstep(-0.30 * R, 0.03 * R, d0);
  float pf = 1.0 + 0.8 * u_poof + 0.22 * u_wet;
  vec2 nq = q * (1.0 / R);
  float t1 = tuft(nq * 3.6 + u_noff);
  float t2 = tuft(nq * 8.0 + u_noff * 1.6 + 7.3);
  float t3 = tuft(nq * 14.0 + u_noff * 2.4 + 57.0);
  float j  = fbm(nq * 3.2 + u_noff) - 0.5;
  float fall = 1.0 - smoothstep(0.03 * R, 0.13 * R, d0);
  float d = d0 - (t1 * 0.16 + t2 * 0.13 + t3 * edge * 0.07) * R * pf * (0.35 + 0.65 * edge) * fall + j * 0.035 * R;
  float skirt = u_pocket>0.5 ? 1.0-min(1.0,u_shape.x+u_shape.y+u_shape.z) : 1.0;
  d = mix(d,smax(d, -(q.y - yb) - 0.13 * R, 0.10 * R),skirt);

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

function createLegacyNibbi(opts) {
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
  function spawnSpat(t, spread, color) {
    for (const sp of spatDyn) {
      if (sp.on && t - sp.born < sp.life) continue;
      const s = pose.r / R0, a = rnd() * Math.PI * 2, rad = (155 + rnd() * 80) * s * (spread || 1);
      sp.on = true; sp.born = t; sp.abs = false; sp.ox = Math.cos(a) * rad; sp.oy = Math.sin(a) * rad * 0.75 + 20 * s; sp.r = (1.4 + rnd() * 3.0) * s; sp.life = 4500 + rnd() * 2500; sp.color = color || null;
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
      if (sp.color) fx.fillStyle = 'rgb(' + Math.round(sp.color[0] * 255) + ',' + Math.round(sp.color[1] * 255) + ',' + Math.round(sp.color[2] * 255) + ')';
      fx.beginPath(); fx.ellipse(ox, oy, sp.r * sc, sp.r * sc * 0.85, 0.4, 0, 7); fx.fill();
      if (sp.color) fx.fillStyle = '#191817';
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
    splash(color, k) { if (reduced) return; const t = now(); for (let i = 0; i < (k || 4); i++) spawnSpat(t + i * 35, 0.9 + rnd() * 0.5, color); api.hop(); },
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


/* Pocket spring controller. The production shader above and original pip design
   stay shared with the opt-in legacy engine; this rig has one simulation clock. */
const P_TAU = Math.PI * 2;
const pFinite = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
const pMix = (a,b,t) => a+(b-a)*t;
const pSmooth = (a,b,v) => { const t=clamp((v-a)/(b-a),0,1); return t*t*(3-2*t); };
const pSmax = (a,b,k) => { const h=clamp(.5+.5*(b-a)/k,0,1); return pMix(a,b,h)+k*h*(1-h); };
const P_NEUTRAL = Object.freeze({x:0,lift:0,sx:1,sy:1,rotate:0,lean:0,round:0,star:0,drop:0,satellite:0,trail:0,impact:0,eyeX:0,eyeY:0,blink:0,wide:1,happy:0,phase:'rest'});
const P_SPAT = [[118,-95,4.2],[148,-39,3],[129,-13,2],[159,93,3.6],[-184,63,2.2],[-172,82,3.1],[-151,78,2],[-137,89,2.6],[-159,95,1.6]];
const B_SPAT = [[-118.7,-55.9,7.4],[-113.3,-64.4,3.4],[-107.8,-46.9,2.4],[132.7,64.4,9.2],[143.5,47.7,3.4],[150.5,73.3,2.2],[109,84.6,3.1]];
const B_LOOK = {
  gaze:[3.5,3],
};
function bubbleEyes(yaw=0,pitch=0) {
  yaw=clamp(pFinite(yaw),-1,1);pitch=clamp(pFinite(pitch),-1,1);
  return [-1,1].map(side=>({
    x:38.8*yaw+43*side,y:-2-3.5*side*yaw+20*pitch,
    rx:35-2*side*yaw,ry:41-2*side*yaw,
    prx:16.5-.5*side*yaw,pry:20-side*yaw,pox:0,poy:0,
  }));
}
const B_CHARACTERS = Object.freeze({wash:1,pool:2,dry:3,'pool-velvet':4,'pool-bloom':5,'pool-tide':6,'pool-speckle':7,'pool-brush':8});
function bubbleDistance(x,y,p) {
  const h=1+(.06*p.round+.12*p.drop)/.82,w=1-(.035*p.round+.045*p.drop)/1.015;
  const nx=x/w,ny=.66+(y-.66)/h,length=Math.hypot(nx,ny),ca=length?nx/length:1,sa=length?ny/length:0;
  let radius=B_PROFILE.radius,c=1,s=0;
  // Recur through the harmonics without repeating atan2 / sin / cos for every
  // contour sample and material pixel. This is the same radial fit as GLSL.
  for(let i=0;i<B_PROFILE.harmonics.length;i++) {
    const nextC=c*ca-s*sa;s=s*ca+c*sa;c=nextC;
    const harmonic=B_PROFILE.harmonics[i];radius+=harmonic[0]*c+harmonic[1]*s;
    if(i===4)radius+=.020*p.star*c;
  }
  return (length-radius)*Math.min(w,h);
}
const B_EYE_UNIT=Array.from({length:64},(_,i)=>[Math.cos(i/64*P_TAU),Math.sin(i/64*P_TAU)]);
function bubbleFaceMargin(p,wide,eyes) {
  let margin=Infinity;
  for(const eye of eyes)for(const [x,y] of B_EYE_UNIT)
    margin=Math.min(margin,-bubbleDistance(eye.x/R0+p.eyeX+x*eye.rx/R0*wide,eye.y/R0+p.eyeY+y*eye.ry/R0*wide,p));
  return margin;
}
function bubbleFacePose(p,wide,eyes) {
  // Pull an outward-facing pair toward the fitted ink profile's center only
  // as far as needed. This works for either side and for upward/downward turns.
  const inset=.016;
  if(bubbleFaceMargin(p,wide,eyes)>=inset)return p;
  const w=1-(.035*p.round+.045*p.drop)/1.015,h=1+(.06*p.round+.12*p.drop)/.82;
  const centerX=B_PROFILE.harmonics[0][0]*w,centerY=.66+(B_PROFILE.harmonics[0][1]-.66)*h;
  const dx=centerX-(eyes[0].x+eyes[1].x)/(2*R0)-p.eyeX,dy=centerY-(eyes[0].y+eyes[1].y)/(2*R0)-p.eyeY;
  let lo=0,hi=1;
  for(let i=0;i<10;i++) {
    const t=(lo+hi)/2,candidate={...p,eyeX:p.eyeX+dx*t,eyeY:p.eyeY+dy*t};
    if(bubbleFaceMargin(candidate,wide,eyes)>=inset)hi=t;else lo=t;
  }
  return {...p,eyeX:p.eyeX+dx*hi,eyeY:p.eyeY+dy*hi};
}
// Cached material atlas for the character Canvas2D fallback. Coordinates use
// the same neutral bubble field as the fragment shader; local y points down.
const B_MATERIAL_TILES = new Map();
const B_MATERIAL_BOUNDS = Object.freeze({left:-1.35,top:-1.35,right:1.35,bottom:1.35,width:2.7,height:2.7});

function bubbleHash(x,y) {
  // GLSL highp is float32. Rounding the hash arithmetic avoids the very
  // different random field produced by JavaScript's double precision.
  const f=Math.fround;
  x=f(f(x)*f(123.34)); y=f(f(y)*f(456.21));
  x=f(x-Math.floor(x)); y=f(y-Math.floor(y));
  const dot=f(f(x*f(x+f(45.32)))+f(y*f(y+f(45.32))));
  x=f(x+dot); y=f(y+dot);
  const value=f(x*y);
  return value-Math.floor(value);
}

function bubbleNoise(x,y) {
  const ix=Math.floor(x),iy=Math.floor(y);
  let fx=x-ix,fy=y-iy;
  fx=fx*fx*(3-2*fx); fy=fy*fy*(3-2*fy);
  const a=bubbleHash(ix,iy),b=bubbleHash(ix+1,iy);
  const c=bubbleHash(ix,iy+1),d=bubbleHash(ix+1,iy+1);
  return (a+(b-a)*fx)*(1-fy)+(c+(d-c)*fx)*fy;
}

function bubbleFbm(x,y) {
  let value=0,amplitude=.5;
  for(let i=0;i<3;i++) {
    value+=amplitude*bubbleNoise(x,y);
    x=x*2.03+17.13; y=y*2.03+9.71;
    amplitude*=.5;
  }
  return value;
}

function bubbleMaterialTile(character,color=null,tiny=false) {
  const kind=Object.hasOwn(B_CHARACTERS,character)?B_CHARACTERS[character]:Number.isInteger(character)&&character>=1&&character<=8?character:1;
  const tint=color?Array.from(color,c=>clamp(Number(c)||0,0,1)):null;
  const key=kind+':'+(tiny?'tiny':'full')+':'+(tint?tint.join(','):'black');
  const cached=B_MATERIAL_TILES.get(key);
  if(cached)return cached;
  const canvas=document.createElement('canvas');
  canvas.width=canvas.height=tiny?256:512;
  const ctx=canvas.getContext('2d');
  const data=ctx.createImageData(canvas.width,canvas.height),bytes=data.data;
  const size=canvas.width,step=B_MATERIAL_BOUNDS.width/size;
  for(let row=0;row<size;row++) {
    const ly=B_MATERIAL_BOUNDS.top+(row+.5)*step,ny=-ly;
    for(let column=0;column<size;column++) {
      const nx=B_MATERIAL_BOUNDS.left+(column+.5)*step;
      let d=bubbleDistance(nx,ly,P_NEUTRAL);
      if(d>.18)continue;
      const coarse=bubbleFbm(nx*5.8+8.2,ny*5.8+3.7);
      const broad=bubbleFbm(nx*2.7+19.1,ny*2.7+7.8);
      const fine=bubbleFbm(nx*52+3.1,ny*52+6.7);
      const fiber=bubbleNoise(nx*105+ny*21,ny*260);
      d+=(bubbleFbm(nx*24,ny*24)-.43)*.035+(bubbleFbm(nx*75,ny*75)-.43)*.014;
      let alpha,tone;
      if(kind===1) {
        d+=(bubbleNoise(nx*9,ny*9)-.5)*.030;
        const body=1-pSmooth(-.028,.020,d+(fine-.43)*.022);
        const bleed=.40*(1-pSmooth(-.018,.115,d))*clamp((coarse-.18)*2.2,0,1)*pSmooth(.18,.62,bubbleFbm(nx*40,ny*40));
        alpha=(body+bleed*(1-body))*(.84+.14*pSmooth(.22,.64,broad)+.03*fine);
        tone=.035+.13*pSmooth(.30,.64,broad)+.02*fine;
        const tide=1-pSmooth(.015,.06,Math.abs(d+.042+.025*(coarse-.4)));
        tone*=1-.40*tide;
        alpha*=.92+.08*fiber;
      } else if(kind===2) {
        const body=1-pSmooth(-.014,.015,d);
        const rim=.24*(1-pSmooth(-.015,.052,d))*(.6+coarse);
        alpha=(body+rim*(1-body))*(.985+.015*fiber);
        tone=.026+.041*fine+.017*broad;
        tone*=1-.25*(1-pSmooth(0,.036,Math.abs(d+.026)));
      } else if(kind===3) {
        const bristle=bubbleFbm(nx*37+coarse*4,ny*29+broad*4);
        const scuff=pSmooth(.50,.71,bubbleFbm(nx*83+coarse*9,ny*83+broad*9));
        const edge=pSmooth(-.22,.02,d);
        alpha=(1-pSmooth(-.022,.018,d+(fine-.43)*.08+(coarse-.43)*.045))*(.91+.075*broad);
        alpha*=(1-edge*pSmooth(.40,.65,bristle)*.88)*(1-(.10+.65*edge)*scuff);
        tone=.045+.085*pSmooth(.24,.66,broad)+.022*fine;
      } else if(kind===4) {
        const body=1-pSmooth(-.010,.010,d);
        const rim=.14*(1-pSmooth(-.008,.026,d));
        const powder=bubbleFbm(nx*4.3+11.3,ny*4.3+5.7);
        alpha=(body+rim*(1-body))*(.948+.034*coarse+.012*fiber);
        tone=.055+.145*pSmooth(.23,.65,powder)+.016*fine;
      } else if(kind===5) {
        const edge=pSmooth(-.24,.06,d);
        const body=1-pSmooth(-.046,.018,d);
        const capillary=bubbleFbm(nx*32+coarse*5,ny*32+broad*5);
        const halo=.76*(1-pSmooth(-.025,.138,d))*pSmooth(.16,.61,capillary);
        alpha=body*(.983-.16*edge)+halo*(1-body);
        tone=.020+.032*fine+.060*edge*(.3+coarse);
      } else if(kind===6) {
        const body=1-pSmooth(-.018,.019,d);
        const rim=.20*(1-pSmooth(-.015,.055,d));
        const basin=d+.19*(bubbleFbm(nx*4.3+4.1,ny*4.3+8.3)-.43)+.045*(coarse-.43);
        const tide1=(1-pSmooth(.012,.040,Math.abs(basin+.105)))*pSmooth(.25,.58,coarse);
        const tide2=(1-pSmooth(.014,.047,Math.abs(basin+.265)))*pSmooth(.28,.58,bubbleFbm(nx*7.1+3.7,ny*7.1+14.2));
        const tide3=(1-pSmooth(.016,.050,Math.abs(basin+.445)))*pSmooth(.26,.62,broad);
        alpha=(body+rim*(1-body))*(.95+.035*fiber);
        tone=.095+.105*pSmooth(.24,.65,broad)+.026*coarse;
        tone*=1-.64*tide1-.43*tide2-.28*tide3;
      } else if(kind===7) {
        const cellX=Math.floor(nx*48),cellY=Math.floor(ny*48);
        const jitterX=bubbleHash(cellX+13.7,cellY+13.7);
        const jitterY=bubbleHash(cellX+13.7+jitterX+17.71,cellY+13.7+jitterX+17.71);
        const spotX=nx*48-cellX-(.2+.6*jitterX),spotY=ny*48-cellY-(.2+.6*jitterY);
        const radius=.10+.11*bubbleHash(cellX+31.9,cellY+31.9);
        const paper=(1-pSmooth(radius*.32,radius,Math.hypot(spotX,spotY)))*(bubbleHash(cellX+6.2,cellY+6.2)>=.64?1:0);
        const body=1-pSmooth(-.015,.013,d);
        const rim=.16*(1-pSmooth(-.012,.038,d));
        alpha=(body+rim*(1-body))*(.993-.83*paper);
        tone=.022+.042*fine+.010*broad;
      } else {
        const brushX=nx*.96+ny*.28,brushY=-nx*.28+ny*.96;
        const warp=bubbleFbm(nx*3.2+7.1,ny*3.2+2.8);
        const bristles=bubbleNoise(brushX*5,brushY*65+warp*3);
        const streak=pSmooth(.40,.76,bristles)*pSmooth(.18,.61,bubbleFbm(brushX*12,brushY*8));
        const edge=pSmooth(-.18,.025,d);
        const body=1-pSmooth(-.018,.017,d+(bristles-.45)*.052);
        const rim=.16*(1-pSmooth(-.008,.049,d))*(.4+fine);
        alpha=(body+rim*(1-body))*(.976-.20*streak-.20*edge*streak);
        tone=.029+.025*fine+.105*streak;
      }
      if(tiny) {
        alpha+=(Math.max(alpha,(1-pSmooth(-.025,.012,d))*.96)-alpha)*.85;
        tone*=.72;
      }
      const pixel=(row*size+column)*4;
      // ImageData stores straight alpha. Canvas performs premultiplication;
      // multiplying RGB by alpha here would darken translucent wash twice.
      if(tint) {
        const intensity=.38+tone*2.6;
        bytes[pixel]=Math.round(clamp(tint[0]*intensity,0,1)*255);
        bytes[pixel+1]=Math.round(clamp(tint[1]*intensity,0,1)*255);
        bytes[pixel+2]=Math.round(clamp(tint[2]*intensity,0,1)*255);
      } else {
        bytes[pixel]=Math.round(tone*255);
        bytes[pixel+1]=Math.round(tone*.975*255);
        bytes[pixel+2]=Math.round(tone*.93*255);
      }
      bytes[pixel+3]=Math.round(clamp(alpha,0,1)*255);
    }
  }
  ctx.putImageData(data,0,0);
  const tile=Object.freeze({canvas,bounds:B_MATERIAL_BOUNDS});
  if(B_MATERIAL_TILES.size>=12)B_MATERIAL_TILES.delete(B_MATERIAL_TILES.keys().next().value);
  B_MATERIAL_TILES.set(key,tile);
  return tile;
}

function pocketPose(value, amount=1) {
  const p={...P_NEUTRAL};
  for (const k of Object.keys(p)) if (k!=='phase') p[k]=pFinite(value?.[k],p[k]);
  p.phase=typeof value?.phase==='string' ? value.phase : 'rest';
  for (const k of ['x','lift','rotate','lean','round','star','drop','impact','eyeX','eyeY']) p[k]*=amount;
  p.x=clamp(p.x,-.3,.3); p.lift=clamp(p.lift,0,1.1); p.rotate=clamp(p.rotate,-.35,.35); p.lean=clamp(p.lean,-.35,.35);
  p.sy=Math.exp(clamp(Math.log(Math.max(.001,p.sy))*amount,-Math.log(1.5),Math.log(1.5))); p.sx=1/p.sy;
  for (const k of ['round','star','drop','impact','blink','happy']) p[k]=clamp(p[k],0,1);
  p.eyeX=clamp(p.eyeX,-.13,.13); p.eyeY=clamp(p.eyeY,-.11,.11); p.wide=clamp(p.wide,.65,1.14);
  p.satellite=p.trail=0;
  return p;
}
function pocketMap(x,y,p,cx,cy,R) {
  x=(x+p.lean*clamp((.66-y)/1.6,0,1.2))*p.sx; y=(y-.66)*p.sy;
  const c=Math.cos(p.rotate),s=Math.sin(p.rotate);
  return [cx+R*(x*c-y*s+p.x),cy+R*(.66+x*s+y*c-p.lift)];
}
function pocketInverse(x,y,p,cx,cy,R) {
  x=(x-cx)/R-p.x; y=(y-cy)/R-.66+p.lift;
  const c=Math.cos(p.rotate),s=Math.sin(p.rotate),lx=(c*x+s*y)/p.sx,ly=(-s*x+c*y)/p.sy+.66;
  return [lx-p.lean*clamp((.66-ly)/1.6,0,1.2),ly];
}
function pocketDistance(x,y,p,character=null) {
  if(character)return bubbleDistance(x,y,p);
  y=-y; const a=Math.atan2(y,x);
  let rr=1+.054*Math.cos(2*a+1.1)+.048*Math.cos(3*a+2.6)+.028*Math.cos(5*a+4.7)+.016*Math.cos(7*a+1.7);
  rr+=.06*clamp(-Math.sin(a),0,1)-.02*clamp(Math.sin(a),0,1)+.085*Math.exp((Math.cos(a-3.3)-1)*6)+.05*Math.exp((Math.cos(a+.15)-1)*6);
  const blot=pSmax(Math.hypot(x,y*pMix(.98,1.1,pSmooth(-.3,.4,y)))-rr*.95,-(y+.66)-.05,.15);
  const round=Math.hypot(x,y-.2)-.86;
  const star=(Math.hypot(x,y-.22)-(.875+.285*Math.cos(5*(Math.atan2(y-.22,x)-Math.PI/2))))*.72;
  const taper=pMix(1.03,.2,pSmooth(-.48,1.36,y));
  const drop=(Math.hypot(x/taper,(y-.35)/1.01)-1)*.7;
  const sum=p.round+p.star+p.drop;
  return blot*(1-Math.min(1,sum))+(round*p.round+star*p.star+drop*p.drop)/Math.max(1,sum);
}
function pocketContour(p,pad=.24,n=80,character=null) {
  const out=[];
  for(let i=0;i<n;i++) {
    const a=i/n*P_TAU,dx=Math.cos(a),dy=Math.sin(a); let lo=0,hi=2.6;
    for(let j=0;j<12;j++) { const r=(lo+hi)/2; if(pocketDistance(dx*r,-.12+dy*r,p,character)<pad)lo=r;else hi=r; }
    out.push([dx*(lo+hi)/2,-.12+dy*(lo+hi)/2]);
  }
  return out;
}
function pocketRing(x,y,rx,ry,n=48) { return Array.from({length:n},(_,i)=>[x+Math.cos(i/n*P_TAU)*rx,y+Math.sin(i/n*P_TAU)*ry]); }
function pocketPath(ctx,points) { ctx.beginPath(); points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath(); }
function pocketBox(points) {
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  for(const [x,y] of points){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
  return {left,top,right,bottom,width:right-left,height:bottom-top};
}
function pocketGeometry(p,cx,cy,R,wide,character=null,eyes=null) {
  const eyeModel=character?(eyes||bubbleEyes()):LOOK.eyes,spatter=character?B_SPAT:P_SPAT;
  const map=(x,y)=>pocketMap(x,y,p,cx,cy,R),boundary=pocketContour(p,character?.18:.24,80,character);
  const eyeOutlines=eyeModel.map(e=>pocketRing(e.x/R0+p.eyeX,e.y/R0+p.eyeY,e.rx/R0*wide,e.ry/R0*wide,64));
  const eyePoints=eyeOutlines.flat(),bodyPoints=boundary.map(([x,y])=>map(x,y));
  const spats=spatter.flatMap(([x,y,r])=>pocketRing(x/R0,y/R0,r/R0,r/R0,8)).map(([x,y])=>map(x,y));
  const faceMargins=eyeOutlines.map(points=>Math.min(...points.map(([x,y])=>-pocketDistance(x,y,p,character))));
  const eyeCenters=eyeModel.map(e=>{const [x,y]=map(e.x/R0+p.eyeX,e.y/R0+p.eyeY);return {x,y};});
  return {bounds:pocketBox([...bodyPoints,...spats]),bodyBounds:pocketBox(bodyPoints),eyeBounds:pocketBox(eyePoints.map(([x,y])=>map(x,y))),
    eyeCenters,faceContained:Math.min(...faceMargins)>=0,minFaceMargin:Math.min(...faceMargins),faceMargins,
    faceMarginUnit:'R; untextured local body field (approximate signed distance)',
    eyeGap:((eyeModel[1].x-eyeModel[0].x)-(eyeModel[0].rx+eyeModel[1].rx)*wide)/R0*R*Math.min(p.sx,p.sy),wide,
    baseFoot:{x:cx,y:cy+.66*R},foot:{x:cx+p.x*R,y:cy+(.66-p.lift)*R},
    map:{anchor:[0,.66],scale:[p.sx,p.sy],rotate:p.rotate,lean:p.lean,x:p.x,lift:p.lift,center:[cx,cy],radius:R},
    _boundary:boundary};
}

function createPocketNibbi(opts) {
  const character=Object.hasOwn(B_CHARACTERS,opts.character)?opts.character:null;
  const look=character?B_LOOK:LOOK;
  const inkCv=opts.ink,fxCv=opts.fx,fx=fxCv.getContext('2d');
  if(!fx)throw new Error('Nibbi needs a 2D effects canvas.');
  const lib=globalThis.NibbiPocketMotion,director=lib.createDirector({seed:pFinite(opts.seed,7)});
  const manual=!!opts.manual,mirrors=new Set(),agents=new Map(),particles=[];
  let gl=null,U={},glOK=false,backendReason=opts.force2D?'forced by force2D':null,maxDimension=8192;
  let resources={program:null,buffer:null,texture:null,shaders:[]};
  let W=1,H=1,DPR=1,dead=false,raf=0,lastWall=null,clock=0,dirty=true,frameCount=0,fps=0;
  let reduced=!!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let energy=1,texture='flow',mood='idle',fade=1,fadeTarget=1,speech=0;
  let current={...P_NEUTRAL},currentEyes=character?bubbleEyes():LOOK.eyes,geometry=null,mirrorCrop=null,poseSnap=true;
  const pose={x:innerWidth/2,y:innerHeight*.44,r:120,vx:0,vy:0,vr:0};
  const target={x:pose.x,y:pose.y,r:pose.r};
  const expression={lidTop:0,lidBot:0,wide:1,pupil:.88};
  let gazeX=character?0:-.25,gazeY=character?0:.1,gazeTX=gazeX,gazeTY=gazeY,lookX=null,lookY=null,direction=null,ptrX=-1e6,ptrY=-1e6,ptrAt=-1e6;
  let nextWander=2.5,nextBlink=2.6,blinkAt=-100,forcedBlinkAt=-100,seed=(pFinite(opts.seed,7)|0)>>>0;
  const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const sm=(a,b,dt,k)=>a+(b-a)*(1-Math.exp(-k*dt));

  function releaseGL(lose=false) {
    if(gl) {
      if(resources.texture)gl.deleteTexture(resources.texture);
      if(resources.buffer)gl.deleteBuffer(resources.buffer);
      if(resources.program)gl.deleteProgram(resources.program);
      for(const shader of resources.shaders)gl.deleteShader(shader);
      if(lose)gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    resources={program:null,buffer:null,texture:null,shaders:[]};gl=null;glOK=false;
  }
  function initGL() {
    if(opts.force2D)return;
    try {
      gl=inkCv.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:false,depth:false,stencil:false});
      if(!gl)throw new Error('WebGL unavailable');
      const limits=gl.getParameter(gl.MAX_VIEWPORT_DIMS);
      maxDimension=Math.min(8192,gl.getParameter(gl.MAX_TEXTURE_SIZE),gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),limits[0],limits[1]);
      const shader=(type,src)=>{const sh=gl.createShader(type);resources.shaders.push(sh);gl.shaderSource(sh,src);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(sh)||'shader compile');return sh;};
      const prog=gl.createProgram();resources.program=prog;
      const highp=gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER,gl.HIGH_FLOAT)?.precision>0;
      if(character&&!highp)throw new Error('High-precision ink grain unavailable; using Canvas2D');
      gl.attachShader(prog,shader(gl.VERTEX_SHADER,VS));gl.attachShader(prog,shader(gl.FRAGMENT_SHADER,highp?FS:FS.replace('precision highp float','precision mediump float')));gl.linkProgram(prog);
      if(!gl.getProgramParameter(prog,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(prog)||'shader link');
      gl.useProgram(prog);
      const buf=gl.createBuffer();resources.buffer=buf;gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
      const loc=gl.getAttribLocation(prog,'a_p');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
      const tex=gl.createTexture();resources.texture=tex;gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,tex);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.LUMINANCE,GRAIN,GRAIN,0,gl.LUMINANCE,gl.UNSIGNED_BYTE,grainBytes);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      U={};for(const n of ['dpr','center','R','breath','h','hp','noff','puff','lift','sq','lean','poof','fade','hAmp','flow','wet','tint','tintAmt','grain','pocket','scale','rotation','shift','shape','character'])U[n]=gl.getUniformLocation(prog,'u_'+n);
      gl.uniform1i(U.grain,0);gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);gl.clearColor(0,0,0,0);glOK=true;backendReason=null;
    }catch(error){backendReason=String(error.message||error);releaseGL();}
  }
  function resize() {
    if(dead)return;
    W=Math.max(1,pFinite(innerWidth,1));H=Math.max(1,pFinite(innerHeight,1));
    DPR=Math.min(2,Math.max(.5,pFinite(devicePixelRatio,1)),maxDimension/W,maxDimension/H);
    const w=Math.max(1,Math.floor(W*DPR)),h=Math.max(1,Math.floor(H*DPR));
    for(const cv of [inkCv,fxCv]){if(cv.width!==w)cv.width=w;if(cv.height!==h)cv.height=h;}
    fx.setTransform(DPR,0,0,DPR,0,0);if(glOK)gl.viewport(0,0,w,h);
    dirty=true;if(reduced)renderFrame(0);
  }
  function spring(key,vkey,dt) {
    const d=pose[key]-target[key],v=pose[vkey],w=Math.sqrt(70),z=.82,wd=w*Math.sqrt(1-z*z),decay=Math.exp(-z*w*dt),c=Math.cos(wd*dt),s=Math.sin(wd*dt);
    pose[key]=target[key]+decay*(d*c+(v+z*w*d)/wd*s);
    pose[vkey]=decay*(v*c-(z*w*v+w*w*d)/wd*s);
    if(Math.abs(pose[key]-target[key])+Math.abs(pose[vkey])<.0001){pose[key]=target[key];pose[vkey]=0;}
  }
  function roomFor(cx,cy,R) {
    const top=(cy-1.18*R-6)/R,side=(Math.min(cx,W-cx)-1.46*R-6)/R,bottom=(H-cy-1.02*R-6)/R;
    const room=clamp(Math.min(top/1.85,side/1.05,bottom/.70),0,1);
    return {amount:room*(.70+.30*pSmooth(32,100,R)),compact:R<55||room<.48};
  }
  function texAt(t,phase=0) {
    if(reduced)return {offset:[0,0],flow:[0,0],wet:0};
    if(texture==='boil') {
      const n=Math.floor(t*9),fr=[[0,0],[.43,-.31],[-.29,.53]][((n%3)+3)%3];
      return {offset:[fr[0]+phase,fr[1]-phase*.7],flow:[.35*Math.sin(n/9*.13+phase),.28*Math.sin(n/9*.11)],wet:.35};
    }
    return {offset:[.44*Math.sin(t*.19+phase),.38*Math.sin(t*.16-phase)],flow:[.35*Math.sin(t*.13+phase),.28*Math.sin(t*.11-phase)],wet:.30+.15*Math.sin(t*.9+phase)};
  }
  function uniforms(cx,cy,R,p,tx,alpha=1,color=null) {
    gl.useProgram(resources.program);gl.uniform1f(U.dpr,DPR);gl.uniform2f(U.center,cx,H-cy);gl.uniform1f(U.R,R);
    gl.uniform1f(U.character,character?B_CHARACTERS[character]:0);
    gl.uniform1f(U.pocket,1);gl.uniform2f(U.scale,p.sx,p.sy);gl.uniform2f(U.rotation,Math.cos(p.rotate),Math.sin(p.rotate));gl.uniform2f(U.shift,p.x,p.lift);gl.uniform3f(U.shape,p.round,p.star,p.drop);
    gl.uniform1f(U.breath,1);gl.uniform4f(U.h,...LOOK.h);gl.uniform4f(U.hp,...LOOK.hp);gl.uniform2f(U.noff,...tx.offset);gl.uniform2f(U.flow,...tx.flow);
    gl.uniform3f(U.puff,1,0,0);gl.uniform1f(U.lift,0);gl.uniform1f(U.sq,1);gl.uniform1f(U.lean,p.lean*R);gl.uniform1f(U.poof,0);gl.uniform1f(U.fade,alpha);gl.uniform1f(U.hAmp,1);gl.uniform1f(U.wet,tx.wet);
    gl.uniform3f(U.tint,...(color||[0,0,0]));gl.uniform1f(U.tintAmt,color?1:0);
  }
  function scissor(b) {
    const left=clamp(Math.floor((b.left-2)*DPR),0,inkCv.width),right=clamp(Math.ceil((b.right+2)*DPR),0,inkCv.width);
    const top=clamp(Math.floor((b.top-2)*DPR),0,inkCv.height),bottom=clamp(Math.ceil((b.bottom+2)*DPR),0,inkCv.height);
    gl.enable(gl.SCISSOR_TEST);gl.scissor(left,inkCv.height-bottom,Math.max(0,right-left),Math.max(0,bottom-top));
  }
  function drawBody2D(ctx,p,cx,cy,R,tx,color=null) {
    if(character) {
      const tile=bubbleMaterialTile(character,color,R<26),b=tile.bounds;
      const sw=(1.015-.035*p.round-.045*p.drop)/1.015,sh=(.82+.06*p.round+.12*p.drop)/.82;
      const map=(x,y)=>pocketMap(x*sw,.66+(y-.66)*sh,p,cx,cy,R);
      // The visible body occupies the rig's linear crown-bend segment. This
      // affine basis carries pigment with the exact same foot, squash and lean
      // as the eyes. Shape cues round/stretch the bubble without another lobe.
      const o=map(0,0),x=map(1,0),y=map(0,-.5);
      ctx.save();ctx.transform(x[0]-o[0],x[1]-o[1],(o[0]-y[0])*2,(o[1]-y[1])*2,o[0],o[1]);
      ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
      ctx.drawImage(tile.canvas,b.left,b.top,b.width,b.height);ctx.restore();return;
    }
    const map=(x,y)=>pocketMap(x,y,p,cx,cy,R),phase=tx.offset[0]*7.7+tx.offset[1]*4.6;
    const base=pocketContour(p,0,112),ragged=base.map(([x,y],i)=>{const a=i/base.length*P_TAU,d=.011*Math.sin(i*2.13+phase)+.008*Math.sin(i*4.79-phase*.8);return [x+Math.cos(a)*d,y+Math.sin(a)*d];});
    const ink=color?'rgb('+color.map(c=>Math.round(c*105)).join(',')+')':'#131212';
    ctx.fillStyle=ink;ctx.save();ctx.globalAlpha*=.09;
    for(let i=0;i<ragged.length;i++){const [x,y]=ragged[i],r=.019+.020*(.5+.5*Math.sin(i*7.31+phase));pocketPath(ctx,pocketRing(x,y,r,r*.82,10).map(([xx,yy])=>map(xx,yy)));ctx.fill();}ctx.restore();
    pocketPath(ctx,ragged.map(([x,y])=>map(x,y)));ctx.fillStyle=ink;ctx.fill();
    ctx.save();ctx.clip();
    for(let i=0;i<125;i++){
      const a=i*2.39996323,r=Math.sqrt((i+.5)/125)*1.46,x=Math.cos(a)*r+.016*tx.flow[0],y=Math.sin(a)*r-.16+.016*tx.flow[1],sz=.006+.014*(.5+.5*Math.sin(i*4.17));
      ctx.fillStyle='rgba(193,187,174,'+(.025+.020*(.5+.5*Math.sin(i*1.7+phase)))+')';pocketPath(ctx,pocketRing(x,y,sz*1.6,sz*.6,8).map(([xx,yy])=>map(xx,yy)));ctx.fill();
    }ctx.restore();
  }
  function drawEyes(ctx,p,cx,cy,R,E,gx,gy,blink,eyes=null) {
    const map=(x,y)=>pocketMap(x,y,p,cx,cy,R),wide=clamp(E.wide*p.wide,.65,1.14);
    const ellipse=(x,y,rx,ry,fill)=>{pocketPath(ctx,pocketRing(x,y,rx,ry,64).map(([xx,yy])=>map(xx,yy)));ctx.fillStyle=fill;ctx.fill();};
    for(const eye of character?(eyes||bubbleEyes(gx,gy)):LOOK.eyes) {
      const x=eye.x/R0+p.eyeX,y=eye.y/R0+p.eyeY,rx=eye.rx/R0*wide,ry=eye.ry/R0*wide;
      const pupil=clamp(E.pupil*(1-.09*p.happy),.5,1.12),prx=eye.prx/R0*pupil,pry=eye.pry/R0*pupil;
      const px=x+clamp((eye.pox+gx*look.gaze[0])/R0,-rx+prx+.009,rx-prx-.009),py=y+clamp((eye.poy+gy*look.gaze[1])/R0,-ry+pry+.009,ry-pry-.009);
      if(character) {
        const closed=E.lidTop>.42,happy=E.lidBot>.20||p.happy>.42;
        const eyeRing=pocketRing(x,y,rx,ry*(closed?.87:1),80).map(([xx,yy],i)=>{
          const wobble=.0035*Math.sin(i*2.07)+.0021*Math.sin(i*4.31);
          return map(xx+(xx-x)*wobble*4,yy+(yy-y)*wobble*4);
        });
        pocketPath(ctx,eyeRing);ctx.fillStyle='#faf6ec';ctx.fill();ctx.save();ctx.clip();
        if(closed||happy) {
          ctx.beginPath();
          for(let i=0;i<=24;i++) {
            const u=i/24,xx=x+(u-.5)*rx*1.36,yy=y+ry*.08+(closed?1:-1)*Math.sin(u*Math.PI)*ry*.39;
            const v=map(xx,yy);if(i)ctx.lineTo(...v);else ctx.moveTo(...v);
          }
          ctx.strokeStyle='#1b1916';ctx.lineWidth=Math.max(1,R*.040);ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke();
        } else {
          ellipse(px,py,prx,pry,'#171612');
          ellipse(px+prx*.24,py-pry*.42,prx*.24,pry*.18,'#faf6ec');
          const top=clamp(E.lidTop+Math.max(blink,p.blink)*(1-E.lidTop),0,1);
          if(top>.001)ellipse(x,y-ry-2.1*ry+top*2*ry,rx*2.2,ry*2.1,'#1b1917');
        }
        ctx.restore();continue;
      }
      ellipse(x,y,rx,ry,'#fbfaf5');ctx.save();pocketPath(ctx,pocketRing(x,y,rx,ry,64).map(([xx,yy])=>map(xx,yy)));ctx.clip();
      ellipse(px,py,prx,pry,'#131211');ellipse(px-prx*.34,py-pry*.42,prx*.29,pry*.23,'rgba(251,250,245,.96)');ellipse(px+prx*.32,py+pry*.29,prx*.12,prx*.12,'rgba(251,250,245,.58)');
      const top=clamp(E.lidTop+Math.max(blink,p.blink)*(1-E.lidTop),0,1),bot=clamp(E.lidBot+p.happy*.32,0,.55);
      if(top>.001)ellipse(x,y-ry-2.1*ry+top*2*ry,rx*2.2,ry*2.1,'#141312');
      if(bot>.001)ellipse(x,y+ry+1.9*ry-bot*2*ry,rx*1.9,ry*1.9,'#141312');ctx.restore();
    }
  }
  function drawSpats(ctx,p,cx,cy,R) {
    ctx.fillStyle='#191817';
    for(const [x,y,r] of character?B_SPAT:P_SPAT){
      const points=pocketRing(x/R0,y/R0,r/R0,r/R0*.88,character?32:12).map(([xx,yy],i)=>{
        const d=character?1+.11*Math.sin(i*2.17)+.08*Math.cos(i*3.13):1;
        return pocketMap(x/R0+(xx-x/R0)*d,y/R0+(yy-y/R0)*d,p,cx,cy,R);
      });
      pocketPath(ctx,points);ctx.fill();
    }
  }
  function drawImpact(ctx,p,cx,cy,R) {
    if(p.impact<=.001)return;
    ctx.save();ctx.globalAlpha*=.35*p.impact;ctx.fillStyle='#191817';
    for(let i=0;i<6;i++){const side=i%2?1:-1,n=Math.floor(i/2);ctx.beginPath();ctx.ellipse(cx+(p.x+side*(.76+n*.18))*R,cy+(.68+Math.sin(i*3.7)*.025)*R,(.038-n*.006)*R*p.impact,.011*R*p.impact,side*.15,0,P_TAU);ctx.fill();}
    ctx.restore();
  }
  function surface(cv) {
    const rect=cv.getBoundingClientRect();if(!rect.width||!rect.height)return null;
    const w=Math.max(1,Math.min(4096,Math.round(rect.width*DPR))),h=Math.max(1,Math.min(4096,Math.round(rect.height*DPR)));
    if(cv.width!==w)cv.width=w;if(cv.height!==h)cv.height=h;
    const ctx=cv.getContext('2d');if(!ctx)return null;ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,w,h);ctx.imageSmoothingQuality='high';return {ctx,w,h};
  }
  function drawCompanions(dt) {
    const sw=Math.min(W,280),sh=Math.min(H,280),R=Math.max(4,Math.min(58,sw/4.6,sh/4.6)),cx=sw/2,cy=sh*.61;
    for(const [id,ag] of agents) {
      if(!ag.canvas.isConnected){agents.delete(id);continue;}
      const surf=surface(ag.canvas);if(!surf)continue;
      let p=pocketPose(ag.director.update(dt,{energy:.55,reduced,compact:true,speech:0,hidden:document.hidden}),.75);
      const tx=texAt(clock,ag.seed),md=MOODS[ag.mood]||MOODS.working,E={...md,wide:Math.min(1.14,md.wide)};
      const gx=reduced?md.gazeBias[0]:md.gazeBias[0]+.18*Math.sin(clock*.7+ag.seed),gy=reduced?md.gazeBias[1]:md.gazeBias[1]+.14*Math.cos(clock*.5+ag.seed);
      const eyes=character?bubbleEyes(gx,gy):LOOK.eyes;
      if(character)p=bubbleFacePose(p,clamp(E.wide*p.wide,.65,1.14),eyes);
      const bounds=pocketGeometry(p,cx,cy,R,clamp(E.wide*p.wide,.65,1.14),character,eyes).bounds;
      const k=Math.min(surf.w/sw,surf.h/sh),dx=(surf.w-sw*k)/2,dy=surf.h-sh*k,g=surf.ctx;
      if(glOK){scissor({left:0,top:0,right:sw,bottom:sh});gl.clear(gl.COLOR_BUFFER_BIT);uniforms(cx,cy,R,p,tx,1,ag.color);scissor(bounds);gl.drawArrays(gl.TRIANGLES,0,3);g.drawImage(inkCv,0,0,Math.round(sw*DPR),Math.round(sh*DPR),dx,dy,sw*k,sh*k);}
      g.save();g.translate(dx,dy);g.scale(k,k);
      if(!glOK)drawBody2D(g,p,cx,cy,R,tx,ag.color);
      drawEyes(g,p,cx,cy,R,E,gx,gy,0,eyes);g.restore();
      ag.bounds=bounds;
    }
  }
  function drawMirrors(room) {
    const R=pose.r,cx=pose.x,cy=pose.y,a=room.amount;
    const desired={left:cx-(1.48+1.10*a)*R,right:cx+(1.48+1.10*a)*R,top:cy-(1.23+2.05*a)*R,bottom:cy+(1.03+.75*a)*R};
    mirrorCrop={left:Math.max(0,desired.left),top:Math.max(0,desired.top),right:Math.min(W,desired.right),bottom:Math.min(H,desired.bottom)};
    mirrorCrop.width=Math.max(1,mirrorCrop.right-mirrorCrop.left);mirrorCrop.height=Math.max(1,mirrorCrop.bottom-mirrorCrop.top);
    for(const m of mirrors) {
      if(!m.isConnected){mirrors.delete(m);continue;}const surf=surface(m);if(!surf)continue;
      const b=mirrorCrop,k=Math.min(surf.w/b.width,surf.h/b.height),dw=b.width*k,dh=b.height*k,dx=(surf.w-dw)/2,dy=surf.h-dh;
      if(glOK)surf.ctx.drawImage(inkCv,b.left*DPR,b.top*DPR,b.width*DPR,b.height*DPR,dx,dy,dw,dh);
      surf.ctx.drawImage(fxCv,b.left*DPR,b.top*DPR,b.width*DPR,b.height*DPR,dx,dy,dw,dh);
    }
  }
  function renderFrame(dt) {
    if(dead)return;
    dt=document.hidden?0:Math.max(0,pFinite(dt));
    if(reduced&&!dirty)return;
    clock+=dt;frameCount++;if(dt>0)fps=Math.round(1/dt);
    if(poseSnap||reduced){Object.assign(pose,target,{vx:0,vy:0,vr:0});poseSnap=false;}else{spring('x','vx',dt);spring('y','vy',dt);spring('r','vr',dt);}
    pose.r=Math.max(4,pose.r);
    const md=MOODS[mood]||MOODS.idle;
    for(const k of ['lidTop','lidBot','wide','pupil'])expression[k]=reduced?md[k]:sm(expression[k],md[k],dt,k==='wide'?6:8);
    fade=reduced?fadeTarget:sm(fade,fadeTarget,dt,4);speech=reduced?0:speech*Math.exp(-3.6*dt);
    const room=roomFor(pose.x,pose.y,pose.r);
    const sampled=director.update(dt,{energy,reduced,compact:room.compact,speech,hidden:document.hidden});
    current=pocketPose(sampled,room.amount);
    if(reduced)current={...P_NEUTRAL,happy:current.happy,wide:current.wide,phase:sampled.phase||'reduced'};
    const pdx=ptrX-pose.x,pdy=ptrY-pose.y,pd=Math.hypot(pdx,pdy);
    if(direction){gazeTX=direction.x;gazeTY=direction.y;}
    else if(lookX!==null){const dx=lookX-pose.x,dy=lookY-pose.y,d=Math.hypot(dx,dy)||1;gazeTX=dx/d*Math.min(1,d/(1.4*pose.r));gazeTY=dy/d*Math.min(1,d/(1.4*pose.r));}
    else if(!reduced) {
      if(clock-ptrAt<6&&pd<2.6*pose.r){gazeTX=clamp(pdx/(1.5*pose.r),-1,1);gazeTY=clamp(pdy/(1.5*pose.r),-1,1);}
      else if(clock>=nextWander){gazeTX=(rnd()-.5)*1.4;gazeTY=(rnd()-.5);nextWander=clock+2.5+rnd()*2.5;}
    }
    const gazeTargetX=direction?direction.x:clamp((reduced&&lookX===null?0:gazeTX)+md.gazeBias[0],-1,1);
    const gazeTargetY=direction?direction.y:clamp((reduced&&lookX===null?0:gazeTY)+md.gazeBias[1],-1,1);
    gazeX=reduced?gazeTargetX:sm(gazeX,gazeTargetX,dt,11);gazeY=reduced?gazeTargetY:sm(gazeY,gazeTargetY,dt,11);
    if(!reduced) {
      if(clock>=nextBlink){blinkAt=clock;nextBlink=clock+(md.blinkGap[0]+rnd()*md.blinkGap[1])/1000;}
    }
    const blinkWave=at=>{const t=clock-at;return t<0||t>=.24?0:t<.11?pSmooth(0,.11,t):1-pSmooth(.11,.24,t);};
    const blink=reduced?0:Math.max(blinkWave(blinkAt),blinkWave(forcedBlinkAt));
    const wide=clamp(expression.wide*current.wide,.65,1.14);
    currentEyes=character?bubbleEyes(gazeX,gazeY):LOOK.eyes;
    if(character)current=bubbleFacePose(current,wide,currentEyes);
    geometry=pocketGeometry(current,pose.x,pose.y,pose.r,wide,character,currentEyes);geometry.room=room;geometry.inBounds=geometry.bounds.left>=0&&geometry.bounds.top>=0&&geometry.bounds.right<=W&&geometry.bounds.bottom<=H;
    if(glOK&&gl.isContextLost()){backendReason='WebGL context lost';releaseGL();}
    drawCompanions(dt);
    if(glOK){gl.disable(gl.SCISSOR_TEST);gl.clear(gl.COLOR_BUFFER_BIT);uniforms(pose.x,pose.y,pose.r,current,texAt(clock),fade);scissor(geometry.bodyBounds);gl.drawArrays(gl.TRIANGLES,0,3);}
    fx.setTransform(1,0,0,1,0,0);fx.clearRect(0,0,fxCv.width,fxCv.height);fx.setTransform(DPR,0,0,DPR,0,0);fx.globalAlpha=fade;
    if(!glOK)drawBody2D(fx,current,pose.x,pose.y,pose.r,texAt(clock));
    drawSpats(fx,current,pose.x,pose.y,pose.r);drawImpact(fx,current,pose.x,pose.y,pose.r);
    for(let i=particles.length-1;i>=0;i--){const sp=particles[i],age=clock-sp.at;if(age>=sp.life){particles.splice(i,1);continue;}if(age<0)continue;const life=age/sp.life;fx.globalAlpha=fade*(1-pSmooth(.4,1,life));fx.fillStyle=sp.color?'rgb('+sp.color.map(c=>Math.round(c*255)).join(',')+')':'#191817';fx.beginPath();fx.ellipse(sp.x+sp.vx*age,sp.y+sp.vy*age+sp.gravity*age*age,sp.r*(1-.4*life),sp.r*.8*(1-.4*life),.4,0,P_TAU);fx.fill();}
    fx.globalAlpha=fade;drawEyes(fx,current,pose.x,pose.y,pose.r,expression,gazeX,gazeY,blink,currentEyes);fx.globalAlpha=1;
    drawMirrors(room);dirty=false;
  }
  function frame(stamp) {
    raf=0;if(dead||document.hidden)return;
    const dt=lastWall===null?0:clamp((stamp-lastWall)/1000,0,.10);lastWall=stamp;
    renderFrame(dt);if(!dead&&!manual&&!document.hidden)raf=requestAnimationFrame(frame);
  }
  function visibility() {
    if(dead)return;
    if(raf){cancelAnimationFrame(raf);raf=0;}lastWall=null;
    if(!document.hidden){dirty=true;renderFrame(0);if(!manual)raf=requestAnimationFrame(frame);}
  }
  function lost(event){event.preventDefault();backendReason='WebGL context lost';releaseGL();dirty=true;renderFrame(0);}
  function restored(){if(dead)return;resources={program:null,buffer:null,texture:null,shaders:[]};initGL();resize();dirty=true;renderFrame(0);}
  function refresh(){dirty=true;if(reduced||manual)renderFrame(0);}
  function play(id,options={}) {if(dead||reduced)return false;const admitted=director.play(id,{...options});if(admitted)refresh();return !!admitted;}
  function spatter(count=1,spread=1,color=null) {
    if(dead||reduced)return;
    count=clamp(Math.floor(pFinite(count,1)),0,24);spread=clamp(pFinite(spread,1),.25,1.5);
    for(let i=0;i<count;i++){if(particles.length>=24)particles.shift();const a=rnd()*P_TAU,R=pose.r,r=(.90+rnd()*.35)*R*spread;
      particles.push({at:clock,x:pose.x+Math.cos(a)*r,y:pose.y+Math.sin(a)*r*.68,vx:Math.cos(a)*R*.14,vy:Math.sin(a)*R*.09,gravity:R*.05,r:R*(.011+rnd()*.015),life:.65+rnd()*.55,color});}
    refresh();
  }
  function setTarget(t,snap=false){if(dead||!t)return;for(const k of ['x','y','r'])if(Number.isFinite(t[k]))target[k]=k==='r'?Math.max(4,t[k]):t[k];if(snap||reduced)poseSnap=true;refresh();}
  const api={
    setTarget(t){setTarget(t);},snapTarget(t){setTarget(t,true);},
    setMood(value){if(dead||!MOODS[value]||mood===value)return;mood=value;director.setMood(value);refresh();},mood:()=>mood,
    lookAt(x,y){if(!Number.isFinite(x)||!Number.isFinite(y))return;direction=null;lookX=x;lookY=y;refresh();},lookFree(){direction=null;lookX=lookY=null;refresh();},
    lookDirection(x,y=0){if(dead||!Number.isFinite(x)||!Number.isFinite(y))return false;direction={x:clamp(x,-1,1),y:clamp(y,-1,1)};lookX=lookY=null;refresh();return true;},
    pointer(x,y){if(!Number.isFinite(x)||!Number.isFinite(y))return;ptrX=x;ptrY=y;ptrAt=clock;},
    pulse(value){if(dead||reduced)return;speech=clamp(Math.max(speech,pFinite(value)),0,1);dirty=true;},
    hop(){return play('hop',{priority:60});},shake(){return play('wiggle',{priority:60});},
    blink(){if(dead||reduced)return;forcedBlinkAt=clock;refresh();},
    spatter(k,spread){spatter(k,spread);},splash(color,k){if(dead||reduced)return;play('ta-da',{priority:45});spatter(k||4,.75,Array.isArray(color)?color.map(c=>clamp(pFinite(c),0,1)):null);},drip(){return play('drop',{priority:40});},
    setFade(v){fadeTarget=clamp(pFinite(v,1),0,1);if(reduced)fade=fadeTarget;refresh();},
    setReducedMotion(value){reduced=!!value;particles.length=0;speech=0;blinkAt=forcedBlinkAt=-100;nextBlink=clock+2.6;poseSnap=true;director.update(0,{energy,reduced,compact:false,speech:0});dirty=true;renderFrame(0);},
    animate:play,animations:()=>lib.catalog,stopAnimation(){director.stop();if(reduced)director.update(0,{energy,reduced:true});refresh();},
    setMotionEnergy(value){energy=clamp(pFinite(value,1),0,1.5);refresh();},setTextureMode(value){if(value!=='flow'&&value!=='boil')return false;texture=value;refresh();return true;},
    advance(ms){if(dead)return api.state();renderFrame(Math.max(0,pFinite(ms))/1000);return api.state();},paperDataURL,
    addMirror(canvas){if(!canvas?.getContext||dead)return;mirrors.add(canvas);refresh();},removeMirror(canvas){mirrors.delete(canvas);},
    setAgents(list){if(dead)return;const keep=new Set();for(const a of Array.isArray(list)?list:[]){if(!a?.canvas?.getContext)continue;keep.add(a.id);let ag=agents.get(a.id);if(!ag){const value=pFinite(a.seed,rnd());ag={canvas:a.canvas,seed:value,mood:a.mood||'working',color:[0,0,0],director:lib.createDirector({seed:Math.round(value*1e6)})};ag.director.setMood(ag.mood);agents.set(a.id,ag);}else if(a.mood&&ag.mood!==a.mood){ag.mood=a.mood;ag.director.setMood(a.mood);}ag.canvas=a.canvas;ag.color=(Array.isArray(a.color)?a.color:[0,0,0]).slice(0,3).map(v=>clamp(pFinite(v),0,1));while(ag.color.length<3)ag.color.push(0);}for(const id of agents.keys())if(!keep.has(id))agents.delete(id);refresh();},
    removeMirrorByCanvas(canvas){mirrors.delete(canvas);},
    hitTest(x,y){if(dead||!Number.isFinite(x)||!Number.isFinite(y)||fade<.01)return false;const q=pocketInverse(x,y,current,pose.x,pose.y,pose.r);return pocketDistance(q[0],q[1],current,character)<.10;},
    state(){const ds=director.state(),g=geometry?{...geometry}:null;if(g)delete g._boundary;
      return {x:pose.x,y:pose.y,r:pose.r,mood,fps,gl:glOK,tx:target.x,ty:target.y,tr:target.r,fade,character,backend:glOK?'webgl':'canvas2d',fallbackReason:backendReason,dpr:DPR,destroyed:dead,
        gaze:{mode:direction?'direction':lookX!==null?'point':'free',direction:direction?{...direction}:null,current:{x:gazeX,y:gazeY},point:lookX!==null?{x:lookX,y:lookY}:null},
        motion:{...ds,enabled:true,pose:{...current},energy,texture,reduced},bounds:g?{...g.bounds}:null,geometry:g,eyeCenters:g?.eyeCenters||[],particleCount:particles.length,
        mirrorCrop:mirrorCrop?{...mirrorCrop}:null,mirrors:mirrors.size,companions:agents.size,clock,manual,frames:frameCount};},
    destroy(){if(dead)return;dead=true;if(raf)cancelAnimationFrame(raf);raf=0;removeEventListener('resize',resize);document.removeEventListener('visibilitychange',visibility);inkCv.removeEventListener('webglcontextlost',lost);inkCv.removeEventListener('webglcontextrestored',restored);particles.length=0;mirrors.clear();agents.clear();if(glOK){gl.disable(gl.SCISSOR_TEST);gl.clear(gl.COLOR_BUFFER_BIT);}releaseGL(true);fx.setTransform(1,0,0,1,0,0);fx.clearRect(0,0,fxCv.width,fxCv.height);},
  };
  initGL();resize();addEventListener('resize',resize);document.addEventListener('visibilitychange',visibility);inkCv.addEventListener('webglcontextlost',lost);inkCv.addEventListener('webglcontextrestored',restored);
  renderFrame(0);if(!manual&&!document.hidden)raf=requestAnimationFrame(frame);
  return api;
}
function createNibbi(opts) {
  return opts.motion==='legacy'||!globalThis.NibbiPocketMotion ? createLegacyNibbi(opts) : createPocketNibbi(opts);
}

window.createNibbi = createNibbi;
})();

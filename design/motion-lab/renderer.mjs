/* Experimental Nibbi renderer, isolated from production.
 * Ink noise, Voronoi tufts, grain and pip eyes adapted from public/nibbi.js
 * (Nibbi / Matthew Shera, MIT). No clock, event listeners or animation loop.
 */
const TAU = Math.PI * 2;
const FOOT = 0.66;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const finite = (x, fallback = 0) => Number.isFinite(x) ? x : fallback;
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const smax = (a, b, k) => { const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1); return mix(a, b, h) + k * h * (1 - h); };
const NEUTRAL = Object.freeze({x: 0, lift: 0, sx: 1, sy: 1, rotate: 0, lean: 0, round: 0, star: 0, drop: 0, satellite: 0, trail: 0, impact: 0, eyeX: 0, eyeY: 0, blink: 0, wide: 1, happy: 0, phase: 'rest'});
const EYES = [
  {x: -35 / 135, y: 13 / 135, rx: 29 / 135, ry: 33.75 / 135, prx: 15.9 / 135, pry: 18.75 / 135, pox: 0.3 / 135, poy: 2.4 / 135},
  {x: 35 / 135, y: 12 / 135, rx: 29.9 / 135, ry: 34.4 / 135, prx: 16.4 / 135, pry: 19.1 / 135, pox: -0.3 / 135, poy: 2.2 / 135},
];
const BOIL = [[0, 0], [0.43, -0.31], [-0.29, 0.53]];
const VS = 'attribute vec2 a_p; void main(){ gl_Position = vec4(a_p, 0.0, 1.0); }';
const FS = `
precision highp float;
uniform vec2 u_resolution;
uniform vec2 u_css;
uniform vec2 u_foot;
uniform float u_R;
uniform vec2 u_scale;
uniform vec2 u_rotation;
uniform float u_lean;
uniform vec3 u_shape;
uniform vec2 u_noff;
uniform vec2 u_flow;
uniform float u_satellite;
uniform vec3 u_bead0;
uniform vec3 u_bead1;
uniform vec3 u_bead2;
uniform sampler2D u_grain;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  float a = hash(i), b = hash(i + vec2(1.0,0.0)), c = hash(i + vec2(0.0,1.0)), d = hash(i + vec2(1.0,1.0));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 3; i++){ v += a*vnoise(p); p = p*2.03 + vec2(17.13,9.71); a *= 0.5; } return v; }
float smax(float a, float b, float k){ float h = clamp(0.5+0.5*(b-a)/k,0.0,1.0); return mix(a,b,h)+k*h*(1.0-h); }
float smin(float a, float b, float k){ return -smax(-a,-b,k); }
vec2 hash2(vec2 p){ float n = hash(p); return vec2(n,hash(p+n+17.71)); }
float voro(vec2 p){ vec2 i = floor(p), f = fract(p); float md = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){ vec2 g = vec2(float(x),float(y)); vec2 r = g+hash2(i+g)-f; md = min(md,dot(r,r)); }
  return sqrt(md); }
float tuft(vec2 p){ float t = 1.0-smoothstep(0.0,1.05,voro(p)); return t*t; }
float body(vec2 q){
  float an = atan(q.y,q.x);
  float rr = 1.0 + 0.054*cos(2.0*an+1.1) + 0.048*cos(3.0*an+2.6) + 0.028*cos(5.0*an+4.7) + 0.016*cos(7.0*an+1.7);
  rr += 0.06*clamp(-sin(an),0.0,1.0) - 0.02*clamp(sin(an),0.0,1.0);
  rr += 0.085*exp((cos(an-3.30)-1.0)*6.0) + 0.050*exp((cos(an+0.15)-1.0)*6.0);
  float ysc = mix(0.98,1.10,smoothstep(-0.3,0.4,q.y));
  float blot = smax(length(q*vec2(1.0,ysc))-rr*0.95,-(q.y+0.66)-0.05,0.15);
  float roundD = length(q-vec2(0.0,0.20))-0.86;
  vec2 sp = q-vec2(0.0,0.22);
  float sa = atan(sp.y,sp.x);
  float starD = (length(sp)-(0.875+0.285*cos(5.0*(sa-1.570796327))))*0.72;
  float taper = mix(1.03,0.20,smoothstep(-0.48,1.36,q.y));
  float dropD = (length(vec2(q.x/taper,(q.y-0.35)/1.01))-1.0)*0.70;
  float total = u_shape.x+u_shape.y+u_shape.z;
  vec3 w = u_shape/max(1.0,total);
  return blot*(1.0-min(1.0,total)) + roundD*w.x + starD*w.y + dropD*w.z;
}
void main(){
  vec2 screen = vec2(gl_FragCoord.x,u_resolution.y-gl_FragCoord.y)*u_css/u_resolution;
  vec2 v = (screen-u_foot)/u_R;
  // Inverse of mapPoint(): rotate, scale, then undo the same crown bend.
  vec2 q = vec2(u_rotation.x*v.x+u_rotation.y*v.y,-u_rotation.y*v.x+u_rotation.x*v.y)/u_scale;
  q.y += 0.66;
  q.x -= u_lean*clamp((0.66-q.y)/1.6,0.0,1.2);
  if (dot(q,q)>8.0){ gl_FragColor=vec4(0.0); return; }
  q.y = -q.y; // Original ink shader is y-up; our public geometry is y-down.
  float d0 = body(q);
  if (u_satellite>0.001){
    d0 = smin(d0,length(q-u_bead0.xy)-u_bead0.z,0.065*u_satellite);
    d0 = smin(d0,length(q-u_bead1.xy)-u_bead1.z,0.065*u_satellite);
    d0 = smin(d0,length(q-u_bead2.xy)-u_bead2.z,0.065*u_satellite);
  }
  if (d0>0.40){ gl_FragColor=vec4(0.0); return; }
  // Original layered ink: cellular tufts, broken feathering, paper fibres, wash.
  float edge = smoothstep(-0.30,0.03,d0);
  float t1 = tuft(q*3.6+u_noff);
  float t2 = tuft(q*8.0+u_noff*1.6+7.3);
  float t3 = tuft(q*14.0+u_noff*2.4+57.0);
  float j = fbm(q*3.2+u_noff)-0.5;
  float fall = 1.0-smoothstep(0.03,0.13,d0);
  float d = d0-(t1*0.16+t2*0.13+t3*edge*0.07)*(0.35+0.65*edge)*fall+j*0.035;
  // Only the native blot has a planted skirt. Release it continuously as beads
  // form, keeping the liquid union free of a hard clip without a material pop.
  float nativeWeight = 1.0-min(1.0,u_shape.x+u_shape.y+u_shape.z);
  float skirtWeight = nativeWeight*(1.0-smoothstep(0.0,0.18,u_satellite));
  d = mix(d,smax(d,-(q.y+0.66)-0.13,0.10),skirtWeight);
  float aIn = 1.0-smoothstep(-0.015,0.008,d);
  float aBl = (1.0-smoothstep(-0.01,0.14,d))*0.33;
  float A = aIn+aBl*(1.0-aIn);
  float g1 = fbm(q*12.0+u_noff*2.3+3.3);
  float outer = smoothstep(-0.005,0.06,d);
  A *= mix(1.0,smoothstep(0.28,0.65,g1),outer*0.9);
  float gr = texture2D(u_grain,screen/256.0).r;
  A *= mix(0.985+0.015*gr,0.86+0.18*gr,edge);
  float wash = fbm(q*2.2+u_flow)-0.5;
  float tone = 0.035+(0.065*t2+0.03*t1)*(0.1+0.9*edge)+0.02*(1.0-gr)+0.05*wash*(1.0-edge);
  gl_FragColor = vec4(vec3(tone*0.98,tone*0.97,tone)*A,A);
}`;

function cleanPose(input, reduced) {
  const p = {...NEUTRAL};
  for (const key of Object.keys(NEUTRAL)) if (key !== 'phase') p[key] = finite(input?.[key], NEUTRAL[key]);
  p.phase = typeof input?.phase === 'string' ? input.phase : 'rest';
  p.x = clamp(p.x, -1.2, 1.2); p.lift = clamp(p.lift, -0.15, 1.1);
  p.sx = clamp(p.sx, 0.35, 2); p.sy = clamp(p.sy, 0.35, 2);
  p.rotate = clamp(p.rotate, -Math.PI, Math.PI); p.lean = clamp(p.lean, -0.8, 0.8);
  for (const key of ['round','star','drop','satellite','trail','impact','blink','happy']) p[key] = clamp(p[key], 0, 1);
  p.wide = clamp(p.wide, 0.65, 1.16);
  p.eyeX = clamp(p.eyeX, -0.16, 0.16); p.eyeY = clamp(p.eyeY, -0.13, 0.13);
  return reduced ? {...NEUTRAL, happy: p.happy, wide: p.wide, phase: 'reduced'} : p;
}

// Positive distance outside. Same shape equation as the fragment shader.
function bodyDistance(x, y, p) {
  y = -y;
  const a = Math.atan2(y, x);
  let rr = 1 + .054*Math.cos(2*a+1.1) + .048*Math.cos(3*a+2.6) + .028*Math.cos(5*a+4.7) + .016*Math.cos(7*a+1.7);
  rr += .06*clamp(-Math.sin(a),0,1) - .02*clamp(Math.sin(a),0,1);
  rr += .085*Math.exp((Math.cos(a-3.30)-1)*6) + .05*Math.exp((Math.cos(a+.15)-1)*6);
  const blot = smax(Math.hypot(x,y*mix(.98,1.10,smooth(-.3,.4,y)))-rr*.95,-(y+.66)-.05,.15);
  const round = Math.hypot(x,y-.20)-.86;
  const star = (Math.hypot(x,y-.22)-(.875+.285*Math.cos(5*(Math.atan2(y-.22,x)-Math.PI/2))))*.72;
  const taper = mix(1.03,.20,smooth(-.48,1.36,y));
  const drop = (Math.hypot(x/taper,(y-.35)/1.01)-1)*.70;
  const sum = p.round+p.star+p.drop, divisor = Math.max(1,sum);
  return blot*(1-Math.min(1,sum))+(round*p.round+star*p.star+drop*p.drop)/divisor;
}

function contour(p, padding = 0, samples = 112) {
  const points = [];
  for (let i = 0; i < samples; i++) {
    const a = i/samples*TAU, dx = Math.cos(a), dy = Math.sin(a);
    let lo = 0, hi = 2.6;
    for (let j = 0; j < 13; j++) {
      const r = (lo+hi)/2;
      if (bodyDistance(dx*r, -.12+dy*r, p) < padding) lo = r; else hi = r;
    }
    points.push([dx*(lo+hi)/2,-.12+dy*(lo+hi)/2]);
  }
  return points;
}

function beads(p, t) {
  if (p.satellite <= .001) return [];
  const amount = p.satellite, spread = .91+.43*amount;
  return [
    [-spread, -.05-.09*Math.sin(t*1.1), .092*amount],
    [spread*.96, -.51+.07*Math.sin(t*.9+.6), .12*amount],
    [-.35+.045*Math.sin(t*.8), -(.93+.44*amount), .073*amount],
  ];
}

function textureAt(time, texture, reduced) {
  const t = reduced ? 0 : finite(time);
  const mode = texture === 'boil' ? 'boil' : 'flow';
  const step = Math.floor(t*9);
  const index = ((step%BOIL.length)+BOIL.length)%BOIL.length;
  const clock = mode === 'boil' ? step/9 : t;
  return {mode, time: t, clock, step: mode === 'boil' ? step : null,
    offset: reduced ? [0,0] : mode === 'boil' ? [...BOIL[index]] : [.44*Math.sin(t*.19), .38*Math.sin(t*.16)],
    flow: [.35*Math.sin(clock*.13), .28*Math.sin(clock*.11)]};
}

// All points, including every eye outline/glint/lid, pass through this map.
function mapUnit(x, y, p) {
  x += p.lean*clamp((FOOT-y)/1.6,0,1.2);
  x *= p.sx; y = (y-FOOT)*p.sy;
  const c = Math.cos(p.rotate), s = Math.sin(p.rotate);
  return [x*c-y*s+p.x, x*s+y*c-p.lift];
}

function box(points) {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const [x,y] of points) { left = Math.min(left,x); right = Math.max(right,x); top = Math.min(top,y); bottom = Math.max(bottom,y); }
  return {left,top,right,bottom,width:right-left,height:bottom-top};
}
function ring(cx, cy, rx, ry, n = 64) {
  return Array.from({length:n},(_,i) => [cx+Math.cos(i/n*TAU)*rx,cy+Math.sin(i/n*TAU)*ry]);
}
function path(ctx, points, close = true) {
  ctx.beginPath();
  points.forEach(([x,y],i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
  if (close) ctx.closePath();
}
function grainBytes() {
  const size = 256, raw = new Float32Array(size*size), out = new Uint8Array(size*size);
  let seed = 1337;
  for (let i = 0; i < raw.length; i++) { seed = (seed*1103515245+12345)&0x7fffffff; raw[i] = seed/0x7fffffff; }
  const g = (x,y) => raw[((y+size)%size)*size+((x+size)%size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    out[y*size+x] = Math.round((g(x-2,y)+2*g(x-1,y)+3*g(x,y)+2*g(x+1,y)+g(x+2,y)+g(x,y-1)+g(x,y+1))/11*255);
  }
  return out;
}

export class InkRenderer {
  constructor(canvas, {force2D = false} = {}) {
    if (!canvas?.getContext) throw new TypeError('InkRenderer needs a canvas.');
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', {alpha:true});
    if (!this.ctx) throw new Error('A visible Canvas2D context is required for compositing.');
    this.dead = false; this.backend = 'canvas2d'; this.reason = force2D ? 'forced by force2D' : null;
    this.gl = null; this.resources = {shaders:[],program:null,buffer:null,texture:null};
    this.maxDimension = 8192; this.geometry = null; this.lastTexture = null;
    if (!force2D) this.initGL();
    this.resize();
  }

  initGL() {
    try {
      this.offscreen = this.canvas.ownerDocument.createElement('canvas');
      const gl = this.offscreen.getContext('webgl', {alpha:true,premultipliedAlpha:true,antialias:false,preserveDrawingBuffer:false,depth:false,stencil:false});
      if (!gl) throw new Error('WebGL context unavailable');
      this.gl = gl;
      const limits = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
      this.maxDimension = Math.min(8192, gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), limits[0], limits[1]);
      const compile = (type, code) => {
        const shader = gl.createShader(type); this.resources.shaders.push(shader);
        gl.shaderSource(shader,code); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'Shader compilation failed');
        return shader;
      };
      const highp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER,gl.HIGH_FLOAT)?.precision > 0;
      const prog = gl.createProgram(); this.resources.program = prog;
      gl.attachShader(prog,compile(gl.VERTEX_SHADER,VS));
      gl.attachShader(prog,compile(gl.FRAGMENT_SHADER,highp ? FS : FS.replace('precision highp float','precision mediump float')));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'Shader link failed');
      gl.useProgram(prog);
      const buffer = gl.createBuffer(); this.resources.buffer = buffer;
      gl.bindBuffer(gl.ARRAY_BUFFER,buffer); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
      const attr = gl.getAttribLocation(prog,'a_p'); gl.enableVertexAttribArray(attr); gl.vertexAttribPointer(attr,2,gl.FLOAT,false,0,0);
      const tex = gl.createTexture(); this.resources.texture = tex;
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,tex); gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.LUMINANCE,256,256,0,gl.LUMINANCE,gl.UNSIGNED_BYTE,grainBytes());
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      this.U = {};
      for (const name of ['resolution','css','foot','R','scale','rotation','lean','shape','noff','flow','satellite','bead0','bead1','bead2','grain']) this.U[name] = gl.getUniformLocation(prog,`u_${name}`);
      gl.uniform1i(this.U.grain,0); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.clearColor(0,0,0,0);
      this.backend = 'webgl'; this.reason = null;
    } catch (error) {
      this.reason = String(error.message || error); this.backend = 'canvas2d'; this.releaseGL();
    }
  }

  resize() {
    if (this.dead) return;
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, finite(rect.width,1)); this.height = Math.max(1,finite(rect.height,1));
    const requested = clamp(finite(this.canvas.ownerDocument.defaultView?.devicePixelRatio,1), .5, 2);
    this.dpr = Math.min(requested,this.maxDimension/this.width,this.maxDimension/this.height);
    const width = Math.max(1,Math.floor(this.width*this.dpr)), height = Math.max(1,Math.floor(this.height*this.dpr));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    if (this.backend === 'webgl') {
      if (this.offscreen.width !== width) this.offscreen.width = width;
      if (this.offscreen.height !== height) this.offscreen.height = height;
      this.gl.viewport(0,0,width,height);
    }
  }

  render(input, {time = 0, texture = 'flow', reduced = false} = {}) {
    if (this.dead) return;
    const p = cleanPose(input,reduced), tx = textureAt(time,texture,reduced);
    const drops = beads(p,reduced ? 0 : finite(time));
    const boundary = contour(p,.24,96);
    const extent = [...boundary];
    for (const [x,y,r] of drops) extent.push(...ring(x,y,r+.22,r+.22,24));
    const eyeLocal = EYES.flatMap(e => ring(e.x+p.eyeX,e.y+p.eyeY,e.rx*p.wide,e.ry*p.wide,32));
    extent.push(...eyeLocal);
    const unitBounds = box(extent.map(([x,y]) => mapUnit(x,y,p)));
    const W = this.width, H = this.height, margin = Math.max(5, Math.min(W,H)*.025);
    const cx = W/2, footY = H*.81;
    const baseRadius = Math.min(W/4.35,H/4.75);
    // Fixed framing for authored motion; an extra safety fit handles arbitrary API poses.
    let R = baseRadius;
    if (unitBounds.left < 0) R = Math.min(R,(cx-margin)/-unitBounds.left);
    if (unitBounds.right > 0) R = Math.min(R,(W-cx-margin)/unitBounds.right);
    if (unitBounds.top < 0) R = Math.min(R,(footY-margin)/-unitBounds.top);
    if (unitBounds.bottom > 0) R = Math.min(R,(H-footY-margin)/unitBounds.bottom);
    R = Math.max(.01,R);
    const map = (x,y) => { const q = mapUnit(x,y,p); return [cx+q[0]*R,footY+q[1]*R]; };
    const mapped = extent.map(([x,y]) => map(x,y));
    const eyeCenters = EYES.map(e => { const [x,y] = map(e.x+p.eyeX,e.y+p.eyeY); return {x,y}; });
    // Match the 64-point white eye paths; measure before their shared invertible warp.
    const faceMargins = EYES.map(e => Math.min(...ring(e.x+p.eyeX,e.y+p.eyeY,e.rx*p.wide,e.ry*p.wide)
      .map(([x,y]) => -bodyDistance(x,y,p))));
    const minFaceMargin = Math.min(...faceMargins);
    this.geometry = {
      width:W,height:H,radius:R,baseRadius,fitScale:R/baseRadius,
      baseFoot:{x:cx,y:footY},foot:{x:cx+p.x*R,y:footY-p.lift*R},localFoot:{x:0,y:FOOT},
      bounds:box(mapped),bodyBounds:box(boundary.map(([x,y]) => map(x,y))),
      eyeBounds:box(eyeLocal.map(([x,y]) => map(x,y))),eyeCenters,
      faceContained:minFaceMargin>=0,minFaceMargin,faceMargins,faceSamplesPerEye:64,
      faceMarginNote:'Base-radius units in the untextured local body field; positive is inside. Morph fields approximate signed distance.',
      transform:{sx:p.sx,sy:p.sy,rotate:p.rotate,lean:p.lean,x:p.x,lift:p.lift},
      shapes:{round:p.round,star:p.star,drop:p.drop},satellites:drops.length,
      inBounds:mapped.every(([x,y]) => x>=0 && x<=W && y>=0 && y<=H),
      boundsNote:'Conservative CSS-pixel ink-feather bounds, not a pixel readback.',
    };
    this.lastTexture = tx;
    const ctx = this.ctx;
    ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
    ctx.setTransform(this.canvas.width/W,0,0,this.canvas.height/H,0,0);
    this.drawMarks(p,map,R,cx,footY);
    if (this.backend === 'webgl' && this.gl.isContextLost()) {
      this.reason = 'WebGL context lost'; this.backend = 'canvas2d'; this.releaseGL();
    }
    if (this.backend === 'webgl') {
      const gl = this.gl, U = this.U;
      gl.useProgram(this.resources.program);
      gl.uniform2f(U.resolution,this.offscreen.width,this.offscreen.height); gl.uniform2f(U.css,W,H);
      gl.uniform2f(U.foot,cx+p.x*R,footY-p.lift*R); gl.uniform1f(U.R,R);
      gl.uniform2f(U.scale,p.sx,p.sy); gl.uniform2f(U.rotation,Math.cos(p.rotate),Math.sin(p.rotate));
      gl.uniform1f(U.lean,p.lean); gl.uniform3f(U.shape,p.round,p.star,p.drop);
      gl.uniform2f(U.noff,...tx.offset); gl.uniform2f(U.flow,...tx.flow); gl.uniform1f(U.satellite,p.satellite);
      for (let i = 0; i < 3; i++) { const b = drops[i] || [0,0,0]; gl.uniform3f(U[`bead${i}`],b[0],-b[1],b[2]); }
      gl.drawArrays(gl.TRIANGLES,0,3);
      ctx.drawImage(this.offscreen,0,0,W,H);
    } else this.drawFallback(p,tx,drops,map,R);
    this.drawEyes(p,map,R);
  }

  drawMarks(p,map,R,cx,footY) {
    const ctx = this.ctx;
    if (p.trail > .001) {
      const side = p.x < 0 ? 1 : -1;
      for (let i = 0; i < 2; i++) {
        const points = [[side*(.78+i*.10),.34],[side*(1.04+i*.14),.43],[side*(1.13+i*.15),.48],[side*(.83+i*.10),.40]];
        path(ctx,points.map(([x,y]) => map(x,y))); ctx.fillStyle = `rgba(24,23,22,${p.trail*(.065-i*.02)})`; ctx.fill();
      }
    }
    if (p.impact > .001) {
      ctx.fillStyle = `rgba(24,23,22,${.38*p.impact})`;
      for (let i = 0; i < 8; i++) {
        const side = i%2 ? 1 : -1, n = Math.floor(i/2), x = cx+p.x*R+side*(.70+n*.14+.13*(1-p.impact))*R;
        const y = footY+(.018+Math.sin(i*3.7)*.035)*R;
        ctx.beginPath(); ctx.ellipse(x,y,(.043-n*.006)*R*p.impact,.012*R*p.impact,side*.15,0,TAU); ctx.fill();
      }
    }
  }

  drawFallback(p,tx,drops,map,R) {
    const ctx = this.ctx, base = contour(p,0,144);
    const phase = tx.offset[0]*7.7+tx.offset[1]*4.6;
    const ragged = base.map(([x,y],i) => {
      const a = i/base.length*TAU;
      const d = .012*Math.sin(i*2.13+phase)+.008*Math.sin(i*4.79-phase*.8);
      return [x+Math.cos(a)*d,y+Math.sin(a)*d];
    });
    // Matte stippled fringe, never a gradient or a glossy replacement body.
    ctx.fillStyle = 'rgba(20,19,18,.085)';
    for (let i = 0; i < ragged.length; i++) {
      const [x,y] = ragged[i], r = .019+.021*(.5+.5*Math.sin(i*7.31+phase));
      path(ctx,ring(x,y,r,r*.82,12).map(([xx,yy]) => map(xx,yy))); ctx.fill();
    }
    path(ctx,ragged.map(([x,y]) => map(x,y))); ctx.fillStyle = '#111011'; ctx.fill();
    ctx.save(); path(ctx,ragged.map(([x,y]) => map(x,y))); ctx.clip();
    for (let i = 0; i < 235; i++) {
      const a = i*2.39996323, r = Math.sqrt((i+.5)/235)*1.46;
      const x = Math.cos(a)*r+.016*tx.flow[0], y = Math.sin(a)*r-.16+.016*tx.flow[1];
      const alpha = .023+.028*(.5+.5*Math.sin(i*1.7+phase));
      const size = .007+.018*(.5+.5*Math.sin(i*4.17));
      ctx.fillStyle = `rgba(193,187,174,${alpha})`;
      path(ctx,ring(x,y,size*1.6,size*.6,8).map(([xx,yy]) => map(xx,yy))); ctx.fill();
    }
    ctx.restore();
    for (const [x,y,r] of drops) {
      path(ctx,ring(x,y,r+.018,r+.018,32).map(([xx,yy]) => map(xx,yy))); ctx.fillStyle = 'rgba(20,19,18,.12)'; ctx.fill();
      path(ctx,ring(x,y,r,r,32).map(([xx,yy]) => map(xx,yy))); ctx.fillStyle = '#151415'; ctx.fill();
    }
  }

  drawEyes(p,map,R) {
    const ctx = this.ctx;
    const ellipse = (cx,cy,rx,ry,fill) => { path(ctx,ring(cx,cy,rx,ry).map(([x,y]) => map(x,y))); ctx.fillStyle = fill; ctx.fill(); };
    for (const eye of EYES) {
      const x = eye.x+p.eyeX, y = eye.y+p.eyeY, rx = eye.rx*p.wide, ry = eye.ry*p.wide;
      const pupil = 1-.12*p.happy, prx = eye.prx*pupil, pry = eye.pry*pupil;
      const px = x+clamp(eye.pox+p.eyeX*.16,-rx+prx+.009,rx-prx-.009);
      const py = y+clamp(eye.poy+p.eyeY*.12,-ry+pry+.009,ry-pry-.009);
      ellipse(x,y,rx,ry,'#fbfaf5');
      ctx.save(); path(ctx,ring(x,y,rx,ry).map(([xx,yy]) => map(xx,yy))); ctx.clip();
      ellipse(px,py,prx,pry,'#131211');
      ellipse(px-prx*.34,py-pry*.42,prx*.29,pry*.23,'rgba(251,250,245,.96)');
      ellipse(px+prx*.32,py+pry*.29,prx*.12,prx*.12,'rgba(251,250,245,.58)');
      if (p.blink > .001) ellipse(x,y-ry-2.1*ry+p.blink*2*ry,rx*2.2,ry*2.1,'#141312');
      if (p.happy > .001) ellipse(x,y+ry+1.9*ry-p.happy*.32*2*ry,rx*1.9,ry*1.9,'#141312');
      ctx.restore();
    }
  }

  info() {
    return {
      backend:this.backend, fallbackReason:this.reason, destroyed:this.dead,
      width:this.width,height:this.height,dpr:this.dpr,
      pixels:{width:this.canvas.width,height:this.canvas.height},maxDimension:this.maxDimension,
      geometry:this.geometry ? JSON.parse(JSON.stringify(this.geometry)) : null,
      texture:this.lastTexture ? JSON.parse(JSON.stringify(this.lastTexture)) : null,
      deterministic:true, ownAnimationLoop:false,
    };
  }

  releaseGL() {
    const gl = this.gl;
    if (gl) {
      const r = this.resources;
      if (r.texture) gl.deleteTexture(r.texture);
      if (r.buffer) gl.deleteBuffer(r.buffer);
      if (r.program) gl.deleteProgram(r.program);
      for (const shader of r.shaders) if (shader) gl.deleteShader(shader);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    this.resources = {shaders:[],program:null,buffer:null,texture:null}; this.gl = null;
    if (this.offscreen) { this.offscreen.width = 1; this.offscreen.height = 1; }
    this.offscreen = null;
  }

  destroy() {
    if (this.dead) return;
    this.releaseGL(); this.dead = true;
    this.ctx.setTransform(1,0,0,1,0,0); this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
  }
}

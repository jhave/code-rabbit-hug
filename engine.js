'use strict';
/* engine: audio clock, baked analysis, one persistent fluid feedback field (WebGL2),
   an "ink" canvas that bleeds into the field, and a crisp overlay canvas on top. */
(() => {
const S = window.SONG, cues = S.cues;
const $ = id => document.getElementById(id);
const glc = $('gl'), ovc = $('ov'), audio = $('au');
const qs = new URLSearchParams(location.search);
const gl = glc.getContext('webgl2', { antialias: false, alpha: false });
if (!gl) { const e = $('err'); e.style.display = 'grid'; e.textContent = 'This piece needs WebGL2.'; return; }
const O = ovc.getContext('2d');
const inkc = document.createElement('canvas'), I = inkc.getContext('2d');

// ---------- math
const clamp = (x, a = 0, b = 1) => x < a ? a : x > b ? b : x;
const lerp = (a, b, t) => a + (b - a) * t;
const sm = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const TAU = Math.PI * 2;

// ---------- baked audio features
const dec = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const ENV = { lo: dec(S.lo), mid: dec(S.mid), hi: dec(S.hi), rms: dec(S.rms), flux: dec(S.flux) };
function env(name, t) {
  const a = ENV[name], i = (t - S.t0) * S.fps, k = Math.floor(i);
  if (k < 0 || k >= a.length - 1) return 0; const f = i - k;
  return (a[k] * (1 - f) + a[k + 1] * f) / 255;
}
const BEAT = 60 / S.bpm;

// ---------- shaders
const VS = `#version 300 es
in vec2 a; out vec2 v; void main(){ v=a*.5+.5; gl_Position=vec4(a,0.,1.); }`;
const NOISE = `
float h1(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h1(i),h1(i+vec2(1,0)),f.x), mix(h1(i+vec2(0,1)),h1(i+vec2(1,1)),f.x), f.y); }
vec2 curl(vec2 p){ float e=.02; return vec2(vn(p+vec2(0,e))-vn(p-vec2(0,e)), vn(p-vec2(e,0))-vn(p+vec2(e,0)))/(2.*e); }
`;
const SIM = `#version 300 es
precision highp float;
uniform sampler2D uPrev, uInk; uniform vec2 uRes; uniform float uT, uK;
uniform float uSwirl,uTurb,uShear,uDrain,uDecay,uInject,uFreeze,uGrav,uGlitch,uZoom;
uniform vec2 uPtr, uPtrV;
in vec2 v; out vec4 o;
${NOISE}
void main(){
  float asp=uRes.x/uRes.y; vec2 p=(v-.5)*vec2(asp,1.);
  vec2 f=vec2(0.);
  f += (curl(p*1.6+vec2(0.,uT*.04)) + .5*curl(p*4.1-vec2(uT*.07,0.)))*.0016*uTurb;
  float r=length(p);
  f += vec2(-p.y,p.x)*uSwirl*.011/(.18+r);
  f -= p*uDrain*.007/(.25+r);
  f += p*uZoom*.006;
  f.x += uShear*.0045*(.65+.35*sin(p.y*7.+uT*1.3));
  f.y -= uGrav*.0028;
  vec2 d=p-(uPtr-.5)*vec2(asp,1.);
  f += uPtrV*exp(-dot(d,d)*26.);
  float row=floor(v.y*26.);
  if(uGlitch>.01 && h1(vec2(row,floor(uT*9.)))>1.-uGlitch*.22) f.x += (h1(vec2(row,3.))-.5)*.06;
  f.x/=asp; f*=uK;
  vec2 px=1./uRes;
  float ice=texture(uPrev,v).a;
  float m=max(max(texture(uPrev,v+vec2(2.5,0.)*px).a,texture(uPrev,v-vec2(2.5,0.)*px).a),
              max(texture(uPrev,v+vec2(0.,2.5)*px).a,texture(uPrev,v-vec2(0.,2.5)*px).a));
  m=max(m,max(texture(uPrev,v+vec2(2.,2.)*px).a,texture(uPrev,v-vec2(2.,-2.)*px).a));
  if(uFreeze>.02){
    float prob=uFreeze*(.22+.78*step(.42,vn(p*26.)))*uK;
    if(m>.6 && h1(v*uRes+fract(uT)*91.)<prob) ice=min(1.,ice+.34);
    if(length(d)<.014) ice=1.;
    for(int i=0;i<7;i++){ vec2 s=vec2(h1(vec2(float(i),1.7)),h1(vec2(float(i),9.2)))-.5; s*=vec2(asp,1.)*.9;
      if(length(p-s)<.006) ice=1.; }
  }
  ice=max(0., ice-(1.-min(1.,uFreeze*3.))*.006*uK);
  vec3 col=texture(uPrev, v-f*(1.-ice)).rgb;
  col*=mix(uDecay, 1., ice*.9);
  vec4 ink=texture(uInk,v);
  col=col*(1.-ink.a*uInject)+ink.rgb*uInject;
  o=vec4(col,ice);
}`;
const SHOW = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uRes; uniform float uT;
uniform float uIrid,uFluoro,uBlush,uGlitch,uDim,uPulse;
in vec2 v; out vec4 o;
${NOISE}
float L(vec3 c){ return dot(c,vec3(.3,.59,.11)); }
vec3 vor(vec2 p){ vec2 i=floor(p), f=fract(p); float d1=9., d2=9., id=0.;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec2 g=vec2(x,y); vec2 q=g+vec2(h1(i+g),h1(i+g+7.3))-f; float d=dot(q,q);
    if(d<d1){ d2=d1; d1=d; id=h1(i+g+3.1);} else if(d<d2) d2=d; }
  return vec3(id, sqrt(d2)-sqrt(d1), sqrt(d1)); }
void main(){
  float asp=uRes.x/uRes.y; vec2 uv=v; vec2 p=(v-.5)*vec2(asp,1.);
  float row=floor(uv.y*44.); float off=0.;
  if(uGlitch>.01 && h1(vec2(row,floor(uT*13.)))>1.-uGlitch*.16) off=(h1(vec2(row,floor(uT*13.)+5.))-.5)*.09*uGlitch;
  float sp=.0035*uGlitch;
  vec4 s=texture(uTex,uv+vec2(off,0.));
  vec3 c=vec3(texture(uTex,uv+vec2(off+sp,0.)).r, s.g, texture(uTex,uv+vec2(off-sp,0.)).b);
  vec2 e=vec2(2.5)/uRes;
  float l=L(c);
  float gx=L(texture(uTex,uv+vec2(e.x,0.)).rgb)-L(texture(uTex,uv-vec2(e.x,0.)).rgb);
  float gy=L(texture(uTex,uv+vec2(0.,e.y)).rgb)-L(texture(uTex,uv-vec2(0.,e.y)).rgb);
  vec3 film=.5+.5*cos(6.2832*(l*1.3+(gx+gy)*3.+vn(p*2.2+uT*.06)*1.2+uT*.02+vec3(0.,.33,.67)));
  c=mix(c, c*film*1.9+film*l*.25, uIrid);
  c+=vec3(.9,.95,1.)*length(vec2(gx,gy))*.6*uIrid;
  vec3 bg=mix(vec3(.018,.018,.032),vec3(.045,.03,.07),v.y+.2*vn(p*1.5+uT*.03));
  float flick=(1.-.35*step(.93,h1(vec2(floor(uT*24.),7.))))*(.94+.06*sin(uT*377.));
  float tube=smoothstep(.012,.0,abs(v.y-.965))*step(.04,fract(v.x*3.+.02))*1.6;
  vec3 fl=vec3(.72,.95,.88)*(exp(-(1.-v.y)*3.2)*.30+tube)*flick*uFluoro;
  c=bg*(1.-uDim)+c+fl;
  c=mix(c, c*vec3(1.35,.42,.55)+vec3(.28,.0,.06)*(.35+l), uBlush);
  float ice=s.a;
  if(ice>.003){ vec3 vr=vor(p*22.); float facet=.25+.75*vr.x; float edge=smoothstep(.0,.06,vr.y);
    vec3 ic=vec3(.55,.82,1.)*(.18+.5*facet)+vec3(1.)*(1.-edge)*.5+c*.55;
    c=mix(c, ic, smoothstep(0.,.5,ice)*.82); }
  c+=uPulse*vec3(.03,.025,.045);
  c*=1.-.55*dot(p,p)*.9;
  c+=(h1(v*uRes+fract(uT)*17.)-.5)*.035;
  o=vec4(pow(max(c,0.),vec3(.92)),1.);
}`;

function sh(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
function prog(fs) { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'a'); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const nm = gl.getActiveUniform(p, i).name; u[nm] = gl.getUniformLocation(p, nm); }
  return { p, u }; }
const simP = prog(SIM), showP = prog(SHOW);
const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
const floatOK = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

let W = 0, H = 0, dpr = 1, sw = 0, sh_ = 0, tex = [], fbo = [], inkTex = null, cur = 0;
function mkTex(w, h, float) { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; }
function resize() {
  W = innerWidth; H = innerHeight; dpr = Math.min(devicePixelRatio || 1, 2);
  ovc.width = glc.width = Math.round(W * dpr); ovc.height = glc.height = Math.round(H * dpr);
  const sc = Math.min(1, 1100 / Math.max(ovc.width, ovc.height));
  sw = Math.max(2, Math.round(ovc.width * sc)); sh_ = Math.max(2, Math.round(ovc.height * sc));
  inkc.width = sw; inkc.height = sh_;
  tex.forEach(t => gl.deleteTexture(t)); fbo.forEach(f => gl.deleteFramebuffer(f)); if (inkTex) gl.deleteTexture(inkTex);
  tex = [mkTex(sw, sh_, floatOK), mkTex(sw, sh_, floatOK)];
  fbo = tex.map(t => { const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); return f; });
  inkTex = mkTex(sw, sh_, false);
  E.W = W; E.H = H; E.u = Math.min(W, H) / 100; E.fw = Math.min(W, H * 1.75);
  if (E.onresize) E.onresize();
}

// ---------- params
const DEF = { swirl: 0, turb: 1, shear: 0, drain: 0, decay: .972, inject: 1, irid: .35, fluoro: 0, blush: 0, glitch: 0, freeze: 0, grav: 0, zoom: 0, dim: 0 };
const P = { ...DEF };

// ---------- lyric timing helpers
const wcache = [];
function wordsOf(i) {
  if (wcache[i]) return wcache[i];
  const c = cues[i], ws = c.text.split(' '), dur = Math.min(c.b - c.a, ws.length * .62 + .5);
  const wt = ws.map(w => w.replace(/[^\w]/g, '').length + 2), tot = wt.reduce((a, b) => a + b, 0);
  let acc = 0; const out = ws.map((w, k) => { const a = c.a + dur * acc / tot; acc += wt[k]; return { w, a, b: c.a + dur * acc / tot, i: k }; });
  out.end = c.a + dur; return wcache[i] = out;
}
const wordT = (i, re) => { const w = wordsOf(i).find(w => re.test(w.w)); return w ? w.a : cues[i].a; };
const cprog = (i, t = E.t) => clamp((t - cues[i].a) / (wordsOf(i).end - cues[i].a));
function charsShown(i, t = E.t) { let n = 0; for (const w of wordsOf(i)) { if (t >= w.b) n += w.w.length + 1; else if (t > w.a) { n += Math.ceil(w.w.length * (t - w.a) / (w.b - w.a)); break; } else break; } return n; }
function cueAt(t) { let k = -1; for (let i = 0; i < cues.length; i++) if (t >= cues[i].a) k = i; return k; }

// word-wrap the current ctx font; returns items positioned around (0,0), textBaseline middle, textAlign left
function flow(c, words, maxW, lh) {
  const sp = c.measureText(' ').width, lines = [[]]; let x = 0;
  for (const w of words) { const wd = c.measureText(w.w).width;
    if (x > 0 && x + wd > maxW) { lines.push([]); x = 0; }
    lines[lines.length - 1].push({ ...w, x, wd }); x += wd + sp; }
  const items = []; let mw = 0;
  lines.forEach((ln, li) => { const last = ln[ln.length - 1], lw = last.x + last.wd; mw = Math.max(mw, lw);
    for (const it of ln) { it.x -= lw / 2; it.y = (li - (lines.length - 1) / 2) * lh; it.line = li; items.push(it); } });
  items.w = mw; items.h = lines.length * lh; items.lines = lines.length; return items;
}
const F = {
  serif: '"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif',
  mono: '"SF Mono",Menlo,Consolas,"DejaVu Sans Mono",monospace',
  sans: '"Helvetica Neue",Helvetica,Arial,sans-serif',
  disp: 'Didot,"Bodoni 72","Bodoni MT","Playfair Display",Georgia,serif',
};
const font = (c, px, fam = F.serif, style = '') => { c.font = `${style} ${px}px ${fam}`; c.textBaseline = 'middle'; c.textAlign = 'left'; };

// ---------- pointer (autopilots when idle, so nothing ever waits on it)
const ptr = { x: 0, y: 0, tx: 0, ty: 0, vx: 0, vy: 0, last: -99, auto: true, down: false };
addEventListener('pointermove', e => { ptr.tx = e.clientX; ptr.ty = e.clientY; ptr.last = performance.now() / 1000; });
addEventListener('pointerdown', e => { ptr.tx = e.clientX; ptr.ty = e.clientY; ptr.last = performance.now() / 1000; ptr.down = true; start(); });
addEventListener('pointerup', () => ptr.down = false);

// ---------- clock
let started = false, ended = false, clock = 0;
const fake = qs.has('fake'), hold = qs.has('hold'), t0 = +qs.get('t') || 0;
function start() {
  if (started && !ended) return;
  clock = ended ? 0 : t0; started = true; ended = false;
  if (!fake) { audio.currentTime = clock; audio.play().catch(() => { started = false; }); }
}
audio.addEventListener('ended', () => { ended = true; });
addEventListener('keydown', e => {
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!started || ended) start(); else if (!fake) audio.paused ? audio.play() : audio.pause(); }
  if (started && !fake && e.key === 'ArrowRight') audio.currentTime = clock = Math.min(S.dur - .1, audio.currentTime + 5);
  if (started && !fake && e.key === 'ArrowLeft') audio.currentTime = clock = Math.max(0, audio.currentTime - 5);
});

// ---------- engine object
const E = window.E = {
  S, cues, O, I, P, DEF, F, ptr, t: 0, dt: .016, T: 0, W: 0, H: 0, u: 1, fw: 1, started: false, ended: false,
  A: { lo: 0, mid: 0, hi: 0, rms: 0, flux: 0 }, beat: 0, beatN: 0, pulse: 0, BEAT,
  clamp, lerp, sm, hash, TAU, env, wordsOf, wordT, cprog, charsShown, cueAt, flow, font,
  scenes: [], post: [], gate: null, onresize: null,
  both(fn) { fn(O, false); fn(I, true); },
};

function frame(ms) {
  requestAnimationFrame(frame);
  const T = ms / 1000, dt = Math.min(.05, Math.max(.001, T - E.T)); E.T = T; E.dt = dt;
  if (fake) { if (!started) start(); if (!hold) clock += dt; if (clock >= S.dur) ended = true; }
  else if (started && !audio.paused) { clock += dt * audio.playbackRate; const d = audio.currentTime - clock; clock = Math.abs(d) > .08 ? audio.currentTime : clock + d * .1; }
  else if (started) clock = audio.currentTime;
  const t = E.t = started ? clock : 0; E.started = started; E.ended = ended;
  const playing = started && !ended;

  for (const k in E.A) E.A[k] = playing ? env(k, t) : 0;
  const bp = (t - S.beat0) / BEAT; E.beatN = Math.floor(bp); E.beat = bp - E.beatN;
  E.pulse = playing ? Math.exp(-E.beat * 4.5) * (.25 + .75 * E.A.lo) : 0;

  // pointer
  ptr.auto = T - ptr.last > 2.5;
  if (ptr.auto) { ptr.tx = W / 2 + W * .3 * Math.sin(T * .37) + W * .09 * Math.sin(T * 1.13); ptr.ty = H / 2 + H * .28 * Math.sin(T * .29 + 1) + H * .08 * Math.cos(T * .91); }
  const px = ptr.x, py = ptr.y, kk = 1 - Math.exp(-dt * (ptr.auto ? 2.2 : 16));
  ptr.x += (ptr.tx - ptr.x) * kk; ptr.y += (ptr.ty - ptr.y) * kk;
  ptr.vx = lerp(ptr.vx, (ptr.x - px) / dt, .3); ptr.vy = lerp(ptr.vy, (ptr.y - py) / dt, .3);

  // canvases
  O.setTransform(dpr, 0, 0, dpr, 0, 0); O.clearRect(0, 0, W, H); O.globalAlpha = 1; O.globalCompositeOperation = 'source-over';
  const ik = sw / W; I.setTransform(ik, 0, 0, ik, 0, 0); I.clearRect(0, 0, W, H); I.globalAlpha = 1; I.globalCompositeOperation = 'source-over';

  // scenes + param blend
  const tgt = {}; let wsum = 0; for (const k in DEF) tgt[k] = 0;
  if (playing) for (const s of E.scenes) {
    const f = s.f || .6, k = sm(s.a - f, s.a + f, t) * (1 - sm(s.b - f, s.b + f, t));
    if (k <= .001) { if (s.live) { s.live = false; s.exit && s.exit(); } continue; }
    s.live = true;
    const sp = typeof s.P === 'function' ? s.P(t) : (s.P || {});
    for (const key in DEF) tgt[key] += k * (key in sp ? sp[key] : DEF[key]); wsum += k;
    O.save(); I.save(); s.draw({ k, t: t - s.a, p: clamp((t - s.a) / (s.b - s.a)) }); O.restore(); I.restore();
  } else if (E.gate) { O.save(); I.save(); E.gate(); O.restore(); I.restore(); }
  for (const k in DEF) { const g = wsum > 0 ? tgt[k] / wsum : DEF[k]; P[k] += (g - P[k]) * (1 - Math.exp(-dt * (k === 'freeze' ? 7 : 3.2))); }
  if (playing) for (const f of E.post) { O.save(); I.save(); f(); O.restore(); I.restore(); }

  // sim
  const K = dt * 60, nx = 1 - cur;
  gl.bindTexture(gl.TEXTURE_2D, inkTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, inkc);
  gl.useProgram(simP.p); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[nx]); gl.viewport(0, 0, sw, sh_);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex[cur]); gl.uniform1i(simP.u.uPrev, 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, inkTex); gl.uniform1i(simP.u.uInk, 1);
  gl.uniform2f(simP.u.uRes, sw, sh_); gl.uniform1f(simP.u.uT, T); gl.uniform1f(simP.u.uK, K);
  const U = simP.u; gl.uniform1f(U.uSwirl, P.swirl); gl.uniform1f(U.uTurb, P.turb * (1 + E.A.mid * .8)); gl.uniform1f(U.uShear, P.shear);
  gl.uniform1f(U.uDrain, P.drain); gl.uniform1f(U.uDecay, Math.pow(P.decay, K)); gl.uniform1f(U.uInject, P.inject);
  gl.uniform1f(U.uFreeze, P.freeze); gl.uniform1f(U.uGrav, P.grav); gl.uniform1f(U.uGlitch, P.glitch); gl.uniform1f(U.uZoom, P.zoom + E.pulse * .25 * (P.zoom > .05 ? 1 : 0));
  gl.uniform2f(U.uPtr, ptr.x / W, 1 - ptr.y / H);
  const pv = ptr.auto ? .35 : 1; gl.uniform2f(U.uPtrV, clamp(ptr.vx / H * .012 * pv, -.03, .03), clamp(-ptr.vy / H * .012 * pv, -.03, .03));
  gl.drawArrays(gl.TRIANGLES, 0, 3); cur = nx;
  // show
  gl.useProgram(showP.p); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, glc.width, glc.height);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex[cur]); gl.uniform1i(showP.u.uTex, 0);
  const V = showP.u; gl.uniform2f(V.uRes, glc.width, glc.height); gl.uniform1f(V.uT, T);
  gl.uniform1f(V.uIrid, P.irid); gl.uniform1f(V.uFluoro, P.fluoro); gl.uniform1f(V.uBlush, P.blush); gl.uniform1f(V.uGlitch, P.glitch); gl.uniform1f(V.uDim, P.dim); gl.uniform1f(V.uPulse, E.pulse);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
addEventListener('resize', resize);
resize(); ptr.x = ptr.tx = W / 2; ptr.y = ptr.ty = H / 2;
E.go = () => requestAnimationFrame(frame);
})();

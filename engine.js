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
const ENV = { lo: dec(S.lo), mid: dec(S.mid), hi: dec(S.hi), rms: dec(S.rms), flux: dec(S.flux), bright: dec(S.bright) };
function env(name, t) {
  const a = ENV[name], i = (t - S.t0) * S.fps, k = Math.floor(i);
  if (k < 0 || k >= a.length - 1) return 0; const f = i - k;
  return (a[k] * (1 - f) + a[k + 1] * f) / 255;
}
const BEAT = 60 / S.bpm;
const ST = window.STEMS || null, STENV = {};
if (ST) for (const k in ST.env) STENV[k] = dec(ST.env[k]);
const stem = (k, t) => { const a = STENV[k]; if (!a) return 0; const i = (t - ST.t0) * ST.fps, j = Math.floor(i); if (j < 0 || j >= a.length - 1) return 0; const f = i - j; return (a[j] * (1 - f) + a[j + 1] * f) / 255; };
const hitT = l => l.map(h => h[0]), KICKS = ST ? hitT(ST.kicks) : S.kicks, SNARES = ST ? hitT(ST.snares) : S.snaps, HATS = ST ? hitT(ST.hats) : S.snaps;
// seconds since the most recent event in a sorted list (kicks, snaps)
function since(list, t) { let a = 0, b = list.length - 1, k = -1; while (a <= b) { const m = (a + b) >> 1; if (list[m] <= t) { k = m; a = m + 1; } else b = m - 1; } return k < 0 ? 9 : t - list[k]; }

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
uniform float uSwirl,uTurb,uShear,uDrain,uDecay,uInject,uFreeze,uGrav,uGlitch,uZoom,uFine,uBlock,uThump,uKick,uSnr,uBeatN;
uniform vec2 uPtr, uPtrV;
in vec2 v; out vec4 o;
${NOISE}
void main(){
  float asp=uRes.x/uRes.y; vec2 vv=v;
  if(uBlock>.5){ vec2 g=vec2(asp,1.)*13.; vv=(floor(v*g)+.5)/g; } // block substrate: rigid tiles tear instead of melting
  vec2 p=(vv-.5)*vec2(asp,1.);
  vec2 f=vec2(0.);
  f += (curl(p*1.6+vec2(0.,uT*.04)) + .5*curl(p*4.1-vec2(uT*.07,0.)))*.0016*uTurb;
  f += curl(p*11.+vec2(uT*.3,-uT*.2))*.0007*uFine;
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
  f+=p*uKick*.02*uThump; f.x+=uSnr*.012*uThump*sign(sin(p.y*18.+uBeatN*3.1416));
  if(uBlock>.5) f*=2.6;
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
uniform float uIrid,uFluoro,uBlush,uGlitch,uDim,uPulse,uSnap,uHat,uBright,uField,uKAge,uBass,uKeys,uTick;
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
  float sp=.0035*uGlitch+.0022*uSnap;
  vec4 s=texture(uTex,uv+vec2(off,0.));
  vec3 c=vec3(texture(uTex,uv+vec2(off+sp,0.)).r, s.g, texture(uTex,uv+vec2(off-sp,0.)).b);
  vec2 e=vec2(2.5)/uRes;
  float l=L(c);
  float gx=L(texture(uTex,uv+vec2(e.x,0.)).rgb)-L(texture(uTex,uv-vec2(e.x,0.)).rgb);
  float gy=L(texture(uTex,uv+vec2(0.,e.y)).rgb)-L(texture(uTex,uv-vec2(0.,e.y)).rgb);
  vec3 film=.5+.5*cos(6.2832*(l*1.3+(gx+gy)*3.+vn(p*2.2+uT*.06)*1.2+uT*.02+uBright*.35+vec3(0.,.33,.67)));
  c=mix(c, c*film*1.9+film*l*.25, uIrid);
  c+=vec3(.9,.95,1.)*length(vec2(gx,gy))*.6*uIrid;
  vec3 bg=mix(vec3(.018,.018,.032),vec3(.045,.03,.07),v.y+.2*vn(p*1.5+uT*.03));
  float flick=(1.-.35*step(.93,h1(vec2(floor(uT*24.),7.))))*(.94+.06*sin(uT*377.));
  float tube=smoothstep(.012,.0,abs(v.y-.965))*step(.04,fract(v.x*3.+.02))*1.6;
  vec3 fl=vec3(.72,.95,.88)*(exp(-(1.-v.y)*3.2)*.30+tube)*flick*uFluoro;
  if(uField>.01){ float cs=.05; vec2 g=p/cs, id=floor(g), f=fract(g)-.5; float r=length((id+.5)*cs);
    float wave=exp(-abs(r-uKAge*1.5)*7.)*exp(-uKAge*2.2);
    float rad=.08+.32*wave+.12*uBass+.09*uTick*step(.5,fract((id.x+id.y)*.5));
    float d=smoothstep(rad,rad-.07,length(f));
    vec3 dc=.5+.5*cos(6.2832*(r*.6-uT*.05+uKeys*.35+vec3(0.,.33,.67)));
    bg+=d*dc*(.09+.55*wave+.14*uBass)*uField; }
  c=bg*(1.-uDim)+c+fl;
  c=mix(c, c*vec3(1.35,.42,.55)+vec3(.28,.0,.06)*(.35+l), uBlush);
  float ice=s.a;
  if(ice>.003){ vec3 vr=vor(p*22.); float facet=.25+.75*vr.x; float edge=smoothstep(.0,.06,vr.y);
    vec3 ic=vec3(.55,.82,1.)*(.18+.5*facet)+vec3(1.)*(1.-edge)*.5+c*.55;
    c=mix(c, ic, smoothstep(0.,.5,ice)*.82); }
  c+=uPulse*vec3(.03,.025,.045);
  c+=uSnap*vec3(.05,.06,.07)*smoothstep(.5,.0,abs(fract(v.y*3.-uT*.7)-.5))*(.4+l);
  c*=1.+uSnap*.12;
  c*=1.-.55*dot(p,p)*.9;
  c+=(h1(v*uRes+fract(uT)*17.)-.5)*(.03+.07*uHat);
  o=vec4(pow(max(c,0.),vec3(.92)),1.);
}`;

function sh(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
function prog(fs, vs = VS) { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'a'); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const nm = gl.getActiveUniform(p, i).name; u[nm] = gl.getUniformLocation(p, nm); }
  return { p, u }; }
const simP = prog(SIM), showP = prog(SHOW);
const COPY = `#version 300 es
precision highp float; uniform sampler2D uTex; uniform vec2 uOff; uniform float uA; in vec2 v; out vec4 o;
void main(){ o=texture(uTex,v+uOff)*uA; }`;
// the lens: the finished picture (fluid + grains + type) seen through switchable aesthetic registers
const LENS = `#version 300 es
precision highp float;
uniform sampler2D uC,uAtlas; uniform vec2 uRes; uniform float uT,uDpr,uBass,uRing,uRingA;
uniform float mCrt,mAscii,mFry,mTherm,mHalf,mLcd,mKal,mPix,mVap,mInv,mEdge,mXer,mVhs;
in vec2 v; out vec4 o;
${NOISE}
float L(vec3 c){ return dot(c,vec3(.3,.59,.11)); }
vec3 S(vec2 uv){ return texture(uC,clamp(uv,0.,1.)).rgb; }
void main(){
  float asp=uRes.x/uRes.y; vec2 p=(v-.5)*vec2(asp,1.);
  p*=1.-uBass*.014;
  if(mKal>.5){ float a=atan(p.y,p.x), r=length(p), seg=6.2832/6.; a=mod(a+uT*.05,seg); a=abs(a-seg*.5); p=r*vec2(cos(a),sin(a)); }
  if(mCrt>.01) p*=1.+mCrt*.09*dot(p,p);
  vec2 uv=p/vec2(asp,1.)+.5;
  if(mVhs>.01){ uv.x+=mVhs*((h1(vec2(floor(v.y*220.),floor(uT*30.)))-.5)*.004+smoothstep(.035,0.,abs(fract(v.y-uT*.23)-.5))*.035); }
  if(mPix>.01){ float n=mix(uRes.y/uDpr,40.,pow(mPix,.3)); vec2 g=vec2(n*asp,n); uv=(floor(uv*g)+.5)/g; }
  vec3 c=S(uv);
  if(mAscii>.01){ vec2 cs=vec2(9.,16.)*uDpr, fc=uv*uRes, cell=floor(fc/cs); vec3 cc=S((cell+.5)*cs/uRes); float l=clamp(L(cc)*1.6,0.,.999);
    vec2 f=fract(fc/cs); float a=texture(uAtlas,vec2((floor(l*16.)+f.x)/16.,f.y)).r;
    c=mix(c, a*mix(normalize(cc+.03)*1.7,vec3(.45,1.,.7),.3)*(.4+l), mAscii); }
  if(mLcd>.01){ vec2 g=uRes/(4.*uDpr); float l=L(S((floor(uv*g)+.5)/g)); float sh=floor(clamp(l*1.7,0.,.999)*4.)/3.;
    vec2 f=fract(uv*g); c=mix(c, mix(vec3(.05,.09,.04),vec3(.78,.9,.6),sh)*(.72+.28*step(.14,f.x)*step(.14,f.y)), mLcd); }
  if(mHalf>.01){ float an=.6; mat2 R=mat2(cos(an),-sin(an),sin(an),cos(an)); float n=uRes.y/(7.*uDpr); vec2 q=R*p*n;
    vec3 cc=S((transpose(R)*(floor(q)+.5)/n)/vec2(asp,1.)+.5); float d=length(fract(q)-.5);
    float dt=smoothstep(.06,-.06,d-sqrt(clamp(L(cc)*1.3,0.,1.))*.66); c=mix(c, dt*mix(vec3(.97,.93,.84),cc*1.5,.35), mHalf); }
  if(mTherm>.01){ float l=clamp(L(c)*1.35,0.,1.);
    vec3 t=l<.25?mix(vec3(0.,0.,.12),vec3(.36,0.,.6),l*4.):l<.5?mix(vec3(.36,0.,.6),vec3(.95,.15,.2),(l-.25)*4.):l<.75?mix(vec3(.95,.15,.2),vec3(1.,.75,.1),(l-.5)*4.):mix(vec3(1.,.75,.1),vec3(1.),(l-.75)*4.);
    c=mix(c,t,mTherm); }
  if(mVap>.01){ float l=L(c); vec3 t=mix(vec3(.1,.02,.28),mix(vec3(1.,.3,.75),vec3(.3,1.,.95),smoothstep(.2,.8,l)),smoothstep(0.,.45,l));
    t=floor(t*6.+.5)/6.; t*=.9+.1*step(.5,fract(v.y*uRes.y/(3.*uDpr))); c=mix(c,t,mVap); }
  if(mFry>.01){ vec2 e=2./uRes; vec3 b=(S(uv+vec2(e.x,0.))+S(uv-vec2(e.x,0.))+S(uv+vec2(0.,e.y))+S(uv-vec2(0.,e.y)))*.25;
    vec3 f=c+(c-b)*4.; float l=L(f); f=mix(vec3(l),f,3.2); f=(f-.33)*1.9+.45; f*=vec3(1.25,.95,.55); f+=vec3(.28,.06,0.)*smoothstep(.55,1.,l);
    f+=(h1(floor(v*uRes/(8.*uDpr))+floor(uT*12.))-.5)*.14; f=floor(f*7.+.5)/7.; c=mix(c,clamp(f,0.,1.),mFry); }
  if(mCrt>.01){ float sl=.78+.22*sin(v.y*uRes.y/uDpr*3.14159); float m=mod(floor(gl_FragCoord.x/uDpr),3.);
    vec3 g=c*sl*vec3(m==0.?1.15:.9,m==1.?1.15:.9,m==2.?1.15:.9); g=mix(g,vec3(L(g))*vec3(.35,1.,.55)*1.3,.5);
    g*=(1.-.45*dot(p,p))*(.94+.06*sin(uT*110.)); g*=1.-step(1.,max(abs(uv.x-.5),abs(uv.y-.5))*2.); c=mix(c,g,mCrt); }
  if(mEdge>.01){ vec2 e=1.6/uRes; float gx=L(S(uv+vec2(e.x,0.)))-L(S(uv-vec2(e.x,0.))), gy=L(S(uv+vec2(0.,e.y)))-L(S(uv-vec2(0.,e.y)));
    float ed=clamp(length(vec2(gx,gy))*7.,0.,1.); c=mix(c, ed*(.55+.45*cos(6.2832*(uT*.12+uv.y*.8+vec3(0.,.33,.67))))*1.7+vec3(0.,.015,.05), mEdge); }
  if(mXer>.01){ float l=L(c)+(h1(floor(v*uRes/(2.*uDpr)))-.5)*.22; float k=step(.3,l); float sat=max(c.r,max(c.g,c.b))-min(c.r,min(c.g,c.b));
    vec3 x=mix(vec3(.93,.91,.85),vec3(.07,.06,.09),k); if(k>.5&&sat>.42&&c.r>c.g) x=vec3(.86,.12,.18); c=mix(c,x,mXer); }
  if(mVhs>.01){ vec3 q=vec3(S(uv+vec2(.0045,0.)).r,c.g,S(uv-vec2(.0045,0.)).b); float l=L(q); q=mix(vec3(l),q,.75)*.92+.05;
    q+=(h1(v*uRes+fract(uT)*9.)-.5)*.09; q*=.93+.07*sin(v.y*uRes.y/uDpr*1.6); c=mix(c,q,mVhs); }
  { float rr=length((v-.5)*vec2(asp,1.)); c=mix(c,1.-c,clamp(smoothstep(.06,0.,abs(rr-uRing*1.7))*exp(-uRing*2.6)*uRingA,0.,1.)); }
  c=mix(c,1.-c,mInv);
  o=vec4(c,1.);
}`;
const copyP = prog(COPY), lensP = prog(LENS);
const LOOKS = ['crt', 'ascii', 'fry', 'therm', 'half', 'lcd', 'kal', 'pix', 'vap', 'inv', 'edge', 'xerox', 'vhs'], look = {}; LOOKS.forEach(k => look[k] = 0);
let compTex = null, compFbo = null, ovTex = null, atlasTex = null;
{ // glyph ramp for the ASCII look, light to dense
  const ac = document.createElement('canvas'); ac.width = 16 * 18; ac.height = 32; const ax = ac.getContext('2d'); ax.fillStyle = '#fff'; ax.font = 'bold 26px Menlo,Consolas,monospace'; ax.textAlign = 'center'; ax.textBaseline = 'middle';
  [...' .·:;~=+/}{*x#%@'].forEach((ch, i) => ax.fillText(ch, i * 18 + 9, 17));
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); atlasTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, atlasTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ac);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); }

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
  if (compTex) { gl.deleteTexture(compTex); gl.deleteFramebuffer(compFbo); gl.deleteTexture(ovTex); }
  compTex = mkTex(ovc.width, ovc.height, false); ovTex = mkTex(ovc.width, ovc.height, false);
  compFbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, compFbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, compTex, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  E.W = W; E.H = H; E.u = Math.min(W, H) / 100; E.fw = Math.min(W, H * 1.75);
  if (E.onresize) E.onresize();
}

// ---------- grains: ~150k GPU particles. Every lyric word (and some big shapes) is a set of targets with an
// arrival time; grains leave wherever they are so that they LAND on the word's onset, hold while it is sung,
// then burst back into the same flow field as the fluid. Matter is conserved: old lines become new ones.
const G = (() => {
  const off = { ok: false, once() {}, word() {}, shape() {}, releaseAll() {}, step() {}, draw() {}, rewind() {} };
  if (!gl.getExtension('EXT_color_buffer_float') || qs.has('nograins')) return off;
  const N = Math.min(screen.width, screen.height) < 700 ? 256 : 384, NN = N * N;
  const FLOW = `
uniform float uT,uW,uK,uDt,uAsp,uSwirl,uTurb,uShear,uDrain,uGrav,uZoom,uFine,uFreeze,uKick,uSnap,uSurge;
uniform vec2 uPtrP,uPtrV;
vec2 flow(vec2 p){
  vec2 f=(curl(p*1.6+vec2(0.,uW*.04))+.5*curl(p*4.1-vec2(uW*.07,0.)))*.0016*uTurb;
  f+=curl(p*11.+vec2(uW*.3,-uW*.2))*.0007*uFine;
  float r=length(p);
  f+=vec2(-p.y,p.x)*uSwirl*.011/(.18+r); f-=p*uDrain*.007/(.25+r); f+=p*uZoom*.006;
  f.x+=uShear*.0045*(.65+.35*sin(p.y*7.+uW*1.3)); f.y-=uGrav*.0028;
  vec2 d=p-uPtrP; f+=uPtrV*exp(-dot(d,d)*26.);
  return f*1.9; }`;
  const UPD = `#version 300 es
precision highp float; precision highp sampler2D;
uniform sampler2D uState,uTgt; in vec2 v; out vec4 o;
${NOISE}${FLOW}
void main(){
  ivec2 ij=ivec2(gl_FragCoord.xy); vec4 s=texelFetch(uState,ij,0), g=texelFetch(uTgt,ij,0);
  vec2 p=s.xy; float heat=s.z, seed=s.w, tau=g.z-uT, travel=.5+.4*seed;
  if(g.w>uT && tau<travel){
    if(tau>0.){ float a=min(1.,uDt/tau); vec2 d=g.xy-p;
      p+=d*a+vec2(-d.y,d.x)*a*sin(seed*40.)*.7*smoothstep(0.,.3,tau); heat=0.; }
    else { float tk=floor(uW*30.); vec2 j=vec2(h1(vec2(seed*91.,tk)),h1(vec2(seed*17.,tk+3.)))-.5;
      float amp=.0012+.007*uKick+.035*uSnap*step(.94,h1(vec2(seed*7.,floor(uW*8.))));
      vec2 dp=g.xy-uPtrP; vec2 push=normalize(dp+1e-5)*exp(-dot(dp,dp)*260.)*.035;
      p=mix(p,g.xy+j*amp+push,1.-exp(-uDt*22.)); heat=1.; }
  } else {
    vec2 f=flow(p);
    f+=(vec2(h1(vec2(seed,1.)),h1(vec2(seed,2.)))-.5)*heat*.022;
    f+=normalize(p+1e-4)*uSurge*.012*(.3+seed);
    p+=f*uK*(1.-uFreeze)*(.55+.9*seed);
    heat*=exp(-uDt*2.4);
    float hx=uAsp*.5+.03;
    if(uDrain>.3 && length(p)<.022){ float a=seed*6.283+uW; p=vec2(cos(a),sin(a))*(.75+.35*h1(vec2(seed,floor(uW*60.)))); }
    if(uGrav>.3) p.y=max(p.y,-.5+.09*h1(vec2(seed*3.,5.))); else p.y=mod(p.y+.53,1.06)-.53;
    p.x=mod(p.x+hx,2.*hx)-hx;
  }
  o=vec4(p,heat,seed);
}`;
  const PVS = `#version 300 es
precision highp float; precision highp sampler2D;
uniform sampler2D uState,uTgt,uCol; uniform float uT,uW,uAsp,uSize,uFreeze,uGlitch,uHat,uGain; uniform int uN;
out vec4 vc;
${NOISE}
void main(){
  ivec2 ij=ivec2(gl_VertexID%uN,gl_VertexID/uN); vec4 s=texelFetch(uState,ij,0), g=texelFetch(uTgt,ij,0), c=texelFetch(uCol,ij,0);
  vec2 p=s.xy;
  if(uFreeze>.01) p=mix(p,floor(p*64.+.5)/64.+vec2(mod(floor(p.y*64.+.5),2.)*.0078,0.),uFreeze);
  if(uGlitch>.01){ float row=floor((p.y+.5)*26.); if(h1(vec2(row,floor(uW*9.)))>1.-uGlitch*.22) p.x+=(h1(vec2(row,3.))-.5)*.08; }
  float tau=g.z-uT, live=step(uT,g.w), held=live*step(tau,0.), appr=live*step(0.,tau)*step(tau,.9);
  float tw=.6+.4*sin(uW*3.+s.w*50.);
  float a=held>.5?.8:appr>.5?.55:(.085+.16*uHat*step(.75,s.w))*tw;
  vec3 col=mix(c.rgb,vec3(.72,.9,1.),uFreeze*.75)+s.z*.35*(1.-held);
  vc=vec4(col*a*uGain,1.);
  gl_Position=vec4(p.x/uAsp*2.,p.y*2.,0.,1.);
  gl_PointSize=uSize*(.75+.6*c.a)*(held>.5?1.2:appr>.5?1.:.8);
}`;
  const PFS = `#version 300 es
precision highp float; in vec4 vc; out vec4 o;
void main(){ float m=smoothstep(.5,.12,length(gl_PointCoord-.5)); o=vec4(vc.rgb*m,0.); }`;
  const up = prog(UPD), pp = prog(PFS, PVS), vao = gl.createVertexArray();
  const raw = () => { gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); };
  const cooked = () => { gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); };
  const ftex = data => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, N, N, 0, gl.RGBA, gl.FLOAT, data);
    for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
  raw();
  const init = new Float32Array(NN * 4); for (let i = 0; i < NN; i++) { init[i * 4] = (Math.random() - .5) * 2; init[i * 4 + 1] = Math.random() - .5; init[i * 4 + 3] = Math.random(); }
  const st = [ftex(init), ftex(init)], sf = st.map(t => { const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); return f; });
  const tgt = new Float32Array(NN * 4).fill(-1), col = new Uint8Array(NN * 4); for (let i = 0; i < NN; i++) { const q = i * 4, h = Math.random(); col[q] = 150 + 90 * h; col[q + 1] = 150 + 80 * Math.random(); col[q + 2] = 190 + 60 * Math.random(); col[q + 3] = Math.random() * 255; }
  const tt = ftex(tgt), ct = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, ct); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, col);
  for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.NEAREST);
  cooked(); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  let gc = 0, gp = 0, dirty = false; const seen = new Set();
  const rc = document.createElement('canvas'), rx = rc.getContext('2d', { willReadFrequently: true });
  const rgbOf = c => { const m = /^#([0-9a-f]{6})$/i.exec(c || ''); if (!m) return [243, 239, 230]; const v = parseInt(m[1], 16); return [v >> 16, (v >> 8) & 255, v & 255]; };
  function put(x, y, arr, rel, rgb) { const q = gp * 4; gp = (gp + 1) % NN; tgt[q] = (x - W / 2) / H; tgt[q + 1] = (H / 2 - y) / H; tgt[q + 2] = arr; tgt[q + 3] = rel;
    const j = .78 + .3 * Math.random(); col[q] = Math.min(255, rgb[0] * j); col[q + 1] = Math.min(255, rgb[1] * j); col[q + 2] = Math.min(255, rgb[2] * j); col[q + 3] = Math.random() * 255; dirty = true; }
  let litD = null;
  function lit(w, h) { const d = litD = rx.getImageData(0, 0, w, h).data, out = []; for (let i = 3, k = 0; i < d.length; i += 4, k++) if (d[i] > 90) out.push(k); return out; }
  return {
    ok: true, N,
    once(key, fn) { if (seen.has(key)) return; seen.add(key); fn(); },
    rewind() { seen.clear(); },
    // one word: grains sweep in left-to-right so the word "writes itself" across its sung slot
    word(text, size, fam, style, x, y, a, b, rel, color, dens = 1) {
      font(rx, size, fam, style); const tw = Math.ceil(rx.measureText(text).width) + 8, th = Math.ceil(size * 1.7);
      if (tw < 9 || tw > 4000) return; rc.width = tw; rc.height = th; font(rx, size, fam, style); rx.fillStyle = '#fff'; rx.fillText(text, 4, th / 2);
      const L = lit(tw, th); if (!L.length) return; const n = Math.round(clamp(L.length * .5, 90, 5200) * dens), rgb = rgbOf(color), sweep = Math.min(.24, (b - a) * .6);
      for (let k = 0; k < n; k++) { const px = L[(Math.random() * L.length) | 0], lx = px % tw + Math.random(), ly = ((px / tw) | 0) + Math.random();
        put(x + lx - 4, y + ly - th / 2, a + sweep * lx / tw, rel, rgb); }
    },
    // any drawing (in CSS px, white): n grains land on it at `arr`, leave at `rel`
    shape(draw, n, arr, rel, color) {
      const sc = Math.min(1, 720 / W), w = Math.ceil(W * sc), h = Math.ceil(H * sc); if (w < 4 || h < 4) return; rc.width = w; rc.height = h; rx.setTransform(sc, 0, 0, sc, 0, 0); rx.fillStyle = rx.strokeStyle = '#fff'; draw(rx); rx.setTransform(1, 0, 0, 1, 0, 0);
      const L = lit(w, h); if (!L.length) return; const rgb = rgbOf(color); n = Math.min(n, NN);
      for (let k = 0; k < n; k++) { const px = L[(Math.random() * L.length) | 0]; put((px % w + Math.random()) / sc, (((px / w) | 0) + Math.random()) / sc, typeof arr === 'function' ? arr(Math.random()) : arr, rel, color === null ? [litD[px * 4], litD[px * 4 + 1], litD[px * 4 + 2]] : rgb); }
    },
    releaseAll(at) { for (let q = 3; q < NN * 4; q += 4) if (tgt[q] > at) tgt[q] = at; dirty = true; seen.clear(); },
    step(T, t, dt) {
      if (dirty) { raw(); gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, tt); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, N, gl.RGBA, gl.FLOAT, tgt);
        gl.bindTexture(gl.TEXTURE_2D, ct); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, N, gl.RGBA, gl.UNSIGNED_BYTE, col); cooked(); dirty = false; }
      const U = up.u, nx = 1 - gc; gl.useProgram(up.p); gl.bindFramebuffer(gl.FRAMEBUFFER, sf[nx]); gl.viewport(0, 0, N, N);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, st[gc]); gl.uniform1i(U.uState, 2); gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, tt); gl.uniform1i(U.uTgt, 3);
      gl.uniform1f(U.uT, t); gl.uniform1f(U.uW, T); gl.uniform1f(U.uK, dt * 60); gl.uniform1f(U.uDt, dt); gl.uniform1f(U.uAsp, W / H);
      gl.uniform1f(U.uSwirl, P.swirl); gl.uniform1f(U.uTurb, P.turb * (1 + E.A.mid * .8) * (1 - .5 * E.hush)); gl.uniform1f(U.uShear, P.shear); gl.uniform1f(U.uDrain, P.drain);
      gl.uniform1f(U.uGrav, P.grav); gl.uniform1f(U.uZoom, P.zoom); gl.uniform1f(U.uFine, .3 + 2.2 * E.A.hi + 1.5 * E.snap); gl.uniform1f(U.uFreeze, clamp(P.freeze));
      gl.uniform1f(U.uKick, E.kick); gl.uniform1f(U.uSnap, E.snap); gl.uniform1f(U.uSurge, E.surge);
      gl.uniform2f(U.uPtrP, (ptr.x / W - .5) * W / H, .5 - ptr.y / H); const pv = ptr.auto ? .35 : 1; gl.uniform2f(U.uPtrV, clamp(ptr.vx / H * .012 * pv, -.03, .03), clamp(-ptr.vy / H * .012 * pv, -.03, .03));
      gl.drawArrays(gl.TRIANGLES, 0, 3); gc = nx; this.t = t; this.T = T;
    },
    draw(fb, w, h, size, gain) {
      const U = pp.u; gl.useProgram(pp.p); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(0, 0, w, h); gl.bindVertexArray(vao);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.colorMask(true, true, true, false);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, st[gc]); gl.uniform1i(U.uState, 2); gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, tt); gl.uniform1i(U.uTgt, 3);
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, ct); gl.uniform1i(U.uCol, 4);
      gl.uniform1f(U.uT, this.t); gl.uniform1f(U.uW, this.T); gl.uniform1f(U.uAsp, W / H); gl.uniform1f(U.uSize, size); gl.uniform1f(U.uGain, gain); gl.uniform1i(U.uN, N);
      gl.uniform1f(U.uFreeze, clamp(P.freeze)); gl.uniform1f(U.uGlitch, P.glitch); gl.uniform1f(U.uHat, E.A.hi);
      gl.drawArrays(gl.POINTS, 0, NN);
      gl.disable(gl.BLEND); gl.colorMask(true, true, true, true); gl.bindVertexArray(null); gl.activeTexture(gl.TEXTURE0);
    },
  };
})();

// ---------- params
const DEF = { swirl: 0, turb: 1, shear: 0, drain: 0, decay: .972, inject: 1, irid: .35, fluoro: 0, blush: 0, glitch: 0, freeze: 0, grav: 0, zoom: 0, dim: 0, block: 0, thump: .6, field: .8, ring: .5 };
const P = { ...DEF };

// ---------- lyric timing helpers
// Suno gives line starts only. Words inside a line are estimated: syllable counts, pauses after punctuation,
// the sung part ending before the line slot does, and onsets snapped to the 16th-note grid.
// window.SONG_WORDS (from words.js, made with ?tap or from a vocal stem) overrides the estimate per cue.
const wcache = [], LEAD = .05, FILL = .86, SIXT = BEAT / 4;
const syl = w => { let n = 0; for (const part of w.toLowerCase().replace(/[^a-z-]/g, '').split('-')) { if (!part) continue; const m = part.replace(/e$/, '').match(/[aeiouy]+/g); n += Math.max(1, m ? m.length : 1); } return Math.max(1, n); };
function wordsOf(i) {
  if (wcache[i]) return wcache[i];
  const c = cues[i], ws = c.text.split(' '), given = window.SONG_WORDS && window.SONG_WORDS[i];
  let out;
  if (given && given.length === ws.length) {
    out = ws.map((w, k) => ({ w, a: given[k] - LEAD, b: (k + 1 < ws.length ? given[k + 1] : given[k] + .45) - LEAD, i: k }));
  } else {
    const wt = ws.map(w => syl(w) + (/[,:;?!.—”]$/.test(w) ? .7 : 0) + .25), tot = wt.reduce((a, b) => a + b, 0);
    const sung = i >= 2 && i <= 48 && !(i >= 38 && i <= 40), span = (cues[i + 1] ? Math.min(c.b, cues[i + 1].a) : c.b) - c.a;
    const dur = Math.min(span * FILL, tot * .29 + .3);
    let acc = 0, prev = -1; out = ws.map((w, k) => { let a = c.a + dur * acc / tot; acc += wt[k];
      if (sung && k) a = Math.max(prev + SIXT, Math.round((a - S.beat0) / SIXT) * SIXT + S.beat0); prev = a; return { w, a: a - LEAD, i: k }; });
    out.forEach((w, k) => { w.b = k + 1 < out.length ? out[k + 1].a : Math.max(w.a + .2, c.a + dur - LEAD); });
  }
  out.end = out[out.length - 1].b; return wcache[i] = out;
}
const wordT = (i, re) => { const w = wordsOf(i).find(w => re.test(w.w)); return w ? w.a : cues[i].a; };
const cprog = (i, t = E.t) => clamp((t - cues[i].a) / (wordsOf(i).end - cues[i].a));
function charsShown(i, t = E.t) { let n = 0; for (const w of wordsOf(i)) { if (t >= w.b) n += w.w.length + 1; else if (t > w.a) { n += Math.min(w.w.length, Math.ceil(w.w.length * (t - w.a) / ((w.b - w.a) * .55))); if (t < w.a + (w.b - w.a) * .55) break; n++; break; } else break; } return n; }
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
let started = false, ended = false, clock = 0, slow = 0, lastT = 0, hidden = null;
const fake = qs.has('fake'), hold = qs.has('hold'), t0 = +qs.get('t') || 0;
const teaser = new Audio('listen.m4a'); teaser.volume = .6; teaser.preservesPitch = false; let teaseN = 0;
function tease() { if (started || fake) return; teaser.currentTime = 0; teaser.playbackRate = [1, .8, 1.15, .92][teaseN++ % 4];
  teaser.play().then(() => { E.teased = performance.now() / 1000; }).catch(() => {}); setTimeout(tease, 3800 + 1700 * (teaseN % 3)); }
setTimeout(tease, 700);
function start() {
  if (started && !ended) return;
  clock = ended ? 0 : t0; started = true; ended = false; G.releaseAll(clock + .25); teaser.pause();
  if (!fake && !qs.has('nofs') && document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
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
  A: { lo: 0, mid: 0, hi: 0, rms: 0, flux: 0, bright: 0 }, beat: 0, beatN: 0, pulse: 0, kick: 0, snap: 0, hat: 0, hush: 0, surge: 0, BEAT, KICKS, SNARES, HATS, since, look, LOOKS, lookFn: null, stemAt: stem,
  stem: { vox: 0, bv: 0, drums: 0, bass: 0, keys: 0, synth: 0 },
  clamp, lerp, sm, hash, TAU, env, wordsOf, wordT, cprog, charsShown, cueAt, flow, font,
  scenes: [], post: [], gate: null, onresize: null, G,
  both(fn) { fn(O, false); fn(I, true); },
};

function frame(ms, manual) {
  if (manual !== true) requestAnimationFrame(frame);
  const T = ms / 1000, dt = Math.min(.05, Math.max(.001, T - E.T)); E.T = T; E.dt = dt;
  if (fake) { if (!started) start(); if (!hold) clock += dt; if (clock >= S.dur) ended = true; }
  else if (started && !audio.paused) { clock += dt * audio.playbackRate; const d = audio.currentTime - clock; clock = Math.abs(d) > .08 ? audio.currentTime : clock + d * .1; }
  else if (started) clock = audio.currentTime;
  const t = E.t = started ? clock : 0; E.started = started; E.ended = ended;
  const playing = started && !ended;

  for (const k in E.A) E.A[k] = playing ? env(k, t) : 0;
  const bp = (t - S.beat0) / BEAT; E.beatN = Math.floor(bp); E.beat = bp - E.beatN;
  // real drum hits (not just the grid): kick drives the pulse, snaps flash, hats grain; hush/surge follow the dynamics
  E.kick = playing ? Math.exp(-since(KICKS, t) * 7) : 0; E.snap = playing ? Math.exp(-since(SNARES, t) * 11) : 0; E.hat = playing ? Math.exp(-since(HATS, t) * 16) : 0;
  for (const k in E.stem) E.stem[k] = playing ? stem(k, t) : 0;
  E.pulse = playing ? Math.max(E.kick * (.4 + .6 * E.A.lo), Math.exp(-E.beat * 4.5) * .3 * E.A.lo) : 0;
  slow += (E.A.rms - slow) * (1 - Math.exp(-dt * .9)); E.hush = playing ? clamp(1 - slow * 2.6) : 0;
  E.surge = Math.max(E.surge * Math.exp(-dt * 2.2), playing ? clamp((E.A.rms - slow - .22) * 3) : 0);

  // pointer
  ptr.auto = T - ptr.last > 2.5;
  if (ptr.auto !== hidden) { hidden = ptr.auto; document.body.style.cursor = hidden ? 'none' : 'crosshair'; }
  if (ptr.auto && E.lead) { ptr.tx = E.lead.x; ptr.ty = E.lead.y; }
  else if (ptr.auto) { ptr.tx = W / 2 + W * .3 * Math.sin(T * .37) + W * .09 * Math.sin(T * 1.13); ptr.ty = H / 2 + H * .28 * Math.sin(T * .29 + 1) + H * .08 * Math.cos(T * .91); }
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
  const U = simP.u; gl.uniform1f(U.uSwirl, P.swirl); gl.uniform1f(U.uTurb, P.turb * (1 + E.A.mid * .8) * (1 - .5 * E.hush)); gl.uniform1f(U.uFine, (.3 + 1.4 * E.hat + 2.5 * E.stem.synth + 1.2 * E.snap) * (1 - .6 * P.freeze)); gl.uniform1f(U.uShear, P.shear);
  gl.uniform1f(U.uDrain, P.drain); gl.uniform1f(U.uDecay, Math.pow(P.decay, K)); gl.uniform1f(U.uInject, P.inject);
  gl.uniform1f(U.uFreeze, P.freeze); gl.uniform1f(U.uGrav, P.grav); gl.uniform1f(U.uGlitch, P.glitch); gl.uniform1f(U.uBlock, P.block); gl.uniform1f(U.uThump, P.thump); gl.uniform1f(U.uKick, Math.pow(E.kick, 3)); gl.uniform1f(U.uSnr, Math.pow(E.snap, 3)); gl.uniform1f(U.uBeatN, E.beatN); gl.uniform1f(U.uZoom, P.zoom + E.pulse * .25 * (P.zoom > .05 ? 1 : 0) + E.surge * .7);
  gl.uniform2f(U.uPtr, ptr.x / W, 1 - ptr.y / H);
  const pv = ptr.auto ? .35 : 1; gl.uniform2f(U.uPtrV, clamp(ptr.vx / H * .012 * pv, -.03, .03), clamp(-ptr.vy / H * .012 * pv, -.03, .03));
  gl.drawArrays(gl.TRIANGLES, 0, 3); cur = nx;
  if (G.ok) { if (t < lastT - .5) G.rewind(); lastT = t; G.step(T, t, dt); G.draw(fbo[cur], sw, sh_, 1.6, .045 * P.inject); }
  // show
  gl.useProgram(showP.p); gl.bindFramebuffer(gl.FRAMEBUFFER, compFbo); gl.viewport(0, 0, glc.width, glc.height);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex[cur]); gl.uniform1i(showP.u.uTex, 0);
  const V = showP.u; gl.uniform2f(V.uRes, glc.width, glc.height); gl.uniform1f(V.uT, T);
  gl.uniform1f(V.uIrid, P.irid * (.75 + .6 * E.stem.keys)); gl.uniform1f(V.uFluoro, P.fluoro); gl.uniform1f(V.uBlush, P.blush); gl.uniform1f(V.uGlitch, P.glitch); gl.uniform1f(V.uDim, P.dim); gl.uniform1f(V.uPulse, E.pulse); gl.uniform1f(V.uSnap, E.snap * (.35 + .65 * E.A.hi)); gl.uniform1f(V.uHat, E.A.hi); gl.uniform1f(V.uBright, E.A.bright); gl.uniform1f(V.uField, P.field); gl.uniform1f(V.uKAge, playing ? since(KICKS, t) : 9); gl.uniform1f(V.uBass, E.stem.bass); gl.uniform1f(V.uKeys, E.stem.keys); gl.uniform1f(V.uTick, E.hat);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  if (G.ok) G.draw(compFbo, glc.width, glc.height, 1.55 * dpr, 1);
  gl.useProgram(copyP.p); gl.bindFramebuffer(gl.FRAMEBUFFER, compFbo); gl.viewport(0, 0, glc.width, glc.height);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ovTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ovc); gl.uniform1i(copyP.u.uTex, 0);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const bv = E.stem.bv; if (bv > .08) { gl.uniform2f(copyP.u.uOff, -.007 * bv, .005 * bv); gl.uniform1f(copyP.u.uA, .5 * bv); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.uniform2f(copyP.u.uOff, .012 * bv, -.008 * bv); gl.uniform1f(copyP.u.uA, .28 * bv); gl.drawArrays(gl.TRIANGLES, 0, 3); }
  gl.uniform2f(copyP.u.uOff, 0, 0); gl.uniform1f(copyP.u.uA, 1); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.disable(gl.BLEND);
  LOOKS.forEach(k => look[k] = 0); if (playing && E.lookFn) E.lookFn(t, look);
  const Q = lensP.u; gl.useProgram(lensP.p); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, compTex); gl.uniform1i(Q.uC, 0); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, atlasTex); gl.uniform1i(Q.uAtlas, 1); gl.activeTexture(gl.TEXTURE0);
  gl.uniform2f(Q.uRes, glc.width, glc.height); gl.uniform1f(Q.uT, T); gl.uniform1f(Q.uDpr, dpr); gl.uniform1f(Q.uBass, E.stem.bass); gl.uniform1f(Q.uRing, playing ? since(KICKS, t) : 9); gl.uniform1f(Q.uRingA, P.ring);
  gl.uniform1f(Q.mCrt, look.crt); gl.uniform1f(Q.mAscii, look.ascii); gl.uniform1f(Q.mFry, look.fry); gl.uniform1f(Q.mTherm, look.therm); gl.uniform1f(Q.mHalf, look.half);
  gl.uniform1f(Q.mLcd, look.lcd); gl.uniform1f(Q.mKal, look.kal); gl.uniform1f(Q.mPix, look.pix); gl.uniform1f(Q.mVap, look.vap); gl.uniform1f(Q.mInv, look.inv); gl.uniform1f(Q.mEdge, look.edge); gl.uniform1f(Q.mXer, look.xerox); gl.uniform1f(Q.mVhs, look.vhs);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
// ?debug shows time / cue number.  ?tap is a timing tool: play, press J (or any letter) on every sung word,
// press S to save words.js next to index.html; those timings then replace the estimates.
const dbg = qs.has('debug') || qs.has('tap'), tapMode = qs.has('tap');
if (dbg) {
  const hud = document.createElement('div'); hud.style.cssText = 'position:fixed;left:0;right:0;top:0;padding:8px 12px;font:13px/1.5 Menlo,monospace;color:#cfe;background:rgba(0,0,0,.72);z-index:9;white-space:pre-wrap;pointer-events:none';
  document.body.appendChild(hud);
  const flat = []; cues.forEach((c, i) => c.text.split(' ').forEach((w, k) => flat.push({ i, k, w, t: null }))); let tp = 0;
  E.post.push(() => { const i = cueAt(E.t); let s = `${E.t.toFixed(2)}s  cue ${i}  beat ${E.beatN}`;
    if (tapMode) { while (tp < flat.length && flat[tp].t === null && cues[flat[tp].i + 1] && cues[flat[tp].i + 1].a < E.t - .3) tp++;
      const cur = flat[tp]; s += `   tapped ${flat.filter(f => f.t !== null).length}/${flat.length}   [letter] = word   [Backspace] = undo   [S] = save\n`;
      if (cur) s += flat.filter(f => f.i === cur.i).map(f => f === cur ? `[${f.w}]` : f.t !== null ? '·' + f.w : f.w).join(' '); }
    else if (i >= 0) s += '   ' + cues[i].text; hud.textContent = s; });
  if (tapMode) addEventListener('keydown', e => {
    if (!started || e.metaKey || e.ctrlKey) return;
    if (e.key === 'Backspace') { if (tp > 0) flat[--tp].t = null; return; }
    if (e.key === 'S') { const out = cues.map((c, i) => { const f = flat.filter(f => f.i === i); return f.every(f => f.t !== null) ? f.map(f => f.t) : null; });
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['// word onsets per cue, made with ?tap\nwindow.SONG_WORDS=' + JSON.stringify(out) + ';\n'], { type: 'text/javascript' })); a.download = 'words.js'; a.click(); return; }
    if (/^[a-z]$/.test(e.key) && tp < flat.length) flat[tp++].t = +(audio.currentTime - .04).toFixed(3);
  });
}
addEventListener('resize', resize);
resize(); ptr.x = ptr.tx = W / 2; ptr.y = ptr.ty = H / 2;
E.go = () => requestAnimationFrame(frame);
E.run = (sec, fps = 60) => { let ms = E.T * 1000; for (let i = 0; i < sec * fps; i++) frame(ms += 1000 / fps, true); return E.t; }; // debugging: advance synchronously
})();

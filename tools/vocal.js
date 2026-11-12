// Vocal-activity estimate from the stereo mix (no stems):
// centre-panned energy in the voice band, minus what is sustained (pads) and what is broadband (drums).
// usage: node tools/vocal.js stereo.raw data.js [--print]   -> writes vocal.json next to data.js, prints per-cue sparklines
const fs = require('fs'), path = require('path');
const [,, rawPath, dataPath, flag] = process.argv;
const SR = 22050, N = 1024, HOP = 220, FPS = SR / HOP;
const b = fs.readFileSync(rawPath), x = new Float32Array(b.buffer, b.byteOffset, b.length >> 2), len = x.length >> 1;
const window_ = {}; new Function('window', fs.readFileSync(dataPath, 'utf8'))(window_); const SONG = window_.SONG;

function fft(re, im) { const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let l = 2; l <= n; l <<= 1) { const ang = -2 * Math.PI / l, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += l) { let cr = 1, ci = 0; for (let k = 0; k < l / 2; k++) { const a = i + k, c = a + l / 2, tr = re[c] * cr - im[c] * ci, ti = re[c] * ci + im[c] * cr;
      re[c] = re[a] - tr; im[c] = im[a] - ti; re[a] += tr; im[a] += ti; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } } }

const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = .5 - .5 * Math.cos(2 * Math.PI * i / N);
const F = Math.floor((len - N) / HOP), k0 = Math.round(250 / (SR / N)), k1 = Math.round(3800 / (SR / N)), NB = k1 - k0;
const C = new Float32Array(F * NB), lr = new Float32Array(N), li = new Float32Array(N), rr = new Float32Array(N), ri = new Float32Array(N);
for (let f = 0; f < F; f++) {
  for (let i = 0; i < N; i++) { const p = (f * HOP + i) * 2; lr[i] = x[p] * win[i]; rr[i] = x[p + 1] * win[i]; li[i] = ri[i] = 0; }
  fft(lr, li); fft(rr, ri);
  for (let k = k0; k < k1; k++) {
    const pl = lr[k] * lr[k] + li[k] * li[k], pr = rr[k] * rr[k] + ri[k] * ri[k], cross = lr[k] * rr[k] + li[k] * ri[k];
    const sim = Math.max(0, 2 * cross / (pl + pr + 1e-12)), mag = Math.hypot(lr[k] + rr[k], li[k] + ri[k]) / 2;
    C[f * NB + (k - k0)] = Math.log1p(60 * mag * sim * sim);
  }
}
// remove sustained content: per-bin block median (1.5 s), linearly interpolated
const BL = 150, nBl = Math.ceil(F / BL), med = new Float32Array(nBl * NB), tmp = [];
for (let k = 0; k < NB; k++) for (let q = 0; q < nBl; q++) { tmp.length = 0; for (let f = q * BL; f < Math.min(F, (q + 1) * BL); f++) tmp.push(C[f * NB + k]); tmp.sort((a, c) => a - c); med[q * NB + k] = tmp[Math.floor(tmp.length * .3)]; }
const V = new Float32Array(F), row = new Float32Array(NB);
for (let f = 0; f < F; f++) {
  const qf = Math.max(0, Math.min(nBl - 1.001, f / BL - .5)), q = Math.floor(qf), w = qf - q;
  for (let k = 0; k < NB; k++) row[k] = Math.max(0, C[f * NB + k] - (med[q * NB + k] * (1 - w) + med[Math.min(nBl - 1, q + 1) * NB + k] * w));
  const s = Float32Array.from(row).sort(), fm = s[Math.floor(NB * .5)]; // broadband floor (drums)
  let v = 0; for (let k = 0; k < NB; k++) v += Math.max(0, row[k] - fm * 1.2); V[f] = v / NB;
}
// smooth ~40 ms, normalise
const Vs = new Float32Array(F); for (let f = 0; f < F; f++) { let s = 0, n = 0; for (let d = -2; d <= 2; d++) { const g = f + d; if (g >= 0 && g < F) { s += V[g]; n++; } } Vs[f] = s / n; }
const sorted = Float32Array.from(Vs).sort(), hiV = sorted[Math.floor(F * .97)]; for (let f = 0; f < F; f++) Vs[f] = Math.min(1, Vs[f] / hiV);
const T0 = (N / 2) / SR, fr = t => Math.max(0, Math.min(F - 1, Math.round((t - T0) * FPS)));
const out = { fps: FPS, t0: T0, v: Array.from(Vs, v => +v.toFixed(3)) };
fs.writeFileSync(path.join(path.dirname(dataPath), 'vocal.json'), JSON.stringify(out));
if (flag) {
  const chars = ' .:-=+*#%@';
  const line = (a, c) => { let s = ''; for (let t = a; t < c; t += .05) { let m = 0; for (let f = fr(t); f < fr(t + .05); f++) m = Math.max(m, Vs[f]); s += chars[Math.min(9, Math.floor(m * 10))]; } return s; };
  console.log('instrumental 24-38s:', line(24, 38));
  SONG.cues.forEach((c, i) => { const e = SONG.cues[i + 1] ? Math.min(c.b + .001, SONG.cues[i + 1].a) : c.b; console.log(String(i).padStart(2), c.a.toFixed(2).padStart(7), (e - c.a).toFixed(2), '|' + line(c.a, e) + '|', c.text.slice(0, 34)); });
}

// Offline analysis: raw mono f32le @22050 + srt  ->  data.js (window.SONG)
// usage: node tools/analyze.js audio.raw subs.srt data.js [other.raw for offset check]
const fs = require('fs');
const [,, rawPath, srtPath, outPath, otherPath] = process.argv;
const SR = 22050, N = 1024, HOP = 220, FPS = SR / HOP;

function load(p) { const b = fs.readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.length >> 2); }
const x = load(rawPath);
const dur = x.length / SR;

// --- FFT (radix 2, in place)
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
const F = Math.floor((x.length - N) / HOP);
const lo = new Float32Array(F), mid = new Float32Array(F), hi = new Float32Array(F), rms = new Float32Array(F), flux = new Float32Array(F), loflux = new Float32Array(F), hiflux = new Float32Array(F), cen = new Float32Array(F);
const binHz = SR / N, B1 = Math.round(150 / binHz), B2 = Math.round(2000 / binHz), B3 = Math.round(9000 / binHz);
let prev = new Float32Array(N / 2);
const re = new Float32Array(N), im = new Float32Array(N);
for (let f = 0; f < F; f++) {
  let e = 0;
  for (let i = 0; i < N; i++) { const s = x[f * HOP + i]; re[i] = s * win[i]; im[i] = 0; e += s * s; }
  rms[f] = Math.sqrt(e / N);
  fft(re, im);
  let a = 0, b = 0, c = 0, fl = 0, lf = 0, hf = 0, cs = 0, ms = 0;
  for (let k = 1; k < B3; k++) {
    const m = Math.log1p(40 * Math.hypot(re[k], im[k]));
    const d = m - prev[k]; if (d > 0) { fl += d; if (k < B1) lf += d; else if (k >= B2) hf += d; }
    cs += k * m; ms += m;
    prev[k] = m;
    if (k < B1) a += m; else if (k < B2) b += m; else c += m;
  }
  lo[f] = a / B1; mid[f] = b / (B2 - B1); hi[f] = c / (B3 - B2); flux[f] = fl; loflux[f] = lf; hiflux[f] = hf; cen[f] = cs / (ms + 1e-9);
}

function pct(arr, p) { const s = Float32Array.from(arr).sort(); return s[Math.floor(p * (s.length - 1))]; }
function norm(arr) { const a = pct(arr, 0.05), b = pct(arr, 0.985); return arr.map(v => Math.max(0, Math.min(1, (v - a) / (b - a || 1)))); }
const nlo = norm(lo), nmid = norm(mid), nhi = norm(hi), nrms = norm(rms), nflux = norm(flux);

// --- tempo: comb search over bpm & phase using combined onset env
const env = new Float32Array(F);
{ const a = norm(flux), b = norm(loflux); for (let i = 0; i < F; i++) env[i] = a[i] * 0.6 + b[i]; }
function at(i) { const k = Math.floor(i); if (k < 0 || k >= F - 1) return 0; const t = i - k; return env[k] * (1 - t) + env[k + 1] * t; }
let best = { s: -1 };
for (let bpm = 70; bpm <= 180; bpm += 0.05) {
  const per = FPS * 60 / bpm;
  for (let ph = 0; ph < 24; ph++) {
    const p0 = per * ph / 24; let s = 0, n = 0;
    for (let i = p0; i < F; i += per) { s += at(i); n++; }
    s /= n;
    if (s > best.s) best = { s, bpm, p0 };
  }
}
// refine phase finely
{ const per = FPS * 60 / best.bpm; let b = { s: -1 };
  for (let p0 = 0; p0 < per; p0 += 0.1) { let s = 0; for (let i = p0; i < F; i += per) s += at(i); if (s > b.s) b = { s, p0 }; }
  best.p0 = b.p0; }
const beatPeriod = 60 / best.bpm, beat0 = best.p0 / FPS + (N / 2) / SR;

// tempo candidates table (for sanity)
const cands = [];
for (const mult of [0.5, 2 / 3, 1, 1.5, 2]) {
  const bpm = best.bpm * mult, per = FPS * 60 / bpm; let b = -1;
  for (let ph = 0; ph < 48; ph++) { let s = 0, n = 0; for (let i = per * ph / 48; i < F; i += per) { s += at(i); n++; } b = Math.max(b, s / n); }
  cands.push([bpm.toFixed(2), b.toFixed(3)]);
}

// --- onsets (strong peaks)
const onsets = [];
for (let i = 3; i < F - 3; i++) {
  let m = 0; for (let k = -30; k <= 30; k++) m += nflux[Math.min(F - 1, Math.max(0, i + k))]; m /= 61;
  if (nflux[i] > m * 1.6 + 0.12 && nflux[i] >= nflux[i - 1] && nflux[i] > nflux[i + 1] && nflux[i] >= nflux[i - 2] && nflux[i] > nflux[i + 2]) {
    const t = +(i / FPS + (N / 2) / SR).toFixed(3);
    if (!onsets.length || t - onsets[onsets.length - 1] > 0.09) onsets.push(t);
  }
}

// --- kick / snap (snare, clap, strong hat) events from band-limited flux
function peaks(arr, mul, floor, gap) { const n = norm(arr), out = [];
  for (let i = 3; i < F - 3; i++) { let m = 0; for (let k = -40; k <= 40; k++) m += n[Math.min(F - 1, Math.max(0, i + k))]; m /= 81;
    if (n[i] > m * mul + floor && n[i] >= n[i - 1] && n[i] > n[i + 1] && n[i] >= n[i - 2] && n[i] > n[i + 2]) { const t = +(i / FPS + (N / 2) / SR).toFixed(3); if (!out.length || t - out[out.length - 1] > gap) out.push(t); } }
  return out; }
const kicks = peaks(loflux, 1.5, .22, .16), snaps = peaks(hiflux, 1.7, .25, .11), ncen = norm(cen);

// --- downsample envelopes to ~50fps bytes
const OUTFPS = FPS / 2, M = Math.floor(F / 2);
function pack(a) { const u = Buffer.alloc(M); for (let i = 0; i < M; i++) u[i] = Math.round(255 * Math.max(a[2 * i], a[2 * i + 1])); return u.toString('base64'); }

// --- cues
const cues = [];
const srt = fs.readFileSync(srtPath, 'utf8').split(/\r?\n\r?\n/);
const ts = s => { const m = s.match(/(\d+):(\d+):(\d+),(\d+)/); return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000; };
for (const blk of srt) {
  const L = blk.trim().split(/\r?\n/); if (L.length < 3) continue;
  const [a, b] = L[1].split('-->'); let text = L.slice(2).join(' ').trim();
  if (/^\*\*\[.*\]\*\*$/.test(text)) continue;
  let voice = 0; const vm = text.match(/^\*\*Voice (\d).*?\*\*\s*/); if (vm) { voice = +vm[1]; text = text.slice(vm[0].length); }
  text = text.replace(/\*/g, '');
  cues.push({ a: +ts(a).toFixed(3), b: +ts(b).toFixed(3), text, voice });
}

// --- offset check vs other decode
let offsetMs = null;
if (otherPath) {
  const y = load(otherPath), n = SR * 60, off0 = SR * 40; let bl = 0, bs = -1e9;
  for (let lag = -2200; lag <= 2200; lag += 4) { let s = 0; for (let i = 0; i < n; i += 7) s += x[off0 + i] * y[off0 + i + lag]; if (s > bs) { bs = s; bl = lag; } }
  offsetMs = bl / SR * 1000;
}

const SONG = { dur: +dur.toFixed(3), fps: +OUTFPS.toFixed(4), t0: +((N / 2) / SR).toFixed(4), bpm: +best.bpm.toFixed(2), beat0: +(beat0 % beatPeriod).toFixed(4), lo: pack(nlo), mid: pack(nmid), hi: pack(nhi), rms: pack(nrms), flux: pack(nflux), bright: pack(ncen), onsets, kicks, snaps, cues };
fs.writeFileSync(outPath, '// generated by tools/analyze.js\nwindow.SONG=' + JSON.stringify(SONG) + ';\n');

console.log('dur', dur.toFixed(2), 'bpm', best.bpm.toFixed(2), 'beat0', SONG.beat0, 'score', best.s.toFixed(3), 'cands', JSON.stringify(cands));
console.log('kicks', kicks.length, 'snaps', snaps.length);
console.log('onsets', onsets.length, 'cues', cues.length, 'offset(other-this) ms', offsetMs);
// coarse energy map, 2s buckets: rms / lo / hi
let line = '';
for (let t = 0; t < dur; t += 2) {
  const i0 = Math.floor(t * FPS), i1 = Math.min(F, Math.floor((t + 2) * FPS)); let r = 0, l = 0, h = 0;
  for (let i = i0; i < i1; i++) { r += nrms[i]; l += nlo[i]; h += nhi[i]; }
  const n = i1 - i0 || 1; line += `${String(t).padStart(3)}s r${(r / n * 9 | 0)} l${(l / n * 9 | 0)} h${(h / n * 9 | 0)}   `; if ((t / 2) % 6 === 5) line += '\n';
}
console.log(line);

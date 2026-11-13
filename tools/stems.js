// Stem analysis: per-stem envelopes, drum hits from the drum stem, and word onsets from the lead-vocal stem.
// usage: node tools/stems.js <dir with 0.raw..9.raw mono f32le 22050> <mix.raw> data.js [--print]
// writes stems.js (window.STEMS) and words.js (window.SONG_WORDS)
const fs = require('fs'), path = require('path');
const [,, dir, mixPath, dataPath, flag] = process.argv;
const SR = 22050, N = 1024, HOP = 220, FPS = SR / HOP, T0 = (N / 2) / SR;
const NAMES = ['vox', 'bv', 'drums', 'bass', 'gtr', 'keys', 'perc', 'synth', 'other', 'brass'];
const load = p => { const b = fs.readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.length >> 2); };
const win_ = {}; new Function('window', fs.readFileSync(dataPath, 'utf8'))(win_); const SONG = win_.SONG, cues = SONG.cues, BEAT = 60 / SONG.bpm;

function fft(re, im) { const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let l = 2; l <= n; l <<= 1) { const ang = -2 * Math.PI / l, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += l) { let cr = 1, ci = 0; for (let k = 0; k < l / 2; k++) { const a = i + k, c = a + l / 2, tr = re[c] * cr - im[c] * ci, ti = re[c] * ci + im[c] * cr;
      re[c] = re[a] - tr; im[c] = im[a] - ti; re[a] += tr; im[a] += ti; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } } }
const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = .5 - .5 * Math.cos(2 * Math.PI * i / N);
const binHz = SR / N, bin = hz => Math.round(hz / binHz);

// spectral features of one signal: rms, flux in bands
function feats(x, bands) {
  const F = Math.floor((x.length - N) / HOP), rms = new Float32Array(F), fl = bands.map(() => new Float32Array(F)), prev = new Float32Array(N / 2), re = new Float32Array(N), im = new Float32Array(N);
  for (let f = 0; f < F; f++) { let e = 0; for (let i = 0; i < N; i++) { const s = x[f * HOP + i]; re[i] = s * win[i]; im[i] = 0; e += s * s; } rms[f] = Math.sqrt(e / N); fft(re, im);
    const acc = bands.map(() => 0);
    for (let k = 1; k < N / 2; k++) { const m = Math.log1p(60 * Math.hypot(re[k], im[k])), d = m - prev[k]; prev[k] = m; if (d > 0) for (let b = 0; b < bands.length; b++) if (k >= bands[b][0] && k < bands[b][1]) acc[b] += d; }
    for (let b = 0; b < bands.length; b++) fl[b][f] = acc[b]; }
  return { F, rms, fl };
}
const pct = (a, p) => { const s = Float32Array.from(a).sort(); return s[Math.floor(p * (s.length - 1))]; };
const norm = (a, lo = .05, hi = .985) => { const x = pct(a, lo), y = pct(a, hi); return a.map(v => Math.max(0, Math.min(1, (v - x) / (y - x || 1)))); };
const smooth = (a, r) => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) { let s = 0, n = 0; for (let d = -r; d <= r; d++) { const j = i + d; if (j >= 0 && j < a.length) { s += a[j]; n++; } } o[i] = s / n; } return o; };
function peaks(arr, mul, floor, gap, r = 40) { const n = norm(arr), out = [], F = n.length;
  for (let i = 3; i < F - 3; i++) { let m = 0; for (let k = -r; k <= r; k++) m += n[Math.min(F - 1, Math.max(0, i + k))]; m /= 2 * r + 1;
    if (n[i] > m * mul + floor && n[i] >= n[i - 1] && n[i] > n[i + 1] && n[i] >= n[i - 2] && n[i] > n[i + 2]) { const t = i / FPS + T0; if (!out.length || t - out[out.length - 1][0] > gap) out.push([+t.toFixed(3), +n[i].toFixed(2)]); } }
  return out; }
const fr = t => Math.round((t - T0) * FPS);

const sig = NAMES.map((_, i) => load(path.join(dir, i + '.raw')));
const mix = load(mixPath);
// --- alignment of stems to the mix
let sum = new Float32Array(mix.length); for (const s of sig) for (let i = 0; i < Math.min(s.length, sum.length); i++) sum[i] += s[i];
let bl = 0, bs = -1e18; for (let lag = -3000; lag <= 3000; lag += 3) { let s = 0; for (let i = SR * 60; i < SR * 100; i += 5) s += mix[i] * (sum[i + lag] || 0); if (s > bs) { bs = s; bl = lag; } }
const LAG = bl / SR; // stems time = mix time + LAG
console.log('stem lag vs mix (ms):', (LAG * 1000).toFixed(1));

// --- envelopes
const env = {}, F = Math.floor((mix.length - N) / HOP);
const FE = sig.map((x, i) => feats(x, i === 2 || i === 6 ? [[1, bin(140)], [bin(180), bin(2500)], [bin(5000), bin(11000)]] : [[1, N / 2]]));
NAMES.forEach((n, i) => { env[n] = smooth(FE[i].rms, 2); });
const gmax = Math.max(...NAMES.map(n => pct(env[n], .985)));
const act = {}; NAMES.forEach(n => { const own = pct(env[n], .985); act[n] = env[n].map(v => Math.min(1, v / (own * .6 + gmax * .4 * .5 + 1e-9))); });

if (flag) { const ch = ' .:-=+*#%@'; console.log('activity per 4 s (0..254):');
  for (const n of NAMES) { let s = ''; for (let t = 0; t < 254; t += 4) { let m = 0, c = 0; for (let f = fr(t + LAG); f < fr(t + 4 + LAG); f++) if (f >= 0 && f < act[n].length) { m += act[n][f]; c++; } s += ch[Math.min(9, Math.floor(m / (c || 1) * 12))]; } console.log(n.padEnd(6), '|' + s + '|'); }
  let ruler = ''; for (let t = 0; t < 254; t += 4) ruler += t % 20 === 0 ? String(t / 10 | 0).slice(-1) : ' '; console.log('x10s   |' + ruler + '|'); }

// --- drum hits from the drum stem
const dr = FE[2], kicks = peaks(dr.fl[0], 1.6, .2, .14), snares = peaks(dr.fl[1], 1.8, .25, .14), hats = peaks(dr.fl[2], 1.4, .15, .07, 20);
const pk = peaks(FE[6].fl[1].map((v, i) => v + FE[6].fl[2][i]), 1.6, .2, .08, 20);
const shift = a => a.map(([t, v]) => [+(t - LAG).toFixed(3), v]).filter(([t]) => t >= 0);
console.log('kicks', kicks.length, 'snares', snares.length, 'hats', hats.length, 'perc', pk.length);

// --- lead vocal: voiced mask + syllable onsets
const vx = FE[0], vEnv = norm(smooth(vx.rms, 3), .3, .99), vFlux = vx.fl[0];
const vOn = peaks(vFlux, 1.35, .1, .085, 12).map(([t, v]) => [t - LAG, v]);
const voiced = t => { const f = fr(t + LAG); return f >= 0 && f < vEnv.length ? vEnv[f] : 0; };
const THR = .1;
const syl = w => { let n = 0; for (const part of w.toLowerCase().replace(/[^a-z-]/g, '').split('-')) { if (!part) continue; const m = part.replace(/e$/, '').match(/[aeiouy]+/g); n += Math.max(1, m ? m.length : 1); } return Math.max(1, n); };
const WORDS = [], report = [];
cues.forEach((c, i) => {
  const ws = c.text.split(' '), nextA = cues[i + 1] ? cues[i + 1].a : c.b, lim = Math.min(c.b, nextA);
  // actual phrase span: first / last voiced frame around the cue slot
  let a = null, b = null; for (let t = c.a - .35; t < lim + .15; t += .01) if (voiced(t) > THR) { if (a === null) a = t; b = t; }
  if (a === null) { WORDS.push(null); report.push(`${i} no voice`); return; }
  if (i > 0 && a < c.a - .12) { // don't swallow the tail of the previous line: start at the deepest dip before the cue
    let best = c.a, bv = 9; for (let t = c.a - .3; t <= c.a + .1; t += .01) if (voiced(t) < bv) { bv = voiced(t); best = t; } if (bv < THR * 1.5) a = best; }
  if (a < c.a - .12) a = c.a - .12;
  // expected syllable times: spread over sounding audio only (pauses skipped)
  const step = .01, ts = [], cum = []; let acc = 0; for (let t = a; t <= b + 1e-6; t += step) { ts.push(t); acc += voiced(t) > THR ? 1 : .04; cum.push(acc); }
  const sy = ws.map(syl), S = sy.reduce((x, y) => x + y, 0), tot = S, e = []; let k0 = 0;
  for (let k = 0; k < S; k++) { const target = acc * k / S; while (k0 < cum.length - 1 && cum[k0] < target) k0++; e.push(ts[k0]); }
  // align syllables to detected vocal onsets (monotonic DP; several syllables may share an onset, onsets may be skipped)
  const on = vOn.filter(([t]) => t >= a - .1 && t <= b + .05).map(([t]) => t - .015), O = on.length; let sylT = e.slice(), snapped = 0;
  if (O) { const INF = 1e9, dp = [], bk = [];
    for (let k = 0; k < S; k++) { dp.push(new Float64Array(O).fill(INF)); bk.push(new Int32Array(O)); for (let j = 0; j < O; j++) { const cst = (on[j] - e[k]) ** 2;
        if (k === 0) { dp[0][j] = cst + j * .002; continue; }
        let best = INF, bj = 0; for (let q = 0; q <= j; q++) { const v = dp[k - 1][q] + (q === j ? .012 : (j - q - 1) * .002); if (v < best) { best = v; bj = q; } }
        dp[k][j] = best + cst; bk[k][j] = bj; } }
    let j = 0; for (let q = 1; q < O; q++) if (dp[S - 1][q] < dp[S - 1][j]) j = q; const as = new Int32Array(S); for (let k = S - 1; k >= 0; k--) { as[k] = j; j = bk[k][j]; }
    for (let k = 0; k < S; ) { let m = k; while (m + 1 < S && as[m + 1] === as[k]) m++; const t0 = on[as[k]], t1 = m + 1 < S ? on[as[m + 1]] : t0 + .16 * (m - k + 1);
      if (Math.abs(t0 - e[k]) < .3) { for (let q = k; q <= m; q++) sylT[q] = t0 + (t1 - t0) * (q - k) / (m - k + 1); snapped += m - k + 1; } k = m + 1; } }
  let last = -1, si = 0; const out = ws.map((w, k) => { const t = Math.max(sylT[si], last + .05); si += sy[k]; last = t; return +t.toFixed(3); });
  WORDS.push(out); report.push(`${String(i).padStart(2)} slot ${c.a.toFixed(2)}–${lim.toFixed(2)}  sung ${a.toFixed(2)}–${b.toFixed(2)}  on ${on.length}/syl ${S}  snapped ${snapped}/${S}  ${c.text.slice(0, 30)}`);
});
if (flag) { console.log(report.join('\n')); for (const i of [2, 16, 18, 37, 48, 50]) console.log(i, cues[i].text.split(' ').map((w, k) => w.slice(0, 7) + '@' + (WORDS[i][k] - cues[i].a).toFixed(2)).join(' ')); }

// --- write
const OUTFPS = FPS / 2, M = Math.floor(F / 2), lagF = Math.round(LAG * FPS);
const pack = a => { const u = Buffer.alloc(M); for (let i = 0; i < M; i++) { const j = 2 * i + lagF; u[i] = Math.round(255 * Math.max(a[j] || 0, a[j + 1] || 0)); } return u.toString('base64'); };
const STEMS = { fps: +OUTFPS.toFixed(4), t0: +T0.toFixed(4), env: {}, kicks: shift(kicks), snares: shift(snares), hats: shift(hats), perc: shift(pk), vox: vOn.filter(([t]) => t > 0).map(([t, v]) => [+t.toFixed(3), v]) };
NAMES.forEach(n => { STEMS.env[n] = pack(act[n]); });
const root = path.dirname(dataPath);
fs.writeFileSync(path.join(root, 'stems.js'), '// generated by tools/stems.js from the Suno stems\nwindow.STEMS=' + JSON.stringify(STEMS) + ';\n');
fs.writeFileSync(path.join(root, 'words.js'), '// word onsets per cue, measured from the lead-vocal stem by tools/stems.js\nwindow.SONG_WORDS=' + JSON.stringify(WORDS) + ';\n');
console.log('wrote stems.js', (fs.statSync(path.join(root, 'stems.js')).size / 1024 | 0) + 'KB', 'words.js');

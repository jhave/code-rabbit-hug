'use strict';
/* scenes: each lyric passage is an "ensemble" that draws crisp type on the overlay (O)
   and bleeds colour into the shared fluid through the ink canvas (I).
   cue indices: 0 intro · 1 so it goes · 2-15 verse 1 · 16-23 chorus · 24-37 verse 2 · 38-40 bridge · 41-48 chorus · 49 · 50 */
(() => {
const E = window.E; if (!E) return;
const { cues, O, I, F, A, ptr, clamp, lerp, sm, hash, TAU, font, flow, wordsOf, wordT, cprog, charsShown, cueAt, BEAT } = E;
const PI = Math.PI, G = E.G;
const rgba = (r, g, b, a) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;
const COL = { paper: '#f3efe6', mint: '#7dffc8', pink: '#ff7ac8', amber: '#ffc861', blue: '#6fb6ff', red: '#ff5a5f', green: '#3fd47a', violet: '#b79cff', dim: '#8d8fa3' };
const PAL = [COL.mint, COL.pink, COL.amber, COL.blue, COL.violet];

// ---------- text helpers
function words(c, i, cx, cy, o = {}) {
  const t = E.t, size = o.size || 5 * E.u, ink = c === I;
  font(c, size, o.fam || F.serif, o.style || '');
  const src = o.upper ? wordsOf(i).map(w => ({ ...w, w: w.w.toUpperCase() })) : wordsOf(i);
  const L = flow(c, src, o.maxW || Math.min(E.W * .84, E.fw * .8), (o.lh || 1.28) * size);
  if (!ink && o.grains !== false) G.once('c' + i, () => { for (const w of L) G.word(w.w, size, o.fam || F.serif, o.style || '', cx + w.x, cy + w.y, w.a, w.b, nextA(i) + .12, typeof o.col === 'function' ? o.col(w) : (o.gcol || o.col || COL.paper)); });
  const k = (o.k ?? 1) * (ink ? (o.ink ?? .07) : 1);
  if (k <= 0) return L;
  for (const w of L) {
    const age = o.all ? 9 : t - w.a; if (age < 0) continue;
    const live = !o.all && t < w.b, pop = o.all ? 0 : Math.exp(-age * 9);
    c.globalAlpha = clamp(age / .07) * k * (live || o.all ? 1 : .86) * (ink ? 1 + pop * 3 : 1); c.fillStyle = typeof o.col === 'function' ? o.col(w) : (o.col || COL.paper);
    const rise = pop * size * .22;
    if (o.wf) { c.save(); c.translate(cx + w.x, cy + w.y + rise); o.wf(w, c, age, ink, cy + w.y); c.restore(); }
    else if (pop > .02) { const sc = 1 + pop * .12; c.save(); c.translate(cx + w.x + w.wd / 2, cy + w.y + rise); c.scale(sc, sc); c.fillText(w.w, -w.wd / 2, 0); c.restore(); }
    else c.fillText(w.w, cx + w.x, cy + w.y);
  }
  c.globalAlpha = 1; return L;
}
const para = (i, cx, cy, o) => { let L; E.both(c => { L = words(c, i, cx, cy, o); }); return L; };
const fit = (text, maxW, maxSize, fam, style = '') => { font(O, 100, fam, style); return Math.min(maxSize, 100 * maxW / O.measureText(text).width); };
const nextA = i => cues[i + 1] ? cues[i + 1].a : 1e9;
const lineK = i => E.t < cues[i].a ? 0 : 1 - sm(0, .3, E.t - nextA(i));
// lines are also called (invisibly, lk = 0) shortly before they start, so their grains can already be in flight
const seq = (i0, i1, fn) => { for (let i = i0; i <= i1; i++) { const lk = lineK(i); if (lk > 0) fn(i, lk); else if (E.t < cues[i].a && E.t > cues[i].a - .75) fn(i, 0); } };
function rr(c, x, y, w, h, r) { c.beginPath(); if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h); }
function aster(c, x, y, r, rot, col, lw, a) {
  c.save(); c.translate(x, y); c.rotate(rot); c.globalAlpha = a; c.strokeStyle = col; c.lineWidth = lw; c.lineCap = 'round'; c.beginPath();
  for (let i = 0; i < 4; i++) { const g = i * PI / 4; c.moveTo(-Math.cos(g) * r, -Math.sin(g) * r); c.lineTo(Math.cos(g) * r, Math.sin(g) * r); }
  c.stroke(); c.restore();
}
function squig(c, x0, x1, y, col, amp) { c.strokeStyle = col; c.lineWidth = Math.max(1, amp * .45); c.beginPath(); for (let x = x0, j = 0; x <= x1; x += amp, j++) { const yy = y + (j % 2 ? amp * .5 : -amp * .5); j ? c.lineTo(x, yy) : c.moveTo(x, yy); } c.stroke(); }
function bunny(c, x, y, s, ci, a = 1) {
  font(c, s, F.mono, 'bold'); c.textAlign = 'center'; c.globalAlpha = a; c.fillStyle = [COL.mint, COL.pink, COL.paper][ci % 3];
  c.fillText('(\\_/)', x, y - s * 1.05); c.fillText('(•.•)', x, y); c.fillText('/>♥', x + s * .25, y + s * 1.05);
  c.globalAlpha = 1; c.textAlign = 'left';
}
const add = (a, b, P, draw, f) => E.scenes.push({ a, b, P, draw, f });
const gText = (txt, size, fam, style, x, y, ls) => c => { font(c, size, fam, style); c.textAlign = 'center'; if (ls && 'letterSpacing' in c) c.letterSpacing = ls; String(txt).split('\n').forEach((ln, j, arr) => c.fillText(ln, x, y + (j - (arr.length - 1) / 2) * size * 1.08)); if ('letterSpacing' in c) c.letterSpacing = '0px'; c.textAlign = 'left'; };

// ---------- ambient ensembles (reused, so later sections can reprise earlier ones)
function ghostLines(k, amt) {
  const { W, H, u, t, T } = E; font(O, 1.9 * u, F.serif, 'italic'); O.fillStyle = COL.paper;
  for (let i = 2; i < cues.length; i += 1) {
    const x = ((hash(i * 1.3) + t * .004 * (1 + hash(i))) % 1) * 1.6 * W - .3 * W, y = hash(i * 2.9) * H;
    O.globalAlpha = amt * k * (.5 + .5 * Math.sin(T * .3 + i * 1.7)); O.fillText(cues[i].text, x, y);
  }
  O.globalAlpha = 1;
}
function spiral(k, amt) { // "all moments happen simultaneously"
  const { W, H, u, t } = E, cx = W / 2, cy = H / 2, R = Math.hypot(W, H) * .5, now = cueAt(t);
  font(O, 2.1 * u, F.serif, 'italic'); O.textAlign = 'center';
  for (let i = 0; i < cues.length; i++) {
    const ph = (hash(i * 5.1) + t * .04) % 1, r = R * Math.pow(1 - ph, 1.5), ang = i * 2.39996 + t * (.2 + 1.1 * ph * ph) + A.mid * .12, s = (.35 + (1 - ph) * .95) * (1 + E.kick * .05);
    O.save(); O.translate(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r * .92); O.rotate(ang + PI / 2); O.scale(s, s);
    O.globalAlpha = amt * k * sm(0, .12, ph) * (1 - sm(.8, 1, ph)) * (i === now ? .9 : .42); O.fillStyle = i === now ? COL.mint : COL.paper;
    O.fillText(cues[i].text, 0, 0); O.restore();
  }
  O.textAlign = 'left'; O.globalAlpha = 1;
}
function stripes(k, vis) {
  const { W, H, t } = E, n = 7, bh = H / n, off = (t * H * .035) % (2 * bh), ys = [];
  for (let j = -2; j < n + 2; j += 2) ys.push(j * bh + off);
  I.fillStyle = rgba(190, 215, 255, (.03 + .05 * E.pulse + .09 * E.snap) * k); for (const y of ys) I.fillRect(W * .08, y, W * .84, bh);
  if (vis > 0) { O.fillStyle = rgba(236, 238, 248, vis * k); for (const y of ys) O.fillRect(W * .08, y, W * .84, bh); }
  return { ys, bh };
}
const TT = ['refactor the void', 'stand-up 09:00', 'sync re: sync', 'velocity ↑↑', 'KPI: hustle', 'close 40 tabs', 'align on alignment', 'ship it friday', 'estimate the inestimable', 'retro of the retro', 'OKR: more OKRs', 'blocker: being'];
function tickets(k, ghostT) {
  const { W, H, u, t } = E, g = ghostT ? sm(0, .7, t - ghostT) : 0;
  for (let n = 0; n < 12; n++) {
    const sc = .8 + .4 * hash(n * 6.1), w = 25 * u * sc, h = 8.5 * u * sc;
    let x = (hash(n * 1.7) * .9 + .05) * W, y = ((hash(n * 9.1) * 1.4 * H + t * (.06 + .07 * hash(n * 2.3)) * H) % (1.4 * H)) - .2 * H;
    const dx = x - ptr.x, dy = y - ptr.y, d = Math.hypot(dx, dy) || 1, push = Math.max(0, 1 - d / (26 * u)) * 16 * u; x += dx / d * push; y += dy / d * push;
    const a = k * (1 - .82 * g) * (g > .5 ? .6 + .4 * hash(n + Math.floor(t * 9)) : 1);
    O.save(); O.translate(x, y); O.rotate((hash(n * 4.4) - .5) * .12); O.globalAlpha = a;
    rr(O, -w / 2, -h / 2, w, h, u); O.fillStyle = 'rgba(14,18,32,.84)'; O.fill(); O.strokeStyle = COL.blue; O.lineWidth = 1.2; if (g > .5) O.setLineDash([4, 5]); O.stroke(); O.setLineDash([]);
    font(O, 1.5 * u * sc, F.mono, 'bold'); O.fillStyle = COL.blue; O.fillText('HUG-' + (101 + n * 7), -w / 2 + u, -h / 2 + 2.2 * u * sc);
    font(O, 1.7 * u * sc, F.sans); O.fillStyle = COL.paper; O.fillText(TT[n], -w / 2 + u, h / 2 - 2.6 * u * sc);
    O.restore();
    I.globalAlpha = a; I.strokeStyle = 'rgba(70,140,255,.16)'; I.lineWidth = 2; I.strokeRect(x - w / 2, y - h / 2, w, h); I.globalAlpha = 1;
  }
}
const SPR = ['0101011111111110111000100', '0111011011111111010110101', '0010001110111111111101110', '0010001110001000010000100'];
function beads(k, amt) { // tamagotchi rosary
  const { W, H, u } = E, N = 28, act = ((E.beatN % N) + N) % N, ex = Math.min(W * .44, H * .8), ey = H * .42;
  O.globalAlpha = .22 * k * amt; O.strokeStyle = '#c9e3a2'; O.lineWidth = 1; O.beginPath(); O.ellipse(W / 2, H / 2, ex, ey, 0, 0, TAU); O.stroke();
  for (let j = 0; j < N; j++) {
    const g = j / N * TAU - PI / 2, x = W / 2 + Math.cos(g) * ex, y = H / 2 + Math.sin(g) * ey, on = j === act, r = (on ? 3.1 + E.pulse : 2.1) * u;
    O.globalAlpha = k * amt * (on ? 1 : .42); O.fillStyle = '#b9cf9a'; O.beginPath(); O.arc(x, y, r, 0, TAU); O.fill();
    const s = SPR[(j + (on ? Math.floor(E.beat * 2) : E.snap > .6 && hash(j + E.beatN) > .6 ? 1 : 0)) % 4], px = r * .26; O.fillStyle = '#1d2a18';
    for (let q = 0; q < 25; q++) if (s[q] === '1') O.fillRect(x + ((q % 5) - 2.5) * px, y + (Math.floor(q / 5) - 2.5) * px, px * .92, px * .92);
    if (on) { I.globalAlpha = .5 * k * amt * (1 - E.beat); I.fillStyle = PAL[j % 5]; I.beginPath(); I.arc(x, y, r * 1.5, 0, TAU); I.fill(); I.globalAlpha = 1; }
  }
  O.globalAlpha = 1;
}
function stars(k, q, withCurve) { // a whole cosmos, smuggled onto one crooked curve
  const { W, H, u, T } = E, cx = W / 2, cy = H * .42, P0 = [cx - 20 * u, cy - u], P1 = [cx + 4 * u, cy + 14 * u], P2 = [cx + 23 * u, cy - 8 * u];
  for (let j = 0; j < 260; j++) {
    const s = hash(j * 5.7), d = hash(j * 8.8), qj = sm(d * .4, .6 + d * .4, q), m = 1 - s;
    const bx = m * m * P0[0] + 2 * m * s * P1[0] + s * s * P2[0], by = m * m * P0[1] + 2 * m * s * P1[1] + s * s * P2[1];
    const x = lerp(hash(j * 1.1) * W, bx, qj), y = lerp(hash(j * 2.3) * H, by, qj) + Math.sin(T + j) * u * .4 * (1 - qj);
    const tw = .5 + .5 * Math.sin(T * 3 + j * 2.1), r = (.5 + hash(j * 3.3)) * u * .22;
    O.globalAlpha = k * (.35 + .65 * tw); O.fillStyle = '#fff'; O.beginPath(); O.arc(x, y, r, 0, TAU); O.fill();
    if (j % 3 === 0) { I.globalAlpha = k * .22; I.fillStyle = PAL[j % 5]; I.fillRect(x - r, y - r, r * 2.4, r * 2.4); }
  }
  if (withCurve && q > .5) { O.globalAlpha = k * sm(.55, 1, q) * .9; O.strokeStyle = COL.paper; O.lineWidth = .45 * u; O.lineCap = 'round'; O.beginPath(); O.moveTo(P0[0], P0[1]); O.quadraticCurveTo(P1[0], P1[1], P2[0], P2[1]); O.stroke(); }
  O.globalAlpha = I.globalAlpha = 1;
}

// ---------- rabbits (shared swarm; scenes ask for a number and a place)
const R = { list: [], want: 0, tx: 0, ty: 0, rad: 13 };
function rabbitsStep() {
  const { W, H, u, dt, t } = E, N = Math.max(8, R.want), s = 1.45 * u;
  while (R.list.length < R.want) { const n = R.list.length, e = Math.floor(hash(n * 3.3) * 4);
    R.list.push({ n, x: e === 0 ? -6 * u : e === 1 ? W + 6 * u : hash(n) * W, y: e === 2 ? -6 * u : e === 3 ? H + 6 * u : hash(n + .5) * H, vx: 0, vy: 0 }); }
  R.list.forEach((r, idx) => {
    const act = idx < R.want; let tx, ty;
    if (act) { const g = idx * 2.39996 + t * .22, rad = (4.5 + R.rad * Math.sqrt((idx + .5) / N)) * u; tx = R.tx + Math.cos(g) * rad; ty = R.ty + Math.sin(g) * rad * .8; }
    else { const g = Math.atan2(r.y - H / 2, r.x - W / 2); tx = W / 2 + Math.cos(g) * (W + H); ty = H / 2 + Math.sin(g) * (W + H); }
    const kS = act ? 7 : .9; r.vx += ((tx - r.x) * kS - r.vx * 3.4) * dt; r.vy += ((ty - r.y) * kS - r.vy * 3.4) * dt; r.x += r.vx * dt; r.y += r.vy * dt;
    r.gone = !act && (r.x < -9 * u || r.x > W + 9 * u || r.y < -9 * u || r.y > H + 9 * u);
    const hop = -(Math.abs(Math.sin((E.beat + hash(r.n) * .5) * PI)) * .7 * (.25 + A.lo) + E.kick * (.6 + hash(r.n * 2.2))) * 1.5 * u;
    bunny(O, r.x, r.y + hop, s, r.n);
    I.globalAlpha = .34; I.fillStyle = PAL[r.n % 5]; I.beginPath(); I.arc(r.x, r.y + hop, s * .8, 0, TAU); I.fill(); I.globalAlpha = 1;
  });
  R.list = R.list.filter(r => !r.gone); R.want = 0;
}
const callRabbits = (n, x, y, rad = 13) => { if (n > R.want) { R.want = Math.floor(n); R.tx = x; R.ty = y; R.rad = rad; } };

// ============================================================ gate
E.gate = () => {
  const { W, H, u, T } = E, s = Math.min(17 * u, E.fw * .15);
  G.once('gate' + (E.ended ? 1 : 0) + W, () => G.shape(gText(E.ended ? 'Listen again:' : 'Listen:', s, F.disp, 'italic', W / 2, H * .46), 60000, -1, 1e9, COL.paper));
  E.both((c, ink) => { font(c, s, F.disp, 'italic'); c.textAlign = 'center'; c.fillStyle = COL.paper; c.globalAlpha = ink ? .02 : G.ok ? .38 + .08 * Math.sin(T * 1.7) : .92;
    c.fillText(E.ended ? 'Listen again:' : 'Listen:', W / 2, H * .46); });
  font(O, 1.6 * u, F.mono); O.textAlign = 'center'; O.fillStyle = COL.dim; O.globalAlpha = .8;
  if ('letterSpacing' in O) O.letterSpacing = '.22em';
  O.fillText('click anywhere  ·  sound on  ·  4:15', W / 2, H * .46 + s * .78);
  if ('letterSpacing' in O) O.letterSpacing = '0px';
};

// ============================================================ 0:00 unstuck in time
add(-1, 18.6, { turb: 1.1, irid: .4 }, ({ k }) => {
  const { W, H, u, t } = E, size = Math.min(5.4 * u, E.fw * .05), g0 = 1 - sm(2.4, 3.8, t);
  if (g0 > 0) E.both((c, ink) => { const s = Math.min(17 * u, E.fw * .15); font(c, s, F.disp, 'italic'); c.textAlign = 'center'; c.fillStyle = COL.paper;
    const txt = 'Listen:'; let x = W / 2 - c.measureText(txt).width / 2; c.textAlign = 'left';
    for (let j = 0; j < txt.length; j++) { const wd = c.measureText(txt[j]).width, sp = (j - 3) * t * t * u * .9; c.globalAlpha = g0 * k * (ink ? .04 : 1); c.fillText(txt[j], x + sp, H * .46 + Math.sin(t * 1.3 + j) * t * u * .5); x += wd; } });
  const fly = Math.max(0, t - 13.9);
  E.both((c, ink) => {
    font(c, size, F.serif);
    const L = flow(c, wordsOf(0), Math.min(W * .8, size * 22), size * 1.5);
    if (!ink) G.once('c0', () => { for (const w of L) G.word(w.w, size, F.serif, '', W / 2 + w.x, H * .47 + w.y, w.a, w.b, /unstuck/.test(w.w) ? w.b + .5 : 13.9, /pull-request/.test(w.w) ? COL.mint : /they/.test(w.w) ? COL.pink : COL.paper); });
    for (const w of L) {
      const age = t - w.a; if (age < 0) continue;
      const v = hash(w.i * 7.7) - .5, stuck = /unstuck/.test(w.w), dir = v < 0 ? -1 : 1;
      const dx = v * size * (.12 * age * (stuck ? 4 : 1) + fly * fly * 1.6), dy = (hash(w.i * 3.1) - .5) * size * fly * fly * .5 + (stuck ? -Math.min(age, 3) * size * .12 : 0);
      const a = clamp(age / .2) * k * (1 - sm(3, 4.6, fly));
      c.save(); c.translate(W / 2 + w.x + dx, H * .47 + w.y + dy); if (stuck) c.rotate(v * .5 * Math.min(1, age * .4));
      const last = /pull-request/.test(w.w); if (last) font(c, size * .92, F.mono, 'bold'); else if (/they/.test(w.w)) font(c, size, F.serif, 'italic'); else font(c, size, F.serif);
      c.fillStyle = last ? COL.mint : /they/.test(w.w) ? COL.pink : COL.paper;
      for (let g = 3; g >= 1; g--) { c.globalAlpha = a * (ink ? .02 : .13) / g; c.fillText(w.w, dir * size * .16 * g * Math.min(1.5, age * .5) * (stuck ? 2.2 : 1), 0); }
      c.globalAlpha = a * (ink ? .06 : 1); c.fillText(w.w, 0, 0); c.restore();
    }
  });
  ghostLines(k, .1 * sm(4, 9, t));
});

// ============================================================ 0:18 and so it goes
add(18.6, 38.85, t => ({ irid: lerp(.4, .95, sm(23, 38, t)), turb: 1.25, swirl: .18 }), ({ k }) => {
  const { W, H, u, t } = E;
  const size = fit('And so it goes.', E.fw * .66, 13 * u, F.disp, 'italic'), fade = 1 - sm(22.4, 24.6, t);
  para(1, W / 2, H * .46, { size, fam: F.disp, style: 'italic', k: k * fade, ink: .05 + .3 * (1 - fade) * sm(22.4, 23, t) * (1 - sm(23.8, 24.6, t)), maxW: W });
  if (t > 22.6) { // one asterisk per beat once the drums arrive
    const n = E.beatN, x = (.12 + .76 * hash(n * 1.9)) * W, y = (.14 + .72 * hash(n * 4.3)) * H, r = (4 + 9 * hash(n * 7.1)) * u * (.5 + A.lo);
    aster(O, x, y, r * (1 + E.beat * .4), n * .7 + E.snap * .4, PAL[((n % 5) + 5) % 5], (.35 + .5 * E.kick) * u, k * Math.exp(-E.beat * 3.2) * .9);
    aster(I, x, y, r, n * .7, PAL[((n % 5) + 5) % 5], .9 * u, k * .55 * (1 - E.beat));
  }
  if (t > 26.6 && t < 30) G.once('title', () => G.shape(gText('code-rabbit hugs', 2.7 * u, F.mono, 'bold', W / 2, H * .5, '.4em'), 26000, r => 27.6 + r * .9, 36.4, COL.mint));
  const ta = sm(27, 29, t) * (1 - sm(35.5, 37.8, t));
  if (ta > 0) { font(O, 2.7 * u, F.mono, 'bold'); O.textAlign = 'center'; O.fillStyle = COL.paper; O.globalAlpha = ta * k; if ('letterSpacing' in O) O.letterSpacing = '.4em';
    O.fillText('code-rabbit hugs', W / 2, H * .5); font(O, 1.4 * u, F.mono); O.textAlign = 'center'; O.fillStyle = COL.dim; if ('letterSpacing' in O) O.letterSpacing = '.25em';
    O.fillText('move the pointer, or don’t', W / 2, H * .5 + 4.5 * u); if ('letterSpacing' in O) O.letterSpacing = '0px'; O.globalAlpha = 1; O.textAlign = 'left'; }
  ghostLines(k, .16);
});

// ============================================================ 0:38 opalescent crosswalk
add(38.85, 53.25, { irid: 1, turb: 1.1, decay: .976 }, ({ k }) => {
  const { W, H, u, t } = E, { ys, bh } = stripes(k, .82), size = Math.min(6 * u, E.fw * .056), swap = t > wordT(2, /soul/);
  const inside = new Path2D(), outside = new Path2D(); outside.rect(0, 0, W, H);
  for (const y of ys) { inside.rect(W * .08, y, W * .84, bh); outside.rect(W * .08, y, W * .84, bh); }
  seq(2, 5, (i, lk) => {
    let cx = W / 2, cy = H / 2;
    if (i === 5) { const dx = cx - ptr.x, dy = cy - ptr.y, d = Math.hypot(dx, dy) || 1, p = Math.max(0, 1 - d / (45 * u)) * 14 * u; cx += dx / d * p + Math.sin(t * 5) * u; cy += dy / d * p; }
    const A1 = { size, fam: F.serif, col: COL.paper, k: k * lk }, B1 = { size: size * .82, fam: F.mono, style: 'bold', col: '#101018', k: k * lk };
    O.save(); O.clip(outside, 'evenodd'); const L = words(O, i, cx, cy, swap ? A1 : { ...B1, col: COL.paper }); O.restore();
    O.save(); O.clip(inside); words(O, i, cx, cy, swap ? B1 : { ...A1, col: '#101018' }); O.restore();
    words(I, i, cx, cy, { ...A1, col: PAL[i % 5], ink: .09 });
    if (i === 4) { const q = sm(.35, 1, cprog(4)), hw = L.w + 6 * u, hh = (L.h * .56 + 2 * u) * q; // hoodie pulled to nose-bridge
      O.globalAlpha = k * lk * .96; O.fillStyle = '#0a0a12'; rr(O, cx - hw / 2, cy - L.h / 2 - 2 * u, hw, hh, [3 * u, 3 * u, 6 * u, 6 * u]); O.fill(); O.globalAlpha = 1; }
  });
});

// ============================================================ 0:53 the kitchen sink
function arcText(c, i, cx, cy, Rr, size, col, a, rot) {
  const text = cues[i].text, n = charsShown(i); font(c, size, F.serif, 'italic'); c.textAlign = 'center';
  const ws = [...text].map(ch => c.measureText(ch).width), tot = ws.reduce((x, y) => x + y, 0); let acc = 0; const st = -PI / 2 - tot / Rr / 2 + rot;
  c.fillStyle = col; c.globalAlpha = a;
  for (let j = 0; j < n && j < text.length; j++) { const g = st + (acc + ws[j] / 2) / Rr; c.save(); c.translate(cx + Math.cos(g) * Rr, cy + Math.sin(g) * Rr); c.rotate(g + PI / 2); c.fillText(text[j], 0, 0); c.restore(); acc += ws[j]; }
  c.textAlign = 'left'; c.globalAlpha = 1;
}
add(53.25, 68.7, t => ({ swirl: 1.15, drain: t > 56 && t < 61 ? 1.5 : .85, turb: .6, irid: .85, decay: .979 }), ({ k }) => {
  const { W, H, u, t } = E, cx = W / 2, cy = H / 2, Rr = Math.min(W, H) * .34;
  spiral(k, 1);
  O.globalAlpha = k; O.fillStyle = '#04040a'; O.beginPath(); O.arc(cx, cy, 2.6 * u * (1 + E.pulse * .3), 0, TAU); O.fill(); O.strokeStyle = 'rgba(243,239,230,.35)'; O.lineWidth = 1; O.stroke(); O.globalAlpha = 1;
  seq(6, 8, (i, lk) => {
    font(O, 100, F.serif, 'italic'); const size = Math.min(4.6 * u, 100 * Rr * 5.2 / O.measureText(cues[i].text).width), rot = (t - cues[i].a) * .1 - .25;
    arcText(O, i, cx, cy, Rr, size, i === 8 ? COL.violet : COL.paper, k * lk, rot); arcText(I, i, cx, cy, Rr, size, PAL[i % 5], k * lk * .1, rot);
  });
  seq(9, 9, (i, lk) => { // post-binary schism: one line, cut in two
    const size = Math.min(5.2 * u, E.fw * .05), d = (sm(0, .5, t - wordT(9, /schism/)) * 3 + .35 + E.pulse * .5) * u;
    O.save(); O.beginPath(); O.rect(0, 0, W, cy); O.clip(); words(O, i, cx - d, cy, { size, col: COL.pink, k: k * lk }); O.restore();
    O.save(); O.beginPath(); O.rect(0, cy, W, H); O.clip(); words(O, i, cx + d, cy, { size, col: COL.blue, k: k * lk }); O.restore();
    words(I, i, cx, cy, { size, col: COL.violet, ink: .08, k: k * lk });
  });
  const d = t - wordT(6, /blink/); // Tralfamadorian blink
  if (d > 0 && d < .36) { const lid = (1 - Math.abs(d / .18 - 1)) * H * .51; O.fillStyle = '#050508'; O.fillRect(0, 0, W, lid); O.fillRect(0, H - lid, W, lid); }
});

// ============================================================ 1:08 tickets, trophies, heavy water
function curlText(i, cx, cy, size, k) {
  const { t } = E, text = [...cues[i].text], n = charsShown(i), kap = sm(.3, 1, cprog(i)) + clamp((t - wordsOf(i).end + .2) / 1.3) * 1.5;
  E.both((c, ink) => {
    font(c, size, F.serif, 'italic'); const ws = text.map(ch => c.measureText(ch).width), tot = ws.reduce((x, y) => x + y, 0);
    let x = -tot / 2, y = 0, th = 0, s = 0, mx = 0, my = 0; const pts = [];
    for (let j = 0; j < text.length; j++) { th += kap / 2.5 * 5 * PI / tot * (.4 + 1.2 * s / tot) * ws[j]; pts.push([x, y, th]); mx += x; my += y; x += Math.cos(th) * ws[j]; y += Math.sin(th) * ws[j]; s += ws[j]; }
    const q = clamp(kap / 2.5); mx = mx / text.length * q; my = my / text.length * q;
    c.fillStyle = ink ? COL.pink : COL.paper; c.globalAlpha = k * (ink ? .08 : 1);
    for (let j = 0; j < n && j < text.length; j++) { c.save(); c.translate(cx + pts[j][0] - mx, cy + pts[j][1] - my); c.rotate(pts[j][2]); c.fillText(text[j], 0, 0); c.restore(); }
    c.globalAlpha = 1;
  });
}
add(68.7, 83.6, t => t < 79.3 ? { turb: .9, grav: .3, irid: .4 } : { grav: 1.3, turb: .35, irid: .65, decay: .982 }, ({ k }) => {
  const { W, H, u, t } = E, size = Math.min(5.4 * u, E.fw * .052);
  tickets(k * (1 - sm(75.2, 76.2, t)), wordT(10, /ghosting/));
  seq(10, 10, (i, lk) => para(i, W / 2, H * .44, { size, fam: F.sans, style: 'bold', k: k * lk, col: w => /Jira|tickets/.test(w.w) ? COL.blue : COL.paper,
    wf: (w, c, age, ink) => { c.rotate(-.025 * Math.min(age, 2.5)); c.translate(age * size * .05, 0); c.fillText(w.w, 0, 0);
      if (!ink && /Jira|tickets/.test(w.w) && age > .5) { c.strokeStyle = COL.red; c.lineWidth = size * .07; c.beginPath(); c.moveTo(0, 0); c.lineTo(w.wd * clamp((age - .5) / .25), 0); c.stroke(); } } }));
  seq(11, 11, (i, lk) => curlText(i, W / 2, H * .46, Math.min(4.2 * u, E.fw * .036), k * lk));
  seq(12, 12, (i, lk) => {
    para(i, W / 2, H * .38, { size, fam: F.disp, k: k * lk });
    const c = cues[12], dur = wordsOf(12).end - c.a, ts = wordT(12, /slaughter/), s = 5.5 * u;
    for (let j = 0; j < 10; j++) {
      const a = t - (c.a + j * dur / 12); if (a < 0) continue;
      const x = W * (.14 + .72 * hash(j * 4.4)), fy = H * .88 - (j % 3) * s * .2, y = Math.min(fy, -s + a * a * H * 1.3), down = y >= fy, tip = sm(0, .35, t - ts - j * .03);
      O.save(); O.translate(x, y); O.rotate(tip * (j % 2 ? 1.5 : -1.5)); O.globalAlpha = k * lk * (1 - tip * .5); O.font = `${s}px serif`; O.textAlign = 'center'; O.textBaseline = 'middle'; O.fillText('🏆', 0, 0); O.restore();
      if (down && a * a * H * 1.3 - s < fy + H * .12) { I.globalAlpha = .4; I.fillStyle = COL.amber; I.beginPath(); I.arc(x, fy, s * .6, 0, TAU); I.fill(); I.globalAlpha = 1; }
    }
  });
  seq(13, 13, (i, lk) => {
    const q = sm(0, 1, cprog(13)), lvl = H * (1 - .52 * q), kk = k * lk;
    const wave = c => { c.beginPath(); c.moveTo(0, H); for (let x = 0; x <= W; x += W / 40) c.lineTo(x, lvl + Math.sin(x / W * 9 + t * 1.6) * u * .8 + Math.sin(x / W * 23 - t) * u * .3); c.lineTo(W, H); c.closePath(); };
    wave(O); O.fillStyle = rgba(50, 110, 200, .24 * kk); O.fill(); O.strokeStyle = rgba(170, 210, 255, .5 * kk); O.lineWidth = 1; O.stroke();
    wave(I); I.fillStyle = rgba(30, 80, 220, .03 * kk); I.fill();
    font(O, 1.5 * u, F.mono); O.fillStyle = COL.blue; O.globalAlpha = kk * q; O.fillText('D₂O', W * .9, lvl - 2 * u); O.globalAlpha = 1;
    const cy = H * .34;
    para(i, W / 2, cy, { size, k: kk, wf: (w, c, age, ink, by) => {
      const rest = Math.max(0, lvl - by) + size * (.9 + 2.2 * hash(w.i * 3.7)), dy = Math.min(age * age * size * .55, rest), under = by + dy > lvl;
      if (under) { c.fillStyle = '#a9d3ff'; c.globalAlpha *= .8; }
      c.fillText(w.w, 0, dy + (under ? Math.sin(t * 1.4 + w.i) * u * .5 : 0)); } });
  });
});

// ============================================================ 1:23 infundibulum → half-smile
add(83.6, 92.2, { swirl: .75, drain: .5, irid: .75, turb: .7 }, ({ k }) => {
  const { W, H, u, t } = E, f = lineK(14), q15 = clamp((t - cues[15].a) / ((wordsOf(15).end - cues[15].a) * .9));
  stars(k * (t < cues[15].a ? .5 : 1), t < cues[15].a ? 0 : q15, true);
  if (t > cues[15].a - .2) G.once('smile', () => { const cx = W / 2, cy = H * .42; G.shape(c => { c.lineWidth = 1.5 * u; c.lineCap = 'round'; c.beginPath(); c.moveTo(cx - 20 * u, cy - u); c.quadraticCurveTo(cx + 4 * u, cy + 14 * u, cx + 23 * u, cy - 8 * u); c.stroke(); },
    80000, r => wordT(15, /cosmos/) + r * (wordsOf(15).end - wordT(15, /cosmos/)), 92.05, COL.paper); });
  if (f > 0) {
    for (let j = 0; j < 11; j++) { const yy = lerp(H * .14, H * .84, j / 10), rx = E.fw * .42 * Math.exp(-j * .33) + 2 * u, ox = Math.sin(t * 1.5 + j * .5) * (10 - j) * .5 * u;
      E.both((c, ink) => { c.globalAlpha = k * f * (ink ? .05 : .3); c.strokeStyle = COL.violet; c.lineWidth = ink ? 2 : 1; c.setLineDash(ink ? [] : [6, 5]); c.lineDashOffset = -t * 30; c.beginPath(); c.ellipse(W / 2 + ox, yy, rx, rx * .16, 0, 0, TAU); c.stroke(); c.setLineDash([]); }); }
    const ws = wordsOf(14), groups = [[0], [1], [2, 3, 4], [5]], sizes = [7.2, 6, 4.2, 3], sc = Math.min(u, E.fw * .0085); let y = H * .25;
    groups.forEach((g, li) => { const size = sizes[li] * sc, txt = g.map(j => ws[j]), ox = Math.sin(t * 1.5 + li * 1.6) * (4 - li) * 1.3 * u;
      E.both((c, ink) => { font(c, size, F.disp, li === 1 ? 'italic' : ''); let x = W / 2 + ox - c.measureText(txt.map(w => w.w).join(' ')).width / 2;
        for (const w of txt) { const age = t - w.a; if (age >= 0) { c.globalAlpha = clamp(age / .16) * k * f * (ink ? .08 : 1); c.fillStyle = ink ? COL.violet : COL.paper; c.fillText(w.w, x, y); } x += c.measureText(w.w + ' ').width; } c.globalAlpha = 1; });
      y += size * 1.55; });
  }
  seq(15, 15, (i, lk) => para(i, W / 2, H * .7, { size: Math.min(4 * u, E.fw * .038), style: 'italic', k: k * lk }));
});

// ============================================================ chorus: the linter
const KW = new Set(['Give', 'me', 'in', 'the', 'So', 'so', 'it', 'goes,', 'and', 'on', 'a', 'of', 'out', 'by', 'through', 'every', 'your', 'is', 'them']);
function chorus(base, k, big) {
  const { W, H, u, t, T } = E, lines = [];
  for (let n = 0; n < 8; n++) lines.push((n === 6 ? '// ' : '') + cues[base + n].text);
  const longest = lines.reduce((a, b) => a.length > b.length ? a : b), gut = 5;
  const size = Math.min(3.5 * u, fit('0'.repeat(longest.length + gut), E.fw * .8, 99, F.mono)), lh = size * 1.85;
  font(O, size, F.mono); const cw = O.measureText('M').width, bw = (longest.length + gut) * cw, x0 = (W - bw) / 2, xt = x0 + gut * cw, y0 = H / 2 - 3.5 * lh;
  const fk = 1 - .38 * E.snap * (hash(Math.floor(T * 30)) > .4 ? 1 : .3);
  O.globalAlpha = k * .55; O.fillStyle = '#07080e'; rr(O, x0 - 3 * u, y0 - lh * 1.1, bw + 6 * u, lh * 9.2, 1.5 * u); O.fill(); O.globalAlpha = 1;
  let wrapQ = 0;
  for (let n = 0; n < 8; n++) {
    const i = base + n, c = cues[i]; if (t < c.a - .75) break;
    G.once('ch' + i, () => { let ci = n === 6 ? 3 : 0; for (const w of wordsOf(i)) { G.word(w.w, size, F.mono, n === 0 ? 'bold' : '', xt + ci * cw, y0 + n * lh, w.a, w.b, nextA(i) + 2.2, PAL[(n + w.i) % 5], .8); ci += w.w.length + 1; } });
    if (t < c.a) break;
    const y = y0 + n * lh, pre = n === 6 ? 3 : 0, shown = charsShown(i) + pre, cur = t < nextA(i) && n < 7 || (n === 7 && t < wordsOf(i).end + .5);
    font(O, size * .8, F.mono); O.textAlign = 'right'; O.globalAlpha = k * fk * (n === 2 ? 1 : .45); O.fillStyle = n === 2 ? COL.red : COL.dim; O.fillText((n === 2 ? '● ' : '') + (40 + n), xt - cw * 1.4, y); O.textAlign = 'left';
    font(O, size, F.mono, n === 0 ? 'bold' : ''); O.globalAlpha = k * fk;
    if (n === 6) { O.shadowColor = '#9fd3ac'; O.shadowBlur = size * (.5 + E.pulse); }
    if (n === 4) { const g = O.createLinearGradient(xt, 0, xt + lines[n].length * cw, 0); for (let s = 0; s <= 4; s++) g.addColorStop(s / 4, `hsl(${(t * 70 + s * 80) % 360} 90% 76%)`); O.fillStyle = g; }
    let ci = pre; if (pre) { O.fillStyle = '#8fb89a'; O.fillText('// '.slice(0, shown), xt, y); }
    for (const w of wordsOf(i)) {
      const vis = clamp(shown - ci, 0, w.w.length); if (vis <= 0) break;
      let s = w.w.slice(0, vis);
      if (n !== 4) O.fillStyle = n === 6 ? '#8fb89a' : n === 2 ? COL.amber : /code-rabbit|hugs|linter|syntax|hope|error|bit/i.test(w.w) ? COL.mint : KW.has(w.w) ? '#c79bff' : COL.paper;
      if (n === 7) { const p = clamp((t - w.b - .4) / (big ? 3 : 5)); s = [...s].map((ch, j) => { const id = ci + j; return hash(id * 3.3) < p ? (hash(id * 9.9) < .1 ? '♥' : hash(id + Math.floor(t * 6) * 1.7) > .5 ? '1' : '0') : ch; }).join(''); }
      O.fillText(s, xt + ci * cw, y);
      if (n === 2 && t > w.b && /fragile|heart|out|of|scope/.test(w.w)) squig(O, xt + ci * cw, xt + (ci + w.w.replace(/[,”]/g, '').length) * cw, y + size * .7, /fragile/.test(w.w) ? COL.red : COL.amber, size * .16);
      ci += w.w.length + 1;
    }
    O.shadowBlur = 0;
    const cxp = xt + Math.min(shown, lines[n].length) * cw;
    if (cur) { O.globalAlpha = k * (E.beat < .5 ? .9 : .25); O.fillStyle = COL.mint; O.fillRect(cxp + cw * .1, y - size * .55, cw * .85, size * 1.1);
      I.globalAlpha = .5 * k; I.fillStyle = PAL[n % 5]; I.fillRect(cxp - cw, y - size * .5, cw * 2, size); I.globalAlpha = 1; }
    if (n === 2) { // lint tooltips
      const tip = (re, msg, col) => { const w = wordsOf(i).find(w => re.test(w.w)), a = sm(0, .15, t - w.b) * (1 - sm(2.6, 3.1, t - w.b)); if (a <= 0) return;
        let cj = 0; for (const q of wordsOf(i)) { if (q === w) break; cj += q.w.length + 1; }
        font(O, size * .62, F.mono); const tw = O.measureText(msg).width + 1.6 * u, tx = Math.min(xt + cj * cw, W - tw - 2 * u), ty = y + lh * .55;
        O.globalAlpha = k * a; rr(O, tx, ty, tw, size * 1.25, .5 * u); O.fillStyle = '#1c0f14'; O.fill(); O.strokeStyle = col; O.lineWidth = 1; O.stroke(); O.fillStyle = col; O.fillText(msg, tx + .8 * u, ty + size * .66); };
      tip(/fragile/, '✖ fragile  (42:9)', COL.red); tip(/scope/, '⚠ ‘heart’ is out of scope', COL.amber);
    }
    if (n === 3) wrapQ = sm(0, .5, t - wordT(i, /wrap/));
    if (n === 5 && t > wordsOf(i).end - .3) { O.save(); O.translate(xt + (lines[n].length + 1.5) * cw, y); O.rotate(t * 3); font(O, size, F.mono); O.textAlign = 'center'; O.fillStyle = COL.violet; O.globalAlpha = k; O.fillText('↻', 0, 0); O.restore(); }
  }
  if (wrapQ > 0) E.both((c, ink) => { font(c, lh * 6.5, F.disp); c.textAlign = 'center'; c.fillStyle = COL.amber; c.globalAlpha = k * wrapQ * (ink ? .06 : .85); const o = (1 - wrapQ) * 12 * u + E.pulse * u;
    c.fillText('{', x0 - 5 * u - o, H / 2); c.fillText('}', x0 + bw + 5 * u + o, H / 2); c.textAlign = 'left'; c.globalAlpha = 1; });
  O.globalAlpha = 1;
  callRabbits((big ? 84 : 38) * sm(0, 4, t - cues[base].a) * k, ptr.x, ptr.y, big ? 20 : 13);
  // grain set-pieces: a heart (or a rabbit) on "hugs", a 42, an asterisk for each "so it goes"
  const th = wordT(base, /hugs/), t42 = wordT(base + 2, /forty/), w3 = wordsOf(base + 3);
  if (t > th - 1) G.once('hug' + base, () => big
    ? G.shape(gText('(\\_/)\n(•.•)\n/ >♥', 15 * u, F.mono, 'bold', W / 2, H / 2), 70000, r => th - .25 + r * .3, th + 1.5, COL.pink)
    : G.shape(gText('♥', 58 * u, F.sans, '', W / 2, H * .53), 45000, r => th - .05 + r * .12, th + 1.25, '#ff4f8b'));
  if (t > t42 - 1) G.once('42' + base, () => G.shape(gText('42', 44 * u, F.mono, 'bold', W / 2, H * .5), 42000, r => t42 + r * .2, t42 + 1.05, COL.red));
  [0, 3].forEach(j => { if (t > w3[j].a - 1) G.once('sig' + base + j, () => G.shape(c => { c.lineWidth = 2.2 * u; c.lineCap = 'round'; c.translate(W * (j ? .72 : .28), H / 2); c.rotate(j); c.beginPath(); for (let q = 0; q < 4; q++) { const g = q * PI / 4, r = 20 * u; c.moveTo(-Math.cos(g) * r, -Math.sin(g) * r); c.lineTo(Math.cos(g) * r, Math.sin(g) * r); } c.stroke(); }, 30000, r => w3[j].a + r * .08, w3[j].a + .55, COL.amber)); });
}
add(92.2, 122.7, { fluoro: .9, irid: .45, turb: 1.1 }, ({ k }) => chorus(16, k, false));

// ============================================================ 2:02 diff · ice-nine
add(122.7, 127.7, t => ({ freeze: t > cues[25].a ? 1 : 0, turb: .8, irid: .5 }), ({ k }) => {
  const { W, H, u, t } = E, rows = ['@@ -47,1 +47,2 @@ verse 2', '- ' + cues[23].text, '+ ' + cues[24].text, '+ ' + cues[25].text];
  const size = Math.min(3.5 * u, fit(rows[2], E.fw * .82, 99, F.mono)), lh = size * 2.1, y0 = H * .36; font(O, size, F.mono); const cw = O.measureText('M').width, x0 = (W - rows[2].length * cw) / 2;
  const frz = sm(0, 1.2, t - cues[25].a);
  rows.forEach((r, n) => {
    const y = y0 + n * lh, shown = n < 2 ? 99 : charsShown(22 + n) + 2; if (n >= 2 && t < cues[22 + n].a) return;
    const col = n === 0 ? COL.violet : n === 1 ? COL.red : n === 3 ? `rgb(${lerp(63, 200, frz) | 0},${lerp(212, 232, frz) | 0},${lerp(122, 255, frz) | 0})` : COL.green;
    if (n) { O.globalAlpha = k * .16; O.fillStyle = col; O.fillRect(x0 - 2 * u, y - lh * .45, rows[2].length * cw + 4 * u, lh * .9);
      I.globalAlpha = k * .07; I.fillStyle = n === 1 ? '#ff2a3c' : n === 3 && frz > .3 ? '#8fd0ff' : '#22e070'; I.fillRect(x0 - 2 * u, y - lh * .45, rows[2].length * cw + 4 * u, lh * .9); I.globalAlpha = 1; }
    font(O, size, F.mono, n === 0 ? '' : 'bold'); O.globalAlpha = k * (n === 0 ? .7 : 1); O.fillStyle = col; O.fillText(r.slice(0, shown), x0, y);
    if (n === 1) { O.strokeStyle = COL.red; O.lineWidth = 1.5; O.beginPath(); O.moveTo(x0 + 2 * cw, y); O.lineTo(x0 + r.length * cw, y); O.stroke(); }
    if (n === 3 && frz > .4) { font(O, size * 1.2, F.sans); O.fillText('❄', x0 + (r.length + 1) * cw, y); }
  });
  E.both((c, ink) => { font(c, 30 * u, F.mono, 'bold'); c.textAlign = 'center'; c.globalAlpha = k * E.pulse * (ink ? .3 : .12); c.fillStyle = COL.red; c.fillText('−', W * .12, H * .5); c.fillStyle = COL.green; c.fillText('+', W * .88, H * .5); c.textAlign = 'left'; c.globalAlpha = 1; });
  const tb = cues[25].a - 1.4, q = clamp((t - tb) / 2.8), bx = W * (-.12 + .78 * (1 - (1 - q) ** 3)), by = H * .76; // the greyhound, stopping
  if (t > tb) { O.save(); O.translate(bx, by + (q < 1 ? Math.sin(t * 30) * u * .15 : 0)); O.scale(-1, 1); O.font = `${8 * u}px serif`; O.textAlign = 'center'; O.textBaseline = 'middle'; O.globalAlpha = k; O.fillText('🚌', 0, 0); O.restore();
    I.globalAlpha = .2 * (1 - q); I.fillStyle = '#9aa'; I.beginPath(); I.arc(bx - 5 * u, by + u, 2 * u, 0, TAU); I.fill(); I.globalAlpha = 1; }
});

// ============================================================ 2:07 tamagotchi rosary · catechism
const pxc = document.createElement('canvas'), pxx = pxc.getContext('2d');
function pixelText(i, cx, cy, maxW, col, k) {
  const sc = Math.max(2, Math.round(E.u * .48)), fs = 10, set = () => { pxx.font = `bold ${fs}px ${F.mono}`; pxx.textBaseline = 'middle'; pxx.textAlign = 'left'; };
  set(); const L = flow(pxx, wordsOf(i), maxW / sc, 14); pxc.width = Math.ceil(L.w) + 6; pxc.height = Math.ceil(L.h) + 6; set(); pxx.fillStyle = col;
  for (const w of L) if (E.t >= w.a) pxx.fillText(w.w, Math.round(pxc.width / 2 + w.x), Math.round(pxc.height / 2 + w.y));
  E.both((c, ink) => { c.imageSmoothingEnabled = false; c.globalAlpha = k * (ink ? .06 : 1); c.drawImage(pxc, Math.round(cx - pxc.width * sc / 2), Math.round(cy - pxc.height * sc / 2), pxc.width * sc, pxc.height * sc); c.imageSmoothingEnabled = true; c.globalAlpha = 1; });
}
add(127.7, 139.5, { irid: .55, turb: .8, swirl: .25, decay: .975 }, ({ k }) => {
  const { W, H, u, t } = E; beads(k, 1);
  seq(26, 27, (i, lk) => pixelText(i, W / 2, H / 2, Math.min(W * .6, E.fw * .5), '#c9e3a2', k * lk));
  if (t >= cues[28].a) {
    const qa = i => cues[i].text.split('—').map(s => s.replace(/[“”]/g, '').trim());
    const size = Math.min(3.6 * u, fit(qa(29)[1], W * .43, 99, F.mono, 'bold'));
    O.globalAlpha = k * .4; O.strokeStyle = COL.paper; O.setLineDash([3, 6]); O.beginPath(); O.moveTo(W / 2, H * .36); O.lineTo(W / 2, H * .64); O.stroke(); O.setLineDash([]);
    [28, 29].forEach((i, r) => { if (t < cues[i].a) return; const [q, a] = qa(i), d = cues[i].b - cues[i].a, y = H * (.44 + r * .12), tq = clamp((t - cues[i].a) / (d * .45)), ta = t - (cues[i].a + d * .5);
      E.both((c, ink) => { const al = k * (ink ? .08 : 1);
        font(c, size, F.serif, 'italic'); c.textAlign = 'right'; c.globalAlpha = al; c.fillStyle = COL.paper; c.fillText(q.slice(0, Math.ceil(q.length * tq)), W / 2 - 2.5 * u, y);
        if (ta > 0) { const pop = 1 + (1 - clamp(ta / .18)) * .35; c.save(); c.translate(W / 2 + 2.5 * u, y); c.scale(pop, pop); font(c, size, F.mono, 'bold'); c.fillStyle = COL.mint; c.fillText(a, 0, 0); c.restore(); }
        c.textAlign = 'left'; c.globalAlpha = 1; }); });
    if (t > cues[29].a + 1) { O.save(); O.translate(W / 2, H * .5); O.rotate(-t * 2.5); font(O, 4 * u, F.mono); O.textAlign = 'center'; O.fillStyle = COL.violet; O.globalAlpha = k * .9; O.fillText('↻', 0, 0); O.restore(); }
  }
});

// ============================================================ 2:19 the review · heart · blush · tote-bag
const ROM = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];
add(139.5, 154.0, t => ({ blush: sm(cues[32].a - .2, cues[32].a + 1.6, t) * (1 - sm(152.6, 154, t)) * .95, irid: .45 }), ({ k }) => {
  const { W, H, u, t } = E, size = Math.min(5.2 * u, E.fw * .05);
  font(O, 1.5 * u, F.mono); O.textAlign = 'center'; O.fillStyle = COL.dim; O.globalAlpha = k * .8; O.fillText('pull request #42  ·  review requested', W / 2, H * .16); O.textAlign = 'left'; O.globalAlpha = 1;
  seq(30, 30, (i, lk) => { // triple-entendre: three readings converging
    const rad = ((1 - sm(.35, 1, cprog(30))) * 1.7 + .12) * u; O.save(); O.globalCompositeOperation = 'screen';
    ['#ff3b6b', '#35f0a8', '#5b7bff'].forEach((col, j) => { const g = t * 1.3 + j * TAU / 3; words(O, i, W / 2 + Math.cos(g) * rad, H * .44 + Math.sin(g) * rad, { size, col, k: k * lk }); });
    O.restore(); words(I, i, W / 2, H * .44, { size, col: COL.violet, k: k * lk });
  });
  if (t >= cues[31].a && t < cues[33].a + .3) { // the queue, the bunny, the heart
    const kk = k * (1 - sm(0, .3, t - cues[33].a)), y = H * .64, q = cprog(31), px = j => W / 2 + (j - 3) * 13 * u;
    for (let j = 0; j < 7; j++) { O.globalAlpha = kk * (j === 3 ? 1 : .5); rr(O, px(j) - 5 * u, y - 2 * u, 10 * u, 4 * u, 2 * u); O.strokeStyle = j === 3 ? COL.pink : COL.dim; O.lineWidth = 1.2; O.stroke();
      font(O, 1.5 * u, F.mono); O.textAlign = 'center'; O.fillStyle = j === 3 ? COL.pink : COL.dim; O.fillText('#' + (39 + j), px(j), y); O.textAlign = 'left'; }
    const hopq = sm(0, .8, q), bx = lerp(-10 * u, px(3), hopq), by = y - 7 * u - (hopq < 1 ? Math.abs(Math.sin(q * PI * 6)) * 4 * u : E.pulse * u);
    bunny(O, bx, by, 2.1 * u, 0, kk);
    const th = t - (cues[31].a + (wordsOf(31).end - cues[31].a) * .8);
    if (th > 0) { const s = (5 + 2.5 * E.pulse) * u * (1 + .5 * Math.exp(-th * 5) * Math.cos(th * 18)) * clamp(th / .12);
      E.both((c, ink) => { font(c, s, F.sans); c.textAlign = 'center'; c.fillStyle = '#ff4f8b'; c.globalAlpha = kk * (ink ? .12 + .5 * Math.exp(-th * 4) : 1); c.fillText('♥', px(3), y - 15 * u - Math.min(th, 1) * 2 * u); c.textAlign = 'left'; c.globalAlpha = 1; }); }
  }
  seq(31, 31, (i, lk) => para(i, W / 2, H * .4, { size: size * .78, fam: F.mono, k: k * lk, col: w => /heart-emoji/.test(w.w) ? COL.pink : COL.paper }));
  seq(32, 32, (i, lk) => para(i, W / 2, H * .38, { size, style: 'italic', k: k * lk, col: w => /crimson|flag|blushes/.test(w.w) ? '#ff3355' : '#ffd9de',
    wf: (w, c) => c.fillText(w.w, 0, /crimson|flag/.test(w.w) ? Math.sin(t * 6 + w.i) * u * .7 : 0) }));
  seq(33, 33, (i, lk) => {
    const kk = k * lk; para(i, W / 2, H * .3, { size, k: kk });
    const bx = W / 2, by = H * .72, c33 = cues[33], dur = wordsOf(33).end - c33.a + 1; let inBag = 0;
    ROM.forEach((r, j) => { const q = clamp((t - (c33.a + .3 + j * dur / 22)) / .8); if (q <= 0) return; if (q >= 1) { inBag++; return; }
      const sx = W / 2 + (hash(j * 1.3) - .5) * 55 * u, x = lerp(sx, bx + (hash(j * 3) - .5) * 9 * u, q * q), y = lerp(H * .36, by - 4 * u, q) - Math.sin(q * PI) * 6 * u;
      E.both((c, ink) => { font(c, 3 * u * (1 - q * .4), F.disp); c.textAlign = 'center'; c.fillStyle = COL.amber; c.globalAlpha = kk * (ink ? .3 : sm(0, .15, q) * (1 - sm(.85, 1, q))); c.fillText(r, x, y); c.textAlign = 'left'; c.globalAlpha = 1; }); });
    const s = 1 + inBag * .006 + E.pulse * .02; O.save(); O.translate(bx, by); O.scale(s, s); O.globalAlpha = kk; O.strokeStyle = COL.paper; O.lineWidth = .3 * u; O.lineJoin = 'round';
    O.beginPath(); O.moveTo(-11 * u, -6 * u); O.lineTo(11 * u, -6 * u); O.lineTo(9.5 * u, 12 * u); O.lineTo(-9.5 * u, 12 * u); O.closePath(); O.fillStyle = 'rgba(235,225,195,.12)'; O.fill(); O.stroke();
    O.beginPath(); O.moveTo(-6 * u, -6 * u); O.bezierCurveTo(-6 * u, -16 * u, 6 * u, -16 * u, 6 * u, -6 * u); O.stroke();
    font(O, 1.6 * u, F.mono); O.textAlign = 'center'; O.fillStyle = COL.paper; O.fillText(inBag ? ROM[inBag - 1] + ' c.' : 'canvas', 0, 4 * u); O.restore();
  });
});

// ============================================================ 2:34 styrofoam castle → catacomb → salvation → crab-walk
const B = { x: null };
function beadsInit() {
  const { W, H, u } = E, cells = [], cols = 30, cell = Math.min(2.1 * u, W * .9 / cols), bx = W / 2 - cols * cell / 2, by = H * .9;
  for (let c = 0; c < cols; c++) { const tower = c < 5 || c > 24 || (c > 12 && c < 17), h = tower ? 13 : 7;
    for (let r = 0; r < h; r++) { if (r === h - 1 && c % 2) continue; if (c > 13 && c < 16 && r < 4) continue; cells.push([bx + (c + .5) * cell, by - (r + .5) * cell]); } }
  const n = cells.length; B.n = n; B.cell = cell; B.hx = new Float32Array(n); B.hy = new Float32Array(n); B.x = new Float32Array(n); B.y = new Float32Array(n); B.vx = new Float32Array(n); B.vy = new Float32Array(n);
  cells.forEach((p, j) => { B.hx[j] = p[0]; B.hy[j] = p[1]; B.x[j] = hash(j * 1.9) * W; B.y[j] = hash(j * 5.3) * H * .7; });
}
E.onresize = () => { B.x = null; };
function beadsStep(mode, k, q) {
  if (!B.x) beadsInit();
  const { W, H, u, dt, t } = E, fl = H * .94, r = B.cell * .42;
  for (let j = 0; j < B.n; j++) {
    let ax = 0, ay = 0; const h = hash(j * 7.7);
    if (mode === 'build') { if (q * 1.25 > h) { ax = (B.hx[j] - B.x[j]) * 40 - B.vx[j] * 9; ay = (B.hy[j] - B.y[j]) * 40 - B.vy[j] * 9; } else { ax = -B.vx[j] * 2; ay = -B.vy[j] * 2 + Math.sin(t * 2 + j) * 6 * u; } }
    else if (mode === 'fall') { ay = 90 * u; ax = (h - .5) * 20 * u - B.vx[j]; }
    else if (mode === 'rise') { ay = -(6 + 14 * h) * u - B.vy[j] * .8; ax = Math.sin(t * 1.5 + j) * 8 * u - B.vx[j] * .5; }
    else if (mode === 'wind') { ax = (30 + 40 * h) * u - B.vx[j] * .6; ay = Math.sin(t * 3 + j) * 10 * u - B.vy[j]; }
    const dx = B.x[j] - ptr.x, dy = B.y[j] - ptr.y, d2 = dx * dx + dy * dy, rr2 = (10 * u) ** 2; if (d2 < rr2) { const d = Math.sqrt(d2) || 1, f = (1 - d2 / rr2) * 900 * u; ax += dx / d * f; ay += dy / d * f; }
    B.vx[j] += ax * dt; B.vy[j] += ay * dt; B.x[j] += B.vx[j] * dt; B.y[j] += B.vy[j] * dt;
    if (B.y[j] > fl) { B.y[j] = fl; B.vy[j] *= -.35; B.vx[j] *= .8; }
    if (mode === 'wind' && B.x[j] > W + 2 * u) B.x[j] = -2 * u;
    if (mode === 'rise' && B.y[j] < -2 * u) B.y[j] = H + u;
    const led = mode === 'rack' || mode === 'fall' ? (h < .16 ? (hash(j + Math.floor(t * 5)) > .4 ? COL.green : '#113') : h > .93 ? COL.red : null) : null;
    O.globalAlpha = k * .92; O.fillStyle = led || '#f4f4f0'; O.beginPath(); O.arc(B.x[j], B.y[j], r, 0, TAU); O.fill();
    if (j % 4 === 0) { I.globalAlpha = k * .1; I.fillStyle = led || '#dfe8ff'; I.fillRect(B.x[j] - r, B.y[j] - r, r * 2, r * 2); }
  }
  O.globalAlpha = I.globalAlpha = 1;
}
add(154.0, 164.75, t => ({ turb: .9, irid: .3, decay: .97, grav: t > wordT(35, /catacomb/) && t < cues[36].a ? 1.4 : t >= wordT(36, /salvation/) ? -1.6 : 0 }), ({ k }) => {
  const { W, H, u, t } = E, size = Math.min(4.8 * u, E.fw * .046), tc = wordT(35, /catacomb/);
  beadsStep(t < cues[35].a ? 'build' : t < tc ? 'rack' : t < cues[36].a ? 'fall' : 'rise', k, cprog(34));
  seq(34, 34, (i, lk) => para(i, W / 2, H * .28, { size, fam: F.disp, k: k * lk, col: w => /styrofoam/.test(w.w) ? '#fff' : COL.paper }));
  seq(35, 35, (i, lk) => para(i, W / 2, H * .28, { size: size * .78, fam: F.mono, k: k * lk, col: w => /busted/.test(w.w) ? COL.red : /catacomb/.test(w.w) ? COL.dim : COL.green }));
  seq(36, 36, (i, lk) => para(i, W / 2, H * .36, { size: size * 1.35, fam: F.sans, style: 'bold', k: k * lk, col: w => /salvation/.test(w.w) ? COL.amber : COL.paper,
    wf: (w, c, age, ink) => { const sal = /salvation/.test(w.w); c.fillText(w.w, 0, sal ? -age * 1.2 * u : 0);
      if (!ink && !sal && age > .45) { c.strokeStyle = COL.red; c.lineWidth = size * .11; c.beginPath(); c.moveTo(-size * .1, 0); c.lineTo((w.wd + size * .1) * clamp((age - .45) / .2), -size * .08); c.stroke(); } } }));
});
add(164.75, 172.9, { shear: 1.7, turb: .5, irid: .5, decay: .976 }, ({ k }) => {
  const { W, H, u, t } = E, t0 = 164.75, hy = H * .58, off = t * 1.3, gw = W * .14;
  E.both((c, ink) => { c.globalAlpha = k * (ink ? .035 : .26); c.strokeStyle = COL.mint; c.lineWidth = 1; c.beginPath();
    for (let j = -16; j <= 16; j++) { const f = j + (off % 1); c.moveTo(W / 2 + f * gw * .1, hy); c.lineTo(W / 2 + f * gw, H); }
    for (let m = 0; m <= 8; m++) { const y = hy + (H - hy) * (m / 8) ** 2; c.moveTo(0, y); c.lineTo(W, y); } c.stroke(); c.globalAlpha = 1; });
  beadsStep('wind', k * .8);
  const size = Math.min(6 * u, E.fw * .055), xo = Math.sin((t - t0) * .9) * 7 * u + (E.beat < .5 ? 0 : 1.3 * u);
  seq(37, 37, (i, lk) => para(i, W / 2 + xo, H * .36, { size, fam: F.sans, style: 'bold', k: k * lk, col: w => /simulation/.test(w.w) ? COL.mint : COL.paper,
    wf: (w, c) => { if (/simulation/.test(w.w)) font(c, size * .9, F.mono, 'bold'); c.fillText(w.w, 0, ((w.i + E.beatN) % 2 ? -1 : 1) * Math.abs(Math.sin(E.beat * PI)) * 1.1 * u); } }));
  const cx = W * (.1 + .8 * clamp((t - t0) / 8)) + (E.beat < .5 ? 0 : 1.5 * u), cy = H * .78 - Math.abs(Math.sin(E.beat * TAU)) * u;
  O.font = `${7 * u}px serif`; O.textAlign = 'center'; O.textBaseline = 'middle'; O.globalAlpha = k; O.fillText('🦀', cx, cy); O.globalAlpha = 1; O.textAlign = 'left';
  I.globalAlpha = .3 * k; I.fillStyle = '#ff7a3c'; I.beginPath(); I.arc(cx, cy, 2.5 * u, 0, TAU); I.fill(); I.globalAlpha = 1;
});

// ============================================================ 2:52 bridge: two voices, a branch that never merges
function glitchText(i, cx, cy, size, k) {
  const { T, u } = E, o = { size, fam: F.mono, style: 'bold', upper: true, maxW: Math.min(E.W * .84, E.fw * .74), lh: 1.5 };
  const L = words(I, i, cx, cy, { ...o, col: COL.mint, k }), n = 6, bh = (L.h + size) / n, tk = Math.floor(T * 5) + Math.floor(E.t / (BEAT / 4)) * 7;
  for (let b = 0; b < n; b++) {
    const dx = hash(b * 7 + tk) > .68 ? (hash(b + tk * 3.1) - .5) * size * 1.3 * (.35 + A.hi + A.mid) : 0;
    O.save(); O.beginPath(); O.rect(0, cy - (L.h + size) / 2 + b * bh, E.W, bh + .5); O.clip(); O.globalCompositeOperation = 'screen';
    words(O, i, cx + dx - size * .09, cy, { ...o, col: '#ff2e5f', k: k * .8 }); words(O, i, cx + dx + size * .09, cy, { ...o, col: '#2ee6ff', k: k * .8 });
    O.globalCompositeOperation = 'source-over'; words(O, i, cx + dx, cy, { ...o, col: '#f4fff9', k }); O.restore();
  }
  font(O, 1.4 * u, F.mono); O.fillStyle = COL.mint; O.globalAlpha = k * .8; const lx = cx - L.w / 2, ly = cy - L.h / 2 - 3.2 * u; O.fillText('VOICE 2', lx, ly);
  for (let j = 0; j < 14; j++) { const h = (.3 + 2.4 * hash(j + tk * 1.3) * (A.mid + A.hi + .15)) * u; O.fillRect(lx + 9 * u + j * .7 * u, ly - h / 2, .4 * u, h); } O.globalAlpha = 1;
}
function gitGraph(k, t0, t1) {
  const { W, H, u, t } = E, xa = W * .08, xb = W * .92, hn = clamp((t - t0) / (t1 - t0)), ym = H * .82;
  const bump = (x, c) => Math.exp(-(((x - c) / .035) ** 2)), yb = xn => ym - 10 * u * sm(.1, .18, xn) + 7 * u * (bump(xn, .42) + bump(xn, .62) + bump(xn, .8)) * sm(.1, .18, xn);
  E.both((c, ink) => { c.lineWidth = ink ? 3 : .3 * u; c.lineCap = 'round'; c.globalAlpha = k * (ink ? .06 : .9);
    c.strokeStyle = COL.dim; c.beginPath(); c.moveTo(xa, ym); c.lineTo(lerp(xa, xb, hn), ym); c.stroke();
    c.strokeStyle = COL.mint; c.beginPath(); for (let xn = .1; xn <= Math.max(.1, hn); xn += .004) { const x = lerp(xa, xb, xn); xn === .1 ? c.moveTo(x, yb(xn)) : c.lineTo(x, yb(xn)); } c.stroke(); c.globalAlpha = 1; });
  const nb = Math.floor((t - t0) / BEAT);
  for (let j = 0; j <= nb; j++) { const xn = j * BEAT / (t1 - t0); if (xn > 1) break; const x = lerp(xa, xb, xn), onB = j % 2 && xn > .18, y = onB ? yb(xn) : ym, nw = j === nb ? 1 - E.beat : 0;
    O.globalAlpha = k; O.fillStyle = '#07080e'; O.strokeStyle = onB ? COL.mint : COL.dim; O.lineWidth = .28 * u; O.beginPath(); O.arc(x, y, (.8 + nw * .8) * u, 0, TAU); O.fill(); O.stroke(); }
  font(O, 1.4 * u, F.mono); O.globalAlpha = k * .8; O.fillStyle = COL.dim; O.fillText('main', xa, ym + 3 * u); if (hn > .2) { O.fillStyle = COL.mint; O.fillText('feature/hug', lerp(xa, xb, .19), ym - 13 * u); }
  const tu = t - wordT(40, /un-merged/);
  if (tu > 0) { const xh = lerp(xa, xb, hn), a = k * sm(0, .4, tu); font(O, 1.5 * u, F.mono, 'bold'); const tw = O.measureText('un-merged').width + 2.4 * u;
    O.globalAlpha = a; rr(O, xh - tw - 2 * u, yb(hn) - 6 * u, tw, 3.2 * u, 1.6 * u); O.strokeStyle = COL.mint; O.lineWidth = 1.2; O.stroke(); O.fillStyle = COL.mint; O.fillText('un-merged', xh - tw - .8 * u, yb(hn) - 4.4 * u);
    O.setLineDash([3, 5]); O.strokeStyle = COL.dim; O.beginPath(); O.moveTo(xh, yb(hn)); O.quadraticCurveTo(xh + 3 * u, (yb(hn) + ym) / 2, xh + 6 * u, ym); O.stroke(); O.setLineDash([]); }
  O.globalAlpha = 1;
}
const TODO = ['// TODO: document the universe', '// ???', '// who wrote this', '// FIXME: time', '// works. nobody knows why', '/* here be dragons */', '// temporary (2011)'];
add(172.9, 189.0, { glitch: .85, turb: .35, irid: .25, decay: .962, dim: .3 }, ({ k }) => {
  const { W, H, u, t } = E, size = Math.min(4.4 * u, E.fw * .042);
  gitGraph(k, 172.9, 189);
  seq(38, 38, (i, lk) => glitchText(i, W / 2, H * .34, size, k * lk));
  seq(39, 39, (i, lk) => {
    TODO.forEach((s, j) => { const a = sm(0, .4, t - cues[39].a - j * .45); font(O, 1.6 * u, F.mono); O.fillStyle = '#7fa08a'; O.globalAlpha = k * lk * a * .55; O.fillText(s, (.06 + .7 * hash(j * 2.2)) * W, (.12 + .5 * hash(j * 6.6)) * H); });
    const L = para(i, W / 2, H * .4, { size: size * 1.15, style: 'italic', k: k * lk, maxW: Math.min(W * .7, E.fw * .62) });
    font(O, size, F.mono); O.fillStyle = '#7fa08a'; O.globalAlpha = k * lk; O.fillText('/*', W / 2 - L.w / 2 - size * 2.2, H * .4 - L.h / 2 + size * .5); if (t > wordsOf(39).end) O.fillText('*/', W / 2 + L.w / 2 + size * .8, H * .4 + L.h / 2 - size * .5); O.globalAlpha = 1;
  });
  seq(40, 40, (i, lk) => { glitchText(i, W / 2, H * .34, size, k * lk);
    const a = sm(0, .4, t - wordT(40, /bot/)) * k * lk; if (a > 0) { const y = H * .58, hug = sm(0, 1.2, t - wordT(40, /bug/));
      bunny(O, W / 2 - lerp(8, 2.6, hug) * u, y, 2.4 * u, 0, a); O.font = `${4 * u}px serif`; O.textAlign = 'center'; O.textBaseline = 'middle'; O.globalAlpha = a; O.fillText('🐛', W / 2 + lerp(8, 2.6, hug) * u, y);
      if (hug > .9) { font(O, 2.4 * u, F.sans); O.textAlign = 'center'; O.fillStyle = COL.pink; O.fillText('♥', W / 2, y - (5 + E.pulse) * u); } O.textAlign = 'left'; O.globalAlpha = 1; } });
});

// ============================================================ 3:08 chorus again — every ensemble at once
add(189.0, 233.7, t => { const q = sm(189, 222, t), e = sm(221, 224, t); return { fluoro: .8 * (1 - e), irid: .5 + .45 * q, swirl: .45 * q + .7 * e, drain: .5 * e, turb: 1 + .5 * q, decay: .976 }; }, ({ k }) => {
  const { t } = E, n = cueAt(t) - 41, e = sm(221.5, 228, t);
  if (n >= 4) spiral(k, .6 + .9 * e);
  if (n >= 2) stripes(k, 0);
  if (n >= 1) tickets(k * .42 * (1 - e));
  if (n >= 5) beads(k, .6);
  if (n >= 6) stars(k * (.5 + .5 * e), 0, false);
  if (e > 0) beadsStep('rise', k * e * .8);
  chorus(41, k * (1 - e * .85), true);
});

// ============================================================ 3:53 poo-tee-weet? · LGTM
add(233.7, 255.5, t => t < 243.8 ? { turb: .3, irid: .3, decay: .955, dim: .2 } : t < 252.1 ? { turb: 1.6, irid: 1, swirl: .9, zoom: .5, decay: .98 } : { decay: .88, turb: .2, dim: 1, irid: 0 }, ({ k }) => {
  const { W, H, u, t, T } = E, kk = k * (1 - sm(251.7, 252.3, t)), big = t > 243.9;
  const bq = (1 - sm(235.4, 236.4, t)) * kk;
  if (bq > 0) {
    ['Poo-', 'tee-', 'weet?'].forEach((s, j) => { const a = clamp((t - cues[49].a - j * .42) / .15); if (a <= 0) return;
      E.both((c, ink) => { font(c, 6.5 * u, F.serif, 'italic'); c.textAlign = 'center'; c.fillStyle = COL.paper; c.globalAlpha = a * bq * (ink ? .08 : 1); c.fillText(s, W / 2 + (j - 1) * 15 * u, H * .5 - j * 3.5 * u); c.textAlign = 'left'; c.globalAlpha = 1; }); });
    const fl = (Math.sin(T * 15) + 1) * 1.6 * u, bx = W / 2 + 27 * u + Math.sin(T) * 2 * u, by = H * .32 + Math.cos(T * 1.3) * u;
    O.globalAlpha = bq; O.strokeStyle = COL.paper; O.lineWidth = .35 * u; O.lineCap = 'round'; O.beginPath(); O.moveTo(bx - 4 * u, by); O.quadraticCurveTo(bx - 2 * u, by - fl - u, bx, by); O.quadraticCurveTo(bx + 2 * u, by - fl - u, bx + 4 * u, by); O.stroke(); O.globalAlpha = 1;
  }
  const c50 = cues[50].a;
  if (t > c50 - .55 && t < c50 + 1) G.once('lgtm', () => { const size = fit('LGTM', E.fw * .46, 22 * u, F.mono, 'bold');
    G.shape(c => { c.translate(W / 2, H * .5); c.rotate(-.05); font(c, size, F.mono, 'bold'); c.textAlign = 'center'; const tw = c.measureText('LGTM').width; c.fillText('LGTM', 0, 0); c.lineWidth = size * .05; rr(c, -tw / 2 - size * .25, -size * .68, tw + size * .5, size * 1.36, size * .14); c.stroke(); },
      G.N * G.N, r => c50 + .5 + r * .1, 243.82, COL.green); });
  if (t > 251.6) G.once('last', () => G.shape(c => { c.lineWidth = .5 * u; c.lineCap = 'round'; c.translate(W / 2, H / 2); c.beginPath(); for (let q = 0; q < 4; q++) { const g = q * PI / 4, r = 2 * u; c.moveTo(-Math.cos(g) * r, -Math.sin(g) * r); c.lineTo(Math.cos(g) * r, Math.sin(g) * r); } c.stroke(); }, 50000, r => 252.5 + r * .6, 254.5, COL.paper));
  if (t >= c50 && kk > 0) {
    const noA = sm(0, .15, t - c50) * (1 - sm(1.8, 2.6, t - c50));
    font(O, 5 * u, F.serif, 'italic'); O.textAlign = 'center'; O.fillStyle = COL.paper; O.globalAlpha = kk * noA; O.fillText('No—', W / 2, H * .3); O.textAlign = 'left';
    const ts = t - c50 - .55;
    if (ts > 0) { const size = fit('LGTM', E.fw * .46, 22 * u, F.mono, 'bold'), sc = (1 + .7 * Math.exp(-ts * 9)) * (1 + (big ? E.pulse * .07 : 0));
      E.both((c, ink) => { c.save(); c.translate(W / 2, H * .5); c.rotate(-.05); c.scale(sc, sc); font(c, size, F.mono, 'bold'); c.textAlign = 'center';
        const tw = c.measureText('LGTM').width; c.globalAlpha = kk * (ink ? .05 + .6 * Math.exp(-ts * 5) + (big ? .1 * E.pulse : 0) : clamp(ts / .08));
        c.fillStyle = COL.green; c.fillText('LGTM', 0, 0); c.strokeStyle = COL.green; c.lineWidth = size * .05; rr(c, -tw / 2 - size * .25, -size * .68, tw + size * .5, size * 1.36, size * .14); c.stroke(); c.restore(); c.globalAlpha = 1; });
      const s2 = 'Looks good to me.'.split(' '); font(O, 3.6 * u, F.serif, 'italic'); const tot = O.measureText(s2.join(' ')).width; let x = W / 2 - tot / 2;
      s2.forEach((w, j) => { O.globalAlpha = kk * clamp((t - c50 - 1.5 - j * .3) / .2); O.fillStyle = COL.paper; O.fillText(w, x, H * .5 + size * .95); x += O.measureText(w + ' ').width; });
      font(O, 1.5 * u, F.mono); O.textAlign = 'center'; O.fillStyle = COL.green; O.globalAlpha = kk * sm(4, 5, t - c50) * .85; O.fillText('✓ code-rabbit approved these changes', W / 2, H * .5 + size * .95 + 5 * u); O.textAlign = 'left'; O.globalAlpha = 1; }
    if (t < 251.6) callRabbits(big ? 90 : 16 * sm(1.5, 4, t - c50), big ? ptr.x : W / 2, big ? ptr.y : H * .5, big ? 22 : 34);
  }
  if (big && kk > 0) { spiral(kk, 1.3); beads(kk, .7); stars(kk * .8, 0, false);
    const n = E.beatN, col = PAL[((n % 5) + 5) % 5]; aster(I, (.1 + .8 * hash(n * 1.9)) * W, (.1 + .8 * hash(n * 4.3)) * H, (5 + 9 * hash(n * 7.1)) * u, n, col, u, kk * .6 * (1 - E.beat)); }
  const fa = sm(252.6, 253.3, t); if (fa > 0) aster(O, W / 2, H / 2, 1.6 * u, T * .3, COL.paper, .28 * u, fa * .8);
});

// ============================================================ always-on layers
const SIG = [wordT(1, /so/), wordsOf(19)[0].a, wordsOf(19)[3].a, wordsOf(44)[0].a, wordsOf(44)[3].a];
E.post.push(() => { // every "so it goes" leaves an asterisk
  const { W, H, u, t } = E; if (t > 252) return;
  SIG.forEach((ts, j) => { const d = t - ts; if (d < 0) return;
    aster(O, W - (3 + j * 2.6) * u, 3.2 * u, .8 * u, j, COL.paper, .16 * u, .55);
    if (d < 1.2) { const x = W * (.3 + .4 * hash(j * 3.1)), y = H * (.25 + .5 * hash(j * 5.9)); aster(O, x, y, (4 + d * 26) * u, d * 1.5, COL.amber, .4 * u, (1 - d / 1.2) * .9); aster(I, x, y, (4 + d * 26) * u, d * 1.5, COL.amber, 1.2 * u, (1 - d / 1.2) * .6); } });
});
E.post.push(rabbitsStep);
E.post.push(() => { const { W, H, t } = E; O.fillStyle = 'rgba(243,239,230,.22)'; O.fillRect(0, H - 1.5, W * t / E.S.dur, 1.5); });

E.go();
})();

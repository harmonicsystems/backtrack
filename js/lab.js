// ======== Lab (open with ?lab): switchable beat views on a canvas, and a readout of how the visuals line up
//          with the audio. Loaded only with ?lab (app.js imports it on demand). This whole module goes, or
//          graduates into the app, once views are chosen. Built in the "Tempo visualization options" session. ========
import { S } from './state.js';
import { ctx, fetchFile } from './audio.js';
import { clock, barIsRest, firstHit } from './groove.js';
import { clk, keep, pct, graphAt, lookahead } from './clock.js';
import { $, reduced, fill } from './ui.js';

let api = { running: () => false };

const STYLES = {dots:'Dots', steps:'Steps', count:'Count', sweep:'Sweep', ring:'Ring', pendulum:'Pendulum', bounce:'Bounce', pulse:'Pulse', lane:'Lane'};
const SKEYS = Object.keys(STYLES), QUICK = [4, 8, 16, 32, 2, 3, 6, 12, 24], SPANS = [1, 2, 4, 0], TAU = Math.PI*2;
const DIRS = {loop:'Loop', swing:'Back & forth', snake:'Snake', snakeb:'Snake + back'}, DKEYS = Object.keys(DIRS);
const lab = {style:'steps', n:16, span:1, dir:'loop', big:'always', clock:'heard', offset:0, bar:true};
const swings = () => lab.dir === 'swing' || lab.dir === 'snakeb', snakes = () => lab.dir === 'snake' || lab.dir === 'snakeb';
try{ Object.assign(lab, JSON.parse(localStorage.getItem('backtrack-lab')||'{}')); }catch(e){}
const isInt = x => Math.abs(x - Math.round(x)) < 1e-6, mod = (a, b) => ((a % b) + b) % b;

// ---- the grid: n cells spread evenly across a span of bars ----
// Accent per cell: 4 cycle start, 3 bar, 2 beat, 1 eighth, 0 finer or off the beat grid.
const grids = {};
const SYL = {2:['','&'], 3:['','trip','let'], 4:['','e','&','a'], 6:['','la','li','&','la','li'], 8:['','·','e','·','&','·','a','·']};
function grid(n, spanBars){
  const key = n + '/' + spanBars; if(grids[key]) return grids[key];
  const beats = spanBars*4, per = n/beats, cb = beats/n;          // cells per beat, beats per cell
  const lv = Array.from({length:n}, (_, i) => { const b = i*cb; return i === 0 ? 4 : isInt(b) ? (Math.round(b) % 4 === 0 ? 3 : 2) : isInt(2*b) ? 1 : 0; });
  // extra space before group starts: at beats if that makes groups of 2+, else at bars, else none
  const gl = [2, 3].find(L => { const s = lv.filter(v => v >= L).length; return s >= 2 && n/s >= 2; }) || 9;
  const syl = lv.map((_, i) => { const b = i*cb;
    if(cb >= 4 && isInt(cb/4)) return String(Math.floor(b/4 + 1e-9) + 1);   // a bar or more per cell: bar numbers
    if(!isInt(per) && !isInt(cb)) return String(i + 1);                    // a cross-rhythm: count the cells
    if(isInt(b)) return String(mod(Math.round(b), 4) + 1);
    return SYL[per] ? SYL[per][Math.round((b - Math.floor(b + 1e-9))*per)] || '·' : '·'; });
  return grids[key] = {n, spanBars, beats, per, lv, gl, syl};
}
function describe(n, spanBars){
  const cb = spanBars*4/n, hit = [[4,'one per bar'],[2,'half notes'],[1,'quarter notes, one per beat'],[.5,'eighth notes'],[.25,'sixteenth notes'],[.125,'thirty-second notes'],
    [4/3,'half-note triplets'],[2/3,'quarter-note triplets'],[1/3,'eighth-note triplets'],[1/6,'sixteenth-note triplets']].find(([v]) => Math.abs(v - cb) < 1e-6);
  return hit ? hit[1] : isInt(cb/4) ? `one per ${cb/4} bars` : 'a cross-rhythm against the beat';
}
// Cells flow in rows: the row count that gives the biggest cells wins, rows prefer to break on bars or beats,
// and groups get a little extra space. `uniform` keeps even spacing (for views where x is time).
const places = new Map();
function place(G, W, H, maxS, uniform){
  const key = [G.n, G.spanBars, W|0, H|0, maxS|0, uniform ? 1 : 0].join('/'); let L = places.get(key); if(L) return L;
  const gap = i => uniform ? .35 : .35 + (G.lv[i] >= G.gl ? .45 : 0) + (G.gl === 2 && G.lv[i] >= 3 ? .35 : 0);
  const pad = Math.min(28, W*.05, H*.08), iw = W - 2*pad, ih = H - 2*pad;
  let best = null;
  for(let R = 1; R <= Math.min(G.n, 8); R++){
    const C = Math.ceil(G.n/R); if((R - 1)*C >= G.n) continue;
    let units = 0;
    for(let r = 0; r < R; r++){ let u = 0; for(let i = r*C; i < Math.min(G.n, r*C + C); i++) u += 1 + (i > r*C ? gap(i) : 0); units = Math.max(units, u); }
    // when a bar takes more than one row, the rows that start a bar get extra space above
    const rg = Array.from({length:R}, (_, r) => r === 0 ? 0 : .5 + (G.lv[r*C] >= 3 && G.lv[C] < 3 ? .5 : 0)), tall = R + rg.reduce((a, v) => a + v, 0);
    const s = Math.min(iw/units, ih/tall, maxS);
    let score = s*(1 - .05*(R - 1));
    for(let r = 1; r < R; r++) if(G.gl < 9 && G.lv[r*C] < G.gl) score *= .7;
    const cpb = G.n/G.spanBars;                       // cells per bar: rows should split a bar evenly or hold whole bars
    if(R > 1 && isInt(cpb) && cpb % C !== 0 && C % cpb !== 0) score *= .6;
    if(!best || score > best.score) best = {R, C, s, score, rg, tall};
  }
  const {R, C, s, rg, tall} = best, cells = []; let y = (H - tall*s)/2;
  for(let r = 0; r < R; r++){
    const a = r*C, b = Math.min(G.n, a + C), xs = []; let x = 0; y += rg[r]*s;
    for(let i = a; i < b; i++){ if(i > a) x += gap(i)*s; xs.push(x); x += s; }
    xs.forEach(x0 => cells.push({x: (W - x)/2 + x0 + s/2, y: y + s/2}));
    y += s;
  }
  if(places.size > 64) places.clear();
  places.set(key, L = {R, C, s, cells}); return L;
}

// ---- one frame's worth of position: which cell, how far into it, and the onset flash ----
function frameInfo(pos, bs, lb, b, r){
  const G = grid(lab.n, lab.span || lb), spanSec = G.beats*bs, cellSec = spanSec/G.n;
  const F = {G, pos, bs, spanSec, cellSec, lb, bpm:b, rate:r, cell:-1, frac:0, abs:0, amp:0, bar0:0, cyc:0, rev:false};
  if(pos == null) return F;
  const cyc = Math.floor(pos/spanSec), cf = (pos - cyc*spanSec)/cellSec;
  F.cell = Math.min(G.n - 1, Math.floor(cf)); F.frac = cf - F.cell; F.abs = pos/cellSec; F.bar0 = cyc*G.spanBars;
  F.cyc = cyc; F.rev = swings() && mod(cyc, 2) === 1;          // back and forth: every other cycle runs the path in reverse
  F.amp = reduced ? 0 : Math.exp(-F.frac*cellSec/Math.min(.16, cellSec*.5));   // instant on the onset, then fades
  return F;
}
const cellBar = (F, i) => F.bar0 + Math.floor(i*F.G.spanBars/F.G.n + 1e-9);
const isRest = (F, i) => { const b = cellBar(F, i); return b >= 0 && barIsRest(b); };
const isCount = (F, i) => F.pos != null && cellBar(F, i) < 0;
const passed = (F, i) => i < F.cell;
// Direction. Views laid out in slots (dots, steps, count, bounce) ask which slot each cell lights: slots read
// left→right, top→bottom; snake turns every other row round; back-and-forth runs the path backwards on every
// other cycle, so the lit cell swings to and fro and turns round on "one".
const paths = new Map();
function order(F, L){
  const n = F.G.n, sn = snakes(), key = n + '/' + L.C + '/' + sn;
  let p = paths.get(key);
  if(!p){ p = Array.from({length:n}, (_, i) => { const r = Math.floor(i/L.C), a = r*L.C, len = Math.min(L.C, n - a); return sn && r % 2 ? a + len - 1 - (i - a) : i; }); paths.set(key, p); }
  const slotOf = j => { const c = Math.floor(j/n), i = mod(j, n); return p[swings() && mod(c, 2) ? n - 1 - i : i]; };   // j: cells since the first downbeat
  const at = []; for(let i = 0; i < n; i++) at[slotOf(F.cyc*n + i)] = i;                                              // slot → the cell it shows this cycle
  return {slotOf, at};
}
// Views where position is time (sweep, pulse) use points 0..n along the path: where the playhead is, and whose
// onset sits at point q this cycle (-1: the next "one", at the far end).
const travel = F => F.cell < 0 ? -1 : F.rev ? F.G.n - F.cell - F.frac : F.cell + F.frac;
const pointCell = (F, q) => { const i = F.rev ? F.G.n - q : q; return i === F.G.n ? -1 : i; };
const circle = (g, x, y, r) => { g.beginPath(); g.arc(x, y, Math.max(r, .5), 0, TAU); };
const rrect = (g, x, y, w, h, r) => { g.beginPath(); if(g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); };
// cells per swing or hop: 1 if a cell lasts `min` seconds, else a musical grouping (a beat's division, a beat, …)
function unit(F, min){
  const {n, per} = F.G, c = F.cellSec;
  if(c >= min) return 1;
  if(isInt(per)) for(let d = 2; d <= n; d++) if(n % d === 0 && (per % d === 0 || d % per === 0) && d*c >= min) return d;
  const k = Math.ceil(min/c); for(let d = k; d <= 2*k; d++) if(n % d === 0) return d;
  return k;
}

// ---- the views. Each lights up on the onset itself (no transition smear); drop-out bars are dashed, the count-in tinted. ----
let P = {};
function readPalette(){ const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
  P = {primary:v('--primary'), strong:v('--primary-strong'), soft:v('--primary-soft'), text:v('--text'), muted:v('--text-muted'), line:v('--border-color'), bg:v('--bg')}; }
const DRAW = {
  dots(g, W, H, F){                        // today's four circles, for any n
    const L = place(F.G, W, H, Math.min(180, H*.8)), O = order(F, L);
    L.cells.forEach(({x, y}, q) => {
      const i = O.at[q], lv = F.G.lv[i], on = i === F.cell, rest = isRest(F, i);
      const lw = Math.max(lv >= 3 ? 2.5 : 1.5, L.s*(lv >= 3 ? .034 : lv === 2 ? .017 : .012));
      const r = L.s/2*(lv >= 2 ? 1 : .7)*(on ? 1 + .06*F.amp : .86) - lw/2;
      circle(g, x, y, r); g.setLineDash(rest ? [Math.max(3, r*.3), Math.max(3, r*.25)] : []);
      if(on && !rest){ g.globalAlpha = isCount(F, i) ? .4 : 1; g.fillStyle = P.primary; g.fill(); }
      g.globalAlpha = on ? 1 : rest ? .35 : .45; g.strokeStyle = P.primary; g.lineWidth = lw; g.stroke();
    });
  },
  steps(g, W, H, F){                       // step sequencer: the cycle fills in and empties on "one"
    const L = place(F.G, W, H, Math.min(140, H*.8)), s = L.s*.9, O = order(F, L);
    L.cells.forEach(({x, y}, q) => {
      const i = O.at[q], lv = F.G.lv[i], on = i === F.cell, rest = isRest(F, i), k = on ? 1 + .05*F.amp : 1;
      rrect(g, x - s*k/2, y - s*k/2, s*k, s*k, s*.2);
      if(on || passed(F, i)){ g.globalAlpha = on ? (rest ? 0 : isCount(F, i) ? .45 : 1) : rest ? .08 : .2; g.fillStyle = P.primary; g.fill(); }
      g.setLineDash(rest ? [4, 4] : []); g.globalAlpha = on ? 1 : lv >= 2 ? .55 : .3;
      g.strokeStyle = P.primary; g.lineWidth = lv >= 3 ? 2.5 : 1.5; g.stroke();
    });
  },
  count(g, W, H, F){                       // the counting: 1 e & a, 1 trip let, bar numbers
    const L = place(F.G, W, H, Math.min(170, H*.8)), s = L.s, O = order(F, L);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    L.cells.forEach(({x, y}, q) => {
      const i = O.at[q], t = F.G.syl[i], on = i === F.cell, rest = isRest(F, i), big = /^\d+$/.test(t), fs = s*(big ? .62 : .44)*(on ? 1 + .08*F.amp : 1);
      if(on){ rrect(g, x - s*.48, y - s*.48, s*.96, s*.96, s*.22); g.globalAlpha = isCount(F, i) ? .5 : 1;
        if(rest){ g.setLineDash([4, 4]); g.strokeStyle = P.primary; g.lineWidth = 1.5; g.stroke(); g.setLineDash([]); } else { g.fillStyle = P.soft; g.fill(); } }
      g.font = `${on ? 600 : big ? 400 : 300} ${fs}px Inter, system-ui, sans-serif`;
      g.globalAlpha = on ? 1 : rest ? .25 : passed(F, i) ? .4 : big ? .85 : .6;
      g.fillStyle = on ? P.strong : big ? P.text : P.muted; g.fillText(t, x, y + fs*.05);
    });
  },
  sweep(g, W, H, F){                       // lanes with a playhead gliding through the ticks
    const G = F.G, n = G.n, R = G.spanBars > 1 && n % Math.min(G.spanBars, 4) === 0 ? Math.min(G.spanBars, 4) : n > 16 && n % 2 === 0 ? 2 : 1, C = n/R;
    const x0 = W*.07, lw = W*.86, gap = H/(R + 1), th = Math.min(28, gap*.3), sn = snakes();
    const tp = travel(F), from = F.rev ? n : 0;                  // the playhead's point on the path, and where this cycle set off
    const X = (q, r) => { const f = (q - r*C)/C; return x0 + (sn && r % 2 ? 1 - f : f)*lw; };
    for(let r = 0; r < R; r++){
      const a = r*C, b = a + C, y = gap*(r + 1);
      g.lineWidth = 2; g.strokeStyle = P.line;
      for(let q = a; q < b; q++){ g.setLineDash(isRest(F, F.rev ? n - 1 - q : q) ? [4, 5] : []); g.beginPath(); g.moveTo(X(q, r), y); g.lineTo(X(q + 1, r), y); g.stroke(); }
      g.setLineDash([]);
      const lo = Math.max(a, Math.min(from, tp)), hi = Math.min(b, Math.max(from, tp));
      if(tp >= 0 && hi > lo){ g.globalAlpha = isCount(F, F.cell) ? .2 : .35; g.strokeStyle = P.primary; g.lineWidth = 6; g.lineCap = 'round';
        g.beginPath(); g.moveTo(X(lo, r), y); g.lineTo(X(hi, r), y); g.stroke(); g.lineCap = 'butt'; }
      for(let q = a; q <= b; q++){
        const i = pointCell(F, q), lv = i < 0 ? 4 : G.lv[i], e = th*[.3, .45, .7, .9, 1.1][lv], on = i === F.cell, done = i >= 0 && i <= F.cell;
        if(on && F.amp > .01){ g.globalAlpha = .3*F.amp; g.fillStyle = P.primary; circle(g, X(q, r), y, e); g.fill(); }
        g.globalAlpha = on ? 1 : done ? .8 : .45; g.strokeStyle = done ? P.primary : P.muted; g.lineWidth = lv >= 3 ? 3 : 2;
        g.beginPath(); g.moveTo(X(q, r), y - e); g.lineTo(X(q, r), y + e); g.stroke();
      }
      if(tp >= 0 && Math.min(R - 1, Math.floor(tp/C)) === r){ const x = X(tp, r); g.globalAlpha = 1; g.strokeStyle = g.fillStyle = P.strong; g.lineWidth = 2;
        g.beginPath(); g.moveTo(x, y - th*1.25); g.lineTo(x, y + th*1.25); g.stroke(); circle(g, x, y, 5); g.fill(); }
      g.globalAlpha = 1;
    }
  },
  ring(g, W, H, F){                        // the cycle as a clock face, one bar (or span) per turn
    const n = F.G.n, cx = W/2, cy = H/2, R = Math.min(W, H)*.38, A = i => -Math.PI/2 + TAU*i/n, maxr = Math.min(R*.09, Math.PI*R/n*.42);
    g.strokeStyle = P.line; g.lineWidth = 2; circle(g, cx, cy, R); g.stroke();
    if(F.cell >= 0){ g.globalAlpha = isCount(F, F.cell) ? .2 : .35; g.strokeStyle = P.primary; g.lineWidth = Math.max(4, R*.05); g.lineCap = 'round';
      const e = TAU*(F.cell + F.frac)/n;                          // back and forth: every other turn runs anticlockwise; "one" stays at the top
      g.beginPath(); if(F.rev) g.arc(cx, cy, R, -Math.PI/2 - e, -Math.PI/2); else g.arc(cx, cy, R, -Math.PI/2, -Math.PI/2 + e); g.stroke(); g.lineCap = 'butt'; }
    for(let q = 0; q < n; q++){
      const i = F.rev ? mod(n - q, n) : q, lv = F.G.lv[i], on = i === F.cell, rest = isRest(F, i), r = maxr*[.45, .55, .75, 1, 1][lv]*(on ? 1 + .25*F.amp : 1);
      circle(g, cx + R*Math.cos(A(q)), cy + R*Math.sin(A(q)), r);
      if(on || passed(F, i)){ g.globalAlpha = on ? (rest ? 0 : isCount(F, i) ? .45 : 1) : rest ? .15 : .55; g.fillStyle = P.primary; }
      else { g.globalAlpha = 1; g.fillStyle = P.bg; }
      g.fill(); g.setLineDash(rest ? [3, 3] : []); g.globalAlpha = on ? 1 : .6; g.strokeStyle = P.primary; g.lineWidth = lv >= 3 ? 2.5 : 1.5; g.stroke(); g.setLineDash([]);
    }
    if(F.pos != null){ const fs = R*.5; g.globalAlpha = 1; g.fillStyle = P.text; g.font = `300 ${fs}px Inter, system-ui, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(mod(Math.floor(F.pos/F.bs), 4) + 1, cx, cy + fs*.05); }
  },
  pendulum(g, W, H, F){                    // a metronome arm: the beat is where it turns round
    const A = .52, px = W/2, py = H*.92, L = Math.min(H*.82, W*.46/Math.sin(A)), k = unit(F, .3), P2 = a => [px + L*Math.sin(a), py - L*Math.cos(a)];
    const u = F.pos == null ? .5 : F.abs/k, land = Math.floor(u), side = Math.cos(Math.PI*land) > 0 ? 1 : -1;
    const flash = reduced || F.pos == null ? 0 : Math.exp(-(u - land)*k*F.cellSec/.18)*[.5, .6, .8, 1, 1][F.G.lv[mod(land*k, F.G.n)]];
    g.strokeStyle = P.line; g.lineWidth = 2; g.beginPath(); g.arc(px, py, L, -Math.PI/2 - A, -Math.PI/2 + A); g.stroke();
    g.fillStyle = P.muted; g.globalAlpha = .7;
    for(let j = 1; j < k; j++){ const [x, y] = P2(A*Math.cos(Math.PI*j/k)); circle(g, x, y, 2.5); g.fill(); }   // subdivisions, passed on time
    for(const s of [-1, 1]){ const [x, y] = P2(s*A), f = s === side ? flash : 0;
      g.globalAlpha = .35 + .65*f; g.fillStyle = P.primary; circle(g, x, y, L*.045*(1 + .35*f)); g.fill(); }
    const [bx, by] = P2(A*Math.cos(Math.PI*u)), rest = F.cell >= 0 && isRest(F, F.cell);
    g.globalAlpha = F.cell >= 0 && isCount(F, F.cell) ? .5 : 1; g.strokeStyle = P.primary; g.lineWidth = 3; g.setLineDash(rest ? [6, 6] : []);
    g.beginPath(); g.moveTo(px, py); g.lineTo(bx, by); g.stroke(); g.setLineDash([]);
    circle(g, bx, by, L*.055); if(rest){ g.fillStyle = P.bg; g.fill(); g.lineWidth = 2.5; g.stroke(); } else { g.fillStyle = P.primary; g.fill(); }
    circle(g, px, py, 5); g.fillStyle = P.primary; g.fill();
  },
  bounce(g, W, H, F){                      // a ball that lands on the beat, so you see it coming
    const L = place(F.G, W, H*.72, Math.min(110, H*.4)), s = L.s, oy = H*.22, k = unit(F, .2), O = order(F, L);
    const pad = q => ({x: L.cells[q].x, y: L.cells[q].y + oy + s*.3});
    g.lineCap = 'round';
    L.cells.forEach((_, q) => { const i = O.at[q], {x, y} = pad(q), lv = F.G.lv[i], w = s*[.3, .38, .5, .62, .62][lv];
      g.setLineDash(isRest(F, i) ? [3, 4] : []); g.globalAlpha = passed(F, i) || i === F.cell ? .9 : .4; g.strokeStyle = P.primary; g.lineWidth = lv >= 3 ? 4 : lv === 2 ? 3 : 2;
      g.beginPath(); g.moveTo(x - w/2, y); g.lineTo(x + w/2, y); g.stroke(); });
    g.setLineDash([]); g.lineCap = 'butt';
    if(F.pos == null) return;
    const h = Math.floor(F.abs/k), u = F.abs/k - h, a = pad(O.slotOf(h*k)), b = pad(O.slotOf((h + 1)*k)), br = Math.max(4, s*.13);   // turning round, it hops in place
    const x = a.x + (b.x - a.x)*u, y = a.y + (b.y - a.y)*u - Math.min(s*1.4, oy + s*.4)*4*u*(1 - u) - br, land = reduced ? 0 : Math.exp(-u*k*F.cellSec/.15);
    if(land > .01){ g.globalAlpha = .25*land; g.fillStyle = P.primary; circle(g, a.x, a.y, br*2.4); g.fill(); }
    g.globalAlpha = isCount(F, F.cell) ? .5 : 1; circle(g, x, y, br);
    if(isRest(F, F.cell)){ g.strokeStyle = P.primary; g.lineWidth = 2; g.stroke(); } else { g.fillStyle = P.primary; g.fill(); }
  },
  pulse(g, W, H, F){                       // a calm glow, strongest on "one", plus where you are in the cycle
    const cx = W/2, cy = H*.45, R0 = Math.min(W, H)*.3, i = F.cell, n = F.G.n, w = i >= 0 ? [.3, .45, .7, 1, 1][F.G.lv[i]] : 0;
    const rest = i >= 0 && isRest(F, i), a = reduced ? .5*w : F.amp*w;
    if(!rest){ g.globalAlpha = .06*a; g.fillStyle = P.primary; g.fillRect(0, 0, W, H); }
    circle(g, cx, cy, R0*(1 + .1*a));
    if(!rest){ g.globalAlpha = (i >= 0 && isCount(F, i) ? .5 : 1)*(.1 + .45*a); g.fillStyle = P.primary; g.fill(); }
    g.setLineDash(rest ? [6, 6] : []); g.globalAlpha = .45; g.strokeStyle = P.primary; g.lineWidth = 2; g.stroke(); g.setLineDash([]);
    const x0 = W*.2, bw = W*.6, y = Math.min(H - 16, cy + R0*1.35), X = q => x0 + bw*q/n, tp = travel(F);
    g.globalAlpha = 1; g.strokeStyle = P.line; g.lineWidth = 2; g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + bw, y); g.stroke();
    if(i >= 0){ g.strokeStyle = P.primary; g.globalAlpha = .6; g.lineWidth = 4; g.beginPath(); g.moveTo(X(F.rev ? n : 0), y); g.lineTo(X(tp), y); g.stroke(); }
    g.lineWidth = 1.5;
    for(let q = 0; q <= n; q++){ const j = pointCell(F, q), e = [2, 3, 5, 7, 7][j < 0 ? 4 : F.G.lv[j]], done = j >= 0 && j <= i;
      g.globalAlpha = done ? .9 : .4; g.strokeStyle = done ? P.primary : P.muted;
      g.beginPath(); g.moveTo(X(q), y - e); g.lineTo(X(q), y + e); g.stroke(); }
  },
  lane(g, W, H, F){                        // the drums themselves scrolling under a "now" line; the grid is the ruler
    const nowX = W*.25, mid = H/2, h = H*.32, pps = W/F.spanSec, t = F.pos ?? 0, n = F.G.n, c = F.cellSec;
    const E = laneEnv(F.bpm);
    if(E){                                  // high band (snare, hats) above the line, low band (kick) below; drop-out bars ghosted
      const loopLen = F.lb*240/F.bpm, step = 2, dj = Math.max(1, Math.round(step/pps*F.rate/E.hop)), paths = {};
      for(let x = 0; x < W; x += step){
        const tt = t + (x - nowX)/pps; if(tt < 0) continue;
        const j = Math.floor((E.start + mod(tt*F.rate, loopLen))/E.hop); let hi = 0, lo = 0;
        for(let q = j, qe = Math.min(j + dj, E.hi.length); q < qe; q++){ if(E.hi[q] > hi) hi = E.hi[q]; if(E.lo[q] > lo) lo = E.lo[q]; }
        const key = (x < nowX ? 'p' : 'f') + (barIsRest(Math.floor(tt/(4*F.bs))) ? 'r' : '');
        (paths[key + 'h'] ||= new Path2D()).rect(x, mid - hi*h, 1.6, hi*h);
        (paths[key + 'l'] ||= new Path2D()).rect(x, mid, 1.6, lo*h);
      }
      for(const [key, p] of Object.entries(paths)){ g.globalAlpha = (key[0] === 'p' ? .35 : .9)*(key[1] === 'r' ? .2 : 1);
        g.fillStyle = key.endsWith('h') ? P.primary : P.strong; g.fill(p); }
    } else if(E === null){ g.globalAlpha = .7; g.fillStyle = P.muted; g.font = '13px Inter, system-ui, sans-serif'; g.textAlign = 'left'; g.fillText('Reading the groove…', nowX + 10, mid - h*1.15); }
    for(let j = Math.ceil((t - nowX/pps)/c); j*c <= t + (W - nowX)/pps; j++){   // the grid, drawn over the drums as a ruler
      const x = nowX + (j*c - t)*pps, lv = F.G.lv[mod(j, n)], e = h*[.35, .5, .75, 1, 1.15][lv], bar = Math.floor(j*c/(4*F.bs) + 1e-9);
      g.setLineDash(bar >= 0 && barIsRest(bar) ? [3, 4] : []); g.globalAlpha = [.3, .4, .55, .8, .9][lv];
      g.strokeStyle = lv >= 3 ? P.strong : P.muted; g.lineWidth = lv >= 3 ? 2 : 1;
      g.beginPath(); g.moveTo(x, mid - e); g.lineTo(x, mid + e); g.stroke();
    }
    g.setLineDash([]);
    if(F.cell >= 0 && F.amp > .01){ g.globalAlpha = .25*F.amp*[.4, .5, .7, 1, 1][F.G.lv[F.cell]]; g.fillStyle = P.primary; circle(g, nowX, mid, h*.5); g.fill(); }
    g.globalAlpha = 1; g.strokeStyle = P.strong; g.lineWidth = 2; g.beginPath(); g.moveTo(nowX, mid - h*1.25); g.lineTo(nowX, mid + h*1.25); g.stroke();
  },
};
// Lane's drum envelope: the loop decoded on its own (an OfflineAudioContext needs no tap), 4 ms RMS in two bands.
const envs = {};
function laneEnv(b){
  if(b in envs) return envs[b];
  envs[b] = null;
  const OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  fetchFile('drums-' + b).then(ab => new OC(1, 1, 48000).decodeAudioData(ab.slice(0))).then(buf => {
    const d = buf.getChannelData(0), sr = buf.sampleRate, hop = Math.round(sr*.004), m = Math.floor(d.length/hop), a = 1 - Math.exp(-TAU*150/sr);
    const lo = new Float32Array(m), hi = new Float32Array(m); let lp = 0, mlo = 1e-9, mhi = 1e-9;
    for(let j = 0; j < m; j++){ let sl = 0, sh = 0;
      for(let i = j*hop, e = i + hop; i < e; i++){ lp += a*(d[i] - lp); const x = d[i] - lp; sl += lp*lp; sh += x*x; }
      lo[j] = Math.sqrt(sl/hop); hi[j] = Math.sqrt(sh/hop); if(lo[j] > mlo) mlo = lo[j]; if(hi[j] > mhi) mhi = hi[j]; }
    for(let j = 0; j < m; j++){ lo[j] = Math.pow(lo[j]/mlo, 1.5); hi[j] = Math.pow(hi[j]/mhi, 1.5); }   // shrink the ring-outs so the hits stand up
    envs[b] = {lo, hi, hop: hop/sr, start: firstHit(buf)};
  }).catch(() => { envs[b] = false; });
  return null;
}

// ---- drawing: sizes come from a ResizeObserver so the frame loop never reads layout ----
const sizes = new Map(), ro = window.ResizeObserver ? new ResizeObserver(es => { for(const e of es) sizes.set(e.target, [e.contentRect.width, e.contentRect.height]); }) : null;
function drawViz(cv, F){
  const [w, h] = sizes.get(cv) || [0, 0]; if(!w || !h) return;
  const dpr = Math.min(2, devicePixelRatio || 1), W = Math.round(w*dpr), H = Math.round(h*dpr);
  if(cv.width !== W || cv.height !== H){ cv.width = W; cv.height = H; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  g.globalAlpha = 1; g.setLineDash([]); g.lineCap = 'butt';
  DRAW[lab.style](g, w, h, F);
}
const bigCv = $('bigviz'), prevCv = $('prevviz'), labbar = $('labbar');
const landscape = matchMedia('(orientation: landscape) and (max-height: 520px)');
const bigOn = () => lab.big === 'always' || document.documentElement.dataset.theme === 'night' || landscape.matches;
let diagAt = 0; const drawMs = [];
export function labFrame(pos, perf){
  if(!clock.beatSec) return;                         // the groove never loaded (Offline): nothing to draw against
  if(bigOn()){ drawViz(bigCv, frameInfo(pos, clock.beatSec, clock.loopBars, S.bpm, clock.rate)); keep(drawMs, performance.now() - perf, 240); }
  if(perf - diagAt > 500){ diagAt = perf; labDiag(); }
}
function labDiag(){
  clk.frame = Math.min(50, Math.max(4, pct(clk.frames, .5) || 1000/60));
  const ms = v => Math.round(v*1000), slow = clk.frames.filter(d => d > clk.frame*1.5).length;
  const t = `${Math.round(1000/clk.frame)} fps · ${slow} of ${clk.frames.length} frames slow · frame work ${pct(drawMs, .95).toFixed(1)} ms · audio clock steps up to ${pct(clk.jit, .95).toFixed(1)} ms\n` +
    `output latency ${clk.ts != null ? ms(clk.ts) + ' ms by timestamp · ' : ''}${ms(clk.rep)} ms reported · ${ctx.sampleRate/1000} kHz\n` +
    (clk.mode === 'raw' ? 'raw clock: the visuals run early by the latency' : `visuals held back ${Math.round(clk.lat*1000 + clk.offset - lookahead())} ms`);
  $('labdiag').textContent = t; $('lcarddiag').textContent = 'Last run:\n' + t;
}
// silent preview in the Lab tab, on performance.now(), while stopped and on screen
let prevRaf = 0, prevVisible = false; const prevStart = performance.now();
function previewLoop(perf){
  prevRaf = 0;
  if(api.running() || !prevVisible || document.hidden) return;
  const r = 1 + S.fine/100;
  drawViz(prevCv, frameInfo((perf - prevStart)/1000, 60/S.bpm/r, +S.bars, S.bpm, r));
  prevRaf = requestAnimationFrame(previewLoop);
}
export function kickPreview(){ if(!prevRaf && !api.running() && prevVisible && !document.hidden) prevRaf = requestAnimationFrame(previewLoop); }
// Tap the beat you hear: each tap's delay after its beat on the audio clock, median of 6+, becomes the offset.
const taps = [];
function labTap(perf){
  const el = $('lb-tap');
  if(!api.running() || clk.k == null || !clock.beatSec) return;
  const p = graphAt(perf) - clock.t0; if(p < 0) return;
  if(taps.length && perf - taps[taps.length - 1].perf > 2500) taps.length = 0;   // a pause starts a fresh measurement
  taps.push({perf, d: mod(p + .1, clock.beatSec) - .1}); if(taps.length > 12) taps.shift();
  if(taps.length < 6){ el.textContent = `Tap ${taps.length} of 6`; return; }
  const m = pct(taps.map(t => t.d), .5);
  labSet({clock:'heard', offset: Math.round((m - clk.lat)*200)*5});
  el.textContent = `Heard +${Math.round(m*1000)} ms`;
}
export function labReset(){ taps.length = drawMs.length = 0; $('lb-tap').textContent = 'Tap the beat'; diagAt = 0; }
const spanName = (sb, short) => lab.span ? (sb === 1 ? '1 bar' : sb + ' bars') : short ? `loop (${sb})` : `the ${sb}-bar loop`;
function labSet(p){
  Object.assign(lab, p);
  lab.n = Math.max(2, Math.min(32, Math.round(+lab.n) || 16)); lab.offset = Math.max(-100, Math.min(400, Math.round(+lab.offset) || 0));
  if(!STYLES[lab.style]) lab.style = 'steps'; if(!SPANS.includes(lab.span)) lab.span = 1; if(!DIRS[lab.dir]) lab.dir = 'loop';
  try{ localStorage.setItem('backtrack-lab', JSON.stringify(lab)); }catch(e){}
  clk.mode = lab.clock === 'raw' ? 'raw' : 'heard'; clk.offset = lab.offset;
  document.body.classList.toggle('lab-always', lab.big === 'always'); labbar.classList.toggle('min', !lab.bar);
  document.querySelectorAll('#lstyles [data-style]').forEach(b => b.setAttribute('aria-pressed', b.dataset.style === lab.style));
  document.querySelectorAll('#lquick [data-n]').forEach(b => b.setAttribute('aria-pressed', +b.dataset.n === lab.n));
  const gridIn = $('lgrid'), offIn = $('loffset'), sb = lab.span || +S.bars, note = describe(lab.n, sb), off = (lab.offset > 0 ? '+' : '') + lab.offset + ' ms';
  gridIn.value = lab.n; fill(gridIn); $('lgridout').textContent = lab.n; offIn.value = lab.offset; fill(offIn); $('loffsetout').textContent = off;
  $('lspan').value = lab.span; $('ldir').value = lab.dir; $('lb-dir').textContent = DIRS[lab.dir]; $('lbig').value = lab.big; $('lclock').value = clk.mode;
  $('lnote').innerHTML = `<b>${lab.n} across ${spanName(sb)}</b> · ${note}`;
  $('lb-style').textContent = STYLES[lab.style]; $('lb-n').textContent = lab.n; $('lb-span').textContent = spanName(sb, true);
  $('lb-off').textContent = clk.mode === 'raw' ? 'raw clock' : off; $('bhint').textContent = `${note} · tap anywhere else to stop`;
  kickPreview();
}
function labAct(k, d){
  if(k === 'style') labSet({style: SKEYS[mod(SKEYS.indexOf(lab.style) + d, SKEYS.length)]});
  else if(k === 'n') labSet({n: lab.n + d});
  else if(k === 'nq') labSet({n: QUICK[(QUICK.indexOf(lab.n) + 1) % QUICK.length]});
  else if(k === 'span') labSet({span: SPANS[(SPANS.indexOf(lab.span) + 1) % SPANS.length]});
  else if(k === 'dir') labSet({dir: DKEYS[(DKEYS.indexOf(lab.dir) + 1) % DKEYS.length]});
  else if(k === 'off') labSet({clock: 'heard', offset: lab.offset + d});
  else if(k === 'clock') labSet({clock: clk.mode === 'raw' ? 'heard' : 'raw'});
  else if(k === 'hide' || k === 'show') labSet({bar: k === 'show'});
}

// Called once by app.js when the page was opened with ?lab. `a.running()` is the transport's playing flag.
export function initLab(a){
  api = a;
  document.body.classList.add('lab'); $('tab-lab').hidden = false; labbar.hidden = false;
  if(ro) [bigCv, prevCv].forEach(c => ro.observe(c));
  readPalette();
  new MutationObserver(readPalette).observe(document.documentElement, {attributes:true, attributeFilter:['data-theme']});
  try{ matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readPalette); }catch(e){}
  $('lstyles').innerHTML = SKEYS.map(k => `<button class="btn" data-style="${k}">${STYLES[k]}</button>`).join('');
  $('lquick').innerHTML = QUICK.map(n => `<button class="btn" data-n="${n}">${n}</button>`).join('');
  $('lstyles').addEventListener('click', e => { const b = e.target.closest('[data-style]'); if(b) labSet({style: b.dataset.style}); });
  $('lquick').addEventListener('click', e => { const b = e.target.closest('[data-n]'); if(b) labSet({n: +b.dataset.n}); });
  $('lgrid').addEventListener('input', () => labSet({n: +$('lgrid').value}));
  $('lspan').addEventListener('change', () => labSet({span: +$('lspan').value}));
  $('ldir').addEventListener('change', () => labSet({dir: $('ldir').value}));
  $('lbig').addEventListener('change', () => labSet({big: $('lbig').value}));
  $('lclock').addEventListener('change', () => labSet({clock: $('lclock').value}));
  $('loffset').addEventListener('input', () => labSet({offset: +$('loffset').value}));
  $('bars').addEventListener('change', () => labSet({})); addEventListener('hashchange', () => labSet({}));   // after app.js has updated S
  labbar.addEventListener('click', e => { const b = e.target.closest('[data-l]'); if(b) labAct(b.dataset.l, +b.dataset.d || 0); });
  $('lb-tap').addEventListener('pointerdown', e => labTap(e.timeStamp));
  new IntersectionObserver(es => { prevVisible = es[es.length - 1].isIntersecting; kickPreview(); }).observe(prevCv);
  document.addEventListener('visibilitychange', kickPreview);
  // keys while playing: ←/→ view, ↑/↓ grid, S span, D direction, C timing mode, [ ] offset, T tap the beat
  const LABKEYS = {ArrowRight:['style', 1], ArrowLeft:['style', -1], ArrowUp:['n', 1], ArrowDown:['n', -1], s:['span'], d:['dir'], c:['clock'], '[':['off', -5], ']':['off', 5]};
  addEventListener('keydown', e => {
    if(!api.running() || e.metaKey || e.ctrlKey || /INPUT|SELECT/.test(e.target.tagName)) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if(k === 't'){ if(!e.repeat) labTap(e.timeStamp); } else if(LABKEYS[k]) labAct(...LABKEYS[k]); else return;
    e.preventDefault();
  });
  labSet({});
}
// ======== end of lab ========

// The beat views: canvas pictures of where you are in the groove, drawn from the timeline every frame. Graduated
// from the beat-view lab (js/lab.js, which still uses them with its extra controls). Each view lights up on the onset
// itself (no transition smear); drop-out bars are dashed, the count-in tinted. Colours come from the theme tokens, so
// day, dark and night (dim red) all follow, and a canvas is sized from its own box, so night mode's rotated layout
// draws crisply too.
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
import { fetchFile } from './audio.js';
import { firstHit } from './groove.js';
import { isInt, mod, grid, place } from './grid.js';

export const STYLES = {dots:'Dots', steps:'Steps', count:'Count', sweep:'Sweep', ring:'Ring', pendulum:'Pendulum', bounce:'Bounce', pulse:'Pulse', lane:'Lane'};
// Sway: side to side on the beat across the whole width (the lab doesn't list them: they don't use its grid)
export const SWAYS = {glide:'Glide', arc:'Arc', lights:'Light bar', loop:'Infinity'};
export const DIRS = {loop:'Loop', swing:'Back & forth', snake:'Snake', snakeb:'Snake + back'};
const TAU = Math.PI*2;

// ---- one frame's worth of position, from the timeline: which of the view's n cells (spread over spanBars bars) is
//      sounding, how far into it, the cycle, and the onset flash. Works through tempo ramps (the timeline's bars are
//      exact) and for any n (cross-rhythms: 3 across a bar of 4). rest(bar) says whether a bar is a drop-out. ----
const F0 = {G:null, tl:null, pos:null, bs:.5, spanSec:2, cellSec:.125, lb:16, bpm:96, rate:1, drums:true, cell:-1, frac:0, abs:0, amp:0, bar0:0, cyc:0,
  pulse:0, beatPos:0, beatSec:.5, beats:4, pace:1, ease:'smooth', rev:false, swing:false, snake:false, rest: () => false};
// o = { n, span, dir, rest, lb, G }: pass G (the grid for n, span) when you have it cached; one reused frame object, so
// the frame loop allocates nothing here.
export function frameAt(tl, pos, o){
  const { n, span } = o, M = tl.meter, G = o.G || grid(n, span, M), F = F0, dir = o.dir || 'loop';
  F.G = G; F.tl = tl; F.pos = pos; F.lb = o.lb || 16; F.bpm = tl.setup.bpm; F.drums = tl.setup.sound !== 'click'; F.rest = o.rest || F0rest;
  F.swing = dir === 'swing' || dir === 'snakeb'; F.snake = dir === 'snake' || dir === 'snakeb';
  const w = tl.at(pos == null ? 0 : pos);
  F.bs = w.barSec/M.top; F.spanSec = w.barSec*span; F.cellSec = F.spanSec/n; F.rate = tl.rateOf(Math.max(0, w.bar)); F.pulse = w.pulse;
  F.beats = w.beats; F.beatSec = w.barSec/w.beats; F.beatPos = w.bar*w.beats + w.beat + w.beatFrac;   // felt beats since the first downbeat
  F.pace = o.pace === 'bar' ? w.beats : +o.pace || 1; F.ease = o.ease || 'smooth';
  if(pos == null){ F.cell = -1; F.frac = F.abs = F.amp = 0; F.bar0 = F.cyc = 0; F.rev = false; return F; }
  const cyc = Math.floor(w.bar/span), inSpan = (w.bar - cyc*span + w.frac)*n/span;
  F.cell = Math.min(n - 1, Math.floor(inSpan + 1e-9)); F.frac = inSpan - F.cell; F.abs = (w.bar + w.frac)*n/span;
  F.bar0 = cyc*span; F.cyc = cyc; F.rev = F.swing && mod(cyc, 2) === 1;   // back and forth: every other cycle runs the path in reverse
  F.amp = reduced ? 0 : Math.exp(-F.frac*F.cellSec/Math.min(.16, F.cellSec*.5));   // instant on the onset, then fades
  return F;
}
const F0rest = () => false;
const cellBar = (F, i) => F.bar0 + Math.floor(i*F.G.spanBars/F.G.n + 1e-9);
const isRest = (F, i) => { const b = cellBar(F, i); return b >= 0 && F.rest(b); };
const isCount = (F, i) => F.pos != null && cellBar(F, i) < 0;
const passed = (F, i) => i < F.cell;
// Direction. Views laid out in slots (dots, steps, count, bounce) ask which slot each cell lights: slots read
// left→right, top→bottom; snake turns every other row round; back-and-forth runs the path backwards on every
// other cycle, so the lit cell swings to and fro and turns round on "one".
const paths = new Map();
const orders = new Map();                                            // cached per layout, direction and cycle parity
function order(F, L){
  const n = F.G.n, sn = F.snake, sw = F.swing, odd = sw && mod(F.cyc, 2) === 1, key = ((n*64 + L.C)*2 + (sn ? 1 : 0))*4 + (sw ? 2 : 0) + (odd ? 1 : 0);
  let o = orders.get(key); if(o) return o;
  const pk = (n*64 + L.C)*2 + (sn ? 1 : 0);
  let p = paths.get(pk);
  if(!p){ p = Array.from({length:n}, (_, i) => { const r = Math.floor(i/L.C), a = r*L.C, len = Math.min(L.C, n - a); return sn && r % 2 ? a + len - 1 - (i - a) : i; }); paths.set(pk, p); }
  const slotOf = j => { const c = Math.floor(j/n), i = mod(j, n); return p[sw && mod(c, 2) ? n - 1 - i : i]; };   // j: cells since the first downbeat
  const at = []; for(let i = 0; i < n; i++) at[slotOf((odd ? 1 : 0)*n + i)] = i;                                   // slot → the cell it shows this cycle
  if(orders.size > 64) orders.clear();
  orders.set(key, o = {slotOf, at}); return o;
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
export function readPalette(){ const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
  P = {primary:v('--primary'), strong:v('--primary-strong'), soft:v('--primary-soft'), text:v('--text'), muted:v('--text-muted'), line:v('--border-color'), bg:v('--bg')}; }
export const DRAW = {
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
    const x0 = W*.07, lw = W*.86, gap = H/(R + 1), th = Math.min(28, gap*.3), sn = F.snake;
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
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(F.pulse + 1, cx, cy + fs*.05); }
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
    const nowX = W*.25, mid = H/2, h = H*.32, pps = W/F.spanSec, t = F.pos ?? 0, n = F.G.n, c = F.cellSec, tl = F.tl;
    const E = F.drums ? laneEnv(F.bpm) : false;     // click only: no drum picture, just the ruler
    if(E){                                  // high band (snare, hats) above the line, low band (kick) below; drop-out bars ghosted
      const barBuf = 240/F.bpm, step = 2, dj = Math.max(1, Math.round(step/pps*F.rate/E.hop)), paths = {};
      for(let x = 0; x < W; x += step){
        const tt = t + (x - nowX)/pps; if(tt < 0) continue;
        const w = tl.at(tt), b = w.bar, j = Math.floor((E.start + (mod(b, F.lb) + w.frac)*barBuf)/E.hop); let hi = 0, lo = 0;   // the loop plays one buffer-bar per bar, whatever the rate
        for(let q = j, qe = Math.min(j + dj, E.hi.length); q < qe; q++){ if(E.hi[q] > hi) hi = E.hi[q]; if(E.lo[q] > lo) lo = E.lo[q]; }
        const key = (x < nowX ? 'p' : 'f') + (F.rest(b) ? 'r' : '');
        (paths[key + 'h'] ||= new Path2D()).rect(x, mid - hi*h, 1.6, hi*h);
        (paths[key + 'l'] ||= new Path2D()).rect(x, mid, 1.6, lo*h);
      }
      for(const [key, p] of Object.entries(paths)){ g.globalAlpha = (key[0] === 'p' ? .35 : .9)*(key[1] === 'r' ? .2 : 1);
        g.fillStyle = key.endsWith('h') ? P.primary : P.strong; g.fill(p); }
    } else if(E === null){ g.globalAlpha = .7; g.fillStyle = P.muted; g.font = '13px Inter, system-ui, sans-serif'; g.textAlign = 'left'; g.fillText('Reading the groove…', nowX + 10, mid - h*1.15); }
    const tick = (x, lv, rest) => { const e = h*[.35, .5, .75, 1, 1.15][lv];
      g.setLineDash(rest ? [3, 4] : []); g.globalAlpha = [.3, .4, .55, .8, .9][lv];
      g.strokeStyle = lv >= 3 ? P.strong : P.muted; g.lineWidth = lv >= 3 ? 2 : 1;
      g.beginPath(); g.moveTo(x, mid - e); g.lineTo(x, mid + e); g.stroke(); };
    const span = F.G.spanBars, cpb = n/span;            // the grid, drawn over the drums as a ruler: bar by bar from the timeline
    if(isInt(cpb)) for(let b = tl.at(t - nowX/pps).bar, bR = tl.at(t + (W - nowX)/pps).bar; b <= bR; b++){
      const bs = tl.barStart(b), bsec = tl.barSecOf(b), rest = b >= 0 && F.rest(b);
      for(let i = 0; i < cpb; i++){ const x = nowX + (bs + i*bsec/cpb - t)*pps; if(x >= -2 && x <= W + 2) tick(x, F.G.lv[mod(b, span)*cpb + i], rest); }
    }
    else for(let j = Math.ceil((t - nowX/pps)/c); j*c <= t + (W - nowX)/pps; j++){   // a cross-rhythm (lab): evenly from the current cell length
      const bar = Math.floor(j*c/(F.G.top*F.bs) + 1e-9); tick(nowX + (j*c - t)*pps, F.G.lv[mod(j, n)], bar >= 0 && F.rest(bar)); }
    g.setLineDash([]);
    if(F.cell >= 0 && F.amp > .01){ g.globalAlpha = .25*F.amp*[.4, .5, .7, 1, 1][F.G.lv[F.cell]]; g.fillStyle = P.primary; circle(g, nowX, mid, h*.5); g.fill(); }
    g.globalAlpha = 1; g.strokeStyle = P.strong; g.lineWidth = 2; g.beginPath(); g.moveTo(nowX, mid - h*1.25); g.lineTo(nowX, mid + h*1.25); g.stroke();
  },
  glide(g, W, H, F){ sway(g, W, H, F, 'glide'); },
  arc(g, W, H, F){ sway(g, W, H, F, 'arc'); },
  lights(g, W, H, F){ sway(g, W, H, F, 'lights'); },
  loop(g, W, H, F){ sway(g, W, H, F, 'loop'); },
};

// ---- Sway: one thing moving side to side across the whole screen, arriving at an edge exactly on the beat — something
//      calm to follow with your eyes (the idea comes from the side-to-side movement of EMDR apps). F.pace = beats per
//      side; F.ease 'smooth' slows into each turn, 'even' keeps one speed like a light bar, 'still' doesn't travel at
//      all (the side it's on, lit). The movement is the point of these pictures, so the phone's Reduce Motion doesn't
//      stop it (it did, and on David's phone Sway only jumped side to side); it only drops the arrival glow. ----
let loopPath = null, loopKey = '';
function sway(g, W, H, F, kind){
  const s = F.pos == null ? 0 : F.beatPos/F.pace, k = Math.floor(s), f = s - k;   // sides since the first downbeat
  const e = F.ease === 'even' || kind === 'arc' ? f : .5 - .5*Math.cos(Math.PI*f), right = mod(k, 2) === 1;
  const x = right ? 1 - e : e;                                                         // 0 = left edge … 1 = right edge
  const r = Math.max(8, Math.min(H*.075, W*.045)), x0 = r*2.4, x1 = W - r*2.4, X = u => x0 + (x1 - x0)*u, cy = H/2;
  const rest = F.cell >= 0 && isRest(F, F.cell), count = F.cell >= 0 && isCount(F, F.cell);
  const land = reduced || F.pos == null ? 0 : Math.exp(-f*F.pace*F.beatSec/.25);     // the glow where it just arrived
  const strong = mod(Math.round(k*F.pace), F.beats) === 0 ? 1 : .6;                  // arriving on "one"
  const base = kind === 'arc' ? H*.72 : cy, end = right ? x1 : x0;
  const ball = (bx, by, rr) => { circle(g, bx, by, rr); g.globalAlpha = count ? .5 : 1;
    if(rest){ g.setLineDash([Math.max(3, rr*.35), Math.max(3, rr*.3)]); g.strokeStyle = P.primary; g.lineWidth = 2; g.stroke(); g.setLineDash([]); }
    else { g.fillStyle = P.primary; g.fill(); } };
  if(F.ease === 'still'){                                                               // no travel: the side it's on
    for(const [u, on] of [[0, !right], [1, right]]){ circle(g, X(u), cy, r); g.globalAlpha = on ? (count ? .5 : 1) : .18;
      g.fillStyle = P.primary; g.fill(); }
    return;
  }
  // the ends: a mark at each side, glowing when it arrives
  if(kind !== 'lights') for(const ex of [x0, x1]){ const lit = ex === end ? land*strong : 0;
    g.globalAlpha = .18 + .5*lit; g.fillStyle = P.primary; circle(g, ex, base, r*(.35 + .9*lit)); g.fill(); }
  if(kind === 'glide'){
    g.globalAlpha = .25; g.strokeStyle = P.line; g.lineWidth = 2; g.beginPath(); g.moveTo(x0, cy); g.lineTo(x1, cy); g.stroke();
    ball(X(x), cy, r);
  } else if(kind === 'arc'){                                                            // a bounce: lands on each side on the beat
    const hgt = Math.min(H*.42, (x1 - x0)*.3), y = base - hgt*4*f*(1 - f);
    g.globalAlpha = .25; g.strokeStyle = P.line; g.lineWidth = 2; g.beginPath(); g.moveTo(x0, base + r); g.lineTo(x1, base + r); g.stroke();
    g.globalAlpha = .12 + .1*(1 - (base - y)/hgt); g.fillStyle = P.primary;            // its shadow on the floor
    g.beginPath(); g.ellipse(X(x), base + r, r*(1.1 - .5*(base - y)/hgt), r*.28, 0, 0, TAU); g.fill();
    ball(X(x), y, r);
  } else if(kind === 'lights'){                                                         // a light bar: the lit lamp travels, a soft trail behind
    const N = Math.max(11, Math.min(31, Math.round((x1 - x0)/(r*1.6)) | 1)), lr = r*.42, dir = right ? -1 : 1;
    for(let i = 0; i < N; i++){ const u = i/(N - 1), d = (u - x)*(N - 1), behind = d*dir < 0;
      const b = Math.max(0, 1 - Math.abs(d)/(behind ? 2.6 : 1.1));
      circle(g, X(u), cy, lr*(1 + .7*b)); g.globalAlpha = (count ? .5 : 1)*(.12 + .88*b);
      if(rest && b > .5){ g.setLineDash([3, 3]); g.strokeStyle = P.primary; g.lineWidth = 2; g.stroke(); g.setLineDash([]); }
      else { g.fillStyle = P.primary; g.fill(); } }
  } else {                                                                              // Infinity: a sideways figure eight
    const A = (x1 - x0)/2, B = Math.min(H*.3, A*.5), cx = (x0 + x1)/2, key = W + 'x' + H;
    if(key !== loopKey){ loopKey = key; loopPath = new Path2D(); for(let i = 0; i <= 96; i++){ const t = TAU*i/96;
      const px = cx - A*Math.cos(t), py = cy + B*Math.sin(2*t); if(i) loopPath.lineTo(px, py); else loopPath.moveTo(px, py); } }
    g.globalAlpha = .25; g.strokeStyle = P.line; g.lineWidth = 2; g.stroke(loopPath);
    const t = Math.PI*(k + e);                                                          // left at even sides, right at odd, crossing in the middle
    ball(cx - A*Math.cos(t), cy + B*Math.sin(2*t), r);
  }
}
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


// ---- drawing: sizes come from a ResizeObserver (content box, so a canvas inside the turned (rotated) layout gets its
//      own width and height), so the frame loop never reads layout ----
const sizes = new Map(), ro = window.ResizeObserver ? new ResizeObserver(es => { for(const e of es) sizes.set(e.target, [e.contentRect.width, e.contentRect.height]); }) : null;
export function observe(cv){ if(ro) ro.observe(cv); }
export function drawViz(cv, style, F){
  const [w, h] = sizes.get(cv) || [0, 0]; if(!w || !h) return false;
  const dpr = Math.min(2, devicePixelRatio || 1), W = Math.round(w*dpr), H = Math.round(h*dpr);
  if(cv.width !== W || cv.height !== H){ cv.width = W; cv.height = H; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  g.globalAlpha = 1; g.setLineDash([]); g.lineCap = 'butt';
  (DRAW[style] || DRAW.steps)(g, w, h, F);
  return true;
}
// The palette follows night mode (data-theme) and the system's light/dark setting.
readPalette();
new MutationObserver(readPalette).observe(document.documentElement, {attributes:true, attributeFilter:['data-theme']});
try{ matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readPalette); }catch(e){}

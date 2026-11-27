// The beat views: canvas pictures of where you are in the groove, drawn from the timeline every frame. Graduated
// from the beat-view lab (js/lab.js, which still uses them with its extra controls). Each view lights up on the onset
// itself (no transition smear); drop-out bars are dashed, the count-in tinted. Colours come from the theme tokens, so
// day, dark and night (dim red) all follow, and a canvas is sized from its own box, so night mode's rotated layout
// draws crisply too.
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
import { fetchFile } from './audio.js';
import { firstHit } from './groove.js';
import { isInt, mod, grid, place } from './grid.js';
import { stickingOf, stepAt, beatOf, STROKES } from './machine.js';

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


// ======== Breathe pictures. B = where() from breath.js ({ n cycle, p phase 0 in · 1 hold · 2 out · 3 hold, f fraction of the
//          phase, h the tide's height 0..1, C cycle seconds, at seconds into the cycle }) plus d (the four durations)
//          and t (seconds since the first inhale, for slow ambient movement). Each follows the same eased breath as the
//          swell you hear. Tide is the app's own circle (DOM); its canvas twin here is for the Setup preview. ========
// ---- Sticking: a Machine beat as one drummer plays it on a four-piece kit (machine.js stickingOf). Two pictures:
//      `sticks`, the bar's sixteen steps as letters (the hand and what it strikes, the feet under it, the counting
//      above), and `kit`, the kit from above with each hand travelling from piece to piece and landing on its stroke.
//      Both come from the timeline and follow the beat's swing, so a step lights on the swung sixteenth itself.
//      Not a beat (drums, plain click): a line saying where it lives. ----
const HOW = { as:'as programmed', moved:'every note, moved to fit', simpler:'simplified to be playable' };
export const howText = how => HOW[how] || '';
const font = (wt, px) => `${wt} ${px}px Inter, system-ui, sans-serif`;
function wrap(g, text, w){ const out = []; let line = '';
  for(const word of text.split(' ')){ const t = line ? line + ' ' + word : word; if(g.measureText(t).width > w && line){ out.push(line); line = word; } else line = t; }
  if(line) out.push(line); return out; }
function noBeat(g, W, H){
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.globalAlpha = 1; g.fillStyle = P.muted;
  const fs = H < 150 ? 12 : Math.max(13, Math.min(18, W/28)); g.font = font(400, fs);
  wrap(g, 'Sticking shows with a Machine beat: Setup ▸ Groove ▸ Sound ▸ Machine.', W*.86).forEach((l, k, a) => g.fillText(l, W/2, H/2 + (k - (a.length - 1)/2)*fs*1.4));
}
// the beat's sticking and the moment in the bar: tau in sixteenths (0..16; -1 when nothing runs) and cur, the step
// sounding (a swung step lights at its own late onset, so the even step before it holds until then), amp the onset's
// flash. One reused object.
const NOW = { S:null, name:'', tau:-1, cur:-1, amp:0, rest:false, count:false };
function stickNow(F){
  const id = F.tl && F.tl.setup.beat, S = id ? stickingOf(id) : null; if(!S) return null;
  NOW.S = S; NOW.name = beatOf(id).name; NOW.tau = NOW.cur = -1; NOW.amp = 0;
  if(F.cell >= 0){ const tau = NOW.tau = F.cell + F.frac, cur = NOW.cur = stepAt(tau, S.swing);
    NOW.amp = reduced ? 0 : Math.exp(-(tau - cur - (cur % 2 ? (S.swing - 50)/50 : 0))*F.cellSec/.12); }                    // the flash on a stroke's onset, gone in a blink
  NOW.rest = F.cell >= 0 && isRest(F, F.cell); NOW.count = F.cell >= 0 && isCount(F, F.cell);
  return NOW;
}
// the bar as cells inside the box (ox, oy, w, h): the hand's letter (a ghost in brackets, an accent heavier) with what it
// strikes under it, the feet below, the counting above; small cells keep only the letters
function stickCells(g, ox, oy, w, h, F, S, cur, maxS){
  const L = place(F.G, w, h, maxS, true), s = L.s, words = s >= 54, syl = s >= 40;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for(let i = 0; i < L.cells.length; i++){
    const x = ox + L.cells[i].x, y = oy + L.cells[i].y, st = S.steps[i], on = i === cur, rest = isRest(F, i), cnt = isCount(F, i), lv = F.G.lv[i], dim = rest ? .3 : 1;
    rrect(g, x - s*.46, y - s*.46, s*.92, s*.92, s*.16);
    if(on && !rest){ g.globalAlpha = cnt ? .45 : 1; g.fillStyle = P.soft; g.fill(); }
    g.setLineDash(rest ? [4, 4] : []); g.globalAlpha = on ? 1 : lv >= 2 ? .5 : .25; g.strokeStyle = P.primary; g.lineWidth = on ? 2.5 : lv >= 3 ? 2 : 1.2; g.stroke(); g.setLineDash([]);
    if(syl){ g.globalAlpha = .7*dim; g.fillStyle = P.muted; g.font = font(400, s*.13); g.fillText(F.G.syl[i], x, y - s*.34); }   // 1 e & a
    const two = st.R && st.L, feet = st.K && st.F ? 'K F' : st.K ? 'K' : st.F ? 'F' : '', hy = words ? y - s*.08 : feet ? y - s*.1 : y + (syl ? s*.04 : 0);
    for(let k = 0; k < 2; k++){
      const c = k ? st.L : st.R; if(!c) continue;
      const lvl = k ? st.ll : st.rl, ghost = lvl < .5, hx = x + (two ? (k ? 1 : -1)*s*.2 : 0), big = s*(ghost ? .22 : lvl >= 1 ? .34 : .29);
      g.globalAlpha = (ghost ? .55 : 1)*dim; g.fillStyle = on ? P.strong : P.text; g.font = font(lvl >= 1 ? 700 : ghost ? 400 : 600, big);
      g.fillText(ghost && words ? (k ? '(L)' : '(R)') : k ? 'L' : 'R', hx, hy);
      if(words){ g.globalAlpha = .75*dim; g.fillStyle = P.muted; g.font = font(400, s*(two ? .1 : .12)); g.fillText(STROKES[c].word, hx, y + s*.13); }
    }
    if(feet){ g.globalAlpha = dim; g.fillStyle = on ? P.strong : P.primary; g.font = font(st.K >= 1 ? 700 : 600, s*(words ? .17 : .22)); g.fillText(feet, x, y + s*(words ? .32 : .27)); }
  }
  g.globalAlpha = 1;
}
// the lines under a picture: who the letters are, then the beat's own note (what was moved or left out), centred on cx
function stickFoot(g, cx, top, w, fs, S, key){
  g.globalAlpha = 1; g.fillStyle = P.muted; g.font = font(400, fs*.9); g.textAlign = 'center'; g.textBaseline = 'middle';
  const note = S.note ? wrap(g, S.note, w).slice(0, 2) : [];
  g.fillText(key, cx, top + fs*.9); note.forEach((l, k) => g.fillText(l, cx, top + fs*.9 + (k + 1)*fs*1.2));
}
DRAW.sticks = function(g, W, H, F){
  const N = stickNow(F); if(!N) return noBeat(g, W, H);
  const S = N.S, small = H < 150, fs = Math.max(11, Math.min(15, W/40)), head = small ? 0 : fs*2.2, foot = small ? 0 : S.note ? fs*4.6 : fs*1.8;
  if(!small){ g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = P.muted; g.font = font(500, fs); g.fillText(`${N.name} · ${HOW[S.how]}`, W/2, head*.55); }
  stickCells(g, 0, head, W, H - head - foot, F, S, N.cur, 150);
  if(!small) stickFoot(g, W/2, H - foot, W*.9, fs, S, 'R L hands · K kick · F hi-hat foot · (L) ghost');
};

// The kit from above, the drummer at the bottom looking up the screen: a classic four-piece (kick, snare, one rack tom
// on the bass drum, one floor tom), the hat on the left with its pedal, a crash on the left, the ride on the right.
// Units: KW across, KH down, sizes in proportion (a 22-inch kick, 14-inch snare and hats, 13 and 16-inch toms, an
// 18-inch crash, a 20-inch ride). Pieces overlap as they do in life: the rack tom and the ride sit over the bass drum.
const KW = 86, KH = 64;
const KIT = {
  kick:  { x:46, y:17, w:29.3, h:18.7, word:'kick' },
  rack:  { x:35, y:20, r:8.7, word:'tom' },
  snare: { x:31, y:50, r:9.3, word:'snare' },
  floor: { x:70, y:51, r:10.7, word:'floor tom' },
  hat:   { x:12, y:43, r:9.3, cym:true, word:'hat' },
  crash: { x:13, y:14, r:12, cym:true, word:'crash' },
  ride:  { x:71, y:16, r:13.3, cym:true, word:'ride' },
};
const KORDER = ['kick', 'rack', 'snare', 'floor', 'hat', 'crash', 'ride'];   // drawn in this order: cymbals over drums
// where each limb lands: a stroke's piece (machine.js STROKES) → the kit piece and a point on it, in units of its radius
// from its centre (y + = toward the drummer). The right hand crosses over to the near right of the hat; the left stays
// on the near left; a cross-stick clicks on the snare's rim; the bell is the ride's centre. The feet stay on the pedals.
const LAND = {
  R: { hat:['hat', .5, .35], snare:['snare', .32, .12], xstick:['snare', .74, .5], rack:['rack', .3, .3], floor:['floor', -.1, .2], ride:['ride', -.38, .42], bell:['ride', 0, 0], crash:['crash', .4, .45] },
  L: { hat:['hat', -.4, .45], snare:['snare', -.3, .12], xstick:['snare', -.74, .5], rack:['rack', -.3, .3], floor:['floor', -.5, .25], ride:['ride', -.62, .3], bell:['ride', -.12, .06], crash:['crash', .05, .55] },
};
const PEDALS = [[46, 26.4, 5.2, 15.5], [14, 47, 4.8, 14.5]];                 // the kick's and the hat's: x, top, width, length
const PT = { R:{}, L:{}, K:{ kick:[46, 38] }, F:{ hat:[14, 58] } };
for(const h of ['R', 'L']) for(const k in LAND[h]){ const [p, dx, dy] = LAND[h][k], q = KIT[p]; PT[h][k] = [q.x + dx*q.r, q.y + dy*q.r]; }
// where a limb is at time tau (sixteenths into the bar): on its way from the stroke it just played to its next one, in
// a straight line at an even speed, lifted most half-way (small hops for quick notes, a full arc from half a second up),
// so it lands exactly on the stroke. Stopped or in the count-in it waits over its first stroke, rising in the last
// beat before it. Writes into o: has (the limb plays in this beat), x, y (kit units), lift 0..1, lv (the coming stroke's level).
function limbAt(o, list, hand, tau, cellSec, count){
  const n = list.length; o.has = n > 0; if(!n) return o;
  if(tau < 0 || count){
    const f = list[0], p = PT[hand][f.piece], dt = tau < 0 ? 99 : f.t + 16 - tau, u = dt <= 4 ? 1 - dt/4 : 0;
    o.x = p[0]; o.y = p[1]; o.lift = 4*u*(1 - u); o.lv = f.lv; return o;
  }
  let k = -1; for(let j = 0; j < n; j++) if(list[j].t <= tau + 1e-9) k = j;      // the stroke just played (none yet: the last one of the bar before)
  const a = list[k < 0 ? n - 1 : k], b = list[(k + 1) % n], ta = k < 0 ? a.t - 16 : a.t, tb = k + 1 >= n ? b.t + 16 : b.t;
  const d = tb - ta, u = d > 0 ? Math.min(1, Math.max(0, (tau - ta)/d)) : 0, pa = PT[hand][a.piece], pb = PT[hand][b.piece];
  o.x = pa[0] + (pb[0] - pa[0])*u; o.y = pa[1] + (pb[1] - pa[1])*u; o.lift = 4*u*(1 - u)*Math.min(1, d*cellSec/.5); o.lv = b.lv; return o;
}
const LIMB = { R:{}, L:{}, K:{}, F:{} }, LIT = {};
function drawKit(g, x0, y0, u, F, N){
  const S = N.S, tau = N.tau, cur = N.cur, rest = N.rest, count = N.count, live = cur >= 0 && !count, st = live ? S.steps[cur] : null;
  const X = v => x0 + v*u, Y = v => y0 + v*u, lw = Math.max(1.2, u*.42), labels = u >= 2.6, dim = rest ? .45 : 1;
  // what the step sounding lights: a piece by its stroke's level; a cross-stick lights the rim, the bell the bell
  for(const k of KORDER) LIT[k] = 0; let rim = 0, bell = 0;
  if(st && !rest){
    for(let k = 0; k < 2; k++){ const c = k ? st.L : st.R; if(!c) continue; const p = STROKES[c].piece, lv = k ? st.ll : st.rl;
      if(p === 'xstick') rim = Math.max(rim, lv); else if(p === 'bell') bell = Math.max(bell, lv); else LIT[p] = Math.max(LIT[p], lv); }
    if(st.K) LIT.kick = Math.max(LIT.kick, st.K); if(st.F) LIT.hat = Math.max(LIT.hat, .7);
  }
  let open = false; if(live) for(const [a, b] of S.open) if((tau >= a && tau < b) || (tau + 16 >= a && tau + 16 < b)) open = true;
  g.lineJoin = 'round'; g.setLineDash([]);
  g.globalAlpha = .4*dim; g.strokeStyle = P.primary; g.lineWidth = lw;                     // the two pedals, under everything
  for(const [px, py, pw, ph] of PEDALS){ rrect(g, X(px - pw/2), Y(py), pw*u, ph*u, u*1.4); g.stroke(); }
  for(const k of KORDER){
    const q = KIT[k], lit = LIT[k];
    if(k === 'kick') rrect(g, X(q.x - q.w/2), Y(q.y - q.h/2), q.w*u, q.h*u, u*2.2); else circle(g, X(q.x), Y(q.y), q.r*u);
    g.globalAlpha = q.cym ? .82 : 1; g.fillStyle = P.bg; g.fill();                       // a piece hides what it sits over
    if(lit){ g.globalAlpha = Math.min(1, .35 + lit*.65); g.fillStyle = P.soft; g.fill(); g.globalAlpha = N.amp*lit*.3; g.fillStyle = P.primary; g.fill(); }
    g.globalAlpha = (lit ? 1 : q.cym ? .5 : .62)*dim; g.strokeStyle = P.primary; g.lineWidth = lw*(q.cym ? .8 : 1.25)*(lit ? 1.5 : 1); g.stroke();
    if(k === 'kick'){ g.globalAlpha = .5*dim; g.lineWidth = lw*2.2; g.beginPath(); g.moveTo(X(q.x - q.w/2 + 2.5), Y(q.y + q.h/2)); g.lineTo(X(q.x + q.w/2 - 2.5), Y(q.y + q.h/2)); g.stroke(); }   // the head the beater meets
    else if(q.cym){                                                                       // a cymbal: its bell and one groove
      g.globalAlpha = .22*dim; g.lineWidth = lw*.6; circle(g, X(q.x), Y(q.y), q.r*u*.62); g.stroke();
      circle(g, X(q.x), Y(q.y), q.r*u*.2);
      if(k === 'ride' && bell){ g.globalAlpha = Math.min(1, .35 + bell*.65); g.fillStyle = P.primary; g.fill(); }
      g.globalAlpha = (k === 'ride' && bell ? 1 : .5)*dim; g.lineWidth = lw*.8; g.stroke();
      if(k === 'hat' && open){ g.globalAlpha = .9; g.lineWidth = lw; g.setLineDash([u*1.6, u*1.2]); circle(g, X(q.x), Y(q.y), q.r*u*1.14); g.stroke(); g.setLineDash([]); }   // open: the top cymbal lifted
    } else {                                                                              // a drum: its hoop
      g.globalAlpha = (k === 'snare' && rim ? 1 : .22)*dim; g.lineWidth = lw*(k === 'snare' && rim ? 2.4 : .6); circle(g, X(q.x), Y(q.y), q.r*u*.86); g.stroke();
    }
    if(labels){ g.globalAlpha = .8*dim; g.fillStyle = P.muted; g.font = font(400, Math.max(9, u*2.5)); g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(k === 'hat' && open ? 'open' : q.word, k === 'kick' ? X(q.x + q.w*.24) : X(q.x), k === 'kick' ? Y(q.y - q.h*.18) : Y(q.y - q.r*.52)); }
  }
  // the limbs: the feet on their pedals (squares), then the hands (the right filled, the left hollow), the right on top
  // as it crosses over. Each is drawn larger the higher it is, over a ring at the size it lands with.
  const m = Math.max(5, u*4.4), cs = F.cellSec, letters = m >= 9;
  for(const h of ['K', 'F', 'L', 'R']){
    const o = limbAt(LIMB[h], S.limbs[h], h, tau, cs, count), foot = h === 'K' || h === 'F', up = h === 'F' && open;
    if(!o.has && !(h === 'F' && S.open.length)) continue;
    if(!o.has){ o.x = PT.F.hat[0]; o.y = PT.F.hat[1]; o.lift = 0; o.lv = .7; }      // the hat foot with no chick to play still lifts for the open hats
    const x = X(o.x), y = Y(o.y), base = m*(foot ? .86 : o.lv < .5 ? .82 : 1), r = base*(1 + .3*(up ? 1 : o.lift));
    const struck = st && !rest && (h === 'K' ? st.K : h === 'F' ? st.F : h === 'R' ? st.R : st.L), fill = h === 'R' || (foot && struck);
    g.globalAlpha = .3*dim; g.strokeStyle = P.primary; g.lineWidth = 1; if(foot) rrect(g, x - base, y - base, base*2, base*2, base*.35); else circle(g, x, y, base); g.stroke();
    if(foot) rrect(g, x - r, y - r, r*2, r*2, r*.35); else circle(g, x, y, r);
    g.globalAlpha = (count ? .6 : 1)*dim; g.fillStyle = fill ? P.primary : P.bg; g.fill();
    g.setLineDash(rest || up ? [3, 3] : []); g.strokeStyle = struck && !foot ? P.strong : P.primary; g.lineWidth = Math.max(1.5, m*.14); g.stroke(); g.setLineDash([]);
    if(letters){ g.fillStyle = fill ? P.bg : P.primary; g.font = font(700, r*1.08); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(h, x, y + r*.06); }
  }
  g.globalAlpha = 1; g.lineJoin = 'miter';
}
DRAW.kit = function(g, W, H, F){
  const N = stickNow(F); if(!N) return noBeat(g, W, H);
  const S = N.S, small = H < 150, fs = Math.max(11, Math.min(15, W/40)), head = small ? 0 : fs*2.2, pad = small ? 3 : Math.max(8, Math.min(14, W*.03));
  const foot = small ? 0 : S.note ? fs*4.6 : fs*1.8, key = 'R L hands · K kick · F hi-hat foot', title = `${N.name} · ${HOW[S.how]}`;
  const top = (cx, y) => { g.textAlign = 'center'; g.textBaseline = 'middle'; g.globalAlpha = 1; g.fillStyle = P.muted; g.font = font(500, fs); g.fillText(title, cx, y + head*.55); };
  if(small || W > H*1.35){                       // wide: the kit at full height on the left; its name, the bar and the note beside it
    const bh = H - 2*pad, u = Math.min((W*(small ? .4 : .56) - pad)/KW, bh/KH), sx = pad + KW*u + pad, sw = W - sx - pad;
    drawKit(g, pad, pad + (bh - KH*u)/2, u, F, N);
    if(!small) top(sx + sw/2, pad*.5);
    stickCells(g, sx, pad*.5 + head, sw, H - pad*1.5 - head - foot, F, S, N.cur, 72);
    if(!small) stickFoot(g, sx + sw/2, H - pad - foot, sw, fs, S, key);
  } else {                                       // tall: the kit as wide as the screen, then the bar in the room left, then the note
    const body = H - head - foot, u = Math.min((W - 2*pad)/KW, body*.56/KH), kh = KH*u;
    top(W/2, 0);
    drawKit(g, (W - KW*u)/2, head + pad*.5, u, F, N);
    stickCells(g, pad, head + kh + pad, W - 2*pad, body - kh - pad*1.5, F, S, N.cur, 96);
    stickFoot(g, W/2, H - foot, W*.92, fs, S, key);
  }
};

export const BSTYLES = {tide:'Tide', box:'Box', water:'Water', flower:'Flower', eight:'Lazy 8', star:'Star', glow:'Glow'};
const WORD = ['in', 'hold', 'out', 'hold'];
const label = (g, text, x, y, on, fs) => { g.font = `${on ? 600 : 400} ${fs}px Inter, system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.globalAlpha = on ? .95 : .45; g.fillStyle = on ? P.strong : P.muted; g.fillText(text, x, y); };
// The Box's path: one side per phase that has a length, from the bottom-left corner. In goes up the left side, hold
// runs along the top, out comes down the right (or straight back to the start when there's no second hold), the
// second hold runs home along the bottom. So 4·4·4·4 is a square, 4·7·8 a triangle, 4·0·8·0 a line up and down.
function boxPath(d){
  const segs = []; let at = [0, 1];
  const go = (p, to) => { if(d[p] > 0){ segs.push({ p, a:at, b:to }); at = to; } };
  go(0, [0, 0]); go(1, [1, 0]); go(2, d[3] > 0 ? [1, 1] : [0, 1]); go(3, [0, 1]);
  return segs;
}
let glowGrad = null, glowKey = '';
export const BDRAW = {
  tide(g, W, H, B){
    const cx = W/2, cy = H/2, R = Math.min(W, H)*.42;
    circle(g, cx, cy, R); g.globalAlpha = .35; g.strokeStyle = P.primary; g.lineWidth = 2; g.stroke();
    circle(g, cx, cy, R*(.55 + .45*B.h)); g.globalAlpha = .22; g.fillStyle = P.primary; g.fill();
  },
  box(g, W, H, B){                                   // trace a square: up = in, top = hold, down = out, bottom = hold
    const s = Math.min(W*.62, H*.66), x0 = (W - s)/2, y0 = (H - s)/2, P2 = ([u, v]) => [x0 + u*s, y0 + v*s], fs = Math.max(11, Math.min(16, s*.07));
    const segs = boxPath(B.d), cur = segs.findIndex(q => q.p === B.p);
    g.lineCap = 'round'; g.lineJoin = 'round';
    segs.forEach((q, i) => { const [ax, ay] = P2(q.a), [bx, by] = P2(q.b);
      g.globalAlpha = i < cur ? .6 : .2; g.strokeStyle = i < cur ? P.primary : P.line; g.lineWidth = i < cur ? 4 : 3;
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
      const mx = (ax + bx)/2, my = (ay + by)/2, ox = mx - (x0 + s/2), oy = my - (y0 + s/2), k = Math.hypot(ox, oy) || 1;   // the word sits just outside its side
      label(g, WORD[q.p], mx + ox/k*fs*1.6, my + oy/k*fs*1.6, i === cur, fs); });
    if(cur < 0) return;
    const q = segs[cur], [ax, ay] = P2(q.a), [bx, by] = P2(q.b), x = ax + (bx - ax)*B.f, y = ay + (by - ay)*B.f;
    g.globalAlpha = .9; g.strokeStyle = P.primary; g.lineWidth = 4; g.beginPath(); g.moveTo(ax, ay); g.lineTo(x, y); g.stroke();
    g.globalAlpha = 1; g.fillStyle = P.primary; circle(g, x, y, Math.max(6, s*.035)); g.fill();
    g.lineCap = 'butt';
  },
  water(g, W, H, B){                                 // the screen fills as you breathe in, empties as you breathe out
    const lvl = H*(.88 - .7*B.h), hold = B.p === 1 || B.p === 3;
    for(const [amp, len, sp, a] of [[H*.012, W*.55, .5, .14], [H*.018, W*.8, -.35, .2]]){
      g.beginPath(); g.moveTo(0, H);
      for(let x = 0; x <= W + 8; x += 8) g.lineTo(x, lvl + amp*(hold ? .6 : 1)*Math.sin(TAU*x/len + B.t*sp));
      g.lineTo(W, H); g.closePath(); g.globalAlpha = a; g.fillStyle = P.primary; g.fill();
    }
    g.beginPath(); for(let x = 0; x <= W + 8; x += 8){ const y = lvl + H*.018*(hold ? .6 : 1)*Math.sin(TAU*x/(W*.8) - B.t*.35); if(x) g.lineTo(x, y); else g.moveTo(x, y); }
    g.globalAlpha = .5; g.strokeStyle = P.primary; g.lineWidth = 2; g.stroke();
  },
  flower(g, W, H, B){                                // petals open on the in-breath and close on the out-breath, turning slowly
    const cx = W/2, cy = H/2, R = Math.min(W, H)*.4, open = .2 + .8*B.h, rot = (B.n + B.at/B.C)*TAU/40;
    const petal = (a, L, wdt, fillA) => { g.save(); g.translate(cx, cy); g.rotate(a);
      g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(wdt, -L*.28, wdt, -L*.78, 0, -L); g.bezierCurveTo(-wdt, -L*.78, -wdt, -L*.28, 0, 0);
      g.globalAlpha = fillA; g.fillStyle = P.primary; g.fill(); g.globalAlpha = .5; g.strokeStyle = P.primary; g.lineWidth = 1.5; g.stroke(); g.restore(); };
    for(let i = 0; i < 8; i++) petal(rot + TAU*i/8 + Math.PI/8, R*open*.62, R*open*.2, .12 + .1*B.h);   // inner ring first, underneath
    for(let i = 0; i < 8; i++) petal(rot + TAU*i/8, R*open, R*open*.3, .1 + .12*B.h);
    circle(g, cx, cy, R*(.07 + .04*B.h)); g.globalAlpha = .85; g.fillStyle = P.primary; g.fill();
  },
  eight(g, W, H, B){                                 // a lazy 8: the left loop breathing in, the right loop breathing out, resting in the middle
    const cx = W/2, cy = H/2, A = Math.min(W*.42, H*.9), K = Math.min(H*.36, A*.5), pt = t => [cx + A*Math.sin(t), cy - K*Math.sin(t)*Math.cos(t)];
    g.beginPath(); for(let i = 0; i <= 96; i++){ const [x, y] = pt(TAU*i/96); if(i) g.lineTo(x, y); else g.moveTo(x, y); }
    g.globalAlpha = .25; g.strokeStyle = P.line; g.lineWidth = 3; g.stroke();
    const fs = Math.max(11, Math.min(16, A*.08));
    label(g, 'in', cx - A*.55, cy, B.p === 0, fs); label(g, 'out', cx + A*.55, cy, B.p === 2, fs);
    let t = 0;                                                        // holds rest where the loops cross
    if(B.p === 0 || B.p === 2){
      const t0 = B.p === 0 ? Math.PI : 0; t = t0 + Math.PI*B.f;         // left lobe is π…2π, right lobe 0…π
      g.beginPath(); for(let i = 0; i <= 48; i++){ const [x, y] = pt(t0 + Math.PI*B.f*i/48); if(i) g.lineTo(x, y); else g.moveTo(x, y); }
      g.globalAlpha = .8; g.strokeStyle = P.primary; g.lineWidth = 4; g.lineCap = 'round'; g.stroke(); g.lineCap = 'butt';
    } else { circle(g, cx, cy, Math.max(10, A*.06)*(1 + .15*Math.sin(B.t*2))); g.globalAlpha = .2; g.fillStyle = P.primary; g.fill(); }
    const [x, y] = pt(t); g.globalAlpha = 1; g.fillStyle = P.primary; circle(g, x, y, Math.max(6, A*.035)); g.fill();
  },
  star(g, W, H, B){                                  // star breathing: up an edge breathing in, down the next breathing out; five breaths go round
    const cx = W/2, cy = H*.54, Ro = Math.min(W, H)*.42, Ri = Ro*.42, V = [];
    for(let i = 0; i < 10; i++){ const a = (-126 + 36*i)*Math.PI/180, r = i % 2 ? Ro : Ri; V.push([cx + r*Math.cos(a), cy + r*Math.sin(a)]); }
    const base = (2*B.n) % 10, e = B.p <= 1 ? base : base + 1, f = B.p === 1 || B.p === 3 ? 1 : B.f, done = e % 10;   // the edge in progress
    g.lineCap = 'round'; g.lineJoin = 'round';
    for(let i = 0; i < 10; i++){ const [ax, ay] = V[i], [bx, by] = V[(i + 1) % 10], lit = i < done;
      g.globalAlpha = lit ? .6 : .2; g.strokeStyle = lit ? P.primary : P.line; g.lineWidth = lit ? 4 : 3;
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke(); }
    const [ax, ay] = V[done], [bx, by] = V[(done + 1) % 10], x = ax + (bx - ax)*f, y = ay + (by - ay)*f;
    g.globalAlpha = .9; g.strokeStyle = P.primary; g.lineWidth = 4; g.beginPath(); g.moveTo(ax, ay); g.lineTo(x, y); g.stroke();
    g.globalAlpha = 1; g.fillStyle = P.primary; circle(g, x, y, Math.max(6, Ro*.045)); g.fill(); g.lineCap = 'butt';
  },
  glow(g, W, H, B){                                  // the whole screen brightens and dims: nothing to watch, just light
    const key = W + 'x' + H + P.primary;
    if(key !== glowKey){ glowKey = key; glowGrad = g.createRadialGradient(W/2, H/2, 0, W/2, H/2, Math.hypot(W, H)*.55);
      glowGrad.addColorStop(0, P.primary); glowGrad.addColorStop(1, P.bg); }
    g.globalAlpha = .06 + .5*B.h; g.fillStyle = glowGrad; g.fillRect(0, 0, W, H);
  },
};
export function drawBreath(cv, style, B){
  const [w, h] = sizes.get(cv) || [0, 0]; if(!w || !h) return false;
  const dpr = Math.min(2, devicePixelRatio || 1), W = Math.round(w*dpr), H = Math.round(h*dpr);
  if(cv.width !== W || cv.height !== H){ cv.width = W; cv.height = H; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  g.globalAlpha = 1; g.setLineDash([]); g.lineCap = 'butt';
  (BDRAW[style] || BDRAW.tide)(g, w, h, B);
  return true;
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

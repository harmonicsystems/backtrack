// The beat grid shared by the app's beats view and the lab: n cells spread evenly across a span of bars, which of
// them are accents (the meter's bar and group starts), what to count in each, and how to lay them out in rows.
// Moved out of the lab when the grid became the app's own view. No DOM, no settings: callers pass the meter.
export const isInt = x => Math.abs(x - Math.round(x)) < 1e-6, mod = (a, b) => ((a % b) + b) % b;

const grids = {};
export const SYL = {2:['','&'], 3:['','trip','let'], 4:['','e','&','a'], 6:['','la','li','&','la','li'], 8:['','·','e','·','&','·','a','·']};
// Accent per cell: 4 the cycle's start, 3 a bar or group start, 2 another beat, 1 a pulse inside a beat or a half
// pulse, 0 finer or off the pulse grid. M is a meter from timeline.js (top pulses per bar, pulseLevel per pulse).
export function grid(n, spanBars, M){
  const top = M ? M.top : 4, den = M ? M.den : 4, PL = M ? M.pulseLevel : [3, 2, 2, 2], key = n + '/' + spanBars + '/' + top + '/' + Array.from(PL).join('');
  if(grids[key]) return grids[key];
  const beats = spanBars * top, per = n / beats, cb = beats / n;          // cells per pulse, pulses per cell
  const lv = Array.from({length:n}, (_, i) => { const b = i * cb; return i === 0 ? 4 : isInt(b) ? PL[mod(Math.round(b), top)] : isInt(2 * b) ? 1 : 0; });
  // extra space before group starts: at beats if that makes groups of 2+, else at bars, else none
  const gl = [2, 3].find(L => { const s = lv.filter(v => v >= L).length; return s >= 2 && n / s >= 2; }) || 9;
  const syl = lv.map((_, i) => { const b = i * cb;
    if(cb >= top && isInt(cb / top)) return String(Math.floor(b / top + 1e-9) + 1);   // a bar or more per cell: bar numbers
    if(!isInt(per) && !isInt(cb)) return String(i + 1);                              // a cross-rhythm: count the cells
    if(isInt(b)) return String(mod(Math.round(b), top) + 1);
    return SYL[per] ? SYL[per][Math.round((b - Math.floor(b + 1e-9)) * per)] || '·' : '·'; });
  return grids[key] = {n, spanBars, top, den, beats, per, lv, gl, syl};
}
export function describe(n, spanBars, M){
  const G = grid(n, spanBars, M), cb = G.beats / n, q = G.den === 8 ? .5 : 1;   // pulses per cell, and the pulse as a fraction of a quarter
  const hit = [[4,'one per bar'],[2,'half notes'],[1,'quarter notes, one per beat'],[.5,'eighth notes'],[.25,'sixteenth notes'],[.125,'thirty-second notes'],
    [4/3,'half-note triplets'],[2/3,'quarter-note triplets'],[1/3,'eighth-note triplets'],[1/6,'sixteenth-note triplets']].find(([v]) => Math.abs(v - cb * q) < 1e-6);
  return hit ? hit[1] : isInt(cb / G.top) ? `one per ${cb / G.top} bars` : 'a cross-rhythm against the beat';
}
// Cells flow in rows: the row count that gives the biggest cells wins, rows prefer to break on bars or beats,
// and groups get a little extra space. `uniform` keeps even spacing (for views where x is time).
const places = new Map();
export function place(G, W, H, maxS, uniform){
  const key = [G.n, G.spanBars, G.top, Array.from(G.lv).join(''), W|0, H|0, maxS|0, uniform ? 1 : 0].join('/'); let L = places.get(key); if(L) return L;
  const gap = i => uniform ? .35 : .35 + (G.lv[i] >= G.gl ? .45 : 0) + (G.gl === 2 && G.lv[i] >= 3 ? .35 : 0);
  const pad = Math.min(28, W * .05, H * .08), iw = W - 2 * pad, ih = H - 2 * pad;
  let best = null;
  for(let R = 1; R <= Math.min(G.n, 8); R++){
    const C = Math.ceil(G.n / R); if((R - 1) * C >= G.n) continue;
    let units = 0;
    for(let r = 0; r < R; r++){ let u = 0; for(let i = r * C; i < Math.min(G.n, r * C + C); i++) u += 1 + (i > r * C ? gap(i) : 0); units = Math.max(units, u); }
    // when a bar takes more than one row, the rows that start a bar get extra space above
    const rg = Array.from({length:R}, (_, r) => r === 0 ? 0 : .5 + (G.lv[r * C] >= 3 && G.lv[C] < 3 ? .5 : 0)), tall = R + rg.reduce((a, v) => a + v, 0);
    const s = Math.min(iw / units, ih / tall, maxS);
    let score = s * (1 - .05 * (R - 1));
    for(let r = 1; r < R; r++) if(G.gl < 9 && G.lv[r * C] < G.gl) score *= .7;
    const cpb = G.n / G.spanBars;                       // cells per bar: rows should split a bar evenly or hold whole bars
    if(R > 1 && isInt(cpb) && cpb % C !== 0 && C % cpb !== 0) score *= .6;
    if(!best || score > best.score) best = {R, C, s, score, rg, tall};
  }
  const {R, C, s, rg, tall} = best, cells = []; let y = (H - tall * s) / 2;
  for(let r = 0; r < R; r++){
    const a = r * C, b = Math.min(G.n, a + C), xs = []; let x = 0; y += rg[r] * s;
    for(let i = a; i < b; i++){ if(i > a) x += gap(i) * s; xs.push(x); x += s; }
    xs.forEach(x0 => cells.push({x: (W - x) / 2 + x0 + s / 2, y: y + s / 2}));
    y += s;
  }
  if(places.size > 64) places.clear();
  places.set(key, L = {R, C, s, cells}); return L;
}

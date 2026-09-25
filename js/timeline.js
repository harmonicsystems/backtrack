// The groove's timeline, pure: meters, click cells, the tempo map (the ramp included) and the click scheduler.
// No DOM, no AudioContext of its own, no settings import. The live scheduler (groove.js), the frame loop (app.js),
// finishTake and the offline render (rec.js) all ask this one module "when is bar b, cell i?" and "where am I at
// second s?", so what you hear, what you see and what a take rebuilds can't drift apart.

// Meters: `top` pulses per bar (the quarter in x/4, the eighth in x/8), `unit` pulses per bpm beat (the bpm is the
// quarter in x/4, the dotted quarter in 6/8, the quarter in 7/8), and the groupings on offer (the first is the default).
export const METERS = {
  '2':{top:2, unit:1, groups:['2']}, '3':{top:3, unit:1, groups:['3']}, '4':{top:4, unit:1, groups:['4']},
  '5':{top:5, unit:1, groups:['32','23']}, '6':{top:6, unit:3, groups:['33']}, '7':{top:7, unit:2, groups:['223','322','232']},
};
const meters = new Map();
// A meter resolved. Beats are what you feel: every pulse in x/4 (the grouping only places accents), each group in
// x/8 (6/8 = two beats of three pulses, 7/8 = three uneven beats). pulseLevel: 3 on the bar's and each group's first
// pulse, 2 on other beats, 1 on pulses inside a beat.
export function meterOf(top = '4', group = ''){
  const m = METERS[top] || METERS['4'], g = m.groups.includes(group) ? group : m.groups[0], id = m.top + '.' + g;
  let M = meters.get(id); if(M) return M;
  const groups = [...g].map(Number), compound = m.unit > 1, beats = compound ? groups : Array(m.top).fill(1);
  const starts = []; let p = 0; for(const n of groups){ starts.push(p); p += n; }
  const beatOfPulse = new Uint8Array(m.top), beatStart = new Uint8Array(m.top), pulseLevel = new Uint8Array(m.top);
  let b = 0, q = 0;
  for(let i = 0; i < m.top; i++){
    if(i >= q + beats[b]){ q += beats[b]; b++; }
    beatOfPulse[i] = b; beatStart[i] = q; pulseLevel[i] = starts.includes(i) ? 3 : i === q ? 2 : 1;
  }
  M = { top:m.top, unit:m.unit, compound, den: compound ? 8 : 4, label:`${m.top}/${compound ? 8 : 4}`, group:g, isDefaultGroup: g === m.groups[0],
        glabel: groups.length > 1 ? groups.join('+') : '', groups, beats, starts, beatOfPulse, beatStart, pulseLevel, choices:m.groups };
  meters.set(id, M); return M;
}

// The click pattern as one bar of cells (pulses × sub): 0 off · 1 a quiet subdivision · 2 a beat · 3 an accent.
// Named patterns fill the grid for the meter; 'c' is the custom grid (a string of digits) at `csub` cells per pulse.
export function cellsOf(code, M, csub = 2, custom = ''){
  const top = M.top, L = M.pulseLevel, x8 = M.compound;
  const grid = (sub, fill) => { const c = new Uint8Array(top * sub); for(let p = 0; p < top; p++) for(let s = 0; s < sub; s++) c[p * sub + s] = fill(p, s); return { sub, cells:c }; };
  switch(code){
    case '2': return x8 ? grid(1, p => L[p]) : grid(2, (p, s) => s ? 1 : L[p]);               // eighths
    case '3': return x8 ? cellsOf('1', M) : grid(3, (p, s) => s ? 1 : L[p]);                  // triplets
    case '4': return x8 ? grid(2, (p, s) => s ? 1 : L[p]) : grid(4, (p, s) => s ? 1 : L[p]);  // sixteenths
    case 'b': return !x8 && (top === 2 || top === 4) ? grid(1, p => p % 2 ? 2 : 0) : cellsOf('1', M);   // backbeat: 2 and 4
    case 'o': return x8 ? cellsOf('1', M) : grid(2, (p, s) => s ? 2 : 0);                     // off-beats: the "and"s
    case 'c': { const sub = maxSub(M, csub); return { sub, cells: fitCells(custom, Math.round(+csub) || sub, sub, M) }; }
    case 'off': return grid(1, () => 0);
    default: return grid(1, p => L[p] === 1 ? 0 : L[p]);                                      // '1': the beats
  }
}
// Cells never get shorter than the click itself: up to four per pulse in x/4, two in x/8.
export const maxSub = (M, want) => Math.max(1, Math.min(M.compound ? 2 : 4, Math.round(+want) || 1));
// Custom cells refitted to another subdivision or meter: pulses keep their cells, subdivisions that still land on
// a cell keep theirs, new in-between cells start off, and the string is padded or cut to the bar.
export function fitCells(cells, oldSub, newSub, M){
  const src = typeof cells === 'string' ? [...cells].map(ch => Math.min(3, Math.max(0, +ch || 0))) : Array.from(cells || []);
  const out = new Uint8Array(M.top * newSub);
  for(let p = 0; p < M.top; p++) for(let s = 0; s < newSub; s++){
    const num = s * oldSub; if(num % newSub) continue;
    const j = p * oldSub + num / newSub; out[p * newSub + s] = j < src.length ? src[j] : 0;
  }
  return out;
}

// A ramp: `step` bpm every `every` bars until `cap`, or null when there is nothing to ramp.
const RAMP = /^(-?\d+)-(\d+)-(\d+)$/;
export function rampOf(str, bpm){
  const m = RAMP.exec(str || ''); if(!m) return null;
  const step = +m[1], every = +m[2], cap = +m[3];
  if(!step || every < 1 || (step > 0 ? cap <= bpm : cap >= bpm)) return null;
  return { step, every, cap };
}
export const rampString = r => r ? `${r.step}-${r.every}-${r.cap}` : '0';

// Everything the timeline needs, from the live settings or from a take. Old takes (before this module) come out as
// what they were: drums, 4/4, quarters on the click, click at full volume.
export function setupOf(src){
  const sound = src.sound === 'click' ? 'click' : 'drums', bpm = +src.bpm || 96;
  const M = meterOf(sound === 'drums' ? '4' : src.meter, sound === 'drums' ? '' : src.group);
  const click = src.click === 'on' ? '1' : (src.click || 'off');
  const { sub, cells } = cellsOf(click, M, src.csub, src.cells);
  return { sound, bpm, rate: sound === 'click' ? 1 : (src.rate != null ? +src.rate : 1 + (+src.fine || 0) / 100),
    meter:M, bars: +(src.bars ?? src.loopBars) || 16, drop: src.drop || '0-0', click, sub, cells, countCells: M.pulseLevel,
    ramp: rampOf(src.ramp, bpm), cvol: src.cvol != null ? +src.cvol : 1,
    levels: sound === 'click' ? [0, .14, .3, .3] : [0, .06, .12, .12], countLevels: [0, .2, .35, .35] };
}

// The map from bars and cells to seconds (from bar 0's downbeat) and back. A ramp changes the tempo once per
// `every` bars until the cap, so the bar lengths are constant inside each period; `ps` holds the period starts.
// Drums: the ramp rides on playbackRate within ±8 % of the loop (Fine included); the click is exact.
export function makeTimeline(setup){
  const { bpm, rate, meter:M, ramp, sound } = setup, top = M.top, unit = M.unit, n = setup.cells.length || 1, drums = sound === 'drums';
  const every = ramp ? ramp.every : 1e9;
  const rampBpm = bar => { if(!ramp) return bpm; const v = bpm + ramp.step * Math.floor(Math.max(0, bar) / every); return ramp.step > 0 ? Math.min(v, ramp.cap) : Math.max(v, ramp.cap); };
  const rateOf = bar => drums ? Math.min(1.08, Math.max(.92, rate * rampBpm(bar) / bpm)) : 1;
  const tempoOf = bar => drums ? bpm * rateOf(bar) : rampBpm(bar);
  const pulseSecOf = bar => 60 / tempoOf(bar) / unit, barSecOf = bar => top * pulseSecOf(bar);
  const ps = [0]; let K = 0;
  if(ramp) while(K < 400 && tempoOf((K + 1) * every) !== tempoOf(K * every)){ ps.push(ps[K] + every * barSecOf(K * every)); K++; }
  const barStart = bar => { if(bar < 0) return bar * barSecOf(0); const k = Math.min(K, Math.floor(bar / every)); return ps[k] + (bar - k * every) * barSecOf(k * every); };
  const cellStart = (bar, i) => barStart(bar) + i * barSecOf(bar) / n;
  // at(): one reused answer object, so the frame loop allocates nothing. kc remembers the period of the last query
  // (time is monotone in the frame loop, so the next answer is at most a step away).
  const W = { bar:0, inBar:0, barSec:0, frac:0, pulse:0, beat:0, beats:M.beats.length, beatFrac:0, cell:0, tempo:bpm };
  let kc = 0;
  function at(sec){
    let bar, barSec;
    if(sec < 0){ barSec = barSecOf(0); bar = Math.floor(sec / barSec + 1e-9); }
    else {
      while(kc > 0 && sec < ps[kc]) kc--;
      while(kc < K && sec >= ps[kc + 1]) kc++;
      barSec = barSecOf(kc * every); bar = kc * every + Math.floor((sec - ps[kc]) / barSec + 1e-9);
      if(kc < K) bar = Math.min(bar, (kc + 1) * every - 1);
    }
    const inBar = Math.max(0, sec - barStart(bar)), pulseSec = barSec / top;
    const pulse = Math.min(top - 1, Math.floor(inBar / pulseSec + 1e-9)), beat = M.beatOfPulse[pulse];
    W.bar = bar; W.inBar = inBar; W.barSec = barSec; W.frac = inBar / barSec; W.pulse = pulse; W.beat = beat;
    W.beatFrac = (pulse - M.beatStart[pulse] + (inBar - pulse * pulseSec) / pulseSec) / M.beats[beat];
    W.cell = Math.min(n - 1, Math.floor(inBar / (barSec / n) + 1e-9)); W.tempo = tempoOf(bar);
    return W;
  }
  const barAtOrAfter = sec => { const w = at(sec); return w.inBar < 1e-6 ? w.bar : w.bar + 1; };   // the first bar line at or after sec
  return { setup, meter:M, cells:setup.cells, n, K, ps, every, tempoOf, rateOf, pulseSecOf, barSecOf, barStart, cellStart, at, barAtOrAfter };
}

// Put the clicks of bars [fromBar, toBar) on a clock. T = { t0: bar 0 on that clock, click(t, freq, level), min?, max? }.
// Bars below 0 are the count-in (the pulses, at the count-in levels); a rest bar or a silent pattern schedules nothing.
export function scheduleClicks(T, tl, fromBar, toBar){
  const s = tl.setup;
  for(let b = fromBar; b < toBar; b++){
    const count = b < 0, cells = count ? s.countCells : s.cells, levels = count ? s.countLevels : s.levels;
    if(!count && (s.click === 'off' || restIn(s.drop, b))) continue;
    const t = T.t0 + tl.barStart(b), step = tl.barSecOf(b) / cells.length;
    for(let i = 0; i < cells.length; i++){
      const lv = cells[i]; if(!lv) continue;
      const tt = t + i * step;
      if((T.min != null && tt < T.min) || (T.max != null && tt >= T.max)) continue;
      T.click(tt, lv === 3 ? 1600 : 1100, levels[lv]);
    }
  }
}
// Drop-out: `on` bars playing, then `off` bars of rest, counted from bar 0.
export const restIn = (drop, bar) => { const [on, off] = String(drop || '0-0').split('-').map(Number); return on ? (bar % (on + off)) >= on : false; };

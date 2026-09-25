// Breathe mode, ported from Tide Breath — but on the audio clock, like the drums: the swell (the drone rising
// louder and brighter on each inhale, ebbing on each exhale), the cue tones and the hum are scheduled ahead as
// audio. They stay exact with the screen locked, freeze with a lock-screen pause, and the same scheduler rebuilds
// the guide offline for a take, so playback matches what was heard.
import { S, FREQ, durs } from './state.js';
import { ctx, bus, settle } from './audio.js';

const ease = t => .5 - .5 * Math.cos(Math.PI * t);
export const TOP = { gain:1, freq:6000 };
// Swell depth s (0–1) sets how far the drone ebbs: quieter and darker at the bottom of each exhale.
export const lowOf = s => ({ gain: 1 - .75 * s, freq: 6000 * Math.pow(350 / 6000, s) });
const levelAt = (h, low) => ({ gain: low.gain + (TOP.gain - low.gain) * h, freq: low.freq * Math.pow(TOP.freq / low.freq, h) });

// The breath clock: t0 is the first inhale, in ctx time.
export const bclock = { t0:0, d:[4,4,4,4], cycle:16, live:false };

// Where you are `pos` seconds after t0: cycle n, phase p (0 in · 1 hold · 2 out · 3 hold), seconds into and left
// in the phase, and h, the tide's height 0..1 (eased like the circle and the swell).
export function where(pos, d = bclock.d){
  const C = d.reduce((a, b) => a + b, 0), n = Math.floor(pos / C);
  let t = pos - n * C, p = 0;
  while(p < 3 && t >= d[p]){ t -= d[p]; p++; }                     // zero-length phases are skipped
  const f = d[p] ? Math.min(1, t / d[p]) : 1;
  return { n, p, into:t, left: Math.max(0, d[p] - t), f, h: [ease(f), 1, 1 - ease(f), 0][p], C, at: pos - n * C };   // at: seconds into this cycle
}

const cueRoot = key => { let f = FREQ[key]; while(f < 300) f *= 2; return f; };
function cueTone(T, t, f, level, decay){
  const c = T.ctx, g = c.createGain();
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + .012); g.gain.exponentialRampToValueAtTime(.0001, t + decay);
  g.connect(T.cues);
  [[1, 1], [2, .25]].forEach(([m, a]) => { const o = c.createOscillator(), og = c.createGain();
    o.frequency.value = f * m; og.gain.value = a; o.connect(og).connect(g); o.start(t); o.stop(t + decay + .05); });
}
function humVoice(T, s, e, key){                                    // a soft drone for the length of an exhale
  const c = T.ctx, g = c.createGain(), f = FREQ[key];
  g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(.25, s + Math.min(.6, (e - s) / 2));
  g.gain.setValueAtTime(.25, e); g.gain.linearRampToValueAtTime(0, e + .8); g.connect(T.hum);
  [[1, .5], [2, .18], [3, .06]].forEach(([m, a]) => { const o = c.createOscillator(), og = c.createGain();   // a few partials: it hums rather than beeps
    o.frequency.value = f * m; og.gain.value = a; o.connect(og).connect(g); o.start(s); o.stop(e + .85); });
}
// An eased move of both swell params across [s, e], from tide height h0 to h1 (partial phases start mid-way).
function swellCurve(T, s, e, hOf, low){
  const n = 48, dur = e - s - .002;                                 // end a hair early: curves must not touch the next one
  if(dur < .01){ const L = levelAt(hOf(1), low); T.amp.setValueAtTime(L.gain, s); T.lp.setValueAtTime(L.freq, s); return; }
  const g = new Float32Array(n), fr = new Float32Array(n);
  for(let i = 0; i < n; i++){ const L = levelAt(hOf(i / (n - 1)), low); g[i] = L.gain; fr[i] = L.freq; }
  T.amp.setValueCurveAtTime(g, s, dur); T.lp.setValueCurveAtTime(fr, s, dur);
}

// Put the breath on a clock between times a and b. T = { ctx, lp, amp (AudioParams), cues, hum (nodes) };
// spec = { t0, d, swell (0–100), bsound, bcue, key }. Works for the live context and for an OfflineAudioContext.
export function scheduleBreath(T, spec, a, b){
  const d = spec.d, C = d.reduce((x, y) => x + y, 0), low = lowOf(+spec.swell / 100);
  if(!(C > 0)) return;
  if(a < spec.t0){ const L = levelAt(0, low); T.amp.setValueAtTime(L.gain, a); T.lp.setValueAtTime(L.freq, a); }   // before the first inhale: resting low
  for(let n = Math.max(0, Math.floor((Math.max(a, spec.t0) - spec.t0) / C)); spec.t0 + n * C < b; n++){
    let ps = spec.t0 + n * C;
    for(let i = 0; i < 4; i++){
      const pe = ps + d[i];
      if(d[i] > 0 && pe > a && ps < b){
        const s = Math.max(ps, a), f0 = (s - ps) / d[i];
        const hOf = i === 0 ? u => ease(f0 + (1 - f0) * u) : i === 2 ? u => 1 - ease(f0 + (1 - f0) * u) : () => (i === 1 ? 1 : 0);
        swellCurve(T, s, pe, hOf, low);
        const r = cueRoot(spec.key);                                  // a phase already under way at a (a take started mid-phase)
        if(ps >= a && spec.bcue !== 'off') cueTone(T, ps, [r * 2, r * 1.5, r, r * 1.5][i], .09, 1.6);   // octave in · fifth hold · root out
        if(spec.bcue === 'count') for(let k = Math.ceil(d[i]) - 1; k >= 1; k--) if(ps + d[i] - k >= a) cueTone(T, ps + d[i] - k, r * 2, .03, .35);
        if(spec.bsound === 'hum' && i === 2 && pe - s > .05) humVoice(T, s, pe, spec.key);   // …keeps its hum and remaining ticks
      }
      ps = pe;
    }
  }
}

// ---- the live breath ----
let timer = 0, through = 0, cueBus = null, humBus = null;
const spec = () => ({ t0: bclock.t0, d: bclock.d, swell: S.swell, bsound: S.bsound, bcue: S.bcue, key: S.key });
const liveT = () => ({ ctx, lp: bus.swellLP.frequency, amp: bus.swellAmp.gain, cues: cueBus, hum: humBus });
export function breathStart(){
  const d = durs(); if(d.every(x => x === 0)) return false;
  const now = ctx.currentTime, low = levelAt(0, lowOf(+S.swell / 100));
  bclock.d = d; bclock.cycle = d.reduce((a, b) => a + b, 0); bclock.t0 = now + .3; bclock.live = true;
  cueBus = ctx.createGain(); cueBus.connect(bus.master); humBus = ctx.createGain(); humBus.connect(bus.master);
  // glide from wherever the drone is (a restart can come mid-inhale) down to resting low, arriving as the first inhale begins
  for(const [p, v] of [[bus.swellLP.frequency, low.freq], [bus.swellAmp.gain, low.gain]]){
    if(p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(now); else { p.cancelScheduledValues(now); p.setValueAtTime(p.value, now); }
    p.linearRampToValueAtTime(v, bclock.t0 - .002);
  }
  through = bclock.t0;
  const step = () => {                                              // keep ~2 cycles (at least 8 s) on the clock, ending on a cycle boundary
    const want = ctx.currentTime + Math.max(8, 2 * bclock.cycle), end = bclock.t0 + Math.ceil((want - bclock.t0) / bclock.cycle) * bclock.cycle;
    if(end <= through) return;
    try{ scheduleBreath(liveT(), spec(), Math.max(through, ctx.currentTime + .02), end); }catch(e){}   // behind (a stalled timer)? pick up from now
    through = end;
  };
  step(); timer = setInterval(step, 500);
  return true;
}
export function breathStop(fade = 2){
  clearInterval(timer); bclock.live = false;
  if(!ctx) return;
  const now = ctx.currentTime, low = lowOf(+S.swell / 100);
  for(const b of [cueBus, humBus]) if(b){ b.gain.setTargetAtTime(0, now, .08); setTimeout(() => b.disconnect(), 700); }
  cueBus = humBus = null;
  settle(bus.swellLP.frequency, low.freq, fade / 4); settle(bus.swellAmp.gain, low.gain, fade / 4);   // back to resting low
}
// Resting (not breathing) in Breathe mode: the drone sits at its low level, like Tide Breath before Begin.
export function breathRest(){
  if(!ctx) return;
  const low = lowOf(+S.swell / 100);
  settle(bus.swellLP.frequency, low.freq, .05); settle(bus.swellAmp.gain, low.gain, .05);
}

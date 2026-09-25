// The drum loop, its beat clock, and the bar-boundary scheduler (drop-outs and the click track).
import { S } from './state.js';
import { ctx, bus, getBuf, click, newClickBus, dropClickBus } from './audio.js';

// t0 is the drums' first downbeat in ctx time; everything visual is derived from it.
// live: the drums are actually on the clock (false when stopped, or when the groove couldn't load).
export const clock = { t0:0, rate:1, beatSec:.625, barSec:2.5, loopBars:16, live:false };

let src = null, out = null, schedTimer = 0, scheduled = 0;   // scheduled = bars whose events are already on the clock
const muteAt = new Map();                                     // bar → drum level scheduled for it (1 playing, 0 drop-out)
// The groove's settings: S in Groove mode; Tune's drums pass their own (a plain 16-bar loop, no count-in or drop-outs).
let G = S;

export function barIsRest(bar){ const [on, off] = G.drop.split('-').map(Number); return on ? (bar % (on + off)) >= on : false; }

// The first hit is found in the decoded audio so AAC encoder padding can't drift the downbeat.
export function firstHit(buf){
  const d = buf.getChannelData(0), n = Math.min(d.length, buf.sampleRate / 5); let peak = 0;
  for(let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
  for(let i = 0; i < n; i++) if(Math.abs(d[i]) > peak * .2) return i / buf.sampleRate;
  return 0;
}

// One looping source. Loop points come from the tempo, not the file edges.
// isCurrent() is checked after the (possibly slow) load: a stop or restart meanwhile means this start is stale.
export async function grooveStart(isCurrent, g = S){
  G = g;
  let buf; try{ buf = await getBuf('drums-' + g.bpm); }catch(e){ return false; }
  if(!isCurrent()) return false;
  clock.rate = 1 + g.fine / 100; clock.beatSec = 60 / g.bpm / clock.rate; clock.barSec = clock.beatSec * 4; clock.loopBars = +g.bars;
  src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.playbackRate.value = clock.rate;
  src.loopStart = firstHit(buf); src.loopEnd = src.loopStart + clock.loopBars * 240 / g.bpm;   // buffer seconds, pre-rate
  out = ctx.createGain(); src.connect(out).connect(bus.drums);   // per-loop gain: drop-outs and the stop fade live here
  newClickBus();
  const countBars = +g.countin;
  clock.t0 = ctx.currentTime + .1 + countBars * clock.barSec;
  src.start(clock.t0, src.loopStart);
  for(let b = 0; b < countBars * 4; b++) click(ctx.currentTime + .1 + b * clock.beatSec, b % 4 === 0, .35);
  scheduled = 0; muteAt.clear(); scheduleAhead(); clock.live = true;
  return true;
}

// Fade out over 40 ms instead of cutting (an instant stop mid-hit is an audible pop).
export function grooveStop(){
  clearInterval(schedTimer); dropClickBus(); clock.live = false; G = S;
  if(!src) return;
  const s = src, o = out, g = out.gain, now = ctx.currentTime; src = null; out = null;
  if(ctx.state !== 'running'){ try{ s.stop(); }catch(e){} o.disconnect(); return; }   // paused: already silent, and a fade would only play on the next resume
  if(g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(now); else { g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); }
  g.linearRampToValueAtTime(0, now + .04);
  try{ s.stop(now + .06); }catch(e){}
}

// Every 250 ms, put the next ~2 bars of events on the audio clock.
function scheduleAhead(){
  clearInterval(schedTimer);
  const step = () => {
    const now = ctx.currentTime;
    while(clock.t0 + scheduled * clock.barSec < now + 2 * clock.barSec){
      const b = scheduled, t = clock.t0 + b * clock.barSec;
      // drop-out edges ramp over 8 ms ending on the bar line, instead of stepping (a step is a click)
      const v = barIsRest(b) ? 0 : 1, pv = muteAt.has(b - 1) ? muteAt.get(b - 1) : 1; muteAt.set(b, v); muteAt.delete(b - 3);
      if(v !== pv && out){ const s = Math.max(t - .008, now); out.gain.setValueAtTime(pv, s); out.gain.linearRampToValueAtTime(v, Math.max(t, s + .002)); }
      if(G.click === 'on' && !barIsRest(b)) for(let k = 0; k < 4; k++) click(t + k * clock.beatSec, k === 0, .12);
      scheduled++;
    }
  };
  step(); schedTimer = setInterval(step, 250);
}

// Drop-out or click changed mid-session: clear what's already scheduled from the next bar on and redo it.
// A fresh click bus kills the stale clicks (bars were scheduled up to two ahead).
export function rescheduleFromNextBar(){
  if(!out) return;
  scheduled = Math.max(0, Math.floor((ctx.currentTime - clock.t0) / clock.barSec) + 1);
  out.gain.cancelScheduledValues(Math.max(ctx.currentTime, clock.t0 + scheduled * clock.barSec - .01));
  for(const b of [...muteAt.keys()]) if(b >= scheduled) muteAt.delete(b);
  newClickBus();
  scheduleAhead();
}

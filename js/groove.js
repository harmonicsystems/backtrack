// The groove: the drum loop (or the click alone), its clock, and the bar scheduler (drop-outs, rate steps, clicks).
import { S } from './state.js';
import { ctx, bus, getBuf, clickAt, clickDest, newClickBus, dropClickBus } from './audio.js';
import { setupOf, makeTimeline, scheduleClicks, restIn, rampString } from './timeline.js';

// t0 is bar 0's downbeat in ctx time; tl (the timeline) turns bars and cells into seconds from t0 and back.
// live: the groove is on the clock (false when stopped, or when the loop couldn't load). endBar: the scheduler puts
// nothing on the clock from this bar on (a session length). beatSec/barSec/rate: the current bar's, for the lab.
export const clock = { t0:0, tl:null, countBars:0, endBar:Infinity, live:false, loopBars:16, beatSec:.625, barSec:2.5, rate:1 };

let src = null, out = null, schedTimer = 0, scheduled = 0;   // scheduled = bars whose events are already on the clock
const muteAt = new Map();                                     // bar → drum level scheduled for it (1 playing, 0 drop-out)
// The groove's settings: S in Groove mode; Tune's drums pass their own (a plain 16-bar loop, no count-in or drop-outs).
let G = S;

export const barIsRest = bar => restIn(G.drop, bar);

// The first hit is found in the decoded audio so AAC encoder padding can't drift the downbeat.
export function firstHit(buf){
  const d = buf.getChannelData(0), n = Math.min(d.length, buf.sampleRate / 5); let peak = 0;
  for(let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
  for(let i = 0; i < n; i++) if(Math.abs(d[i]) > peak * .2) return i / buf.sampleRate;
  return 0;
}

const liveT = () => ({ t0: clock.t0, click: (t, f, l) => clickAt(ctx, clickDest(), t, f, l) });

// One looping source (or none: the click alone). Loop points come from the tempo, not the file edges.
// isCurrent() is checked after the (possibly slow) load: a stop or restart meanwhile means this start is stale.
export async function grooveStart(isCurrent, g = S){
  G = g;
  const drums = g.sound !== 'click';
  let buf = null;
  if(drums){ try{ buf = await getBuf('drums-' + g.bpm); }catch(e){ return false; } }
  if(!isCurrent()) return false;
  const setup = setupOf(g), tl = makeTimeline(setup);   // read after the load: a pattern changed while the loop loaded counts
  clock.tl = tl; clock.loopBars = setup.bars; clock.countBars = +g.countin; clock.endBar = Infinity;
  clock.rate = tl.rateOf(0); clock.beatSec = tl.pulseSecOf(0); clock.barSec = tl.barSecOf(0);
  if(drums){
    src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.playbackRate.value = tl.rateOf(0);
    src.loopStart = firstHit(buf); src.loopEnd = src.loopStart + setup.bars * 240 / g.bpm;   // buffer seconds, pre-rate
    out = ctx.createGain(); src.connect(out).connect(bus.drums);   // per-loop gain: drop-outs and the stop fade live here
  } else { src = null; out = null; }
  newClickBus();
  clock.t0 = ctx.currentTime + .1 + clock.countBars * tl.barSecOf(0);
  if(src) src.start(clock.t0, src.loopStart);
  scheduleClicks(liveT(), tl, -clock.countBars, 0);               // the count-in: one bar of the meter's pulses
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

// Every 250 ms, put the next ~2 bars of events on the audio clock: drop-out mutes, the ramp's rate steps, the clicks.
function scheduleAhead(){
  clearInterval(schedTimer);
  const step = () => {
    const tl = clock.tl, now = ctx.currentTime;
    while(scheduled < clock.endBar && clock.t0 + tl.barStart(scheduled) < now + 2 * tl.barSecOf(scheduled)){
      const b = scheduled, t = clock.t0 + tl.barStart(b);
      if(out){
        // drop-out edges ramp over 8 ms ending on the bar line, instead of stepping (a step is a click)
        const v = barIsRest(b) ? 0 : 1, pv = muteAt.has(b - 1) ? muteAt.get(b - 1) : 1; muteAt.set(b, v); muteAt.delete(b - 3);
        if(v !== pv){ const s = Math.max(t - .008, now); out.gain.setValueAtTime(pv, s); out.gain.linearRampToValueAtTime(v, Math.max(t, s + .002)); }
      }
      // a ramp step lands on the bar line, so the loop's position stays locked to the timeline
      if(src && (b === 0 || tl.rateOf(b) !== tl.rateOf(b - 1))) src.playbackRate.setValueAtTime(tl.rateOf(b), Math.max(t, now));
      scheduleClicks(liveT(), tl, b, b + 1);
      scheduled++;
    }
    const w = tl.at(now - clock.t0);                              // the current bar's tempo, for the lab
    clock.rate = tl.rateOf(w.bar); clock.beatSec = tl.pulseSecOf(w.bar); clock.barSec = w.barSec;
  };
  step(); schedTimer = setInterval(step, 250);
}

// Pattern, grouping or drop-out changed mid-session (the map itself can't change without a restart): clear what's
// already scheduled from the next bar on and redo it. The old click bus dies at that bar line, so the current bar
// keeps its clicks and only the stale ones go.
export function rescheduleFromNextBar(){
  if(!clock.live) return;
  // the map (tempo, Fine, ramp, meter, bars) stays the session's own: S.bpm may hold a tap not yet applied
  const s = clock.tl.setup, now = ctx.currentTime;
  const tl = clock.tl = makeTimeline(setupOf({ sound:s.sound, bpm:s.bpm, rate:s.rate, meter:String(s.meter.top), bars:s.bars, ramp:rampString(s.ramp),
                                               group:G.group, drop:G.drop, click:G.click, csub:G.csub, cells:G.cells, cvol:G.cvol }));
  scheduled = Math.max(0, tl.at(now - clock.t0).bar + 1);
  const at = Math.max(now, clock.t0 + tl.barStart(scheduled) - .01);
  if(out) out.gain.cancelScheduledValues(at);
  if(src) src.playbackRate.cancelScheduledValues(at);
  for(const b of [...muteAt.keys()]) if(b >= scheduled) muteAt.delete(b);
  newClickBus(at);
  scheduleAhead();
}

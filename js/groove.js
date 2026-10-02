// The groove: the drum loop (or the click alone), its clock, and the bar scheduler (drop-outs, rate steps, clicks).
import { S, droneAt, progOf, progEvery, washWanted } from './state.js';
import { ctx, bus, getBuf, clickAt, clickDest, newClickBus, dropClickBus, washTo, droneNow, emit } from './audio.js';
import { setupOf, makeTimeline, scheduleClicks, restIn, rampString } from './timeline.js';

// t0 is bar 0's downbeat in ctx time; tl (the timeline) turns bars and cells into seconds from t0 and back.
// live: the groove is on the clock (false when stopped, or when the loop couldn't load). endBar: the scheduler puts
// nothing on the clock from this bar on (a session length). beatSec/barSec/rate: the current bar's, for the lab.
export const clock = { t0:0, tl:null, countBars:0, endBar:Infinity, live:false, loopBars:16, beatSec:.625, barSec:2.5, rate:1 };

let src = null, out = null, schedTimer = 0, scheduled = 0;   // scheduled = bars whose events are already on the clock
const muteAt = new Map();                                     // bar → drum level scheduled for it (1 playing, 0 drop-out)
// A routine's glide crosses loops: curLoop is the recording playing (its bpm), prep the next one decoding ahead.
let curLoop = 0, prep = null, lastRate = 0;
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

// ---- a drone progression (Groove mode only: Tune's drums pass their own settings): the Wash moves on bar b's line
//      exactly when bar b's drone differs from bar b−1's. Each bar is issued once (a pattern change mid-session
//      reschedules bars, and must not move the drone twice). ----
const droneIssued = new Set();
const walking = () => !!(clock.tl && clock.tl.routine && clock.tl.routine.to !== clock.tl.routine.from);   // a routine's key walk
const moving = () => G === S && S.mode === 'groove' && (progOf(G.prog)[0] !== 'off' || walking()) && washWanted();
export const walk = () => clock.tl ? clock.tl.routine : null;   // the session's routine (the walk for droneAt), if any
// The key or the drone changed mid-session: issue the moves again for the bars already on the clock (washStart has just
// put the current bar's drone back; the moves it queued before were dropped with the old drone).
export function droneRefresh(){
  droneIssued.clear();
  if(!clock.live || !clock.tl) return;
  const now = clock.tl.at(ctx.currentTime - clock.t0).bar;
  for(let b = Math.max(1, now + 1); b < scheduled; b++) droneBar(b);
}
const sameDrone = (a, b) => a.key === b.key && Math.abs(a.rate - b.rate) < 1e-6;
function droneBar(b){
  if(b <= 0 || droneIssued.has(b) || !moving()) return;
  const d = droneAt(b, G, walk());
  if(sameDrone(d, droneAt(b - 1, G, walk()))) return;
  droneIssued.add(b);
  washTo(d.key, d.rate, clock.t0 + clock.tl.barStart(b), clock.tl.barSecOf(b) * progEvery(G));
}

// One looping source (or none: the click alone). Loop points come from the tempo, not the file edges.
// isCurrent() is checked after the (possibly slow) load: a stop or restart meanwhile means this start is stale.
// extra: a routine's fields for the session ({ routine, bpm }: app.js), laid over g for the timeline only.
export async function grooveStart(isCurrent, g = S, extra = null){
  G = g;
  const drums = g.sound !== 'click', src0 = () => extra ? { ...g, ...extra } : g;
  let buf = null, loop0 = drums ? setupOf(src0()).loop : 0;
  if(drums){ try{ buf = await getBuf('drums-' + loop0); }catch(e){ return false; } }
  if(!isCurrent()) return false;
  const setup = setupOf(src0()), tl = makeTimeline(setup);   // read after the load: a pattern changed while the loop loaded counts
  clock.tl = tl; clock.loopBars = setup.bars; clock.countBars = +g.countin; clock.endBar = Infinity;
  clock.rate = tl.rateOf(0); clock.beatSec = tl.pulseSecOf(0); clock.barSec = tl.barSecOf(0);
  curLoop = loop0; prep = null; lastRate = 0;
  if(drums){
    src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.playbackRate.value = tl.tempoOf(0) / loop0;
    src.loopStart = firstHit(buf); src.loopEnd = src.loopStart + setup.bars * 240 / loop0;   // buffer seconds, pre-rate
    out = ctx.createGain(); src.connect(out).connect(bus.drums);   // per-loop gain: drop-outs and the stop fade live here
  } else { src = null; out = null; }
  newClickBus();
  clock.t0 = ctx.currentTime + .1 + clock.countBars * tl.barSecOf(0);
  if(src) src.start(clock.t0, src.loopStart);
  scheduleClicks(liveT(), tl, -clock.countBars, 0);               // the count-in: one bar of the meter's pulses
  // a settings restart keeps the drone flowing: if a progression left it elsewhere, it comes home with the first bar line
  droneIssued.clear();
  const home = droneAt(-1, g, tl.routine), now = droneNow();
  if(moving() && now && !sameDrone(now, home)) washTo(home.key, home.rate, ctx.currentTime + .1, tl.barSecOf(0) * progEvery(g));
  scheduled = 0; muteAt.clear(); scheduleAhead(); clock.live = true;
  return true;
}
// A glide's next loop, decoded ahead of its bar line.
function prepLoop(bpm){
  const p = prep = { bpm, buf:null };
  getBuf('drums-' + bpm).then(b => { if(prep === p) p.buf = b; }, () => { if(prep === p) prep = null; });
}
// Switch to the loop bar b wants, on its bar line at t: a 12 ms crossfade ending on the line, the new recording
// coming in under the old one's last beat from its own bar (b mod the loop's bars, so the phrase keeps its place),
// its downbeat landing on the line at full level. The new per-loop gain ends the crossfade at the old one's level;
// the drop-out code then ramps it for bar b as usual.
export const XF = .012;
function switchLoop(b, t, now, buf, bpm){
  const tl = clock.tl, bars = tl.setup.bars, old = src, oldOut = out, lv = muteAt.has(b - 1) ? muteAt.get(b - 1) : 1;
  src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
  src.loopStart = firstHit(buf); src.loopEnd = src.loopStart + bars * 240 / bpm;
  const rate = src.playbackRate.value = tl.tempoOf(b) / bpm, s = Math.max(t - XF, now);
  out = ctx.createGain(); out.gain.setValueAtTime(0, s); out.gain.linearRampToValueAtTime(lv, Math.max(t, s + .002)); src.connect(out).connect(bus.drums);
  src.start(s, Math.max(0, src.loopStart + (b % bars) * 240 / bpm - (t - s) * rate));
  oldOut.gain.setValueAtTime(lv, s); oldOut.gain.linearRampToValueAtTime(0, Math.max(t, s + .002));
  try{ old.stop(Math.max(t, now) + .03); }catch(e){}
  setTimeout(() => { try{ oldOut.disconnect(); }catch(e){} }, Math.max(0, t - now) * 1000 + 500);
  curLoop = bpm; prep = null;
  emit('loop', { bar:b, bpm, tempo: tl.tempoOf(b) });
}

// Fade out over 40 ms instead of cutting (an instant stop mid-hit is an audible pop).
export function grooveStop(){
  clearInterval(schedTimer); dropClickBus(); clock.live = false; G = S; prep = null;
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
    // a glide's next loop decodes a few bars ahead of the line it's needed on
    if(src && tl.routine && !prep) for(let b = scheduled; b < scheduled + 6; b++) if(tl.loopOf(b) !== curLoop){ prepLoop(tl.loopOf(b)); break; }
    while(scheduled < clock.endBar && clock.t0 + tl.barStart(scheduled) < now + 2 * tl.barSecOf(scheduled)){
      const b = scheduled, t = clock.t0 + tl.barStart(b);
      let switched = false;
      if(src && b > 0 && tl.loopOf(b) !== curLoop){           // the glide crosses into another loop on this bar line
        const want = tl.loopOf(b);
        if(!prep || prep.bpm !== want) prepLoop(want);
        if(prep.buf){ switchLoop(b, t, now, prep.buf, want); switched = true; }
        else if(t - now > .3 * tl.barSecOf(b)) break;         // not decoded yet: wait for the next pass (250 ms)
        // (too late: this bar keeps the old loop, stretched a little further; the next bar line tries again)
      }
      if(out){
        // drop-out edges ramp over 8 ms ending on the bar line, instead of stepping (a step is a click)
        const v = barIsRest(b) ? 0 : 1, pv = muteAt.has(b - 1) ? muteAt.get(b - 1) : 1; muteAt.set(b, v); muteAt.delete(b - 3);
        if(v !== pv){ const s = Math.max(t - .008, now); out.gain.setValueAtTime(pv, s); out.gain.linearRampToValueAtTime(v, Math.max(t, s + .002)); }
      }
      // a ramp step (or a glide's bar) lands on the bar line, so the loop's position stays locked to the timeline
      const rate = src ? tl.tempoOf(b) / curLoop : 1;
      if(src && (b === 0 || switched || rate !== lastRate)) src.playbackRate.setValueAtTime(rate, Math.max(t, now));
      lastRate = rate;
      scheduleClicks(liveT(), tl, b, b + 1);
      droneBar(b);
      scheduled++;
    }
    const w = tl.at(now - clock.t0);                              // the current bar's tempo, for the lab
    clock.rate = src ? tl.tempoOf(w.bar) / curLoop : 1; clock.beatSec = tl.pulseSecOf(w.bar); clock.barSec = w.barSec;
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
  const tl = clock.tl = makeTimeline(setupOf({ sound:s.sound, bpm:s.bpm, rate:s.rate, meter:String(s.meter.top), bars:s.bars, ramp:rampString(s.ramp), routine:s.routine, loop:s.loop,
                                               group:G.group, drop:G.drop, click:G.click, csub:G.csub, cells:G.cells, cvol:G.cvol }));
  scheduled = Math.max(0, tl.at(now - clock.t0).bar + 1);
  const at = Math.max(now, clock.t0 + tl.barStart(scheduled) - .01);
  if(out) out.gain.cancelScheduledValues(at);
  if(src) src.playbackRate.cancelScheduledValues(at);
  lastRate = 0;                                                     // (the rate is set again from the next bar)
  for(const b of [...muteAt.keys()]) if(b >= scheduled) muteAt.delete(b);
  newClickBus(at);
  scheduleAhead();
}

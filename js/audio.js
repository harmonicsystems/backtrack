// The audio engine: one AudioContext, its buses, file loading, the drone player, clicks and reference tones.
import { S, FREQ, washWanted } from './state.js';

export let ctx = null;
// wash → swellLP (brightness) → swellAmp (level) → master: flat in Groove, the breath's swell in Breathe.
// Everything a session plays (drums, click, the drone's swell chain, the breath cues) runs through bus.session, so a
// session length can fade the whole thing out on the audio clock; reference tones and take playback go straight to master.
export const bus = { master:null, session:null, drums:null, wash:null, click:null, swellLP:null, swellAmp:null };

// The transport (app.js) tells the engine what "playing" means (and what else keeps it busy while stopped: the mic, a
// take playing); the engine reports outside pauses back.
const hooks = { running: () => false, held: () => false, busy: () => false, drone: () => null, hold(){}, unhold(){} };
export function setHooks(h){ Object.assign(hooks, h); }

let ourResume = false, idleTimer = 0, idleAt = 0, routing = false, sessionKind = 'playback';

// The audio x-ray (?xray) listens here; with nobody watching, emit() does nothing.
const watchers = new Set();
export const watch = fn => { watchers.add(fn); return () => watchers.delete(fn); };
export const emit = (type, detail) => { for(const f of watchers) try{ f(type, detail); }catch(e){} };
let born = 0, builds = 0;   // (for the x-ray: when this context was built, and how many have been)
export const engineInfo = () => ({ running: hooks.running(), held: hooks.held(), routing, sessionKind, born, builds });

// While the mic opens, iOS switches the audio route and can briefly interrupt the context: that's not an outside
// pause. Afterwards, if a session is playing and the context didn't come back by itself, resume it.
export function setRouting(on){
  routing = on; emit('routing', on ? 'on' : 'off');
  if(!on && ctx && hooks.running() && !hooks.held() && ctx.state !== 'running'){ ourResume = true; ctx.resume(); }
}
// 'playback' normally (plays through the silent switch); 'play-and-record' only while the mic is open.
export function setAudioSession(kind){ sessionKind = kind; emit('session', kind); try{ if(navigator.audioSession) navigator.audioSession.type = kind; }catch(e){} }

// iOS only lets audio start inside a tap, so Start builds/resumes the context up front.
export function unlock(){
  const fresh = !ctx; ensureCtx();
  try{ if(navigator.audioSession) navigator.audioSession.type = sessionKind; }catch(e){}   // 'playback' plays through the silent switch
  clearTimeout(idleTimer); idleTimer = 0;
  // a context built here may already be running and report it a moment later: that's ours too, not an unasked resume
  // (which would close it again: a tone or a take right after an idle close would be cut off)
  if(fresh) ourResume = true;
  if(ctx.state !== 'running'){ ourResume = true; ctx.resume(); emit('resume', ctx.state); }
}
// The context and its buses, without waking it (the mic's source node needs a context; decoding doesn't: see decoder()).
export function ensureCtx(){
  if(!ctx){
    ctx = new (window.AudioContext || window.webkitAudioContext)(); born = performance.now(); builds++;
    bus.master = ctx.createGain(); bus.master.connect(ctx.destination);
    bus.session = ctx.createGain(); bus.session.connect(bus.master);
    for(const b of ['drums','click']){ bus[b] = ctx.createGain(); bus[b].connect(bus.session); }
    bus.wash = ctx.createGain(); bus.swellLP = ctx.createBiquadFilter(); bus.swellAmp = ctx.createGain();
    bus.swellLP.type = 'lowpass'; bus.swellLP.Q.value = .5; bus.swellLP.frequency.value = 20000;
    bus.wash.connect(bus.swellLP).connect(bus.swellAmp).connect(bus.session);
    bus.drums.gain.value = +S.dvol; bus.wash.gain.value = +S.wvol; bus.click.gain.value = +S.cvol;
    // Lock screen / media widget / CarPlay Pause and Play go straight to the AudioContext in WebKit
    // (AudioContext::didReceiveRemoteControlCommand: Pause → suspendPlayback, Play → mayResumePlayback),
    // not to navigator.mediaSession handlers; calls and Siri interrupt it the same way. So the context's own
    // state is the source of truth: suspended/interrupted while playing = freeze in place ("Paused", everything
    // stays scheduled on the frozen clock); running again = carry on exactly where we were.
    // After an in-app stop the context is closed (idle()), so the lock screen can't restart it, and any other
    // unexpected resume while stopped closes it again: sound never starts unasked.
    ctx.onstatechange = () => {
      const on = ctx.state === 'running', ours = ourResume;
      if(on) ourResume = false;
      let did = '';
      if(!on && hooks.running() && !hooks.held() && !routing){ did = 'hold'; hooks.hold(); }
      else if(on && hooks.held()){ did = 'unhold'; hooks.unhold(); }
      else if(on && !hooks.running() && !ours){ did = 'back to sleep'; idle(0, true); }
      emit('state', { state: ctx.state, did, ours });
    };
    emit('build', { rate: ctx.sampleRate, n: builds });
  }
  return ctx;
}
// Nothing playing (after a stop, once the fades finish; after a tone or a take): the context is CLOSED, not suspended.
// iOS WebKit fixes a context's output path (its rate, the resampler, the RemoteIO format) when it's built and never
// updates it on a route change, so an engine built on the phone's speaker keeps its 48 kHz path when wired CarPlay
// (44.1 kHz) takes over, and plays with static. A page also can't tell when a route changes. Closing the only context
// lets WebKit switch the page's audio session off, which refreshes its stored copy of the route's rate, so the next
// start builds a fresh engine for the route in use: static → stop → start fixes it, no relaunch. (Research from WebKit
// source in CLAUDE.md.) The cost: after a stop, Now Playing leaves the lock screen and the car until the next start.
// A later, shorter idle() never pulls a pending close earlier (a stop's 2.6 s lets the drone's fade finish; the mic
// closing a moment later asks for 0.8 s): only `now` (an unasked resume) does.
export function idle(ms, now = false){
  const at = performance.now() + ms;
  if(!now && idleTimer && at < idleAt) return;
  clearTimeout(idleTimer); idleAt = at;
  idleTimer = setTimeout(() => { idleTimer = 0; if(ctx && !hooks.running() && !hooks.busy()) closeCtx('idle'); }, ms);
}
// WebKit's STORED rate (a new context reads the page's cached copy of the audio session's settings, refreshed only when
// the page's audio switches on or off, never on a route change), so mid-session it's the running context's own rate.
// A throwaway context, never started; the x-ray's Probe button only.
export function probeRate(){
  try{ const p = new (window.AudioContext || window.webkitAudioContext)(), r = p.sampleRate; p.close().catch(() => {}); return r; }catch(e){ return 0; }
}
// Throw the context away (stopped, mic closed); the next unlock() builds a new one. Files stay fetched and decoded
// (a buffer is re-decoded only if the new context runs at another rate: getBuf).
export function closeCtx(why){
  if(!ctx || hooks.running() || hooks.busy()) return false;
  const old = ctx;
  clearTimeout(idleTimer); idleTimer = 0; washGen++; for(const c of chains){ c.done = true; clearTimeout(c.timer); } chains = [];
  clickBus = null; dying.clear();
  old.onstatechange = null; ctx = null;
  if(old.sampleRate >= 44100) lastRate = old.sampleRate;             // (a call-quality 16/24 kHz engine mustn't set what renders decode at)
  lastLatency = (old.baseLatency || 0) + (old.outputLatency || 0);
  for(const k in bus) bus[k] = null;
  old.close().catch(() => {});
  emit('close', { why, rate: old.sampleRate });
  return true;
}

// Drop whatever is scheduled on p and glide to v. The glide starts one sample after the cancel point: a curve cut
// short by cancelAndHoldAtTime can end a hair past `now`, and an event inside a curve throws (seen in ~7% of stops
// during the very first swell curve).
export function settle(p, v, tau){
  const now = ctx.currentTime;
  if(p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(now); else { p.cancelScheduledValues(now); p.setValueAtTime(p.value, now); }
  try{ p.setTargetAtTime(v, now + 1 / ctx.sampleRate, tau); }catch(e){}
}
export const fadeTo = (param, to, dur) => settle(param, to, Math.max(dur, .02) / 3);

// ---- files: fetched early, decoded at the live context's rate (cached per rate), cached by the service worker.
//      With no live context (stopped: takes being prepared), an OfflineAudioContext decodes: a live one kept around
//      just to decode would keep the page's audio session on and block the refresh above. ----
const raw = {}, decoded = {};
let lastRate = 48000, offline = null, lastLatency = null;
// The last context's reported output latency, for estimates made while none is open (the Takes sheet's sync line).
export const outLatency = () => ctx ? (ctx.baseLatency || 0) + (ctx.outputLatency || 0) : lastLatency;
const decoder = () => ctx || (offline && offline.sampleRate === lastRate ? offline : (offline = new OfflineAudioContext(1, 1, lastRate)));
export const fetchFile = n => raw[n] ||= fetch(`audio/${n}.m4a`).then(r => { if(!r.ok) throw r.status; return r.arrayBuffer(); })
                                        .catch(e => { delete raw[n]; throw e; });
// A decoded Wash is ~13 MB, so at most three stay decoded (a drone progression's current, next and home); the rest are
// dropped least recently asked for first (their raw files stay fetched).
const WASH_KEEP = 3, washUsed = [];
export function getBuf(n){
  const d = decoder(), key = `${n}@${d.sampleRate}`;
  if(n.startsWith('wash-')){
    const i = washUsed.indexOf(n); if(i >= 0) washUsed.splice(i, 1); washUsed.push(n);
    while(washUsed.length > WASH_KEEP){ const old = washUsed.shift(); for(const k in decoded) if(k.startsWith(old + '@')) delete decoded[k]; }
  }
  if(!decoded[key]){
    for(const k in decoded) if(k.startsWith(n + '@')) delete decoded[k];   // one rate per file in memory
    decoded[key] = fetchFile(n).then(b => d.decodeAudioData(b.slice(0))).catch(e => { delete decoded[key]; throw e; });
  }
  return decoded[key];
}

// ---- the drone: a 34 s cut of the Wash per key, crossfaded into itself so it never seams (same player as Tide Breath).
//      A chain is one recording at one rate, looping its voices through its own gain. A drone progression (Groove)
//      crossfades from chain to chain on bar lines (washTo). Starts and moves go through one queue (washQ), so chains
//      begin in time order however long each recording takes to decode. ----
const XF = 4, EQ_IN = Float32Array.from({length:32}, (_, i) => Math.sin(i / 31 * Math.PI / 2)), EQ_OUT = EQ_IN.slice().reverse();
let chains = [], washGen = 0, washQ = Promise.resolve();
// Tune mode retunes the drone to its A4 (442: +7.9 cents, 432: −31.8) so it sits on the lines drawn for that A4.
export const washRate = () => S.mode === 'tune' ? +S.a4 / 440 : 1;
function voice(c, buf, t, fade){
  const src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = buf; src.playbackRate.value = c.rate; src.connect(g).connect(c.g);
  const end = t + buf.duration / c.rate - XF;
  g.gain.setValueCurveAtTime(EQ_IN, t, fade); g.gain.setValueCurveAtTime(EQ_OUT, end, XF);
  src.start(t); src.stop(end + XF + .05);
  c.voices.add(src); src.onended = () => c.voices.delete(src);
  return end;
}
function chainStart(buf, key, rate, t, fade){
  const c = { key, rate, g: ctx.createGain(), voices: new Set(), timer: 0, done: false };
  c.g.connect(bus.wash); chains.push(c);
  const loop = (tt, f) => { const next = voice(c, buf, tt, f);
    c.timer = setTimeout(() => { if(!c.done) loop(next, XF); }, (next - ctx.currentTime - 1.5) * 1000); };
  loop(t, fade);
  return c;
}
// Fade a chain out over d seconds from t (on the audio clock), then let it go.
function chainEnd(c, t, d){
  c.done = true; clearTimeout(c.timer);
  const p = c.g.gain;
  try{ p.setValueAtTime(1, t); p.setValueCurveAtTime(EQ_OUT, t, d); }catch(e){ try{ p.setTargetAtTime(0, t, d / 3); }catch(e2){} }
  for(const s of c.voices) try{ s.stop(t + d + .05); }catch(e){}
  const cx = ctx, tidy = () => {
    if(cx.state !== 'closed' && cx.currentTime < t + d + .1){ setTimeout(tidy, Math.max(60, (t + d + .15 - cx.currentTime) * 1000)); return; }
    try{ c.g.disconnect(); }catch(e){} chains = chains.filter(x => x !== c);
  };
  setTimeout(tidy, Math.max(0, (t + d - cx.currentTime) * 1000) + 150);
}
const liveChain = () => chains.filter(c => !c.done).pop();
// The drone playing now (or about to): its recording and pitch shift, the progression's own terms (washRate() aside).
export const droneNow = () => { const c = liveChain(); return c ? { key: c.key, rate: c.rate / washRate() } : null; };
// Start the drone: the progression's drone for the bar playing (hooks.drone), otherwise the key's. Resolves once it's
// on the clock (Tune re-learns the room's floor after it).
export function washStart(fade){
  if(!washWanted()) return Promise.resolve();
  const gen = washGen, d = hooks.drone() || { key: S.key, rate: 1 };
  return washQ = washQ.then(async () => {
    let buf; try{ buf = await getBuf('wash-' + d.key); }catch(e){ return; }
    if(gen !== washGen || !ctx || !hooks.running()) return;
    chainStart(buf, d.key, d.rate * washRate(), ctx.currentTime + .05, fade);
  });
}
// A move's crossfade: short, and finished ON the bar line, so the new root is there at full level on the downbeat and the
// old one is gone (a half-second fade centred on the line sounded late: −3 dB on the beat, full a quarter-second after).
export const moveFade = stepSec => Math.min(.12, .5 * stepSec);
// A progression's move: crossfade to another recording (at a pitch shift), arriving on the bar line at `at`. If the
// recording isn't decoded in time, it moves as soon as it is (logged).
export function washTo(key, rate, at, stepSec){
  if(!washWanted() || !ctx) return;
  const gen = washGen;
  washQ = washQ.then(async () => {
    let buf; try{ buf = await getBuf('wash-' + key); }catch(e){ return; }
    if(gen !== washGen || !ctx || !hooks.running()) return;
    const prev = liveChain(), r = rate * washRate();
    if(prev && prev.key === key && Math.abs(prev.rate - r) < 1e-6) return;                // already there
    const xs = moveFade(stepSec), want = at - xs, t = Math.max(want, ctx.currentTime + .03);
    if(prev) chainEnd(prev, t, xs);
    chainStart(buf, key, r, t, xs);
    emit('drone', { key, rate, at, late: t - want > .01 ? t - want : 0 });
  });
}
export function washStop(fade){
  washGen++;
  const now = ctx ? ctx.currentTime : 0;
  for(const c of chains){
    c.done = true; clearTimeout(c.timer); fadeTo(c.g.gain, 0, fade);
    for(const s of c.voices) try{ s.stop(now + fade + .1); }catch(e){}
  }
  const gone = chains; chains = [];
  setTimeout(() => gone.forEach(c => { try{ c.g.disconnect(); }catch(e){} }), (fade + .5) * 1000);
}

// ---- clicks are scheduled bars ahead, so each session routes them through its own bus; dropping the bus
//      silences every click still waiting (count-in, click track) instead of letting them tick on after a stop.
//      A pattern change mid-session drops it at the next bar line instead, so the current bar keeps its clicks. ----
let clickBus = null; const dying = new Set();   // buses fading at a coming bar line: a stop or a new session silences them too
export const clickDest = () => clickBus || bus.click;
export function newClickBus(at){ dropClickBus(at); clickBus = ctx.createGain(); clickBus.connect(bus.click); }
export function dropClickBus(at){
  const now = ctx.currentTime;
  if(!at) for(const cb of dying) fade(cb, now);      // now: whatever was still waiting for its bar line goes too
  if(!clickBus) return;
  const cb = clickBus; clickBus = null; fade(cb, Math.max(now, at || 0));
}
function fade(cb, t){
  dying.add(cb);
  cb.gain.cancelScheduledValues(t); cb.gain.setValueAtTime(1, t); cb.gain.setTargetAtTime(0, t, .003);
  // disconnect on the audio clock, not the wall clock: paused from outside, the clock stands still and the bus must wait
  // (on this bus's own context: once that context is closed its buses just go)
  const c = ctx, tidy = () => { if(c.state !== 'closed' && c.currentTime < t + .12){ setTimeout(tidy, Math.max(60, (t + .15 - c.currentTime) * 1000)); return; } cb.disconnect(); dying.delete(cb); };
  setTimeout(tidy, Math.max(0, (t - c.currentTime) * 1000) + 150);
}
// One click on any context (live or offline): a sine blip, 2 ms in, 50 ms out.
export function clickAt(c, dest, t, freq, level){
  const o = c.createOscillator(), g = c.createGain();
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + .002); g.gain.exponentialRampToValueAtTime(.0001, t + .05);
  o.connect(g).connect(dest); o.start(t); o.stop(t + .06);
}
export const click = (t, accent, level) => clickAt(ctx, clickDest(), t, accent ? 1600 : 1100, level);

// ---- reference tones in the key, sung against the drone ----
export const rootFreq = () => { let f = FREQ[S.key] * washRate(); while(f < 200) f *= 2; return f; };
export function tone(f, level, decay){
  unlock();
  const t = ctx.currentTime, g = ctx.createGain();
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + .02); g.gain.setValueAtTime(level, t + decay * .6); g.gain.exponentialRampToValueAtTime(.0001, t + decay);
  g.connect(bus.master);
  [[1,1],[2,.3],[3,.08]].forEach(([m, a]) => { const o = ctx.createOscillator(), og = ctx.createGain();
    o.frequency.value = f * m; og.gain.value = a; o.connect(og).connect(g); o.start(t); o.stop(t + decay + .05); });
  if(!hooks.running()) idle((decay + .5) * 1000);   // a tone while stopped lets the context close again afterwards
}

// The swell chain back to neutral (Groove mode): no brightness filter, full level.
export function flatSwell(){
  if(!ctx) return;
  settle(bus.swellLP.frequency, 20000, .05); settle(bus.swellAmp.gain, 1, .05);
}

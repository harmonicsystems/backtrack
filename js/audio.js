// The audio engine: one AudioContext, its buses, file loading, the drone player, clicks and reference tones.
import { S, FREQ } from './state.js';

export let ctx = null;
export const bus = { master:null, drums:null, wash:null, click:null };

// The transport (app.js) tells the engine what "playing" means; the engine reports outside pauses back.
const hooks = { running: () => false, held: () => false, hold(){}, unhold(){} };
export function setHooks(h){ Object.assign(hooks, h); }

let ourResume = false, idleTimer = 0, routing = false, sessionKind = 'playback';

// While the mic opens, iOS switches the audio route and can briefly interrupt the context: that's not an outside
// pause. Afterwards, if a session is playing and the context didn't come back by itself, resume it.
export function setRouting(on){
  routing = on;
  if(!on && ctx && hooks.running() && !hooks.held() && ctx.state !== 'running'){ ourResume = true; ctx.resume(); }
}
// 'playback' normally (plays through the silent switch); 'play-and-record' only while the mic is open.
export function setAudioSession(kind){ sessionKind = kind; try{ if(navigator.audioSession) navigator.audioSession.type = kind; }catch(e){} }

// iOS only lets audio start inside a tap, so Start builds/resumes the context up front.
export function unlock(){
  ensureCtx();
  try{ if(navigator.audioSession) navigator.audioSession.type = sessionKind; }catch(e){}   // 'playback' plays through the silent switch
  clearTimeout(idleTimer);
  if(ctx.state !== 'running'){ ourResume = true; ctx.resume(); }
}
// The context and its buses, without waking it: decoding and offline renders don't need a running context,
// and waking it outside a session would keep the phone's audio session busy for nothing.
export function ensureCtx(){
  if(!ctx){
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    bus.master = ctx.createGain(); bus.master.connect(ctx.destination);
    for(const b of ['drums','wash','click']){ bus[b] = ctx.createGain(); bus[b].connect(bus.master); }
    bus.drums.gain.value = +S.dvol; bus.wash.gain.value = +S.wvol;
    // Lock screen / media widget / CarPlay Pause and Play go straight to the AudioContext in WebKit
    // (AudioContext::didReceiveRemoteControlCommand: Pause → suspendPlayback, Play → mayResumePlayback),
    // not to navigator.mediaSession handlers; calls and Siri interrupt it the same way. So the context's own
    // state is the source of truth: suspended/interrupted while playing = freeze in place ("Paused", everything
    // stays scheduled on the frozen clock); running again = carry on exactly where we were.
    // WebKit ignores remote Play for a context the page suspended itself, so after an in-app stop (idleSuspend)
    // the lock screen can't restart it — and any other unexpected resume while stopped is put back to sleep,
    // so sound never starts unasked.
    ctx.onstatechange = () => {
      const on = ctx.state === 'running', ours = ourResume;
      if(on) ourResume = false;
      if(!on && hooks.running() && !hooks.held() && !routing) hooks.hold();
      else if(on && hooks.held()) hooks.unhold();
      else if(on && !hooks.running() && !ours) idleSuspend(0);
    };
  }
  return ctx;
}
// After a stop (once the fades finish) the context is suspended, so the lock screen and CarPlay show "paused"
// instead of "playing", and the phone isn't keeping an idle audio engine awake.
export function idleSuspend(ms){
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if(!hooks.running() && ctx && ctx.state === 'running') ctx.suspend(); }, ms);
}

export function fadeTo(param, to, dur){
  const now = ctx.currentTime;
  if(param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now); else param.cancelScheduledValues(now);
  try{ param.setTargetAtTime(to, now, Math.max(dur, .02) / 3); }catch(e){ param.value = to; }
}

// ---- files: fetched early, decoded once a context exists, cached by the service worker ----
const raw = {}, decoded = {};
export const fetchFile = n => raw[n] ||= fetch(`audio/${n}.m4a`).then(r => { if(!r.ok) throw r.status; return r.arrayBuffer(); })
                                        .catch(e => { delete raw[n]; throw e; });
export const getBuf = n => decoded[n] ||= fetchFile(n).then(b => ctx.decodeAudioData(b.slice(0)))
                                        .catch(e => { delete decoded[n]; throw e; });

// ---- the drone: a 34 s cut of the Wash per key, crossfaded into itself so it never seams (same player as Tide Breath) ----
const XF = 4, EQ_IN = Float32Array.from({length:32}, (_, i) => Math.sin(i / 31 * Math.PI / 2)), EQ_OUT = EQ_IN.slice().reverse();
let voices = [], washTimer = 0, washGen = 0;
function voice(buf, t, fade){
  const src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = buf; src.connect(g).connect(bus.wash);
  const end = t + buf.duration - XF;
  g.gain.setValueCurveAtTime(EQ_IN, t, fade); g.gain.setValueCurveAtTime(EQ_OUT, end, XF);
  src.start(t); src.stop(end + XF + .05);
  const v = {src, g}; voices.push(v); src.onended = () => { voices = voices.filter(x => x !== v); };
  return end;
}
export async function washStart(fade){
  if(S.wash !== 'on') return;
  const gen = ++washGen;
  let buf; try{ buf = await getBuf('wash-' + S.key); }catch(e){ return; }
  if(gen !== washGen || !hooks.running()) return;
  const t0 = ctx.currentTime + .05;
  const loop = t => { const next = voice(buf, t, t === t0 ? fade : XF);
    washTimer = setTimeout(() => { if(gen === washGen) loop(next); }, (next - ctx.currentTime - 1.5) * 1000); };
  loop(t0);
}
export function washStop(fade){
  washGen++; clearTimeout(washTimer);
  const now = ctx ? ctx.currentTime : 0;
  voices.forEach(({src, g}) => { fadeTo(g.gain, 0, fade); try{ src.stop(now + fade + .1); }catch(e){} });
}

// ---- clicks are scheduled bars ahead, so each session routes them through its own bus; dropping the bus
//      silences every click still waiting (count-in, click track) instead of letting them tick on after a stop ----
let clickBus = null;
export function newClickBus(){ dropClickBus(); clickBus = ctx.createGain(); clickBus.connect(bus.click); }
export function dropClickBus(){
  if(!clickBus) return;
  const cb = clickBus; clickBus = null;
  cb.gain.setTargetAtTime(0, ctx.currentTime, .003); setTimeout(() => cb.disconnect(), 150);
}
export function click(t, accent, level){
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.value = accent ? 1600 : 1100;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + .002); g.gain.exponentialRampToValueAtTime(.0001, t + .05);
  o.connect(g).connect(clickBus || bus.click); o.start(t); o.stop(t + .06);
}

// ---- reference tones in the key, sung against the drone ----
export const rootFreq = () => { let f = FREQ[S.key]; while(f < 200) f *= 2; return f; };
export function tone(f, level, decay){
  unlock();
  const t = ctx.currentTime, g = ctx.createGain();
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + .02); g.gain.setValueAtTime(level, t + decay * .6); g.gain.exponentialRampToValueAtTime(.0001, t + decay);
  g.connect(bus.master);
  [[1,1],[2,.3],[3,.08]].forEach(([m, a]) => { const o = ctx.createOscillator(), og = ctx.createGain();
    o.frequency.value = f * m; og.gain.value = a; o.connect(og).connect(g); o.start(t); o.stop(t + decay + .05); });
  if(!hooks.running()) idleSuspend((decay + .5) * 1000);   // a tone while stopped lets the context sleep again afterwards
}

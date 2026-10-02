// The transport (start / stop / pause-from-outside), the frame loop, the lock-screen info, and the control wiring.
import { S, TEMPOS, keyLabel, restore, save, applyPreset, presetString, LAB, XRAY, switchMode, durs, fmtN, breath, breathLabel, washWanted, tuneLabel, describe, layersLine, tuningTag, noiseName, droneWord, TEXTURES, droneAt, progOf, progEvery, isClick, meter, conform, cells, ramp,
         walkOf, walkKeys, walkOff, noiseTo, untilMs, lenLabel } from './state.js';
import { ctx, bus, unlock, idle, setHooks, fadeTo, settle, fetchFile, washStart, washStop, tone, rootFreq, flatSwell, emit, closeCtx, synthNotes, synthTone } from './audio.js';
import { NOTES, TONES, levelsOf, hexOf } from './synth.js';
import { fitCells } from './timeline.js';
import { bclock, where, breathStart, breathStop, breathRest } from './breath.js';
import { clock, barIsRest, grooveStart, grooveStop, rescheduleFromNextBar, droneRefresh, walk } from './groove.js';
import { $, reduced, render, face, faceReset, initControls, initSheet, openSheet, closeSheet, sheetOpen, initNight, initShortcutCard, initAudioFile, setSynthHooks, toast, recUI, takesCount, micSheet, homeInfo, setGlanceHooks, setArriveOpen } from './ui.js';
import { tuneReset, tuneFrame, tuneGuides, tuneTheme, tuneListening, tuneIdle, tuneQuiet, droneHz } from './tune.js';
import { createTracker } from './pitch.js';
import { clockUpdate, heardPos, clockReset, keep, pct } from './clock.js';
import * as rec from './rec.js';
import { initTakes, refreshTakes, refreshHistory, stopPlayback, takePlaying, initMicPicker, refreshMics } from './takes.js';
import { initViewer, viewFrame, viewBreath, viewStop, viewChanged } from './viewer.js';
import { noiseStart, noiseStop, noiseEq, noiseColor, wavesRestart, waveHeight, noiseRoutine, noiseProgress } from './noise.js';
import { LOOPS } from './timeline.js';

// The beat-view lab loads only with ?lab; until it arrives (or without ?lab) these hooks do nothing.
let lab = null;
if(LAB) import('./lab.js').then(m => { lab = m; m.initLab({ running: () => running }); }).catch(() => {});
// The audio x-ray (?xray): a debug overlay that watches the engine (audio.js emits, it listens). Close audio = stop and
// close the context now instead of after the fades; the next start (a later tap, once WebKit's audio session is off
// and its stored rate refreshed) builds a fresh one. A new context in the same tap would read the stale rate.
if(XRAY) import('./xray.js').then(m => m.initXray({ running: () => running, held: () => held, runMode: () => runMode, close: () => {
  if(rec.micActive()) return 'The mic is open: stop Tune or the take first.';
  if(running) stop();
  stopPlayback();
  return closeCtx('asked') ? '' : 'Nothing to close: the audio is already closed.';
} })).catch(e => console.error(e));

const ms = 'mediaSession' in navigator ? navigator.mediaSession : null;   // lock screen / media widget / CarPlay
const go = $('go'), beats = $('beats');

// running = a session is on; held = it was paused from outside (lock screen, widget, CarPlay, a call) and is frozen in place.
// session increments on every start/stop, so async steps (loading a groove) can tell they've gone stale.
// runMode = the mode the session was started in (a #link can switch S.mode before the session is stopped).
let running = false, held = false, session = 0, raf = 0, sessionStart = 0, lastBeat = -1, lastBar = -1, lastCell = -1, runMode = 'groove';

// Lock screen / media widget / CarPlay: title, drone and artwork. (WebKit sends their Play/Pause to the
// AudioContext itself — see audio.js — the handlers below are a fallback for browsers that route them here.)
function mediaMeta(){
  if(!ms || !window.MediaMetadata) return;
  const b = S.mode === 'breathe', t = S.mode === 'tune', n = S.mode === 'noise', k = keyLabel();
  ms.metadata = new MediaMetadata({
    title: n ? noiseName() : b ? `${breathLabel()} · breathe` : t ? tuneLabel() : `${S.bpm} bpm · ${describe().long}`, artist:'BackTrack',
    album: n ? 'Noise' + (S.nwave !== '0' ? ` · waves ${S.nwave} s` : '') + (S.len !== '0' ? ` · ${lenLabel()}` : '') : b ? (S.bsound === 'wash' ? `${droneWord()} in ${k}` + tuningTag() : S.bsound === 'hum' ? `Hum in ${k}` + tuningTag() : 'Silent') : t ? (S.tdrone === 'wash' ? `${droneWord()} in ${k}` + tuningTag() : 'No drone') : layersLine(S, k),
    artwork:[{ src:new URL(n ? `icons/n/${S.ncolor}.png` : b ? `icons/b/${(breath() || [0, 0, 0, 'custom'])[3]}.png` : t ? `icons/t/${S.key}${S.tinst === 'C' ? '' : '-' + S.tinst}.png`
      : isClick() ? `icons/c/${S.bpm}.png` : `icons/p/${S.bpm}-${S.key}.png`, document.baseURI).href, sizes:'180x180', type:'image/png' }] });
}
let guideKey = '';
function update(){
  render(); save(); mediaMeta(); viewChanged();
  const gk = [S.key, S.tinst, S.tlines, S.treg].join(); if(gk !== guideKey){ guideKey = gk; tuneGuides(); }   // Tune's lines follow
  if(!running) tuneIdle();
}

// ---- the frame loop: the circle shows count-in, bar number, beat dots, and rests ----
function tick(){
  if(!running) return;
  if(runMode === 'tune'){
    const now = performance.now() / 1000;
    if(tuneGraph){
      tuneGraph.an.getFloatTimeDomainData(tuneGraph.buf);
      tracker.push(tuneGraph.buf, ctx.sampleRate, ctx.currentTime, { a4:+S.a4, droneHz:droneHz() });
      tuneFrame(tracker.read(now), now);
    }
    face.elapsed(Math.floor((performance.now() - sessionStart) / 1000));
    raf = requestAnimationFrame(tick); return;
  }
  if(runMode === 'noise'){
    const sec = Math.floor(elapsedSec());
    face.noise(waveHeight(ctx.currentTime), Math.floor(sec / 60));
    face.elapsed(Math.floor((performance.now() - sessionStart) / 1000));
    checkEnd(); face.left(sessionLeft());
    raf = requestAnimationFrame(tick); return;
  }
  if(runMode === 'breathe'){
    const bt = Math.max(0, ctx.currentTime - bclock.t0), bw = where(bt);
    face.breath(bw); viewBreath(bw, bt, bclock.d);
    face.elapsed(Math.floor((performance.now() - sessionStart) / 1000));
    checkEnd(); face.left(sessionLeft());
    raf = requestAnimationFrame(tick); return;
  }
  const perf = performance.now(); clockUpdate(perf);
  const pos = heardPos(perf), tl = clock.tl;           // the raw audio clock, unless the lab switches to "what you hear"
  if(tl){
    const w = tl.at(pos), M = tl.meter;                // the timeline turns the position into bar · beat · cell
    face.drone(droneCue(pos < 0 ? -1 : w.bar));
    if(pos < 0 && !clock.countBars) face.preroll();
    else if(pos < 0) face.count(w.bar < -1 ? 0 : w.beat);   // the first 0.1 s (before the count-in bar) reads as beat 1
    else {
      const key = w.bar * 64 + w.beat, newBeat = key !== lastBeat, newCell = w.bar !== lastBar || w.cell !== lastCell;
      lastBeat = key; lastBar = w.bar; lastCell = w.cell;
      face.bar({ beat:w.beat, bar:w.bar, cell:w.cell, inLoop: w.bar % clock.loopBars + 1, rest: barIsRest(w.bar), newBeat, newCell,
                 down: M.pulseLevel[M.beatStart[w.pulse]] === 3 });
      if(tl.setup.ramp || (tl.routine && tl.routine.bpm != null)) face.tempo(Math.round(w.tempo));   // the tempo you hear (Fine included; the title drops its suffix)
    }
  }
  face.elapsed(Math.floor((perf - sessionStart) / 1000));
  checkEnd(); face.left(sessionLeft());
  if(lab) lab.labFrame(pos, perf); else viewFrame(pos);
  raf = requestAnimationFrame(tick);
}

let lock = null;
// (Noise leaves the screen free to lock: the noise plays on, and a sleep timer shouldn't keep a lit screen by the bed.)
async function wake(){ try{ if(running && !held && S.mode !== 'noise' && 'wakeLock' in navigator && !lock){ lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => lock = null); } }catch(e){} }
function sleep(){ if(lock){ lock.release().catch(() => {}); lock = null; } }

// keepWash: settings changed mid-session restart the groove but let the drone keep flowing.
// explained: called from the mic explainer's own button, so it mustn't show the explainer again.
async function start(keepWash, explained){
  if(S.mode === 'tune' && !tuneCap && !explained && !rec.micGranted()){ micSheet(true); return; }   // first time: say what Tune does with the mic
  unlock(); stopPlayback();                            // a take playing in the Takes sheet gives way to the groove
  settle(bus.session.gain, 1, .03);                    // back from a session length's fade-out
  clearTimeout(tempoTimer); tapReset();                // a tap or nudge still pending would only restart what is starting now
  const sid = ++session; held = false; pendingRestart = false;
  running = true; if(ms) ms.playbackState = 'playing'; wake();
  face.running(true);
  [window, $('app')].forEach(el => el.scrollTo({ top:0, behavior: reduced ? 'auto' : 'smooth' }));
  sessionStart = performance.now(); lastBeat = lastBar = lastCell = -1;
  faceReset(); clockReset(); if(lab) lab.labReset();
  if(!keepWash){ washing = washStart(3); logStart = performance.now(); pausedMs = 0; logId = 's' + Date.now().toString(36); doneBefore = 0; untilCache = null; rt0 = null; }
  runMode = S.mode; emit('transport', `start ${S.mode}${keepWash ? ' (settings restart)' : ''}`); logName = S.mode === 'noise' ? noiseName() : S.mode === 'breathe' ? `${breathLabel()} breath` : S.mode === 'tune' ? tuneLabel() : grooveLogName();
  logSetup = { preset:presetString(), ...homeInfo() };          // what Setup's Recents shows and loads (the last settings, like the name)
  clearInterval(endTimer); endTimer = setInterval(checkEnd, 250);   // the session length's deadline, checked even with the screen off
  if(runMode === 'noise'){ noiseStart(2); noiseRoutine(noiseRt()); tick(); return; }
  if(runMode === 'breathe'){ breathStart(); tick(); return; }
  flatSwell();
  if(runMode === 'tune'){ tuneStart(sid); return; }
  const rt = grooveRt(keepWash); prefetchLoops(rt);
  const ok = await grooveStart(() => sid === session && running, S, rt);
  if(sid !== session) return;                          // stopped or restarted while loading: that session owns the screen now
  if(!ok){ face.offline(); return; }
  tick();
}
function stop(keepWash){
  if(recState === 'recording') recStop();
  const wasRunning = running;
  if(held) pausedMs += performance.now() - heldAt;
  if(keepWash && running && ctx){                      // a settings restart: the bars or cycles done so far still count
    if(runMode === 'groove' && clock.live && clock.tl) doneBefore += Math.max(0, clock.tl.at(ctx.currentTime - clock.t0).bar);
    else if(runMode === 'breathe' && bclock.live) doneBefore += Math.floor(Math.max(0, ctx.currentTime - bclock.t0) / bclock.cycle);
  }
  clearInterval(endTimer); endT = endFade = 0; clock.endBar = Infinity; bclock.endT = 0;
  running = false; held = false; pendingRestart = false; session++; cancelAnimationFrame(raf); sleep();
  if(wasRunning) emit('transport', `stop ${runMode}${keepWash ? ' (settings restart)' : ''}`);
  if(runMode === 'noise') noiseStop(keepWash ? .3 : 2); else if(runMode === 'breathe') breathStop(keepWash ? .2 : 2); else grooveStop();
  if(!keepWash){ tuneStop(); washStop(2); idle(2600); if(wasRunning) logIt(); }   // once the fades finish, the context closes (audio.js)
  if(ms) ms.playbackState = 'paused';
  face.running(false); viewStop(); if(!keepWash){ tuneIdle(); tuneQuiet(); }
  if(lab) lab.kickPreview();
}
// While paused from outside, a settings change must not resume the sound: it's remembered and applied on resume.
let pendingRestart = false;
function restart(){ if(!running) return; if(held){ pendingRestart = true; return; } stop(true); start(true); }

// Paused from outside: everything stays scheduled on the (now frozen) audio clock, so resuming is seamless.
function hold(){
  if(runMode === 'tune'){ stop(); return; }            // Tune closes the mic when paused from outside (a call, the lock screen)
  held = true; heldAt = performance.now(); cancelAnimationFrame(raf); sleep(); if(ms) ms.playbackState = 'paused'; face.held(true); logIt();
  if(recState === 'recording') recStop();              // a paused background app can be ended by iOS: save the take now
}
function unhold(){
  held = false; face.held(false); pausedMs += performance.now() - heldAt;

  // settings changed while paused: restart with them. A routine ending at a time of day restarts too, so the glide
  // fits the time left (the pause moved its arrival, not the clock on the wall).
  if(pendingRestart || (S.len[0] === '@' && (runMode === 'groove' ? !!(S.tobpm || S.tokey) : runMode === 'noise' && !!noiseTo()))){ pendingRestart = false; stop(true); start(true); return; }
  if(ms) ms.playbackState = 'playing'; wake(); lastBeat = -1; tick();
}
function resumeHeld(){ unlock(); if(ctx.state === 'running') unhold(); }   // otherwise the context's statechange unholds once it runs
// drone: what a progression plays in the bar under way (so a drone (re)started mid-session starts on the right root)
const walking = () => { const R = walk(); return !!R && R.to !== R.from; };   // the session's key walk (a routine)
const moving = () => S.mode === 'groove' && (progOf(S.prog)[0] !== 'off' || walking());
setHooks({ running: () => running, held: () => held, busy: () => rec.micActive() || takePlaying(), hold, unhold,
  drone: () => running && runMode === 'groove' && moving() && clock.live && clock.tl ? droneAt(clock.tl.at(ctx.currentTime - clock.t0).bar, S, walk()) : null });
// Every recording a progression (or a key walk) will use, fetched ahead (~400 KB each; decoding waits for the bar it's needed in).
function prefetchDrones(){
  if(!washWanted() || S.dsrc === 'synth') return;
  const keys = new Set([S.key]);
  if(S.mode === 'groove' && progOf(S.prog)[0] !== 'off') progOf()[2].forEach((_, i) => keys.add(droneAt(i * progEvery(), S).key));
  if(S.mode === 'groove' && S.tokey) walkKeys(S).forEach(k => keys.add(k));
  keys.forEach(k => fetchFile('wash-' + k).catch(() => {}));
}
// The drum loops a glide passes through, fetched ahead (each decodes a few bars before its first bar line).
function prefetchLoops(rt = null){
  if(S.mode !== 'groove' || isClick()) return;
  const to = rt && rt.routine ? rt.routine.bpm : S.tobpm ? +S.tobpm : null; if(to == null) return;
  const lo = Math.min(S.bpm, to) * .9, hi = Math.max(S.bpm, to) * 1.1;
  LOOPS.filter(l => l >= lo && l <= hi).forEach(l => fetchFile('drums-' + l).catch(() => {}));
}
// "on F", or "next: C" in the last bar before a move (Groove with a progression and the drone on)
const droneCue = bar => {
  if(!moving() || S.wash !== 'on') return '';
  const d = droneAt(bar, S, walk()), n = droneAt(bar + 1, S, walk());
  return bar >= 0 && n.note !== d.note ? `next: ${keyLabel(n.note)}` : `on ${keyLabel(d.note)}`;
};

// ---- a routine (Arrive): the session moves to a destination over its length. Groove: the glide and the key walk go
//      into the timeline (groove.js, as extra fields over S); Noise: the voice follows the clock (noise.js). ----
let rt0 = null;   // the start tempo and key the routine began from: a settings restart with them unchanged continues
                  // from the tempo and the drone heard now, over the time left; a changed one starts the move afresh
function grooveRt(keepWash){
  const spec = lenSpec(); if(!spec || spec.cycles) return null;
  const to = walkOf(S), dest = S.tobpm ? +S.tobpm : null;
  if(!to && dest == null) return null;
  const r = { bpm: dest, from: 0, to }, x = { routine: r };
  if(spec.loops) r.bars = Math.max(1, spec.loops * +S.bars - doneBefore);
  else r.sec = Math.max(1, secLeft(spec) - (S.countin === '1' ? 240 / S.bpm : 0) - .1);   // arrive as the minutes run out
  if(keepWash && rt0 && clock.tl && ctx){
    const tl = clock.tl, w = tl.at(ctx.currentTime - clock.t0), R = tl.routine;
    if(R && R.bpm != null && S.bpm === rt0.bpm){ const b = Math.round(w.tempo / tl.setup.rate); x.bpm = b; if(dest != null && Math.abs(b - dest) < 1) r.bpm = null; }   // (arrived already: stay)
    if(R && S.key === rt0.key) r.from = walkOff(w.bar, R);
  } else rt0 = { bpm:S.bpm, key:S.key };
  return x;
}
function noiseRt(){
  const spec = lenSpec(), to = noiseTo(); if(!spec || !to) return null;
  const left = secLeft(spec); return left > 0 ? { to, left } : null;
}
const noiseSync = () => { if(running && runMode === 'noise') noiseRoutine(noiseRt()); };

// ---- Tune: the mic stays open while the circle runs (a settings restart keeps it), feeding the pitch tracker through
//      a 4 kHz lowpass (sharper peaks for bright tones) and an analyser read once per frame on the main thread. ----
let tuneCap = null, tuneGraph = null, washing = null;
const tracker = createTracker();
// What reaches the mic changed (drone started or retuned, volume, drums, route): the tracker re-learns the room's floor.
// Drone changes wait until the Wash is actually playing: loading it can take longer than the 2 s re-learning.
const relearn = () => tracker.relearn(), relearnAfter = p => Promise.resolve(p).then(relearn, relearn);
const TUNE_DRUMS = { fine:'0', bars:'16', countin:'0', drop:'0-0', click:'off' };   // Tune's drums: a plain loop
async function tuneStart(sid){
  tuneReset(); tracker.reset();
  if(!tuneCap){
    let cap;
    try{ cap = await rec.openMic({ capture:false }); }   // getUserMedia starts inside the tap, before this await
    catch(e){
      if(sid !== session) return;
      stop(); toast(e && e.name === 'NotAllowedError' ? 'Tune needs the microphone to show your pitch. You can turn it on in Settings.' : 'Couldn’t open the microphone.');
      return;
    }
    if(sid !== session || !running){ rec.releaseMic(cap); return; }
    tuneCap = cap;
    const lp = ctx.createBiquadFilter(), an = ctx.createAnalyser(), sink = ctx.createGain();
    lp.type = 'lowpass'; lp.frequency.value = 4000; lp.Q.value = .707; an.fftSize = 2048; sink.gain.value = 0;   // the analyser must reach the destination to run; silently
    rec.micSource(cap).connect(lp).connect(an).connect(sink).connect(ctx.destination);
    tuneGraph = { lp, an, sink, buf: new Float32Array(an.fftSize) };
    refreshMics();                                     // the browser names the inputs once the mic is on
  }
  tuneListening(true); tick();
  if(washing) relearnAfter(washing);
  if(+S.tdrums) relearnAfter(grooveStart(() => sid === session && running, { bpm:+S.tdrums, ...TUNE_DRUMS }));
}
function tuneStop(){
  if(tuneGraph){ try{ rec.micSource(tuneCap).disconnect(tuneGraph.lp); tuneGraph.lp.disconnect(); tuneGraph.an.disconnect(); tuneGraph.sink.disconnect(); }catch(e){} tuneGraph = null; }
  if(tuneCap){ rec.releaseMic(tuneCap); tuneCap = null; }
}
rec.setMicHooks({
  ended: () => { if(recState === 'recording') recStop(); if(running && runMode === 'tune'){ stop(); toast('The microphone turned off, so Tune stopped.'); } },
  input: () => { refreshMics(); if(running && runMode === 'tune') relearn(); },
});

// ---- a session length. Minutes count wall time minus held time (the history's formula, so a settings restart doesn't
//      reset them); loops and cycles count bars and cycles across restarts. The end is always musical: the next bar
//      line, or the end of the breath cycle in progress, with bus.session fading out over the last bar (at most 1.5 s)
//      on the audio clock, so silence lands on the line whatever the timers do. A take in progress ends before the fade. ----
let endT = 0, endFade = 0, endTimer = 0, doneBefore = 0, lastTakeToast = -1e9, untilCache = null;
// '@19:30' ends at that time of day (today, or tomorrow once it has passed), fixed when the session starts.
const untilFor = len => { if(!untilCache || untilCache.len !== len) untilCache = { len, ms: untilMs(len) }; return untilCache.ms; };
const lenSpec = () => { const v = S.len; if(!v || v === '0') return null; return v[0] === 'l' ? { loops:+v.slice(1) } : v[0] === 'c' ? { cycles:+v.slice(1) } : v[0] === '@' ? { until: untilFor(v) } : { min:+v }; };
const elapsedSec = () => ((held ? heldAt : performance.now()) - logStart - pausedMs) / 1000;
const secLeft = spec => spec.until ? (spec.until - Date.now()) / 1000 : spec.min * 60 - elapsedSec();   // (a time of day counts on the wall, pauses included)
const lastPhase = () => { const d = durs().filter(x => x > 0); return d[d.length - 1] || 1; };
function armEnd(f){
  endFade = endT - Math.max(.05, f);
  const g = bus.session.gain; g.setValueAtTime(1, Math.max(ctx.currentTime, endFade)); g.linearRampToValueAtTime(0, endT);
}
function disarmEnd(){ endT = endFade = 0; clock.endBar = Infinity; bclock.endT = 0; if(ctx) settle(bus.session.gain, 1, .02); }
function checkEnd(){
  if(!running || held || runMode === 'tune') return;
  const spec = lenSpec(); if(!spec){ if(endT) disarmEnd(); return; }
  const now = ctx.currentTime;
  if(!endT){
    if(runMode === 'noise'){                           // no bars or breaths to land on: when the minutes are up, a 30 s fade
      noiseProgress();                                 // (a routine's EQ and color follow the clock here, screen off too)
      if(!(spec.min || spec.until) || secLeft(spec) > 0) return;
      endT = now + 30; armEnd(30);
    } else if(runMode === 'groove'){
      const tl = clock.tl; if(!tl || !clock.live) return;
      const next = Math.max(0, tl.at(now - clock.t0).bar) + 1;
      let due;
      if(spec.loops) due = Math.max(next, spec.loops * clock.loopBars - doneBefore);
      else if(secLeft(spec) <= 0) due = next;
      else return;
      const f = Math.min(1.5, tl.barSecOf(due - 1));
      if(due === next && clock.t0 + tl.barStart(due) - now < f * .8) due++;   // room for the fade: one bar later
      endT = clock.t0 + tl.barStart(due); clock.endBar = due; armEnd(f);
    } else {
      if(!bclock.live) return;
      const cyc = bclock.cycle, next = Math.floor(Math.max(0, now - bclock.t0) / cyc) + 1, f = Math.min(1.5, lastPhase());
      let k;
      if(spec.cycles) k = Math.max(next, spec.cycles - doneBefore);
      else if(secLeft(spec) <= 0) k = next;
      else return;
      if(k === next && bclock.t0 + k * cyc - now < f * .8) k++;              // room for the fade: one cycle later
      endT = bclock.t0 + k * cyc; bclock.endT = endT; armEnd(f);
    }
  }
  if(recState === 'recording' && now >= endFade) recStop();
  if(now >= endT){
    const n = spec.min || spec.loops || spec.cycles, unit = spec.min ? 'min' : spec.loops ? 'loop' : 'cycle', at = spec.until ? lenLabel(S.len).replace('until ', '') : '';
    stop();
    if(performance.now() - lastTakeToast > 4000) toast(at ? `Session done · ${at}` : `Session done · ${n} ${unit}${unit !== 'min' && n !== 1 ? 's' : ''}`);   // a take's toast keeps its Listen
  }
}
function sessionLeft(){
  const spec = lenSpec(); if(!spec || !ctx) return null;
  if(spec.min || spec.until) return { sec: Math.max(0, secLeft(spec)) };
  if(runMode === 'groove'){
    if(!clock.tl) return null;
    const bar = Math.max(0, clock.tl.at(ctx.currentTime - clock.t0).bar) + doneBefore;
    return { count: Math.max(0, Math.ceil((spec.loops * clock.loopBars - bar) / clock.loopBars)), unit:'loop' };
  }
  const n = Math.floor(Math.max(0, ctx.currentTime - bclock.t0) / bclock.cycle) + doneBefore;
  return { count: Math.max(0, spec.cycles - n), unit:'cycle' };
}

// ---- the quiet history: one entry per session of 20 s or more (paused time doesn't count; settings restarts don't split it).
//      Written at every outside pause and when the app goes away too (iOS may end a paused app), then rewritten at stop. ----
let logStart = 0, pausedMs = 0, heldAt = 0, logName = '', logId = '', logSetup = {};
const grooveLogName = () => `${S.bpm} bpm ${describe().long}`;
function logIt(){
  const sec = Math.round(((held ? heldAt : performance.now()) - logStart - pausedMs) / 1000);
  if(sec < 20) return;
  rec.logSession({ id:logId, mode:runMode, name:logName, preset:logSetup.preset, home:logSetup.name, icon:logSetup.icon, start: Date.now() - sec * 1000, seconds: sec }).then(refreshHistory, () => {});
}
addEventListener('pagehide', () => { if(running) logIt(); });

// ---- startup ----
restore(); initControls(); initSheet(); initNight(); initShortcutCard(); update();
initAudioFile(() => recState !== 'idle' || rec.micBusy());   // Save as audio waits while a take records or Measure listens
if(S.mode === 'groove' && !isClick()) fetchFile('drums-' + S.bpm).catch(() => {}); prefetchDrones();

// ---- the transport controls ----
const toggle = () => held ? resumeHeld() : running ? stop() : start();
go.addEventListener('click', toggle);
beats.addEventListener('click', e => { if(e.target.closest('.labbar, .brec, .vpick')) return; if(held) resumeHeld(); else if(running) stop(); });
addEventListener('keydown', e => {
  if(sheetOpen() || e.metaKey || e.ctrlKey || /INPUT|SELECT|BUTTON|TEXTAREA/.test(e.target.tagName)) return;
  if(e.code === 'Space'){ e.preventDefault(); toggle(); }
  else if(e.key === 'r' && !e.repeat){ e.preventDefault(); recToggle(); }
});
// Coming back to the app never un-pauses by itself: a session paused from the lock screen stays paused until you say so.
document.addEventListener('visibilitychange', () => { if(document.visibilityState !== 'visible') return; wake(); if(running && !held && ctx && ctx.state !== 'running') unlock(); });
if(ms){
  for(const [action, fn] of [['play', () => { if(held) resumeHeld(); else if(!running) start(); }],
                              ['pause', () => { if(running && !held){ hold(); ctx.suspend(); } }],
                              ['stop', () => { if(running) stop(); }]]){
    try{ ms.setActionHandler(action, fn); }catch(e){}
  }
}

// ---- Recording: ● opens the mic (only while recording) and captures on the audio clock; ■ saves the take.
//      From stopped it starts the groove too, count-in included; mid-session the take begins at the next bar line. ----
let recState = 'idle', recTimer = 0, recSnap = null, recFromStopped = false, recCap = null;
async function recStart(){
  if(recState !== 'idle' || held || S.mode === 'noise') return;   // (Noise has no Rec)
  if(rec.micBusy()){ toast('Measuring sync… one moment.'); return; }
  unlock(); stopPlayback();                            // inside the tap, before any await (iOS)
  clearTimeout(tempoTimer); tapReset();                // a pending tap would end this take with a restart
  const wasRunning = running, sid = session;
  recState = 'opening'; recUI('opening');
  let cap;
  try{ cap = await rec.openMic(); }
  catch(e){
    recState = 'idle'; recUI('idle');
    toast(e && e.name === 'NotAllowedError' ? 'Microphone access is off for BackTrack. You can turn it on in Settings.' : 'Couldn’t open the microphone.');
    return;
  }
  // stopped (or restarted) while the mic was opening: close it again and start nothing
  if(wasRunning && (!running || session !== sid)){ await rec.endCapture(cap); recState = 'idle'; recUI('idle'); return; }
  recCap = cap; recSnap = rec.snapshot(); recFromStopped = !running;
  rec.beginCapture(cap, () => { recStop(); toast('Takes stop at 10 minutes. This one is saved.'); });
  recState = 'recording'; recUI('recording', 0);
  recTimer = setInterval(() => recUI('recording', rec.capturedSec(cap)), 250);
  if(!running) start();
}
async function recStop(){
  if(recState !== 'recording') return;
  // the session's clock, taken now: stop() calls this before the groove goes away
  const sess = runMode === 'breathe' ? { mode:'breathe', live: bclock.live, t0: bclock.t0 }
    : { mode:runMode, live: clock.live, t0: clock.t0, tl: clock.tl, countin: runMode === 'groove' && clock.countBars > 0 };   // (rec.js keeps it only when the take begins at bar 0)
  recState = 'saving'; clearInterval(recTimer); recUI('saving');
  const cap = recCap; recCap = null;
  let r = null;
  try{ r = await rec.finishTake(cap, sess, recSnap); }catch(e){}
  recState = 'idle'; recUI('idle');
  if(r && r.unsaved){
    // storage failed: the audio still exists in memory, so offer it straight away (the mic file needs no render)
    const file = rec.micWav(r.take, r.pcm, `BackTrack ${r.take.name.replace('♭', 'b')} (unsaved).wav`);
    toast('Couldn’t save the take on this phone.', { action:'Share it', ms:15000, onAction: () => rec.shareFile(file).catch(() => {}) });
  } else if(r){
    const m = Math.floor(r.take.seconds / 60), sec = String(Math.floor(r.take.seconds % 60)).padStart(2, '0');
    lastTakeToast = performance.now();
    toast(`Take saved · ${m}:${sec}`, { action:'Listen', onAction: () => openSheet('takes') });
    refreshTakes();
  }
}
function recToggle(){
  if(recState === 'recording') recStop();
  else if(recState === 'idle' && !held){ if(rec.micGranted()) recStart(); else micSheet(false); }
}
$('recbtn').addEventListener('click', recToggle);
$('brec').addEventListener('click', recToggle);
$('micallow').addEventListener('click', () => { closeSheet(); if($('panel-mic').dataset.for === 'tune') start(false, true); else recStart(); });
initTakes({ running: () => running, recording: () => recState !== 'idle', stopSession: () => stop(), count: takesCount });
refreshTakes();
$('takesbtn').addEventListener('click', () => { refreshTakes(); openSheet('takes'); });

// ---- Setup ----
$('setupbtn').addEventListener('click', () => openSheet());
$('guidebtn').addEventListener('click', () => openSheet());
// A take has exactly one setup: anything that changes the groove itself ends the take first (volumes don't).
const endTake = () => { if(recState === 'recording') recStop(); };

// Tempo: the labels follow the drag; the groove (and its download) waits until you let go.
const tempo = $('tempo');
const pickTempo = () => { if(running && clock.live && clock.tl && clock.tl.setup.bpm === S.bpm) return; endTake(); conform(); update(); if(!isClick()) fetchFile('drums-' + S.bpm).catch(() => {}); restart(); };   // (conform: a destination equal to the new tempo is no move)
tempo.addEventListener('input', () => { S.bpm = TEMPOS[+tempo.value]; update(); });
tempo.addEventListener('change', pickTempo);
$('ticks').addEventListener('click', e => { const t = e.target.closest('[data-bpm]'); if(!t) return; S.bpm = +t.dataset.bpm; update(); pickTempo(); });

const bind = (id, ev, after, ends) => $(id).addEventListener(ev, () => { if(ends) endTake(); S[id] = $(id).value; update(); if(after) after(); });
bind('bars', 'change', restart, true);
bind('countin', 'change', restart, true);
bind('fine', 'input'); $('fine').addEventListener('change', () => { endTake(); restart(); });
bind('dvol', 'input', () => { if(ctx) fadeTo(bus.drums.gain, +S.dvol, .05); });
// where the session arrives (Tempo ramp ▸ Over the session): a tempo, a key, or both; a change restarts the move
for(const id of ['tobpm', 'tokey']) $(id).addEventListener('change', () => { endTake(); S[id] = $(id).value; conform(); update(); prefetchDrones(); prefetchLoops(); restart(); });
bind('wvol', 'input', () => { if(ctx) fadeTo(bus.wash.gain, +S.wvol, .05); });
bind('key', 'change', () => { conform(); update(); prefetchDrones(); if(running){ if(S.tokey || walking()) restart(); else { washStop(2.5); washStart(2.5); droneRefresh(); } } }, true);   // (a key walk starts over from the new key)
// The Drone menu (Wash · Synth · Off): a new source crossfades in over 1.5 s, the moves already scheduled follow it.
$('wash').addEventListener('change', () => {
  endTake(); const v = $('wash').value, was = S.wash; S.wash = v === 'off' ? 'off' : 'on'; if(v !== 'off') S.dsrc = v; update(); prefetchDrones();
  if(running){ if(S.wash === 'on'){ washStop(1.5); washStart(was === 'off' ? 3 : 1.5); droneRefresh(); } else washStop(2); }
});
// a progression change starts the groove over, so the moves begin from home on bar 1
for(const id of ['prog', 'pbars']) $(id).addEventListener('change', () => { endTake(); S[id] = $(id).value; conform(); update(); prefetchDrones(); restart(); });
bind('drop', 'change', () => { if(running) rescheduleFromNextBar(); }, true);

// ---- Sound, free tempo, meter, the click pattern, the ramp, the session length ----
// (the name follows too: a pattern or grouping change renames the groove without a restart, and History takes the last name)
const resched = () => { if(running){ rescheduleFromNextBar(); if(runMode === 'groove') logName = grooveLogName(); } };
$('soundsw').addEventListener('click', e => {
  const b = e.target.closest('[data-sound]'); if(!b || b.dataset.sound === S.sound) return;
  endTake(); S.sound = b.dataset.sound; if(isClick() && S.click === 'off') S.click = '1'; conform(); update();
  if(!isClick()) fetchFile('drums-' + S.bpm).catch(() => {});
  restart();
});
const bpmfree = $('bpmfree');
bpmfree.addEventListener('input', () => { S.bpm = +bpmfree.value; update(); });
bpmfree.addEventListener('change', pickTempo);
// −/+ and Tap tempo share one timer: the groove restarts once, when the tapping or nudging stops.
let tempoTimer = 0; const taps = [];
const tapReset = () => { taps.length = 0; $('tap').textContent = 'Tap tempo'; };
const nudgeTempo = d => { const v = Math.max(40, Math.min(240, S.bpm + d)); if(v === S.bpm) return; S.bpm = v; update(); clearTimeout(tempoTimer); tempoTimer = setTimeout(pickTempo, 300); };
$('bpmdown').addEventListener('click', () => nudgeTempo(-1)); $('bpmup').addEventListener('click', () => nudgeTempo(1));
// Tap tempo: the median of the intervals between the last taps; a 2 s pause starts over. Touch and mouse tap on
// pointerdown (no button delay); a keyboard or a screen reader taps with Enter or Space.
function tapTempo(t){
  if(taps.length && t - taps[taps.length - 1] > 2000) taps.length = 0;
  keep(taps, t, 8); clearTimeout(tempoTimer);
  if(taps.length < 4){ $('tap').textContent = `Tap ${taps.length} of 4`; tempoTimer = setTimeout(tapReset, 2000); return; }
  S.bpm = Math.max(40, Math.min(240, Math.round(60000 / pct(taps.slice(1).map((x, i) => x - taps[i]), .5)))); update();
  $('tap').textContent = `${S.bpm} bpm`;
  tempoTimer = setTimeout(() => { tapReset(); pickTempo(); }, 2000);
}
$('tap').addEventListener('pointerdown', e => { if(e.pointerType !== '') tapTempo(e.timeStamp); });
$('tap').addEventListener('keydown', e => { if((e.key === 'Enter' || e.key === ' ') && !e.repeat){ e.preventDefault(); tapTempo(e.timeStamp); } });
$('tap').addEventListener('click', e => { if(e.detail === 0 && e.pointerType === undefined && !e.isTrusted) tapTempo(e.timeStamp); });   // synthetic activation (assistive tech)
$('meters').addEventListener('click', e => { const b = e.target.closest('[data-meter]'); if(!b || !isClick() || b.dataset.meter === S.meter) return; endTake(); S.meter = b.dataset.meter; S.group = ''; conform(); update(); restart(); });
$('groups').addEventListener('click', e => { const b = e.target.closest('[data-group]'); if(!b || b.dataset.group === meter().group) return; endTake(); S.group = b.dataset.group; conform(); update(); resched(); });
$('cpat').addEventListener('change', () => {
  const code = $('cpat').value; if(code === S.click){ update(); return; }
  endTake();
  if(code === 'c'){ const c = cells(); S.csub = String(c.sub); S.cells = Array.from(c.cells).join(''); }   // custom starts as the pattern showing
  S.click = code; conform(); update(); resched();
});
$('csub').addEventListener('click', e => {
  const b = e.target.closest('[data-sub]'); if(!b || b.dataset.sub === S.csub) return;
  endTake(); S.cells = Array.from(fitCells(S.cells, +S.csub, +b.dataset.sub, meter())).join(''); S.csub = b.dataset.sub; conform(); update(); resched();
});
$('cgrid').addEventListener('click', e => {
  const b = e.target.closest('[data-i]'); if(!b) return;
  const a = [...S.cells], i = +b.dataset.i, v = +a[i] || 0; a[i] = String(v <= 1 ? 2 : v === 2 ? 3 : 0);   // off → on → accent → off
  endTake(); S.cells = a.join(''); update(); resched();
});
bind('cvol', 'input', () => { if(ctx) fadeTo(bus.click.gain, +S.cvol, .05); });

// ---- Noise: everything changes live (no restart): a color crossfades, the EQ glides, waves start over from where they are ----
$('ncolors').addEventListener('click', e => { const b = e.target.closest('[data-ncolor]'); if(!b) return; S.ncolor = b.dataset.ncolor; update(); if(running){ noiseColor(); noiseSync(); } });
$('ntex').addEventListener('click', e => {
  const b = e.target.closest('[data-tex]'), t = b && TEXTURES.find(x => x[0] === b.dataset.tex); if(!t) return;
  Object.assign(S, { ncolor: t[2], neq: t[3], nwave: t[4], nswell: t[5] }); update();
  if(running){ noiseColor(); wavesRestart(); noiseSync(); }
});
bind('nvol', 'input', () => { if(ctx && bus.noise) fadeTo(bus.noise.gain, +S.nvol, .05); });
for(let i = 0; i < 5; i++) $('neq' + i).addEventListener('input', () => {
  S.neq = [0, 1, 2, 3, 4].map(j => String(+$('neq' + j).value || 0)).join('.'); update(); noiseEq(); noiseSync();
});
$('neqflat').addEventListener('click', () => { S.neq = '0.0.0.0.0'; update(); noiseEq(); noiseSync(); });
$('nwave').addEventListener('change', () => { S.nwave = $('nwave').value; update(); wavesRestart(); noiseSync(); });
$('nswell').addEventListener('input', () => { S.nswell = $('nswell').value; update(); });
$('nswell').addEventListener('change', () => { wavesRestart(); noiseSync(); });
// where the Noise timer arrives: the sound, the waves, their depth
for(const id of ['tosound', 'towave', 'toswell']) $(id).addEventListener('change', () => { S[id] = $(id).value; conform(); update(); noiseSync(); });
$('ramps').addEventListener('click', e => {
  const b = e.target.closest('[data-r]'), r = ramp(), arr = !r && !!(S.tobpm || S.tokey); if(!b) return;
  if(b.dataset.r === 'to'){ if(arr) return; const was = !!r; endTake(); S.ramp = '0'; setArriveOpen(true); update(); if(was) restart(); return; }   // the row opens; a tempo or key picked there moves the groove
  if(b.dataset.r === (r ? `${r.step}-${r.every}` : arr ? 'to' : '0')) return;
  endTake(); setArriveOpen(false); const had = S.tobpm || S.tokey; S.tobpm = S.tokey = ''; S.ramp = b.dataset.r === '0' ? '0' : `${b.dataset.r}-${+$('rampcap').value || 240}`; conform(); update();
  if(S.ramp !== '0' || had || r) restart();
});
$('rampcap').addEventListener('input', () => { $('rampcapout').textContent = $('rampcap').value; });
$('rampcap').addEventListener('change', () => { const r = ramp(); if(!r) return; endTake(); S.ramp = `${r.step}-${r.every}-${+$('rampcap').value}`; conform(); update(); restart(); });
// A length chosen mid-session takes effect at once (a routine restarts, so its move fits the time left).
const lenChanged = () => {
  conform(); untilCache = null; update();
  if(!running) return;
  disarmEnd();
  if(runMode === 'groove' && (S.tobpm || S.tokey)) restart(); else if(runMode === 'noise') noiseSync(); else if(runMode === 'groove') rescheduleFromNextBar();
  face.left(sessionLeft());
};
// "At a time…": the next half hour from now, then the time field beside the menu sets it
const nextHalfHour = () => { const d = new Date(Date.now() + 35 * 60000); d.setMinutes(d.getMinutes() < 30 ? 0 : 30, 0, 0); return `@${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
for(const [sel, inp] of [['len', 'lenat'], ['blen', 'blenat'], ['nlen', 'nlenat']]){
  $(sel).addEventListener('change', () => { const v = $(sel).value; S.len = v === '@' ? (S.len[0] === '@' ? S.len : nextHalfHour()) : v; lenChanged(); });
  $(inp).addEventListener('change', () => { if(/^\d\d:\d\d$/.test($(inp).value)) S.len = '@' + $(inp).value; lenChanged(); });
}
bind('count', 'change');
// A tone needs a running context, and resuming it would un-pause a held session, so tones wait while paused.
document.querySelectorAll('[data-tone]').forEach(b => b.addEventListener('click', () => { if(!held) tone(rootFreq() * +b.dataset.tone, .12, 2.2); }));

// ---- Groove | Breathe ----
$('modes').addEventListener('click', e => {
  const b = e.target.closest('[data-mode]'); if(!b || running) return;
  if(!switchMode(b.dataset.mode)) return;
  update();
  if(S.mode === 'breathe') breathRest(); else flatSwell();
  if(S.mode === 'groove' && !isClick()) fetchFile('drums-' + S.bpm).catch(() => {});
  if(S.mode === 'tune' && +S.tdrums) fetchFile('drums-' + S.tdrums).catch(() => {});
  prefetchDrones();
});

// ---- Breathe controls: a pattern, the drone (Wash / Hum / none), cues, swell. Changes end a take and restart the breath. ----
const breathChanged = () => { endTake(); update(); restart(); };
$('pchips').addEventListener('click', e => { const c = e.target.closest('[data-p]'); if(!c || c.dataset.p === S.pattern) return; S.pattern = c.dataset.p; breathChanged(); });
[0, 1, 2, 3].forEach(i => $('d' + i).addEventListener('change', () => {
  const d = [0, 1, 2, 3].map(k => Math.max(0, Math.min(30, Math.round((parseFloat($('d' + k).value) || 0) * 2) / 2)));
  const p = d.map(fmtN).join('-');
  if(d.every(x => x === 0) || p === S.pattern){ update(); return; }     // no length, or no change: just show the pattern in use
  S.pattern = p; breathChanged();
}));
$('bsound').addEventListener('change', () => {
  endTake(); const v = $('bsound').value; S.bsound = v === 'synth' ? 'wash' : v; if(v === 'wash' || v === 'synth') S.dsrc = v; update();
  if(running){ washStop(1.5); if(washWanted()) washStart(1.5); restart(); }
  prefetchDrones();
});
$('bcue').addEventListener('change', () => { S.bcue = $('bcue').value; breathChanged(); });
$('swell').addEventListener('input', () => { S.swell = $('swell').value; update(); });
$('swell').addEventListener('change', () => { endTake(); if(running) restart(); else if(S.mode === 'breathe') breathRest(); });
$('bkey').addEventListener('change', () => {
  endTake(); S.key = $('bkey').value; update(); fetchFile('wash-' + S.key).catch(() => {});
  if(running){ washStop(2.5); washStart(2.5); restart(); }
});
$('bwvol').addEventListener('input', () => { S.wvol = $('bwvol').value; update(); if(ctx) fadeTo(bus.wash.gain, +S.wvol, .05); });

// ---- Tune controls. Key, tuning, drone and drums end a take (one setup per take); the rest only change the display.
//      Anything that changes what reaches the mic tells the tracker to re-learn the room's floor. ----
$('tkey').addEventListener('change', () => {
  endTake(); S.key = $('tkey').value; update(); fetchFile('wash-' + S.key).catch(() => {});
  if(running && washWanted()){ washStop(2.5); relearnAfter(washStart(2.5)); }
});
$('tinst').addEventListener('change', () => { S.tinst = $('tinst').value; update(); });
// The tuning (the phone's own, every mode; a menu in Drone, Sound and Key): the drone retunes in place; Breathe's cues
// and hum are scheduled ahead, so its breath restarts with them; Tune re-learns the room once the drone plays.
function setTuning(v){
  endTake(); S.a4 = v; update();
  if(!running) return;
  if(washWanted()){ washStop(1.5); const w = washStart(1.5); if(runMode === 'tune') relearnAfter(w); if(runMode === 'groove') droneRefresh(); }
  if(runMode === 'breathe') restart();
}
for(const id of ['a4', 'ga4', 'ba4']) $(id).addEventListener('change', () => setTuning($(id).value));
for(const id of ['tcents','treg','tspeed']) $(id).addEventListener('change', () => { S[id] = $(id).value; update(); });
$('lchips').addEventListener('click', e => { const c = e.target.closest('[data-l]'); if(!c) return; S.tlines = c.dataset.l; update(); });
$('tdrone').addEventListener('change', () => {
  endTake(); const v = $('tdrone').value; S.tdrone = v === 'off' ? 'off' : 'wash'; if(v !== 'off') S.dsrc = v; update();
  prefetchDrones();
  if(running){ washStop(1.5); if(washWanted()) relearnAfter(washStart(1.5)); else relearn(); }
});

// ---- Setup ▸ Synth. Every change ends a take first (one setup per take). Note levels glide and a tone crossfades in
//      place (audio.js → synth.js); Octave and Pure | Even rebuild the drone, like a key change. Tune re-learns the
//      room after anything that changes what reaches the mic. ----
function synthRebuild(){
  if(!running || !washWanted() || S.dsrc !== 'synth') return;
  washStop(.3); const w = washStart(.3);
  if(runMode === 'tune') relearnAfter(w); if(runMode === 'groove') droneRefresh();
}
function synthLive(kind){
  if(!running || !washWanted() || S.dsrc !== 'synth') return;
  if(kind === 'notes') synthNotes(); else synthTone();
  if(runMode === 'tune') relearn();
}
let toneTimer = 0, toneAt = 0;
function synthToneSoon(){                                  // drawbar drags: at most 8 crossfades a second, and always the last
  clearTimeout(toneTimer);
  toneTimer = setTimeout(() => { toneAt = performance.now(); synthLive('tone'); }, Math.max(0, 125 - (performance.now() - toneAt)));
}
setSynthHooks({
  start: () => endTake(),
  edit(kind, i, v){
    const key = kind === 'notes' ? 'snotes' : 'stone', lv = levelsOf(S[key]); lv[i] = v;
    S[key] = hexOf(lv); update();
    if(kind === 'notes') synthLive('notes'); else synthToneSoon();
  },
});
$('snp').addEventListener('change', () => {
  const p = NOTES.find(x => x[0] === $('snp').value); if(!p) return;
  endTake(); const moved = S.soct !== p[3]; S.snotes = p[2]; S.soct = p[3]; update();
  if(moved) synthRebuild(); else synthLive('notes');
});
$('soct').addEventListener('change', () => { endTake(); S.soct = $('soct').value; update(); synthRebuild(); });
$('stemp').addEventListener('click', e => { const b = e.target.closest('[data-temp]'); if(!b || b.dataset.temp === S.stemp) return; endTake(); S.stemp = b.dataset.temp; update(); synthRebuild(); });
$('stp').addEventListener('click', e => {
  const b = e.target.closest('[data-stone]'), p = b && TONES.find(x => x[0] === b.dataset.stone); if(!p || p[2] === S.stone) return;
  endTake(); S.stone = p[2]; update(); synthLive('tone');
});
$('tdrums').addEventListener('change', () => {
  endTake(); S.tdrums = $('tdrums').value; update();
  if(+S.tdrums) fetchFile('drums-' + S.tdrums).catch(() => {});
  if(running){ relearn(); restart(); }
});
$('twvol').addEventListener('input', () => { S.wvol = $('twvol').value; update(); if(ctx) fadeTo(bus.wash.gain, +S.wvol, .05); });
$('tdvol').addEventListener('input', () => { S.dvol = $('tdvol').value; update(); if(ctx) fadeTo(bus.drums.gain, +S.dvol, .05); });
$('twvol').addEventListener('change', relearn); $('tdvol').addEventListener('change', relearn);
$('night').addEventListener('click', tuneTheme);
initMicPicker(); initViewer();

// An old #link opened mid-session is a whole new preset: full restart (new key and drone included).
addEventListener('hashchange', () => loadPreset(location.hash));
// A setup from the Setup list's Recents, the same way: the whole preset, mode included.
function loadPreset(str){
  if(!applyPreset(str)) return;
  update();
  if(running){ stop(); start(); return; }
  if(S.mode === 'breathe') breathRest(); else flatSwell();
  if(S.mode === 'groove' && !isClick()) fetchFile('drums-' + S.bpm).catch(() => {});
  if(S.mode === 'tune' && +S.tdrums) fetchFile('drums-' + S.tdrums).catch(() => {});
  prefetchDrones();
}
setGlanceHooks({ load:loadPreset, sessions:rec.listSessions });

if('serviceWorker' in navigator && /^https?:$/.test(location.protocol)){
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.ready.then(() => { $('offline').hidden = false; });
}

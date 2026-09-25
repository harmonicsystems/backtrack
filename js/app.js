// The transport (start / stop / pause-from-outside), the frame loop, the lock-screen info, and the control wiring.
import { S, TEMPOS, keyLabel, restore, save, applyPreset, LAB, switchMode, durs, fmtN, breath, breathLabel, washWanted, tuneLabel, styleLabel, isClick, meter, conform, cells, ramp } from './state.js';
import { ctx, bus, unlock, idleSuspend, setHooks, fadeTo, settle, fetchFile, washStart, washStop, tone, rootFreq, flatSwell } from './audio.js';
import { fitCells } from './timeline.js';
import { bclock, where, breathStart, breathStop, breathRest } from './breath.js';
import { clock, barIsRest, grooveStart, grooveStop, rescheduleFromNextBar } from './groove.js';
import { $, reduced, render, face, faceReset, initControls, initSheet, openSheet, closeSheet, sheetOpen, initNight, initShortcutCard, toast, recUI, takesCount, micSheet } from './ui.js';
import { tuneReset, tuneFrame, tuneGuides, tuneTheme, tuneListening, tuneIdle, tuneQuiet, droneHz } from './tune.js';
import { createTracker } from './pitch.js';
import { clockUpdate, heardPos, clockReset, keep, pct } from './clock.js';
import * as rec from './rec.js';
import { initTakes, refreshTakes, refreshHistory, stopPlayback, initMicPicker, refreshMics } from './takes.js';
import { initViewer, viewFrame, viewStop, viewChanged } from './viewer.js';

// The beat-view lab loads only with ?lab; until it arrives (or without ?lab) these hooks do nothing.
let lab = null;
if(LAB) import('./lab.js').then(m => { lab = m; m.initLab({ running: () => running }); }).catch(() => {});

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
  const b = S.mode === 'breathe', t = S.mode === 'tune', k = keyLabel();
  ms.metadata = new MediaMetadata({
    title: b ? `${breathLabel()} · breathe` : t ? tuneLabel() : `${S.bpm} bpm · ${styleLabel()}`, artist:'BackTrack',
    album: b ? (S.bsound === 'wash' ? `Wash in ${k}` : S.bsound === 'hum' ? `Hum in ${k}` : 'Silent') : t ? (S.tdrone === 'wash' ? `Wash in ${k}` : 'No drone')
      : (S.wash === 'on' ? `Wash in ${k}` : isClick() ? 'Click only' : 'Drums only'),
    artwork:[{ src:new URL(b ? `icons/b/${(breath() || [0, 0, 0, 'custom'])[3]}.png` : t ? `icons/t/${S.key}${S.tinst === 'C' ? '' : '-' + S.tinst}.png`
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
  if(runMode === 'breathe'){
    face.breath(where(Math.max(0, ctx.currentTime - bclock.t0)));
    face.elapsed(Math.floor((performance.now() - sessionStart) / 1000));
    checkEnd(); face.left(sessionLeft());
    raf = requestAnimationFrame(tick); return;
  }
  const perf = performance.now(); clockUpdate(perf);
  const pos = heardPos(perf), tl = clock.tl;           // the raw audio clock, unless the lab switches to "what you hear"
  if(tl){
    const w = tl.at(pos), M = tl.meter;                // the timeline turns the position into bar · beat · cell
    if(pos < 0 && !clock.countBars) face.preroll();
    else if(pos < 0) face.count(w.bar < -1 ? 0 : w.beat);   // the first 0.1 s (before the count-in bar) reads as beat 1
    else {
      const key = w.bar * 64 + w.beat, newBeat = key !== lastBeat, newCell = w.bar !== lastBar || w.cell !== lastCell;
      lastBeat = key; lastBar = w.bar; lastCell = w.cell;
      face.bar({ beat:w.beat, bar:w.bar, cell:w.cell, inLoop: w.bar % clock.loopBars + 1, rest: barIsRest(w.bar), newBeat, newCell,
                 down: M.pulseLevel[M.beatStart[w.pulse]] === 3 });
      if(tl.setup.ramp) face.tempo(Math.round(w.tempo));   // the tempo you hear (Fine included; the title drops its suffix)
    }
  }
  face.elapsed(Math.floor((perf - sessionStart) / 1000));
  checkEnd(); face.left(sessionLeft());
  if(lab) lab.labFrame(pos, perf); else viewFrame(pos);
  raf = requestAnimationFrame(tick);
}

let lock = null;
async function wake(){ try{ if(running && !held && 'wakeLock' in navigator && !lock){ lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => lock = null); } }catch(e){} }
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
  if(!keepWash){ washing = washStart(3); logStart = performance.now(); pausedMs = 0; logId = 's' + Date.now().toString(36); doneBefore = 0; }
  runMode = S.mode; logName = S.mode === 'breathe' ? `${breathLabel()} breath` : S.mode === 'tune' ? tuneLabel() : `${S.bpm} bpm ${styleLabel()}`;
  clearInterval(endTimer); endTimer = setInterval(checkEnd, 250);   // the session length's deadline, checked even with the screen off
  if(runMode === 'breathe'){ breathStart(); tick(); return; }
  flatSwell();
  if(runMode === 'tune'){ tuneStart(sid); return; }
  const ok = await grooveStart(() => sid === session && running);
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
  if(runMode === 'breathe') breathStop(keepWash ? .2 : 2); else grooveStop();
  if(!keepWash){ tuneStop(); washStop(2); idleSuspend(2600); if(wasRunning) logIt(); }
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

  if(pendingRestart){ pendingRestart = false; stop(true); start(true); return; }   // settings changed while paused: restart with them
  if(ms) ms.playbackState = 'playing'; wake(); lastBeat = -1; tick();
}
function resumeHeld(){ unlock(); if(ctx.state === 'running') unhold(); }   // otherwise the context's statechange unholds once it runs
setHooks({ running: () => running, held: () => held, hold, unhold });

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
let endT = 0, endFade = 0, endTimer = 0, doneBefore = 0, lastTakeToast = -1e9;
const lenSpec = () => { const v = S.len; if(!v || v === '0') return null; return v[0] === 'l' ? { loops:+v.slice(1) } : v[0] === 'c' ? { cycles:+v.slice(1) } : { min:+v }; };
const elapsedSec = () => ((held ? heldAt : performance.now()) - logStart - pausedMs) / 1000;
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
    if(runMode === 'groove'){
      const tl = clock.tl; if(!tl || !clock.live) return;
      const next = Math.max(0, tl.at(now - clock.t0).bar) + 1;
      let due;
      if(spec.loops) due = Math.max(next, spec.loops * clock.loopBars - doneBefore);
      else if(elapsedSec() >= spec.min * 60) due = next;
      else return;
      const f = Math.min(1.5, tl.barSecOf(due - 1));
      if(due === next && clock.t0 + tl.barStart(due) - now < f * .8) due++;   // room for the fade: one bar later
      endT = clock.t0 + tl.barStart(due); clock.endBar = due; armEnd(f);
    } else {
      if(!bclock.live) return;
      const cyc = bclock.cycle, next = Math.floor(Math.max(0, now - bclock.t0) / cyc) + 1, f = Math.min(1.5, lastPhase());
      let k;
      if(spec.cycles) k = Math.max(next, spec.cycles - doneBefore);
      else if(elapsedSec() >= spec.min * 60) k = next;
      else return;
      if(k === next && bclock.t0 + k * cyc - now < f * .8) k++;              // room for the fade: one cycle later
      endT = bclock.t0 + k * cyc; bclock.endT = endT; armEnd(f);
    }
  }
  if(recState === 'recording' && now >= endFade) recStop();
  if(now >= endT){
    const n = spec.min || spec.loops || spec.cycles, unit = spec.min ? 'min' : spec.loops ? 'loop' : 'cycle';
    stop();
    if(performance.now() - lastTakeToast > 4000) toast(`Session done · ${n} ${unit}${unit !== 'min' && n !== 1 ? 's' : ''}`);   // a take's toast keeps its Listen
  }
}
function sessionLeft(){
  const spec = lenSpec(); if(!spec || !ctx) return null;
  if(spec.min) return { sec: Math.max(0, spec.min * 60 - elapsedSec()) };
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
let logStart = 0, pausedMs = 0, heldAt = 0, logName = '', logId = '';
function logIt(){
  const sec = Math.round(((held ? heldAt : performance.now()) - logStart - pausedMs) / 1000);
  if(sec < 20) return;
  rec.logSession({ id:logId, mode:runMode, name:logName, start: Date.now() - sec * 1000, seconds: sec }).then(refreshHistory, () => {});
}
addEventListener('pagehide', () => { if(running) logIt(); });

// ---- startup ----
restore(); initControls(); initSheet(); initNight(); initShortcutCard(); update();
if(S.mode === 'groove' && !isClick()) fetchFile('drums-' + S.bpm).catch(() => {}); if(washWanted()) fetchFile('wash-' + S.key).catch(() => {});

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
  if(recState !== 'idle' || held) return;
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
const pickTempo = () => { if(running && clock.live && clock.tl && clock.tl.setup.bpm === S.bpm) return; endTake(); if(!isClick()) fetchFile('drums-' + S.bpm).catch(() => {}); restart(); };
tempo.addEventListener('input', () => { S.bpm = TEMPOS[+tempo.value]; update(); });
tempo.addEventListener('change', pickTempo);
$('ticks').addEventListener('click', e => { const t = e.target.closest('[data-bpm]'); if(!t) return; S.bpm = +t.dataset.bpm; update(); pickTempo(); });

const bind = (id, ev, after, ends) => $(id).addEventListener(ev, () => { if(ends) endTake(); S[id] = $(id).value; update(); if(after) after(); });
bind('bars', 'change', restart, true);
bind('countin', 'change', restart, true);
bind('fine', 'input'); $('fine').addEventListener('change', () => { endTake(); restart(); });
bind('dvol', 'input', () => { if(ctx) fadeTo(bus.drums.gain, +S.dvol, .05); });
bind('wvol', 'input', () => { if(ctx) fadeTo(bus.wash.gain, +S.wvol, .05); });
bind('key', 'change', () => { fetchFile('wash-' + S.key).catch(() => {}); if(running){ washStop(2.5); washStart(2.5); } }, true);
bind('wash', 'change', () => { if(running){ if(S.wash === 'on') washStart(3); else washStop(2); } }, true);
bind('drop', 'change', () => { if(running) rescheduleFromNextBar(); }, true);

// ---- Sound, free tempo, meter, the click pattern, the ramp, the session length ----
const resched = () => { if(running) rescheduleFromNextBar(); };
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
$('ramps').addEventListener('click', e => {
  const b = e.target.closest('[data-r]'), r = ramp(); if(!b || b.dataset.r === (r ? `${r.step}-${r.every}` : '0')) return;
  endTake(); S.ramp = b.dataset.r === '0' ? '0' : `${b.dataset.r}-${+$('rampcap').value || 240}`; conform(); update(); restart();
});
$('rampcap').addEventListener('input', () => { $('rampcapout').textContent = $('rampcap').value; });
$('rampcap').addEventListener('change', () => { const r = ramp(); if(!r) return; endTake(); S.ramp = `${r.step}-${r.every}-${+$('rampcap').value}`; conform(); update(); restart(); });
const lenChanged = () => { update(); if(running){ disarmEnd(); if(runMode === 'groove') rescheduleFromNextBar(); face.left(sessionLeft()); } };
$('len').addEventListener('change', () => { S.len = $('len').value; lenChanged(); });
$('blen').addEventListener('change', () => { S.len = $('blen').value; lenChanged(); });
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
  if(washWanted()) fetchFile('wash-' + S.key).catch(() => {});
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
  endTake(); S.bsound = $('bsound').value; update();
  if(running){ if(washWanted()) washStart(3); else washStop(2); restart(); }
  if(washWanted()) fetchFile('wash-' + S.key).catch(() => {});
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
$('a4').addEventListener('change', () => { endTake(); S.a4 = $('a4').value; update(); if(running && washWanted()){ washStop(1.5); relearnAfter(washStart(1.5)); } });
for(const id of ['tcents','treg','tspeed']) $(id).addEventListener('change', () => { S[id] = $(id).value; update(); });
$('lchips').addEventListener('click', e => { const c = e.target.closest('[data-l]'); if(!c) return; S.tlines = c.dataset.l; update(); });
$('tdrone').addEventListener('change', () => {
  endTake(); S.tdrone = $('tdrone').value; update();
  if(washWanted()) fetchFile('wash-' + S.key).catch(() => {});
  if(running){ if(washWanted()) relearnAfter(washStart(3)); else { washStop(2); relearn(); } }
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
addEventListener('hashchange', () => { if(!applyPreset(location.hash)) return; update(); if(running){ stop(); start(); } });

if('serviceWorker' in navigator && /^https?:$/.test(location.protocol)){
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.ready.then(() => { $('offline').hidden = false; });
}

// The transport (start / stop / pause-from-outside), the frame loop, the lock-screen info, and the control wiring.
import { S, TEMPOS, groove, keyLabel, restore, save, applyPreset, LAB, switchMode, durs, fmtN, breath, breathLabel, washWanted, tuneLabel } from './state.js';
import { ctx, bus, unlock, idleSuspend, setHooks, fadeTo, fetchFile, washStart, washStop, tone, rootFreq, flatSwell } from './audio.js';
import { bclock, where, breathStart, breathStop, breathRest } from './breath.js';
import { clock, barIsRest, grooveStart, grooveStop, rescheduleFromNextBar } from './groove.js';
import { $, reduced, render, face, faceReset, initControls, initSheet, openSheet, closeSheet, sheetOpen, initNight, initShortcutCard, toast, recUI, takesCount, micSheet } from './ui.js';
import { tuneReset, tuneFrame, tuneGuides, tuneTheme, tuneListening, tuneIdle, tuneQuiet, droneHz } from './tune.js';
import { createTracker } from './pitch.js';
import { clockUpdate, heardPos, clockReset } from './clock.js';
import * as rec from './rec.js';
import { initTakes, refreshTakes, refreshHistory, stopPlayback, initMicPicker, refreshMics } from './takes.js';

// The beat-view lab loads only with ?lab; until it arrives (or without ?lab) these hooks do nothing.
let lab = null;
if(LAB) import('./lab.js').then(m => { lab = m; m.initLab({ running: () => running }); }).catch(() => {});

const ms = 'mediaSession' in navigator ? navigator.mediaSession : null;   // lock screen / media widget / CarPlay
const go = $('go'), beats = $('beats');

// running = a session is on; held = it was paused from outside (lock screen, widget, CarPlay, a call) and is frozen in place.
// session increments on every start/stop, so async steps (loading a groove) can tell they've gone stale.
// runMode = the mode the session was started in (a #link can switch S.mode before the session is stopped).
let running = false, held = false, session = 0, raf = 0, sessionStart = 0, lastBeat = -1, runMode = 'groove';

// Lock screen / media widget / CarPlay: title, drone and artwork. (WebKit sends their Play/Pause to the
// AudioContext itself — see audio.js — the handlers below are a fallback for browsers that route them here.)
function mediaMeta(){
  if(!ms || !window.MediaMetadata) return;
  const b = S.mode === 'breathe', t = S.mode === 'tune', k = keyLabel();
  ms.metadata = new MediaMetadata({
    title: b ? `${breathLabel()} · breathe` : t ? tuneLabel() : `${S.bpm} bpm · ${groove()[1]}`, artist:'BackTrack',
    album: b ? (S.bsound === 'wash' ? `Wash in ${k}` : S.bsound === 'hum' ? `Hum in ${k}` : 'Silent') : t ? (S.tdrone === 'wash' ? `Wash in ${k}` : 'No drone')
      : (S.wash === 'on' ? `Wash in ${k}` : 'Drums only'),
    artwork:[{ src:new URL(b ? `icons/b/${(breath() || [0, 0, 0, 'custom'])[3]}.png` : t ? `icons/t/${S.key}${S.tinst === 'C' ? '' : '-' + S.tinst}.png`
      : `icons/p/${S.bpm}-${S.key}.png`, document.baseURI).href, sizes:'180x180', type:'image/png' }] });
}
let guideKey = '';
function update(){
  render(); save(); mediaMeta();
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
    raf = requestAnimationFrame(tick); return;
  }
  const perf = performance.now(); clockUpdate(perf);
  const pos = heardPos(perf);                          // the raw audio clock, unless the lab switches to "what you hear"
  if(pos < 0 && !+S.countin) face.preroll();
  else if(pos < 0) face.count(Math.max(0, 4 + Math.floor(pos / clock.beatSec)));   // the first 0.1 s reads as beat 1
  else {
    const beat = Math.floor(pos / clock.beatSec), bar = Math.floor(beat / 4), newBeat = beat !== lastBeat;
    if(newBeat) lastBeat = beat;
    face.bar({ beat, bar, inLoop: bar % clock.loopBars + 1, rest: barIsRest(bar), newBeat });
  }
  face.elapsed(Math.floor((perf - sessionStart) / 1000));
  if(lab) lab.labFrame(pos, perf);
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
  const sid = ++session; held = false; pendingRestart = false;
  running = true; if(ms) ms.playbackState = 'playing'; wake();
  face.running(true);
  [window, $('app')].forEach(el => el.scrollTo({ top:0, behavior: reduced ? 'auto' : 'smooth' }));
  sessionStart = performance.now(); lastBeat = -1;
  faceReset(); clockReset(); if(lab) lab.labReset();
  if(!keepWash){ washing = washStart(3); logStart = performance.now(); pausedMs = 0; logId = 's' + Date.now().toString(36); }
  runMode = S.mode; logName = S.mode === 'breathe' ? `${breathLabel()} breath` : S.mode === 'tune' ? tuneLabel() : `${S.bpm} bpm ${groove()[1]}`;
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
  running = false; held = false; pendingRestart = false; session++; cancelAnimationFrame(raf); sleep();
  if(runMode === 'breathe') breathStop(keepWash ? .2 : 2); else grooveStop();
  if(!keepWash){ tuneStop(); washStop(2); idleSuspend(2600); if(wasRunning) logIt(); }
  if(ms) ms.playbackState = 'paused';
  face.running(false); if(!keepWash){ tuneIdle(); tuneQuiet(); }
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
if(S.mode === 'groove') fetchFile('drums-' + S.bpm).catch(() => {}); if(washWanted()) fetchFile('wash-' + S.key).catch(() => {});

// ---- the transport controls ----
const toggle = () => held ? resumeHeld() : running ? stop() : start();
go.addEventListener('click', toggle);
beats.addEventListener('click', e => { if(e.target.closest('.labbar, .brec')) return; if(held) resumeHeld(); else if(running) stop(); });
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
    : { mode:runMode, live: clock.live, t0: clock.t0, barSec: clock.barSec, loopBars: clock.loopBars, rate: clock.rate,
        countin: runMode === 'groove' && recFromStopped && recSnap.countin === '1' };
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
const pickTempo = () => { endTake(); fetchFile('drums-' + S.bpm).catch(() => {}); restart(); };
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
bind('click', 'change', () => { if(running) rescheduleFromNextBar(); }, true);
// A tone needs a running context, and resuming it would un-pause a held session, so tones wait while paused.
document.querySelectorAll('[data-tone]').forEach(b => b.addEventListener('click', () => { if(!held) tone(rootFreq() * +b.dataset.tone, .12, 2.2); }));

// ---- Groove | Breathe ----
$('modes').addEventListener('click', e => {
  const b = e.target.closest('[data-mode]'); if(!b || running) return;
  if(!switchMode(b.dataset.mode)) return;
  update();
  if(S.mode === 'breathe') breathRest(); else flatSwell();
  if(S.mode === 'groove') fetchFile('drums-' + S.bpm).catch(() => {});
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
initMicPicker();

// An old #link opened mid-session is a whole new preset: full restart (new key and drone included).
addEventListener('hashchange', () => { if(!applyPreset(location.hash)) return; update(); if(running){ stop(); start(); } });

if('serviceWorker' in navigator && /^https?:$/.test(location.protocol)){
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.ready.then(() => { $('offline').hidden = false; });
}

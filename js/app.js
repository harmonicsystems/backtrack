// The transport (start / stop / pause-from-outside), the frame loop, the lock-screen info, and the control wiring.
import { S, TEMPOS, groove, keyLabel, restore, save, applyPreset, LAB } from './state.js';
import { ctx, bus, unlock, idleSuspend, setHooks, fadeTo, fetchFile, washStart, washStop, tone, rootFreq } from './audio.js';
import { clock, barIsRest, grooveStart, grooveStop, rescheduleFromNextBar } from './groove.js';
import { $, reduced, render, face, faceReset, initControls, initSheet, openSheet, sheetOpen, initNight, initShortcutCard } from './ui.js';
import { clockUpdate, heardPos, clockReset } from './clock.js';

// The beat-view lab loads only with ?lab; until it arrives (or without ?lab) these hooks do nothing.
let lab = null;
if(LAB) import('./lab.js').then(m => { lab = m; m.initLab({ running: () => running }); }).catch(() => {});

const ms = 'mediaSession' in navigator ? navigator.mediaSession : null;   // lock screen / media widget / CarPlay
const go = $('go'), beats = $('beats');

// running = a session is on; held = it was paused from outside (lock screen, widget, CarPlay, a call) and is frozen in place.
// session increments on every start/stop, so async steps (loading a groove) can tell they've gone stale.
let running = false, held = false, session = 0, raf = 0, sessionStart = 0, lastBeat = -1;

// Lock screen / media widget / CarPlay: title, drone and artwork. (WebKit sends their Play/Pause to the
// AudioContext itself — see audio.js — the handlers below are a fallback for browsers that route them here.)
function mediaMeta(){
  if(!ms || !window.MediaMetadata) return;
  ms.metadata = new MediaMetadata({ title:`${S.bpm} bpm · ${groove()[1]}`, artist:'BackTrack', album: S.wash === 'on' ? `Wash in ${keyLabel()}` : 'Drums only',
    artwork:[{ src:new URL(`icons/p/${S.bpm}-${S.key}.png`, document.baseURI).href, sizes:'180x180', type:'image/png' }] });
}
function update(){ render(); save(); mediaMeta(); }

// ---- the frame loop: the circle shows count-in, bar number, beat dots, and rests ----
function tick(){
  if(!running) return;
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
async function start(keepWash){
  unlock();
  const sid = ++session; held = false; pendingRestart = false;
  running = true; if(ms) ms.playbackState = 'playing'; wake();
  face.running(true);
  [window, $('app')].forEach(el => el.scrollTo({ top:0, behavior: reduced ? 'auto' : 'smooth' }));
  sessionStart = performance.now(); lastBeat = -1;
  faceReset(); clockReset(); if(lab) lab.labReset();
  if(!keepWash) washStart(3);
  const ok = await grooveStart(() => sid === session && running);
  if(sid !== session) return;                          // stopped or restarted while loading: that session owns the screen now
  if(!ok){ face.offline(); return; }
  tick();
}
function stop(keepWash){
  running = false; held = false; pendingRestart = false; session++; cancelAnimationFrame(raf); sleep(); grooveStop();
  if(!keepWash){ washStop(2); idleSuspend(2600); }
  if(ms) ms.playbackState = 'paused';
  face.running(false);
  if(lab) lab.kickPreview();
}
// While paused from outside, a settings change must not resume the sound: it's remembered and applied on resume.
let pendingRestart = false;
function restart(){ if(!running) return; if(held){ pendingRestart = true; return; } stop(true); start(true); }

// Paused from outside: everything stays scheduled on the (now frozen) audio clock, so resuming is seamless.
function hold(){ held = true; cancelAnimationFrame(raf); sleep(); if(ms) ms.playbackState = 'paused'; face.held(true); }
function unhold(){
  held = false; face.held(false);
  if(pendingRestart){ pendingRestart = false; stop(true); start(true); return; }   // settings changed while paused: restart with them
  if(ms) ms.playbackState = 'playing'; wake(); lastBeat = -1; tick();
}
function resumeHeld(){ unlock(); if(ctx.state === 'running') unhold(); }   // otherwise the context's statechange unholds once it runs
setHooks({ running: () => running, held: () => held, hold, unhold });

// ---- startup ----
restore(); initControls(); initSheet(); initNight(); initShortcutCard(); update();
fetchFile('drums-' + S.bpm).catch(() => {}); if(S.wash === 'on') fetchFile('wash-' + S.key).catch(() => {});

// ---- the transport controls ----
const toggle = () => held ? resumeHeld() : running ? stop() : start();
go.addEventListener('click', toggle);
beats.addEventListener('click', e => { if(e.target.closest('.labbar')) return; if(held) resumeHeld(); else if(running) stop(); });
addEventListener('keydown', e => { if(e.code === 'Space' && !sheetOpen() && !/INPUT|SELECT|BUTTON|TEXTAREA/.test(e.target.tagName)){ e.preventDefault(); toggle(); } });
// Coming back to the app never un-pauses by itself: a session paused from the lock screen stays paused until you say so.
document.addEventListener('visibilitychange', () => { if(document.visibilityState !== 'visible') return; wake(); if(running && !held && ctx && ctx.state !== 'running') unlock(); });
if(ms){
  for(const [action, fn] of [['play', () => { if(held) resumeHeld(); else if(!running) start(); }],
                              ['pause', () => { if(running && !held){ hold(); ctx.suspend(); } }],
                              ['stop', () => { if(running) stop(); }]]){
    try{ ms.setActionHandler(action, fn); }catch(e){}
  }
}

// ---- Setup ----
$('setupbtn').addEventListener('click', () => openSheet());
$('guidebtn').addEventListener('click', () => openSheet());

// Tempo: the labels follow the drag; the groove (and its download) waits until you let go.
const tempo = $('tempo');
const pickTempo = () => { fetchFile('drums-' + S.bpm).catch(() => {}); restart(); };
tempo.addEventListener('input', () => { S.bpm = TEMPOS[+tempo.value]; update(); });
tempo.addEventListener('change', pickTempo);
$('ticks').addEventListener('click', e => { const t = e.target.closest('[data-bpm]'); if(!t) return; S.bpm = +t.dataset.bpm; update(); pickTempo(); });

const bind = (id, ev, after) => $(id).addEventListener(ev, () => { S[id] = $(id).value; update(); if(after) after(); });
bind('bars', 'change', restart);
bind('countin', 'change', restart);
bind('fine', 'input'); $('fine').addEventListener('change', restart);
bind('dvol', 'input', () => { if(ctx) fadeTo(bus.drums.gain, +S.dvol, .05); });
bind('wvol', 'input', () => { if(ctx) fadeTo(bus.wash.gain, +S.wvol, .05); });
bind('key', 'change', () => { fetchFile('wash-' + S.key).catch(() => {}); if(running){ washStop(2.5); washStart(2.5); } });
bind('wash', 'change', () => { if(running){ if(S.wash === 'on') washStart(3); else washStop(2); } });
bind('drop', 'change', () => { if(running) rescheduleFromNextBar(); });
bind('click', 'change', () => { if(running) rescheduleFromNextBar(); });
// A tone needs a running context, and resuming it would un-pause a held session, so tones wait while paused.
document.querySelectorAll('[data-tone]').forEach(b => b.addEventListener('click', () => { if(!held) tone(rootFreq() * +b.dataset.tone, .12, 2.2); }));

// An old #link opened mid-session is a whole new preset: full restart (new key and drone included).
addEventListener('hashchange', () => { if(!applyPreset(location.hash)) return; update(); if(running){ stop(); start(); } });

if('serviceWorker' in navigator && /^https?:$/.test(location.protocol)){
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.ready.then(() => { $('offline').hidden = false; });
}

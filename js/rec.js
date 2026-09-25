// Recording: the mic (opened only while ● is on or Tune listens), takes stored on this phone, the offline mix used
// for "play with track" and for sharing, and the round-trip latency measurement.
import { S, keyLabel, SHORT, presetString, durs, breathLabel, tuneLabel } from './state.js';
import { scheduleBreath } from './breath.js';
import { ctx, unlock, ensureCtx, getBuf, click, setRouting, setAudioSession, idleSuspend } from './audio.js';   // (ensureCtx: listing mics mustn't wake the audio)
import { firstHit } from './groove.js';

const MAX_SEC = 10 * 60;   // a take stops itself at 10 minutes (~57 MB of mono PCM while it's in memory)
const wait = ms => new Promise(r => setTimeout(r, ms));
const isIOS = 'standalone' in navigator;

// ---- takes live in IndexedDB: metadata in 'takes', the 16-bit mono PCM in 'pcm' (so the list never loads audio).
//      iOS drops IndexedDB connections after time in the background, so a dead connection is reopened and the
//      operation retried once. ----
let dbp = null;
function db(){
  return dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('backtrack', 2);
    r.onupgradeneeded = () => {                                        // v1: takes + pcm · v2: + sessions (the quiet history)
      const d = r.result;
      if(!d.objectStoreNames.contains('takes')) d.createObjectStore('takes', { keyPath:'id' });
      if(!d.objectStoreNames.contains('pcm')) d.createObjectStore('pcm');
      if(!d.objectStoreNames.contains('sessions')) d.createObjectStore('sessions', { keyPath:'id' });
    };
    r.onsuccess = () => { const d = r.result; d.onclose = () => { dbp = null; }; d.onversionchange = () => { d.close(); dbp = null; }; res(d); };
    r.onerror = () => { dbp = null; rej(r.error); };
  });
}
async function withDb(fn){
  try{ return await fn(await db()); }
  catch(e){
    if(!e || !/InvalidState|Unknown|TransactionInactive|Abort/.test(e.name || '')) throw e;
    dbp = null; return fn(await db());                    // the connection went away: reopen and try once more
  }
}
const done = t => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = t.onabort = () => rej(t.error || new DOMException('aborted', 'AbortError')); });
const ask = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
export const listTakes = () => withDb(async d => (await ask(d.transaction('takes').objectStore('takes').getAll())).sort((a, b) => b.created - a.created));
export const getPcm = id => withDb(async d => new Int16Array(await ask(d.transaction('pcm').objectStore('pcm').get(id))));
export const saveMeta = take => withDb(async d => { const t = d.transaction('takes', 'readwrite'); t.objectStore('takes').put(take); await done(t); });
export const deleteTake = id => withDb(async d => { const t = d.transaction(['takes', 'pcm'], 'readwrite'); t.objectStore('takes').delete(id); t.objectStore('pcm').delete(id); await done(t); });
// ---- the session log: what you practised and for how long. No streaks, no goals; one control clears it. ----
export const logSession = entry => withDb(async d => { const t = d.transaction('sessions', 'readwrite'); t.objectStore('sessions').put({ id:'s' + Date.now().toString(36), ...entry }); await done(t); });
export const listSessions = since => withDb(async d => (await ask(d.transaction('sessions').objectStore('sessions').getAll())).filter(x => x.start >= since));
export const clearSessions = () => withDb(async d => { const t = d.transaction('sessions', 'readwrite'); t.objectStore('sessions').clear(); await done(t); });

async function saveTake(take, pcm){
  await withDb(async d => { const t = d.transaction(['takes', 'pcm'], 'readwrite'); t.objectStore('takes').put(take); t.objectStore('pcm').put(pcm.buffer, take.id); await done(t); });
  try{ if(navigator.storage && navigator.storage.persist) navigator.storage.persist(); }catch(e){}   // ask the browser not to clear takes under storage pressure
}

// ---- round-trip latency: from a sound being scheduled to the mic hearing it (output + input). Measured on the
//      speaker when the user asks; until then an estimate from what the browser reports plus a typical mic delay. ----
// Measured per input: the iPhone mic on the speaker and a headset mic have very different round trips.
// (The first version stored one value under LAT; it still applies to any input not measured since.)
const LAT = 'backtrack-latency', LATS = 'backtrack-latency-by-input', LAST = 'backtrack-mic-last';
const readJSON = k => { try{ return JSON.parse(localStorage.getItem(k) || 'null'); }catch(e){ return null; } };
export const currentInput = () => mic ? mic.input : (readJSON(LAST) || '');   // the live input's label, or the last one used
export function latency(input = currentInput()){
  const m = (readJSON(LATS) || {})[input] || readJSON(LAT);
  if(m && isFinite(m.sec)) return { sec:m.sec, measured:true };
  const out = ctx ? (ctx.baseLatency || 0) + (ctx.outputLatency || 0) : .02;
  return { sec: Math.min(.4, out + .012), measured:false };
}

// ---- the mic: one shared stream, open only while something holds a lease on it (● Rec, Measure, Tune listening).
//      Each capture hangs its own tap on the shared source, so Tune keeps listening while a take records and nothing
//      can end someone else's capture. Measure needs the mic to itself. Voice processing is off: it mangles instruments. ----
let mic = null, opening = null, measuring = false, workletReady = null, routeTimer = 0;
const micHooks = { ended(){}, input(){} };
export const setMicHooks = h => Object.assign(micHooks, h);
export const micBusy = () => measuring;
export const micOpen = () => !!mic;
export const micGranted = () => { try{ return !!localStorage.getItem('backtrack-mic'); }catch(e){ return false; } };

// Which mic. By default the phone's own (built-in) mic: iOS's Automatic choice with AirPods connected is their mic,
// which turns them into a call-quality headset both ways. 'auto' = let iOS choose; { id, label } = a named input.
// deviceId:{exact} makes WebKit call setPreferredInput; ids are per site and survive reloads, so the built-in mic's
// id, found once (names appear only after the mic has been on in a page load), is remembered in BUILTIN.
const PICK = 'backtrack-mic-pick', BUILTIN = 'backtrack-mic-builtin', BASE = { echoCancellation:false, noiseSuppression:false, autoGainControl:false, channelCount:1 };
export const micPick = () => readJSON(PICK);                                    // null (built-in, the default) | 'auto' | { id, label }
export function setMicPick(p){ try{ if(p) localStorage.setItem(PICK, JSON.stringify(p)); else localStorage.removeItem(PICK); }catch(e){} }
export const builtinMic = () => readJSON(BUILTIN);                              // { id, label } once found
// Inputs with names. Browsers only name them once the mic has been on in this page load.
export async function listMics(){
  try{ return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput' && d.deviceId && d.label); }catch(e){ return []; }
}
// The built-in mic among named inputs: by its name ("iPhone Microphone", "… (Built-in)"), else the first input that
// isn't a headset. (Names are localized; the ids are what's kept.)
const HEADSET = /airpods|bluetooth|headset|headphone|buds|beats|hands-?free|usb/i, BUILT = /iphone|ipad|ipod|built-?in|internal|intégr|integr|intern|interno|eingebaut|内蔵|内建/i;
export function findBuiltin(list){
  const d = list.find(x => BUILT.test(x.label) && !HEADSET.test(x.label)) || list.find(x => !HEADSET.test(x.label));
  if(!d) return null;
  const b = { id:d.deviceId, label:d.label }; try{ localStorage.setItem(BUILTIN, JSON.stringify(b)); }catch(e){}
  return b;
}
const gum = c => navigator.mediaDevices.getUserMedia({ audio:c });
const withId = id => gum({ ...BASE, deviceId:{ exact:id } });
function request(){
  const p = micPick(), b = builtinMic(), id = p && p !== 'auto' ? p.id : !p && b ? b.id : null;
  // A chosen mic that's gone (unplugged, or this home-screen app's ids differ) falls back to Automatic rather than
  // failing the take. A real denial fails again at once, without a second prompt.
  return id ? withId(id).catch(() => gum(BASE).then(s => { s.fellBack = true; return s; })) : gum(BASE);
}
// The first time (the built-in mic's id not known yet), iOS may have picked a headset: now that the inputs have
// names, find the built-in mic and, if it isn't the one live, switch to it. (One quick reroute, once per install.)
async function preferBuiltin(stream){
  if(micPick() || builtinMic()) return stream;
  const b = findBuiltin(await listMics()), tr = stream.getAudioTracks()[0];
  if(!b || !tr || tr.label === b.label) return stream;
  try{ const s = await withId(b.id); stream.getTracks().forEach(t => t.stop()); return s; }catch(e){ return stream; }
}
function openStream(){
  setAudioSession('play-and-record'); setRouting(true); clearTimeout(routeTimer);   // the route change can briefly interrupt the context: not an "outside pause"
  const asked = request();
  let stream = null;
  return opening = (async () => {
    try{
      stream = await preferBuiltin(await asked); const tr = stream.getAudioTracks()[0];
      try{ localStorage.setItem('backtrack-mic', '1'); }catch(e){}
      const m = mic = { stream, node: ctx.createMediaStreamSource(stream), users:0, input: tr ? tr.label : '', fellBack: !!stream.fellBack, routes:0 };
      try{ localStorage.setItem(LAST, JSON.stringify(m.input)); }catch(e){}
      setTimeout(() => micHooks.input(m.input));                                  // the inputs have names now
      if(tr){
        tr.addEventListener('configurationchange', () => { m.input = tr.label; m.routes++; micHooks.input(m.input); });
        tr.addEventListener('ended', () => { if(mic === m) micHooks.ended(); });      // e.g. a chosen headset disconnected
      }
      return m;
    }catch(e){
      (stream ? Promise.resolve(stream) : asked).then(s => s.getTracks().forEach(t => t.stop())).catch(() => {});   // never leave a mic open behind a failure
      setAudioSession('playback'); throw e;
    }finally{
      opening = null; routeTimer = setTimeout(() => setRouting(false), 1200);      // iOS can reroute just after getUserMedia resolves
    }
  })();
}
// Resolves to a lease on the open mic (opening it if needed). Call from a tap: getUserMedia starts before any await.
// capture: the lease will record (takes, Measure), so the capture worklet must be loaded; Tune and Find mics only listen.
// wake: false leaves a stopped or paused session asleep (Find mics); the mic works on a suspended context.
export async function openMic({ measure = false, capture = true, wake = true } = {}){
  if(measuring || (measure && (mic || opening))) throw new DOMException('The microphone is already in use.', 'InvalidStateError');
  if(measure) measuring = true;
  if(wake) unlock(); else ensureCtx();
  if(capture) workletReady ||= ctx.audioWorklet.addModule('js/rec-worklet.js').catch(e => { workletReady = null; throw e; });
  const m = mic || opening || openStream();
  try{
    const [shared] = await Promise.all([m, capture ? workletReady : null]);
    shared.users++;
    return { shared, tap:null, sink:null, chunks:[], frames:0, onLimit:null, measure, closed:false };
  }catch(e){
    if(measure) measuring = false;
    Promise.resolve(m).then(s => { if(!s.users) drop(s); }, () => {});   // the worklet failed first: close the mic once it opens
    throw e;
  }
}
function drop(m){
  try{ m.node.disconnect(); }catch(e){}
  m.stream.getTracks().forEach(t => t.stop());
  if(mic === m){ mic = null; setAudioSession('playback'); setTimeout(() => micHooks.input('')); }   // (the pickers' "Listening with" line)
}
// Give a lease back; the mic closes when nobody holds one.
export function releaseMic(cap){
  if(!cap || cap.closed) return;
  cap.closed = true; if(cap.measure) measuring = false;
  if(--cap.shared.users <= 0) drop(cap.shared);
}
export const micSource = cap => cap.shared.node;
// Hear the mic briefly, just so the browser names the inputs (call from a tap). Returns the named inputs.
export async function findMics(){
  const cap = await openMic({ capture:false, wake:false });
  try{ return await listMics(); } finally{ releaseMic(cap); }
}
export function beginCapture(cap, limit){
  cap.onLimit = limit || null; cap.routes0 = cap.shared.routes;       // a reroute earlier in a Tune session isn't this take's
  cap.tap = new AudioWorkletNode(ctx, 'rec-tap', { numberOfInputs:1, numberOfOutputs:1, outputChannelCount:[1], channelCount:1, channelCountMode:'explicit' });
  cap.sink = ctx.createGain(); cap.sink.gain.value = 0;   // the tap must reach the destination to be processed; silently
  cap.shared.node.connect(cap.tap).connect(cap.sink).connect(ctx.destination);
  cap.tap.port.onmessage = e => {
    if(!e.data.pcm) return;
    const f = e.data.pcm, s = new Int16Array(f.length);
    for(let i = 0; i < f.length; i++) s[i] = Math.max(-1, Math.min(1, f[i])) * 32767;
    cap.chunks.push({ frame:e.data.frame, pcm:s }); cap.frames += s.length;
    if(cap.onLimit && cap.frames >= MAX_SEC * ctx.sampleRate){ const cb = cap.onLimit; cap.onLimit = null; cb(); }
  };
}
export const capturedSec = cap => cap && ctx ? cap.frames / ctx.sampleRate : 0;
// Stop capturing and close the mic (safe to call on a handle that never began capturing).
// Returns { pcm (Int16, gaps zero-filled), start (ctx seconds of the first sample) }, or null if nothing was captured.
export async function endCapture(cap){
  if(!cap || cap.closed || cap.ending) return null;
  cap.ending = true;
  const t = cap.tap;
  if(t) await Promise.race([ new Promise(r => { const prev = t.port.onmessage; t.port.onmessage = e => { if(e.data.done) r(); else prev(e); }; t.port.postMessage('stop'); }), wait(600) ]);
  try{ if(t){ cap.shared.node.disconnect(t); t.disconnect(); } cap.sink && cap.sink.disconnect(); }catch(e){}
  const input = cap.shared.input, routeChanged = cap.shared.routes !== cap.routes0 || cap.shared.fellBack;
  releaseMic(cap);
  if(!cap.chunks.length) return null;
  const f0 = cap.chunks[0].frame, last = cap.chunks[cap.chunks.length - 1], pcm = new Int16Array(last.frame + last.pcm.length - f0);
  for(const c of cap.chunks) pcm.set(c.pcm, c.frame - f0);
  cap.chunks = [];
  return { pcm, start: f0 / ctx.sampleRate, input, routeChanged };
}

// ---- a take: the mic plus everything needed to rebuild the backing it was recorded over ----
// sess = { live (drums were playing), t0, barSec, loopBars, rate, countin (session began with a count-in) } from the transport.
// Resolves to { take } when saved, { take, pcm, unsaved:true } when storage failed (so the audio can still be shared), or null.
export async function finishTake(cap, sess, snap){
  const c = await endCapture(cap);
  if(!c || c.pcm.length < ctx.sampleRate * .5) return null;       // under half a second: nothing worth keeping
  let barIndex = 0, alignSec = 0;
  if(sess.mode === 'breathe'){ if(sess.live) alignSec = sess.t0 - c.start; }
  else if(sess.live && sess.barSec){                                 // drums were playing (Groove, or Tune with drums)
    barIndex = Math.max(0, Math.ceil((c.start - sess.t0) / sess.barSec - 1e-6));   // the first bar line at or after the mic opened
    alignSec = sess.t0 + barIndex * sess.barSec - c.start;                          // …in seconds into the recording
  }
  const k = keyLabel(snap.key), id = 't' + Date.now().toString(36), breathe = sess.mode === 'breathe', tune = sess.mode === 'tune';
  const drums = tune ? !!sess.live : true;                           // Tune may run with the drone alone
  const take = { id, created: Date.now(), mode: sess.mode || 'groove',
    name: breathe ? `${breathLabel(snap.pattern)} breath · ${k}` : tune ? snap.tuneName : `${snap.bpm} ${k} ${SHORT[snap.bpm]}`, preset: snap.preset,
    pattern: snap.pattern, bsound: snap.bsound, bcue: snap.bcue, swell: snap.swell,
    bpm: tune ? (+snap.tdrums || 96) : snap.bpm, key: snap.key, rate: sess.rate || 1, loopBars: sess.loopBars || 16,
    drop: tune ? '0-0' : snap.drop, click: tune ? 'off' : snap.click, wash: tune ? (snap.tdrone === 'wash' ? 'on' : 'off') : snap.wash,
    washRate: tune ? +snap.a4 / 440 : 1, dvol: drums ? +snap.dvol : 0, wvol: +snap.wvol, countin: !!(sess.countin && barIndex === 0),
    hasTrack: tune ? !!sess.live || snap.tdrone === 'wash' : !!sess.live,
    sr: ctx.sampleRate, frames: c.pcm.length, seconds: c.pcm.length / ctx.sampleRate, alignSec, barIndex,
    latency: latency(c.input).sec, input: c.input || '', routeChanged: !!c.routeChanged, nudge: 0 };
  try{ await saveTake(take, c.pcm); return { take }; }
  catch(e){ return { take, pcm: c.pcm, unsaved:true }; }
}
// what a take needs to remember about the settings at the moment recording began
export const snapshot = () => ({ bpm:S.bpm, key:S.key, drop:S.drop, click:S.click, wash:S.wash, dvol:S.dvol, wvol:S.wvol, countin:S.countin, preset:presetString(),
                                  pattern:S.pattern, bsound:S.bsound, bcue:S.bcue, swell:S.swell,
                                  a4:S.a4, tdrone:S.tdrone, tdrums:S.tdrums, tuneName: tuneLabel() + (+S.tdrums ? ` · ${S.tdrums}` : '') });

// Where your part starts in the recording: what you played at recording position (T − start) + latency answered the
// backing scheduled at ctx time T, so skipping `shift` seconds puts every note back on the backing's own timeline.
// take.nudge moves your part later (+) or earlier (−) by ear, in ms.
const shiftOf = take => take.latency - take.nudge / 1000;

// ---- one heavy render at a time: a long take's buffers run to hundreds of MB, and two at once can exhaust a phone ----
let renderQ = Promise.resolve();
function serial(fn){ const p = renderQ.then(fn); renderQ = p.catch(() => {}); return p; }

// ---- the mix: the mic over a rebuilt backing, rendered offline ----
const restIn = (drop, bar) => { const [on, off] = drop.split('-').map(Number); return on ? (bar % (on + off)) >= on : false; };
function offClick(oc, t, accent, level){
  const o = oc.createOscillator(), g = oc.createGain();
  o.frequency.value = accent ? 1600 : 1100;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + .002); g.gain.exponentialRampToValueAtTime(.0001, t + .05);
  o.connect(g).connect(oc.destination); o.start(t); o.stop(t + .06);
}
async function washVoices(oc, take, total, out){
  const buf = await getBuf('wash-' + take.key), XF = 4, rate = take.washRate || 1, dur = buf.duration / rate;
  const IN = Float32Array.from({length:32}, (_, i) => Math.sin(i / 31 * Math.PI / 2)), OUT = IN.slice().reverse();
  for(let t = 0; t < total; t += dur - XF){
    const s = oc.createBufferSource(), v = oc.createGain(), end = t + dur - XF;
    s.buffer = buf; s.playbackRate.value = rate; s.connect(v).connect(out);
    v.gain.setValueCurveAtTime(IN, t, t === 0 ? 1 : XF); v.gain.setValueCurveAtTime(OUT, end, XF);
    s.start(t); s.stop(end + XF);
  }
}
async function breathBacking(oc, take, total){
  const lp = oc.createBiquadFilter(), amp = oc.createGain(), cues = oc.createGain(), hum = oc.createGain(), g = oc.createGain();
  lp.type = 'lowpass'; lp.Q.value = .5; g.gain.value = take.wvol;
  g.connect(lp).connect(amp).connect(oc.destination); cues.connect(oc.destination); hum.connect(oc.destination);
  scheduleBreath({ ctx:oc, lp:lp.frequency, amp:amp.gain, cues, hum },
                 { t0: take.alignSec, d: durs(take.pattern), swell: take.swell, bsound: take.bsound, bcue: take.bcue, key: take.key }, 0, total);
  if(take.bsound === 'wash' && take.wvol > 0) await washVoices(oc, take, total, g);
}
async function backing(oc, take, total){
  if(take.mode === 'breathe') return breathBacking(oc, take, total);
  const barSec = 240 / take.bpm / take.rate, beatSec = barSec / 4, A = take.alignSec, B = take.barIndex;
  const pAt = tau => B + (tau - A) / barSec;                   // session bar position at render time tau
  // drums, from the right place in the loop, with the take's drop-outs
  if(take.dvol > 0){
    const buf = await getBuf('drums-' + take.bpm), src = oc.createBufferSource(), mute = oc.createGain(), g = oc.createGain();
    src.buffer = buf; src.loop = true; src.playbackRate.value = take.rate;
    src.loopStart = firstHit(buf); src.loopEnd = src.loopStart + take.loopBars * 240 / take.bpm;
    const tau0 = Math.max(0, A - B * barSec), p0 = pAt(tau0);
    g.gain.value = take.dvol; src.connect(mute).connect(g).connect(oc.destination);
    src.start(tau0, src.loopStart + (p0 % take.loopBars) * 240 / take.bpm);
    let pv = restIn(take.drop, Math.floor(p0)) ? 0 : 1; mute.gain.setValueAtTime(pv, 0);
    for(let b = Math.floor(p0) + 1; b <= Math.ceil(pAt(total)); b++){
      const t = A + (b - B) * barSec, v = restIn(take.drop, b) ? 0 : 1;
      if(v !== pv && t > .01){ mute.gain.setValueAtTime(pv, t - .008); mute.gain.linearRampToValueAtTime(v, t); }
      pv = v;
    }
  }
  // the click track, and the count-in if the take began with one
  for(let b = Math.max(0, Math.floor(pAt(0))); take.click === 'on' && b <= Math.ceil(pAt(total)); b++){
    if(restIn(take.drop, b)) continue;
    for(let q = 0; q < 4; q++){ const t = A + (b - B) * barSec + q * beatSec; if(t >= 0 && t < total) offClick(oc, t, q === 0, .12); }
  }
  if(take.countin) for(let q = 0; q < 4; q++){ const t = A - barSec + q * beatSec; if(t >= 0) offClick(oc, t, q === 0, .35); }
  // the drone, crossfaded into itself like the live player
  if(take.wash === 'on' && take.wvol > 0){ const g = oc.createGain(); g.gain.value = take.wvol; g.connect(oc.destination); await washVoices(oc, take, total, g); }
}
// The mic over the rebuilt backing, as a stereo AudioBuffer, peak-limited so the mix never clips. Serialized.
export function renderMix(take, pcm){
  return serial(async () => {
    ensureCtx();                                                   // decode only: no need to wake the context
    const sr = take.sr, micSec = take.frames / sr, shift = shiftOf(take);
    const total = Math.max(.5, micSec - Math.max(0, shift) + .3), oc = new OfflineAudioContext(2, Math.ceil(total * sr), sr);
    const mb = oc.createBuffer(1, take.frames, sr), ch = mb.getChannelData(0);
    for(let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const ms = oc.createBufferSource(); ms.buffer = mb; ms.connect(oc.destination);
    if(shift >= 0) ms.start(0, Math.min(shift, micSec)); else ms.start(-shift);
    if(take.hasTrack) await backing(oc, take, total);
    const out = await oc.startRendering();
    let peak = 0; for(let c = 0; c < out.numberOfChannels; c++){ const d = out.getChannelData(c); for(let i = 0; i < d.length; i++){ const a = Math.abs(d[i]); if(a > peak) peak = a; } }
    if(peak > .98) for(let c = 0; c < out.numberOfChannels; c++){ const d = out.getChannelData(c), k = .98 / peak; for(let i = 0; i < d.length; i++) d[i] *= k; }
    return out;
  });
}
// Your part alone, straight from the stored samples (no render): mono, with the same sync as the mix.
function micSlice(take, pcm){
  const n = Math.round(shiftOf(take) * take.sr);
  if(n >= 0) return pcm.subarray(Math.min(n, pcm.length));
  const out = new Int16Array(pcm.length - n); out.set(pcm, -n); return out;   // nudged later than the recording: lead with silence
}
export function micBuffer(take, pcm){
  const s = micSlice(take, pcm), b = ensureCtx().createBuffer(1, Math.max(1, s.length), take.sr), d = b.getChannelData(0);
  for(let i = 0; i < s.length; i++) d[i] = s[i] / 32768;
  return b;
}

// ---- export: 16-bit WAV files, built in parts (no single giant buffer), then shared or downloaded ----
function wavHeader(chs, sr, bytes){
  const dv = new DataView(new ArrayBuffer(44)), str = (o, s) => { for(let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + bytes, true); str(8, 'WAVE'); str(12, 'fmt '); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); dv.setUint16(22, chs, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * chs * 2, true);
  dv.setUint16(32, chs * 2, true); dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, bytes, true);
  return dv;
}
export function mixWav(buf, name){
  const chs = buf.numberOfChannels, len = buf.length, data = [...Array(chs)].map((_, c) => buf.getChannelData(c)), parts = [wavHeader(chs, buf.sampleRate, len * chs * 2)];
  for(let a = 0; a < len; a += buf.sampleRate){                    // one second at a time
    const b = Math.min(len, a + buf.sampleRate), part = new Int16Array((b - a) * chs);
    for(let i = a, o = 0; i < b; i++) for(let c = 0; c < chs; c++) part[o++] = Math.max(-1, Math.min(1, data[c][i])) * 32767;
    parts.push(part);
  }
  return new File(parts, name, { type:'audio/wav' });
}
// Int16Array is little-endian on every device this runs on, which is what WAV wants.
export function micWav(take, pcm, name){ const s = micSlice(take, pcm); return new File([wavHeader(1, take.sr, s.length * 2), s], name, { type:'audio/wav' }); }
// Chrome (Android/desktop) refuses to share more than 50 MiB; larger files, or no share sheet at all, download instead.
export async function shareFile(file){
  const fits = isIOS || file.size <= 50 * 1024 * 1024;
  if(fits && navigator.canShare && navigator.canShare({ files:[file] })){ await navigator.share({ files:[file], title:file.name }); return 'shared'; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000); return 'downloaded';
}

// ---- measure the round trip on the speaker: eight clicks, heard back through the mic ----
export async function measureLatency(){
  const cap = await openMic({ measure:true });
  beginCapture(cap); await wait(500);
  const t0 = ctx.currentTime + .3, times = Array.from({length:8}, (_, k) => t0 + k * .5);
  times.forEach((t, k) => click(t, k === 0, .5));
  await wait((t0 - ctx.currentTime + 8 * .5 + .6) * 1000);
  const c = await endCapture(cap); idleSuspend(800);
  if(!c) return { ok:false };
  const sr = ctx.sampleRate, x = c.pcm, delays = [];
  let floor = 0; for(let i = 0; i < Math.min(x.length, sr * .25); i++) floor = Math.max(floor, Math.abs(x[i]));   // room noise before the first click
  for(const t of times){
    const a = Math.floor((t - c.start) * sr), b = Math.min(x.length, a + Math.floor(sr * .45)); if(a < 0 || a >= x.length) continue;
    let peak = 0; for(let i = a; i < b; i++) peak = Math.max(peak, Math.abs(x[i]));
    if(peak < Math.max(floor * 3, 600)) continue;                                  // too quiet to trust
    for(let i = a; i < b; i++) if(Math.abs(x[i]) > peak * .3){ delays.push((i - a) / sr); break; }
  }
  if(delays.length < 5) return { ok:false, heard:delays.length };
  delays.sort((p, q) => p - q);
  const med = delays[Math.floor(delays.length / 2)], spread = delays[Math.floor(delays.length * .8)] - delays[Math.floor(delays.length * .2)];
  if(spread > .02) return { ok:false, heard:delays.length, spread };
  const all = readJSON(LATS) || {}; all[c.input || ''] = { sec:med, at:Date.now() };
  try{ localStorage.setItem(LATS, JSON.stringify(all)); }catch(e){}
  return { ok:true, sec:med, input:c.input };
}

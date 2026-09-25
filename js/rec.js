// Recording: the mic (opened only while ● is on), takes stored on this phone, the offline mix used for
// "play with track" and for sharing, and the round-trip latency measurement.
import { S, keyLabel, SHORT, presetString } from './state.js';
import { ctx, unlock, ensureCtx, getBuf, click, setRouting, setAudioSession, idleSuspend } from './audio.js';
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
    const r = indexedDB.open('backtrack', 1);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('takes', { keyPath:'id' }); d.createObjectStore('pcm'); };
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
async function saveTake(take, pcm){
  await withDb(async d => { const t = d.transaction(['takes', 'pcm'], 'readwrite'); t.objectStore('takes').put(take); t.objectStore('pcm').put(pcm.buffer, take.id); await done(t); });
  try{ if(navigator.storage && navigator.storage.persist) navigator.storage.persist(); }catch(e){}   // ask the browser not to clear takes under storage pressure
}

// ---- round-trip latency: from a sound being scheduled to the mic hearing it (output + input). Measured on the
//      speaker when the user asks; until then an estimate from what the browser reports plus a typical mic delay. ----
const LAT = 'backtrack-latency';
export function latency(){
  try{ const m = JSON.parse(localStorage.getItem(LAT) || 'null'); if(m && isFinite(m.sec)) return { sec:m.sec, measured:true }; }catch(e){}
  const out = ctx ? (ctx.baseLatency || 0) + (ctx.outputLatency || 0) : .02;
  return { sec: Math.min(.4, out + .012), measured:false };
}

// ---- the mic. One capture at a time (a take or a measurement), each owning its own stream and nodes, so
//      nothing can end someone else's capture or leave a mic open. Voice processing is off: it mangles instruments. ----
let busy = false, workletReady = null;
export const micBusy = () => busy;
export const micGranted = () => { try{ return !!localStorage.getItem('backtrack-mic'); }catch(e){ return false; } };
// Resolves to a capture handle with the mic open. Call from a tap: getUserMedia is started before any await.
export async function openMic(){
  if(busy) throw new DOMException('The microphone is already in use.', 'InvalidStateError');
  busy = true;
  unlock();
  workletReady ||= ctx.audioWorklet.addModule('js/rec-worklet.js').catch(e => { workletReady = null; throw e; });
  setAudioSession('play-and-record'); setRouting(true);  // the route change can briefly interrupt the context: not an "outside pause"
  const gum = navigator.mediaDevices.getUserMedia({ audio:{ echoCancellation:false, noiseSuppression:false, autoGainControl:false, channelCount:1 } });
  try{
    const [stream] = await Promise.all([gum, workletReady]);
    try{ localStorage.setItem('backtrack-mic', '1'); }catch(e){}
    return { stream, tap:null, micNode:null, sink:null, chunks:[], frames:0, onLimit:null };
  }catch(e){
    gum.then(s => s.getTracks().forEach(t => t.stop())).catch(() => {});   // never leave a mic open behind a failure
    busy = false; setAudioSession('playback'); throw e;
  }finally{ setRouting(false); }
}
export function beginCapture(cap, limit){
  cap.onLimit = limit || null;
  cap.micNode = ctx.createMediaStreamSource(cap.stream);
  cap.tap = new AudioWorkletNode(ctx, 'rec-tap', { numberOfInputs:1, numberOfOutputs:1, outputChannelCount:[1], channelCount:1, channelCountMode:'explicit' });
  cap.sink = ctx.createGain(); cap.sink.gain.value = 0;   // the tap must reach the destination to be processed; silently
  cap.micNode.connect(cap.tap).connect(cap.sink).connect(ctx.destination);
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
  if(!cap || cap.closed) return null;
  cap.closed = true;
  const t = cap.tap;
  if(t) await Promise.race([ new Promise(r => { const prev = t.port.onmessage; t.port.onmessage = e => { if(e.data.done) r(); else prev(e); }; t.port.postMessage('stop'); }), wait(600) ]);
  try{ cap.micNode && cap.micNode.disconnect(); t && t.disconnect(); cap.sink && cap.sink.disconnect(); }catch(e){}
  cap.stream.getTracks().forEach(tr => tr.stop());
  busy = false; setAudioSession('playback');
  if(!cap.chunks.length) return null;
  const f0 = cap.chunks[0].frame, last = cap.chunks[cap.chunks.length - 1], pcm = new Int16Array(last.frame + last.pcm.length - f0);
  for(const c of cap.chunks) pcm.set(c.pcm, c.frame - f0);
  cap.chunks = [];
  return { pcm, start: f0 / ctx.sampleRate };
}

// ---- a take: the mic plus everything needed to rebuild the backing it was recorded over ----
// sess = { live (drums were playing), t0, barSec, loopBars, rate, countin (session began with a count-in) } from the transport.
// Resolves to { take } when saved, { take, pcm, unsaved:true } when storage failed (so the audio can still be shared), or null.
export async function finishTake(cap, sess, snap){
  const c = await endCapture(cap);
  if(!c || c.pcm.length < ctx.sampleRate * .5) return null;       // under half a second: nothing worth keeping
  let barIndex = 0, alignSec = 0;
  if(sess.live){
    barIndex = Math.max(0, Math.ceil((c.start - sess.t0) / sess.barSec - 1e-6));   // the first bar line at or after the mic opened
    alignSec = sess.t0 + barIndex * sess.barSec - c.start;                          // …in seconds into the recording
  }
  const k = keyLabel(snap.key), id = 't' + Date.now().toString(36);
  const take = { id, created: Date.now(), name: `${snap.bpm} ${k} ${SHORT[snap.bpm]}`, preset: snap.preset,
    bpm: snap.bpm, key: snap.key, rate: sess.rate, loopBars: sess.loopBars, drop: snap.drop, click: snap.click, wash: snap.wash,
    dvol: +snap.dvol, wvol: +snap.wvol, countin: !!(sess.countin && barIndex === 0), hasTrack: !!sess.live,
    sr: ctx.sampleRate, frames: c.pcm.length, seconds: c.pcm.length / ctx.sampleRate, alignSec, barIndex,
    latency: latency().sec, nudge: 0 };
  try{ await saveTake(take, c.pcm); return { take }; }
  catch(e){ return { take, pcm: c.pcm, unsaved:true }; }
}
// what a take needs to remember about the settings at the moment recording began
export const snapshot = () => ({ bpm:S.bpm, key:S.key, drop:S.drop, click:S.click, wash:S.wash, dvol:S.dvol, wvol:S.wvol, countin:S.countin, preset:presetString() });

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
async function backing(oc, take, total){
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
  if(take.wash === 'on' && take.wvol > 0){
    const buf = await getBuf('wash-' + take.key), XF = 4, g = oc.createGain(); g.gain.value = take.wvol; g.connect(oc.destination);
    const IN = Float32Array.from({length:32}, (_, i) => Math.sin(i / 31 * Math.PI / 2)), OUT = IN.slice().reverse();
    for(let t = 0; t < total; t += buf.duration - XF){
      const s = oc.createBufferSource(), v = oc.createGain(), end = t + buf.duration - XF;
      s.buffer = buf; s.connect(v).connect(g);
      v.gain.setValueCurveAtTime(IN, t, t === 0 ? 1 : XF); v.gain.setValueCurveAtTime(OUT, end, XF);
      s.start(t); s.stop(end + XF);
    }
  }
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
  const cap = await openMic();
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
  try{ localStorage.setItem(LAT, JSON.stringify({ sec:med, at:Date.now() })); }catch(e){}
  return { ok:true, sec:med };
}

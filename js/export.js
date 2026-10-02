// Save as audio: the setup on screen rendered offline to a WAV file for the share sheet (Files, AirDrop, another app,
// a speaker). Groove, Breathe and Tune go through the take renderer's backing (rec.js), so a file sounds like the app:
// the count-in if there is one, then the minutes, ending as a session does: on the 4-bar phrase line nearest them (Groove,
// Tune's drums), after the whole breath nearest them (Breathe) or on the minute (a drone alone), fading over
// min(1.5 s, the last bar or phase). Peaks are brought to −1 dBFS. Noise is whole buffer periods at the app's level
// (noise.js), so the file loops seamlessly in a player that repeats it. Loaded only when someone taps Save as audio.
import { S, durs, tuning, walkOf, noiseTo } from './state.js';
import { renderRate } from './audio.js';
import { setupOf, makeTimeline } from './timeline.js';
import { backing, mixWav, serial } from './rec.js';
import { renderNoise } from './noise.js';
export { shareFile } from './rec.js';

const LEAD = .2, TOP = .891;                      // a moment of silence before the first sound; −1 dBFS

// What the backing renderer reads (the fields a take stores), for the setup on screen. Tune's drums are a plain loop.
function takeOf(sr){
  const tune = S.mode === 'tune', breathe = S.mode === 'breathe', drums = tune ? +S.tdrums > 0 : S.sound === 'drums';
  const g = tune ? { sound:'drums', bpm:+S.tdrums || 96, fine:'0', bars:'16', meter:'4', group:'', click:'off', csub:'2', cells:'', drop:'0-0', ramp:'0', countin:false }
                 : { sound:S.sound, bpm:+S.bpm, fine:S.fine, bars:S.bars, meter:S.meter, group:S.group, click:S.click, csub:S.csub, cells:S.cells,
                     drop:S.drop, ramp:S.ramp, countin:S.countin === '1' };
  // a routine (Arrive) fitted to the file: the glide and the walk span its minutes
  const routine = !tune && !breathe && (S.tobpm || S.tokey) ? { bpm: S.tobpm ? +S.tobpm : null, from:0, to: walkOf(S) } : null;
  return { ...g, mode:S.mode, key:S.key, cvol:+S.cvol, dvol: drums ? +S.dvol : 0, wvol:+S.wvol, washRate:tuning(), routine,
    wash: tune ? (S.tdrone === 'wash' ? 'on' : 'off') : S.wash, prog: tune || breathe ? 'off' : S.prog, pbars:S.pbars,
    pattern:S.pattern, bsound:S.bsound, bcue:S.bcue, swell:S.swell, barIndex:0, alignSec:LEAD, sr };
}
// Where the file ends and how long its fade is. With a count-in, bar 0's downbeat (alignSec) comes one bar later.
function ending(take, min){
  const L = min * 60;
  if(take.mode === 'breathe'){
    const d = durs(take.pattern), C = d.reduce((a, b) => a + b, 0), last = d.filter(x => x > 0).pop() || 1;
    return { end: LEAD + Math.max(1, Math.round((L - LEAD) / C)) * C, fade: Math.min(1.5, last) };   // whole breaths, nearest the minutes
  }
  if(take.mode === 'tune' && !(take.dvol > 0)) return { end: L, fade: 1.5 };          // a drone alone: no bars to land on
  if(take.routine) take.routine.sec = Math.max(1, L - LEAD - (take.countin ? 240 / take.bpm : 0));   // arrive on the minute
  const tl = makeTimeline(setupOf(take));
  if(take.countin) take.alignSec = LEAD + tl.barSecOf(0);
  const bar = Math.max(4, Math.round(tl.barAtOrAfter(L - take.alignSec) / 4) * 4);      // the 4-bar phrase line nearest the minutes
  return { end: take.alignSec + tl.barStart(bar), fade: Math.min(1.5, tl.barSecOf(bar - 1)) };
}
function peakOf(buf, from){
  let p = 0;
  for(let c = 0; c < buf.numberOfChannels; c++){ const d = buf.getChannelData(c); for(let i = from; i < d.length; i++){ const a = Math.abs(d[i]); if(a > p) p = a; } }
  return p || 1;
}
function fadeOut(buf, a, b){                      // linear, like a session's end, and silence after it
  const i0 = Math.max(0, Math.floor(a * buf.sampleRate)), i1 = Math.min(buf.length, Math.round(b * buf.sampleRate));
  for(let c = 0; c < buf.numberOfChannels; c++){
    const d = buf.getChannelData(c);
    for(let i = i0; i < i1; i++) d[i] *= (i1 - i) / (i1 - i0);
    d.fill(0, i1);
  }
}

// The setup as a WAV File, `min` minutes long (Noise: the nearest whole number of buffer periods). progress(f) hears how
// far the render is (0…1). The settings are read now; the render waits its turn behind any take being prepared.
export function renderSetup(min, name, progress){
  const sr = renderRate(), noise = S.mode === 'noise' ? { ...S } : null, take = noise ? null : takeOf(sr);
  const tick = (oc, total) => {                   // progress stops at 5.37 s, 10.37 s… (the drone's own stops are at multiples of 6 s)
    if(progress && oc.suspend) for(let t = 5.37; t < total; t += 5) oc.suspend(t).then(() => { progress(t / total); oc.resume(); });
  };
  return serial(async () => {
    if(noise){
      const { buf, from } = await renderNoise(noise, min, sr, tick, noiseTo(noise));
      return mixWav(buf, name, from, Math.min(1, TOP / peakOf(buf, from)));   // the app's level, only kept from clipping
    }
    const { end, fade } = ending(take, min), total = end + .05, oc = new OfflineAudioContext(2, Math.ceil(total * sr), sr);
    await backing(oc, take, total);
    tick(oc, total);
    const buf = await oc.startRendering();
    fadeOut(buf, end - fade, end);
    return mixWav(buf, name, 0, Math.min(8, TOP / peakOf(buf, 0)));
  });
}

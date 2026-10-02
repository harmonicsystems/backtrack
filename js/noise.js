// Noise mode: colored noise from a looped buffer, a five-band EQ, and waves (a slow swell in level and brightness),
// scheduled ahead on the audio clock like the breath, so anything that moves stays on the one clock (later: waves that
// follow the breath, changes on a bar line). The buffers, the EQ table and the wave maths are pure; the voice is live.
import { S, NCOLORS } from './state.js';
import { ctx, bus, settle, fadeTo, watch } from './audio.js';

const COLORS = NCOLORS;
// The EQ: [type, frequency, label]. Peaking bands are an octave and a bit wide (Q 1).
export const BANDS = [['lowshelf', 80, 'Low'], ['peaking', 250, '250'], ['peaking', 1000, '1k'], ['peaking', 4000, '4k'], ['highshelf', 10000, 'High']];
// Grey is pink with the lows and highs lifted, where the ear hears less (a gentle inverse of the equal-loudness
// contours, added to the EQ rather than baked into the buffer).
const GREY = [6, 2, 0, -2, 3];
export const eqOf = (g = S) => { const e = String(g.neq || '0.0.0.0.0').split('.').map(Number); return BANDS.map((_, i) => e[i] || 0); };
export const eqLive = (g = S) => eqOf(g).map((v, i) => v + (g.ncolor === 'grey' ? GREY[i] : 0));

// ---- the buffers: 2^18 samples a channel (~5.5 s), the two channels decorrelated, from a seeded generator (the same
//      color is the same noise every time), the same RMS for every color (−20 dBFS), and seamless: a quarter-second
//      more is made and its tail crossfaded (equal power) into the head, so the loop point is just more noise. ----
const LEN = 1 << 18, TARGET = .1;
const rng = seed => () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
function colored(color, seed, n){
  const r = rng(seed), w = () => r() * 2 - 1, x = new Float32Array(n);
  if(color === 'white' || color === 'violet'){
    let prev = 0;
    for(let i = 0; i < n; i++){ const v = w(); x[i] = color === 'violet' ? v - prev : v; prev = v; }     // violet: white, differenced (+6 dB/oct)
  } else if(color === 'brown'){
    let y = 0;
    for(let i = 0; i < n; i++){ y = .998 * y + w(); x[i] = y; }                                      // a leaky integrator: −6 dB/oct above ~15 Hz
  } else {                                                                                           // pink (grey too), and blue = pink differenced
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, prev = 0;                             // Paul Kellet's refined pink filter
    for(let i = 0; i < n; i++){
      const v = w();
      b0 = .99886 * b0 + v * .0555179; b1 = .99332 * b1 + v * .0750759; b2 = .969 * b2 + v * .153852;
      b3 = .8665 * b3 + v * .3104856; b4 = .55 * b4 + v * .5329522; b5 = -.7616 * b5 - v * .016898;
      const p = b0 + b1 + b2 + b3 + b4 + b5 + b6 + v * .5362; b6 = v * .115926;
      x[i] = color === 'blue' ? p - prev : p; prev = p;
    }
  }
  let mean = 0; for(let i = 0; i < n; i++) mean += x[i]; mean /= n;                                 // no DC (brown wanders)
  for(let i = 0; i < n; i++) x[i] -= mean;
  return x;
}
const cache = new Map();
export function noiseBuffer(color, sr){
  const key = `${color}@${sr}`; if(cache.has(key)) return cache.get(key);
  const xf = Math.round(sr / 4), ci = COLORS.findIndex(c => c[0] === color), buf = new AudioBuffer({ numberOfChannels:2, length:LEN, sampleRate:sr });
  for(let ch = 0; ch < 2; ch++){
    const x = colored(color, 1 + ci * 2 + ch, LEN + xf), out = buf.getChannelData(ch);
    out.set(x.subarray(0, LEN));
    for(let i = 0; i < xf; i++){ const a = (i + .5) / xf * Math.PI / 2; out[i] = x[i] * Math.sin(a) + x[LEN + i] * Math.cos(a); }   // the loop's join
    let s = 0; for(let i = 0; i < LEN; i++) s += out[i] * out[i];
    const k = TARGET / Math.sqrt(s / LEN); for(let i = 0; i < LEN; i++) out[i] *= k;
  }
  for(const k of cache.keys()) if(!k.endsWith('@' + sr)) cache.delete(k);                          // one rate in memory (~2 MB a color)
  cache.set(key, buf);
  return buf;
}

// ---- waves: each one rises over 40 % of its length and washes out over the rest. Lengths vary ±15 % around the
//      setting, seeded by the wave's number, so the surf is irregular but the same every time (an offline render, later,
//      will match). height h 0 … 1; level 1 − .65·depth·(1 − h); brightness 1.5 kHz … 12 kHz on depth. ----
export const waveLen = (i, period) => period * (.85 + .3 * rng(1000 + i)());
export const waveLow = depth => ({ gain: 1 - .65 * depth, freq: 12000 * Math.pow(1500 / 12000, depth) });
const ease = f => .5 - .5 * Math.cos(Math.PI * f);
export const waveH = f => f < .4 ? ease(f / .4) : 1 - ease((f - .4) / .6);
const level = (h, low) => ({ gain: low.gain + (1 - low.gain) * h, freq: low.freq * Math.pow(12000 / low.freq, h) });
// Put waves on a clock between times a and b. T = { lp, amp (AudioParams) }; spec = { t0, period, depth }; returns the
// waves placed ([{ start, len }]) so the screen can follow them. Curves end 2 ms early: curves must never touch.
// spec.period and spec.depth may be functions of a wave's start time (a routine's waves slowing down or deepening).
const atT = (v, t) => typeof v === 'function' ? v(t) : v;
export function scheduleWaves(T, spec, a, b, from = { i: 0, start: spec.t0 }){
  const placed = [];
  let { i, start } = from;
  while(start < b){
    const low = waveLow(atT(spec.depth, start)), len = waveLen(i, atT(spec.period, start)), end = start + len;
    if(end > a){
      const s = Math.max(a, start), n = 64, dur = end - s - .002, g = new Float32Array(n), fr = new Float32Array(n);
      for(let k = 0; k < n; k++){ const L = level(waveH((s - start + k / (n - 1) * dur) / len), low); g[k] = L.gain; fr[k] = L.freq; }
      if(dur > .01){ try{ T.amp.setValueCurveAtTime(g, s, dur); T.lp.setValueCurveAtTime(fr, s, dur); }catch(e){} }
    }
    placed.push({ start, len }); i++; start = end;
  }
  return { placed, next: { i, start } };
}

// ---- a file (Save as audio): whole buffer periods, so it loops seamlessly when a player repeats it (the filters are fixed,
//      so periodic noise in gives periodic noise out). Half a second of pre-roll lets the filters settle and is left out
//      of the file (`from`). With waves, whole waves, all stretched by the same small factor to fill the span exactly, so
//      level and brightness meet themselves at the seam too (both at rest). `tick(oc, total)` may add progress stops. ----
// With a destination `to` ({ color, neq, nwave, nswell }: a routine), the file moves there across its length: the EQ on
// straight lines, the color crossfaded equal-power, the waves' period and depth read at each wave's start (the live
// voice does the same), and no longer seamless.
export async function renderNoise(g, min, sr, tick, to = null){
  const pre = Math.round(sr / 2), n = Math.max(1, Math.round(min * 60 * sr / LEN)) * LEN, P = pre / sr, L = n / sr;
  const oc = new OfflineAudioContext(2, pre + n, sr), src = oc.createBufferSource(), db = eqLive(g);
  src.buffer = noiseBuffer(g.ncolor, sr); src.loop = true;
  const eq = BANDS.map(([type, f], i) => { const b = oc.createBiquadFilter(); b.type = type; b.frequency.value = f; if(type === 'peaking') b.Q.value = 1; b.gain.value = db[i]; return b; });
  const lp = oc.createBiquadFilter(), amp = oc.createGain();
  lp.type = 'lowpass'; lp.Q.value = .5; lp.frequency.value = 20000;
  const sg = oc.createGain(); src.connect(sg).connect(eq[0]); for(let i = 0; i < 4; i++) eq[i].connect(eq[i + 1]);
  eq[4].connect(lp).connect(amp).connect(oc.destination);
  const pAt = t => Math.max(0, Math.min(1, (t - P) / L)), lerp = (a, b, p) => a + (b - a) * p;
  if(to){
    const db1 = eqLive({ ...g, ncolor: to.color, neq: to.neq });
    eq.forEach((b, i) => { b.gain.setValueAtTime(db[i], P); b.gain.linearRampToValueAtTime(db1[i], P + L); });
    if(to.color !== g.ncolor){
      const s2 = oc.createBufferSource(), g2 = oc.createGain(), N = 512;
      s2.buffer = noiseBuffer(to.color, sr); s2.loop = true; s2.connect(g2).connect(eq[0]); s2.start(0, s2.buffer.duration / 3);
      const out = Float32Array.from({ length:N }, (_, i) => Math.cos(i / (N - 1) * Math.PI / 2)), inn = Float32Array.from({ length:N }, (_, i) => Math.sin(i / (N - 1) * Math.PI / 2));
      g2.gain.setValueAtTime(0, 0); sg.gain.setValueCurveAtTime(out, P, L - .002); g2.gain.setValueCurveAtTime(inn, P, L - .002);
    }
  }
  const p0 = +g.nwave, p1 = to ? +to.nwave : p0, d0 = +g.nswell / 100, d1 = to ? +to.nswell / 100 : d0;
  if(to && (p0 || p1)){
    const period = t => p0 && p1 ? lerp(p0, p1, pAt(t)) : p0 || p1, depth = t => lerp(p0 ? d0 : 0, p1 ? d1 : 0, pAt(t)), low = waveLow(depth(P));
    lp.frequency.setValueAtTime(low.freq, 0); amp.gain.setValueAtTime(low.gain, 0);
    scheduleWaves({ lp: lp.frequency, amp: amp.gain }, { t0: P, period, depth }, P, P + L);
  } else if(p0){
    const low = waveLow(d0), K = Math.max(1, Math.round(L / p0));
    let sum = 0; for(let i = 0; i < K; i++) sum += waveLen(i, 1);
    lp.frequency.setValueAtTime(low.freq, 0); amp.gain.setValueAtTime(low.gain, 0);
    scheduleWaves({ lp: lp.frequency, amp: amp.gain }, { t0: P, period: L / sum, depth: d0 }, P, P + L);
  }
  src.start(0);
  if(tick) tick(oc, P + L);
  return { buf: await oc.startRendering(), from: pre };
}

// ---- the live voice: source(s) → five biquads → waves (lowpass, gain) → fade → bus.noise (→ session → master); an
//      analyser on the fade's output feeds the EQ panel's spectrum. A color change crossfades two sources (0.4 s). ----
let V = null, waveTimer = 0, waves = [], wnext = null, R = null;   // R: the routine in progress (noiseRoutine)
watch(t => { if(t === 'close'){ clearInterval(waveTimer); V = null; waves = []; R = null; } });   // the context went: nothing to stop
const ndb = () => eqLive();
function source(color, fadeIn){
  const s = ctx.createBufferSource(), g = ctx.createGain(), now = ctx.currentTime;
  s.buffer = noiseBuffer(color, ctx.sampleRate); s.loop = true; s.connect(g).connect(V.eq[0]);
  s.start(now, Math.random() * s.buffer.duration);                                                 // anywhere in the loop
  if(fadeIn) g.gain.setValueCurveAtTime(XIN, now + 1 / ctx.sampleRate, fadeIn);
  return { s, g, color };
}
export function noiseStart(fade = 2){
  if(V) return;
  const eq = BANDS.map(([type, f]) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if(type === 'peaking') b.Q.value = 1; return b; });
  const lp = ctx.createBiquadFilter(), amp = ctx.createGain(), out = ctx.createGain(), an = ctx.createAnalyser();
  lp.type = 'lowpass'; lp.Q.value = .5; lp.frequency.value = 20000;
  an.fftSize = 4096; an.smoothingTimeConstant = .85;
  for(let i = 0; i < 4; i++) eq[i].connect(eq[i + 1]);
  eq[4].connect(lp).connect(amp).connect(out).connect(bus.noise); out.connect(an);
  V = { eq, lp, amp, out, an, src: null };
  noiseEq(true);
  const now = ctx.currentTime; out.gain.setValueAtTime(0, now); out.gain.linearRampToValueAtTime(1, now + fade);
  V.src = source(S.ncolor, 0);
  wavesRestart();
}
export function noiseStop(fade = 2){
  clearInterval(waveTimer); waves = []; wnext = null; R = null;
  if(!V || !ctx) { V = null; return; }
  const v = V, now = ctx.currentTime; V = null;
  fadeTo(v.out.gain, 0, fade);
  try{ v.src.s.stop(now + fade + .1); }catch(e){}
  if(v.dst) try{ v.dst.s.stop(now + fade + .1); }catch(e){}
  setTimeout(() => { try{ v.out.disconnect(); }catch(e){} }, (fade + .5) * 1000);
}
// The EQ follows the settings (a glide, so a slider never steps).
export function noiseEq(now){
  if(!V) return;
  ndb().forEach((db, i) => { const p = V.eq[i].gain; if(now) p.value = db; else p.setTargetAtTime(db, ctx.currentTime, .03); });
}
// A new color: an equal-power crossfade, the old source down the cosine as the new one comes up the sine over the same
// 0.4 s (an exponential fade-out against a sine fade-in dipped ~4 dB a tenth of a second in).
const XIN = Float32Array.from({ length:32 }, (_, i) => Math.sin(i / 31 * Math.PI / 2)), XOUT = XIN.slice().reverse();
export function noiseColor(){
  if(!V || V.src.color === S.ncolor) { noiseEq(); return; }
  const old = V.src, now = ctx.currentTime, x = .4, p = old.g.gain, v = p.value;
  V.src = source(S.ncolor, x); noiseEq();
  if(p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(now); else { p.cancelScheduledValues(now); p.setValueAtTime(v, now); }
  try{ p.setValueCurveAtTime(XOUT.map(c => c * v), now + 1 / ctx.sampleRate, x); }catch(e){ fadeTo(p, 0, x); }
  try{ old.s.stop(now + x + .1); }catch(e){}
}
// ---- a routine (Arrive): the sound moves to a destination over the session. R maps the audio clock to progress
//      (the clock and the session both freeze in an outside pause, so they stay in step); the EQ and the color's
//      crossfade follow it every quarter second (noiseProgress, from app.js's end-of-session timer, which runs with the
//      screen off), the waves read their period and depth at each wave's start (scheduleWaves). r = { to, left }:
//      the destination and the seconds left; null ends it. Called again whenever the start settings change. ----
const pAt = t => R ? Math.max(0, Math.min(1, (t - R.c0) / R.D)) : 0;
const lerp = (a, b, p) => a + (b - a) * p;
function dropDst(){ if(!V || !V.dst) return; const d = V.dst; V.dst = null; fadeTo(d.g.gain, 0, .4); try{ d.s.stop(ctx.currentTime + .6); }catch(e){} }
export function noiseRoutine(r){
  if(!V){ R = null; return; }
  if(!r){ if(R){ R = null; dropDst(); noiseEq(); wavesRestart(); } return; }
  const from = { color:S.ncolor, eq:eqLive(S), nwave:+S.nwave, nswell:+S.nswell / 100 };
  const to = { color:r.to.color, eq:eqLive({ ...S, ncolor:r.to.color, neq:r.to.neq }), nwave:+r.to.nwave, nswell:+r.to.nswell / 100 };
  R = { from, to, c0: ctx.currentTime, D: Math.max(1, r.left) }; lastP = -1;
  if(to.color !== from.color){ if(!V.dst || V.dst.color !== to.color){ dropDst(); V.dst = source(to.color, 0); V.dst.g.gain.value = 0; } }
  else dropDst();
  noiseProgress(); wavesRestart();
}
let lastP = -1;
export function noiseProgress(){
  if(!V || !R || ctx.currentTime - lastP < .24) return;   // (a quarter second is plenty for a move over minutes)
  const now = lastP = ctx.currentTime, p = pAt(now), tau = .4, set = (param, v) => { try{ param.setTargetAtTime(v, now, tau); }catch(e){} };   // (a curve in flight: next time)
  R.from.eq.forEach((a, i) => set(V.eq[i].gain, lerp(a, R.to.eq[i], p)));
  if(V.dst){ set(V.src.g.gain, Math.cos(p * Math.PI / 2)); set(V.dst.g.gain, Math.sin(p * Math.PI / 2)); }
}
export const noiseRoutineOn = () => !!R;
// Waves on or off, or a new period or depth: glide from wherever they are to the new resting level, then schedule anew.
// In a routine the period and depth are read at each wave's start: from one side's waves to the other's, a side with
// none lends its period and its depth starts (or ends) at 0.
export function wavesRestart(){
  clearInterval(waveTimer); waves = []; wnext = null;
  if(!V) return;
  const now = ctx.currentTime;
  const w0 = R ? R.from.nwave : +S.nwave, w1 = R ? R.to.nwave : w0, s0 = R ? R.from.nswell : +S.nswell / 100, s1 = R ? R.to.nswell : s0;
  const period = R && (w0 || w1) ? t => (w0 && w1 ? lerp(w0, w1, pAt(t)) : w0 || w1) : w0, depth = R && (w0 || w1) ? t => lerp(w0 ? s0 : 0, w1 ? s1 : 0, pAt(t)) : s0;
  if(!period){ settle(V.lp.frequency, 20000, .3); settle(V.amp.gain, 1, .3); return; }
  const low = waveLow(atT(depth, now)), t0 = now + .6;
  for(const [p, v] of [[V.lp.frequency, low.freq], [V.amp.gain, low.gain]]){
    if(p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(now); else { p.cancelScheduledValues(now); p.setValueAtTime(p.value, now); }
    p.linearRampToValueAtTime(v, t0 - .002);
  }
  const spec = { t0, period, depth }, T = { lp: V.lp.frequency, amp: V.amp.gain };
  let through = t0;
  const step = () => {                                             // keep two waves (at least 16 s) on the clock
    if(!V) return;
    const want = ctx.currentTime + Math.max(16, 2.5 * atT(period, ctx.currentTime));
    if(want <= through) return;
    const r = scheduleWaves(T, spec, Math.max(through, ctx.currentTime + .02), want, wnext || undefined);
    waves = waves.filter(w => w.start + w.len > ctx.currentTime - 1).concat(r.placed.filter(w => !waves.some(x => x.start === w.start)));
    wnext = r.next; through = want;
  };
  step(); waveTimer = setInterval(step, 500);
}
// The wave height now (0 … 1; 1 with no waves), for the circle.
export function waveHeight(t){
  if(!V || !(R ? R.from.nwave || R.to.nwave : +S.nwave)) return 1;
  const w = waves.find(x => t >= x.start && t < x.start + x.len);
  return w ? waveH((t - w.start) / w.len) : 0;
}
export const noiseAnalyser = () => V && V.an;
export const noiseLive = () => !!V;

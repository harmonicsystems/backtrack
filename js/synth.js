// The harmonic drone: BackTrack's synthesizer, built from the harmonic series. Two layers from the same series:
//   Notes: which harmonics of the root sound (1–16), each with its level. This is the chord.
//   Tone:  which harmonics each of those notes has (a named sound, or drawbars). This is the timbre.
// Pure tuning puts every note on the root's own series, so the whole drone is one periodic sound with no beating at
// all. Even moves each note to the nearest piano key (octaves stay exact); each note keeps its own pure harmonics.
// No settings and no live context here: the presets, spectra and names, and the bank, which plays on any context,
// so the live drone (audio.js), a take's backing and a Save as audio file (rec.js) are the same sound.
export const H = 16;
// [id, name, levels as hex digits (harmonic 1 first, 0–f, trailing zeros dropped), octave of the fundamental:
//  1 low · 2 middle · 3 high = the Wash's root × ½ · 1 · 2, so a chord's notes land in a singable range]
export const NOTES = [
  ['root', 'Root', 'f', '3'],
  ['octave', 'Root + octave', 'f9', '3'],
  ['shruti', 'Shruti box', '0fb9', '2'],
  ['fifth', 'Open fifth', '0fb', '2'],
  ['major', 'Major', '000fcc', '1'],
  ['seventh', 'Seventh', '000fccb', '1'],
  ['overtones', 'Overtones', '0000000999999999', '1'],
];
// [id, name, each note's own harmonics as hex digits]
export const TONES = [
  ['pure', 'Pure', 'f'],                                   // a sine
  ['flute', 'Flute', 'f521'],                              // the fundamental, a breath of the next few
  ['reed', 'Reed', 'f08050402020101'],                     // odd harmonics: hollow, like a clarinet or a shruti box's reeds
  ['strings', 'Strings', 'f854332221111111'],              // every harmonic, falling like a bowed string's
  ['organ', 'Organ', 'fc893504'],                          // drawbar registration: 8' 4' 2⅔' 2' 1⅗' 1⅓' 1'
  ['glass', 'Glass', 'a608050600030003'],                  // octaves and fifths high up: a mixture's shimmer
];
export const TARGET = .15;   // the Wash's RMS (−16.5 dBFS, measured), so the Drone level means the same loudness for both

export function levelsOf(hex = ''){
  const a = new Float32Array(H);
  for(let i = 0; i < H && i < hex.length; i++) a[i] = (parseInt(hex[i], 16) || 0) / 15;
  return a;
}
export function hexOf(a){
  let s = '';
  for(let i = 0; i < H; i++) s += Math.round(Math.max(0, Math.min(1, a[i] || 0)) * 15).toString(16);
  return s.replace(/0+$/, '') || '0';
}
export const notesPreset = hex => NOTES.find(p => p[2] === hex);
export const tonePreset = hex => TONES.find(p => p[2] === hex);

// Harmonic n's frequency over the fundamental: n itself (Pure), or the nearest piano key (Even: octaves stay exact).
export const ratioOf = (n, temp) => temp === 'even' ? Math.pow(2, Math.round(12 * Math.log2(n)) / 12) : n;
const PC = ['C','D♭','D','E♭','E','F','G♭','G','A♭','A','B♭','B'];
const ROLE = [, 'the root', 'the octave', 'the fifth', 'the root', 'a pure major 3rd', 'the fifth', 'the harmonic 7th', 'the root',
  'a pure 9th', 'a pure major 3rd', 'the 11th harmonic', 'the fifth', 'the 13th harmonic', 'the harmonic 7th', 'a pure major 7th', 'the root'];
// Harmonic n over a fundamental at midi m0 (named at A = 440): its note and octave, how far a pure one sits from the
// piano key (cents; 0 in Even), and what it is against the root.
export function harmonicInfo(n, m0, temp){
  const midi = m0 + 12 * Math.log2(n), key = Math.round(midi);
  return { name: PC[((key % 12) + 12) % 12] + (Math.floor(key / 12) - 1), cents: temp === 'even' ? 0 : Math.round((midi - key) * 100), role: ROLE[n] };
}

// A tone's waveform peaks above its levels' sum or below it; each wave is scaled to a peak of 1 here, so a browser that
// normalises PeriodicWaves anyway plays exactly what the level maths below assumes.
const peaks = new Map();
function peakOf(hex){
  if(peaks.has(hex)) return peaks.get(hex);
  const t = levelsOf(hex); let p = 0;
  for(let i = 0; i < 2048; i++){ let v = 0; for(let m = 1; m <= H; m++) if(t[m - 1]) v += t[m - 1] * Math.sin(2 * Math.PI * m * i / 2048); p = Math.max(p, Math.abs(v)); }
  peaks.set(hex, p || 1); return p || 1;
}
// The drone's RMS with every note at its level: Pure sums coinciding harmonics coherently (every note is on the root's
// series, all in phase); Even keeps that within each octave family (n = odd × 2^a, exact octaves) and adds the
// families' power, since tempered notes share no harmonics.
export function rmsOf(notesHex, toneHex, temp){
  const w = levelsOf(notesHex), k = 1 / peakOf(toneHex), t = levelsOf(toneHex).map(x => x * k);
  let s = 0;
  for(const o of temp === 'even' ? [1, 3, 5, 7, 9, 11, 13, 15] : [1]){
    const A = new Float64Array(H * H + 1);
    for(let n = 1; n <= H; n++){
      if(!w[n - 1] || (temp === 'even' && n / (n & -n) !== o)) continue;
      const base = temp === 'even' ? n / o : n;
      for(let m = 1; m <= H; m++) A[base * m] += w[n - 1] * t[m - 1];
    }
    for(let j = 1; j < A.length; j++) s += A[j] * A[j];
  }
  return Math.sqrt(s / 2);
}
const normOf = s => { const r = rmsOf(s.notes, s.tone, s.temp); return r > 1e-6 ? TARGET / r : 0; };
const waves = new WeakMap();   // per context: tone hex → PeriodicWave (sine terms, phase 0, peak 1)
function waveOf(c, hex){
  let m = waves.get(c); if(!m) waves.set(c, m = new Map());
  if(!m.has(hex)){
    const t = levelsOf(hex), k = 1 / peakOf(hex), real = new Float32Array(H + 1), imag = new Float32Array(H + 1);
    for(let i = 0; i < H; i++) imag[i + 1] = t[i] * k;
    m.set(hex, c.createPeriodicWave(real, imag, { disableNormalization: true }));
  }
  return m.get(hex);
}
const IN = Float32Array.from({ length:32 }, (_, i) => Math.sin(i / 31 * Math.PI / 2));

// A bank plays the drone on any context, live or offline: one oscillator per sounding note, carrying the tone as its
// wave, into its own gain (its level × the normalisation), into the bank's gain (start and stop), into `out`.
// spec = { notes, tone (hex), temp ('pure' | 'even') }; f = the fundamental (harmonic 1) in Hz from time t.
// Every voice keeps the phase it would have had from the bank's start (its ratio × the fundamental's phase): a note
// that joins later, or a tone's crossfade, starts exactly on one of its own cycle boundaries, so it is in phase with the
// rest and the live drone is the same signal as its offline render. A move is a frequency step on every oscillator:
// oscillators change pitch without a break in their wave, so the step lands exactly where it's scheduled.
export function makeBank(c, out, spec, f, t, fade){
  const sr = c.sampleRate; t = Math.ceil(t * sr - 1e-6) / sr;   // on a sample: an oscillator then starts exactly at phase 0
  const s = { ...spec }, g = c.createGain(), sched = [[t, f]], voices = new Map();
  let w = levelsOf(s.notes), norm = normOf(s);
  g.connect(out);
  g.gain.setValueAtTime(0, t);
  if(fade > .01) g.gain.setValueCurveAtTime(IN, t, fade); else g.gain.setValueAtTime(1, t);
  const fAt = x => { let i = 0; while(i + 1 < sched.length && sched[i + 1][0] <= x) i++; return i; };
  const phase = x => {                                     // the fundamental's cycles from t to x
    let p = 0;
    for(let i = 0; i < sched.length && sched[i][0] < x; i++) p += (Math.min(x, i + 1 < sched.length ? sched[i + 1][0] : x) - sched[i][0]) * sched[i][1];
    return p;
  };
  const align = (n, x) => {                                // the first sample at or after x where voice n starts a cycle
    const r = ratioOf(n, s.temp); x = Math.max(x, t);
    let i = fAt(x), tx = x, need = Math.ceil(r * phase(x) - 1e-9) - r * phase(x);
    for(; i < sched.length; i++){
      const fr = r * sched[i][1], end = i + 1 < sched.length ? sched[i + 1][0] : Infinity;
      if(tx + need / fr <= end) return Math.round((tx + need / fr) * sr) / sr;
      need -= (end - tx) * fr; tx = end;
    }
    return x;
  };
  const glide = (p, v, now, tau) => {
    if(p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(now); else { p.cancelScheduledValues(now); p.setValueAtTime(p.value, now); }
    p.setTargetAtTime(v, now + 1 / sr, tau);
  };
  // A voice: oscillator → x (its own fade in and out, linear ramps from explicit points) → g (its level, which glides)
  // → the bank. (A linear ramp after cancelAndHoldAtTime starts from the last plain value event, possibly long ago, so
  // fades never share a param with glides: measured, a crossfade that did dipped 16 dB before it began.)
  const voice = (n, at, level, ramp) => {
    const o = c.createOscillator(), xg = c.createGain(), vg = c.createGain(), r = ratioOf(n, s.temp), i = fAt(at);
    o.setPeriodicWave(waveOf(c, s.tone));
    // The frequency's own value, not an event at `at`: with only an event there, Chrome plays the rest of the starting
    // render block at the default 440 Hz (measured: a voice 26 samples out of phase). Start times are whole samples
    // (align, and t above): with automation, a fractional start isn't phase-corrected.
    o.frequency.value = r * sched[i][1];
    for(let j = i + 1; j < sched.length; j++) o.frequency.setValueAtTime(r * sched[j][1], sched[j][0]);
    vg.gain.value = level;
    if(ramp){ xg.gain.setValueAtTime(0, at); xg.gain.linearRampToValueAtTime(1, at + ramp); }
    o.connect(xg).connect(vg).connect(g); o.start(at);
    return { o, x: xg, g: vg, n, in: at + ramp };
  };
  const fadeOut = (v, at, d) => {
    const a = Math.max(at, v.in), p = v.x.gain;                 // (after its own fade-in, if that's still going)
    p.setValueAtTime(1, a); p.linearRampToValueAtTime(0, a + d);
    try{ v.o.stop(a + d + .02); }catch(e){}
  };
  for(let n = 1; n <= H; n++) if(w[n - 1] > 0) voices.set(n, voice(n, t, w[n - 1] * norm, 0));
  return {
    d: null,                                               // the drone it plays: { key, rate } (audio.js's droneNow)
    // A move: from `at`, the fundamental is f.
    to(fr, at){
      let i = sched.findIndex(e => Math.abs(e[0] - at) < 1e-6);
      if(i >= 0) sched[i][1] = fr; else { sched.push([at, fr]); sched.sort((a, b) => a[0] - b[0]); }
      for(const v of voices.values()) v.o.frequency.setValueAtTime(ratioOf(v.n, s.temp) * fr, at);
    },
    // New note levels: each voice glides; a note joining starts on its own cycle boundary; a note leaving fades out.
    notes(hex){
      const now = c.currentTime; s.notes = hex; w = levelsOf(hex); norm = normOf(s);
      for(let n = 1; n <= H; n++){
        const v = voices.get(n), L = w[n - 1] * norm;
        if(L > 0 && !v) voices.set(n, voice(n, align(n, now + .03), L, .06));
        else if(!(L > 0) && v){ fadeOut(v, now, .06); voices.delete(n); }
        else if(v) glide(v.g.gain, L, now, .03);
      }
    },
    // A new tone: each voice crossfades (60 ms) to a twin carrying the new wave, started on the voice's own cycle
    // boundary, so old and new are in phase and the fade is a morph rather than two waves beating.
    tone(hex){
      const now = c.currentTime; s.tone = hex; norm = normOf(s);
      for(const [n, v] of [...voices]){ const at = align(n, now + .03); voices.set(n, voice(n, at, w[n - 1] * norm, .06)); fadeOut(v, at, .06); }
    },
    stop(at, d){                                           // a glide down from wherever it is (as audio.js's fadeTo)
      const p = g.gain;
      if(p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(at); else { p.cancelScheduledValues(at); p.setValueAtTime(p.value, at); }
      try{ p.setTargetAtTime(0, at + 1 / sr, Math.max(d, .02) / 3); }catch(e){}
      for(const v of voices.values()) try{ v.o.stop(at + 2 * d + .05); }catch(e){}   // by then the glide is at −52 dB
      voices.clear();
      setTimeout(() => { try{ g.disconnect(); }catch(e){} }, (at - (c.currentTime || 0) + 2 * d + .5) * 1000);
    },
  };
}

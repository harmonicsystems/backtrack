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

// ---- voicings: one entry per voice, { n: which harmonic of the chord it plays, hz }; voice 0 is the bass ----
export function homeVoicing(notesHex, temp, f){
  const w = levelsOf(notesHex), v = [];
  for(let n = 1; n <= H; n++) if(w[n - 1] > 0) v.push({ n, hz: ratioOf(n, temp) * f });
  return v;
}
const cents = (a, b) => 1200 * Math.abs(Math.log2(a / b));
// Voice leading, for a chord moving to a new root f: the bass takes the new root; every other voice moves to the
// nearest note of the new chord, with the chord kept whole (each upper note once, tried in every rotation: every
// inversion), so common tones stay and the rest step. Each voice stays within a window around its home register
// (home: the voicing at home), so a long progression can't drift, and above the bass. Every note is still the new
// root's own harmonic, octave-shifted, so in Pure the chord is still one series and nothing beats. Pure function.
export function leadVoicing(prev, notesHex, temp, f, home){
  const w = levelsOf(notesHex), ns = [];
  for(let n = 1; n <= H; n++) if(w[n - 1] > 0) ns.push(n);
  if(!ns.length || prev.length !== ns.length) return homeVoicing(notesHex, temp, f);
  const bass = { n: ns[0], hz: ratioOf(ns[0], temp) * f }, up = ns.slice(1);
  if(!up.length) return [bass];
  const pu = prev.slice(1).map((v, i) => ({ hz: v.hz, i: i + 1 })).sort((a, b) => a.hz - b.hz);
  const hu = home.slice(1).map(v => v.hz), lo = Math.min(...hu) * Math.pow(2, -7 / 12), hi = Math.max(...hu) * Math.pow(2, 7 / 12);
  const cls = n => ((1200 * Math.log2(ratioOf(n, temp))) % 1200 + 1200) % 1200;
  const U = [...up].sort((a, b) => cls(a) - cls(b) || a - b);
  const place = (n, near) => {                             // the octave of note n nearest `near`, in the window, above the bass
    const base = ratioOf(n, temp) * f; let best = null;
    for(let k = -6; k <= 6; k++){
      const hz = base * Math.pow(2, k); if(hz <= bass.hz * 1.001) continue;
      const c = cents(hz, near) + (hz >= lo * .999 && hz <= hi * 1.001 ? 0 : 2400 + Math.min(cents(hz, lo), cents(hz, hi)));
      if(!best || c < best.c) best = { hz, c };
    }
    return best;
  };
  let pick = null;
  for(let r = 0; r < U.length; r++){
    let cost = 0; const out = pu.map((v, j) => { const n = U[(j + r) % U.length], p = place(n, v.hz); cost += p.c; return { i: v.i, n, hz: p.hz }; });
    const hz = out.map(o => o.hz).sort((a, b) => a - b);
    for(let j = 1; j < hz.length; j++) if(cents(hz[j], hz[j - 1]) < 1) cost += 4800;   // two voices on one note
    if(!pick || cost < pick.cost - 1e-6) pick = { cost, out };
  }
  const next = [bass];
  for(const o of pick.out) next[o.i] = { n: o.n, hz: o.hz };
  return next;
}

// A bank plays the drone on any context, live or offline: one oscillator per voice, carrying the tone as its wave,
// into its own crossfade gain, its level gain (its harmonic's level × the normalisation) and the bank's gain (start and
// stop), into `out`. spec = { notes, tone (hex), temp }; voicing = homeVoicing / leadVoicing's list, from time t.
// Each voice keeps a schedule of [time, hz, n]: a move (set) steps every oscillator's frequency on the bar line, which
// an oscillator does without a break in its wave, and steps its level if it now plays another harmonic. A tone change or
// a new chord (morph) starts each replacement on its predecessor's cycle boundary, so the two are in phase and the
// 60 ms crossfade is a morph; a voice with no predecessor fades in. Live and offline are the same signal.
export function makeBank(c, out, spec, voicing, t, fade){
  const sr = c.sampleRate; t = Math.ceil(t * sr - 1e-6) / sr;   // on a sample: an oscillator then starts exactly at phase 0
  const s = { ...spec }, g = c.createGain();
  let w = levelsOf(s.notes), norm = normOf(s), voices = [];
  g.connect(out);
  g.gain.setValueAtTime(0, t);
  if(fade > .01) g.gain.setValueCurveAtTime(IN, t, fade); else g.gain.setValueAtTime(1, t);
  const idx = (S, x) => { let i = 0; while(i + 1 < S.length && S[i + 1][0] <= x) i++; return i; };
  const phase = (v, x) => {                                // voice v's cycles from its start to x
    let p = 0; const S = v.sched;
    for(let i = 0; i < S.length && S[i][0] < x; i++) p += (Math.min(x, i + 1 < S.length ? S[i + 1][0] : x) - S[i][0]) * S[i][1];
    return p;
  };
  const align = (v, x) => {                                // the first sample at or after x where voice v starts a cycle
    x = Math.max(x, v.t0);
    let i = idx(v.sched, x), tx = x, need = Math.ceil(phase(v, x) - 1e-9) - phase(v, x);
    for(; i < v.sched.length; i++){
      const fr = v.sched[i][1], end = i + 1 < v.sched.length ? v.sched[i + 1][0] : Infinity;
      if(tx + need / fr <= end) return Math.round((tx + need / fr) * sr) / sr;
      need -= (end - tx) * fr; tx = end;
    }
    return x;
  };
  const level = n => (w[n - 1] || 0) * norm;
  const glide = (p, v, now, tau) => {
    if(p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(now); else { p.cancelScheduledValues(now); p.setValueAtTime(p.value, now); }
    p.setTargetAtTime(v, now + 1 / sr, tau);
  };
  // A voice: oscillator → x (its own fade in and out, linear ramps from explicit points) → g (its level) → the bank.
  // The frequency's own value, not an event at `at`: with only an event there, Chrome plays the rest of the starting
  // render block at the default 440 Hz (measured: a voice 26 samples out of phase). Start times are whole samples
  // (align, and t above): with automation, a fractional start isn't phase-corrected. (A linear ramp after
  // cancelAndHoldAtTime starts from the last plain value event, so fades never share a param with glides.)
  const voice = (sched, at, ramp, now) => {               // now: { hz, n } to play from `at` (else the schedule's own)
    const o = c.createOscillator(), xg = c.createGain(), vg = c.createGain(), i = idx(sched, at);
    const own = [now ? [at, now.hz, now.n] : [at, sched[i][1], sched[i][2]], ...sched.slice(i + 1).map(e => [...e])];
    o.setPeriodicWave(waveOf(c, s.tone));
    o.frequency.value = own[0][1]; vg.gain.value = level(own[0][2]);
    for(const [tt, hz, n] of own.slice(1)){ o.frequency.setValueAtTime(hz, tt); vg.gain.setTargetAtTime(level(n), tt, .004); }
    if(ramp){ xg.gain.setValueAtTime(0, at); xg.gain.linearRampToValueAtTime(1, at + ramp); }
    o.connect(xg).connect(vg).connect(g); o.start(at);
    return { o, x: xg, g: vg, sched: own, t0: at, in: at + ramp };
  };
  const fadeOut = (v, at, d) => {
    const a = Math.max(at, v.in), p = v.x.gain;                 // (after its own fade-in, if that's still going)
    p.setValueAtTime(1, a); p.linearRampToValueAtTime(0, a + d);
    try{ v.o.stop(a + d + .02); }catch(e){}
  };
  const nAt = (v, x) => v.sched[idx(v.sched, x)][2], hzAt = (v, x) => v.sched[idx(v.sched, x)][1];
  voices = voicing.map(nv => voice([[t, nv.hz, nv.n]], t, 0));
  return {
    d: null,                                               // the drone it plays: { key, rate } (audio.js's droneNow)
    // The harmonics that sound (a new set needs morph; new levels of the same set just glide).
    ns: () => voicing.map(v => v.n).join(','),
    // The voicing at time x (each voice's harmonic and pitch).
    at: x => voices.map(v => ({ n: nAt(v, x), hz: hzAt(v, x) })),
    // A move: from `at`, voice k plays voicing[k].
    set(vc, at){
      vc.forEach((nv, k) => {
        const v = voices[k]; if(!v) return;
        const S = v.sched, j = S.findIndex(e => Math.abs(e[0] - at) < 1e-6);
        if(j >= 0) S[j] = [at, nv.hz, nv.n]; else { S.push([at, nv.hz, nv.n]); S.sort((a, b) => a[0] - b[0]); }
        v.o.frequency.setValueAtTime(nv.hz, at); v.g.gain.setTargetAtTime(level(nv.n), at, .004);
      });
    },
    // New levels for the same harmonics: each voice glides (moves already scheduled are issued again by the caller).
    levels(hex){
      const now = c.currentTime; s.notes = hex; w = levelsOf(hex); norm = normOf(s);
      for(const v of voices) glide(v.g.gain, level(nAt(v, now)), now, .03);
    },
    // A new tone, or new notes (vc: the voicing to play now): each new voice that plays a pitch an old one plays starts on
    // that one's cycle boundary and takes over in 60 ms; old voices with no successor fade out, new ones fade in.
    morph(spec2, vc){
      const now = c.currentTime, old = voices, used = new Set();
      Object.assign(s, spec2); w = levelsOf(s.notes); norm = normOf(s); voicing = vc;
      voices = vc.map(nv => {
        const twin = old.find(v => !used.has(v) && cents(hzAt(v, now + .03), nv.hz) < .5);
        if(twin){ used.add(twin); const at = align(twin, now + .03), nw = voice(twin.sched, at, .06, nv); fadeOut(twin, at, .06); return nw; }
        return voice([[now + .03, nv.hz, nv.n]], now + .03, .06);
      });
      for(const v of old) if(!used.has(v)) fadeOut(v, now + .03, .06);
    },
    stop(at, d){                                           // a glide down from wherever it is (as audio.js's fadeTo)
      const p = g.gain;
      if(p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(at); else { p.cancelScheduledValues(at); p.setValueAtTime(p.value, at); }
      try{ p.setTargetAtTime(0, at + 1 / sr, Math.max(d, .02) / 3); }catch(e){}
      for(const v of voices) try{ v.o.stop(at + 2 * d + .05); }catch(e){}   // by then the glide is at −52 dB
      voices = [];
      setTimeout(() => { try{ g.disconnect(); }catch(e){} }, (at - (c.currentTime || 0) + 2 * d + .5) * 1000);
    },
  };
}

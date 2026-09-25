// Tune mode's ears. mpm() finds the pitch of one analyser frame with the McLeod pitch method (McLeod & Wyvill 2005,
// "A smarter way to find pitch"); createTracker() turns one such frame per display frame into what to draw. The
// phone's own drone and drums reach the mic through the speaker, so the tracker gates on a learned noise floor and
// makes new notes prove themselves before they're drawn. Pure: no DOM, no Web Audio, so node runs it as-is.

// ---- the detector ----
// At the drone's root or an octave or two below it, within a quarter tone: where the Wash's own leak reads. The Wash
// is a harmonic series on the octave below its root (strongest there), so that's where it mostly reads.
const droneLike = (f, droneHz) => { const e = 12 * Math.log2(f / droneHz); return e < .5 && Math.abs(e - 12 * Math.round(e / 12)) < .5; };
const plans = new Map();                                            // per FFT size: bit reversal, twiddles, scratch
function plan(N){
  let p = plans.get(N); if(p) return p;
  const bits = Math.log2(N), rev = new Uint32Array(N), cos = new Float64Array(N / 2), sin = new Float64Array(N / 2);
  for(let i = 0; i < N; i++) for(let b = 0; b < bits; b++) rev[i] |= (i >> b & 1) << (bits - 1 - b);
  for(let i = 0; i < N / 2; i++){ cos[i] = Math.cos(2 * Math.PI * i / N); sin[i] = -Math.sin(2 * Math.PI * i / N); }
  p = { N, rev, cos, sin, re: new Float64Array(N), im: new Float64Array(N), nsdf: new Float64Array(N / 2 + 2), keys: new Int32Array(N / 2) };
  plans.set(N, p); return p;
}
function fft(p, re, im){                                            // in place, iterative radix-2, forward
  const { N, rev, cos, sin } = p;
  for(let i = 0; i < N; i++){ const j = rev[i]; if(j > i){ let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for(let size = 2; size <= N; size <<= 1){
    const half = size >> 1, step = N / size;
    for(let s = 0; s < N; s += size) for(let k = 0; k < half; k++){
      const a = s + k, b = a + half, wr = cos[k * step], wi = sin[k * step];
      const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
    }
  }
}

// One frame x (2048 samples at 44.1/48 kHz reaches ~50 Hz) → { freq, clarity }, or null when nothing periodic sits in
// [fmin, fmax]. clarity is the NSDF peak: ~1 for a steady tone, ≤ .35 for white or pink noise. droneHz, the drone's
// root: peaks there or octaves below (the drone leaking in) can't set the bar, so a quieter voice above it still wins
// (plain MPM reads the drone's octave-down pitch once the drone is within ~6 dB of the voice).
export function mpm(x, sr, { fmin = 50, fmax = 1600, k = .9, droneHz = 0, nsdfOut = null } = {}){
  const W = x.length, tMax = Math.min(W >> 1, Math.ceil(sr / fmin)) + 1, tMin = Math.floor(sr / fmax);
  let N = 1; while(N < W + tMax) N <<= 1;                          // zero-padded to W + τmax: no circular wrap in the lags we read
  const p = plan(N), { re, im, keys } = p, n = nsdfOut || p.nsdf;
  let mean = 0; for(let i = 0; i < W; i++) mean += x[i]; mean /= W;    // DC would keep the NSDF from ever going negative
  let m = 0; for(let i = 0; i < W; i++){ const v = x[i] - mean; re[i] = v; m += 2 * v * v; }   // m'(0) = 2·Σx²
  if(m < 1e-12) return null;
  re.fill(0, W); im.fill(0);
  fft(p, re, im);                                                   // autocorrelation r'(τ) = IFFT(|X|²), every lag at once
  for(let i = 0; i < N; i++){ re[i] = re[i] * re[i] + im[i] * im[i]; im[i] = 0; }
  fft(p, re, im);                                                   // |X|² is real and even, so FFT = N·IFFT
  for(let t = 0; t <= tMax; t++){
    if(t > 0){ const a = x[t - 1] - mean, b = x[W - t] - mean; m -= a * a + b * b; }   // m'(τ) = Σ x_j² + x_{j+τ}², one lag at a time
    n[t] = m > 0 ? 2 * re[t] / N / m : 0;                           // NSDF n(τ) = 2r'(τ)/m'(τ), in [−1, 1]
  }
  // key maxima: the top of each positive lobe after the first negative-going zero crossing
  let nk = 0, t = 1, best = -1;
  while(t < tMax && n[t] > 0) t++;                                  // skip the lobe around τ = 0
  for(; t < tMax; t++){
    if(n[t] > 0 && (best < 0 || n[t] > n[best])) best = t;
    if(best >= 0 && n[t + 1] <= 0){ keys[nk++] = best; best = -1; }
  }
  if(best >= 0 && best < tMax - 1) keys[nk++] = best;               // a lobe cut off at τmax counts only if it peaked inside
  if(!nk) return null;
  let top = 0, topND = 0;
  for(let i = 0; i < nk; i++){
    const v = n[keys[i]]; top = Math.max(top, v);
    if(!droneHz || !droneLike(sr / keys[i], droneHz)) topND = Math.max(topND, v);
  }
  if(topND >= .6) top = topND;
  let c = 0; for(let i = 0; i < nk; i++) if(n[keys[i]] >= k * top){ c = keys[i]; break; }   // the first key maximum within k of the best
  // Singing the drone's root, the voice's own peak is itself drone-like, and the drone's period (twice the lag) wins:
  // a drone-like pick gives way to any earlier peak that is strongly periodic on its own.
  if(droneHz && droneLike(sr / c, droneHz)) for(let i = 0; i < nk && keys[i] < c; i++) if(n[keys[i]] >= .8){ c = keys[i]; break; }
  if(c < tMin) return null;                                         // above fmax
  const a = n[c - 1], b = n[c], d = n[c + 1], den = a - 2 * b + d, delta = den ? .5 * (a - d) / den : 0;   // parabola through the peak
  return { freq: sr / (c + delta), clarity: b - .25 * (a - d) * delta };
}

// ---- the tracker ----
const HOLD = .5, DIM = .1, LEARN = 2;                               // s: clear after, dim/break the line after, quick floor learning
const sorted = new Float64Array(5);
function median(h, from){                                           // of h[from…] (≤ 5 values), without allocating
  let n = 0;
  for(let i = from; i < h.length; i++){ const v = h[i]; let j = n++; while(j && sorted[j - 1] > v){ sorted[j] = sorted[j - 1]; j--; } sorted[j] = v; }
  return n & 1 ? sorted[n >> 1] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}
const octaveShaped = j => Math.abs(j - 12) < .5 || Math.abs(j - 24) < .5;

// push(x, sr, t, { a4, droneHz }) once per display frame with the analyser's latest frame; t = ctx.currentTime, and a
// push < 10 ms after the last is ignored. droneHz = the root the drone really plays (FREQ[key]·a4/440 when retuned), 0
// with no drone. relearn() whenever what the speaker plays changes (drone volume, key, drums); reset() at the start and
// after an outside pause. Pitch is kept as midi on the A440 grid and moved to the a4 grid in read(), so changing A4
// never disturbs the history. read(now), now in seconds on any clock, always returns
// { line, midi, note, cents, fresh, held, level }:
//   line   the scrolling trace (median 3, τ 20 ms); null once the gate has been shut > 100 ms, so the drawn line breaks
//   midi   the readout (median 5, τ 60 ms, jumps straight to a confirmed new note); note = the shown note (hysteresis),
//          cents = 100·(midi − note), within ±50. All null after 0.5 s without a voiced frame.
//   fresh  a new voiced frame was accepted since the last read; held = none for > 100 ms (dim the readout)
//   level  0..1 for the "I hear you" disc, measured above the learned floor so the drone's own leak doesn't light it
//          (in a quiet room that is the plain −60…−10 dBFS scale); reported voiced or not.
export function createTracker(){
  let lastT, db, floor, open, onDrone, learnAt, lastLoud, rested, learnUntil, hist, pend, pendN, pendT, lastGood, snap, fresh, A4, readAt, value, lineV, note, lvl;
  const qb = new Float64Array(20); let qi, qT;                      // the quietest level per half second, over the last 10 s
  function reset(){                                                 // the floor is unknown at the start and the drone is fading in: learn it quickly
    lastT = floor = lastGood = readAt = value = lineV = note = null; db = -120; open = onDrone = snap = fresh = false; qb.fill(Infinity); qi = 0; qT = -1e9;
    learnAt = true; learnUntil = lastLoud = -1; rested = false; hist = []; pend = pendN = 0; A4 = 440; lvl = 0;
  }
  reset();
  return {
    reset,
    relearn(){ learnAt = true; },                                   // after a drone volume, key or drums change
    push(x, sr, t, { a4 = 440, droneHz = 0 } = {}){
      if(lastT != null && t >= lastT && t - lastT < .01) return;     // the context isn't running: the analyser repeats its last frame
      const dt = lastT == null || t < lastT ? 0 : Math.min(t - lastT, .25); lastT = t; A4 = a4;
      let s = 0; for(let i = 0; i < x.length; i++) s += x[i] * x[i];
      if(floor == null && s === 0) return;                          // a just-connected analyser's first frames: nothing heard yet
      db = 10 * Math.log10(s / x.length + 1e-12);
      if(learnAt){ learnUntil = t + LEARN; learnAt = false; }
      // The floor is the level with nobody singing: the room, the mic, the drone and drums leaking in. It falls at once;
      // it rises ≤ 1 dB/s (20 just after a change) only while the gate is shut, so a held note can't raise it — or while
      // it shows the octave below the drone's root (where the Wash reads, and hardly anyone sings), so a drone turned up
      // without relearn() (the phone's volume buttons) still clears. A held root keeps its line.
      const learning = t < learnUntil;
      if(t - qT >= .5){ qT = t; qi = (qi + 1) % qb.length; qb[qi] = Infinity; }
      qb[qi] = Math.min(qb[qi], db); let quiet = Infinity; for(let i = 0; i < qb.length; i++) quiet = Math.min(quiet, qb[i]);
      // Someone singing softly (under the gate) mustn't raise the floor under themselves: it crept 1 dB/s, and a soft
      // start then locked the singer out until a pause. So, outside the quick re-learning after a change, the floor
      // creeps no higher than 1 dB over the quietest the last 10 s have been (the room and drone before you sang).
      if(floor == null) floor = db;
      else if(onDrone) floor = Math.min(db, floor + (learning ? 20 : 1) * dt);
      else if(!open) floor = Math.min(db, Math.max(Math.min(floor, db), Math.min(floor + (learning ? 20 : 1) * dt, learning ? Infinity : quiet + 1)));
      const loud = db >= Math.max(-60, floor + (open ? 8 : 12));
      const r = loud ? mpm(x, sr, { fmin:53, droneHz }) : null;     // from A1 (55 Hz) less a quarter tone: the app's kicks read 46–52 Hz
      if(loud){ if(t - lastLoud > DIM) rested = true; lastLoud = t; }   // after a breath (> 100 ms under the gate) a new note isn't a leap
      const drone = !!r && droneHz > 0 && droneLike(r.freq, droneHz);
      // A pitch on the drone itself could be the drone: it needs the full opening margin in every frame (a note's fading
      // tail otherwise hands the line to the drone). While learning it keeps the gate shut and *is* the floor: a drone
      // fading in (every start) or turned up rises faster than any floor may follow. Measured: without this, every
      // start showed the Wash's low root for ~1.5 s, and the ends of notes over the C drone flipped to C2.
      // Below the drone's root (where the Wash itself reads, and hardly anyone sings) it needs 18 dB: the phone's own
      // volume buttons can turn the drone up without a relearn(), and the floor may only creep there.
      open = !!r && r.clarity >= (open ? .8 : .85) && !(drone && (learning || db < floor + (r.freq < droneHz * .75 ? 18 : 12)));
      if(drone && learning) floor = db;
      onDrone = open && drone && r.freq < droneHz * .75;
      if(!open){ pendN = 0; if(lastGood != null && t - lastGood > HOLD){ hist.length = 0; lastGood = null; } return; }
      const m = 69 + 12 * Math.log2(r.freq / 440), med = hist.length ? median(hist, 0) : null;
      if(med == null || Math.abs(m - med) > .8){                    // a new note (or the first): wait for agreeing frames
        const leap = med == null || rested ? 0 : Math.abs(m - med), low = r.freq < 62;
        // A kick blurs a held note (the gate stays loud but shuts on clarity), then reads as the note's subharmonic nearest
        // the kick (~55 Hz, every time in the tests): nothing leaps into that register mid-phrase, and a note starting
        // there must outlast a kick (150 ms). Octave leaps and the drone's pitch are the classic misreads: 4 frames.
        if(leap && low){ pendN = 0; return; }
        const need = drone || low || octaveShaped(leap) ? 4 : 2;
        if(pendN && Math.abs(m - pend) < .5) pendN++; else { pendN = 1; pendT = t; }
        pend = m;
        if(pendN < need || low && t - pendT < .15) return;          // until then the old note stays up
        hist.length = 0; snap = true;                               // confirmed: restart the medians and jump, no glide through notes in between
      }
      pendN = 0; rested = false; hist.push(m); if(hist.length > 5) hist.shift();
      lastGood = t; fresh = true;
    },
    read(now){
      const dt = readAt == null ? 1 : now - readAt; readAt = now;
      const k = tau => dt > .25 || dt < 0 ? 1 : 1 - Math.exp(-dt / tau);   // time-based, so 30 fps (Low Power) settles like 60
      const lo = Math.max(-60, (floor ?? -120) + 3), hi = Math.max(-10, lo + 12), L = Math.min(1, Math.max(0, (db - lo) / (hi - lo)));
      lvl += (L - lvl) * k(L > lvl ? .05 : .2);
      const out = { line:null, midi:null, note:null, cents:null, fresh, held:true, level:lvl }; fresh = false;
      if(lastGood == null || lastT - lastGood > HOLD){ value = lineV = note = null; return out; }
      const off = 12 * Math.log2(A4 / 440), target = median(hist, 0) - off, lt = median(hist, Math.max(0, hist.length - 3)) - off;
      if(snap || value == null){ value = target; lineV = lt; snap = false; }
      else { value += (target - value) * k(.06); lineV += (lt - lineV) * k(.02); }
      if(note == null || Math.abs(value - note) > .65) note = Math.round(value);   // a note name doesn't flicker at the quarter tone
      const quiet = lastT - lastGood;
      out.midi = value; out.note = note; out.cents = Math.max(-50, Math.min(50, 100 * (value - note)));
      out.held = quiet > DIM; out.line = quiet > DIM ? null : lineV;
      return out;
    }
  };
}

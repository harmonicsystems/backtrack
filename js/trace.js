// Tune mode's pitch line. One model holds the last few seconds of your pitch, the key's guide lines and the octave
// window (which can follow your voice); any number of canvas views draw it — the strip under the circle and the
// full-screen trace show the same data, so turning the phone never loses a note. Pitch is midi on the A4 grid
// (69 = A4, fractions are cents/100), and the window is linear in cents. Nothing allocates per frame: history is a
// ring buffer, and a draw only reads it (reusing one gradient and the labels' own strings).
const RM = matchMedia('(prefers-reduced-motion: reduce)');
const ease = t => .5 - .5 * Math.cos(Math.PI * t);
const mod12 = n => ((n % 12) + 12) % 12;
const LO = 3, HI = 15, SPAN = LO + HI;           // the window: base − 3 … base + 15 semitones (300 ¢ below the root to 300 ¢ above its octave)
const PAN = .6, PAN_GAP = 2, OUT = 1;            // follow my voice: 1 s beyond the window pans one octave, eased over .6 s, at most every 2 s
const REST = .7, PHRASE = 12, FADE = 1.2;        // a phrase ends after .7 s of silence (reduced motion keeps its last 12 s); the pen fades over 1.2 s

export function createPitchModel({ seconds = 16 } = {}){
  const N = Math.ceil(seconds * 128);            // room for 128 frames a second, so a 120 Hz display still keeps `seconds`
  const deg = new Array(12).fill(null), near = { kind:'', label:'', cents:0, midi:0 };
  let oct = null, outDir = 0, outSince = 0, pStart = 0, pOpen = false;
  const m = {
    N, T: new Float64Array(N), M: new Float32Array(N),      // time (s) and midi per frame; NaN = no voice, which breaks the line
    PT: new Float64Array(N), PM: new Float32Array(N), pn: 0, p0: 0, p1: 0,   // the last finished phrase, copied out of the ring
    head: 0, count: 0, root: 57, base: 57, from: 57, panT: -1e9, follow: false, lastV: -1e9, lastM: NaN,
    push(t, midi){
      const v = midi == null ? NaN : +midi;
      m.T[m.head] = t; m.M[m.head] = v; m.head = (m.head + 1) % N; if(m.count < N) m.count++;
      if(v !== v){                                            // silence: a pan needs sustained voice, and .7 s of it closes the phrase
        outDir = 0;
        if(pOpen && t - m.lastV >= REST){ pOpen = false; keepPhrase(); }
        return;
      }
      if(!pOpen){ pOpen = true; pStart = t; }
      m.lastV = t; m.lastM = v;
      if(!m.follow) return;                                  // fixed registers never pan
      const dir = v > m.base + HI ? 1 : v < m.base - LO ? -1 : 0;
      if(dir !== outDir){ outDir = dir; outSince = t; return; }
      if(dir && t - outSince >= OUT && t - m.panT >= PAN_GAP && Math.abs(m.base + 12 * dir - m.root) <= 24){   // (two octaves covers the detector's range)
        m.from = RM.matches ? m.base + 12 * dir : m.baseAt(t); m.base += 12 * dir; m.panT = outSince = t;
      }
    },
    // root: integer midi of the root line; degrees: [{ semi 0–12, kind 'root'|'fifth'|'octave'|'scale', label }]
    setGuides({ root = m.root, degrees = [], follow = false } = {}){
      deg.fill(null); oct = null;
      for(const d of degrees) if(d.semi === 12) oct = d; else deg[mod12(d.semi)] = d;
      if(!deg[0] && oct) deg[0] = oct;
      const base = root + (follow ? m.base - m.root : 0);   // following keeps the octave it panned to; a fixed register sits on its root
      m.root = root; m.follow = !!follow;
      if(base !== m.base) m.base = m.from = base;
    },
    clear(){ m.head = m.count = m.pn = 0; m.base = m.from = m.root; m.panT = m.lastV = -1e9; m.lastM = NaN; outDir = 0; pOpen = false; },
    baseAt(now){ const u = Math.min(1, Math.max(0, (now - m.panT) / PAN)); return m.from + (m.base - m.from) * ease(u); },
    // The guide degree drawn at midi L, or null. Pitch class 0 is the root line, except base + 12, the octave line.
    lineDeg(L){ return L === m.base + 12 && oct ? oct : deg[mod12(L - m.root)]; },
    // Nearest guide line to pitch v, written into `out` (reused, so a frame loop allocates nothing); null when there are no lines.
    nearest(v, out = near){
      let best = 1e9, bl = 0; const k0 = Math.floor((v - m.root) / 12);
      for(let k = k0 - 1; k <= k0 + 1; k++) for(let s = 0; s < 12; s++){
        const L = m.root + 12 * k + s, e = Math.abs(v - L);
        if(deg[s] && e < best){ best = e; bl = L; }
      }
      if(best === 1e9) return null;
      const d = m.lineDeg(bl); out.kind = d.kind; out.label = d.label; out.cents = (v - bl) * 100; out.midi = bl;
      return out;
    },
    // The line the latest pitch is within ±50 ¢ of: { kind, label, cents (+ = above), midi }; null in silence.
    // The object is reused on every call: copy it to keep it.
    closeness(){
      const v = m.count ? m.M[(m.head - 1 + N) % N] : NaN;
      if(v !== v) return null;
      const n = m.nearest(v);
      return n && Math.abs(n.cents) <= 50 ? n : null;
    },
  };
  // Copy the phrase that just ended (at most its last 12 s) out of the ring, so reduced motion can show it still.
  function keepPhrase(){
    const a = Math.max(pStart, m.lastV - PHRASE); let i = m.head, k = 0;
    while(k < m.count && m.T[(i - 1 + N) % N] >= a){ i = (i - 1 + N) % N; k++; }
    m.pn = 0;
    for(let j = 0; j < k; j++){ const q = (i + j) % N; if(m.T[q] > m.lastV) break; m.PT[m.pn] = m.T[q]; m.PM[m.pn++] = m.M[q]; }
    m.p0 = a; m.p1 = m.lastV;
  }
  return m;
}

// A canvas view of a model. big = the full-screen trace (wider gutter, larger type and pen).
export function createTraceView(canvas, model, { big = false } = {}){
  const g = canvas.getContext('2d'), md = model, nr = { kind:'', label:'', cents:0, midi:0 };
  const gut = big ? 48 : 32, fs = big ? 14 : 11, lw = big ? 3.5 : 2.5, pr = big ? 7 : 5, hr = big ? 14 : 10, ch = big ? 13 : 10;
  const C = { primary:'#326AB2', border:'#E2E3E4', muted:'#62676E' };
  let w = 0, h = 0, dpr = 1, fade = null, font = '';
  const at = { top:0, sc:1, now:-1, sec:8 };      // per-frame numbers live on an object: a double written to a closure variable is boxed every frame
  const yOf = v => (at.top - v) * at.sc;
  const redraw = () => { if(at.now >= 0) draw(at.now, { seconds: at.sec }); };

  // The line's stroke is a gradient, clear at the left edge and solid from a quarter of the way in: the oldest quarter
  // fades out. (Erasing with destination-out looks the same but costs far more to raster, as do dashed strokes.)
  function paint(){
    const c = C.primary; fade = g.createLinearGradient(0, 0, Math.max(1, (w - gut - 8) * .25), 0);
    fade.addColorStop(0, /^#[0-9a-f]{6}$/i.test(c) ? c + '00' : 'rgba(0,0,0,0)'); fade.addColorStop(1, c);
  }
  // Size from clientWidth/Height, not getBoundingClientRect: in night mode #app is turned 90°, and its bounding box is swapped.
  function resize(){
    const d = Math.min(3, devicePixelRatio || 1), W = Math.round(canvas.clientWidth * d), H = Math.round(canvas.clientHeight * d);
    const changed = W !== canvas.width || H !== canvas.height || d !== dpr;
    w = canvas.clientWidth; h = canvas.clientHeight; dpr = d;
    if(W !== canvas.width || H !== canvas.height){ canvas.width = W; canvas.height = H; }   // (this clears the canvas and its state)
    paint(); g.font = font;
    if(changed) redraw();
  }
  // Canvas can't read var() or color-mix(), so take the plain tokens and apply alpha with globalAlpha.
  function theme(){
    const cs = getComputedStyle(document.documentElement), v = (n, d) => cs.getPropertyValue(n).trim() || d;
    C.primary = v('--primary', C.primary); C.border = v('--border-color', C.border); C.muted = v('--text-muted', C.muted);
    font = fs + 'px ' + v('--font-mono', "'IBM Plex Mono',monospace"); g.font = font;
    paint(); redraw();
  }
  // A guide line on whole device pixels, so thin lines stay crisp. Dashes [2,4] are drawn as rects.
  function line(y, l, a, color, dash){
    g.globalAlpha = a; g.beginPath();
    if(dash){ const t = Math.round((y - .5) * dpr) / dpr; for(let x = 0; x < w - gut; x += 6) g.rect(x, t, 2, 1); g.fillStyle = color; g.fill(); return; }
    const s = (Math.round(y * dpr) + (Math.round(l * dpr) & 1 ? .5 : 0)) / dpr;
    g.moveTo(0, s); g.lineTo(w - gut, s); g.lineWidth = l; g.strokeStyle = color; g.stroke();
  }
  function draw(now, { seconds = 8 } = {}){
    at.now = now; at.sec = seconds;
    if(!w || !h) return;
    const N = md.N, T = md.T, M = md.M, n = md.count, i0 = (md.head - 1 + N) % N, px = w - gut - 8;
    const cur = n ? M[i0] : NaN, live = cur === cur, pv = live ? cur : md.lastM;
    const pa = live ? 1 : pv === pv ? Math.max(0, 1 - (now - md.lastV) / FADE) : 0;   // the pen: solid while voiced, then hollow and fading
    const top = at.top = md.baseAt(now) + HI, sc = at.sc = h / SPAN, lo = Math.ceil(top - SPAN), hi = Math.floor(top);
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    // 1. the guide lines, labelled in the gutter (scale tones only where a semitone is taller than the type). The line
    //    nearest the pen brightens as you approach it: closeness shows as brightness, never as a colour.
    const near = pa > 0 ? md.nearest(pv, nr) : null, nl = near ? near.midi : NaN, f = near ? Math.max(0, 1 - Math.abs(near.cents) / 50) * pa : 0;
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for(let L = lo; L <= hi; L++){
      const d = md.lineDeg(L); if(!d) continue;
      const y = yOf(L), b = L === nl ? .35 * f : 0, scale = d.kind === 'scale';
      if(scale){ line(y, 1, 1, C.border, true); if(b) line(y, 1, b, C.primary, true); }
      else if(d.kind === 'root' && L !== md.base + 12) line(y, 2, .45 + b, C.primary, false);
      else line(y, 1.5, .3 + b, C.primary, false);
      if(d.label && y >= fs / 2 && y <= h - fs / 2 && (!scale || sc >= fs + 2)){ g.globalAlpha = scale ? .7 : 1; g.fillStyle = C.muted; g.fillText(d.label, w - 4, y); }
    }
    // 2. your line, scrolling left from the pen; off-window stretches just run off the canvas (clipped)
    g.globalAlpha = 1; g.lineWidth = lw; g.lineJoin = g.lineCap = 'round'; g.beginPath();
    if(!RM.matches){
      const pps = px / seconds, tl = now - seconds; let up = true;
      if(live){ g.moveTo(px, yOf(cur)); up = false; }
      for(let k = 0; k < n; k++){
        const i = (i0 - k + N) % N, v = M[i];
        if(v !== v) up = true;
        else if(up){ g.moveTo(px - (now - T[i]) * pps, yOf(v)); up = false; }
        else g.lineTo(px - (now - T[i]) * pps, yOf(v));
        if(T[i] < tl) break;                                 // one sample past the left edge, so the line runs off it
      }
      g.strokeStyle = fade; g.stroke();
    } else if(md.pn > 1){                                   // reduced motion: nothing scrolls; the last phrase, still, fitted to the width
      const sx = (px - 16) / Math.max(.5, md.p1 - md.p0); let up = true;
      for(let j = 0; j < md.pn; j++){
        const v = md.PM[j];
        if(v !== v) up = true;
        else if(up){ g.moveTo((md.PT[j] - md.p0) * sx, yOf(v)); up = false; }
        else g.lineTo((md.PT[j] - md.p0) * sx, yOf(v));
      }
      g.globalAlpha = .6; g.strokeStyle = C.primary; g.stroke();
    }
    // 3. the pen
    if(pa <= 0) return;
    const y = yOf(pv); g.fillStyle = g.strokeStyle = C.primary; g.globalAlpha = pa;
    if(y < 0 || y > h){                                      // beyond the window: a chevron pinned to that edge
      const e = y < 0 ? 2 : h - 2, s = y < 0 ? 1 : -1;
      g.lineWidth = lw * .8; g.beginPath(); g.moveTo(px - ch / 2, e + s * ch / 2); g.lineTo(px, e); g.lineTo(px + ch / 2, e + s * ch / 2); g.stroke();
      return;
    }
    const hk = live && near ? Math.min(1, Math.max(0, (12 - Math.abs(near.cents)) / 4)) : 0;   // halo within ±10 ¢ (a soft 8–12 ¢ edge, so vibrato doesn't flicker it)
    if(hk > 0){ g.globalAlpha = .25 * hk; g.beginPath(); g.arc(px, y, hr, 0, 2 * Math.PI); g.fill(); g.globalAlpha = 1; }
    g.beginPath();
    if(live){ g.arc(px, y, pr, 0, 2 * Math.PI); g.fill(); }
    else { g.lineWidth = 1.5; g.arc(px, y, pr - .75, 0, 2 * Math.PI); g.stroke(); }
  }
  theme(); resize();
  if(window.ResizeObserver) new ResizeObserver(resize).observe(canvas);   // also catches the view becoming visible
  if(document.fonts) document.fonts.ready.then(() => { g.font = font; redraw(); });
  return { canvas, draw, resize, theme };
}

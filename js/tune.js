// Tune mode on screen: your note in the circle, the pitch line under it (the whole screen when horizontal) over the
// key's guide lines, and a quiet spoken summary when a phrase ends. Detection is pitch.js; drawing is trace.js.
// Judgment-free by design: closeness shows as a line growing brighter and words like "5¢ above", never colour.
import { S, FREQ, CHROMA, inst, writtenKey } from './state.js';
import { $, put, reduced } from './ui.js';
import { createPitchModel, createTraceView } from './trace.js';

// Note names follow the written key signature: sharp keys spell with ♯, the rest with ♭ (C mixes, as players read it).
// Minor lines read from the relative major's signature (D minor: B♭, not A♯).
const FLAT = ['C','D♭','D','E♭','E','F','G♭','G','A♭','A','B♭','B'], SHARP = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
const MIXED = ['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
const spelling = () => {
  const w0 = writtenKey(), w = S.tlines === 'min' ? CHROMA[(CHROMA.indexOf(w0) + 3) % 12] : w0;
  return ['G','D','A','E','B'].includes(w) ? SHARP : w === 'C' ? MIXED : FLAT;
};
const SAY = { '♯':' sharp', '♭':' flat' };
export const noteName = midi => spelling()[(((midi + inst()[2]) % 12) + 12) % 12];     // written pitch for the chosen instrument

// The lines: [semitones above the root, kind]. Scale tones are faint; root, fifth and octave carry the key.
const DEG = { rfo:[[0,'root'],[7,'fifth'],[12,'octave']], ro:[[0,'root'],[12,'octave']],
  maj:[[0,'root'],[2,'scale'],[4,'scale'],[5,'scale'],[7,'fifth'],[9,'scale'],[11,'scale'],[12,'octave']],
  min:[[0,'root'],[2,'scale'],[3,'scale'],[5,'scale'],[7,'fifth'],[8,'scale'],[10,'scale'],[12,'octave']] };
const WORDS = { 0:'Root', 2:'Second', 3:'Third', 4:'Third', 5:'Fourth', 7:'Fifth', 8:'Sixth', 9:'Sixth', 10:'Seventh', 11:'Seventh', 12:'Octave' };
// The drone's root on the A4 grid: the Wash is tuned to A440 and retuned with A4, so its root is a whole note there.
export const rootLow = () => Math.round(69 + 12 * Math.log2(FREQ[S.key] / 440));
export const droneHz = () => S.tdrone === 'wash' ? FREQ[S.key] * S.a4 / 440 : 0;

const model = createPitchModel({ seconds:16 });
const strip = createTraceView($('tlinec'), model), big = createTraceView($('tunebigc'), model, { big:true });
const go = $('go'), word = $('word'), barno = $('barno'), cents = $('cents'), bword = $('bword'), bno = $('bno'), beats = $('beats'),
      tline = $('tline'), say = $('tunesay'), pulse = go.querySelector('.pulse');

// Key, instrument, lines or register changed: redraw the guide lines (history stays).
export function tuneGuides(){
  const r = rootLow() + 12 * (S.treg === 'auto' ? 1 : +S.treg - 1);
  model.setGuides({ root:r, follow: S.treg === 'auto',
    degrees: DEG[S.tlines].map(([semi, kind]) => ({ semi, kind, label: noteName(r + semi) })) });
}
export function tuneTheme(){ strip.theme(); big.theme(); strip.resize(); big.resize(); if(document.body.dataset.running !== 'true') tuneIdle(); }
addEventListener('resize', () => { strip.resize(); big.resize(); if(document.body.dataset.running !== 'true') tuneIdle(); });
// Not listening: the strip shows just the key's lines, with the invitation over them.
export function tuneIdle(){
  if(S.mode !== 'tune') return;
  bigShown = null; tline.dataset.idle = 'true'; model.clear();
  requestAnimationFrame(() => { strip.resize(); strip.draw(performance.now() / 1000, { seconds: +S.tspeed }); });
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', tuneTheme);

// ---- per session ----
let lastVoice = -1e9, lastWord = '', lastName = '', shownQ = null, textC = null, textNote = null, textAt = 0, level = 0, prevNow = 0, bigShown = null;
const phrase = { note:null, since:0, steady:false, word:'', name:'', cents:0, onLine:false };   // the note holding now; announced once it ends
let lastSaid = -1e9;
export function tuneReset(){
  model.clear(); tuneGuides();
  lastVoice = -1e9; lastWord = lastName = ''; shownQ = textC = textNote = null; textAt = 0; level = 0; prevNow = 0; phrase.note = null; phrase.steady = false;
  tline.dataset.idle = 'true'; go.classList.remove('faded'); pulse.style.transform = '';
}
// "Listening": said aloud only when the mic opens; between phrases it's just the circle's text.
export function tuneListening(aloud){ put(word, 'Listening'); put(barno, '·'); put(cents, ''); put(bword, 'Listening'); put(bno, ''); if(aloud) speak('Listening'); }
export function tuneQuiet(){ say.textContent = ''; }
function speak(text){ say.textContent = ''; say.textContent = text; }

// "8¢ above": whole cents, from a slower average of the readout (τ 250 ms) with a little hysteresis, so the words settle
// instead of flickering, and vibrato reads as its centre.
function centsText(c, note, dt, onLine){
  if(textC == null || note !== textNote){ textC = c; textNote = note; shownQ = null; }
  else textC += (c - textC) * (1 - Math.exp(-dt / .25));
  if(shownQ == null || Math.abs(textC - shownQ) > 1.2) shownQ = Math.round(textC);
  return shownQ === 0 ? (onLine ? 'on the line' : 'on the note') : `${Math.abs(shownQ)}¢ ${shownQ > 0 ? 'above' : 'below'}`;
}

// One frame: r from the tracker (pitch.js read()), now = seconds.
export function tuneFrame(r, now){
  const dt = prevNow ? Math.min(.25, now - prevNow) : 0; prevNow = now;
  level += ((r ? r.level || 0 : 0) - level) * (1 - Math.exp(-dt / .12));
  if(!reduced) pulse.style.transform = `scale(${(.72 + .14 * Math.min(1, level)).toFixed(4)})`;   // "I can hear you", nothing more
  const voiced = r && r.midi != null;
  model.push(now, voiced && r.line != null ? r.line : null);
  // draw only the view that's on screen; size it when it appears
  const isBig = beats.clientWidth > 0;
  if(isBig !== bigShown){ bigShown = isBig; (isBig ? big : strip).resize(); }
  (isBig ? big : strip).draw(now, { seconds: +S.tspeed });

  if(voiced){
    if(!r.held) lastVoice = now;
    tline.dataset.idle = 'false';
    const semi = ((r.note - rootLow()) % 12 + 12) % 12, degs = DEG[S.tlines], onLine = degs.some(d => d[0] % 12 === semi);
    // The word comes from the line you're on (the octave line isn't the root). While the note fades (held) the trace
    // has no sample, so the last word stays.
    let w = lastWord;
    if(!r.held){
      const near = model.closeness(), kind = near ? near.kind : null;
      w = kind && kind !== 'scale' ? WORDS[kind === 'octave' ? 12 : kind === 'fifth' ? 7 : 0] : onLine ? WORDS[semi] : '';
    }
    const name = noteName(r.note);
    lastWord = w; lastName = name;
    go.classList.toggle('faded', !!r.held);                             // the note just ended: it stays, dimmed, for a breath
    put(word, w || ' '); put(barno, name); put(bword, w || name);
    const ct = centsText(r.cents, r.note, dt, onLine);
    if(now - textAt > .2){                                              // text at most 5 times a second
      textAt = now;
      const c = S.tcents === 'show' ? ct : '';
      put(cents, c); put(bno, S.tcents === 'show' ? `${w ? name + ' · ' : ''}${c}` : (w ? name : ''));
    }
    // a steady note (±30¢) sung for 0.8 s becomes the phrase's summary (sung frames only, not the fading tail)
    if(!r.held){
      if(phrase.note !== r.note){ phrase.note = r.note; phrase.since = now; phrase.steady = false; }
      if(Math.abs(r.cents) <= 30 && now - phrase.since >= .8){ phrase.steady = true; phrase.word = w; phrase.name = name; phrase.cents = r.cents; phrase.onLine = onLine; }
    }
  } else if(now - lastVoice < 1.2){
    go.classList.add('faded');
  } else if(lastName){
    lastName = ''; go.classList.remove('faded'); tuneListening(false);
  }
  // Spoken only when a phrase ends (0.7 s of quiet after a steady note), so speech never talks over singing.
  if(!voiced && phrase.note != null && now - lastVoice >= .7){
    if(phrase.steady && now - lastSaid >= 2.5){
      const spoken = phrase.name.replace(/[♯♭]/, m => SAY[m]);
      const c = Math.round(phrase.cents), where = c === 0 ? (phrase.onLine ? 'on the line' : 'on the note') : `${Math.abs(c)} cents ${c > 0 ? 'above' : 'below'}`;
      speak([spoken, phrase.word ? `the ${phrase.word.toLowerCase()}` : '', S.tcents === 'show' ? where : ''].filter(Boolean).join(', '));
      lastSaid = now;
    }
    phrase.note = null; phrase.steady = false;
  }
}

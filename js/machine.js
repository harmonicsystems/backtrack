// Drum machine beats: Drum Keys' classic patterns (one bar of sixteenths) played on the samples of seven machines,
// on the groove's own timeline, so a beat plays at any tempo 40–240 and through ramps and glides with nothing to
// stretch. The samples are fetched one file at a time out of archive.org's drum-machines-collection (it serves single
// files from inside its zips, with CORS), only when a machine is first played; the service worker keeps them.
// No DOM, no settings, no context of its own (state.js reads the lists; groove.js and rec.js call scheduleBeat with
// their context, and loadKit with audio.js's getUrlBuf).
import { restIn } from './timeline.js';

// The lanes, in scheduling order: the closed hat before the open hat, so a closed hat on the same step chokes it.
export const LANES = ['kick', 'snare', 'clap', 'rim', 'chh', 'ohh', 'tom1', 'cym', 'perc1', 'perc2'];
const LEVEL = { g:.3, x:.7, X:1 };
// A beat's hits in time order: [sixteenth, lane, level].
function hitsOf(lanes){
  const out = [];
  for(let i = 0; i < 16; i++) for(const l of LANES){ const ch = (lanes[l] || '')[i]; if(LEVEL[ch]) out.push([i, l, LEVEL[ch]]); }
  return out;
}

// [id, name (the readout and the car), short (home screen), usual bpm, swing %, lanes: x hit · X accent · g ghost · . rest, note]
// Lanes: perc1 = shaker, perc2 = cowbell (Drum Keys' convention). From Drum Keys' engine.js PRESETS.
export const BEATS = [
  ['rock', 'Rock', 'Rock', 110, 50, { kick:'X.......x.x.....', snare:'....X.......X...', chh:'x.x.x.x.x.x.x.x.' }, 'Kick on 1 and the “and” of 3, snare on 2 and 4, straight eighths on the hat.'],
  ['funk', 'Funk', 'Funk', 100, 54, { kick:'X.x.......x..x..', snare:'....X..g.g..X..g', chh:'xxxxxxx.xxxxx.xx', ohh:'.......x.....x..' }, 'Busy sixteenths on the hat, ghost notes on the snare and a little swing.'],
  ['boombap', 'Boom bap', 'Boom', 90, 58, { kick:'X......x..x.....', snare:'....X.......X...', chh:'x.x.x.x.x.x.x.x.', ohh:'..............x.' }, 'The swung kick-and-snare of late-’80s and ’90s hip-hop.'],
  ['njs', 'New jack swing', 'Swing', 104, 62, { kick:'X..x..x...x..x..', snare:'....X.......X...', chh:'x.xxx.xxx.xxx.xx' }, 'Heavily swung sixteenths: late-’80s R&B meeting hip-hop.'],
  ['shuffle', 'Shuffle', 'Shuffle', 92, 67, { kick:'X.....x.X.....x.', snare:'....X.......X...', chh:'X.xxX.xxX.xxX.xx' }, 'Swing pushed to the triplet: the long-short lope of blues and boogie.'],
  ['disco', 'Disco', 'Disco', 118, 50, { kick:'X...X...X...X...', snare:'....x.......x...', chh:'xx.xxx.xxx.xxx.x', ohh:'..x...x...x...x.' }, 'Four on the floor with the open hat on every “and”.'],
  ['house', 'House', 'House', 124, 52, { kick:'X...X...X...X...', clap:'....x.......x...', ohh:'..x...x...x...x.', perc1:'g.g.g.g.g.g.g.g.' }, 'Four on the floor, clap on 2 and 4, open hat on the off-beats.'],
  ['techno', 'Techno', 'Techno', 132, 50, { kick:'X...X...X...X...', clap:'....x.......x...', chh:'gg.ggg.ggg.ggg.g', ohh:'..x...x...x...x.', rim:'...x.....x..x...' }, 'Four on the floor with a syncopated rim over driving hats.'],
  ['electro', 'Electro', 'Electro', 126, 50, { kick:'X.....x.....x...', clap:'....X.......X...', chh:'x.x.x.x.x.x.x.x.', perc2:'x..x..x...x..x..' }, 'Broken kicks and a cowbell figure, early-’80s style.'],
  ['break', 'Breakbeat', 'Break', 136, 50, { kick:'X.x.......xx....', snare:'....X..g.g..X..g', cym:'x.x.x.x.x.x.x.x.' }, 'A sampled-break feel: syncopated kick, ghosted snare, ride eighths.'],
  ['trap', 'Trap', 'Trap', 140, 50, { kick:'X.....x...x....x', clap:'........X.......', chh:'xgxgxgxgxxxxxgxg', ohh:'.......x........' }, 'Half-time: the clap on 3, rolling sixteenth hats above.'],
  ['dnb', 'Drum & bass', 'DnB', 172, 50, { kick:'X.........X.....', snare:'....X..g.g..X...', chh:'x.x.x.x.x.x.x.x.' }, 'The two-step kick and snare, usually played fast.'],
  ['onedrop', 'One drop', 'Drop', 76, 62, { kick:'........X.......', rim:'........x.......', chh:'x.x.x.x.x.x.x.x.' }, 'Beat 1 left empty, kick and rim together on 3: reggae’s one drop.'],
  ['bossa', 'Bossa nova', 'Bossa', 128, 50, { kick:'X..xX..xX..xX..x', rim:'x..x..x...x..x..', chh:'gggggggggggggggg' }, 'The kick’s steady pulse under a cross-stick figure.'],
  ['clave', 'Son clave', 'Clave', 104, 50, { kick:'X...X...X...X...', rim:'x..x..x...x.x...', perc2:'x.x.x.x.x.x.x.x.', tom1:'......x.......x.' }, 'The 3-2 son clave on the rim, cowbell on the eighths.'],
].map(([id, name, short, bpm, swing, lanes, note]) => ({ id, name, short, bpm, swing, lanes, note, hits: hitsOf(lanes) }));
export const beatOf = id => BEATS.find(b => b.id === id);

// The machines, oldest first: each lane's file inside the archive.org zip (Drum Keys' app/machines.js picks, checked there
// against the collection; the cymbal lane uses the ride, gentler than a crash for practice). A lane a machine lacks is
// silent, or borrows its nearest sound where a beat would lose its backbeat.
export const KITS = [
  { id:'ace', name:'Rhythm Ace', maker:'Ace Tone', year:1967, zip:'Acetone Rhythm-Ace.zip', root:'Acetone Rhythm-Ace/',
    note:'Ikutaro Kakehashi’s rhythm box, before he founded Roland: soft, dry and a little toy-like.',
    // No clap: the second snare plays it, so backbeats on the clap lane still sound. The collection names the
    // percussion only by number; these were picked by length and brightness (Perc1 low and short = bongo, Perc3
    // bright and short = maracas, Perc4 mid and ringing = bell), and the cymbal lane borrows the open hat.
    pads:{ kick:'Kick1.wav', snare:'Snare1.wav', clap:'Snare2.wav', rim:'Clave.wav', chh:'HHcl.wav', ohh:'HHop.wav',
           tom1:'Perc1.wav', cym:'HHop.wav', perc1:'Perc3.wav', perc2:'Perc4.wav' } },
  { id:'cr78', name:'CR-78', maker:'Roland', year:1978, zip:'Roland CR78.zip', root:'Roland CR78/',
    note:'One of the first programmable rhythm boxes: gentle and papery.',
    // Numbered files, Drum Keys' picks by ear. No clap: the snare plays it.
    pads:{ kick:'SAMPLE5.WAV', snare:'SAMPLE9.WAV', clap:'SAMPLE9.WAV', rim:'SAMPLE10.WAV', chh:'SAMPLE21.WAV', ohh:'SAMPLE22.WAV',
           tom1:'SAMPLE12.WAV', cym:'SAMPLE11.WAV', perc1:'SAMPLE7.WAV', perc2:'SAMPLE8.WAV' } },
  { id:'808', name:'TR-808', maker:'Roland', year:1980, zip:'Roland TR808.zip', root:'Roland TR808/',
    note:'Analog boom and snap: the low end of hip-hop, electro and trap.',
    pads:{ kick:'Kick01.wav', snare:'Snare01.wav', clap:'Clap01.wav', rim:'Rim01.wav', chh:'Hat_C01.wav', ohh:'Hat_O01.wav',
           tom1:'Tom02.wav', cym:'Ride01.wav', perc1:'Shaker01.wav', perc2:'Cow.wav' } },
  { id:'dmx', name:'DMX', maker:'Oberheim', year:1981, zip:'Oberheim DMX.zip', root:'Oberheim DMX/',
    note:'Hard, punchy samples that shaped early hip-hop.',
    // No cowbell: the low timbale plays its lane.
    pads:{ kick:'Kick01.wav', snare:'Snare01.wav', clap:'Clap.wav', rim:'Rim.wav', chh:'Hat_C.wav', ohh:'Hat_O.wav',
           tom1:'TomLo.wav', cym:'Ride.wav', perc1:'Cabasa.wav', perc2:'TimbaleLo.wav' } },
  { id:'linn', name:'LinnDrum', maker:'Linn', year:1982, zip:'Linn Linndrum.zip', root:'Linn Linndrum/',
    note:'Recordings of real drums, all over 1980s radio.',
    pads:{ kick:'Kick.wav', snare:'SnareDrum.wav', clap:'Clap.wav', rim:'Sst.wav', chh:'Chh.wav', ohh:'Ohh.wav',
           tom1:'Toml.wav', cym:'Ride.wav', perc1:'Cabasa.wav', perc2:'Cowb.wav' } },
  { id:'909', name:'TR-909', maker:'Roland', year:1983, zip:'Roland TR-909.zip', root:'Roland TR-909/',
    note:'Analog drums with sampled cymbals: the engine room of house and techno.',
    pads:{ kick:'Set3/Bd01.wav', snare:'Set3/Sn01.wav', clap:'Set3/Clp01.wav', rim:'Set3/Rs01.wav', chh:'Set3/Ch01.wav', ohh:'Set3/Oh01.wav',
           tom1:'Set3/Lt01.wav', cym:'Set3/Ride01.wav', perc1:'Set3/Ch16.wav' } },
  { id:'707', name:'TR-707', maker:'Roland', year:1985, zip:'Roland TR707.zip', root:'Roland TR707/',
    note:'Crisp sampled drums in a slim box: mid-’80s pop and early house.',
    pads:{ kick:'Bd0.wav', snare:'Sd0.wav', clap:'Hcp.wav', rim:'Rim.wav', chh:'HH_c.wav', ohh:'HH_o.wav',
           tom1:'Lt.wav', cym:'Rid.wav', perc1:'Tam.wav', perc2:'Cow.wav' } },
];
export const kitOf = id => KITS.find(k => k.id === id) || KITS.find(k => k.id === '808');
const ITEM = 'https://archive.org/download/drum-machines-collection/';
export const sampleUrl = (kit, file) => ITEM + encodeURIComponent(kit.zip) + '/' + encodeURIComponent(kit.root + file);

// The mix: each lane's level, and one trim for the machine as a whole (each sample is first brought to a peak of 1,
// so the machines sit at one level). To be checked by ear against the drum loops.
const MIX = { kick:1, snare:.8, clap:.75, rim:.55, chh:.4, ohh:.4, tom1:.7, cym:.4, perc1:.4, perc2:.5 };
export const TRIM = .45;

// A machine's samples, decoded: { lane: { buf, k } } with k the gain to a peak of 1. A file that won't load leaves its
// lane silent; `count` says how many loaded (0: nothing to play, most likely offline before the first play).
const kits = {};
export function loadKit(id, getUrlBuf){
  const kit = kitOf(id);
  return kits[kit.id] ||= Promise.all(Object.entries(kit.pads).map(([lane, file]) =>
    getUrlBuf(sampleUrl(kit, file)).then(buf => [lane, { buf, k: gainToPeak(buf) }], () => null)))
    .then(rows => { const out = Object.fromEntries(rows.filter(Boolean)); out.count = rows.filter(Boolean).length; if(!out.count) delete kits[kit.id]; return out; });
}
function gainToPeak(buf){
  let peak = 0;
  for(let c = 0; c < buf.numberOfChannels; c++){ const d = buf.getChannelData(c); for(let i = 0; i < d.length; i++){ const a = Math.abs(d[i]); if(a > peak) peak = a; } }
  return peak > 1e-4 ? Math.min(8, 1 / peak) : 0;
}

// Put the beat's hits for bars [fromBar, toBar) on a clock, on any context (live or offline).
// T = { c: the context, dest, t0: bar 0 on that clock, kit (loadKit's), open: [] (open hats still ringing), min?, max? }.
// The count-in (bars < 0) and drop-out bars are silent; swing delays every second sixteenth, as in Drum Keys.
export function scheduleBeat(T, tl, fromBar, toBar){
  const s = tl.setup, B = beatOf(s.beat); if(!B || !T.kit || !T.kit.count) return;
  for(let b = Math.max(0, fromBar); b < toBar; b++){
    if(restIn(s.drop, b)) continue;
    const t = T.t0 + tl.barStart(b), step = tl.barSecOf(b) / 16, sw = (B.swing - 50) / 50 * step;
    for(const [i, lane, lv] of B.hits){
      const tt = t + i * step + (i % 2 ? sw : 0);
      if((T.min != null && tt < T.min) || (T.max != null && tt >= T.max)) continue;
      hit(T, lane, tt, lv);
    }
  }
}
function hit(T, lane, t, lv){
  const p = T.kit[lane]; if(!p || !p.k) return;
  const c = T.c;
  if(lane === 'chh' && T.open.length){                  // a closed hat chokes the open hat ringing
    for(const v of T.open) if(v.t < t + 1e-6 && v.end > t){ v.g.gain.setTargetAtTime(0, t, .008); try{ v.src.stop(t + .06); }catch(e){} v.end = t; }
    T.open = T.open.filter(v => v.end > t);
  }
  const src = c.createBufferSource(), g = c.createGain();
  src.buffer = p.buf; g.gain.value = lv * MIX[lane] * p.k * TRIM;
  src.connect(g).connect(T.dest); src.start(t);
  if(lane === 'ohh') T.open.push({ src, g, t, end: t + p.buf.duration });
}

// ---- Sticking: how one drummer plays each beat on a four-piece kit, step by step (Setup ▸ View ▸ Sticking: the bar as
//      letters, or the kit from above). The kit is the classic one: kick, snare, one rack tom, one floor tom, hi-hat,
//      one crash, one ride. R and L are the hands, each with the stroke it plays; K is the kick (the right foot, straight
//      from the kick lane); F is the hi-hat foot closing the hat for a "chick". A stroke names the piece it lands on,
//      the word shown under the letter, and the machine lanes it can stand for: the kit has no clap, cowbell or shaker,
//      so the clap is the snare, the cowbell's part goes on the bell of the ride, and a beat says where its shaker
//      went (`also`). ----
export const STROKES = {
  H: { piece:'hat',    word:'hat',   lanes:['chh'] },
  O: { piece:'hat',    word:'open',  lanes:['ohh', 'chh'] },            // an open hat covers a closed note on its step too
  S: { piece:'snare',  word:'snare', lanes:['snare', 'clap'] },
  X: { piece:'xstick', word:'rim',   lanes:['rim'] },                   // cross-stick: the stick laid across the snare
  T: { piece:'rack',   word:'tom',   lanes:['tom1'] },
  U: { piece:'floor',  word:'floor', lanes:['tom1'] },
  D: { piece:'ride',   word:'ride',  lanes:['cym'] },
  B: { piece:'bell',   word:'bell',  lanes:['perc2'] },
  A: { piece:'crash',  word:'crash', lanes:['cym'] },
};
// Each beat: R and L (a stroke code per step), F (the hi-hat foot), `also` (a lane played by other strokes, as
// { lane: codes }), how faithful it is, and the note shown with it. how: 'as' = every note as programmed (the clap on
// the snare); 'moved' = every note sounds, some on another limb or piece; 'simpler' = some notes left out (the note
// says which). Checked by tools/check-sticking.mjs: nothing added, what is left out, and each limb's rate.
const STICK = {
  rock:    { R:'H.H.H.H.H.H.H.H.', L:'....S.......S...', how:'as' },
  funk:    { R:'HHHHHHHOHHHHHOHH', L:'....S..S.S..S..S', how:'as', note:'One-handed sixteenths on the hat: the hardest part.' },
  boombap: { R:'H.H.H.H.H.H.H.O.', L:'....S.......S...', how:'as' },
  njs:     { R:'H.HHH.HHH.HHH.HH', L:'....S.......S...', how:'as', note:'One hand plays the whole hat. The swung “a” just before each beat is the hard part.' },
  shuffle: { R:'H.HHH.HHH.HHH.HH', L:'....S.......S...', how:'as', note:'One hand plays the whole hat. The late “a” just before each beat is the hard part.' },
  disco:   { R:'H.O.S.O.H.O.S.O.', L:'.H.H.H.H.H.H.H.H', how:'simpler', note:'Hands alternate on the hat. The right plays the snare on 2 and 4, so the hat is left out there.' },
  house:   { R:'H.O.H.O.H.O.H.O.', L:'....S.......S...', also:{ perc1:'HO' }, how:'moved', note:'The shaker’s eighths go on the hat: closed on the beat, open on each “and”.' },
  techno:  { R:'H.O.H.O.H.O.H.O.', L:'....S....X..S...', how:'simpler', note:'The quiet in-between hats and two of the three rim hits are left out: it needs three hands.' },
  electro: { R:'B..B..B...B..B..', L:'....S.......S...', F:'F.F.F.F.F.F.F.F.', how:'moved', note:'The cowbell is the ride’s bell. The hi-hat foot plays the hat’s eighths: the hard part.' },
  break:   { R:'D.D.D.D.D.D.D.D.', L:'....S..S.S..S..S', how:'as', note:'Two kicks in a row on the “and” and “a” of 3: a quick double with the right foot.' },
  trap:    { R:'H.H.H.H.S.H.H.H.', L:'.H.H.H.O.H.H.H.H', F:'........F.......', how:'moved', note:'Hands alternate on the hat. On 3 the right plays the clap on the snare as the foot closes the hat.' },
  dnb:     { R:'H.H.H.H.H.H.H.H.', L:'....S..S.S..S...', how:'as' },
  onedrop: { R:'H.H.H.H.H.H.H.H.', L:'........X.......', how:'as' },
  bossa:   { R:'H.H.H.H.H.H.H.H.', L:'X..X..X...X..X..', how:'simpler', note:'The hat plays eighths: the soft sixteenths need both hands, and the left has the cross-stick.' },
  clave:   { R:'B.B.B.B.B.B.B.B.', L:'X..X..X...X.X.T.', how:'simpler', note:'The cowbell is the ride’s bell. The tom on the “and” of 2 is left out: it lands with the clave.' },
};
// One beat's sticking, worked out once: steps[16] = { R, L (a stroke code or ''), F, K (the kick's level or 0), rl, ll
// (the hand strokes' levels: ghost .3 · hit .7 · accent 1) }; limbs.R/L/K/F = that limb's strokes in time order, each
// { i, t, code, piece, lv } with t the step's time in sixteenths (the swing's delay on every second one included);
// open = the stretches [from, to] (in the same time, to may run past 16 into the next bar) while the hat is open: from
// an open stroke to the next closed stroke or chick; how, note, swing. null for a beat without a sticking.
const built = {};
export function stickingOf(id){
  if(id in built) return built[id];
  const B = beatOf(id), s = B && STICK[id]; if(!s) return built[id] = null;
  const sw = (B.swing - 50) / 50, tOf = i => i + (i % 2 ? sw : 0), at = (str, i) => (str || '')[i] && str[i] !== '.' ? str[i] : '';
  const lanesOf = c => [...STROKES[c].lanes, ...Object.keys(s.also || {}).filter(l => s.also[l].includes(c))];
  const lvl = (lanes, i) => Math.max(0, ...lanes.map(l => LEVEL[(B.lanes[l] || '')[i]] || 0)) || .7;
  const limbs = { R:[], L:[], K:[], F:[] }, steps = [];
  for(let i = 0; i < 16; i++){
    const st = { R: at(s.R, i), L: at(s.L, i), F: !!at(s.F, i), K: LEVEL[(B.lanes.kick || '')[i]] || 0, rl:0, ll:0 };
    for(const h of ['R', 'L']) if(st[h]){ const lv = st[h.toLowerCase() + 'l'] = lvl(lanesOf(st[h]), i); limbs[h].push({ i, t: tOf(i), code: st[h], piece: STROKES[st[h]].piece, lv }); }
    if(st.K) limbs.K.push({ i, t: tOf(i), code:'K', piece:'kick', lv: st.K });
    if(st.F) limbs.F.push({ i, t: tOf(i), code:'F', piece:'hat', lv: lvl(['chh'], i) });
    steps.push(st);
  }
  // the hat's open stretches: every hat event in time order; an open stroke opens it, the next closed stroke or chick closes it
  const hat = [...limbs.R, ...limbs.L, ...limbs.F].filter(e => e.piece === 'hat').sort((a, b) => a.t - b.t), open = [];
  hat.forEach((e, k) => {
    if(e.code !== 'O') return;
    let to = e.t + 2;                                                  // nothing closes it in the bar: an eighth
    for(let j = 1; j <= hat.length; j++){ const n = hat[(k + j) % hat.length]; if(n.code !== 'O'){ to = n.t + (k + j >= hat.length ? 16 : 0); break; } }
    open.push([e.t, to]);
  });
  return built[id] = { steps, limbs, open, how: s.how, note: s.note || '', swing: B.swing };
}
// The step sounding at time tau (sixteenths into the bar): a swung step starts late, so the even step before it holds
// until its onset.
export function stepAt(tau, swing){ const i = Math.floor(tau), sw = (swing - 50) / 50; return i % 2 && tau - i < sw ? i - 1 : i; }
export const STICK_RAW = STICK;

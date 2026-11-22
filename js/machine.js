// Drum machine beats: Drum Keys' classic patterns (one bar of sixteenths) played on the samples of three machines,
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

// The machines: each lane's file inside the archive.org zip (Drum Keys' app/machines.js picks, checked there against
// the collection; the cymbal lane uses the ride, gentler than a crash for practice). A lane a machine lacks is silent.
export const KITS = [
  { id:'808', name:'TR-808', maker:'Roland', year:1980, zip:'Roland TR808.zip', root:'Roland TR808/',
    note:'Analog boom and snap: the low end of hip-hop, electro and trap.',
    pads:{ kick:'Kick01.wav', snare:'Snare01.wav', clap:'Clap01.wav', rim:'Rim01.wav', chh:'Hat_C01.wav', ohh:'Hat_O01.wav',
           tom1:'Tom02.wav', cym:'Ride01.wav', perc1:'Shaker01.wav', perc2:'Cow.wav' } },
  { id:'909', name:'TR-909', maker:'Roland', year:1983, zip:'Roland TR-909.zip', root:'Roland TR-909/',
    note:'Analog drums with sampled cymbals: the engine room of house and techno.',
    pads:{ kick:'Set3/Bd01.wav', snare:'Set3/Sn01.wav', clap:'Set3/Clp01.wav', rim:'Set3/Rs01.wav', chh:'Set3/Ch01.wav', ohh:'Set3/Oh01.wav',
           tom1:'Set3/Lt01.wav', cym:'Set3/Ride01.wav', perc1:'Set3/Ch16.wav' } },
  { id:'linn', name:'LinnDrum', maker:'Linn', year:1982, zip:'Linn Linndrum.zip', root:'Linn Linndrum/',
    note:'Recordings of real drums, all over 1980s radio.',
    pads:{ kick:'Kick.wav', snare:'SnareDrum.wav', clap:'Clap.wav', rim:'Sst.wav', chh:'Chh.wav', ohh:'Ohh.wav',
           tom1:'Toml.wav', cym:'Ride.wav', perc1:'Cabasa.wav', perc2:'Cowb.wav' } },
];
export const kitOf = id => KITS.find(k => k.id === id) || KITS[0];
const ITEM = 'https://archive.org/download/drum-machines-collection/';
export const sampleUrl = (kit, file) => ITEM + encodeURIComponent(kit.zip) + '/' + encodeURIComponent(kit.root + file);

// The mix: each lane's level, and one trim for the machine as a whole (each sample is first brought to a peak of 1,
// so the three machines sit at one level). To be checked by ear against the drum loops.
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

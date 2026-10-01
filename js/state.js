// Everything a preset is made of, plus the device-only mix. No DOM in here.
import { METERS, meterOf, cellsOf, fitCells, maxSub, rampOf, rampString } from './timeline.js';

// The grooves, slowest to fastest: bpm, the genres that live there, the classical term.
export const GROOVES = [[60,'Slow ballad','Largo'],[72,'Ballad · soul','Adagio'],[88,'Hip-hop','Andante'],[96,'Hip-hop · R&B','Andante'],
                        [108,'Mid-tempo rock','Moderato'],[120,'Pop · rock','Allegro'],[128,'House · dance','Allegro']];
export const TEMPOS = GROOVES.map(g => g[0]);
export const SHORT = {60:'Slow', 72:'Ballad', 88:'Hip-hop', 96:'R&B', 108:'Rock', 120:'Pop', 128:'House'};   // home-screen names
export const KEYS = [['C','C'],['B','B'],['Bb','B♭'],['A','A'],['Ab','A♭'],['G','G'],['Gb','G♭'],['F','F'],['E','E'],['Eb','E♭'],['D','D'],['Db','D♭']];
export const FREQ = {C:130.81,B:123.47,Bb:116.54,A:110,Ab:103.83,G:98,Gb:92.5,F:87.31,E:82.41,Eb:77.78,D:73.42,Db:69.3};
export const DROPS = ['0-0','4-1','4-2','8-4','4-4'];
// ---- drone progressions (Groove): the Wash moves to another root every few bars ----
// [code, menu label, semitones from home per step, bars per step when fixed (the blues: one chord a bar)]
export const PROGS = [['off','Off',[0]],['4','Root ↔ 4th',[0,5]],['5','Root ↔ 5th',[0,7]],['6','Root ↔ 6th',[0,9]],
  ['iv','I – IV – V – I',[0,5,7,0]],['bl','12-bar blues',[0,0,0,0,5,5,0,0,7,5,0,0],1],
  ['ch','Chromatic up',[0,1,2,3,4,5,6,7,8,9,10,11]],['c4','Circle of 4ths',[0,5,10,3,8,1,6,11,4,9,2,7]]];
export const PBARS = ['1','2','4','8'];
// The tuning: the phone's own setting (like the volumes), for every mode. A = 440, 442 or 432: the Wash plays at a4/440
// (432 is 1.818 % slower, −31.8 cents) and every synthesized tone (cues, hum, reference tones) is scaled the same way.
export const TUNINGS = ['440','442','432'];
export const tuning = () => +S.a4 / 440;
export const tuningTag = () => S.a4 === '440' ? '' : ` · A=${S.a4}`;
const WASH_UP = ['Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B','C'];   // the Wash recordings, low to high: D♭2 … C3
export const progOf = (code = S.prog) => PROGS.find(p => p[0] === code) || PROGS[0];
export const progEvery = (g = S) => progOf(g.prog)[3] || +g.pbars || 4;   // bars per step
// The drone in bar `bar` (any context: S or a take): the step's pitch class in the octave nearest home, within the
// Wash's range D♭2 … D3 (the top C recording pitch-shifted up one or two half steps for D♭3 and D3; a tie, the tritone,
// takes the lower). The count-in (bars below 0) is home. → { key (the recording), rate (its pitch shift), note (the
// pitch class, a KEYS id) }
export function droneAt(bar, g = S){
  const p = progOf(g.prog), off = bar < 0 ? 0 : p[2][Math.floor(bar / progEvery(g)) % p[2].length];
  const h = WASH_UP.indexOf(g.key), pc = (h + off) % 12;
  const idx = [pc, pc + 12].filter(i => i <= 13).reduce((a, b) => Math.abs(b - h) < Math.abs(a - h) ? b : a);
  return { key: idx > 11 ? 'C' : WASH_UP[idx], rate: idx > 11 ? Math.pow(2, (idx - 11) / 12) : 1, note: WASH_UP[pc] };
}
const noteFrom = (g, off) => keyLabel(WASH_UP[(WASH_UP.indexOf(g.key) + off) % 12]);
// What the drone does, in words: the album and guide line ("Wash C ↔ F"), the glance row's caption ("↔ F · every 4"),
// and Setup's note under the menus ("C → F → C → F, a move every 4 bars").
export function droneLine(g = S, k = keyLabel(g.key)){
  const p = progOf(g.prog);
  return p[0] === 'off' ? `Wash in ${k}` : p[2].length === 2 ? `Wash ${k} ↔ ${noteFrom(g, p[2][1])}` : p[0] === 'iv' ? `Wash: I–IV–V in ${k}`
    : p[0] === 'bl' ? `Wash: 12-bar blues in ${k}` : p[0] === 'ch' ? `Wash: chromatic from ${k}` : `Wash: circle of 4ths from ${k}`;
}
export function progShort(g = S){
  const p = progOf(g.prog), every = ` · every ${progEvery(g)}`;
  return p[0] === 'off' ? '' : p[2].length === 2 ? `↔ ${noteFrom(g, p[2][1])}${every}` : p[0] === 'iv' ? `I–IV–V${every}`
    : p[0] === 'bl' ? '12-bar blues' : p[0] === 'ch' ? `chromatic${every}` : `circle of 4ths${every}`;
}
export function progNote(g = S){
  const p = progOf(g.prog), n = progEvery(g), ns = p[2].map(o => noteFrom(g, o)), every = `, a move every ${n === 1 ? 'bar' : n + ' bars'}`;
  if(p[0] === 'off') return '';
  if(p[0] === 'bl') return `${ns.slice(0, 4).join(' ')} · ${ns.slice(4, 8).join(' ')} · ${ns.slice(8).join(' ')}, one chord a bar, then round again.`;
  if(p[2].length === 12) return `${ns.slice(0, 4).join(', ')} … ${ns[11]}, then home${every}. Each note sits in the octave nearest ${ns[0]}.`;
  return `${(p[2].length === 2 ? [...ns, ...ns] : ns).join(' → ')}${every}. Each note sits in the octave nearest ${ns[0]}.`;
}
// sound: the drum loop, or the click alone at any tempo. meter/group: pulses per bar and their grouping (click only;
// the loops are 4/4). click: the pattern code (see PATTERNS); csub/cells: the custom grid. ramp: 'step-every-cap'.
// len: a session length ('0', minutes, 'l8' loops, 'c20' cycles). count: what the beats view writes in its cells.
export const DEFAULTS = {prog:'off', pbars:'4', bars:'16', countin:'1', drop:'0-0', click:'off', wash:'on', fine:'0', sound:'drums', meter:'4', group:'', csub:'2', cells:'', ramp:'0', len:'0', count:'off'};
// Classical terms by tempo, matching the grooves' column (60 Largo · 72 Adagio · 88/96 Andante · 108 Moderato · 120/128 Allegro).
export const TERMS = [[40,'Largo'],[66,'Adagio'],[76,'Andante'],[108,'Moderato'],[120,'Allegro'],[156,'Vivace'],[176,'Presto'],[200,'Prestissimo']];
export function termFor(bpm){ let i = 0; while(i + 1 < TERMS.length && bpm >= TERMS[i + 1][0]) i++; return { name:TERMS[i][1], lo:TERMS[i][0], hi: i + 1 < TERMS.length ? TERMS[i + 1][0] - 1 : 240 }; }
// Click patterns: code, label in x/4, label in x/8 (null = not offered there: the meter's pulse is already the eighth).
// The feels (s t v d r) are named rhythm skeletons; they, like the backbeat, live only in some meters (ONLY).
export const PATTERNS = [['off','Off','Off'],['1','Quarters','Beats'],['2','Eighths','Eighths'],['3','Triplets',null],['4','Sixteenths','Sixteenths'],['b','Backbeat',null],['o','Off-beats',null],['c','Custom','Custom'],
                         ['s','Shuffle',null],['t','Tresillo 3+3+2',null],['v','Son clave 3-2',null],['d','One drop',null],['r','Train beat',null]];
export const FEELS = ['s','t','v','d','r'];
const ONLY = { b:[2,4], t:[2,4], v:[4], d:[4], r:[4] };
export const patternOk = (code, M) => { const p = PATTERNS.find(x => x[0] === code); return !!p && !!(M.compound ? p[2] : p[1]) && (!ONLY[code] || ONLY[code].includes(M.top)); };
export const RAMPS = [['0','Off'],['1-4','+1 every 4'],['2-8','+2 every 8'],['4-8','+4 every 8']];   // bpm every N bars

// ---- Breathe mode (ported from Tide Breath): a pattern of in · hold · out · hold seconds ----
// [pattern, chip label, home-screen name, icon]
export const BREATHS = [['4-4-4-4','Box','Box breath','box'],['4-7-8-0','4·7·8','4·7·8 breath','478'],
                        ['5.5-0-5.5-0','Coherent','Coherent breath','coherent'],['4-0-8-0','Long exhale','Long exhale','exhale']];
export const BDEFAULTS = {pattern:'4-4-4-4', bsound:'wash', bcue:'phase', swell:'60', len:'0'};
export const PHASES = ['Breathe in', 'Hold', 'Breathe out', 'Hold'];
export const fmtN = n => (Math.round(n * 2) / 2).toString();
export const durs = (p = S.pattern) => p.split('-').map(Number);
export const breath = (p = S.pattern) => BREATHS.find(b => b[0] === p);                       // a named pattern, or undefined
export const patternLabel = (p = S.pattern) => durs(p).map(fmtN).join('·');
export const breathLabel = (p = S.pattern) => (breath(p) || [0, patternLabel(p)])[1];        // "4·7·8", "Coherent", or "4·2·6·0"
export const breathHome = (p = S.pattern) => (breath(p) || [0, 0, patternLabel(p) + ' breath'])[2];
// ---- Tune mode: the mic listens and draws your pitch over the key's lines ----
// Instruments: [id, label, semitones from concert to written pitch]. The drone always plays at concert pitch.
export const INSTS = [['C','Concert',0],['Bb','B♭',2],['Eb','E♭',9],['F','F',7]];
export const LINES = [['rfo','Root, fifth, octave'],['ro','Root and octave'],['maj','Major scale'],['min','Minor scale']];
export const TDEFAULTS = {tinst:'C', tlines:'rfo', treg:'auto', tdrone:'wash', tdrums:'0'};
export const CHROMA = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
export const inst = (i = S.tinst) => INSTS.find(x => x[0] === i) || INSTS[0];
export const writtenKey = (k = S.key, i = S.tinst) => CHROMA[(CHROMA.indexOf(k) + inst(i)[2]) % 12];
export const tuneLabel = () => `Tune in ${keyLabel(writtenKey())}` + (S.tinst === 'C' ? '' : ` (${inst()[1]})`);      // "Tune in C (B♭)"
export const tuneHome = () => (S.tinst === 'C' ? '' : inst()[1] + ' ') + `Tune in ${keyLabel(writtenKey())}`;        // "B♭ Tune in C": fits under an icon

// what the drone plays depends on the mode: the Wash on/off in Groove, the sound choice in Breathe, on/off in Tune
export const washWanted = () => S.mode === 'breathe' ? S.bsound === 'wash' : S.mode === 'tune' ? S.tdrone === 'wash' : S.wash === 'on';

// The beat-view lab: read before the first render rewrites the URL, and carried along in it afterwards.
export const LAB = new URLSearchParams(location.search).has('lab');
// The audio x-ray (a debug overlay for the audio engine): the same, with ?xray.
export const XRAY = new URLSearchParams(location.search).has('xray');

// The live settings. Values are strings as the controls hold them, except bpm.
// tspeed (seconds across the pitch line) and tcents (show the cents) are per-device, like the volumes.
export const S = { mode:'groove', bpm:96, key:'C', ...DEFAULTS, ...BDEFAULTS, ...TDEFAULTS, dvol:'0.9', wvol:'0.6', cvol:'1', tspeed:'8', tcents:'show', a4:'440' };

export const keyLabel = (k = S.key) => (KEYS.find(x => x[0] === k) || [k, k])[1];
export const groove = (bpm = S.bpm) => GROOVES[TEMPOS.indexOf(bpm)];   // [bpm, genre, classical]; undefined for a click tempo
export const isClick = () => S.sound === 'click';
export const meter = () => meterOf(isClick() ? S.meter : '4', isClick() ? S.group : '');   // the meter in force (the loops are 4/4)
export const noteOf = M => M.unit === 3 ? '♩.' : '♩';                    // what the bpm counts
export const cells = () => cellsOf(S.click, meter(), S.csub, S.cells);    // the click pattern in force: { sub, cells }
export const ramp = () => rampOf(S.ramp, S.bpm);

// ---- what a groove is called: one answer for the car and lock screen, the readout, the home screen, takes and history.
//      Drums keep their loop's genre (a click on top doesn't change a recording: it goes on the album line), except the
//      128 loop, four on the floor, with the off-beat click: disco's open hat over house. Click presets are named by what
//      the click plays, never as the style itself ("Rachenitsa pulse"). A tempo band needs the start tempo and a ramp's cap
//      inside it. Anything unnamed is "{meter} click". The ranges and names are sourced in CLAUDE.md. g: S, or a take. ----
const FEEL = { s:['Shuffle eighths','Shuffle','Triplets with the middle one left out: the long-short lope of blues, boogie-woogie and early rock and roll.'],
  t:['Tresillo 3+3+2','3+3+2','A rhythm with sub-Saharan African roots, central to Cuban music and, through it, to jazz, R&B and rock and roll.'],
  v:['Son clave 3-2','Clave','Son clave’s five strokes, from western Cuba; related bell patterns are found across sub-Saharan Africa. Counted in one bar, as Cuban musicians write it.'],
  v2:['Son clave 2-3','Clave','Son clave’s five strokes, from western Cuba; related bell patterns are found across sub-Saharan Africa. Counted in one bar, as Cuban musicians write it.'],
  d:['One drop pulse','Drop','Beat 1 left empty, the drop on 3: the heart of Jamaican rock steady and reggae drumming.'],
  r:['Train beat · 16ths','Train','Steady sixteenths with 2 and 4 accented: the train beat at the roots of country, often on brushes. Keep the inner notes soft.'] };
const NOTE = { rach:'The grouping of the ordinary Bulgarian rachenitsa (ruchenitsa). Around 210–230 here is dance tempo; slower is for practice.',
  ssq:'3+2+2 is shared: the Greek kalamatianos, lesnoto in North Macedonia and Bulgaria, chetvorno when fast.',
  ballad6:'The slow rolling two of soul, gospel and country ballads and slow blues.', jig:'Two beats of three, as in Irish jigs and 6/8 marches.',
  waltz:'Three to a bar: the slow waltz near 84–90, the Viennese waltz near 174–180.', march:'A steady two, as in a march near 120.',
  chop:'The chop between the bass notes: a bluegrass mandolin’s chop, a polka’s “pah”. Both run across a wide range of tempos.',
  disco:'The open hi-hat on every “and”, as in 1970s disco.', house:'Off-beats over the 128 loop’s four on the floor: disco’s open hat, the root of house.',
  ballad12:'Triplets under a slow four: the 12/8 feel of slow blues, gospel and soul ballads.' };
export const CLICK_WORD = { '1':'quarter', '2':'eighth', '3':'triplet', '4':'sixteenth', b:'backbeat', o:'off-beat', s:'shuffle', t:'tresillo', v:'clave', v2:'clave', d:'one-drop', r:'train-beat', c:'custom' };
// A feel by name, or a custom grid that is exactly one (onsets as fractions of the bar, so 8 and 16 cells both match).
function feelOf(code, M, sub, cells){
  if(FEEL[code]) return patternOk(code, M) ? code : '';
  if(code !== 'c' || M.compound) return '';
  const n = cells.length, on = [], acc = [];
  cells.forEach((v, i) => { if(v){ on.push(i / n); if(v === 3) acc.push(i); } });
  const is = at => on.length === at.length && at.every((f, j) => Math.abs(on[j] - f) < 1e-9), sixteenths = xs => xs.map(i => i / 16);
  if(sub === 3 && on.length === 2 * M.top && on.every(f => Math.round(f * n) % 3 !== 1)) return 's';
  if((M.top === 2 || M.top === 4) && is([0, 3 / 8, 6 / 8])) return 't';
  if(M.top !== 4) return '';
  if(is(sixteenths([0, 3, 6, 10, 12]))) return 'v';
  if(is(sixteenths([2, 4, 8, 11, 14]))) return 'v2';
  if(is([.5])) return 'd';
  if(n === 16 && on.length === 16 && acc.length === 2 && acc[0] === 4 && acc[1] === 12) return 'r';
  return '';
}
// → { long (title, readout: ≤ 22 chars), short (home screen), meter ("7/8 2+2+3"), tag (the meter for the album line when
//     long doesn't say it), note (a line of context for Setup), click (the click's word, for a drums album line), silent }
export function describe(g = S){
  const drums = g.sound !== 'click', bpm = +g.bpm, M = meterOf(drums ? '4' : g.meter, drums ? '' : g.group);
  const code = g.click === 'on' ? '1' : (g.click || 'off'), { sub, cells } = cellsOf(code, M, g.csub, g.cells);
  const silent = !cells.some(v => v), feel = feelOf(code, M, sub, cells), meter = M.label + (M.choices.length > 1 ? ' ' + M.glabel : '');   // 6/8 has one grouping: no "3+3"
  const out = (long, short, note = '') => ({ long, short, meter, tag: drums || /\d\/\d/.test(long) ? '' : meter, note, silent,
                                             click: silent ? '' : CLICK_WORD[feel || code] || '' });
  if(drums) return bpm === 128 && code === 'o' ? out('Disco · house', 'Disco', NOTE.house) : out((groove(bpm) || GROOVES[3])[1], SHORT[bpm] || 'Drums', feel ? FEEL[feel][2] : '');   // a feel over the loop keeps its credit
  const r = rampOf(g.ramp, bpm), band = (lo, hi) => bpm >= lo && bpm <= hi && (!r || (r.cap >= lo && r.cap <= hi));
  const plain = ['1','2','4'].includes(code), top = M.top;
  if(silent) return out('Silent beats', M.label);
  if(feel) return out(...FEEL[feel]);
  if(plain && top === 7 && M.group === '223') return out('Rachenitsa pulse', '2+2+3', NOTE.rach);
  if(plain && top === 7 && M.group === '322') return out('Slow-quick-quick', '3+2+2', NOTE.ssq);
  if(plain && top === 6 && band(40, 80)) return out('6/8 ballad pulse', '6/8', NOTE.ballad6);
  if(plain && top === 6 && band(90, 140)) return out('Jig · march pulse', '6/8', NOTE.jig);
  if(plain && top === 3) return band(78, 96) ? out('Slow waltz pulse', 'Waltz', NOTE.waltz) : band(168, 186) ? out('Viennese waltz pulse', 'Waltz', NOTE.waltz) : out('Waltz time', '3/4', NOTE.waltz);
  if((code === '1' || code === '2') && top === 2 && band(112, 128)) return out('March pulse', 'March', NOTE.march);
  if(code === 'o' && top === 2 && band(80, 200)) return out('Bluegrass · polka', 'Chop', NOTE.chop);
  if(code === 'o' && top === 4 && band(110, 130)) return out('Disco off-beats', 'Disco', NOTE.disco);
  if(code === '3' && top === 4 && band(40, 70)) return out('12/8 ballad pulse', '12/8', NOTE.ballad12);
  return out(`${meter} click`, meter.split(' ').pop());
}
// The home-screen name: "128 G♭ House", "132 C 2+2+3"; a click name that won't fit under an icon (12 characters) falls
// back to the meter rather than being cut. Drums keep their genre whatever the length ("88 D♭ Hip-hop"). Short names are
// ≤ 5 characters so "240 G♭ Clave" fits, except Shuffle (7), which shows only below 100 bpm in a natural key.
// Takes (fit: false) have room, so they always keep the short name.
export function grooveHome(g = S, k = keyLabel(g.key), fit = true){
  const d = describe(g), a = `${g.bpm} ${k} ${d.short}`;
  return !fit || g.sound !== 'click' || a.length <= 12 ? a : `${g.bpm} ${k} ${d.meter.split(' ').pop()}`;
}
// What plays under the title (the album line on the car and lock screen): the drone, and the click's part over drums
// or the meter when the title names a style. "Wash in G♭ · off-beat click", "7/8 2+2+3 · Wash in C", "Screen only".
export function layersLine(g = S, k = keyLabel(g.key)){
  const d = describe(g), wash = g.wash === 'on';
  if(g.sound !== 'click') return wash ? droneLine(g, k) + tuningTag() + (d.click ? ` · ${d.click} click` : '') : d.click ? `${d.click[0].toUpperCase()}${d.click.slice(1)} click` : 'Drums only';
  const base = wash ? droneLine(g, k) + tuningTag() : d.silent ? 'Screen only' : 'Click only';
  return d.tag ? `${d.tag} · ${base}` : base;
}
// The classical term, with accel. or rit. when a ramp moves the tempo.
export const termLine = (term, r = ramp()) => term + (r ? (r.step > 0 ? ' · accel.' : ' · rit.') : '');

// The invariants between settings, applied after a link and after the sound / meter / pattern / ramp controls,
// so a link and a tap always agree: the loops are 4/4 and only come at their seven tempos; the click is exact
// (no Fine) and offers fewer patterns in x/8; custom cells fit the bar; a ramp only goes somewhere.
export function conform(){
  if(S.sound === 'drums'){
    S.meter = '4'; S.group = '';
    if(!TEMPOS.includes(S.bpm)) S.bpm = TEMPOS.reduce((a, b) => Math.abs(b - S.bpm) < Math.abs(a - S.bpm) ? b : a);
  } else {
    S.bpm = Math.max(40, Math.min(240, Math.round(+S.bpm) || 120)); S.fine = '0';
    if(!METERS[S.meter]) S.meter = '4';
    if(S.group && !METERS[S.meter].groups.includes(S.group)) S.group = '';
    if(S.group === METERS[S.meter].groups[0]) S.group = '';
  }
  const M = meter();
  if(S.click === 'on') S.click = '1';
  if(!PATTERNS.some(p => p[0] === S.click)) S.click = 'off';
  if(!patternOk(S.click, M)) S.click = '1';            // x/8 has no triplets, backbeat or off-beats; a backbeat is 2 and 4; the feels have their meters
  const sub = maxSub(M, S.csub);
  if(S.click === 'c') S.cells = Array.from(fitCells(S.cells, Math.round(+S.csub) || sub, sub, M)).join('');
  S.csub = String(sub);
  let r = rampOf(S.ramp, S.bpm);
  if(r && S.sound === 'drums'){                       // the loops stretch at most 8 %, Fine included
    const rate = 1 + (+S.fine || 0) / 100, lim = r.step > 0 ? Math.round(S.bpm * 1.08 / rate) : Math.round(S.bpm / 1.08 / rate);
    r.cap = r.step > 0 ? Math.min(r.cap, lim) : Math.max(r.cap, lim);
    if(r.step > 0 ? r.cap <= S.bpm : r.cap >= S.bpm) r = null;
  }
  S.ramp = rampString(r);
  if(!PROGS.some(p => p[0] === S.prog)) S.prog = 'off';
  if(!PBARS.includes(S.pbars)) S.pbars = '4';
  if(!TUNINGS.includes(S.a4)) S.a4 = '440';
  if(!/^(0|\d+|l\d+|c\d+)$/.test(S.len) || (S.mode === 'groove' ? S.len[0] === 'c' : S.len[0] === 'l')) S.len = '0';
  if(!['off','num','syl'].includes(S.count)) S.count = 'off';
}

// ---- the preset lives in the URL: "72-Eb" plus only the settings that differ from the defaults,
//      e.g. ?p=72-Eb/b8/d4.1/k1  (b = loop bars, c0 = no count-in, d = drop-out on.off, k = click pattern, w0 = no drone, f = fine %).
//      A click preset has a c in front: ?p=c132-C/m7.223/k2/r2.8.160/t10 (m = meter.grouping, r = ramp step.every.cap,
//      t = session length in minutes or tl8 loops, nn / ns = count numbers / syllables). ----
// Breathe presets: "b-4-7-8-0-C" plus h (hum) / n (no drone), k (count cues) / q (no cues), s45 (swell %), t5 / tc12 (length).
// Tune presets: "t-Bb" (the concert key: the drone's) plus iBb/iEb/iF (instrument), n (no drone),
// g72 (drums at 72), lr/lmaj/lmin (root and octave / major / minor scale lines), r1/r2/r3 (lines low / middle / high).
export function presetString(mode = S.mode){
  if(mode === 'tune'){
    const t = [`t-${S.key}`];
    if(S.tinst !== 'C') t.push('i' + S.tinst);
    if(S.tdrone === 'off') t.push('n');
    if(S.tdrums !== '0') t.push('g' + S.tdrums);
    if(S.tlines !== 'rfo') t.push(S.tlines === 'ro' ? 'lr' : 'l' + S.tlines);
    if(S.treg !== 'auto') t.push('r' + S.treg);
    return t.join('/');
  }
  if(mode === 'breathe'){
    const t = [`b-${durs().map(fmtN).join('-')}-${S.key}`];
    if(S.bsound === 'hum') t.push('h'); else if(S.bsound === 'off') t.push('n');
    if(S.bcue === 'count') t.push('k'); else if(S.bcue === 'off') t.push('q');
    if(S.swell !== BDEFAULTS.swell) t.push('s' + S.swell);
    if(S.len !== '0') t.push('t' + S.len);
    return t.join('/');
  }
  const click = isClick(), t = [`${click ? 'c' : ''}${S.bpm}-${S.key}`];
  if(click && (S.meter !== '4' || S.group)) t.push('m' + S.meter + (S.group ? '.' + S.group : ''));
  if(S.bars !== DEFAULTS.bars) t.push('b' + S.bars);
  if(S.countin !== DEFAULTS.countin) t.push('c' + S.countin);
  if(S.drop !== DEFAULTS.drop) t.push('d' + S.drop.replace('-', '.'));
  if(S.click !== (click ? '1' : 'off')) t.push(S.click === 'off' ? 'k0' : S.click === 'c' ? `kc${S.csub}.${S.cells}` : 'k' + S.click);
  if(S.wash !== DEFAULTS.wash) t.push('w0');
  if(S.prog !== 'off') t.push('p' + S.prog + (progOf()[3] || S.pbars === '4' ? '' : '.' + S.pbars));   // p4, p5.2, pbl
  if(!click && +S.fine) t.push('f' + S.fine);
  const r = ramp(); if(r) t.push(`r${r.step}.${r.every}.${r.cap}`);
  if(S.len !== '0') t.push('t' + S.len);
  if(S.count !== 'off') t.push('n' + S.count[0]);
  return t.join('/');
}
// A link is a whole preset: missing tokens mean defaults. Accepts "?p" values and old "#" hashes.
// Returns false (and changes nothing) for anything that isn't a valid preset; a bad token is skipped.
export function applyPreset(str){
  const [head, ...tokens] = (str || '').replace(/^#/, '').split('/');
  const tn = /^t-([A-G]b?)$/.exec(head);
  if(tn){
    if(!CHROMA.includes(tn[1])) return false;
    Object.assign(S, { mode:'tune', key:tn[1] }, TDEFAULTS);
    for(const t of tokens){
      if(t[0] === 'i' && INSTS.some(x => x[0] === t.slice(1))) S.tinst = t.slice(1);
      // (a442/a432 in older links: the tuning is the phone's own setting now, so a link no longer changes it)
      else if(t === 'n') S.tdrone = 'off';
      else if(t[0] === 'g' && TEMPOS.includes(+t.slice(1))) S.tdrums = t.slice(1);
      else if(t === 'lr') S.tlines = 'ro'; else if(t === 'lmaj' || t === 'lmin') S.tlines = t.slice(1);
      else if(/^r[123]$/.test(t)) S.treg = t[1];
    }
    return true;
  }
  const b = /^b-(\d+(?:\.5)?)-(\d+(?:\.5)?)-(\d+(?:\.5)?)-(\d+(?:\.5)?)-([A-G]b?)$/.exec(head);
  if(b){
    const d = b.slice(1, 5).map(Number);
    if(d.some(x => x > 30) || d.every(x => x === 0) || !KEYS.some(k => k[0] === b[5])) return false;
    Object.assign(S, { mode:'breathe', pattern: d.map(fmtN).join('-'), key:b[5] }, { bsound:'wash', bcue:'phase', swell:BDEFAULTS.swell, len:'0' });
    for(const t of tokens){
      if(t === 'h') S.bsound = 'hum'; else if(t === 'n') S.bsound = 'off';
      else if(t === 'k') S.bcue = 'count'; else if(t === 'q') S.bcue = 'off';
      else if(t[0] === 's' && /^\d{1,3}$/.test(t.slice(1)) && +t.slice(1) <= 100) S.swell = String(+t.slice(1));
      else if(t[0] === 't'){ const g = /^(\d{1,3}|c\d{1,3})$/.exec(t.slice(1)), n = g && +(g[1][0] === 'c' ? g[1].slice(1) : g[1]);
        if(g && n >= 1 && n <= (g[1][0] === 'c' ? 200 : 120)) S.len = g[1]; }
    }
    return true;
  }
  const m = /^(c?)(\d{2,3})-([A-G]b?)$/.exec(head);
  if(!m || !KEYS.some(k => k[0] === m[3])) return false;
  const click = m[1] === 'c', bpm = +m[2];
  if(click ? (bpm < 40 || bpm > 240) : !TEMPOS.includes(bpm)) return false;
  Object.assign(S, { mode:'groove', bpm, key:m[3] }, DEFAULTS, { sound: click ? 'click' : 'drums', click: click ? '1' : 'off' });
  for(const t of tokens){
    const v = t.slice(1);
    if(t[0]==='b' && ['4','8','16'].includes(v)) S.bars = v;
    else if(t[0]==='c' && ['0','1'].includes(v)) S.countin = v;
    else if(t[0]==='d' && DROPS.includes(v.replace('.', '-'))) S.drop = v.replace('.', '-');
    else if(t[0]==='k'){ const g = /^(0|[1234bostvdr]|c([1-4])\.([0-3]{2,32}))$/.exec(v);
      if(g){ if(g[1] === '0') S.click = 'off'; else if(g[2]){ S.click = 'c'; S.csub = g[2]; S.cells = g[3]; } else S.click = g[1]; } }
    else if(t==='w0') S.wash = 'off';
    else if(t[0]==='p'){ const g = /^(4|5|6|iv|bl|ch|c4)(?:\.([1248]))?$/.exec(v); if(g){ S.prog = g[1]; S.pbars = g[2] || '4'; } }
    else if(t[0]==='f' && !click && v !== '' && !isNaN(+v) && Math.abs(+v) <= 8) S.fine = String(Math.round(+v));
    else if(t[0]==='m' && click){ const g = /^([2-7])(?:\.(\d+))?$/.exec(v); if(g && METERS[g[1]] && (!g[2] || METERS[g[1]].groups.includes(g[2]))){ S.meter = g[1]; S.group = g[2] || ''; } }
    else if(t[0]==='r'){ const g = /^(-?\d{1,2})\.(\d{1,2})\.(\d{2,3})$/.exec(v);
      if(g && +g[1] && Math.abs(+g[1]) <= 20 && +g[2] >= 1 && +g[2] <= 64 && +g[3] >= 40 && +g[3] <= 240) S.ramp = `${+g[1]}-${+g[2]}-${+g[3]}`; }
    else if(t[0]==='t'){ const g = /^(\d{1,3}|l\d{1,2})$/.exec(v), n = g && +(g[1][0] === 'l' ? g[1].slice(1) : g[1]);
      if(g && n >= 1 && n <= (g[1][0] === 'l' ? 99 : 120)) S.len = g[1]; }
    else if(t==='nn') S.count = 'num'; else if(t==='ns') S.count = 'syl';
  }
  conform();
  return true;
}

// ---- remembered on this device (storage keys unchanged since the first version) ----
const STORE = 'backtrack';
// Each mode remembers its own last preset, so switching modes brings back where you were in that mode.
export function save(){
  let saved = {}; try{ saved = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; }catch(e){}
  const presets = { ...(saved.presets || {}), [S.mode]: presetString() };
  try{ localStorage.setItem(STORE, JSON.stringify({ preset:presetString(), presets, bars:S.bars, countin:S.countin, fine:S.fine, dvol:S.dvol,
                                                    wash:S.wash, wvol:S.wvol, cvol:S.cvol, drop:S.drop, click:S.click, tspeed:S.tspeed, tcents:S.tcents, a4:S.a4 })); }catch(e){}
}
// Switch mode: restore that mode's last preset, keeping the key you're in (a voice's key doesn't change with the mode).
export function switchMode(mode){
  if(mode === S.mode) return false;
  let saved = {}; try{ saved = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; }catch(e){}
  const key = S.key, last = (saved.presets || {})[mode];
  const fresh = mode === 'breathe' ? `b-${BDEFAULTS.pattern}-${key}` : mode === 'tune' ? `t-${key}` : `96-${key}`;
  if(!applyPreset(last || fresh)) applyPreset(fresh);
  S.key = key;
  return true;
}
// ?p=… (current links), then #… (older links), then the last preset on this device, then the default.
// Volumes are per-device mixing taste and never come from a link.
// ---- the phone's own settings travel in a link as a starting point (&d=…, only what isn't default): iOS gives each
//      home-screen shortcut its own storage, so a shortcut made from this page, or someone opening a shared link for the
//      first time, adopts each setting it hasn't saved yet, once. Anything saved wins. (The View adds its own: viewer.js.)
//      a432 tuning · dv/wv/cv volumes in % · ts12 Tune's speed · th cents hidden ----
export function deviceTokens(){
  const t = [];
  if(S.a4 !== '440') t.push('a' + S.a4);
  for(const [k, c, d] of [['dvol','dv',.9],['wvol','wv',.6],['cvol','cv',1]]) if(Math.abs(+S[k] - d) > 1e-6) t.push(c + Math.round(+S[k] * 100));
  if(S.tspeed !== '8') t.push('ts' + S.tspeed);
  if(S.tcents !== 'show') t.push('th');
  return t;
}
function seedDevice(saved){
  const d = new URLSearchParams(location.search).get('d'); if(!d) return;
  for(const t of d.split('/')){
    let m;
    if((m = /^a(440|442|432)$/.exec(t))){ if(saved.a4 == null) S.a4 = m[1]; }
    else if((m = /^(dv|wv|cv)(\d{1,3})$/.exec(t))){ const k = { dv:'dvol', wv:'wvol', cv:'cvol' }[m[1]]; if(saved[k] == null) S[k] = String(Math.min(100, +m[2]) / 100); }
    else if((m = /^ts(4|8|12)$/.exec(t))){ if(saved.tspeed == null) S.tspeed = m[1]; }
    else if(t === 'th'){ if(saved.tcents == null) S.tcents = 'hide'; }
  }
}
export function restore(){
  let saved = {};
  try{ saved = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; }catch(e){}
  for(const k of ['bars','countin','fine','dvol','wash','wvol','cvol','drop','click','tspeed','tcents','a4']) if(saved[k] != null) S[k] = String(saved[k]);
  seedDevice(saved);
  if(S.click === 'on') S.click = '1';                   // saved before the click had patterns
  if(!applyPreset(new URLSearchParams(location.search).get('p')) && !applyPreset(location.hash) && !applyPreset(saved.preset || '')){
    S.bpm = 96; S.key = 'C'; conform();
  }
}

// Everything a preset is made of, plus the device-only mix. No DOM in here.
import { METERS, meterOf, cellsOf, fitCells, maxSub, rampOf, rampString } from './timeline.js';
import { BEATS, KITS, beatOf, kitOf } from './machine.js';
import { NOTES, TONES, notesPreset, tonePreset, levelsOf, hexOf, homeVoicing, leadVoicing } from './synth.js';

// The grooves, slowest to fastest: bpm, the genres that live there, the classical term.
export const GROOVES = [[60,'Slow ballad','Largo'],[72,'Ballad · soul','Adagio'],[88,'Hip-hop','Andante'],[96,'Hip-hop · R&B','Andante'],
                        [108,'Mid-tempo rock','Moderato'],[120,'Pop · rock','Allegro'],[128,'House · dance','Allegro']];
export const TEMPOS = GROOVES.map(g => g[0]);
export const SHORT = {60:'Slow', 72:'Ballad', 88:'Hip-hop', 96:'R&B', 108:'Rock', 120:'Pop', 128:'House'};   // home-screen names
export const KEYS = [['C','C'],['B','B'],['Bb','B♭'],['A','A'],['Ab','A♭'],['G','G'],['Gb','G♭'],['F','F'],['E','E'],['Eb','E♭'],['D','D'],['Db','D♭']];
export const FREQ = {C:130.81,B:123.47,Bb:116.54,A:110,Ab:103.83,G:98,Gb:92.5,F:87.31,E:82.41,Eb:77.78,D:73.42,Db:69.3};
export const DROPS = ['0-0','4-1','4-2','8-4','4-4'];
// ---- drone progressions (Groove): the Wash moves to another root every few bars ----
// [code, menu label, semitones from home per step, bars per step when fixed (the blues: one chord a bar),
//  which steps are minor chords (Moon's iii, Miles's vi: the Synth lowers its third, the cue and the note say "Em")]
export const PROGS = [['off','Off',[0]],['4','Root ↔ 4th',[0,5]],['5','Root ↔ 5th',[0,7]],['6','Root ↔ 6th',[0,9]],
  ['iv','I – IV – V – I',[0,5,7,0]],['mn','Moon',[0,5,4,5],0,[0,0,1,0]],['mi','Miles',[0,9,5,0],0,[0,1,0,0]],['bl','12-bar blues',[0,0,0,0,5,5,0,0,7,5,0,0],1],
  ['ch','Chromatic up',[0,1,2,3,4,5,6,7,8,9,10,11]],['ub','Up and back',[0,1,2,3,4,5,4,3,2,1]],['ld','Ladder',[0]],['c4','Circle of 4ths',[0,5,10,3,8,1,6,11,4,9,2,7]],['x','Custom',[0]]];
// The named progressions' chords in numerals (the menu says only the name; the note spells it out)
const NUMERALS = { mn:'I – IV – iii – IV', mi:'I – vi – IV – I' };
// ---- a progression of your own (S.pcust, the 'x' row above): one chord a step, written as the root in half steps
//      above the key (0–9, a, b) with "m" after it for a minor chord: "09m50" is I – vi – IV – I. Up to 12 steps (a
//      12-bar blues fits); a chord repeated simply lasts longer. The first step is where the count-in sits. ----
export const PMAX = 12;
export const chordSteps = (g = S) => (String(g.pcust || '').match(/[0-9ab]m?/g) || ['0']).slice(0, PMAX).map(s => [parseInt(s[0], 12), s.length > 1]);
export const stepsString = steps => steps.map(([o, m]) => o.toString(12) + (m ? 'm' : '')).join('');
// Custom starts from the progression that was showing, as Click's Custom grid starts from its pattern
export const seedChords = code => { const p = progOf(code); return ['off','ld','x'].includes(p[0]) || p[2].length > PMAX ? '0' : stepsString(p[2].map((o, i) => [o, !!(p[4] && p[4][i])])); };
// ---- a name of your own (S.pname) keeps the progression on this phone: the list below is every named one, shown in
//      the Moves menu under "Yours". The name travels in the link (px09m50~Blue_Moon), so a shortcut or a shared link
//      brings its progression along; the chords are steps above the key, so a kept one plays in any key.
//      Letters, digits, spaces and a little punctuation, up to 20 characters. ----
export const NMAX = 20, KMAX = 40;
export const cleanName = s => String(s || '').normalize('NFC').replace(/[^\p{L}\p{M}\p{N} '’\-–.,!()♭♯]/gu, '').replace(/\s+/g, ' ').trim().slice(0, NMAX).trim();
const KEPT = 'backtrack-chords', sameName = (a, b) => a.toLowerCase() === b.toLowerCase();
let kept = null;                                        // [{ n: name, c: chords (as S.pcust), b: bars a chord }], oldest first
export function keptList(){
  if(kept) return kept;
  kept = [];
  try{ for(const e of JSON.parse(localStorage.getItem(KEPT) || '[]') || []){
    const n = cleanName(e && e.n), c = (String(e && e.c || '').match(/[0-9ab]m?/g) || []).slice(0, PMAX).join('');
    if(n && c && !kept.some(k => sameName(k.n, n)) && kept.length < KMAX) kept.push({ n, c, b: PBARS.includes(String(e.b)) ? String(e.b) : '4' });
  } }catch(e){}
  return kept;
}
const keptWrite = () => { try{ localStorage.setItem(KEPT, JSON.stringify(kept)); }catch(e){} };
export const keptFind = name => keptList().find(k => sameName(k.n, name || '')) || null;
// Keep the progression showing under its name (new, or the latest version of one already kept). False when the list is full.
export function keepChords(g = S){
  if(progCode(g) !== 'x' || !g.pname) return false;
  const k = keptFind(g.pname), e = { n: g.pname, c: g.pcust || '0', b: g.pbars };
  if(k) Object.assign(k, e); else { if(keptList().length >= KMAX) return false; kept.push(e); }
  keptWrite(); return true;
}
export function renameKept(old, name){ const k = keptFind(old); if(k){ k.n = name; keptWrite(); } return !!k; }
// Forget one: returns what it was and where it sat, for the toast's "Keep it"
export function forgetKept(name){
  const i = keptList().findIndex(k => sameName(k.n, name || '')); if(i < 0) return null;
  const [entry] = kept.splice(i, 1); keptWrite(); return { entry, i };
}
export function restoreKept({ entry, i }){ if(keptFind(entry.n) || keptList().length >= KMAX) return false; kept.splice(Math.min(i, kept.length), 0, entry); keptWrite(); return true; }
const ROMAN = ['I','♭II','II','♭III','III','IV','♯IV','V','♭VI','VI','♭VII','VII'];
export const numeral = (off, minor = false) => minor ? ROMAN[off].toLowerCase() : ROMAN[off];
export const PBARS = ['1','2','4','8'];
// The tuning: the phone's own setting (like the volumes), for every mode. A = 440, 442 or 432: the Wash plays at a4/440
// (432 is 1.818 % slower, −31.8 cents) and every synthesized tone (cues, hum, reference tones) is scaled the same way.
export const TUNINGS = ['440','442','432'];
export const tuning = () => +S.a4 / 440;
export const tuningTag = () => S.a4 === '440' ? '' : ` · A=${S.a4}`;
const WASH_UP = ['Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B','C'];   // the Wash recordings, low to high: D♭2 … C3
// ---- the ladder: the drone climbs a scale a step at a time to the top of a span, and comes back down to where it
//      started. A generated progression ('ld'), in Groove (Drone ▸ Moves) and in Tune (g.tlad), from one definition:
//      the scale's degrees up to the span, then back, home once a round. ----
export const LSCALES = [['c','Half steps',[0,1,2,3,4,5,6,7,8,9,10,11,12]],['maj','Major scale',[0,2,4,5,7,9,11,12]],['min','Minor scale',[0,2,3,5,7,8,10,12]],
  ['pen','Pentatonic',[0,2,4,7,9,12]],['wt','Whole steps',[0,2,4,6,8,10,12]]];
export const LSPANS = [['3','a 3rd',4],['4','a 4th',5],['5','a 5th',7],['8','an octave',12]];
export const LSECS = ['4','6','8','12','16'];
const lscale = g => LSCALES.find(x => x[0] === g.lscale) || LSCALES[0];
// The top of the ladder in semitones: the span's note in the scale (a minor scale's 3rd is 3), or 0 when the scale
// has no such note (a pentatonic has no 4th).
export function ladderTop(g = S, span = g.lspan){
  const d = lscale(g)[2], sp = LSPANS.find(x => x[0] === span) || LSPANS[2];
  return d.includes(sp[2]) ? sp[2] : sp[0] === '3' && d.includes(3) ? 3 : 0;
}
export const ladderSpans = (g = S) => LSPANS.filter(x => ladderTop(g, x[0]) > 0);
export function ladderOffs(g = S){
  const top = ladderTop(g) || 7, up = lscale(g)[2].filter(x => x <= top);
  return [...up, ...up.slice(1, -1).reverse()];
}
// How far above home a ladder stands in bar `bar`, in semitones (0 without a ladder, and in the count-in).
export const ladderOff = (bar, g = S) => { if(progCode(g) !== 'ld' || bar < 0) return 0; const o = ladderOffs(g); return o[Math.floor(bar / progEvery(g)) % o.length]; };
// Which progression a setup (S or a take) plays: Groove's own, Tune's ladder, none in Breathe and Noise.
export const progCode = (g = S) => g.mode === 'tune' ? (g.tlad === 'on' ? 'ld' : 'off') : g.mode === 'breathe' || g.mode === 'noise' ? 'off' : g.prog || 'off';
export const progOf = (code = progCode(S)) => PROGS.find(p => p[0] === code) || PROGS[0];
export const progOffs = (g = S) => progCode(g) === 'ld' ? ladderOffs(g) : progCode(g) === 'x' ? chordSteps(g).map(s => s[0]) : progOf(progCode(g))[2];
const progQual = g => progCode(g) === 'x' ? chordSteps(g).map(s => s[1]) : progOf(progCode(g))[4];   // which steps are minor
// bars per step (Tune: bars of its drums, or one bar of its silent timeline, which lasts the step's seconds)
export const progEvery = (g = S) => progOf(progCode(g))[3] || (g.mode === 'tune' ? (+g.tdrums ? +g.tlbars || 2 : 1) : +g.pbars || 4);
// The drone in bar `bar` (any context: S or a take): the step's pitch class in the octave nearest home, within B1 … D3
// (index −2 … 13 here: the D♭2 recording pitch-shifted down one or two half steps for C2 and B1, the top C up one or
// two for D♭3 and D3; a tie, the tritone, takes the lower). Up and back walks a 4th up and back, or down and back from
// the top keys (B♭, B, C: no room above), so every move is a half step. The count-in (bars below 0) is the first step:
// home, in every progression but one of your own that starts on another chord.
// → { key (the recording), rate (its pitch shift), note (the pitch class, a KEYS id) }
const LO = -2, HI = 13;
// Is the chord on this bar minor? (the count-in is the first step)
export const progMinor = (bar, g = S) => { const q = progQual(g); return !!q && !!q[bar < 0 ? 0 : Math.floor(bar / progEvery(g)) % q.length]; };
// Does the drone sound a third? Only the Synth with harmonic 5 or 10 (Major, Seventh); the Wash and the Shruti box are root and fifth.
export const hasThird = (g = S) => g.dsrc === 'synth' && [4, 9].some(i => levelsOf(g.snotes)[i] > 0);
const walksDown = g => progCode(g) === 'ub' && WASH_UP.indexOf(g.key) + 5 > HI;
// A ladder climbs straight up from home (no folding into the octave nearest home). The Wash can play it when its top
// fits under D3; the Synth plays any (its pitch is a frequency, with no range).
export const ladderFits = (g = S) => WASH_UP.indexOf(g.key) + (ladderTop(g) || 7) <= HI;
const recOf = idx => ({ key: idx > 11 ? 'C' : idx < 0 ? 'Db' : WASH_UP[idx], rate: idx > 11 ? Math.pow(2, (idx - 11) / 12) : idx < 0 ? Math.pow(2, idx / 12) : 1 });
// ---- a routine's key walk (Arrive in a key): home steps a half step at a time, every R.every bars, from offset R.from
//      to R.to (semitones from g.key); a progression rides on the walking home. R comes from the session's timeline
//      (tl.routine) or a take. The count-in is where the walk starts. ----
export const walkOff = (bar, R) => { if(!R) return 0; if(bar < 0 || R.to === R.from) return R.from; return R.from + Math.sign(R.to - R.from) * Math.min(Math.floor(bar / R.every), Math.abs(R.to - R.from)); };
export function droneAt(bar, g = S, R = null){
  const code = progCode(g), offs = progOffs(g), h = WASH_UP.indexOf(g.key) + walkOff(bar, R);
  let off = offs[bar < 0 ? 0 : Math.floor(bar / progEvery(g)) % offs.length];
  if(walksDown(g)) off = -off;
  const pc = ((h + off) % 12 + 12) % 12;
  if(code === 'ld' && (g.dsrc === 'synth' || ladderFits(g))){        // straight up: within the Wash's range, or the synth beyond it
    const i = h + off, hc = Math.max(LO, Math.min(HI, i)), r = recOf(hc);
    return { key: r.key, rate: r.rate * Math.pow(2, (i - hc) / 12), note: WASH_UP[pc] };
  }
  const idx = [pc - 12, pc, pc + 12].filter(i => i >= LO && i <= HI).reduce((a, b) => Math.abs(b - h) < Math.abs(a - h) ? b : a);
  return { ...recOf(idx), note: WASH_UP[pc] };
}
// The walk a setup asks for: semitones from the key to the key to arrive in, the shorter way round (a tie goes down),
// unless that way leaves the Wash's range (B1 … D3), in which case the other. 0 when there is nowhere to go.
export function walkOf(g = S){
  if(!g.tokey || g.tokey === g.key || !WASH_UP.includes(g.tokey)) return 0;
  const h = WASH_UP.indexOf(g.key), up = ((WASH_UP.indexOf(g.tokey) - h) % 12 + 12) % 12, down = up - 12;
  const pick = up < -down ? up : down, other = pick === up ? down : up, fits = o => h + o >= LO && h + o <= HI;
  return fits(pick) ? pick : fits(other) ? other : pick;
}
// The recordings a walk passes through (to fetch them ahead).
export function walkKeys(g = S){
  const to = walkOf(g), h = WASH_UP.indexOf(g.key), keys = [];
  for(let i = 0; i <= Math.abs(to); i++) keys.push(recOf(h + Math.sign(to) * i).key);
  return keys;
}
// Where a Groove routine arrives, in words: "to 60 bpm in E", "to E", "to 60 bpm", "" (nowhere).
export function arriveLine(g = S){
  const t = g.tobpm && +g.tobpm !== +g.bpm ? `${g.tobpm} bpm` : '', k = g.tokey && g.tokey !== g.key ? keyLabel(g.tokey) : '';
  return t && k ? `to ${t} in ${k}` : t ? `to ${t}` : k ? `to ${k}` : '';
}
export const glideDir = (g = S) => g.tobpm && +g.tobpm !== +g.bpm ? Math.sign(+g.tobpm - +g.bpm) : 0;
// A session length in words: "20 min", "8 loops", "12 cycles", "until 7:30 PM". '@HH:MM' ends at that time of day.
export const untilLabel = len => { const d = new Date(); d.setHours(+len.slice(1, 3), +len.slice(4, 6), 0, 0); return 'until ' + d.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' }); };
export const lenLabel = (len = S.len) => len === '0' ? 'Off' : len[0] === '@' ? untilLabel(len) : len[0] === 'l' ? `${len.slice(1)} loops` : len[0] === 'c' ? `${len.slice(1)} cycles` : `${len} min`;
// The time of day a '@HH:MM' length ends at, as a timestamp: today, or tomorrow if that time has (all but) passed.
export function untilMs(len, now = Date.now()){
  const d = new Date(now); d.setHours(+len.slice(1, 3), +len.slice(4, 6), 0, 0);
  if(d.getTime() < now + 20000) d.setDate(d.getDate() + 1);
  return d.getTime();
}
// Solfège for a ladder's step, movable do. Major, and the pentatonic (five of its notes): Do = the pitch it starts from.
// Minor is la-based (David's choice, 2026-11-17): the same seven syllables from La, so the starting pitch is La and the
// half steps stay Ti–Do and Mi–Fa. '' for half steps and whole steps, which keep their note names.
const SOLFA = { 0:'Do', 2:'Re', 4:'Mi', 5:'Fa', 7:'Sol', 9:'La', 11:'Ti', 12:'Do' };
const SOLMIN = { 0:'La', 2:'Ti', 3:'Do', 5:'Re', 7:'Mi', 8:'Fa', 10:'Sol', 12:'La' };
export const solfa = (off, g = S) => progCode(g) !== 'ld' ? '' : (g.lscale === 'min' ? SOLMIN : g.lscale === 'maj' || g.lscale === 'pen' ? SOLFA : {})[off] || '';
// A ladder's notes, spelled for its key: sharps from the sharp keys (A major: C♯, not D♭), flats from the rest.
// A minor ladder reads its relative major's signature (G minor: B♭, not A♯), so only E and B minor take sharps.
const SHARPN = { Db:'C♯', Eb:'D♯', Gb:'F♯', Ab:'G♯', Bb:'A♯' };
export const ladNote = (g, off) => { const id = WASH_UP[(((WASH_UP.indexOf(g.key) + off) % 12) + 12) % 12];
  return (g.lscale === 'min' ? ['E','B'] : ['G','D','A','E','B']).includes(g.key) && SHARPN[id] ? SHARPN[id] : keyLabel(id); };
const noteFrom = (g, off) => keyLabel(WASH_UP[(((WASH_UP.indexOf(g.key) + off) % 12) + 12) % 12]);
// A note's name by its degree in the major key (III in A is C♯, ♭VII in A is G, IV in F is B♭). A name that would
// need a double accidental, or C♭ F♭ E♯ B♯, takes the plain one (IV in G♭ reads B).
const LETTER = 'CDEFGAB', LPC = [0,2,4,5,7,9,11], DEGREE = [0,1,1,2,2,3,3,4,5,5,6,6];
export const degName = (off, g = S) => {
  off = ((off % 12) + 12) % 12;
  const pc = (CHROMA.indexOf(g.key) + off) % 12, li = (LETTER.indexOf(keyLabel(g.key)[0]) + DEGREE[off]) % 7, acc = ((pc - LPC[li] + 18) % 12) - 6;
  const nm = LETTER[li] + (acc === 1 ? '♯' : acc === -1 ? '♭' : '');
  return Math.abs(acc) > 1 || ['C♭','F♭','E♯','B♯'].includes(nm) ? keyLabel(CHROMA[pc]) : nm;
};
// A chord's name in the major-key progressions (I – IV – V, Moon, Miles, your own): spelled for the key (Moon in A: C♯m, not D♭m)
export const chordLabel = (id, g = S, minor = false) =>
  (['iv','mn','mi','x'].includes(progCode(g)) ? degName(CHROMA.indexOf(id) - CHROMA.indexOf(g.key), g) : keyLabel(id)) + (minor ? 'm' : '');
// Your own progression, as names ("C", "Am") and numerals ("I", "vi"); short: its own name, else the numerals up to four chords, then a count
export const chordNames = (g = S) => chordSteps(g).map(([o, m]) => degName(o, g) + (m ? 'm' : ''));
export const chordNumerals = (g = S) => chordSteps(g).map(([o, m]) => numeral(o, m));
const ownShort = g => { if(g.pname) return g.pname; const n = chordNumerals(g); return n.length <= 4 ? n.join('–') : `${n.length} chords`; };   // its name, once it has one
// What the drone does, in words: the album and guide line ("Wash C ↔ F"), the glance row's caption ("↔ F · every 4"),
// and Setup's note under the menus ("C → F → C → F, a move every 4 bars").
export function droneLine(g = S, k = keyLabel(g.key)){
  const p = progOf(progCode(g)), w = droneWord(g);
  return p[0] === 'off' ? `${w} in ${k}` : p[0] === 'x' ? `${w}: ${ownShort(g)} in ${k}` : p[2].length === 2 ? `${w} ${k} ↔ ${noteFrom(g, p[2][1])}` : p[0] === 'iv' ? `${w}: I–IV–V in ${k}` : NUMERALS[p[0]] ? `${w}: ${p[1]} in ${k}`
    : p[0] === 'bl' ? `${w}: 12-bar blues in ${k}` : p[0] === 'ch' ? `${w}: chromatic from ${k}`
    : p[0] === 'ld' ? `${w}: ${ladderWords(g)} from ${k}`
    : p[0] === 'ub' ? `${w}: ${walksDown(g) ? 'down' : 'up'} and back from ${k}` : `${w}: circle of 4ths from ${k}`;
}
// "up a 5th and back" (half steps), "up a major scale to the 5th and back"
export function ladderWords(g = S){
  const sp = (LSPANS.find(x => x[0] === g.lspan) || LSPANS[2])[1], sc = lscale(g);
  return sc[0] === 'c' ? `up ${sp} and back` : `${sc[1].toLowerCase()} up ${sp} and back`;
}
// How long a ladder's step lasts, in words: "every 8 s" (Tune without drums), "every 2 bars"
export const ladderEvery = (g = S) => g.mode === 'tune' && !+g.tdrums ? `every ${g.tlsec} s` : `every ${progEvery(g) === 1 ? 'bar' : progEvery(g) + ' bars'}`;
export function progShort(g = S){
  const p = progOf(progCode(g)), every = ` · every ${progEvery(g)}`;
  if(p[0] === 'ld') return `${ladderWords(g)} · ${ladderEvery(g)}`;
  return p[0] === 'off' ? '' : p[0] === 'x' ? ownShort(g) + every : p[2].length === 2 ? `↔ ${noteFrom(g, p[2][1])}${every}` : p[0] === 'iv' ? `I–IV–V${every}` : NUMERALS[p[0]] ? `${p[1]}${every}`
    : p[0] === 'bl' ? '12-bar blues' : p[0] === 'ch' ? `chromatic${every}` : p[0] === 'ub' ? `${walksDown(g) ? 'down' : 'up'} and back${every}` : `circle of 4ths${every}`;
}
export function progNote(g = S){
  const p = progOf(progCode(g)), n = progEvery(g), ns = p[2].map((o, i) => chordLabel(WASH_UP[(((WASH_UP.indexOf(g.key) + o) % 12) + 12) % 12], g, !!(p[4] && p[4][i]))), every = `, a move every ${n === 1 ? 'bar' : n + ' bars'}`;
  if(p[0] === 'off') return '';
  if(p[0] === 'x') return chordNames(g).join(' → ');                  // (the Drone panel's button to the Chords editor)
  if(p[0] === 'ld'){ const offs = ladderOffs(g), up = offs.slice(0, offs.length / 2 + 1).map(o => ladNote(g, o));
    const fold = g.dsrc !== 'synth' && !ladderFits(g);
    const oct = offs[up.length - 1] === 12, list = up.length > 6 ? up.slice(0, 3).join(', ') + ' … ' + (oct ? 'the ' + up[0] + ' above' : up[up.length - 1]) : up.join(', ');
    const syl = offs.slice(0, up.length).map(o => solfa(o, g)), sung = syl[0] ? ` The cue names each step in solfège: ${syl.join(', ')}.` : '';
    return `${list}, then back down to ${up[0]}, a move ${ladderEvery(g)}.${sung}${fold ? ' The Wash has no room to climb that far from ' + up[0] + ', so it drops an octave on the way; the Synth climbs straight.' : ''}`; }
  if(p[0] === 'ub'){ const d = walksDown(g), ws = [0, 1, 2, 3, 4, 5].map(o => noteFrom(g, d ? -o : o));
    return `${ws.join(', ')}, then back ${d ? 'up' : 'down'} to ${ws[0]}${every}. A half step each move${d ? ' (no room above ' + ws[0] + ', so it walks down)' : ''}.`; }
  if(p[0] === 'bl') return `${ns.slice(0, 4).join(' ')} · ${ns.slice(4, 8).join(' ')} · ${ns.slice(8).join(' ')}, one chord a bar, then round again.`;
  if(p[2].length === 12) return `${ns.slice(0, 4).join(', ')} … ${ns[11]}, then home${every}. Each note sits in the octave nearest ${ns[0]}.`;
  return `${(p[2].length === 2 ? [...ns, ...ns] : ns).join(' → ')}${NUMERALS[p[0]] ? ` (${NUMERALS[p[0]]})` : ''}${every}. Each note sits in the octave nearest ${ns[0]}.`;   // the menu says only the name
}
// sound: the drum loop, or the click alone at any tempo. meter/group: pulses per bar and their grouping (click only;
// the loops are 4/4). click: the pattern code (see PATTERNS); csub/cells: the custom grid. ramp: 'step-every-cap'.
// len: a session length ('0', minutes, 'l8' loops, 'c20' cycles). count: what the beats view writes in its cells.
// beat / kit: a drum machine's beat on the click's timeline (machine.js; '' = none) and the machine that plays it.
// tobpm / tokey: where a session with a length arrives (Setup ▸ Practice ▸ Tempo ramp ▸ Over the session): '' keeps.
export const DEFAULTS = {beat:'', kit:'808', prog:'off', pbars:'4', pcust:'', pname:'', lscale:'c', lspan:'5', bars:'16', countin:'1', drop:'0-0', click:'off', wash:'on', fine:'0', sound:'drums', meter:'4', group:'', csub:'2', cells:'', ramp:'0', len:'0', count:'off', tobpm:'', tokey:''};
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
export const TDEFAULTS = {tinst:'C', tlines:'rfo', treg:'auto', tdrone:'wash', tdrums:'0', tlad:'off', tlsec:'8', tlbars:'2', lscale:'c', lspan:'5'};
// ---- Noise mode (noise.js plays it): a color, a five-band EQ (dB, '.'-joined), waves (period in s, 0 = off) and their
//      depth (%). The level (nvol) is the phone's own, like the other volumes. ----
// tosound (a texture or a color), towave, toswell: where a timed session arrives ('' keeps what it started with).
export const NDEFAULTS = {ncolor:'pink', neq:'0.0.0.0.0', nwave:'0', nswell:'50', tosound:'', towave:'', toswell:''};
export const NCOLORS = [['white','White'],['pink','Pink'],['brown','Brown'],['grey','Grey'],['blue','Blue'],['violet','Violet']];
export const NNOTES = { white:'Equal energy at every frequency: bright and hissy.', pink:'Equal energy in every octave: softer and fuller than white.',
  brown:'Falls 6 dB an octave: deep and rumbly.', grey:'Pink with the lows and highs lifted, where the ear hears less: closer to even across the range.',
  blue:'Rises 3 dB an octave: bright and airy.', violet:'Rises 6 dB an octave: very bright, mostly highs.' };
export const NWAVES = ['0','6','8','10','12','16'];
// Textures: plain names for a color and an EQ (Surf adds waves). [id, label, color, eq, waves, depth]
export const TEXTURES = [['deep','Deep','brown','3.0.-2.-6.-9','0','50'], ['fan','Fan','pink','-2.3.0.-4.-10','0','50'],
  ['rain','Soft rain','pink','-6.-2.1.3.0','0','50'], ['falls','Waterfall','white','2.2.0.-3.-6','0','50'], ['surf','Surf','brown','0.0.0.-2.-4','10','60']];
// The texture these settings are (waves on a still texture keep its name), or the color: "Soft rain", "Pink noise".
export const textureOf = (g = S) => TEXTURES.find(t => t[2] === g.ncolor && t[3] === g.neq && (t[4] === '0' || (t[4] === g.nwave && t[5] === g.nswell)));
export const noiseName = (g = S) => { const t = textureOf(g); return t ? t[1] : `${(NCOLORS.find(c => c[0] === g.ncolor) || NCOLORS[1])[1]} noise`; };
// Where a Noise routine arrives: the sound (a texture brings its color, EQ and, if it has them, waves; a color keeps the
// EQ), the waves and their depth, each only where it differs from the start. null when nothing moves or no length is set.
export function noiseTo(g = S){
  const t = TEXTURES.find(x => x[0] === g.tosound), c = !t && NCOLORS.find(x => x[0] === g.tosound);
  const to = { color: t ? t[2] : c ? c[0] : g.ncolor, neq: t ? t[3] : g.neq, nwave: g.towave !== '' ? g.towave : t && t[4] !== '0' ? t[4] : g.nwave,
               nswell: g.toswell !== '' ? g.toswell : t && t[4] !== '0' ? t[5] : g.nswell };
  if(to.color === g.ncolor && to.neq === g.neq && to.nwave === g.nwave && (to.nswell === g.nswell || (to.nwave === '0' && g.nwave === '0'))) return null;
  const name = t ? t[1] : c ? `${c[1]} noise` : '';
  return { ...to, name, line: [name, to.nwave !== g.nwave || to.nswell !== g.nswell ? (to.nwave === '0' ? 'still' : `waves ${to.nwave} s` + (to.nswell !== g.nswell ? ` · depth ${to.nswell}` : '')) : ''].filter(Boolean).join(' · ') };
}
export const CHROMA = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
export const inst = (i = S.tinst) => INSTS.find(x => x[0] === i) || INSTS[0];
export const writtenKey = (k = S.key, i = S.tinst) => CHROMA[(CHROMA.indexOf(k) + inst(i)[2]) % 12];
export const tuneLabel = () => `Tune in ${keyLabel(writtenKey())}` + (S.tinst === 'C' ? '' : ` (${inst()[1]})`);      // "Tune in C (B♭)"
export const tuneHome = () => (S.tinst === 'C' ? '' : inst()[1] + ' ') + `Tune in ${keyLabel(writtenKey())}`;        // "B♭ Tune in C": fits under an icon

// what the drone plays depends on the mode: the Wash on/off in Groove, the sound choice in Breathe, on/off in Tune
export const washWanted = () => S.mode === 'noise' ? false : S.mode === 'breathe' ? S.bsound === 'wash' : S.mode === 'tune' ? S.tdrone === 'wash' : S.wash === 'on';

// The beat-view lab: read before the first render rewrites the URL, and carried along in it afterwards.
export const LAB = new URLSearchParams(location.search).has('lab');
// The audio x-ray (a debug overlay for the audio engine): the same, with ?xray.
export const XRAY = new URLSearchParams(location.search).has('xray');

// The live settings. Values are strings as the controls hold them, except bpm.
// tspeed (seconds across the pitch line) and tcents (show the cents) are per-device, like the volumes.
// ---- the drone's source in Groove, Breathe and Tune: the Wash, or the harmonic synth (synth.js). Part of each mode's
//      preset. snotes / stone: the Notes (harmonics of the root) and the Tone (each note's harmonics) as hex levels;
//      soct: the fundamental's octave (1 low · 2 middle · 3 high); stemp: pure or even. A new synth is a reed shruti box. ----
export const SDEFAULTS = { dsrc:'wash', snotes:'0fb9', stone:'f08050402020101', soct:'2', stemp:'pure' };
export const synthOn = (g = S) => g.dsrc === 'synth';
export const notesName = (g = S) => (notesPreset(g.snotes) || [, 'Harmonics'])[1];
export const toneName = (g = S) => (tonePreset(g.stone) || [, 'Custom'])[1];
// What the drone is, in a word or three: "Wash", "Reed shruti box", "Organ seventh", "Synth harmonics" (custom both ways)
export const droneWord = (g = S) => g.dsrc !== 'synth' ? 'Wash' : `${tonePreset(g.stone) ? toneName(g) : 'Synth'} ${notesName(g).toLowerCase()}`;
// The synth's fundamental (harmonic 1) for a drone step d = droneAt(bar): the Wash's root for that step, its pitch shift,
// the tuning, and the octave (middle = the Wash's own register).
export const synthF = (d, g = S, tune = tuning()) => FREQ[d.key] * d.rate * tune * Math.pow(2, (+g.soct || 2) - 2);
export const synthSpec = (g = S) => ({ notes: g.snotes, tone: g.stone, temp: g.stemp });
// The synth's voicing in bar `bar` (S or a take; R a routine's walk): home until the drone first moves, then each move
// voice-led from the one before (leadVoicing: the bass takes the root, the rest move to the nearest chord notes). A pure
// function of the bar, worked out from home in order and cached, so a take or a file voices every move as heard.
const voicings = new Map();
export function synthVoicing(bar, g = S, R = null, tune = tuning()){
  const ld = progCode(g) === 'ld', key = [g.key, progCode(g), progEvery(g), ld ? g.lscale + g.lspan : progCode(g) === 'x' ? g.pcust : '', g.snotes, g.stemp, g.soct, tune, R ? JSON.stringify(R) : ''].join('|');
  let c = voicings.get(key);
  if(!c){
    if(voicings.size > 12) voicings.clear();
    const d = droneAt(-1, g, R), m = progMinor(-1, g), home = homeVoicing(g.snotes, g.stemp, synthF(d, g, tune), m);
    voicings.set(key, c = { bars:[-1], v:[home], home, last:-1, d, m });
  }
  for(; c.last < bar; c.last++){
    const b = c.last + 1, d = droneAt(b, g, R), m = progMinor(b, g);
    if(d.key === c.d.key && Math.abs(d.rate - c.d.rate) < 1e-9 && m === !!c.m) continue;
    // a ladder moves the whole stack in parallel (the anchor keeps one shape); other progressions are voice-led
    c.bars.push(b); c.v.push(ld ? homeVoicing(g.snotes, g.stemp, synthF(d, g, tune)) : leadVoicing(c.v[c.v.length - 1], g.snotes, g.stemp, synthF(d, g, tune), c.home, m)); c.d = d; c.m = m;
  }
  let i = c.bars.length - 1; while(i > 0 && c.bars[i] > bar) i--;
  return c.v[i];
}
// Link tokens, all starting with y (no mode uses y): ys synth · yn<preset> or yn:<hex> notes · yt<preset> or yt:<hex>
// tone · yo1 / yo3 octave · ye even. Only what differs from a new synth.
export function synthTokens(){
  if(S.dsrc !== 'synth') return [];
  const t = ['ys'], n = notesPreset(S.snotes), o = tonePreset(S.stone);
  if(S.snotes !== SDEFAULTS.snotes) t.push('yn' + (n ? n[0] : ':' + S.snotes));
  if(S.stone !== SDEFAULTS.stone) t.push('yt' + (o ? o[0] : ':' + S.stone));
  if(S.soct !== SDEFAULTS.soct) t.push('yo' + S.soct);
  if(S.stemp === 'even') t.push('ye');
  return t;
}
export function synthToken(t){
  let g;
  if(t === 'ys') S.dsrc = 'synth';
  else if((g = /^yn(?::([0-9a-f]{1,16})|([a-z]+))$/.exec(t))){ const p = g[2] && NOTES.find(x => x[0] === g[2]), h = p ? p[2] : g[1] && hexOf(levelsOf(g[1])); if(h && h !== '0') S.snotes = h; }
  else if((g = /^yt(?::([0-9a-f]{1,16})|([a-z]+))$/.exec(t))){ const p = g[2] && TONES.find(x => x[0] === g[2]), h = p ? p[2] : g[1] && hexOf(levelsOf(g[1])); if(h && h !== '0') S.stone = h; }
  else if((g = /^yo([123])$/.exec(t))) S.soct = g[1];
  else if(t === 'ye') S.stemp = 'even';
  else return false;
  return true;
}

export const S = { mode:'groove', bpm:96, key:'C', ...DEFAULTS, ...BDEFAULTS, ...TDEFAULTS, ...NDEFAULTS, ...SDEFAULTS, dvol:'0.9', wvol:'0.6', cvol:'1', nvol:'0.6', tspeed:'8', tcents:'show', a4:'440' };

export const keyLabel = (k = S.key) => (KEYS.find(x => x[0] === k) || [k, k])[1];
export const groove = (bpm = S.bpm) => GROOVES[TEMPOS.indexOf(bpm)];   // [bpm, genre, classical]; undefined for a click tempo
export const isClick = () => S.sound === 'click';                          // a free tempo: the click alone, or a drum machine
export const isMachine = (g = S) => g.sound === 'click' && !!g.beat;      // a drum machine's beat (4/4, on the click's timeline)
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
  if(!drums && g.beat && beatOf(g.beat)){ const B = beatOf(g.beat);   // a drum machine: named by its beat, the machine on the album line
    return { long:B.name, short:B.short, meter, tag:'', note:B.note, silent:false, click: silent ? '' : CLICK_WORD[feel || code] || '', kit:kitOf(g.kit).name }; }
  if(drums) return bpm === 128 && code === 'o' ? out('Disco · house', 'Disco', NOTE.house) : out((groove(bpm) || GROOVES[3])[1], SHORT[bpm] || 'Drums', feel ? FEEL[feel][2] : '');   // a feel over the loop keeps its credit
  const r = rampOf(g.ramp, bpm) || (glideDir(g) ? { cap:+g.tobpm, step:glideDir(g) } : null), band = (lo, hi) => bpm >= lo && bpm <= hi && (!r || (r.cap >= lo && r.cap <= hi));   // (a glide's destination counts as the cap)
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
  return !fit || g.sound !== 'click' || g.beat || a.length <= 12 ? a : `${g.bpm} ${k} ${d.meter.split(' ').pop()}`;
}
// What plays under the title (the album line on the car and lock screen): the drone, and the click's part over drums
// or the meter when the title names a style. "Wash in G♭ · off-beat click", "7/8 2+2+3 · Wash in C", "Screen only".
export function layersLine(g = S, k = keyLabel(g.key)){
  const d = describe(g), wash = g.wash === 'on';
  if(g.sound !== 'click') return wash ? droneLine(g, k) + tuningTag() + (d.click ? ` · ${d.click} click` : '') : d.click ? `${d.click[0].toUpperCase()}${d.click.slice(1)} click` : 'Drums only';
  if(d.kit) return d.kit + (wash ? ' · ' + droneLine(g, k) + tuningTag() : '') + (d.click ? ` · ${d.click} click` : '');   // "TR-909 · Wash in C"
  const base = wash ? droneLine(g, k) + tuningTag() : d.silent ? 'Screen only' : 'Click only';
  return d.tag ? `${d.tag} · ${base}` : base;
}
// The classical term, with accel. or rit. when a ramp moves the tempo.
export const termLine = (term, r = ramp()) => { const d = r ? Math.sign(r.step) : glideDir(); return term + (d > 0 ? ' · accel.' : d < 0 ? ' · rit.' : ''); };

// The invariants between settings, applied after a link and after the sound / meter / pattern / ramp controls,
// so a link and a tap always agree: the loops are 4/4 and only come at their seven tempos; the click is exact
// (no Fine) and offers fewer patterns in x/8; custom cells fit the bar; a ramp only goes somewhere.
export function conform(){
  if(!KITS.some(k => k.id === S.kit)) S.kit = '808';
  if(S.sound === 'drums'){
    S.meter = '4'; S.group = ''; S.beat = '';
    if(!TEMPOS.includes(S.bpm)) S.bpm = TEMPOS.reduce((a, b) => Math.abs(b - S.bpm) < Math.abs(a - S.bpm) ? b : a);
  } else {
    S.bpm = Math.max(40, Math.min(240, Math.round(+S.bpm) || 120)); S.fine = '0';
    if(S.beat && !beatOf(S.beat)) S.beat = '';
    if(S.beat){ S.meter = '4'; S.group = ''; }                    // the beats are one bar of sixteenths
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
  // where the session arrives: a loop tempo on drums (the nearest), 40–240 on the click, a key; nothing when it's where it starts
  if(S.tobpm !== ''){
    let v = Math.round(+S.tobpm) || 0;
    if(S.sound === 'drums') v = TEMPOS.reduce((a, b) => Math.abs(b - v) < Math.abs(a - v) ? b : a); else v = Math.max(40, Math.min(240, v));
    S.tobpm = v === S.bpm ? '' : String(v);
  }
  if(!KEYS.some(k => k[0] === S.tokey) || S.tokey === S.key) S.tokey = '';
  if(S.tobpm || S.tokey) S.ramp = '0';                 // a glide and a step ramp can't both move the tempo
  if(!PROGS.some(p => p[0] === S.prog)) S.prog = 'off';
  if(!PBARS.includes(S.pbars)) S.pbars = '4';
  S.pcust = (String(S.pcust || '').match(/[0-9ab]m?/g) || []).slice(0, PMAX).join(''); if(S.prog === 'x' && !S.pcust) S.pcust = '0';
  S.pname = S.prog === 'x' ? cleanName(S.pname) : '';
  if(!LSCALES.some(x => x[0] === S.lscale)) S.lscale = 'c';
  if(!ladderTop(S)) S.lspan = ladderSpans(S).some(x => x[0] === '5') ? '5' : '8';   // the scale has no such note: its 5th, or the octave
  if(S.tlad !== 'on') S.tlad = 'off';
  if(!LSECS.includes(S.tlsec)) S.tlsec = '8';
  if(!['1','2','4','8'].includes(S.tlbars)) S.tlbars = '2';
  if(!TUNINGS.includes(S.a4)) S.a4 = '440';
  if(!/^(0|\d+|l\d+|c\d+|@([01]\d|2[0-3]):[0-5]\d)$/.test(S.len) || (S.mode === 'groove' ? S.len[0] === 'c' : S.len[0] === 'l') || (S.mode === 'noise' && !/^(\d+|@.*)$/.test(S.len))) S.len = '0';
  if(!NCOLORS.some(c => c[0] === S.ncolor)) S.ncolor = 'pink';
  if(!/^-?\d{1,2}(\.-?\d{1,2}){4}$/.test(S.neq)) S.neq = NDEFAULTS.neq;
  if(!NWAVES.includes(S.nwave)) S.nwave = '0';
  if(!(+S.nswell >= 0 && +S.nswell <= 100)) S.nswell = NDEFAULTS.nswell;
  if(!TEXTURES.some(t => t[0] === S.tosound) && !NCOLORS.some(c => c[0] === S.tosound)) S.tosound = '';
  if(!NWAVES.includes(S.towave)) S.towave = '';
  if(S.toswell !== '' && !(+S.toswell >= 0 && +S.toswell <= 100)) S.toswell = ''; else if(S.toswell !== '') S.toswell = String(Math.round(+S.toswell));
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
  if(mode === 'noise'){                                   // n-pink plus e2.0.-3.-6.-9 (EQ) · w10 (waves, s) · s60 (depth) · t45 (minutes)
    const t = [`n-${S.ncolor}`];
    if(S.neq !== NDEFAULTS.neq) t.push('e' + S.neq);
    if(S.nwave !== '0') t.push('w' + S.nwave);
    if(S.nswell !== NDEFAULTS.nswell) t.push('s' + S.nswell);
    if(S.len !== '0') t.push('t' + lenToken(S.len));
    if(S.tosound || S.towave !== '' || S.toswell !== '') t.push('a' + S.tosound + (S.towave !== '' ? '.w' + S.towave : '') + (S.toswell !== '' ? '.s' + S.toswell : ''));
    return t.join('/');
  }
  if(mode === 'tune'){
    const t = [`t-${S.key}`];
    if(S.tinst !== 'C') t.push('i' + S.tinst);
    if(S.tdrone === 'off') t.push('n');
    t.push(...synthTokens());
    if(S.tdrums !== '0') t.push('g' + S.tdrums);
    if(S.tlines !== 'rfo') t.push(S.tlines === 'ro' ? 'lr' : 'l' + S.tlines);
    if(S.treg !== 'auto') t.push('r' + S.treg);
    if(S.tlad === 'on') t.push('u' + S.lscale + S.lspan + (S.tlsec === '8' ? '' : '.' + S.tlsec) + (S.tlbars === '2' ? '' : '.b' + S.tlbars));   // uc5, umaj8.12, uc5.b4
    return t.join('/');
  }
  if(mode === 'breathe'){
    const t = [`b-${durs().map(fmtN).join('-')}-${S.key}`];
    if(S.bsound === 'hum') t.push('h'); else if(S.bsound === 'off') t.push('n');
    t.push(...synthTokens());
    if(S.bcue === 'count') t.push('k'); else if(S.bcue === 'off') t.push('q');
    if(S.swell !== BDEFAULTS.swell) t.push('s' + S.swell);
    if(S.len !== '0') t.push('t' + lenToken(S.len));
    return t.join('/');
  }
  const click = isClick(), t = [`${click ? 'c' : ''}${S.bpm}-${S.key}`];
  if(click && (S.meter !== '4' || S.group)) t.push('m' + S.meter + (S.group ? '.' + S.group : ''));
  if(S.bars !== DEFAULTS.bars) t.push('b' + S.bars);
  if(S.countin !== DEFAULTS.countin) t.push('c' + S.countin);
  if(S.drop !== DEFAULTS.drop) t.push('d' + S.drop.replace('-', '.'));
  if(S.beat) t.push('g' + S.beat + (S.kit === '808' ? '' : '.' + S.kit));   // a drum machine: gfunk, ghouse.909
  if(S.click !== (click && !S.beat ? '1' : 'off')) t.push(S.click === 'off' ? 'k0' : S.click === 'c' ? `kc${S.csub}.${S.cells}` : 'k' + S.click);
  if(S.wash !== DEFAULTS.wash) t.push('w0');
  t.push(...synthTokens());
  if(S.prog !== 'off') t.push('p' + S.prog + (S.prog === 'ld' ? S.lscale + S.lspan : S.prog === 'x' ? S.pcust : '') + (progOf(S.prog)[3] || S.pbars === '4' ? '' : '.' + S.pbars)
    + (S.prog === 'x' && S.pname ? '~' + S.pname.replace(/ /g, '_') : ''));   // p4, p5.2, pbl, px09m50~Blue_Moon
  if(!click && +S.fine) t.push('f' + S.fine);
  const r = ramp(); if(r) t.push(`r${r.step}.${r.every}.${r.cap}`);
  if(S.len !== '0') t.push('t' + lenToken(S.len));
  if(S.tobpm || S.tokey) t.push('a' + S.tobpm + (S.tokey ? '.' + S.tokey : ''));   // where the session arrives: a60.E, a60, a.E
  if(S.count !== 'off') t.push('n' + S.count[0]);
  return t.join('/');
}
// '@19:30' travels as t@1930; the rest as they are.
const lenToken = len => len[0] === '@' ? '@' + len.slice(1).replace(':', '') : len;
const lenFrom = (v, max, prefix) => {                   // a t token's value → a length, or null
  const at = /^@([01]\d|2[0-3])([0-5]\d)$/.exec(v); if(at) return `@${at[1]}:${at[2]}`;
  const g = new RegExp(`^(\\d{1,3}|${prefix}\\d{1,3})$`).exec(v); if(!g) return null;
  const n = +(g[1][0] === prefix ? g[1].slice(1) : g[1]);
  return n >= 1 && n <= (g[1][0] === prefix ? max : 120) ? g[1] : null;
};
// A link is a whole preset: missing tokens mean defaults. Accepts "?p" values and old "#" hashes.
// Returns false (and changes nothing) for anything that isn't a valid preset; a bad token is skipped.
export function applyPreset(str){
  const [head, ...tokens] = (str || '').replace(/^#/, '').split('/');
  const nz = /^n-(white|pink|brown|grey|blue|violet)$/.exec(head);
  if(nz){
    Object.assign(S, { mode:'noise' }, NDEFAULTS, { ncolor: nz[1], len:'0' });
    for(const t of tokens){
      let g;
      if((g = /^e(-?\d{1,2}(?:\.-?\d{1,2}){4})$/.exec(t))) S.neq = g[1].split('.').map(v => String(Math.max(-12, Math.min(12, +v)) || 0)).join('.');
      else if((g = /^w(6|8|10|12|16)$/.exec(t))) S.nwave = g[1];
      else if((g = /^s(\d{1,3})$/.exec(t)) && +g[1] <= 100) S.nswell = String(+g[1]);
      else if((g = /^t(\d{1,3})$/.exec(t)) && +g[1] >= 1 && +g[1] <= 240) S.len = g[1];
      else if((g = /^t(@\d{4})$/.exec(t)) && lenFrom(g[1], 0, 'x')) S.len = lenFrom(g[1], 0, 'x');
      else if((g = /^a(deep|fan|rain|falls|surf|white|pink|brown|grey|blue|violet)?(?:\.w(0|6|8|10|12|16))?(?:\.s(\d{1,3}))?$/.exec(t)) && t !== 'a'){
        S.tosound = g[1] || ''; S.towave = g[2] || ''; S.toswell = g[3] != null && +g[3] <= 100 ? String(+g[3]) : ''; }
    }
    conform();
    return true;
  }
  const tn = /^t-([A-G]b?)$/.exec(head);
  if(tn){
    if(!CHROMA.includes(tn[1])) return false;
    Object.assign(S, { mode:'tune', key:tn[1] }, TDEFAULTS, SDEFAULTS);
    for(const t of tokens){
      let g;
      if(synthToken(t)) continue;
      if(t[0] === 'i' && INSTS.some(x => x[0] === t.slice(1))) S.tinst = t.slice(1);
      // (a442/a432 in older links: the tuning is the phone's own setting now, so a link no longer changes it)
      else if(t === 'n') S.tdrone = 'off';
      else if(t[0] === 'g' && TEMPOS.includes(+t.slice(1))) S.tdrums = t.slice(1);
      else if(t === 'lr') S.tlines = 'ro'; else if(t === 'lmaj' || t === 'lmin') S.tlines = t.slice(1);
      else if(/^r[123]$/.test(t)) S.treg = t[1];
      else if((g = /^u(c|maj|min|pen|wt)([3458])(?:\.(4|6|8|12|16))?(?:\.b([1248]))?$/.exec(t))){ S.tlad = 'on'; S.lscale = g[1]; S.lspan = g[2]; S.tlsec = g[3] || '8'; S.tlbars = g[4] || '2'; }
    }
    if(!ladderTop(S)) S.lspan = '8';                    // (a span the scale has no note for)
    return true;
  }
  const b = /^b-(\d+(?:\.5)?)-(\d+(?:\.5)?)-(\d+(?:\.5)?)-(\d+(?:\.5)?)-([A-G]b?)$/.exec(head);
  if(b){
    const d = b.slice(1, 5).map(Number);
    if(d.some(x => x > 30) || d.every(x => x === 0) || !KEYS.some(k => k[0] === b[5])) return false;
    Object.assign(S, { mode:'breathe', pattern: d.map(fmtN).join('-'), key:b[5] }, { bsound:'wash', bcue:'phase', swell:BDEFAULTS.swell, len:'0' }, SDEFAULTS);
    for(const t of tokens){
      if(synthToken(t)) continue;
      if(t === 'h') S.bsound = 'hum'; else if(t === 'n') S.bsound = 'off';
      else if(t === 'k') S.bcue = 'count'; else if(t === 'q') S.bcue = 'off';
      else if(t[0] === 's' && /^\d{1,3}$/.test(t.slice(1)) && +t.slice(1) <= 100) S.swell = String(+t.slice(1));
      else if(t[0] === 't'){ const v = lenFrom(t.slice(1), 200, 'c'); if(v) S.len = v; }
    }
    return true;
  }
  const m = /^(c?)(\d{2,3})-([A-G]b?)$/.exec(head);
  if(!m || !KEYS.some(k => k[0] === m[3])) return false;
  const click = m[1] === 'c', bpm = +m[2];
  if(click ? (bpm < 40 || bpm > 240) : !TEMPOS.includes(bpm)) return false;
  Object.assign(S, { mode:'groove', bpm, key:m[3] }, DEFAULTS, SDEFAULTS, { sound: click ? 'click' : 'drums', click: click ? '1' : 'off' });
  let kSeen = false;
  for(const t of tokens){
    const v = t.slice(1);
    if(synthToken(t)) continue;
    if(t[0]==='g' && click){ const g = /^([a-z]+)(?:\.([a-z0-9]+))?$/.exec(v); if(g && beatOf(g[1])){ S.beat = g[1]; S.kit = g[2] && KITS.some(k => k.id === g[2]) ? g[2] : '808'; } }
    else if(t[0]==='b' && ['4','8','16'].includes(v)) S.bars = v;
    else if(t[0]==='c' && ['0','1'].includes(v)) S.countin = v;
    else if(t[0]==='d' && DROPS.includes(v.replace('.', '-'))) S.drop = v.replace('.', '-');
    else if(t[0]==='k'){ kSeen = true; const g = /^(0|[1234bostvdr]|c([1-4])\.([0-3]{2,32}))$/.exec(v);
      if(g){ if(g[1] === '0') S.click = 'off'; else if(g[2]){ S.click = 'c'; S.csub = g[2]; S.cells = g[3]; } else S.click = g[1]; } }
    else if(t==='w0') S.wash = 'off';
    else if(t[0]==='p'){ const g = /^(4|5|6|iv|mn|mi|bl|ch|ub|c4)(?:\.([1248]))?$/.exec(v), l = /^ld(c|maj|min|pen|wt)([3458])(?:\.([1248]))?$/.exec(v);
      const x = /^x((?:[0-9ab]m?){1,12})(?:\.([1248]))?(?:~(.+))?$/.exec(v);                         // px09m50: your own chords, ~Blue_Moon their name
      if(g){ S.prog = g[1]; S.pbars = g[2] || '4'; } else if(l){ S.prog = 'ld'; S.lscale = l[1]; S.lspan = l[2]; S.pbars = l[3] || '4'; }   // (ub: up and back)
      else if(x){ S.prog = 'x'; S.pcust = x[1]; S.pbars = x[2] || '4'; S.pname = cleanName((x[3] || '').replace(/_/g, ' ')); } }
    else if(t[0]==='f' && !click && v !== '' && !isNaN(+v) && Math.abs(+v) <= 8) S.fine = String(Math.round(+v));
    else if(t[0]==='m' && click){ const g = /^([2-7])(?:\.(\d+))?$/.exec(v); if(g && METERS[g[1]] && (!g[2] || METERS[g[1]].groups.includes(g[2]))){ S.meter = g[1]; S.group = g[2] || ''; } }
    else if(t[0]==='r'){ const g = /^(-?\d{1,2})\.(\d{1,2})\.(\d{2,3})$/.exec(v);
      if(g && +g[1] && Math.abs(+g[1]) <= 20 && +g[2] >= 1 && +g[2] <= 64 && +g[3] >= 40 && +g[3] <= 240) S.ramp = `${+g[1]}-${+g[2]}-${+g[3]}`; }
    else if(t[0]==='t'){ const l = lenFrom(v, 99, 'l'); if(l) S.len = l; }
    else if(t[0]==='a'){ const g = /^(\d{2,3})?(?:\.([A-G]b?))?$/.exec(v); if(g && v){ S.tobpm = g[1] || ''; S.tokey = g[2] || ''; } }   // where it arrives (conform checks)
    else if(t==='nn') S.count = 'num'; else if(t==='ns') S.count = 'syl';
  }
  if(S.beat && !kSeen) S.click = 'off';                  // a drum machine plays without the click unless the link says
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
                                                    wash:S.wash, wvol:S.wvol, cvol:S.cvol, nvol:S.nvol, drop:S.drop, click:S.click, tspeed:S.tspeed, tcents:S.tcents, a4:S.a4 })); }catch(e){}
}
// Switch mode: restore that mode's last preset, keeping the key you're in (a voice's key doesn't change with the mode).
export function switchMode(mode){
  if(mode === S.mode) return false;
  let saved = {}; try{ saved = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; }catch(e){}
  const key = S.key, last = (saved.presets || {})[mode];
  const fresh = mode === 'breathe' ? `b-${BDEFAULTS.pattern}-${key}` : mode === 'tune' ? `t-${key}` : mode === 'noise' ? 'n-pink' : `96-${key}`;
  if(!applyPreset(last || fresh)) applyPreset(fresh);
  S.key = key;
  return true;
}
// ?p=… (current links), then #… (older links), then the last preset on this device, then the default.
// Volumes are per-device mixing taste and never come from a link.
// ---- the phone's own settings travel in a link as a starting point (&d=…, only what isn't default): iOS gives each
//      home-screen shortcut its own storage, so a shortcut made from this page, or someone opening a shared link for the
//      first time, adopts each setting it hasn't saved yet, once. Anything saved wins. (The View adds its own: viewer.js.)
//      a432 tuning · dv/wv/cv/nv volumes in % · ts12 Tune's speed · th cents hidden ----
export function deviceTokens(){
  const t = [];
  if(S.a4 !== '440') t.push('a' + S.a4);
  for(const [k, c, d] of [['dvol','dv',.9],['wvol','wv',.6],['cvol','cv',1],['nvol','nv',.6]]) if(Math.abs(+S[k] - d) > 1e-6) t.push(c + Math.round(+S[k] * 100));
  if(S.tspeed !== '8') t.push('ts' + S.tspeed);
  if(S.tcents !== 'show') t.push('th');
  return t;
}
function seedDevice(saved){
  const d = new URLSearchParams(location.search).get('d'); if(!d) return;
  for(const t of d.split('/')){
    let m;
    if((m = /^a(440|442|432)$/.exec(t))){ if(saved.a4 == null) S.a4 = m[1]; }
    else if((m = /^(dv|wv|cv|nv)(\d{1,3})$/.exec(t))){ const k = { dv:'dvol', wv:'wvol', cv:'cvol', nv:'nvol' }[m[1]]; if(saved[k] == null) S[k] = String(Math.min(100, +m[2]) / 100); }
    else if((m = /^ts(4|8|12)$/.exec(t))){ if(saved.tspeed == null) S.tspeed = m[1]; }
    else if(t === 'th'){ if(saved.tcents == null) S.tcents = 'hide'; }
  }
}
export function restore(){
  let saved = {};
  try{ saved = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; }catch(e){}
  for(const k of ['bars','countin','fine','dvol','wash','wvol','cvol','nvol','drop','click','tspeed','tcents','a4']) if(saved[k] != null) S[k] = String(saved[k]);
  seedDevice(saved);
  if(S.click === 'on') S.click = '1';                   // saved before the click had patterns
  if(!applyPreset(new URLSearchParams(location.search).get('p')) && !applyPreset(location.hash) && !applyPreset(saved.preset || '')){
    S.bpm = 96; S.key = 'C'; conform();
  }
}

// ---- Programming (2026-11-26, David: "scheduled programming … the same Groove setting that changes as the day
//      progresses"). Three parts of the day, each a Groove preset with a start time; when you press play from stopped,
//      the clock picks the part (the latest start at or before now; before the first, last night's). Before sleep's
//      groove hands over to the Noise when its session ends. Kept on this phone in backtrack-programming. ----
export const PARTS = [
  { id:'morning', name:'Morning',      at:'05:00', p:'c112-C/gfunk.909' },         // high energy
  { id:'drive',   name:'Drive home',   at:'16:00', p:'96-C/t30/a72' },             // winds down over the drive
  { id:'sleep',   name:'Before sleep', at:'21:00', p:'72-C/t20/a60', noise:true },  // down to 60, then the Noise
];
const PG_KEY = 'backtrack-programming', HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
let PG = null;
export function programming(){
  if(PG) return PG;
  let s = {}; try{ s = JSON.parse(localStorage.getItem(PG_KEY) || '{}') || {}; }catch(e){}
  const saved = Array.isArray(s.parts) ? s.parts : [];
  PG = { on: s.on === true, parts: PARTS.map((d, i) => { const x = saved[i] || {};
    return { ...d, at: HHMM.test(x.at) ? x.at : d.at, p: typeof x.p === 'string' && x.p ? x.p : d.p }; }) };
  return PG;
}
export function saveProgramming(){
  const pg = programming();
  try{ localStorage.setItem(PG_KEY, JSON.stringify({ on: pg.on, parts: pg.parts.map(x => ({ at:x.at, p:x.p })) })); }catch(e){}
}
const minutesOf = at => +at.slice(0, 2) * 60 + +at.slice(3, 5);
// The part playing at this time of day (its index).
export function partAt(date = new Date()){
  const now = date.getHours() * 60 + date.getMinutes();
  const order = programming().parts.map((x, i) => ({ i, m: minutesOf(x.at) })).sort((a, b) => a.m - b.m);
  let pick = order[order.length - 1];
  for(const x of order) if(x.m <= now) pick = x;
  return pick.i;
}
// A part's setup in words, without changing S: "96 C R&B · to 72 bpm in 30 min".
export function presetLabel(str){
  const keep = { ...S }; let out = '';
  if(applyPreset(str) && S.mode === 'groove'){
    const len = S.len === '0' ? '' : S.len[0] === '@' ? lenLabel() : (S.len[0] === 'l' ? 'over ' : 'in ') + lenLabel().replace(/^1 loops$/, '1 loop');   // "in 20 min", "over 8 loops", "until 9:30 PM"
    out = [grooveHome(S), [arriveLine(), len].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
  }
  for(const k of Object.keys(S)) if(!(k in keep)) delete S[k];
  Object.assign(S, keep);
  return out;
}

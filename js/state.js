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
// sound: the drum loop, or the click alone at any tempo. meter/group: pulses per bar and their grouping (click only;
// the loops are 4/4). click: the pattern code (see PATTERNS); csub/cells: the custom grid. ramp: 'step-every-cap'.
// len: a session length ('0', minutes, 'l8' loops, 'c20' cycles). count: what the beats view writes in its cells.
export const DEFAULTS = {bars:'16', countin:'1', drop:'0-0', click:'off', wash:'on', fine:'0', sound:'drums', meter:'4', group:'', csub:'2', cells:'', ramp:'0', len:'0', count:'off'};
// Classical terms by tempo, matching the grooves' column (60 Largo · 72 Adagio · 88/96 Andante · 108 Moderato · 120/128 Allegro).
export const TERMS = [[40,'Largo'],[66,'Adagio'],[76,'Andante'],[108,'Moderato'],[120,'Allegro'],[156,'Vivace'],[176,'Presto'],[200,'Prestissimo']];
export function termFor(bpm){ let i = 0; while(i + 1 < TERMS.length && bpm >= TERMS[i + 1][0]) i++; return { name:TERMS[i][1], lo:TERMS[i][0], hi: i + 1 < TERMS.length ? TERMS[i + 1][0] - 1 : 240 }; }
// Click patterns: code, label in x/4, label in x/8 (null = not offered there: the meter's pulse is already the eighth).
export const PATTERNS = [['off','Off','Off'],['1','Quarters','Beats'],['2','Eighths','Eighths'],['3','Triplets',null],['4','Sixteenths','Sixteenths'],['b','Backbeat',null],['o','Off-beats',null],['c','Custom','Custom']];
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
export const TDEFAULTS = {tinst:'C', a4:'440', tlines:'rfo', treg:'auto', tdrone:'wash', tdrums:'0'};
export const CHROMA = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
export const inst = (i = S.tinst) => INSTS.find(x => x[0] === i) || INSTS[0];
export const writtenKey = (k = S.key, i = S.tinst) => CHROMA[(CHROMA.indexOf(k) + inst(i)[2]) % 12];
export const tuneLabel = () => `Tune in ${keyLabel(writtenKey())}` + (S.tinst === 'C' ? '' : ` (${inst()[1]})`);      // "Tune in C (B♭)"
export const tuneHome = () => (S.tinst === 'C' ? '' : inst()[1] + ' ') + `Tune in ${keyLabel(writtenKey())}`;        // "B♭ Tune in C": fits under an icon

// what the drone plays depends on the mode: the Wash on/off in Groove, the sound choice in Breathe, on/off in Tune
export const washWanted = () => S.mode === 'breathe' ? S.bsound === 'wash' : S.mode === 'tune' ? S.tdrone === 'wash' : S.wash === 'on';

// The beat-view lab: read before the first render rewrites the URL, and carried along in it afterwards.
export const LAB = new URLSearchParams(location.search).has('lab');

// The live settings. Values are strings as the controls hold them, except bpm.
// tspeed (seconds across the pitch line) and tcents (show the cents) are per-device, like the volumes.
export const S = { mode:'groove', bpm:96, key:'C', ...DEFAULTS, ...BDEFAULTS, ...TDEFAULTS, dvol:'0.9', wvol:'0.6', cvol:'1', tspeed:'8', tcents:'show' };

export const keyLabel = (k = S.key) => (KEYS.find(x => x[0] === k) || [k, k])[1];
export const groove = (bpm = S.bpm) => GROOVES[TEMPOS.indexOf(bpm)];   // [bpm, genre, classical]; undefined for a click tempo
export const isClick = () => S.sound === 'click';
export const meter = () => meterOf(isClick() ? S.meter : '4', isClick() ? S.group : '');   // the meter in force (the loops are 4/4)
export const noteOf = M => M.unit === 3 ? '♩.' : '♩';                    // what the bpm counts
export const styleLabel = () => isClick() ? `${meter().label} click` : groove()[1];   // "7/8 click" | "Hip-hop · R&B"
export const grooveName = (bpm = S.bpm, sound = S.sound, m = S.meter, g = S.group) => sound === 'click' ? `${meterOf(m, g).label} click` : (SHORT[bpm] || 'Click');
export const cells = () => cellsOf(S.click, meter(), S.csub, S.cells);    // the click pattern in force: { sub, cells }
export const ramp = () => rampOf(S.ramp, S.bpm);

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
  if(M.compound && ['3','b','o'].includes(S.click)) S.click = '1';
  if(S.click === 'b' && M.top !== 2 && M.top !== 4) S.click = '1';   // a backbeat is 2 and 4
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
  if(!/^(0|\d+|l\d+|c\d+)$/.test(S.len) || (S.mode === 'groove' ? S.len[0] === 'c' : S.len[0] === 'l')) S.len = '0';
  if(!['off','num','syl'].includes(S.count)) S.count = 'off';
}

// ---- the preset lives in the URL: "72-Eb" plus only the settings that differ from the defaults,
//      e.g. ?p=72-Eb/b8/d4.1/k1  (b = loop bars, c0 = no count-in, d = drop-out on.off, k = click pattern, w0 = no drone, f = fine %).
//      A click preset has a c in front: ?p=c132-C/m7.223/k2/r2.8.160/t10 (m = meter.grouping, r = ramp step.every.cap,
//      t = session length in minutes or tl8 loops, nn / ns = count numbers / syllables). ----
// Breathe presets: "b-4-7-8-0-C" plus h (hum) / n (no drone), k (count cues) / q (no cues), s45 (swell %), t5 / tc12 (length).
// Tune presets: "t-Bb" (the concert key: the drone's) plus iBb/iEb/iF (instrument), a442/a432 (A4), n (no drone),
// g72 (drums at 72), lr/lmaj/lmin (root and octave / major / minor scale lines), r1/r2/r3 (lines low / middle / high).
export function presetString(mode = S.mode){
  if(mode === 'tune'){
    const t = [`t-${S.key}`];
    if(S.tinst !== 'C') t.push('i' + S.tinst);
    if(S.a4 !== '440') t.push('a' + S.a4);
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
      else if(t === 'a442' || t === 'a432') S.a4 = t.slice(1);
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
    else if(t[0]==='k'){ const g = /^(0|[1234bo]|c([1-4])\.([0-3]{2,32}))$/.exec(v);
      if(g){ if(g[1] === '0') S.click = 'off'; else if(g[2]){ S.click = 'c'; S.csub = g[2]; S.cells = g[3]; } else S.click = g[1]; } }
    else if(t==='w0') S.wash = 'off';
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
                                                    wash:S.wash, wvol:S.wvol, cvol:S.cvol, drop:S.drop, click:S.click, tspeed:S.tspeed, tcents:S.tcents })); }catch(e){}
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
export function restore(){
  let saved = {};
  try{ saved = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; }catch(e){}
  for(const k of ['bars','countin','fine','dvol','wash','wvol','cvol','drop','click','tspeed','tcents']) if(saved[k] != null) S[k] = String(saved[k]);
  if(S.click === 'on') S.click = '1';                   // saved before the click had patterns
  if(!applyPreset(new URLSearchParams(location.search).get('p')) && !applyPreset(location.hash) && !applyPreset(saved.preset || '')){
    S.bpm = 96; S.key = 'C'; conform();
  }
}

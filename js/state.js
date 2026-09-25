// Everything a preset is made of, plus the device-only mix. No DOM in here.

// The grooves, slowest to fastest: bpm, the genres that live there, the classical term.
export const GROOVES = [[60,'Slow ballad','Largo'],[72,'Ballad · soul','Adagio'],[88,'Hip-hop','Andante'],[96,'Hip-hop · R&B','Andante'],
                        [108,'Mid-tempo rock','Moderato'],[120,'Pop · rock','Allegro'],[128,'House · dance','Allegro']];
export const TEMPOS = GROOVES.map(g => g[0]);
export const SHORT = {60:'Slow', 72:'Ballad', 88:'Hip-hop', 96:'R&B', 108:'Rock', 120:'Pop', 128:'House'};   // home-screen names
export const KEYS = [['C','C'],['B','B'],['Bb','B♭'],['A','A'],['Ab','A♭'],['G','G'],['Gb','G♭'],['F','F'],['E','E'],['Eb','E♭'],['D','D'],['Db','D♭']];
export const FREQ = {C:130.81,B:123.47,Bb:116.54,A:110,Ab:103.83,G:98,Gb:92.5,F:87.31,E:82.41,Eb:77.78,D:73.42,Db:69.3};
export const DROPS = ['0-0','4-1','4-2','8-4','4-4'];
export const DEFAULTS = {bars:'16', countin:'1', drop:'0-0', click:'off', wash:'on', fine:'0'};

// ---- Breathe mode (ported from Tide Breath): a pattern of in · hold · out · hold seconds ----
// [pattern, chip label, home-screen name, icon]
export const BREATHS = [['4-4-4-4','Box','Box breath','box'],['4-7-8-0','4·7·8','4·7·8 breath','478'],
                        ['5.5-0-5.5-0','Coherent','Coherent breath','coherent'],['4-0-8-0','Long exhale','Long exhale','exhale']];
export const BDEFAULTS = {pattern:'4-4-4-4', bsound:'wash', bcue:'phase', swell:'60'};
export const PHASES = ['Breathe in', 'Hold', 'Breathe out', 'Hold'];
export const fmtN = n => (Math.round(n * 2) / 2).toString();
export const durs = (p = S.pattern) => p.split('-').map(Number);
export const breath = (p = S.pattern) => BREATHS.find(b => b[0] === p);                       // a named pattern, or undefined
export const patternLabel = (p = S.pattern) => durs(p).map(fmtN).join('·');
export const breathLabel = (p = S.pattern) => (breath(p) || [0, patternLabel(p)])[1];        // "4·7·8", "Coherent", or "4·2·6·0"
export const breathHome = (p = S.pattern) => (breath(p) || [0, 0, patternLabel(p) + ' breath'])[2];
// what the drone plays depends on the mode: the Wash on/off in Groove, the sound choice in Breathe
export const washWanted = () => S.mode === 'breathe' ? S.bsound === 'wash' : S.wash === 'on';

// The beat-view lab: read before the first render rewrites the URL, and carried along in it afterwards.
export const LAB = new URLSearchParams(location.search).has('lab');

// The live settings. Values are strings as the controls hold them, except bpm.
export const S = { mode:'groove', bpm:96, key:'C', ...DEFAULTS, ...BDEFAULTS, dvol:'0.9', wvol:'0.6' };

export const keyLabel = (k = S.key) => (KEYS.find(x => x[0] === k) || [k, k])[1];
export const groove = (bpm = S.bpm) => GROOVES[TEMPOS.indexOf(bpm)];   // [bpm, genre, classical]

// ---- the preset lives in the URL: "72-Eb" plus only the settings that differ from the defaults,
//      e.g. ?p=72-Eb/b8/d4.1/k1  (b = loop bars, c0 = no count-in, d = drop-out on.off, k1 = click, w0 = no drone, f = fine %) ----
// Breathe presets: "b-4-7-8-0-C" plus h (hum) / n (no drone), k (count cues) / q (no cues), s45 (swell %).
export function presetString(mode = S.mode){
  if(mode === 'breathe'){
    const t = [`b-${durs().map(fmtN).join('-')}-${S.key}`];
    if(S.bsound === 'hum') t.push('h'); else if(S.bsound === 'off') t.push('n');
    if(S.bcue === 'count') t.push('k'); else if(S.bcue === 'off') t.push('q');
    if(S.swell !== BDEFAULTS.swell) t.push('s' + S.swell);
    return t.join('/');
  }
  const t = [`${S.bpm}-${S.key}`];
  if(S.bars !== DEFAULTS.bars) t.push('b' + S.bars);
  if(S.countin !== DEFAULTS.countin) t.push('c' + S.countin);
  if(S.drop !== DEFAULTS.drop) t.push('d' + S.drop.replace('-', '.'));
  if(S.click !== DEFAULTS.click) t.push('k1');
  if(S.wash !== DEFAULTS.wash) t.push('w0');
  if(+S.fine) t.push('f' + S.fine);
  return t.join('/');
}
// A link is a whole preset: missing tokens mean defaults. Accepts "?p" values and old "#" hashes.
// Returns false (and changes nothing) for anything that isn't a valid preset.
export function applyPreset(str){
  const [head, ...tokens] = (str || '').replace(/^#/, '').split('/');
  const b = /^b-(\d+(?:\.5)?)-(\d+(?:\.5)?)-(\d+(?:\.5)?)-(\d+(?:\.5)?)-([A-G]b?)$/.exec(head);
  if(b){
    const d = b.slice(1, 5).map(Number);
    if(d.some(x => x > 30) || d.every(x => x === 0) || !KEYS.some(k => k[0] === b[5])) return false;
    Object.assign(S, { mode:'breathe', pattern: d.map(fmtN).join('-'), key:b[5] }, { bsound:'wash', bcue:'phase', swell:BDEFAULTS.swell });
    for(const t of tokens){
      if(t === 'h') S.bsound = 'hum'; else if(t === 'n') S.bsound = 'off';
      else if(t === 'k') S.bcue = 'count'; else if(t === 'q') S.bcue = 'off';
      else if(t[0] === 's' && /^\d{1,3}$/.test(t.slice(1)) && +t.slice(1) <= 100) S.swell = String(+t.slice(1));
    }
    return true;
  }
  const m = /^(\d+)-([A-G]b?)$/.exec(head);
  if(!m || !TEMPOS.includes(+m[1]) || !KEYS.some(k => k[0] === m[2])) return false;
  Object.assign(S, { mode:'groove', bpm:+m[1], key:m[2] }, DEFAULTS);
  for(const t of tokens){
    const v = t.slice(1);
    if(t[0]==='b' && ['4','8','16'].includes(v)) S.bars = v;
    else if(t[0]==='c' && ['0','1'].includes(v)) S.countin = v;
    else if(t[0]==='d' && DROPS.includes(v.replace('.', '-'))) S.drop = v.replace('.', '-');
    else if(t==='k1') S.click = 'on';
    else if(t==='w0') S.wash = 'off';
    else if(t[0]==='f' && v !== '' && !isNaN(+v) && Math.abs(+v) <= 8) S.fine = String(Math.round(+v));
  }
  return true;
}

// ---- remembered on this device (storage keys unchanged since the first version) ----
const STORE = 'backtrack';
// Each mode remembers its own last preset, so switching modes brings back where you were in that mode.
export function save(){
  let saved = {}; try{ saved = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; }catch(e){}
  const presets = { ...(saved.presets || {}), [S.mode]: presetString() };
  try{ localStorage.setItem(STORE, JSON.stringify({ preset:presetString(), presets, bars:S.bars, countin:S.countin, fine:S.fine, dvol:S.dvol,
                                                    wash:S.wash, wvol:S.wvol, drop:S.drop, click:S.click })); }catch(e){}
}
// Switch mode: restore that mode's last preset, keeping the key you're in (a voice's key doesn't change with the mode).
export function switchMode(mode){
  if(mode === S.mode) return false;
  let saved = {}; try{ saved = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; }catch(e){}
  const key = S.key, last = (saved.presets || {})[mode];
  if(!applyPreset(last || (mode === 'breathe' ? `b-${BDEFAULTS.pattern}-${key}` : `96-${key}`))) applyPreset(mode === 'breathe' ? `b-${BDEFAULTS.pattern}-${key}` : `96-${key}`);
  S.key = key;
  return true;
}
// ?p=… (current links), then #… (older links), then the last preset on this device, then the default.
// Volumes are per-device mixing taste and never come from a link.
export function restore(){
  let saved = {};
  try{ saved = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; }catch(e){}
  for(const k of ['bars','countin','fine','dvol','wash','wvol','drop','click']) if(saved[k] != null) S[k] = String(saved[k]);
  if(!applyPreset(new URLSearchParams(location.search).get('p')) && !applyPreset(location.hash) && !applyPreset(saved.preset || '')){
    S.bpm = 96; S.key = 'C';
  }
}

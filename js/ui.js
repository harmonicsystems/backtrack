// Everything on screen: readouts, the circle and the four-beat view, the Setup sheet, night mode, the shortcut card.
import { S, TEMPOS, KEYS, keyLabel, groove, presetString, deviceTokens, LAB, XRAY, BREATHS, PHASES, durs, fmtN, breath, breathLabel, breathHome, patternLabel,
         LINES, inst, writtenKey, tuneLabel, tuneHome, isClick, meter, noteOf, termFor, PATTERNS, FEELS, patternOk, RAMPS, cells as cellsNow, ramp,
         describe, grooveHome, termLine, PROGS, progOf, progShort, progNote, droneLine, tuningTag,
         NCOLORS, NNOTES, TEXTURES, textureOf, noiseName, FREQ, droneWord, notesName, toneName } from './state.js';
import { H, NOTES, TONES, notesPreset, tonePreset, levelsOf, harmonicInfo } from './synth.js';
import { BANDS, eqOf, eqLive, noiseAnalyser } from './noise.js';
import { METERS, meterOf, maxSub, setupOf } from './timeline.js';
import { renderRate } from './audio.js';
import { grid, place } from './grid.js';

export const $ = id => document.getElementById(id);
export const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const go = $('go'), word = $('word'), barno = $('barno'), dotsBox = $('dots'), beats = $('beats'), brow = $('brow'), hint = $('hint'), tempo = $('tempo');
let dots = [], cells = [];   // the beats under the circle and the cells of the big view: rebuilt by layoutBeats()

// ---- sliders: the track wrapper draws the fill (the thumb travels width − 28 px, so fill to its centre) ----
export const fill = el => { const pct = (el.value - el.min) / (el.max - el.min); el.parentElement.style.setProperty('--pct', `calc(14px + (100% - 28px) * ${pct})`); };

// Set text with a short slide in the direction of travel ('fade' cross-fades); no-op when unchanged, instant under reduced motion.
export function swap(el, text, dir){
  if(el.textContent === text) return;
  el.textContent = text;
  if(reduced || !dir) return;
  el.classList.remove('swap-up','swap-down','swap-fade'); void el.offsetWidth;
  el.classList.add(dir === 'fade' ? 'swap-fade' : dir > 0 ? 'swap-up' : 'swap-down');
}

export function initControls(){
  $('pchips').innerHTML = BREATHS.map(([p, label]) => `<button class="btn" data-p="${p}">${label}</button>`).join('');
  $('ncolors').innerHTML = NCOLORS.map(([c, label]) => `<button class="btn" data-ncolor="${c}">${label}</button>`).join('');
  $('ntex').innerHTML = TEXTURES.map(([t, label]) => `<button class="btn" data-tex="${t}">${label}</button>`).join('');
  $('lchips').innerHTML = LINES.map(([l, label]) => `<button class="btn" data-l="${l}">${label}</button>`).join('');
  $('tkey').innerHTML = KEYS.map(([k]) => `<option value="${k}"></option>`).join('');          // texts follow the instrument (render)
  $('tdrums').insertAdjacentHTML('beforeend', TEMPOS.map(t => `<option value="${t}">${t} bpm</option>`).join(''));
  $('ticks').innerHTML = TEMPOS.map(t => `<span data-bpm="${t}">${t}</span>`).join('');
  $('meters').innerHTML = Object.keys(METERS).map(k => `<button class="btn" data-meter="${k}">${meterOf(k).label}</button>`).join('');
  $('prog').innerHTML = PROGS.map(([c, l]) => `<option value="${c}">${l}</option>`).join('');
  initSynth();
  $('csub').innerHTML = [1, 2, 3, 4].map(n => `<button class="btn" data-sub="${n}">${n}</button>`).join('');
  $('ramps').innerHTML = RAMPS.map(([r, l]) => `<button class="btn" data-r="${r}">${l}</button>`).join('');
  // tick marks on the tempo track, one per groove, where the thumb's centre sits at each stop
  $('tempotrack').insertAdjacentHTML('beforeend', TEMPOS.map((_, k) => `<i style="left:calc(14px + (100% - 28px) * ${k / (TEMPOS.length - 1)})"></i>`).join(''));
  document.querySelectorAll('input[type=range]').forEach(el => { fill(el); el.addEventListener('input', () => fill(el)); });
}

// ---- state → screen. Called after every settings change. ----
let shownBpm = null, gridKey = '', layoutKey = '';
// live: the tempo you hear under a ramp (Fine already inside it, so no suffix)
// (a ramp's tempo bands are checked against its cap, so the name holds at the live tempo too)
const titleLine = (bpm, live) => `${bpm} bpm` + (!isClick() && +S.fine && !live ? ` ${S.fine > 0 ? '+' : ''}${S.fine}%` : '') + ` · ${describe().long}`;
const metaLine = bpm => `${bpm} bpm · ${describe().long} · ${keyLabel()}`;
// A select showing a value it has no option for (a link's 7-minute session) gets one extra option for it.
function pickOption(sel, value, label){
  let o = [...sel.options].find(x => x.value === value);
  if(!o){ o = sel.querySelector('.extra') || sel.appendChild(Object.assign(document.createElement('option'), { className:'extra' })); o.value = value; o.textContent = label; }
  sel.value = value;
}
export function render(){
  const k = keyLabel(), click = isClick(), M = meter(), g = groove(), gi = TEMPOS.indexOf(S.bpm), breathe = S.mode === 'breathe', tune = S.mode === 'tune', noise = S.mode === 'noise';
  const d = describe(), genre = d.long, classical = termLine(click ? termFor(S.bpm).name : g[2]);
  if(document.body.dataset.mode !== S.mode){ document.body.dataset.mode = S.mode; syncTabs(); }
  document.body.dataset.sound = S.sound;
  document.querySelectorAll('#modes [data-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === S.mode));
  if(go.dataset.running !== 'true') go.setAttribute('aria-label', tune ? 'Start listening' : 'Start');
  // controls follow the state (links and restores change it without touching them)
  if(gi >= 0) tempo.value = gi; $('bpmfree').value = S.bpm;
  for(const id of ['bars','countin','fine','dvol','key','wvol','drop','bcue','swell','cvol','count','prog','pbars','nvol','nwave','nswell']) $(id).value = S[id];
  const synth = S.dsrc === 'synth';                                // each mode's Drone menu: Wash · Synth · Off (Hum in Breathe)
  $('wash').value = S.wash === 'off' ? 'off' : S.dsrc; $('bsound').value = S.bsound === 'wash' ? S.dsrc : S.bsound; $('tdrone').value = S.tdrone === 'wash' ? S.dsrc : 'off';
  renderSynth();
  // Noise: the color and texture chips, the EQ, the timer (a link's other minutes get their own menu line)
  const tex = textureOf();
  document.querySelectorAll('#ncolors [data-ncolor]').forEach(b => b.setAttribute('aria-pressed', b.dataset.ncolor === S.ncolor));
  document.querySelectorAll('#ntex [data-tex]').forEach(b => b.setAttribute('aria-pressed', !!tex && b.dataset.tex === tex[0]));
  eqOf().forEach((db, i) => { $('neq' + i).value = db; $('neq' + i + 'out').textContent = (db > 0 ? '+' : '') + db; });
  $('nvolout').textContent = Math.round(S.nvol * 100); $('nswellout').textContent = S.nswell; $('nswell').disabled = S.nwave === '0';
  $('nnote').textContent = NNOTES[S.ncolor];
  if(noise) pickOption($('nlen'), S.len, `${S.len} min`);
  const prog = progOf(); $('pbarsf').hidden = prog[0] === 'off' || !!prog[3];   // the blues keeps its own timing
  $('prognote').textContent = progNote(); $('prognote').hidden = prog[0] === 'off';
  $('bkey').value = S.key; $('bwvol').value = S.wvol;
  durs().forEach((v, i) => $('d' + i).value = fmtN(v));             // rendered on change only, so this also corrects a rejected or clamped entry
  document.querySelectorAll('#pchips [data-p]').forEach(b => b.setAttribute('aria-pressed', b.dataset.p === S.pattern));
  $('swellrow').hidden = S.bsound !== 'wash';
  // Tune: the key menu names keys as the player reads them ("C · sounds B♭" on a B♭ instrument)
  for(const o of $('tkey').options) o.textContent = S.tinst === 'C' ? keyLabel(o.value) : `${keyLabel(writtenKey(o.value))} · sounds ${keyLabel(o.value)}`;
  for(const id of ['tinst','a4','tcents','treg','tspeed','tdrums']) $(id).value = S[id];
  $('ga4').value = $('ba4').value = S.a4;                           // the tuning: one setting, a menu in each mode
  $('tkey').value = S.key; $('twvol').value = S.wvol; $('tdvol').value = S.dvol; $('tdvolrow').hidden = S.tdrums === '0';
  document.querySelectorAll('#lchips [data-l]').forEach(b => b.setAttribute('aria-pressed', b.dataset.l === S.tlines));
  // sound, meter and grouping
  document.querySelectorAll('#soundsw [data-sound]').forEach(b => b.setAttribute('aria-pressed', b.dataset.sound === S.sound));
  document.querySelectorAll('#meters [data-meter]').forEach(b => b.setAttribute('aria-pressed', b.dataset.meter === String(M.top)));
  const gs = $('groups'), gkey = M.top + '/' + M.group; gs.hidden = !click || M.choices.length < 2;
  if(gs.dataset.key !== gkey){ gs.dataset.key = gkey; gs.innerHTML = M.choices.map(c => `<button class="btn" data-group="${c}" aria-pressed="${c === M.group}">${[...c].join('+')}</button>`).join(''); }
  $('meternote').textContent = !click ? '' : M.compound ? `In ${M.label} the bpm is the ${M.unit === 3 ? 'dotted quarter' : 'quarter'}: ♪ = ${S.bpm * M.unit}.` : M.choices.length > 1 ? `Accents fall on ${M.glabel}.` : '';
  $('bpmnote').textContent = click ? ' ' + noteOf(M) : '';
  // the click pattern and the custom grid (laid out only in Groove mode: the panel's height counts in every mode)
  const groove_ = S.mode === 'groove';
  // the menu holds only what this meter offers (rebuilt, not hidden: iOS pickers show hidden options), the feels in their own group
  const cpat = $('cpat'), pk = `${M.top}/${M.compound}`;
  if(cpat.dataset.key !== pk){
    cpat.dataset.key = pk;
    const opt = ([c, x4, x8]) => `<option value="${c}">${M.compound ? x8 : x4}</option>`, ok = PATTERNS.filter(p => patternOk(p[0], M));
    const feels = ok.filter(p => FEELS.includes(p[0]));
    cpat.innerHTML = ok.filter(p => !FEELS.includes(p[0])).map(opt).join('') + (feels.length ? `<optgroup label="Feels">${feels.map(opt).join('')}</optgroup>` : '');
  }
  cpat.value = S.click;
  $('cnote').textContent = d.note || (click && d.silent ? 'Silent: the beats keep time on screen only.' : 'Accents are the brighter click. The count shows in the big beats: turn the phone sideways, or use night mode.');
  $('cnote').hidden = S.click === 'c';
  $('custom').hidden = !(groove_ && S.click === 'c');
  document.querySelectorAll('#csub [data-sub]').forEach(b => { b.hidden = +b.dataset.sub > maxSub(M, 4); b.setAttribute('aria-pressed', b.dataset.sub === S.csub); });
  const ck = `${M.top}/${M.group}/${S.csub}/${S.cells}/${S.click}/${groove_}`; if(ck !== gridKey){ gridKey = ck; renderGrid(M); }
  // the ramp
  const r = ramp(), cap = $('rampcap'), maxCap = click ? 240 : Math.round(S.bpm * 1.08 / (1 + (+S.fine || 0) / 100));
  document.querySelectorAll('#ramps [data-r]').forEach(b => b.setAttribute('aria-pressed', r ? b.dataset.r === `${r.step}-${r.every}` : b.dataset.r === '0'));
  cap.min = S.bpm + 1; cap.max = Math.max(S.bpm + 1, maxCap); cap.value = r ? r.cap : Math.min(maxCap, S.bpm + 20); $('rampcapout').textContent = cap.value;
  $('caprow').hidden = !(groove_ && r); $('rampnote').hidden = !(groove_ && r);
  if(r) $('rampnote').textContent = click ? `${S.bpm} → ${r.cap} bpm over ${Math.ceil((r.cap - S.bpm) / r.step) * r.every} bars.` : `The grooves stretch at most 8 % (Fine included): up to ${maxCap} bpm.`;
  // the session length (a link can carry a count the menus don't offer: it gets its own line)
  const isL = S.len[0] === 'l', isC = S.len[0] === 'c', lenLabel = isL ? `${S.len.slice(1)} loops` : isC ? `${S.len.slice(1)} cycles` : `${S.len} min`;
  pickOption($('len'), isC ? '0' : S.len, lenLabel); pickOption($('blen'), isL ? '0' : S.len, lenLabel);
  document.querySelectorAll('input[type=range]').forEach(fill);

  const wk = keyLabel(writtenKey()), il = S.tinst === 'C' ? '' : ` (${inst()[1]})`;
  $('code').textContent = noise ? noiseName() + (S.len !== '0' ? ` · ${S.len} min` : '') : breathe ? `${patternLabel()} · ${k}` : tune ? `Tune · ${wk}${il}` + (S.a4 !== '440' ? ` · ${S.a4}` : '') : click ? `${S.bpm} bpm · ${M.label} · ${k}` : `${S.bpm} bpm · ${k}`;
  $('countlabel').textContent = breathe ? 'Cycles' : 'Bars'; $('countwrap').hidden = tune || noise;
  const preset = presetString();
  $('hashview').textContent = '?p=' + preset;
  audSync();
  clearTimeout(urlTimer); urlTimer = setTimeout(writeUrl, 250);   // (a volume slider updates many times a second; Safari limits replaceState)
  homeScreen(preset);
  renderGlance();

  const dir = shownBpm == null ? 0 : Math.sign(S.bpm - shownBpm); shownBpm = S.bpm;
  swap($('bpmnow'), String(S.bpm), dir); swap($('genrenow'), genre, dir); swap($('classnow'), classical, dir);
  document.querySelectorAll('#ticks span').forEach(t => t.classList.toggle('on', +t.dataset.bpm === S.bpm));
  if(noise){
    swap($('ptitle'), noiseName(), 'fade');
    swap($('partist'), (S.nwave !== '0' ? `Waves every ${S.nwave} s` : 'Steady') + (S.len !== '0' ? ` · ${S.len} min timer` : ''), 'fade');
    setMeta(noiseName());
  } else if(tune){
    const lines = { rfo:'root, fifth, octave', ro:'root and octave', maj:'major scale', min:'minor scale' }[S.tlines];
    swap($('ptitle'), tuneLabel(), 'fade');
    swap($('partist'), [S.tdrone === 'wash' ? droneWord() : 'No drone', lines].concat(+S.tdrums ? [`${S.tdrums} bpm`] : []).join(' · '), 'fade');
    setMeta(tuneLabel() + (+S.tdrums ? ` · ${S.tdrums} bpm` : ''));
  } else if(breathe){
    swap($('ptitle'), breathLabel(), 'fade');
    swap($('partist'), (S.bsound === 'wash' ? `${droneWord()} in ${k}` : S.bsound === 'hum' ? `Hum on exhale in ${k}` : 'Silent') + (S.bsound === 'off' ? '' : tuningTag()), 'fade');
    setMeta(`${breathLabel()} · ${k}`);
    drawCurve(durs());
  } else {
    swap($('ptitle'), titleLine(S.bpm), 'fade');
    const [on, off] = S.drop.split('-').map(Number);
    swap($('partist'), (S.wash === 'on' ? droneLine(S, k) + tuningTag() : click ? (d.silent ? 'Screen only' : 'Click only') : 'Drums only') + (on ? ` · ${on} on / ${off} off` : ''), 'fade');
    setMeta(metaLine(S.bpm));
  }
  $('swellout').textContent = S.swell; $('bwvolout').textContent = Math.round(S.wvol * 100);
  $('fineout').textContent = (S.fine > 0 ? '+' : '') + S.fine + '%';
  $('dvolout').textContent = Math.round(S.dvol * 100); $('wvolout').textContent = Math.round(S.wvol * 100); $('cvolout').textContent = Math.round(S.cvol * 100);
  $('tdvolout').textContent = Math.round(S.dvol * 100); $('twvolout').textContent = Math.round(S.wvol * 100);
  const lk = `${M.top}/${M.group}/${cellsNow().sub}/${S.count}`; if(lk !== layoutKey){ layoutKey = lk; layoutBeats(); }
}
// The address bar is the setup: ?p=preset, then &d= the phone's own settings as a starting point for a new shortcut or
// a first-time listener (state.js deviceTokens, plus the View's), then the lab and x-ray flags, which ride along too.
let urlTimer = 0, viewTokens = () => [];
export const setViewTokens = f => { viewTokens = f; };
export function writeUrl(){
  clearTimeout(urlTimer);
  const d = [...deviceTokens(), ...viewTokens()].join('/'), url = '?p=' + presetString() + (d ? '&d=' + d : '') + (LAB ? '&lab' : '') + (XRAY ? '&xray' : '');
  if(location.search !== url || location.hash) try{ history.replaceState(null, '', url); }catch(e){}   // refused inside sandboxed viewers (about:srcdoc)
}
// The link to send someone: the setup and your settings as a starting point, without the lab or x-ray flags.
export function shareUrl(){
  writeUrl();
  const u = new URL(location.href); u.searchParams.delete('lab'); u.searchParams.delete('xray'); u.hash = '';
  return u.toString().replace(/%2F/g, '/');
}
// ---- the glance list (Setup's home): every section's current values, drawn small, the number as a caption ----
const glanceShown = new Map();
const gput = (id, html) => { if(glanceShown.get(id) !== html){ glanceShown.set(id, html); $(id).innerHTML = html; } };
const gcell = (top, cap) => `<span class="gc"><span class="gt">${top}</span><small>${cap}</small></span>`;
const gbar = v => `<i class="gbar"><i style="width:${Math.round(v * 100)}%"></i></i>`;
const gnum = n => `<b>${n}</b>`, gword = w => `<span class="w">${w}</span>`, gbadge = t => `<i class="gbadge">${t}</i>`;
const pct = v => Math.round(v * 100);
let viewText = ['', ''];   // what the View row says, from viewer.js (the View setting lives there)
export function glanceView(name, cap){ viewText = [name, cap]; renderGlance(); }
const glanceHooks = { load(){}, async sessions(){ return []; } };
export const setGlanceHooks = h => Object.assign(glanceHooks, h);
function renderGlance(){
  const k = keyLabel(), click = isClick(), M = meter(), breathe = S.mode === 'breathe', tune = S.mode === 'tune', noise = S.mode === 'noise', synth = S.dsrc === 'synth';
  if(noise){
    // Noise: the color (its icon) and texture, the level; the EQ's shape; the waves; the timer
    const tex = textureOf(), color = NCOLORS.find(c => c[0] === S.ncolor)[1], eq = eqOf();
    gput('gv-nsound', `<img class="gtile" src="icons/n/${S.ncolor}.png" alt="">` + gcell(gword(tex ? tex[1] : color), tex ? color.toLowerCase() + ' noise' : 'noise')
      + gcell(gbar(+S.nvol), `level ${pct(+S.nvol)}`));
    const marks = eq.map((db, i) => [db, BANDS[i][2]]).filter(([db]) => db).sort((a, b) => Math.abs(b[0]) - Math.abs(a[0])).slice(0, 2)
      .map(([db, l]) => `${l === 'Low' ? 'lows' : l === 'High' ? 'highs' : l} ${db > 0 ? '+' : '−'}${Math.abs(db)}`);
    gput('gv-neq', gcell(gword(marks.length ? 'Shaped' : 'Flat'), marks.length ? marks.join(' · ') : 'no EQ'));
    gput('gv-nwave', S.nwave === '0' ? gcell(gword('Off'), 'steady') : gcell(gnum(S.nwave) + gword('s'), `waves · depth ${S.nswell}`));
    gput('gv-ntimer', S.len === '0' ? gcell(gword('Off'), 'no timer') : gcell('<i class="gring"></i>' + gnum(S.len), 'min · fades out'));
  } else if(!breathe && !tune){
    // Groove: the tempo (its stop on the seven-groove scale when the drums play), the drums' level
    const scale = `<i class="gscale">${TEMPOS.map(t => `<i${t === S.bpm ? ' class="on"' : ''}></i>`).join('')}</i>`;
    gput('gv-groove', gcell(gnum(S.bpm) + (click ? '' : scale), `bpm · ${describe().long}`)
      + (click ? '' : gcell(gbar(+S.dvol), `drums ${pct(+S.dvol)}`)));
    // Click: one bar of the pattern as dots (accent · beat · quiet subdivision · off), the click's level
    const c = cellsNow(), p = PATTERNS.find(x => x[0] === S.click) || PATTERNS[0], label = (M.compound && p[2]) || p[1];
    const dots = `<i class="gdots">${[...c.cells].map(v => `<i class="${['o', 'q', 'b', 'a'][v]}"></i>`).join('')}</i>`;
    gput('gv-click', S.click === 'off' ? gcell(gword('Off'), click ? 'silent beats' : 'drums only')
      : gcell(dots, label.toLowerCase() + (S.count === 'off' ? '' : ' · count')) + gcell(gbar(+S.cvol), `click ${pct(+S.cvol)}`));
    // Drone: the key, the Wash's level
    gput('gv-drone', gcell(gbadge(k), S.wash === 'on' ? (progShort() || (synth ? droneWord().toLowerCase() : 'wash')) + (S.a4 === '440' ? '' : ` · A ${S.a4}`) : 'no drone') + (S.wash === 'on' ? gcell(gbar(+S.wvol), `${synth ? 'synth' : 'wash'} ${pct(+S.wvol)}`) : ''));
    // Practice: loop bars with the drop-out drawn (filled bars on, hollow off), the session length, the ramp
    const [on, off] = S.drop.split('-').map(Number), r = ramp();
    const sq = on ? `<i class="gsq">${'<i></i>'.repeat(on)}${'<i class="off"></i>'.repeat(off)}</i>` : '';
    const isL = S.len[0] === 'l';
    gput('gv-practice', gcell(gnum(S.bars) + sq, (on ? `bars · ${on} on ${off} off` : 'bars') + (S.countin === '0' ? ' · no count-in' : ''))
      + (S.len === '0' ? (r ? gcell(gnum(r.cap), `ramp to · bpm`) : gcell(gword('Open'), 'no timer'))
         : gcell('<i class="gring"></i>' + gnum(S.len.replace('l', '')), (isL ? 'loops' : 'min') + (r ? ` · ramp to ${r.cap}` : ''))));
  } else if(breathe){
    const isC = S.len[0] === 'c', b = breath();
    gput('gv-pattern', gcell(gnum(patternLabel()), b ? b[2].toLowerCase() : 'seconds in · hold · out · hold')
      + (S.len === '0' ? '' : gcell('<i class="gring"></i>' + gnum(S.len.replace('c', '')), isC ? 'cycles' : 'min')));
    const snd = S.bsound === 'wash' ? (synth ? droneWord().toLowerCase() : 'wash') : S.bsound === 'hum' ? 'hum on the out-breath' : 'silent';
    const cue = S.bcue === 'phase' ? 'cues' : S.bcue === 'count' ? 'counts' : 'no cues';
    gput('gv-sound', gcell(gbadge(k), `${snd} · ${cue}` + (S.a4 === '440' ? '' : ` · A ${S.a4}`)) + (S.bsound === 'wash' ? gcell(gbar(+S.wvol), `${synth ? 'synth' : 'wash'} ${pct(+S.wvol)} · swell ${S.swell}`) : ''));
  } else {
    gput('gv-tkey', gcell(gbadge(keyLabel(writtenKey())), `${S.tinst === 'C' ? 'concert' : inst()[1] + ' instrument'} · A ${S.a4}`));
    const lines = (LINES.find(l => l[0] === S.tlines) || LINES[0])[1], reg = { auto:'follow my voice', 1:'low', 2:'middle', 3:'high' }[S.treg];
    gput('gv-tlines', gcell(gword(lines), reg));
    gput('gv-tsound', (S.tdrone === 'wash' ? gcell(gbar(+S.wvol), synth ? `${droneWord().toLowerCase()} ${pct(+S.wvol)}` : `wash ${pct(+S.wvol)}`) : gcell(gword('No drone'), 'voice only'))
      + (+S.tdrums ? gcell(gnum(S.tdrums), 'bpm drums') : ''));
  }
  if(!tune && !noise){
    const cellsOn = 6, g = `<i class="ggrid">${Array.from({ length:16 }, (_, i) => `<i${i < cellsOn ? ' class="on"' : ''}></i>`).join('')}</i>`;
    gput('gv-view', viewText[0] ? g + gcell(gword(viewText[0]), viewText[1]) : '');
  }
  const { name, icon } = homeInfo();
  gput('gv-save', `<img class="gtile" src="${icon}" alt="">` + gcell(gword(name), 'add to Home Screen'));
}
// Recents: the last three distinct setups played (sessions of 20 s or more that logged a preset), newest first,
// the current one left out. Each tile loads that setup, mode included.
export async function refreshRecents(){
  let all = []; try{ all = await glanceHooks.sessions(0); }catch(e){}
  const now = presetString(), seen = new Set([now]), recent = [];
  for(const x of all.filter(x => x.preset && x.icon).sort((a, b) => b.start - a.start)){
    if(seen.has(x.preset)) continue; seen.add(x.preset); recent.push(x); if(recent.length === 3) break;
  }
  gput('gv-recents', recent.length ? recent.map(x => `<button class="grec" data-preset="${x.preset}" aria-label="Load ${x.home}"><img class="gtile" src="${x.icon}" alt=""><small>${x.home}</small></button>`).join('')
    : '<span class="gempty">Setups you play show up here.</span>');
}
// Every mode writes the full-screen header through here: a direct write from one mode used to leave the cache holding
// another's text, so after Breathe the Groove header kept "4·7·8 · C".
let metaShown = '';
function setMeta(t){ if(t !== metaShown){ metaShown = t; $('bmeta').textContent = t; } }
// The custom grid: one button per cell, off · on · accent; a little air before each group. Cells are updated in
// place when the bar keeps its size, so a keyboard or VoiceOver user's focus stays on the cell just tapped.
const CELL = ['off', 'quiet', 'on', 'accent'];
function renderGrid(M){
  const el = $('cgrid');
  if(S.mode !== 'groove' || S.click !== 'c'){ el.innerHTML = ''; return; }
  const c = cellsNow(), G = grid(c.cells.length, 1, M), had = el.children.length === c.cells.length;
  if(!had) el.innerHTML = Array.from(c.cells).map((v, i) => `<button type="button" data-i="${i}" class="${i && G.lv[i] >= 3 ? 'g ' : ''}${G.lv[i] < 2 ? 'sub' : ''}"></button>`).join('');
  [...el.children].forEach((b, i) => { const v = c.cells[i]; b.dataset.v = v; b.setAttribute('aria-label', `Cell ${i + 1}, ${CELL[v]}`); if(had){ b.classList.toggle('g', !!i && G.lv[i] >= 3); b.classList.toggle('sub', G.lv[i] < 2); } });
}

// ---- the beats view: one bar of cells (the meter's pulses × the click's subdivision) laid out in rows by the lab's
//      place(), plus the small dots under the circle, one per felt beat. Rebuilt on settings changes and on resize,
//      never per frame; the frame loop only toggles .on. ----
let G = null, beatCell = [], litCell = -1, litBeat = -1;
const sizes = new Map();
const ro = window.ResizeObserver ? new ResizeObserver(es => { for(const e of es) sizes.set(e.target, [e.contentRect.width, e.contentRect.height]); placeCells(); }) : null;
if(ro) ro.observe(brow);
export function layoutBeats(){
  const M = meter(), { sub } = cellsNow(), n = M.top * sub;
  G = grid(n, 1, M);
  beatCell = M.beats.map((_, b) => M.beats.slice(0, b).reduce((a, x) => a + x, 0) * sub);   // each felt beat's first cell
  const text = i => S.count === 'off' ? '' : S.count === 'num' ? (G.lv[i] >= 2 ? G.syl[i] : '') : G.syl[i];
  brow.innerHTML = Array.from({length:n}, (_, i) => `<i class="${G.lv[i] >= 3 ? 'a' : ''}${G.lv[i] < 2 ? ' sub' : ''}"><span>${text(i)}</span></i>`).join('');
  cells = [...brow.children];
  dotsBox.innerHTML = M.beats.map((_, b) => `<i class="${M.pulseLevel[beatCell[b] / sub] === 3 ? 'a' : ''}"></i>`).join('');
  dots = [...dotsBox.children];
  if(litCell >= 0 && cells[litCell]) cells[litCell].classList.add('on');
  if(litBeat >= 0 && dots[litBeat]) dots[litBeat].classList.add('on');
  placeCells();
}
function placeCells(){
  const [W, H] = sizes.get(brow) || [0, 0]; if(!G || !W || !H || !cells.length) return;
  const L = place(G, W, H, Math.min(180, H * .8));
  cells.forEach((c, i) => { const p = L.cells[i]; c.style.setProperty('--s', L.s + 'px'); c.style.setProperty('--x', (p.x - L.s / 2) + 'px'); c.style.setProperty('--y', (p.y - L.s / 2) + 'px'); });
}

// ---- the breath curve under the circle (from Tide Breath): one cycle as a single line; a dot travels it ----
const CW = 400, CH = 48, CP = 6, bwave = $('bwave'), bwbase = $('bwbase'), bwlit = $('bwlit'), bwdot = $('bwdot');
let curveTotal = 0, curveLen = 0, curveKey = '';
function drawCurve(d){
  const key = d.join('-'); if(key === curveKey) return; curveKey = key;
  curveTotal = d.reduce((a, b) => a + b, 0); if(!curveTotal) return;
  const e = t => .5 - .5 * Math.cos(Math.PI * t), pts = [];
  for(let i = 0; i <= 120; i++){
    let t = i / 120 * curveTotal, p = 0; while(p < 3 && t > d[p]){ t -= d[p]; p++; }
    const f = d[p] ? Math.min(1, t / d[p]) : 0, h = [e(f), 1, 1 - e(f), 0][p];
    pts.push((i / 120 * (CW - 2 * CP) + CP).toFixed(1) + ',' + (CH - CP - h * (CH - 2 * CP)).toFixed(1));
  }
  const path = 'M' + pts.join(' L'); bwbase.setAttribute('d', path); bwlit.setAttribute('d', path);
  curveLen = bwlit.getTotalLength(); bwlit.style.strokeDasharray = curveLen; lightCurve(-1);
}
function lightCurve(pos){                                           // pos: seconds into the cycle, or −1 to rest
  if(pos < 0 || !curveTotal){ bwave.dataset.idle = 'true'; return; }
  bwave.dataset.idle = 'false';
  const len = Math.min(1, pos / curveTotal) * curveLen;
  bwlit.style.strokeDashoffset = curveLen - len;
  const pt = bwlit.getPointAtLength(len); bwdot.setAttribute('cx', pt.x); bwdot.setAttribute('cy', pt.y);
}

// ---- home-screen shortcut: suggested name and per-tempo+key icon (read by iOS when you tap Add to Home Screen).
//      iOS gets NO manifest: with one, it launched every shortcut from the manifest's bare start_url, and each
//      home-screen app starts with empty storage, so presets were lost. Without one it saves this page's URL (?p=…).
//      Other browsers (Android/desktop install) get a per-preset manifest instead. ----
const touchIcon = document.querySelector('link[rel="apple-touch-icon"]'), appTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]'),
      isIOS = 'standalone' in navigator;   // only iOS Safari exposes navigator.standalone
let manifestLink = null;
if(!isIOS){ manifestLink = document.createElement('link'); manifestLink.rel = 'manifest'; document.head.appendChild(manifestLink); }
// The home-screen name and icon of the current setup ("72 E♭ Ballad", icons/p/72-Eb.png); the session log keeps them
// so the Setup list's Recents can show a played setup as its tile.
export function homeInfo(){
  const k = keyLabel();
  const name = S.mode === 'noise' ? noiseName() : S.mode === 'breathe' ? breathHome() : S.mode === 'tune' ? tuneHome() : grooveHome(S, k);
  const icon = S.mode === 'noise' ? `icons/n/${S.ncolor}.png` : S.mode === 'breathe' ? `icons/b/${(breath() || [0, 0, 0, 'custom'])[3]}.png`
    : S.mode === 'tune' ? `icons/t/${S.key}${S.tinst === 'C' ? '' : '-' + S.tinst}.png` : isClick() ? `icons/c/${S.bpm}.png` : `icons/p/${S.bpm}-${S.key}.png`;
  return { name, icon };
}
function homeScreen(preset){
  const { name, icon } = homeInfo(), base = new URL('./', document.baseURI).href;   // baseURI, not location: about:srcdoc can't resolve './'
  document.title = `${name} · BackTrack`; appTitle.content = name; touchIcon.href = icon;
  $('scname').textContent = name; $('scicon').src = icon;
  if(!manifestLink) return;
  const m = { name, short_name:name, id:`./?p=${encodeURIComponent(preset)}`, start_url:`${base}?p=${preset}`, scope:base,
    display:'standalone', orientation:'any', background_color:'#FBFBFC', theme_color:'#FBFBFC',
    icons:[{src:base + icon, sizes:'180x180', type:'image/png'}, {src:base + 'icons/icon-192.png', sizes:'192x192', type:'image/png'},
           {src:base + 'icons/icon-512.png', sizes:'512x512', type:'image/png'}] };
  manifestLink.href = 'data:application/manifest+json,' + encodeURIComponent(JSON.stringify(m));
}
// Share this setup: the share sheet with the link and its name, or the link copied where there's no share sheet.
async function shareSetup(){
  const url = shareUrl(), title = `${homeInfo().name} · BackTrack`;
  const copy = async () => { try{ await navigator.clipboard.writeText(url); toast('Link copied'); }catch(e){ toast(url, { ms:8000 }); } };
  if(!navigator.share) return copy();
  try{ await navigator.share({ title, url }); }catch(e){ if(!e || e.name !== 'AbortError') copy(); }
}
// ---- Save as audio: the first tap makes the file (export.js, loaded on demand), the second opens the share sheet, which
//      iOS opens only straight from a tap. A file made for other settings is dropped, and so is one once it's shared. ----
let aud = null, audMod = null, audBusy = () => false;            // aud = { key, file, pct } while being made or ready
const AUDLEN = 'backtrack-audlen';
const audKey = () => [presetString(), S.a4, S.dvol, S.wvol, S.cvol, $('audlen').value].join('|');
const mbOf = bytes => `${Math.max(1, Math.round(bytes / 1048576))} MB`;
function audible(){                                                // a silent setup makes no file
  if(S.mode === 'noise') return true;
  if(S.mode === 'breathe') return (S.bsound === 'wash' && +S.wvol > 0) || S.bsound === 'hum' || S.bcue !== 'off';
  if(S.mode === 'tune') return (S.tdrone === 'wash' && +S.wvol > 0) || (+S.tdrums > 0 && +S.dvol > 0);
  const st = setupOf(S);
  return (st.sound === 'drums' && +S.dvol > 0) || (S.wash === 'on' && +S.wvol > 0) || (+S.cvol > 0 && Array.from(st.cells).some(c => c > 0));
}
function audWhat(){
  if(S.mode === 'noise') return 'A WAV that loops seamlessly';
  if(S.mode === 'breathe') return 'A WAV that ends after a full breath';
  if(S.mode === 'tune') return `The ${S.tdrone === 'wash' ? 'drone' + (+S.tdrums ? ' and drums' : '') : 'drums'} as a WAV`;
  return 'A WAV that ends on a phrase';
}
function audSync(){
  const b = $('audsave'), h = $('audhint');
  if(aud && aud.key !== audKey()) aud = null;                      // the setup changed: that file is for another one
  if(aud && aud.file){ b.textContent = 'Share audio file'; b.disabled = false; h.textContent = `Ready, ${mbOf(aud.file.size)}: to Files, AirDrop or another app.`; return; }
  if(aud){ b.textContent = `Making… ${Math.round(aud.pct * 100)}%`; b.disabled = true; h.textContent = 'Keep BackTrack open while it’s made.'; return; }
  const ok = audible(); b.textContent = 'Save as audio'; b.disabled = !ok;
  h.textContent = ok ? `${audWhat()}, about ${mbOf(+$('audlen').value * 60 * renderRate() * 4)}.` : 'Nothing sounds in this setup yet.';
}
async function audTap(){
  if(aud && aud.file){                                             // straight from the tap: no await before the share sheet
    const f = aud.file;
    try{ await audMod.shareFile(f); if(aud && aud.file === f){ aud = null; audSync(); } }
    catch(e){ if(!e || e.name !== 'AbortError') toast('Couldn’t share the file.'); }
    return;
  }
  if(aud || !audible()) return;
  if(audBusy()){ toast('Finish the take first.'); return; }
  const min = +$('audlen').value, mine = aud = { key:audKey(), file:null, pct:0 };
  audSync();
  try{
    audMod ||= await import('./export.js');
    const file = await audMod.renderSetup(min, `BackTrack ${homeInfo().name.replace('♭', 'b')} ${min} min.wav`,
                                          p => { if(aud === mine){ mine.pct = p; audSync(); } });
    if(aud === mine){ mine.file = file; audSync(); }
  }catch(e){ if(aud === mine){ aud = null; audSync(); toast('Couldn’t make the audio file.'); } }
}
export function initAudioFile(busy){
  audBusy = busy;
  try{ const v = localStorage.getItem(AUDLEN); if(v && $('audlen').querySelector(`option[value="${v}"]`)) $('audlen').value = v; }catch(e){}
  $('audlen').addEventListener('change', () => { try{ localStorage.setItem(AUDLEN, $('audlen').value); }catch(e){} audSync(); });
  $('audsave').addEventListener('click', audTap);
  audSync();
}
// Inside an installed home-screen app there's no Share button, so offer the link to open in Safari instead.
export function initShortcutCard(){
  $('sharelink').addEventListener('click', shareSetup);
  if(!(navigator.standalone || matchMedia('(display-mode: standalone)').matches)) return;
  $('schint').innerHTML = 'To save this setup as another app, open its link in <b>Safari</b>, then Share → <b>Add to Home Screen</b>.';
  const cl = $('copylink'); cl.hidden = false;
  cl.addEventListener('click', async () => {
    const url = shareUrl();
    try{ await navigator.clipboard.writeText(url); cl.textContent = 'Link copied'; }catch(e){ toast(url, { ms:8000 }); }
    setTimeout(() => cl.textContent = 'Copy link', 2500);
  });
}

// ---- the circle (and, when horizontal, the four big beats) ----
// Every text write goes through put(): the frame loop runs 60 times a second, so it only touches the DOM on change.
const bword = $('bword'), bno = $('bno'), barsDone = $('bars-done'), elapsedEl = $('elapsed'), shown = new Map(),
      pulse = go.querySelector('.pulse'), tfill = $('tfill');
export const put = (el, v) => { v = String(v); if(shown.get(el) !== v){ shown.set(el, v); el.textContent = v; } };
export const face = {
  drone(text){ put($('dronecue'), text); put($('bdrone'), text ? '· ' + text : ''); },
  // Noise: the sound's name, the minutes so far, and the disc swelling with the waves (still, at full size, without them)
  noise(h, min){
    const sc = .55 + .45 * h;
    pulse.style.transform = tfill.style.transform = `scale(${sc.toFixed(4)})`;
    put(word, noiseName()); put(barno, String(min)); put(bword, noiseName()); put(bno, String(min));
  },   // a progression's "on F" / "next: C"
  running(on){
    document.querySelectorAll('[data-tone]').forEach(b => b.disabled = false);   // (re-)enabled whenever the session starts or stops
    const tune = S.mode === 'tune';
    go.setAttribute('aria-label', (on ? 'Stop' : 'Start') + (tune ? ' listening' : '')); go.dataset.running = String(on); document.body.dataset.running = String(on);
    put(hint, tune ? 'Tap the circle to stop listening' : 'Tap the circle to stop');
    if(on){ put(word, S.mode === 'breathe' ? 'Breathe in' : tune ? 'Opening mic' : S.mode === 'noise' ? noiseName() : 'Loading'); put(barno, '·'); return; }
    go.classList.remove('beat','down','rest','faded'); beats.classList.remove('rest','count'); cells.forEach(c => c.classList.remove('on')); put($('cents'), '');
    put(word, 'Tap to start'); dots.forEach(d => d.classList.remove('on')); litCell = litBeat = -1; face.drone('');
    pulse.style.transform = ''; tfill.style.transform = ''; lightCurve(-1);
    if(S.mode === 'groove'){ swap($('ptitle'), titleLine(S.bpm), 'fade'); setMeta(metaLine(S.bpm)); }   // a ramp's live tempo goes back to the preset's
    put($('bhint'), 'Tap anywhere to stop');
  },
  // a ramp in progress: the guide line and the big view's corner follow the tempo you hear
  tempo(bpm){
    if(bpm === liveBpm) return;
    const dir = liveBpm == null ? 'fade' : Math.sign(bpm - liveBpm); liveBpm = bpm;
    swap($('ptitle'), titleLine(bpm, true), dir); setMeta(metaLine(bpm));
  },
  // a session length: how much is left, in the hint line under the circle and in the big view's corner
  left(info){
    const t = !info ? '' : info.sec != null ? (info.sec > 60 ? `${Math.ceil(info.sec / 60)} min left` : 'Last minute') : info.count > 1 ? `${info.count} ${info.unit}s left` : `Last ${info.unit}`;
    put(hint, t ? `${t} · Tap the circle to stop` : 'Tap the circle to stop'); put($('bhint'), t ? `${t} · tap anywhere to stop` : 'Tap anywhere to stop');
  },
  // Breathe: w = where() — the disc (and the full-screen tide) is the breath, eased exactly like the swell you hear
  breath(w){
    const sc = .55 + .45 * w.h;
    pulse.style.transform = tfill.style.transform = `scale(${sc.toFixed(4)})`;
    put(word, PHASES[w.p]); put(barno, Math.max(1, Math.ceil(w.left - 1e-6)));
    put(bword, PHASES[w.p]); put(bno, Math.max(1, Math.ceil(w.left - 1e-6)));
    put(barsDone, w.n);
    lightCurve(w.at);
  },
  held(on){
    go.setAttribute('aria-label', on ? 'Resume' : 'Stop' + (S.mode === 'tune' ? ' listening' : ''));
    document.querySelectorAll('[data-tone]').forEach(b => b.disabled = on);   // a tone would resume the paused session
    put(hint, on ? 'Tap the circle to resume' : S.mode === 'tune' ? 'Tap the circle to stop listening' : 'Tap the circle to stop');
    if(on){ put(word, 'Paused'); put(bword, 'Paused'); }
  },
  offline(){ put(word, 'Offline'); put(barno, '·'); },
  preroll(){ put(word, 'Bar'); put(barno, 1); put(bword, 'Bar'); put(bno, 1); },   // the moment before bar 1, no count-in
  count(cb){                                                                        // cb = the beat through the count-in bar
    put(word, 'Count in'); put(barno, cb + 1); dots.forEach((d, i) => d.classList.toggle('on', i === cb));
    beats.classList.add('count'); beats.classList.remove('rest');
    const c = beatCell[cb] ?? cb; cells.forEach((x, i) => x.classList.toggle('on', i === c)); litCell = c; litBeat = cb;
    put(bword, 'Count in'); put(bno, cb + 1);
  },
  // beat = the felt beat, cell = the big view's cell, down = the beat starts a group (the circle's bigger pulse)
  bar({beat, bar, cell, inLoop, rest, newBeat, newCell, down}){
    if(newBeat){
      go.classList.remove('beat','down'); void go.offsetWidth;
      if(!reduced) go.classList.add(down ? 'down' : 'beat');
      dots.forEach((d, i) => d.classList.toggle('on', i === beat)); litBeat = beat;
      put(barsDone, bar);
    }
    if(newCell){ cells.forEach((c, i) => c.classList.toggle('on', i === cell)); litCell = cell; }
    go.classList.toggle('rest', rest); beats.classList.toggle('rest', rest); beats.classList.remove('count');
    put(word, rest ? 'Keep time' : 'Bar'); put(barno, inLoop);
    put(bword, rest ? 'Keep time' : 'Bar'); put(bno, inLoop);
  },
  elapsed(sec){ put(elapsedEl, Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0')); },
};

// ---- the Setup sheet: slides up from the bottom, tabs per area, drag the handle down (or tap outside, or Esc) to close.
//      A non-modal <dialog> inside #app, not showModal(): the top layer would escape night mode's rotated #app. ----
const sheet = $('sheet'), scrim = $('scrim'), sheetHead = $('sheethead'), tabs = [...document.querySelectorAll('#glance [data-tab]')], listPanel = $('panel-list');
const behind = [document.querySelector('.nav'), document.querySelector('main')];
let lastFocus = null, closing = 0, sheetState = 'closed';   // 'closed' | 'open' | 'closing' — the one source of truth
export const sheetOpen = () => sheetState === 'open';
// One sheet, three modes: 'setup' (the glance list, and the section panels behind it), 'takes' (the recordings),
// 'mic' (the one-time explainer before the iOS prompt). In Setup, `currentTab` is 'list' or a section's panel.
const MODES = { takes:'Takes', mic:'Record along' };
let currentTab = 'list';
const modeTabs = () => tabs.filter(t => (t.dataset.modes || '').split(' ').includes(S.mode) && !(t.dataset.tab === 'lab' && !LAB) && !(t.dataset.tab === 'view' && LAB));   // the lab has its own view controls
// Called when the mode changes: show that mode's rows; a section panel open from another mode goes back to the list.
export function syncTabs(){
  const shown = modeTabs();
  for(const t of tabs) t.hidden = !shown.includes(t);
  if(!shown.some(t => t.dataset.tab === currentTab)) currentTab = 'list';
  if(sheet.dataset.mode === 'setup') selectTab(currentTab); else { listPanel.hidden = true; for(const t of tabs) $(t.getAttribute('aria-controls')).hidden = true; }
}
function showMode(mode){
  sheet.dataset.mode = mode; if(mode !== 'setup') $('sheettitle').textContent = mode === 'mic' && $('panel-mic').dataset.for === 'tune' ? 'Tune listens while it runs' : MODES[mode] || '';
  for(const p of document.querySelectorAll('.panel[data-mode]')) p.hidden = p.dataset.mode !== mode;
  if(mode === 'setup') selectTab(currentTab);
  else { listPanel.hidden = true; $('sheetback').hidden = true; delete sheet.dataset.view; for(const t of tabs) $(t.getAttribute('aria-controls')).hidden = true; }
}
// The one-time microphone explainer, worded for ● Rec or for Tune.
export function micSheet(forTune){
  $('panel-mic').dataset.for = forTune ? 'tune' : 'rec';
  $('micallow').textContent = forTune ? 'Allow the microphone and start' : 'Allow the microphone and record';
  openSheet('mic');
}
export function openSheet(name){
  const mode = MODES[name] ? name : 'setup';
  if(mode === 'setup'){ currentTab = 'list'; refreshRecents(); }   // Setup always opens on the list
  showMode(mode);
  if(sheetState === 'open'){ focusSheet(); return; }
  clearTimeout(closing); sheetState = 'open';
  lastFocus = document.activeElement;
  // show() focuses the first tab and scrolls it into view; in night portrait #app is the scroll container and
  // the sheet still sits below it, so keep #app's scroll position or the whole turned layout jumps.
  const app = $('app'), y = app.scrollTop;
  if(!sheet.open) sheet.show();
  app.scrollTop = y;
  scrim.hidden = false; behind.forEach(el => el.inert = true);
  void sheet.offsetHeight;                      // flush the closed position so the slide-up animates (no rAF dependency)
  sheet.classList.add('up'); scrim.classList.add('on');
  focusSheet();
}
function focusSheet(){
  const target = sheet.dataset.mode === 'setup' ? (currentTab === 'list' ? (modeTabs()[0] || $('sheetdone')) : $('sheetback'))
    : (document.querySelector(`.panel[data-mode="${sheet.dataset.mode}"] button:not([disabled])`) || $('sheetdone'));
  target.focus({preventScroll:true});
}
export function closeSheet(){
  if(sheetState !== 'open') return;             // already closed or closing
  sheetState = 'closing'; clearTimeout(closing);
  sheet.classList.remove('up'); scrim.classList.remove('on'); behind.forEach(el => el.inert = false);
  closing = setTimeout(() => { if(sheetState !== 'closing') return; sheetState = 'closed'; sheet.close(); scrim.hidden = true; sheet.style.transform = ''; }, reduced ? 0 : 320);
  if(lastFocus && lastFocus.focus) lastFocus.focus({preventScroll:true});
}
// Every Setup panel (all modes) and the list stay laid out but invisible and inert behind the one showing
// (see .panel.behind), so Setup is one height whatever the section or mode.
function selectTab(name){
  currentTab = name;
  const show = (panel, on) => {
    const wasOff = panel.hidden || panel.classList.contains('behind');
    panel.hidden = false; panel.classList.toggle('behind', !on); panel.inert = !on;
    if(on && wasOff && !reduced){ panel.classList.remove('panel-in'); void panel.offsetWidth; panel.classList.add('panel-in'); }
  };
  show(listPanel, name === 'list');
  for(const t of tabs){
    const on = t.dataset.tab === name, laid = t.dataset.tab !== 'lab' || LAB, panel = $(t.getAttribute('aria-controls'));
    if(!laid){ panel.hidden = true; continue; }
    show(panel, on);
  }
  const row = tabs.find(t => t.dataset.tab === name);
  sheet.dataset.view = name === 'list' ? 'list' : 'panel';
  $('sheetback').hidden = name === 'list';
  $('sheetback').lastChild.textContent = name === 'synth' && subBack && subBack !== 'list' ? titleOf(subBack) : 'Setup';   // ‹ Drone / ‹ Sound
  $('sheettitle').textContent = row ? row.querySelector('.gk').textContent : 'Setup';
  if(name === 'neq') kickSpectrum();
}
// ---- Setup ▸ Synth, a panel opened from the Drone (Groove) or Sound (Breathe, Tune) panel rather than the list: its
//      back button returns there. Notes | Tone views: the preset menus and chips, Octave, Pure | Even, and the two
//      16-bar harmonic editors. Edits go to app.js (setSynthHooks), which writes S, ends a take and tells the drone. ----
let subBack = null, sview = 'notes', nread = null, tread = null, noteBars = null, toneBars = null, synthHooks = { start(){}, edit(){} };
export const setSynthHooks = h => { synthHooks = h; };
const titleOf = tab => { const r = tabs.find(t => t.dataset.tab === tab); return r ? r.querySelector('.gk').textContent : 'Setup'; };
export function openSub(name){ subBack = currentTab; nread = tread = null; selectTab(name); renderSynth(); $('sheetback').focus({preventScroll:true}); }
const TONE_NOTE = { pure:'A sine: the fundamental alone, nothing above it.', flute:'The fundamental and a breath of the next few harmonics.',
  reed:'Odd harmonics: hollow, like a clarinet or a shruti box’s reeds.', strings:'Every harmonic, falling away like a bowed string’s.',
  organ:'A drawbar organ: 8′ 4′ 2⅔′ 2′ 1⅗′ 1⅓′ 1′.', glass:'Octaves and fifths high above: a bright, glassy shimmer.' };
const fundMidi = () => 69 + 12 * Math.log2(FREQ[S.key] * Math.pow(2, +S.soct - 2) / 440);   // harmonic 1, named at A = 440
// "5 · E5, a pure major 3rd, 14¢ below a piano's"; in Even, how far the note moved to its piano key
function harmonicText(n){
  const h = harmonicInfo(n, fundMidi(), 'pure'), even = S.stemp === 'even';
  const off = !h.cents ? '' : even ? `, moved ${Math.abs(h.cents)}¢ to the piano key` : `, ${Math.abs(h.cents)}¢ ${h.cents < 0 ? 'below' : 'above'} a piano’s`;
  return `${n} · ${h.name}, ${h.role}${off}`;
}
function notesSummary(){
  const lv = levelsOf(S.snotes), names = [];
  for(let n = 1; n <= H; n++) if(lv[n - 1] > 0) names.push(harmonicInfo(n, fundMidi(), 'pure').name);
  return `${notesName()}: ${names.length > 7 ? names.slice(0, 6).join(' · ') + ' … ' + names[names.length - 1] : names.join(' · ')}`;
}
const toneText = m => m == null ? (TONE_NOTE[(tonePreset(S.stone) || [])[0]] || 'Your own tone: each bar is a harmonic of every note.')
  : `Harmonic ${m + 1} of every note · ${Math.round(levelsOf(S.stone)[m] * 100)} %`;
function initSynth(){
  $('snp').innerHTML = NOTES.map(([id, name]) => `<option value="${id}">${name}</option>`).join('') + '<option value="custom" disabled>Custom</option>';
  $('stp').innerHTML = TONES.map(([id, name]) => `<button class="btn" data-stone="${id}">${name}</button>`).join('');
  noteBars = makeBars($('snbars'), { name: i => harmonicText(i + 1), show: i => { nread = i; }, start: () => synthHooks.start(), edit: (i, v) => synthHooks.edit('notes', i, v) });
  toneBars = makeBars($('stbars'), { name: i => `Harmonic ${i + 1} of every note`, show: i => { tread = i; }, start: () => synthHooks.start(), edit: (i, v) => synthHooks.edit('tone', i, v) });
  $('synthsw').addEventListener('click', e => { const b = e.target.closest('[data-sv]'); if(b){ sview = b.dataset.sv; renderSynth(); } });
  document.querySelectorAll('[data-opens]').forEach(b => b.addEventListener('click', () => openSub(b.dataset.opens)));
}
function renderSynth(){
  if(!noteBars) return;
  const on = S.dsrc === 'synth', gOn = on && S.wash === 'on', bOn = on && S.bsound === 'wash', tOn = on && S.tdrone === 'wash';
  const label = `<span>${toneName()} · ${notesName()}</span><span aria-hidden="true">›</span>`;
  for(const id of ['gsynth', 'bsynth', 'tsynth']) if($(id).dataset.label !== label){ $(id).dataset.label = label; $(id).innerHTML = label; }
  $('gsynth').hidden = !gOn; document.querySelector('#panel-drone .tones').hidden = gOn;   // a synth is its own reference tone
  $('bsynthf').hidden = !bOn; $('tsynthf').hidden = !tOn; $('tsrow').classList.toggle('three', tOn); $('tsrow').classList.toggle('two', !tOn);
  document.querySelectorAll('#synthsw [data-sv]').forEach(b => b.setAttribute('aria-pressed', b.dataset.sv === sview));
  $('sv-notes').hidden = sview !== 'notes'; $('sv-tone').hidden = sview !== 'tone';
  const np = notesPreset(S.snotes), tp = tonePreset(S.stone);
  $('snp').value = np ? np[0] : 'custom'; $('soct').value = S.soct;
  document.querySelectorAll('#stemp [data-temp]').forEach(b => b.setAttribute('aria-pressed', b.dataset.temp === S.stemp));
  $('stempnote').textContent = S.stemp === 'even' ? 'Even: each note on the nearest piano key, for playing along with piano or guitar.'
    : 'Pure: the harmonic series itself, so nothing beats. Its 3rd sits 14¢ and its 7th 31¢ below a piano’s.';
  document.querySelectorAll('#stp [data-stone]').forEach(b => b.setAttribute('aria-pressed', !!tp && b.dataset.stone === tp[0]));
  noteBars.draw(levelsOf(S.snotes)); toneBars.draw(levelsOf(S.stone));
  $('snread').textContent = nread == null ? notesSummary() : harmonicText(nread + 1);
  $('stread').textContent = toneText(tread);
}
// A 16-bar harmonic editor. Paint levels by dragging across the bars (also on the turned layout, where the page's "up"
// is the screen's right); a finger that leaves the bars keeps setting the last one, so a push past the top is 100 %.
// Each bar is a slider for the keyboard and VoiceOver (↑/→ a step up, ↓/← down, Page ↑/↓ a quarter, Home/End).
// start() comes before a gesture's first change (a take in progress ends first); edit(i, level) per change.
function makeBars(el, o){
  el.innerHTML = Array.from({ length: H }, (_, i) => `<div class="hbar${[1, 2, 4, 8, 16].includes(i + 1) ? ' rootk' : ''}" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="100" data-i="${i}"><div class="ht"><div class="hf"></div></div><span class="hn" aria-hidden="true">${i + 1}</span></div>`).join('');
  const bars = [...el.children], fills = bars.map(b => b.querySelector('.hf'));
  let lv = new Float32Array(H), drag = null;
  const put = (i, v) => { v = Math.round(Math.max(0, Math.min(1, v)) * 15) / 15; o.show(i); if(Math.abs(lv[i] - v) < 1e-6){ renderSynth(); return; } lv[i] = v; o.edit(i, v); };
  const hit = e => {                                       // the column under the finger (across the row: x, or y turned), its level
    const t = turned(), rs = bars.map(b => b.querySelector('.ht').getBoundingClientRect());
    const across = t ? e.clientY : e.clientX, mid = r => t ? (r.top + r.bottom) / 2 : (r.left + r.right) / 2;
    let i = 0; rs.forEach((r, k) => { if(Math.abs(mid(r) - across) < Math.abs(mid(rs[i]) - across)) i = k; });
    const r = rs[i];
    if(!drag && (t ? e.clientX < r.left - 8 || e.clientX > r.right + 8 : e.clientY < r.top - 8 || e.clientY > r.bottom + 8)) return null;   // a press starts on the bars
    return { i, v: t ? (e.clientX - r.left) / r.width : (r.bottom - e.clientY) / r.height };
  };
  el.addEventListener('pointerdown', e => {
    const h = hit(e); if(!h) return;
    e.preventDefault(); try{ el.setPointerCapture(e.pointerId); }catch(err){}
    drag = { i: h.i }; o.start(); put(h.i, h.v); bars[h.i].focus({ preventScroll:true });
  });
  el.addEventListener('pointermove', e => { if(!drag) return; const h = hit(e); if(h){ drag.i = h.i; put(h.i, h.v); } });
  const up = () => { drag = null; };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('keydown', e => {
    const b = e.target.closest('.hbar'); if(!b) return;
    const i = +b.dataset.i, q = 1 / 15;
    const v = { ArrowUp: lv[i] + q, ArrowRight: lv[i] + q, ArrowDown: lv[i] - q, ArrowLeft: lv[i] - q, PageUp: lv[i] + 4 * q, PageDown: lv[i] - 4 * q, Home: 0, End: 1 }[e.key];
    if(v == null) return;
    e.preventDefault(); o.start(); put(i, v);
  });
  el.addEventListener('focusin', e => { const b = e.target.closest('.hbar'); if(b){ o.show(+b.dataset.i); renderSynth(); } });
  return {
    draw(a){
      lv = Float32Array.from(a);
      bars.forEach((b, i) => {
        const p = Math.round(a[i] * 100);
        fills[i].style.height = p + '%'; b.classList.toggle('on', a[i] > 0);
        if(b.getAttribute('aria-valuenow') !== String(p)) b.setAttribute('aria-valuenow', p);
        b.setAttribute('aria-valuetext', `${o.name(i)}: ${p} %`);
      });
    },
  };
}

// ---- Noise ▸ EQ: the spectrum, with the EQ's curve over it. Playing: what the analyser after the EQ and waves hears;
//      stopped: the color's slope plus the EQ. Both are drawn relative to 1 kHz on a ±30 dB scale, so the shape reads
//      the same either way. Drawn only while the panel shows, at most 30 times a second. ----
const specCv = $('nspec'), FREQS = Float32Array.from({ length:120 }, (_, i) => 20 * Math.pow(1000, i / 119));
const SLOPE = { white:0, pink:-3, brown:-6, grey:-3, blue:3, violet:6 };
let specRaf = 0, specAt = 0, eqOC = null, eqF = null, specBins = null;
function eqCurve(){                                                 // the five bands' dB at FREQS (grey's lift included)
  if(!eqOC){ eqOC = new OfflineAudioContext(1, 1, 48000); eqF = BANDS.map(([type, f]) => { const b = eqOC.createBiquadFilter(); b.type = type; b.frequency.value = f; if(type === 'peaking') b.Q.value = 1; return b; }); }
  const tot = new Float32Array(FREQS.length), mag = new Float32Array(FREQS.length), ph = new Float32Array(FREQS.length);
  eqLive().forEach((db, i) => { eqF[i].gain.value = db; eqF[i].getFrequencyResponse(FREQS, mag, ph); for(let k = 0; k < FREQS.length; k++) tot[k] += 20 * Math.log10(mag[k] || 1e-6); });
  return tot;
}
function liveShape(an){                                             // the analyser's dB, a sixth of an octave around each point
  if(!specBins || specBins.length !== an.frequencyBinCount) specBins = new Float32Array(an.frequencyBinCount);
  an.getFloatFrequencyData(specBins);
  const hz = an.context.sampleRate / an.fftSize, k6 = Math.pow(2, 1 / 12);
  return Array.from(FREQS, f => { const a = Math.max(1, Math.floor(f / k6 / hz)), b = Math.min(specBins.length - 1, Math.max(a, Math.ceil(f * k6 / hz)));
    let p = 0; for(let i = a; i <= b; i++) p += Math.pow(10, specBins[i] / 10); return 10 * Math.log10(p / (b - a + 1) || 1e-12); });
}
function drawSpectrum(){
  specRaf = 0;
  if(!sheetOpen() || currentTab !== 'neq' || document.hidden) return;
  const now = performance.now();
  if(now - specAt >= 33){
    specAt = now;
    const w = specCv.clientWidth, h = specCv.clientHeight, dpr = Math.min(2, devicePixelRatio || 1);
    if(w && h){
      if(specCv.width !== Math.round(w * dpr) || specCv.height !== Math.round(h * dpr)){ specCv.width = Math.round(w * dpr); specCv.height = Math.round(h * dpr); }
      const g = specCv.getContext('2d'), css = getComputedStyle(document.documentElement), col = n => css.getPropertyValue(n).trim();
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
      const X = f => w * Math.log(f / 20) / Math.log(1000), Y = db => h * .5 - db * (h / 60), eq = eqCurve(), an = noiseAnalyser();
      const at1k = FREQS.findIndex(f => f >= 1000);
      let shape = an ? liveShape(an) : Array.from(FREQS, (f, i) => SLOPE[S.ncolor] * Math.log2(f / 1000) + eq[i]);
      if(an){ const ref = shape[at1k] - eq[at1k]; shape = shape.map(v => v - ref); }       // the live shape, its 1 kHz where the EQ puts it
      g.strokeStyle = col('--border-color'); g.lineWidth = 1; g.setLineDash([3, 3]);
      for(const f of [100, 1000, 10000]){ g.beginPath(); g.moveTo(X(f), 0); g.lineTo(X(f), h); g.stroke(); }
      g.beginPath(); g.moveTo(0, Y(0)); g.lineTo(w, Y(0)); g.stroke(); g.setLineDash([]);
      g.beginPath(); g.moveTo(0, h);
      FREQS.forEach((f, i) => g.lineTo(X(f), Math.max(0, Math.min(h, Y(shape[i])))));
      g.lineTo(w, h); g.closePath(); g.globalAlpha = .28; g.fillStyle = col('--primary'); g.fill(); g.globalAlpha = 1;
      g.beginPath(); FREQS.forEach((f, i) => { const y = Math.max(1, Math.min(h - 1, Y(eq[i]))); i ? g.lineTo(X(f), y) : g.moveTo(X(f), y); });
      g.strokeStyle = col('--primary'); g.lineWidth = 1.6; g.stroke();
      g.fillStyle = col('--text-muted'); g.font = '10px ' + (col('--font-mono') || 'monospace');
      [['100', 100], ['1k', 1000], ['10k', 10000]].forEach(([t, f]) => g.fillText(t, X(f) + 3, h - 4));
    }
  }
  specRaf = requestAnimationFrame(drawSpectrum);
}
export function kickSpectrum(){ if(!specRaf) specRaf = requestAnimationFrame(drawSpectrum); }
export function initSheet(){
  syncTabs();
  tabs.forEach(t => t.addEventListener('click', () => { selectTab(t.dataset.tab); $('sheetback').focus({preventScroll:true}); }));
  $('sheetback').addEventListener('click', () => {
    const was = currentTab, from = subBack;
    if(was === 'synth' && from && from !== 'list' && modeTabs().some(t => t.dataset.tab === from)){   // back to the panel that opened it
      subBack = null; selectTab(from);
      const b = $(tabs.find(t => t.dataset.tab === from).getAttribute('aria-controls')).querySelector('.synthbtn'); if(b) b.focus({preventScroll:true});
      return;
    }
    selectTab('list'); (tabs.find(t => t.dataset.tab === was) || tabs[0]).focus({preventScroll:true});
  });
  $('gv-recents').addEventListener('click', e => { const b = e.target.closest('[data-preset]'); if(b){ glanceHooks.load(b.dataset.preset); refreshRecents(); } });   // the loaded setup is now the current one, so it leaves the row
  $('sheetdone').addEventListener('click', closeSheet);
  scrim.addEventListener('click', closeSheet);
  addEventListener('keydown', e => { if(e.key === 'Escape' && sheetState === 'open'){ e.preventDefault(); closeSheet(); } });
  // Drag the handle/header down to dismiss. In night mode on an upright phone the sheet is rotated 90°,
  // so "down" for the sheet is the finger moving left across the glass.
  let drag = null;
  const along = e => turned()
                     ? drag.x - e.clientX : e.clientY - drag.y;
  sheetHead.addEventListener('pointerdown', e => {
    if(e.target.closest('button')) return;
    drag = { x:e.clientX, y:e.clientY, t:performance.now(), d:0 }; sheet.style.transition = 'none'; sheetHead.setPointerCapture(e.pointerId);
  });
  sheetHead.addEventListener('pointermove', e => { if(!drag) return; drag.d = Math.max(0, along(e)); sheet.style.transform = `translateY(${drag.d}px)`; });
  const end = () => {
    if(!drag) return;
    const fast = drag.d / Math.max(1, performance.now() - drag.t) > .6;
    sheet.style.transition = ''; sheet.style.transform = '';
    if(drag.d > 90 || (fast && drag.d > 20)) closeSheet();
    drag = null;
  };
  sheetHead.addEventListener('pointerup', end); sheetHead.addEventListener('pointercancel', end);
}

// ---- two switches in the nav: Night (dim red colours) and Turn (the layout sideways, for a phone lying on its side
//      with rotation lock on; a PWA can't rotate the screen itself). They were one setting; apart, you can change
//      settings upright in Night — iOS's own pickers never turn with a CSS-rotated page. ----
export const turned = () => !!document.documentElement.dataset.turn && matchMedia('(orientation: portrait)').matches;   // the page is drawn sideways
export function initNight(){
  const night = $('night'), turn = $('turn'), root = document.documentElement, metas = [...document.querySelectorAll('meta[name="theme-color"]')];
  metas.forEach(m => m.dataset.day = m.content);
  const setNight = on => {
    if(on) root.dataset.theme = 'night'; else delete root.dataset.theme;
    night.textContent = on ? 'Day' : 'Night'; night.setAttribute('aria-pressed', on);
    metas.forEach(m => m.content = on ? '#0A0000' : m.dataset.day);
    try{ localStorage.setItem('backtrack-night', on ? '1' : ''); }catch(e){}
  };
  const setTurn = on => {
    if(on) root.dataset.turn = 'on'; else delete root.dataset.turn;
    turn.setAttribute('aria-pressed', on); turn.setAttribute('aria-label', on ? 'Turn upright' : 'Turn to landscape');
    try{ localStorage.setItem('backtrack-turn', on ? '1' : ''); }catch(e){}
    dispatchEvent(new Event('resize'));                                      // canvases re-measure in the new layout
  };
  night.addEventListener('click', () => setNight(!root.dataset.theme));
  turn.addEventListener('click', () => setTurn(!root.dataset.turn));
  setNight(!!root.dataset.theme); setTurn(!!root.dataset.turn);             // (the head script applied both before the first paint)
}

// A fresh session starts with an empty text cache, so nothing is skipped because an old frame wrote the same text.
let liveBpm = null;
export function faceReset(){ shown.clear(); liveBpm = null; }

// ---- a quiet one-line message above the thumb row, optionally with one action ("Undo", "Listen") ----
const toastEl = $('toast'); let toastTimer = 0;
export function toast(text, { action, onAction, ms = 3500 } = {}){
  clearTimeout(toastTimer);
  toastEl.innerHTML = ''; toastEl.append(text);
  if(action){ const b = document.createElement('button'); b.textContent = action; b.addEventListener('click', () => { toastEl.classList.remove('on'); onAction && onAction(); }); toastEl.append(b); }
  toastEl.classList.add('on');
  toastTimer = setTimeout(() => toastEl.classList.remove('on'), ms);
}

// ---- the Rec button (main screen, and in the full-screen beat view): idle · opening · recording m:ss · saving ----
const recBtns = [$('recbtn'), $('brec')];
export function recUI(state, sec = 0){
  document.body.classList.toggle('recording', state === 'recording');
  const label = state === 'opening' ? 'Opening mic…' : state === 'saving' ? 'Saving…'
    : state === 'recording' ? `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}` : 'Rec';
  for(const b of recBtns){
    put(b.querySelector('.rlabel'), label);
    b.setAttribute('aria-pressed', state === 'recording'); b.disabled = state === 'opening' || state === 'saving';
    b.setAttribute('aria-label', state === 'recording' ? 'Stop recording' : 'Record');
  }
}
export function takesCount(n){ put($('takescount'), n ? String(n) : ''); $('takesbtn').classList.toggle('empty', !n); }

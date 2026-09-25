// Everything on screen: readouts, the circle and the four-beat view, the Setup sheet, night mode, the shortcut card.
import { S, TEMPOS, SHORT, KEYS, keyLabel, groove, presetString, LAB, BREATHS, PHASES, durs, fmtN, breath, breathLabel, breathHome, patternLabel,
         LINES, inst, writtenKey, tuneLabel, tuneHome, isClick, meter, noteOf, termFor, PATTERNS, RAMPS, cells as cellsNow, ramp } from './state.js';
import { METERS, meterOf, maxSub } from './timeline.js';
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
  $('lchips').innerHTML = LINES.map(([l, label]) => `<button class="btn" data-l="${l}">${label}</button>`).join('');
  $('tkey').innerHTML = KEYS.map(([k]) => `<option value="${k}"></option>`).join('');          // texts follow the instrument (render)
  $('tdrums').insertAdjacentHTML('beforeend', TEMPOS.map(t => `<option value="${t}">${t} bpm</option>`).join(''));
  $('ticks').innerHTML = TEMPOS.map(t => `<span data-bpm="${t}">${t}</span>`).join('');
  $('meters').innerHTML = Object.keys(METERS).map(k => `<button class="btn" data-meter="${k}">${meterOf(k).label}</button>`).join('');
  $('cpat').innerHTML = PATTERNS.map(([c, l]) => `<option value="${c}">${l}</option>`).join('');
  $('csub').innerHTML = [1, 2, 3, 4].map(n => `<button class="btn" data-sub="${n}">${n}</button>`).join('');
  $('ramps').innerHTML = RAMPS.map(([r, l]) => `<button class="btn" data-r="${r}">${l}</button>`).join('');
  // tick marks on the tempo track, one per groove, where the thumb's centre sits at each stop
  $('tempotrack').insertAdjacentHTML('beforeend', TEMPOS.map((_, k) => `<i style="left:calc(14px + (100% - 28px) * ${k / (TEMPOS.length - 1)})"></i>`).join(''));
  document.querySelectorAll('input[type=range]').forEach(el => { fill(el); el.addEventListener('input', () => fill(el)); });
}

// ---- state → screen. Called after every settings change. ----
let shownBpm = null, gridKey = '', layoutKey = '';
// live: the tempo you hear under a ramp (Fine already inside it, so no suffix)
const titleLine = (bpm, live) => isClick() ? `${bpm} bpm · ${meter().label} click` : `${bpm} bpm` + (+S.fine && !live ? ` ${S.fine > 0 ? '+' : ''}${S.fine}%` : '') + ` · ${groove()[1]}`;
const metaLine = bpm => `${bpm} bpm · ${isClick() ? `Click · ${meter().label}` : groove()[1]} · ${keyLabel()}`;
// A select showing a value it has no option for (a link's 7-minute session) gets one extra option for it.
function pickOption(sel, value, label){
  let o = [...sel.options].find(x => x.value === value);
  if(!o){ o = sel.querySelector('.extra') || sel.appendChild(Object.assign(document.createElement('option'), { className:'extra' })); o.value = value; o.textContent = label; }
  sel.value = value;
}
export function render(){
  const k = keyLabel(), click = isClick(), M = meter(), g = groove(), gi = TEMPOS.indexOf(S.bpm), breathe = S.mode === 'breathe', tune = S.mode === 'tune';
  const genre = click ? `Click · ${M.label}` : g[1], classical = click ? termFor(S.bpm).name : g[2];
  if(document.body.dataset.mode !== S.mode){ document.body.dataset.mode = S.mode; syncTabs(); }
  document.body.dataset.sound = S.sound;
  document.querySelectorAll('#modes [data-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === S.mode));
  if(go.dataset.running !== 'true') go.setAttribute('aria-label', tune ? 'Start listening' : 'Start');
  // controls follow the state (links and restores change it without touching them)
  if(gi >= 0) tempo.value = gi; $('bpmfree').value = S.bpm;
  for(const id of ['bars','countin','fine','dvol','key','wash','wvol','drop','bsound','bcue','swell','cvol','count']) $(id).value = S[id];
  $('bkey').value = S.key; $('bwvol').value = S.wvol;
  durs().forEach((v, i) => $('d' + i).value = fmtN(v));             // rendered on change only, so this also corrects a rejected or clamped entry
  document.querySelectorAll('#pchips [data-p]').forEach(b => b.setAttribute('aria-pressed', b.dataset.p === S.pattern));
  $('swellrow').hidden = S.bsound !== 'wash';
  // Tune: the key menu names keys as the player reads them ("C · sounds B♭" on a B♭ instrument)
  for(const o of $('tkey').options) o.textContent = S.tinst === 'C' ? keyLabel(o.value) : `${keyLabel(writtenKey(o.value))} · sounds ${keyLabel(o.value)}`;
  for(const id of ['tinst','a4','tcents','treg','tspeed','tdrone','tdrums']) $(id).value = S[id];
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
  for(const o of $('cpat').options){ const p = PATTERNS.find(x => x[0] === o.value), label = M.compound ? p[2] : p[1], ok = label && !(o.value === 'b' && M.top !== 2 && M.top !== 4); o.hidden = !ok; if(label) o.textContent = label; }
  $('cpat').value = S.click;
  $('cnote').textContent = click && S.click === 'off' ? 'Silent: the beats keep time on screen only.' : 'Accents are the brighter click. The count shows in the big beats: turn the phone sideways, or use night mode.';
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
  $('code').textContent = breathe ? `${patternLabel()} · ${k}` : tune ? `Tune · ${wk}${il}` + (S.a4 !== '440' ? ` · ${S.a4}` : '') : click ? `${S.bpm} bpm · ${M.label} · ${k}` : `${S.bpm} bpm · ${k}`;
  $('countlabel').textContent = breathe ? 'Cycles' : 'Bars'; $('countwrap').hidden = tune;
  const preset = presetString(), q = '?p=' + preset, url = q + (LAB ? '&lab' : '');   // the lab flag rides along (and into home-screen shortcuts)
  $('hashview').textContent = q;
  if(location.search !== url || location.hash) try{ history.replaceState(null, '', url); }catch(e){}   // refused inside sandboxed viewers (about:srcdoc)
  homeScreen(preset, k);

  const dir = shownBpm == null ? 0 : Math.sign(S.bpm - shownBpm); shownBpm = S.bpm;
  swap($('bpmnow'), String(S.bpm), dir); swap($('genrenow'), genre, dir); swap($('classnow'), classical, dir);
  document.querySelectorAll('#ticks span').forEach(t => t.classList.toggle('on', +t.dataset.bpm === S.bpm));
  if(tune){
    const lines = { rfo:'root, fifth, octave', ro:'root and octave', maj:'major scale', min:'minor scale' }[S.tlines];
    swap($('ptitle'), tuneLabel(), 'fade');
    swap($('partist'), [S.tdrone === 'wash' ? 'Wash' : 'No drone', lines].concat(+S.tdrums ? [`${S.tdrums} bpm`] : []).join(' · '), 'fade');
    $('bmeta').textContent = tuneLabel() + (+S.tdrums ? ` · ${S.tdrums} bpm` : '');
  } else if(breathe){
    swap($('ptitle'), breathLabel(), 'fade');
    swap($('partist'), S.bsound === 'wash' ? `Wash in ${k}` : S.bsound === 'hum' ? `Hum on exhale in ${k}` : 'Silent', 'fade');
    $('bmeta').textContent = `${breathLabel()} · ${k}`;
    drawCurve(durs());
  } else {
    swap($('ptitle'), titleLine(S.bpm), 'fade');
    const [on, off] = S.drop.split('-').map(Number);
    swap($('partist'), (S.wash === 'on' ? `Wash in ${k}` : click ? 'Click only' : 'Drums only') + (on ? ` · ${on} on / ${off} off` : ''), 'fade');
    setMeta(metaLine(S.bpm));
  }
  $('swellout').textContent = S.swell; $('bwvolout').textContent = Math.round(S.wvol * 100);
  $('fineout').textContent = (S.fine > 0 ? '+' : '') + S.fine + '%';
  $('dvolout').textContent = Math.round(S.dvol * 100); $('wvolout').textContent = Math.round(S.wvol * 100); $('cvolout').textContent = Math.round(S.cvol * 100);
  $('tdvolout').textContent = Math.round(S.dvol * 100); $('twvolout').textContent = Math.round(S.wvol * 100);
  const lk = `${M.top}/${M.group}/${cellsNow().sub}/${S.count}`; if(lk !== layoutKey){ layoutKey = lk; layoutBeats(); }
}
let metaShown = '';
const setMeta = t => { if(t !== metaShown){ metaShown = t; $('bmeta').textContent = t; } };
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
function homeScreen(preset, k){
  const name = S.mode === 'breathe' ? breathHome() : S.mode === 'tune' ? tuneHome() : isClick() ? `${S.bpm} ${k} ${meter().label}` : `${S.bpm} ${k} ${SHORT[S.bpm]}`;
  const icon = S.mode === 'breathe' ? `icons/b/${(breath() || [0, 0, 0, 'custom'])[3]}.png`
    : S.mode === 'tune' ? `icons/t/${S.key}${S.tinst === 'C' ? '' : '-' + S.tinst}.png` : isClick() ? `icons/c/${S.bpm}.png` : `icons/p/${S.bpm}-${S.key}.png`, base = new URL('./', document.baseURI).href;   // baseURI, not location: about:srcdoc can't resolve './'
  document.title = `${name} · BackTrack`; appTitle.content = name; touchIcon.href = icon;
  $('scname').textContent = name; $('scicon').src = icon;
  if(!manifestLink) return;
  const m = { name, short_name:name, id:`./?p=${encodeURIComponent(preset)}`, start_url:`${base}?p=${preset}`, scope:base,
    display:'standalone', orientation:'any', background_color:'#FBFBFC', theme_color:'#FBFBFC',
    icons:[{src:base + icon, sizes:'180x180', type:'image/png'}, {src:base + 'icons/icon-192.png', sizes:'192x192', type:'image/png'},
           {src:base + 'icons/icon-512.png', sizes:'512x512', type:'image/png'}] };
  manifestLink.href = 'data:application/manifest+json,' + encodeURIComponent(JSON.stringify(m));
}
// Inside an installed home-screen app there's no Share button, so offer the link to open in Safari instead.
export function initShortcutCard(){
  if(!(navigator.standalone || matchMedia('(display-mode: standalone)').matches)) return;
  $('schint').innerHTML = 'To save this setup as another app, open its link in <b>Safari</b>, then Share → <b>Add to Home Screen</b>.';
  const cl = $('copylink'); cl.hidden = false;
  cl.addEventListener('click', async () => {
    try{ await navigator.clipboard.writeText(location.href); cl.textContent = 'Link copied'; }catch(e){ cl.textContent = location.href; }
    setTimeout(() => cl.textContent = 'Copy link to open in Safari', 2500);
  });
}

// ---- the circle (and, when horizontal, the four big beats) ----
// Every text write goes through put(): the frame loop runs 60 times a second, so it only touches the DOM on change.
const bword = $('bword'), bno = $('bno'), barsDone = $('bars-done'), elapsedEl = $('elapsed'), shown = new Map(),
      pulse = go.querySelector('.pulse'), tfill = $('tfill');
export const put = (el, v) => { v = String(v); if(shown.get(el) !== v){ shown.set(el, v); el.textContent = v; } };
export const face = {
  running(on){
    document.querySelectorAll('[data-tone]').forEach(b => b.disabled = false);   // (re-)enabled whenever the session starts or stops
    const tune = S.mode === 'tune';
    go.setAttribute('aria-label', (on ? 'Stop' : 'Start') + (tune ? ' listening' : '')); go.dataset.running = String(on); document.body.dataset.running = String(on);
    put(hint, tune ? 'Tap the circle to stop listening' : 'Tap the circle to stop');
    if(on){ put(word, S.mode === 'breathe' ? 'Breathe in' : tune ? 'Opening mic' : 'Loading'); put(barno, '·'); return; }
    go.classList.remove('beat','down','rest','faded'); beats.classList.remove('rest','count'); cells.forEach(c => c.classList.remove('on')); put($('cents'), '');
    put(word, 'Tap to start'); dots.forEach(d => d.classList.remove('on')); litCell = litBeat = -1;
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
const sheet = $('sheet'), scrim = $('scrim'), sheetHead = $('sheethead'), tabs = [...document.querySelectorAll('#tabs [role=tab]')];
const behind = [document.querySelector('.nav'), document.querySelector('main')];
let lastFocus = null, closing = 0, sheetState = 'closed';   // 'closed' | 'open' | 'closing' — the one source of truth
export const sheetOpen = () => sheetState === 'open';
// One sheet, three modes: 'setup' (the tabs), 'takes' (the recordings), 'mic' (the one-time explainer before the iOS prompt).
const MODES = { takes:'Takes', mic:'Record along' };
let currentTab = 'groove';
const modeTabs = () => tabs.filter(t => (t.dataset.modes || '').split(' ').includes(S.mode) && !(t.dataset.tab === 'lab' && !LAB));
// Called when the mode changes: show that mode's tabs, and its last tab.
export function syncTabs(){
  for(const t of tabs) t.hidden = !modeTabs().includes(t);
  let saved = null; try{ saved = localStorage.getItem('backtrack-tab-' + S.mode); }catch(e){}
  const shown = modeTabs();
  currentTab = shown.some(t => t.dataset.tab === saved) ? saved : shown[0].dataset.tab;
  if(sheet.dataset.mode === 'setup') selectTab(currentTab); else for(const t of tabs) $(t.getAttribute('aria-controls')).hidden = true;
}
function showMode(mode){
  sheet.dataset.mode = mode; $('sheettitle').textContent = mode === 'mic' && $('panel-mic').dataset.for === 'tune' ? 'Tune listens while it runs' : MODES[mode] || '';
  for(const p of document.querySelectorAll('.panel[data-mode]')) p.hidden = p.dataset.mode !== mode;
  if(mode === 'setup') selectTab(currentTab);
  else for(const t of tabs) $(t.getAttribute('aria-controls')).hidden = true;
}
// The one-time microphone explainer, worded for ● Rec or for Tune.
export function micSheet(forTune){
  $('panel-mic').dataset.for = forTune ? 'tune' : 'rec';
  $('micallow').textContent = forTune ? 'Allow the microphone and start' : 'Allow the microphone and record';
  openSheet('mic');
}
export function openSheet(name){
  const mode = MODES[name] ? name : 'setup';
  showMode(mode); if(mode === 'setup' && name) selectTab(name);
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
  const target = sheet.dataset.mode === 'setup' ? (tabs.find(t => t.getAttribute('aria-selected') === 'true') || tabs[0])
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
// Every Setup panel (all modes) stays laid out but invisible and inert behind the selected one (see .panel.behind),
// so Setup is one height whatever the tab or mode.
function selectTab(name){
  currentTab = name;
  for(const t of tabs){
    const on = t.dataset.tab === name, laid = t.dataset.tab !== 'lab' || LAB, panel = $(t.getAttribute('aria-controls'));
    const wasOff = panel.hidden || panel.classList.contains('behind');
    t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1;
    panel.hidden = !laid; panel.classList.toggle('behind', laid && !on); panel.inert = !on;
    if(on && wasOff && !reduced){ panel.classList.remove('panel-in'); void panel.offsetWidth; panel.classList.add('panel-in'); }
  }
  try{ localStorage.setItem('backtrack-tab-' + S.mode, name); }catch(e){}
}
export function initSheet(){
  const shownTabs = modeTabs;
  syncTabs();
  tabs.forEach(t => {
    t.addEventListener('click', () => selectTab(t.dataset.tab));
    t.addEventListener('keydown', e => {                                   // arrow keys move along the tab row
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if(!d) return;
      const v = shownTabs(), n = v[(v.indexOf(t) + d + v.length) % v.length]; selectTab(n.dataset.tab); n.focus(); e.preventDefault();
    });
  });
  $('sheetdone').addEventListener('click', closeSheet);
  scrim.addEventListener('click', closeSheet);
  addEventListener('keydown', e => { if(e.key === 'Escape' && sheetState === 'open'){ e.preventDefault(); closeSheet(); } });
  // Drag the handle/header down to dismiss. In night mode on an upright phone the sheet is rotated 90°,
  // so "down" for the sheet is the finger moving left across the glass.
  let drag = null;
  const along = e => (document.documentElement.dataset.theme === 'night' && matchMedia('(orientation: portrait)').matches)
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

// ---- night mode: dim red, and the layout turns to landscape ----
export function initNight(){
  const night = $('night'), metas = [...document.querySelectorAll('meta[name="theme-color"]')];
  metas.forEach(m => m.dataset.day = m.content);
  const set = on => {
    if(on) document.documentElement.dataset.theme = 'night'; else delete document.documentElement.dataset.theme;
    night.textContent = on ? 'Day' : 'Night'; night.setAttribute('aria-pressed', on);
    metas.forEach(m => m.content = on ? '#0A0000' : m.dataset.day);
    try{ localStorage.setItem('backtrack-night', on ? '1' : ''); }catch(e){}
  };
  night.addEventListener('click', () => set(!document.documentElement.dataset.theme));
  try{ if(localStorage.getItem('backtrack-night')) set(true); }catch(e){}
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

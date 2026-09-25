// Everything on screen: readouts, the circle and the four-beat view, the Setup sheet, night mode, the shortcut card.
import { S, TEMPOS, SHORT, keyLabel, groove, presetString, LAB } from './state.js';

export const $ = id => document.getElementById(id);
export const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const go = $('go'), word = $('word'), barno = $('barno'), dots = [...$('dots').children],
      beats = $('beats'), cells = [...beats.querySelectorAll('.row i')], hint = $('hint'), tempo = $('tempo');

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
  $('ticks').innerHTML = TEMPOS.map(t => `<span data-bpm="${t}">${t}</span>`).join('');
  // tick marks on the tempo track, one per groove, where the thumb's centre sits at each stop
  $('tempotrack').insertAdjacentHTML('beforeend', TEMPOS.map((_, k) => `<i style="left:calc(14px + (100% - 28px) * ${k / (TEMPOS.length - 1)})"></i>`).join(''));
  document.querySelectorAll('input[type=range]').forEach(el => { fill(el); el.addEventListener('input', () => fill(el)); });
}

// ---- state → screen. Called after every settings change. ----
let shownTempo = null;
export function render(){
  const k = keyLabel(), [, genre, classical] = groove(), gi = TEMPOS.indexOf(S.bpm);
  // controls follow the state (links and restores change it without touching them)
  tempo.value = gi;
  for(const id of ['bars','countin','fine','dvol','key','wash','wvol','drop','click']) $(id).value = S[id];
  document.querySelectorAll('input[type=range]').forEach(fill);

  $('code').textContent = `${S.bpm} bpm · ${k}`;
  const preset = presetString(), q = '?p=' + preset, url = q + (LAB ? '&lab' : '');   // the lab flag rides along (and into home-screen shortcuts)
  $('hashview').textContent = q;
  if(location.search !== url || location.hash) try{ history.replaceState(null, '', url); }catch(e){}   // refused inside sandboxed viewers (about:srcdoc)
  homeScreen(preset, k);

  const dir = shownTempo == null ? 0 : Math.sign(gi - shownTempo); shownTempo = gi;
  swap($('bpmnow'), String(S.bpm), dir); swap($('genrenow'), genre, dir); swap($('classnow'), classical, dir);
  document.querySelectorAll('#ticks span').forEach(t => t.classList.toggle('on', +t.dataset.bpm === S.bpm));
  swap($('ptitle'), `${S.bpm} bpm` + (+S.fine ? ` ${S.fine > 0 ? '+' : ''}${S.fine}%` : '') + ` · ${genre}`, 'fade');
  const [on, off] = S.drop.split('-').map(Number);
  swap($('partist'), (S.wash === 'on' ? `Wash in ${k}` : 'Drums only') + (on ? ` · ${on} on / ${off} off` : ''), 'fade');
  $('bmeta').textContent = `${S.bpm} bpm · ${genre} · ${k}`;
  $('fineout').textContent = (S.fine > 0 ? '+' : '') + S.fine + '%';
  $('dvolout').textContent = Math.round(S.dvol * 100); $('wvolout').textContent = Math.round(S.wvol * 100);
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
  const name = `${S.bpm} ${k} ${SHORT[S.bpm]}`, icon = `icons/p/${S.bpm}-${S.key}.png`, base = new URL('./', document.baseURI).href;   // baseURI, not location: about:srcdoc can't resolve './'
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
const bword = $('bword'), bno = $('bno'), barsDone = $('bars-done'), elapsedEl = $('elapsed'), shown = new Map();
const put = (el, v) => { v = String(v); if(shown.get(el) !== v){ shown.set(el, v); el.textContent = v; } };
export const face = {
  running(on){
    document.querySelectorAll('[data-tone]').forEach(b => b.disabled = false);   // (re-)enabled whenever the session starts or stops
    go.setAttribute('aria-label', on ? 'Stop' : 'Start'); go.dataset.running = String(on); document.body.dataset.running = String(on);
    put(hint, 'Tap the circle to stop');
    if(on){ put(word, 'Loading'); put(barno, '·'); return; }
    go.classList.remove('beat','down','rest'); beats.classList.remove('rest','count'); cells.forEach(c => c.classList.remove('on'));
    put(word, 'Tap to start'); dots.forEach(d => d.classList.remove('on'));
  },
  held(on){
    go.setAttribute('aria-label', on ? 'Resume' : 'Stop');
    document.querySelectorAll('[data-tone]').forEach(b => b.disabled = on);   // a tone would resume the paused session
    put(hint, on ? 'Tap the circle to resume' : 'Tap the circle to stop');
    if(on){ put(word, 'Paused'); put(bword, 'Paused'); }
  },
  offline(){ put(word, 'Offline'); put(barno, '·'); },
  preroll(){ put(word, 'Bar'); put(barno, 1); put(bword, 'Bar'); put(bno, 1); },   // the moment before bar 1, no count-in
  count(cb){                                                                        // cb = 0..3 through the count-in bar
    put(word, 'Count in'); put(barno, cb + 1); dots.forEach(d => d.classList.remove('on'));
    beats.classList.add('count'); beats.classList.remove('rest');
    cells.forEach((c, i) => c.classList.toggle('on', i === cb)); put(bword, 'Count in'); put(bno, cb + 1);
  },
  bar({beat, bar, inLoop, rest, newBeat}){
    if(newBeat){
      go.classList.remove('beat','down'); void go.offsetWidth;
      if(!reduced) go.classList.add(beat % 4 === 0 ? 'down' : 'beat');
      dots.forEach((d, i) => d.classList.toggle('on', i === beat % 4));
      cells.forEach((c, i) => c.classList.toggle('on', i === beat % 4));
      put(barsDone, bar);
    }
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
const MODES = { takes:'Takes', mic:'Record over the groove' };
let currentTab = 'groove';
function showMode(mode){
  sheet.dataset.mode = mode; $('sheettitle').textContent = MODES[mode] || '';
  for(const p of document.querySelectorAll('.panel[data-mode]')) p.hidden = p.dataset.mode !== mode;
  if(mode === 'setup') selectTab(currentTab);
  else for(const t of tabs) $(t.getAttribute('aria-controls')).hidden = true;
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
function selectTab(name){
  currentTab = name;
  for(const t of tabs){
    const on = t.dataset.tab === name, panel = $(t.getAttribute('aria-controls'));
    t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1;
    if(on && panel.hidden){ panel.hidden = false; if(!reduced){ panel.classList.remove('panel-in'); void panel.offsetWidth; panel.classList.add('panel-in'); } }
    else if(!on) panel.hidden = true;
  }
  try{ localStorage.setItem('backtrack-tab', name); }catch(e){}
}
export function initSheet(){
  $('tab-lab').hidden = !LAB;
  const shownTabs = () => tabs.filter(t => !t.hidden);
  let saved = null; try{ saved = localStorage.getItem('backtrack-tab'); }catch(e){}
  selectTab(shownTabs().some(t => t.dataset.tab === saved) ? saved : 'groove');
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
export function faceReset(){ shown.clear(); }

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

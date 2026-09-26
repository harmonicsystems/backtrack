// The View: which picture the full-screen view shows, its live preview in Setup ▸ View, and changing it while playing
// (‹ ›, a sideways swipe, ←/→). Groove: the beats view's own cells, or one of the canvas views in js/views.js.
// Breathe: the tide circle, or one of the breath pictures (box, water, flower, lazy 8, star, glow). Device-only, like
// night mode: a link never changes how your screen looks. (Tune has the pitch line.)
import { S, meter, cells as cellsNow, LAB, durs } from './state.js';
import { makeTimeline, setupOf, restIn } from './timeline.js';
import { clock, barIsRest } from './groove.js';
import { where } from './breath.js';
import { frameAt, drawViz, drawBreath, observe, SWAYS, BSTYLES } from './views.js';
import { grid } from './grid.js';
import { $, sheetOpen, turned } from './ui.js';

// The Sway pictures (side to side, full width) share one chip; ‹ › and swipes step through each of them.
export const VIEWS = { grid:'Grid', steps:'Steps', count:'Count', sweep:'Sweep', ring:'Ring', pendulum:'Pendulum', bounce:'Bounce', pulse:'Pulse', lane:'Lane', ...SWAYS };
const VKEYS = Object.keys(VIEWS), BKEYS = Object.keys(BSTYLES), SPANS = ['1', '2', '4'], SUBS = ['click', '1', '2', '3', '4'], DIRS = ['loop', 'swing', 'snake', 'snakeb'];
const CHIPS = [...Object.keys(VIEWS).filter(k => !SWAYS[k]), 'sway'], isSway = k => !!SWAYS[k];
const DEF = { style:'grid', sub:'4', span:'1', dir:'loop', full:'side', sway:'glide', pace:'1', ease:'smooth', bstyle:'tide' };
const OK = { style:VKEYS, sub:SUBS, span:SPANS, dir:DIRS, full:['side', 'always'], sway:Object.keys(SWAYS), pace:['1', '2', 'bar'], ease:['smooth', 'even', 'still'], bstyle:BKEYS };
const V = { ...DEF };   // full: 'side' (turned) | 'always' (upright too); sway: the last Sway picture; pace: beats per side; bstyle: Breathe's picture
try{ Object.assign(V, JSON.parse(localStorage.getItem('backtrack-view') || '{}')); }catch(e){}
const bigCv = $('bigviz'), prevCv = $('vprev'), beats = $('beats'), panel = $('panel-view');
[bigCv, prevCv].forEach(observe);
const breathing = () => S.mode === 'breathe';

// The view's grid: the bar's pulses × a subdivision (or the click pattern's), over 1–4 bars, at most 32 cells. Grid is
// the beats view's own cells (one bar of the click's), so its preview uses those. Worked out when settings change
// (viewChanged(), from app.js's update()), never per frame.
let sh = null;
function shape(){
  if(sh) return sh;
  const M = meter(), sw = isSway(V.style), grid1 = V.style === 'grid' || sw;   // Sway moves by beats; its cells are just the pulses (for rests)
  const sub = sw ? 1 : grid1 || V.sub === 'click' ? cellsNow().sub : Math.min(+V.sub, M.unit === 1 ? 4 : 2), per = M.top * sub;
  let span = grid1 ? 1 : +V.span; while(span > 1 && per * span > 32) span /= 2;
  const n = per * span;
  return sh = { n, span, dir: grid1 ? 'loop' : V.dir, G: grid(n, span, M), rest:restMemo, lb:16, pace:V.pace, ease:V.ease };
}
let chipMode = '';
export function viewChanged(){ sh = null; bd = null; if(S.mode !== chipMode) sync(); }
// drop-out lookups, cached for the few bars on screen (a view asks for every cell, every frame)
const rb = new Float64Array(8).fill(NaN), rv = new Uint8Array(8); let rtl = null;
function restMemo(b){
  if(rtl !== clock.tl){ rtl = clock.tl; rb.fill(NaN); }
  const k = ((b % 8) + 8) % 8; if(rb[k] !== b){ rb[k] = b; rv[k] = barIsRest(b) ? 1 : 0; }
  return rv[k] === 1;
}

function sync(){
  for(const k in DEF) if(!OK[k].includes(String(V[k]))) V[k] = DEF[k];
  if(isSway(V.style)) V.sway = V.style;
  try{ localStorage.setItem('backtrack-view', JSON.stringify(V)); }catch(e){}
  const br = breathing(), sw = !br && isSway(V.style);
  document.body.dataset.view = LAB ? 'lab' : V.style; document.body.dataset.bview = V.bstyle; document.body.dataset.full = V.full;
  if(chipMode !== S.mode){                                             // each mode lists its own pictures
    chipMode = S.mode;
    $('vchips').innerHTML = (br ? BKEYS : CHIPS).map(k => `<button class="btn" data-v="${k}">${br ? BSTYLES[k] : k === 'sway' ? 'Sway' : VIEWS[k]}</button>`).join('');
  }
  document.querySelectorAll('#vchips [data-v]').forEach(b => b.setAttribute('aria-pressed', br ? b.dataset.v === V.bstyle : b.dataset.v === V.style || (sw && b.dataset.v === 'sway')));
  for(const k of ['sub', 'span', 'dir']){ $('v' + k).value = V[k]; $('v' + k).disabled = V.style === 'grid'; }   // Grid is the beats view as it is
  $('vgridf').hidden = br || sw; $('vswayf').hidden = br || !sw;       // Sway has its own row: which one, its pace, its motion; Breathe needs neither
  for(const k of ['sway', 'pace', 'ease']) $('v' + k).value = V[k];
  $('vfull').checked = V.full === 'always';
  $('vname').textContent = br ? BSTYLES[V.bstyle] : VIEWS[V.style];
  sh = null; kick();
}
export function setView(p){ Object.assign(V, p); sync(); }
const step = d => breathing() ? setView({ bstyle: BKEYS[(BKEYS.indexOf(V.bstyle) + d + BKEYS.length) % BKEYS.length] })
  : setView({ style: VKEYS[(VKEYS.indexOf(V.style) + d + VKEYS.length) % VKEYS.length] });

// ---- per frame while a groove plays (called from app.js's tick with the same position the circle uses) ----
let live = null;
export function viewFrame(pos){
  if(LAB || !clock.tl){ live = null; return; }
  const big = V.style !== 'grid', prev = previewing();
  live = true;                                                       // (the silent preview stays off while playing)
  if(!big && !prev) return;                                          // Grid on its own: the beats view draws itself
  const o = shape(); o.lb = clock.loopBars;
  const F = frameAt(clock.tl, pos, o);
  if(big && beats.clientWidth) drawViz(bigCv, V.style, F);
  if(prev) drawViz(prevCv, big ? V.style : 'dots', F);
}
// ---- per frame while breathing: w = where() (the same moment the circle and the swell use), t = seconds since the
//      first inhale. Tide on its own is the DOM circle, so nothing to draw. ----
const B = { d:[4, 4, 4, 4], t:0 };
let bd = null;
export function viewBreath(w, t, d){
  live = true;
  const big = V.bstyle !== 'tide', prev = previewing();
  if(!big && !prev) return;
  Object.assign(B, w); B.d = d; B.t = t;
  if(big && beats.clientWidth) drawBreath(bigCv, V.bstyle, B);
  if(prev) drawBreath(prevCv, V.bstyle, B);
}
export function viewStop(){ live = null; kick(); }

// ---- the preview in Setup ▸ View: live while playing; otherwise a silent run of the current settings ----
const previewing = () => sheetOpen() && !panel.hidden && !panel.classList.contains('behind');
let prevRaf = 0, prevKey = '', prevTl = null, prevStart = performance.now();
function previewLoop(perf){
  prevRaf = 0;
  if(!previewing() || document.hidden || live) return;
  if(breathing()){                                                   // the pattern as it stands, breathing silently
    if(!bd){ bd = durs(); prevStart = perf; }
    const t = (perf - prevStart) / 1000;
    Object.assign(B, where(t, bd)); B.d = bd; B.t = t;
    drawBreath(prevCv, V.bstyle, B);
  } else {
    const setup = setupOf(S), k = JSON.stringify(setup);
    if(k !== prevKey){ prevKey = k; prevTl = makeTimeline(setup); prevStart = perf; }
    const o = shape();
    drawViz(prevCv, V.style === 'grid' ? 'dots' : V.style, frameAt(prevTl, (perf - prevStart) / 1000, { ...o, rest: b => restIn(S.drop, b), lb:+S.bars }));
  }
  prevRaf = requestAnimationFrame(previewLoop);
}
export function kick(){ if(!prevRaf && previewing() && !document.hidden && !live) prevRaf = requestAnimationFrame(previewLoop); }

export function initViewer(){
  $('vchips').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if(!b) return;
    if(breathing()) setView({ bstyle: b.dataset.v }); else setView({ style: b.dataset.v === 'sway' ? V.sway : b.dataset.v }); });
  $('vsway').innerHTML = Object.entries(SWAYS).map(([k, t]) => `<option value="${k}">${t}</option>`).join('');
  for(const k of ['sub', 'span', 'dir', 'pace', 'ease']) $('v' + k).addEventListener('change', () => setView({ [k]: $('v' + k).value }));
  $('vsway').addEventListener('change', () => setView({ style: $('vsway').value }));
  $('vfull').addEventListener('change', () => setView({ full: $('vfull').checked ? 'always' : 'side' }));
  // in the full-screen view: ‹ View › (a tap there doesn't stop), a sideways swipe, or ←/→ — Groove and Breathe
  const mine = () => !LAB && (S.mode === 'groove' || S.mode === 'breathe');
  $('vpick').addEventListener('click', e => { const b = e.target.closest('[data-d]'); if(b) step(+b.dataset.d); });
  // (the full-screen view has touch-action:none, so a finger's drag reaches us instead of becoming a scroll)
  let sw = null, swiped = false;
  beats.addEventListener('pointerdown', e => { swiped = false; sw = { x:e.clientX, y:e.clientY }; });
  beats.addEventListener('pointercancel', () => { sw = null; });
  beats.addEventListener('pointerup', e => {
    if(!sw || !mine()){ sw = null; return; }
    // turned on an upright phone the view is sideways, so "sideways" for it is the finger moving up or down
    const t = turned(), dx = t ? e.clientY - sw.y : e.clientX - sw.x, dy = t ? e.clientX - sw.x : e.clientY - sw.y; sw = null;
    if(Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)){ swiped = true; step(dx < 0 ? 1 : -1); }
  });
  beats.addEventListener('click', e => { if(swiped){ swiped = false; e.stopImmediatePropagation(); } }, true);   // a swipe isn't a tap to stop
  addEventListener('keydown', e => {
    if(!mine() || !beats.clientWidth || sheetOpen() || e.metaKey || e.ctrlKey || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if(e.key === 'ArrowRight' || e.key === 'ArrowLeft'){ e.preventDefault(); step(e.key === 'ArrowRight' ? 1 : -1); }
  });
  const mo = new MutationObserver(kick);                              // the View tab (or the sheet) shown: start the preview
  mo.observe(panel, { attributes:true, attributeFilter:['class', 'hidden'] }); mo.observe($('sheet'), { attributes:true, attributeFilter:['class', 'open'] });
  document.addEventListener('visibilitychange', kick);
  sync();
}

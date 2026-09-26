// ======== Lab (open with ?lab): the beat views (js/views.js, which the app's View setting uses too) with the lab's
//          extra controls — any grid size, span and direction, the "heard" clock and its sync readout, tap-the-beat
//          calibration. Loaded only with ?lab (app.js imports it on demand). Built in the "Tempo visualization
//          options" session. ========
import { S, meter } from './state.js';
import { ctx } from './audio.js';
import { clock, barIsRest } from './groove.js';
import { makeTimeline, setupOf, restIn } from './timeline.js';
import { STYLES, DIRS, frameAt, drawViz, observe } from './views.js';
import { clk, keep, pct, graphAt, lookahead } from './clock.js';
import { $, fill, syncTabs } from './ui.js';
import { mod, describe } from './grid.js';

let api = { running: () => false };

const SKEYS = Object.keys(STYLES), QUICK = [4, 8, 16, 32, 2, 3, 6, 12, 24], SPANS = [1, 2, 4, 0];
const DKEYS = Object.keys(DIRS);
const lab = {style:'steps', n:16, span:1, dir:'loop', big:'always', clock:'heard', offset:0, bar:true};
try{ Object.assign(lab, JSON.parse(localStorage.getItem('backtrack-lab')||'{}')); }catch(e){}
const bigCv = $('bigviz'), prevCv = $('prevviz'), labbar = $('labbar');
const landscape = matchMedia('(orientation: landscape) and (max-height: 520px)');
const bigOn = () => lab.big === 'always' || !!document.documentElement.dataset.turn || landscape.matches;
let diagAt = 0; const drawMs = [];
export function labFrame(pos, perf){
  if(!clock.tl) return;                              // the groove never loaded (Offline): nothing to draw against
  if(bigOn()){ drawViz(bigCv, lab.style, frameAt(clock.tl, pos, { n:lab.n, span:lab.span || clock.loopBars, dir:lab.dir, rest:barIsRest, lb:clock.loopBars })); keep(drawMs, performance.now() - perf, 240); }
  if(perf - diagAt > 500){ diagAt = perf; labDiag(); }
}
function labDiag(){
  clk.frame = Math.min(50, Math.max(4, pct(clk.frames, .5) || 1000/60));
  const ms = v => Math.round(v*1000), slow = clk.frames.filter(d => d > clk.frame*1.5).length;
  const t = `${Math.round(1000/clk.frame)} fps · ${slow} of ${clk.frames.length} frames slow · frame work ${pct(drawMs, .95).toFixed(1)} ms · audio clock steps up to ${pct(clk.jit, .95).toFixed(1)} ms\n` +
    `output latency ${clk.ts != null ? ms(clk.ts) + ' ms by timestamp · ' : ''}${ms(clk.rep)} ms reported · ${ctx.sampleRate/1000} kHz\n` +
    (clk.mode === 'raw' ? 'raw clock: the visuals run early by the latency' : `visuals held back ${Math.round(clk.lat*1000 + clk.offset - lookahead())} ms`);
  $('labdiag').textContent = t; $('lcarddiag').textContent = 'Last run:\n' + t;
}
// silent preview in the Lab tab, on performance.now(), while stopped and on screen
let prevRaf = 0, prevVisible = false, prevKey = '', prevTl = null; const prevStart = performance.now();
function previewLoop(perf){
  prevRaf = 0;
  if(api.running() || !prevVisible || document.hidden) return;
  const k = JSON.stringify(setupOf(S)); if(k !== prevKey){ prevKey = k; prevTl = makeTimeline(setupOf(S)); }   // the settings as they stand
  drawViz(prevCv, lab.style, frameAt(prevTl, (perf - prevStart)/1000, { n:lab.n, span:lab.span || +S.bars, dir:lab.dir, rest: b => restIn(S.drop, b), lb:+S.bars }));
  prevRaf = requestAnimationFrame(previewLoop);
}
export function kickPreview(){ if(!prevRaf && !api.running() && prevVisible && !document.hidden) prevRaf = requestAnimationFrame(previewLoop); }
// Tap the beat you hear: each tap's delay after its beat on the audio clock, median of 6+, becomes the offset.
const taps = [];
function labTap(perf){
  const el = $('lb-tap');
  if(!api.running() || clk.k == null || !clock.beatSec) return;
  const p = graphAt(perf) - clock.t0; if(p < 0) return;
  if(taps.length && perf - taps[taps.length - 1].perf > 2500) taps.length = 0;   // a pause starts a fresh measurement
  taps.push({perf, d: mod(p + .1, clock.beatSec) - .1}); if(taps.length > 12) taps.shift();
  if(taps.length < 6){ el.textContent = `Tap ${taps.length} of 6`; return; }
  const m = pct(taps.map(t => t.d), .5);
  labSet({clock:'heard', offset: Math.round((m - clk.lat)*200)*5});
  el.textContent = `Heard +${Math.round(m*1000)} ms`;
}
export function labReset(){ taps.length = drawMs.length = 0; $('lb-tap').textContent = 'Tap the beat'; diagAt = 0; }
const spanName = (sb, short) => lab.span ? (sb === 1 ? '1 bar' : sb + ' bars') : short ? `loop (${sb})` : `the ${sb}-bar loop`;
function labSet(p){
  Object.assign(lab, p);
  lab.n = Math.max(2, Math.min(32, Math.round(+lab.n) || 16)); lab.offset = Math.max(-100, Math.min(400, Math.round(+lab.offset) || 0));
  if(!STYLES[lab.style]) lab.style = 'steps'; if(!SPANS.includes(lab.span)) lab.span = 1; if(!DIRS[lab.dir]) lab.dir = 'loop';
  try{ localStorage.setItem('backtrack-lab', JSON.stringify(lab)); }catch(e){}
  clk.mode = lab.clock === 'raw' ? 'raw' : 'heard'; clk.offset = lab.offset;
  document.body.classList.toggle('lab-always', lab.big === 'always'); labbar.classList.toggle('min', !lab.bar);
  document.querySelectorAll('#lstyles [data-style]').forEach(b => b.setAttribute('aria-pressed', b.dataset.style === lab.style));
  document.querySelectorAll('#lquick [data-n]').forEach(b => b.setAttribute('aria-pressed', +b.dataset.n === lab.n));
  const gridIn = $('lgrid'), offIn = $('loffset'), sb = lab.span || +S.bars, note = describe(lab.n, sb, meter()), off = (lab.offset > 0 ? '+' : '') + lab.offset + ' ms';
  gridIn.value = lab.n; fill(gridIn); $('lgridout').textContent = lab.n; offIn.value = lab.offset; fill(offIn); $('loffsetout').textContent = off;
  $('lspan').value = lab.span; $('ldir').value = lab.dir; $('lb-dir').textContent = DIRS[lab.dir]; $('lbig').value = lab.big; $('lclock').value = clk.mode;
  $('lnote').innerHTML = `<b>${lab.n} across ${spanName(sb)}</b> · ${note}`;
  $('lb-style').textContent = STYLES[lab.style]; $('lb-n').textContent = lab.n; $('lb-span').textContent = spanName(sb, true);
  $('lb-off').textContent = clk.mode === 'raw' ? 'raw clock' : off; $('bhint').textContent = `${note} · tap anywhere else to stop`;
  kickPreview();
}
function labAct(k, d){
  if(k === 'style') labSet({style: SKEYS[mod(SKEYS.indexOf(lab.style) + d, SKEYS.length)]});
  else if(k === 'n') labSet({n: lab.n + d});
  else if(k === 'nq') labSet({n: QUICK[(QUICK.indexOf(lab.n) + 1) % QUICK.length]});
  else if(k === 'span') labSet({span: SPANS[(SPANS.indexOf(lab.span) + 1) % SPANS.length]});
  else if(k === 'dir') labSet({dir: DKEYS[(DKEYS.indexOf(lab.dir) + 1) % DKEYS.length]});
  else if(k === 'off') labSet({clock: 'heard', offset: lab.offset + d});
  else if(k === 'clock') labSet({clock: clk.mode === 'raw' ? 'heard' : 'raw'});
  else if(k === 'hide' || k === 'show') labSet({bar: k === 'show'});
}

// Called once by app.js when the page was opened with ?lab. `a.running()` is the transport's playing flag.
export function initLab(a){
  api = a;
  document.body.classList.add('lab'); syncTabs(); labbar.hidden = false;
  [bigCv, prevCv].forEach(observe);
  $('lstyles').innerHTML = SKEYS.map(k => `<button class="btn" data-style="${k}">${STYLES[k]}</button>`).join('');
  $('lquick').innerHTML = QUICK.map(n => `<button class="btn" data-n="${n}">${n}</button>`).join('');
  $('lstyles').addEventListener('click', e => { const b = e.target.closest('[data-style]'); if(b) labSet({style: b.dataset.style}); });
  $('lquick').addEventListener('click', e => { const b = e.target.closest('[data-n]'); if(b) labSet({n: +b.dataset.n}); });
  $('lgrid').addEventListener('input', () => labSet({n: +$('lgrid').value}));
  $('lspan').addEventListener('change', () => labSet({span: +$('lspan').value}));
  $('ldir').addEventListener('change', () => labSet({dir: $('ldir').value}));
  $('lbig').addEventListener('change', () => labSet({big: $('lbig').value}));
  $('lclock').addEventListener('change', () => labSet({clock: $('lclock').value}));
  $('loffset').addEventListener('input', () => labSet({offset: +$('loffset').value}));
  $('bars').addEventListener('change', () => labSet({})); addEventListener('hashchange', () => labSet({}));   // after app.js has updated S
  labbar.addEventListener('click', e => { const b = e.target.closest('[data-l]'); if(b) labAct(b.dataset.l, +b.dataset.d || 0); });
  $('lb-tap').addEventListener('pointerdown', e => labTap(e.timeStamp));
  new IntersectionObserver(es => { prevVisible = es[es.length - 1].isIntersecting; kickPreview(); }).observe(prevCv);
  document.addEventListener('visibilitychange', kickPreview);
  // keys while playing: ←/→ view, ↑/↓ grid, S span, D direction, C timing mode, [ ] offset, T tap the beat
  const LABKEYS = {ArrowRight:['style', 1], ArrowLeft:['style', -1], ArrowUp:['n', 1], ArrowDown:['n', -1], s:['span'], d:['dir'], c:['clock'], '[':['off', -5], ']':['off', 5]};
  addEventListener('keydown', e => {
    if(!api.running() || e.metaKey || e.ctrlKey || /INPUT|SELECT/.test(e.target.tagName)) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if(k === 't'){ if(!e.repeat) labTap(e.timeStamp); } else if(LABKEYS[k]) labAct(...LABKEYS[k]); else return;
    e.preventDefault();
  });
  labSet({});
}
// ======== end of lab ========

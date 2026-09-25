// The Takes sheet: every take on this phone — played back with the track or alone, nudged into sync by ear,
// shared as a WAV, or deleted (with a moment to undo). Below them, the quiet history: minutes over the last week.
// No streaks, no goals — just what you did, and one button to forget it.
import { $, fill, toast } from './ui.js';
import { ctx, bus, unlock, idleSuspend } from './audio.js';
import { listTakes, getPcm, saveMeta, deleteTake, renderMix, micBuffer, mixWav, micWav, shareFile, latency, measureLatency, micBusy,
         listSessions, clearSessions, listMics, findMics, micPick, setMicPick, micOpen } from './rec.js';

let hooks = { running: () => false, recording: () => false, stopSession(){}, count(){} };
const list = $('takelist');
let takes = [], expanded = null, playing = null;   // playing = { id, mode, src }
let prepared = null;                               // the expanded take's ready-to-share files: { id, nudge, mix, mic }
const pendingDelete = new Map();                   // id → timer, while the Undo toast is up

const fmt = sec => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const when = ms => new Date(ms).toLocaleString(undefined, { weekday:'short', hour:'numeric', minute:'2-digit' });
const stamp = ms => { const d = new Date(ms), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`; };
const fileName = (t, mic) => `BackTrack ${t.name.replace('♭', 'b')}${mic ? ' (mic)' : ''} ${stamp(t.created)}.wav`;
const nudgeText = v => v === 0 ? 'in sync' : `${Math.abs(v)} ms ${v > 0 ? 'later' : 'earlier'}`;
const PLAY = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 3.8v12.4a.8.8 0 0 0 1.2.7l10-6.2a.8.8 0 0 0 0-1.4l-10-6.2A.8.8 0 0 0 6 3.8z"/></svg>';
const STOP = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="5" y="5" width="10" height="10" rx="1.5"/></svg>';
const byId = id => takes.find(t => t.id === id);
const backingOf = t => !t.hasTrack ? '' : t.mode === 'breathe' ? 'guide' : t.mode === 'tune' && !(t.dvol > 0) ? 'drone' : 'track';

export async function refreshTakes(){
  try{ takes = (await listTakes()).filter(t => !pendingDelete.has(t.id)); }catch(e){ takes = []; }
  draw(); hooks.count(takes.length); refreshHistory();
  return takes;
}

// ---- History: the last seven days, per mode, and what you did most ----
const mins = sec => `${Math.max(1, Math.round(sec / 60))} min`;
export async function refreshHistory(){
  let all = [];
  try{ all = await listSessions(0); }catch(e){}
  const week = all.filter(x => x.start >= Date.now() - 7 * 864e5);
  $('clearhist').hidden = !all.length; if(!all.length) armClear(false);   // a refresh mid-confirm keeps the question open
  if(!week.length){ $('histtext').textContent = all.length ? 'Nothing in the last 7 days.' : 'Sessions longer than 20 seconds show up here.'; return; }
  const line = (label, list) => {
    if(!list.length) return '';
    const by = {}; list.forEach(x => by[x.name] = (by[x.name] || 0) + x.seconds);
    const top = Object.entries(by).sort((a, b) => b[1] - a[1])[0][0], total = list.reduce((a, x) => a + x.seconds, 0);
    return `<div>${label} <b>${mins(total)}</b>${Object.keys(by).length > 1 ? ` · mostly ${top}` : ` · ${top}`}</div>`;
  };
  $('histtext').innerHTML = `<div>Last 7 days <b>${mins(week.reduce((a, x) => a + x.seconds, 0))}</b></div>`
    + line('Breathing', week.filter(x => x.mode === 'breathe')) + line('Tuning', week.filter(x => x.mode === 'tune'))
    + line('Groove', week.filter(x => x.mode !== 'breathe' && x.mode !== 'tune'));
}
// Clearing takes two taps: the first asks, the second (within a few seconds) forgets.
let clearTimer = 0;
function armClear(on){
  clearTimeout(clearTimer); const b = $('clearhist');
  b.dataset.armed = on ? '1' : ''; b.textContent = on ? 'Clear history?' : 'Clear';
  if(on) clearTimer = setTimeout(() => armClear(false), 4000);
}

function draw(){
  $('takesempty').hidden = takes.length > 0;
  list.innerHTML = takes.map(t => `
    <li class="take" data-id="${t.id}">
      <button class="tplay" data-act="play" aria-label="Play ${t.name}${backingOf(t) ? ' with the ' + backingOf(t) : ''}">${PLAY}</button>
      <div class="tmeta"><div class="tname">${t.name}</div><div class="tsub">${when(t.created)} · ${fmt(t.seconds)}${t.hasTrack ? '' : ' · mic only'}</div></div>
      <button class="tmore" data-act="more" aria-expanded="false" aria-label="More for ${t.name}"><span></span><span></span><span></span></button>
      <div class="tdetail" hidden>
        <div class="tbtns">
          <button class="btn" data-act="mic">Mic only</button>
          <button class="btn" data-act="sharemix" disabled>Share mix</button>
          <button class="btn" data-act="sharemic" disabled>Share mic</button>
          <button class="btn" data-act="del">Delete</button>
        </div>
        <label class="slider"><span>Sync</span><span class="track center"><input type="range" min="-300" max="300" step="5" value="${t.nudge}" data-act="nudge" aria-label="Move your part earlier or later"></span><output>${nudgeText(t.nudge)}</output></label>
        ${backingOf(t) ? `<div class="schint">If your part sounds early or late against the ${backingOf(t)}, slide it until they line up.</div>` : ''}
      </div>
    </li>`).join('');
  list.querySelectorAll('input[type=range]').forEach(fill);
  if(expanded && byId(expanded)) setExpanded(expanded, true); else expanded = null;
  paintPlaying(); syncLine();
}
const row = id => list.querySelector(`.take[data-id="${id}"]`);
function setExpanded(id, on){
  const r = row(id); if(!r) return;
  r.querySelector('.tdetail').hidden = !on; r.querySelector('.tmore').setAttribute('aria-expanded', on); r.classList.toggle('open', on);
  if(on) prepare(byId(id));
}
function paintPlaying(){
  list.querySelectorAll('.take').forEach(r => {
    const p = playing && playing.id === r.dataset.id;
    const b = r.querySelector('.tplay'); b.innerHTML = p && playing.mode === 'mix' ? STOP : PLAY; b.classList.toggle('on', !!(p && playing.mode === 'mix'));
    const m = r.querySelector('[data-act="mic"]'); m.textContent = p && playing.mode === 'mic' ? 'Stop' : 'Mic only';
  });
}
function syncLine(){
  const L = latency();
  $('latval').textContent = `${Math.round(L.sec * 1000)} ms ${L.measured ? 'measured' : 'estimated'}`;
}

// ---- preparing the share files ahead of the tap: the share sheet must open straight from a tap, not after a render.
//      The mic file is instant (straight from the stored samples); the mix is one serialized render. ----
async function prepare(t){
  if(!t) return;
  if(prepared && prepared.id === t.id && prepared.nudge === t.nudge){ relabel(); return; }   // ready, or already on its way
  if(hooks.recording()){ relabel(); return; }                                               // no heavy renders during a take
  const mine = prepared = { id:t.id, nudge:t.nudge, mix:null, mic:null, failed:false }; relabel();
  try{
    const pcm = await getPcm(t.id); if(prepared !== mine) return;
    mine.mic = micWav(t, pcm, fileName(t, true)); relabel();
    const buf = await renderMix(t, pcm); if(prepared !== mine) return;
    mine.mix = mixWav(buf, fileName(t, false)); relabel();
  }catch(e){ if(prepared === mine){ mine.failed = true; relabel(); toast('Couldn’t prepare this take.'); } }
}
// Share buttons always reflect `prepared`, however often the list is redrawn.
function relabel(){
  const p = prepared, r = p && row(p.id); if(!r) return;
  const set = (act, file, name) => { const b = r.querySelector(`[data-act="${act}"]`); if(!b) return; b.textContent = file || p.failed ? name : 'Preparing…'; b.disabled = !file; };
  set('sharemix', p.mix, 'Share mix'); set('sharemic', p.mic, 'Share mic');
}

// ---- playback in the app: the same offline mix, played once ----
export function stopPlayback(){
  if(!playing) return;
  const p = playing; playing = null;
  try{ p.src.onended = null; p.src.stop(); }catch(e){}
  paintPlaying(); idleSuspend(600);
}
async function play(t, mode){
  if(playing && playing.id === t.id && playing.mode === mode){ stopPlayback(); return; }
  stopPlayback();
  if(hooks.running()) hooks.stopSession();
  unlock();                                                      // inside the tap, before any await (iOS)
  const token = playing = { id:t.id, mode, src:null }; paintPlaying();
  try{
    const pcm = await getPcm(t.id);
    const buf = mode === 'mix' ? await renderMix(t, pcm) : micBuffer(t, pcm);
    if(playing !== token) return;
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(bus.master);
    src.onended = () => { if(playing === token){ playing = null; paintPlaying(); idleSuspend(600); } };
    token.src = src; src.start();
  }catch(e){ if(playing === token){ playing = null; paintPlaying(); toast("Couldn't play this take."); } }
}

async function share(t, which){
  if(!prepared || prepared.id !== t.id || !prepared[which]) return;
  try{ await shareFile(prepared[which]); }catch(e){ if(e && e.name !== 'AbortError') toast("Couldn't share this take."); }
}
function remove(t){
  if(playing && playing.id === t.id) stopPlayback();
  pendingDelete.set(t.id, setTimeout(async () => { pendingDelete.delete(t.id); try{ await deleteTake(t.id); }catch(e){} refreshTakes(); }, 6000));
  if(expanded === t.id){ expanded = null; prepared = null; }
  takes = takes.filter(x => x.id !== t.id); draw(); hooks.count(takes.length);
  toast('Take deleted', { action:'Undo', ms:6000, onAction: () => { clearTimeout(pendingDelete.get(t.id)); pendingDelete.delete(t.id); refreshTakes(); } });
}

// ---- which microphone: Automatic, or one of the named inputs. Browsers only name inputs once the mic has been on in
//      this page load, so until then the list is Automatic (plus the saved choice), and "Find mics" opens it for a moment. ----
export async function refreshMics(){ fillMics(await listMics()); }
function fillMics(list){
  let pick = micPick();
  if(pick && !list.some(d => d.deviceId === pick.id)){                   // same mic, new id (e.g. another home-screen app): keep the choice
    const same = list.find(d => d.label === pick.label); if(same){ pick = { id:same.deviceId, label:same.label }; setMicPick(pick); }
  }
  const opts = [['', 'Automatic'], ...list.map(d => [d.deviceId, d.label])];
  if(pick && !opts.some(o => o[0] === pick.id)) opts.push([pick.id, pick.label]);
  document.querySelectorAll('.micsel').forEach(sel => { sel.replaceChildren(...opts.map(([v, t]) => new Option(t, v))); sel.value = pick ? pick.id : ''; });
  document.querySelectorAll('.micfind').forEach(b => b.hidden = list.length > 0);
}
export function initMicPicker(){
  document.querySelectorAll('.micsel').forEach(sel => sel.addEventListener('change', () => {
    const o = sel.selectedOptions[0];
    setMicPick(sel.value ? { id:sel.value, label:o.textContent } : null);
    document.querySelectorAll('.micsel').forEach(s => s.value = sel.value);
    if(micOpen()) toast('The new microphone is used the next time it opens.');
  }));
  document.querySelectorAll('.micfind').forEach(b => b.addEventListener('click', async () => {
    if(hooks.recording() || micBusy()) return;
    b.disabled = true;
    try{ const list = await findMics(); fillMics(list); if(!list.length) toast('No named microphones yet. Try again after recording once.'); }
    catch(e){ toast(e && e.name === 'NotAllowedError' ? 'Microphone access is off for BackTrack.' : 'Couldn’t open the microphone.'); }
    b.disabled = false; syncLine();
  }));
  if(navigator.mediaDevices) navigator.mediaDevices.addEventListener('devicechange', refreshMics);
  refreshMics();
}

export function initTakes(h){
  hooks = { ...hooks, ...h };
  list.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'), r = e.target.closest('.take'); if(!b || !r || b.tagName === 'INPUT') return;
    const t = byId(r.dataset.id); if(!t) return;
    const act = b.dataset.act;
    if(act === 'play') play(t, 'mix');
    else if(act === 'mic') play(t, 'mic');
    else if(act === 'more'){ const on = expanded !== t.id; if(expanded) setExpanded(expanded, false); expanded = on ? t.id : null; if(on) setExpanded(t.id, true); }
    else if(act === 'sharemix') share(t, 'mix');
    else if(act === 'sharemic') share(t, 'mic');
    else if(act === 'del') remove(t);
  });
  list.addEventListener('input', e => {
    if(e.target.dataset.act !== 'nudge') return;
    const v = +e.target.value; fill(e.target); e.target.closest('.slider').querySelector('output').textContent = nudgeText(v);
  });
  list.addEventListener('change', async e => {
    if(e.target.dataset.act !== 'nudge') return;
    const t = byId(e.target.closest('.take').dataset.id); if(!t) return;
    t.nudge = +e.target.value; prepared = null;
    try{ await saveMeta(t); }catch(e){}
    if(playing && playing.id === t.id){ const mode = playing.mode; stopPlayback(); play(t, mode); }   // hear the new sync straight away
    if(expanded === t.id) prepare(t);
  });
  $('measure').addEventListener('click', async () => {
    const b = $('measure');
    if(hooks.recording() || micBusy()){ toast('Finish the take first, then measure.'); return; }
    stopPlayback(); if(hooks.running()) hooks.stopSession();
    b.disabled = true; b.textContent = 'Listening…';
    try{
      const r = await measureLatency();
      toast(r.ok ? `Sync measured: ${Math.round(r.sec * 1000)} ms. New takes use it.` : 'Couldn’t hear the clicks clearly. Use the phone speaker, turn it up, and try again somewhere quiet.');
    }catch(e){ toast(e && e.name === 'NotAllowedError' ? 'Microphone access is off for BackTrack.' : 'Couldn’t open the microphone.'); }
    b.disabled = false; b.textContent = 'Measure'; syncLine();
  });
  $('clearhist').addEventListener('click', async () => {
    if(!$('clearhist').dataset.armed){ armClear(true); return; }
    armClear(false);
    try{ await clearSessions(); toast('History cleared'); }catch(e){ toast('Couldn’t clear the history.'); }
    refreshHistory();
  });
  syncLine();
}

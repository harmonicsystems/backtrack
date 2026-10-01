// The audio x-ray (?xray): a debug overlay for the audio engine. Where the sound goes (what the browser will say about
// the route), whether the context's clock keeps time, a level meter on every bus in graph order, and a log of every
// state change that outlives the page (read it after a drive). Imported only with ?xray, like the lab.
// Safari names no output device, and on iOS nothing a page can read changes when the route does (research in CLAUDE.md):
// the probe reads WebKit's STORED rate, latency is cached too, slip can't see underruns in the audio process. The one
// fresh reading is a new context's rate after the page's audio was off (a cold launch, or after a close): "built at".
import { ctx, bus, watch, engineInfo, probeRate } from './audio.js';
import { micInfo, micPick } from './rec.js';

const KEY = 'backtrack-xray-log', MAX = 300;
const $ = s => root.querySelector(s);
let api = null, root = null, open = false, log = [], saveTimer = 0, probed = 0, lastProbe = 0, devs = [];

// ---- the log: [time, type, text], newest last, kept across page loads ----
try{ log = JSON.parse(localStorage.getItem(KEY) || '[]').slice(-MAX); }catch(e){ log = []; }
const persist = () => { try{ localStorage.setItem(KEY, JSON.stringify(log.slice(-MAX))); }catch(e){} };
function note(type, text){
  log.push([Date.now(), type, text]); if(log.length > MAX) log.splice(0, log.length - MAX);
  clearTimeout(saveTimer); saveTimer = setTimeout(persist, 400);
  if(open) drawLog();
}
const hms = t => { const d = new Date(t); return d.toTimeString().slice(0, 8) + '.' + Math.floor(d.getMilliseconds() / 100); };
const day = t => new Date(t).toLocaleDateString(undefined, { month:'short', day:'numeric' });
const logText = () => log.map(([t, type, text]) => type === 'load' ? `—— ${day(t)} ${hms(t)} ${text}` : `${hms(t)}  ${type.padEnd(9)} ${text}`).join('\n');

// ---- numbers ----
const ms = s => s == null || !isFinite(s) ? '—' : `${Math.round(s * 1000)} ms`;
const khz = r => r ? `${+(r / 1000).toFixed(2)}k` : '—';
const db = v => v <= 1e-5 ? '−∞' : (20 * Math.log10(v)).toFixed(0);
const standalone = () => navigator.standalone || matchMedia('(display-mode: standalone)').matches;
// Safari's own version first: newer iOS freezes the OS number in the user agent.
const iosVer = () => { const ua = navigator.userAgent, v = ua.match(/Version\/([\d.]+)/), m = ua.match(/OS (\d+)_(\d+)/);
  const dev = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? (/iPad/.test(ua) || /Macintosh/.test(ua) ? 'iPad' : 'iPhone') : /Macintosh/.test(ua) ? 'Mac' : '';
  return [dev, v ? `Safari ${v[1]}` : ua.match(/(Chrome|Firefox)\/[\d.]+/)?.[0] || '', m ? `(UA says iOS ${m[1]}.${m[2]})` : ''].filter(Boolean).join(' '); };
const sessionLine = () => { const a = navigator.audioSession; return a ? `${a.type}${a.state ? ' · ' + a.state : ''}` : 'no audioSession API'; };

// ---- WebKit's stored rate: what a new context would get now. Only on the Probe button: a throwaway context around the
//      moment the page's audio switches off could keep it on. `probed` also takes every build's own rate. ----
function probe(why, force){
  const now = performance.now();
  if(!force && now - lastProbe < 1000) return;
  lastProbe = now;
  const r = probeRate(); if(!r) return;
  if(r !== probed || force) note('probe', `stored ${r} Hz (${why})` + (ctx && ctx.sampleRate !== r ? ` ≠ context ${ctx.sampleRate} Hz` : ''));
  probed = r;
}
const mismatch = () => ctx && probed && probed !== ctx.sampleRate;

// ---- clock health: the audio clock against the wall clock, paired by getOutputTimestamp where there is one.
//      A context that runs slow drops audio (slip); one built for another rate runs off by thousands of ppm. ----
const clk = { prev:null, sumC:0, sumP:0, slip:0, lates:[], lastTick:0 };
function clockReset(){ clk.prev = null; clk.sumC = clk.sumP = 0; }
function stamp(){
  if(ctx.getOutputTimestamp){ const s = ctx.getOutputTimestamp(); if(s.performanceTime > 0) return { c: s.contextTime, p: s.performanceTime / 1000 }; }
  return { c: ctx.currentTime, p: performance.now() / 1000 };
}
function clockTick(){
  const now = performance.now();
  if(clk.lastTick) clk.lates.push([now, Math.max(0, now - clk.lastTick - 250)]);   // this timer's lateness = the scheduler's
  clk.lastTick = now;
  while(clk.lates.length && clk.lates[0][0] < now - 10000) clk.lates.shift();
  if(!ctx || ctx.state !== 'running' || document.visibilityState !== 'visible'){ clockReset(); return; }
  const s = stamp(), pv = clk.prev; clk.prev = { ...s, ctx };
  if(!pv || pv.ctx !== ctx) return;
  const dC = s.c - pv.c, dP = s.p - pv.p;
  if(dP <= 0 || dP > 2){ clockReset(); return; }                     // a stall this long is the page being frozen, not the audio
  clk.sumC += dC; clk.sumP += dP;
  const lost = dP - dC;
  if(lost > .03){ clk.slip += lost; note('slip', `audio clock fell ${ms(lost)} behind in ${ms(dP)}`); }
}
const ppm = () => clk.sumP > 4 ? Math.round((clk.sumC / clk.sumP - 1) * 1e6) : null;
const lateMax = () => clk.lates.reduce((m, [, l]) => Math.max(m, l), 0);

// ---- the flow: an analyser on every bus, in graph order (analysers run without being connected onward) ----
const STAGES = [
  ['drums',   () => bus.drums,    n => `gain ${n.gain.value.toFixed(2)}`],
  ['click',   () => bus.click,    n => `gain ${n.gain.value.toFixed(2)}`],
  ['wash',    () => bus.wash,     n => `gain ${n.gain.value.toFixed(2)}`],
  ['↳ swell lowpass', () => bus.swellLP, n => `${Math.round(n.frequency.value)} Hz`],
  ['↳ swell level',   () => bus.swellAmp, n => `gain ${n.gain.value.toFixed(2)}`],
  ['noise',   () => bus.noise,    n => `gain ${n.gain.value.toFixed(2)}`],
  ['session', () => bus.session,  n => `gain ${n.gain.value.toFixed(2)}`],
  ['master',  () => bus.master,   n => `gain ${n.gain.value.toFixed(2)}`],
];
let taps = { ctx:null, list:[], mic:null, micNode:null }, clips = 0;
const buf = new Float32Array(2048);
function analyser(node){ const a = ctx.createAnalyser(); a.fftSize = 2048; a.smoothingTimeConstant = 0; node.connect(a); return a; }
function ensureTaps(){
  if(!ctx || !bus.master) return;
  if(taps.ctx !== ctx){ taps = { ctx, list: STAGES.map(([, get]) => analyser(get())), mic:null, micNode:null }; clips = 0; }
  const m = micInfo(), node = m.open ? m.node : null;
  if(node !== taps.micNode){
    if(taps.mic) try{ taps.micNode.disconnect(taps.mic); }catch(e){}
    taps.micNode = node; taps.mic = node ? analyser(node) : null;
  }
}
function level(a){
  if(!a) return null;
  a.getFloatTimeDomainData(buf);
  let pk = 0, sq = 0; for(let i = 0; i < buf.length; i++){ const v = Math.abs(buf[i]); if(v > pk) pk = v; sq += v * v; }
  return { pk, rms: Math.sqrt(sq / buf.length) };
}
function levels(){
  ensureTaps();
  const out = taps.ctx === ctx ? taps.list.map(level) : [];
  const master = out[out.length - 1];
  if(master && master.pk >= .999){ clips++; if(clips === 1 || clips % 50 === 0) note('clip', `master peak ${master.pk.toFixed(3)} (${clips} so far)`); }
  return { out, mic: level(taps.mic) };
}

// ---- where the sound goes, as far as a web page can tell ----
function routeGuess(m){
  const label = (m.label || '').toLowerCase();
  if(ctx && ctx.sampleRate <= 24000) return 'call mode (Bluetooth hands-free): low rate both ways';
  if(/carplay/.test(label)) return 'CarPlay (the mic says so)';
  if(/airpods|beats|bluetooth|buds/.test(label) && m.open) return 'Bluetooth headset (the mic in use)';
  return 'Safari doesn’t say';
}

async function listDevices(why){
  if(!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  let list; try{ list = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind !== 'videoinput'); }catch(e){ return; }
  const name = d => `${d.kind === 'audiooutput' ? 'out' : 'in'}: ${d.label || '(unnamed until the mic has been on)'}`;
  const was = new Set(devs.map(name)), now = new Set(list.map(name));
  const add = [...now].filter(x => !was.has(x)), gone = [...was].filter(x => !now.has(x));
  if(why && (add.length || gone.length)) note('devices', [...add.map(x => '+ ' + x), ...gone.map(x => '− ' + x)].join(' · '));
  devs = list; if(open) drawDevices();
}

// ---- a snapshot line: tap Mark the moment something sounds wrong ----
function snapshot(){
  const e = engineInfo(), L = levels(), m = micInfo();
  const lv = STAGES.map(([name], i) => L.out[i] && L.out[i].pk > 1e-4 ? `${name.replace('↳ swell ', 'sw-')} ${db(L.out[i].pk)}` : '').filter(Boolean).join(', ');
  return [ctx ? `context ${ctx.state} ${ctx.sampleRate} Hz` : 'no context', `stored ${probed || '?'} Hz`,
    ctx ? `base ${ms(ctx.baseLatency)} out ${ms(ctx.outputLatency)}` : '', `clock ${ppm() ?? '—'} ppm, slip ${ms(clk.slip)}`,
    `timer late ≤ ${Math.round(lateMax())} ms`, `session ${sessionLine()}`, `app ${e.running ? (e.held ? 'held' : 'playing ' + api.runMode()) : 'stopped'}`,
    m.open ? `mic ${m.label} ${m.settings.sampleRate || '?'} Hz` : 'mic off', lv ? `peaks dB: ${lv}` : 'silent'].filter(Boolean).join(' · ');
}

// ---- the panel ----
const CSS = `
#xray{position:fixed; z-index:1000; bottom:calc(env(safe-area-inset-bottom) + 6px); left:50%; transform:translateX(-50%); font:11px/1.45 var(--font-mono); color:var(--text); -webkit-text-size-adjust:100%}
#xray button{font:inherit; color:inherit; background:var(--bg-raised); border:1px solid var(--border-color); border-radius:var(--radius-sm); padding:5px 8px; cursor:pointer}
#xray .xr-pill{display:flex; gap:6px; align-items:center; white-space:nowrap; background:var(--surface); box-shadow:var(--shadow); opacity:.85}
#xray .dot{width:8px; height:8px; border-radius:50%; background:var(--text-muted)}
#xray .dot.run{background:var(--accent)} #xray .dot.warn{background:var(--rec)}
#xray .xr-panel{display:none; width:min(380px, calc(100vw - 16px)); max-height:min(72vh, 640px); overflow:auto; -webkit-overflow-scrolling:touch;
  background:var(--surface); border:1px solid var(--border-color); border-radius:var(--radius); box-shadow:var(--shadow-lg); padding:10px 12px}
#xray[data-open="true"] .xr-pill{display:none} #xray[data-open="true"] .xr-panel{display:block}
#xray h3{font:600 11px var(--font-mono); letter-spacing:.06em; text-transform:uppercase; color:var(--text-muted); margin:10px 0 4px}
#xray .xr-head{display:flex; justify-content:space-between; align-items:center; font-weight:600}
#xray .kv{display:grid; grid-template-columns:auto 1fr; gap:0 10px} #xray .kv span:nth-child(odd){color:var(--text-muted)}
#xray .warn{color:var(--rec); font-weight:500}
#xray .flow{display:grid; grid-template-columns:minmax(0,9.5em) 1fr auto; gap:3px 8px; align-items:center}
#xray .flow .nm{white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
#xray .meter{position:relative; height:8px; background:var(--bg-raised); border-radius:2px; overflow:hidden}
#xray .meter i, #xray .meter b{position:absolute; left:0; top:0; bottom:0}
#xray .meter i{background:var(--primary-soft); border-right:1px solid var(--primary)} #xray .meter b{background:var(--primary)}
#xray .meter.hot b{background:var(--rec)}
#xray .val{color:var(--text-muted); text-align:right; white-space:nowrap}
#xray .arrow{grid-column:1 / -1; color:var(--text-muted); padding-left:1em}
#xray .btns{display:flex; flex-wrap:wrap; gap:6px; margin-top:10px}
#xray .msg{min-height:1.45em; color:var(--text-muted); margin-top:4px}
#xray pre{margin:6px 0 0; white-space:pre-wrap; word-break:break-word; font:inherit; font-size:10.5px; color:var(--text-muted); max-height:40vh; overflow:auto}
#xray textarea{width:100%; height:120px; font:inherit; font-size:10px; margin-top:6px}
`;
const HTML = `
<button class="xr-pill" aria-label="Open the audio x-ray"><span class="dot"></span><span class="pl">x-ray</span></button>
<div class="xr-panel" role="region" aria-label="Audio x-ray">
  <div class="xr-head"><span>Audio x-ray</span><button data-a="close" aria-label="Close the x-ray">Close</button></div>
  <h3>Output</h3><div class="kv" data-s="out"></div>
  <h3>Clock</h3><div class="kv" data-s="clock"></div>
  <h3>Flow</h3><div class="flow" data-s="flow"></div>
  <h3>Inputs</h3><div class="kv" data-s="in"></div>
  <div class="btns">
    <button data-a="mark">Mark</button><button data-a="probe">Probe</button><button data-a="closeaudio">Close audio</button><button data-a="reload">Reload</button>
    <button data-a="copy">Copy log</button><button data-a="clear">Clear log</button>
  </div>
  <div class="msg" aria-live="polite"></div>
  <h3>Log</h3><pre data-s="log"></pre>
</div>`;

const kv = rows => rows.map(([k, v, warn]) => `<span>${k}</span><span${warn ? ' class="warn"' : ''}>${v}</span>`).join('');
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' })[c]);
let msgTimer = 0;
function say(text){ const m = $('.msg'); m.textContent = text; clearTimeout(msgTimer); msgTimer = setTimeout(() => m.textContent = '', 5000); }

function drawOut(){
  const e = engineInfo(), m = micInfo();
  const age = e.born ? Math.round((performance.now() - e.born) / 1000) : 0;
  const rows = ctx ? [
    ['context', `${ctx.state} · built ${age < 120 ? age + ' s' : Math.round(age / 60) + ' min'} ago · #${e.builds}`],
    ['rate', `context ${khz(ctx.sampleRate)} · stored ${khz(probed)}`, mismatch()],
    ...(mismatch() ? [['', 'The route’s rate changed since this engine was built. Stop, wait a few seconds, start.', true]] : []),
    ['latency', `base ${ms(ctx.baseLatency)} · output ${ms(ctx.outputLatency)}`],
  ] : [['context', 'closed (a new one is built on the next start)'], ['rate', `last built ${khz(probed)}`]];
  rows.push(['session', `${sessionLine()}${e.routing ? ' · mic rerouting' : ''}`],
            ['app', e.running ? (e.held ? 'held (paused from outside)' : `playing · ${api.runMode()}`) : 'stopped'],
            ['route', `${routeGuess(m)} (guess)`]);
  $('[data-s="out"]').innerHTML = kv(rows);
}
function drawClock(){
  const p = ppm();
  $('[data-s="clock"]').innerHTML = kv([
    ['drift', p == null ? 'measuring (needs a few seconds playing)' : `${p > 0 ? '+' : ''}${p} ppm`, p != null && Math.abs(p) > 2000],
    ['slip', (clk.slip ? `${ms(clk.slip)} lost in all` : 'none') + ' (page side only)', clk.slip > 0],
    ['timers', `late ≤ ${Math.round(lateMax())} ms (last 10 s)`, lateMax() > 500],
  ]);
}
function drawFlow(){
  const L = levels(), rows = [];
  STAGES.forEach(([name, get, param], i) => {
    const n = get(), l = L.out[i];
    if(name === 'session') rows.push(`<span class="arrow">drums + click + swell + breath cues + noise ↓</span>`);
    rows.push(meterRow(name, l, n ? param(n) : '—'));
  });
  rows.push(`<span class="arrow">↓ ${ctx ? `destination · ${khz(ctx.sampleRate)} · ${ctx.destination.channelCount} ch` : 'no context'}</span>`);
  const m = micInfo();
  if(m.open){
    const st = m.settings || {};
    rows.push(`<span class="arrow">mic (in)</span>`, meterRow(m.label || 'mic', L.mic, `${khz(st.sampleRate)} · ${st.channelCount || '?'} ch`));
  }
  if(clips) rows.push(`<span class="arrow warn">master clipped ${clips}×</span>`);
  $('[data-s="flow"]').innerHTML = rows.join('');
}
function meterRow(name, l, val){
  const w = v => Math.max(0, Math.min(100, (20 * Math.log10(Math.max(v, 1e-6)) + 60) / 60 * 100));
  const on = l && l.pk > 1e-5;
  return `<span class="nm">${esc(name)}</span><span class="meter${on && l.pk >= .9 ? ' hot' : ''}"><i style="width:${on ? w(l.pk) : 0}%"></i><b style="width:${on ? w(l.rms) : 0}%"></b></span>`
       + `<span class="val">${on ? db(l.pk) + ' dB · ' : ''}${esc(val)}</span>`;
}
function drawDevices(){
  const m = micInfo(), p = micPick();
  const rows = [['mic', m.open ? `on · ${m.label}${m.routes ? ` · rerouted ${m.routes}×` : ''}` : `off · last: ${m.label || '—'}`],
                ['choice', p === 'auto' ? 'Automatic' : p ? p.label : 'built-in (default)']];
  const ins = devs.filter(d => d.kind === 'audioinput'), outs = devs.filter(d => d.kind === 'audiooutput');
  ins.forEach((d, i) => rows.push([i ? '' : 'inputs', esc(d.label || '(unnamed)')]));
  rows.push(['outputs', outs.length ? outs.map(d => esc(d.label || '(unnamed)')).join(' · ') : 'not listed by this browser (iOS never lists them)']);
  $('[data-s="in"]').innerHTML = kv(rows);
}
function drawLog(){ const el = $('[data-s="log"]'); el.textContent = logText().split('\n').reverse().slice(0, 120).join('\n'); }
function drawPill(){
  const warn = mismatch() || clk.slip > 0 || clips > 0, run = ctx && ctx.state === 'running';
  $('.dot').className = 'dot' + (warn ? ' warn' : run ? ' run' : '');
  $('.pl').textContent = ctx ? `${ctx.state === 'running' ? '' : ctx.state + ' · '}${khz(ctx.sampleRate)}${mismatch() ? ' ≠ ' + khz(probed) : ''} · ${ms(ctx.outputLatency)}` : 'x-ray';
}
function draw(){
  if(document.visibilityState !== 'visible') return;
  drawPill();
  if(!open) return;
  drawOut(); drawClock(); drawFlow();
}

function act(a){
  if(a === 'close'){ setOpen(false); return; }
  if(a === 'mark'){ note('MARK', snapshot()); say('Marked.'); return; }
  if(a === 'probe'){ probe('asked', true); say(`Stored ${probed} Hz, context ${ctx ? ctx.sampleRate + ' Hz' : 'none'}. (Stored only refreshes when the audio switches off.)`); return; }
  if(a === 'closeaudio'){
    const err = api.close();
    if(err){ say(err); return; }
    clockReset(); clk.slip = 0;
    say('Audio closed. Wait a few seconds, then tap the circle: the log shows the new engine’s rate.'); return;
  }
  if(a === 'reload'){ note('page', 'reload asked'); clearTimeout(saveTimer); persist(); location.reload(); return; }
  if(a === 'copy'){
    const text = `BackTrack audio x-ray · ${iosVer()} · ${standalone() ? 'home-screen app' : 'browser'}\nnow: ${snapshot()}\n\n${logText()}`;
    const fallback = () => { let t = root.querySelector('textarea'); if(!t){ t = document.createElement('textarea'); t.readOnly = true; $('.msg').after(t); } t.value = text; t.select(); say('Select all and copy.'); };
    if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => say('Log copied.'), fallback); else fallback();
    return;
  }
  if(a === 'clear'){ log = []; persist(); note('load', 'log cleared'); say('Cleared.'); }
}
function setOpen(on){
  open = on; root.dataset.open = on;
  try{ localStorage.setItem('backtrack-xray-open', on ? '1' : ''); }catch(e){}
  if(on){ listDevices(); drawDevices(); drawLog(); draw(); }
}

export function initXray(a){
  api = a;
  const style = document.createElement('style'); style.textContent = CSS; document.head.append(style);
  root = document.createElement('div'); root.id = 'xray'; root.innerHTML = HTML; document.body.append(root);
  root.querySelector('.xr-pill').addEventListener('click', () => setOpen(true));
  root.addEventListener('click', e => { const b = e.target.closest('[data-a]'); if(b) act(b.dataset.a); });

  note('load', `page load · ${iosVer()} · ${standalone() ? 'home-screen app' : 'browser'} · ${location.search || '/'}`);
  watch((type, d) => {
    if(type === 'state'){ note('context', `${d.state}${d.did ? ' → ' + d.did : ''}${d.ours ? ' (we asked)' : ''}`); clockReset(); }
    else if(type === 'build'){ note('context', `built at ${d.rate} Hz (#${d.n})` + (probed && d.rate !== probed ? ` · the last one ran at ${probed} Hz` : '')); probed = d.rate; }
    else if(type === 'close'){ note('context', `closed (${d.why === 'idle' ? 'nothing playing' : 'you asked'}), it ran at ${d.rate} Hz`); clockReset(); }
    else if(type === 'routing') note('route', `mic open/close reroute ${d}`);
    else if(type === 'session') note('session', `audioSession.type → ${d}`);
    else if(type === 'resume') note('context', `resume asked (was ${d})`);
    else if(type === 'mic'){ note('mic', d); listDevices('mic'); if(open) drawDevices(); }
    else if(type === 'transport') note('app', d);
    else if(type === 'drone') note('drone', `→ ${d.key}${d.rate > 1 ? ` +${Math.round(12 * Math.log2(d.rate))}` : ''}${d.late ? ` (${Math.round(d.late * 1000)} ms late: still decoding)` : ''}`);
  });
  const as = navigator.audioSession;
  // (statechange fires when the page's audio switches on or off: exactly when WebKit refreshes its stored rate)
  if(as && as.addEventListener) as.addEventListener('statechange', () => note('session', `audio switched on/off (${sessionLine()})`));
  if(navigator.mediaDevices) navigator.mediaDevices.addEventListener('devicechange', () => { note('devices', 'devicechange'); listDevices('change'); });
  document.addEventListener('visibilitychange', () => note('page', document.visibilityState));
  addEventListener('pagehide', e => { note('page', `pagehide${e.persisted ? ' (kept)' : ''}`); clearTimeout(saveTimer); persist(); });
  addEventListener('pageshow', e => { if(e.persisted) note('page', 'pageshow (restored)'); });
  addEventListener('error', e => note('error', `${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`));
  addEventListener('unhandledrejection', e => note('error', `unhandled: ${e.reason && (e.reason.message || e.reason)}`));

  listDevices();
  setInterval(clockTick, 250);
  setInterval(() => { if(open) draw(); }, 100);
  setInterval(() => { if(!open) draw(); }, 500);
  let wasOpen = false; try{ wasOpen = !!localStorage.getItem('backtrack-xray-open'); }catch(e){}
  setOpen(wasOpen); drawPill();
}

// Where the listener is in the groove, in seconds from the drums' first downbeat.
// ctx.currentTime is the graph's render position. It runs ahead of the speaker by the output latency
// (tens of ms on a phone speaker, 150–300 ms over Bluetooth) and on phones it moves in ~10–20 ms steps.
// 'raw' uses it as-is (the app's behaviour, and the default). 'heard' (the lab) smooths it against
// performance.now(), subtracts the latency the browser reports, aims at the moment the frame reaches the
// screen, and adds a manual offset.
import { ctx } from './audio.js';
import { clock } from './groove.js';

export const clk = { mode:'raw', offset:0, k:null, rep:0, ts:null, lat:0, jit:[], frames:[], prev:0, frame:1000/60 };
export const keep = (a, v, n) => { a.push(v); if(a.length > n) a.shift(); };
export const pct = (a, q) => { if(!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
export const graphAt = perf => perf / 1000 + clk.k;           // smoothed ctx time at a performance.now() instant
export const lookahead = () => Math.min(clk.frame, 1000 / 60);   // a frame reaches the screen about one refresh after it's drawn

export function clockUpdate(perf){
  const s = ctx.currentTime - perf / 1000;
  clk.k = clk.k == null || s > clk.k || s < clk.k - .05 ? s : clk.k - 1e-5;   // leading edge of the stepped clock
  keep(clk.jit, (clk.k - s) * 1000, 240);
  if(clk.prev) keep(clk.frames, perf - clk.prev, 240); clk.prev = perf;
  clk.rep = (ctx.baseLatency || 0) + (ctx.outputLatency || 0);
  try{ const o = ctx.getOutputTimestamp && ctx.getOutputTimestamp();
    if(o && o.performanceTime > 0){ const l = graphAt(perf) - (o.contextTime + (perf - o.performanceTime) / 1000);
      if(l >= 0 && l < .5) clk.ts = clk.ts == null ? l : clk.ts + (l - clk.ts) * .05; } }catch(e){}
  clk.lat = Math.max(clk.rep, clk.ts || 0);
}
export function heardPos(perf){
  if(clk.mode === 'raw') return ctx.currentTime - clock.t0;
  return graphAt(perf + lookahead()) - clk.lat - clk.offset / 1000 - clock.t0;
}
export function clockReset(){ Object.assign(clk, { k:null, ts:null, prev:0 }); clk.jit.length = clk.frames.length = 0; }

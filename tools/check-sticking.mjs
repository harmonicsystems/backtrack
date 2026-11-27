// Checks each beat's sticking (machine.js) against the beat as programmed and against a drummer's limits:
// which notes the sticking leaves out or adds, and each limb's fastest stroke rate at the beat's usual tempo.
// Run: node tools/check-sticking.mjs
globalThis.window = globalThis;
const { BEATS, STICK_RAW, STICK_CODES } = await import('../js/machine.js');
const MAX = 8.2;   // strokes a second, sustained over three strokes, for one hand or one foot: about the edge of comfortable singles
let bad = 0;
for(const B of BEATS){
  const s = STICK_RAW[B.id], step = 60 / B.bpm / 4, sw = (B.swing - 50) / 50 * step, tOf = i => i * step + (i % 2 ? sw : 0);
  const have = new Set(), want = new Set();
  for(const [lane, str] of Object.entries(B.lanes)) if(lane !== 'kick') for(let i = 0; i < 16; i++) if(str[i] !== '.') want.add(lane + ':' + i);
  for(const limb of ['R', 'L']) for(let i = 0; i < 16; i++){ const c = (s[limb] || '')[i]; if(c && c !== '.'){ have.add(STICK_CODES[c] + ':' + i); if(c === 'O') have.add('chh:' + i); } }
  for(let i = 0; i < 16; i++) if((s.F || '')[i] === 'F') have.add('chh:' + i);
  const missing = [...want].filter(k => !have.has(k)), extra = [...have].filter(k => !want.has(k) && !(k.startsWith('chh') && want.has('ohh:' + k.slice(4))));
  const rate = str => { const t = []; for(let i = 0; i < 16; i++) if((str || '')[i] && str[i] !== '.') t.push(tOf(i));
    // the fastest run of three strokes (two gaps): a single quick double, like a kick on two sixteenths in a row, is fine
    const n = t.length, gap = j => (j + 1 < n ? t[j + 1] : t[0] + 16 * step) - t[j];
    let m = Infinity; for(let j = 0; j < n; j++) m = Math.min(m, gap(j) + gap((j + 1) % n)); return n > 2 ? 2 / m : 0; };
  const rates = { R: rate(s.R), L: rate(s.L), K: rate(B.lanes.kick), F: rate(s.F) };
  const fast = Object.entries(rates).filter(([, r]) => r > MAX).map(([k, r]) => `${k} ${r.toFixed(1)}/s`);
  const ok = (s.how === 'simpler') === (missing.length > 0) && !extra.length;
  if(!ok) bad++;
  console.log(`${B.name.padEnd(15)} ${B.bpm} bpm  ${s.how.padEnd(8)} R ${rates.R.toFixed(1)} L ${rates.L.toFixed(1)} K ${rates.K.toFixed(1)} F ${rates.F.toFixed(1)} /s` +
    (missing.length ? `  left out: ${missing.join(' ')}` : '') + (extra.length ? `  EXTRA: ${extra.join(' ')}` : '') + (fast.length ? `  FAST: ${fast.join(', ')}` : '') + (ok ? '' : '  <- check'));
}
process.exit(bad ? 1 : 0);

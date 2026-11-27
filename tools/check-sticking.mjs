// Checks each beat's sticking (js/machine.js) against the beat as programmed and against a drummer's limits.
//   - every stroke stands for a note the machine plays on that step (nothing added);
//   - which programmed notes are left out, and that `how` says so: 'simpler' when any is, else 'moved' when a note
//     went to the hi-hat foot, to another piece (the cowbell on the ride bell) or to another lane's stroke (`also`),
//     else 'as';
//   - no hand plays two things on one step (one string per hand makes that impossible; the feet have one job each);
//   - each limb's fastest sustained rate at the beat's usual tempo (three strokes in a row; a single quick double,
//     like two kicks a sixteenth apart, is allowed) and each hand's quickest move between two pieces.
// Run after changing a beat or a sticking: node tools/check-sticking.mjs
globalThis.window = globalThis;
const { BEATS, STICK_RAW, STROKES } = await import('../js/machine.js');
const MAX = 8.2;    // strokes a second, sustained: about the edge of comfortable singles for one hand or foot
const MOVE = 100;   // ms: the least time to carry a hand from one piece to another
let bad = 0;
for(const B of BEATS){
  const s = STICK_RAW[B.id]; if(!s){ console.log(`${B.name.padEnd(15)} no sticking  <- check`); bad++; continue; }
  const step = 60 / B.bpm / 4, sw = (B.swing - 50) / 50, tOf = i => (i + (i % 2 ? sw : 0)) * step, problems = [];
  const has = (lane, i) => { const ch = (B.lanes[lane] || '')[i]; return !!ch && ch !== '.'; };
  const want = new Set(), have = new Set(), extra = [];
  for(const lane of Object.keys(B.lanes)) if(lane !== 'kick') for(let i = 0; i < 16; i++) if(has(lane, i)) want.add(`${lane}:${i}`);
  for(const h of ['R', 'L', 'F']) if((s[h] || '').length && s[h].length !== 16) problems.push(`${h} is ${s[h].length} long`);
  for(const h of ['R', 'L']) for(let i = 0; i < 16; i++){
    const c = (s[h] || '')[i]; if(!c || c === '.') continue;
    if(!STROKES[c]){ problems.push(`${h}${i}: unknown stroke ${c}`); continue; }
    const lanes = [...STROKES[c].lanes, ...Object.keys(s.also || {}).filter(l => s.also[l].includes(c))].filter(l => has(l, i));
    if(!lanes.length) extra.push(`${h}${i}:${c}`); lanes.forEach(l => have.add(`${l}:${i}`));
  }
  for(let i = 0; i < 16; i++) if((s.F || '')[i] === 'F'){ if(has('chh', i)) have.add(`chh:${i}`); else extra.push(`F${i}`); }
  const out = [...want].filter(k => !have.has(k));
  const movedBy = [(s.F || '').includes('F') && 'foot', s.also && 'also', ((s.R || '') + (s.L || '')).includes('B') && 'bell'].filter(Boolean);
  const how = out.length ? 'simpler' : movedBy.length ? 'moved' : 'as';
  if(how !== s.how) problems.push(`how should be '${how}'`);
  if(extra.length) problems.push(`adds ${extra.join(' ')}`);
  if(s.note && s.note.length > 100) problems.push(`note is ${s.note.length} characters`);
  if(how !== 'as' && !s.note) problems.push('needs a note');
  // rates: the fastest run of three strokes for each limb, and each hand's quickest change of piece
  const times = str => { const t = []; for(let i = 0; i < 16; i++) if((str || '')[i] && str[i] !== '.') t.push([tOf(i), str[i]]); return t; };
  const rate = t => { const n = t.length, gap = j => (j + 1 < n ? t[j + 1][0] : t[0][0] + 16 * step) - t[j][0];
    let m = Infinity; for(let j = 0; j < n; j++) m = Math.min(m, gap(j) + gap((j + 1) % n)); return n > 2 ? 2 / m : 0; };
  const move = t => { const n = t.length; let m = Infinity;
    for(let j = 0; j < n; j++){ const a = t[j], b = t[(j + 1) % n], d = (j + 1 < n ? b[0] : b[0] + 16 * step) - a[0];
      if(n > 1 && STROKES[a[1]].piece !== STROKES[b[1]].piece) m = Math.min(m, d); } return m === Infinity ? 0 : Math.round(m * 1000); };
  const T = { R: times(s.R), L: times(s.L), K: times(B.lanes.kick), F: times(s.F) }, r = Object.fromEntries(Object.entries(T).map(([k, t]) => [k, rate(t)]));
  const mv = { R: move(T.R), L: move(T.L) };
  for(const [k, v] of Object.entries(r)) if(v > MAX) problems.push(`${k} plays ${v.toFixed(1)} a second`);
  for(const [k, v] of Object.entries(mv)) if(v && v < MOVE) problems.push(`${k} changes piece in ${v} ms`);
  if(problems.length) bad++;
  console.log(`${B.name.padEnd(15)} ${String(B.bpm).padStart(3)} bpm  ${s.how.padEnd(8)} R ${r.R.toFixed(1)} L ${r.L.toFixed(1)} K ${r.K.toFixed(1)} F ${r.F.toFixed(1)} /s` +
    `  moves R ${mv.R || '-'} L ${mv.L || '-'} ms` + (out.length ? `  left out: ${out.join(' ')}` : '') + (problems.length ? `  <- ${problems.join('; ')}` : ''));
}
console.log(bad ? `\n${bad} beat(s) need a look` : '\nAll 15 pass');
process.exit(bad ? 1 : 0);

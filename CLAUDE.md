# Backtrack

A quiet backing track for drum and singing practice. Sibling of Tide Breath (`~/Code/breathe`): same single-file PWA recipe, same design tokens, same night mode and service worker. Single `index.html`, no framework, no build, no backend.
Live at https://harmonicsystems.github.io/backtrack/ (GitHub Pages from `main` root). Repo uses the `github-harmonicsystems` SSH alias.

- **Drum loops** (`audio/drums-{bpm}.m4a`, 60/72/88/96/108/120/128): 17-bar cuts from `~/Music/Logic/Drum Beats/Bounces/` (`Loops/` for the first five; 72 and 128 sit in the parent folder), bars 1–16 loop and bar 17 is natural tail, loudness-matched to −16 LUFS, 128k AAC. The tempo control is a slider with one stop per groove (`GROOVES` in the script holds bpm, genre label, classical term); adding a groove = encode the file and add a row there. The grooves are humanised (bars correlate ~0.7–0.9), so loops of 4/8/16 bars keep the feel. David has said the beats can be public.
- **Loop points are computed from the tempo, not the file**: `loopStart` = first hit found in the decoded buffer (defeats AAC encoder padding), `loopEnd = loopStart + bars·240/bpm`. Fine tempo is `playbackRate` ±8%; the beat clock uses `beatSec = 60/bpm/rate` from `t0` (the drums' first downbeat in `ctx` time).
- **Wash drone** (`audio/wash-{key}.m4a`) is the same 12-loop set as Tide Breath, played with the same crossfading voice player.
- **Bar scheduler** (`scheduleAhead`): every 250 ms it schedules the next ~2 bars of events on the audio clock — drop-out mutes (`drumsMute` gain at bar boundaries) and the optional click. Changing drop-out/click mid-session resets `scheduled` to the next bar.
- **Count-in** is one bar of synthesized clicks before `t0`; the face shows "Count in".
- URL hash is `#{bpm}-{key}`; everything else (loop bars, count-in, fine, volumes, drop-out, click) is `localStorage` `backtrack`. Night mode in `backtrack-night`.
- **Bump `VERSION` in `sw.js` on every deploy**; `AUDIO` only when loop files change.
- Local dev: `python3 -m http.server 8766` (service workers don't run on `file://`). Icons: `magick -background none -density 300 icons/icon.svg -resize 192x192 icons/icon-192.png` (also 180, 512).

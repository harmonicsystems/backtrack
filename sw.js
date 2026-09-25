// BackTrack service worker: the app shell is precached so it opens offline;
// Google Fonts and the drum/wash loops are cached as they're fetched. Bump VERSION on every deploy;
// bump AUDIO only if the loop files themselves change (so phones don't redownload them).
const VERSION = 'backtrack-v14';
const AUDIO = 'backtrack-audio-v1';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'js/app.js', 'js/audio.js', 'js/breath.js', 'js/clock.js', 'js/grid.js', 'js/groove.js', 'js/lab.js', 'js/pitch.js', 'js/rec.js', 'js/rec-worklet.js', 'js/state.js', 'js/takes.js', 'js/timeline.js', 'js/trace.js', 'js/tune.js', 'js/ui.js',
               'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== AUDIO).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Page navigations: network first (fresh deploys win), cache when offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put('./', copy)); return res; })
        .catch(() => caches.match('./'))
    );
    return;
  }

  // The page's modules too: network first, so fresh HTML never runs with the previous deploy's code
  // (cache-first here paired new markup with old modules on the first launch after an update).
  if (url.origin === location.origin && url.pathname.endsWith('.js')) {
    e.respondWith(
      fetch(req, { cache: 'no-cache' }).then(res => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return res; })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Everything else (shell files, fonts, loops): cache first, fill the cache on miss.
  if (url.origin === location.origin || /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        const bucket = url.pathname.includes('/audio/') ? AUDIO : VERSION;
        if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(bucket).then(c => c.put(req, copy)); }
        return res;
      }))
    );
  }
});

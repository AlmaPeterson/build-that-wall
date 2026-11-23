// Build That Wall's service worker: lets the game open and play with no internet (bots and Pass'n'Play),
// once it has been opened online one time. Online play, accounts, feedback and videos still need the internet.
//
// - The page itself: from the network when there is one (so a new version shows straight away), else the saved copy.
// - The game's files (scripts, styles, pictures, sounds): the saved copy at once, and a fresh one fetched in the
//   background for next time (most change name with every version anyway).
// - game-settings.json: the network first, so the owner's changes show straight away.
// - Anything on another site (the game server, Google, PayPal, YouTube) is left alone.
const CACHE = 'btw-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
const MAX_FILES = 400;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function save(req, res) {
  if (!res || res.status !== 200 || res.type === 'opaque') return;
  const c = await caches.open(CACHE);
  await c.put(req, res);
  // Old versions' files pile up: keep the newest ones
  const keys = await c.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_FILES))) {
    if (!SHELL.some((s) => new URL(s, self.registration.scope).href === k.url)) await c.delete(k);
  }
}

async function networkFirst(req, fallback) {
  try {
    const res = await fetch(req);
    void save(req, res.clone());
    return res;
  } catch {
    const hit = (await caches.match(req)) || (fallback && (await caches.match(fallback)));
    if (hit) return hit;
    throw new Error('offline');
  }
}

async function savedThenRefresh(e, req) {
  const hit = await caches.match(req);
  const fresh = fetch(req).then((res) => { void save(req, res.clone()); return res; });
  if (hit) { e.waitUntil(fresh.catch(() => {})); return hit; }
  return fresh;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;   // (songs and videos ask for parts: left alone)
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') { e.respondWith(networkFirst(req, './index.html')); return; }
  if (url.pathname.endsWith('/game-settings.json') || url.pathname.endsWith('/sw.js')) { e.respondWith(networkFirst(req)); return; }
  e.respondWith(savedThenRefresh(e, req));
});

// ─────────────────────────────────────────────────────────────────────
// Vision Cash-Up service worker
//
// What it does:
//  • Caches the app shell (HTML, CSS, JS, Chart.js, logo, icons) so the
//    app can be installed and still opens on a bad connection.
//  • NETWORK-FIRST for the shell: when online you always get the latest
//    files from GitHub Pages (so fixes still go live the same way as
//    before); the cache is only used when the network fails.
//
// What it never does:
//  • It never touches the Apps Script backend (script.google.com /
//    script.googleusercontent.com) — every API call, cash-up submit,
//    photo upload and dashboard load goes straight to the network.
//  • It never handles POSTs or any other cross-origin request.
//
// When the shell file list changes, bump CACHE_VERSION.
// ─────────────────────────────────────────────────────────────────────

const CACHE_VERSION = 'cashup-shell-v1';

const APP_SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'pwa.js',
  'vendor/chart.umd.min.js',
  'assets/logo.jpg',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png'
];

const NEVER_CACHE_HOSTS = [
  'script.google.com',
  'script.googleusercontent.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('cashup-shell-') && k !== CACHE_VERSION)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Backend calls: never intercepted, never cached.
  if (NEVER_CACHE_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h))) return;

  // Only same-origin GETs inside this app's folder are handled; everything
  // else (POSTs, Google Fonts, other sites) goes to the network untouched.
  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  const scopePath = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(scopePath)) return;

  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const res = await fetch(req);
    if (res && res.ok && res.type === 'basic') {
      cache.put(req, res.clone());
    }
    return res;
  } catch (err) {
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    // Offline page load (e.g. launched from the home screen with no signal)
    if (req.mode === 'navigate') {
      const shell = await cache.match('index.html') || await cache.match('./');
      if (shell) return shell;
    }
    throw err;
  }
}

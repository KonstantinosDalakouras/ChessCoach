/* SF19 Coach service worker
 * - offline support (app shell + the Stockfish engine files are cached)
 * - adds COOP/COEP headers so multi-threaded Stockfish works even on hosts that can't set them
 * - serves .wasm with the correct MIME type
 */
const VERSION = '5c4b8441c4';
const APP_CACHE = `sf19c-app-${VERSION}`;
const ENGINE_CACHE = 'sf19c-engine-19';
const PRECACHE = ["./","app.js?v=5c4b8441c4","app.css?v=5c4b8441c4","openings.json","manifest.webmanifest","icon-192.png","icon-512.png","favicon.svg"];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then(cache => cache.addAll(PRECACHE.map(p => new Request(p, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('sf19c-app-') && k !== APP_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isolate(resp, extra) {
  if (!resp || resp.type === 'opaque' || resp.type === 'opaqueredirect' || resp.status === 0) return resp;
  const headers = new Headers(resp.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  if (extra) for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers });
}

const wasmFix = url => (url.pathname.endsWith('.wasm') ? { 'Content-Type': 'application/wasm' } : undefined);

async function navigation(request) {
  const cache = await caches.open(APP_CACHE);
  try {
    // (A navigate-mode Request can't be re-created with an AbortSignal, so race a timer instead.)
    const resp = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 6000)),
    ]);
    if (resp.ok && new URL(request.url).pathname.replace(/index\.html$/, '') === new URL(self.registration.scope).pathname) {
      cache.put('./', resp.clone()).catch(() => {});
    }
    return isolate(resp);
  } catch (e) {
    const hit = (await cache.match('./')) || (await cache.match('index.html'));
    if (hit) return isolate(hit);
    throw e;
  }
}

async function engineFile(request, url) {
  const cache = await caches.open(ENGINE_CACHE);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return isolate(hit, wasmFix(url));
  const resp = await fetch(request);
  if (resp.ok) cache.put(request, resp.clone()).catch(() => {});
  return isolate(resp, wasmFix(url));
}

async function asset(request) {
  const cache = await caches.open(APP_CACHE);
  const hit = await cache.match(request, { ignoreSearch: true });
  const network = fetch(request).then(resp => {
    if (resp.ok && resp.type === 'basic') cache.put(request, resp.clone()).catch(() => {});
    return resp;
  });
  if (hit) {
    network.catch(() => {});
    return isolate(hit);
  }
  return isolate(await network);
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') { event.respondWith(navigation(request)); return; }
  if (url.pathname.includes('/engine/')) { event.respondWith(engineFile(request, url)); return; }
  if (url.pathname.endsWith('/sw.js')) return;
  event.respondWith(asset(request));
});

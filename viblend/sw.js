// sw.js — Viblend Service Worker

const CACHE_NAME = 'viblend-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/app.html',
  '/manifest.json',
  '/css/main.css',
  '/css/animations.css',
  '/css/components.css',
  '/js/config.js',
  '/js/supabase.js',
  '/js/auth.js',
  '/js/taste.js',
  '/js/algorithm.js',
  '/js/player.js',
  '/js/karaoke.js',
  '/js/vocals.js',
  '/js/lyrics.js',
  '/js/room.js',
  '/js/realtime.js',
  '/js/ui.js',
  '/js/app.js',
  '/js/pwa.js',
  '/js/workers/vocals-worker.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ─── Install ──────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache what we can — don't fail install on individual asset failures
      return Promise.allSettled(
        STATIC_ASSETS.map(url =>
          cache.add(url).catch(err => console.warn(`SW cache miss: ${url}`, err))
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ─── Activate ─────────────────────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch Strategy ───────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin requests (except CDN assets)
  if (request.method !== 'GET') return;

  // API calls → Network First
  const isApiCall = url.hostname.includes('supabase') ||
                    url.hostname.includes('spotify') ||
                    url.hostname.includes('apple') ||
                    url.hostname.includes('googleapis') ||
                    url.hostname.includes('lrclib') ||
                    url.pathname.includes('/api/');

  if (isApiCall) {
    event.respondWith(networkFirst(request));
    return;
  }

  // CDN scripts → Cache First with network fallback
  const isCDN = url.hostname.includes('cdn.jsdelivr') ||
                url.hostname.includes('cdnjs.cloudflare') ||
                url.hostname.includes('unpkg') ||
                url.hostname.includes('accounts.google') ||
                url.hostname.includes('js-cdn.music.apple') ||
                url.hostname.includes('scdn.co');

  if (isCDN) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // App shell → Cache First for static assets, Network First for HTML
  if (request.headers.get('Accept')?.includes('text/html')) {
    event.respondWith(networkFirst(request, '/app.html'));
    return;
  }

  // Static assets (JS, CSS, images, models)
  event.respondWith(cacheFirst(request));
});

// ─── Strategies ───────────────────────────────────────────────────────────────

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone()).catch(() => {});
    }
    return networkResponse;
  } catch {
    return new Response('Offline — asset not cached', { status: 503 });
  }
}

async function networkFirst(request, fallbackUrl = null) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok && request.method === 'GET') {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone()).catch(() => {});
    }
    return networkResponse;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;

    if (fallbackUrl) {
      const fallback = await caches.match(fallbackUrl);
      if (fallback) return fallback;
    }

    return new Response(
      JSON.stringify({ error: 'offline', message: 'No network and no cached response' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// ─── Push Notifications (scaffold) ────────────────────────────────────────────

self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'Viblend', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: data.url || '/',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data || '/')
  );
});

// ─── Background sync (scaffold for future use) ────────────────────────────────

self.addEventListener('sync', (event) => {
  if (event.tag === 'viblend-heartbeat') {
    // Future: sync heartbeat when network returns
  }
});

// service-worker.js
const CACHE_VERSION = 'v2';
const CACHE_NAME = `thinktech-${CACHE_VERSION}`;
const STATIC_ASSETS = ['/', '/index.html', '/dashboard.html', '/manifest.json'];

// ─────────────────────────────────────────────
// Install — cache static shell
// ─────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

// ─────────────────────────────────────────────
// Activate — clean old caches
// ─────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ─────────────────────────────────────────────
// Fetch — network-first for API, cache-first for static
// ─────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/uploads/')) return;
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then(cached => {
        if (cached) return cached;
        if (event.request.headers.get('accept')?.includes('text/html')) {
          return caches.match('/index.html');
        }
      }))
  );
});

// ─────────────────────────────────────────────
// Push — receives server push, shows notification
// ─────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {
    title: 'ThinkTech Therapy',
    body: 'You have a new notification',
    link: '/dashboard'
  };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (e) { /* ignore */ }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxOTIgMTkyIj48cmVjdCB3aWR0aD0iMTkyIiBoZWlnaHQ9IjE5MiIgcng9IjQwIiBmaWxsPSIjMWEyYTNhIi8+PHBhdGggZD0iTTk2IDQ4Yy0xNiAwLTMwIDE0LTMwIDMwdjE2YzAgMTYgMTQgMzAgMzAgMzBzMzAtMTQgMzAtMzBWNzhjMC0xNi0xNC0zMC0zMC0zMHoiIGZpbGw9IiMyYTlkOGYiLz48cGF0aCBkPSJNOTYgMTI4Yy0yNCAwLTQ0IDE2LTQ4IDQwaDk2Yy00LTI0LTI0LTQwLTQ4LTQweiIgZmlsbD0iI2U5YzQ2YSIvPjwvc3ZnPg==',
      badge: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxOTIgMTkyIj48cmVjdCB3aWR0aD0iMTkyIiBoZWlnaHQ9IjE5MiIgcng9IjQwIiBmaWxsPSIjMWEyYTNhIi8+PC9zdmc+',
      data: { link: data.link },
      tag: data.tag || 'thinktech',
      requireInteraction: false,
      vibrate: [200, 100, 200]
    })
  );
});

// ─────────────────────────────────────────────
// Notification click — focus or open the app
// ─────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link || '/dashboard';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(link);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(link);
    })
  );
});

// ─────────────────────────────────────────────
// Message — allow skipWaiting
// ─────────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
export function renderServiceWorker(paths: string[], revision: string): string {
  return `/* PhotoBunker: public app shell only. Never cache API or user media. */
const CACHE_PREFIX = 'photobunker-shell-';
const CACHE_NAME = CACHE_PREFIX + ${JSON.stringify(revision)};
const STATIC_PATHS = new Set(${JSON.stringify(paths)});
const APP_ROUTES = new Set(['/', '/camera', '/camera/presets', '/camera/presets/new', '/profiles', '/profiles/new', '/gallery', '/settings', '/profile', '/messages', '/assignments', '/assignments/new', '/profile/teams', '/profile/account', '/profile/edit', '/profile/contacts', '/profile/security', '/join']);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll([...STATIC_PATHS])));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.search) return;

  if (request.mode === 'navigate' && (APP_ROUTES.has(url.pathname) || /^\\/(?:gallery|profiles|assignments|camera\\/presets)\\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\\/(?:team|edit))?$/.test(url.pathname))) {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match('/')) || Response.error();
    }));
    return;
  }

  if (STATIC_PATHS.has(url.pathname)) {
    event.respondWith(caches.open(CACHE_NAME).then(async (cache) =>
      (await cache.match(url.pathname)) || fetch(request)
    ));
  }
});
`
}

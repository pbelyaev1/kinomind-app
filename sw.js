/* KinoMind — service worker.
   Оболочка приложения кэшируется, чтобы открывалось мгновенно и работало без сети.
   Постеры и кадры кладём в отдельный кэш с ограничением по размеру.
   Запросы к /api/ и к TMDB никогда не кэшируем как оболочку. */

const SHELL = 'kinomind-shell-v9';
const MEDIA = 'kinomind-media-v9';
const MEDIA_MAX = 600;
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== MEDIA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trimMedia() {
  const c = await caches.open(MEDIA);
  const keys = await c.keys();
  if (keys.length <= MEDIA_MAX) return;
  await Promise.all(keys.slice(0, keys.length - MEDIA_MAX).map((k) => c.delete(k)));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // синхронизация — только сеть, ничего не кэшируем
  if (url.pathname.startsWith('/api/')) return;

  // картинки TMDB и превью YouTube — сначала кэш, потом сеть
  if (/(^|\.)(image\.tmdb\.org|imagetmdb\.com|imagetmdb\.cub\.rip|i\.ytimg\.com)$/.test(url.hostname)) {
    e.respondWith((async () => {
      const c = await caches.open(MEDIA);
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) { c.put(req, res.clone()); trimMedia(); }
        return res;
      } catch (err) {
        return hit || Response.error();
      }
    })());
    return;
  }

  // данные TMDB — сеть, а если её нет, отдаём последний удачный ответ
  if (/themoviedb\.org$|cub\.rip$|kurwa-bober\.ninja$|kinopoisk\.dev$/.test(url.hostname)) {
    e.respondWith((async () => {
      const c = await caches.open(MEDIA);
      try {
        const res = await fetch(req);
        if (res && res.ok) { c.put(req, res.clone()); trimMedia(); }
        return res;
      } catch (err) {
        const hit = await c.match(req);
        return hit || Response.error();
      }
    })());
    return;
  }

  // сама оболочка — сначала сеть, кэш только как запасной вариант.
  // Иначе после выкладки новой версии пользователь ещё долго видит старую.
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      const c = await caches.open(SHELL);
      try {
        const ctl = new AbortController();
        const to = setTimeout(() => ctl.abort(), 4000);
        const res = await fetch(req, { signal: ctl.signal, cache: 'no-cache' });
        clearTimeout(to);
        if (res && res.ok) { c.put(req, res.clone()); return res; }
        throw new Error('bad');
      } catch (err) {
        const hit = await c.match(req, { ignoreSearch: true });
        return hit || (await c.match('./index.html')) || Response.error();
      }
    })());
  }
});

// страница просит применить новую версию немедленно
self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

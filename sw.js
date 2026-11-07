/* TechTube service worker: the app shell and sample media work offline; uploads live in IndexedDB. */
const CACHE = 'techtube-v1.0.0';
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'media/videos/s1.mp4', 'media/videos/s2.mp4', 'media/videos/s3.mp4',
  'media/videos/s4.mp4', 'media/videos/s5.mp4', 'media/videos/s6.mp4',
  'media/thumbs/s1.jpg', 'media/thumbs/s2.jpg', 'media/thumbs/s3.jpg',
  'media/thumbs/s4.jpg', 'media/thumbs/s5.jpg', 'media/thumbs/s6.jpg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Serve a byte range out of a cached full file, so <video> seeking works offline.
async function rangeFrom(req, hit) {
  const buf = await hit.arrayBuffer();
  const total = buf.byteLength;
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
  let start = 0, end = total - 1;
  if (m && m[1] === '' && m[2] !== '') { start = Math.max(0, total - parseInt(m[2], 10)); }
  else if (m) { start = parseInt(m[1] || '0', 10); if (m[2] !== '') end = Math.min(parseInt(m[2], 10), total - 1); }
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': hit.headers.get('Content-Type') || 'video/mp4',
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const isMedia = url.pathname.includes('/media/');

  if (isMedia) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(url.pathname.replace(/\/$/, ''), { ignoreSearch: true })
        || await cache.match(req.url, { ignoreSearch: true });
      if (hit) return req.headers.has('range') ? rangeFrom(req, hit) : hit;
      return fetch(req);
    })());
    return;
  }

  // App shell: network first (so updates land), cache as the offline fallback.
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    } catch {
      const hit = await caches.match(req, { ignoreSearch: true });
      return hit || caches.match('index.html');
    }
  })());
});

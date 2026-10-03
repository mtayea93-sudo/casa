/* ===== E-CASA Web — Service Worker (تحديث أولًا + أوفلاين) ===== */
const CACHE = 'mt-casa-v22';
const SHELL = [
  './', 'index.html', 'manifest.json', 'icon.svg',
  'logo.png', 'favicon-48.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png',
  'assets/target-morph-1.png', 'assets/target-morph-2.png', 'assets/target-motility.mp4',
  'assets/path-diagram.png', 'assets/defects-diagram.png',
  'css/style.css',
  'js/vendor/firebase-app-compat.js', 'js/vendor/firebase-database-compat.js', 'js/vendor/firebase-auth-compat.js',
  'js/db.js', 'js/login.js', 'js/sync.js', 'js/report.js', 'js/camera.js', 'js/analyze.js',
  'js/morpho.js', 'js/annotate.js', 'js/app.js', 'js/admin.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Network-first: أي تحديث جديد بينزل فورًا على كل الأجهزة.
   لو مفيش نت، بنرجع للنسخة المتخزنة (شغل أوفلاين). */
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(res => {
      if (res.ok && new URL(e.request.url).origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('./')))
  );
});

/* Firebase Auth بيبعت رسائل للـ SW وبيستنى رد ack — من غير الرد ده
   تسجيل الدخول المجهول بيفشل بـ "unsupported_event" والمزامنة بتقف.
   بنرد ack + done فورًا عشان الـ auth يكمل شغله. */
self.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || !d.eventId || !e.ports || !e.ports[0]) return;
  const port = e.ports[0];
  port.postMessage({ status: 'ack', eventId: d.eventId, eventType: d.eventType });
  port.postMessage({ status: 'done', eventId: d.eventId, eventType: d.eventType, response: [] });
});

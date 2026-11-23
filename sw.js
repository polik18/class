/* 智慧課堂助手離線快取（Service Worker）
   - 本站檔案：網路優先，失敗時用快取（確保更新後立即生效，斷網仍可開啟）
   - 鎖定版本的 CDN 程式庫：快取優先
   - 不快取：即時問答 API、統計、分析與任何非 GET 請求 */
const VERSION = 'class-v2026-11-23-game';
const SHELL = [
  './', './index.html', './exam.html', './manifest.webmanifest',
  './css/tailwind.css', './css/pro.css', './css/projector.css', './css/exam-tailwind.css', './css/game.css', './sound-lab.html',
  './js/exam.js', './icon.svg',
  './js/pro/utils.js', './js/pro/app.js', './js/pro/draw.js', './js/pro/clock.js', './js/pro/timer.js',
  './js/pro/score.js', './js/pro/board.js', './js/pro/irs-protocol.js', './js/pro/irs-persistence.js',
  './js/pro/irs-sound.js', './js/pro/irs-quiz-bank.js', './js/pro/irs-game.js', './js/pro/irs-swarm.js', './js/pro/irs-media.js', './js/pro/irs-transport.js', './js/pro/irs.js', './js/pro/data.js', './js/pro/init.js',
  './audio/start.mp3', './audio/end.mp3'
];
const CDN_HOSTS = ['unpkg.com', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const NEVER = [/workers\.dev/, /googletagmanager/, /google-analytics/, /site-stats/, /challenges\.cloudflare\.com/, /peerjs\.com/];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (NEVER.some(re => re.test(url.href))) return;

  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }

  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
        return res;
      }))
    );
  }
});

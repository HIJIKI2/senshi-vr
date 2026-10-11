// オフライン動作用 Service Worker（PWA としてインストール後、PC なしで起動できる）
const CACHE = 'senshi-vr-v6';
const ASSETS = ['./', './index.html', './app.js', './manifest.json', './icon.svg', './icon-192.png', './icon-512.png',
  './lib/three.module.js', './lib/OrbitControls.js', './lib/RoomEnvironment.js', './lib/GLTFLoader.js', './lib/BufferGeometryUtils.js',
  './assets/lps/LeePerrySmith.glb', './assets/lps/col.jpg', './assets/lps/normal.jpg', './assets/hands/left.glb', './assets/hands/right.glb',
  './src/constants.js', './src/vessel.js', './src/textures.js', './src/room.js', './src/patient.js', './src/handmodel.js', './src/tools.js', './src/echo.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request))
  );
});

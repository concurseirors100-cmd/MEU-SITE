// Service worker do QuestIA: permite instalar no celular e abrir sem internet.
//
// Estratégia "rede primeiro": com internet, sempre busca a versão nova (assim uma
// atualização publicada chega sem precisar limpar nada); sem internet, usa a última
// cópia guardada. Os DADOS de estudo não passam por aqui — vivem no IndexedDB.
const CACHE = 'questia-v1';
const ESSENCIAIS = [
  './', './index.html', './css/style.css',
  './js/app.js', './js/calculadora-revisao.js', './js/dashboard.js', './js/formulas.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'
];
const EXTERNOS_OK = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ESSENCIAIS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // chamadas à IA (POST) passam direto
  const url = new URL(req.url);
  const mesmoSite = url.origin === self.location.origin;
  if (!mesmoSite && !EXTERNOS_OK.includes(url.hostname)) return;
  if (mesmoSite && url.pathname.startsWith('/api/')) return;

  e.respondWith(
    fetch(req)
      .then((resp) => {
        if (resp.ok) {
          const copia = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, copia));
        }
        return resp;
      })
      .catch(() => caches.match(req).then((r) => r || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});

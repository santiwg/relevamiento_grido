/* ==========================================================================
   Service worker: guarda la app en el celular para que abra SIN señal.
   - La primera vez que se abre con internet, descarga los archivos de abajo.
   - Después responde desde el celular y, si hay señal, actualiza en segundo plano
     (la versión nueva se ve la siguiente vez que se abre la app).
   - Solo toca archivos de la propia app. Los envíos a Google Sheets pasan de largo.
   Para forzar que todos los celulares tomen una versión nueva, cambiá VERSION.
   ========================================================================== */

const VERSION = 'relevamiento-2.0.0';

const ARCHIVOS = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'lib/jszip.min.js',
  'lib/qrcode.js'
];

// Al instalarse: descarga todo y queda listo
self.addEventListener('install', evento => {
  evento.waitUntil(
    caches.open(VERSION).then(cache => cache.addAll(ARCHIVOS)).then(() => self.skipWaiting())
  );
});

// Al activarse: borra las cachés de versiones viejas y toma el control
self.addEventListener('activate', evento => {
  evento.waitUntil(
    caches.keys()
      .then(nombres => Promise.all(nombres.filter(n => n !== VERSION).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Al pedir un archivo: responde desde el celular y actualiza en segundo plano
self.addEventListener('fetch', evento => {
  const pedido = evento.request;
  if (pedido.method !== 'GET') return;
  const url = new URL(pedido.url);
  if (url.origin !== self.location.origin) return;           // por ejemplo, Google Sheets

  evento.respondWith(
    caches.open(VERSION).then(async cache => {
      const guardado = await cache.match(pedido, { ignoreSearch: true });
      const red = fetch(pedido).then(respuesta => {
        if (respuesta && respuesta.ok) cache.put(pedido, respuesta.clone());
        return respuesta;
      }).catch(() => null);
      if (guardado) return guardado;
      const respuesta = await red;
      // Sin señal y sin archivo guardado: si era una página, entrega la principal
      return respuesta || (pedido.mode === 'navigate' ? cache.match('index.html') : Response.error());
    })
  );
});

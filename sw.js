// Service worker minimal — exigé par certains navigateurs pour l'installation en
// application de bureau (PWA). Ne met rien en cache : toutes les requêtes
// (y compris Firestore) passent directement par le réseau, pour ne jamais
// servir de données obsolètes en caisse/comptabilité.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {}); // pass-through, pas d'interception

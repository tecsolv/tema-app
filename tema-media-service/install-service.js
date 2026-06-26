// Installe TeMa Media Service comme service Windows (démarrage automatique avec
// Windows, redémarrage auto en cas de crash). Exécuter avec : node install-service.js
// (depuis une invite de commande "Exécuter en tant qu'administrateur").
// Nécessite : npm install node-windows --save (non inclus par défaut, optionnel).
const Service = require('node-windows').Service;

const svc = new Service({
  name: 'TeMa Media Service',
  description: 'Lecteur audio local pour la diffusion boutique TeMa (VLC), piloté par TeMa Media Center.',
  script: require('path').join(__dirname, 'index.js')
});

svc.on('install', () => svc.start());
svc.install();

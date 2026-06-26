// Installe TeMa Media Service comme service Windows (démarrage automatique avec
// Windows, redémarrage auto en cas de crash). Exécuter avec : node install-service.js
// (depuis une invite de commande "Exécuter en tant qu'administrateur").
const Service = require('node-windows').Service;

const svc = new Service({
  name: 'TeMa Media Service',
  description: 'Pilote VirtualDJ pour la diffusion audio TeMa Boutique (via pont MIDI), sur ordre de TeMa Media Center.',
  script: require('path').join(__dirname, 'index.js')
});

svc.on('install', () => svc.start());
svc.install();

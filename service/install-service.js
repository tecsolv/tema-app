'use strict';

const { Service } = require('node-windows');
const path = require('path');

const svc = new Service({
  name: 'TeMaMediaService',
  description: 'TeMa Media Service — Pont Firestore ↔ VirtualDJ',
  script: path.join(__dirname, 'index.js'),
  nodeOptions: []
});

const isUninstall = process.argv.includes('--uninstall');

svc.on('install', () => {
  console.log('✅ Service installé.');
  console.log('   Vérification : Gestionnaire de services Windows → "TeMaMediaService"');
  svc.start();
});

svc.on('start', () => {
  console.log('✅ Service démarré.');
});

svc.on('uninstall', () => {
  console.log('✅ Service désinstallé.');
});

svc.on('error', err => {
  console.error('❌ Erreur service :', err);
});

if (isUninstall) {
  console.log('Désinstallation de TeMaMediaService…');
  svc.uninstall();
} else {
  console.log('Installation de TeMaMediaService comme service Windows…');
  console.log('(Cette opération nécessite une invite Administrateur)');
  svc.install();
}

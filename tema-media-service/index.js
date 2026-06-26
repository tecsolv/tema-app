// TeMa Media Service — point d'entrée. Lance VLC localement, se connecte à
// Firebase, et reste actif 24/7 indépendamment du navigateur. C'est la seule
// pièce du système TeMa qui fait réellement sortir du son.
const fs = require('fs');
const path = require('path');
const { initFirebase } = require('./firebase');
const Player = require('./player');
const Queue = require('./queue');
const { demarrerSync } = require('./sync');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

console.log(`TeMa Media Service — démarrage (device: ${config.deviceId})`);

const db = initFirebase(config);
const player = new Player(config);
const queue = new Queue(db, path.resolve(config.cacheDir || './cache'));

player.demarrer();

// Laisse le temps à VLC d'ouvrir son interface HTTP avant le premier appel.
setTimeout(() => {
  demarrerSync({ db, config, player, queue });
  console.log('TeMa Media Service — opérationnel, en écoute de media_commands.');
}, 3000);

process.on('uncaughtException', err => console.error('[FATAL]', err));
process.on('unhandledRejection', err => console.error('[FATAL]', err));

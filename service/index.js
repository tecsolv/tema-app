// TeMa Media Service — point d'entrée. Lance VLC localement, se connecte à
// Firebase, et reste actif 24/7 indépendamment du navigateur. C'est la seule
// pièce du système TeMa qui fait réellement sortir du son.
const fs = require('fs');
const path = require('path');
const { initFirebase, initStorageBucket } = require('./firebase');
const Player = require('./player');
const Queue = require('./queue');
const { demarrerSync } = require('./sync');
const { demarrerRelayClient } = require('./relay-client');

const CONFIG_PATH = path.join(__dirname, 'config.json');
if (!fs.existsSync(CONFIG_PATH)) {
  console.error('❌ config.json introuvable.');
  console.error('   Copiez config.example.json en config.json et adaptez les valeurs.');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

const SA_PATH = path.resolve(config.firebaseServiceAccountPath || './service-account.json');
if (!fs.existsSync(SA_PATH)) {
  console.error('❌ service-account.json introuvable.');
  console.error('   Firebase Console > Paramètres du projet > Comptes de service > Générer une nouvelle clé privée.');
  process.exit(1);
}

console.log('═══════════════════════════════════════');
console.log('   TeMa Media Service v2.0.0');
console.log(`   Appareil : ${config.deviceId}`);
console.log('═══════════════════════════════════════');

// Prévention de la veille Windows — maintient le PC actif pendant toute la durée du service.
// SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) : interdit la veille système
// tant que ce processus tourne. L'OS remet les paramètres à zéro automatiquement à l'arrêt.
if (process.platform === 'win32') {
  const { execFile } = require('child_process');
  const tmpPs = path.join(require('os').tmpdir(), 'tema_wake.ps1');
  fs.writeFileSync(tmpPs, `
Add-Type -Name W32 -Namespace TeMaPI -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("kernel32.dll")]
public static extern uint SetThreadExecutionState(uint esFlags);
'@
[TeMaPI.W32]::SetThreadExecutionState(0x80000001) | Out-Null
`);
  execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmpPs],
    err => err
      ? console.warn('[VEILLE] SetThreadExecutionState non disponible :', err.message)
      : console.log('[VEILLE] Veille système bloquée ✓')
  );
}

const db = initFirebase(config);
const storageBucket = initStorageBucket(config);
const player = new Player(config);
const queue = new Queue(db, path.resolve(config.cacheDir || './cache'));

player.demarrer();

// Laisse le temps à VLC d'ouvrir son interface HTTP avant le premier appel.
setTimeout(() => {
  const relayClient = demarrerRelayClient(config); // "Retour de Son" temps réel — voir relay-client.js
  demarrerSync({ db, config, player, queue, storageBucket, relayClient });
  console.log('✅ TeMa Media Service opérationnel — en écoute de media_commands.');
}, 3000);

process.on('uncaughtException', err => console.error('[FATAL]', err));
process.on('unhandledRejection', err => console.error('[FATAL]', err));

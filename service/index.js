'use strict';

const admin = require('firebase-admin');
const JZZ = require('jzz');
const chokidar = require('chokidar');
const fs = require('fs');
const path = require('path');

// --- Configuration ---
const CONFIG_PATH = path.join(__dirname, 'config.json');
if (!fs.existsSync(CONFIG_PATH)) {
  console.error('❌ config.json introuvable.');
  console.error('   Copiez config.example.json en config.json et adaptez les valeurs.');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

const SA_PATH = path.join(__dirname, 'service-account.json');
if (!fs.existsSync(SA_PATH)) {
  console.error('❌ service-account.json introuvable.');
  console.error('   Firebase Console > Paramètres du projet > Comptes de service > Générer une nouvelle clé privée.');
  process.exit(1);
}

// --- Firebase ---
admin.initializeApp({ credential: admin.credential.cert(require(SA_PATH)) });
const db = admin.firestore();

// --- MIDI ---
let midiPort = null;

async function openMidiPort() {
  try {
    const midi = await JZZ();
    midiPort = midi.openMidiOut(config.midiPortName);
    await midiPort;
    console.log(`✅ Port MIDI ouvert : "${config.midiPortName}"`);
  } catch (err) {
    console.error(`❌ Port MIDI "${config.midiPortName}" inaccessible : ${err.message}`);
    console.error('   Vérifiez que loopMIDI est en cours d\'exécution avec ce nom de port.');
    midiPort = null;
  }
}

function sendMidiNote(channel, note, velocity) {
  if (!midiPort) return;
  midiPort.noteOn(channel - 1, note, velocity);
  setTimeout(() => { if (midiPort) midiPort.noteOff(channel - 1, note, 0); }, 100);
}

function sendMidiCC(channel, cc, value) {
  if (!midiPort) return;
  midiPort.control(channel - 1, cc, value);
}

function sendMidi(mapping) {
  if (!mapping) return;
  if (mapping.type === 'cc') sendMidiCC(mapping.channel, mapping.cc, mapping.value ?? 127);
  else sendMidiNote(mapping.channel, mapping.note, mapping.velocity ?? 127);
}

// --- État local ---
let etatLocal = {
  status: 'stopped',
  nowPlaying: '',
  artiste: '',
  album: '',
  volume: 70,
  shuffle: false,
  repeat: 'aucun',
  position: 0,
  sourceId: null
};

// --- Mise à jour Firestore ---
async function majEtatFirestore(updates) {
  Object.assign(etatLocal, updates);
  try {
    await db.collection('media_state').doc(config.deviceId).set({
      ...etatLocal,
      deviceId: config.deviceId,
      derniereSynchro: admin.firestore.FieldValue.serverTimestamp(),
      etatService: 'en_marche'
    }, { merge: true });
  } catch (err) {
    console.error('Erreur media_state:', err.message);
  }
}

// --- Heartbeat (maintient le voyant "En ligne" dans le tableau de bord) ---
function demarrerHeartbeat() {
  const ms = config.heartbeatIntervalMs || 10000;
  setInterval(async () => {
    try {
      const ts = admin.firestore.FieldValue.serverTimestamp();
      await Promise.all([
        db.collection('media_state').doc(config.deviceId).set(
          { derniereSynchro: ts, etatService: 'en_marche' }, { merge: true }
        ),
        db.collection('media_devices').doc(config.deviceId).set(
          { derniereSynchro: ts, statut: 'online' }, { merge: true }
        )
      ]);
    } catch (err) { console.error('Heartbeat:', err.message); }
  }, ms);
  console.log(`💓 Heartbeat actif (toutes les ${ms / 1000}s)`);
}

// --- Traitement d'une commande ---
async function traiterCommande(id, data) {
  const { command, params = {}, deviceId } = data;
  if (deviceId !== config.deviceId) return;

  console.log(`▶  ${command}`, Object.keys(params).length ? params : '');
  const m = config.midiMapping || {};

  try {
    switch (command) {
      case 'PLAY':
        sendMidi(m.PLAY || { type: 'note', channel: 1, note: 60, velocity: 127 });
        await majEtatFirestore({ status: 'playing' });
        break;

      case 'PAUSE':
        sendMidi(m.PAUSE || { type: 'note', channel: 1, note: 61, velocity: 127 });
        await majEtatFirestore({ status: 'paused' });
        break;

      case 'STOP':
        sendMidi(m.STOP || { type: 'note', channel: 1, note: 62, velocity: 127 });
        await majEtatFirestore({ status: 'stopped', nowPlaying: '', artiste: '', position: 0 });
        break;

      case 'NEXT':
        sendMidi(m.NEXT || { type: 'note', channel: 1, note: 63, velocity: 127 });
        break;

      case 'PREVIOUS':
        sendMidi(m.PREVIOUS || { type: 'note', channel: 1, note: 64, velocity: 127 });
        break;

      case 'SET_VOLUME': {
        const vol = params.volume ?? 70;
        const midiVol = Math.round(Math.min(127, Math.max(0, vol / 100 * 127)));
        const vm = m.SET_VOLUME || { type: 'cc', channel: 1, cc: 7 };
        sendMidiCC(vm.channel, vm.cc, midiVol);
        await majEtatFirestore({ volume: vol });
        break;
      }

      case 'FADE_OUT':
        sendMidi(m.FADE_OUT || { type: 'note', channel: 1, note: 68, velocity: 127 });
        break;

      case 'FADE_IN':
        sendMidi(m.FADE_IN || { type: 'note', channel: 1, note: 69, velocity: 127 });
        break;

      case 'SET_SHUFFLE':
        sendMidi(m.SET_SHUFFLE || { type: 'note', channel: 1, note: 70, velocity: 127 });
        await majEtatFirestore({ shuffle: params.shuffle ?? false });
        break;

      case 'SET_REPEAT':
        await majEtatFirestore({ repeat: params.repeat || 'aucun' });
        break;

      case 'SET_SOURCE':
      case 'SET_PLAYLIST':
        // VirtualDJ doit avoir la playlist correspondante ouverte manuellement.
        // Ici on met juste à jour l'état pour que le tableau de bord soit cohérent.
        await majEtatFirestore({ sourceId: params.sourceId || params.playlistId || null });
        console.warn(`⚠️  ${command} : changement de source non automatisé via MIDI. Chargez la playlist dans VirtualDJ.`);
        break;

      case 'SEEK':
        // MIDI seul ne permet pas un seek précis sans Pro API.
        await majEtatFirestore({ position: params.secondes || 0 });
        break;

      case 'PLAY_ANNOUNCEMENT':
        sendMidi(m.PLAY_ANNOUNCEMENT || m.PLAY || { type: 'note', channel: 1, note: 60, velocity: 127 });
        break;

      default:
        console.log(`⚠️  Commande non gérée : ${command}`);
    }

    await db.collection('media_commands').doc(id).update({ statut: 'traitée' });
  } catch (err) {
    console.error(`Erreur commande ${command}:`, err.message);
    await db.collection('media_commands').doc(id)
      .update({ statut: 'erreur', erreur: err.message }).catch(() => {});
  }
}

// --- Écoute des commandes Firestore ---
function demarrerEcouteCommandes() {
  db.collection('media_commands')
    .where('deviceId', '==', config.deviceId)
    .where('statut', '==', 'en_attente')
    .onSnapshot(snapshot => {
      snapshot.docChanges().forEach(change => {
        if (change.type === 'added') traiterCommande(change.doc.id, change.doc.data());
      });
    }, err => console.error('Écoute media_commands:', err.message));

  console.log(`👂 En attente de commandes pour l'appareil : ${config.deviceId}`);
}

// --- Surveillance du fichier "Now Playing" de VirtualDJ ---
function demarrerSurveillanceNowPlaying() {
  const filePath = config.nowPlayingFilePath;
  if (!filePath) return;

  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️  Fichier "Now Playing" introuvable : ${filePath}`);
    console.warn('   Dans VirtualDJ : Options > Recording/Broadcast > "Now playing to file" → pointer vers ce chemin.');
    return;
  }

  chokidar.watch(filePath, { usePolling: true, interval: 1000 }).on('change', async () => {
    try {
      const contenu = fs.readFileSync(filePath, 'utf8').trim();
      if (contenu && contenu !== etatLocal.nowPlaying) {
        const parts = contenu.split(' - ');
        const artiste = parts.length >= 2 ? parts[0].trim() : '';
        const titre = parts.length >= 2 ? parts.slice(1).join(' - ').trim() : contenu;
        await majEtatFirestore({ nowPlaying: contenu, artiste, album: '', status: 'playing' });
        console.log(`🎵 En cours : ${contenu}`);
      }
    } catch (err) {
      console.error('Lecture now-playing:', err.message);
    }
  });

  console.log(`👁️  Surveillance : ${filePath}`);
}

// --- Enregistrement de l'appareil ---
async function enregistrerAppareil() {
  try {
    await db.collection('media_devices').doc(config.deviceId).set({
      deviceId: config.deviceId,
      nom: config.deviceName || config.deviceId,
      derniereSynchro: admin.firestore.FieldValue.serverTimestamp(),
      statut: 'online',
      plateforme: 'windows',
      version: '1.0.0'
    }, { merge: true });
    console.log(`📋 Appareil enregistré : ${config.deviceId}`);
  } catch (err) {
    console.error('Enregistrement appareil:', err.message);
  }
}

// --- Arrêt propre ---
async function arreter() {
  console.log('\n🛑 Arrêt TeMa Media Service…');
  try {
    const ts = admin.firestore.FieldValue.serverTimestamp();
    await Promise.all([
      db.collection('media_state').doc(config.deviceId).update({ etatService: 'hors_ligne', derniereSynchro: ts }),
      db.collection('media_devices').doc(config.deviceId).update({ statut: 'offline', derniereSynchro: ts })
    ]);
  } catch {}
  if (midiPort) midiPort.close();
  process.exit(0);
}

process.on('SIGINT', arreter);
process.on('SIGTERM', arreter);

// --- Démarrage ---
async function demarrer() {
  console.log('═══════════════════════════════════════');
  console.log('   TeMa Media Service v1.0.0');
  console.log(`   Appareil : ${config.deviceId}`);
  console.log('═══════════════════════════════════════');

  await openMidiPort();
  await enregistrerAppareil();
  await majEtatFirestore({ status: 'stopped', etatService: 'en_marche' });
  demarrerHeartbeat();
  demarrerEcouteCommandes();
  demarrerSurveillanceNowPlaying();

  console.log('✅ Service démarré. Ctrl+C pour arrêter.\n');
}

demarrer().catch(err => {
  console.error('Erreur fatale:', err);
  process.exit(1);
});

// TeMa Media Service — pont entre Firestore (commandes envoyées par TeMa Media Center)
// et VirtualDJ, via un port MIDI virtuel (loopMIDI) mappé une fois dans les paramètres
// de VirtualDJ. Ce service ne joue jamais de son lui-même : il traduit des commandes
// en messages MIDI, et lit le fichier "now playing" exporté par VirtualDJ pour
// republier le titre courant dans Firestore.
//
// NON TESTÉ contre une vraie installation VirtualDJ — à valider et ajuster sur place
// (voir README.md pour la procédure d'installation et de calibrage).

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const easymidi = require('easymidi');
const chokidar = require('chokidar');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(require(path.resolve(config.firebaseServiceAccountPath)))
});
const db = admin.firestore();
const ZONE = config.zone;
const stateRef = db.collection('media_center').doc(ZONE);

let midiOut;
try {
  midiOut = new easymidi.Output(config.midiPortName);
  console.log(`[MIDI] Connecté au port "${config.midiPortName}"`);
} catch (err) {
  console.error(`[MIDI] Impossible d'ouvrir le port "${config.midiPortName}". ` +
    `Vérifiez que loopMIDI est lancé et que le port existe.`, err.message);
  process.exit(1);
}

function envoyerMidi(action, params) {
  const map = config.midiMapping[action];
  if (!map) throw new Error(`Aucun mapping MIDI défini pour la commande "${action}"`);
  if (map.type === 'noteon') {
    midiOut.send('noteon', { note: map.note, velocity: 127, channel: map.channel || 0 });
    setTimeout(() => midiOut.send('noteoff', { note: map.note, velocity: 0, channel: map.channel || 0 }), 80);
  } else if (map.type === 'cc') {
    const valeurMidi = action === 'SET_VOLUME'
      ? Math.round(((params?.volume ?? 70) / 100) * 127)
      : 0;
    midiOut.send('cc', { controller: map.controller, value: valeurMidi, channel: map.channel || 0 });
  } else {
    throw new Error(`Type de mapping MIDI inconnu : ${map.type}`);
  }
}

async function publierEtat(maj) {
  await stateRef.set({
    derniereSynchro: admin.firestore.FieldValue.serverTimestamp(),
    ...maj
  }, { merge: true });
}

// ── Traitement des commandes (media_commands, statut = 'en_attente') ──
function demarrerEcouteCommandes() {
  db.collection('media_commands')
    .where('zone', '==', ZONE)
    .where('statut', '==', 'en_attente')
    .orderBy('dateTS', 'asc')
    .onSnapshot(snap => {
      snap.docChanges().forEach(async change => {
        if (change.type !== 'added') return;
        const doc = change.doc;
        const { commande, params } = doc.data();
        console.log(`[COMMANDE] ${commande}`, params || {});
        try {
          envoyerMidi(commande, params);
          // Champs directement connus suite à la commande (TeMa les a déjà optimistement
          // affichés ; on les republie ici pour rester la source de vérité une fois traitée).
          const maj = {};
          if (commande === 'SET_VOLUME') maj.volume = params.volume;
          if (commande === 'SET_SHUFFLE') maj.shuffle = params.shuffle;
          if (commande === 'SET_REPEAT') maj.repeat = params.repeat;
          if (commande === 'SET_AUTODJ') maj.autodj = params.autodj;
          if (commande === 'LOAD_PLAYLIST') { maj.playlist = params.playlist; maj.mode = 'playlist'; maj.status = 'playing'; }
          if (commande === 'LOAD_RADIO') { maj.station = params.url; maj.mode = 'radio'; maj.status = 'playing'; }
          if (commande === 'PLAY') maj.status = 'playing';
          if (commande === 'PAUSE') maj.status = 'paused';
          if (commande === 'STOP') maj.status = 'stopped';
          await publierEtat({ ...maj, etatVirtualDJ: 'connecte', erreur: null });
          await doc.ref.update({ statut: 'traitee' });
        } catch (err) {
          console.error(`[ERREUR] commande ${commande} :`, err.message);
          await doc.ref.update({ statut: 'erreur', erreurDetail: err.message });
          await publierEtat({ etatVirtualDJ: 'erreur', erreur: err.message });
        }
      });
    }, err => console.error('[FIRESTORE] Écoute media_commands interrompue :', err.message));
}

// ── Lecture du fichier "now playing" exporté par VirtualDJ ──
// Hypothèse de format par défaut : une ligne texte "Artiste - Titre" réécrite par VDJ
// à chaque changement de piste (Options > Recording > "Now playing to file" dans VDJ,
// ou un script de plugin équivalent). À adapter selon le format réellement produit.
function demarrerSurveillanceNowPlaying() {
  if (!config.nowPlayingFilePath) {
    console.warn('[NOW PLAYING] nowPlayingFilePath non configuré — le titre courant ne sera pas synchronisé.');
    return;
  }
  const lireEtPublier = async () => {
    try {
      const contenu = fs.readFileSync(config.nowPlayingFilePath, 'utf8').trim();
      if (contenu) await publierEtat({ titre: contenu, etatVirtualDJ: 'connecte', erreur: null });
    } catch (err) {
      console.error('[NOW PLAYING] Lecture impossible :', err.message);
    }
  };
  chokidar.watch(config.nowPlayingFilePath).on('change', lireEtPublier);
  lireEtPublier();
}

// ── Heartbeat : republie périodiquement derniereSynchro pour que TeMa sache
// que le service est vivant, même sans commande ni changement de piste ──
function demarrerHeartbeat() {
  setInterval(() => publierEtat({}), config.pollIntervalMs || 2000);
}

console.log(`TeMa Media Service démarré — zone "${ZONE}"`);
demarrerEcouteCommandes();
demarrerSurveillanceNowPlaying();
demarrerHeartbeat();

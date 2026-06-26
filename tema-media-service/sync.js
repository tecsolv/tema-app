// Synchronisation Firebase : écoute media_commands destinées à ce deviceId,
// exécute via player/queue, publie l'état dans media_state, et tient à jour
// media_devices (présence/heartbeat) pour que TeMa Web App sache si ce poste
// est en ligne.
const { admin } = require('./firebase');

function demarrerSync({ db, config, player, queue }) {
  const deviceId = config.deviceId;
  const stateRef = db.collection('media_state').doc(deviceId);
  const deviceRef = db.collection('media_devices').doc(deviceId);

  let dernierTimestampTraite = 0;

  async function publierState(maj) {
    await stateRef.set({
      ...maj,
      derniereSynchro: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }

  async function annoncerDevice(statut) {
    await deviceRef.set({
      label: config.deviceLabel || deviceId,
      statut,
      derniereSynchro: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }

  async function traiterCommande(doc) {
    const data = doc.data();
    if (data.deviceId && data.deviceId !== deviceId) return;
    if (!data.timestamp || data.timestamp <= dernierTimestampTraite) return;
    dernierTimestampTraite = data.timestamp;

    console.log(`[SYNC] Commande reçue : ${data.command}`, data.params || {});
    try {
      switch (data.command) {
        case 'PLAY': {
          let piste = queue.pisteCourante();
          if (!piste) { await publierState({ erreur: 'Aucune piste en file — chargez une playlist' }); break; }
          const cheminLocal = await queue.telechargerSiBesoin(piste);
          await player.jouer(cheminLocal);
          await publierState({ status: 'playing', nowPlaying: piste.titre, erreur: null });
          break;
        }
        case 'PAUSE':
          await player.pause();
          await publierState({ status: 'paused' });
          break;
        case 'STOP':
          await player.stop();
          await publierState({ status: 'stopped' });
          break;
        case 'NEXT': {
          const piste = queue.suivante();
          if (!piste) { await publierState({ erreur: 'File vide' }); break; }
          const cheminLocal = await queue.telechargerSiBesoin(piste);
          await player.jouer(cheminLocal);
          await publierState({ status: 'playing', nowPlaying: piste.titre, erreur: null });
          break;
        }
        case 'SET_PLAYLIST': {
          const pistes = await queue.chargerPlaylist(data.params.playlistId);
          await publierState({ playlistId: data.params.playlistId, erreur: null });
          if (pistes.length) {
            const cheminLocal = await queue.telechargerSiBesoin(pistes[0]);
            await player.jouer(cheminLocal);
            await publierState({ status: 'playing', nowPlaying: pistes[0].titre });
          }
          break;
        }
        case 'SET_VOLUME':
          await player.definirVolume(data.params.volume);
          await publierState({ volume: data.params.volume });
          break;
        default:
          console.warn(`[SYNC] Commande inconnue ignorée : ${data.command}`);
      }
      await doc.ref.update({ statut: 'traitee' });
    } catch (err) {
      console.error('[SYNC] Erreur traitement commande :', err.message);
      await doc.ref.update({ statut: 'erreur', erreurDetail: err.message });
      await publierState({ erreur: err.message });
    }
  }

  db.collection('media_commands')
    .where('deviceId', '==', deviceId)
    .where('statut', '==', 'en_attente')
    .onSnapshot(snap => {
      snap.docChanges().forEach(change => {
        if (change.type === 'added') traiterCommande(change.doc);
      });
    }, err => console.error('[SYNC] Écoute media_commands interrompue :', err.message));

  annoncerDevice('online');
  setInterval(() => annoncerDevice('online'), config.heartbeatIntervalMs || 5000);

  process.on('SIGINT', async () => { await annoncerDevice('offline'); process.exit(0); });
  process.on('SIGTERM', async () => { await annoncerDevice('offline'); process.exit(0); });
}

module.exports = { demarrerSync };

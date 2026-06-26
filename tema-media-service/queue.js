// File de lecture locale : résout une playlist (media_playlists) en liste de pistes
// (media_tracks), télécharge chaque fichier depuis Firebase Storage vers un cache
// disque local, et fournit la piste courante au lecteur VLC.
const fs = require('fs');
const path = require('path');
const https = require('https');

class Queue {
  constructor(db, cacheDir) {
    this.db = db;
    this.cacheDir = cacheDir;
    this.pistes = [];
    this.index = 0;
    this.playlistId = null;
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  }

  async chargerPlaylist(playlistId) {
    const playlistDoc = await this.db.collection('media_playlists').doc(playlistId).get();
    if (!playlistDoc.exists) throw new Error(`Playlist introuvable : ${playlistId}`);
    const { trackIds = [] } = playlistDoc.data();
    const pistes = [];
    for (const trackId of trackIds) {
      const trackDoc = await this.db.collection('media_tracks').doc(trackId).get();
      if (trackDoc.exists) pistes.push({ id: trackId, ...trackDoc.data() });
    }
    this.pistes = pistes;
    this.index = 0;
    this.playlistId = playlistId;
    return pistes;
  }

  async telechargerSiBesoin(piste) {
    const nomFichier = `${piste.id}${path.extname(piste.url || '') || '.mp3'}`;
    const cheminLocal = path.join(this.cacheDir, nomFichier);
    if (fs.existsSync(cheminLocal)) return cheminLocal;
    console.log(`[QUEUE] Téléchargement de "${piste.titre}"...`);
    await new Promise((resolve, reject) => {
      const fichier = fs.createWriteStream(cheminLocal);
      https.get(piste.url, res => {
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode} pour ${piste.url}`)); return; }
        res.pipe(fichier);
        fichier.on('finish', () => fichier.close(resolve));
      }).on('error', reject);
    });
    return cheminLocal;
  }

  pisteCourante() { return this.pistes[this.index] || null; }

  suivante() {
    if (!this.pistes.length) return null;
    this.index = (this.index + 1) % this.pistes.length;
    return this.pisteCourante();
  }
}

module.exports = Queue;

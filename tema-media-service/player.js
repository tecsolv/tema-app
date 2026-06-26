// Pilotage de VLC via son interface HTTP intégrée (--intf http), qui EST l'interface
// de contrôle officielle de VLC en ligne de commande — pas une dépendance tierce.
// VLC est lancé une seule fois au démarrage du service et reste actif 24/7.
const { spawn } = require('child_process');
const http = require('http');

class Player {
  constructor(config) {
    this.config = config;
    this.process = null;
    this.currentVolume = config.defaultVolume ?? 70;
  }

  demarrer() {
    const { binaryPath, httpPort, httpPassword } = this.config.vlc;
    this.process = spawn(binaryPath, [
      '--intf', 'http',
      '--http-port', String(httpPort),
      '--http-password', httpPassword,
      '--no-video',
      '--extraintf', 'http'
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    this.process.stdout.on('data', d => console.log('[VLC]', d.toString().trim()));
    this.process.stderr.on('data', d => console.error('[VLC:err]', d.toString().trim()));
    this.process.on('exit', code => {
      console.error(`[VLC] Processus terminé (code ${code}) — relance dans 3s`);
      setTimeout(() => this.demarrer(), 3000);
    });
  }

  requeteHttp(cheminAvecQuery) {
    const { httpPort, httpPassword } = this.config.vlc;
    return new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1', port: httpPort, path: cheminAvecQuery,
        auth: `:${httpPassword}`, timeout: 4000
      }, res => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => resolve(body));
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('Timeout VLC HTTP')));
      req.end();
    });
  }

  async jouer(cheminFichierLocal) {
    const cible = encodeURIComponent(cheminFichierLocal);
    await this.requeteHttp(`/requests/status.json?command=in_play&input=${cible}`);
  }

  async pause() { await this.requeteHttp('/requests/status.json?command=pl_pause'); }
  async stop() { await this.requeteHttp('/requests/status.json?command=pl_stop'); }
  async suivant() { await this.requeteHttp('/requests/status.json?command=pl_next'); }

  async definirVolume(pourcent) {
    this.currentVolume = pourcent;
    const valeurVlc = Math.round((pourcent / 100) * 256); // VLC : 0-256 = 0-200%
    await this.requeteHttp(`/requests/status.json?command=volume&val=${valeurVlc}`);
  }

  async etat() {
    const body = await this.requeteHttp('/requests/status.json');
    try { return JSON.parse(body); } catch { return null; }
  }
}

module.exports = Player;

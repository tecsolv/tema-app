# TeMa Media Service

Service Windows qui relie **TeMa Media Center** (le navigateur, qui n'envoie que des
commandes Firestore) à **VirtualDJ** (qui assure la diffusion réelle du son). Le
navigateur ne joue jamais le son — ce service est la seule pièce qui parle à VirtualDJ.

⚠️ **Ce code n'a pas pu être testé contre une vraie installation VirtualDJ** (pas
d'accès à un poste Windows dans l'environnement où il a été écrit). Considérez-le comme
un point de départ solide à calibrer et valider sur le poste de diffusion réel.

## Principe

VirtualDJ n'expose pas d'API HTTP universelle sur toutes ses éditions. La méthode
qui fonctionne sur **toute édition** est un **pont MIDI virtuel** :

1. Ce service envoie des messages MIDI (notes / contrôleurs) sur un port MIDI virtuel.
2. VirtualDJ "voit" ce port comme un contrôleur MIDI externe.
3. Dans VirtualDJ (Options > Controllers > MIDI Mapping), on associe une fois chaque
   note MIDI à une action (Play, Pause, Next, Load Playlist, etc.).
4. Pour republier le titre en cours vers TeMa, VirtualDJ écrit le morceau en cours dans
   un fichier texte (fonctionnalité native "Now playing to file", utilisée normalement
   pour les overlays de stream) ; ce service surveille ce fichier et republie son
   contenu dans Firestore.

**Si vous avez VirtualDJ Pro Infinity**, son module "Remote" expose une API réseau plus
riche (lecture de volume/position en plus du contrôle) — ce serait une meilleure base
que le pont MIDI, mais sa documentation exacte n'a pas pu être consultée ici. Si vous
confirmez disposer de cette licence, ce service peut être réécrit pour s'y connecter
directement plutôt que de passer par MIDI.

## Installation

1. **Node.js** : installer Node.js LTS sur le poste de diffusion.
2. **loopMIDI** : installer [loopMIDI](https://www.tobias-erichsen.de/software/loopmidi.html)
   et créer un port virtuel (ex. nommé `loopMIDI Port`).
3. **Compte de service Firebase** : dans la console Firebase du projet TeMa, générer
   une clé de compte de service (Paramètres du projet > Comptes de service > Générer
   une nouvelle clé privée), l'enregistrer comme `service-account.json` dans ce dossier.
4. **Configuration** : copier `config.example.json` en `config.json`, ajuster :
   - `midiPortName` : nom exact du port loopMIDI créé.
   - `nowPlayingFilePath` : chemin du fichier "now playing" exporté par VirtualDJ.
   - `midiMapping` : notes/contrôleurs choisis (les valeurs par défaut sont arbitraires,
     à mapper ensuite dans VirtualDJ).
5. **Dépendances** : `npm install` dans ce dossier.
6. **Test manuel** : `npm start` — vérifier dans la console que le service se connecte
   au port MIDI et à Firestore sans erreur.
7. **Mapper les actions dans VirtualDJ** : dans VirtualDJ, ouvrir la fenêtre de mapping
   MIDI, déclencher chaque commande depuis TeMa Media Center une à une, et associer
   la note MIDI reçue à l'action correspondante (Play, Pause, Stop, etc.).
8. **Fichier "Now playing"** : dans VirtualDJ, activer l'export du titre en cours vers
   un fichier texte (souvent sous Options > Recording/Broadcast, ou via un skin/plugin
   dédié selon la version) et pointer `nowPlayingFilePath` vers ce fichier.
9. **Installer comme service Windows** (démarrage automatique) :
   `npm run install-service` depuis une invite **administrateur**.

## Limites connues

- Pas de lecture fiable du **volume réel**, de la **durée** ou du **temps écoulé** sans
  l'API Remote de VirtualDJ Pro Infinity — ces champs resteront approximatifs (déduits
  des commandes envoyées) avec le pont MIDI seul.
- Le mapping MIDI est **unidirectionnel** (TeMa → VirtualDJ) : il ne permet pas de
  savoir si une commande a réellement été exécutée côté VirtualDJ, seulement qu'elle a
  été envoyée. Le champ `etatVirtualDJ` reflète donc l'état du pont MIDI, pas une
  confirmation de VirtualDJ lui-même.
- La programmation automatique des publicités (toutes les 15/20/30/60 min) n'est pas
  encore implémentée dans `index.js` — à ajouter en lisant `media_pub_programmation`
  et en déclenchant `PLAY_ANNOUNCEMENT` à intervalles réguliers.

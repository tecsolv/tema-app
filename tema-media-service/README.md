# TeMa Media Service V1

Lecteur audio local pour boutique. **C'est la seule pièce du système TeMa qui fait
réellement sortir du son.** Le navigateur (TeMa Media Center) n'est qu'un centre de
contrôle : il gère les playlists/pistes et envoie des commandes Firestore — il ne
joue jamais de son lui-même.

⚠️ **Non testé contre une vraie installation VLC/Windows** (pas d'accès à un poste
Windows physique dans l'environnement où ce code a été écrit). À valider et ajuster
sur le poste de diffusion réel.

## Principe

1. Le service lance **VLC** au démarrage avec son interface HTTP officielle
   (`--intf http`) — c'est l'interface de contrôle en ligne de commande native de VLC,
   pas une dépendance tierce.
2. Il écoute `media_commands` (Firestore) filtré par `deviceId`.
3. Pour `SET_PLAYLIST`/`PLAY`/`NEXT`, il résout `media_playlists` → `media_tracks`,
   télécharge le MP3 depuis Firebase Storage dans un cache local (`./cache`), puis
   demande à VLC de le jouer via sa propre file (pas de re-téléchargement si déjà en
   cache).
4. Il publie l'état (`media_state/{deviceId}`) et un battement de présence
   (`media_devices/{deviceId}`) en continu, pour que TeMa Web App affiche le poste
   comme "en ligne" et sache ce qui est en train de jouer.

## Structure

```
/tema-media-service
 ├── index.js          point d'entrée
 ├── firebase.js        connexion Firebase Admin SDK
 ├── player.js           pilotage VLC (HTTP interface)
 ├── queue.js             résolution playlist → pistes, téléchargement Storage
 ├── sync.js              écoute media_commands, publication media_state/media_devices
 ├── config.example.json
 └── logs/
```

## Installation

1. **VLC** : installer VLC Media Player sur le poste de diffusion (la version
   desktop classique, pas le Store) — noter le chemin de `vlc.exe`.
2. **Node.js** : installer Node.js LTS.
3. **Compte de service Firebase** : Console Firebase > Paramètres du projet >
   Comptes de service > Générer une nouvelle clé privée → l'enregistrer comme
   `service-account.json` dans ce dossier.
4. **Configuration** : copier `config.example.json` en `config.json`, renseigner :
   - `deviceId` : identifiant unique du poste (ex. `boutique-principale-pc1`).
   - `vlc.binaryPath` : chemin exact vers `vlc.exe`.
   - `vlc.httpPassword` : mot de passe arbitraire pour l'interface HTTP locale de VLC
     (reste sur la machine, jamais exposé à internet).
5. `npm install`
6. `npm start` — vérifier dans la console que VLC démarre et que le service annonce
   `online` dans Firestore (`media_devices/{deviceId}`).
7. (Optionnel) **Démarrage automatique Windows** : `npm install node-windows --save`
   puis `node install-service.js` depuis une invite **administrateur**.

## Commandes supportées (strictement celles-ci)

`PLAY`, `PAUSE`, `STOP`, `NEXT`, `SET_PLAYLIST` (`params.playlistId`), `SET_VOLUME`
(`params.volume`, 0-100).

## Limites connues

- Une seule file de lecture active à la fois par poste (pas de gestion d'erreur si
  le fichier audio est corrompu au-delà de ce que VLC gère nativement).
- Le cache local n'est jamais purgé automatiquement — prévoir un nettoyage manuel ou
  une rotation si la bibliothèque de pistes devient volumineuse.
- Pas de reprise de téléchargement partiel : un téléchargement interrompu doit être
  effacé manuellement du dossier `cache` pour être retenté.

# Architecture Sessions POS & Suivi RH — TeMa

> Document de conception préalable. **Aucun code n'a été modifié.**
> Objectif : transformer la session globale unique actuelle en sessions
> **caisse + utilisateur**, avec gestion des pauses, suivi RH, exclusivité
> des caisses, journal d'audit et tableaux de bord, **sans casser** le
> fonctionnement existant (ventes, encaissement, tickets, journal, rapport Z,
> clients, stock, comptabilité, admin).

---

## 1. État actuel (rappel synthétique)

| Élément | Aujourd'hui |
|---|---|
| `sessions_caisse` | 1 document "ouverte" maximum, **global** à toute l'app |
| Lien session ↔ caisse physique | ❌ inexistant (aucune notion de "caisse 1/2/3") |
| Lien session ↔ utilisateur | Partiel (`operateur` = nom, mais pas utilisé pour le filtre) |
| Ouverture de session | Action manuelle via écran "Caisse Journalière" |
| Pause / fin de service | ❌ inexistant |
| Suivi RH (heures, présence) | ❌ inexistant |
| Exclusivité caisse | ❌ inexistant |
| Journal d'audit | ❌ inexistant |
| `ventesCaisse.sessionId` | Référence le doc `sessions_caisse` actif (déjà en place) |
| `users` | username, nom, role, passwordHash, isAdmin, status, lastLogin |

---

## 2. Schéma de données proposé

### 2.1 Nouvelle collection `caisses` (postes de caisse physiques)

```js
caisses/{caisseId}
{
  nom: "Caisse 1",                 // libellé affiché
  code: "C1",                      // code court
  statut: "disponible" | "occupee" | "desactivee",
  sessionActiveId: string | null,  // pointeur dénormalisé vers sessions_caisse en cours
  utilisateurActifId: string | null,
  utilisateurActifNom: string | null,
  createdAt, updatedAt
}
```

- Créée/gérée depuis le module **Admin** (CRUD simple, comme `users`).
- `sessionActiveId` est mis à jour à chaque ouverture/fermeture/pause pour
  permettre un **tableau de bord temps réel** sans requête agrégée coûteuse.

### 2.2 Évolution de `sessions_caisse` (ADDITIVE — rien n'est supprimé)

```js
sessions_caisse/{sessionId}
{
  // ── CHAMPS EXISTANTS (conservés tels quels pour compatibilité) ──
  dateOuverture, fondsCaisse, note, operateur,
  statut: "ouverte" | "fermée",     // ← conservé, dérivé automatiquement (voir §4.2)
  totalVentes, nbTickets, totaux, createdAt, dateFermeture, fermeePar,

  // ── NOUVEAUX CHAMPS ──
  caisseId, caisseNom,
  utilisateurId, utilisateurNom,
  dateHeureConnexion,        // = login
  dateHeureDebutSession,     // = début effectif de session (≈ login si auto-démarrage)
  statutSession: "ouverte" | "en_pause" | "fermee",   // état détaillé (3 états)

  pauses: [                  // historique des pauses de ce service
    { debut, fin, dureeMin }
  ],
  pauseEnCours: { debut } | null,

  dateHeureFin,              // = fin de service
  dureeTravailMin,           // fin - début
  dureePauseMin,             // somme des pauses
  dureeEffectiveMin          // dureeTravailMin - dureePauseMin
}
```

**Pourquoi additif ?**
- Les fonctions existantes (`majBadgeSessionPOS`, `renderPOSJournal`,
  `genererRapportZ`, l'incrément `totalVentes/nbTickets/totaux` à
  l'encaissement) lisent/écrivent les champs existants → **elles continuent
  de fonctionner sans modification de leur logique interne**.
- Les anciens documents (créés avant la migration) n'ont simplement pas les
  nouveaux champs → l'UI les affichera avec `"—"` / valeurs par défaut.

### 2.3 Nouvelle collection `audit_caisses` (journal d'audit)

```js
audit_caisses/{auditId}
{
  type: "ouverture" | "fermeture_forcee" | "deconnexion_forcee"
      | "transfert" | "reattribution",
  caisseId, caisseNom,
  utilisateurConcerneId, utilisateurConcerneNom,   // l'employé impacté
  responsableId, responsableNom,                   // Gérant/Admin ayant agi
  ancienUtilisateurId, ancienUtilisateurNom,        // pour transfert
  nouvelUtilisateurId, nouvelUtilisateurNom,        // pour transfert
  sessionId,                                        // session concernée
  motif: string,
  date, heure,
  createdAt
}
```

### 2.4 "Suivi des Présences" — pas de nouvelle collection

Chaque document `sessions_caisse` représente **un service complet** (un
"shift") avec toutes les métriques RH (heures, pauses, ventes, tickets).
=> **Le suivi RH est une simple vue filtrée/agrégée de `sessions_caisse`**,
pas une collection séparée. Cela évite la duplication et les problèmes de
synchronisation.

---

## 3. Nouveau workflow métier

### 3.1 Connexion → sélection caisse → démarrage automatique

```
Écran d'accueil → Connexion (identifiant + mot de passe)
   ↓ seConnecter() — INCHANGÉ (auth, currentUser)
   ↓
Si rôle = Caissier(ère)/Vendeur(se) :
   ↓
   Écran "Sélection de la caisse" (NOUVEAU, avant ouvrirEcranPOS)
     - Liste des `caisses` avec statut temps réel :
         🟢 Disponible / 🔴 Occupée (par qui, depuis quand)
     - L'utilisateur clique une caisse disponible
   ↓
   Vérification exclusivité (voir §3.3)
   ↓
   Création automatique de sessions_caisse :
     statutSession = "ouverte", statut = "ouverte"
     caisseId, caisseNom, utilisateurId, utilisateurNom,
     dateHeureConnexion = dateHeureDebutSession = maintenant
     fondsCaisse = 0 (ou demandé via une mini-modale optionnelle —
                      à valider : conserver la saisie du fonds initial ?)
   ↓
   caisses/{id}.sessionActiveId = sessionId, statut = "occupee"
   ↓
   Badge POS → 🟢 EN SESSION
   ↓
   ouvrirEcranPOS() — INCHANGÉ
```

> ⚠️ **Point à valider avec vous** : le système actuel demande le **fonds de
> caisse initial** à l'ouverture manuelle. Avec le démarrage automatique,
> deux options :
> - (A) Le fonds de caisse reste à 0 et peut être ajusté plus tard par le
>   Gérant (rapide, mais moins rigoureux comptablement) ;
> - (B) Une mini-modale "Fonds de caisse" s'affiche **juste après** la
>   sélection de caisse, avant de basculer vers le POS (1 clic
>   supplémentaire, mais conserve la rigueur actuelle).
> Recommandation : **option B**, car le fonds de caisse initial est central
> pour le Rapport Z existant (`genererRapportZ`).

### 3.2 Pause / Reprise / Fin de service

Ajout de 3 boutons dans la topbar POS (à côté du badge de session) :

| Bouton | Action | Champs mis à jour |
|---|---|---|
| ☕ **Pause** | `statutSession = "en_pause"`<br>`pauseEnCours = {debut: now}` | `statut` reste `"ouverte"` (compat Rapport Z) |
| ▶ **Reprendre** | `pauses.push({debut, fin: now, dureeMin})`<br>`pauseEnCours = null`<br>`statutSession = "ouverte"` | — |
| 🔴 **Fin de service** | `dateHeureFin = now`<br>`dureeTravailMin`, `dureePauseMin`, `dureeEffectiveMin` calculés<br>`statutSession = "fermee"`<br>`statut = "fermée"` (déclenche la même branche que `fermerSessionCaisse` actuel) | `caisses/{id}.sessionActiveId = null`, `statut = "disponible"` |

**Calcul automatique** :
```
dureeTravailMin   = (dateHeureFin - dateHeureDebutSession) en minutes
dureePauseMin     = somme(pauses[].dureeMin)
dureeEffectiveMin = dureeTravailMin - dureePauseMin
```

**Badge POS — 3 états** :
- 🟢 EN SESSION (`statutSession == "ouverte"`)
- 🟡 EN PAUSE (`statutSession == "en_pause"`)
- ⚫ HORS SESSION (`statutSession == "fermee"` ou aucune session)

> ⚠️ **Question métier ouverte** : pendant une pause, le caissier peut-il
> encore encaisser ? Recommandation : **non** — désactiver `#btn-pay` et
> l'ajout au panier tant que `statutSession == "en_pause"`, avec message
> "Reprenez votre session pour encaisser". Cela évite des ventes
> enregistrées "pendant une pause" dans les rapports RH. À valider.

### 3.3 Exclusivité des caisses

Au moment de la sélection de caisse (§3.1), avant création :

```
SI caisses/{id}.sessionActiveId existe ET
   sessions_caisse/{sessionActiveId}.statutSession ∈ ["ouverte","en_pause"]
ALORS
   Afficher :
   ⚠️ Cette caisse est actuellement utilisée par :
       Nom : <utilisateurNom>
       Heure d'ouverture : <dateHeureDebutSession>
       Statut : <En session | En pause>
   Bloquer la création d'une nouvelle session sur cette caisse.

   SI currentUser est Gérant/Admin :
     Afficher en plus 3 actions :
       - "Forcer la fermeture de cette session"
       - "Transférer cette caisse à un autre utilisateur"
       - "Réattribuer (fermer + ouvrir une nouvelle session pour moi)"
     → chacune crée une entrée dans audit_caisses (voir §3.4)
SINON
   Procéder normalement (§3.1)
```

### 3.4 Actions Gérant/Admin (journalisées)

| Action | Effet sur `sessions_caisse` | Entrée `audit_caisses` |
|---|---|---|
| **Forcer fermeture** | `statutSession="fermee"`, `statut="fermée"`, `dateHeureFin=now`, calculs durée, `fermeePar = responsable.label` | `type:"fermeture_forcee"` |
| **Transfert de caisse** | Ferme la session de l'ancien utilisateur (comme ci-dessus) **+** crée une nouvelle session pour le nouvel utilisateur sur la même `caisseId` | `type:"transfert"`, avec `ancienUtilisateurId/Nom` et `nouvelUtilisateurId/Nom` |
| **Réattribution** (à soi-même) | Ferme l'ancienne + ouvre une nouvelle session pour le Gérant/Admin lui-même | `type:"reattribution"` |

Toutes ces actions exigent un **motif** (champ texte obligatoire), enregistré
dans `audit_caisses.motif`.

---

## 4. Compatibilité avec l'existant

### 4.1 Fonctions/écrans qui continuent de fonctionner SANS modification

- `ajouterAuPanier`, `recalcTotal`, `posOuvrirPaiement`, `confirmerPaiement`
  (calcul du panier, encaissement, tickets) — **aucun changement**, ils
  utilisent toujours `posSessionActive?.id` pour `sessionId`.
- `genererRapportZ()` — lit `posSessionActive.dateOuverture`, `.fondsCaisse`,
  `.nbTickets` → tous présents dans le nouveau schéma.
- `renderPOSJournal()` — la logique `posSessionActive ? ... : ...` continue
  de fonctionner ; elle sera **enrichie** (pas remplacée) pour afficher en
  plus caisse/employé/pauses.
- Module Comptabilité, Stock, Clients, Admin — **non impactés**, aucune de
  leurs collections n'est touchée.

### 4.2 Pont de compatibilité `statut` ↔ `statutSession`

Pour ne rien casser dans le filtre existant
`where('statut','==','ouverte')` :

| `statutSession` | `statut` (champ legacy) |
|---|---|
| `"ouverte"` | `"ouverte"` |
| `"en_pause"` | `"ouverte"` *(toujours considérée "ouverte" pour le legacy)* |
| `"fermee"` | `"fermée"` |

Ainsi tout code existant qui ne connaît que `statut` continue de voir le bon
état binaire.

### 4.3 Changement de filtre du listener `u14` (impact identifié)

Le listener actuel :
```js
db.collection('sessions_caisse').where('statut','==','ouverte')
  .orderBy('dateOuverture','desc').limit(1)
```
était **global** (1 seule session pour toute l'app). Avec le nouveau modèle
multi-caisses, ce filtre doit devenir **spécifique à l'utilisateur courant** :
```js
db.collection('sessions_caisse')
  .where('utilisateurId','==', currentUser.id)
  .where('statutSession','in',['ouverte','en_pause'])
  .orderBy('dateHeureDebutSession','desc').limit(1)
```
- Impact : `posSessionActive` représente désormais **la session de
  l'utilisateur connecté**, pas "une session quelconque". C'est en fait plus
  correct et résout l'ambiguïté de la Q7 du diagnostic précédent.
- Reconnexion automatique (`sessionStorage` / `tema_user`) : au lieu de
  recréer une session, on **retrouve** la session ouverte de cet
  utilisateur (si `dateHeureFin` n'est pas renseignée) et on la reprend —
  pas de doublon.

### 4.4 Données historiques

- Les documents `sessions_caisse` créés **avant** la migration n'ont pas
  `caisseId`/`utilisateurId`/`statutSession`/etc.
- Aucune réécriture rétroactive nécessaire : l'UI affichera ces anciens
  enregistrements avec `caisseNom: "—"`, `utilisateurNom: operateur` (repli
  sur le champ existant), et `statutSession` déduit de `statut`
  (`"ouverte"→"ouverte"`, `"fermée"→"fermee"`).
- `ventesCaisse` et `ventes_services` restent strictement identiques.

---

## 5. Nouveaux écrans

### 5.1 "Sélection de caisse" (post-login, caissiers uniquement)

- Grille de cartes, une par `caisses` doc : nom, statut (Disponible/Occupée
  + occupant), clic = tentative d'ouverture de session (§3.1/3.3).

### 5.2 "Suivi des Présences" (Gérant/Admin uniquement)

- Filtres : Employé, Caisse, Jour / Semaine / Mois / Période personnalisée.
- Tableau : Employé · Caisse · Arrivée · Départ · Pause(s) · Temps travaillé
  · Temps effectif · Tickets · CA · Panier moyen.
- Source : requête sur `sessions_caisse` (filtrée par `utilisateurId`,
  `caisseId`, `dateHeureDebutSession` selon les filtres).

### 5.3 Rapports Journalier / Hebdomadaire / Mensuel

- Agrégations côté client (comme `renderPOSStats` existant) sur
  `sessions_caisse` + `ventesCaisse` regroupées par jour/semaine/mois.
- Réutilise les composants graphiques déjà présents (Chart.js déjà chargé).

### 5.4 Exports Excel / PDF

- **Excel** : le projet exporte déjà du CSV (`exportCSV`, voir
  `tema_smart_caisse.html`/online). Pour un vrai `.xlsx` (mise en forme,
  plusieurs feuilles), il faudra soit :
  - (A) continuer en CSV (`.csv`, ouvrable dans Excel, **zéro dépendance**) ;
  - (B) ajouter la librairie **SheetJS (xlsx.js)** en CDN (comme Chart.js /
    html5-qrcode déjà inclus) pour un vrai `.xlsx` multi-feuilles.
  → **Recommandation : (B)**, cohérent avec la demande explicite "Export
  Excel", impact = 1 ligne `<script src=...>` supplémentaire, aucun risque
  de régression.
- **PDF** : réutiliser le pattern déjà en place pour le Guide Utilisateur et
  le Rapport Z (`window.print()` + CSS `@media print` dédiée).

### 5.5 Tableau de bord Gérant (caisses + RH)

- Vue temps réel `caisses` (jointure dénormalisée
  `sessionActiveId`/`utilisateurActifNom`/`statut`) :
  ```
  CAISSE 1 → Marie  → 🟢 En session
  CAISSE 2 → Jean   → 🟡 En pause
  CAISSE 3 → —      → ⚪ Disponible
  CAISSE 4 → —      → ⚪ Disponible
  ```
- Widgets : Top vendeurs, Retards (heure d'arrivée vs heure d'ouverture
  prévue — **nécessite de définir des horaires planifiés**, actuellement
  absents du modèle `users` → à discuter si requis), Absences, Temps de
  présence cumulé, Performance par caisse / par employé (CA, nb tickets,
  panier moyen — calculables depuis `sessions_caisse`+`ventesCaisse`).

---

## 6. Index Firestore nécessaires

| Collection | Index composite | Usage |
|---|---|---|
| `sessions_caisse` | `utilisateurId` ASC + `statutSession` ASC + `dateHeureDebutSession` DESC | Reprise de session au login |
| `sessions_caisse` | `caisseId` ASC + `statutSession` ASC | Vérification exclusivité caisse |
| `sessions_caisse` | `statutSession` ASC + `dateHeureDebutSession` DESC | Tableau de bord temps réel |
| `sessions_caisse` | `dateHeureDebutSession` ASC/DESC (range) + `caisseId`/`utilisateurId` | Filtres Suivi RH (jour/semaine/mois/période) |
| `audit_caisses` | `caisseId` ASC + `date` DESC | Historique par caisse |
| `audit_caisses` | `utilisateurConcerneId` ASC + `date` DESC | Historique par employé |
| `caisses` | (aucun composite requis — petite collection, lecture complète) | Tableau de bord |

> ⚠️ Le diagnostic précédent a déjà identifié une erreur d'index manquant sur
> `sessions_caisse(statut, dateOuverture)`. **Cet index doit être créé
> indépendamment** de cette évolution (sinon même le système actuel reste
> bloqué). La migration en profitera pour le remplacer par les index
> ci-dessus.

---

## 7. Plan de migration (étapes, sans interruption de service)

1. **Pré-requis** : créer l'index Firestore manquant sur `sessions_caisse`
   (corrige le bug actuel "Hors session" indépendamment de cette évolution).
2. **Étape 1 — Données de référence** : créer la collection `caisses` +
   écran Admin "Gestion des caisses" (CRUD : nom, code). Aucune session
   existante n'est touchée.
3. **Étape 2 — Champs additifs** : déployer le code qui **écrit** les
   nouveaux champs (`caisseId`, `utilisateurId`, `statutSession`, `pauses`,
   etc.) sur les **nouvelles** sessions, tout en maintenant `statut` en
   parallèle (pont §4.2). Les anciennes sessions ne sont pas réécrites.
4. **Étape 3 — Écran de sélection de caisse** : activé pour les caissiers ;
   bascule du démarrage manuel vers le démarrage automatique.
5. **Étape 4 — Pause/Reprise/Fin de service** : nouveaux boutons + badge
   3 états.
6. **Étape 5 — Exclusivité + audit** : contrôles de blocage + actions
   Gérant/Admin + collection `audit_caisses`.
7. **Étape 6 — Écrans de suivi** : Suivi des Présences, Rapports
   J/S/M, Exports Excel/PDF, Tableau de bord caisses.
8. **Rollback** : à chaque étape, le pont `statut`/`statutSession` permet de
   revenir en arrière sans perte de données — aucune étape ne supprime ou
   ne renomme de champ existant.

---

## 8. Risques identifiés

| Risque | Mitigation |
|---|---|
| Sessions "orphelines" si l'utilisateur ferme l'onglet sans cliquer "Fin de service" | Reprise automatique de la session existante à la reconnexion (§4.3) ; le Gérant peut forcer la fermeture (§3.4) |
| Index Firestore manquants → listeners silencieusement en échec (`console.error`) | Lister tous les index requis (§6) et les créer **avant** déploiement ; ajouter un toast visible en cas d'échec de listener critique |
| Double-session si deux onglets du même utilisateur | La requête de reprise (`utilisateurId` + `statutSession in [ouverte,en_pause]`) retourne la session existante au lieu d'en créer une nouvelle |
| Décision non tranchée : fonds de caisse à l'ouverture auto (option A/B §3.1) | À valider avant implémentation — impacte le Rapport Z |
| Décision non tranchée : encaissement autorisé pendant une pause ? (§3.2) | À valider — recommandation : non autorisé |
| "Retards"/horaires planifiés (tableau de bord §5.5) nécessitent un champ "horaire prévu" absent de `users` | À discuter : ajouter `horairePrevu` optionnel dans `users`, ou retirer ce widget de la v1 |
| Export Excel `.xlsx` réel nécessite une nouvelle dépendance (SheetJS) | Risque faible (CDN, comme Chart.js) ; alternative CSV sans dépendance si préféré |

---

## 9. Recommandations techniques

1. Créer d'abord l'index Firestore manquant (corrige le bug actuel,
   indépendant de cette évolution).
2. Implémenter par étapes selon le plan §7, chaque étape étant testable et
   non bloquante pour les précédentes.
3. Trancher les 3 points ouverts (§3.1 fonds de caisse, §3.2 encaissement
   pendant pause, §5.5 horaires planifiés) avant de coder les écrans
   correspondants.
4. Conserver `posSessionActive` comme nom de variable (minimise le diff),
   en changeant uniquement la requête qui l'alimente (§4.3).
5. Pour les exports, ajouter SheetJS (xlsx.js) via CDN pour un Excel natif
   multi-feuilles (Présences, Ventes, Sessions).

---

## 10. Validation requise avant codage

Merci de confirmer :
- [ ] Schéma de données proposé (§2) — collections `caisses`,
      `sessions_caisse` (champs additifs), `audit_caisses`
- [ ] Pont de compatibilité `statut`/`statutSession` (§4.2)
- [ ] Option fonds de caisse : (A) à 0 par défaut ou (B) mini-modale à la
      sélection de caisse
- [ ] Encaissement bloqué pendant une pause : oui / non
- [ ] Export Excel via SheetJS (CDN) vs CSV existant
- [ ] Plan de migration en 6 étapes (§7) — ordre et découpage acceptables ?

Une fois ces points validés, l'implémentation pourra démarrer étape par
étape, avec vérification de non-régression à chaque étape (vente,
encaissement, tickets, journal, rapport Z, clients, stock, comptabilité,
admin).

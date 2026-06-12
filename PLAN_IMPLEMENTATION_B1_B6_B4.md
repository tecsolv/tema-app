# PLAN D'IMPLÉMENTATION — B1 / B6 / B4 (Priorité 2)

**Statut** : document d'analyse uniquement. **Aucune ligne de code n'a été modifiée, aucun fichier synchronisé.**
**Objectif** : décrire précisément, avant tout développement, l'architecture cible, le pseudo-code, les risques et le plan de test pour B1 (transactionnalisation sessions/caisses), B6 (nettoyage champ legacy `statut`) et B4 (`sessionId` manquant sur ventes ERP Mobile Money/Services).

---

# B1 — TRANSACTIONNALISATION DES ÉCRITURES SESSIONS/CAISSES

## 1. Architecture actuelle

Trois fonctions effectuent des écritures séquentielles **non liées par une transaction Firestore unique** sur les collections `sessions_caisse` et `caisses` :

### 1.1 `posFinService()` ([5127-5155](tema_boutique_online.html:5127))
```
await sessions_caisse/{session.id}.update({ statut, statutSession:'fermee', dateFermeture, ... durées })   // écriture 1
await caisses/{session.caisseId}.update({ statut:'disponible', sessionActiveId:null, ... })                  // écriture 2
```
→ 2 écritures séquentielles, 2 documents, aucune lecture préalable.

### 1.2 `demarrerNouvelleSessionSurCaisse(c, userId, userNom, note)` ([5422-5433](tema_boutique_online.html:5422))
```
await sessions_caisse/{nouveau-id}.set({ statut:'ouverte', statutSession:'ouverte', ... })  // écriture 1
await caisses/{c.id}.update({ statut:'occupee', sessionActiveId:nouveau-id, ... })          // écriture 2
```
→ 2 écritures séquentielles, 2 documents, aucune lecture préalable. **Appelée uniquement depuis `confirmerActionAudit()`** (grep confirmé : aucun autre appelant).

### 1.3 `confirmerActionAudit()` ([5369-5420](tema_boutique_online.html:5369))
Séquence complète pour `transfert`/`réattribution` :
```
sessionSnap = await sessions_caisse/{sessionId}.get()                          // lecture 1
await sessions_caisse/{sessionId}.update({ statut:'fermée', statutSession:'fermee', ... })  // écriture 1
await demarrerNouvelleSessionSurCaisse(...)                                     // écritures 2 + 3 (set + update, cf. 1.2)
await consignerAuditCaisse(...)                                                 // écriture 4 (audit_caisses)
```
Pour `fermeture forcée` (else) :
```
sessionSnap = await sessions_caisse/{sessionId}.get()                          // lecture 1
await sessions_caisse/{sessionId}.update({ statut:'fermée', statutSession:'fermee', ... })  // écriture 1
await caisses/{c.id}.update({ statut:'disponible', sessionActiveId:null, ... })  // écriture 2
await consignerAuditCaisse(...)                                                 // écriture 3 (audit_caisses)
```

**Problème** : entre l'écriture 1 (fermeture de l'ancienne session) et l'écriture 2/3 (libération ou réattribution de `caisses`), une coupure réseau/onglet laisse `caisses.sessionActiveId` pointer vers une session déjà `statutSession:'fermee'` — état incohérent visible dans le module Présences (`renderTableauBordCaisses`).

### 1.4 Hors périmètre B1 (confirmé, ne touchent pas `caisses`)
- `confirmerDemarrageSession()` ([5058-5098](tema_boutique_online.html:5058)) — **déjà transactionnel**, référence/modèle à suivre, **non modifié**.
- `ouvrirSessionCaisse()` / `fermerSessionCaisse()` ([5451-5489](tema_boutique_online.html:5451)) — sessions manuelles sans `caisseId` (Gérant/Admin), n'écrivent jamais dans `caisses`. **Hors périmètre B1** (rien à transactionnaliser, pas de 2e document).

---

## 2. Architecture cible

| Fonction | Transaction Firestore | Documents impliqués |
|---|---|---|
| `posFinService()` | 1 transaction | `sessions_caisse/{id}` (lecture + écriture) + `caisses/{caisseId}` (lecture + écriture) |
| `confirmerActionAudit()` — cas `fermeture forcée` | 1 transaction | `sessions_caisse/{ancienId}` (lecture + écriture) + `caisses/{c.id}` (lecture + écriture) |
| `confirmerActionAudit()` — cas `transfert`/`réattribution` | 1 transaction | `sessions_caisse/{ancienId}` (lecture + écriture) + `sessions_caisse/{nouveauId}` (création) + `caisses/{c.id}` (lecture + écriture) |
| `demarrerNouvelleSessionSurCaisse()` | **supprimée comme fonction autonome**, sa logique est **inlinée** dans la transaction de `confirmerActionAudit()` (seul appelant) | — |
| `consignerAuditCaisse()` / `consigner()` | **hors transaction**, exécutés **après** le succès de la transaction principale | `audit_caisses`, `journal` |

**Principe directeur** : une transaction Firestore = "tout ou rien" sur l'état métier (`sessions_caisse` + `caisses`). Les écritures de **journalisation** (`audit_caisses`, `journal`) restent hors transaction car ce sont des logs, pas de l'état — leur échec isolé ne doit pas annuler le changement d'état déjà validé (cohérent avec le principe non-bloquant déjà retenu pour `audit_actions` en v1.2).

---

## 3. Fonctions à modifier — ordre exact

1. **`posFinService()`** — la plus simple (2 documents, pas de branche conditionnelle complexe) → **à traiter en premier**, sert de validation du pattern.
2. **`confirmerActionAudit()`** + suppression de `demarrerNouvelleSessionSurCaisse()` comme fonction séparée (logique inlinée) → traité en second, réutilise le pattern validé à l'étape 1.
3. **B6** (suppression du champ legacy `statut`) — appliqué **dans la même passe** que les 2 fonctions ci-dessus (puisque ce sont les mêmes lignes de code), plus 4 autres emplacements indépendants (cf. section B6).

**Aucune autre fonction n'est modifiée.** `confirmerDemarrageSession()`, `posPause()`, `posReprendre()`, `ouvrirSessionCaisse()`, `fermerSessionCaisse()`, `renderTableauBordCaisses()`, `renderSuiviPresencesTable()`, `renderAuditCaissesTable()`, `majBadgeSessionPOS()` : **non touchées**.

---

## 4. Pseudo-code complet

### 4.1 `posFinService()` — cible

```javascript
async function posFinService() {
  if (!posSessionActive || !posSessionActive.caisseId) return;
  if (!confirm('Terminer votre service ? Cette action clôture votre session sur cette caisse.')) return;
  const session = posSessionActive;
  const fin = posDateHeure(), finTS = Date.now();

  // calcul des durées (INCHANGÉ par rapport au code actuel)
  let pauses = session.pauses || [];
  if (session.pauseEnCours) {
    const p = session.pauseEnCours;
    const dureeMin = Math.max(0, Math.round((finTS - (p.debutTS || finTS)) / 60000));
    pauses = [...pauses, { debut: p.debut, fin, dureeMin }];
  }
  const debutTS = session.dateHeureDebutSessionTS || finTS;
  const dureeTravailMin = Math.max(0, Math.round((finTS - debutTS) / 60000));
  const dureePauseMin = pauses.reduce((s,p) => s + (p.dureeMin||0), 0);
  const dureeEffectiveMin = Math.max(0, dureeTravailMin - dureePauseMin);

  const sessionRef = db.collection('sessions_caisse').doc(session.id);
  const caisseRef = db.collection('caisses').doc(session.caisseId);

  try {
    await db.runTransaction(async (tx) => {
      // LECTURES (avant toute écriture, requis par l'API Firestore)
      const sessionSnap = await tx.get(sessionRef);
      const caisseSnap = await tx.get(caisseRef);

      const sData = sessionSnap.data() || {};
      // garde défensive : si la session est déjà fermée (ex: fermée entre-temps
      // par un Gérant via confirmerActionAudit), ne pas la re-fermer / re-calculer
      if (sData.statutSession === 'fermee') {
        throw new Error('SESSION_DEJA_FERMEE');
      }

      // ÉCRITURES
      tx.update(sessionRef, {
        statutSession: 'fermee', dateFermeture: fin, fermeePar: currentUser?.label || '—',
        dateHeureFin: fin, dateHeureFinTS: finTS, pauses, pauseEnCours: null,
        dureeTravailMin, dureePauseMin, dureeEffectiveMin
        // statut: 'fermée'  ← SUPPRIMÉ (B6)
      });

      // garde défensive : ne libérer la caisse que si elle référence bien CETTE session
      const cData = caisseSnap.data() || {};
      if (cData.sessionActiveId === session.id) {
        tx.update(caisseRef, { statut: 'disponible', sessionActiveId: null, utilisateurActifId: null, utilisateurActifNom: null });
      }
      // si cData.sessionActiveId !== session.id : la caisse a déjà été réattribuée
      // par un Gérant (confirmerActionAudit) -> ne pas écraser son nouvel état
    });

    // hors transaction : journalisation (best-effort, non-bloquant)
    consigner('Fin de service', `${currentUser.label} a terminé son service sur ${session.caisseNom||'—'} (travail: ${dureeTravailMin}min, pause: ${dureePauseMin}min, effectif: ${dureeEffectiveMin}min)`);

    posSessionActive = null;
    showToast('Service terminé ✓ — Rapport Z disponible dans Caisse Journalière');
    goScreen('screen-select-caisse');
    renderSelectCaisseGrid();
  } catch(err) {
    if (err.message === 'SESSION_DEJA_FERMEE') {
      // la session a déjà été clôturée par un Gérant (fermeture forcée) entre-temps
      posSessionActive = null;
      showToast('Votre session a déjà été clôturée par un Gérant/Admin', 'error');
      goScreen('screen-select-caisse');
      renderSelectCaisseGrid();
    } else {
      showToast('Erreur : '+err.message,'error');
    }
  }
}
```

**Lectures dans la transaction** : `sessions_caisse/{session.id}`, `caisses/{session.caisseId}` (2 lectures).
**Écritures dans la transaction** : `sessions_caisse/{session.id}.update(...)`, `caisses/{session.caisseId}.update(...)` (conditionnelle — 1 à 2 écritures).
**Hors transaction** : `consigner()` (collection `journal`).

---

### 4.2 `confirmerActionAudit()` — cible (avec `demarrerNouvelleSessionSurCaisse` inlinée)

```javascript
async function confirmerActionAudit() {
  const action = auditActionEnCours;
  if (!action) return;
  const motif = document.getElementById('audit-motif').value.trim();
  if (!motif) { showToast('Le motif est obligatoire','error'); return; }
  const c = action.caisse;
  const sessionId = c.sessionActiveId;
  if (!sessionId) { showToast('Aucune session active sur cette caisse','error'); closePosModal('modal-audit-caisse'); return; }

  // Validation AVANT transaction (ne dépend pas de l'état Firestore)
  let newUserId = null, newUserNom = null;
  if (action.type === 'transfert') {
    const sel = document.getElementById('audit-nouvel-utilisateur');
    newUserId = sel.value;
    newUserNom = sel.options[sel.selectedIndex]?.dataset.nom;
    if (!newUserId) { showToast('Sélectionnez un utilisateur','error'); return; }
  } else if (action.type === 'reattribution') {
    newUserId = currentUser.id;
    newUserNom = currentUser.label;
  }

  const sessionRef = db.collection('sessions_caisse').doc(sessionId);
  const caisseRef = db.collection('caisses').doc(c.id);
  const fin = posDateHeure(), finTS = Date.now();

  // Pré-génération de l'ID de la nouvelle session (transfert/réattribution)
  const newSessionRef = (action.type === 'transfert' || action.type === 'reattribution')
    ? db.collection('sessions_caisse').doc()
    : null;

  let sessionDataPourAudit = null;

  try {
    await db.runTransaction(async (tx) => {
      // LECTURES
      const sessionSnap = await tx.get(sessionRef);
      const session = sessionSnap.data() || {};
      sessionDataPourAudit = session;

      // calcul des durées (INCHANGÉ)
      let pauses = session.pauses || [];
      if (session.pauseEnCours) {
        const p = session.pauseEnCours;
        const dureeMin = Math.max(0, Math.round((finTS - (p.debutTS || finTS)) / 60000));
        pauses = [...pauses, { debut: p.debut, fin, dureeMin }];
      }
      const debutTS = session.dateHeureDebutSessionTS || finTS;
      const dureeTravailMin = Math.max(0, Math.round((finTS - debutTS) / 60000));
      const dureePauseMin = pauses.reduce((s,p) => s + (p.dureeMin||0), 0);
      const dureeEffectiveMin = Math.max(0, dureeTravailMin - dureePauseMin);

      // ÉCRITURE 1 : fermeture de l'ancienne session
      tx.update(sessionRef, {
        statutSession: 'fermee', dateHeureFin: fin, dateHeureFinTS: finTS,
        fermeePar: currentUser.label + ' (action ' + action.type + ')',
        pauses, pauseEnCours: null,
        dureeTravailMin, dureePauseMin, dureeEffectiveMin
        // statut: 'fermée'  ← SUPPRIMÉ (B6)
      });

      if (action.type === 'transfert' || action.type === 'reattribution') {
        const now = posDateHeure(), nowTS = Date.now();
        // ÉCRITURE 2 : création de la nouvelle session (logique ex-demarrerNouvelleSessionSurCaisse)
        tx.set(newSessionRef, {
          dateOuverture: now, fondsCaisse: 0,
          note: action.type === 'transfert' ? 'Transfert de caisse' : 'Réattribution de caisse',
          operateur: newUserNom, totalVentes: 0, nbTickets: 0, totaux: {},
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          caisseId: c.id, caisseNom: c.nom, utilisateurId: newUserId, utilisateurNom: newUserNom,
          dateHeureConnexion: now, dateHeureDebutSession: now, dateHeureDebutSessionTS: nowTS,
          statutSession: 'ouverte', pauses: [], pauseEnCours: null
          // statut: 'ouverte'  ← SUPPRIMÉ (B6)
        });
        // ÉCRITURE 3 : mise à jour de la caisse vers la nouvelle session
        tx.update(caisseRef, {
          statut: 'occupee', sessionActiveId: newSessionRef.id,
          utilisateurActifId: newUserId, utilisateurActifNom: newUserNom
        });
      } else {
        // ÉCRITURE 2 : libération de la caisse (fermeture forcée)
        tx.update(caisseRef, { statut: 'disponible', sessionActiveId: null, utilisateurActifId: null, utilisateurActifNom: null });
      }
    });

    // hors transaction : journalisation (best-effort)
    if (action.type === 'transfert') {
      await consignerAuditCaisse('transfert', c, sessionDataPourAudit, motif, {
        ancienUtilisateurId: sessionDataPourAudit.utilisateurId, ancienUtilisateurNom: sessionDataPourAudit.utilisateurNom,
        nouvelUtilisateurId: newUserId, nouvelUtilisateurNom: newUserNom
      });
      showToast('Caisse transférée à ' + newUserNom + ' ✓');
    } else if (action.type === 'reattribution') {
      await consignerAuditCaisse('reattribution', c, sessionDataPourAudit, motif, {
        ancienUtilisateurId: sessionDataPourAudit.utilisateurId, ancienUtilisateurNom: sessionDataPourAudit.utilisateurNom,
        nouvelUtilisateurId: newUserId, nouvelUtilisateurNom: newUserNom
      });
      showToast('Caisse réattribuée ✓');
    } else {
      await consignerAuditCaisse(action.type, c, sessionDataPourAudit, motif);
      showToast('Session fermée de force ✓');
    }
    consigner('Audit caisse', `${currentUser.label} a effectué "${action.type}" sur ${c.nom} (motif: ${motif})`);
    closePosModal('modal-audit-caisse');
  } catch(err) {
    showToast('Erreur : '+err.message,'error');
  }
}
```

**Lectures dans la transaction** : `sessions_caisse/{sessionId}` (1 lecture — `caisseRef` n'a pas besoin d'être lu car son contenu n'influence pas les écritures, contrairement à `posFinService` qui doit vérifier `sessionActiveId`).
**Écritures dans la transaction** :
- Cas `transfert`/`réattribution` : 3 écritures (`sessions_caisse/{ancienId}.update`, `sessions_caisse/{nouveauId}.set`, `caisses/{c.id}.update`)
- Cas `fermeture forcée` : 2 écritures (`sessions_caisse/{ancienId}.update`, `caisses/{c.id}.update`)
**Hors transaction** : `consignerAuditCaisse()` (collection `audit_caisses`), `consigner()` (collection `journal`).

> Remarque sur `caisseRef` non lu dans `confirmerActionAudit` : cette fonction est déclenchée **par un Gérant/Admin** depuis le module Présences sur une caisse dont il vient de consulter l'état (`sessionActiveId === sessionId` est garanti par construction de l'écran, `c` provient de `caisses` en mémoire à jour via listener temps réel). Il n'y a pas de garde symétrique à celle de `posFinService` à ajouter ici, car **c'est précisément cette fonction qui a autorité pour réécrire `caisses`** (c'est l'action Gérant/Admin elle-même). Si une analyse plus poussée souhaite une garde supplémentaire (ex: `caisseSnap.data().sessionActiveId === sessionId` avant d'écraser), elle peut être ajoutée par lecture additionnelle — **à valider si jugé utile**, non bloquant pour la livraison.

---

## 5. Risques de deadlock

Firestore `runTransaction()` ne produit **pas de deadlock classique** (pas de verrous explicites posés par le client). Le mécanisme est **optimistic concurrency control + retry automatique** (jusqu'à 5 tentatives par défaut) :
- Si un document lu dans la transaction est modifié par un autre client entre la lecture et la validation, Firestore **rejoue automatiquement** la fonction de transaction.
- Après 5 échecs consécutifs, la transaction est rejetée et `runTransaction()` rejette sa promesse → `catch(err)` dans notre code, toast d'erreur affiché.

**Risque résiduel** : si deux transactions s'écrivent mutuellement en boucle (A modifie ce que B lit, et vice-versa, en continu), on pourrait observer plusieurs retries consécutifs — scénario extrêmement improbable ici car :
- `posFinService()` est déclenché par **le caissier propriétaire de la session** (1 seul utilisateur par session par construction du Multi-Caisses).
- `confirmerActionAudit()` est déclenché par **un Gérant/Admin**, action ponctuelle et rare (pas de boucle).

→ **Risque de deadlock : négligeable.** Le seul cas réaliste de retry est la collision décrite en section 6 (Test 6).

---

## 6. Risques de conflit concurrent

| Scénario | Avant (code actuel) | Après (transactionnel) |
|---|---|---|
| Caissier clique "Fin de service" **exactement** au moment où un Gérant force la fermeture de la même session via `confirmerActionAudit` | Risque réel : les 2 séquences de 2 écritures peuvent s'entrelacer → `caisses.sessionActiveId` peut finir par pointer vers une session déjà fermée, ou la nouvelle session du Gérant peut être écrasée par la libération du caissier | **Protégé** : `posFinService` lit `sessionSnap` en transaction ; si `statutSession === 'fermee'` (déjà fermée par le Gérant), elle lève `SESSION_DEJA_FERMEE` et n'écrit rien — Firestore garantit qu'une seule des deux transactions "gagne" la course, l'autre voit l'état déjà mis à jour au retry |
| Gérant clique 2 fois rapidement sur "Forcer fermeture" (double-clic UI) | Risque : 2 exécutions de `confirmerActionAudit` créeraient potentiellement 2 nouvelles sessions (2× `demarrerNouvelleSessionSurCaisse`) | **Mitigation recommandée (hors périmètre strict B1 mais à considérer)** : désactiver le bouton de confirmation pendant l'exécution (`btn.disabled = true`), pattern déjà utilisé dans `confirmerVente()` (`btn-confirm-pay`). Sans cette désactivation, la 2e exécution créerait une 2e session sur la même caisse — la transaction ne l'empêche pas structurellement car elle porte sur des `newSessionRef` différents à chaque appel. **Recommandation : ajouter la désactivation du bouton de confirmation de la modale `modal-audit-caisse` pendant l'exécution, en plus de la transactionnalisation.** |
| Vente en cours (`confirmerVente`, écrit `sessions_caisse.totalVentes` via `increment`) pendant que `posFinService` clôture la session | `confirmerVente` utilise `db.batch()` (non transactionnel) avec `FieldValue.increment()` — un incrément qui arrive **après** la clôture de session serait appliqué sur un document déjà `statutSession:'fermee'`, faussant le Rapport Z déjà généré | **Non resolu par B1** (hors périmètre — `confirmerVente` n'est pas dans la liste des fonctions à modifier). Risque préexistant, non aggravé par B1. **Mitigation possible future (V2)** : désactiver le bouton "Fin de service" si une vente est en cours de validation — non spécifié dans le plan v1.2, à signaler comme amélioration V2 potentielle. |

---

## 7. Plan de rollback

**Rollback applicatif (transactions elles-mêmes)** : aucun rollback manuel nécessaire — `db.runTransaction()` est atomique par construction. En cas d'erreur (réseau, conflit après 5 retries, garde `SESSION_DEJA_FERMEE`), **aucune écriture n'est appliquée** ; l'état Firestore reste strictement identique à avant l'appel.

**Rollback de déploiement (code)** :
1. Avant déploiement : conserver une copie de `tema_boutique_online.html` actuel (post-Priorité 1, déjà audité) sous un nom horodaté (ex: `tema_boutique_online.PRE-B1B6B4.html`) — copie locale, pas de commit/sync.
2. Si une anomalie est détectée après déploiement (ex: blocage du module Présences) : revenir à la copie de sauvegarde et re-synchroniser `deploy-vercel/index.html` depuis celle-ci.
3. **Aucune migration de données n'est requise par B1** (les transactions écrivent les mêmes champs `statutSession`, `dateHeureFin`, etc. que le code actuel — seul le **mécanisme** d'écriture change, pas le **schéma** des documents, à l'exception du retrait de `statut` traité en B6). Un rollback de code seul suffit, sans script de réparation de données.
4. **Documents en état transitoire au moment du rollback** : si un déploiement est interrompu *pendant* qu'une transaction est en cours côté client, Firestore garantit qu'elle s'est soit appliquée intégralement, soit pas du tout — aucun document "à moitié écrit" possible. Aucune réparation de données nécessaire même en cas de rollback en plein trafic.

---

# B6 — NETTOYAGE DU CHAMP LEGACY `sessions_caisse.statut`

## Les 6 emplacements exacts (grep exhaustif, mise à jour par rapport à l'audit précédent)

| # | Fonction | Ligne | Valeur écrite | Type d'écriture |
|---|---|---|---|---|
| 1 | `confirmerDemarrageSession()` | [5072](tema_boutique_online.html:5072) | `statut: 'ouverte'` | `tx.set()` (déjà transactionnel) |
| 2 | `demarrerNouvelleSessionSurCaisse()` (→ inlinée en 4.2) | [5427](tema_boutique_online.html:5427) | `statut: 'ouverte'` | `.set()` → `tx.set()` |
| 3 | `posFinService()` | [5144](tema_boutique_online.html:5144) | `statut: 'fermée'` | `.update()` → `tx.update()` |
| 4 | `confirmerActionAudit()` | [5395](tema_boutique_online.html:5395) | `statut: 'fermée'` | `.update()` → `tx.update()` |
| 5 | `fermerSessionCaisse()` | [5483](tema_boutique_online.html:5483) | `statut:'fermée'` | `.update()` (hors périmètre B1, session manuelle sans `caisseId`) |
| 6 | `ouvrirSessionCaisse()` | [5457](tema_boutique_online.html:5457) | `statut:'ouverte'` | `.add()` (hors périmètre B1, session manuelle sans `caisseId`) |

> **Correction par rapport au rapport d'audit précédent** : seuls les emplacements #1 à #4 étaient mentionnés. La relecture pour ce plan a identifié **2 emplacements additionnels** (#5 `fermerSessionCaisse()`, #6 `ouvrirSessionCaisse()`) — ces 2 fonctions gèrent les sessions manuelles Gérant/Admin (`caisseId: null`, hors Multi-Caisses) et écrivent aussi le champ legacy `statut`. Elles sont **hors périmètre B1** (pas de document `caisses` à transactionnaliser) mais **dans le périmètre B6** (même champ mort à retirer).

## Confirmation : 0 lecture

Grep exhaustif de `.statut` sur `sessions_caisse` (toutes occurrences de `.statut` dans le fichier passées en revue) : **aucune lecture** de `sessions_caisse.statut`. Les seules lectures de `.statut` portent sur :
- `caisses.statut` (`'occupee'`/`'disponible'`) — champ actif, **non concerné par B6**
- `rapprochements.statut` — module Trésorerie, collection différente, **sans rapport**

## Stratégie de suppression

**Action** : retirer la clé `statut: '...'` de chacun des 6 objets passés à `.set()`/`.update()`/`.add()`/`tx.set()`/`tx.update()` aux emplacements listés ci-dessus.

- Pour les emplacements `.update()`/`tx.update()` (#3, #4, #5) : ne plus inclure `statut` dans l'objet de mise à jour → Firestore **ne touche pas** au champ existant sur le document (il reste tel qu'il était avant, avec son ancienne valeur `'ouverte'`/`'fermée'`).
- Pour les emplacements `.set()`/`tx.set()`/`.add()` (#1, #2, #6) : ne plus inclure `statut` dans le document créé → les **nouveaux documents** n'auront simplement pas ce champ.

**Aucune opération de suppression explicite** (`FieldValue.delete()`) n'est nécessaire ni recommandée : le champ étant mort en lecture, sa présence résiduelle sur les anciens documents est inoffensive.

## Impacts sur les données historiques

- **Aucun impact** : les documents `sessions_caisse` créés avant ce changement conservent leur champ `statut` (valeur `'ouverte'` ou `'fermée'`, avec accent) indéfiniment — ce sont des données figées, non lues, sans effet sur l'application.
- Les **nouveaux documents** (créés après déploiement) n'auront pas de champ `statut` du tout. Si un export/rapport futur listait par erreur tous les champs bruts d'un document `sessions_caisse` (ex: vue de debug Admin), il afficherait `statut` pour les anciens documents et rien pour les nouveaux — **incohérence purement cosmétique**, sans impact fonctionnel, car aucun code de production ne lit ce champ.
- **Aucune migration de données (script de nettoyage rétroactif) n'est nécessaire ni recommandée** — conforme au principe "additif, non destructif" : on ne touche pas aux documents existants.

---

# B4 — `sessionId` MANQUANT SUR VENTES MOBILE MONEY/SERVICES (ERP)

## Les 2 emplacements exacts

### Emplacement 1 — `enregistrerTransactionMM()` ([7079-7113](tema_boutique_online.html:7079))

Écriture dans `ventesCaisse` (ligne 7097-7106) :
```javascript
await db.collection('ventesCaisse').add({
  date: data.date, heure, zone: 'MM',
  article: `Commission ${MM_TYPE_LABELS[type]||type} — ${reseau}`,
  quantite: 1, prixUnitaire: commission, montant: commission,
  modePaiement: reseau, client: data.client,
  note: `Réf: ${data.reference || '—'} | Montant opérat.: ${FCFA(montant)}`,
  source: 'mobile_money',
  createdBy: currentUser.label,
  createdAt: firebase.firestore.FieldValue.serverTimestamp()
  // sessionId: ABSENT ← à ajouter
});
```

### Emplacement 2 — `enregistrerVenteService()` ([7289-7324](tema_boutique_online.html:7289))

Écriture dans `ventesCaisse` (ligne 7310-7318) :
```javascript
await db.collection('ventesCaisse').add({
  date: data.date, heure, zone: 'SVC',
  article: `${s.emoji} ${s.label}`,
  quantite: qte, prixUnitaire: prix, montant,
  modePaiement: mode, client: data.client,
  note: `Service numérique`, source: 'service',
  createdBy: currentUser.label,
  createdAt: firebase.firestore.FieldValue.serverTimestamp()
  // sessionId: ABSENT ← à ajouter
});
```

## Source exacte du `sessionId`

**Identique au pattern Digital déjà existant** (lignes ~3727/3826, confirmé dans l'audit initial) :
```javascript
sessionId: posSessionActive?.id || null
```
- `posSessionActive` est la variable globale définie en [3189](tema_boutique_online.html:3189), maintenue par le listener temps réel `u14` ([4170-4178](tema_boutique_online.html:4170)).
- **Aucune nouvelle source de données** — réutilisation de la variable globale existante, déjà disponible dans le contexte de toute fonction appelée depuis l'écran ERP.

## Comportement si aucune session active n'existe

Cas typique : un Gérant/Admin/Comptable enregistre une transaction Mobile Money ou un service depuis l'écran ERP **sans avoir ouvert de session de caisse** (`posSessionActive === null`, ce qui est le cas normal pour ces rôles qui n'utilisent pas le Multi-Caisses).

→ `posSessionActive?.id || null` retourne **`null`**. Le document `ventesCaisse` créé aura `sessionId: null`.

**Impact sur `genererRapportZ()`** ([5529-5549](tema_boutique_online.html:5529)) :
```javascript
const ventesSession = ventesCaisse.filter(v => v.sessionId === posSessionActive.id);
```
- Un document avec `sessionId: null` ne correspond **jamais** à `posSessionActive.id` (qui est toujours une chaîne non vide pour une session de caisse réelle) → ces ventes ERP **n'apparaissent pas** dans le Rapport Z d'un caissier. **C'est le comportement correct et attendu** : une transaction Mobile Money saisie par un Gérant depuis l'ERP n'est pas une vente du caissier.

**Cas limite (rare)** : si un Gérant/Admin a **également** ouvert une session de caisse physique (double rôle, scénario non interdit par le Multi-Caisses) et effectue une transaction Mobile Money depuis l'écran ERP **pendant** que sa session de caisse est active, `posSessionActive?.id` ne sera pas `null` → le document `ventesCaisse` portera le `sessionId` de sa session de caisse personnelle, et cette transaction MM apparaîtra dans **son propre** Rapport Z. **Ce comportement est identique à celui déjà en vigueur côté Digital** (même pattern) — **cohérent, pas une régression introduite par B4**, mais à documenter comme comportement attendu si jamais questionné.

## Stratégie d'implémentation

Ajout d'**une seule clé** dans chacun des 2 objets `.add(...)`, sans modifier aucun autre champ :
```javascript
sessionId: posSessionActive?.id || null,
```

---

# PLAN DE TEST COMPLET (10 scénarios)

Tous les tests doivent être exécutés en **preview** avec, lorsque c'est pertinent, des **stubs Firestore temporaires** (comme pour la Priorité 1) afin d'éviter toute pollution de la base de production par des sessions/transactions de test. Les tests nécessitant une écriture réelle (ex: vérification bout-en-bout du Tableau de bord Présences) devront être réalisés sur un compte/caisse de test dédié, avec nettoyage manuel après test — **à planifier avec toi avant exécution**.

### Test 1 — Ouverture de session
- **Action** : `confirmerDemarrageSession()` sur une caisse `disponible`.
- **Attendu (inchangé par B1)** : transaction existante (déjà conforme) crée `sessions_caisse` (sans champ `statut` après B6) + met à jour `caisses.statut='occupee'`.
- **Vérification spécifique B6** : le nouveau document `sessions_caisse` ne contient **pas** de champ `statut`.
- **Régression à vérifier** : badge POS passe à "EN SESSION", `posSessionActive` correctement peuplé.

### Test 2 — Transfert de caisse (Gérant/Admin)
- **Action** : Gérant ouvre "Suivi des Présences", sélectionne une caisse occupée par Marie, choisit "Transférer" vers Pierre, saisit un motif, confirme.
- **Attendu (B1)** : une seule transaction Firestore exécute : fermeture session de Marie (`statutSession:'fermee'`, sans `statut` legacy) + création session de Pierre (`statutSession:'ouverte'`, sans `statut` legacy) + mise à jour `caisses` (`sessionActiveId` → nouvelle session de Pierre, `utilisateurActifNom` → Pierre).
- **Hors transaction** : `audit_caisses` reçoit une entrée `type:'transfert'` avec `ancienUtilisateurNom:'Marie'`, `nouvelUtilisateurNom:'Pierre'`.
- **Vérification** : `renderTableauBordCaisses` affiche immédiatement la caisse comme occupée par Pierre (listener temps réel `u15`/`u17`).
- **Cas d'échec à tester** : interrompre la transaction (simuler une erreur réseau via stub) → vérifier qu'**aucun** des 3 documents n'est modifié (état Marie/caisse inchangé).

### Test 3 — Réattribution (Gérant/Admin prend la caisse pour lui-même)
- **Action** : identique au Test 2 mais `action.type === 'reattribution'`, nouvel utilisateur = `currentUser` (le Gérant lui-même).
- **Attendu** : même mécanique transactionnelle, `nouvelUtilisateurNom = currentUser.label`.
- **Vérification** : le Gérant peut ensuite utiliser la caisse via `screen-select-caisse` → `choisirCaisse()` → reprise de la nouvelle session (déjà existante, non modifiée).

### Test 4 — Pause
- **Action** : `posPause()` (non modifiée par B1/B6/B4).
- **Attendu** : comportement identique à la Priorité 1 (garde anti-double-pause D3 toujours active).
- **Objectif du test** : **non-régression croisée** — vérifier que `posPause()` fonctionne toujours après la modification de `posFinService()`/`confirmerActionAudit()` dans le même fichier (aucune dépendance partagée modifiée, mais test de cohérence globale du module).

### Test 5 — Reprise
- **Action** : `posReprendre()` (non modifiée).
- **Attendu** : comportement identique, `pauses` array mis à jour comme avant.
- **Vérification croisée avec B1** : si une pause est en cours au moment d'un "Fin de service" (Test 6) ou d'une "fermeture forcée" (Test 7), la pause en cours doit être correctement clôturée dans les `pauses[]` de la transaction (logique de calcul des durées **inchangée**, simplement déplacée dans `tx`).

### Test 6 — Fin de service (cas normal)
- **Action** : caissier clique "Fin de service" sur sa propre session active.
- **Attendu (B1)** : transaction unique — `sessions_caisse.statutSession='fermee'` + `caisses.statut='disponible'`/`sessionActiveId=null`. Garde `cData.sessionActiveId === session.id` vraie → caisse libérée normalement.
- **Vérification B6** : aucun champ `statut` écrit/modifié.
- **Cas conflictuel (scénario du Test 9 du tableau de risques)** : simuler qu'un Gérant a **déjà** force-fermé cette session (via `confirmerActionAudit`, donc `statutSession` déjà `'fermee'`) **avant** que le caissier ne clique sur "Fin de service" → la transaction de `posFinService` doit lever `SESSION_DEJA_FERMEE`, afficher le toast "Votre session a déjà été clôturée par un Gérant/Admin", et rediriger le caissier vers `screen-select-caisse` **sans erreur JS**.

### Test 7 — Fermeture forcée (Gérant/Admin, sans réattribution)
- **Action** : Gérant sélectionne "Forcer la fermeture" (sans transfert/réattribution) sur une caisse occupée.
- **Attendu (B1)** : transaction à 2 écritures (`sessions_caisse` fermée + `caisses` libérée), `audit_caisses` reçoit `type:'fermeture_forcee'` (ou type équivalent existant) hors transaction.
- **Vérification** : la caisse redevient `disponible` et peut être immédiatement réutilisée par n'importe quel caissier via `screen-select-caisse` (Test 1).

### Test 8 — Mobile Money (B4)
- **Action** : Gérant/Admin (sans session de caisse active, `posSessionActive === null`) enregistre une transaction Mobile Money via `enregistrerTransactionMM()`.
- **Attendu (B4)** : le document créé dans `ventesCaisse` contient `sessionId: null`.
- **Vérification croisée** : ce document **n'apparaît dans aucun Rapport Z** caissier (filtre `v.sessionId === posSessionActive.id` ne matche jamais `null`).
- **Test complémentaire** : si `posSessionActive` est non-null (cas du Gérant ayant aussi une session de caisse active), vérifier que `sessionId` correspond bien à cette session — et que cette transaction **apparaît** dans le Rapport Z de cette session (comportement attendu, documenté ci-dessus).

### Test 9 — Vente Service ERP (B4)
- **Action** : identique au Test 8 mais via `enregistrerVenteService()`.
- **Attendu** : même comportement — `sessionId: null` si pas de session active, `sessionId: posSessionActive.id` sinon.
- **Vérification** : la page `page-services` (historique des ventes de services) continue de fonctionner normalement (aucun champ existant modifié, uniquement ajout de `sessionId`).

### Test 10 — Rapport Z + Tableau de bord Présences (test d'intégration global)
- **Scénario combiné** :
  1. Caissier A ouvre une session sur Caisse 1 (Test 1), effectue 2 ventes POS normales.
  2. Pendant ce temps, Gérant enregistre 1 transaction Mobile Money via ERP **sans** session active (Test 8) → `sessionId: null`.
  3. Caissier A clique "Fin de service" (Test 6) → génère le Rapport Z.
  4. **Vérification Rapport Z** : seules les 2 ventes POS de Caissier A apparaissent (total cohérent), la transaction Mobile Money du Gérant **n'apparaît pas** (sessionId différent/null) — **comportement correct, pas une régression**.
  5. **Vérification Tableau de bord Présences** (`renderTableauBordCaisses`) : Caisse 1 repasse à "Disponible" (⚪), badge 3 états cohérent, aucune entrée dupliquée dans `renderSuiviPresencesTable`/`renderAuditCaissesTable`.
  6. Caissier B ouvre une nouvelle session sur Caisse 1 (Test 1) → doit fonctionner sans aucun résidu de la session de Caissier A (transaction de fermeture a bien tout nettoyé).

---

# RÉCAPITULATIF

| Élément | Statut de cette analyse |
|---|---|
| B1 — architecture actuelle/cible, pseudo-code complet | ✅ Documenté (sections 1-4) |
| B1 — risques deadlock/conflit | ✅ Documenté (sections 5-6), 1 recommandation complémentaire identifiée (désactivation bouton modale audit) |
| B1 — plan de rollback | ✅ Documenté (section 7) — atomicité Firestore native, pas de script de réparation nécessaire |
| B6 — 6 emplacements (2 de plus que l'audit initial) | ✅ Documentés avec stratégie additive sans migration |
| B4 — 2 emplacements, source, comportement sans session | ✅ Documenté |
| Plan de test — 10 scénarios | ✅ Documenté, avec recommandation d'environnement de test dédié pour éviter pollution de production |

**Point ouvert à valider avant implémentation** :
- Recommandation section 6 (désactivation du bouton de confirmation de `modal-audit-caisse` pendant l'exécution, anti double-clic) — **hors périmètre strict B1/B6/B4 du plan v1.2**, mais directement lié au risque de double-session identifié pendant cette analyse. À valider : l'inclure dans cette livraison (effort : +15 min, même fichier) ou le traiter séparément ?

**Aucun fichier modifié. Aucune synchronisation effectuée. En attente de ton accord pour démarrer l'implémentation.**

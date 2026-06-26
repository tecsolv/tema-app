// Connexion Firebase — seul point de synchronisation entre TeMa Web App (contrôleur)
// et ce service (exécuteur). Aucune autre collection que celles listées ci-dessous
// n'est utilisée, conformément à la structure officielle TeMa Media Center.
const path = require('path');
const admin = require('firebase-admin');

function initFirebase(config) {
  admin.initializeApp({
    credential: admin.credential.cert(require(path.resolve(config.firebaseServiceAccountPath)))
  });
  return admin.firestore();
}

module.exports = { initFirebase, admin };

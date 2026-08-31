#!/usr/bin/env python3
"""
sync-icons.py — Synchronisation de la bibliothèque d'images TeMa Boutique
Usage :  python3 sync-icons.py

Ce script :
  1. Scanne le dossier source "Icorns d'Articles" pour détecter les nouveaux fichiers
  2. Les copie dans le bon sous-dossier de icons-articles/
  3. Met à jour index.json
  4. Affiche un résumé des ajouts

Pour catégoriser un nouveau fichier manuellement, ajoutez son nom
dans le dictionnaire MANUEL_CATEGORIES ci-dessous, puis relancez le script.
"""

import os, shutil, json, sys, unicodedata
from pathlib import Path

def nfc(s: str) -> str:
    """Normalise en NFC pour comparer les noms de fichiers (macOS = NFD)."""
    return unicodedata.normalize('NFC', s)

BASE = Path(__file__).parent
SRC  = BASE / "assets" / "Icorns d'Articles"
DEST = BASE / "assets" / "icons-articles"
IDX  = DEST / "index.json"

# ──────────────────────────────────────────────────────────────────────────────
# Étiquettes affichées dans la bibliothèque par catégorie
LABELS = {
    "epicerie":        "Épicerie & Superette",
    "boissons":        "Boissons",
    "viandes-poisson": "Viandes & Poisson",
    "patisserie":      "Pâtisserie & Boulangerie",
    "fournitures":     "Fournitures scolaires",
    "informatique":    "Informatique & Électronique",
    "electromenager":  "Électroménager",
    "hygiene-beaute":  "Hygiène & Beauté",
    "vetements":       "Vêtements & Jouets",
    "services":        "Services",
    "divers":          "Divers",
}

# ──────────────────────────────────────────────────────────────────────────────
# CATÉGORISATION MANUELLE
# Ajouter ici les nouveaux fichiers avec leur catégorie et étiquette.
# Format :  "Nom du fichier.png": ("catégorie", "Étiquette affichée")
# Les fichiers non listés ici iront automatiquement dans "divers".
MANUEL_CATEGORIES: dict[str, tuple[str, str]] = {
    # Épicerie
    "Ananas.png":            ("epicerie",       "Ananas"),
    "Arricot vert.png":      ("epicerie",       "Haricot vert"),
    "Avocat.png":            ("epicerie",       "Avocat"),
    "Banane.png":            ("epicerie",       "Banane"),
    "Beure.png":             ("epicerie",       "Beurre"),
    "Carrot.png":            ("epicerie",       "Carotte"),
    "Champigon.png":         ("epicerie",       "Champignon"),
    "Chou.png":              ("epicerie",       "Chou"),
    "Citron.png":            ("epicerie",       "Citron"),
    "Citron Vert.png":       ("epicerie",       "Citron vert"),
    "Cumcumbre.png":         ("epicerie",       "Concombre"),
    "Gingimbre.png":         ("epicerie",       "Gingembre"),
    "Ketchop.png":           ("epicerie",       "Ketchup"),
    "Kiwi.png":              ("epicerie",       "Kiwi"),
    "Maïs.png":              ("epicerie",       "Maïs"),
    "Oignon.png":            ("epicerie",       "Oignon"),
    "Oignon rouge.png":      ("epicerie",       "Oignon rouge"),
    "Orange.png":            ("epicerie",       "Orange"),
    "Pasteque.png":          ("epicerie",       "Pastèque"),
    "Patate douce.png":      ("epicerie",       "Patate douce"),
    "Pomme de terre.png":    ("epicerie",       "Pomme de terre"),
    "Pomme verte.png":       ("epicerie",       "Pomme verte"),
    "Poivre rouge.png":      ("epicerie",       "Poivre rouge"),
    "Raisin.png":            ("epicerie",       "Raisin"),
    "Salade.png":            ("epicerie",       "Salade"),
    "Tomate.png":            ("epicerie",       "Tomate"),
    # Boissons
    "Bièrre.png":                ("boissons", "Bière"),
    "Coka-Cola Boutaille.png":   ("boissons", "Coca-Cola bouteille"),
    "Coka-Cola Canne.png":       ("boissons", "Coca-Cola cannette"),
    "Fanta en Cane.png":         ("boissons", "Fanta cannette"),
    "Jack Daniel.png":           ("boissons", "Jack Daniel's"),
    "L'eau 330ml.png":           ("boissons", "Eau minérale 330ml"),
    "L'eau Celeste 330ml.png":   ("boissons", "Eau Celeste 330ml"),
    "Liqueur.png":               ("boissons", "Liqueur"),
    "Lottus.png":                ("boissons", "Lottus"),
    "Sprite en Canne.png":       ("boissons", "Sprite cannette"),
    "Sprite en bouteille.png":   ("boissons", "Sprite bouteille"),
    "Vin blanc.png":             ("boissons", "Vin blanc"),
    "Vin mousseux.png":          ("boissons", "Vin mousseux"),
    "Voldka.png":                ("boissons", "Vodka"),
    "Whisky.png":                ("boissons", "Whisky"),
    # Viandes & Poisson
    "Corqette de beef.png":  ("viandes-poisson", "Croquette de bœuf"),
    "Cuisse de mouton.png":  ("viandes-poisson", "Cuisse de mouton"),
    "Plateau d'oeufs.png":   ("viandes-poisson", "Plateau d'œufs"),
    "Poisson.png":           ("viandes-poisson", "Poisson"),
    "Viande de Beef.png":    ("viandes-poisson", "Viande de bœuf"),
    "Viande de porc.png":    ("viandes-poisson", "Viande de porc"),
    # Pâtisserie
    "Bagette de pain.png":       ("patisserie", "Baguette"),
    "Croissant.png":             ("patisserie", "Croissant"),
    "Donut.png":                 ("patisserie", "Donut"),
    "Gateaux sur Commande.png":  ("patisserie", "Gâteau commande"),
    "Pain fourré.png":           ("patisserie", "Pain fourré"),
    "Plaquette de Chocolat.png": ("patisserie", "Chocolat"),
    "Potion de gâteau.png":      ("patisserie", "Portion gâteau"),
    # Fournitures
    "Agraffeuse.png":      ("fournitures", "Agrafeuse"),
    "Cahier 300-pages.png":("fournitures", "Cahier 300 p."),
    "Classeur.png":        ("fournitures", "Classeur"),
    "Classeur Bleu.png":   ("fournitures", "Classeur bleu"),
    "Classeur rouge.png":  ("fournitures", "Classeur rouge"),
    "Classeur_02.png":     ("fournitures", "Classeur grand"),
    "Cslculatrice.png":    ("fournitures", "Calculatrice"),
    "Gomme.png":           ("fournitures", "Gomme"),
    "Marker.png":          ("fournitures", "Marqueur"),
    "Perforateur.png":     ("fournitures", "Perforateur"),
    "Règle.png":           ("fournitures", "Règle"),
    "Sciceaux.png":        ("fournitures", "Ciseaux"),
    "Scotch.png":          ("fournitures", "Scotch"),
    "Taille crayon.png":   ("fournitures", "Taille-crayon"),
    "Trombonne.png":       ("fournitures", "Trombone"),
    # Informatique
    "Casque.png":              ("informatique", "Casque audio"),
    "Chargeur d'Android.png":  ("informatique", "Chargeur Android"),
    "Ecouteur sans fil.png":   ("informatique", "Écouteur BT"),
    "Ordinateur Portable.png": ("informatique", "PC portable"),
    "Slit 3c.png":             ("informatique", "Clim split 3cv"),
    "Split 1.5c":              ("informatique", "Clim split 1.5cv"),
    "Split 2c.png":            ("informatique", "Clim split 2cv"),
    "TV 32\".png":             ("informatique", "Télévision 32\""),
    "TV 42\".png":             ("informatique", "Télévision 42\""),
    "TV 50\".png":             ("informatique", "Télévision 50\""),
    "TV 65\".png":             ("informatique", "Télévision 65\""),
    "TV 100\".png":            ("informatique", "Télévision 100\""),
    # Électroménager
    "Ampoule.png":         ("electromenager", "Ampoule"),
    "Fer à repasser.png":  ("electromenager", "Fer à repasser"),
    "Frigo 2-Batants.png": ("electromenager", "Réfrigérateur"),
    "Machine à laver.png": ("electromenager", "Machine à laver"),
    "Micro-Ondre.png":     ("electromenager", "Micro-ondes"),
    "Rice cooker.png":     ("electromenager", "Rice cooker"),
    "Ventilateur.png":     ("electromenager", "Ventilateur"),
    # Hygiène & Beauté
    "Bougie senteur.png":    ("hygiene-beaute", "Bougie parfumée"),
    "Brosse à dents.png":    ("hygiene-beaute", "Brosse à dents"),
    "Papier toillette.png":  ("hygiene-beaute", "Papier toilette"),
    "Parfum.png":            ("hygiene-beaute", "Parfum"),
    "Produit de beauté.png": ("hygiene-beaute", "Prod. beauté"),
    "Savon.png":             ("hygiene-beaute", "Savon"),
    "Senteur .png":          ("hygiene-beaute", "Senteur"),
    # Vêtements
    "Veste dame.png": ("vetements", "Veste dame"),
    "Jouet.png":      ("vetements", "Jouet enfant"),
    # Services
    "Appel.png":                     ("services", "Crédit téléph."),
    "Connection inernet (data).png": ("services", "Internet / Data"),
    "Enveloppe.png":                 ("services", "Courrier"),
    "Envoi de document.png":         ("services", "Envoi document"),
    "Mobile Money .png":             ("services", "Mobile Money"),
    "Navigation.png":                ("services", "Navigation GPS"),
    "Saisie de CV.png":              ("services", "Saisie CV"),
    # Divers
    "Cigarette.png": ("divers", "Cigarette"),
    "key.png":       ("divers", "Clé"),
    **{f"key ({i}).png": ("divers", f"Icône {i}") for i in range(1, 46)},
}

# ──────────────────────────────────────────────────────────────────────────────

def nom_dest(orig: str) -> str:
    """Retourne le nom du fichier de destination (ajoute .png si absent)."""
    name = orig.rstrip()
    return name if name.lower().endswith(('.png', '.jpg', '.jpeg', '.gif')) else name + '.png'

def file_id(dest_name: str) -> str:
    """Génère un id propre à partir du nom de fichier."""
    return (dest_name.replace('.png','').replace('.jpg','').replace('.jpeg','').replace('.gif','')
            .replace(' ','_').replace("'","").replace('"','')
            .replace('(','').replace(')','').lower())

def charger_index() -> dict:
    if IDX.exists():
        with open(IDX, encoding='utf-8') as f:
            return json.load(f)
    # Créer un index vide avec toutes les catégories
    return {"categories": [{"id": k, "label": v, "icons": []} for k, v in LABELS.items()]}

def sauvegarder_index(data: dict):
    with open(IDX, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def main():
    if not SRC.exists():
        print(f"[ERREUR] Dossier source introuvable : {SRC}")
        sys.exit(1)

    DEST.mkdir(parents=True, exist_ok=True)
    for cat in LABELS:
        (DEST / cat).mkdir(exist_ok=True)

    data = charger_index()

    # Index rapide : set de tous les fichiers déjà présents dans icons-articles/
    # Normalisé en NFC pour comparer sans problème les accents (macOS = NFD)
    deja_presents: set[str] = set()
    for cat_entry in data["categories"]:
        for icon in cat_entry["icons"]:
            deja_presents.add(nfc(icon["file"]))

    # Fichiers valides dans le dossier source
    exts = {'.png', '.jpg', '.jpeg', '.gif'}
    sources = [
        f for f in os.listdir(SRC)
        if Path(f).suffix.lower() in exts or not Path(f).suffix  # inclut "Split 1.5c" sans ext
    ]

    nouveaux   = []
    ignores    = []

    for orig in sorted(sources):
        dest_name = nom_dest(orig)
        if nfc(dest_name) in deja_presents:
            continue  # déjà dans la bibliothèque

        # Catégorie
        if orig in MANUEL_CATEGORIES:
            cat_id, label = MANUEL_CATEGORIES[orig]
        else:
            # Pas encore catégorisé → divers
            cat_id = "divers"
            label  = Path(dest_name).stem.replace('_', ' ')
            ignores.append(orig)

        src_path  = SRC / orig
        dest_path = DEST / cat_id / dest_name
        shutil.copy2(src_path, dest_path)

        # Ajouter dans l'index
        cat_entry = next((c for c in data["categories"] if c["id"] == cat_id), None)
        if cat_entry is None:
            data["categories"].append({"id": cat_id, "label": LABELS.get(cat_id, cat_id), "icons": []})
            cat_entry = data["categories"][-1]
        cat_entry["icons"].append({"id": file_id(dest_name), "file": dest_name, "label": label})
        nouveaux.append((orig, cat_id, label))

    sauvegarder_index(data)

    # ── Résumé ──────────────────────────────────────────────────────────────
    print(f"\n{'─'*55}")
    print(f"  sync-icons.py — TeMa Boutique")
    print(f"{'─'*55}")
    if not nouveaux:
        print("  ✅ Aucun nouveau fichier détecté. Bibliothèque à jour.")
    else:
        print(f"  ✅ {len(nouveaux)} nouvelle(s) icône(s) ajoutée(s) :\n")
        for orig, cat, lbl in nouveaux:
            marker = "⚠ " if orig in ignores else "  "
            print(f"  {marker}[{cat:16}]  {lbl:20}  ← {orig}")
        if ignores:
            print(f"\n  ⚠  {len(ignores)} fichier(s) placé(s) dans 'divers' (catégorie inconnue).")
            print("     Pour les recatégoriser : ajoutez-les dans MANUEL_CATEGORIES")
            print("     de ce script, puis relancez sync-icons.py.")
    print(f"\n  → N'oubliez pas de faire git add + git commit + git push")
    print(f"{'─'*55}\n")

if __name__ == "__main__":
    main()

# 🚀 Guide d'utilisation de l'ETL

## 📋 Prérequis

Installer les dépendances Python :

```bash
pip install requests
```

## ⚙️ Utilisation

### 1. Exécuter l'ETL

Lancez le script pour récupérer et transformer les données :

```bash
python etl.py
```

**Ce que fait le script :**
- ✅ Télécharge les données Enedis (NAF 63, ≥10 GWh)
- ✅ Géocode toutes les adresses uniques
- ✅ Regroupe les data centers par département
- ✅ Calcule les statistiques
- ✅ Génère le fichier `data.json`

**Temps d'exécution estimé :** 20-40 secondes (selon le nombre d'adresses)

### 2. Lancer l'application web

Une fois `data.json` généré :

```bash
python -m http.server 8000
```

Ouvrez votre navigateur : **http://localhost:8000**

## 📊 Exemple de sortie

```
============================================================
  ETL - DATA CENTERS FRANCE
============================================================

[ÉTAPE 1] EXTRACTION DES DONNÉES ENEDIS
ℹ Filtres appliqués : NAF 63, CONSO ≥ 9000 MWh
ℹ Téléchargement des données...
✓ 1247 enregistrements récupérés

[ÉTAPE 2] TRANSFORMATION DES DONNÉES
ℹ Regroupement des données par adresse...
✓ 53 adresses uniques identifiées
ℹ Géocodage des adresses...
  Géocodage 53/53...
✓ 52 adresses géocodées avec succès
⚠ 1 adresses non géocodées

[ÉTAPE 3] SAUVEGARDE DES DONNÉES
✓ Données sauvegardées dans 'data.json' (145.3 KB)

============================================================
  RÉSUMÉ
============================================================
  Data Centers détectés : 52
  Consommation totale   : 612.4 GWh
  Départements          : 18
  Temps d'exécution     : 23.7s
============================================================

✓ ETL terminé avec succès !
```

## 🔄 Quand relancer l'ETL ?

- ✅ Après chaque mise à jour des données Enedis (annuelle)
- ✅ Si vous modifiez les filtres (NAF, seuil de consommation)
- ✅ Si vous voulez rafraîchir le géocodage

## 🛠️ Configuration

Modifiez les constantes dans `etl.py` :

```python
CODE_NAF = "63"               # Code NAF à filtrer
SEUIL_CONSO_MWH = 9000       # Seuil minimal (en MWh)
LIMITE_RECORDS = 10000        # Nombre max d'enregistrements
```

## ❌ Dépannage

### Erreur : `ModuleNotFoundError: No module named 'requests'`

```bash
pip install requests
```

### Erreur : `Aucune donnée récupérée`

- Vérifiez votre connexion internet
- L'API Enedis est peut-être temporairement indisponible

### Erreur dans le navigateur : `data.json introuvable`

Vous devez d'abord exécuter `python etl.py` pour générer le fichier.

## 📁 Structure des fichiers

```
DataOpenMap/
├── etl.py              ← Script ETL (à exécuter)
├── data.json           ← Données générées (ne pas modifier)
├── index.html          ← Application web
├── script.js           ← Charge data.json
├── style.css
└── README_ETL.md       ← Ce fichier
```

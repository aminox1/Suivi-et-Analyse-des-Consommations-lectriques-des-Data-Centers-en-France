# Suivi et Analyse des Consommations Électriques des Data Centers en France

##  À propos du projet

Ce projet a été réalisé dans le cadre d'un travail de recherche sur l'impact énergétique des data centers en France. Notre objectif était de détecter et visualiser les data centers à travers leurs consommations électriques réelles, en utilisant les données ouvertes d'Enedis.

##  Objectifs

- Identifier les data centers en France à partir des données de consommation électrique
- Visualiser leur localisation et leurs consommations sur une carte interactive
- Analyser l'évolution historique de leurs consommations (2021-2023)
- Comparer les consommations réelles avec les puissances de raccordement demandées

##  Méthodologie

Nous avons utilisé une approche basée sur :
- **Code NAF 63** : Portails internet, traitement de données, hébergement et activités connexes
- **Seuil minimal** : 10 GWh de consommation annuelle (pour cibler les gros data centers)
- **Géocodage** : Localisation automatique des adresses via l'API Adresse du gouvernement français

##  Ce que nous avons développé

### 1. Analyse documentaire
Un document PDF d'analyse détaillant :
- Le contexte énergétique des data centers en France
- Les sources de données disponibles
- La méthodologie de détection

### 2. Application web interactive
Une interface de visualisation permettant de :
- **Voir la carte nationale** avec les data centers regroupés par département
- **Explorer par département** en cliquant sur les marqueurs
- **Consulter l'historique** de consommation de chaque data center
- **Classer les départements** par consommation totale ou nombre de sites

##  Comment utiliser l'application

### Installation

```bash
# Cloner le repository
git clone https://github.com/aminox1/Suivi-et-Analyse-des-Consommations-lectriques-des-Data-Centers-en-France.git

# Naviguer dans le dossier
cd DataOpenMap/DataOpenMap

# Lancer un serveur web local
python -m http.server 8000
```

### Utilisation

1. Ouvrir votre navigateur et aller sur `http://localhost:8000`
2. La carte se charge avec les data centers détectés
3. **Cliquez sur un département** pour voir ses data centers
4. **Cliquez sur " Classement"** pour voir le top des départements
5. **Cliquez sur un data center** pour voir son historique détaillé

##  Sources de données

- **Enedis Open Data** : Consommation annuelle des entreprises par adresse
  - URL : https://opendata.enedis.fr/datasets/consommation-annuelle-entreprise-par-adresse
  - Filtres appliqués : Code NAF 63, consommation ≥ 10 GWh
  
- **API Adresse** : Géocodage des adresses
  - URL : https://api-adresse.data.gouv.fr

- **Carte participative** : Le Nuage Était Sous Nos Pieds
  - URL : https://lenuageetaitsousnospieds.org

##  Résultats clés

D'après nos analyses :
- Identification de plusieurs dizaines de data centers majeurs en France
- Consommations variant de 10 à plus de 130 GWh par site
- Concentration importante dans certains départements (Île-de-France, Bouches-du-Rhône)
- Évolutions de consommation visibles sur les dernières années

##  Perspectives futures

- Intégration des données de la carte participative de lenuageetaitsousnospieds.org
- Extension de l'analyse aux années antérieures à 2021 (sans code NAF)
- Corrélation avec les puissances de raccordement RTE
- Distinction entre types de data centers (cloud, colocation, hyperscale)

##  Équipe

Projet réalisé par une équipe d'étudiants dans le cadre d'un travail de recherche encadré par Guillaume Urvoy-Keller.

##  Technologies utilisées

- **Frontend** : HTML5, CSS3, JavaScript
- **Cartographie** : Leaflet.js
- **APIs** : Enedis Open Data, API Adresse
- **Hébergement local** : Python HTTP Server

##  Licence

Ce projet utilise des données ouvertes et a été développé à des fins éducatives et de recherche.

---

*Dernière mise à jour : Janvier 2026*

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ETL - Extract Transform Load
Télécharge les données Enedis, les transforme et les sauvegarde localement
"""

import requests
import json
import time
import csv
import os
from datetime import datetime
from typing import Dict, List, Optional

# ================= CONFIGURATION =================
API_ENEDIS_EXPORT = "https://opendata.enedis.fr/api/explore/v2.1/catalog/datasets/consommation-annuelle-entreprise-par-adresse/exports/csv"
CSV_FILE = "donnees_enedis_complet.csv"
API_GEOCODING = "https://api-adresse.data.gouv.fr/search/"
OUTPUT_FILE = "data.json"

# Filtres - MODIFICATION: Maintenant on gère plusieurs codes NAF
CODES_NAF = ["61", "62", "63"]  # Télécommunications (61) et Informatique (63)
SEUIL_CONSO_MWH = 100
GEOCODING_DELAY = 0.15

# ================= COULEURS POUR LOGS =================
class Colors:
    GREEN = '\033[92m'
    BLUE = '\033[94m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    END = '\033[0m'
    BOLD = '\033[1m'

def log_info(msg: str):
    print(f"{Colors.BLUE}[INFO]{Colors.END} {msg}")

def log_success(msg: str):
    print(f"{Colors.GREEN}[OK]{Colors.END} {msg}")

def log_warning(msg: str):
    print(f"{Colors.YELLOW}[WARNING]{Colors.END} {msg}")

def log_error(msg: str):
    print(f"{Colors.RED}[ERROR]{Colors.END} {msg}")

def log_step(step: int, title: str):
    print(f"\n{Colors.BOLD}{Colors.BLUE}[ÉTAPE {step}] {title}{Colors.END}")

# ================= DOWNLOAD =================
def download_enedis_data() -> bool:
    """
    Télécharge les données depuis l'API Enedis Open Data
    et géocode les adresses si latitude / longitude sont absentes.
    Séparateur ;
    """
    log_info("Téléchargement depuis l'API Enedis Open Data...")
    log_info(f"(Données pour les NAF: {', '.join(CODES_NAF)})")

    all_rows = []
    fieldnames = None
    geocode_cache = {}

    total_to_geocode = 0
    geocoded_count = 0
    failed_count = 0

    for code_naf in CODES_NAF:
        log_info(f"Téléchargement NAF {code_naf}...")
        params = {
            "limit": -1,
            "refine": f"code_secteur_naf2:{code_naf}",
            "timezone": "UTC"
        }

        try:
            response = requests.get(API_ENEDIS_EXPORT, params=params, timeout=180)
            response.raise_for_status()

            content = response.content.decode('utf-8').splitlines()
            reader = csv.DictReader(content, delimiter=';')

            if fieldnames is None:
                fieldnames = reader.fieldnames

            # 🔎 Premier passage : compter combien à géocoder
            rows = list(reader)
            for row in rows:
                if not row.get("latitude") or not row.get("longitude"):
                    total_to_geocode += 1

            log_info(f"{total_to_geocode} lignes nécessitent un géocodage")

            # 🔁 Deuxième passage : traitement réel
            for index, row in enumerate(rows, start=1):

                adresse = row.get("adresse", "").strip()
                commune = row.get("nom_commune", "").strip()
                code_commune = row.get("code_commune", "")
                code_postal = code_commune[:2] + "000" if code_commune else ""

                lat = row.get("latitude")
                lng = row.get("longitude")

                key = f"{adresse}|{code_postal}|{commune}"

                if not lat or not lng:

                    if key in geocode_cache:
                        result = geocode_cache[key]
                    else:
                        result = geocode_address(adresse, code_postal, commune)
                        geocode_cache[key] = result
                        time.sleep(GEOCODING_DELAY)

                    if result:
                        row["latitude"] = result["lat"]
                        row["longitude"] = result["lng"]
                        geocoded_count += 1
                    else:
                        row["latitude"] = ""
                        row["longitude"] = ""
                        failed_count += 1

                    # 📊 Log progression toutes les 50 lignes
                    if geocoded_count % 50 == 0:
                        log_info(
                            f"Géocodage en cours : {geocoded_count}/{total_to_geocode} "
                            f"({(geocoded_count/total_to_geocode)*100:.1f}%)"
                        )

                all_rows.append(row)

            log_success(f"NAF {code_naf} téléchargé")

        except Exception as e:
            log_error(f"Erreur téléchargement NAF {code_naf}: {e}")
            return False

    if all_rows:
        if "latitude" not in fieldnames:
            fieldnames += ["latitude", "longitude"]

        with open(CSV_FILE, 'w', encoding='utf-8', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames, delimiter=';')
            writer.writeheader()
            writer.writerows(all_rows)

        file_size = os.path.getsize(CSV_FILE) / (1024 * 1024)

        log_success("GÉOCODAGE TERMINÉ")
        log_info(f"Succès : {geocoded_count}")
        log_info(f"Échecs : {failed_count}")
        log_success(f"CSV enrichi sauvegardé ({file_size:.1f} MB)")

        return True

    return False



# ================= EXTRACT =================
def extract_enedis_data() -> List[Dict]:
    log_step(1, "EXTRACTION DES DONNÉES ENEDIS")
    
    if not os.path.exists(CSV_FILE):
        log_info(f"Fichier local non trouvé")
        if not download_enedis_data():
            return []
    else:
        file_date = datetime.fromtimestamp(os.path.getmtime(CSV_FILE))
        log_info(f"Fichier existant trouvé (modifié le {file_date.strftime('%d/%m/%Y %H:%M')})")
    
    log_info(f"Lecture du fichier CSV...")
    records = []
    
    try:
        with open(CSV_FILE, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f, delimiter=';')
            for row in reader:
                if row is None:
                    continue
                clean_row = { (k or '').lstrip('\ufeff') : (v or '') for k, v in row.items() }
                # Vérifier si latitude et longitude existent
                clean_row['latitude'] = clean_row.get('latitude', '')
                clean_row['longitude'] = clean_row.get('longitude', '')
                records.append(clean_row)

        log_success(f"{len(records)} lignes lues")
    
    except Exception as e:
        log_error(f"Erreur lecture : {e}")
        return []
    
    # Filtrage par NAF
    log_info(f"Filtrage : NAF {', '.join(CODES_NAF)}")
    filtered_records = [r for r in records if r.get('code_secteur_naf2', '') in CODES_NAF]
    log_success(f"{len(filtered_records)} enregistrements NAF {', '.join(CODES_NAF)}")
    return filtered_records


# ================= GEOCODING =================
def geocode_address(address: str, code_postal: str = "", commune: str = "") -> Optional[Dict]:
    full_address = f"{address} {code_postal} {commune}".strip()
    
    try:
        response = requests.get(API_GEOCODING, params={"q": full_address, "limit": 1}, timeout=10)
        response.raise_for_status()
        data = response.json()
        features = data.get('features', [])
        
        if features:
            coords = features[0]['geometry']['coordinates']
            context = features[0]['properties'].get('context', '')
            dept_code = context.split(',')[0].strip() if context else "00"
            
            return {
                "lat": coords[1],
                "lng": coords[0],
                "dept": dept_code,
                "score": features[0]['properties'].get('score', 0)
            }
        return None
    except:
        return None


import math

def distance_m(lat1, lon1, lat2, lon2):
    """Distance en mètres entre deux points GPS"""
    R = 6371000  # rayon Terre en mètres

    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)

    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    )

    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ================= TRANSFORM =================
def transform_data(records: List[Dict]) -> Dict:
    log_step(2, "TRANSFORMATION DES DONNÉES")

    addresses_map = {}

    # ==========================================================
    # 1️⃣ REGROUPEMENT PAR ADRESSE
    # ==========================================================
    log_info("Regroupement par adresse...")
    for record in records:
        adresse = record.get('adresse', '').strip()
        if not adresse:
            continue

        commune = record.get('nom_commune', '').strip()
        code_commune = record.get('code_commune', '')
        code_dept = record.get('code_departement', '')
        code_naf = record.get('code_secteur_naf2', '')

        full_key = f"{adresse}|{code_commune}|{commune}"

        if full_key not in addresses_map:
            addresses_map[full_key] = {
                "adresse": adresse,
                "code_postal": code_commune[:2] + "000" if code_commune else "",
                "commune": commune,
                "code_departement": code_dept,
                "code_naf": code_naf,
                "historique": [],
                "lat": record.get('latitude'),
                "lng": record.get('longitude')
            }

        try:
            annee = int(record.get('annee', 0))
            conso = float(
                record.get('consommation_annuelle_totale_de_ladresse_mwh', '0')
                .replace(',', '.')
                .replace(' ', '')
            )
        except:
            continue

        if annee and conso:
            addresses_map[full_key]["historique"].append({
                "annee": annee,
                "mwh": conso
            })

    log_success(f"{len(addresses_map)} adresses uniques")

    # ==========================================================
    # 2️⃣ FILTRAGE PAR CONSOMMATION
    # ==========================================================
    log_info(f"Filtrage : CONSO ≥ {SEUIL_CONSO_MWH} MWh")
    addresses_map = {
        k: v for k, v in addresses_map.items()
        if v["historique"] and max(h["mwh"] for h in v["historique"]) >= SEUIL_CONSO_MWH
    }
    log_success(f"{len(addresses_map)} adresses après filtrage consommation")

    # ==========================================================
    # 3️⃣ CHARGEMENT CARTE (matching par coordonnée exacte)
    # ==========================================================
    log_info("Lecture de la carte des data centers...")

    carte_coords = set()

    try:
        with open(
            "carte_des_data_centers__des_projets_et_des_contestations_en_france.csv",
            encoding="utf-8"
        ) as f:
            reader = csv.DictReader(f, delimiter=',')

            for row in reader:
                try:
                    lat = round(float(row["Latitude"]), 4)
                    lon = round(float(row["Longitude"]), 4)
                    carte_coords.add((lat, lon))
                except:
                    continue

        log_success(f"{len(carte_coords)} coordonnées chargées depuis la carte")

    except Exception as e:
        log_warning(f"Impossible de lire la carte: {e}")
        carte_coords = set()


    # ==========================================================
    # 4️⃣ MATCH COORDONNÉES PAR PROXIMITÉ (≤ 50m)
    # ==========================================================
    log_info("Matching spatial (rayon 100m)...")

    RAYON_MATCH_METRES = 100

    datacenters = []
    match_count = 0

    for data in addresses_map.values():
        try:
            lat = float(data['lat'])
            lng = float(data['lng'])
        except:
            continue

        match_found = False

        for lat_carte, lng_carte in carte_coords:
            if distance_m(lat, lng, lat_carte, lng_carte) <= RAYON_MATCH_METRES:
                match_found = True
                break

        if match_found:
            match_count += 1

            data['historique'].sort(key=lambda x: x['annee'], reverse=True)
            dept_final = data.get('code_departement') or "00"

            datacenters.append({
                "nom": data['adresse'],
                "adresse_complete": f"{data['adresse']}, {data['code_postal']} {data['commune']}",
                "lat": round(lat, 6),
                "lng": round(lng, 6),
                "departement": dept_final,
                "code_naf": data['code_naf'],
                "historique": data['historique'],
                "match_carte": True
            })

    log_success(f"{match_count} correspondances trouvées avec la carte")



    # ==========================================================
    # 5️⃣ REGROUPEMENT PAR DÉPARTEMENT
    # ==========================================================
    departements_map = {}
    for dc in datacenters:
        dept = dc['departement']
        if dept not in departements_map:
            departements_map[dept] = {
                "code": dept,
                "datacenters": [],
                "total_mwh": 0,
                "count": 0
            }
        departements_map[dept]["datacenters"].append(dc)
        departements_map[dept]["count"] += 1
        if dc["historique"]:
            departements_map[dept]["total_mwh"] += dc["historique"][0]["mwh"]

    departements = []
    for dept_code, dept_data in departements_map.items():
        avg_lat = sum(dc["lat"] for dc in dept_data["datacenters"]) / len(dept_data["datacenters"])
        avg_lng = sum(dc["lng"] for dc in dept_data["datacenters"]) / len(dept_data["datacenters"])
        departements.append({
            "code": dept_code,
            "lat": avg_lat,
            "lng": avg_lng,
            "total_mwh": dept_data["total_mwh"],
            "count": dept_data["count"],
            "datacenters": dept_data["datacenters"]
        })

    departements.sort(key=lambda x: x["total_mwh"], reverse=True)

    total_dc = len(datacenters)
    total_mwh = sum(d["total_mwh"] for d in departements)

    return {
        "metadata": {
            "generated_at": datetime.now().isoformat(),
            "source": "API Enedis Open Data",
            "total_datacenters": total_dc,
            "total_mwh": round(total_mwh, 2),
            "total_gwh": round(total_mwh / 1000, 2),
            "total_departements": len(departements),
            "filters": {
                "codes_naf": CODES_NAF,
                "seuil_mwh": SEUIL_CONSO_MWH
            }
        },
        "departements": departements
    }

# ================= enrich csv =================
import sys

def enrich_csv_with_geocode(csv_file: str) -> bool:
    """
    Vérifie si latitude / longitude sont vides dans le CSV et les complète via géocodage.
    Réécrit le fichier CSV avec les nouvelles valeurs.
    Affiche le nombre de lignes encore nulles.
    """
    if not os.path.exists(csv_file):
        log_error(f"Fichier {csv_file} non trouvé")
        return False

    all_rows = []
    geocode_cache = {}
    total_rows = 0
    updated_rows = 0

    # 1️⃣ Lecture du CSV
    with open(csv_file, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f, delimiter=';')
        fieldnames = reader.fieldnames

        if "latitude" not in fieldnames:
            fieldnames.append("latitude")
        if "longitude" not in fieldnames:
            fieldnames.append("longitude")

        rows = list(reader)
        total_rows = len(rows)

    # 2️⃣ Parcours et enrichissement
    for idx, row in enumerate(rows, start=1):
        adresse = row.get("adresse", "").strip()
        commune = row.get("nom_commune", "").strip()
        code_commune = row.get("code_commune", "")
        code_postal = code_commune[:2] + "000" if code_commune else ""

        lat = row.get("latitude")
        lng = row.get("longitude")

        key = f"{adresse}|{code_postal}|{commune}"

        if not lat or not lng:
            # Vérifier cache
            if key in geocode_cache:
                result = geocode_cache[key]
            else:
                result = geocode_address(adresse, code_postal, commune)
                geocode_cache[key] = result
                time.sleep(GEOCODING_DELAY)

            if result:
                row["latitude"] = result["lat"]
                row["longitude"] = result["lng"]
                updated_rows += 1
            else:
                row["latitude"] = ""
                row["longitude"] = ""

        all_rows.append(row)

        # Log dynamique
        percent = (idx / total_rows) * 100
        sys.stdout.write(
            f"\rTraitement CSV : {idx}/{total_rows} ({percent:.1f}%) | mises à jour: {updated_rows}"
        )
        sys.stdout.flush()

    print()  # retour à la ligne propre

    # 3️⃣ Réécriture du CSV
    with open(csv_file, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, delimiter=';')
        writer.writeheader()
        writer.writerows(all_rows)

    # 4️⃣ Compter les lignes encore nulles
    remaining_nulls = sum(
        1 for row in all_rows if not row.get("latitude") or not row.get("longitude")
    )

    log_success(f"CSV '{csv_file}' mis à jour : {updated_rows} lignes enrichies sur {total_rows}")
    if remaining_nulls > 0:
        log_warning(f"{remaining_nulls} lignes ont encore latitude ou longitude vides après géocodage")
    else:
        log_info("Toutes les lignes ont maintenant latitude et longitude")

    return True

# ================= LOAD =================
def load_data(data: Dict) -> bool:
    log_step(3, "SAUVEGARDE DES DONNÉES")
    
    try:
        with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        file_size = len(json.dumps(data)) / 1024
        log_success(f"Données sauvegardées dans '{OUTPUT_FILE}' ({file_size:.1f} KB)")
        return True
    except Exception as e:
        log_error(f"Erreur : {e}")
        return False

# ================= MAIN =================
def main():
    print(f"\n{Colors.BOLD}{'='*60}")
    print(f"  ETL - DATA CENTERS FRANCE")
    print(f"  Source: API Enedis Open Data")
    print(f"{'='*60}{Colors.END}\n")
    
    start_time = time.time()
    
    # 1️⃣ Extraction des données
    records = extract_enedis_data()
    if not records:
        log_error("Aucune donnée. Arrêt.")
        return

    # 2️⃣ Enrichissement du CSV avec latitude / longitude manquantes
    log_step(1.5, "ENRICHISSEMENT DU CSV AVEC LAT/LNG")
    enriched = enrich_csv_with_geocode(CSV_FILE)
    if not enriched:
        log_warning("Enrichissement du CSV échoué ou non nécessaire")

    # 3️⃣ Relecture des données pour transformation
    records = extract_enedis_data()
    if not records:
        log_error("Aucune donnée après enrichissement. Arrêt.")
        return

    # 4️⃣ Transformation
    transformed_data = transform_data(records)

    # 5️⃣ Sauvegarde
    success = load_data(transformed_data)
    
    elapsed_time = time.time() - start_time
    print(f"\n{Colors.BOLD}{'='*60}")
    print(f"  RÉSUMÉ")
    print(f"{'='*60}{Colors.END}")
    print(f"  Data Centers détectés : {Colors.GREEN}{transformed_data['metadata']['total_datacenters']}{Colors.END}")
    print(f"  Consommation totale   : {Colors.GREEN}{transformed_data['metadata']['total_gwh']} GWh{Colors.END}")
    print(f"  Départements          : {Colors.GREEN}{transformed_data['metadata']['total_departements']}{Colors.END}")
    print(f"  Temps d'exécution     : {Colors.BLUE}{elapsed_time:.1f}s{Colors.END}")
    print(f"{'='*60}\n")
    
    if success:
        log_success("✓ ETL terminé ! Lancez maintenant : python -m http.server 8000")
    else:
        log_error("✗ ETL terminé avec des erreurs")


if __name__ == "__main__":
    main()
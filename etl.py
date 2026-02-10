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
CODES_NAF = ["61", "63"]  # Télécommunications (61) et Informatique (63)
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
    """
    log_info("Téléchargement depuis l'API Enedis Open Data...")
    log_info(f"(Données pour les NAF: {', '.join(CODES_NAF)})")
    
    # Télécharger pour chaque code NAF et combiner
    all_data = []
    
    for code_naf in CODES_NAF:
        log_info(f"Téléchargement NAF {code_naf}...")
        params = {
            "limit": -1,
            "refine": f"code_secteur_naf2:{code_naf}",
            "timezone": "UTC"
        }
        
        try:
            response = requests.get(API_ENEDIS_EXPORT, params=params, timeout=180, stream=True)
            response.raise_for_status()
            
            # Lire le contenu
            content = response.content.decode('utf-8')
            all_data.append(content)
            
            log_success(f"NAF {code_naf} téléchargé")
            
        except Exception as e:
            log_error(f"Erreur téléchargement NAF {code_naf}: {e}")
            return False
    
    # Combiner les fichiers CSV (garder l'en-tête du premier uniquement)
    if all_data:
        combined = all_data[0]  # Premier fichier avec en-tête
        for data in all_data[1:]:
            # Sauter la première ligne (en-tête) pour les fichiers suivants
            lines = data.split('\n')
            combined += '\n'.join(lines[1:])
        
        with open(CSV_FILE, 'w', encoding='utf-8') as f:
            f.write(combined)
        
        file_size = os.path.getsize(CSV_FILE) / (1024 * 1024)
        log_success(f"CSV combiné sauvegardé ({file_size:.1f} MB)")
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
        log_info("Pour retélécharger, supprimez le fichier 'donnees_enedis_complet.csv'")
    
    log_info(f"Lecture du fichier CSV...")
    records = []
    
    try:
        success = False
        for encoding in ['utf-8', 'latin-1', 'cp1252', 'iso-8859-1']:
            for delimiter in [';', ',']:
                try:
                    with open(CSV_FILE, 'r', encoding=encoding) as f:
                        reader = csv.DictReader(f, delimiter=delimiter)
                        temp_records = []
                        for row in reader:
                            clean_row = {k.lstrip('\ufeff'): v for k, v in row.items()}
                            temp_records.append(clean_row)
                        
                        if temp_records and 'code_secteur_naf2' in temp_records[0]:
                            records = temp_records
                            log_success(f"{len(records)} lignes lues (encodage: {encoding})")
                            success = True
                            break
                except:
                    continue
            if success:
                break
        
        if not records:
            raise Exception("Format CSV non reconnu")
        
    except Exception as e:
        log_error(f"Erreur lecture : {e}")
        return []
    
    # Filtrage par NAF
    log_info(f"Filtrage : NAF {', '.join(CODES_NAF)}")
    filtered_records = []
    
    for record in records:
        naf = record.get('code_secteur_naf2', '')
        
        if naf in CODES_NAF:
            filtered_records.append(record)
    
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

# ================= TRANSFORM =================
def transform_data(records: List[Dict]) -> Dict:
    log_step(2, "TRANSFORMATION DES DONNÉES")
    
    addresses_map = {}
    
    log_info("Regroupement par adresse...")
    debug_count = 0
    for record in records:
        adresse = record.get('adresse', '')
        if not adresse:
            continue
        
        if debug_count == 0:
            log_info(f"DEBUG - Premier enregistrement: {list(record.keys())[:5]}")
            log_info(f"DEBUG - adresse={adresse}, annee={record.get('annee')}, conso={record.get('consommation_annuelle_totale_de_ladresse_mwh')}")
            debug_count += 1
        
        code_dept = record.get('code_departement', '')
        commune = record.get('nom_commune', '')
        code_commune = record.get('code_commune', '')
        code_naf = record.get('code_secteur_naf2', '')
        
        full_key = f"{adresse}|{code_commune}|{commune}"
        
        if full_key not in addresses_map:
            addresses_map[full_key] = {
                "adresse": adresse,
                "code_postal": code_commune[:2] + "000" if code_commune else "",
                "commune": commune,
                "code_departement": code_dept,
                "code_naf": code_naf,
                "historique": []
            }
        
        annee_str = record.get('annee', '')
        conso_str = record.get('consommation_annuelle_totale_de_ladresse_mwh', '0')
        
        try:
            annee = int(annee_str) if annee_str else 0
            conso = float(conso_str.replace(',', '.').replace(' ', '')) if conso_str else 0
            
            if debug_count == 1:
                log_info(f"DEBUG - Après conversion: annee={annee}, conso={conso}")
                debug_count += 1
            
        except Exception as e:
            if debug_count == 1:
                log_error(f"DEBUG - Erreur conversion: {e}")
            continue
        
        if annee and conso:
            addresses_map[full_key]["historique"].append({"annee": annee, "mwh": conso})
    
    log_success(f"{len(addresses_map)} adresses uniques")
    
    # Filtrer par consommation
    log_info(f"Filtrage : CONSO ≥ {SEUIL_CONSO_MWH} MWh")
    addresses_filtered = {}
    for key, data in addresses_map.items():
        if data['historique']:
            max_conso = max(h['mwh'] for h in data['historique'])
            if max_conso >= SEUIL_CONSO_MWH:
                addresses_filtered[key] = data
    
    log_success(f"{len(addresses_filtered)} adresses avec conso ≥ {SEUIL_CONSO_MWH} MWh")
    addresses_map = addresses_filtered
    
    log_info("Géocodage des adresses...")
    datacenters = []
    geocoded_count = 0
    failed_count = 0
    
    for i, (key, data) in enumerate(addresses_map.items(), 1):
        print(f"\r  Géocodage {i}/{len(addresses_map)}...", end='', flush=True)
        
        dept_from_csv = data.get('code_departement', '')
        
        coords = geocode_address(data['adresse'], data['code_postal'], data['commune'])
        time.sleep(GEOCODING_DELAY)
        
        if coords:
            data['historique'].sort(key=lambda x: x['annee'], reverse=True)
            
            dept_final = dept_from_csv if dept_from_csv else coords['dept']
            
            datacenters.append({
                "nom": data['adresse'],
                "adresse_complete": f"{data['adresse']}, {data['code_postal']} {data['commune']}",
                "lat": coords['lat'],
                "lng": coords['lng'],
                "departement": dept_final,
                "code_naf": data['code_naf'],
                "historique": data['historique'],
                "score_geocoding": coords['score']
            })
            geocoded_count += 1
        else:
            if dept_from_csv and data['historique']:
                log_warning(f"Géocodage échoué pour {data['adresse'][:30]}... - conservé avec dept {dept_from_csv}")
            failed_count += 1
    
    print()
    log_success(f"{geocoded_count} adresses géocodées")
    if failed_count > 0:
        log_warning(f"{failed_count} échecs de géocodage")
    
    log_info("Regroupement par département...")
    departements_map = {}
    
    for dc in datacenters:
        dept = dc['departement']
        if dept not in departements_map:
            departements_map[dept] = {"code": dept, "datacenters": [], "total_mwh": 0, "count": 0}
        
        departements_map[dept]["datacenters"].append(dc)
        departements_map[dept]["count"] += 1
        
        if dc['historique']:
            departements_map[dept]["total_mwh"] += dc['historique'][0]['mwh']
    
    departements = []
    for dept_code, dept_data in departements_map.items():
        avg_lat = sum(dc['lat'] for dc in dept_data['datacenters']) / len(dept_data['datacenters'])
        avg_lng = sum(dc['lng'] for dc in dept_data['datacenters']) / len(dept_data['datacenters'])
        
        departements.append({
            "code": dept_code,
            "lat": avg_lat,
            "lng": avg_lng,
            "total_mwh": dept_data["total_mwh"],
            "count": dept_data["count"],
            "datacenters": dept_data["datacenters"]
        })
    
    departements.sort(key=lambda x: x['total_mwh'], reverse=True)
    log_success(f"{len(departements)} départements")
    
    total_dc = len(datacenters)
    total_mwh = sum(dept['total_mwh'] for dept in departements)
    
    return {
        "metadata": {
            "generated_at": datetime.now().isoformat(),
            "source": "API Enedis Open Data",
            "total_datacenters": total_dc,
            "total_mwh": round(total_mwh, 2),
            "total_gwh": round(total_mwh / 1000, 2),
            "total_departements": len(departements),
            "filters": {"codes_naf": CODES_NAF, "seuil_mwh": SEUIL_CONSO_MWH}
        },
        "departements": departements
    }

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
    
    records = extract_enedis_data()
    if not records:
        log_error("Aucune donnée. Arrêt.")
        return
    
    transformed_data = transform_data(records)
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
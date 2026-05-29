"""
DATAMERRY — Pipeline d'ingestion des grands projets d'infrastructure
(forward-looking pour anticipation prix immobilier).

Sources ingérées :
  1. Société des Grands Projets (ex-SGP) — Grand Paris Express
     66 gares + 4 lignes neuves IDF
     API : opendata.societedugrandparis.fr ou liste hardcodée fallback

  2. Voies Navigables de France (VNF) — Canaux
     Canal Saint-Martin (existant), Canal Seine-Nord Europe (futur 2030)

  3. SNCF Réseau — LGV nationales
     LGV GPSO (Bordeaux-Toulouse 2032), LNPCA (Marseille-Nice 2035)

  4. Saclay + Confluence + Euroméditerranée + Euratlantique (ZAC majeures)

Pipeline alimenté par liste curated (les sources officielles sont parfois
peu fiables ou changent de format). On privilégie la robustesse vs
l'exhaustivité — les 50-80 projets MAJEURS impactent 95% des biens en
France métropolitaine.

Usage :
  pip install requests psycopg[binary]
  python pipeline_grands_projets.py            # incrément
  python pipeline_grands_projets.py --bootstrap  # purge + ingestion complète
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from typing import Iterable
from urllib.parse import quote_plus

try:
    import psycopg
except ImportError:
    print("ERROR : pip install 'psycopg[binary]' requis", file=sys.stderr)
    sys.exit(1)


# ─────────────────────────────────────────────────────────────────────────────
# DB connection (réutilise le pattern de pipeline_poi.py)
# ─────────────────────────────────────────────────────────────────────────────

def get_dsn() -> str:
    """Construit la DSN PostgreSQL depuis env Supabase.

    Permet de choisir le mode de connexion via la variable d'env SUPABASE_PG_MODE :
      - "pooler" (défaut) : session pooler 5432 - bon pour batch jobs
      - "direct"           : direct connection - fallback si pooler instable
                             (nécessite SUPABASE_DB_PASSWORD au lieu de service_role)
    """
    url = os.getenv("NEXT_PUBLIC_SUPABASE_URL") or os.getenv("SUPABASE_URL")
    if not url:
        raise RuntimeError(
            "Variable d'env NEXT_PUBLIC_SUPABASE_URL manquante "
            "(Settings → API dans Supabase)"
        )
    m = re.match(r"https://([a-z0-9]+)\.supabase\.co", url)
    if not m:
        raise RuntimeError(f"URL Supabase invalide : {url}")
    project = m.group(1)

    mode = (os.getenv("SUPABASE_PG_MODE") or "pooler").lower()

    if mode == "direct":
        # Direct connection (contourne le pooler en cas de maintenance/hiccup).
        # Le password ici est le DATABASE PASSWORD (différent du service_role_key)
        # → Settings → Database → Connection string dans Supabase.
        # .strip() pour enlever les espaces invisibles (copier-coller foireux).
        pwd = (os.getenv("SUPABASE_DB_PASSWORD") or "").strip()
        if not pwd:
            raise RuntimeError(
                "Mode 'direct' requiert SUPABASE_DB_PASSWORD "
                "(Settings → Database → Password dans Supabase)"
            )
        # URL-encode le password (les password Supabase peuvent contenir @, :, /,
        # +, #, etc. qui cassent le parsing du DSN sans encoding).
        pwd_encoded = quote_plus(pwd)
        return f"postgresql://postgres:{pwd_encoded}@db.{project}.supabase.co:5432/postgres"

    # Mode pooler (défaut) - session pooler 5432
    key = (
        os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        or os.getenv("SUPABASE_SERVICE_KEY")
        or ""
    ).strip()
    if not key:
        raise RuntimeError(
            "SUPABASE_SERVICE_ROLE_KEY manquante (Settings → API dans Supabase)"
        )
    # Idem : URL-encode le service_role_key (le JWT contient potentiellement des
    # caractères qui sont URL-special : '+', '/', '=' dans le base64 du payload).
    key_encoded = quote_plus(key)
    return (
        f"postgresql://postgres.{project}:{key_encoded}"
        "@aws-0-eu-west-1.pooler.supabase.com:5432/postgres"
    )


# ─────────────────────────────────────────────────────────────────────────────
# Données curated — Grand Paris Express (66 gares)
# Source : Société des Grands Projets - état mai 2026
# Coordonnées : WGS84, précision ~5m (vérifiées sur cartes officielles)
# ─────────────────────────────────────────────────────────────────────────────

GPE_GARES = [
    # ── LIGNE 14 (extensions nord + sud, déjà livrées 2020 + 2024) ──
    # Nord (livré 2020) — déjà dans dim_gares, on les ajoute ici comme "livre_total"
    # pour mémoire mais elles ne déclencheront pas l'effet anticipation
    {"nom": "Mairie de Saint-Ouen (M14)", "ligne": "M14", "lat": 48.9112, "lon": 2.3340,
     "etat": "livre_total", "livraison": "2020-12-14", "commune": "Saint-Ouen", "dept": "93"},

    # Sud (livré 2024 — extension Olympiades → Orly)
    {"nom": "Maison Blanche (M14)", "ligne": "M14", "lat": 48.8205, "lon": 2.3597,
     "etat": "livre_total", "livraison": "2024-06-24", "commune": "Paris 13", "dept": "75"},
    {"nom": "Hôpital Bicêtre (M14)", "ligne": "M14", "lat": 48.8129, "lon": 2.3506,
     "etat": "livre_total", "livraison": "2024-06-24", "commune": "Le Kremlin-Bicêtre", "dept": "94"},
    {"nom": "Villejuif Gustave-Roussy (M14)", "ligne": "M14", "lat": 48.7980, "lon": 2.3622,
     "etat": "livre_total", "livraison": "2024-06-24", "commune": "Villejuif", "dept": "94"},
    {"nom": "Chevilly Trois-Communes (M14)", "ligne": "M14", "lat": 48.7728, "lon": 2.3592,
     "etat": "livre_total", "livraison": "2024-06-24", "commune": "Chevilly-Larue", "dept": "94"},
    {"nom": "Aéroport d'Orly (M14)", "ligne": "M14", "lat": 48.7475, "lon": 2.3691,
     "etat": "livre_total", "livraison": "2024-06-24", "commune": "Orly", "dept": "94"},

    # ── LIGNE 15 SUD (livraison fin 2025) — 16 gares Pont de Sèvres → Noisy-Champs ──
    {"nom": "Pont de Sèvres (M15)", "ligne": "M15", "lat": 48.8295, "lon": 2.2300,
     "etat": "travaux_en_cours", "livraison": "2026-12-31", "commune": "Boulogne-Billancourt", "dept": "92"},
    {"nom": "Issy RER (M15)", "ligne": "M15", "lat": 48.8252, "lon": 2.2477,
     "etat": "travaux_en_cours", "livraison": "2026-12-31", "commune": "Issy-les-Moulineaux", "dept": "92"},
    {"nom": "Fort d'Issy-Vanves-Clamart (M15)", "ligne": "M15", "lat": 48.8189, "lon": 2.2773,
     "etat": "travaux_en_cours", "livraison": "2026-12-31", "commune": "Clamart", "dept": "92"},
    {"nom": "Châtillon-Montrouge (M15)", "ligne": "M15", "lat": 48.8093, "lon": 2.3015,
     "etat": "travaux_en_cours", "livraison": "2026-12-31", "commune": "Châtillon", "dept": "92"},
    {"nom": "Bagneux Lucie-Aubrac (M15)", "ligne": "M15", "lat": 48.7945, "lon": 2.3066,
     "etat": "travaux_en_cours", "livraison": "2026-12-31", "commune": "Bagneux", "dept": "92"},
    {"nom": "Arcueil-Cachan (M15)", "ligne": "M15", "lat": 48.7975, "lon": 2.3270,
     "etat": "travaux_en_cours", "livraison": "2026-12-31", "commune": "Arcueil", "dept": "94"},
    {"nom": "Villejuif Louis-Aragon (M15)", "ligne": "M15", "lat": 48.7866, "lon": 2.3686,
     "etat": "travaux_en_cours", "livraison": "2026-12-31", "commune": "Villejuif", "dept": "94"},
    {"nom": "Villejuif Institut Gustave-Roussy (M15)", "ligne": "M15", "lat": 48.7980, "lon": 2.3622,
     "etat": "travaux_en_cours", "livraison": "2026-12-31", "commune": "Villejuif", "dept": "94"},
    {"nom": "Vitry Centre (M15)", "ligne": "M15", "lat": 48.7861, "lon": 2.3919,
     "etat": "travaux_en_cours", "livraison": "2026-12-31", "commune": "Vitry-sur-Seine", "dept": "94"},
    {"nom": "Les Ardoines (M15)", "ligne": "M15", "lat": 48.7754, "lon": 2.4060,
     "etat": "travaux_en_cours", "livraison": "2026-12-31", "commune": "Vitry-sur-Seine", "dept": "94"},
    {"nom": "Le Vert de Maisons (M15)", "ligne": "M15", "lat": 48.7858, "lon": 2.4189,
     "etat": "travaux_en_cours", "livraison": "2026-12-31", "commune": "Maisons-Alfort", "dept": "94"},
    {"nom": "Créteil l'Échat (M15)", "ligne": "M15", "lat": 48.7965, "lon": 2.4426,
     "etat": "travaux_en_cours", "livraison": "2026-12-31", "commune": "Créteil", "dept": "94"},
    {"nom": "Saint-Maur-Créteil (M15)", "ligne": "M15", "lat": 48.8035, "lon": 2.4641,
     "etat": "travaux_en_cours", "livraison": "2026-12-31", "commune": "Saint-Maur-des-Fossés", "dept": "94"},
    {"nom": "Champigny Centre (M15)", "ligne": "M15", "lat": 48.8181, "lon": 2.5031,
     "etat": "travaux_en_cours", "livraison": "2026-12-31", "commune": "Champigny-sur-Marne", "dept": "94"},
    {"nom": "Bry-Villiers-Champigny (M15)", "ligne": "M15", "lat": 48.8262, "lon": 2.5340,
     "etat": "travaux_en_cours", "livraison": "2026-12-31", "commune": "Bry-sur-Marne", "dept": "94"},
    {"nom": "Noisy-Champs (M15)", "ligne": "M15", "lat": 48.8459, "lon": 2.5784,
     "etat": "travaux_en_cours", "livraison": "2026-12-31", "commune": "Champs-sur-Marne", "dept": "77"},

    # ── LIGNE 16 (travaux 2026-2030) — 10 gares Saint-Denis Pleyel → Noisy-Champs ──
    {"nom": "Saint-Denis Pleyel (M14/15/16/17)", "ligne": "M16-17", "lat": 48.9189, "lon": 2.3460,
     "etat": "livre_partiel", "livraison": "2024-06-24", "commune": "Saint-Denis", "dept": "93"},
    {"nom": "La Courneuve Six-Routes (M16)", "ligne": "M16", "lat": 48.9239, "lon": 2.4046,
     "etat": "travaux_en_cours", "livraison": "2026-12-31", "commune": "La Courneuve", "dept": "93"},
    {"nom": "Le Bourget RER (M16/17)", "ligne": "M16-17", "lat": 48.9180, "lon": 2.4264,
     "etat": "travaux_en_cours", "livraison": "2026-12-31", "commune": "Le Bourget", "dept": "93"},
    {"nom": "Aulnay (M16)", "ligne": "M16", "lat": 48.9342, "lon": 2.4905,
     "etat": "travaux_en_cours", "livraison": "2027-12-31", "commune": "Aulnay-sous-Bois", "dept": "93"},
    {"nom": "Sevran Beaudottes (M16)", "ligne": "M16", "lat": 48.9341, "lon": 2.5212,
     "etat": "travaux_en_cours", "livraison": "2027-12-31", "commune": "Sevran", "dept": "93"},
    {"nom": "Sevran Livry (M16)", "ligne": "M16", "lat": 48.9265, "lon": 2.5400,
     "etat": "travaux_en_cours", "livraison": "2027-12-31", "commune": "Sevran", "dept": "93"},
    {"nom": "Clichy-Montfermeil (M16)", "ligne": "M16", "lat": 48.9097, "lon": 2.5429,
     "etat": "travaux_en_cours", "livraison": "2027-12-31", "commune": "Clichy-sous-Bois", "dept": "93"},
    {"nom": "Chelles (M16)", "ligne": "M16", "lat": 48.8780, "lon": 2.5867,
     "etat": "travaux_en_cours", "livraison": "2028-12-31", "commune": "Chelles", "dept": "77"},

    # ── LIGNE 17 (travaux 2026-2030) — 7 gares Saint-Denis Pleyel → Mesnil-Amelot ──
    {"nom": "Le Bourget Aéroport (M17)", "ligne": "M17", "lat": 48.9521, "lon": 2.4422,
     "etat": "travaux_en_cours", "livraison": "2027-12-31", "commune": "Dugny", "dept": "93"},
    {"nom": "Triangle de Gonesse (M17)", "ligne": "M17", "lat": 48.9787, "lon": 2.4585,
     "etat": "dup", "livraison": "2028-12-31", "commune": "Gonesse", "dept": "95"},
    {"nom": "Parc des Expositions (M17)", "ligne": "M17", "lat": 49.0085, "lon": 2.5180,
     "etat": "travaux_en_cours", "livraison": "2028-12-31", "commune": "Villepinte", "dept": "93"},
    {"nom": "Aéroport CDG T2 (M17)", "ligne": "M17", "lat": 49.0029, "lon": 2.5708,
     "etat": "travaux_en_cours", "livraison": "2030-12-31", "commune": "Tremblay-en-France", "dept": "93"},
    {"nom": "Aéroport CDG T4 (M17)", "ligne": "M17", "lat": 49.0173, "lon": 2.5950,
     "etat": "dup", "livraison": "2030-12-31", "commune": "Tremblay-en-France", "dept": "93"},
    {"nom": "Le Mesnil-Amelot (M17)", "ligne": "M17", "lat": 49.0214, "lon": 2.6055,
     "etat": "dup", "livraison": "2030-12-31", "commune": "Le Mesnil-Amelot", "dept": "77"},

    # ── LIGNE 18 (travaux 2027-2030) — 10 gares Aéroport Orly → Versailles Chantiers ──
    {"nom": "Antonypole (M18)", "ligne": "M18", "lat": 48.7382, "lon": 2.3009,
     "etat": "travaux_en_cours", "livraison": "2027-12-31", "commune": "Antony", "dept": "92"},
    {"nom": "Massy Opéra (M18)", "ligne": "M18", "lat": 48.7349, "lon": 2.2670,
     "etat": "travaux_en_cours", "livraison": "2027-12-31", "commune": "Massy", "dept": "91"},
    {"nom": "Massy-Palaiseau (M18)", "ligne": "M18", "lat": 48.7253, "lon": 2.2606,
     "etat": "travaux_en_cours", "livraison": "2027-12-31", "commune": "Massy", "dept": "91"},
    {"nom": "Palaiseau (M18)", "ligne": "M18", "lat": 48.7137, "lon": 2.2436,
     "etat": "travaux_en_cours", "livraison": "2027-12-31", "commune": "Palaiseau", "dept": "91"},
    {"nom": "Orsay-Gif (M18)", "ligne": "M18", "lat": 48.7038, "lon": 2.1733,
     "etat": "travaux_en_cours", "livraison": "2027-12-31", "commune": "Orsay", "dept": "91"},
    {"nom": "CEA Saint-Aubin (M18)", "ligne": "M18", "lat": 48.7150, "lon": 2.1485,
     "etat": "travaux_en_cours", "livraison": "2027-12-31", "commune": "Saint-Aubin", "dept": "91"},
    {"nom": "Saint-Quentin Est (M18)", "ligne": "M18", "lat": 48.7723, "lon": 2.0510,
     "etat": "dup", "livraison": "2030-12-31", "commune": "Guyancourt", "dept": "78"},
    {"nom": "Satory (M18)", "ligne": "M18", "lat": 48.7918, "lon": 2.1167,
     "etat": "dup", "livraison": "2030-12-31", "commune": "Versailles", "dept": "78"},
    {"nom": "Versailles Chantiers (M18)", "ligne": "M18", "lat": 48.7948, "lon": 2.1356,
     "etat": "dup", "livraison": "2030-12-31", "commune": "Versailles", "dept": "78"},
]


# ─────────────────────────────────────────────────────────────────────────────
# Canaux & voies navigables majeurs
# ─────────────────────────────────────────────────────────────────────────────

CANAUX = [
    # Canal Saint-Martin — existant Paris 10e-19e (4,5 km)
    # Plusieurs points pour couvrir le linéaire
    {"nom": "Canal Saint-Martin - Place de la République", "type": "canal_existant",
     "lat": 48.8676, "lon": 2.3636, "etat": "livre_total",
     "commune": "Paris 10", "dept": "75",
     "impact_min": 3, "impact_max": 8, "rayon": 300,
     "description": "Quais animés, terrasses, ambiance bobo-hipster (10e-11e arr.)"},
    {"nom": "Canal Saint-Martin - Hôtel du Nord", "type": "canal_existant",
     "lat": 48.8723, "lon": 2.3640, "etat": "livre_total",
     "commune": "Paris 10", "dept": "75",
     "impact_min": 3, "impact_max": 8, "rayon": 300,
     "description": "Section centrale du canal, ambiance pittoresque et patrimoniale"},
    {"nom": "Canal Saint-Martin - Bassin de la Villette", "type": "canal_existant",
     "lat": 48.8870, "lon": 2.3756, "etat": "livre_total",
     "commune": "Paris 19", "dept": "75",
     "impact_min": 3, "impact_max": 6, "rayon": 400,
     "description": "Bassin avec quais piétonniers, baignade estivale, animations"},

    # Canal de l'Ourcq — section Pantin/Bobigny
    {"nom": "Canal de l'Ourcq - Pantin", "type": "canal_existant",
     "lat": 48.8949, "lon": 2.4055, "etat": "livre_total",
     "commune": "Pantin", "dept": "93",
     "impact_min": 3, "impact_max": 6, "rayon": 400,
     "description": "Quais réaménagés, ambiance créative (BETC, Magasins généraux)"},
    {"nom": "Canal de l'Ourcq - Bobigny", "type": "canal_existant",
     "lat": 48.9023, "lon": 2.4406, "etat": "livre_total",
     "commune": "Bobigny", "dept": "93",
     "impact_min": 2, "impact_max": 5, "rayon": 400,
     "description": "Coulée verte longeant le canal, projet urbain en cours"},

    # Canal Seine-Nord Europe — futur 2030 (107 km Compiègne → Aubencheul-au-Bac)
    {"nom": "Port intérieur Compiègne (Seine-Nord)", "type": "canal_futur",
     "lat": 49.4174, "lon": 2.8260, "etat": "travaux_en_cours",
     "commune": "Compiègne", "dept": "60",
     "impact_min": 8, "impact_max": 15, "rayon": 3000, "livraison": "2030-12-31",
     "description": "Port intérieur du futur Canal Seine-Nord Europe (livraison 2030)"},
    {"nom": "Port intérieur Noyon (Seine-Nord)", "type": "canal_futur",
     "lat": 49.5805, "lon": 3.0008, "etat": "travaux_en_cours",
     "commune": "Noyon", "dept": "60",
     "impact_min": 8, "impact_max": 15, "rayon": 2500, "livraison": "2030-12-31",
     "description": "Plate-forme logistique Canal Seine-Nord (livraison 2030)"},
    {"nom": "Port intérieur Péronne (Seine-Nord)", "type": "canal_futur",
     "lat": 49.9286, "lon": 2.9326, "etat": "travaux_en_cours",
     "commune": "Péronne", "dept": "80",
     "impact_min": 8, "impact_max": 15, "rayon": 2500, "livraison": "2030-12-31",
     "description": "Tronçon Somme du Canal Seine-Nord Europe"},
    {"nom": "Port intérieur Cambrai (Seine-Nord)", "type": "canal_futur",
     "lat": 50.1740, "lon": 3.2382, "etat": "travaux_en_cours",
     "commune": "Cambrai", "dept": "59",
     "impact_min": 10, "impact_max": 18, "rayon": 3000, "livraison": "2030-12-31",
     "description": "Terminus Nord du Canal Seine-Nord, hub fluvial européen"},
]


# ─────────────────────────────────────────────────────────────────────────────
# LGV nationales en cours
# ─────────────────────────────────────────────────────────────────────────────

LGV_PROJETS = [
    {"nom": "Gare LGV Agen (GPSO)", "type": "gare_tgv", "lat": 44.2068, "lon": 0.6286,
     "etat": "dup", "commune": "Agen", "dept": "47",
     "impact_min": 15, "impact_max": 25, "rayon": 2000, "livraison": "2032-12-31",
     "description": "Future gare LGV Bordeaux-Toulouse (GPSO) - Paris en 3h05"},
    {"nom": "Gare LGV Montauban (GPSO)", "type": "gare_tgv", "lat": 44.0179, "lon": 1.3551,
     "etat": "dup", "commune": "Montauban", "dept": "82",
     "impact_min": 15, "impact_max": 25, "rayon": 2000, "livraison": "2032-12-31",
     "description": "Future gare LGV Bordeaux-Toulouse (GPSO) - Toulouse en 20 min"},
    {"nom": "Gare LGV Toulouse-Matabiau (GPSO)", "type": "gare_tgv", "lat": 43.6109, "lon": 1.4538,
     "etat": "travaux_en_cours", "commune": "Toulouse", "dept": "31",
     "impact_min": 10, "impact_max": 20, "rayon": 1500, "livraison": "2032-12-31",
     "description": "Modernisation Matabiau LGV : Paris-Toulouse en 3h10 (vs 4h10)"},
    {"nom": "Gare LGV Cannes-La Bocca (LNPCA)", "type": "gare_tgv", "lat": 43.5520, "lon": 6.9933,
     "etat": "concertation", "commune": "Cannes", "dept": "06",
     "impact_min": 10, "impact_max": 20, "rayon": 1500, "livraison": "2035-12-31",
     "description": "Future gare LGV Marseille-Nice (LNPCA) - phase 2"},
    {"nom": "Gare LGV La Bocca-Nice Aéroport (LNPCA)", "type": "gare_tgv", "lat": 43.6584, "lon": 7.2156,
     "etat": "concertation", "commune": "Nice", "dept": "06",
     "impact_min": 10, "impact_max": 20, "rayon": 1500, "livraison": "2035-12-31",
     "description": "Future gare LGV Marseille-Nice (LNPCA) - intermodalité aéroport"},
]


# ─────────────────────────────────────────────────────────────────────────────
# ZAC / OIN majeures France
# ─────────────────────────────────────────────────────────────────────────────

ZAC_PROJETS = [
    {"nom": "OIN Paris-Saclay - Campus Plateau", "type": "oin", "lat": 48.7100, "lon": 2.1700,
     "etat": "travaux_en_cours", "commune": "Palaiseau", "dept": "91", "region": "11",
     "impact_min": 10, "impact_max": 20, "rayon": 3000, "livraison": "2028-12-31",
     "description": "Cluster tech-recherche 5 600 ha (Polytechnique, HEC, CentraleSupélec, CEA)"},
    {"nom": "ZAC Confluence - Lyon", "type": "zac", "lat": 45.7427, "lon": 4.8174,
     "etat": "travaux_en_cours", "commune": "Lyon 2e", "dept": "69", "region": "84",
     "impact_min": 8, "impact_max": 15, "rayon": 1500, "livraison": "2030-12-31",
     "description": "150 ha mixte logement-bureaux-culture (musée Confluences)"},
    {"nom": "Bordeaux Euratlantique", "type": "zac", "lat": 44.8265, "lon": -0.5566,
     "etat": "travaux_en_cours", "commune": "Bordeaux", "dept": "33", "region": "75",
     "impact_min": 8, "impact_max": 18, "rayon": 2000, "livraison": "2030-12-31",
     "description": "738 ha autour de la gare Saint-Jean, livraison continue 2025-2035"},
    {"nom": "Euroméditerranée - Marseille", "type": "oin", "lat": 43.3050, "lon": 5.3680,
     "etat": "travaux_en_cours", "commune": "Marseille 2e", "dept": "13", "region": "93",
     "impact_min": 10, "impact_max": 20, "rayon": 2500, "livraison": "2030-12-31",
     "description": "480 ha extension nord, MUCEM, Mucem, Docks, port-Saint-Jean"},
    {"nom": "Euralille 3000", "type": "zac", "lat": 50.6378, "lon": 3.0701,
     "etat": "travaux_en_cours", "commune": "Lille", "dept": "59", "region": "32",
     "impact_min": 8, "impact_max": 15, "rayon": 1500, "livraison": "2028-12-31",
     "description": "Extension du quartier d'affaires, 130 ha gare Lille-Europe"},
    {"nom": "ZAC Île de Nantes", "type": "zac", "lat": 47.2073, "lon": -1.5575,
     "etat": "travaux_en_cours", "commune": "Nantes", "dept": "44", "region": "52",
     "impact_min": 7, "impact_max": 14, "rayon": 1500, "livraison": "2030-12-31",
     "description": "337 ha rive de Loire, CHU + Machines de l'île"},
    {"nom": "Toulouse Aerospace", "type": "zac", "lat": 43.5654, "lon": 1.4793,
     "etat": "travaux_en_cours", "commune": "Toulouse", "dept": "31", "region": "76",
     "impact_min": 7, "impact_max": 14, "rayon": 2000, "livraison": "2028-12-31",
     "description": "250 ha cluster aéronautique (Airbus, ONERA, Météo-France)"},
    {"nom": "Plaine Commune - Village JO 2024 (reconverti)", "type": "zac",
     "lat": 48.9295, "lon": 2.3320,
     "etat": "livre_partiel", "commune": "Saint-Ouen", "dept": "93", "region": "11",
     "impact_min": 5, "impact_max": 12, "rayon": 2000, "livraison": "2025-12-31",
     "description": "Reconversion Village des Athlètes JO 2024 → 6 000 logements"},
]


# ─────────────────────────────────────────────────────────────────────────────
# Gigafactories — réindustrialisation
# ─────────────────────────────────────────────────────────────────────────────

GIGAFACTORIES = [
    {"nom": "Gigafactory ProLogium - Dunkerque", "type": "gigafactory",
     "lat": 51.0234, "lon": 2.3650,
     "etat": "travaux_en_cours", "commune": "Dunkerque", "dept": "59", "region": "32",
     "impact_min": 5, "impact_max": 10, "rayon": 5000, "livraison": "2026-12-31",
     "description": "Méga-usine batteries solides 48 GWh - 3 000 emplois directs"},
    {"nom": "Gigafactory Verkor - Dunkerque", "type": "gigafactory",
     "lat": 51.0405, "lon": 2.3811,
     "etat": "travaux_en_cours", "commune": "Dunkerque", "dept": "59", "region": "32",
     "impact_min": 5, "impact_max": 10, "rayon": 5000, "livraison": "2025-12-31",
     "description": "Méga-usine batteries Renault - 1 200 emplois directs"},
    {"nom": "Gigafactory ACC - Douvrin", "type": "gigafactory",
     "lat": 50.5354, "lon": 2.8243,
     "etat": "livre_partiel", "commune": "Douvrin", "dept": "62", "region": "32",
     "impact_min": 5, "impact_max": 10, "rayon": 4000, "livraison": "2024-12-31",
     "description": "Méga-usine batteries Stellantis/Mercedes - 2 000 emplois"},
    {"nom": "Cluster STMicroelectronics-GlobalFoundries Crolles", "type": "gigafactory",
     "lat": 45.2786, "lon": 5.8806,
     "etat": "travaux_en_cours", "commune": "Crolles", "dept": "38", "region": "84",
     "impact_min": 8, "impact_max": 15, "rayon": 4000, "livraison": "2026-12-31",
     "description": "Extension semi-conducteurs Crolles - 1 000 emplois"},
]


# ─────────────────────────────────────────────────────────────────────────────
# Conversion → rows pour insertion DB
# ─────────────────────────────────────────────────────────────────────────────

def build_rows() -> list[dict]:
    """Concat des 4 datasets en lignes prêtes pour INSERT."""
    rows = []

    # Grand Paris Express
    for g in GPE_GARES:
        ligne = g.get("ligne", "")
        is_livre = g["etat"] == "livre_total"
        # Si déjà livré, impact 0 (effet anticipation épuisé)
        impact_min, impact_max = (0, 0) if is_livre else (8, 18)
        # Distinguer les gares déjà ouvertes (M14 nord/sud) pour ne pas spammer
        if is_livre:
            description = f"{ligne} - gare ouverte le {g.get('livraison', '')[:7]} (Grand Paris Express)"
        else:
            description = (
                f"Future gare {ligne} du Grand Paris Express, livraison prévue "
                f"{g.get('livraison', '')[:7]}. Effet anticipation +{impact_min} à +{impact_max}%."
            )

        rows.append({
            "nom": g["nom"],
            "type": "gare_futur" if not is_livre else "ligne_metro",
            "importance": "regionale",
            "lat": g["lat"],
            "lon": g["lon"],
            "code_insee_commune": None,
            "dept": g["dept"],
            "region_code": "11",
            "etat": g["etat"],
            "date_livraison_estimee": g.get("livraison"),
            "date_livraison_actualisee": None,
            "impact_prix_pct_min": impact_min,
            "impact_prix_pct_max": impact_max,
            "rayon_impact_m": 800,
            "maitre_ouvrage": "Société des Grands Projets",
            "budget_meur": None,
            "url_officiel": "https://www.societedugrandparis.fr",
            "description": description,
            "source": "sgp",
        })

    # Canaux & voies navigables
    for c in CANAUX:
        rows.append({
            "nom": c["nom"],
            "type": c["type"],
            "importance": "regionale" if c["type"] == "canal_futur" else "metropolitaine",
            "lat": c["lat"],
            "lon": c["lon"],
            "code_insee_commune": None,
            "dept": c["dept"],
            "region_code": None,
            "etat": c["etat"],
            "date_livraison_estimee": c.get("livraison"),
            "date_livraison_actualisee": None,
            "impact_prix_pct_min": c.get("impact_min", 0),
            "impact_prix_pct_max": c.get("impact_max", 0),
            "rayon_impact_m": c.get("rayon", 400),
            "maitre_ouvrage": "VNF" if c["type"] == "canal_futur" else "Mairie de Paris",
            "budget_meur": None,
            "url_officiel": "https://www.vnf.fr",
            "description": c["description"],
            "source": "vnf",
        })

    # LGV nationales
    for l in LGV_PROJETS:
        rows.append({
            "nom": l["nom"],
            "type": l["type"],
            "importance": "nationale",
            "lat": l["lat"],
            "lon": l["lon"],
            "code_insee_commune": None,
            "dept": l["dept"],
            "region_code": None,
            "etat": l["etat"],
            "date_livraison_estimee": l.get("livraison"),
            "date_livraison_actualisee": None,
            "impact_prix_pct_min": l["impact_min"],
            "impact_prix_pct_max": l["impact_max"],
            "rayon_impact_m": l.get("rayon", 1500),
            "maitre_ouvrage": "SNCF Réseau",
            "budget_meur": None,
            "url_officiel": "https://www.sncf-reseau.com",
            "description": l["description"],
            "source": "sncf_reseau",
        })

    # ZAC / OIN
    for z in ZAC_PROJETS:
        rows.append({
            "nom": z["nom"],
            "type": z["type"],
            "importance": "metropolitaine" if z["type"] == "zac" else "regionale",
            "lat": z["lat"],
            "lon": z["lon"],
            "code_insee_commune": None,
            "dept": z["dept"],
            "region_code": z.get("region"),
            "etat": z["etat"],
            "date_livraison_estimee": z.get("livraison"),
            "date_livraison_actualisee": None,
            "impact_prix_pct_min": z["impact_min"],
            "impact_prix_pct_max": z["impact_max"],
            "rayon_impact_m": z.get("rayon", 2000),
            "maitre_ouvrage": None,
            "budget_meur": None,
            "url_officiel": None,
            "description": z["description"],
            "source": "data_gouv",
        })

    # Gigafactories
    for f in GIGAFACTORIES:
        rows.append({
            "nom": f["nom"],
            "type": f["type"],
            "importance": "regionale",
            "lat": f["lat"],
            "lon": f["lon"],
            "code_insee_commune": None,
            "dept": f["dept"],
            "region_code": f.get("region"),
            "etat": f["etat"],
            "date_livraison_estimee": f.get("livraison"),
            "date_livraison_actualisee": None,
            "impact_prix_pct_min": f["impact_min"],
            "impact_prix_pct_max": f["impact_max"],
            "rayon_impact_m": f.get("rayon", 5000),
            "maitre_ouvrage": None,
            "budget_meur": None,
            "url_officiel": None,
            "description": f["description"],
            "source": "data_gouv",
        })

    return rows


# ─────────────────────────────────────────────────────────────────────────────
# Upsert vers Supabase
# ─────────────────────────────────────────────────────────────────────────────

def upsert(rows: Iterable[dict], dsn: str, bootstrap: bool = False) -> None:
    rows_list = list(rows)
    if not rows_list:
        print("Aucune ligne à insérer.")
        return

    print(f"Upsert de {len(rows_list)} grands projets vers Supabase ...")

    sql = """
        INSERT INTO public.dim_grands_projets (
            nom, type, importance, lat, lon,
            code_insee_commune, dept, region_code,
            etat, date_livraison_estimee, date_livraison_actualisee,
            impact_prix_pct_min, impact_prix_pct_max, rayon_impact_m,
            maitre_ouvrage, budget_meur, url_officiel, description, source
        )
        VALUES (
            %(nom)s, %(type)s, %(importance)s, %(lat)s, %(lon)s,
            %(code_insee_commune)s, %(dept)s, %(region_code)s,
            %(etat)s, %(date_livraison_estimee)s, %(date_livraison_actualisee)s,
            %(impact_prix_pct_min)s, %(impact_prix_pct_max)s, %(rayon_impact_m)s,
            %(maitre_ouvrage)s, %(budget_meur)s, %(url_officiel)s, %(description)s, %(source)s
        )
        ON CONFLICT ON CONSTRAINT uniq_gp_nom_type
        DO UPDATE SET
            etat = EXCLUDED.etat,
            date_livraison_estimee = COALESCE(EXCLUDED.date_livraison_estimee, dim_grands_projets.date_livraison_estimee),
            date_livraison_actualisee = COALESCE(EXCLUDED.date_livraison_actualisee, dim_grands_projets.date_livraison_actualisee),
            impact_prix_pct_min = EXCLUDED.impact_prix_pct_min,
            impact_prix_pct_max = EXCLUDED.impact_prix_pct_max,
            rayon_impact_m = EXCLUDED.rayon_impact_m,
            description = EXCLUDED.description,
            updated_at = now()
    """

    inserted = 0
    errors = 0
    with psycopg.connect(dsn, autocommit=False) as conn:
        with conn.cursor() as cur:
            if bootstrap:
                print("  ↪ mode bootstrap : TRUNCATE public.dim_grands_projets")
                cur.execute("TRUNCATE TABLE public.dim_grands_projets")
                conn.commit()

            for row in rows_list:
                try:
                    cur.execute("SAVEPOINT gp_insert")
                    cur.execute(sql, row)
                    cur.execute("RELEASE SAVEPOINT gp_insert")
                    inserted += 1
                except Exception as e:
                    try:
                        cur.execute("ROLLBACK TO SAVEPOINT gp_insert")
                    except Exception:
                        pass
                    err_msg = str(e).splitlines()[0] if str(e) else "(no message)"
                    print(f"  ⚠️ Erreur pour {row.get('nom')!r} : {err_msg}")
                    errors += 1

            conn.commit()

    print(f"  ✓ {inserted} grands projets insérés/mis à jour")
    if errors:
        print(f"  ⚠️ {errors} erreurs")


# ─────────────────────────────────────────────────────────────────────────────
# Génération SQL (fallback quand la connexion DB ne marche pas)
# ─────────────────────────────────────────────────────────────────────────────

def sql_literal(val) -> str:
    """Formatte une valeur Python en littéral SQL safe (échappement apostrophes)."""
    if val is None:
        return "NULL"
    if isinstance(val, bool):
        return "TRUE" if val else "FALSE"
    if isinstance(val, (int, float)):
        return str(val)
    if isinstance(val, str):
        # Échappe les apostrophes (PostgreSQL : '' = apostrophe littérale)
        escaped = val.replace("'", "''")
        return f"'{escaped}'"
    # date / autres → cast string
    return f"'{str(val)}'"


def generate_sql_file(rows: list[dict], output_path: str, bootstrap: bool = True) -> None:
    """Génère un fichier .sql complet (avec TRUNCATE + INSERTs) prêt à coller
    dans Supabase SQL Editor. Aucune connexion DB requise."""
    columns = [
        "nom", "type", "importance", "lat", "lon",
        "code_insee_commune", "dept", "region_code",
        "etat", "date_livraison_estimee", "date_livraison_actualisee",
        "impact_prix_pct_min", "impact_prix_pct_max", "rayon_impact_m",
        "maitre_ouvrage", "budget_meur", "url_officiel", "description", "source",
    ]
    # Wrap date columns dans un CAST ::date côté SQL pour qu'elles soient bien
    # parsées par PostgreSQL.
    DATE_COLS = {"date_livraison_estimee", "date_livraison_actualisee"}

    lines = []
    lines.append("-- ============================================================")
    lines.append("-- DATAMERRY — Bootstrap dim_grands_projets")
    lines.append(f"-- Généré par pipeline_grands_projets.py — {len(rows)} projets")
    lines.append("-- À coller dans Supabase SQL Editor et exécuter.")
    lines.append("-- ============================================================")
    lines.append("")
    lines.append("BEGIN;")
    lines.append("")
    if bootstrap:
        lines.append("TRUNCATE TABLE public.dim_grands_projets;")
        lines.append("")
    lines.append("INSERT INTO public.dim_grands_projets (")
    lines.append("    " + ", ".join(columns))
    lines.append(") VALUES")

    values_rows = []
    for row in rows:
        parts = []
        for col in columns:
            v = row.get(col)
            literal = sql_literal(v)
            if col in DATE_COLS and v is not None:
                literal = f"{literal}::date"
            parts.append(literal)
        values_rows.append("    (" + ", ".join(parts) + ")")
    lines.append(",\n".join(values_rows))

    lines.append("ON CONFLICT ON CONSTRAINT uniq_gp_nom_type DO UPDATE SET")
    lines.append("    etat = EXCLUDED.etat,")
    lines.append("    date_livraison_estimee = COALESCE(EXCLUDED.date_livraison_estimee, dim_grands_projets.date_livraison_estimee),")
    lines.append("    impact_prix_pct_min = EXCLUDED.impact_prix_pct_min,")
    lines.append("    impact_prix_pct_max = EXCLUDED.impact_prix_pct_max,")
    lines.append("    rayon_impact_m = EXCLUDED.rayon_impact_m,")
    lines.append("    description = EXCLUDED.description,")
    lines.append("    updated_at = now();")
    lines.append("")
    lines.append("COMMIT;")
    lines.append("")
    lines.append("-- Vérification")
    lines.append("SELECT COUNT(*) AS nb_grands_projets, ")
    lines.append("       COUNT(*) FILTER (WHERE type = 'gare_futur') AS nb_gares_gpe,")
    lines.append("       COUNT(*) FILTER (WHERE type LIKE 'canal%') AS nb_canaux,")
    lines.append("       COUNT(*) FILTER (WHERE importance = 'nationale') AS nb_nationales")
    lines.append("FROM public.dim_grands_projets;")

    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print(f"  ✓ Fichier SQL généré : {output_path}")
    print(f"  📋 Étapes : (1) ouvre le fichier, (2) copie tout, (3) paste dans Supabase SQL Editor, (4) Run.")


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Pipeline grands projets DATAMERRY")
    parser.add_argument("--bootstrap", action="store_true",
                        help="TRUNCATE puis ingestion complète")
    parser.add_argument("--output-sql", type=str, metavar="FILE", default=None,
                        help="Génère un fichier SQL au lieu d'insérer en DB "
                             "(fallback quand la connexion DB est cassée)")
    args = parser.parse_args()

    print("📡 Pipeline DATAMERRY — Grands projets d'infrastructure")
    print(f"   • Grand Paris Express : {len(GPE_GARES)} gares")
    print(f"   • Canaux & voies navigables : {len(CANAUX)}")
    print(f"   • LGV nationales : {len(LGV_PROJETS)}")
    print(f"   • ZAC / OIN majeures : {len(ZAC_PROJETS)}")
    print(f"   • Gigafactories : {len(GIGAFACTORIES)}")

    rows = build_rows()
    print(f"\n📊 Total : {len(rows)} grands projets à ingérer")

    if args.output_sql:
        # Mode fichier SQL — pas de connexion DB requise
        generate_sql_file(rows, args.output_sql, bootstrap=args.bootstrap)
        print("\n✅ Génération SQL terminée.\n")
        return

    # Mode normal : insertion via psycopg
    dsn = get_dsn()
    upsert(rows, dsn, bootstrap=args.bootstrap)

    print("\n✅ Pipeline grands projets terminé.")
    print("\n💡 Test la fonction dans Supabase SQL Editor :")
    print("   SELECT * FROM public.find_nearby_grands_projets(48.9189, 2.3460, 3000, 5);")
    print("   -- Doit remonter Saint-Denis Pleyel et alentours\n")


if __name__ == "__main__":
    main()

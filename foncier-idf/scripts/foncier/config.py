"""Configuration du pipeline foncier."""

from __future__ import annotations

import os
from dataclasses import dataclass, field

from dotenv import load_dotenv

load_dotenv()


# ─────────────────────────────────────────────
# Règles PLU par sous-zone
# Chaque sous-zone définit :
#   - max_height : hauteur max (m)
#   - ces : coefficient d'emprise au sol (0-1)
#   - cos : coefficient d'occupation des sols (ratio SDP/surface terrain), None si non plafonné
#   - green_ratio : ratio espace vert minimum (0-1)
#   - setback_front : recul en mètres par rapport à la voie
#   - setback_side : recul latéral en mètres (prospect)
#   - vocation : "residentiel", "economique", "mixte"
#   - parking_per_logement : dict par typologie {T1: 1, T2: 1.5, ...}
#   - parking_per_100m2_eco : nb places / 100 m² SDP activité économique
#   - description : texte descriptif de la sous-zone
# ─────────────────────────────────────────────

@dataclass(frozen=True)
class PLUSubZoneRule:
    code: str
    zone_family: str  # U, AU, A, N
    vocation: str  # residentiel, economique, mixte
    max_height: float
    ces: float  # emprise au sol
    cos: float | None  # None = non plafonné (PLU-i moderne)
    green_ratio: float
    setback_front: float
    setback_side: float
    parking_per_logement: dict[str, float] = field(default_factory=dict)
    parking_per_100m2_eco: float = 1.0
    description: str = ""


# Règles PLU-i EPT Boucle Nord de Seine (92)
# Source : PLU-i BNS approuvé
PLU_RULES_BNS: dict[str, PLUSubZoneRule] = {
    "UA": PLUSubZoneRule(
        code="UA", zone_family="U", vocation="mixte",
        max_height=25.0, ces=0.80, cos=None,
        green_ratio=0.10, setback_front=0.0, setback_side=0.0,
        parking_per_logement={"T1": 1, "T2": 1.5, "T3": 1.5, "T4": 1.5, "T5": 2},
        parking_per_100m2_eco=1.0,
        description="Centre-ville dense, alignement sur voie, mixité fonctionnelle",
    ),
    "UB": PLUSubZoneRule(
        code="UB", zone_family="U", vocation="residentiel",
        max_height=18.0, ces=0.60, cos=None,
        green_ratio=0.20, setback_front=3.0, setback_side=3.0,
        parking_per_logement={"T1": 1, "T2": 1.5, "T3": 1.5, "T4": 1.5, "T5": 2},
        parking_per_100m2_eco=1.0,
        description="Résidentiel collectif, tissu urbain constitué",
    ),
    "UC": PLUSubZoneRule(
        code="UC", zone_family="U", vocation="residentiel",
        max_height=12.0, ces=0.40, cos=None,
        green_ratio=0.30, setback_front=5.0, setback_side=3.0,
        parking_per_logement={"T1": 1, "T2": 1.5, "T3": 1.5, "T4": 1.5, "T5": 2},
        parking_per_100m2_eco=1.0,
        description="Résidentiel pavillonnaire / petit collectif",
    ),
    "UD": PLUSubZoneRule(
        code="UD", zone_family="U", vocation="residentiel",
        max_height=9.0, ces=0.30, cos=None,
        green_ratio=0.40, setback_front=5.0, setback_side=4.0,
        parking_per_logement={"T1": 1, "T2": 1, "T3": 1.5, "T4": 1.5, "T5": 2},
        parking_per_100m2_eco=1.0,
        description="Résidentiel individuel / faible densité",
    ),
    "UE": PLUSubZoneRule(
        code="UE", zone_family="U", vocation="economique",
        max_height=15.0, ces=0.60, cos=None,
        green_ratio=0.15, setback_front=5.0, setback_side=5.0,
        parking_per_logement={},
        parking_per_100m2_eco=2.0,
        description="Activités économiques, bureaux, commerces",
    ),
    "UX": PLUSubZoneRule(
        code="UX", zone_family="U", vocation="economique",
        max_height=20.0, ces=0.65, cos=None,
        green_ratio=0.15, setback_front=5.0, setback_side=5.0,
        parking_per_logement={},
        parking_per_100m2_eco=2.5,
        description="Zone d'activité industrielle / logistique",
    ),
    "UP": PLUSubZoneRule(
        code="UP", zone_family="U", vocation="mixte",
        max_height=50.0, ces=0.70, cos=None,
        green_ratio=0.15, setback_front=0.0, setback_side=0.0,
        parking_per_logement={"T1": 1, "T2": 1.5, "T3": 1.5, "T4": 1.5, "T5": 2},
        parking_per_100m2_eco=1.5,
        description="Zone de projet / secteur de renouvellement urbain (OAP)",
    ),
    "AU": PLUSubZoneRule(
        code="AU", zone_family="AU", vocation="mixte",
        max_height=15.0, ces=0.50, cos=None,
        green_ratio=0.25, setback_front=5.0, setback_side=4.0,
        parking_per_logement={"T1": 1, "T2": 1.5, "T3": 1.5, "T4": 1.5, "T5": 2},
        parking_per_100m2_eco=1.0,
        description="Zone à urbaniser, constructible sous conditions",
    ),
    "A": PLUSubZoneRule(
        code="A", zone_family="A", vocation="residentiel",
        max_height=7.0, ces=0.10, cos=None,
        green_ratio=0.70, setback_front=10.0, setback_side=5.0,
        parking_per_logement={"T1": 1, "T2": 1, "T3": 1, "T4": 1.5, "T5": 2},
        parking_per_100m2_eco=0.5,
        description="Zone agricole, construction très limitée",
    ),
    "N": PLUSubZoneRule(
        code="N", zone_family="N", vocation="residentiel",
        max_height=7.0, ces=0.05, cos=None,
        green_ratio=0.80, setback_front=10.0, setback_side=10.0,
        parking_per_logement={},
        parking_per_100m2_eco=0.0,
        description="Zone naturelle, inconstructible sauf exceptions",
    ),
}

# Fallback pour les communes sans PLU-i détaillé
PLU_RULES_DEFAULT = PLU_RULES_BNS


# ─────────────────────────────────────────────
# Coûts parking souterrain
# Source : cours prospection foncière
# 1 place = 5 + 5 + 6 = 16 m² + circulation ≈ 27 m²/place
# ─────────────────────────────────────────────
PARKING_COST_PER_PLACE = 13_500.0  # €/place en sous-sol (standard)
PARKING_SURFACE_PER_PLACE = 27.0  # m²/place (emprise + moitié circulation)

# Surface moyenne logement par typologie (m² SDP)
SURFACE_MOYENNE_PAR_TYPO: dict[str, float] = {
    "T1": 30.0,
    "T2": 45.0,
    "T3": 65.0,
    "T4": 80.0,
    "T5": 100.0,
}

# Mix typologique par défaut (répartition des logements)
MIX_TYPOLOGIQUE_DEFAULT: dict[str, float] = {
    "T1": 0.10,
    "T2": 0.25,
    "T3": 0.35,
    "T4": 0.20,
    "T5": 0.10,
}

# ─────────────────────────────────────────────
# Taxe d'aménagement
# Valeur forfaitaire 2025 (Île-de-France) : 854 €/m² SDP
# Taux communal : entre 0% et 5% (variable par commune)
# ─────────────────────────────────────────────
TAXE_AMENAGEMENT_VALEUR_FORFAITAIRE = 854.0  # €/m² SDP (IDF 2025)
TAXE_AMENAGEMENT_TAUX_DEFAULT = 0.05  # 5% par défaut

# Taux par commune (code INSEE → taux)
# Source : délibérations communales
TAXE_AMENAGEMENT_TAUX_COMMUNES: dict[str, float] = {
    "92078": 0.05,  # Villeneuve-la-Garenne
    "92025": 0.05,  # Colombes
    "92004": 0.05,  # Asnières-sur-Seine
    "92035": 0.05,  # Gennevilliers
    "92024": 0.05,  # Clichy
    "92009": 0.05,  # Bois-Colombes
}


@dataclass(frozen=True)
class Settings:
    pg_host: str
    pg_port: int
    pg_db: str
    pg_user: str
    pg_password: str

    # Heuristiques urbanistiques par défaut (fallback si pas de sous-zone PLU)
    default_max_height_u: float = 12.0
    default_max_height_au: float = 10.0
    default_max_footprint_u: float = 0.40
    default_max_footprint_au: float = 0.35
    default_green_ratio_u: float = 0.20
    default_green_ratio_au: float = 0.25
    default_setback_penalty: float = 0.85
    default_parking_penalty: float = 0.90

    # Bilan promoteur
    construction_cost_m2: float = 1300.0
    vrd_cost_m2: float = 100.0
    sales_fee_ratio: float = 0.03
    margin_ratio: float = 0.08
    sellable_ratio: float = 0.75

    # Coûts sous-sol
    parking_cost_per_place: float = PARKING_COST_PER_PLACE
    parking_surface_per_place: float = PARKING_SURFACE_PER_PLACE

    # Taxe d'aménagement
    taxe_amenagement_valeur_forfaitaire: float = TAXE_AMENAGEMENT_VALEUR_FORFAITAIRE
    taxe_amenagement_taux_default: float = TAXE_AMENAGEMENT_TAUX_DEFAULT


def get_settings() -> Settings:
    return Settings(
        pg_host=os.environ["SUPABASE_DB_HOST"],
        pg_port=int(os.environ.get("SUPABASE_DB_PORT", "5432")),
        pg_db=os.environ.get("SUPABASE_DB_NAME", "postgres"),
        pg_user=os.environ.get("SUPABASE_DB_USER", "postgres"),
        pg_password=os.environ["SUPABASE_DB_PASSWORD"],
    )

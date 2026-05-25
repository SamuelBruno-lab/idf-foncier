#!/usr/bin/env python3
"""
DATAMERRY — Audit qualité : détecte les hulls HDBSCAN débordants.

Pour chaque cluster de `dvf_hdbscan_zones`, calcule le pourcentage de son
polygone qui déborde EN DEHORS du contour officiel de sa commune (IGN via
geo.api.gouv.fr). Si > 5%, c'est un bug visuel à corriger en relançant le
pipeline (qui depuis 2026-05-25 applique le clip commune).

Usage :
  # Auditer toute la France
  python analyses/validate_hulls_commune.py

  # Auditer un département
  python analyses/validate_hulls_commune.py --dept 94

  # Modifier le seuil de tolérance (défaut 5%)
  python analyses/validate_hulls_commune.py --threshold 0.05

  # Générer une carte HTML des zones débordantes
  python analyses/validate_hulls_commune.py --dept 94 --map

Sortie :
  analyses/output/hulls_validation.csv     — toutes les zones avec score débordement
  analyses/output/hulls_validation_map.html — carte folium des zones débordantes (--map)

Dépendances :
  pip install 'psycopg[binary]' pandas shapely requests
  pip install folium  (uniquement si --map)
"""

import argparse
import os
import sys
from pathlib import Path

import pandas as pd

try:
    import psycopg
    from shapely.geometry import Polygon
except ImportError as e:
    print(f"❌ Dépendance manquante : {e}")
    print("   pip install 'psycopg[binary]' shapely pandas")
    sys.exit(1)

# Réutilise les fonctions du pipeline (fetch_commune_polygon avec cache mémoire)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
try:
    from pipeline_hdbscan_idf import fetch_commune_polygon
except ImportError:
    print("❌ Impossible d'importer pipeline_hdbscan_idf. Vérifie que tu es bien à la racine du repo.")
    sys.exit(1)


OUT_DIR = Path(__file__).resolve().parent / "output"
OUT_DIR.mkdir(exist_ok=True)


# ─────────────────────────────────────────────────────────────────────────────
# Chargement zones depuis Supabase
# ─────────────────────────────────────────────────────────────────────────────

def load_zones(conn, dept: str | None, table: str) -> pd.DataFrame:
    where = "hull_coords IS NOT NULL"
    if dept:
        where += f" AND code_commune LIKE '{dept}%%'"
    sql = f"""
        SELECT id::text AS zone_id, code_commune, type_local, count,
               prix_m2_median, centroid_lat, centroid_lon, hull_coords
        FROM public.{table}
        WHERE {where}
        ORDER BY code_commune, type_local
    """
    print(f"▶ Chargement zones depuis public.{table}…")
    df = pd.read_sql(sql, conn)
    print(f"  ✅ {len(df):,} zones à valider")
    return df


# ─────────────────────────────────────────────────────────────────────────────
# Validation
# ─────────────────────────────────────────────────────────────────────────────

def validate_one(row, threshold_pct: float) -> dict:
    """
    Calcule le ratio area_outside / area_total pour une zone.

    Convention : hull_coords est en [(lat, lon), ...] — cohérent avec
    fetch_commune_polygon() qui retourne un Polygon en (lat, lon) aussi.
    """
    result = {
        "zone_id": row.zone_id,
        "code_commune": row.code_commune,
        "type_local": row.type_local,
        "count": row.count,
        "prix_m2_median": float(row.prix_m2_median) if row.prix_m2_median is not None else None,
        "centroid_lat": float(row.centroid_lat) if row.centroid_lat is not None else None,
        "centroid_lon": float(row.centroid_lon) if row.centroid_lon is not None else None,
        "area_total_deg2": None,
        "area_outside_deg2": None,
        "debordement_pct": None,
        "status": "unknown",
    }

    commune_poly = fetch_commune_polygon(row.code_commune)
    if commune_poly is None or commune_poly.is_empty:
        result["status"] = "no_commune_polygon"
        return result

    if not row.hull_coords or len(row.hull_coords) < 4:
        result["status"] = "invalid_hull"
        return result

    try:
        hull_poly = Polygon(row.hull_coords)
        if hull_poly.is_empty or not hull_poly.is_valid:
            # Tentative de fix pour les polygones auto-intersectants
            hull_poly = hull_poly.buffer(0)
            if hull_poly.is_empty:
                result["status"] = "invalid_hull_geom"
                return result

        total_area = hull_poly.area
        if total_area == 0:
            result["status"] = "zero_area"
            return result

        inside = hull_poly.intersection(commune_poly).area
        outside = max(0.0, total_area - inside)
        pct_outside = (outside / total_area) * 100

        result["area_total_deg2"] = round(total_area, 10)
        result["area_outside_deg2"] = round(outside, 10)
        result["debordement_pct"] = round(pct_outside, 2)
        result["status"] = "ok" if pct_outside < threshold_pct * 100 else "debord"
    except Exception as e:
        result["status"] = f"error:{type(e).__name__}"

    return result


def validate_all(zones: pd.DataFrame, threshold_pct: float) -> pd.DataFrame:
    print(f"\n▶ Validation hull × commune (seuil = {threshold_pct*100:.1f}%)…")
    results = []
    n = len(zones)
    for i, row in enumerate(zones.itertuples(index=False), 1):
        results.append(validate_one(row, threshold_pct))
        if i % 500 == 0 or i == n:
            print(f"  [{i}/{n}] zones traitées")
    return pd.DataFrame(results)


# ─────────────────────────────────────────────────────────────────────────────
# Rendu carte folium (optionnel)
# ─────────────────────────────────────────────────────────────────────────────

def render_map(zones: pd.DataFrame, results: pd.DataFrame, dept: str | None) -> Path | None:
    try:
        import folium  # noqa: PLC0415
    except ImportError:
        print("⚠️ folium non installé — skip carte. (pip install folium)")
        return None

    merged = zones.merge(results[["zone_id", "debordement_pct", "status"]], on="zone_id")
    debord = merged[merged["status"] == "debord"]
    if debord.empty:
        print("  ✅ Aucune zone débordante → pas de carte à générer")
        return None

    # Centre carte = barycentre des zones débordantes
    centre_lat = debord["centroid_lat"].mean()
    centre_lon = debord["centroid_lon"].mean()
    m = folium.Map(location=[centre_lat, centre_lon], zoom_start=11, tiles="cartodbpositron")

    for row in debord.itertuples(index=False):
        # hull_coords est en (lat, lon) — convention folium compatible
        try:
            color = (
                "#ef4444" if row.debordement_pct > 30
                else "#f97316" if row.debordement_pct > 15
                else "#fbbf24"
            )
            folium.Polygon(
                locations=row.hull_coords,
                color=color,
                weight=2,
                fill=True,
                fill_opacity=0.4,
                popup=folium.Popup(
                    f"<b>Zone {row.zone_id[:8]}</b><br>"
                    f"Commune : {row.code_commune}<br>"
                    f"Type : {row.type_local}<br>"
                    f"Transactions : {row.count}<br>"
                    f"Prix m² médian : {row.prix_m2_median:.0f}€<br>"
                    f"<b>Débordement : {row.debordement_pct:.1f}%</b>",
                    max_width=300,
                ),
            ).add_to(m)
        except Exception:
            continue

    out = OUT_DIR / f"hulls_validation_map{'_' + dept if dept else ''}.html"
    m.save(str(out))
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dept", help="Filtrer sur un département (ex: 94)")
    parser.add_argument(
        "--threshold",
        type=float,
        default=0.05,
        help="Seuil de débordement à signaler (défaut 0.05 = 5%%)",
    )
    parser.add_argument(
        "--table",
        default="dvf_hdbscan_zones",
        choices=["dvf_hdbscan_zones", "dvf_hdbscan_zones_5y"],
        help="Table de zones à auditer (défaut: dvf_hdbscan_zones adaptive)",
    )
    parser.add_argument("--map", action="store_true", help="Génère une carte folium des débordants")
    args = parser.parse_args()

    uri = os.environ.get("SUPABASE_DB_URL") or os.environ.get("DATABASE_URL")
    if not uri:
        print("❌ SUPABASE_DB_URL manquante. Format : postgresql://...")
        sys.exit(1)

    with psycopg.connect(uri, connect_timeout=15) as conn:
        zones = load_zones(conn, dept=args.dept, table=args.table)
        if zones.empty:
            print("⚠️ Aucune zone à auditer.")
            sys.exit(0)
        results = validate_all(zones, threshold_pct=args.threshold)

    # CSV
    out_csv = OUT_DIR / f"hulls_validation{'_' + args.dept if args.dept else ''}.csv"
    results.to_csv(out_csv, index=False)

    # Stats récap
    n_total = len(results)
    by_status = results["status"].value_counts().to_dict()
    n_ok = by_status.get("ok", 0)
    n_debord = by_status.get("debord", 0)
    n_skipped = sum(v for k, v in by_status.items() if k not in ("ok", "debord"))

    # Sous-catégories de débordement
    debord_df = results[results["status"] == "debord"]
    n_critical = (debord_df["debordement_pct"] >= 30).sum()
    n_severe = ((debord_df["debordement_pct"] >= 15) & (debord_df["debordement_pct"] < 30)).sum()
    n_mild = ((debord_df["debordement_pct"] >= 5) & (debord_df["debordement_pct"] < 15)).sum()

    print("\n" + "═" * 66)
    print("  AUDIT HULLS DATAMERRY — résultats")
    print("═" * 66)
    print(f"  Total zones auditées       : {n_total:,}")
    print(f"  ✅ Conformes (< {args.threshold*100:.0f}%)        : {n_ok:,}  ({n_ok/n_total*100:.1f}%)")
    print(f"  🔴 Débordent ≥ {args.threshold*100:.0f}%          : {n_debord:,}  ({n_debord/n_total*100:.1f}%)")
    if n_debord > 0:
        print(f"     • Critique (≥ 30%)        : {n_critical:,}")
        print(f"     • Sévère    (15-30%)      : {n_severe:,}")
        print(f"     • Mild      ( 5-15%)      : {n_mild:,}")
    if n_skipped > 0:
        print(f"  ⚠️ Skip (data invalide)     : {n_skipped:,}")
        for k, v in by_status.items():
            if k not in ("ok", "debord"):
                print(f"     • {k:24s}: {v:,}")

    # Top 20 des pires
    if n_debord > 0:
        print("\n  🔴 Top 20 des pires débordants :")
        top = debord_df.nlargest(20, "debordement_pct")[
            ["zone_id", "code_commune", "type_local", "count", "debordement_pct"]
        ].copy()
        top["zone_id"] = top["zone_id"].str.slice(0, 8) + "…"
        for r in top.itertuples(index=False):
            print(
                f"     {r.zone_id} | {r.code_commune} | {r.type_local:35s} | "
                f"{r.count:>4} ventes | {r.debordement_pct:>6.2f}% débord"
            )

        # Communes les plus touchées
        commune_stats = (
            debord_df.groupby("code_commune")
            .agg(
                n_zones_debord=("zone_id", "count"),
                debord_max_pct=("debordement_pct", "max"),
                debord_med_pct=("debordement_pct", "median"),
            )
            .sort_values("n_zones_debord", ascending=False)
            .head(15)
        )
        if not commune_stats.empty:
            print("\n  🗺️ Top 15 communes à régénérer en priorité :")
            for code, row in commune_stats.iterrows():
                print(
                    f"     {code} : {int(row.n_zones_debord):>2} zones débordantes "
                    f"(max {row.debord_max_pct:.1f}%, médian {row.debord_med_pct:.1f}%)"
                )
            print(f"\n  Pour corriger ces communes (ex département {commune_stats.index[0][:2]}) :")
            print(f"     python pipeline_hdbscan_dept.py {commune_stats.index[0][:2]}")

    print(f"\n💾 CSV : {out_csv}")

    if args.map:
        m = render_map(zones, results, args.dept)
        if m:
            print(f"💾 Carte : {m}")

    print()


if __name__ == "__main__":
    main()

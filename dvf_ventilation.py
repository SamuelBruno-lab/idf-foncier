"""
dvf_ventilation.py — Ventilation des mutations DVF mixtes
==========================================================

Une mutation DVF "mixte" = un même id_mutation contenant plusieurs type_local
(ex: vente d'un bâtiment avec commerce au RDC + 3 appartements à l'étage).

Sans ventilation, ces ventes polluent les statistiques :
  - Soit elles sont gardées avec un prix_m2 absurde (prix global / surface_bati
    d'un seul lot)
  - Soit elles sont jetées
  - Soit elles sont divisées arbitrairement par nb_lots (perd la sémantique)

Stratégie de ventilation (4 étapes) :
  1. aggregate_mutations()         — sépare pures (1 type_local) / mixtes (≥2)
  2. run_preliminary_clustering()  — HDBSCAN sur les pures → zones de référence
  3. assign_cluster_to_mixed()     — chaque mixte → zone la plus proche
  4. ventiler_mutations_mixtes()   — prix réparti au prorata (surface × prix_m2_réf)

Référence prix par ordre de priorité :
  parcelle (si ≥5 ventes pures même type) → micromarché HDBSCAN → médiane globale

Filtre anti-aberrations : si prix réel < 20% du théorique → exclu (vente
familiale, judiciaire, viager).

Code extrait de carte_drancy_par_type.py (la version la plus récente avec
améliorations) — sera réutilisé par pipeline_hdbscan_idf.py et les scripts
carte_*_par_type.py.
"""

from __future__ import annotations

import json

import hdbscan
import numpy as np
import pandas as pd


def aggregate_mutations(data: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Une ligne par mutation pour les mutations pures :
    - Sépare les mutations mixtes (plusieurs type_local) pour ventilation ultérieure
    - Agrège surface_terrain (somme des parcelles) pour les maisons
    - Agrège surface_reelle_bati (somme Carrez) pour les appartements

    Returns (pure_dedup, mixed_raw).
    """
    if "id_mutation" not in data.columns:
        return data, pd.DataFrame()
    if "type_local" in data.columns:
        n_types = data.groupby("id_mutation")["type_local"].apply(
            lambda x: x.dropna().nunique()
        )
        pure_ids = n_types[n_types <= 1].index
        mixed_ids = n_types[n_types > 1].index
        n_mixed = len(mixed_ids)
        if n_mixed > 0:
            print(f"  Mutations mixtes détectées : {n_mixed} (seront ventilées)")
        pure_data = data[data["id_mutation"].isin(pure_ids)].copy()
        mixed_data = data[data["id_mutation"].isin(mixed_ids)].copy()
    else:
        pure_data = data.copy()
        mixed_data = pd.DataFrame()

    agg_dict: dict[str, str] = {}
    for col in ["surface_terrain", "surface_reelle_bati"]:
        if col in data.columns:
            agg_dict[col] = "sum"
    if agg_dict:
        agg_df = pure_data.groupby("id_mutation").agg(agg_dict).reset_index()
        for col in agg_dict:
            agg_df[col] = agg_df[col].replace(0, np.nan)
        data_dedup = pure_data.drop_duplicates(subset=["id_mutation"], keep="first").copy()
        data_dedup = data_dedup.drop(columns=list(agg_dict.keys()), errors="ignore")
        data_dedup = data_dedup.merge(agg_df, on="id_mutation", how="left")
    else:
        data_dedup = pure_data.drop_duplicates(subset=["id_mutation"], keep="first").copy()
    print(f"  Mutations pures agrégées : {len(data_dedup)}")
    return data_dedup, mixed_data


def run_preliminary_clustering(
    pure_data: pd.DataFrame,
    min_cluster_size: int = 8,
    min_samples: int = 2,
) -> np.ndarray:
    """Clustering HDBSCAN préliminaire sur toutes les ventes pures.
    Sert à définir les zones de référence pour la ventilation des mixtes.
    """
    if pure_data.empty or len(pure_data) < min_cluster_size:
        return np.full(len(pure_data), -1, dtype=int)
    coords = np.radians(pure_data[["latitude", "longitude"]].values)
    cl = hdbscan.HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        metric="haversine",
        cluster_selection_method="eom",
    )
    labels = cl.fit_predict(coords)
    n_clusters = int(np.unique(labels[labels >= 0]).size)
    print(f"  Clustering préliminaire (référence ventilation) : {n_clusters} zones sur {len(pure_data)} tx pures")
    return labels


def assign_cluster_to_mixed(
    mixed_data: pd.DataFrame,
    pure_data: pd.DataFrame,
    pure_cluster_labels: np.ndarray,
) -> pd.DataFrame:
    """Affecte chaque mutation mixte à la zone HDBSCAN la plus proche (par centroïde lat/lon)."""
    mixed_data = mixed_data.copy()
    pure_cl = pure_data.copy()
    pure_cl["_ref_cluster"] = pure_cluster_labels
    centroids = (
        pure_cl[pure_cl["_ref_cluster"] >= 0]
        .groupby("_ref_cluster")[["latitude", "longitude"]]
        .mean()
    )
    if centroids.empty:
        mixed_data["ref_cluster"] = -1
        return mixed_data
    centroid_arr = centroids[["latitude", "longitude"]].values
    centroid_ids = centroids.index.tolist()
    id_to_cluster: dict = {}
    for id_mut, grp in mixed_data.groupby("id_mutation"):
        lat = float(grp["latitude"].iloc[0])
        lon = float(grp["longitude"].iloc[0])
        dists = np.sqrt(
            (centroid_arr[:, 0] - lat) ** 2 + (centroid_arr[:, 1] - lon) ** 2
        )
        id_to_cluster[id_mut] = centroid_ids[int(np.argmin(dists))]
    mixed_data["ref_cluster"] = (
        mixed_data["id_mutation"].map(id_to_cluster).fillna(-1).astype(int)
    )
    return mixed_data


def ventiler_mutations_mixtes(
    mixed_data: pd.DataFrame,
    median_m2_by_cluster_type: dict,
    median_m2_by_parcelle_type: dict,
    global_median_m2_by_type: dict,
    min_parcelle_tx: int = 5,
    seuil_m2_min: dict | None = None,
) -> pd.DataFrame:
    """Ventile le prix total de chaque mutation mixte entre ses composantes.

    Référence de prix (par ordre de priorité) :
      1. Médiane de la parcelle (si ≥ min_parcelle_tx ventes pures du même type)
      2. Médiane du micromarché = zone HDBSCAN préliminaire pour ce type
      3. Médiane globale (fallback)

    Si la référence choisie est < seuil min pour ce type, fallback global.

    Formule : Part(type) = Prix_total × (S_type × P_réf_type) / Σ(S_i × P_réf_i)

    Filtre anti-aberration : si prix réel < 20% du théorique → mutation exclue.
    """
    if seuil_m2_min is None:
        seuil_m2_min = {}
    if mixed_data.empty:
        return pd.DataFrame()
    results = []
    for id_mut, group in mixed_data.groupby("id_mutation"):
        total_val = float(group["valeur_fonciere"].iloc[0])
        ref_cluster = (
            int(group["ref_cluster"].iloc[0])
            if "ref_cluster" in group.columns
            else -1
        )
        id_parcelle = (
            str(group["id_parcelle"].iloc[0])
            if "id_parcelle" in group.columns
            else None
        )

        type_groups = []
        for tl, tl_grp in group.groupby("type_local", dropna=False):
            template = tl_grp.iloc[0].copy()
            surf_bati = (
                tl_grp["surface_reelle_bati"].sum()
                if "surface_reelle_bati" in tl_grp.columns
                else np.nan
            )
            surf_terrain = (
                tl_grp["surface_terrain"].sum()
                if "surface_terrain" in tl_grp.columns
                else np.nan
            )
            template["surface_reelle_bati"] = (
                surf_bati if (pd.notna(surf_bati) and surf_bati > 0) else np.nan
            )
            template["surface_terrain"] = (
                surf_terrain
                if (pd.notna(surf_terrain) and surf_terrain > 0)
                else np.nan
            )
            surf = surf_bati if (pd.notna(surf_bati) and surf_bati > 0) else np.nan

            parcelle_info = median_m2_by_parcelle_type.get(id_parcelle, {}).get(
                tl, {}
            )
            if parcelle_info.get("count", 0) >= min_parcelle_tx and pd.notna(
                parcelle_info.get("median")
            ):
                m2_ref = parcelle_info["median"]
                ref_source = "parcelle"
            elif ref_cluster >= 0 and tl in median_m2_by_cluster_type.get(
                ref_cluster, {}
            ):
                m2_ref = median_m2_by_cluster_type[ref_cluster][tl]
                ref_source = f"zone_{ref_cluster}"
            else:
                m2_ref = global_median_m2_by_type.get(tl, np.nan)
                ref_source = "global"

            tl_min = seuil_m2_min.get(tl, 0)
            if pd.notna(m2_ref) and m2_ref < tl_min and ref_source != "global":
                fallback = global_median_m2_by_type.get(tl, np.nan)
                if pd.notna(fallback) and fallback >= tl_min:
                    m2_ref = fallback
                    ref_source = "global"

            theorique = (
                float(surf) * float(m2_ref)
                if (pd.notna(surf) and pd.notna(m2_ref))
                else np.nan
            )
            type_groups.append(
                {
                    "row": template,
                    "type_local": tl,
                    "surface": surf,
                    "m2_ref": m2_ref,
                    "theorique": theorique,
                    "ref_source": ref_source,
                }
            )

        total_theorique = sum(
            c["theorique"] for c in type_groups if pd.notna(c["theorique"])
        )

        if total_theorique > 0 and total_val / total_theorique < 0.20:
            continue

        breakdown = []
        for c in type_groups:
            if total_theorique > 0 and pd.notna(c["theorique"]):
                ventile_val = total_val * (c["theorique"] / total_theorique)
            else:
                ventile_val = total_val / len(type_groups)
            breakdown.append(
                {
                    "type": str(c["type_local"]),
                    "surface": float(c["surface"])
                    if pd.notna(c["surface"])
                    else None,
                    "m2_ref": float(c["m2_ref"])
                    if pd.notna(c["m2_ref"])
                    else None,
                    "theorique": float(c["theorique"])
                    if pd.notna(c["theorique"])
                    else None,
                    "ventile": ventile_val,
                    "ref_source": c["ref_source"],
                }
            )
        breakdown_str = json.dumps(breakdown, ensure_ascii=False)

        for c, b in zip(type_groups, breakdown):
            new_row = c["row"].copy()
            new_row["valeur_fonciere"] = b["ventile"]
            new_row["is_ventile"] = True
            new_row["valeur_fonciere_totale"] = total_val
            surf = c["surface"]
            new_row["prix_m2"] = (
                b["ventile"] / float(surf)
                if pd.notna(surf) and float(surf) > 0
                else np.nan
            )
            new_row["prix_m2_median_ventil"] = c["m2_ref"]
            new_row["ventil_ref_source"] = c["ref_source"]
            new_row["ventil_breakdown"] = breakdown_str
            new_row["ventil_total_theorique"] = (
                total_theorique if total_theorique > 0 else np.nan
            )
            results.append(new_row)

    if not results:
        return pd.DataFrame()
    ventile_df = pd.DataFrame(results)
    n_mut = mixed_data["id_mutation"].nunique()
    print(f"  Mutations mixtes ventilées : {n_mut} mutations → {len(ventile_df)} composantes")
    return ventile_df


def ventilate_dataset(
    df: pd.DataFrame,
    seuil_m2_max: dict | None = None,
    seuil_m2_min: dict | None = None,
    min_cluster_size: int = 8,
    min_samples: int = 2,
    min_parcelle_tx: int = 5,
) -> pd.DataFrame:
    """Orchestration complète de la ventilation. Appelé par les pipelines.

    Args:
        df: DataFrame DVF nettoyé (avec colonnes valeur_fonciere, type_local,
            id_mutation, id_parcelle, surface_reelle_bati, latitude, longitude,
            prix_m2 déjà calculé sur les transactions pures).
        seuil_m2_max: dict {type_local: max €/m²} pour exclure les outliers
        seuil_m2_min: dict {type_local: min €/m²}
        min_cluster_size: HDBSCAN pour le clustering préliminaire
        min_samples: HDBSCAN
        min_parcelle_tx: seuil ventes pures sur même parcelle pour la médiane parcelle

    Returns:
        DataFrame concat des mutations pures + mutations mixtes ventilées (chacune
        décomposée en ses N composantes). Les lignes ventilées ont un flag
        is_ventile=True et un champ ventil_breakdown JSON.
    """
    if df.empty:
        return df

    # Étape 1 : aggregate (séparer pures/mixtes, agréger surfaces des pures)
    pure_data, mixed_data = aggregate_mutations(df)

    # Recalcule prix_m2 sur les pures agrégées (surfaces ont changé)
    if "type_local" in pure_data.columns and "surface_reelle_bati" in pure_data.columns:
        pure_data["prix_m2"] = np.where(
            (pure_data["surface_reelle_bati"] > 0),
            pure_data["valeur_fonciere"] / pure_data["surface_reelle_bati"],
            np.nan,
        )

    # Filtre outliers prix_m2 avant clustering (sinon ils faussent les médianes)
    if seuil_m2_max:
        for tl, seuil in seuil_m2_max.items():
            pure_data = pure_data[
                ~((pure_data["type_local"] == tl) & (pure_data["prix_m2"] > seuil))
            ]
    if seuil_m2_min:
        for tl, seuil in seuil_m2_min.items():
            pure_data = pure_data[
                ~((pure_data["type_local"] == tl) & (pure_data["prix_m2"] < seuil))
            ]

    # Étape 2 : clustering préliminaire sur les pures
    pure_cluster_labels = run_preliminary_clustering(
        pure_data, min_cluster_size=min_cluster_size, min_samples=min_samples
    )

    # Médianes par (cluster, type) — référence principale
    median_m2_by_cluster_type: dict = {}
    pure_with_clusters = pure_data.copy()
    pure_with_clusters["_ref_cluster"] = pure_cluster_labels
    for cid in np.unique(pure_cluster_labels[pure_cluster_labels >= 0]):
        subset_c = pure_with_clusters[
            (pure_with_clusters["_ref_cluster"] == cid)
            & pure_with_clusters["prix_m2"].notna()
            & (pure_with_clusters["prix_m2"] > 0)
        ]
        median_m2_by_cluster_type[int(cid)] = {}
        for tl in subset_c["type_local"].dropna().unique():
            vals = subset_c[subset_c["type_local"] == tl]["prix_m2"]
            if len(vals) >= 10:
                median_m2_by_cluster_type[int(cid)][tl] = float(vals.median())

    # Médianes par (parcelle, type) — référence si parcelle isolée avec beaucoup de ventes
    median_m2_by_parcelle_type: dict = {}
    if "id_parcelle" in pure_data.columns:
        for (id_parc, tl), grp in pure_data.groupby(["id_parcelle", "type_local"]):
            vals = grp["prix_m2"].dropna()
            vals = vals[vals > 0]
            if id_parc not in median_m2_by_parcelle_type:
                median_m2_by_parcelle_type[id_parc] = {}
            median_m2_by_parcelle_type[id_parc][tl] = {
                "median": float(vals.median()) if len(vals) > 0 else np.nan,
                "count": len(vals),
            }

    # Médianes globales par type — fallback
    global_median_m2_by_type: dict = {}
    for tl in pure_data["type_local"].dropna().unique():
        subset = pure_data[
            (pure_data["type_local"] == tl)
            & pure_data["prix_m2"].notna()
            & (pure_data["prix_m2"] > 0)
        ]
        if len(subset) > 0:
            global_median_m2_by_type[tl] = float(subset["prix_m2"].median())

    # Étape 3+4 : assigner les clusters aux mixtes et ventiler
    if not mixed_data.empty:
        mixed_data = assign_cluster_to_mixed(mixed_data, pure_data, pure_cluster_labels)
        ventile_df = ventiler_mutations_mixtes(
            mixed_data,
            median_m2_by_cluster_type,
            median_m2_by_parcelle_type,
            global_median_m2_by_type,
            min_parcelle_tx=min_parcelle_tx,
            seuil_m2_min=seuil_m2_min or {},
        )
        if not ventile_df.empty:
            # Appliquer les mêmes seuils min/max aux résultats ventilés
            before = len(ventile_df)
            if seuil_m2_max:
                for tl, seuil in seuil_m2_max.items():
                    ventile_df = ventile_df[
                        ~((ventile_df["type_local"] == tl) & (ventile_df["prix_m2"] > seuil))
                    ]
            if seuil_m2_min:
                for tl, seuil in seuil_m2_min.items():
                    ventile_df = ventile_df[
                        ~((ventile_df["type_local"] == tl) & (ventile_df["prix_m2"] < seuil))
                    ]
            if len(ventile_df) < before:
                print(
                    f"  Suppression {before - len(ventile_df)} ventilations aberrantes (seuils min/max)"
                )
            pure_data = pd.concat([pure_data, ventile_df], ignore_index=True)
            print(f"  Total après ventilation : {len(pure_data)} transactions")

    return pure_data

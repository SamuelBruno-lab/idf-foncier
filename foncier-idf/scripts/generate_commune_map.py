"""
generate_commune_map.py
Génère une carte HTML standalone pour une commune à partir des données DVF.
Appelé par le workflow GitHub Actions generate-map.yml.

Env vars requises :
  COMMUNE_CODE   ex: 92078
  COMMUNE_NOM    ex: Puteaux
  SUPABASE_URL
  SUPABASE_SERVICE_KEY
"""

import os
import json
import datetime
import pandas as pd
import requests

COMMUNE_CODE = os.environ["COMMUNE_CODE"]
COMMUNE_NOM = os.environ["COMMUNE_NOM"]
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
OUTPUT = f"/tmp/map_{COMMUNE_CODE}.html"

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}


def fetch_supabase(table, params=""):
    url = f"{SUPABASE_URL}/rest/v1/{table}?{params}"
    r = requests.get(url, headers=HEADERS)
    r.raise_for_status()
    return r.json()


def load_dvf():
    """Charge les données DVF depuis Supabase ou le CSV local."""
    csv_path = f"/tmp/dvf_{COMMUNE_CODE}.csv"
    if os.path.exists(csv_path) and os.path.getsize(csv_path) > 1000:
        df = pd.read_csv(csv_path, low_memory=False)
        # Normaliser les colonnes DVF nationales
        col_map = {
            "valeur_fonciere": "prix",
            "surface_reelle_bati": "surface_bati",
            "type_local": "type_local",
            "latitude": "latitude",
            "longitude": "longitude",
            "date_mutation": "date_mutation",
        }
        df = df.rename(columns={k: v for k, v in col_map.items() if k in df.columns})
        df = df.dropna(subset=["prix", "latitude", "longitude"])
        df["prix"] = pd.to_numeric(df["prix"], errors="coerce")
        df["surface_bati"] = pd.to_numeric(df.get("surface_bati", 0), errors="coerce").fillna(0)
        df["prix_m2"] = df.apply(
            lambda r: r["prix"] / r["surface_bati"] if r["surface_bati"] > 10 else None, axis=1
        )
        return df
    else:
        # Fallback : Supabase
        data = fetch_supabase(
            "dvf_points",
            f"code_commune=eq.{COMMUNE_CODE}&select=prix,prix_m2,surface_bati,type_local,latitude,longitude,annee&limit=5000",
        )
        return pd.DataFrame(data)


def main():
    print(f"Generating map for {COMMUNE_NOM} ({COMMUNE_CODE})...")
    df = load_dvf()
    if df.empty:
        print("No data found, generating empty placeholder page.")
        generate_empty_page()
        return

    # Centroid
    lat_center = df["latitude"].median()
    lon_center = df["longitude"].median()
    total = len(df)
    prix_m2_median = int(df["prix_m2"].dropna().median()) if "prix_m2" in df and df["prix_m2"].notna().any() else 0
    annee_min = int(df["annee"].min()) if "annee" in df else 2020
    annee_max = int(df["annee"].max()) if "annee" in df else 2025

    # Préparer les points pour la carte
    points_json = []
    for _, row in df.dropna(subset=["latitude", "longitude"]).iterrows():
        pts = {
            "lat": float(row["latitude"]),
            "lon": float(row["longitude"]),
            "prix_m2": float(row["prix_m2"]) if pd.notna(row.get("prix_m2")) else None,
            "type": str(row.get("type_local", "")),
        }
        points_json.append(pts)

    points_str = json.dumps(points_json)

    html = f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{COMMUNE_NOM} — Analyse foncière | datamerry</title>
<meta name="description" content="Analyse du marché immobilier de {COMMUNE_NOM} : {total} transactions DVF {annee_min}–{annee_max}, prix médian {prix_m2_median:,}€/m². datamerry.">
<meta property="og:title" content="{COMMUNE_NOM} — Analyse foncière datamerry">
<meta property="og:description" content="{total} transactions · {prix_m2_median:,}€/m² médian · {annee_min}–{annee_max}">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  * {{ margin:0; padding:0; box-sizing:border-box; }}
  body {{ background:#070714; font-family: Segoe UI, sans-serif; color:#fff; height:100vh; display:flex; flex-direction:column; }}
  #header {{ background:rgba(5,5,20,0.95); border-bottom:1px solid rgba(255,255,255,0.08); padding:14px 20px; display:flex; align-items:center; gap:16px; flex-shrink:0; }}
  #header a {{ color:rgba(255,255,255,0.35); text-decoration:none; font-size:12px; }}
  #header .title {{ font-weight:700; font-size:16px; color:#fff; }}
  #header .subtitle {{ font-size:11px; color:rgba(255,255,255,0.35); margin-top:2px; }}
  #stats {{ display:flex; gap:24px; margin-left:auto; }}
  #stats .s {{ text-align:center; }}
  #stats .s .v {{ font-size:18px; font-weight:800; color:#00d4ff; }}
  #stats .s .l {{ font-size:10px; color:rgba(255,255,255,0.35); }}
  #map {{ flex:1; }}
  #footer {{ background:rgba(5,5,20,0.9); padding:8px 20px; font-size:11px; color:rgba(255,255,255,0.2); display:flex; justify-content:space-between; flex-shrink:0; }}
  #footer a {{ color:rgba(0,212,255,0.5); text-decoration:none; }}
  .legend {{ background:rgba(10,10,30,0.92); border:1px solid rgba(255,255,255,0.1); border-radius:8px; padding:10px 14px; font-size:11px; }}
  .legend-item {{ display:flex; align-items:center; gap:8px; margin-bottom:5px; }}
  .legend-dot {{ width:10px; height:10px; border-radius:50%; flex-shrink:0; }}
</style>
</head>
<body>
<div id="header">
  <div>
    <a href="https://datamerry.com">← datamerry</a>
    <div class="title">{COMMUNE_NOM}</div>
    <div class="subtitle">Analyse foncière {annee_min}–{annee_max} · Source DVF data.gouv.fr</div>
  </div>
  <div id="stats">
    <div class="s"><div class="v">{total:,}</div><div class="l">transactions</div></div>
    <div class="s"><div class="v">{prix_m2_median:,}€</div><div class="l">prix médian/m²</div></div>
    <div class="s"><div class="v">{annee_min}–{annee_max}</div><div class="l">période</div></div>
  </div>
</div>
<div id="map"></div>
<div id="footer">
  <span>datamerry.com · Observatoire foncier IA · {datetime.date.today().strftime("%B %Y")}</span>
  <a href="https://datamerry.com">Voir toutes les analyses →</a>
</div>
<script>
var map = L.map('map', {{zoomControl:true}}).setView([{lat_center},{lon_center}], 14);
L.tileLayer('https://{{s}}.basemaps.cartocdn.com/dark_all/{{z}}/{{x}}/{{y}}{{r}}.png',{{
  attribution:'© OpenStreetMap contributors © CARTO',maxZoom:19
}}).addTo(map);

var points = {points_str};
var typeColors = {{
  'Appartement':'#00d4ff','Maison':'#00ff88',
  'Local industriel. commercial ou assimilé':'#f59e0b','Dépendance':'#a78bfa'
}};
var minP=3000,maxP=12000;
function lerp(t,a,b){{return a+t*(b-a);}}
function priceColor(p){{
  if(!p)return '#888';
  var t=Math.min(1,Math.max(0,(p-minP)/(maxP-minP)));
  var r=Math.round(lerp(t,0x00,0xff));
  var g=Math.round(lerp(t,0xff,0x44));
  var b2=Math.round(lerp(t,0x88,0x44));
  return 'rgb('+r+','+g+','+b2+')';
}}
points.forEach(function(p){{
  var col=p.prix_m2?priceColor(p.prix_m2):(typeColors[p.type]||'#888');
  var label=p.prix_m2?Math.round(p.prix_m2).toLocaleString('fr-FR')+'€/m²':(p.type||'N/A');
  L.circleMarker([p.lat,p.lon],{{
    radius:5,color:'transparent',fillColor:col,fillOpacity:0.75,weight:0
  }}).bindPopup('<b>'+label+'</b><br>'+p.type).addTo(map);
}});

// Légende
var legend=L.control({{position:'bottomright'}});
legend.onAdd=function(){{
  var d=L.DomUtil.create('div','legend');
  d.innerHTML='<div style="font-weight:700;margin-bottom:8px;color:rgba(255,255,255,0.6)">Prix/m²</div>';
  [['< 4 000€','#00ff88'],['4 000–6 000€','#88cc44'],['6 000–8 000€','#ffaa00'],['> 8 000€','#ff4444']].forEach(function(item){{
    d.innerHTML+='<div class="legend-item"><div class="legend-dot" style="background:'+item[1]+'"></div><span style="color:rgba(255,255,255,0.6)">'+item[0]+'</span></div>';
  }});
  return d;
}};
legend.addTo(map);
</script>
</body>
</html>"""

    with open(OUTPUT, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"Map generated: {OUTPUT} ({len(points_json)} points)")


def generate_empty_page():
    html = f"""<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><title>{COMMUNE_NOM} — datamerry</title></head>
<body style="background:#070714;color:#fff;font-family:Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px">
  <h1 style="font-size:24px">{COMMUNE_NOM}</h1>
  <p style="color:rgba(255,255,255,0.45)">Données DVF insuffisantes pour générer une carte.</p>
  <a href="https://datamerry.com" style="color:#00d4ff">← Retour à datamerry</a>
</body></html>"""
    with open(OUTPUT, "w") as f:
        f.write(html)


if __name__ == "__main__":
    main()

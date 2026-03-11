# CLAUDE.md — idf-foncier

## Project Overview

**datamerry.com** — Interactive French real estate transaction analysis platform for Île-de-France (IDF). Combines Python geospatial pipelines (HDBSCAN clustering, Folium maps) with a Next.js web app (Deck.gl + Mapbox) backed by Supabase PostGIS.

Two main components live in this repo:

1. **Root (`/`)** — Python scripts generating static HTML maps from DVF (Demandes de Valeurs Foncières) open data
2. **`foncier-idf/`** — Next.js 16 web application serving the interactive map at datamerry.com

## Repository Structure

```
idf-foncier/
├── CLAUDE.md
├── index.html                      # VLG landing page (GitHub Pages)
├── pipeline_dept.py                # Generic department map pipeline (all IDF depts)
├── pipeline_hdbscan_idf.py         # Bulk HDBSCAN clustering → Supabase upload
├── carte_vlg.py                    # Simple DBSCAN map for Villeneuve-la-Garenne
├── carte_vlg_par_type.py           # 3-map generation by type (Apparts/Maisons/Commerces)
├── carte_vlg_hdbscan.py            # Premium HDBSCAN map with heatmap layer
├── carte_vlg_premium.py            # Premium DBSCAN map variant
├── carte_vlg_typologies.py         # 3-map by typology (Logements/Commerciaux/Terrains)
├── carte_94.py                     # Val-de-Marne department map
├── carte_drancy_par_type.py        # Drancy commune pipeline (template for new communes)
├── make_standalone.py              # Embed CDN resources for offline HTML maps
├── publish_github.sh               # Deploy maps to per-department GitHub Pages repos
├── dvf_92078_*.csv                 # DVF transaction data (Villeneuve-la-Garenne)
├── carte_vlg*.html                 # Generated HTML maps (committed for GitHub Pages)
├── vlg_pages/                      # Standalone offline maps for VLG
├── foncier-idf/                    # Next.js web application
│   ├── src/
│   │   ├── app/                    # App Router pages & API routes
│   │   ├── components/             # React components (DvfMap, FilterPanel, etc.)
│   │   ├── lib/supabase.ts         # Supabase client
│   │   └── types/dvf.ts            # TypeScript interfaces
│   ├── sql/                        # Database schema & import scripts
│   ├── scripts/                    # Map generation scripts
│   └── .github/workflows/          # CI/CD for automated map generation
```

## Tech Stack

### Python Pipeline
- **pandas, numpy** — Data manipulation
- **folium, branca** — Interactive Leaflet map generation
- **hdbscan** — Adaptive density-based clustering
- **sklearn.cluster.DBSCAN** — Fixed-radius clustering (older scripts)
- **scipy.spatial.ConvexHull** — Zone boundary polygons
- **httpx, requests** — HTTP for Supabase uploads

### Next.js App (`foncier-idf/`)
- **Next.js 16.1.6** with App Router, **React 19**, **TypeScript 5**
- **Deck.gl 9** + **Mapbox GL** — WebGL map visualization
- **Supabase** (PostgreSQL + PostGIS) — Geospatial backend
- **Tailwind CSS v4** — Styling
- **Resend** — Transactional email
- **Vercel** — Deployment

## Development Commands

### Next.js App
```bash
cd foncier-idf
npm install
npm run dev          # Dev server (localhost:3000)
npm run build        # Production build
npm run lint         # ESLint
```

### Python Pipelines
```bash
# Generate maps for a department (e.g., 93 = Seine-Saint-Denis)
python pipeline_dept.py 93

# Run HDBSCAN clustering for all IDF communes → Supabase
python pipeline_hdbscan_idf.py --dept 92 93

# Generate VLG maps by property type
python carte_vlg_par_type.py

# Publish maps to GitHub Pages
bash publish_github.sh 93
```

### Environment Variables (foncier-idf)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_MAPBOX_TOKEN=
RESEND_API_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

## Architecture

### Data Flow
```
DVF CSV (data.gouv.fr)
  → Python pipeline (clean, filter, cluster)
    → Static HTML maps (GitHub Pages per dept)
    → Supabase PostGIS (dvf_points, dvf_hdbscan_zones)
      → Next.js API routes (/api/dvf/clusters)
        → Deck.gl map (datamerry.com)
```

### Zoom-Based Clustering Strategy
| Zoom Level | Data Source | Approx. Count |
|---|---|---|
| < 7 | `dvf_clusters_region` | ~52 bubbles |
| 7–9 | `dvf_clusters_dept` | ~400 bubbles |
| 10–12 | `dvf_clusters_commune` | ~35k bubbles |
| ≥ 13 | `dvf_points` (raw) | up to 2,000–15,000 |

### Database Tables (Supabase)
- `dvf_points` — ~3M individual transactions
- `dvf_clusters_commune` / `_dept` / `_region` — Pre-aggregated clusters
- `dvf_hdbscan_zones` — Micro-market polygons with price statistics
- `leads` — CRM lead capture
- `waitlist` — Commune analysis request queue

### Next.js Pages
| Route | Purpose |
|---|---|
| `/` | Landing page with full IDF map |
| `/dept/[code]` | Department map (92, 93, 94, etc.) |
| `/analyse/[code]` | Commune analysis (SSG for top 100) |
| `/actualites` | News / pilot projects |

### API Routes
| Endpoint | Method | Purpose |
|---|---|---|
| `/api/dvf/clusters` | GET | Zoom-based cluster data |
| `/api/analyse/[code]` | GET | Commune analysis data |
| `/api/communes/search` | GET | Autocomplete search |
| `/api/leads` | POST | Lead capture |
| `/api/waitlist` | GET/POST | Waitlist signup & count |

## Key Conventions

### Python Scripts
- **DVF data paths**: `/home/user/dvf_<CODE>_{YEAR}.csv` or `/home/user/dvf_<CODE>.csv`
- **Year range**: 2020–2025 (2025 partial)
- **Spatial metric**: Haversine (radians) for all clustering
- **HDBSCAN parameters**: Appartements ~8% of count (eom method), Maisons 4–8 fixed (leaf method), Commerces 5–8
- **Price outlier filters**: Appartement ≤12k €/m², Maison ≤9k €/m², Commercial ≤15k €/m², global min 500 €/m²
- **Excluded records**: Dépendances (caves/garages), VEFA maisons, negative/zero prices, missing coordinates
- **Coordinate jitter**: Spiral pattern, ~12m max radius for co-located points
- **Mutation ventilation**: 3-tier reference pricing for mixed transactions (parcelle ≥5 sales → zone median → global median)
- **Color scheme**: Cyan→Yellow→Orange→Red (#00d4ff → #ff0055), 5-point gradient
- **UI theme**: Dark gradient background (CartoDB Dark basemap), collapsible dashboard top-left
- **Year icons**: 🔵🟢🟡🟠🔴🟣 (2020–2025)
- **Output maps**: Always include `.nojekyll` for GitHub Pages

### Next.js App
- **Import aliases**: `@/*` → `./src/*`
- **Styling**: Tailwind CSS v4 (no separate config file, uses PostCSS plugin)
- **Components**: Functional React with hooks, no class components
- **Data fetching**: Server-side in page components, client-side via fetch in map components
- **Maps**: Deck.gl ScatterplotLayer (clusters mode) or HeatmapLayer (heatmap mode)
- **Lead capture**: Email de-duplication, IP hashing (no PII stored), source tracking
- **SSG**: Top 100 communes pre-rendered, others use dynamic fallback

### Departments Covered
| Code | Name | Repo |
|---|---|---|
| 60 | Oise | oise-foncier |
| 75 | Paris | paris-foncier |
| 77 | Seine-et-Marne | seine-et-marne-foncier |
| 78 | Yvelines | yvelines-foncier |
| 91 | Essonne | essonne-foncier |
| 92 | Hauts-de-Seine | hauts-de-seine-foncier |
| 93 | Seine-Saint-Denis | seine-saint-denis-foncier |
| 94 | Val-de-Marne | val-de-marne-foncier |
| 95 | Val-d'Oise | val-d-oise-foncier |

### GitHub Organization
- Owner: `SamuelBruno-lab`
- Main repo: `idf-foncier` (this repo — pipelines + Next.js app)
- Per-department repos: `{dept-name}-foncier` (GitHub Pages hosting for static maps)
- Deployment: Vercel for Next.js, GitHub Pages for static HTML maps

## Language

The codebase, comments, commit messages, UI text, and variable names are primarily in **French**. Follow this convention:
- Commit messages in French (e.g., `feat: ajouter recherche d'adresse`)
- Variable names may mix French domain terms (`prix_m2`, `type_local`, `code_commune`) with English programming terms
- User-facing text is always in French

## Common Patterns for New Features

### Adding a New Commune Map
1. Obtain DVF CSV data for the commune
2. Use `carte_drancy_par_type.py` as template — copy and adapt commune code, coordinates, and output paths
3. Run the script to generate HTML maps
4. Use `publish_github.sh` to deploy to GitHub Pages

### Adding a New Department
1. Add department config to `pipeline_dept.py` (`DEPT_CONFIG` dict)
2. Add repo name to `publish_github.sh` (`REPO_NAMES` array)
3. Run `python pipeline_dept.py <CODE>` then `bash publish_github.sh <CODE>`

### Modifying the Web App
1. Work in `foncier-idf/` directory
2. Database schema changes go in `foncier-idf/sql/`
3. New API routes in `foncier-idf/src/app/api/`
4. New pages in `foncier-idf/src/app/`
5. Shared components in `foncier-idf/src/components/`

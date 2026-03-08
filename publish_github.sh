#!/bin/bash
# Publie les cartes HTML sur GitHub Pages pour un département
# Usage: bash publish_github.sh <CODE_DEPT>
# Ex:    bash publish_github.sh 93

set -e

DEPT=$1
GITHUB_TOKEN="${GITHUB_TOKEN:-}"  # Set via: export GITHUB_TOKEN=...
GITHUB_USER="SamuelBruno-lab"

declare -A REPO_NAMES
REPO_NAMES[60]="oise-foncier"
REPO_NAMES[75]="paris-foncier"
REPO_NAMES[77]="seine-et-marne-foncier"
REPO_NAMES[78]="yvelines-foncier"
REPO_NAMES[91]="essonne-foncier"
REPO_NAMES[92]="hauts-de-seine-foncier"
REPO_NAMES[93]="seine-saint-denis-foncier"
REPO_NAMES[94]="val-de-marne-foncier"
REPO_NAMES[95]="val-d-oise-foncier"

REPO=${REPO_NAMES[$DEPT]}
if [ -z "$REPO" ]; then
  echo "❌ Département inconnu: $DEPT"
  exit 1
fi

MAPS_DIR="/home/user/maps_${DEPT}"
if [ ! -d "$MAPS_DIR" ]; then
  echo "❌ Dossier $MAPS_DIR introuvable. Lancer d'abord: python pipeline_dept.py $DEPT"
  exit 1
fi

echo "🚀 Publication de $DEPT → $GITHUB_USER/$REPO"
echo "   Dossier source: $MAPS_DIR"

# 1. Vérifier si le repo existe, sinon le créer
echo "[1/3] Vérification/création du repo GitHub..."
REPO_CHECK=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: token $GITHUB_TOKEN" \
  "https://api.github.com/repos/$GITHUB_USER/$REPO")

if [ "$REPO_CHECK" = "404" ]; then
  echo "  Repo n'existe pas, création..."
  curl -s -X POST \
    -H "Authorization: token $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github.v3+json" \
    "https://api.github.com/user/repos" \
    -d "{\"name\":\"$REPO\",\"description\":\"Analyse foncière · Département $DEPT · datamerry.com\",\"homepage\":\"https://$GITHUB_USER.github.io/$REPO/\",\"private\":false,\"has_pages\":true}" \
    | python3 -c "import json,sys; r=json.load(sys.stdin); print('  ✅ Repo créé:', r.get('html_url','?'))" 2>/dev/null || echo "  Repo créé (ou existant)"
  sleep 2
else
  echo "  Repo existe déjà (HTTP $REPO_CHECK)"
fi

# 2. Cloner ou init le repo localement
WORK_DIR="/tmp/gh_$DEPT"
rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"

echo "[2/3] Préparation du contenu..."
# Init git repo
cd "$WORK_DIR"
git init -q
git -c user.email="noreply@datamerry.com" -c user.name="datamerry" \
    config user.email "noreply@datamerry.com" 2>/dev/null || true
git -c user.email="noreply@datamerry.com" -c user.name="datamerry" \
    config user.name "datamerry" 2>/dev/null || true

# Copier les fichiers
cp "$MAPS_DIR"/*.html .

# Commit
git add -A
git -c "commit.gpgsign=false" -c "user.email=noreply@datamerry.com" -c "user.name=datamerry" \
    commit -q -m "feat: carte foncière $DEPT · datamerry.com"

# 3. Push vers GitHub
echo "[3/3] Push vers GitHub Pages..."
git remote add origin "https://$GITHUB_USER:$GITHUB_TOKEN@github.com/$GITHUB_USER/$REPO.git"
git branch -M main
git push -f -u origin main 2>&1 | grep -v "^remote:" | grep -v "^To " || true

# 4. Activer GitHub Pages sur main
sleep 3
echo "  Activation GitHub Pages..."
curl -s -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/repos/$GITHUB_USER/$REPO/pages" \
  -d '{"source":{"branch":"main","path":"/"}}' \
  | python3 -c "import json,sys; r=json.load(sys.stdin); print('  Pages URL:', r.get('html_url', r.get('url','?')))" 2>/dev/null || \
  echo "  GitHub Pages déjà actif ou activation en cours"

echo ""
echo "✅ Publié ! URL (active dans ~1min) :"
echo "   https://$GITHUB_USER.github.io/$REPO/"

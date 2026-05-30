"""
scrape_eurealimmo.py — Scraper de migration eurealimmo.com → Vercel.

Récupère TOUS les éléments réutilisables du site Botble existant :
  - HTML de chaque page (pour analyse contenu)
  - Médias (logos, images personnalisées, PDFs)
  - Palette de couleurs extraite du CSS
  - Inventaire CSV : ce qui vaut la peine d'être migré vs Lorem Ipsum

Output : dossier `eurealimmo-scrape/` avec :
  - pages/             : HTML brut de chaque page (.html)
  - media/             : tous les médias téléchargés
  - styles/            : CSS extraits
  - report.csv         : inventaire complet
  - colors.txt         : palette détectée
  - summary.md         : résumé pour décision migration

Usage :
    python scripts/scrape_eurealimmo.py
"""

from __future__ import annotations

import csv
import re
import sys
import time
from collections import Counter
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests

# Force UTF-8 stdout (Windows cp1252 ne supporte pas les emojis)
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

BASE_URL = "https://eurealimmo.com"
OUTPUT_DIR = Path("eurealimmo-scrape")
MAX_PAGES = 50
TIMEOUT = 15
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Migration-Scraper/1.0"

# Marqueurs de Lorem Ipsum / contenu placeholder
LOREM_PATTERNS = [
    r"lorem ipsum",
    r"alice'?s first thought",  # Alice in Wonderland (seed Botble)
    r"the quick brown fox",
    r"placeholder",
    r"@botble\.com",
    r"\+91\s*1234567890",
    r"john\.smith",
    r"san francisco",  # Faux biens US
    r"bakersfield",
    r"anaheim",
    r"alhambra",
]
LOREM_RE = re.compile("|".join(LOREM_PATTERNS), re.IGNORECASE)


def setup_dirs() -> None:
    """Crée les dossiers de sortie."""
    for sub in ["pages", "media", "styles"]:
        (OUTPUT_DIR / sub).mkdir(parents=True, exist_ok=True)


def fetch(url: str) -> requests.Response | None:
    """GET avec timeout + User-Agent, renvoie None si échec."""
    try:
        r = requests.get(
            url,
            headers={"User-Agent": USER_AGENT},
            timeout=TIMEOUT,
            allow_redirects=True,
        )
        r.raise_for_status()
        return r
    except Exception as e:
        print(f"  ⚠ {url} → {e}")
        return None


def safe_filename(url: str) -> str:
    """Convertit une URL en nom de fichier sûr."""
    path = urlparse(url).path.strip("/") or "index"
    name = re.sub(r"[^\w.\-]+", "_", path)
    return name[:200]


def discover_urls() -> list[str]:
    """
    Découvre les URLs à scraper depuis le sitemap.xml.
    Fallback : crawl simple depuis la home.
    """
    urls: set[str] = {BASE_URL}
    print("📍 Découverte URLs depuis sitemap.xml...")

    # Sitemap index
    sitemap_urls = [
        f"{BASE_URL}/sitemap.xml",
        f"{BASE_URL}/pages.xml",
        f"{BASE_URL}/agents.xml",
        f"{BASE_URL}/properties-2026-01.xml",
        f"{BASE_URL}/properties-city.xml",
        f"{BASE_URL}/projects-2026-01.xml",
    ]
    for sm_url in sitemap_urls:
        r = fetch(sm_url)
        if not r:
            continue
        # Extraction <loc>...</loc>
        for match in re.finditer(r"<loc>([^<]+)</loc>", r.text):
            url = match.group(1).strip()
            if url.startswith(BASE_URL):
                urls.add(url)

    # Fallback : crawl depuis la home si sitemap vide
    if len(urls) <= 1:
        print("  ↪ Sitemap vide, fallback crawl home")
        r = fetch(BASE_URL)
        if r:
            for match in re.finditer(r'href="([^"]+)"', r.text):
                href = match.group(1)
                full = urljoin(BASE_URL, href)
                if full.startswith(BASE_URL) and "#" not in full:
                    urls.add(full.split("?")[0])

    print(f"📍 {len(urls)} URLs découvertes")
    return sorted(urls)[:MAX_PAGES]


def download_media(media_url: str, report: list[dict]) -> None:
    """Télécharge un média et l'enregistre dans output/media/."""
    full = urljoin(BASE_URL, media_url)
    if not full.startswith(BASE_URL):
        return
    filename = safe_filename(full)
    out_path = OUTPUT_DIR / "media" / filename
    if out_path.exists():
        return  # déjà téléchargé
    r = fetch(full)
    if r:
        out_path.write_bytes(r.content)
        size_kb = len(r.content) / 1024
        report.append({
            "type": "media",
            "url": full,
            "local": str(out_path),
            "size_kb": f"{size_kb:.1f}",
            "has_lorem": "no",
            "useful": "tbd",
        })
        print(f"  📷 {filename} ({size_kb:.1f} Ko)")


def extract_media_urls(html: str) -> set[str]:
    """Extrait toutes les URLs de médias (img, link, source, video, pdf, etc.)."""
    media: set[str] = set()
    patterns = [
        r'<img[^>]+src="([^"]+)"',
        r'<source[^>]+src="([^"]+)"',
        r'<video[^>]+src="([^"]+)"',
        r'<link[^>]+href="([^"]+\.(?:css|woff2?|ttf|svg|ico))"',
        r'url\(["\']?([^"\')]+)["\']?\)',  # CSS url()
        r'href="([^"]+\.pdf)"',
        r'<meta[^>]+og:image[^>]+content="([^"]+)"',
    ]
    for pat in patterns:
        for match in re.finditer(pat, html, re.IGNORECASE):
            media.add(match.group(1))
    return media


def extract_colors(html: str, css_text: str = "") -> Counter:
    """Extrait les couleurs HEX/RGB de tout le contenu CSS/inline."""
    colors: Counter = Counter()
    blob = html + " " + css_text
    # Hex 3/6 chars
    for m in re.finditer(r"#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b", blob):
        colors[m.group(0).lower()] += 1
    # rgb / rgba
    for m in re.finditer(r"rgba?\(([^)]+)\)", blob, re.IGNORECASE):
        colors[f"rgba({m.group(1).strip()})"] += 1
    return colors


def scrape_page(url: str, report: list[dict]) -> tuple[str, Counter]:
    """Scrape une page : sauve HTML, télécharge médias, retourne (text, palette)."""
    r = fetch(url)
    if not r:
        return "", Counter()
    html = r.text

    # Sauvegarde HTML
    filename = safe_filename(url) + ".html"
    out_path = OUTPUT_DIR / "pages" / filename
    out_path.write_text(html, encoding="utf-8")

    # Inventaire
    has_lorem = bool(LOREM_RE.search(html))
    text_only = re.sub(r"<[^>]+>", " ", html)
    text_only = re.sub(r"\s+", " ", text_only).strip()

    report.append({
        "type": "page",
        "url": url,
        "local": str(out_path),
        "size_kb": f"{len(html) / 1024:.1f}",
        "has_lorem": "yes" if has_lorem else "no",
        "useful": "no_lorem" if has_lorem else "maybe",
    })

    print(
        f"  📄 {filename} ({len(html) / 1024:.1f} Ko) "
        f"{'⚠ Lorem/fake' if has_lorem else '✓ clean'}"
    )

    # Téléchargement médias
    for media_url in extract_media_urls(html):
        download_media(media_url, report)

    # Récupération CSS externes
    palette = extract_colors(html)
    for m in re.finditer(r'<link[^>]+href="([^"]+\.css)"', html):
        css_url = urljoin(url, m.group(1))
        if css_url.startswith(BASE_URL):
            css_r = fetch(css_url)
            if css_r:
                css_filename = safe_filename(css_url)
                (OUTPUT_DIR / "styles" / css_filename).write_text(
                    css_r.text, encoding="utf-8"
                )
                palette.update(extract_colors("", css_r.text))

    return text_only, palette


def generate_summary(report: list[dict], colors: Counter) -> None:
    """Génère un résumé markdown pour décision migration."""
    pages = [r for r in report if r["type"] == "page"]
    media = [r for r in report if r["type"] == "media"]
    pages_clean = [r for r in pages if r["has_lorem"] == "no"]
    pages_lorem = [r for r in pages if r["has_lorem"] == "yes"]

    summary = f"""# Audit migration eurealimmo.com → Vercel

## Statistiques globales

- **Pages scrapées** : {len(pages)}
- **Pages 'clean'** (pas de Lorem Ipsum / fake data) : {len(pages_clean)}
- **Pages 'fake'** (Lorem Ipsum, agents US, biens US) : {len(pages_lorem)}
- **Médias téléchargés** : {len(media)}

## Top 15 couleurs détectées (CSS)

| Couleur | Occurrences |
|---|---|
"""
    for color, count in colors.most_common(15):
        summary += f"| `{color}` | {count} |\n"

    summary += "\n## Pages clean (à analyser pour migration)\n\n"
    for p in pages_clean[:20]:
        summary += f"- `{p['url']}` ({p['size_kb']} Ko)\n"

    summary += "\n## Médias téléchargés (≥ 5 Ko, candidats pour réutilisation)\n\n"
    big_media = sorted(
        [m for m in media if float(m["size_kb"]) > 5],
        key=lambda m: -float(m["size_kb"]),
    )
    for m in big_media[:30]:
        summary += f"- `{m['local']}` ({m['size_kb']} Ko) — {m['url']}\n"

    summary += f"""\n## Recommandation

D'après le scraping :
- {len(pages_clean)} pages sont récupérables
- {len(pages_lorem)} pages contiennent du contenu Lorem Ipsum / fake US
- {len([m for m in media if float(m['size_kb']) > 10])} médias > 10 Ko méritent une revue manuelle

**Stratégie de migration suggérée** :
1. Réutiliser le logo + favicon (top 3 plus petits médias type .svg/.ico)
2. Recréer toutes les pages from scratch en Next.js (vu le faible nombre de pages clean)
3. Importer la palette couleurs principale dans Tailwind config
4. Archiver le scraping comme preuve légale (en cas de litige avec le dev offshore)
"""
    (OUTPUT_DIR / "summary.md").write_text(summary, encoding="utf-8")
    print(f"\n📊 Résumé écrit dans {OUTPUT_DIR}/summary.md")


def main() -> None:
    print(f"🚀 Scraping eurealimmo.com → {OUTPUT_DIR}/\n")
    setup_dirs()
    urls = discover_urls()

    report: list[dict] = []
    global_palette: Counter = Counter()

    for i, url in enumerate(urls, 1):
        print(f"\n[{i}/{len(urls)}] {url}")
        _, palette = scrape_page(url, report)
        global_palette.update(palette)
        time.sleep(0.3)  # politesse serveur

    # Écriture report CSV
    with open(OUTPUT_DIR / "report.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f, fieldnames=["type", "url", "local", "size_kb", "has_lorem", "useful"]
        )
        writer.writeheader()
        writer.writerows(report)
    print(f"\n📋 Report CSV : {OUTPUT_DIR}/report.csv")

    # Palette couleurs
    with open(OUTPUT_DIR / "colors.txt", "w", encoding="utf-8") as f:
        f.write("# Palette de couleurs détectée (par fréquence)\n\n")
        for color, count in global_palette.most_common(50):
            f.write(f"{color}\t{count}\n")
    print(f"🎨 Palette : {OUTPUT_DIR}/colors.txt")

    # Résumé markdown
    generate_summary(report, global_palette)

    print(f"\n✅ Scraping terminé : {len(report)} éléments dans {OUTPUT_DIR}/")


if __name__ == "__main__":
    main()

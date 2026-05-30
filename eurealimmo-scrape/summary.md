# Audit migration eurealimmo.com → Vercel

## Statistiques globales

- **Pages scrapées** : 23
- **Pages 'clean'** (pas de Lorem Ipsum / fake data) : 6
- **Pages 'fake'** (Lorem Ipsum, agents US, biens US) : 17
- **Médias téléchargés** : 28

## Top 15 couleurs détectées (CSS)

| Couleur | Occurrences |
|---|---|
| `#fff` | 3581 |
| `#000` | 766 |
| `#6c757d` | 680 |
| `#007bff` | 578 |
| `#212529` | 527 |
| `#28a745` | 510 |
| `#dee2e6` | 510 |
| `#dc3545` | 476 |
| `#343a40` | 323 |
| `#f8f9fa` | 306 |
| `#ffc107` | 289 |
| `#17a2b8` | 289 |
| `#e9ecef` | 255 |
| `#495057` | 221 |
| `#e0e0e0` | 177 |

## Pages clean (à analyser pour migration)

- `https://eurealimmo.com/agents.xml` (0.8 Ko)
- `https://eurealimmo.com/blog-categories.xml` (1.9 Ko)
- `https://eurealimmo.com/blog-tags.xml` (1.5 Ko)
- `https://eurealimmo.com/pages.xml` (4.0 Ko)
- `https://eurealimmo.com/projects-city.xml` (2.6 Ko)
- `https://eurealimmo.com/properties-city.xml` (2.6 Ko)

## Médias téléchargés (≥ 5 Ko, candidats pour réutilisation)

- `eurealimmo-scrape\media\themes_flex-home_images_g4.png` (6415.8 Ko) — https://eurealimmo.com/themes/flex-home/images/g4.png
- `eurealimmo-scrape\media\themes_flex-home_images_g6.png` (3391.2 Ko) — https://eurealimmo.com/themes/flex-home/images/g6.png
- `eurealimmo-scrape\media\themes_flex-home_images_g3.png` (1885.6 Ko) — https://eurealimmo.com/themes/flex-home/images/g3.png
- `eurealimmo-scrape\media\themes_flex-home_images_g1.png` (1866.4 Ko) — https://eurealimmo.com/themes/flex-home/images/g1.png
- `eurealimmo-scrape\media\themes_flex-home_images_about.png` (1229.5 Ko) — https://eurealimmo.com/themes/flex-home/images/about.png
- `eurealimmo-scrape\media\themes_flex-home_images_g2.png` (1139.3 Ko) — https://eurealimmo.com/themes/flex-home/images/g2.png
- `eurealimmo-scrape\media\themes_flex-home_images_g5.png` (780.6 Ko) — https://eurealimmo.com/themes/flex-home/images/g5.png
- `eurealimmo-scrape\media\storage_general_home-banner.jpg` (616.5 Ko) — https://eurealimmo.com/storage/general/home-banner.jpg
- `eurealimmo-scrape\media\storage_general_breadcrumb-background.jpg` (494.0 Ko) — https://eurealimmo.com/storage/general/breadcrumb-background.jpg
- `eurealimmo-scrape\media\themes_flex-home_libraries_fontawesome_css_fontawesome.min.css` (156.1 Ko) — https://eurealimmo.com/themes/flex-home/libraries/fontawesome/css/fontawesome.min.css
- `eurealimmo-scrape\media\themes_flex-home_libraries_bootstrap_bootstrap.min.v4.css` (152.1 Ko) — https://eurealimmo.com/themes/flex-home/libraries/bootstrap/bootstrap.min.v4.css
- `eurealimmo-scrape\media\index` (139.9 Ko) — https://eurealimmo.com#flags_fr_a
- `eurealimmo-scrape\media\storage_logo_f488ca84d2a5148161ebd8f7d717776f49f7e136-1-1-1.png` (93.6 Ko) — https://eurealimmo.com/storage/logo/f488ca84d2a5148161ebd8f7d717776f49f7e136-1-1-1.png
- `eurealimmo-scrape\media\storage_logo-1.png` (72.0 Ko) — https://eurealimmo.com/storage/logo-1.png
- `eurealimmo-scrape\media\themes_flex-home_css_style.css` (64.5 Ko) — https://eurealimmo.com/themes/flex-home/css/style.css
- `eurealimmo-scrape\media\storage_fonts_12dd16c23c_snunitosansv18pe0tmimslybiv1o4x1m8ce2xcx3yop4tqpf-metm0lfgwvpnn64cl7u8uphzibmv51q42ptcp7t1r-tqkr51.woff2` (30.3 Ko) — https://eurealimmo.com/storage/fonts/12dd16c23c/snunitosansv18pe0tmimslybiv1o4x1m8ce2xcx3yop4tqpf-metm0lfgwvpnn64cl7u8uphzibmv51q42ptcp7t1r-tqkr51.woff2
- `eurealimmo-scrape\media\storage_fonts_12dd16c23c_snunitosansv18pe0tmimslybiv1o4x1m8ce2xcx3yop4tqpf-metm0lfgwvpnn64cl7u8uphzibmv51q42ptcp7t7r-tqkr51pe8.woff2` (27.2 Ko) — https://eurealimmo.com/storage/fonts/12dd16c23c/snunitosansv18pe0tmimslybiv1o4x1m8ce2xcx3yop4tqpf-metm0lfgwvpnn64cl7u8uphzibmv51q42ptcp7t7r-tqkr51pe8.woff2
- `eurealimmo-scrape\media\storage_fonts_12dd16c23c_snunitosansv18pe0tmimslybiv1o4x1m8ce2xcx3yop4tqpf-metm0lfgwvpnn64cl7u8uphzibmv51q42ptcp7t4r-tqkr51pe8.woff2` (21.2 Ko) — https://eurealimmo.com/storage/fonts/12dd16c23c/snunitosansv18pe0tmimslybiv1o4x1m8ce2xcx3yop4tqpf-metm0lfgwvpnn64cl7u8uphzibmv51q42ptcp7t4r-tqkr51pe8.woff2
- `eurealimmo-scrape\media\storage_fonts_12dd16c23c_snunitosansv18pe0tmimslybiv1o4x1m8ce2xcx3yop4tqpf-metm0lfgwvpnn64cl7u8uphzibmv51q42ptcp7txr-tqkr51pe8.woff2` (16.1 Ko) — https://eurealimmo.com/storage/fonts/12dd16c23c/snunitosansv18pe0tmimslybiv1o4x1m8ce2xcx3yop4tqpf-metm0lfgwvpnn64cl7u8uphzibmv51q42ptcp7txr-tqkr51pe8.woff2
- `eurealimmo-scrape\media\themes_flex-home_libraries_leaflet_leaflet.css` (13.3 Ko) — https://eurealimmo.com/themes/flex-home/libraries/leaflet/leaflet.css
- `eurealimmo-scrape\media\storage_fonts_12dd16c23c_snunitosansv18pe0tmimslybiv1o4x1m8ce2xcx3yop4tqpf-metm0lfgwvpnn64cl7u8uphzibmv51q42ptcp7t6r-tqkr51pe8.woff2` (10.1 Ko) — https://eurealimmo.com/storage/fonts/12dd16c23c/snunitosansv18pe0tmimslybiv1o4x1m8ce2xcx3yop4tqpf-metm0lfgwvpnn64cl7u8uphzibmv51q42ptcp7t6r-tqkr51pe8.woff2
- `eurealimmo-scrape\media\vendor_core_core_base_libraries_ckeditor_content-styles.css` (10.0 Ko) — https://eurealimmo.com/vendor/core/core/base/libraries/ckeditor/content-styles.css

## Recommandation

D'après le scraping :
- 6 pages sont récupérables
- 17 pages contiennent du contenu Lorem Ipsum / fake US
- 21 médias > 10 Ko méritent une revue manuelle

**Stratégie de migration suggérée** :
1. Réutiliser le logo + favicon (top 3 plus petits médias type .svg/.ico)
2. Recréer toutes les pages from scratch en Next.js (vu le faible nombre de pages clean)
3. Importer la palette couleurs principale dans Tailwind config
4. Archiver le scraping comme preuve légale (en cas de litige avec le dev offshore)

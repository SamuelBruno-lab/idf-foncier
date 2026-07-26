/**
 * Middleware Next.js — routing multi-domaines.
 *
 * Le projet `foncier-idf` héberge plusieurs sites sous un seul déploiement
 * Vercel :
 *   - www.datamerry.com       → app principale DATAMERRY (route /)
 *   - reseau.eurealimmo.com   → landing recrutement Eurealimmo (route /eurealimmo-reseau)
 *   - eurealimmo.com          → vitrine HNWI vendeurs (Y2, à venir)
 *
 * Stratégie :
 *   1. Détecter le hostname dans la requête
 *   2. Si hostname = reseau.eurealimmo.com, réécrire / vers /eurealimmo-reseau
 *      (transparent pour l'utilisateur — l'URL affichée reste reseau.eurealimmo.com)
 *   3. Tout autre hostname → comportement par défaut (DATAMERRY)
 *
 * Configuration Vercel requise :
 *   - Domains > Add : reseau.eurealimmo.com (Vercel donne le CNAME à configurer)
 *   - DNS chez le registrar du domaine eurealimmo.com :
 *       CNAME reseau → cname.vercel-dns.com
 */

import { NextRequest, NextResponse } from "next/server";

const EUREALIMMO_RESEAU_HOSTNAMES = new Set([
  "reseau.eurealimmo.com",
  "www.reseau.eurealimmo.com",
]);

const ESTIMER_COLLABIMO_HOSTNAMES = new Set([
  "estimer.collabimo.com",
  "www.estimer.collabimo.com",
]);

export function middleware(req: NextRequest) {
  const hostname = (req.headers.get("host") ?? "").toLowerCase().split(":")[0];

  // ─── Routing estimer.collabimo.com → /cabinets/collabimo/estimer ────
  // Sous-domaine dédié à l'outil d'estimation public Collabimo (HNWI IDF).
  // Toute requête racine est rewrite vers la page white-label cabinet.
  if (ESTIMER_COLLABIMO_HOSTNAMES.has(hostname)) {
    const url = req.nextUrl.clone();
    const path = url.pathname;

    // API : pas de rewrite
    if (path.startsWith("/api/")) {
      return NextResponse.next();
    }

    // Assets statiques + conventions Next.js metadata (icon, robots, sitemap, og-image)
    if (
      path.startsWith("/_next") ||
      path.startsWith("/favicon") ||
      path === "/icon" || path.startsWith("/icon-") ||
      path === "/apple-icon" || path.startsWith("/apple-icon-") ||
      path === "/opengraph-image" || path.startsWith("/opengraph-image-") ||
      path === "/twitter-image" || path.startsWith("/twitter-image-") ||
      path === "/robots.txt" ||
      path === "/sitemap.xml" || path.startsWith("/sitemap") ||
      path === "/manifest.json" ||
      path.match(/\.(ico|png|jpg|jpeg|svg|webp|gif|woff2?|ttf|css|js|json|xml|txt)$/i)
    ) {
      return NextResponse.next();
    }

    // Racine → page estimation Collabimo
    if (path === "/" || path === "") {
      url.pathname = "/cabinets/collabimo/estimer";
      return NextResponse.rewrite(url);
    }

    // Toute autre route sous estimer.collabimo.com → page estimation
    // (évite que estimer.collabimo.com/foncier expose autre chose)
    if (
      !path.startsWith("/cabinets/collabimo/") &&
      !path.startsWith("/legal/")
    ) {
      url.pathname = "/cabinets/collabimo/estimer";
      return NextResponse.rewrite(url);
    }
  }

  // ─── Routing reseau.eurealimmo.com ─────────────────────────────────
  if (EUREALIMMO_RESEAU_HOSTNAMES.has(hostname)) {
    const url = req.nextUrl.clone();
    const path = url.pathname;

    // Routes API : pas de rewrite, on laisse passer
    if (path.startsWith("/api/")) {
      return NextResponse.next();
    }

    // Route racine → /eurealimmo-reseau
    if (path === "/" || path === "") {
      url.pathname = "/eurealimmo-reseau";
      return NextResponse.rewrite(url);
    }

    // Pages légales : on les expose à la racine sous reseau.eurealimmo.com
    if (path === "/mentions-legales" || path === "/cgu" || path === "/legal/mentions-legales" || path === "/legal/cgu") {
      // Ces pages restent accessibles sur DATAMERRY aussi (mêmes mentions Hoguet pour Eurealimmo)
      return NextResponse.next();
    }

    // Pour toute autre route sous reseau.eurealimmo.com → redirige vers /eurealimmo-reseau
    // (évite que reseau.eurealimmo.com/foncier expose des pages DATAMERRY)
    if (
      !path.startsWith("/eurealimmo-reseau") &&
      !path.startsWith("/_next") &&
      !path.startsWith("/favicon") &&
      !path.match(/\.(ico|png|jpg|jpeg|svg|webp|gif|woff2?|ttf|css|js)$/i)
    ) {
      url.pathname = "/eurealimmo-reseau";
      return NextResponse.rewrite(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  /*
   * Match all request paths except:
   * - Next.js internal (_next/static, _next/image)
   * - Favicon
   * - Static assets
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};

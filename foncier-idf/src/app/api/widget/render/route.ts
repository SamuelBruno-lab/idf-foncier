/**
 * GET /api/widget/render?key=wdmk_…&address=…&surface=…&pieces=…&prix_achat=…&color=…
 *
 * Renvoie un fragment HTML stylé prêt à être injecté dans une div par
 * /public/widget.js. La clé widget (`wdmk_…`) est passée en query string car
 * elle est exposée en clair dans le navigateur (comme une clé Stripe publishable).
 *
 * Sécurité :
 *   - withApiKey vérifie la clé + le header Origin/Referer
 *   - Les clés widget ont allowed_referrers limitant les domaines
 *
 * Customisation :
 *   - data-color → CSS variable --dm-primary (couleur cabinet)
 *
 * Performance : réutilise la même logique métier que /api/property-report
 * mais sans le bagage JSON — pure SSR HTML.
 */

import { NextRequest, NextResponse } from "next/server";

import { geocodeAddress } from "@/lib/geocode";
import { withApiKey, type ApiKeyRecord } from "@/lib/auth/apiKey";
import { getStreetview } from "@/lib/streetview";
import { getEcoles } from "@/lib/datasets/ecoles";
import { getTransports } from "@/lib/datasets/transports";
import { getServices } from "@/lib/datasets/services";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { pointInPolygon } from "@/lib/geo";

// ──────────────────────────────────────────────────────────────────────────────
// Utils de sécurité — échappement HTML pour éviter XSS sur les inputs cabinet
// ──────────────────────────────────────────────────────────────────────────────

const HTML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function esc(s: string | number | null | undefined): string {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) => HTML_ESCAPE[c] ?? c);
}

function fmtEur(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n) + " €";
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(1).replace(".", ",") + " %";
}

function safeColor(raw: string | null): string {
  if (!raw) return "#1f3a8a"; // bleu DATAMERRY par défaut
  const cleaned = raw.trim();
  if (!/^#[0-9a-fA-F]{3,8}$/.test(cleaned)) return "#1f3a8a";
  return cleaned;
}

// ──────────────────────────────────────────────────────────────────────────────
// Handler
// ──────────────────────────────────────────────────────────────────────────────

async function handleWidgetRender(
  req: NextRequest,
  ctx: { key: ApiKeyRecord },
): Promise<NextResponse> {
  const sp = req.nextUrl.searchParams;
  const address = sp.get("address")?.trim() ?? "";
  const surface = Number(sp.get("surface")) || null;
  const pieces = Number(sp.get("pieces")) || null;
  const prixAchat = Number(sp.get("prix_achat")) || null;
  const color = safeColor(sp.get("color"));

  if (address.length < 3) {
    return htmlResponse(
      `<div class="dm-widget dm-error" style="--dm-primary:${color}">
        <p>⚠️ Paramètre <code>data-address</code> requis (min 3 caractères).</p>
      </div>`,
    );
  }

  // 1) Géocodage
  const sb = getSupabaseServerClient();
  const geocode = await geocodeAddress(address, sb).catch(() => null);
  const top = geocode?.results[0];
  if (!top) {
    return htmlResponse(
      `<div class="dm-widget dm-error" style="--dm-primary:${color}">
        <p>Adresse introuvable : <strong>${esc(address)}</strong></p>
      </div>`,
    );
  }

  // 2) Sub-agrégats en parallèle
  const [estim, rendement, plafonds, streetview, ecoles, transports, services] =
    await Promise.all([
      fetchEstimation(sb, top.lat, top.lon, top.code_insee, surface),
      fetchRendement(sb, top.code_insee, pieces),
      fetchPlafonds(sb, top.code_insee),
      getStreetview(top.lat, top.lon).catch(() => null),
      getEcoles(top.lat, top.lon).catch(() => null),
      getTransports(top.lat, top.lon).catch(() => null),
      getServices(top.lat, top.lon).catch(() => null),
    ]);

  // 3) HTML
  const cabinetName = esc(ctx.key.cabinet_name);
  const html = `
<div class="dm-widget" style="--dm-primary:${color}">
  <header class="dm-widget__hdr">
    <span class="dm-widget__cabinet">${cabinetName}</span>
    <span class="dm-widget__by">propulsé par DATAMERRY</span>
  </header>

  <section class="dm-widget__address">
    <h2>${esc(top.label)}</h2>
    <p class="dm-meta">${esc(top.postcode)} ${esc(top.city)}${surface ? ` · ${surface} m²` : ""}${pieces ? ` · ${pieces} pièces` : ""}</p>
  </section>

  ${streetview?.image_url
    ? `<img class="dm-widget__sv" src="${esc(streetview.image_url)}" alt="Vue rue" loading="lazy" />`
    : ""}

  <section class="dm-widget__main">
    <div class="dm-widget__card">
      <h3>Estimation marché</h3>
      ${estim.available
        ? `
        <p class="dm-bignum">${fmtEur(estim.prix_total?.median)}</p>
        <p class="dm-sub">${fmtEur(estim.prix_m2.median)}/m² &middot; fourchette ${fmtEur(estim.prix_total?.p10)} – ${fmtEur(estim.prix_total?.p90)}</p>
        <p class="dm-mini">Basé sur ${estim.cluster_n} ventes notariées DVF dans la zone</p>
      `
        : `<p class="dm-mini">Données insuffisantes pour cette commune.</p>`}
    </div>

    <div class="dm-widget__card">
      <h3>Rendement locatif</h3>
      ${rendement.available
        ? `
        <p class="dm-bignum">${fmtPct(rendement.rendement_brut)}</p>
        <p class="dm-sub">Loyer ${fmtEur(rendement.loyer_m2_median)}/m² · net estimé ${fmtPct(rendement.rendement_net_est)}</p>
        <p class="dm-mini">Source ${esc(rendement.loyer_source ?? "OLAP/ANIL")}</p>
      `
        : `<p class="dm-mini">Pas de référence loyer pour cette zone.</p>`}
    </div>

    <div class="dm-widget__card">
      <h3>Zone fiscale</h3>
      ${plafonds.available
        ? `<p class="dm-bignum">${esc(plafonds.zone_abc)}</p>
           <p class="dm-mini">Éligible Jeanbrun · LLI · Loc'Avantages</p>`
        : `<p class="dm-mini">Zonage A/B/C non identifié.</p>`}
    </div>
  </section>

  <section class="dm-widget__neighborhood">
    <h3>Quartier</h3>
    <div class="dm-widget__scores">
      <div class="dm-score">
        <span class="dm-score__val">${transports?.score_accessibilite ?? "—"}<span class="dm-score__max">/100</span></span>
        <span class="dm-score__lbl">Accessibilité transports</span>
      </div>
      <div class="dm-score">
        <span class="dm-score__val">${services?.score_quotidien ?? "—"}<span class="dm-score__max">/100</span></span>
        <span class="dm-score__lbl">Ville à 15 min</span>
      </div>
      <div class="dm-score">
        <span class="dm-score__val">${ecoles?.count ?? "—"}</span>
        <span class="dm-score__lbl">Écoles &lt; 1,5 km</span>
      </div>
    </div>
  </section>

  <footer class="dm-widget__ftr">
    <span>Données DVF, OLAP, ANIL, INSEE, OpenStreetMap · ${new Date().toLocaleDateString("fr-FR")}</span>
  </footer>
</div>`;

  return htmlResponse(html);
}

function htmlResponse(body: string): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Cache 5 min côté CDN, le widget refetch toutes les 5 min
      "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600",
      // CORS : appel cross-origin depuis le site du cabinet
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Sub-agrégats (versions allégées de property-report)
// ──────────────────────────────────────────────────────────────────────────────

async function fetchEstimation(
  sb: ReturnType<typeof getSupabaseServerClient>,
  lat: number,
  lon: number,
  codeInsee: string,
  surface: number | null,
) {
  const { data: zones, error } = await sb
    .from("dvf_hdbscan_zones")
    .select(
      "id, count, hull_coords, centroid_lat, centroid_lon, prix_m2_median, prix_m2_p10, prix_m2_p90",
    )
    .eq("code_commune", codeInsee)
    .eq("type_local", "Appartement");

  if (error || !zones?.length) {
    return { available: false as const, prix_m2: { median: null, p10: null, p90: null }, prix_total: null, cluster_n: 0 };
  }

  const rows = zones as Array<{
    id: string;
    count: number;
    hull_coords: number[][] | null;
    centroid_lat: number | null;
    centroid_lon: number | null;
    prix_m2_median: number | null;
    prix_m2_p10: number | null;
    prix_m2_p90: number | null;
  }>;
  const point: [number, number] = [lat, lon];
  let match = rows.find((z) => z.hull_coords && pointInPolygon(point, z.hull_coords));
  if (!match) {
    let best: { row: typeof rows[number]; d: number } | null = null;
    for (const z of rows) {
      if (z.centroid_lat == null || z.centroid_lon == null) continue;
      const d = (z.centroid_lat - lat) ** 2 + (z.centroid_lon - lon) ** 2;
      if (!best || d < best.d) best = { row: z, d };
    }
    match = best?.row ?? rows[0];
  }

  const surface_safe = surface && surface > 0 ? surface : null;
  return {
    available: true as const,
    cluster_n: match.count,
    prix_m2: {
      median: match.prix_m2_median,
      p10: match.prix_m2_p10,
      p90: match.prix_m2_p90,
    },
    prix_total: surface_safe && match.prix_m2_median
      ? {
          median: Math.round(match.prix_m2_median * surface_safe),
          p10: match.prix_m2_p10 ? Math.round(match.prix_m2_p10 * surface_safe) : null,
          p90: match.prix_m2_p90 ? Math.round(match.prix_m2_p90 * surface_safe) : null,
        }
      : null,
  };
}

async function fetchRendement(
  sb: ReturnType<typeof getSupabaseServerClient>,
  codeInsee: string,
  pieces: number | null,
) {
  const bucket = pieces == null ? "all" : pieces <= 2 ? "T1-T2" : "T3+";
  const { data } = await sb
    .from("fact_rendement")
    .select("loyer_source, loyer_m2_median, rendement_brut, rendement_net_est")
    .eq("code_commune", codeInsee)
    .eq("type_local", "Appartement")
    .eq("nb_pieces_bucket", bucket)
    .maybeSingle();
  if (!data) {
    return {
      available: false as const,
      loyer_source: null,
      loyer_m2_median: null,
      rendement_brut: null,
      rendement_net_est: null,
    };
  }
  return { available: true as const, ...(data as {
    loyer_source: string | null;
    loyer_m2_median: number | null;
    rendement_brut: number | null;
    rendement_net_est: number | null;
  }) };
}

async function fetchPlafonds(
  sb: ReturnType<typeof getSupabaseServerClient>,
  codeInsee: string,
) {
  const { data } = await sb
    .from("dim_zonage_abc")
    .select("zone_abc")
    .eq("code_insee", codeInsee)
    .maybeSingle();
  if (!data) return { available: false as const, zone_abc: null };
  return { available: true as const, zone_abc: (data as { zone_abc: string }).zone_abc };
}

export const GET = withApiKey(handleWidgetRender, {
  endpoint: "/api/widget/render",
});

/**
 * CORS preflight pour le widget embed.
 * Le navigateur envoie OPTIONS automatiquement quand on inclut un header
 * custom (X-API-Key) sur une requête cross-origin.
 */
export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  const origin = req.headers.get("origin") ?? "*";
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "X-API-Key, Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    },
  });
}

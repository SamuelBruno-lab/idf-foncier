/**
 * GET /api/property-report/pdf?address=…&surface=62&pieces=3
 *                             &color=%231f3a8a    # primaryColor URL-encoded
 *                             &logo=https://…     # URL du logo cabinet
 *                             &include=streetview,ecoles,transports,services
 *
 * Renvoie un PDF rapport brandé (Content-Type: application/pdf), streamé.
 *
 * Le PDF est généré par @react-pdf/renderer (pas Puppeteer) :
 *   - 5 Mo serverless au lieu de 50 Mo
 *   - ~200 ms vs 2-3 s
 *   - pas de Chromium à déployer
 *
 * Le branding cabinet est passé en query string :
 *   - color=#1f3a8a (URL-encoded en %23)
 *   - logo=https://collabimmo.fr/logo.png (URL absolue)
 *
 * Authentification : même clé serveur (dmk_live_…) que /api/property-report.
 * 1 PDF généré = 1 ligne dans api_usage_log (comptabilisé sur l'endpoint).
 */

import { NextRequest, NextResponse } from "next/server";
import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";

import { geocodeAddress } from "@/lib/geocode";
import { withApiKey, type ApiKeyRecord } from "@/lib/auth/apiKey";
import { getStreetview } from "@/lib/streetview";
import { getEcoles } from "@/lib/datasets/ecoles";
import { getTransports } from "@/lib/datasets/transports";
import { getServices } from "@/lib/datasets/services";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { pointInPolygon } from "@/lib/geo";
import { PropertyReportPDF, type PdfReportData, type PdfBranding } from "@/lib/pdf/report";

// ──────────────────────────────────────────────────────────────────────────────
// Validation des paramètres branding (anti-XSS / anti-SSRF)
// ──────────────────────────────────────────────────────────────────────────────

function safeColor(raw: string | null): string {
  if (!raw) return "#1f3a8a";
  const cleaned = raw.trim();
  if (!/^#[0-9a-fA-F]{3,8}$/.test(cleaned)) return "#1f3a8a";
  return cleaned;
}

/**
 * Sanity check sur l'URL logo : doit être https, hostname valide, pas localhost.
 * Évite que le serveur ne fetch des ressources internes (SSRF).
 */
function safeLogoUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return null;
    if (
      u.hostname === "localhost" ||
      u.hostname.endsWith(".local") ||
      /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.)/.test(u.hostname)
    ) {
      return null;
    }
    return u.toString();
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Handler
// ──────────────────────────────────────────────────────────────────────────────

async function handlePropertyReportPdf(
  req: NextRequest,
  ctx: { key: ApiKeyRecord },
): Promise<NextResponse> {
  const sp = req.nextUrl.searchParams;
  const address = sp.get("address")?.trim() ?? "";
  const surface = Number(sp.get("surface")) || null;
  const pieces = Number(sp.get("pieces")) || null;
  const typeLocal = (sp.get("type")?.trim() || "Appartement") as string;
  const color = safeColor(sp.get("color"));
  const logoUrl = safeLogoUrl(sp.get("logo"));
  const cabinetNameQuery = sp.get("cabinet_name")?.trim();

  if (address.length < 3) {
    return NextResponse.json(
      { error: "Paramètre 'address' requis (min 3 caractères)" },
      { status: 400 },
    );
  }

  // 1) Géocodage
  const sb = getSupabaseServerClient();
  const geocode = await geocodeAddress(address, sb).catch(() => null);
  const top = geocode?.results[0];
  if (!top) {
    return NextResponse.json({ error: "Adresse non trouvée" }, { status: 404 });
  }

  // 2) Agrégats en parallèle (même périmètre que /api/property-report avec include=all)
  const [estimation, rendement, plafonds, streetview, ecoles, transports, services] =
    await Promise.all([
      fetchEstimation(sb, top.lat, top.lon, top.code_insee, typeLocal, surface),
      fetchRendement(sb, top.code_insee, typeLocal, pieces),
      fetchPlafonds(sb, top.code_insee),
      getStreetview(top.lat, top.lon).catch(() => null),
      getEcoles(top.lat, top.lon).catch(() => null),
      getTransports(top.lat, top.lon).catch(() => null),
      getServices(top.lat, top.lon).catch(() => null),
    ]);

  // 3) Build payload PDF
  const reportData: PdfReportData = {
    address: {
      label: top.label,
      lat: top.lat,
      lon: top.lon,
      code_insee: top.code_insee,
      postcode: top.postcode,
      city: top.city,
    },
    query: { type_local: typeLocal, surface, pieces },
    estimation,
    rendement,
    plafonds,
    streetview: streetview && streetview.image_url
      ? {
          available: streetview.available,
          image_url: streetview.image_url,
          attribution: streetview.attribution,
          source: streetview.source,
        }
      : null,
    ecoles: ecoles
      ? { count: ecoles.count, par_type: ecoles.par_type }
      : null,
    transports: transports
      ? {
          score_accessibilite: transports.score_accessibilite,
          count: transports.count,
          par_type: transports.par_type,
        }
      : null,
    services_proximite: services
      ? {
          score_quotidien: services.score_quotidien,
          count: services.count,
          par_categorie: services.par_categorie,
        }
      : null,
  };

  const branding: PdfBranding = {
    cabinetName: cabinetNameQuery ?? ctx.key.cabinet_name,
    primaryColor: color,
    cabinetLogoUrl: logoUrl,
    contactInfo: undefined,
  };

  // 4) Rendu PDF en buffer puis envoi
  let pdfBuffer: Buffer;
  try {
    // createElement plutôt que JSX pour rester dans un fichier .ts
    pdfBuffer = await renderToBuffer(
      createElement(PropertyReportPDF, { data: reportData, branding }),
    );
  } catch (err) {
    console.error("[/api/property-report/pdf] render failed:", err);
    return NextResponse.json(
      { error: "pdf_render_failed", hint: String(err) },
      { status: 500 },
    );
  }

  const filename = `datamerry-${top.code_insee}-${Date.now()}.pdf`;
  return new NextResponse(pdfBuffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Content-Length": String(pdfBuffer.length),
      "Cache-Control": "private, no-cache",
    },
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Sub-agrégats (réutilisent la même logique que /api/property-report)
// ──────────────────────────────────────────────────────────────────────────────

async function fetchEstimation(
  sb: ReturnType<typeof getSupabaseServerClient>,
  lat: number,
  lon: number,
  codeInsee: string,
  typeLocal: string,
  surface: number | null,
) {
  const { data: zones, error } = await sb
    .from("dvf_hdbscan_zones")
    .select(
      "id, count, hull_coords, centroid_lat, centroid_lon, prix_m2_median, prix_m2_p10, prix_m2_p90",
    )
    .eq("code_commune", codeInsee)
    .eq("type_local", typeLocal);

  if (error || !zones?.length) {
    return {
      available: false as const,
      prix_m2: { median: null, p10: null, p90: null },
      prix_total: null,
      cluster_n: 0,
    };
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
  let match = rows.find(
    (z) => z.hull_coords && pointInPolygon(point, z.hull_coords),
  );
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
  typeLocal: string,
  pieces: number | null,
) {
  const bucket = pieces == null ? "all" : pieces <= 2 ? "T1-T2" : "T3+";
  const { data } = await sb
    .from("fact_rendement")
    .select("loyer_source, loyer_m2_median, rendement_brut, rendement_net_est")
    .eq("code_commune", codeInsee)
    .eq("type_local", typeLocal)
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
  return {
    available: true as const,
    ...(data as {
      loyer_source: string | null;
      loyer_m2_median: number | null;
      rendement_brut: number | null;
      rendement_net_est: number | null;
    }),
  };
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
  return {
    available: true as const,
    zone_abc: (data as { zone_abc: string }).zone_abc,
  };
}

export const GET = withApiKey(handlePropertyReportPdf, {
  endpoint: "/api/property-report/pdf",
});

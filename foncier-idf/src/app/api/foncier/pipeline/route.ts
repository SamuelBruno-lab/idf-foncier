import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

const ADMIN_SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Communes IDF departements
const IDF_DEPS = ["75", "77", "78", "91", "92", "93", "94", "95"];

// Ville name lookup (will be enriched by geo API)
async function getCityName(insee: string): Promise<string> {
  try {
    const res = await fetch(
      `https://geo.api.gouv.fr/communes/${insee}?fields=nom`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return insee;
    const data = (await res.json()) as { nom?: string };
    return data.nom ?? insee;
  } catch {
    return insee;
  }
}

// DVF median price fallback per department
const DVF_FALLBACK_PRICE: Record<string, number> = {
  "75": 10500,
  "92": 5800,
  "93": 3800,
  "94": 5200,
  "78": 3500,
  "91": 3200,
  "95": 3000,
  "77": 2800,
  "60": 2200, // Oise
};

type CadastreFeature = {
  properties: {
    id: string;
    commune: string;
    section: string;
    numero: string;
    contenance: number;
  };
  geometry: {
    type: string;
    coordinates: unknown;
  };
};

export async function POST(req: NextRequest) {
  // Auth
  const auth = req.headers.get("x-admin-key");
  if (auth !== ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    insee?: string;
    step?: string;
  };
  const insee = body.insee;
  const step = body.step ?? "all"; // "ingest", "score", "all"

  if (!insee || !/^\d{5}$/.test(insee)) {
    return NextResponse.json(
      { error: "Paramètre 'insee' requis (5 chiffres)." },
      { status: 400 }
    );
  }

  const dep = insee.startsWith("75") ? "75" : insee.substring(0, 2);
  if (!IDF_DEPS.includes(dep) && dep !== "60") {
    return NextResponse.json(
      { error: `Commune ${insee} hors IDF+Oise.` },
      { status: 400 }
    );
  }

  const logs: string[] = [];
  const supabase = getSupabaseServerClient();

  try {
    // ===== STEP 1: Ingest cadastre =====
    if (step === "all" || step === "ingest") {
      logs.push(`Fetching cadastre for ${insee}...`);

      const cadastreUrl = `https://cadastre.data.gouv.fr/bundler/cadastre-etalab/communes/${insee}/geojson/parcelles`;
      const res = await fetch(cadastreUrl, {
        signal: AbortSignal.timeout(30000),
        headers: { "Accept-Encoding": "gzip" },
      });

      if (!res.ok) {
        logs.push(`Cadastre API error: ${res.status}`);
        return NextResponse.json(
          { success: false, logs, error: `Cadastre API returned ${res.status}` },
          { status: 502 }
        );
      }

      const geojson = (await res.json()) as {
        features: CadastreFeature[];
      };
      const features = geojson.features;
      logs.push(`Fetched ${features.length} parcels from cadastre`);

      const cityName = await getCityName(insee);
      logs.push(`City: ${cityName}`);

      // Delete existing parcels for this commune (cascade will clean scores)
      const { error: delErr } = await supabase
        .from("parcels")
        .delete()
        .eq("insee_code", insee);
      if (delErr) {
        logs.push(`Warning: delete existing parcels: ${delErr.message}`);
      }

      // Insert parcels via the SQL function (handles ST_Transform)
      // We batch via RPC to handle geometry transformation server-side
      const batchSize = 100;
      let inserted = 0;

      for (let i = 0; i < features.length; i += batchSize) {
        const batch = features.slice(i, i + batchSize);
        const parcelsJson = batch.map((f) => ({
          parcel_id: f.properties.id,
          insee_code: f.properties.commune,
          section: f.properties.section,
          number: f.properties.numero,
          area_m2: f.properties.contenance,
          city_name: cityName,
          geojson: JSON.stringify(f.geometry),
        }));

        const { error: rpcErr } = await supabase.rpc(
          "ingest_cadastre_batch",
          { parcels_json: JSON.stringify(parcelsJson) }
        );

        if (rpcErr) {
          logs.push(
            `Batch ${Math.floor(i / batchSize) + 1} error: ${rpcErr.message}`
          );
          // Try to continue with next batch
        } else {
          inserted += batch.length;
        }
      }

      logs.push(`Inserted ${inserted}/${features.length} parcels`);
    }

    // ===== STEP 2: Score =====
    if (step === "all" || step === "score") {
      logs.push(`Scoring ${insee}...`);

      // Get DVF median price for this commune
      let medianPrice =
        DVF_FALLBACK_PRICE[dep] ?? 3000;

      // Try to get real DVF price from existing clusters
      const { data: dvfData } = await supabase
        .from("dvf_clusters_commune")
        .select("prix_m2_median,count")
        .like("cluster_id", `${insee}_%`)
        .order("count", { ascending: false })
        .limit(1);

      if (dvfData && dvfData.length > 0) {
        medianPrice = dvfData[0].prix_m2_median;
        logs.push(`DVF price found: ${medianPrice} €/m²`);
      } else {
        logs.push(`DVF fallback price: ${medianPrice} €/m²`);
      }

      // Run scoring via RPC
      const { data: scoreResult, error: scoreErr } = await supabase.rpc(
        "score_commune_parcels",
        {
          p_insee: insee,
          p_median_price: medianPrice,
        }
      );

      if (scoreErr) {
        logs.push(`Scoring error: ${scoreErr.message}`);
        return NextResponse.json(
          { success: false, logs, error: scoreErr.message },
          { status: 500 }
        );
      }

      logs.push(`Scored: ${scoreResult ?? "?"} parcels`);
    }

    // Count final results
    const { count } = await supabase
      .from("parcel_scores")
      .select("parcel_id", { count: "exact", head: true })
      .like("parcel_id", `${insee}%`);

    logs.push(`Total scored parcels for ${insee}: ${count ?? 0}`);

    return NextResponse.json({
      success: true,
      insee,
      scored: count ?? 0,
      logs,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logs.push(`FATAL: ${msg}`);
    return NextResponse.json(
      { success: false, logs, error: msg },
      { status: 500 }
    );
  }
}

/**
 * POST /api/staging — Phase D.3 : melgor/stabledesign_interiordesign
 *
 * Modèle spécifiquement entraîné sur la tâche "empty room → furnished room"
 * (2e place Generative Interior Design Competition 2024).
 *
 * Pas de mask : on compose UN prompt combiné à partir des zones,
 * en utilisant le centroïde des polygones comme indicateur de position
 * (gauche/centre/droite, haut/bas).
 *
 * Body (multipart/form-data) :
 *   - image       : File OBLIGATOIRE
 *   - zones_json  : array de zones {type, prompt, mask?, points?:[{x,y}]}
 *   - cabinet_slug: optionnel
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

const REPLICATE_BASE = "https://api.replicate.com/v1";

// melgor/stabledesign_interiordesign — 2nd place Generative Interior Design 2024
const STABLEDESIGN_VERSION =
  "5e13482ea317670bfc797bb18bace359860a721a39b5bbcaa1ffcd241d62bca0";

const ZONE_DESCRIPTIONS: Record<string, string> = {
  cuisine:
    "modern fully-equipped kitchen with white shaker cabinets, oak countertops, marble backsplash, stainless steel range hood",
  repas:
    "dining area with oak wood table, six cane back chairs and a pendant light",
  salon:
    "living room with cream sectional sofa, boucle armchair, marble coffee table, beige rug and large potted plants",
  lecture:
    "cozy reading nook with rattan armchair, arc floor lamp and small side table",
};

function positionHint(centroidX: number, centroidY: number): string {
  // centroidX et Y en % (0-100)
  let horiz = "in the center";
  if (centroidX < 35) horiz = "on the left side";
  else if (centroidX > 65) horiz = "on the right side";
  let vert = "";
  if (centroidY < 35) vert = " against the back wall";
  else if (centroidY > 65) vert = " in the foreground";
  return `${horiz}${vert}`;
}

function computeCentroid(points: { x: number; y: number }[]): { x: number; y: number } {
  if (!points || points.length === 0) return { x: 50, y: 50 };
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  return { x: sumX / points.length, y: sumY / points.length };
}

async function callStableDesign(args: {
  imageUrl: string;
  prompt: string;
}): Promise<{ id: string; status: string; output?: string | string[] }> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN not configured");

  const res = await fetch(`${REPLICATE_BASE}/predictions`, {
    method: "POST",
    headers: {
      Authorization: `Token ${token}`,
      "Content-Type": "application/json",
      Prefer: "wait=60",
    },
    body: JSON.stringify({
      version: STABLEDESIGN_VERSION,
      input: {
        image_base: args.imageUrl,
        prompt: args.prompt,
        strength: 0.95,
        seed: Math.floor(Math.random() * 1000000),
      },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Replicate stabledesign failed: ${res.status} ${t}`);
  }
  return await res.json();
}

async function pollReplicate(predictionId: string, maxSeconds = 120): Promise<{
  status: string;
  output?: string | string[];
  error?: string;
}> {
  const token = process.env.REPLICATE_API_TOKEN;
  const url = `${REPLICATE_BASE}/predictions/${predictionId}`;
  const deadline = Date.now() + maxSeconds * 1000;
  while (Date.now() < deadline) {
    const res = await fetch(url, {
      headers: { Authorization: `Token ${token}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Replicate poll failed: ${res.status}`);
    const data = (await res.json()) as {
      status: string;
      output?: string | string[];
      error?: string;
    };
    if (
      data.status === "succeeded" ||
      data.status === "failed" ||
      data.status === "canceled"
    ) {
      return data;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { status: "timeout" };
}

async function uploadFile(
  sb: ReturnType<typeof getSupabase>,
  file: File,
  pathPrefix: string,
  cabinetSlug: string | null,
): Promise<{ path: string; signedUrl: string }> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const timestamp = Date.now();
  const path = `${pathPrefix}/${cabinetSlug ?? "anon"}/${timestamp}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  const { error } = await sb.storage
    .from("staging-images")
    .upload(path, buf, {
      contentType: file.type || `image/${ext}`,
      upsert: false,
    });
  if (error) throw new Error(`upload_failed: ${error.message}`);
  const { data: signed, error: signErr } = await sb.storage
    .from("staging-images")
    .createSignedUrl(path, 3600);
  if (signErr || !signed?.signedUrl)
    throw new Error(`sign_url_failed: ${signErr?.message}`);
  return { path, signedUrl: signed.signedUrl };
}

type ZoneInput = {
  type: string;
  prompt?: string;
  mask?: string;
  points?: { x: number; y: number }[];
};

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const image = formData.get("image") as File | null;
  const zonesJson = formData.get("zones_json") as string | null;
  const cabinetSlug = (formData.get("cabinet_slug") as string | null) ?? null;

  if (!image || !(image instanceof File)) {
    return NextResponse.json({ ok: false, error: "no_image" }, { status: 400 });
  }
  if (image.size > 20 * 1024 * 1024) {
    return NextResponse.json({ ok: false, error: "image_too_large" }, { status: 400 });
  }
  if (!zonesJson) {
    return NextResponse.json({ ok: false, error: "no_zones" }, { status: 400 });
  }

  let zones: ZoneInput[];
  try {
    zones = JSON.parse(zonesJson) as ZoneInput[];
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_zones_json" }, { status: 400 });
  }
  if (!Array.isArray(zones) || zones.length === 0) {
    return NextResponse.json({ ok: false, error: "empty_zones" }, { status: 400 });
  }

  const sb = getSupabase();

  // 1. Upload image originale
  let imgUp: { path: string; signedUrl: string };
  try {
    imgUp = await uploadFile(sb, image, "originals", cabinetSlug);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "upload_failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  // 2. Construire le prompt combiné depuis les zones + leurs positions
  const zoneDescriptions = zones.map((z) => {
    const desc = ZONE_DESCRIPTIONS[z.type] ?? z.type;
    const centroid = computeCentroid(z.points ?? []);
    const pos = z.points && z.points.length > 0 ? positionHint(centroid.x, centroid.y) : "";
    return pos ? `${desc} ${pos}` : desc;
  });

  const combinedPrompt = `A photorealistic interior design of a bright open living space, scandinavian style, magazine quality. The space contains: ${zoneDescriptions.join("; ")}. Natural light, warm wood floor, white walls preserved. Professional real estate photography.`;

  // 3. Insert job
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const ua = req.headers.get("user-agent");
  const { data: jobIns } = await sb
    .from("staging_jobs")
    .insert({
      cabinet_slug: cabinetSlug,
      client_ip: ip,
      user_agent: ua,
      original_image_path: imgUp.path,
      zones_json: zones.map((z) => ({
        type: z.type,
        prompt: z.prompt,
        points: z.points,
      })),
      replicate_status: "starting",
    })
    .select("id")
    .single();
  const jobId = (jobIns as { id: string } | null)?.id;

  // 4. Single call to StableDesign
  let resultUrl = imgUp.signedUrl;
  const errors: string[] = [];

  try {
    const start = await callStableDesign({
      imageUrl: imgUp.signedUrl,
      prompt: combinedPrompt,
    });
    let final: {
      status: string;
      output?: string | string[];
      error?: string;
    };
    if (start.status === "succeeded" || start.status === "failed") {
      final = start as { status: string; output?: string | string[] };
    } else {
      final = await pollReplicate(start.id, 120);
    }
    if (final.status !== "succeeded") {
      errors.push(`stabledesign: ${final.error ?? final.status}`);
    } else {
      const out = final.output;
      const newUrl = Array.isArray(out) ? out[0] : (out as string | null);
      if (newUrl) resultUrl = newUrl;
    }
  } catch (err) {
    errors.push(`stabledesign: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 5. Update job
  const finalStatus = errors.length === 0 ? "succeeded" : "partial";
  if (jobId) {
    await sb
      .from("staging_jobs")
      .update({
        replicate_status: finalStatus,
        final_image_url: resultUrl,
        result_image_url: resultUrl,
        completed_at: new Date().toISOString(),
        cost_usd: 0.05,
      })
      .eq("id", jobId);
  }

  return NextResponse.json({
    ok: true,
    job_id: jobId,
    result_url: resultUrl,
    original_url: imgUp.signedUrl,
    prompt_used: combinedPrompt,
    zones_processed: zones.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}

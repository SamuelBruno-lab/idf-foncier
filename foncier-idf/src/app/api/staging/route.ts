/**
 * POST /api/staging — Phase D.4 : FLUX Fill Pro (Black Forest Labs)
 *
 * FLUX.1 Fill Pro = state-of-the-art inpainting (nov 2024).
 * Supporte nativement : image + mask + prompt.
 * Black areas of mask preserved, white areas inpainted.
 * Qualité largement supérieure à SDXL inpainting.
 *
 * Multi-pass : 1 appel par zone, chaque résultat devient input de la zone suivante.
 *
 * Body :
 *   - image       : File OBLIGATOIRE
 *   - zones_json  : array de {type, prompt, mask: dataURL_PNG, points}
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

const ZONE_PROMPTS: Record<string, string> = {
  cuisine:
    "modern L-shaped fitted kitchen filling the entire tiled floor area against the wall, base cabinets occupying the full depth of the tile zone with solid oak wood countertop, matching upper wall cabinets mounted on the existing wall at eye level, brushed brass hardware, marble subway tile backsplash between cabinets, stainless steel range hood mounted on the wall, induction cooktop on the countertop, integrated oven below the cooktop, dishwasher built into the base cabinets, fridge built in, plants and decorative items on the counter, scandinavian style, photorealistic interior magazine photo, natural light, the kitchen volume completely occupies the tiled area while preserving the surrounding parquet floor",
  repas:
    "elegant oak wood dining table with six cane back chairs, linear pendant light hanging from ceiling, plants centerpiece, scandinavian style, photorealistic, magazine quality",
  salon:
    "cream sectional sofa, boucle armchair, marble round coffee table, beige tufted area rug, large potted Strelitzia plant, low oak sideboard, framed art on wall, scandinavian style, photorealistic, magazine quality",
  lecture:
    "rattan armchair, tall arc floor lamp, small wooden side table with books, potted plant, cozy scandinavian reading nook, photorealistic, magazine quality",
};

async function callFluxFill(args: {
  imageUrl: string;
  maskUrl: string;
  prompt: string;
}): Promise<{ id: string; status: string; output?: string | string[] }> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN not configured");

  // Endpoint models/.../predictions = pas besoin de version hash pour les modèles BFL officiels
  const res = await fetch(
    `${REPLICATE_BASE}/models/black-forest-labs/flux-fill-pro/predictions`,
    {
      method: "POST",
      headers: {
        Authorization: `Token ${token}`,
        "Content-Type": "application/json",
        Prefer: "wait=60",
      },
      body: JSON.stringify({
        input: {
          image: args.imageUrl,
          mask: args.maskUrl,
          prompt: args.prompt,
          steps: 50,
          guidance: 30,
          output_format: "png",
          safety_tolerance: 2,
        },
      }),
    },
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Replicate FLUX Fill failed: ${res.status} ${t}`);
  }
  return await res.json();
}

async function pollReplicate(predictionId: string, maxSeconds = 180): Promise<{
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

async function uploadFromDataUrl(
  sb: ReturnType<typeof getSupabase>,
  dataUrl: string,
  pathPrefix: string,
  cabinetSlug: string | null,
): Promise<{ path: string; signedUrl: string }> {
  const match = dataUrl.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
  if (!match) throw new Error("invalid_data_url");
  const ext = match[1] === "jpeg" ? "jpg" : match[1];
  const buf = Buffer.from(match[2], "base64");
  const timestamp = Date.now();
  const path = `${pathPrefix}/${cabinetSlug ?? "anon"}/${timestamp}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await sb.storage
    .from("staging-images")
    .upload(path, buf, { contentType: `image/${match[1]}`, upsert: false });
  if (error) throw new Error(`upload_failed: ${error.message}`);
  const { data: signed, error: signErr } = await sb.storage
    .from("staging-images")
    .createSignedUrl(path, 3600);
  if (signErr || !signed?.signedUrl)
    throw new Error(`sign_url_failed: ${signErr?.message}`);
  return { path, signedUrl: signed.signedUrl };
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
  mask: string;
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
  if (zones.length > 4) {
    return NextResponse.json({ ok: false, error: "too_many_zones" }, { status: 400 });
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

  // 2. Insert job
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

  // 3. Multi-pass FLUX Fill (1 appel par zone)
  let currentImageUrl = imgUp.signedUrl;
  const errors: string[] = [];
  let zoneIndex = 0;

  for (const zone of zones) {
    zoneIndex++;
    try {
      // Upload masque
      const maskUp = await uploadFromDataUrl(sb, zone.mask, "masks", cabinetSlug);
      // Choisir prompt
      const prompt = zone.prompt?.trim() || ZONE_PROMPTS[zone.type] || ZONE_PROMPTS.salon;
      // Appel FLUX Fill
      const start = await callFluxFill({
        imageUrl: currentImageUrl,
        maskUrl: maskUp.signedUrl,
        prompt,
      });
      let final: {
        status: string;
        output?: string | string[];
        error?: string;
      };
      if (start.status === "succeeded" || start.status === "failed") {
        final = start as { status: string; output?: string | string[] };
      } else {
        final = await pollReplicate(start.id, 180);
      }
      if (final.status !== "succeeded") {
        errors.push(`zone ${zoneIndex} (${zone.type}): ${final.error ?? final.status}`);
        continue;
      }
      const out = final.output;
      const newUrl = Array.isArray(out) ? out[0] : (out as string | null);
      if (newUrl) {
        currentImageUrl = newUrl;
      }
    } catch (err) {
      errors.push(`zone ${zoneIndex} (${zone.type}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 4. Update job
  const totalCost = zones.length * 0.05; // FLUX Fill Pro ~$0.05/image
  const finalStatus = errors.length === 0 ? "succeeded" : "partial";
  if (jobId) {
    await sb
      .from("staging_jobs")
      .update({
        replicate_status: finalStatus,
        final_image_url: currentImageUrl,
        result_image_url: currentImageUrl,
        completed_at: new Date().toISOString(),
        cost_usd: totalCost,
      })
      .eq("id", jobId);
  }

  return NextResponse.json({
    ok: true,
    job_id: jobId,
    result_url: currentImageUrl,
    original_url: imgUp.signedUrl,
    zones_processed: zones.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}

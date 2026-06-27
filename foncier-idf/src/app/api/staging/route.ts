/**
 * POST /api/staging — Phase D : multi-pass inpainting par zones.
 *
 * Body (multipart/form-data) :
 *   - image       : File OBLIGATOIRE — photo principale de la pièce vide
 *   - zones_json  : string JSON — array de zones :
 *       [{type, prompt, mask: dataURL_PNG}, ...]
 *       (les masques sont générés côté client via Canvas API)
 *   - cabinet_slug: optionnel
 *
 * Process :
 *   Pour chaque zone, dans l'ordre :
 *     1. Upload masque → Supabase Storage
 *     2. Appel Replicate inpainting (image courante + masque + prompt zone)
 *     3. L'image suivante = résultat
 *   Renvoie URL finale.
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

// ────────────────────────────────────────────────────────────────
// Prompts par type de zone
// ────────────────────────────────────────────────────────────────

const ZONE_PROMPTS: Record<string, string> = {
  cuisine:
    "modern fully-equipped kitchen with white shaker cabinets, brushed brass hardware, oak wood countertops, marble backsplash, induction cooktop, integrated stainless steel oven, kitchen island, plants, scandinavian style, photorealistic, magazine quality",
  repas:
    "oak wood dining table with 6 cane back chairs, linear pendant light above, plants centerpiece, soft natural light, scandinavian style, photorealistic, magazine quality",
  salon:
    "cream sectional sofa, boucle armchair, marble round coffee table, beige tufted rug, large potted Strelitzia plant, low oak sideboard, framed art on wall, scandinavian style, photorealistic, magazine quality",
  lecture:
    "rattan armchair, arc floor lamp, small wooden side table with books and candle, plant, cozy reading nook, scandinavian hygge, photorealistic, magazine quality",
};

const NEGATIVE_PROMPT =
  "blurry, low quality, distorted, deformed, watermark, text, logo, people, person, faces, cartoon, anime, sketch, empty room, modified architecture";

// ────────────────────────────────────────────────────────────────
// Replicate inpainting
// ────────────────────────────────────────────────────────────────

const REPLICATE_BASE = "https://api.replicate.com/v1";

async function callInpaint(args: {
  imageUrl: string;
  maskUrl: string;
  prompt: string;
}): Promise<{ id: string; status: string; output?: string | string[] }> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN not configured");

  // lucataco/sdxl-inpainting (vrai SDXL 1.0 Inpainting HuggingFace diffusers)
  // Resolution native 1024x1024. Inputs HF diffusers standards.
  const SDXL_INPAINT_VERSION =
    "a5b13068cc81a89a4fbeefeccc774869fcb34df4dbc92c1555e0f2771d49dde7";
  const res = await fetch(`${REPLICATE_BASE}/predictions`, {
    method: "POST",
    headers: {
      Authorization: `Token ${token}`,
      "Content-Type": "application/json",
      Prefer: "wait=60",
    },
    body: JSON.stringify({
      version: SDXL_INPAINT_VERSION,
      input: {
        image: args.imageUrl,
        mask: args.maskUrl,
        prompt: args.prompt,
        negative_prompt: NEGATIVE_PROMPT,
        num_inference_steps: 30,
        guidance_scale: 8,
        strength: 0.99,
        num_outputs: 1,
      },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Replicate inpaint failed: ${res.status} ${t}`);
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

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────────────
// Handler
// ────────────────────────────────────────────────────────────────

type ZoneInput = {
  type: string;
  prompt?: string;
  mask: string; // dataURL PNG
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
  if (zones.length > 6) {
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
      zones_json: zones.map((z) => ({ type: z.type, prompt: z.prompt })),
      replicate_status: "starting",
    })
    .select("id")
    .single();
  const jobId = (jobIns as { id: string } | null)?.id;

  // 3. Multi-pass inpainting
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
      // Appel inpainting
      const start = await callInpaint({
        imageUrl: currentImageUrl,
        maskUrl: maskUp.signedUrl,
        prompt,
      });
      // Poll si pas terminé
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
        errors.push(`zone ${zoneIndex} (${zone.type}): ${final.error ?? final.status}`);
        continue; // on garde l'image courante et passe à la zone suivante
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
  const totalCost = zones.length * 0.012;
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

/**
 * POST /api/staging
 *
 * Virtual home staging via Replicate.
 *
 * Body (multipart/form-data) :
 *   - image       : File (photo de pièce vide, JPG/PNG/WEBP, < 20 MB)
 *   - room_type   : "salon" | "chambre" | "cuisine" | "sdb" | "bureau"
 *   - style       : "moderne" | "scandinave" | "luxe" | "industriel"
 *   - cabinet_slug: optionnel (pour quotas + tracking)
 *
 * Réponse :
 *   { ok: true, job_id, result_url, original_url }
 *
 * Modèle Replicate utilisé : adirik/interior-design
 * Coût : ~0.02 € par image.
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
// Construction du prompt à partir du type de pièce + style
// ────────────────────────────────────────────────────────────────

const ROOM_DESCRIPTIONS: Record<string, string> = {
  salon: "luxurious living room with sofa, armchairs, coffee table, side tables, decorative lamps, rugs",
  chambre: "elegant bedroom with king-size bed, headboard, nightstands, bedside lamps, dresser, mirror, rug",
  cuisine: "modern fully-equipped kitchen with island, stools, pendant lights, appliances, plants",
  sdb: "modern bathroom with vanity, double sinks, large mirror, lighting fixtures, towels, plants",
  bureau: "stylish home office with desk, ergonomic chair, bookshelves, lamp, plants, framed art",
};

const STYLE_DESCRIPTIONS: Record<string, string> = {
  moderne:
    "modern contemporary style, clean lines, neutral palette (white, beige, charcoal), minimalist, natural materials, large windows",
  scandinave:
    "scandinavian nordic style, light woods, white walls, cozy textiles, plants, warm minimalist, hygge atmosphere",
  luxe:
    "luxury high-end interior, marble surfaces, brass and gold accents, velvet upholstery, crystal lighting, sophisticated and elegant, art pieces",
  industriel:
    "industrial loft style, exposed brick, metal beams, leather sofa, raw wood, Edison bulbs, vintage decor",
};

function buildPrompt(roomType: string, style: string, custom?: string): string {
  const room = ROOM_DESCRIPTIONS[roomType] ?? ROOM_DESCRIPTIONS.salon;
  const styleDesc = STYLE_DESCRIPTIONS[style] ?? STYLE_DESCRIPTIONS.moderne;
  const base = `A photorealistic interior photograph of a fully furnished ${room}, ${styleDesc}, professional real estate photography, high resolution, soft natural lighting, magazine quality`;
  return custom ? `${base}, ${custom}` : base;
}

const NEGATIVE_PROMPT =
  "blurry, low quality, distorted, deformed, watermark, text, logo, people, person, faces, cartoon, anime, sketch, dark, gloomy, empty room";

// ────────────────────────────────────────────────────────────────
// Replicate API helpers
// ────────────────────────────────────────────────────────────────

const REPLICATE_API = "https://api.replicate.com/v1/predictions";
// adirik/interior-design — modèle stable et éprouvé
// (le hash de version doit être mis à jour si le modèle évolue)
const REPLICATE_MODEL_VERSION =
  "76604baddc85b1b4616e1c6475eca080da339c8875bd4996705440484a6eac38";

async function callReplicate(args: {
  imageUrl: string;
  prompt: string;
}): Promise<{ id: string; status: string; output?: string | string[] }> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    throw new Error("REPLICATE_API_TOKEN not configured");
  }

  const startRes = await fetch(REPLICATE_API, {
    method: "POST",
    headers: {
      Authorization: `Token ${token}`,
      "Content-Type": "application/json",
      Prefer: "wait=60",
    },
    body: JSON.stringify({
      version: REPLICATE_MODEL_VERSION,
      input: {
        image: args.imageUrl,
        prompt: args.prompt,
        negative_prompt: NEGATIVE_PROMPT,
        num_inference_steps: 50,
        guidance_scale: 9,
        prompt_strength: 0.8,
      },
    }),
  });

  if (!startRes.ok) {
    const errText = await startRes.text();
    throw new Error(`Replicate start failed: ${startRes.status} ${errText}`);
  }

  return await startRes.json();
}

async function pollReplicate(predictionId: string, maxSeconds = 90): Promise<{
  status: string;
  output?: string | string[];
  error?: string;
}> {
  const token = process.env.REPLICATE_API_TOKEN;
  const url = `${REPLICATE_API}/${predictionId}`;
  const deadline = Date.now() + maxSeconds * 1000;

  while (Date.now() < deadline) {
    const res = await fetch(url, {
      headers: { Authorization: `Token ${token}` },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Replicate poll failed: ${res.status}`);
    }
    const data = (await res.json()) as {
      status: string;
      output?: string | string[];
      error?: string;
    };
    if (data.status === "succeeded" || data.status === "failed" || data.status === "canceled") {
      return data;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { status: "timeout" };
}

// ────────────────────────────────────────────────────────────────
// Handler
// ────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("image") as File | null;
  const roomType = (formData.get("room_type") as string | null) ?? "salon";
  const style = (formData.get("style") as string | null) ?? "moderne";
  const customPrompt = (formData.get("custom_prompt") as string | null) ?? undefined;
  const cabinetSlug = (formData.get("cabinet_slug") as string | null) ?? null;

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "no_image" }, { status: 400 });
  }
  if (file.size > 20 * 1024 * 1024) {
    return NextResponse.json({ ok: false, error: "image_too_large" }, { status: 400 });
  }

  const sb = getSupabase();

  // 1. Upload original dans Supabase Storage (bucket privé)
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const timestamp = Date.now();
  const originalPath = `originals/${cabinetSlug ?? "anon"}/${timestamp}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());

  const { error: uploadErr } = await sb.storage
    .from("staging-images")
    .upload(originalPath, buf, {
      contentType: file.type || `image/${ext}`,
      upsert: false,
    });

  if (uploadErr) {
    return NextResponse.json(
      { ok: false, error: "upload_failed", detail: uploadErr.message },
      { status: 500 },
    );
  }

  // 2. URL signée 1h pour que Replicate puisse lire
  const { data: signed, error: signErr } = await sb.storage
    .from("staging-images")
    .createSignedUrl(originalPath, 3600);

  if (signErr || !signed?.signedUrl) {
    return NextResponse.json(
      { ok: false, error: "sign_url_failed", detail: signErr?.message },
      { status: 500 },
    );
  }

  // 3. Insert job
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const ua = req.headers.get("user-agent");
  const { data: jobIns } = await sb
    .from("staging_jobs")
    .insert({
      cabinet_slug: cabinetSlug,
      client_ip: ip,
      user_agent: ua,
      original_image_path: originalPath,
      room_type: roomType,
      style,
      custom_prompt: customPrompt,
      replicate_status: "starting",
    })
    .select("id")
    .single();

  const jobId = (jobIns as { id: string } | null)?.id;

  // 4. Appel Replicate
  const prompt = buildPrompt(roomType, style, customPrompt);

  let predictionId: string;
  let resultUrl: string | null = null;
  let finalStatus = "failed";
  let errMsg: string | undefined;

  try {
    const startResp = await callReplicate({
      imageUrl: signed.signedUrl,
      prompt,
    });
    predictionId = startResp.id;

    if (jobId) {
      await sb
        .from("staging_jobs")
        .update({
          replicate_prediction_id: predictionId,
          replicate_status: startResp.status,
        })
        .eq("id", jobId);
    }

    // Poll si pas déjà terminé
    let finalResp: { status: string; output?: string | string[]; error?: string };
    if (startResp.status === "succeeded" || startResp.status === "failed") {
      finalResp = startResp as { status: string; output?: string | string[] };
    } else {
      finalResp = await pollReplicate(predictionId, 90);
    }

    finalStatus = finalResp.status;
    if (finalResp.status === "succeeded") {
      const out = finalResp.output;
      resultUrl = Array.isArray(out) ? out[0] : (out as string | null);
    } else if (finalResp.error) {
      errMsg = finalResp.error;
    }
  } catch (err) {
    errMsg = err instanceof Error ? err.message : String(err);
  }

  // 5. Update job + return
  if (jobId) {
    await sb
      .from("staging_jobs")
      .update({
        replicate_status: finalStatus,
        result_image_url: resultUrl,
        completed_at: new Date().toISOString(),
        cost_usd: finalStatus === "succeeded" ? 0.02 : 0,
      })
      .eq("id", jobId);
  }

  if (finalStatus !== "succeeded" || !resultUrl) {
    return NextResponse.json(
      {
        ok: false,
        error: "staging_failed",
        detail: errMsg ?? `status: ${finalStatus}`,
        job_id: jobId,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    job_id: jobId,
    result_url: resultUrl,
    original_url: signed.signedUrl,
    prompt_used: prompt,
  });
}

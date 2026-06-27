/**
 * POST /api/staging
 *
 * Virtual home staging Phase C — multi-photos + plan 2D.
 *
 * Body (multipart/form-data) :
 *   - image       : File OBLIGATOIRE — photo 1 de pièce vide
 *   - image_2     : File optionnel — autre angle de la même pièce
 *   - plan        : File optionnel — plan 2D (PDF/PNG/JPG)
 *   - room_type   : "salon" | "sejour_cuisine" | "chambre" | "cuisine" | "sdb" | "bureau"
 *   - style       : "moderne" | "scandinave" | "luxe" | "industriel"
 *   - cabinet_slug: optionnel
 *
 * Modèles utilisés :
 *   - Si plan présent → `lucataco/sdxl-controlnet` (Canny edges du plan)
 *   - Sinon          → `adirik/interior-design` (mode mono-image simple)
 *
 * Cohérence : si 2 photos fournies, même seed utilisée → style consistant.
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
// Prompts
// ────────────────────────────────────────────────────────────────

const ROOM_DESCRIPTIONS: Record<string, string> = {
  salon: "luxurious living room with sofa, armchairs, coffee table, side tables, decorative lamps, rugs",
  sejour_cuisine: "open-plan living-dining-kitchen space with kitchen island, bar stools, dining table with chairs, sofa, coffee table, pendant lights over island, integrated appliances, plants, large windows",
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
// Replicate
// ────────────────────────────────────────────────────────────────

const REPLICATE_API = "https://api.replicate.com/v1/predictions";

// Modèle mono-image (pas de plan)
const MODEL_SIMPLE_VERSION =
  "76604baddc85b1b4616e1c6475eca080da339c8875bd4996705440484a6eac38";

// Modèle SDXL + ControlNet Canny (avec plan)
// lucataco/sdxl-controlnet — supporte une image principale + une image de control
const MODEL_CONTROLNET_VERSION =
  "db21e45e5fe6e7b7e5b6f3a4dc54f5e6c5dfaf9c46aff3c8f6b3ad6ee9a2e8d2";

async function callReplicateSimple(args: {
  imageUrl: string;
  prompt: string;
  seed?: number;
}): Promise<{ id: string; status: string; output?: string | string[] }> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN not configured");

  const res = await fetch(REPLICATE_API, {
    method: "POST",
    headers: {
      Authorization: `Token ${token}`,
      "Content-Type": "application/json",
      Prefer: "wait=60",
    },
    body: JSON.stringify({
      version: MODEL_SIMPLE_VERSION,
      input: {
        image: args.imageUrl,
        prompt: args.prompt,
        negative_prompt: NEGATIVE_PROMPT,
        num_inference_steps: 50,
        guidance_scale: 9,
        prompt_strength: 0.8,
        ...(args.seed !== undefined ? { seed: args.seed } : {}),
      },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Replicate simple start failed: ${res.status} ${t}`);
  }
  return await res.json();
}

async function callReplicateControlNet(args: {
  imageUrl: string;
  controlImageUrl: string;
  prompt: string;
  seed?: number;
}): Promise<{ id: string; status: string; output?: string | string[] }> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN not configured");

  const res = await fetch(REPLICATE_API, {
    method: "POST",
    headers: {
      Authorization: `Token ${token}`,
      "Content-Type": "application/json",
      Prefer: "wait=60",
    },
    body: JSON.stringify({
      version: MODEL_CONTROLNET_VERSION,
      input: {
        image: args.imageUrl,
        control_image: args.controlImageUrl,
        prompt: args.prompt,
        negative_prompt: NEGATIVE_PROMPT,
        num_inference_steps: 50,
        guidance_scale: 9,
        controlnet_conditioning_scale: 0.7,
        ...(args.seed !== undefined ? { seed: args.seed } : {}),
      },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Replicate controlnet start failed: ${res.status} ${t}`);
  }
  return await res.json();
}

async function pollReplicate(predictionId: string, maxSeconds = 120): Promise<{
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
    if (!res.ok) throw new Error(`Replicate poll failed: ${res.status}`);
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
// Helpers
// ────────────────────────────────────────────────────────────────

async function uploadToSupabase(
  sb: ReturnType<typeof getSupabase>,
  file: File,
  pathPrefix: string,
  cabinetSlug: string | null,
): Promise<{ path: string; signedUrl: string }> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const timestamp = Date.now();
  const path = `${pathPrefix}/${cabinetSlug ?? "anon"}/${timestamp}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  const { error: uploadErr } = await sb.storage
    .from("staging-images")
    .upload(path, buf, {
      contentType: file.type || `image/${ext}`,
      upsert: false,
    });
  if (uploadErr) throw new Error(`upload_failed: ${uploadErr.message}`);

  const { data: signed, error: signErr } = await sb.storage
    .from("staging-images")
    .createSignedUrl(path, 3600);
  if (signErr || !signed?.signedUrl) throw new Error(`sign_url_failed: ${signErr?.message}`);

  return { path, signedUrl: signed.signedUrl };
}

async function runStaging(args: {
  imageUrl: string;
  planUrl?: string;
  prompt: string;
  seed: number;
}): Promise<{ resultUrl: string | null; status: string; error?: string }> {
  try {
    const start = args.planUrl
      ? await callReplicateControlNet({
          imageUrl: args.imageUrl,
          controlImageUrl: args.planUrl,
          prompt: args.prompt,
          seed: args.seed,
        })
      : await callReplicateSimple({
          imageUrl: args.imageUrl,
          prompt: args.prompt,
          seed: args.seed,
        });

    let final: { status: string; output?: string | string[]; error?: string };
    if (start.status === "succeeded" || start.status === "failed") {
      final = start as { status: string; output?: string | string[] };
    } else {
      final = await pollReplicate(start.id, 120);
    }

    if (final.status === "succeeded") {
      const out = final.output;
      const url = Array.isArray(out) ? out[0] : (out as string | null);
      return { resultUrl: url, status: "succeeded" };
    }
    return { resultUrl: null, status: final.status, error: final.error };
  } catch (err) {
    return {
      resultUrl: null,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ────────────────────────────────────────────────────────────────
// Handler
// ────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const image1 = formData.get("image") as File | null;
  const image2 = formData.get("image_2") as File | null;
  const plan = formData.get("plan") as File | null;
  const roomType = (formData.get("room_type") as string | null) ?? "salon";
  const style = (formData.get("style") as string | null) ?? "moderne";
  const customPrompt = (formData.get("custom_prompt") as string | null) ?? undefined;
  const cabinetSlug = (formData.get("cabinet_slug") as string | null) ?? null;

  if (!image1 || !(image1 instanceof File)) {
    return NextResponse.json({ ok: false, error: "no_image" }, { status: 400 });
  }
  if (image1.size > 20 * 1024 * 1024) {
    return NextResponse.json({ ok: false, error: "image_too_large" }, { status: 400 });
  }

  const sb = getSupabase();

  // 1. Uploads
  let img1Up: { path: string; signedUrl: string };
  let img2Up: { path: string; signedUrl: string } | null = null;
  let planUp: { path: string; signedUrl: string } | null = null;
  try {
    img1Up = await uploadToSupabase(sb, image1, "originals", cabinetSlug);
    if (image2 && image2 instanceof File && image2.size > 0) {
      img2Up = await uploadToSupabase(sb, image2, "originals", cabinetSlug);
    }
    if (plan && plan instanceof File && plan.size > 0) {
      // TODO Phase C.2 : conversion PDF → PNG si plan.type === "application/pdf"
      // Pour POC : on accepte PDF tel quel, Replicate fallback gère certains PDF
      planUp = await uploadToSupabase(sb, plan, "plans", cabinetSlug);
    }
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "upload_failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  // 2. Insert job
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const ua = req.headers.get("user-agent");
  const seed = Math.floor(Math.random() * 1_000_000_000);
  const { data: jobIns } = await sb
    .from("staging_jobs")
    .insert({
      cabinet_slug: cabinetSlug,
      client_ip: ip,
      user_agent: ua,
      original_image_path: img1Up.path,
      photo_2_path: img2Up?.path ?? null,
      plan_path: planUp?.path ?? null,
      room_type: roomType,
      style,
      custom_prompt: customPrompt,
      replicate_status: "starting",
      seed_used: seed,
    })
    .select("id")
    .single();
  const jobId = (jobIns as { id: string } | null)?.id;

  // 3. Build prompt
  const prompt = buildPrompt(roomType, style, customPrompt);

  // 4. Run staging photo 1
  const r1 = await runStaging({
    imageUrl: img1Up.signedUrl,
    planUrl: planUp?.signedUrl,
    prompt,
    seed,
  });

  // 5. Run staging photo 2 (si fourni) — même seed = cohérence stylistique
  let r2: { resultUrl: string | null; status: string; error?: string } | null = null;
  if (img2Up) {
    r2 = await runStaging({
      imageUrl: img2Up.signedUrl,
      planUrl: planUp?.signedUrl,
      prompt,
      seed,
    });
  }

  // 6. Update job
  const totalCost = (r1.resultUrl ? 0.05 : 0) + (r2?.resultUrl ? 0.05 : 0);
  if (jobId) {
    await sb
      .from("staging_jobs")
      .update({
        replicate_status: r1.status === "succeeded" && (r2?.status ?? "succeeded") === "succeeded" ? "succeeded" : "partial_or_failed",
        result_image_url: r1.resultUrl,
        result_image_url_2: r2?.resultUrl ?? null,
        completed_at: new Date().toISOString(),
        cost_usd: totalCost,
      })
      .eq("id", jobId);
  }

  if (!r1.resultUrl) {
    return NextResponse.json(
      {
        ok: false,
        error: "staging_failed",
        detail: r1.error ?? `status: ${r1.status}`,
        job_id: jobId,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    job_id: jobId,
    result_url: r1.resultUrl,
    original_url: img1Up.signedUrl,
    result_url_2: r2?.resultUrl ?? null,
    original_url_2: img2Up?.signedUrl ?? null,
    plan_used: planUp?.signedUrl ?? null,
    prompt_used: prompt,
    seed,
  });
}

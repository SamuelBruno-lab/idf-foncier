/**
 * GET /api/dev/admin-bypass?slug=X&email=Y&key=SECRET
 *
 * Endpoint de bypass admin pour les tests internes — DATAMERRY uniquement.
 *
 * Cas d'usage : Resend KO / domaine non vérifié / mail dans spams perdus.
 * On contourne le magic link en signant directement un cookie de session.
 *
 * SÉCURITÉ :
 *   - Endpoint INACTIF si l'env var DM_DEV_BYPASS_KEY est vide ou absente
 *     → renvoie 404 (pas d'indice qu'il existe)
 *   - Si la var est set : on exige `key` query param qui matche
 *   - Le cabinet doit exister + être actif
 *
 * À RETIRER ou désactiver (DM_DEV_BYPASS_KEY="") avant production publique.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { signSession, ADMIN_SESSION_COOKIE, ADMIN_SESSION_TTL_SECONDS } from "@/lib/admin-auth";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const expectedKey = process.env.DM_DEV_BYPASS_KEY;

  // Inactif par défaut (pas de var d'env → 404)
  if (!expectedKey) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const sp = req.nextUrl.searchParams;
  const key = sp.get("key");
  const slug = (sp.get("slug") ?? "").toLowerCase().trim();
  const email = (sp.get("email") ?? "").toLowerCase().trim();

  // Vérifie le secret (constant-time best effort — pas critique pour cet endpoint)
  if (!key || key !== expectedKey) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (!slug || !email) {
    return NextResponse.json(
      { error: "missing_params", required: ["slug", "email"] },
      { status: 400 },
    );
  }

  // Vérifie que le cabinet existe et est actif
  const sb = getSupabase();
  const { data: cabinet } = await sb
    .from("dim_cabinets_white_label")
    .select("slug, active")
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();

  if (!cabinet) {
    return NextResponse.json({ error: "cabinet_not_found_or_inactive" }, { status: 404 });
  }

  // Signe la session + set le cookie + redirige vers le dashboard
  const sessionToken = signSession(slug, email);
  const redirectUrl = `${req.nextUrl.origin}/cabinets/${slug}/admin`;

  const res = NextResponse.redirect(redirectUrl);
  res.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: sessionToken,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: ADMIN_SESSION_TTL_SECONDS,
  });
  return res;
}

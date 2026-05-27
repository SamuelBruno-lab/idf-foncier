/**
 * GET /api/cabinets/{slug}/admin/verify?token=XXX
 *
 * Endpoint cliqué depuis le magic link reçu par email :
 *   1. Vérifie le token (existe, non utilisé, non expiré, matche le slug)
 *   2. Marque used_at
 *   3. Set le cookie session HttpOnly dm_admin_session
 *   4. Redirige vers /cabinets/{slug}/admin (dashboard)
 *
 * Si le token est invalide → redirige vers /cabinets/{slug}/admin/login
 * avec ?error=invalid_token pour informer l'utilisateur.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  consumeMagicLinkToken,
  signSession,
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
} from "@/lib/admin-auth";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug: rawSlug } = await ctx.params;
  const slug = rawSlug.toLowerCase();

  const token = req.nextUrl.searchParams.get("token");
  const baseUrl = req.nextUrl.origin;

  if (!token) {
    return NextResponse.redirect(`${baseUrl}/cabinets/${slug}/admin/login?error=missing_token`);
  }

  const result = await consumeMagicLinkToken(token);

  if (!result || result.cabinet_slug !== slug) {
    return NextResponse.redirect(
      `${baseUrl}/cabinets/${slug}/admin/login?error=invalid_or_expired`,
    );
  }

  // Génère le cookie session signé
  const sessionToken = signSession(result.cabinet_slug, result.email);

  const redirectUrl = `${baseUrl}/cabinets/${slug}/admin`;
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

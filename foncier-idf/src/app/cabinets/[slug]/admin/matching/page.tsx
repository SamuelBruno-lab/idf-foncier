/**
 * Page admin de paramétrage du matching géo-spatial des leads
 * vers les membres Collabimo.
 *
 * URL : /cabinets/[slug]/admin/matching
 *
 * Auth : cookie session admin (pattern admin-auth.ts).
 */

import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { verifySession, ADMIN_SESSION_COOKIE } from "@/lib/admin-auth";
import { getSupabaseServerClient } from "@/lib/supabase-server";

import { MatchingConfigForm } from "./MatchingConfigForm";

export const metadata: Metadata = {
  title: "Paramètres de matching — Admin",
  robots: { index: false, follow: false },
};

const ALLOWED_SLUGS = new Set(["collabimo", "collabimo-test", "eurealimmo"]);

async function fetchConfig(cabinetSlug: string) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("matching_config")
    .select("*")
    .eq("cabinet_slug", cabinetSlug)
    .single();

  if (error || !data) {
    // Si la ligne n'existe pas, la créer avec valeurs par défaut
    const { data: created } = await supabase
      .from("matching_config")
      .insert({ cabinet_slug: cabinetSlug })
      .select("*")
      .single();
    return created;
  }
  return data;
}

export default async function MatchingAdminPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  if (!ALLOWED_SLUGS.has(slug)) {
    notFound();
  }

  // Auth
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  const session = sessionToken ? await verifySession(sessionToken) : null;
  if (!session || session.cabinet_slug !== slug) {
    const h = await headers();
    const proto = h.get("x-forwarded-proto") ?? "https";
    const host = h.get("host") ?? "localhost:3000";
    redirect(
      `/cabinets/${slug}/admin/login?next=${encodeURIComponent(
        `${proto}://${host}/cabinets/${slug}/admin/matching`,
      )}`,
    );
  }

  const config = await fetchConfig(slug);
  if (!config) {
    notFound();
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#fafaf9",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <MatchingConfigForm initial={config} cabinetSlug={slug} />
    </main>
  );
}

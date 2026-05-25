/**
 * Layout pour pages white-label cabinet.
 *
 * Masque le Header global DATAMERRY pour laisser place au branding du cabinet.
 * Charge les infos du cabinet en SSR et les met à disposition des pages enfant
 * via props (passées par le système de slot Next.js).
 */

import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase-server";

type Cabinet = {
  slug: string;
  cabinet_name: string;
  primary_color: string;
  secondary_color: string | null;
  logo_url: string | null;
  font_family: string | null;
  cta_contact_url: string;
  cta_contact_label: string;
  contact_email: string | null;
  contact_phone: string | null;
  legal_mention: string | null;
};

async function loadCabinet(slug: string): Promise<Cabinet | null> {
  const sb = getSupabaseServerClient();
  const { data, error } = await sb
    .from("dim_cabinets_white_label")
    .select(
      "slug, cabinet_name, primary_color, secondary_color, logo_url, font_family, cta_contact_url, cta_contact_label, contact_email, contact_phone, legal_mention",
    )
    .eq("slug", slug.toLowerCase())
    .eq("active", true)
    .maybeSingle();
  if (error || !data) return null;
  return data as Cabinet;
}

export default async function CabinetLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const cabinet = await loadCabinet(slug);
  if (!cabinet) notFound();

  const primary = cabinet.primary_color || "#1f3a8a";
  const secondary = cabinet.secondary_color || primary;

  return (
    <>
      {/* Reset du layout global DATAMERRY (header datamerry caché) */}
      <style
        // eslint-disable-next-line react/no-unknown-property
        dangerouslySetInnerHTML={{
          __html: `
            body { margin: 0 !important; padding: 0 !important; }
            body > header,
            body > div > header,
            body > nav,
            body > div > nav {
              display: none !important;
            }
            :root {
              --cabinet-primary: ${primary};
              --cabinet-secondary: ${secondary};
            }
          `,
        }}
      />

      <div
        style={{
          minHeight: "100vh",
          fontFamily:
            cabinet.font_family ??
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          background: "#f8fafc",
          color: "#0f172a",
        }}
      >
        {/* Header cabinet */}
        <header
          style={{
            background: "white",
            borderBottom: "1px solid #e2e8f0",
            padding: "16px 24px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {cabinet.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cabinet.logo_url}
                alt={cabinet.cabinet_name}
                style={{ height: 36, width: "auto", objectFit: "contain" }}
              />
            ) : (
              <span
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: primary,
                  letterSpacing: "0.02em",
                }}
              >
                {cabinet.cabinet_name.toUpperCase()}
              </span>
            )}
          </div>
          {cabinet.contact_phone || cabinet.contact_email ? (
            <div style={{ fontSize: 13, color: "#475569", textAlign: "right" }}>
              {cabinet.contact_phone && (
                <div>
                  📞 <a href={`tel:${cabinet.contact_phone}`} style={{ color: primary, textDecoration: "none" }}>{cabinet.contact_phone}</a>
                </div>
              )}
              {cabinet.contact_email && (
                <div style={{ fontSize: 11, color: "#64748b" }}>
                  <a href={`mailto:${cabinet.contact_email}`} style={{ color: primary, textDecoration: "none" }}>{cabinet.contact_email}</a>
                </div>
              )}
            </div>
          ) : null}
        </header>

        {/* Contenu de la page */}
        <main style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px" }}>
          {children}
        </main>

        {/* Footer obligatoire */}
        <footer
          style={{
            textAlign: "center",
            padding: "20px 16px 40px",
            borderTop: "1px solid #e2e8f0",
            marginTop: 40,
            background: "white",
            fontSize: 11,
            color: "#94a3b8",
          }}
        >
          {cabinet.legal_mention && (
            <div style={{ marginBottom: 6 }}>{cabinet.legal_mention}</div>
          )}
          <div>
            Estimation propulsée par{" "}
            <a
              href="https://datamerry.com"
              style={{ color: "#475569", textDecoration: "none", fontWeight: 600 }}
            >
              DATAMERRY®
            </a>{" "}
            · Sources officielles DVF (notaires), OLAP, ANIL, ADEME, INSEE
          </div>
        </footer>
      </div>
    </>
  );
}

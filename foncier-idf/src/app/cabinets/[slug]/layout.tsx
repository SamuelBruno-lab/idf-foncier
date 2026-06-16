/**
 * Layout pour pages white-label cabinet.
 *
 * Masque le Header global DATAMERRY pour laisser place au branding du cabinet.
 * Ajoute la navigation cabinet (config par slug) et un footer minimal "Propulsé par DATAMERRY".
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

// Config navigation par cabinet — à déplacer en BDD quand >3 cabinets
const CABINET_NAV: Record
  string,
  {
    homeUrl: string;
    legalUrl: string;
    items: { label: string; href: string }[];
    ctaSecondary?: { label: string; href: string };
    ctaPrimary?: { label: string; href: string };
  }
> = {
  collabimo: {
    homeUrl: "https://collabimo.com",
    legalUrl: "https://collabimo.com/mentions-legales",
    items: [
      { label: "Vendre", href: "https://collabimo.com/vendre" },
      { label: "Acheter", href: "https://collabimo.com/acheter" },
      { label: "A propos", href: "https://collabimo.com/a-propos" },
      { label: "Nos professionnels", href: "https://collabimo.com/nos-professionnels" },
      { label: "Contact", href: "https://collabimo.com/contact" },
    ],
    ctaSecondary: { label: "RDV Experts", href: "https://collabimo.com/rdv-experts" },
    ctaPrimary: { label: "Se connecter", href: "https://collabimo.com/login" },
  },
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
  const nav = CABINET_NAV[slug.toLowerCase()];

  return (
    <>
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
        {/* Header cabinet avec navigation */}
        <header
          style={{
            background: "white",
            borderBottom: "1px solid #e2e8f0",
            padding: "16px 24px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 16,
          }}
        >
          {/* Logo cliquable */}
          
            href={nav?.homeUrl ?? "/"}
            style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none" }}
          >
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
          </a>

          {/* Navigation centrale */}
          {nav && (
            <nav style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
              {nav.items.map((item) => (
                
                  key={item.href}
                  href={item.href}
                  style={{
                    color: "#0f172a",
                    fontSize: 14,
                    fontWeight: 500,
                    textDecoration: "none",
                  }}
                >
                  {item.label}
                </a>
              ))}
            </nav>
          )}

          {/* CTAs droite */}
          {nav?.ctaSecondary || nav?.ctaPrimary ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {nav.ctaSecondary && (
                
                  href={nav.ctaSecondary.href}
                  style={{
                    padding: "8px 16px",
                    border: `1px solid ${primary}`,
                    borderRadius: 999,
                    color: primary,
                    textDecoration: "none",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {nav.ctaSecondary.label}
                </a>
              )}
              {nav.ctaPrimary && (
                
                  href={nav.ctaPrimary.href}
                  style={{
                    padding: "8px 16px",
                    background: primary,
                    borderRadius: 999,
                    color: "white",
                    textDecoration: "none",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {nav.ctaPrimary.label}
                </a>
              )}
            </div>
          ) : cabinet.contact_phone || cabinet.contact_email ? (
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

        {/* Footer minimaliste */}
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
          <div style={{ marginBottom: 6 }}>
            Propulsé par{" "}
            
              href="https://datamerry.com"
              style={{ color: "#475569", textDecoration: "none", fontWeight: 600 }}
            >
              DATAMERRY®
            </a>{" "}
            · Sources : DVF, OLAP, ANIL, ADEME, INSEE
          </div>
          {nav?.legalUrl && (
            <div>
              
                href={nav.legalUrl}
                style={{ color: "#94a3b8", textDecoration: "none" }}
              >
                Mentions légales
              </a>
            </div>
          )}
        </footer>
      </div>
    </>
  );
}

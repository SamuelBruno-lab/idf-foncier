/**
 * Layout pour pages white-label cabinet.
 *
 * Header avec branding cabinet + navigation.
 * Footer riche avec colonnes du site + liens légaux + mention DATAMERRY.
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

type NavItem = { label: string; href: string };
type FooterColumn = { title: string; items: NavItem[] };

type CabinetNavConfig = {
  homeUrl: string;
  legalUrl: string;
  logoUrl: string | null;
  items: NavItem[];
  ctaSecondary: NavItem | null;
  ctaPrimary: NavItem | null;
  footerColumns: FooterColumn[] | null;
  footerBottomLinks: NavItem[] | null;
  copyright: string | null;
};

const CABINET_NAV: Record<string, CabinetNavConfig> = {
  collabimo: {
    homeUrl: "https://www.collabimo.com",
    legalUrl: "https://www.collabimo.com/mentions-legales",
    logoUrl: "https://assets.softr-files.com/applications/b7e89bf9-c5d9-48f5-84f6-705e2b400a61/assets/7f2b2fb1-ad77-4419-9093-a2bddbe9de6c.png",
    items: [
      { label: "Vendre", href: "https://www.collabimo.com/vendre" },
      { label: "Acheter", href: "https://www.collabimo.com/acheter" },
      { label: "A propos", href: "https://www.collabimo.com/a-propos" },
      { label: "Nos professionnels", href: "https://www.collabimo.com/professionnels" },
      { label: "Contact", href: "https://www.collabimo.com/contact" },
    ],
    ctaSecondary: { label: "RDV Experts", href: "https://www.collabimo.com/rendez-vous" },
    ctaPrimary: { label: "Se connecter", href: "https://www.collabimo.com/connexion" },
    footerColumns: [
      {
        title: "NOS PAGES",
        items: [
          { label: "Accueil", href: "https://www.collabimo.com" },
          { label: "Vendre", href: "https://www.collabimo.com/vendre" },
          { label: "Acheter", href: "https://www.collabimo.com/acheter" },
        ],
      },
      {
        title: "CONTACT",
        items: [
          { label: "Nos professionnels", href: "https://www.collabimo.com/professionnels" },
          { label: "Collabimo", href: "https://www.collabimo.com/contact" },
        ],
      },
      {
        title: "RENDEZ-VOUS",
        items: [
          { label: "Professionnels", href: "https://www.collabimo.com/professionnels" },
          { label: "Expert Collabimo", href: "https://www.collabimo.com/rendez-vous" },
        ],
      },
    ],
    footerBottomLinks: [
      { label: "CGU", href: "https://www.collabimo.com/cgu" },
      { label: "Mentions légales", href: "https://www.collabimo.com/mentions-legales" },
      { label: "Contact", href: "https://www.collabimo.com/contact" },
    ],
    copyright: "© 2026 Collabimo. Tous droits réservés.",
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
  const nav: CabinetNavConfig | undefined =
    CABINET_NAV[slug.toLowerCase()] ||
    CABINET_NAV[(cabinet.slug || "").toLowerCase()] ||
    CABINET_NAV[(cabinet.cabinet_name || "").toLowerCase().replace(/[^a-z0-9]/g, "")];
  const homeUrl = nav ? nav.homeUrl : "/";
  const logoUrl = (nav && nav.logoUrl) || cabinet.logo_url;
  const fontFam = cabinet.font_family || "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  const hasCtas = nav && (nav.ctaSecondary || nav.ctaPrimary);
  const hasContact = cabinet.contact_phone || cabinet.contact_email;

  return (
    <>
      <style
        // eslint-disable-next-line react/no-unknown-property
        dangerouslySetInnerHTML={{
          __html: `
            body { margin: 0 !important; padding: 0 !important; }
            body > header,
            body > nav {
              display: none !important;
            }
            :root {
              --cabinet-primary: ${primary};
              --cabinet-secondary: ${secondary};
            }
          `,
        }}
      />

      <div style={{ minHeight: "100vh", fontFamily: fontFam, background: "#f8fafc", color: "#0f172a" }}>
        {/* HEADER */}
        <div role="banner" style={{ background: "white", borderBottom: "1px solid #e2e8f0", padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
          <a href={homeUrl} style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none" }}>
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={cabinet.cabinet_name} style={{ height: 40, width: "auto", objectFit: "contain" }} />
            ) : (
              <span style={{ fontSize: 22, fontWeight: 800, color: primary, letterSpacing: "0.02em" }}>
                {cabinet.cabinet_name.toUpperCase()}
              </span>
            )}
          </a>

          {nav ? (
            <div role="navigation" style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
              {nav.items.map((item) => (
                <a key={item.href} href={item.href} style={{ color: "#0f172a", fontSize: 14, fontWeight: 500, textDecoration: "none" }}>
                  {item.label}
                </a>
              ))}
            </div>
          ) : null}

          {hasCtas ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {nav && nav.ctaSecondary ? (
                <a href={nav.ctaSecondary.href} style={{ padding: "8px 16px", border: `1px solid ${primary}`, borderRadius: 999, color: primary, textDecoration: "none", fontSize: 13, fontWeight: 600 }}>
                  {nav.ctaSecondary.label}
                </a>
              ) : null}
              {nav && nav.ctaPrimary ? (
                <a href={nav.ctaPrimary.href} style={{ padding: "8px 16px", background: primary, borderRadius: 999, color: "white", textDecoration: "none", fontSize: 13, fontWeight: 600 }}>
                  {nav.ctaPrimary.label}
                </a>
              ) : null}
            </div>
          ) : hasContact ? (
            <div style={{ fontSize: 13, color: "#475569", textAlign: "right" }}>
              {cabinet.contact_phone ? (
                <div>
                  📞 <a href={`tel:${cabinet.contact_phone}`} style={{ color: primary, textDecoration: "none" }}>{cabinet.contact_phone}</a>
                </div>
              ) : null}
              {cabinet.contact_email ? (
                <div style={{ fontSize: 11, color: "#64748b" }}>
                  <a href={`mailto:${cabinet.contact_email}`} style={{ color: primary, textDecoration: "none" }}>{cabinet.contact_email}</a>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* MAIN */}
        <main style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px" }}>
          {children}
        </main>

        {/* FOOTER RICHE */}
        <div style={{ background: "white", borderTop: "1px solid #e2e8f0", marginTop: 40 }}>
          {nav && nav.footerColumns ? (
            <div style={{ maxWidth: 1200, margin: "0 auto", padding: "48px 24px 24px", display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr", gap: 32 }}>
              <div>
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt={cabinet.cabinet_name} style={{ height: 40, width: "auto", objectFit: "contain", marginBottom: 16 }} />
                ) : null}
              </div>
              {nav.footerColumns.map((col) => (
                <div key={col.title}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#64748b", marginBottom: 16, letterSpacing: "0.05em" }}>
                    {col.title}
                  </div>
                  {col.items.map((item) => (
                    <a key={item.href} href={item.href} style={{ display: "block", fontSize: 14, color: "#0f172a", textDecoration: "none", marginBottom: 8 }}>
                      {item.label}
                    </a>
                  ))}
                </div>
              ))}
            </div>
          ) : null}

          {nav && (nav.copyright || nav.footerBottomLinks) ? (
            <div style={{ borderTop: "1px solid #e2e8f0" }}>
              <div style={{ maxWidth: 1200, margin: "0 auto", padding: "20px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16, fontSize: 12, color: "#94a3b8" }}>
                <div>{nav.copyright || ""}</div>
                {nav.footerBottomLinks ? (
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                    {nav.footerBottomLinks.map((item) => (
                      <a key={item.href} href={item.href} style={{ color: "#94a3b8", textDecoration: "none" }}>
                        {item.label}
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Mention DATAMERRY (toujours) */}
          <div style={{ borderTop: "1px solid #f1f5f9", padding: "16px 24px 32px", fontSize: 11, color: "#94a3b8", textAlign: "center" }}>
            Propulsé par{" "}
            <a href="https://datamerry.com" style={{ color: "#475569", textDecoration: "none", fontWeight: 600 }}>
              DATAMERRY®
            </a>{" "}
            · Sources : DVF, OLAP, ANIL, ADEME, INSEE
          </div>
        </div>
      </div>
    </>
  );
}

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
      { label: "Estimer mon bien", href: "https://estimer.collabimo.com" },
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
          { label: "Estimer mon bien", href: "https://estimer.collabimo.com" },
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
    CABINET_NAV[(cabinet.cabinet_

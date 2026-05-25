"use client";

/**
 * Page Estimer brandée cabinet (white-label).
 *
 * URL : /cabinets/{slug}/estimer
 *
 * Le visiteur passe par un assistant conversationnel (EstimWizard) qui
 * collecte progressivement les caractéristiques du bien (vendeur/acheteur,
 * type, adresse, surface, étage, DPE, état, extérieurs, usage…) avant de
 * lancer l'estimation et de l'orienter vers le CTA cabinet.
 */

import { useEffect, useState } from "react";
import EstimWizard from "@/components/EstimWizard";

type Cabinet = {
  cabinet_name: string;
  primary_color: string;
  cta_contact_url: string;
  cta_contact_label: string;
};

async function fetchCabinet(slug: string): Promise<Cabinet | null> {
  try {
    const res = await fetch(`/api/cabinets/${slug}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as Cabinet;
  } catch {
    return null;
  }
}

export default function EstimerPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const [slug, setSlug] = useState<string>("");
  const [cabinet, setCabinet] = useState<Cabinet | null>(null);

  useEffect(() => {
    (async () => {
      const { slug: s } = await params;
      setSlug(s);
      const cab = await fetchCabinet(s);
      setCabinet(cab);
    })();
  }, [params]);

  if (!cabinet || !slug) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
        Chargement…
      </div>
    );
  }

  const primary = cabinet.primary_color ?? "#1f3a8a";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <section
        style={{
          background: `linear-gradient(135deg, ${primary}10 0%, ${primary}25 100%)`,
          borderRadius: 16,
          padding: "40px 24px",
          textAlign: "center",
          border: `1px solid ${primary}40`,
        }}
      >
        <h1 style={{ fontSize: 30, color: primary, marginBottom: 8 }}>
          Combien vaut votre bien ?
        </h1>
        <p
          style={{
            color: "#475569",
            fontSize: 15,
            maxWidth: 600,
            margin: "0 auto",
          }}
        >
          Estimation gratuite et instantanée — {cabinet.cabinet_name} vous
          propose un premier avis basé sur les ventes notariées DVF et les
          données officielles, via un assistant qui vous pose les bonnes
          questions.
        </p>
      </section>

      <EstimWizard
        slug={slug}
        primaryColor={primary}
        cabinetName={cabinet.cabinet_name}
        ctaUrl={cabinet.cta_contact_url}
        ctaLabel={cabinet.cta_contact_label}
      />
    </div>
  );
}

/**
 * Page parrainage — espace mandataire.
 *
 * URL : /mandataire/[id]/workspace/parrainage
 *
 * Affiche les codes referral du mandataire (founder + standard) avec
 * URL complète, bouton copier, QR code, compteur global réseau.
 */

import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ReferralLinksCard } from "./ReferralLinksCard";

async function fetchReferralCodes(id: string, baseUrl: string) {
  try {
    const res = await fetch(`${baseUrl}/api/mandataire/${id}/referral-codes`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export default async function WorkspaceParrainagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const protocol = host.includes("localhost") ? "http" : "https";
  const baseUrl = `${protocol}://${host}`;

  const data = await fetchReferralCodes(id, baseUrl);
  if (!data || !data.ok) notFound();

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{ fontFamily: "Georgia, serif", fontSize: 28, fontWeight: 700, margin: "0 0 4px" }}
        >
          Parrainage
        </h1>
        <p style={{ color: "#64748b", fontSize: 14, margin: 0 }}>
          Tes liens uniques pour recruter dans le réseau Eurealimmo.
          Tu touches 18 % à vie sur les commissions de tes filleuls.
        </p>
      </div>

      <ReferralLinksCard
        founderCodes={data.founder_codes}
        standardCodes={data.standard_codes}
        network={data.network}
      />
    </div>
  );
}

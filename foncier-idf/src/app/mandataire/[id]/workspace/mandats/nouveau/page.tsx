/**
 * Page création manuelle d'un mandat.
 * URL : /mandataire/[id]/workspace/mandats/nouveau
 *
 * Permet à Diara de générer un mandat sans lead pré-existant.
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

import { ManualMandatForm } from "./ManualMandatForm";

const PRIMARY = "#c8a25d";
const DARK = "#0f172a";
const MUTED = "#64748b";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function fetchMandataire(id: string) {
  if (!UUID_RE.test(id)) return null;
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data } = await sb
    .from("eurealimmo_mandataires")
    .select("id, first_name, last_name, contract_signed_at")
    .eq("id", id)
    .maybeSingle();
  return data as {
    id: string;
    first_name: string;
    last_name: string;
    contract_signed_at: string | null;
  } | null;
}

export default async function NouveauMandatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const mandataire = await fetchMandataire(id);
  if (!mandataire) notFound();

  const cabinetSlug = "eurealimmo";

  return (
    <div>
      {/* Breadcrumb */}
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/mandataire/${id}/workspace/leads`}
          style={{ fontSize: 12, color: MUTED, textDecoration: "none", fontWeight: 500 }}
        >
          ← Retour à mes leads
        </Link>
      </div>

      {/* Titre */}
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontFamily: "Georgia, serif",
            fontSize: 26,
            fontWeight: 700,
            margin: "0 0 4px",
            color: DARK,
          }}
        >
          📝 Créer un mandat manuellement
        </h1>
        <p style={{ color: MUTED, fontSize: 13, margin: 0, lineHeight: 1.5 }}>
          Pour les clients que vous avez déjà en main (hors flux estimation en ligne).
          Le mandat sera ajouté à votre registre et au DOCX généré sera conforme loi
          Hoguet (n°70-9) + décret 72-678.
        </p>
      </div>

      {/* Gate contrat */}
      {!mandataire.contract_signed_at && (
        <div
          style={{
            background: "#fef3c7",
            border: "1px solid #f59e0b",
            borderRadius: 8,
            padding: 16,
            marginBottom: 20,
            color: "#78350f",
            fontSize: 13,
            lineHeight: 1.6,
          }}
        >
          <strong>🔒 Génération de mandat verrouillée</strong>
          <br />
          La signature de mandats Hoguet sera activée dès que votre contrat de
          mandataire commercial Eurealimmo aura été signé et que votre inscription
          au RSAC sera effective. Vous pouvez préremplir le formulaire en
          prévisualisation, mais l'envoi est bloqué.
        </div>
      )}

      <ManualMandatForm mandataireId={id} cabinetSlug={cabinetSlug} />
    </div>
  );
}

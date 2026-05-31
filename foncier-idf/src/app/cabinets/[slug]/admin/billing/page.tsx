/**
 * Page admin cabinet : gestion de l'abonnement DATAMERRY Pro.
 *
 * URL : /cabinets/[slug]/admin/billing
 *
 * Auth : cookie session admin (verifySession + slug match).
 *
 * Fonctionnalités :
 *   - Si pas d'abonnement : carte "Souscrire 39 €/mo" → Stripe Checkout
 *   - Si abonné : status, période en cours, bouton "Gérer mon abonnement" → portail Stripe
 *   - Gère les query params status=success / status=cancel après retour Checkout
 */

import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { verifySession, ADMIN_SESSION_COOKIE } from "@/lib/admin-auth";
import { BillingActions } from "./BillingActions";

export const metadata: Metadata = {
  title: "Mon abonnement DATAMERRY",
  robots: { index: false, follow: false },
};

const PRIMARY = "#1f3a8a";
const DARK = "#0f172a";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

const STATUS_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  active: { label: "✓ Actif", color: "#065f46", bg: "#d1fae5" },
  trialing: { label: "Essai en cours", color: "#1e40af", bg: "#dbeafe" },
  past_due: { label: "Paiement en retard", color: "#92400e", bg: "#fef3c7" },
  canceled: { label: "Annulé", color: "#475569", bg: "#f1f5f9" },
  unpaid: { label: "Impayé", color: "#991b1b", bg: "#fee2e2" },
  incomplete: { label: "En cours d'activation", color: "#475569", bg: "#f8fafc" },
  paused: { label: "En pause", color: "#475569", bg: "#f1f5f9" },
};

export default async function AdminBillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { slug } = await params;
  const { status: returnStatus } = await searchParams;

  // Auth check
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  const session = verifySession(sessionCookie);
  if (!session || session.slug !== slug) {
    redirect(`/cabinets/${slug}/admin/login`);
  }

  // Récupère le statut billing actuel
  const sb = getSupabase();
  const { data: subData } = await sb
    .from("v_cabinet_billing_status")
    .select("*")
    .eq("cabinet_slug", slug)
    .maybeSingle();

  const sub = subData as {
    cabinet_slug: string;
    status: string;
    plan_name: string;
    plan_amount_eur: number;
    plan_interval: string;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    trial_end: string | null;
    stripe_customer_id: string | null;
    customer_email: string | null;
  } | null;

  const hasActiveSub =
    sub && ["active", "trialing", "past_due"].includes(sub.status);

  // Récupère le cabinet pour le branding
  const { data: cabinet } = await sb
    .from("dim_cabinets_white_label")
    .select("slug, brand_name, primary_color, contact_email")
    .eq("slug", slug)
    .maybeSingle();

  const c = cabinet as {
    slug: string;
    brand_name: string;
    primary_color: string | null;
    contact_email: string;
  } | null;

  const brandColor = c?.primary_color ?? PRIMARY;

  return (
    <main style={{ background: "#fafafa", color: DARK, minHeight: "100vh" }}>
      {/* Header */}
      <header style={{ background: DARK, padding: "18px 24px" }}>
        <div
          style={{
            maxWidth: 920,
            margin: "0 auto",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 16,
          }}
        >
          <div>
            <div style={{ color: "white", fontWeight: 700, fontSize: 14, letterSpacing: "0.05em" }}>
              {c?.brand_name ?? slug.toUpperCase()}
            </div>
            <div style={{ color: brandColor, fontSize: 10, letterSpacing: "0.1em" }}>
              MON ABONNEMENT
            </div>
          </div>
          <nav style={{ display: "flex", gap: 16, fontSize: 13 }}>
            <Link href={`/cabinets/${slug}/admin`} style={{ color: "#cbd5e1" }}>
              ← Dashboard
            </Link>
            <span style={{ color: brandColor, fontWeight: 700 }}>Billing</span>
          </nav>
        </div>
      </header>

      {/* Message de retour Stripe */}
      {returnStatus === "success" && (
        <div
          style={{
            background: "#d1fae5",
            padding: "16px 24px",
            color: "#065f46",
            textAlign: "center",
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          🎉 Souscription confirmée ! Votre abonnement DATAMERRY Pro est en cours
          d&apos;activation. Vous recevrez la facture par email sous quelques minutes.
        </div>
      )}
      {returnStatus === "cancel" && (
        <div
          style={{
            background: "#fef3c7",
            padding: "16px 24px",
            color: "#78350f",
            textAlign: "center",
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          Souscription annulée. Vous pouvez revenir quand vous voulez.
        </div>
      )}

      {/* Contenu */}
      <section style={{ padding: "40px 24px" }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <h1
            style={{
              fontFamily: "Georgia, serif",
              fontSize: 32,
              fontWeight: 700,
              margin: "0 0 8px",
            }}
          >
            Mon abonnement DATAMERRY
          </h1>
          <p style={{ color: "#64748b", fontSize: 15, marginBottom: 32 }}>
            Plateforme d&apos;estimation immobilière propulsée par 11 M de transactions DVF
            + micro-marchés HDBSCAN + IDFM PRIM + chatbot LLM.
          </p>

          {hasActiveSub && sub ? (
            <ActiveSubscriptionCard sub={sub} slug={slug} />
          ) : (
            <NoSubscriptionCard slug={slug} brandColor={brandColor} />
          )}

          {/* Avantages plan */}
          <div
            style={{
              marginTop: 32,
              padding: 24,
              background: "white",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
            }}
          >
            <h3
              style={{ fontFamily: "Georgia, serif", fontSize: 18, margin: "0 0 16px" }}
            >
              Inclus dans DATAMERRY Pro
            </h3>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {[
                "Estimation immobilière en 30 sec (DVF 11M+ transactions)",
                "Rapport PDF brandé vendeur (8 pages, micro-marchés HDBSCAN)",
                "Widget embed pour votre site (estimator + chatbot)",
                "Chatbot LLM conseiller métier 24/7",
                "Pipeline leads → CRM cabinet intégré",
                "Datasets enrichis : transports IDFM, lycées, POI, grands projets",
                "Évolution prix micro-marché 5-10 ans",
                "Modulation prix selon contexte économique (DCF, élasticité taux)",
                "Mise à jour datasets : 6 mois",
                "Support 5j/7 par email",
              ].map((item, i) => (
                <li
                  key={i}
                  style={{
                    paddingLeft: 26,
                    position: "relative",
                    marginBottom: 8,
                    fontSize: 13,
                    color: "#475569",
                    lineHeight: 1.5,
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      left: 0,
                      color: brandColor,
                      fontWeight: 700,
                    }}
                  >
                    ✓
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}

function NoSubscriptionCard({ slug, brandColor }: { slug: string; brandColor: string }) {
  return (
    <div
      style={{
        background: "white",
        border: `2px solid ${brandColor}`,
        borderRadius: 12,
        padding: 32,
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.15em",
          color: brandColor,
          fontWeight: 700,
          marginBottom: 12,
        }}
      >
        DATAMERRY PRO
      </div>
      <div style={{ marginBottom: 16 }}>
        <span style={{ fontFamily: "Georgia, serif", fontSize: 56, fontWeight: 700 }}>
          39 €
        </span>
        <span style={{ fontSize: 16, color: "#94a3b8", marginLeft: 6 }}>/ mois HT</span>
      </div>
      <p style={{ color: "#475569", marginBottom: 28, fontSize: 14 }}>
        Engagement mensuel, résiliable à tout moment. TVA 20 % facturée automatiquement
        (déductible si vous êtes assujetti).
      </p>
      <BillingActions slug={slug} action="checkout" brandColor={brandColor} />
      <p style={{ marginTop: 16, fontSize: 11, color: "#94a3b8" }}>
        Paiement sécurisé via Stripe — carte bancaire, SEPA, Apple/Google Pay.
      </p>
    </div>
  );
}

function ActiveSubscriptionCard({
  sub,
  slug,
}: {
  sub: {
    status: string;
    plan_name: string;
    plan_amount_eur: number;
    plan_interval: string;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    trial_end: string | null;
  };
  slug: string;
}) {
  const statusInfo = STATUS_LABEL[sub.status] ?? STATUS_LABEL.incomplete;
  return (
    <div
      style={{
        background: "white",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        padding: 28,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.15em",
              color: "#94a3b8",
              fontWeight: 700,
            }}
          >
            PLAN ACTUEL
          </div>
          <div
            style={{ fontFamily: "Georgia, serif", fontSize: 24, fontWeight: 700 }}
          >
            {sub.plan_name}
          </div>
        </div>
        <span
          style={{
            padding: "6px 14px",
            background: statusInfo.bg,
            color: statusInfo.color,
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.02em",
          }}
        >
          {statusInfo.label}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <InfoBlock label="Montant" value={`${(sub.plan_amount_eur / 100).toFixed(0)} € / ${sub.plan_interval === "month" ? "mois" : "an"} HT`} />
        <InfoBlock
          label="Prochaine échéance"
          value={
            sub.current_period_end
              ? new Date(sub.current_period_end).toLocaleDateString("fr-FR", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })
              : "—"
          }
        />
        {sub.cancel_at_period_end && (
          <InfoBlock
            label="Annulation"
            value="En fin de période"
            valueColor="#92400e"
          />
        )}
      </div>

      <BillingActions slug={slug} action="portal" brandColor="#1f3a8a" />
    </div>
  );
}

function InfoBlock({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          color: "#94a3b8",
          fontWeight: 700,
          letterSpacing: "0.1em",
          marginBottom: 4,
        }}
      >
        {label.toUpperCase()}
      </div>
      <div
        style={{
          fontWeight: 700,
          fontSize: 15,
          color: valueColor ?? "#0f172a",
        }}
      >
        {value}
      </div>
    </div>
  );
}

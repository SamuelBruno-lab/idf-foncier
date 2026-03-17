import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { Resend } from "resend";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  const email: string = (body.email ?? "").trim().toLowerCase();
  const prenom: string = (body.prenom ?? "").trim().slice(0, 80);
  const nom_famille: string = (body.nom_famille ?? "").trim().slice(0, 80);
  const nom: string = (body.nom ?? `${prenom} ${nom_famille}`.trim()).slice(0, 160);
  const societe: string = (body.societe ?? "").trim().slice(0, 120);
  const telephone: string = (body.telephone ?? "").trim().slice(0, 30);
  const consentement: boolean = body.consentement === true;
  const intent: string = (body.intent ?? "").trim().slice(0, 30);
  const commune_code: string = (body.commune_code ?? "").trim().slice(0, 10);
  const commune_nom: string = (body.commune_nom ?? "").trim().slice(0, 120);
  const budget: string = (body.budget ?? "").trim().slice(0, 60);
  const timeline: string = (body.timeline ?? "").trim().slice(0, 60);

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Email invalide" }, { status: 400 });
  }
  if (!consentement) {
    return NextResponse.json({ error: "Consentement requis" }, { status: 400 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const ip_hash = createHash("sha256").update(ip).digest("hex").slice(0, 16);

  const { error } = await getSupabase().from("leads").upsert(
    {
      email,
      nom: nom || null,
      prenom: prenom || null,
      societe: societe || null,
      telephone: telephone || null,
      consentement,
      ip_hash,
      source: (body.source ?? "carte_idf").slice(0, 80),
      intent: intent || null,
      commune_code: commune_code || null,
      commune_nom: commune_nom || null,
      budget: budget || null,
      timeline: timeline || null,
    },
    { onConflict: "email", ignoreDuplicates: false }
  );

  if (error) {
    console.error("leads insert error:", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }

  // Notification email non-bloquante
  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const intentLabels: Record<string, string> = {
      acheteur: "J'achète",
      vendeur: "Je vends",
      investisseur: "J'investis",
      agent: "Je suis agent",
    };
    const intentDisplay = intent ? (intentLabels[intent] ?? intent) : "—";
    const subjectSuffix = intent && commune_nom
      ? ` · ${intentDisplay} · ${commune_nom}`
      : "";

    // Notification interne → contact@datamerry.com
    resend.emails.send({
      from: "datamerry <no-reply@datamerry.com>",
      to: "contact@datamerry.com",
      subject: `[datamerry] Nouveau lead · ${nom || email}${subjectSuffix}`,
      text: [
        intent ? `Nouveau lead — ${intentDisplay}` : `Nouvelle inscription accès anticipé.`,
        ``,
        `Prénom   : ${prenom || "—"}`,
        `Nom      : ${nom_famille || "—"}`,
        `Email    : ${email}`,
        `Société  : ${societe || "—"}`,
        `Téléphone: ${telephone || "—"}`,
        `Intent   : ${intentDisplay}`,
        `Commune  : ${commune_nom || "—"}${commune_code ? ` (${commune_code})` : ""}`,
        `Budget   : ${budget || "—"}`,
        `Horizon  : ${timeline || "—"}`,
        `Source   : ${(body.source ?? "carte_idf")}`,
        ``,
        `→ Supabase leads : https://supabase.com/dashboard/project/zexkxstcwkdsqjgsppvx/editor`,
      ].join("\n"),
    }).catch((err: unknown) => console.error("resend lead notification error:", err));

    // Confirmation email → utilisateur
    if (intent && commune_nom) {
      const confirmMessages: Record<string, string[]> = {
        acheteur: [
          `Bonjour ${prenom || ""},`,
          ``,
          `Votre demande pour ${commune_nom} a bien été prise en compte.`,
          ``,
          `Un expert du marché immobilier de ${commune_nom} vous contactera très prochainement pour vous proposer une sélection de biens correspondant à votre recherche.`,
          ``,
          `À très vite,`,
          `L'équipe datamerry`,
          `https://datamerry.com`,
        ],
        vendeur: [
          `Bonjour ${prenom || ""},`,
          ``,
          `Votre demande d'estimation pour ${commune_nom} a bien été enregistrée.`,
          ``,
          `Un expert du marché de ${commune_nom} vous contactera prochainement pour vous fournir une estimation gratuite de votre bien.`,
          ``,
          `À très vite,`,
          `L'équipe datamerry`,
          `https://datamerry.com`,
        ],
        investisseur: [
          `Bonjour ${prenom || ""},`,
          ``,
          `Votre demande pour investir à ${commune_nom} a bien été prise en compte.`,
          ``,
          `Un expert du marché vous contactera prochainement avec les données de rentabilité et les micro-marchés à fort potentiel.`,
          ``,
          `À très vite,`,
          `L'équipe datamerry`,
          `https://datamerry.com`,
        ],
        agent: [
          `Bonjour ${prenom || ""},`,
          ``,
          `Votre demande d'accès aux données DVF enrichies a bien été enregistrée.`,
          ``,
          `Vous recevrez les rapports de marché et leads qualifiés pour votre secteur sous 24h.`,
          ``,
          `À très vite,`,
          `L'équipe datamerry`,
          `https://datamerry.com`,
        ],
      };
      const confirmSubjects: Record<string, string> = {
        acheteur: `Votre recherche à ${commune_nom} — datamerry`,
        vendeur: `Votre estimation à ${commune_nom} — datamerry`,
        investisseur: `Votre projet d'investissement à ${commune_nom} — datamerry`,
        agent: `Accès données DVF · ${commune_nom} — datamerry`,
      };
      resend.emails.send({
        from: "datamerry <no-reply@datamerry.com>",
        to: email,
        subject: confirmSubjects[intent] ?? `Votre demande pour ${commune_nom} — datamerry`,
        text: (confirmMessages[intent] ?? confirmMessages.acheteur).join("\n"),
      }).catch((err: unknown) => console.error("resend lead confirmation error:", err));
    }
  }

  return NextResponse.json({ ok: true });
}

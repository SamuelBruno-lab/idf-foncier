import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function POST(req: NextRequest) {
  const { email, commune_code, commune_nom } = await req.json();

  if (!email || !commune_code) {
    return NextResponse.json({ error: "email et commune_code requis" }, { status: 400 });
  }

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email)) {
    return NextResponse.json({ error: "email invalide" }, { status: 400 });
  }

  // Insert job + waitlist en même temps
  const [jobResult] = await Promise.all([
    getSupabase().from("jobs").insert({
      commune_code,
      commune_nom,
      user_email: email,
      status: "pending_payment",
      amount_eur: 19.99,
    }),
    getSupabase().from("waitlist").upsert(
      { email, commune_code, commune_nom, type: "paid_request" },
      { onConflict: "email,commune_code", ignoreDuplicates: false }
    ),
  ]);

  if (jobResult.error) {
    console.error("jobs insert error:", jobResult.error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }

  // Emails non-bloquants — ne pas faire échouer la requête si Resend est KO
  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const communeLabel = commune_nom ?? commune_code;

    // Notification interne owner
    resend.emails.send({
      from: "datamerry <no-reply@datamerry.com>",
      to: "contact@datamerry.com",
      subject: `[datamerry] Nouvelle demande · ${communeLabel} · 19,99€`,
      text: [
        `Nouvelle demande d'analyse payante reçue.`,
        ``,
        `Email    : ${email}`,
        `Commune  : ${communeLabel} (${commune_code})`,
        ``,
        `→ Envoyer le lien de paiement à ${email}`,
        `→ Supabase jobs : https://supabase.com/dashboard/project/zexkxstcwkdsqjgsppvx/editor`,
      ].join("\n"),
    }).catch((err: unknown) => console.error("resend owner email error:", err));

    // Confirmation utilisateur
    resend.emails.send({
      from: "datamerry <no-reply@datamerry.com>",
      to: email,
      subject: `Votre demande d'analyse pour ${communeLabel} — datamerry`,
      text: [
        `Bonjour,`,
        ``,
        `Nous avons bien reçu votre demande d'analyse foncière pour ${communeLabel}.`,
        ``,
        `Vous recevrez un lien de paiement (19,99€ TTC) par email sous 24h.`,
        `Dès réception du paiement, votre carte interactive sera générée sous 72h.`,
        ``,
        `À bientôt,`,
        `L'équipe datamerry`,
        `https://datamerry.com`,
      ].join("\n"),
    }).catch((err: unknown) => console.error("resend user email error:", err));
  }

  return NextResponse.json({ ok: true });
}

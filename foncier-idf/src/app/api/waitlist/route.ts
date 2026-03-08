import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(req: NextRequest) {
  const { email, commune_code, commune_nom, type } = await req.json();

  if (!email || !commune_code) {
    return NextResponse.json({ error: "email et commune_code requis" }, { status: 400 });
  }

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email)) {
    return NextResponse.json({ error: "email invalide" }, { status: 400 });
  }

  const entryType = type ?? "notify";

  // Upsert pour éviter les doublons
  const { error } = await supabase.from("waitlist").upsert(
    { email, commune_code, commune_nom, type: entryType },
    { onConflict: "email,commune_code", ignoreDuplicates: true }
  );

  if (error) {
    console.error("waitlist upsert error:", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }

  // Confirmation email uniquement pour les inscriptions gratuites (pas les paid_request)
  if (entryType === "notify" && process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const communeLabel = commune_nom ?? commune_code;
    resend.emails.send({
      from: "datamerry <no-reply@datamerry.com>",
      to: email,
      subject: `Vous êtes sur la liste pour ${communeLabel} — datamerry`,
      text: [
        `Bonjour,`,
        ``,
        `Vous êtes bien inscrit(e) sur la liste d'attente pour ${communeLabel}.`,
        ``,
        `Vous serez notifié(e) par email dès que l'analyse sera disponible gratuitement.`,
        ``,
        `À bientôt,`,
        `L'équipe datamerry`,
        `https://datamerry.com`,
      ].join("\n"),
    }).catch((err: unknown) => console.error("resend waitlist email error:", err));
  }

  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  const commune_code = req.nextUrl.searchParams.get("commune_code");
  if (!commune_code) return NextResponse.json({ count: 0 });

  const { count } = await supabase
    .from("waitlist")
    .select("*", { count: "exact", head: true })
    .eq("commune_code", commune_code);

  return NextResponse.json({ count: count ?? 0 });
}

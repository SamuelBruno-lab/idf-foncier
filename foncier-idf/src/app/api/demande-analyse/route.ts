import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

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
  const [jobResult, waitlistResult] = await Promise.all([
    supabase.from("jobs").insert({
      commune_code,
      commune_nom,
      user_email: email,
      status: "pending_payment",
      amount_eur: 19.99,
    }),
    supabase.from("waitlist").upsert(
      { email, commune_code, commune_nom, type: "paid_request" },
      { onConflict: "email,commune_code", ignoreDuplicates: false }
    ),
  ]);

  if (jobResult.error) {
    console.error("jobs insert error:", jobResult.error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  const user_id: string = (body.user_id ?? "").trim();
  const email: string = (body.email ?? "").trim().toLowerCase();
  const prenom: string = (body.prenom ?? "").trim().slice(0, 80);
  const nom: string = (body.nom ?? "").trim().slice(0, 80);
  const role: string = (body.role ?? "").trim();
  const goal: string = (body.goal ?? "").trim();
  const commune_code: string = (body.commune_code ?? "").trim().slice(0, 10);
  const commune_nom: string = (body.commune_nom ?? "").trim().slice(0, 120);

  if (!user_id || !role || !goal) {
    return NextResponse.json({ error: "Champs requis manquants" }, { status: 400 });
  }

  const { error } = await getSupabase().from("user_profiles").upsert(
    {
      user_id,
      email: email || null,
      prenom: prenom || null,
      nom: nom || null,
      role,
      goal,
      commune_code: commune_code || null,
      commune_nom: commune_nom || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error) {
    console.error("profile upsert error:", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

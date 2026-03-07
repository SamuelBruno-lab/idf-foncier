import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json([]);

  const { data, error } = await supabase
    .from("dvf_clusters_commune")
    .select("cluster_id, nom")
    .ilike("nom", `%${q}%`)
    .order("nom")
    .limit(200); // on déduplique côté serveur

  if (error) return NextResponse.json([], { status: 500 });

  // Dédupliquer par code_commune (cluster_id = "{code}_{type_local}")
  const seen = new Set<string>();
  const results: { code: string; nom: string }[] = [];
  for (const row of data ?? []) {
    const code = row.cluster_id.split("_")[0];
    if (!seen.has(code)) {
      seen.add(code);
      results.push({ code, nom: row.nom });
    }
    if (results.length >= 10) break;
  }

  return NextResponse.json(results);
}

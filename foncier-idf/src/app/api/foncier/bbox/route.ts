import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import type { ParcelBBoxItem } from "@/lib/foncier-types";

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseServerClient();
    const { searchParams } = new URL(req.url);

    const minx = Number(searchParams.get("minx"));
    const miny = Number(searchParams.get("miny"));
    const maxx = Number(searchParams.get("maxx"));
    const maxy = Number(searchParams.get("maxy"));
    const minScore = Number(searchParams.get("minScore") ?? "6");
    const limit = Number(searchParams.get("limit") ?? "500");

    const invalid =
      [minx, miny, maxx, maxy].some((v) => Number.isNaN(v)) ||
      minx >= maxx ||
      miny >= maxy;

    if (invalid) {
      return NextResponse.json(
        { error: "BBox invalide." },
        { status: 400 }
      );
    }

    const { data, error } = await supabase.rpc("get_foncier_bbox", {
      minx,
      miny,
      maxx,
      maxy,
      min_score: minScore,
      limit_count: limit,
    });

    if (error) {
      console.error("API /foncier/bbox error:", error);
      const notFound = error.code === "PGRST202" || error.message?.includes("schema cache");
      return NextResponse.json(
        { error: notFound
            ? "Fonction get_foncier_bbox non trouvée. Exécutez le schéma SQL (sql/08_foncier_schema.sql) dans Supabase."
            : "Erreur lors de la récupération cartographique.",
          items: [], count: 0 },
        { status: notFound ? 200 : 500 }
      );
    }

    return NextResponse.json({
      items: (data ?? []) as ParcelBBoxItem[],
      count: data?.length ?? 0,
    });
  } catch (e) {
    console.error("Unexpected /foncier/bbox error:", e);
    return NextResponse.json(
      { error: "Erreur serveur inattendue." },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

type Params = {
  params: Promise<{ z: string; x: string; y: string }>;
};

export async function GET(req: NextRequest, { params }: Params) {
  const { z, x, y } = await params;
  const zNum = Number(z);
  const xNum = Number(x);
  const yNum = Number(y.replace(/\.mvt$/, ""));

  if ([zNum, xNum, yNum].some(Number.isNaN)) {
    return new NextResponse("Invalid tile coordinates", { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const minScore = Number(searchParams.get("minScore") ?? "0");
  const insee = searchParams.get("insee") || null;

  const supabase = getSupabaseServerClient();

  try {
    const { data, error } = await supabase.rpc("get_mvt_tile", {
      p_z: zNum,
      p_x: xNum,
      p_y: yNum,
      p_min_score: minScore,
      p_insee: insee,
    });

    if (error) {
      console.error("MVT tile RPC error:", error);
      return new NextResponse(null, { status: 204 });
    }

    // Supabase returns base64-encoded bytea
    if (!data) {
      return new NextResponse(null, {
        status: 204,
        headers: { "Cache-Control": "public, max-age=300, s-maxage=300" },
      });
    }

    // The RPC returns hex-encoded bytea, decode it
    const hex = typeof data === "string" ? data.replace(/^\\x/, "") : "";
    const bytes = new Uint8Array(
      hex.match(/.{1,2}/g)?.map((byte: string) => parseInt(byte, 16)) ?? []
    );

    if (bytes.length === 0) {
      return new NextResponse(null, {
        status: 204,
        headers: { "Cache-Control": "public, max-age=300, s-maxage=300" },
      });
    }

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.mapbox-vector-tile",
        "Cache-Control": "public, max-age=300, s-maxage=300",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    console.error("MVT tile error:", e);
    return new NextResponse("Tile error", { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Handles the Supabase Auth magic link callback.
 * New users → /onboarding, returning users → /
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { data } = await supabase.auth.exchangeCodeForSession(code);

    // Check if user has a profile (= already onboarded)
    if (data?.user) {
      const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      );
      const { data: profile } = await admin
        .from("user_profiles")
        .select("id")
        .eq("user_id", data.user.id)
        .maybeSingle();

      if (!profile) {
        // New user → onboarding
        return NextResponse.redirect(new URL("/onboarding", req.url));
      }
    }
  }

  // Returning user → home
  return NextResponse.redirect(new URL("/", req.url));
}

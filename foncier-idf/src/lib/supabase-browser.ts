import { createClient } from "@supabase/supabase-js";

let client: ReturnType<typeof createClient> | null = null;

/** Singleton Supabase client for browser (auth-enabled) */
export function getSupabaseBrowser() {
  if (client) return client;
  client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return client;
}

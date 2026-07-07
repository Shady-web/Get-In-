// Browser-side Supabase client: auth (email/password, Google) + realtime
// leaderboard reads. Uses the public anon key (browser-safe); the session
// persists in localStorage and detectSessionInUrl completes OAuth redirects.
// All game writes still go through our server routes with the service key.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null | undefined;

export function getSupabaseBrowser(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  cached =
    url && key
      ? createClient(url, key, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        })
      : null;
  return cached;
}

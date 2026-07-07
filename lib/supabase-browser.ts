// Browser-side Supabase client: auth (email/password, Google) + realtime
// leaderboard reads. Uses the public anon key (browser-safe); the session
// persists in localStorage and detectSessionInUrl completes OAuth redirects.
// All game writes still go through our server routes with the service key.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null | undefined;

export function getSupabaseBrowser(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  // Tolerate copy-paste artifacts (quotes/whitespace) and validate, so a
  // typo shows up as a console message instead of a hard crash.
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\/+$/, "");
  const key = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "")
    .trim()
    .replace(/^["']|["']$/g, "");
  let valid = false;
  try {
    const parsed = new URL(url);
    valid = parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    valid = false;
  }
  if (!valid || !key) {
    if (url || key) {
      console.error(
        "[supabase] NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY " +
          "must BOTH be set (Project Settings -> API: Project URL + anon key), " +
          "e.g. NEXT_PUBLIC_SUPABASE_URL=https://abcdefgh.supabase.co - and " +
          "restart the dev server after editing .env.local.",
      );
    }
    cached = null;
    return cached;
  }
  cached = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return cached;
}

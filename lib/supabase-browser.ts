// Browser-side Supabase client: auth (email/password, Google) + realtime
// leaderboard reads. Uses the public anon key (browser-safe); the session
// persists in localStorage and detectSessionInUrl completes OAuth redirects.
// All game writes still go through our server routes with the service key.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null | undefined;

export function getSupabaseBrowser(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  // Tolerate copy-paste artifacts (quotes/whitespace) and validate, so a
  // typo shows up as a console message instead of a hard crash. Take only
  // the first token: a multi-line paste can append the next env line to a
  // value, which would otherwise break the Authorization header.
  const firstToken = (v: string | undefined) =>
    (v ?? "").trim().replace(/^["']|["']$/g, "").split(/\s/)[0] ?? "";
  const url = firstToken(process.env.NEXT_PUBLIC_SUPABASE_URL).replace(/\/+$/, "");
  const key = firstToken(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
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

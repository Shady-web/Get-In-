// Server-only Supabase client using the service-role key. Identity comes
// from Supabase Auth (verified in lib/auth.ts); RLS stays locked and every
// DB access goes through our own API routes with this admin client. Never
// import this from client code.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Env values often arrive with stray quotes/whitespace from copy-paste.
 * Clean them and validate, so a typo logs a pointed message instead of
 * crashing the whole app with "Invalid supabaseUrl".
 */
export function cleanSupabaseUrl(raw: string | undefined, name: string): string | null {
  const url = (raw ?? "").trim().replace(/^["']|["']$/g, "").replace(/\/+$/, "");
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("bad protocol");
    return url;
  } catch {
    console.error(
      `[supabase] ${name} is not a valid URL (got "${raw}"). ` +
        `Expected the Project URL from Supabase -> Project Settings -> API, ` +
        `e.g. https://abcdefgh.supabase.co`,
    );
    return null;
  }
}

let cached: SupabaseClient | null = null;

/** Returns the admin client, or null when Supabase env isn't configured yet. */
export function getSupabaseAdmin(): SupabaseClient | null {
  if (cached) return cached;
  const url = cleanSupabaseUrl(process.env.SUPABASE_URL, "SUPABASE_URL");
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim().replace(/^["']|["']$/g, "");
  if (!url || !key) return null;
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

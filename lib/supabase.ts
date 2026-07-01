// Server-only Supabase client using the service-role key.
// There is NO Supabase Auth in this app — identity is just a wallet address
// or nickname — so RLS stays locked and every DB access goes through our own
// API routes with this admin client. Never import this from client code.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/** Returns the admin client, or null when Supabase env isn't configured yet. */
export function getSupabaseAdmin(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

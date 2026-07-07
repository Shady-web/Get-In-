// Browser-side fetch that attaches the Supabase session token. Server routes
// verify it (lib/auth.ts) - identity is never a client-chosen string.

import { getSupabaseBrowser } from "@/lib/supabase-browser";

export async function authFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const supabase = getSupabaseBrowser();
  const token = supabase
    ? (await supabase.auth.getSession()).data.session?.access_token
    : null;
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

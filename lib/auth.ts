// Server-only auth: verify the Supabase access token the browser sends and
// hand routes a trustworthy user id. Identity is no longer a client-supplied
// string; it is whoever the token says it is.

import { getSupabaseAdmin } from "@/lib/supabase";

export interface AuthUser {
  userId: string; // Supabase auth user id (uuid) - THE identity everywhere
  email: string | null;
  username: string | null; // chosen at sign-up (user_metadata), if any
}

/**
 * Resolve the caller from the Authorization: Bearer <access_token> header.
 * Throws with .status = 401 when the token is missing or invalid.
 */
export async function requireUser(request: Request): Promise<AuthUser> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    throw httpError(503, "Supabase is not configured on the server.");
  }
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw httpError(401, "Sign in to do that.");

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) throw httpError(401, "Session expired. Sign in again.");

  const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>;
  return {
    userId: data.user.id,
    email: data.user.email ?? null,
    username: typeof meta.username === "string" ? meta.username : null,
  };
}

export function httpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

/** Uniform error response helper for routes using requireUser. */
export function errorStatus(err: unknown): number {
  const s = (err as { status?: unknown })?.status;
  return typeof s === "number" ? s : 502;
}

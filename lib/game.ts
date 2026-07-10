// Server-only player persistence: resolving and creating the players row for
// an authenticated Supabase user. (This module used to also save and settle
// prediction-card picks; that points game was removed — betting is the game
// now — so only the player helpers and the isFinal re-export remain.)

import { getSupabaseAdmin } from "@/lib/supabase";

export { isFinal } from "@/lib/game-core";

export interface PlayerRow {
  id: string;
  wallet_or_nickname: string; // mirrors username (kept for display code)
  auth_user_id?: string | null; // schema v8: the Supabase Auth user id
  username?: string | null;
  coin_balance?: number; // schema v8 (was coins)
  sol_balance?: number; // lamports, schema v8
}

/**
 * Resolve a player by their VERIFIED Supabase auth user id (every route gets
 * it from requireUser; clients can no longer pick their own identity). The
 * row is normally created by the /api/player bootstrap right after login
 * with the real username; this fallback self-heals with a placeholder name.
 */
export async function getOrCreatePlayer(identity: string): Promise<PlayerRow> {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase is not configured on the server.");
  const { data } = await supabase
    .from("players")
    .select("*")
    .eq("auth_user_id", identity)
    .maybeSingle();
  if (data) return data as PlayerRow;
  return ensurePlayer({ userId: identity, email: null, username: null });
}

/** Sanitize a candidate username: lowercase a-z 0-9 _ only, 3-20 chars. */
export function cleanUsername(raw: string): string {
  const s = raw.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
  return s.length >= 3 ? s : "";
}

/**
 * Create (or fetch) the player row for an authenticated user. Username
 * preference: chosen at sign-up (metadata) > email prefix > player_xxxxxx.
 * Collisions with taken usernames retry with a numeric suffix.
 */
export async function ensurePlayer(user: {
  userId: string;
  email: string | null;
  username: string | null;
}): Promise<PlayerRow> {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase is not configured on the server.");

  const { data: existing } = await supabase
    .from("players")
    .select("*")
    .eq("auth_user_id", user.userId)
    .maybeSingle();
  if (existing) return existing as PlayerRow;

  const base =
    cleanUsername(user.username ?? "") ||
    cleanUsername(user.email?.split("@")[0] ?? "") ||
    `player_${user.userId.replace(/-/g, "").slice(0, 6)}`;

  for (let attempt = 0; attempt < 6; attempt++) {
    const username =
      attempt === 0 ? base : `${base.slice(0, 16)}${Math.floor(Math.random() * 9000) + 1000}`;
    const { data, error } = await supabase
      .from("players")
      .insert({
        auth_user_id: user.userId,
        username,
        wallet_or_nickname: username,
      })
      .select("*")
      .single();
    if (!error && data) return data as PlayerRow;
    if (error?.code === "23505") {
      // Either another request created us concurrently (fine, fetch it) or
      // the username is taken (roll a suffix and retry).
      const { data: raced } = await supabase
        .from("players")
        .select("*")
        .eq("auth_user_id", user.userId)
        .maybeSingle();
      if (raced) return raced as PlayerRow;
      continue;
    }
    throw new Error(`Player lookup failed: ${error?.message ?? "unknown"}`);
  }
  throw new Error("Could not find a free username. Try again.");
}

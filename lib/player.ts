// Client-side identity types. Identity IS the Supabase Auth user id; the
// label is the username (or email prefix) for display. No localStorage:
// the Supabase session is the single source of truth.

export interface PlayerRecord {
  id: string;
  wallet_or_nickname: string; // mirrors username
  username?: string | null;
  coin_balance?: number;
  sol_balance?: number; // lamports
}

export interface StoredPlayer {
  identity: string; // Supabase auth user id (uuid)
  label: string; // username / email prefix, for display
  player: PlayerRecord | null;
}

export function displayName(p: StoredPlayer): string {
  return p.player?.username ?? p.player?.wallet_or_nickname ?? p.label;
}

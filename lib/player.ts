// Client-side identity storage. No Supabase Auth - identity is just the
// wallet address or a nickname, remembered in localStorage.

export interface PlayerRecord {
  id: string;
  wallet_or_nickname: string;
  total_points: number;
  best_streak: number;
  current_streak?: number;
}

export interface StoredPlayer {
  identity: string; // wallet address or nickname
  kind: "wallet" | "guest";
  player: PlayerRecord | null; // Supabase row, if the API had it
}

const KEY = "getin.player";

export function getStoredPlayer(): StoredPlayer | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredPlayer) : null;
  } catch {
    return null;
  }
}

export function setStoredPlayer(p: StoredPlayer): void {
  window.localStorage.setItem(KEY, JSON.stringify(p));
}

export function clearStoredPlayer(): void {
  window.localStorage.removeItem(KEY);
}

/** "7xKX…9fGh" for wallets; nicknames pass through untouched. */
export function displayName(p: StoredPlayer): string {
  return p.kind === "wallet"
    ? `${p.identity.slice(0, 4)}…${p.identity.slice(-4)}`
    : p.identity;
}

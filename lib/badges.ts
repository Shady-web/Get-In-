// Server-only milestone badges. Conditions are checked against data the app
// already stores, so a badge is awarded the first time it is OBSERVED (past
// achievements count retroactively) and then kept forever in the badges
// table. Awarding is idempotent: the unique(player, badge_id) constraint
// makes double inserts harmless.

import { getSupabaseAdmin } from "@/lib/supabase";
import { getOrCreatePlayer } from "@/lib/game";

export interface BadgeDef {
  id: string;
  icon: string;
  name: string;
  hint: string; // how to earn it (shown on locked badges)
}

export const BADGE_DEFS: BadgeDef[] = [
  { id: "first_win", icon: "🏅", name: "First Win", hint: "Win any bet slip" },
  { id: "first_cashout", icon: "💸", name: "Cool Head", hint: "Cash out a bet early" },
  { id: "parlay_5", icon: "🎰", name: "Parlay Pro", hint: "Win an accumulator with 5+ legs" },
  { id: "streak_10", icon: "🔥", name: "On Fire", hint: "Hit a 10-win prediction streak" },
  { id: "bankroll_5k", icon: "👑", name: "High Roller", hint: "Grow your bankroll to 5,000 coins" },
];

export interface BadgeStatus extends BadgeDef {
  earnedAt: string | null; // null = still locked
}

export async function getBadges(identity: string): Promise<BadgeStatus[]> {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase is not configured on the server.");
  const player = await getOrCreatePlayer(identity);

  const [ownedRes, slipsRes, predRes] = await Promise.all([
    supabase.from("badges").select("badge_id, earned_at").eq("player", player.id),
    supabase
      .from("bet_slips")
      .select("status, bet_legs(id)")
      .eq("player", player.id)
      .in("status", ["won", "cashed"]),
    supabase
      .from("predictions")
      .select("id", { count: "exact", head: true })
      .eq("player", player.id)
      .eq("result", "won"),
  ]);

  const owned = new Map(
    (ownedRes.data ?? []).map((b: any) => [b.badge_id as string, b.earned_at as string]),
  );
  const slips = (slipsRes.data ?? []).map((s: any) => ({
    status: String(s.status),
    legs: Array.isArray(s.bet_legs) ? s.bet_legs.length : 0,
  }));

  const conditions: Record<string, boolean> = {
    first_win: slips.some((s) => s.status === "won") || (predRes.count ?? 0) > 0,
    first_cashout: slips.some((s) => s.status === "cashed"),
    parlay_5: slips.some((s) => s.status === "won" && s.legs >= 5),
    streak_10: (player.best_streak ?? 0) >= 10,
    bankroll_5k: (player.coin_balance ?? 0) >= 5_000,
  };

  const newlyEarned = BADGE_DEFS.filter((b) => !owned.has(b.id) && conditions[b.id]);
  if (newlyEarned.length > 0) {
    const now = new Date().toISOString();
    const { error } = await supabase.from("badges").insert(
      newlyEarned.map((b) => ({ player: player.id, badge_id: b.id })),
    );
    if (!error || error.code === "23505") {
      for (const b of newlyEarned) owned.set(b.id, now);
    }
  }

  return BADGE_DEFS.map((b) => ({ ...b, earnedAt: owned.get(b.id) ?? null }));
}

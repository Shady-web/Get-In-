import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** GET /api/leaderboard: top 20 players by points. */
export async function GET() {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "Supabase is not configured on the server." },
      { status: 503 },
    );
  }

  // Rank by coin bankroll (aliased from coin_balance, schema v8); fall back
  // to points if the column doesn't exist yet so the board never goes dark.
  let data: unknown[] | null;
  let error: { message: string } | null;
  ({ data, error } = await supabase
    .from("players")
    .select("wallet_or_nickname, total_points, best_streak, current_streak, coins:coin_balance")
    .order("coin_balance", { ascending: false })
    .limit(20));
  if (error) {
    ({ data, error } = await supabase
      .from("players")
      .select("wallet_or_nickname, total_points, best_streak, current_streak")
      .order("total_points", { ascending: false })
      .limit(20));
  }

  if (error) {
    return NextResponse.json(
      { ok: false, error: `Leaderboard unavailable: ${error.message}` },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, players: data ?? [] });
}

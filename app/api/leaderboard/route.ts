import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface LeaderRow {
  wallet_or_nickname: string;
  coins: number;
  sol: number; // lamports
}

/**
 * GET /api/leaderboard: two boards, top 20 each — highest GI-coin bankroll
 * and highest SOL balance (spendable custodial SOL, lamports). The client
 * toggles between them.
 *
 * Only REAL accounts appear: rows must have an auth_user_id (a Supabase
 * email/Google sign-up), which excludes the legacy players created before
 * email login was added. And a player only shows once they have standing on
 * that board - coins earned from quests/wins for the coin board, SOL for the
 * SOL board - so empty brand-new accounts don't clutter it.
 */
export async function GET() {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "Supabase is not configured on the server." },
      { status: 503 },
    );
  }

  const [coinsRes, solRes] = await Promise.all([
    supabase
      .from("players")
      .select("wallet_or_nickname, coin_balance, sol_balance")
      .not("auth_user_id", "is", null)
      .gt("coin_balance", 0)
      .order("coin_balance", { ascending: false })
      .limit(20),
    supabase
      .from("players")
      .select("wallet_or_nickname, coin_balance, sol_balance")
      .not("auth_user_id", "is", null)
      .gt("sol_balance", 0)
      .order("sol_balance", { ascending: false })
      .limit(20),
  ]);

  if (coinsRes.error || solRes.error) {
    const message = coinsRes.error?.message ?? solRes.error?.message ?? "unknown";
    return NextResponse.json(
      { ok: false, error: `Leaderboard unavailable: ${message}` },
      { status: 502 },
    );
  }

  const shape = (rows: unknown[] | null): LeaderRow[] =>
    (rows ?? []).map((r) => {
      const row = r as Record<string, unknown>;
      return {
        wallet_or_nickname: String(row.wallet_or_nickname ?? ""),
        coins: Number(row.coin_balance ?? 0),
        sol: Number(row.sol_balance ?? 0),
      };
    });

  return NextResponse.json({
    ok: true,
    byCoins: shape(coinsRes.data),
    bySol: shape(solRes.data),
  });
}

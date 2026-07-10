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
      .order("coin_balance", { ascending: false })
      .limit(20),
    supabase
      .from("players")
      .select("wallet_or_nickname, coin_balance, sol_balance")
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

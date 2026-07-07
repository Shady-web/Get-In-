import { NextResponse } from "next/server";
import { logCoinLedger } from "@/lib/wallet";
import { errorStatus, requireUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getOrCreatePlayer } from "@/lib/game";

export const dynamic = "force-dynamic";

const CLAIM_AMOUNT = 500;
const CLAIM_EVERY_MS = 24 * 3600_000;

/** POST /api/coins/claim { identity }: 500 free coins, once per 24h. */
export async function POST(request: Request) {
  let identity: string;
  try {
    identity = (await requireUser(request)).userId;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sign in to do that.";
    return NextResponse.json({ ok: false, error: message }, { status: errorStatus(err) });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "Supabase is not configured on the server." },
      { status: 503 },
    );
  }

  try {
    const player = await getOrCreatePlayer(identity);
    const last = player.last_claim ? new Date(player.last_claim).getTime() : 0;
    const nextAt = last + CLAIM_EVERY_MS;
    if (Date.now() < nextAt) {
      return NextResponse.json(
        { ok: false, error: "Already claimed today.", nextClaimAt: nextAt },
        { status: 429 },
      );
    }
    const { data, error } = await supabase
      .from("players")
      .update({
        coin_balance: (player.coin_balance ?? 0) + CLAIM_AMOUNT,
        last_claim: new Date().toISOString(),
      })
      .eq("id", player.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await logCoinLedger(player.id, "daily_claim", CLAIM_AMOUNT);
    return NextResponse.json({
      ok: true,
      player: data,
      claimed: CLAIM_AMOUNT,
      nextClaimAt: Date.now() + CLAIM_EVERY_MS,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Claim failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
